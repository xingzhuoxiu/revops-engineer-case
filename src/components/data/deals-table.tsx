import Link from 'next/link';
import { Status } from '@/components/data/status';
import { NewBadge } from '@/components/handoff/built';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate, formatMoney } from '@/lib/format';
import { readState } from '@/lib/handoff/store';
import type { SalesforceAccount, SalesforceOpportunity, SalesforceUser } from '@/lib/systems/types';

/** What the Closed Won hand-off has done with a deal. Added to the mock Deals list. */
export const HANDOFF_LABEL: Record<string, string> = {
  processed: 'Processed',
  waiting_rep: 'Waiting on rep',
  waiting_finance: 'With finance',
  ignored: 'Ignored',
  not_sent: 'Not sent yet',
};

type Tone = 'green' | 'amber' | 'blue' | 'red' | 'grey';

const DOT: Record<Tone, string> = {
  green: 'bg-emerald-500',
  amber: 'bg-amber-500',
  blue: 'bg-sky-500',
  red: 'bg-red-500',
  grey: 'bg-slate-300',
};

/** Each condition, in one line, so a rep can read the column without a key. */
export const LEGEND: { tone: Tone; label: string; means: string }[] = [
  { tone: 'amber', label: 'Waiting on rep', means: 'something to fix on the deal' },
  {
    tone: 'blue',
    label: 'With finance',
    means: 'finance or Deal Desk decides, nothing for the rep',
  },
  { tone: 'green', label: 'Processed', means: 'set up. The line below says where billing is' },
  { tone: 'red', label: 'Needs attention', means: 'overdue invoice or failed payment' },
  { tone: 'grey', label: 'Not in hand-off', means: 'not Closed Won, or not sent yet' },
];

/** The status of one deal: a coloured dot, a label, and the one reason behind it. */
function describe(
  status: string,
  opp: SalesforceOpportunity,
  open: string[],
): { tone: Tone; label: string; detail: string } {
  if (status === 'waiting_rep') {
    return {
      tone: 'amber',
      label: 'Waiting on rep',
      detail: open.length ? `Fix: ${open.join(', ')}` : 'Something to fix',
    };
  }
  if (status === 'waiting_finance') {
    return {
      tone: 'blue',
      label: 'With finance',
      detail: open.length ? `Waiting on: ${open.join(', ')}` : 'Finance is deciding',
    };
  }
  if (status === 'processed') {
    const billing = String(opp.Invoice_Status__c ?? '');
    if (billing === 'Overdue' || billing === 'Payment failed') {
      return { tone: 'red', label: 'Processed', detail: billing };
    }
    const detail =
      billing === 'Draft'
        ? 'Invoice drafted, Billing sends it'
        : billing === 'Sent'
          ? 'Invoice sent, waiting for payment'
          : billing === 'Paid'
            ? 'Invoice paid'
            : billing === 'Paid by card'
              ? 'Card charged'
              : 'Set up';
    return { tone: 'green', label: 'Processed', detail };
  }
  if (status === 'ignored') {
    return { tone: 'grey', label: 'Not in hand-off', detail: 'Not Closed Won' };
  }
  return {
    tone: 'grey',
    label: 'Not in hand-off',
    detail: opp.StageName === 'Closed Won' ? 'Not sent to finance yet' : 'Deal is still open',
  };
}

export function HandoffLegend() {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-violet-500/30 bg-violet-500/5 px-3 py-2 text-xs">
      <span className="font-medium text-violet-900 dark:text-violet-200">Hand-off column</span>
      {LEGEND.map((l) => (
        <span key={l.label} className="flex items-center gap-1.5">
          <span className={`size-2 rounded-full ${DOT[l.tone]}`} />
          <span className="font-medium">{l.label}</span>
          <span className="text-muted-foreground">{l.means}</span>
        </span>
      ))}
    </div>
  );
}

export function DealsTable({
  opportunities,
  accounts,
  users,
}: {
  opportunities: SalesforceOpportunity[];
  accounts: SalesforceAccount[];
  users: SalesforceUser[];
}) {
  const accountName = (id: string) => accounts.find((a) => a.Id === id)?.Name ?? id;
  const userName = (id: string) => users.find((u) => u.Id === id)?.Name ?? id;
  const { handoffs, alerts } = readState();
  // What is open on each deal, by name, so the column can say why
  const openFor = (oppId: string, queues: 'rep' | 'other') =>
    alerts
      .filter(
        (a) =>
          a.oppId === oppId &&
          a.status === 'open' &&
          a.kind === 'rule' &&
          (queues === 'rep' ? a.queue === 'rep' : a.queue !== 'rep'),
      )
      .map((a) => a.title.toLowerCase());
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Opportunity</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead className="bg-violet-500/5">
              Hand-off <NewBadge className="ml-1" />
            </TableHead>
            <TableHead>Owner</TableHead>
            <TableHead className="text-right">Licenses</TableHead>
            <TableHead className="text-right">Amount</TableHead>
            <TableHead>Payment</TableHead>
            <TableHead>Close date</TableHead>
            <TableHead>Subscription</TableHead>
            <TableHead>Invoice</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {opportunities.map((o) => {
            const status: string = handoffs[o.Id]?.status ?? 'not_sent';
            const hand = describe(
              status,
              o,
              openFor(o.Id, status === 'waiting_rep' ? 'rep' : 'other'),
            );
            return (
              <TableRow key={o.Id}>
                <TableCell>
                  <Link href={`/deals/${o.Id}`} className="font-medium hover:underline">
                    {o.Name}
                  </Link>
                  <div className="text-muted-foreground text-xs">
                    {accountName(o.AccountId)}, {o.RecordType.Name}
                  </div>
                </TableCell>
                <TableCell>
                  <Status value={o.StageName} />
                </TableCell>
                <TableCell className="bg-violet-500/5">
                  <div className="flex items-start gap-2">
                    <span className={`mt-1.5 size-2 shrink-0 rounded-full ${DOT[hand.tone]}`} />
                    <div>
                      <div className="font-medium text-sm">{hand.label}</div>
                      <div className="max-w-56 whitespace-normal text-muted-foreground text-xs">
                        {hand.detail}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-sm">{userName(o.OwnerId)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {o.Number_of_Licenses__c} {o.Plan__c}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(o.Amount, o.CurrencyIsoCode)}
                </TableCell>
                <TableCell className="text-sm">{o.Payment_Method__c}</TableCell>
                <TableCell className="text-sm">{formatDate(o.CloseDate)}</TableCell>
                <TableCell className="font-mono text-xs">{o.Subscription_ID__c ?? ''}</TableCell>
                <TableCell className="font-mono text-xs">{o.Invoice_Number__c ?? ''}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
