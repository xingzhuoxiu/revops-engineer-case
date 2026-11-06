import type { Metadata } from 'next';
import Link from 'next/link';
import { Status } from '@/components/data/status';
import { TabsNav } from '@/components/data/tabs-nav';
import { BuiltNote } from '@/components/handoff/built';
import { Exceptions, exceptionCount } from '@/components/handoff/exceptions';
import { ReadyToBill } from '@/components/handoff/ready-to-bill';
import { Rules } from '@/components/handoff/rules';
import { Page, PageHeader } from '@/components/shell/page';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { adminApp, salesforce } from '@/lib/connectors';
import { formatDate } from '@/lib/format';
import { readState } from '@/lib/handoff/store';

export const metadata: Metadata = { title: 'Admin app' };

/** A short note on each new tab, for whoever reviews this mock. */
const NOTES: Record<string, { title: string; text: string }> = {
  ready: {
    title: 'The finance side of the hand-off.',
    text: 'Every deal Salesforce sent over, and what the system already set up for it: the workspace, the subscription, and the invoice draft or card charge. Finance only has to check the invoice and send it. In the real admin app this would just be another page.',
  },
  exceptions: {
    title: 'Only what needs a person.',
    text: 'Anything the system can’t decide by itself ends up here, with who handles it and by when. It goes to a team queue, not to one person, so nothing sits here while someone is on holiday. The conversation itself stays in Slack.',
  },
  rules: {
    title: 'Finance’s rules in one place.',
    text: 'Card limit, discount limit, deadlines, and who covers for who. Finance can change them here and see who changed what, so a small rule change doesn’t need a developer.',
  },
};

export default async function AdminAppPage(props: PageProps<'/admin-app'>) {
  const { tab, deal, preview, filter } = await props.searchParams;
  const active =
    tab === 'workspaces' || tab === 'ready' || tab === 'exceptions' || tab === 'rules'
      ? tab
      : 'subscriptions';
  const ready = Object.values(readState().handoffs).filter((h) => h.status !== 'ignored').length;
  const [subscriptions, workspaces, accounts] = await Promise.all([
    adminApp.listSubscriptions(),
    adminApp.listWorkspaces(),
    salesforce.listAccounts(),
  ]);
  const account = (id: string | null) => accounts.find((a) => a.Id === id);
  const workspace = (id: string) => workspaces.find((w) => w.id === id);
  const accountCell = (id: string | null) => {
    const found = account(id);
    return found ? (
      <Link href={`/accounts/${found.Id}`} className="hover:underline">
        {found.Name}
      </Link>
    ) : (
      <span className="text-muted-foreground">Not linked</span>
    );
  };

  return (
    <Page>
      <PageHeader
        title="Admin app"
        description="Mentimeter's internal app for workspaces and subscriptions."
      />
      <TabsNav
        active={active}
        tabs={[
          {
            id: 'subscriptions',
            label: 'Subscriptions',
            href: '/admin-app',
            count: subscriptions.length,
          },
          {
            id: 'workspaces',
            label: 'Workspaces',
            href: '/admin-app?tab=workspaces',
            count: workspaces.length,
          },
          {
            id: 'ready',
            label: 'Ready to bill',
            href: '/admin-app?tab=ready',
            count: ready,
            isNew: true,
          },
          {
            id: 'exceptions',
            label: 'Exceptions',
            href: '/admin-app?tab=exceptions',
            count: exceptionCount(),
            isNew: true,
          },
          { id: 'rules', label: 'Rules', href: '/admin-app?tab=rules', isNew: true },
        ]}
      />
      {NOTES[active] ? (
        <BuiltNote title={NOTES[active].title}>{NOTES[active].text}</BuiltNote>
      ) : null}
      {active === 'ready' ? (
        <ReadyToBill
          deal={typeof deal === 'string' ? deal : undefined}
          preview={preview === '1'}
          filter={typeof filter === 'string' ? filter : undefined}
        />
      ) : active === 'exceptions' ? (
        <Exceptions />
      ) : active === 'rules' ? (
        <Rules />
      ) : (
        <div className="rounded-lg border">
          {active === 'subscriptions' ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Subscription</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Seats</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Billing</TableHead>
                  <TableHead>Created by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscriptions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono text-xs">{s.id}</TableCell>
                    <TableCell className="text-sm">
                      {workspace(s.workspaceId)?.name}
                      <div className="font-mono text-muted-foreground text-xs">{s.workspaceId}</div>
                    </TableCell>
                    <TableCell className="text-sm">{accountCell(s.salesforceAccountId)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {s.seats} {s.plan}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDate(s.startDate)} to {formatDate(s.endDate)}
                      {s.autoRenew ? (
                        <div className="text-muted-foreground text-xs">Renews automatically</div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Status value={s.status} />
                    </TableCell>
                    <TableCell className="text-sm">
                      {s.billingSystem}
                      <div className="font-mono text-muted-foreground text-xs">
                        {s.billingReference}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">{s.createdBy}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Domain</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead className="text-right">Members</TableHead>
                  <TableHead>Region</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workspaces.map((w) => (
                  <TableRow key={w.id}>
                    <TableCell>
                      <div className="font-medium text-sm">{w.name}</div>
                      <div className="font-mono text-muted-foreground text-xs">{w.id}</div>
                    </TableCell>
                    <TableCell className="text-sm">{accountCell(w.salesforceAccountId)}</TableCell>
                    <TableCell className="text-sm">{w.domain}</TableCell>
                    <TableCell>
                      <Status value={w.plan} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{w.activeMembers}</TableCell>
                    <TableCell className="text-sm">{w.region}</TableCell>
                    <TableCell className="text-sm">{formatDate(w.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}
    </Page>
  );
}
