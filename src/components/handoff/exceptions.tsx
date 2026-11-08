import Link from 'next/link';
import { askRepAction } from '@/app/(shell)/handoff-actions';
import { formatDate } from '@/lib/format';
import { draftReply } from '@/lib/handoff/drafts';
import { currentFinanceUser } from '@/lib/handoff/session';
import { type Alert, appToday, openAlerts, readState } from '@/lib/handoff/store';
import { assignee, getPolicy } from '@/lib/policy/policy';
import { cn } from '@/lib/utils';
import { waitingOn } from './item-actions';
import { DealDetail } from './ready-to-bill';

/** Deals with something open: they need a person. The count is deals, not items. */
export const needsActionCount = () => {
  const deals = readState().handoffs;
  return new Set(
    openAlerts()
      .filter((a) => a.oppId && deals[a.oppId])
      .map((a) => a.oppId),
  ).size;
};

type Who = 'rep' | 'billing' | 'credit' | 'deal_desk';

const whoOf = (a: Alert): Who =>
  a.ownerLabel
    ? 'deal_desk'
    : a.queue === 'rep'
      ? 'rep'
      : a.queue === 'credit'
        ? 'credit'
        : 'billing';

const COLUMNS: { id: Who; label: string }[] = [
  { id: 'rep', label: 'Sales rep' },
  { id: 'billing', label: 'Billing' },
  { id: 'credit', label: 'Credit Control' },
  { id: 'deal_desk', label: 'Deal Desk' },
];

/**
 * Every Closed Won deal that is waiting on someone, in a column per person who has to act.
 * One card per deal, so a deal is never in two places. Ready to bill is the other half:
 * deals that are set up. Click a card for the deal, with its Slack conversation.
 */
export async function Exceptions({ deal, preview }: { deal?: string; preview?: boolean }) {
  const state = readState();
  const today = appToday();
  const me = await currentFinanceUser();

  const handoff = deal ? state.handoffs[deal] : undefined;
  if (handoff) {
    return (
      <div className="flex flex-col gap-6">
        <Link
          href="/admin-app?tab=exceptions"
          className="w-fit text-muted-foreground text-sm hover:text-foreground"
        >
          ← Needs action
        </Link>
        <DealDetail
          h={handoff}
          preview={!!preview}
          backHref={`/admin-app?tab=exceptions&deal=${handoff.oppId}`}
        />
      </div>
    );
  }

  // One card per deal. The item due first decides which column it is in.
  const byDeal = new Map<string, Alert[]>();
  for (const a of openAlerts()) {
    if (!a.oppId || !state.handoffs[a.oppId]) continue;
    byDeal.set(a.oppId, [...(byDeal.get(a.oppId) ?? []), a]);
  }
  const cards = [...byDeal.entries()]
    .map(([oppId, items]) => {
      const sorted = [...items].sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
      const first = sorted[0] as Alert;
      const h = state.handoffs[oppId];
      return {
        oppId,
        first,
        who: whoOf(first),
        customer: h?.accountName ?? 'Unknown',
        rep: h?.repName ?? 'the rep',
        what: [...new Set(sorted.map((a) => a.title))].join(', '),
        due: first.due,
        draft: h ? draftReply(h, sorted, false) : '',
      };
    })
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));

  const policy = getPolicy();
  const owner = (id: Who) => {
    if (id === 'rep') return 'Fixes it on the deal in Salesforce';
    if (id === 'deal_desk') return `Approves discounts over ${policy.discountApprovalPct}%`;
    const who = assignee(policy, id);
    return `${who.name}${who.covering ? `, covering for ${who.covering}` : ''}`;
  };

  return (
    <div className="grid items-start gap-8 lg:grid-cols-4">
      {COLUMNS.map((col) => {
        const items = cards.filter((c) => c.who === col.id);
        return (
          <section key={col.id} className="flex min-w-0 flex-col">
            <header className="border-b pb-2">
              <div className="flex items-baseline justify-between">
                <h3 className="font-medium text-sm">{col.label}</h3>
                <span className="text-muted-foreground text-xs tabular-nums">{items.length}</span>
              </div>
              <p className="text-muted-foreground text-xs">{owner(col.id)}</p>
            </header>
            {items.length === 0 ? (
              <p className="py-3 text-muted-foreground text-xs">Nothing here.</p>
            ) : (
              items.map((c) => {
                const overdue = !!c.due && c.due < today;
                return (
                  <article key={c.oppId} className="flex flex-col gap-1 border-b py-3 text-sm">
                    <Link
                      href={`/admin-app?tab=exceptions&deal=${c.oppId}`}
                      className="font-medium hover:underline"
                    >
                      {c.customer}
                    </Link>
                    <div className="text-muted-foreground text-xs">{c.what}</div>
                    <div className="text-muted-foreground text-xs">Sales rep: {c.rep}</div>
                    {c.due ? (
                      <div
                        className={cn(
                          'text-xs',
                          overdue ? 'font-medium text-red-600' : 'text-muted-foreground',
                        )}
                      >
                        {overdue ? 'Overdue, was due ' : 'Due '}
                        {formatDate(c.due)}
                      </div>
                    ) : null}
                    <CardAction
                      a={c.first}
                      rep={c.rep}
                      me={me?.real_name ?? null}
                      waiting={waitingOn(c.first, c.rep)}
                      text={c.draft}
                    />
                  </article>
                );
              })
            )}
          </section>
        );
      })}
    </div>
  );
}

/**
 * One link per card, the most likely next step. Asking the rep is one click, with the
 * suggested message, and goes out under the signed-in person's name. Anything else opens the deal.
 */
function CardAction({
  a,
  rep,
  me,
  waiting,
  text,
}: {
  a: Alert;
  rep: string;
  me: string | null;
  waiting: string;
  text: string;
}) {
  const link = 'w-fit text-sm underline underline-offset-2';
  const open = `/admin-app?tab=exceptions&deal=${a.oppId}`;
  if (a.title === 'Discount approval') {
    return (
      <Link href={`/deals/${a.oppId}`} className={link}>
        Approve in Salesforce
      </Link>
    );
  }
  const canAsk =
    a.queue !== 'rep'
      ? ['Purchase order', 'Workspace match', 'Payment method on file'].includes(a.title) ||
        a.kind === 'overdue' ||
        a.kind === 'payment'
      : false;
  if (!canAsk || !me) {
    return (
      <Link href={open} className={link} title={waiting}>
        {a.kind === 'rep_message' ? `Reply to ${rep}` : 'Open'}
      </Link>
    );
  }
  return (
    <form action={askRepAction}>
      <input type="hidden" name="oppId" value={a.oppId ?? ''} />
      <input type="hidden" name="text" value={text} />
      <button type="submit" className={`${link} cursor-pointer`}>
        Ask {rep.split(' ')[0]}
      </button>
    </form>
  );
}
