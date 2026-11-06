import type { Metadata } from 'next';
import Link from 'next/link';
import { DealsTable, HANDOFF_LABEL, HandoffLegend } from '@/components/data/deals-table';
import { TabsNav } from '@/components/data/tabs-nav';
import { BuiltNote } from '@/components/handoff/built';
import { Page, PageHeader } from '@/components/shell/page';
import { salesforce } from '@/lib/connectors';
import { CASE_WEEK_START } from '@/lib/format';
import { readState } from '@/lib/handoff/store';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Deals' };

const text = (v: string | string[] | undefined) => (typeof v === 'string' ? v : undefined);

export default async function DealsPage(props: PageProps<'/deals'>) {
  const params = await props.searchParams;
  const view = text(params.view);
  const rep = text(params.rep);
  const handoff = text(params.handoff);
  const active = view === 'all' ? 'all' : view === 'open' ? 'open' : 'won';
  const [opportunities, accounts, users] = await Promise.all([
    salesforce.listOpportunities(),
    salesforce.listAccounts(),
    salesforce.listUsers(),
  ]);
  const handoffs = readState().handoffs;
  const won = opportunities.filter(
    (o) => o.StageName === 'Closed Won' && o.CloseDate >= CASE_WEEK_START,
  );
  // The mock doesn't flip IsClosed when the stage changes, so a deal moved to Closed Won is not open
  const open = opportunities.filter((o) => !o.IsClosed && o.StageName !== 'Closed Won');
  const inView = active === 'won' ? won : active === 'open' ? open : opportunities;
  const statusOf = (id: string) => handoffs[id]?.status ?? 'not_sent';
  const search = text(params.q)?.trim() ?? '';
  const needle = search.toLowerCase();
  const accountName = (id: string) => accounts.find((a) => a.Id === id)?.Name ?? '';
  const shown = inView
    .filter(
      (o) =>
        (!rep || o.OwnerId === rep) &&
        (!handoff || statusOf(o.Id) === handoff) &&
        (!needle ||
          o.Name.toLowerCase().includes(needle) ||
          accountName(o.AccountId).toLowerCase().includes(needle)),
    )
    .sort((a, b) => b.CloseDate.localeCompare(a.CloseDate));

  // Filters keep each other, the search and the selected tab
  const href = (next: { rep?: string; handoff?: string; q?: string }) => {
    const q = new URLSearchParams();
    if (view) q.set('view', view);
    const r = 'rep' in next ? next.rep : rep;
    const h = 'handoff' in next ? next.handoff : handoff;
    if (r) q.set('rep', r);
    if (h) q.set('handoff', h);
    const s = 'q' in next ? next.q : search;
    if (s) q.set('q', s);
    return `/deals${q.size ? `?${q}` : ''}`;
  };
  const owners = [...new Set(inView.map((o) => o.OwnerId))]
    .map((id) => ({ id, name: users.find((u) => u.Id === id)?.Name ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <Page>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded bg-[#fcb95b] font-bold text-[10px] text-white">
              $
            </span>
            Opportunities
          </span>
        }
        title="Recently viewed"
        description="Opportunities in Salesforce."
      />
      <TabsNav
        active={active}
        tabs={[
          { id: 'won', label: 'Closed Won this week', href: '/deals', count: won.length },
          { id: 'open', label: 'Open', href: '/deals?view=open', count: open.length },
          { id: 'all', label: 'All', href: '/deals?view=all', count: opportunities.length },
        ]}
      />
      <form action="/deals" className="flex items-center gap-2">
        {view ? <input type="hidden" name="view" value={view} /> : null}
        {rep ? <input type="hidden" name="rep" value={rep} /> : null}
        {handoff ? <input type="hidden" name="handoff" value={handoff} /> : null}
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Search deals by name"
          className="h-9 w-full max-w-sm rounded-md border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/40"
        />
        <button
          type="submit"
          className="h-9 rounded-md bg-primary px-3 font-medium text-primary-foreground text-sm"
        >
          Search
        </button>
        {search ? (
          <Link href={href({ q: undefined })} className="text-muted-foreground text-sm hover:underline">
            Clear
          </Link>
        ) : null}
      </form>
      <div className="flex flex-col gap-3 rounded-lg border border-violet-500/30 bg-violet-500/5 p-3">
        <BuiltNote title="What I added here.">
          The Hand-off column, and the filters by owner and status. Real Salesforce already lets you
          filter deals by rep with list views, so that part isn’t new. I added it so you can see
          each rep’s deals in this mock. The Hand-off status is the new part: in the real thing it’s
          a field on the deal that the integration fills in.
        </BuiltNote>
        <Filter label="Owner">
          <Chip href={href({ rep: undefined })} on={!rep}>
            All
          </Chip>
          {owners.map((o) => (
            <Chip key={o.id} href={href({ rep: o.id })} on={rep === o.id}>
              {o.name}
            </Chip>
          ))}
        </Filter>
        <Filter label="Hand-off">
          <Chip href={href({ handoff: undefined })} on={!handoff}>
            All
          </Chip>
          {Object.entries(HANDOFF_LABEL).map(([key, label]) => (
            <Chip key={key} href={href({ handoff: key })} on={handoff === key}>
              {label}
            </Chip>
          ))}
        </Filter>
      </div>
      <HandoffLegend />
      <DealsTable opportunities={shown} accounts={accounts} users={users} />
    </Page>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      <span className="w-16 text-muted-foreground text-xs">{label}</span>
      {children}
    </div>
  );
}

function Chip({ href, on, children }: { href: string; on: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
        on ? 'border-violet-600 bg-violet-600 text-white' : 'hover:bg-violet-500/10',
      )}
    >
      {children}
    </Link>
  );
}
