/**
 * Dersin tarz kütüphanesini yeniden kurar (style.ingest 3.–4. adım): dersin bütün maddeleri kümelenir (cluster.ts),
 * kümeler var olan tarzlarla eşlenir, yeni kümeler style_definition ile adlandırılır, sonuç upsert_question_styles ile
 * yazılır. Eğitmenin onayladığı/düzenlediği ya da etkinleştirdiği tarzın maddeleri yerinde kalır, adı ve tanımı ezilmez
 * (SQL de korur). Model adı/tanımı ürün kuralına uymazsa (öngörü sözcüğü, üye metninden 30+ karakter kopya, uzunluk)
 * yedek ad (en sık konu / kazanım adı) ve boş tanım yazılır.
 */
import type { StyleDefinition } from '@ogrenmen/contracts';
import { STYLE_FORMATS } from '@ogrenmen/contracts';
import type { ClusterInput } from '@ogrenmen/prompts';
import type { Logger } from '../log.js';
import {
  assignStyles,
  clusterItems,
  distanceMatrix,
  fallbackName,
  medoidOrder,
  mostCommon,
  uniqueCode,
  usableStyleText,
  type AssignedCluster,
} from './cluster.js';
import { loadCourseItems, loadStyles, skillNames, upsertStyles, type CourseItem, type StylePayload, type StyleRow } from './db.js';
import { defineStyles, type StyleCallEnv } from './llm.js';

/** Tek style_definition çağrısında en çok küme (sözleşme 60). */
export const DEFINE_CHUNK = 40;

export interface LibraryResult {
  items: number;
  clusters: number;
  method: 'embedding' | 'tfidf';
  created: number;
  reused: number;
  moved: number;
  named_by_model: number;
  named_fallback: number;
  cost_usd: number;
}

type Band = 'easy' | 'medium' | 'hard';

function bandOf(values: readonly (number | null)[]): Band | null {
  const xs = values.filter((v): v is number => v !== null);
  if (xs.length === 0) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return m < 0.4 ? 'easy' : m < 0.65 ? 'medium' : 'hard';
}

function centroid(vs: readonly (number[] | null)[]): number[] | null {
  const ok = vs.filter((v): v is number[] => Array.isArray(v) && v.length > 0);
  if (ok.length === 0 || ok.length !== vs.length) return null;
  const out = new Array<number>(ok[0]!.length).fill(0);
  for (const v of ok) for (let i = 0; i < out.length; i++) out[i]! += v[i]! / ok.length;
  return out.map((x) => Math.round(x * 1e6) / 1e6);
}

/** Model girdisi: kümenin üyeleri (medoid sırası, en çok 6) ve özeti. */
export function clusterInput(c: AssignedCluster, items: readonly CourseItem[], order: readonly number[]): ClusterInput {
  const ms = c.members.map((i) => items[i]!);
  return {
    cluster_id: c.key,
    size: ms.length,
    years: [...new Set(ms.map((m) => m.year).filter((y): y is number => y !== null))].sort(),
    skill_ids: [...new Set(ms.flatMap((m) => m.skill_ids))].sort().slice(0, 5),
    members: order.slice(0, 6).map((i) => {
      const m = items[i]!;
      return { year: m.year, term: m.term, item_no: m.item_no, topic: m.topic, kind: m.kind, format: m.format, trick: m.trick, difficulty: m.difficulty, skill_ids: m.skill_ids, excerpt: m.ocr_text.slice(0, 400) };
    }),
  };
}

export interface RebuildInput {
  env: StyleCallEnv;
  courseCode: string | null;
  courseTitle: string | null;
  log: Logger;
}

export async function rebuildLibrary(inp: RebuildInput): Promise<LibraryResult> {
  const { env } = inp;
  const items = await loadCourseItems(env.db, env.courseId);
  const styles = await loadStyles(env.db, env.courseId);
  const res: LibraryResult = { items: items.length, clusters: 0, method: 'tfidf', created: 0, reused: 0, moved: 0, named_by_model: 0, named_fallback: 0, cost_usd: 0 };
  if (items.length === 0) return res;

  const clusterIn = items.map((it) => ({ id: it.id, text: it.ocr_text, topic: it.topic, skillIds: it.skill_ids, kind: it.kind, format: it.format, embedding: it.embedding }));
  const { groups, method } = clusterItems(clusterIn);
  const { dist, n } = distanceMatrix(clusterIn);
  res.method = method;
  res.clusters = groups.length;
  const byId = new Map<string, StyleRow>(styles.map((s) => [s.id, s]));
  const assigned = assignStyles({
    styleOf: items.map((it) => it.style_id),
    styles: styles.map((s) => ({ id: s.id, code: s.code, pinned: s.reviewed || s.status === 'active' })),
    groups,
  });
  const orders = new Map(assigned.map((c) => [c.key, medoidOrder(dist, n, c.members)]));

  // yeni kümeler: model adlandırır
  const fresh = assigned.filter((c) => c.styleId === null);
  const taken = new Set(styles.map((s) => s.code));
  const named = new Map<string, StyleDefinition['styles'][number]>();
  for (let i = 0; i < fresh.length; i += DEFINE_CHUNK) {
    const chunk = fresh.slice(i, i + DEFINE_CHUNK);
    try {
      const out = await defineStyles(env, {
        courseCode: inp.courseCode,
        courseTitle: inp.courseTitle,
        clusters: chunk.map((c) => clusterInput(c, items, orders.get(c.key)!)),
        takenCodes: [...taken],
      });
      res.cost_usd += out.costUsd;
      const keys = new Set(chunk.map((c) => c.key));
      for (const s of out.data.styles) if (keys.has(s.cluster_id) && !named.has(s.cluster_id)) named.set(s.cluster_id, s);
    } catch (err) {
      // adlandırma düşerse kümeler yedek adla yazılır (eğitmen kütüphanede yeniden adlandırır)
      inp.log.warn('style.ingest: tarz adlandırma düştü; yedek ad', { course: env.courseId, error: (err as Error).message.slice(0, 300) });
    }
  }

  const sk = await skillNames(env.db, env.curriculumId);
  const skillLeafOk = (s: string) => sk.size === 0 || sk.has(s);
  const payload: StylePayload[] = [];
  let ordinal = styles.length;
  for (const c of assigned) {
    const order = orders.get(c.key)!;
    const ms = c.members.map((i) => items[i]!);
    const exemplars = order.slice(0, 3).map((i) => items[i]!.id);
    const assignIds = c.assign.map((i) => items[i]!.id);
    if (c.styleId) {
      const st = byId.get(c.styleId)!;
      res.reused++;
      res.moved += assignIds.length;
      if (assignIds.length > 0) payload.push({ code: st.code, item_ids: assignIds });
      continue;
    }
    ordinal++;
    const texts = ms.map((m) => m.ocr_text);
    const def = named.get(c.key);
    const skills = [...new Set([...(def?.skill_ids ?? []), ...ms.flatMap((m) => m.skill_ids)])].filter(skillLeafOk).slice(0, 5);
    const modelName = def && usableStyleText(def.name, texts, 3, 80) ? def.name.trim() : null;
    if (modelName) res.named_by_model++;
    else res.named_fallback++;
    const name = modelName ?? fallbackName(ms.map((m) => ({ topic: m.topic, text: m.ocr_text, skillIds: m.skill_ids })), new Map([...sk].map(([k, v]) => [k, v.name])), ordinal);
    const description = def && usableStyleText(def.description, texts, 10, 500) ? def.description.trim() : null;
    // yedek tuzak da aynı denetimden geçer (öğrenciye gider: kopya ve öngörü sözcüğü yok)
    const fbTrick = mostCommon(ms.map((m) => m.trick?.trim() || null));
    const trick = def?.trick && usableStyleText(def.trick, texts, 3, 200) ? def.trick.trim() : usableStyleText(fbTrick, texts, 3, 200) ? fbTrick : null;
    const format = def?.format ?? mostCommon(ms.map((m) => m.format)) ?? 'other';
    const code = uniqueCode(def?.code && !taken.has(def.code) ? def.code : name, taken);
    const emb = centroid(ms.map((m) => m.embedding));
    payload.push({
      code,
      name,
      description,
      format: (STYLE_FORMATS as readonly string[]).includes(format) ? format : 'other',
      trick: trick && trick.length <= 200 ? trick : null,
      difficulty_band: def?.difficulty_band ?? bandOf(ms.map((m) => m.difficulty)),
      skill_ids: skills,
      item_ids: c.members.map((i) => items[i]!.id),
      exemplar_item_ids: exemplars,
      ...(emb ? { embedding: emb } : {}),
    });
    res.created++;
  }

  if (payload.length > 0) {
    await upsertStyles(env.db, env.courseId, payload);
  } else {
    // değişiklik yok: kaynakları kümelenmiş say (upsert_question_styles bunu worker çağrısında yapar)
    await env.db.query(`update public.exam_sources set status = 'clustered' where course_id = $1::uuid and status = 'ocr_done'`, [env.courseId]);
    await env.db.query('select app.refresh_style_scores($1::uuid)', [env.courseId]);
  }
  return res;
}
