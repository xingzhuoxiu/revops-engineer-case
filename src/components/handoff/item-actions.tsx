import Link from 'next/link';
import { checkAgain } from '@/app/(shell)/handoff-actions';
import { Button } from '@/components/ui/button';
import type { Alert } from '@/lib/handoff/store';
import { assignee, getPolicy } from '@/lib/policy/policy';

/** Who has to act on an item. This is what "waiting" means, so it is always named. */
export function waitingOn(a: Alert, rep: string): string {
  if (a.ownerLabel) return 'Deal Desk';
  if (a.queue === 'rep') return `${rep}, sales rep`;
  const id = a.queue === 'credit' ? 'credit' : 'billing';
  const who = assignee(getPolicy(), id);
  return `${who.name}, ${id === 'credit' ? 'Credit Control' : 'Billing'}`;
}

/** The few actions that are not a message: try the checks again, or approve a discount in Salesforce. */
export function ItemAction({ a, rep }: { a: Alert; rep: string }) {
  if (!a.oppId) return null;
  if (a.kind === 'locked' || a.kind === 'reopened' || a.kind === 'account_changed') return null;
  if (a.kind === 'blocked') {
    return (
      <form action={checkAgain}>
        <input type="hidden" name="oppId" value={a.oppId} />
        <Button type="submit" variant="ghost" size="sm" className="-ml-2.5">
          Try again
        </Button>
      </form>
    );
  }
  // A discount is decided by Deal Desk, on the deal in Salesforce. The request in #deal-desk links there.
  if (a.title === 'Discount approval') {
    return (
      <div className="flex flex-col gap-1">
        <Link href={`/deals/${a.oppId}`} className="w-fit text-sm underline underline-offset-2">
          Open the deal in Salesforce to approve
        </Link>
        <span className="text-muted-foreground text-xs">{rep} is told when it is decided.</span>
      </div>
    );
  }
  // Chasing the rep happens in the Slack box on the deal, with a suggested message
  return null;
}
