import 'server-only';
import { studentDb } from '@/server/practice/client';

/** Kullanıcının JWT'siyle çalışan RPC istemcisi (RLS ve SECURITY DEFINER denetimleri geçerli; service_role yok). */
export const examDb = studentDb;
