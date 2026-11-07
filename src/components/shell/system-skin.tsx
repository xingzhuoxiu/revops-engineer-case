'use client';

import { Bell, HelpCircle, Search, Settings } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type System = 'salesforce' | 'admin' | 'kleer' | 'stripe' | 'slack' | 'mentos';

const systemOf = (path: string): System =>
  path.startsWith('/deals') || path.startsWith('/accounts')
    ? 'salesforce'
    : path.startsWith('/admin-app')
      ? 'admin'
      : path.startsWith('/kleer')
        ? 'kleer'
        : path.startsWith('/stripe')
          ? 'stripe'
          : path.startsWith('/slack')
            ? 'slack'
            : 'mentos';

/**
 * Each mock system gets the look of the real product: its colours (set in
 * globals.css under [data-system]) and its own top bar. It's a mock, so this
 * only suggests the real thing: layout, colour and navigation, no logos.
 */
export function SystemSkin({ children }: { children: ReactNode }) {
  const path = usePathname();
  const system = systemOf(path);
  return (
    <div data-system={system} className="flex min-h-svh flex-1 flex-col bg-background">
      <TopBar system={system} path={path} />
      {children}
    </div>
  );
}

const tab = (active: boolean) =>
  cn(
    'border-b-[3px] px-3 py-2.5 text-sm transition-colors',
    active ? 'border-primary font-medium text-primary' : 'border-transparent hover:bg-muted',
  );

function Search_({ placeholder, className }: { placeholder: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex h-8 w-full max-w-md items-center gap-2 rounded-md border bg-muted/60 px-2.5 text-muted-foreground text-sm',
        className,
      )}
    >
      <Search className="size-3.5" />
      {placeholder}
    </div>
  );
}

function TopBar({ system, path }: { system: System; path: string }) {
  if (system === 'salesforce') {
    return (
      <header className="sticky top-12 z-10 border-b bg-background">
        <div className="flex items-center gap-4 border-b px-4 py-2">
          <Search_ placeholder="Search Opportunities and more..." className="mx-auto" />
          <div className="flex items-center gap-3 text-muted-foreground">
            <Settings className="size-4" />
            <Bell className="size-4" />
            <HelpCircle className="size-4" />
          </div>
        </div>
        <nav className="flex items-center gap-1 px-4">
          <span className="mr-3 py-2.5 font-semibold text-sm">Sales</span>
          <Link href="/deals" className={tab(path.startsWith('/deals'))}>
            Opportunities
          </Link>
          <Link href="/accounts" className={tab(path.startsWith('/accounts'))}>
            Accounts
          </Link>
        </nav>
      </header>
    );
  }
  if (system === 'stripe') {
    return (
      <header className="sticky top-12 z-10 flex items-center gap-4 border-b bg-background px-4 py-2">
        <span className="font-semibold text-sm">Payments</span>
        <Search_ placeholder="Search" className="mx-auto" />
        <span className="rounded-md bg-amber-100 px-2 py-0.5 text-amber-800 text-xs">
          Test mode
        </span>
      </header>
    );
  }
  if (system === 'slack') {
    return (
      <header className="sticky top-12 z-10 flex items-center gap-4 bg-[#350d36] px-4 py-1.5">
        <span className="font-semibold text-sm text-white">Mentimeter</span>
        <Search_
          placeholder="Search Mentimeter"
          className="mx-auto border-white/20 bg-white/15 text-white/80"
        />
        <HelpCircle className="size-4 text-white/80" />
      </header>
    );
  }
  if (system === 'kleer') {
    return (
      <header className="sticky top-12 z-10 flex items-center gap-4 border-b bg-background px-4 py-2">
        <span className="font-semibold text-sm">Kleer</span>
        <span className="text-muted-foreground text-sm">Invoicing</span>
      </header>
    );
  }
  if (system === 'admin') {
    return (
      <header className="sticky top-12 z-10 flex items-center gap-3 border-b bg-background px-4 py-2">
        <span className="font-semibold text-sm">Admin</span>
        <span className="text-muted-foreground text-xs">Internal, for Mentimeter staff only</span>
      </header>
    );
  }
  return null;
}
