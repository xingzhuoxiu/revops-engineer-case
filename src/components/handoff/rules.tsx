import Link from 'next/link';
import { savePolicyAction } from '@/app/(shell)/handoff-actions';
import { Json } from '@/components/data/fields';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDateTime } from '@/lib/format';
import { getPolicy, getPolicyLog, type QueueId } from '@/lib/policy/policy';

const NUMBERS: [name: string, label: string, hint: string][] = [
  [
    'cardLimitEur',
    'Card limit (EUR)',
    'R2. Above this first-year amount, the deal must be invoiced.',
  ],
  [
    'discountApprovalPct',
    'Discount that needs Deal Desk approval (%)',
    'Above this, Deal Desk has to approve it before the deal is booked.',
  ],
  ['repDeadlineDays', 'Rep deadline (days after close)', 'How long a rep has to fix their part.'],
  [
    'managerEscalationDays',
    'Sales manager update after (days since close)',
    'A deal still waiting on its rep after this long is in the sales manager’s weekly update.',
  ],
  [
    'financeDeadlineDaysBeforeStart',
    'Finance deadline (days before start)',
    'When a finance item is due.',
  ],
  [
    'escalateDaysBeforeStart',
    'Escalate unsecured billing (days before start)',
    'Warn Billing and Customer Success if the invoice has not been sent by then.',
  ],
];

/** Finance's rules, as settings. Saved with a change log, so nothing changes silently. */
export function Rules() {
  const policy = getPolicy();
  const log = getPolicyLog();
  return (
    <div className="flex flex-col gap-6">
      <form action={savePolicyAction} className="flex flex-col gap-5">
        <div className="grid gap-4 md:grid-cols-2">
          {NUMBERS.map(([name, label, hint]) => (
            <div key={name} className="flex flex-col gap-1">
              <Label htmlFor={name}>{label}</Label>
              <Input
                id={name}
                name={name}
                type="number"
                min={0}
                defaultValue={String(policy[name as keyof typeof policy])}
              />
              <span className="text-muted-foreground text-xs">{hint}</span>
            </div>
          ))}
          <div className="flex flex-col gap-1">
            <Label htmlFor="salesManager">Sales manager (weekly update)</Label>
            <Input id="salesManager" name="salesManager" defaultValue={policy.salesManager} />
            <span className="text-muted-foreground text-xs">
              Gets one Slack message a week: closed deals not booked because the rep hasn’t fixed
              something, by rep, with the value. The case has no sales manager, so this is a
              placeholder. Use a name from Salesforce.
            </span>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="invoiceSendMode">Invoice sending</Label>
            <select
              id="invoiceSendMode"
              name="invoiceSendMode"
              defaultValue={policy.invoiceSendMode}
              className="h-8 rounded-lg border bg-background px-2 text-sm"
            >
              <option value="review">Billing previews and sends each invoice</option>
              <option value="auto">Send straight away</option>
            </select>
            <span className="text-muted-foreground text-xs">
              Kleer always creates a draft first. Card deals are charged directly.
            </span>
          </div>
        </div>

        <div className="border-t pt-4">
          <label className="flex items-center gap-2 font-medium text-sm">
            <input
              type="checkbox"
              name="poExceptionForExistingCustomers"
              defaultChecked={policy.poExceptionForExistingCustomers}
            />
            PO exception for existing customers (R3)
          </label>
          <p className="mt-2 text-muted-foreground text-xs">
            Relationship Managers want existing customers to be invoiced without a PO, and finance
            hasn’t decided yet. So for now it’s off: no PO, no invoice. If finance says yes, I
            wouldn’t make it a yes for every existing customer. I’d add conditions, like contract
            terms, credit score or payment history. This is a mock, so it’s only the switch.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {(Object.keys(policy.queues) as QueueId[]).map((id) => {
            const q = policy.queues[id];
            return (
              <div key={id} className="flex flex-col gap-2 border-t pt-4">
                <h3 className="font-medium text-sm">{q.name} queue</h3>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`${id}.owner`}>Owner</Label>
                    <Input id={`${id}.owner`} name={`${id}.owner`} defaultValue={q.owner} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`${id}.backup`}>Backup</Label>
                    <Input id={`${id}.backup`} name={`${id}.backup`} defaultValue={q.backup} />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name={`${id}.away`} defaultChecked={q.away} />
                  Owner is away, send to the backup
                </label>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2">
          <Button type="submit">Save</Button>
          <Link
            href="/admin-app?tab=rules"
            className="px-2.5 py-1 text-muted-foreground text-sm hover:text-foreground"
          >
            Discard
          </Link>
        </div>
      </form>

      <section className="flex flex-col gap-2">
        <h2 className="font-medium text-base">Change log</h2>
        {log.length === 0 ? (
          <p className="text-muted-foreground text-sm">No changes yet.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {log.map((c) => (
              <li key={`${c.at}${c.change}`}>
                <span className="text-muted-foreground">
                  {formatDateTime(c.at)}, {c.by}:
                </span>{' '}
                {c.change}
              </li>
            ))}
          </ul>
        )}
      </section>

      <details className="border-t pt-3 text-sm">
        <summary className="cursor-pointer">Rules as data</summary>
        <p className="my-2 text-muted-foreground text-xs">
          Same settings as above, as the system stores them. Nothing is hard-coded, so a change
          applies from the next deal.
        </p>
        <Json value={policy} />
      </details>
    </div>
  );
}
