import { ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { resetEverything, sendEvents } from '@/app/(shell)/dev/actions';
import { advanceAction } from '@/app/(shell)/handoff-actions';
import { BuiltNote, NewBadge } from '@/components/handoff/built';
import { Page, PageHeader, Section } from '@/components/shell/page';
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
import { readState } from '@/lib/handoff/store';

export const metadata: Metadata = { title: 'Closed Won hand-off' };

/** Everything that was built, where to find it, and what it would be in the real thing. */
const CHANGES: { where: string; what: string; real: string; href: string }[] = [
  {
    where: 'Salesforce > Deals',
    what: 'A Hand-off column, and filters by owner and status.',
    real: 'Salesforce already has list views to filter by rep. Hand-off would be a field on the deal.',
    href: '/deals',
  },
  {
    where: 'Salesforce > a deal',
    what: 'The rep’s checklist: what’s wrong or missing, what finance did with the deal, and a way to message finance.',
    real: 'A component on the Opportunity page in Salesforce.',
    href: '/deals',
  },
  {
    where: 'The webhook',
    what: 'When a deal is moved to Closed Won it checks the deal against finance’s rules. Clean deals get the workspace, subscription and invoice or charge set up. Anything else goes to whoever has to fix it.',
    real: 'A Salesforce Flow that calls a small service. There is no screen for this part.',
    href: '/dev',
  },
  {
    where: 'Admin app > Ready to bill',
    what: 'Every deal Salesforce sent, what was set up, and the invoice to preview and send.',
    real: 'A page in the admin app.',
    href: '/admin-app?tab=ready',
  },
  {
    where: 'Admin app > Exceptions',
    what: 'Everything that’s stuck and needs a person, with who handles it and by when.',
    real: 'A queue in the admin app. The talking stays in Slack.',
    href: '/admin-app?tab=exceptions',
  },
  {
    where: 'Admin app > Rules',
    what: 'Finance’s rules as settings they can change, with a log of who changed what.',
    real: 'A settings page owned by finance, so a rule change doesn’t need a developer.',
    href: '/admin-app?tab=rules',
  },
  {
    where: 'Slack',
    what: 'Reps get one message a day, not one per deal. Messages about a deal are linked to that deal.',
    real: 'A Slack app with permission to post and read.',
    href: '/slack',
  },
];

export default function ClosedWonHandoffPage() {
  const all = Object.values(readState().handoffs);
  const count = (s: string) => all.filter((h) => h.status === s).length;
  const stats = [
    { label: 'Set up automatically', value: count('processed'), href: '/admin-app?tab=ready' },
    {
      label: 'Waiting on the rep',
      value: count('waiting_rep'),
      href: '/deals?handoff=waiting_rep',
    },
    { label: 'With finance', value: count('waiting_finance'), href: '/admin-app?tab=exceptions' },
    { label: 'Ignored (not Closed Won)', value: count('ignored'), href: '/deals?handoff=ignored' },
  ];

  return (
    <Page>
      <PageHeader
        title="Closed Won hand-off"
        description="What I built for this case, and where to find it."
      />
      <BuiltNote title="How to read this app.">
        Everything I added is purple, with a <NewBadge /> or <NewBadge label="Updated" /> tag.
        Anything without a tag is the original MentOS. This is a mock, so the notes are there to say
        what each part would be in the real Salesforce or admin app.
      </BuiltNote>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="flex flex-col gap-2 text-sm">
            <h2 className="font-medium text-base">Before</h2>
            <p className="text-muted-foreground">
              A deal is moved to Closed Won. Then someone copies it by hand into the admin app, and
              again into Kleer or Stripe. Mistakes show up after the customer has been billed, and
              the rep asks in Slack what happened.
            </p>
          </CardContent>
        </Card>
        <Card className="ring-2 ring-violet-500/60">
          <CardContent className="flex flex-col gap-2 text-sm">
            <h2 className="font-medium text-base">After</h2>
            <p className="text-muted-foreground">
              The moment a deal is moved to Closed Won, the system checks it. Clean deals are set up
              for finance automatically. Problems go to whoever owns them, with a deadline. The rep
              sees the status on the deal and doesn’t need to ask.
            </p>
          </CardContent>
        </Card>
      </div>

      <Section title="This week’s deals">
        {all.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-violet-500/50 p-6">
            <p className="text-sm">
              Nothing has been sent yet. Salesforce sends a deal when it’s moved to Closed Won. This
              button sends all of this week’s deals, the way Salesforce would.
            </p>
            <form action={sendEvents}>
              <input type="hidden" name="mode" value="all" />
              <Button type="submit" className="bg-violet-600 text-white hover:bg-violet-700">
                Send this week’s deals from Salesforce
              </Button>
            </form>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {stats.map((s) => (
              <Link
                key={s.label}
                href={s.href}
                className="group rounded-xl border border-violet-500/30 bg-violet-500/5 p-4 transition-colors hover:bg-violet-500/10"
              >
                <div className="text-muted-foreground text-xs">{s.label}</div>
                <div className="font-semibold text-3xl tabular-nums">{s.value}</div>
                <div className="mt-1 flex items-center gap-1 text-violet-700 text-xs dark:text-violet-300">
                  Open <ArrowRight className="size-3" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </Section>

      <Section title="What I changed">
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-52">Where</TableHead>
                <TableHead>What I added</TableHead>
                <TableHead>In the real environment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {CHANGES.map((c) => (
                <TableRow key={c.where}>
                  <TableCell className="align-top">
                    <Link
                      href={c.href}
                      className="font-medium text-sm text-violet-700 hover:underline dark:text-violet-300"
                    >
                      {c.where}
                    </Link>
                  </TableCell>
                  <TableCell className="whitespace-normal align-top text-sm">{c.what}</TableCell>
                  <TableCell className="whitespace-normal align-top text-muted-foreground text-sm">
                    {c.real}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Section>

      <Section title="Try it">
        <ol className="list-inside list-decimal space-y-1 text-sm">
          <li>Send this week’s deals (the button above, or on Dev tools).</li>
          <li>
            Go to{' '}
            <Link
              href="/admin-app?tab=ready"
              className="text-violet-700 hover:underline dark:text-violet-300"
            >
              Admin app, Ready to bill
            </Link>
            , open Fjordline, preview the invoice and send it.
          </li>
          <li>Open a deal like Corvid Analytics under Deals to see the rep’s checklist.</li>
          <li>
            Change a limit on the{' '}
            <Link
              href="/admin-app?tab=rules"
              className="text-violet-700 hover:underline dark:text-violet-300"
            >
              Rules
            </Link>{' '}
            tab, save, and check the log.
          </li>
        </ol>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border p-3">
          <span className="text-muted-foreground text-xs">Demo controls</span>
          <form action={sendEvents}>
            <input type="hidden" name="mode" value="all" />
            <Button type="submit" variant="outline" size="sm">
              Send remaining deals
            </Button>
          </form>
          <form action={advanceAction}>
            <input type="hidden" name="days" value="7" />
            <Button type="submit" variant="outline" size="sm">
              Demo: +7 days
            </Button>
          </form>
          <form action={resetEverything}>
            <Button type="submit" variant="outline" size="sm">
              Reset all systems
            </Button>
          </form>
        </div>
      </Section>
    </Page>
  );
}
