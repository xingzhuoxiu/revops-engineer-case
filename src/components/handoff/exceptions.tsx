import Link from 'next/link';
import { askRepAction, checkAgain, replyAction } from '@/app/(shell)/handoff-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDate, formatDateTime } from '@/lib/format';
import { messagesByDeal } from '@/lib/handoff/slack';
import { type Alert, appToday, openAlerts, readState } from '@/lib/handoff/store';
import { assignee, getPolicy } from '@/lib/policy/policy';

/** A ready-made question per kind of problem. One click, then edit if needed. */
const SNIPPET: Record<string, string> = {
  'Purchase order':
    'Can you get the PO from the customer? Billing cannot invoice until we have it.',
  'Discount review': 'Is this discount approved? Please add the approval to the deal.',
  'Workspace match': 'Do you know which workspace the customer uses?',
  'Payment method on file':
    'The card on file has expired. Can you ask for a new card, or switch them to invoice?',
};

export const exceptionCount = () => openAlerts().filter((a) => a.queue !== 'rep').length;

/**
 * Everything that is stuck and needs a person in finance. Slack stays for the
 * conversation: a rep message that nobody has answered shows up here as an item,
 * everything else is folded away at the bottom.
 */
export async function Exceptions() {
  const policy = getPolicy();
  const today = appToday();
  const state = readState();
  const rows = openAlerts()
    .filter((a) => a.queue !== 'rep')
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
  const deals = Object.values(state.handoffs).map((h) => ({
    Id: h.oppId,
    accountName: h.accountName,
  }));
  const threads = await messagesByDeal(deals);
  const nameOf = (id: string | null) => (id ? state.handoffs[id]?.accountName : null);
  // Only deals where a person has written. Our own automatic messages aren't conversation.
  const humanLatest = (id: string) => threads[id]?.messages.find((m) => m.role !== 'app');
  const withMessages = deals.filter((d) => humanLatest(d.Id));

  return (
    <div className="flex flex-col gap-4">
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
          Nothing is waiting on finance.
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-3">
          {COLUMNS.map((col) => {
            const items = rows.filter((a) => columnOf(a) === col.id);
            return (
              <section key={col.id} className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3">
                <header>
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-sm">{col.label}</h3>
                    <span className="rounded-full bg-violet-600 px-2 py-0.5 text-white text-xs">
                      {items.length}
                    </span>
                  </div>
                  <Owner id={col.id} />
                </header>
                {items.length === 0 ? (
                  <p className="rounded-lg border border-dashed p-4 text-center text-muted-foreground text-xs">
                    Nothing here.
                  </p>
                ) : (
                  items.map((a) => {
                    const overdue = !!a.due && a.due < today;
                    return (
                      <article
                        key={a.id}
                        className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm shadow-xs"
                      >
                        {a.oppId ? (
                          <div>
                            <Link
                              href={`/admin-app?tab=ready&deal=${a.oppId}`}
                              className="font-medium hover:underline"
                            >
                              {nameOf(a.oppId)}
                            </Link>
                            <div className="text-muted-foreground text-xs">
                              Customer: {nameOf(a.oppId)}. Sales rep:{' '}
                              {state.handoffs[a.oppId]?.repName ?? 'unknown'}
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">No deal</span>
                        )}
                        <div>
                          <div className="font-medium">{a.title}</div>
                          <div className="text-muted-foreground text-xs">{a.message}</div>
                        </div>
                        {a.due ? (
                          <div
                            className={`text-xs ${overdue ? 'font-medium text-red-600' : 'text-muted-foreground'}`}
                          >
                            {overdue ? 'Overdue, was due ' : 'Due '}
                            {formatDate(a.due)}
                          </div>
                        ) : null}
                        <Action
                          a={a}
                          rep={state.handoffs[a.oppId ?? '']?.repName ?? 'the rep'}
                          customer={nameOf(a.oppId) ?? 'this deal'}
                        />
                      </article>
                    );
                  })
                )}
              </section>
            );
          })}
        </div>
      )}

      {withMessages.length > 0 ? (
        <details className="rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer font-medium">
            Slack messages about deals ({withMessages.length})
          </summary>
          <p className="my-2 text-muted-foreground text-xs">
            The conversation stays in Slack. This is only the latest message per deal. Open the deal
            to read the rest or to reply.
          </p>
          <ul className="flex flex-col divide-y">
            {withMessages.map((d) => {
              const latest = humanLatest(d.Id);
              return (
                <li key={d.Id} className="flex items-center gap-3 py-2">
                  <Link
                    href={`/admin-app?tab=ready&deal=${d.Id}`}
                    className="w-44 shrink-0 font-medium hover:underline"
                  >
                    {d.accountName}
                  </Link>
                  <span className="line-clamp-1 flex-1 text-muted-foreground">
                    {latest?.author}: {latest?.text}
                  </span>
                  <span className="shrink-0 text-muted-foreground text-xs">
                    {latest ? formatDateTime(latest.at) : ''}
                  </span>
                  {threads[d.Id]?.unanswered ? (
                    <span className="shrink-0 text-amber-700 text-xs">No reply yet</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
      <p className="text-muted-foreground text-xs">
        Billing: {policy.queues.billing.owner}, backup {policy.queues.billing.backup}. Credit
        Control: {policy.queues.credit.owner}, backup {policy.queues.credit.backup}. You can change
        this on the Rules tab.
      </p>
    </div>
  );
}

const COLUMNS = [
  { id: 'billing', label: 'Billing' },
  { id: 'credit', label: 'Credit Control' },
  { id: 'manager', label: 'Finance or sales manager' },
] as const;

/** Alerts with an owner label (discounts, commission) go to the manager column. */
const columnOf = (a: Alert) =>
  a.ownerLabel ? 'manager' : a.queue === 'credit' ? 'credit' : 'billing';

function Owner({ id }: { id: (typeof COLUMNS)[number]['id'] }) {
  if (id === 'manager') {
    return (
      <p className="text-muted-foreground text-xs">Affects commission, so not Billing’s call</p>
    );
  }
  const who = assignee(getPolicy(), id);
  return (
    <p className="text-muted-foreground text-xs">
      {who.name}
      {who.covering ? ` (covering for ${who.covering})` : ''}
    </p>
  );
}

/** One small button. The message box opens only when it is clicked, so rows stay short. */
function Action({ a, rep, customer }: { a: Alert; rep: string; customer: string }) {
  if (!a.oppId) return null;
  if (a.kind === 'locked') return null;
  if (a.kind === 'blocked') {
    return (
      <form action={checkAgain}>
        <input type="hidden" name="oppId" value={a.oppId} />
        <Button type="submit" variant="outline" size="sm">
          Try again
        </Button>
      </form>
    );
  }
  const reply = a.kind === 'rep_message';
  return (
    <details>
      <summary className="w-fit cursor-pointer rounded-lg border px-2.5 py-1 text-sm hover:bg-muted">
        {reply ? `Reply to ${rep}` : `Ask ${rep}`}
      </summary>
      <form action={reply ? replyAction : askRepAction} className="mt-2 flex flex-col gap-2">
        <p className="text-muted-foreground text-xs">
          {reply
            ? `Posts in #finance-billing, about ${customer}.`
            : `Direct message to ${rep} in Slack, about ${customer}.`}
        </p>
        <input type="hidden" name="oppId" value={a.oppId} />
        <Input
          name="text"
          defaultValue={reply ? '' : (SNIPPET[a.title] ?? 'Can you check this on the deal?')}
          placeholder={reply ? 'Reply in #finance-billing' : undefined}
        />
        <Button type="submit" size="sm">
          Send in Slack
        </Button>
      </form>
    </details>
  );
}
