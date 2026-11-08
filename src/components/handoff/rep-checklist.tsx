import { Check, X } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  checkAgain,
  closeDeal,
  decideApprovalAction,
  pretendFixed,
  requestApprovalAction,
} from '@/app/(shell)/handoff-actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { kleer, salesforce } from '@/lib/connectors';
import { formatDate } from '@/lib/format';
import { evaluateLive } from '@/lib/handoff/context';
import { hasDemoFix } from '@/lib/handoff/demo';
import { appToday, getHandoff } from '@/lib/handoff/store';
import { getPolicy } from '@/lib/policy/policy';
import { evaluateDeal, FIX } from '@/lib/policy/rules';
import { BuiltNote } from './built';

const CHECKS: [label: string, rules: string[]][] = [
  ['Amount is correct', ['R8', 'Lines']],
  ['Currency matches the account', ['Currency']],
  ['Payment method allowed', ['R2']],
  ['Billing details complete', ['R4']],
  ['VAT ID valid', ['VAT']],
  ['Purchase order present', ['R3']],
  ['Start date valid', ['Dates']],
  ['Discount approved', ['Discount']],
];

const WAITING_ON: Record<string, string> = {
  billing: 'Billing',
  credit: 'Credit Control',
  deal_desk: 'Deal Desk (approves discounts over 25%)',
};

/**
 * The rep's own checklist, on the Salesforce deal page. It tells the rep what
 * finance would stop on, in their words, and what has happened since the
 * deal was sent. In a real Salesforce this is a record-page component.
 */
export async function RepChecklist({ oppId }: { oppId: string }) {
  const { ctx, result } = await evaluateLive(oppId);
  const { opp, account } = ctx;
  const h = getHandoff(oppId);
  const policy = getPolicy();
  const closed = opp.StageName === 'Closed Won';

  const fails = result.findings.filter((f) => f.status === 'fail');
  // The PO comes from the customer through the rep, so it is the rep's to fill in.
  // Billing still tracks it in their queue, but the rep must be told clearly.
  const isRepsToFix = (f: (typeof fails)[number]) => f.owner === 'rep' || f.rule === 'R3';
  const repFails = fails.filter(isRepsToFix);
  const others = fails.filter((f) => !isRepsToFix(f));

  // What happened in billing, read live: the invoice may have been sent since
  let billing: string | null = null;
  // Where the deal is in finance's process, shown to the rep as a short strip
  let steps: { label: string; done: boolean; note?: string }[] | null = null;
  if (h?.status === 'processed') {
    if (h.invoiceNumber) {
      const invoice = await kleer.getInvoice(h.invoiceNumber);
      const sent = invoice.status !== 'draft';
      steps = [
        { label: 'Checked', done: true },
        { label: 'Invoice drafted', done: true, note: invoice.invoiceNumber },
        {
          label: sent ? 'Invoice sent to customer' : 'Invoice with finance to send',
          done: sent,
          note: sent && invoice.sentAt ? formatDate(invoice.sentAt) : undefined,
        },
        ...(sent
          ? [
              invoice.status === 'paid'
                ? { label: 'Paid', done: true, note: formatDate(invoice.paidAt) }
                : {
                    label: invoice.dueDate < appToday() ? 'Payment overdue' : 'Waiting for payment',
                    done: false,
                    note: `due ${formatDate(invoice.dueDate)}`,
                  },
            ]
          : []),
      ];
      billing = `Invoice ${invoice.invoiceNumber}, ${invoice.status === 'draft' ? 'with Billing for review' : invoice.status}`;
    } else if (h.stripeSubscriptionId) {
      billing = 'Card charged';
      steps = [
        { label: 'Checked', done: true },
        { label: 'Card charged', done: true },
      ];
    }
  }

  const owner = await salesforce.getUser(opp.OwnerId).catch(() => null);

  const status = !closed
    ? { label: 'Not closed yet', tone: 'bg-muted text-muted-foreground' }
    : h?.status === 'processed'
      ? { label: 'Processed', tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' }
      : repFails.length
        ? { label: 'Waiting on you', tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-400' }
        : others.length
          ? { label: 'With finance', tone: 'bg-secondary text-secondary-foreground' }
          : { label: 'Ready', tone: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' };

  // An open deal: what finance would stop on if it were closed right now
  const preview = closed
    ? null
    : evaluateDeal({ ...ctx, opp: { ...opp, StageName: 'Closed Won' } }, policy).findings.filter(
        (f) => f.status === 'fail',
      );

  // Once the deal is processed there is nothing to act on, so the card stays short and quiet.
  // The purple highlight is only for deals that need something.
  const done = closed && h?.status === 'processed';
  const Rest = ({ children }: { children: ReactNode }) =>
    done ? (
      <details className="rounded-lg border p-3 text-sm">
        <summary className="cursor-pointer text-muted-foreground">
          Show the checklist and messages
        </summary>
        <div className="mt-4 flex flex-col gap-4">{children}</div>
      </details>
    ) : (
      children
    );

  return (
    <Card className={closed && repFails.length > 0 ? 'ring-2 ring-violet-500/60' : undefined}>
      <CardContent className="flex flex-col gap-4">
        {done ? null : (
          <BuiltNote title="This one is for the sales rep.">
            It sits on the deal in Salesforce, because that’s where reps already work. It shows what
            finance needs from the deal, what the rep has to fix, and what finance did with it
            after. Reps don’t need the admin app, they just need to see what happened. In real
            Salesforce this would be a component on the Opportunity page.
          </BuiltNote>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-medium text-base">Rep self-QA checklist</h2>
            <p className="text-muted-foreground text-xs">
              {done
                ? `All checks passed. Workspace ${h?.workspaceId}, subscription ${h?.subscriptionId}${billing ? `, ${billing.toLowerCase()}` : ''}.`
                : `What finance needs from this deal before it can be billed.${owner ? ` Owner: ${owner.Name}.` : ''}`}
            </p>
          </div>
          <Badge className={status.tone}>{status.label}</Badge>
        </div>

        {steps ? (
          <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            {steps.map((s, i) => (
              <li key={s.label} className="flex items-center gap-2">
                {i > 0 ? <span className="text-muted-foreground">→</span> : null}
                <span
                  className={
                    s.done
                      ? 'flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400'
                      : 'flex items-center gap-1 text-amber-700 dark:text-amber-400'
                  }
                >
                  {s.done ? (
                    <Check className="size-4" />
                  ) : (
                    <span className="size-2 rounded-full bg-amber-500" />
                  )}
                  {s.label}
                  {s.note ? (
                    <span className="font-normal text-muted-foreground">{s.note}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        ) : null}

        <Rest>
          {!closed ? (
            <div className="flex flex-col gap-3 text-sm">
              <p className="text-muted-foreground">
                The check runs by itself when the deal is moved to Closed Won. Nothing is sent to
                finance before then.
              </p>
              <div className="rounded-lg border p-3">
                <p className="font-medium">If you closed it now, finance would stop on:</p>
                {preview && preview.length > 0 ? (
                  <ul className="mt-1 list-inside list-disc text-muted-foreground">
                    {preview.map((f) => (
                      <li key={f.rule}>{f.message}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-muted-foreground">
                    Nothing. It would go straight through.
                  </p>
                )}
              </div>
              <form action={closeDeal} className="flex flex-col items-start gap-1">
                <input type="hidden" name="oppId" value={oppId} />
                <Button type="submit" className="bg-violet-600 text-white hover:bg-violet-700">
                  Demo: move this deal to Closed Won
                </Button>
                <span className="text-muted-foreground text-xs">
                  Moves it even if nothing is filled in, so you can see what happens. In Salesforce
                  you’d change the stage and the event goes out by itself. Reset all systems on Dev
                  tools undoes it.
                </span>
              </form>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {CHECKS.filter(
                ([label]) =>
                  (label !== 'VAT ID valid' || account.VAT_Number__c) &&
                  (label !== 'Purchase order present' || account.PO_Required__c) &&
                  (label !== 'Discount approved' ||
                    (opp.Discount__c ?? 0) > policy.discountApprovalPct),
              ).map(([label, rules]) => {
                const bad = repFails.filter((f) => rules.includes(f.rule));
                if (bad.length === 0) {
                  return (
                    <li key={label} className="flex items-center gap-2 text-sm">
                      <Check className="size-4 text-emerald-600" />
                      {label}
                    </li>
                  );
                }
                return bad.map((f) => {
                  const fix = FIX[f.rule];
                  // "Missing for invoicing: billing email, VAT ID" becomes a short list
                  const missing =
                    f.rule === 'R4'
                      ? f.message
                          .replace('Missing for invoicing: ', '')
                          .replace(/\.$/, '')
                          .split(', ')
                      : null;
                  const inBilling = ['R4', 'VAT', 'R2', 'R3'].includes(f.rule);
                  return (
                    <li
                      key={f.rule}
                      className="rounded-lg border-2 border-amber-500 bg-amber-500/10 p-4 text-sm"
                    >
                      <div className="flex items-center gap-2 font-semibold text-base">
                        <X className="size-5 text-amber-600" />
                        {fix?.what ?? label}
                      </div>
                      {missing ? (
                        <ul className="mt-2 list-inside list-disc font-medium">
                          {missing.map((m) => (
                            <li key={m}>{m}</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 font-medium">{f.message}</p>
                      )}
                      {fix ? <p className="mt-2 text-muted-foreground">{fix.how}</p> : null}
                      {inBilling ? (
                        <a
                          href="#billing"
                          className="mt-2 inline-block font-medium text-violet-700 underline dark:text-violet-300"
                        >
                          Fill it in in the Billing section below
                        </a>
                      ) : null}
                    </li>
                  );
                });
              })}
            </ul>
          )}

          {closed && repFails.length > 0 && result.due ? (
            <p className="text-sm">
              {result.due < appToday() ? 'This was due ' : 'Please fix this by '}
              <strong>{formatDate(result.due)}</strong>. You get one Slack message when it is
              raised, and a reminder on the due date. The deal counts in the forecast, but finance
              cannot book it until this is fixed. If it is still open {policy.managerEscalationDays}{' '}
              days after close, {policy.salesManager} sees it in the weekly update.
            </p>
          ) : null}

          {others.length > 0 && closed ? (
            <div className="text-muted-foreground text-sm">
              <p className="font-medium text-foreground">With others, nothing for you to do</p>
              <ul className="mt-1 list-inside list-disc">
                {others.map((f) => (
                  <li key={f.rule}>
                    {f.rule === 'Discount'
                      ? 'Discount approval'
                      : f.rule === 'R3'
                        ? 'Purchase order'
                        : f.rule === 'Workspace'
                          ? 'Workspace match'
                          : f.rule === 'Payment'
                            ? 'Payment method on file'
                            : f.rule}
                    : {WAITING_ON[f.owner ?? 'billing'] ?? policy.queues.billing.name}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {closed && !done && fails.some((f) => f.rule === 'Discount') ? (
            <div className="rounded-lg border p-3 text-sm">
              {opp.Discount_Approval__c === 'Pending' ? (
                <div className="flex flex-col gap-2">
                  <p>
                    <strong>Approval requested</strong> in #deal-desk, with a link to this deal. You
                    get a Slack message when Deal Desk decides.
                  </p>
                  <form action={decideApprovalAction} className="flex flex-col items-start gap-1">
                    <input type="hidden" name="oppId" value={oppId} />
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        name="decision"
                        value="Approved"
                        size="sm"
                        className="bg-violet-600 text-white hover:bg-violet-700"
                      >
                        Demo: Deal Desk approves
                      </Button>
                      <Button
                        type="submit"
                        name="decision"
                        value="Rejected"
                        variant="outline"
                        size="sm"
                      >
                        Demo: Deal Desk rejects
                      </Button>
                    </div>
                    <span className="text-muted-foreground text-xs">
                      Deal Desk follows the link in #deal-desk and decides here. In Salesforce this
                      is the approval step on the record.
                    </span>
                  </form>
                </div>
              ) : (
                <form action={requestApprovalAction} className="flex flex-col items-start gap-1">
                  <input type="hidden" name="oppId" value={oppId} />
                  <Button type="submit" size="sm">
                    Request Deal Desk approval
                  </Button>
                  <span className="text-muted-foreground text-xs">
                    Sends the request to #deal-desk with this deal attached. Nothing to type or
                    copy.
                  </span>
                </form>
              )}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {closed ? (
              <form action={checkAgain}>
                <input type="hidden" name="oppId" value={oppId} />
                <Button type="submit" variant="outline" size="sm">
                  Check again
                </Button>
              </form>
            ) : null}
            {closed && h?.status === 'waiting_rep' && hasDemoFix(account.Name) ? (
              <form action={pretendFixed}>
                <input type="hidden" name="oppId" value={oppId} />
                <Button type="submit" variant="ghost" size="sm" title="Demo only">
                  Demo: pretend I fixed it in Salesforce
                </Button>
              </form>
            ) : null}
          </div>
        </Rest>
      </CardContent>
    </Card>
  );
}
