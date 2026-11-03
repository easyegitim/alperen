import {
  Bell,
  BookOpen,
  Camera,
  ClipboardCheck,
  ClipboardList,
  FileCheck,
  FileText,
  Inbox,
  LayoutGrid,
  ListTree,
  MessageCircle,
  MessagesSquare,
  Network,
  NotebookText,
  Settings,
  Shapes,
  UserRound,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { NavIconName } from '@/lib/nav';

export const NAV_ICONS: Record<NavIconName, LucideIcon> = {
  coach: MessagesSquare,
  ask: Camera,
  exams: ClipboardList,
  notes: NotebookText,
  map: Network,
  profile: UserRound,
  summary: LayoutGrid,
  chat: MessageCircle,
  reports: FileText,
  bell: Bell,
  settings: Settings,
  students: Users,
  courses: BookOpen,
  curricula: ListTree,
  styles: Shapes,
  content: FileCheck,
  examkeys: ClipboardCheck,
  queue: Inbox,
  cost: Wallet,
};

export function NavIcon({ name, size = 22 }: { name: NavIconName; size?: number }) {
  const Icon = NAV_ICONS[name];
  return <Icon aria-hidden="true" size={size} />;
}

export { Camera };
