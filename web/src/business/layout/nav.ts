import {
  Activity,
  BarChart3,
  Building2,
  Contact,
  CreditCard,
  FileText,
  Inbox,
  LayoutDashboard,
  Nfc,
  Plug,
  Smartphone,
  Tag,
  Users,
  UsersRound,
  Zap,
} from 'lucide-react'
import type { ShellNavSection } from '@/layouts/DashboardShell'
import type { Permission } from '../api/types'

interface Item {
  path: string
  label: string
  icon: ShellNavSection['items'][number]['icon']
  perm?: Permission
}

const SECTIONS: { title?: string; items: Item[] }[] = [
  {
    items: [
      { path: '', label: 'Overview', icon: LayoutDashboard },
      { path: 'cards', label: 'NFC Cards', icon: Nfc },
      { path: 'tags', label: 'NFC Tags', icon: Tag },
      { path: 'employees', label: 'Employees', icon: Users },
      { path: 'customers', label: 'Customers', icon: Contact },
      { path: 'devices', label: 'Devices', icon: Smartphone },
      { path: 'events', label: 'NFC Events', icon: Activity },
    ],
  },
  {
    title: 'Experience',
    items: [
      { path: 'profiles', label: 'Pages', icon: FileText },
      { path: 'responses', label: 'Form responses', icon: Inbox },
      { path: 'actions', label: 'Actions', icon: Zap },
      { path: 'analytics', label: 'Analytics', icon: BarChart3, perm: 'analytics.view' },
    ],
  },
  {
    title: 'Manage',
    items: [
      { path: 'integrations', label: 'API / Integrations', icon: Plug, perm: 'api.view' },
      { path: 'team', label: 'Team Members', icon: UsersRound },
      { path: 'billing', label: 'Billing', icon: CreditCard },
      { path: 'settings', label: 'Business Settings', icon: Building2 },
    ],
  },
]

export function businessNav(base: string, can: (p: Permission) => boolean): ShellNavSection[] {
  return SECTIONS.map((s) => ({
    title: s.title,
    items: s.items
      .filter((i) => !i.perm || can(i.perm))
      .map((i) => ({ to: i.path ? `${base}/${i.path}` : base, label: i.label, icon: i.icon, end: i.path === '' })),
  }))
}
