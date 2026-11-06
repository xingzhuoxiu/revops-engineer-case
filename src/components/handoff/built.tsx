import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Everything built for the Closed Won hand-off is marked in violet, so it
 * stands out from the skeleton MentOS. These markers are walkthrough aids for
 * this mock: a real system would not have them.
 */
export function NewBadge({ label = 'New', className }: { label?: string; className?: string }) {
  return (
    <span
      className={cn(
        'rounded-full bg-violet-600 px-1.5 py-0.5 font-medium text-[10px] text-white uppercase tracking-wide',
        className,
      )}
    >
      {label}
    </span>
  );
}

/** A short note on a built feature: what it is, and what it would be in real life. */
export function BuiltNote({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 text-violet-900 text-xs dark:text-violet-200">
      <NewBadge className="mt-0.5 shrink-0" />
      <div>
        <span className="font-medium">{title}</span> {children}
      </div>
    </div>
  );
}

/** A small pill in the violet scheme, for values the hand-off adds (e.g. a deal's hand-off status). */
export function VioletPill({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <span
      className={cn(
        'whitespace-nowrap rounded-full border px-2 py-0.5 text-xs',
        muted
          ? 'border-border text-muted-foreground'
          : 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300',
      )}
    >
      {children}
    </span>
  );
}
