import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  advanceAction,
  askRepAction,
  replyAction,
  sendInvoiceAction,
} from '@/app/(shell)/handoff-actions';
import { Fields } from '@/components/data/fields';
import { Status } from '@/components/data/status';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { messagesByDeal } from '@/lib/handoff/slack';
import { appToday, type Handoff, readState } from '@/lib/handoff/store';
import { cn } from '@/lib/utils';
import { Messages } from './messages';
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
}

const DOT: Record<Kind, string> = {
  to_send: 'bg-violet-600',
  waiting: 'bg-amber-500',
  done: 'bg-emerald-500',
  ignored: 'bg-slate-300',
};

const FILTERS: { id: string; label: string; kinds: Kind[] | null }[] = [
  { id: 'all', label: 'All', kinds: null },
  { id: 'to_send', label: 'To send', kinds: ['to_send'] },
  { id: 'waiting', label: 'Waiting', kinds: ['waiting'] },
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
 * Deals Salesforce has sent. The list is on the left and the selected deal is on
 * the right, so finance can work down the list without leaving the page.
 */
export async function ReadyToBill({
  deal,
  preview,
  filter,
}: {
  deal?: string;
  preview?: boolean;
  filter?: string;
}) {
  const all = Object.values(readState().handoffs).sort((a, b) =>
    a.accountName.localeCompare(b.accountName),
  );
  if (all.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
        No deals yet. Salesforce sends each deal when it is moved to Closed Won. On Dev tools, press
        “Send all to webhook” to send this week’s deals.
      </div>
    );
  }
  // One call for every invoice, instead of one per deal
  const invoices = new Map((await kleer.findInvoices()).map((i) => [i.invoiceNumber, i.status]));
  const rows = all.map((h) => toRow(h, invoices));
  const active = FILTERS.find((f) => f.id === filter) ?? FILTERS[0];
  const shown = rows.filter((r) => !active?.kinds || active.kinds.includes(r.kind));
  const selected = shown.find((r) => r.h.oppId === deal) ?? shown[0];
  const count = (kinds: Kind[] | null) =>
    rows.filter((r) => !kinds || kinds.includes(r.kind)).length;
  const href = (oppId: string, f = active?.id) =>
    `/admin-app?tab=ready&deal=${oppId}${f && f !== 'all' ? `&filter=${f}` : ''}`;

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <nav className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <Link
              key={f.id}
              href={`/admin-app?tab=ready${f.id === 'all' ? '' : `&filter=${f.id}`}`}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                active?.id === f.id
                  ? 'border-violet-600 bg-violet-600 text-white'
                  : 'hover:bg-violet-500/10',
              )}
            >
              {f.label} {count(f.kinds)}
            </Link>
          ))}
        </nav>
        <ul className="flex flex-col divide-y rounded-lg border">
          {shown.map((r) => (
            <li key={r.h.oppId}>
              <Link
                href={href(r.h.oppId)}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/60',
                  selected?.h.oppId === r.h.oppId && 'bg-violet-500/10',
                )}
              >
                <span className={cn('size-2 shrink-0 rounded-full', DOT[r.kind])} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-sm">{r.h.accountName}</span>
                  <span className="block truncate text-muted-foreground text-xs">
                    {r.note}, {r.h.repName}
                  </span>
                </span>
              </Link>
            </li>
          ))}
          {shown.length === 0 ? (
            <li className="p-4 text-center text-muted-foreground text-sm">Nothing here.</li>
          ) : null}
        </ul>
        <Demo />
      </div>
      <div className="min-w-0">
        {selected ? (
          <Detail h={selected.h} preview={!!preview} backHref={href(selected.h.oppId)} />
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
            Pick a deal from the list.
          </div>
        )}
      </div>
    </div>
  );
}

async function Detail({
  h,
  preview,
  backHref,
}: {
  h: Handoff;
  preview: boolean;
  backHref: string;
}) {
  const [opp, sub, ws, invoice, thread] = await Promise.all([
    salesforce.getOpportunity(h.oppId),
    h.subscriptionId ? adminApp.getSubscription(h.subscriptionId) : null,
    h.workspaceId ? adminApp.getWorkspace(h.workspaceId) : null,
    h.invoiceNumber ? kleer.getInvoice(h.invoiceNumber) : null,
    messagesByDeal([{ Id: h.oppId, accountName: h.accountName }]).then((t) => t[h.oppId]),
  ]);
  const today = appToday();
  const live =
    sub && sub.status === 'Scheduled'
      ? `Scheduled, goes live ${formatDate(sub.startDate)}`
      : sub?.status;
  const held = sub?.status === 'Scheduled' && invoice?.status === 'draft';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-medium text-lg">{h.dealName}</h2>
          <div className="mt-1 flex items-center gap-2">
            <Status value={LABEL[h.status]} tone={TONE[h.status]} />
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
            className="rounded-lg bg-violet-600 px-3 py-1.5 font-medium text-sm text-white hover:bg-violet-700"
          >
            Preview and send invoice
          </Link>
        ) : null}
      </div>

      {preview && invoice ? (
        <Card className="ring-2 ring-violet-500/60">
          <CardContent className="flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Invoice {invoice.invoiceNumber}</div>
                <div className="text-muted-foreground text-xs">
                  Customer {invoice.customerNumber}. Dated {formatDate(invoice.invoiceDate)}, due{' '}
                  {formatDate(invoice.dueDate)} ({invoice.paymentTermsDays} days).
                </div>
              </div>
              <Badge variant="outline">{invoice.status}</Badge>
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
                <Link href={backHref} className="rounded-lg px-2.5 py-1 text-sm hover:bg-muted">
                  Close
                </Link>
              </form>
            ) : (
              <div className="flex items-center gap-3 text-sm">
                <span className="font-medium text-emerald-700 dark:text-emerald-400">
                  Invoice sent{invoice.sentAt ? ` on ${formatDate(invoice.sentAt)}` : ''}.
                </span>
                <span className="text-muted-foreground">It can’t be sent again.</span>
                <Link href={backHref} className="rounded-lg px-2.5 py-1 hover:bg-muted">
                  Close
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {h.status !== 'processed' ? (
        <p className="rounded-lg border border-dashed p-4 text-muted-foreground text-sm">
          Nothing has been set up yet. See the Exceptions tab for what this deal is waiting for.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
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

      <details className="rounded-lg border p-3 text-sm">
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

      <details className="rounded-lg border p-3 text-sm" open={thread?.unanswered}>
        <summary className="cursor-pointer">
          Slack messages about this deal
          {thread?.unanswered ? ' (the rep is waiting for a reply)' : ''}
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <Messages thread={thread} />
          <form className="flex flex-col gap-2">
            <input type="hidden" name="oppId" value={h.oppId} />
            <Textarea
              name="text"
              rows={2}
              placeholder={`Write to ${h.repName} or to #finance-billing`}
            />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" formAction={askRepAction}>
                Send to {h.repName.split(' ')[0]} in Slack
              </Button>
              <Button type="submit" size="sm" variant="outline" formAction={replyAction}>
                Post in #finance-billing
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Both are filed under this deal. The first is a direct message to the rep. The second
              is a reply in the channel, and closes an open message from the rep.
            </p>
          </form>
        </div>
      </details>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-2">
        <h3 className="font-medium text-sm">{title}</h3>
        {children}
      </CardContent>
    </Card>
  );
}

/** Demo only. Reset lives on Dev tools. */
function Demo() {
  return (
    <details className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer text-muted-foreground">Demo controls</summary>
      <form action={advanceAction} className="mt-3 flex flex-col items-start gap-2">
        <input type="hidden" name="days" value="7" />
        <Button type="submit" variant="outline" size="sm">
          Demo: +7 days
        </Button>
        <span className="text-muted-foreground text-xs">
          Moves the app’s clock forward and runs the daily check, to see deadlines, going live and
          escalation. Reset everything on Dev tools.
        </span>
      </form>
    </details>
  );
}
