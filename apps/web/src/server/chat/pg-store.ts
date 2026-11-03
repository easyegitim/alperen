/**
 * Üretim deposu (bugün yalnız yerel/test; üretimde kapalı). Koç turu güvenilir yazım ister (asistan turu, llm_calls,
 * hafıza aracı, eğitmen bildirimi); bunlar kullanıcı JWT'siyle kapalıdır (0018 conversation_messages_insert_own yalnız
 * role='user'; 0017 log_llm_call yalnız worker/personel; 0023 upsert_memory_file yalnız güvenilir çağıran). Bu yüzden
 * koç turu sunucuya özel bir Postgres bağlantısıyla (`OGRENMEN_WEB_COACH_DATABASE_URL`, yalnız `src/server/chat`;
 * tarayıcıya asla gitmez) okur ve yazar; her sorgu oturumdan çözülen öğrenci kimliğiyle açıkça kapsanır. Storage
 * nesneleri ve `uploads` satırı kullanıcının JWT'li istemcisiyle (RLS + Storage politikaları) okunur/yazılır.
 *
 * BİLİNEN SAPMA (PLAN-v2 §4, PLAN-v2-detail §2.4 "web yalnız kullanıcı JWT'si") — üretime bu hâliyle ÇIKMAZ:
 * okumalar da (geçmiş, dossier, ustalık, search_evidence, teşhis) bu bağlantıyla yapılır ve yalıtım yalnız elle
 * yazılmış WHERE süzgecine dayanır. RLS politikaları yalnız `to authenticated` olduğundan RLS'e tabi bir rol satır
 * göremez; çalışan tek rol RLS'i aşan roldür. Bu yüzden deps.ts `checkDbRole` kapalı başarısız olur: RLS'i aşan rol
 * üretimde her zaman 503, yerelde yalnız `OGRENMEN_WEB_COACH_TRUSTED_DEV=1` ile açılır.
 * Hedef (veritabanı + bu dosya): okumalar kullanıcı JWT'siyle (kendi sohbeti/mesajları 0018 select politikaları,
 * `render_dossier` RPC'si + `renderDossierText`, ustalık, sınavlar); güvenilir yazımlar SECURITY DEFINER
 * `coach_append_assistant_turn`, `coach_log_llm_call`, `coach_upsert_memory`, `coach_escalate` RPC'leriyle — her biri
 * sohbet, öğrenci ve katılımcının birbirine ait olduğunu denetler ve yalnız tablo yetkisi olmayan (yalnız EXECUTE)
 * `ogrenmen_web_coach` rolüne verilir.
 *
 * Tur kilidi: oturum düzeyinde danışma kilidi (`pg_try_advisory_lock(NS, hashtext(conversation_id))`), tur boyunca
 * ayrı bir bağlantıda tutulur (bağlantı ölürse kilit kendiliğinden düşer). Bu yüzden bağlantı adresi oturum kipinde
 * olmalıdır (doğrudan ya da Supavisor :5432; işlem kipi :6543 oturum kilidini taşımaz).
 */
import 'server-only';
import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import {
  CourseBlockCache,
  DossierError,
  PgLedger,
  PgStore,
  renderCourseBlock,
  renderDossier,
  type LedgerWriter,
  type MemoryStore,
  type ToolRunners,
} from '@ogrenmen/llm';
import { bandOf, ESCALATION_DEDUPE_MS, escalationBody, evidenceWords, snippet } from './format';
import type {
  ChatStore,
  ChatStudent,
  CoachMode,
  ConversationRow,
  EscalationInput,
  SeedContext,
  StoredBlock,
  StoredMessage,
  TurnClaim,
  TurnRecord,
  UploadBlob,
  UploadRow,
} from './types';
import { isCoachMode } from './types';

/** Kullanıcının JWT'li Supabase istemcisinden gereken dar parça (Storage + uploads ekleme). */
export interface UserStorageClient {
  storage: {
    from(bucket: string): {
      upload(path: string, body: Uint8Array | Blob, opts: { contentType: string; upsert: boolean }): PromiseLike<{ error: { message: string } | null }>;
      download(path: string): PromiseLike<{ data: Blob | null; error: { message: string } | null }>;
    };
  };
  from(table: 'uploads'): {
    insert(row: Record<string, unknown>): PromiseLike<{ error: { message: string } | null }>;
  };
}

export const UPLOADS_BUCKET = 'uploads';
const courseCache = new CourseBlockCache();
const DOSSIER_MAX_AGE_MS = 5 * 60_000;

function conv(r: Record<string, unknown>): ConversationRow {
  return {
    id: String(r.id),
    mode: isCoachMode(r.mode) ? r.mode : 'hint',
    courseId: r.course_id ? String(r.course_id) : null,
    summary: typeof r.summary === 'string' ? r.summary : null,
    summaryUptoMessageId: r.summary_upto_message_id === null || r.summary_upto_message_id === undefined ? null : Number(r.summary_upto_message_id),
  };
}

function upload(r: Record<string, unknown>): UploadRow {
  return {
    id: String(r.id),
    kind: r.kind === 'pdf' ? 'pdf' : 'photo',
    mime: String(r.mime ?? (r.kind === 'pdf' ? 'application/pdf' : 'image/jpeg')),
    storagePath: String(r.storage_path),
    anthropicFileId: r.anthropic_file_id ? String(r.anthropic_file_id) : null,
    bytes: r.bytes === null || r.bytes === undefined ? null : Number(r.bytes),
  };
}

const CONV_COLS = 'id, mode, course_id, summary, summary_upto_message_id';
/** Danışma kilidi ad alanı (iki anahtarlı biçim: NS, hashtext(conversation_id)). */
export const TURN_LOCK_NS = 0x0c0a;

export class PgChatStore implements ChatStore {
  readonly kind = 'pg' as const;
  constructor(
    private readonly db: pg.Pool,
    private readonly user: UserStorageClient | null,
    /** Tur kilitlerinin tutulduğu havuz (her süren tur bir bağlantı tutar; sorgu havuzunu tüketmesin diye ayrı). */
    private readonly locks: pg.Pool = db,
  ) {}

  async claimTurn(conversationId: string): Promise<TurnClaim | null> {
    const client = await this.locks.connect();
    // Tur boyunca dışarıda tutulan bağlantı: koparsa (kilit de düşer) olay işlenmezse süreç çöker.
    const onError = (err: Error) => console.error('OGR-CHAT-013 tur kilidi bağlantısı koptu', err.message);
    client.on('error', onError);
    try {
      const r = await client.query('select pg_try_advisory_lock($1::int, hashtext($2::text)) as ok', [TURN_LOCK_NS, conversationId]);
      if (!r.rows[0]?.ok) {
        client.off('error', onError);
        client.release();
        return null;
      }
    } catch (err) {
      client.off('error', onError);
      client.release(err instanceof Error ? err : true);
      throw err;
    }
    let done = false;
    return {
      release: async () => {
        if (done) return;
        done = true;
        try {
          await client.query('select pg_advisory_unlock($1::int, hashtext($2::text))', [TURN_LOCK_NS, conversationId]);
          client.off('error', onError);
          client.release();
        } catch (err) {
          // Kilit bırakılamadıysa bağlantı havuza dönmez; kapanınca kilit düşer.
          client.off('error', onError);
          client.release(err instanceof Error ? err : true);
        }
      },
    };
  }

  async turnInProgress(conversationId: string): Promise<boolean> {
    // İşlem düzeyinde dene-kilitle: boşsa alınır ve deyim bitince bırakılır; başka oturum tutuyorsa false döner.
    const r = await this.db.query('select pg_try_advisory_xact_lock($1::int, hashtext($2::text)) as free', [TURN_LOCK_NS, conversationId]);
    return !r.rows[0]?.free;
  }

  async countMessages(conversationId: string, afterId: number | null): Promise<number> {
    const r = await this.db.query('select count(*)::int as n from public.conversation_messages where conversation_id = $1::uuid and id > $2', [
      conversationId,
      afterId ?? 0,
    ]);
    return Number(r.rows[0]?.n ?? 0);
  }

  async resolveStudent(profileId: string): Promise<ChatStudent | null> {
    const r = await this.db.query(
      `select s.id, s.public_ref, e.id as enrollment_id, e.course_id
         from public.students s
         left join lateral (
           select en.id, en.course_id from public.enrollments en
            where en.student_id = s.id and en.status = 'active'
            order by en.started_at desc, en.created_at desc limit 1
         ) e on true
        where s.profile_id = $1::uuid and s.status = 'active'`,
      [profileId],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      profileId,
      studentId: String(row.id),
      publicRef: String(row.public_ref),
      enrollmentId: row.enrollment_id ? String(row.enrollment_id) : null,
      courseId: row.course_id ? String(row.course_id) : null,
    };
  }

  async latestConversation(s: ChatStudent): Promise<ConversationRow | null> {
    const r = await this.db.query(
      `select ${CONV_COLS} from public.conversations
        where student_id = $1::uuid and participant_id = $2::uuid and kind = 'coach'
        order by coalesce(last_message_at, created_at) desc, created_at desc limit 1`,
      [s.studentId, s.profileId],
    );
    return r.rows[0] ? conv(r.rows[0]) : null;
  }

  async getConversation(s: ChatStudent, id: string): Promise<ConversationRow | null> {
    const r = await this.db.query(
      `select ${CONV_COLS} from public.conversations
        where id = $1::uuid and student_id = $2::uuid and participant_id = $3::uuid and kind = 'coach'`,
      [id, s.studentId, s.profileId],
    );
    return r.rows[0] ? conv(r.rows[0]) : null;
  }

  async createConversation(s: ChatStudent, mode: CoachMode): Promise<ConversationRow> {
    const r = await this.db.query(
      `insert into public.conversations (student_id, kind, participant_id, course_id, mode)
       values ($1::uuid, 'coach', $2::uuid, $3::uuid, $4) returning ${CONV_COLS}`,
      [s.studentId, s.profileId, s.courseId, mode],
    );
    return conv(r.rows[0]!);
  }

  async setMode(s: ChatStudent, conversationId: string, mode: CoachMode): Promise<boolean> {
    const r = await this.db.query(
      `update public.conversations set mode = $4
        where id = $1::uuid and student_id = $2::uuid and participant_id = $3::uuid and kind = 'coach'`,
      [conversationId, s.studentId, s.profileId, mode],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async listMessages(conversationId: string, opts: { afterId?: number | null; limit: number }): Promise<StoredMessage[]> {
    const r = await this.db.query(
      `select * from (
         select id, role, content, upload_ids, tool_calls, created_at from public.conversation_messages
          where conversation_id = $1::uuid and id > $2
          order by id desc limit $3
       ) t order by id`,
      [conversationId, opts.afterId ?? 0, opts.limit],
    );
    return r.rows.map((m) => ({
      id: Number(m.id),
      role: m.role as StoredMessage['role'],
      content: (Array.isArray(m.content) ? m.content : []) as StoredBlock[],
      uploadIds: Array.isArray(m.upload_ids) ? m.upload_ids.map(String) : [],
      toolCalls: (m.tool_calls ?? null) as TurnRecord | null,
      createdAt: new Date(m.created_at as string).toISOString(),
    }));
  }

  async appendMessages(
    conversationId: string,
    messages: { role: StoredMessage['role']; content: StoredBlock[]; uploadIds?: string[]; llmCallId?: number | null; toolCalls?: TurnRecord | null }[],
  ): Promise<number[]> {
    const client = await this.db.connect();
    try {
      await client.query('begin');
      const ids: number[] = [];
      for (const m of messages) {
        const r = await client.query(
          `insert into public.conversation_messages (conversation_id, role, content, upload_ids, llm_call_id, tool_calls)
           values ($1::uuid, $2, $3::jsonb, $4::uuid[], $5, $6::jsonb) returning id`,
          [conversationId, m.role, JSON.stringify(m.content), m.uploadIds ?? [], m.llmCallId ?? null, m.toolCalls ? JSON.stringify(m.toolCalls) : null],
        );
        ids.push(Number(r.rows[0]!.id));
      }
      await client.query('update public.conversations set last_message_at = now() where id = $1::uuid', [conversationId]);
      await client.query('commit');
      return ids;
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async getUploads(s: ChatStudent, ids: readonly string[]): Promise<UploadRow[]> {
    if (ids.length === 0) return [];
    const r = await this.db.query(
      `select id, kind, mime, storage_path, anthropic_file_id, bytes from public.uploads
        where id = any($1::uuid[]) and kind in ('photo', 'pdf')
          and (student_id = $2::uuid or (owner_id = $3::uuid and student_id is null))`,
      [[...ids], s.studentId, s.profileId],
    );
    return r.rows.map(upload);
  }

  async readUpload(_s: ChatStudent, u: UploadRow): Promise<UploadBlob | null> {
    if (!this.user) return null;
    const { data, error } = await this.user.storage.from(UPLOADS_BUCKET).download(u.storagePath);
    if (error || !data) return null;
    return { mime: u.mime, data: new Uint8Array(await data.arrayBuffer()) };
  }

  async saveUpload(
    s: ChatStudent,
    file: { mime: string; data: Uint8Array; kind: UploadRow['kind']; width?: number | null; height?: number | null },
  ): Promise<UploadRow> {
    if (!this.user) throw new Error('OGR-CHAT-003 yükleme için kullanıcı oturumu gerekli');
    const id = randomUUID();
    const ext = file.kind === 'pdf' ? 'pdf' : file.mime === 'image/png' ? 'png' : file.mime === 'image/webp' ? 'webp' : 'jpg';
    const path = `${s.profileId}/${id}.${ext}`;
    const up = await this.user.storage.from(UPLOADS_BUCKET).upload(path, file.data, { contentType: file.mime, upsert: false });
    if (up.error) throw new Error(`OGR-CHAT-004 Storage yüklemesi başarısız: ${up.error.message}`);
    const { createHash } = await import('node:crypto');
    const ins = await this.user.from('uploads').insert({
      id,
      owner_id: s.profileId,
      student_id: s.studentId,
      kind: file.kind,
      storage_path: path,
      mime: file.mime,
      bytes: file.data.byteLength,
      sha256: createHash('sha256').update(file.data).digest('hex'),
      width: file.width ?? null,
      height: file.height ?? null,
    });
    if (ins.error) throw new Error(`OGR-CHAT-005 yükleme satırı yazılamadı: ${ins.error.message}`);
    return { id, kind: file.kind, mime: file.mime, storagePath: path, anthropicFileId: null, bytes: file.data.byteLength };
  }

  async getSeed(s: ChatStudent, id: string): Promise<SeedContext | null> {
    const r = await this.db.query(
      `select sa.id, sa.question_text, sa.student_work_text, sa.verdict, sa.failing_step_no, sa.error_cause, sa.skill_ids,
              sa.misconception_tags, sa.upload_ids, sa.analysis ->> 'why_tr' as why
         from public.solution_analyses sa join public.enrollments e on e.id = sa.enrollment_id
        where sa.id = $1::uuid and e.student_id = $2::uuid`,
      [id, s.studentId],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      id: String(row.id),
      questionText: row.question_text ? String(row.question_text) : null,
      studentWorkText: row.student_work_text ? String(row.student_work_text) : null,
      verdict: row.verdict ? String(row.verdict) : null,
      failingStepNo: row.failing_step_no === null || row.failing_step_no === undefined ? null : Number(row.failing_step_no),
      errorCause: row.error_cause ? String(row.error_cause) : null,
      skillIds: Array.isArray(row.skill_ids) ? row.skill_ids.map(String) : [],
      misconceptionTags: Array.isArray(row.misconception_tags) ? row.misconception_tags.map(String) : [],
      summary: row.why ? String(row.why) : null,
      uploadIds: Array.isArray(row.upload_ids) ? row.upload_ids.map(String) : [],
    };
  }

  /**
   * Eğitmen yönlendirmesi: yalnız `notifications` (kind='coach_escalation'). Aynı sohbetten 24 saatte en çok bir
   * bildirim gider (tur kilidi aynı sohbette iki turu önlediği için denetle-yaz yarışı yok); önceki bildirim
   * duruyorsa yeni satır yazılmaz ve true döner (konu zaten iletildi). `instructor_notes` yazılmaz: author_id zorunlu ve
   * "yazan eğitmen" anlamında; koçun notu eğitmenin yazdığı gibi görünür, öneri motoru da onu eğitmen notu sayardı
   * (kaynak sütunu gelince eklenebilir). Ham ret kategorisi yalnız payload'da; gövde Türkçe etiket taşır.
   */
  async escalate(input: EscalationInput): Promise<boolean> {
    const { student } = input;
    try {
      const recent = await this.db.query(
        `select 1 from public.notifications
          where kind = 'coach_escalation' and payload ->> 'conversation_id' = $1::text
            and created_at > now() - make_interval(secs => $2::double precision / 1000) limit 1`,
        [input.conversationId, ESCALATION_DEDUPE_MS],
      );
      if (recent.rows.length > 0) return true;
      const r = await this.db.query(
        `select il.instructor_id from public.instructor_links il
          where il.student_id = $1::uuid and (il.course_id is null or il.course_id = $2::uuid)
          order by (il.role = 'owner') desc, il.created_at limit 1`,
        [student.studentId, student.courseId],
      );
      const instructor = r.rows[0]?.instructor_id ? String(r.rows[0].instructor_id) : null;
      if (!instructor) return false;
      await this.db.query(
        `insert into public.notifications (recipient_id, kind, title, body, payload)
         values ($1::uuid, 'coach_escalation', 'Koç bir öğrenciyi sana yönlendirdi', $2, $3::jsonb)`,
        [
          instructor,
          escalationBody(input),
          JSON.stringify({
            student_id: student.studentId,
            enrollment_id: student.enrollmentId,
            conversation_id: input.conversationId,
            reason: input.reason,
            category: input.category,
          }),
        ],
      );
      return true;
    } catch (err) {
      console.error('OGR-CHAT-006 eğitmen yönlendirmesi yazılamadı', err);
      return false;
    }
  }

  async systemBlocks(s: ChatStudent, courseId: string | null): Promise<{ course: string | null; dossier: string | null }> {
    if (!courseId) return { course: null, dossier: null };
    let dossier: string | null = null;
    let curriculumId: string | null = null;
    try {
      const d = await renderDossier(this.db, s.studentId, courseId, { maxAgeMs: DOSSIER_MAX_AGE_MS });
      dossier = d.text;
      curriculumId = d.curriculumId;
    } catch (err) {
      if (!(err instanceof DossierError)) throw err;
    }
    let course: string | null = null;
    try {
      course = (await renderCourseBlock(this.db, courseId, { curriculumId, cache: courseCache })).text;
    } catch (err) {
      console.error('OGR-CHAT-007 ders bloğu kurulamadı', err);
    }
    return { course, dossier };
  }

  toolRunners(s: ChatStudent): ToolRunners {
    const db = this.db;
    return {
      get_mastery: async (input) => {
        const enr = await this.enrollmentFor(s, input.course_id ?? null);
        if (!enr) return JSON.stringify({ note: 'Bu ders için kayıt yok.', skills: [] });
        const codes = input.skill_codes ?? [];
        const r = codes.length > 0
          ? await db.query(
              `select m.skill_id, sk.name, m.p, m.evidence_count, m.last_evidence_at from public.mastery m
                 join public.skills sk on sk.curriculum_id = m.curriculum_id and sk.id = m.skill_id
                where m.enrollment_id = $1::uuid and m.skill_id = any($2::text[]) order by m.skill_id`,
              [enr, codes],
            )
          : await db.query(
              `(select m.skill_id, sk.name, m.p, m.evidence_count, m.last_evidence_at from public.mastery m
                  join public.skills sk on sk.curriculum_id = m.curriculum_id and sk.id = m.skill_id
                 where m.enrollment_id = $1::uuid order by m.p asc, m.skill_id limit 8)
               union
               (select m.skill_id, sk.name, m.p, m.evidence_count, m.last_evidence_at from public.mastery m
                  join public.skills sk on sk.curriculum_id = m.curriculum_id and sk.id = m.skill_id
                 where m.enrollment_id = $1::uuid order by m.p desc, m.skill_id limit 5)
               order by p asc, skill_id`,
              [enr],
            );
        const skills = r.rows.map((x) => ({
          code: String(x.skill_id),
          name: String(x.name),
          // Ham olasılık (p) modele verilmez: yüzde yerine kelime bandı (PLAN-v2 §6).
          band: bandOf(Number(x.p), Number(x.evidence_count)),
          evidence: evidenceWords(Number(x.evidence_count)),
          last_seen: x.last_evidence_at ? new Date(x.last_evidence_at as string).toISOString().slice(0, 10) : null,
        }));
        return JSON.stringify({ skills, unknown_codes: codes.filter((c) => !skills.some((k) => k.code === c)) });
      },
      get_recent_exams: async (input) => {
        // Bölüm sonuçları (score.sections; grade_exam_session yazar) + öne çıkan hatalar: oturumun yanlış/boş
        // sorularının kazanımları ve teşhislerindeki yanılgı etiketleri (en sık 3'er).
        const r = await db.query(
          `select e.title, e.kind, es.finished_at, es.score,
                  (select coalesce(jsonb_agg(w order by w.n desc, w.code), '[]'::jsonb) from (
                     select sk.code, coalesce(s2.name, sk.code) as name, count(*)::int as n
                       from public.exam_responses er join public.exam_questions q on q.id = er.exam_question_id
                       cross join lateral unnest(q.skill_ids) as sk(code)
                       left join public.skills s2 on s2.curriculum_id = en.curriculum_id and s2.id = sk.code
                      where er.session_id = es.id and er.outcome in ('wrong', 'blank', 'unfinished')
                      group by sk.code, s2.name order by count(*) desc, sk.code limit 3) w) as weak_skills,
                  (select coalesce(jsonb_agg(t order by t.n desc, t.tag), '[]'::jsonb) from (
                     select tag, count(*)::int as n
                       from public.exam_responses er join public.solution_analyses sa on sa.id = er.solution_analysis_id
                       cross join lateral unnest(sa.misconception_tags) as tag
                      where er.session_id = es.id
                      group by tag order by count(*) desc, tag limit 3) t) as misconceptions
             from public.exam_sessions es
             join public.exams e on e.id = es.exam_id join public.enrollments en on en.id = es.enrollment_id
            where en.student_id = $1::uuid and es.status = 'done'
            order by es.finished_at desc nulls last limit $2`,
          [s.studentId, input.limit ?? 3],
        );
        const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
        return JSON.stringify({
          exams: r.rows.map((x) => {
            const score = (x.score ?? {}) as Record<string, unknown>;
            const sections = Array.isArray(score.sections) ? (score.sections as Record<string, unknown>[]) : [];
            return {
              title: String(x.title),
              kind: String(x.kind),
              date: x.finished_at ? new Date(x.finished_at as string).toISOString().slice(0, 10) : null,
              net: num(score.net),
              correct: num(score.correct),
              wrong: num(score.wrong),
              blank: num(score.blank),
              sections: sections.map((sec) => ({
                section: String(sec.section ?? 'Genel'),
                net: num(sec.net),
                correct: num(sec.correct),
                wrong: num(sec.wrong),
                blank: num(sec.blank),
              })),
              top_errors: {
                skills: (x.weak_skills as { code: string; name: string; n: number }[]).map((k) => ({ code: k.code, name: k.name, missed: k.n })),
                misconceptions: (x.misconceptions as { tag: string; n: number }[]).map((t) => ({ tag: t.tag, count: t.n })),
              },
            };
          }),
        });
      },
      search_evidence: async (input) => {
        const words = [...new Set(input.query.toLocaleLowerCase('tr').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3))].slice(0, 6);
        if (words.length === 0) return JSON.stringify({ results: [], note: 'Arama için en az bir anlamlı kelime gerekli.' });
        const kinds = input.kinds && input.kinds.length > 0 ? input.kinds : ['upload', 'solution_analysis', 'lesson', 'exam_response', 'conversation'];
        // Gömme (Voyage) henüz yok: kelime eşleşmesi (ILIKE) yedeği; puan = eşleşen kelime sayısı, sonra yenilik.
        const r = await db.query(
          `with ev as (
             select 'upload'::text as kind, u.id::text as id, u.created_at as at, coalesce(u.extracted_text, '') as txt
               from public.uploads u where u.student_id = $1::uuid and u.extracted_text is not null
             union all
             select 'solution_analysis', sa.id::text, sa.created_at,
                    concat_ws(' ', sa.question_text, sa.student_work_text, sa.analysis ->> 'why_tr', array_to_string(sa.skill_ids, ' '),
                              array_to_string(sa.misconception_tags, ' '))
               from public.solution_analyses sa join public.enrollments e on e.id = sa.enrollment_id where e.student_id = $1::uuid
             union all
             select 'exam_response', er.id::text, es.created_at, coalesce(er.how_far_text, '')
               from public.exam_responses er join public.exam_sessions es on es.id = er.session_id
               join public.enrollments e on e.id = es.enrollment_id
              where e.student_id = $1::uuid and er.how_far_text is not null
             union all
             select 'lesson', lc.id::text, l.held_at, lc.quote
               from public.lesson_claims lc join public.lesson_analyses la on la.id = lc.analysis_id
               join public.lessons l on l.id = la.lesson_id join public.enrollments e on e.id = l.enrollment_id
              where e.student_id = $1::uuid and lc.status in ('approved', 'edited')
             union all
             select 'conversation', cm.id::text, cm.created_at,
                    coalesce((select string_agg(b ->> 'text', ' ') from jsonb_array_elements(cm.content) b where b ->> 'type' = 'text'), '')
               from public.conversation_messages cm join public.conversations c on c.id = cm.conversation_id
              where c.student_id = $1::uuid and c.kind = 'coach' and cm.role in ('user', 'assistant')
           )
           select kind, id, at, txt, (select count(*) from unnest($2::text[]) w where ev.txt ilike '%' || w || '%') as score
             from ev where kind = any($3::text[])
              and exists (select 1 from unnest($2::text[]) w where ev.txt ilike '%' || w || '%')
            order by score desc, at desc limit $4`,
          [s.studentId, words, kinds, input.limit ?? 5],
        );
        return JSON.stringify({
          method: 'keyword',
          results: r.rows.map((x) => ({
            kind: String(x.kind),
            id: String(x.id),
            date: x.at ? new Date(x.at as string).toISOString().slice(0, 10) : null,
            snippet: snippet(String(x.txt), words),
          })),
        });
      },
    };
  }

  private async enrollmentFor(s: ChatStudent, courseId: string | null): Promise<string | null> {
    if (!courseId || courseId === s.courseId) return s.enrollmentId;
    const r = await this.db.query(
      `select id from public.enrollments where student_id = $1::uuid and course_id = $2::uuid
        order by (status = 'active') desc, started_at desc limit 1`,
      [s.studentId, courseId],
    );
    return r.rows[0]?.id ? String(r.rows[0].id) : null;
  }

  memoryStore(): MemoryStore {
    return new PgStore(this.db);
  }

  ledger(): LedgerWriter {
    return new PgLedger(this.db);
  }
}
