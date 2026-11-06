import { ArrowRight, BookOpen, Sparkles, Wrench } from 'lucide-react';
import Link from 'next/link';
import { DealsTable } from '@/components/data/deals-table';
import { Page, PageHeader, Section } from '@/components/shell/page';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { salesforce, slack } from '@/lib/connectors';
import { CASE_WEEK_START, formatDateTime } from '@/lib/format';
import { slackText } from '@/lib/slack-text';

export default async function HomePage() {
  const [opportunities, accounts, users, feed, channels, slackUsers] = await Promise.all([
    salesforce.listOpportunities({ closedAfter: CASE_WEEK_START }),
    salesforce.listAccounts(),
    salesforce.listUsers(),
    salesforce.listEvents(),
    slack.listChannels(),
    slack.listUsers(),
  ]);
  const won = opportunities
    .filter((o) => o.StageName === 'Closed Won')
    .sort((a, b) => a.CloseDate.localeCompare(b.CloseDate));
  const finance = channels.find((c) => c.name === 'finance-billing');
  const recent = finance ? (await slack.history(finance.id)).slice(0, 4) : [];

  const stats = [
    { label: 'Closed Won this week', value: won.length },
    { label: 'Without a subscription', value: won.filter((o) => !o.Subscription_ID__c).length },
    {
      label: 'Invoice deals not invoiced',
      value: won.filter((o) => o.Payment_Method__c === 'Invoice' && !o.Invoice_Number__c).length,
    },
    { label: 'Salesforce events', value: feed.latestReplayId },
  ];

  return (
    <Page>
      <PageHeader
        title="Home"
        description="It's Friday 6 November. These deals closed this week, and nobody has set them up yet."
      />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label} size="sm">
            <CardHeader>
              <CardDescription>{stat.label}</CardDescription>
              <div className="font-semibold text-3xl tabular-nums">{stat.value}</div>
            </CardHeader>
          </Card>
        ))}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Start here</CardTitle>
            <CardDescription>
              This app is yours. Build whatever you think fixes the Closed Won hand-off.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-3">
            {[
              {
                href: '/your-app',
                icon: Sparkles,
                label: 'Closed Won hand-off',
                hint: 'What I built, start here',
              },
              {
                href: '/deals',
                icon: BookOpen,
                label: 'This week’s deals',
                hint: 'What Salesforce holds',
              },
              {
                href: '/dev',
                icon: Wrench,
                label: 'Dev tools',
                hint: 'Events, request log, reset',
              },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group flex flex-col gap-1 rounded-lg border p-3 transition-colors hover:bg-muted"
              >
                <item.icon className="size-4 text-primary" />
                <span className="flex items-center gap-1 font-medium text-sm">
                  {item.label}
                  <ArrowRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
                </span>
                <span className="text-muted-foreground text-xs">{item.hint}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>#finance-billing</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {recent.map((m) => (
              <div key={m.ts} className="text-sm">
                <div className="text-muted-foreground text-xs">
                  <span className="font-medium text-foreground">
                    {slackUsers.find((u) => u.id === m.user)?.real_name ?? 'Your app'}
                  </span>{' '}
                  {formatDateTime(m.postedAt)}
                </div>
                <p className="line-clamp-3">{slackText(m.text, slackUsers)}</p>
              </div>
            ))}
            <Link
              href={`/slack?channel=${finance?.id ?? ''}`}
              className="text-primary text-sm hover:underline"
            >
              Open in Slack
            </Link>
          </CardContent>
        </Card>
      </div>

      <Section title="Closed Won this week" count={won.length}>
        <DealsTable opportunities={won} accounts={accounts} users={users} />
      </Section>
    </Page>
  );
}
