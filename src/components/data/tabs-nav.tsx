import Link from 'next/link';
import { NewBadge } from '@/components/handoff/built';
import { cn } from '@/lib/utils';

/** Tabs that are links, so the selected tab is in the URL. */
export function TabsNav({
  tabs,
  active,
}: {
  tabs: { id: string; label: string; href: string; count?: number; isNew?: boolean }[];
  active: string;
}) {
  return (
    <nav className="flex w-fit gap-1 rounded-lg bg-muted p-1">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          className={cn(
            'rounded-md px-3 py-1 text-sm transition-colors',
            tab.id === active
              ? 'bg-background font-medium shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {tab.label}
          {tab.isNew ? <NewBadge className="ml-1.5" /> : null}
          {tab.count === undefined ? null : (
            <span className="ml-1.5 text-muted-foreground text-xs">{tab.count}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}
