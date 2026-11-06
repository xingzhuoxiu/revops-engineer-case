import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Status } from '@/components/data/status';
import { TabsNav } from '@/components/data/tabs-nav';
import { BillingEditor } from '@/components/handoff/billing-editor';
import { DealActivity } from '@/components/handoff/deal-activity';
import { RepChecklist } from '@/components/handoff/rep-checklist';
import { EmptyState, Page, PageHeader } from '@/components/shell/page';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { adminApp, ConnectorError, kleer, salesforce } from '@/lib/connectors';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { getHandoff } from '@/lib/handoff/store';

/** Fields every opportunity has. Anything else was written back by an integration. */
const STANDARD_FIELDS = new Set([
  'Id',
  'Name',
  'AccountId',
  'RecordType',
  'StageName',
  'IsClosed',
  'IsWon',
  'CloseDate',
  'Amount',
  'CurrencyIsoCode',
  'OwnerId',
  'Plan__c',
  'Number_of_Licenses__c',
  'Total_Licenses__c',
  'Price_per_License_per_Year__c',
  'Discount__c',
  'Contract_Term__c',
  'Start_Date__c',
  'End_Date__c',
  'Multi_Year_deal__c',
  'Multi_Year_Payment_Terms__c',
  'Payment_Method__c',
  'Credit_Card_Payment__c',
  'PO_Number__c',
  'Billing_Contact__c',
  'Discount_Approval__c',
  'Original_Opportunity__c',
  'Subscription_ID__c',
  'Invoice_Number__c',
  'Description',
  'CreatedDate',
  'LastModifiedDate',
  'OpportunityLineItems',
]);

const yesNo = (value: unknown) => (value ? 'Yes' : 'No');

export default async function DealPage(props: PageProps<'/deals/[id]'>) {
  const { id } = await props.params;
  const { tab } = await props.searchParams;
  const active = tab === 'products' || tab === 'events' ? tab : 'activity';
  const opportunity = await salesforce.getOpportunity(id).catch((error) => {
    if (error instanceof ConnectorError && error.status === 404) notFound();
    throw error;
  });
  const [account, users, feed, subscriptions, invoices] = await Promise.all([
    salesforce.getAccount(opportunity.AccountId),
    salesforce.listUsers(),
    salesforce.listEvents(),
    adminApp.listSubscriptions({ salesforceAccountId: opportunity.AccountId }),
    kleer.findInvoices({ foreignId: opportunity.Id }),
  ]);
  const contact = opportunity.Billing_Contact__c
    ? await salesforce.getContact(opportunity.Billing_Contact__c).catch(() => null)
    : null;
  const original = opportunity.Original_Opportunity__c
    ? await salesforce.getOpportunity(opportunity.Original_Opportunity__c).catch(() => null)
    : null;
  const owner = users.find((u) => u.Id === opportunity.OwnerId);
  const events = feed.events.filter((e) => e.opportunityId === opportunity.Id);
  const custom = Object.entries(opportunity).filter(([key]) => !STANDARD_FIELDS.has(key));
  const money = (n: number | null) => formatMoney(n, opportunity.CurrencyIsoCode);
  const workspaceId = getHandoff(opportunity.Id)?.workspaceId ?? account.Workspace_ID__c;

  const tabHref = (t: string) => `/deals/${opportunity.Id}${t === 'activity' ? '' : `?tab=${t}`}`;

  return (
    <Page>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded bg-[#fcb95b] font-bold text-[10px] text-white">
              $
            </span>
            Opportunity
            <span className="text-muted-foreground">·</span>
            <Link href={`/accounts/${account.Id}`} className="hover:underline">
              {account.Name}
            </Link>
          </span>
        }
        title={opportunity.Name}
        actions={
          <>
            <Badge variant="outline">{opportunity.RecordType.Name}</Badge>
            <Status value={opportunity.StageName} />
          </>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[17rem_minmax(0,1fr)_17rem]">
        {/* Left: the deal's key facts */}
        <aside className="order-2 flex flex-col gap-4 lg:order-1">
          <Panel title="About this deal">
            <Facts
              rows={[
                ['Amount', money(opportunity.Amount)],
                ['Close date', formatDate(opportunity.CloseDate)],
                ['Owner', owner ? `${owner.Name} (${owner.UserRole.Name})` : opportunity.OwnerId],
                ['Plan', opportunity.Plan__c],
                ['Licenses on this deal', opportunity.Number_of_Licenses__c],
                ['Total after this deal', opportunity.Total_Licenses__c],
                ['List price per license', money(opportunity.Price_per_License_per_Year__c)],
                [
                  'Discount',
                  opportunity.Discount__c === null ? null : `${opportunity.Discount__c}%`,
                ],
                ['Discount approval', opportunity.Discount_Approval__c],
                ['Contract term', opportunity.Contract_Term__c],
                ['Start date', formatDate(opportunity.Start_Date__c)],
                ['End date', formatDate(opportunity.End_Date__c)],
                ['Multi-year', yesNo(opportunity.Multi_Year_deal__c)],
                ['Multi-year payment', opportunity.Multi_Year_Payment_Terms__c],
                [
                  'Original deal',
                  original ? (
                    <Link
                      key="original"
                      href={`/deals/${original.Id}`}
                      className="text-primary hover:underline"
                    >
                      {original.Name}
                    </Link>
                  ) : null,
                ],
              ]}
            />
          </Panel>
          {opportunity.Description ? (
            <Panel title="Description">
              <p className="text-sm">{opportunity.Description}</p>
            </Panel>
          ) : null}
        </aside>

        {/* Center: what needs the rep, then the detail */}
        <main className="order-1 flex min-w-0 flex-col gap-6 lg:order-2">
          <RepChecklist oppId={opportunity.Id} />
          <BillingEditor opportunity={opportunity} account={account} contact={contact} />
          <div className="flex flex-col gap-4">
            <TabsNav
              active={active}
              tabs={[
                { id: 'activity', label: 'Slack messages', href: tabHref('activity') },
                {
                  id: 'products',
                  label: 'Products',
                  href: tabHref('products'),
                  count: opportunity.OpportunityLineItems.totalSize,
                },
                {
                  id: 'events',
                  label: 'Salesforce events',
                  href: tabHref('events'),
                  count: events.length,
                },
              ]}
            />
            {active === 'activity' ? (
              <DealActivity oppId={opportunity.Id} accountName={account.Name} />
            ) : active === 'products' ? (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Quantity</TableHead>
                      <TableHead className="text-right">List price</TableHead>
                      <TableHead className="text-right">Discount</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {opportunity.OpportunityLineItems.records.map((line) => (
                      <TableRow key={line.Id}>
                        <TableCell>
                          {line.Name}{' '}
                          <span className="font-mono text-muted-foreground text-xs">
                            {line.ProductCode}
                          </span>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{line.Quantity}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(line.UnitPrice)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{line.Discount}%</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(line.TotalPrice)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : events.length === 0 ? (
              <EmptyState>No events for this deal.</EmptyState>
            ) : (
              <ul className="flex flex-col gap-2">
                {events.map((e) => (
                  <li key={e.replayId} className="rounded-lg border p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs">
                        #{e.replayId} {e.type}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {formatDateTime(e.occurredAt)}
                      </span>
                    </div>
                    <div className="text-muted-foreground text-xs">
                      Changed: {e.changedFields.join(', ')}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </main>

        {/* Right: what this deal is linked to in the other systems */}
        <aside className="order-3 flex flex-col gap-4">
          <Panel title="Linked records">
            <div className="flex flex-col gap-3 text-sm">
              <Linked label="Account">
                <Link href={`/accounts/${account.Id}`} className="hover:underline">
                  {account.Name}
                </Link>
                <span className="text-muted-foreground text-xs">
                  {account.Type}, {account.BillingCountry}
                </span>
              </Linked>
              <Linked label="Workspace">
                {workspaceId ? (
                  <span className="font-mono text-xs">{workspaceId}</span>
                ) : (
                  <span className="text-muted-foreground">None yet</span>
                )}
              </Linked>
              <Linked label="Subscription">
                {subscriptions.length === 0 ? (
                  <span className="text-muted-foreground">None yet</span>
                ) : (
                  subscriptions.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2">
                      <span>
                        <span className="font-mono text-xs">{s.id}</span>
                        <span className="block text-muted-foreground text-xs">
                          {s.seats} {s.plan}, to {formatDate(s.endDate)}
                        </span>
                      </span>
                      <Status value={s.status} />
                    </div>
                  ))
                )}
              </Linked>
              <Linked label="Invoice">
                {invoices.length === 0 ? (
                  <span className="text-muted-foreground">None yet</span>
                ) : (
                  invoices.map((i) => (
                    <div key={i.invoiceNumber} className="flex items-center justify-between gap-2">
                      <span>
                        <span className="font-mono text-xs">{i.invoiceNumber}</span>
                        <span className="block text-muted-foreground text-xs">
                          {formatMoney(i.totalAmount, i.currency)}
                        </span>
                      </span>
                      <Status value={i.status} />
                    </div>
                  ))
                )}
              </Linked>
            </div>
          </Panel>
          <Panel title="Written back by the hand-off">
            <Facts
              rows={[
                ['Subscription_ID__c', opportunity.Subscription_ID__c],
                ['Invoice_Number__c', opportunity.Invoice_Number__c],
                ...custom.map(
                  ([key, value]) =>
                    [key, value === null ? null : String(value)] as [string, string | null],
                ),
              ]}
              showEmpty
            />
          </Panel>
        </aside>
      </div>
    </Page>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card size="sm">
      <CardContent className="flex flex-col gap-2">
        <h2 className="font-medium text-sm">{title}</h2>
        {children}
      </CardContent>
    </Card>
  );
}

/** Label on the left, value on the right. Empty values are left out unless asked for. */
function Facts({
  rows,
  showEmpty,
}: {
  rows: [label: string, value: ReactNode][];
  showEmpty?: boolean;
}) {
  const shown = rows.filter(([, v]) => showEmpty || (v !== null && v !== undefined && v !== ''));
  return (
    <dl className="flex flex-col divide-y text-sm">
      {shown.map(([label, value]) => (
        <div key={label} className="flex items-start justify-between gap-3 py-1.5">
          <dt className="shrink-0 text-muted-foreground text-xs">{label}</dt>
          <dd className="break-words text-right">
            {value === null || value === undefined || value === '' ? (
              <span className="text-muted-foreground">None</span>
            ) : (
              value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Linked({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-muted-foreground text-xs">{label}</div>
      {children}
    </div>
  );
}
