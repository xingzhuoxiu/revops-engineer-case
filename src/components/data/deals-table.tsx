import Link from 'next/link';
import { Status } from '@/components/data/status';
import { NewBadge, VioletPill } from '@/components/handoff/built';
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
  const handoffs = readState().handoffs;
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
                  <VioletPill muted={status === 'not_sent' || status === 'ignored'}>
                    {HANDOFF_LABEL[status]}
                  </VioletPill>
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
