import { redirect } from 'next/navigation';

// Eski yol: son rapor artık Özet sayfasında.
export default function Eski() {
  redirect('/veli');
}
