import 'server-only';
import { progressClient } from '@/server/progress/read';
import { studentDb } from '@/server/practice/client';
import { documentLine } from '@/server/progress/present';
import type { RpcClient } from '@/server/practice/rpc';
import { listMyDocuments } from './rpc';

export const documentDb = studentDb;

const SIGNED_URL_SECONDS = 600;

export interface ViewableDocument {
  id: string;
  title: string;
  /** İmzalı Storage adresi (10 dk); PDF henüz yoksa null. */
  src: string | null;
  /** Deneme ve soru setinde: belgeden kurulmuş uygulama içi sınav ("Çöz"); yoksa null. */
  examId: string | null;
}

/** Belge satırı (RLS belirler) + 'documents' kovasından kullanıcının JWT'siyle imzalı adres. Yoksa null. */
export async function loadViewableDocument(id: string): Promise<ViewableDocument | null> {
  const db = await progressClient();
  const { data: doc } = await db.from('generated_documents').select('id, title, kind, pdf_path, status').eq('id', id).maybeSingle();
  if (!doc || doc.kind === 'answer_key') return null;
  const path = doc.pdf_path;
  const signed = path && (doc.status === 'rendered' || doc.status === 'published') ? await db.storage.from('documents').createSignedUrl(path, SIGNED_URL_SECONDS) : null;
  let examId: string | null = null;
  if (doc.kind === 'mock_exam' || doc.kind === 'question_set') {
    const mine = await listMyDocuments(db as unknown as RpcClient, { kind: doc.kind, limit: 200 });
    examId = (mine.ok ? mine.data.find((d) => d.id === id)?.exam_id : null) ?? null;
  }
  return { id: doc.id, title: documentLine(doc.title, doc.kind), src: signed?.data?.signedUrl ?? null, examId };
}
