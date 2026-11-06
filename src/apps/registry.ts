/**
 * The apps in the sidebar. Add your own here: give it an id, a label, a path
 * and an icon from lucide-react, and create the page under src/app/(shell).
 */
import {
  Building2,
  CreditCard,
  FileText,
  Handshake,
  Home,
  LayoutGrid,
  MessageSquare,
  Sparkles,
  Wrench,
} from 'lucide-react';
import type { ComponentType } from 'react';

export interface AppEntry {
  id: string;
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  /** A violet marker in the sidebar: "New" or "Updated" for pages changed by the hand-off work */
  badge?: string;
}

export interface AppSection {
  label: string;
  apps: AppEntry[];
}

export const APP_SECTIONS: AppSection[] = [
  {
    label: 'MentOS',
    apps: [
      { id: 'home', label: 'Home', href: '/', icon: Home },
      {
        id: 'your-app',
        label: 'Closed Won hand-off',
        href: '/your-app',
        icon: Sparkles,
        badge: 'New',
      },
    ],
  },
  {
    label: 'Salesforce',
    apps: [
      { id: 'deals', label: 'Deals', href: '/deals', icon: Handshake, badge: 'Updated' },
      { id: 'accounts', label: 'Accounts', href: '/accounts', icon: Building2 },
    ],
  },
  {
    label: 'Systems',
    apps: [
      {
        id: 'admin-app',
        label: 'Admin app',
        href: '/admin-app',
        icon: LayoutGrid,
        badge: 'Updated',
      },
      { id: 'kleer', label: 'Kleer', href: '/kleer', icon: FileText },
      { id: 'stripe', label: 'Stripe', href: '/stripe', icon: CreditCard },
      { id: 'slack', label: 'Slack', href: '/slack', icon: MessageSquare },
    ],
  },
  {
    label: 'Developer',
    apps: [{ id: 'dev', label: 'Dev tools', href: '/dev', icon: Wrench }],
  },
];
