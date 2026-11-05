// Sahte Supabase'in Yükle → Teşhis eki (e2e/fake-supabase.mjs çağırır): Storage nesne yükleme ('uploads' kovası;
// politika taklidi: ilk klasör oturumdaki kullanıcı), submit_upload RPC'si ve worker benzetimi (Kendi çalışmam →
// kısa süre sonra solution_analyses satırı; Okul denemesi → uploads 'ready'). Gerçek hat apps/worker'da ve
// test/diagnosis.live.test.ts'te gerçek Postgres'le sınanır.
import { USERS } from './fixtures.mjs';

const NOW = '2026-11-03T09:00:00+00:00';
const STUDENT_ID = '10000000-0000-4000-8000-000000000001';
const CURRICULUM_ID = '60000000-0000-4000-8000-000000000001';
export const E2E_ENROLLMENT_ID = '70000000-0000-4000-8000-000000000001';

/** Sahte worker'ın yazdığı teşhis (apps/worker/test/fixtures/diagnosis/01-dagilma-isaret.json ile aynı öykü). */
export const E2E_ANALYSIS = {
  why_tr: '3. adımda $-3(x-2)$ ifadesini $-3x-6$ yazdın; eksi çarpı eksi artı olduğu için doğrusu $-3x+6$.',
  one_line: 'Çözümünü inceledim: 3. adımda işlem kuralı.',
  steps: [
    { no: 1, text: '$2(x+1) = 2x+2$', status: 'ok' },
    { no: 2, text: '$2x+2 - 3(x-2) = 4$', status: 'ok' },
    { no: 3, text: '$-3(x-2) = -3x-6$', status: 'error' },
    { no: 4, text: '$-x - 4 = 4$', status: 'ok' },
  ],
  reference_steps: ['$2(x+1) = 2x+2$', '$2x+2 - 3(x-2) = 4$', '$-3(x-2) = -3x+6$', '$-x + 8 = 4$'],
  // modelin sırası: önce Denklem (apply_diagnosis skill_ids'i alfabetik saklar); "Bu kazanım" yine yanılgının kazanımı olmalı
  skill_order: ['tyt.mat.cebir.denklem', 'tyt.mat.temel.sayilar'],
};

export function seedUploadTables() {
  return {
    enrollments: [{ id: E2E_ENROLLMENT_ID, student_id: STUDENT_ID, curriculum_id: CURRICULUM_ID, course_id: '50000000-0000-4000-8000-000000000001', status: 'active', created_at: NOW }],
    skills: [
      { curriculum_id: CURRICULUM_ID, id: 'tyt.mat.cebir.denklem', name: 'Birinci dereceden denklemler', is_leaf: true },
      { curriculum_id: CURRICULUM_ID, id: 'tyt.mat.temel.sayilar', name: 'Sayı kümeleri, işlem önceliği, işaret kuralları', is_leaf: true },
    ],
    mastery: [
      { enrollment_id: E2E_ENROLLMENT_ID, skill_id: 'tyt.mat.cebir.denklem', p: 0.91, evidence_count: 9 },
      { enrollment_id: E2E_ENROLLMENT_ID, skill_id: 'tyt.mat.temel.sayilar', p: 0.62, evidence_count: 6 },
    ],
    misconception_tags: [{ tag: 'sayilar.parantez-eksi-dagitma', skill_id: 'tyt.mat.temel.sayilar', text_student: 'Eksi işareti parantezdeki her terime dağılır.' }],
    uploads: [],
    solution_analyses: [],
  };
}

const objects = new Map();
let seq = 0;

function readRaw(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/** storage-js Blob'u multipart/form-data olarak gönderir: dosya parçasını ve türünü ayıklar. */
function filePart(raw, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!m) return { body: raw, contentType };
  const boundary = Buffer.from(`--${m[1] ?? m[2]}`);
  let from = raw.indexOf(boundary);
  while (from !== -1) {
    const next = raw.indexOf(boundary, from + boundary.length);
    if (next === -1) break;
    const part = raw.subarray(from + boundary.length + 2, next - 2);
    const sep = part.indexOf('\r\n\r\n');
    const head = part.subarray(0, sep).toString('utf8');
    if (/filename=|content-type:/i.test(head) && !/name="cacheControl"/i.test(head)) {
      const ct = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1] ?? 'application/octet-stream';
      return { body: part.subarray(sep + 4), contentType: ct.trim() };
    }
    from = next;
  }
  return { body: raw, contentType };
}

/** İstek bu eke aitse işler ve true döner. */
export async function handleUploads({ req, res, path, url, tables, send, readBody, userFromAuth }) {
  // sınama kancası: Storage nesneleri ve satırlar
  if (path === '/__uploads') {
    return send(res, 200, { objects: [...objects.entries()].map(([k, v]) => ({ path: k, bytes: v.body.length, contentType: v.contentType })), uploads: tables.uploads, analyses: tables.solution_analyses }), true;
  }
  if (path === '/__uploads/object') {
    const o = objects.get(url.searchParams.get('path') ?? '');
    if (!o) return send(res, 404, { message: 'yok' }), true;
    res.writeHead(200, { 'content-type': o.contentType, 'access-control-allow-origin': '*' });
    res.end(o.body);
    return true;
  }

  const obj = /^\/storage\/v1\/object\/uploads\/(.+)$/.exec(path);
  if (obj && (req.method === 'POST' || req.method === 'PUT')) {
    const user = userFromAuth(req);
    const name = decodeURIComponent(obj[1]);
    if (!user) return send(res, 400, { statusCode: '403', error: 'Unauthorized', message: 'oturum yok' }), true;
    if (name.split('/')[0] !== user.id) return send(res, 400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' }), true;
    if (objects.has(name) && req.headers['x-upsert'] !== 'true') return send(res, 400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }), true;
    const part = filePart(await readRaw(req), String(req.headers['content-type'] ?? 'application/octet-stream'));
    objects.set(name, part);
    return send(res, 200, { Key: `uploads/${name}`, Id: `obj-${++seq}` }), true;
  }

  if (path === '/rest/v1/rpc/submit_upload' && req.method === 'POST') {
    const user = userFromAuth(req);
    const body = await readBody(req);
    const ids = Array.isArray(body.p_upload_ids) ? body.p_upload_ids : [];
    const max = body.p_kind === 'own_work' ? 4 : body.p_kind === 'school_exam' ? 40 : 0;
    if (user && user.id === USERS.student.id && (ids.length === 0 || ids.length > max || new Set(ids).size !== ids.length)) {
      return send(res, 400, { code: 'P0001', message: `OGR-UPL-001 ${body.p_kind} için 1–${max} tekil sayfa gerekir`, details: null, hint: null }), true;
    }
    if (!user || user.id !== USERS.student.id) return send(res, 403, { code: '42501', message: 'OGR-AUTH-001 yükleme yalnız öğrenci oturumunda gönderilir', details: null, hint: null }), true;
    const rows = ids.map((id) => tables.uploads.find((u) => u.id === id && u.owner_id === user.id));
    for (const r of rows) if (r) r.status ??= 'stored'; // sütun varsayılanı (0007)
    if (ids.length === 0 || rows.some((r) => !r || r.status !== 'stored') || rows.some((r) => !objects.has(r.storage_path))) {
      return send(res, 400, { code: 'P0001', message: 'OGR-UPL-003 yükleme bulunamadı ya da işlenmiş', details: null, hint: null }), true;
    }
    for (const r of rows) r.status = 'processing';
    // worker benzetimi (upload.intake → diagnosis.run): kısa gecikmeyle sonuç
    setTimeout(() => {
      if (body.p_kind === 'own_work') {
        tables.solution_analyses.push({
          id: `bbbbbbbb-0000-4000-8000-${String(tables.solution_analyses.length + 1).padStart(12, '0')}`,
          enrollment_id: E2E_ENROLLMENT_ID,
          upload_ids: ids,
          question_text: '$2(x+1) - 3(x-2) = 4$ olduğuna göre $x$ kaçtır?',
          analysis: E2E_ANALYSIS,
          verdict: 'wrong',
          failing_step_no: 3,
          error_cause: 'procedure',
          // gerçek teşhis gibi iki kazanım, alfabetik (0017 apply_diagnosis)
          skill_ids: ['tyt.mat.cebir.denklem', 'tyt.mat.temel.sayilar'],
          misconception_tags: ['sayilar.parantez-eksi-dagitma'],
          created_at: new Date().toISOString(),
        });
      }
      for (const r of rows) r.status = 'ready';
    }, 2_500);
    return send(res, 200, { upload_ids: ids, kind: body.p_kind, enrollment_id: E2E_ENROLLMENT_ID, job_id: `job-${++seq}`, reused: false }), true;
  }
  return false;
}
