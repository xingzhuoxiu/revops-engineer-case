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
        'rounded-[2px] bg-violet-600 px-1 py-px font-medium text-[10px] text-white uppercase tracking-wide',
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
    <div className="border-violet-600 border-l-2 py-0.5 pl-3 text-muted-foreground text-xs">
      <span className="font-medium text-foreground">{title}</span> {children}
    </div>
  );
}

/** A value the hand-off adds (e.g. a deal's hand-off status): a small violet dot and plain text. */
export function VioletPill({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs">
      <span
        className={cn('size-1.5 rounded-full', muted ? 'bg-muted-foreground/40' : 'bg-violet-600')}
      />
      {children}
    </span>
  );
}
