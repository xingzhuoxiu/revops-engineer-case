import type { Metadata } from 'next';
import Link from 'next/link';
import { Status } from '@/components/data/status';
import { BuiltNote } from '@/components/handoff/built';
import { Exceptions, needsActionCount } from '@/components/handoff/exceptions';
import { ReadyToBill } from '@/components/handoff/ready-to-bill';
import { Rules } from '@/components/handoff/rules';
import { SignIn } from '@/components/handoff/sign-in';
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
    title: 'Ready to bill.',
    text: 'Deals that are set up: the workspace, the subscription, and the invoice or card charge. Send the invoice here. Deals still waiting on someone are under Needs action. In the real admin app this would just be another page.',
  },
  exceptions: {
    title: 'Needs action.',
    text: 'Every Closed Won deal that is waiting on someone, and who: the sales rep, Billing, Credit Control or Deal Desk. One card per deal, in the column of whoever has to act. When the open items are done, the deal moves to Ready to bill. The conversation stays in Slack.',
  },
  rules: {
    title: 'Rules.',
    text: 'Finance’s numbers as settings: card limit, discount limit, deadlines, and who covers for who. Every change is logged, so a small rule change doesn’t need a developer.',
  },
};

export default async function AdminAppPage(props: PageProps<'/admin-app'>) {
  const { tab, deal, preview, filter, pick, sent } = await props.searchParams;
  const active =
    tab === 'workspaces' || tab === 'ready' || tab === 'exceptions' || tab === 'rules'
      ? tab
      : 'subscriptions';
  const ready = Object.values(readState().handoffs).filter((h) => h.status === 'processed').length;
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

  const groups = [
    {
      title: 'Records',
      items: [
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
      ],
    },
    {
      title: 'Closed Won hand-off',
      items: [
        {
          id: 'exceptions',
          label: 'Needs action',
          href: '/admin-app?tab=exceptions',
          count: needsActionCount(),
        },
        { id: 'ready', label: 'Ready to bill', href: '/admin-app?tab=ready', count: ready },
        { id: 'rules', label: 'Rules', href: '/admin-app?tab=rules', count: null },
      ],
    },
  ];

  return (
    <Page>
      <PageHeader title="Admin app" />
      <div className="grid items-start gap-8 md:grid-cols-[11rem_minmax(0,1fr)]">
        <nav className="flex flex-col gap-5 text-sm">
          {groups.map((g, i) => (
            <div key={g.title} className="flex flex-col">
              <div className="flex items-center gap-1.5 px-2 pb-1 text-muted-foreground text-xs">
                {g.title}
                {i === 1 ? <span className="size-1.5 rounded-full bg-violet-600" /> : null}
              </div>
              {g.items.map((n) => (
                <Link
                  key={n.id}
                  href={n.href}
                  className={`flex items-center justify-between rounded-sm px-2 py-1.5 hover:bg-muted ${
                    active === n.id ? 'bg-muted font-medium' : ''
                  }`}
                >
                  {n.label}
                  {n.count === null ? null : (
                    <span className="text-muted-foreground text-xs tabular-nums">{n.count}</span>
                  )}
                </Link>
              ))}
            </div>
          ))}
          <SignIn />
        </nav>
        <div className="flex min-w-0 flex-col gap-4">
          {NOTES[active] ? (
            <BuiltNote title={NOTES[active].title}>{NOTES[active].text}</BuiltNote>
          ) : null}
          {active === 'ready' ? (
            <ReadyToBill
              deal={typeof deal === 'string' ? deal : undefined}
              preview={preview === '1'}
              filter={typeof filter === 'string' ? filter : undefined}
              pick={pick === undefined ? undefined : [pick].flat()}
              sent={typeof sent === 'string' ? Number(sent) || undefined : undefined}
            />
          ) : active === 'exceptions' ? (
            <Exceptions
              deal={typeof deal === 'string' ? deal : undefined}
              preview={preview === '1'}
            />
          ) : active === 'rules' ? (
            <Rules />
          ) : (
            <div className="border-y">
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
                          <div className="font-mono text-muted-foreground text-xs">
                            {s.workspaceId}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">
                          {accountCell(s.salesforceAccountId)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {s.seats} {s.plan}
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatDate(s.startDate)} to {formatDate(s.endDate)}
                          {s.autoRenew ? (
                            <div className="text-muted-foreground text-xs">
                              Renews automatically
                            </div>
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
                        <TableCell className="text-muted-foreground text-xs">
                          {s.createdBy}
                        </TableCell>
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
                        <TableCell className="text-sm">
                          {accountCell(w.salesforceAccountId)}
                        </TableCell>
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
        </div>
      </div>
    </Page>
  );
}
