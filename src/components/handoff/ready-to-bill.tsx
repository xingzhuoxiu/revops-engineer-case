import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  advanceAction,
  askRepAction,
  replyAction,
  sendInvoiceAction,
  sendInvoicesAction,
} from '@/app/(shell)/handoff-actions';
import { Fields } from '@/components/data/fields';
import { Status } from '@/components/data/status';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { adminApp, kleer, salesforce } from '@/lib/connectors';
import { formatDate, formatMoney } from '@/lib/format';
import { draftReply } from '@/lib/handoff/drafts';
import { currentFinanceUser } from '@/lib/handoff/session';
import { messagesByDeal } from '@/lib/handoff/slack';
import { appToday, type Handoff, openAlerts, readState } from '@/lib/handoff/store';
import { cn } from '@/lib/utils';
import { ItemAction, waitingOn } from './item-actions';
import { Messages } from './messages';
import { SelectAll } from './select-all';
import { SubmitOnce } from './submit-once';

const LABEL: Record<Handoff['status'], string> = {
  processed: 'Processed',
  waiting_rep: 'Waiting on rep',
  waiting_finance: 'Finance decides',
  ignored: 'Ignored',
};
const TONE: Record<Handoff['status'], 'good' | 'warn' | 'neutral' | 'muted'> = {
  processed: 'good',
  waiting_rep: 'warn',
  waiting_finance: 'neutral',
  ignored: 'muted',
};

/** What finance can do with a deal. "to_send" is the one that is theirs to act on. */
type Kind = 'to_send' | 'waiting' | 'done' | 'ignored';
interface Row {
  h: Handoff;
  kind: Kind;
  note: string;
  /** The latest message a person wrote about this deal in Slack, if any */
  msg?: { author: string; at: string; unanswered: boolean } | null;
}

const DOT: Record<Kind, string> = {
  to_send: 'bg-foreground',
  waiting: 'bg-amber-500',
  done: 'bg-emerald-500',
  ignored: 'bg-slate-300',
};

const FILTERS: { id: string; label: string; kinds: Kind[] | null }[] = [
  { id: 'all', label: 'All', kinds: null },
  { id: 'to_send', label: 'To send', kinds: ['to_send'] },
  { id: 'done', label: 'Done', kinds: ['done'] },
];

function toRow(h: Handoff, invoices: Map<string, string>): Row {
  if (h.status === 'processed') {
    if (h.invoiceNumber) {
      if (invoices.get(h.invoiceNumber) === 'draft')
        return { h, kind: 'to_send', note: 'Invoice to send' };
      return { h, kind: 'done', note: 'Invoice sent' };
    }
    return { h, kind: 'done', note: 'Card charged' };
  }
  if (h.status === 'waiting_rep') return { h, kind: 'waiting', note: 'Waiting on the rep' };
  if (h.status === 'waiting_finance') return { h, kind: 'waiting', note: 'Needs a decision' };
  return { h, kind: 'ignored', note: 'Not Closed Won' };
}

/**
 * Deals that are set up and ready for finance: send the invoice, or see that it is done.
 * Deals that are waiting on someone are on the Exceptions tab, so no deal is in both.
 */
export async function ReadyToBill({
  deal,
  preview,
  filter,
  pick,
  sent,
}: {
  deal?: string;
  preview?: boolean;
  filter?: string;
  /** Invoices ticked in the list, to review before sending */
  pick?: string[];
  /** How many invoices the last bulk send sent */
  sent?: number;
}) {
  const all = Object.values(readState().handoffs)
    .filter((h) => h.status === 'processed')
    .sort((a, b) => a.accountName.localeCompare(b.accountName));
  if (all.length === 0) {
    return (
      <div className="py-6 text-muted-foreground text-sm">
        Nothing is ready yet. Deals appear here once they are set up. Salesforce sends each deal
        when it is moved to Closed Won. On the landing page, press “Send this week’s deals from
        Salesforce”.
      </div>
    );
  }
  // One call for every invoice, instead of one per deal
  const invoices = new Map((await kleer.findInvoices()).map((i) => [i.invoiceNumber, i.status]));
  // Recent Slack messages from reps, so finance sees them here without opening each deal
  const threads = await messagesByDeal(
    all.map((h) => ({ Id: h.oppId, accountName: h.accountName })),
  );
  const rows = all.map((h) => {
    const row = toRow(h, invoices);
    const thread = threads[h.oppId];
    const latest = thread?.messages.find((m) => m.role !== 'app');
    row.msg =
      latest && thread
        ? { author: latest.author, at: latest.at, unanswered: thread.unanswered }
        : null;
    return row;
  });
  const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const matches = (r: Row, _id: string, kinds: Kind[] | null) => !kinds || kinds.includes(r.kind);
  // Deals with a message nobody has answered come first
  const shown = rows
    .filter((r) => matches(r, active?.id ?? 'all', active?.kinds ?? null))
    .sort((a, b) => Number(!!b.msg?.unanswered) - Number(!!a.msg?.unanswered));
  const selected = deal ? rows.find((r) => r.h.oppId === deal) : undefined;
  const count = (f: (typeof FILTERS)[number]) =>
    rows.filter((r) => matches(r, f.id, f.kinds)).length;
  const href = (oppId: string, f = active?.id) =>
    `/admin-app?tab=ready&deal=${oppId}${f && f !== 'all' ? `&filter=${f}` : ''}`;

  const listHref = `/admin-app?tab=ready${active && active.id !== 'all' ? `&filter=${active.id}` : ''}`;

  // Only deals with nothing open can be sent in bulk: no open items, no rep waiting for a reply
  const flagged = new Set(openAlerts().map((a) => a.oppId));
  const ready = (r: Row) => r.kind === 'to_send' && !flagged.has(r.h.oppId) && !r.msg?.unanswered;

  if (pick?.length) {
    const chosen = rows.filter((r) => pick.includes(r.h.oppId) && ready(r));
    const invoices = await Promise.all(
      chosen.map(async (r) => {
        const [invoice, sub] = await Promise.all([
          kleer.getInvoice(r.h.invoiceNumber as string),
          r.h.subscriptionId ? adminApp.getSubscription(r.h.subscriptionId) : null,
        ]);
        return { r, invoice, sub };
      }),
    );
    const totals = new Map<string, number>();
    for (const { invoice } of invoices) {
      totals.set(invoice.currency, (totals.get(invoice.currency) ?? 0) + invoice.totalAmount);
    }
    return (
      <div className="flex flex-col gap-4">
        <Link href={listHref} className="w-fit text-muted-foreground text-sm hover:text-foreground">
          ← All deals
        </Link>
        <h2 className="font-medium text-lg">
          Send {invoices.length} invoice{invoices.length === 1 ? '' : 's'}
        </h2>
        <p className="text-muted-foreground text-sm">
          Each customer gets their invoice by email. It can’t be unsent. Untick any you want to
          check first.
        </p>
        <form action={sendInvoicesAction} className="flex flex-col gap-4">
          <div>
            <div className={cn(CONFIRM, 'border-b py-2 text-muted-foreground text-xs')}>
              <span />
              <span>Customer</span>
              <span>Service period</span>
              <span>Invoice</span>
              <span className="text-right">Amount</span>
            </div>
            {invoices.map(({ r, invoice, sub }) => {
              const discount = Math.max(0, ...invoice.lines.map((l) => l.discountPercent));
              const details = [
                sub ? `${sub.seats} ${sub.plan}` : null,
                discount > 0 ? `${discount}% discount` : null,
                invoice.poNumber ? `PO ${invoice.poNumber}` : null,
              ].filter(Boolean);
              return (
                <label
                  key={r.h.oppId}
                  className={cn(CONFIRM, 'items-center border-b py-3 text-sm')}
                >
                  <input type="checkbox" name="oppId" value={r.h.oppId} defaultChecked />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{r.h.accountName}</span>
                    <span className="block truncate text-muted-foreground text-xs">
                      {details.join(', ')}
                    </span>
                  </span>
                  <span className="text-muted-foreground">
                    {formatDate(invoice.servicePeriod.start)} to{' '}
                    {formatDate(invoice.servicePeriod.end)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate">{invoice.invoiceNumber}</span>
                    <span className="block truncate text-muted-foreground text-xs">
                      Due {formatDate(invoice.dueDate)}
                    </span>
                  </span>
                  <span className="text-right tabular-nums">
                    {formatMoney(invoice.totalAmount, invoice.currency)}
                  </span>
                </label>
              );
            })}
            <div className="px-2 py-3 text-right text-muted-foreground text-sm tabular-nums">
              Total {[...totals].map(([cur, sum]) => formatMoney(sum, cur)).join(' + ')}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <SubmitOnce pendingText="Sending...">Send invoices</SubmitOnce>
            <Link href={listHref} className="text-muted-foreground text-sm hover:text-foreground">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    );
  }

  if (selected) {
    return (
      <div className="flex flex-col gap-6">
        <Link href={listHref} className="w-fit text-muted-foreground text-sm hover:text-foreground">
          ← All deals
        </Link>
        <Detail h={selected.h} preview={!!preview} backHref={href(selected.h.oppId)} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex flex-wrap gap-x-6 gap-y-1 border-b text-sm">
        {FILTERS.map((f) => (
          <Link
            key={f.id}
            href={`/admin-app?tab=ready${f.id === 'all' ? '' : `&filter=${f.id}`}`}
            className={cn(
              '-mb-px border-b-2 pb-2',
              active?.id === f.id
                ? 'border-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {f.label} <span className="text-xs tabular-nums">{count(f)}</span>
          </Link>
        ))}
      </nav>
      {sent ? (
        <p className="text-sm">
          Sent {sent} invoice{sent === 1 ? '' : 's'}. The reps have been told.
        </p>
      ) : null}
      <form id="bulk" action="/admin-app" method="get">
        <input type="hidden" name="tab" value="ready" />
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground text-xs">
            Tick the invoices to send together. Deals with open items can’t be ticked.
          </span>
          <Button type="submit" size="sm">
            Review and send selected
          </Button>
        </div>
      </form>
      <div>
        <div className={cn(ROW, 'border-b py-2 text-muted-foreground text-xs')}>
          <span>
            <SelectAll />
          </span>
          <span>Customer</span>
          <span>Status</span>
          <span>Billed through</span>
          <span>Sales rep</span>
          <span>Slack</span>
        </div>
        {shown.map((r) => (
          <div
            key={r.h.oppId}
            className={cn(ROW, 'items-center border-b py-3 text-sm hover:bg-muted')}
          >
            <span>
              {ready(r) ? (
                <input
                  type="checkbox"
                  name="pick"
                  value={r.h.oppId}
                  form="bulk"
                  aria-label={`Send the invoice to ${r.h.accountName}`}
                />
              ) : null}
            </span>
            <Link href={href(r.h.oppId)} className="contents">
              <span className="truncate font-medium">{r.h.accountName}</span>
              <span className="flex items-center gap-2">
                <span className={cn('size-2 shrink-0 rounded-full', DOT[r.kind])} />
                {r.note}
              </span>
              <span className="truncate text-muted-foreground">
                {r.h.invoiceNumber ? `${r.h.invoiceNumber}, Kleer` : 'Card, Stripe'}
              </span>
              <span className="truncate text-muted-foreground">{r.h.repName}</span>
              <span
                className={cn(
                  'truncate text-xs',
                  r.msg?.unanswered ? 'font-medium text-amber-700' : 'text-muted-foreground',
                )}
              >
                {r.msg
                  ? `${r.msg.unanswered ? 'Needs a reply: ' : ''}${r.msg.author}, ${formatDate(r.msg.at)}`
                  : '—'}
              </span>
            </Link>
          </div>
        ))}
        {shown.length === 0 ? (
          <p className="py-6 text-muted-foreground text-sm">Nothing here.</p>
        ) : null}
      </div>
      <Demo />
    </div>
  );
}

const CONFIRM =
  'grid grid-cols-[1.5rem_minmax(0,1.6fr)_minmax(0,1.4fr)_minmax(0,1fr)_8rem] gap-x-4 px-2';

const ROW =
  'grid grid-cols-[1.5rem_minmax(0,1.4fr)_minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.6fr)] gap-x-4 px-2';

export { Detail as DealDetail };

async function Detail({
  h,
  preview,
  backHref,
}: {
  h: Handoff;
  preview: boolean;
  backHref: string;
}) {
  const [me, opp, sub, ws, invoice, thread] = await Promise.all([
    currentFinanceUser(),
    salesforce.getOpportunity(h.oppId),
    h.subscriptionId ? adminApp.getSubscription(h.subscriptionId) : null,
    h.workspaceId ? adminApp.getWorkspace(h.workspaceId) : null,
    h.invoiceNumber ? kleer.getInvoice(h.invoiceNumber) : null,
    messagesByDeal([{ Id: h.oppId, accountName: h.accountName }]).then((t) => t[h.oppId]),
  ]);
  const today = appToday();
  // Where the rep last asked, so the reply goes there and not to another channel
  const asked = thread?.messages.find(
    (m) => m.role === 'rep' && m.channel.startsWith('#') && !m.threadTs,
  );
  const live =
    sub && sub.status === 'Scheduled'
      ? `Scheduled, goes live ${formatDate(sub.startDate)}`
      : sub?.status;
  const held = sub?.status === 'Scheduled' && invoice?.status === 'draft';
  const items = openAlerts()
    .filter((a) => a.oppId === h.oppId)
    .sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999'));
  const lead = items[0];
  // A draft for finance to read and send. It answers the rep's question when they asked one.
  const suggested = draftReply(h, items, !!asked);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium text-lg">{h.dealName}</h2>
          <div className="mt-1 flex items-center gap-2">
            {lead ? (
              <span className="text-amber-700 text-sm">
                Waiting on {waitingOn(lead, h.repName)}
              </span>
            ) : (
              <Status value={LABEL[h.status]} tone={TONE[h.status]} />
            )}
            <Link
              href={`/deals/${h.oppId}`}
              className="text-muted-foreground text-xs hover:underline"
            >
              Open in Salesforce
            </Link>
          </div>
        </div>
        {invoice?.status === 'draft' ? (
          <Link
            href={`${backHref}&preview=1`}
            className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground text-sm hover:opacity-90"
          >
            Preview and send invoice
          </Link>
        ) : null}
      </div>

      {preview && invoice ? (
        <div className="border-y py-4">
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Invoice {invoice.invoiceNumber}</div>
                <div className="text-muted-foreground text-xs">
                  Customer {invoice.customerNumber}. Dated {formatDate(invoice.invoiceDate)}, due{' '}
                  {formatDate(invoice.dueDate)} ({invoice.paymentTermsDays} days).
                </div>
              </div>
              <span className="text-muted-foreground text-xs capitalize">{invoice.status}</span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Line</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right">Discount</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoice.lines.map((l) => (
                  <TableRow key={l.description}>
                    <TableCell className="whitespace-normal">{l.description}</TableCell>
                    <TableCell className="text-right">{l.quantity}</TableCell>
                    <TableCell className="text-right">
                      {formatMoney(l.unitPrice, invoice.currency)}
                    </TableCell>
                    <TableCell className="text-right">{l.discountPercent}%</TableCell>
                    <TableCell className="text-right">
                      {formatMoney(l.amount, invoice.currency)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="ml-auto flex w-60 flex-col gap-1 text-right">
              <div>Net {formatMoney(invoice.netAmount, invoice.currency)}</div>
              <div>
                VAT {invoice.vatRate}% {formatMoney(invoice.vatAmount, invoice.currency)}
              </div>
              <div className="font-medium">
                Total {formatMoney(invoice.totalAmount, invoice.currency)}
              </div>
            </div>
            <div className="text-muted-foreground text-xs">
              Service period {formatDate(invoice.servicePeriod.start)} to{' '}
              {formatDate(invoice.servicePeriod.end)}. Our reference {invoice.ourReference}.
            </div>
            {invoice.status === 'draft' ? (
              <form action={sendInvoiceAction} className="flex gap-2">
                <input type="hidden" name="oppId" value={h.oppId} />
                <SubmitOnce pendingText="Sending...">Send invoice</SubmitOnce>
                <Link
                  href={backHref}
                  className="px-2.5 py-1 text-muted-foreground text-sm hover:text-foreground"
                >
                  Close
                </Link>
              </form>
            ) : (
              <div className="flex items-center gap-3 text-sm">
                <span className="font-medium text-emerald-700 dark:text-emerald-400">
                  Invoice sent{invoice.sentAt ? ` on ${formatDate(invoice.sentAt)}` : ''}.
                </span>
                <span className="text-muted-foreground">It can’t be sent again.</span>
                <Link href={backHref} className="text-muted-foreground hover:text-foreground">
                  Close
                </Link>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {items.length > 0 ? (
        <section className="flex flex-col gap-3 border-t pt-3">
          <h3 className="font-medium text-sm">Waiting on</h3>
          {items.map((a) => (
            <div key={a.id} className="flex flex-col gap-1 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-medium">{waitingOn(a, h.repName)}</span>
                <span className="shrink-0 text-muted-foreground text-xs">
                  {a.due ? `Due ${formatDate(a.due)}` : ''}
                </span>
              </div>
              <div className="text-muted-foreground text-xs">
                {a.title}. {a.message}
              </div>
              <ItemAction a={a} rep={h.repName} />
            </div>
          ))}
        </section>
      ) : null}

      {h.status !== 'processed' ? null : (
        <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
          <Block title="Workspace">
            <Fields
              columns={2}
              items={[
                ['Workspace ID', h.workspaceId],
                ['Name', ws?.name ?? null],
              ]}
            />
          </Block>
          <Block title="Subscription">
            <Fields
              columns={2}
              items={[
                ['Subscription', h.subscriptionId],
                ['Plan and seats', sub ? `${sub.seats} ${sub.plan}` : null],
                ['Term', sub ? `${formatDate(sub.startDate)} to ${formatDate(sub.endDate)}` : null],
                ['Status', held ? `${live}, held until billing is secured` : live],
              ]}
            />
          </Block>
          <Block title="Billing">
            <Fields
              columns={2}
              items={[
                ['Method', h.system === 'Stripe' ? 'Card (Stripe)' : 'Invoice (Kleer)'],
                [
                  'Reference',
                  invoice
                    ? `${invoice.invoiceNumber}, ${invoice.status}`
                    : (h.stripeSubscriptionId ?? null),
                ],
                ['Amount', invoice ? formatMoney(invoice.totalAmount, invoice.currency) : null],
                ['PO number', invoice?.poNumber ?? null],
              ]}
            />
          </Block>
          <Block title="Sales rep">
            <Fields
              columns={2}
              items={[
                ['Rep', h.repName],
                ['Processed', formatDate(h.processedAt)],
              ]}
            />
          </Block>
        </div>
      )}

      <section className="flex flex-col gap-3 border-t pt-3 text-sm">
        <h3 className="font-medium">
          Slack
          {thread?.unanswered ? (
            <span className="ml-2 font-normal text-amber-700 text-xs">
              the rep is waiting for a reply
            </span>
          ) : null}
        </h3>
        <Messages thread={thread} />
        {me ? null : (
          <p className="text-muted-foreground text-xs">
            Sign in with Slack (left menu) to message the rep. Your name shows on the message.
          </p>
        )}
        <form className={me ? 'flex flex-col gap-2' : 'hidden'}>
          <input type="hidden" name="oppId" value={h.oppId} />
          {asked ? (
            <>
              <input type="hidden" name="channel" value={asked.channel.replace('#', '')} />
              <input type="hidden" name="threadTs" value={asked.ts} />
            </>
          ) : null}
          <Textarea
            name="text"
            rows={2}
            defaultValue={suggested}
            placeholder={`Write to ${h.repName}`}
          />
          <div className="flex flex-wrap items-center gap-4">
            {asked ? (
              <>
                <Button type="submit" size="sm" formAction={replyAction}>
                  Reply in {asked.channel}
                </Button>
                <Button type="submit" size="sm" variant="ghost" formAction={askRepAction}>
                  Send a direct message instead
                </Button>
              </>
            ) : (
              <>
                <Button type="submit" size="sm" formAction={askRepAction}>
                  Send to {h.repName.split(' ')[0]}
                </Button>
                <Button type="submit" size="sm" variant="ghost" formAction={replyAction}>
                  Post in #finance-billing instead
                </Button>
              </>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            {suggested ? 'The text is a draft: read it, change it, then send. ' : ''}As{' '}
            {me?.real_name}.{' '}
            {asked
              ? `The reply goes in the thread of ${asked.author}’s question and tags ${h.repName.split(' ')[0]}.`
              : `A direct message goes only to ${h.repName.split(' ')[0]}. A channel post is visible to the team and tags ${h.repName.split(' ')[0]}.`}
          </p>
        </form>
      </section>

      <details className="border-t pt-3 text-sm">
        <summary className="cursor-pointer">Copied from Salesforce</summary>
        <div className="mt-3">
          <Fields
            items={[
              ['Plan', opp.Plan__c],
              ['Licenses', opp.Number_of_Licenses__c],
              [
                'List price per license',
                formatMoney(opp.Price_per_License_per_Year__c, opp.CurrencyIsoCode),
              ],
              ['Discount', opp.Discount__c === null ? null : `${opp.Discount__c}%`],
              ['Contract term', opp.Contract_Term__c],
              ['Start date', formatDate(opp.Start_Date__c)],
              ['End date', formatDate(opp.End_Date__c)],
              ['Payment method', opp.Payment_Method__c],
              ['PO number', opp.PO_Number__c],
              ['Record type', opp.RecordType.Name],
              ['Closed', formatDate(opp.CloseDate)],
              ['Today in the app', formatDate(today)],
            ]}
          />
        </div>
      </details>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t pt-3">
      <h3 className="font-medium text-sm">{title}</h3>
      {children}
    </section>
  );
}

/** Demo only. Reset lives on Dev tools. */
function Demo() {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">Demo controls</summary>
      <div className="mt-3 flex flex-col items-start gap-2">
        <div className="flex gap-2">
          {[7, 35].map((days) => (
            <form key={days} action={advanceAction}>
              <input type="hidden" name="days" value={days} />
              <Button type="submit" variant="outline" size="sm">
                Demo: +{days} days
              </Button>
            </form>
          ))}
        </div>
        <span className="text-muted-foreground text-xs">
          Moves the app’s clock forward and runs the daily check, to see deadlines, going live and
          escalation. +35 days passes the 30-day payment terms, so sent invoices become overdue.
          Reset everything on Dev tools.
        </span>
      </div>
    </details>
  );
}
