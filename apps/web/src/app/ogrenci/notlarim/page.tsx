import { redirect } from 'next/navigation';

// Eski yol (PLAN-v2 §13 öncesi): yeni yerine yönlenir.
export default function Eski() {
  redirect('/ogrenci/gelisim/belgeler');
}
