// E2E sahte verisi (sahte Supabase sunucusu ve testler ortak kullanır). Gerçek kimlik/sır içermez.

export const FAKE_PORT = Number(process.env.E2E_SUPABASE_PORT || 54399);
export const FAKE_URL = `http://127.0.0.1:${FAKE_PORT}`;
export const FAKE_ANON_KEY = 'e2e-anon-key-not-a-secret';
export const WEB_PORT = Number(process.env.E2E_WEB_PORT || 3101);
export const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
export const OTP_CODE = '123456';

const NOW = '2026-10-19T11:32:00+00:00';

export const USERS = {
  student: { id: '00000000-0000-4000-8000-000000000001', email: 'ayse@example.test' },
  parent: { id: '00000000-0000-4000-8000-000000000002', email: 'mehmet@example.test' },
  instructor: { id: '00000000-0000-4000-8000-000000000003', email: 'zeynep@example.test' },
  invitee: { id: '00000000-0000-4000-8000-000000000005', email: 'davetli@example.test' },
  newcomer: { id: '00000000-0000-4000-8000-000000000004', email: 'yeni@example.test' },
};

const STUDENT_ID = '10000000-0000-4000-8000-000000000001';

function profile(id, role, display_name, onboarded = true) {
  return { id, role, display_name, locale: 'tr', tz: 'Europe/Istanbul', avatar_path: null, onboarded_at: onboarded ? NOW : null, created_at: NOW, updated_at: NOW };
}

export function seedTables() {
  return {
    profiles: [
      profile(USERS.student.id, 'student', 'Ayşe Yılmaz'),
      profile(USERS.parent.id, 'parent', 'Mehmet Yılmaz'),
      profile(USERS.instructor.id, 'instructor', 'Zeynep Hoca'),
    ],
    students: [{ id: STUDENT_ID, public_ref: 's_e2eabcdefghi', profile_id: USERS.student.id, grade: '11', school: null, status: 'active', created_at: NOW }],
    guardian_links: [{ id: '20000000-0000-4000-8000-000000000001', parent_id: USERS.parent.id, student_id: STUDENT_ID, relation: 'baba', status: 'active', created_at: NOW }],
    instructor_links: [{ id: '30000000-0000-4000-8000-000000000001', instructor_id: USERS.instructor.id, student_id: STUDENT_ID, course_id: null, role: 'owner', created_at: NOW }],
    memory_files: [
      { student_id: STUDENT_ID, path: '/memories/profile.md', content: '11. sınıf, hedef TYT. Kısa adımlarla anlatım işe yarıyor.', bytes: 60, created_at: NOW, updated_at: NOW },
      { student_id: STUDENT_ID, path: '/memories/patterns.md', content: 'Eksi işaretini dağıtırken 3 kez işaret hatası yaptı (12, 19, 27 Eki).', bytes: 70, created_at: NOW, updated_at: NOW },
    ],
    notifications: [
      { id: '40000000-0000-4000-8000-000000000001', recipient_id: USERS.parent.id, kind: 'weekly_report', title: 'Haftalık özet hazır', body: 'Bu hafta 3 gün çalıştı.', payload: {}, channels: ['in_app'], read_at: null, sent_at: null, created_at: NOW },
    ],
    courses: [
      { id: '50000000-0000-4000-8000-000000000001', code: 'TYT-MAT', title: 'TYT Matematik', kind: 'exam_track', curriculum_id: '60000000-0000-4000-8000-000000000001', description: null, visibility: 'public', created_by: null, created_at: NOW },
    ],
  };
}
