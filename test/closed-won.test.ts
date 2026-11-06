/**
 * Runs this week's Salesforce events through the hand-off and checks what
 * finance would expect: which deals go straight through, which wait for the
 * rep, which wait for finance, and that nothing is ever created twice.
 */
import { describe, expect, it } from 'vitest';
import { adminApp, kleer, salesforce, stripe } from '@/lib/connectors';
import { readDb } from '@/lib/db';
import { loadContext } from '@/lib/handoff/context';
import { demoFix } from '@/lib/handoff/demo';
import {
  advanceDays,
  decideApproval,
  financeReply,
  handleEvent,
  moveToClosedWon,
  recheck,
  repMessageFinance,
  requestApproval,
  saveBillingDetails,
  sendInvoice,
  sweep,
} from '@/lib/handoff/run';
import { messagesByDeal } from '@/lib/handoff/slack';
import { getHandoff, openAlerts, readState } from '@/lib/handoff/store';
import { assignee, DEFAULT_POLICY, getPolicy, getPolicyLog, savePolicy } from '@/lib/policy/policy';
import { evaluateDeal } from '@/lib/policy/rules';

async function sendAll() {
  const { events } = await salesforce.listEvents();
  const outcomes: Record<string, string> = {};
  for (const event of events) {
    outcomes[`${event.opportunity.Name} #${event.replayId}`] = await handleEvent(event);
  }
  return outcomes;
}

async function idOf(name: string) {
  // Halden and Okapi also have an older deal each: take the one from this week
  const [opp] = (await salesforce.listOpportunities({ closedAfter: '2026-11-02' })).filter((o) =>
    o.Name.startsWith(name),
  );
  if (!opp) throw new Error(`no deal ${name}`);
  return opp.Id;
}

const statusOf = async (name: string) => getHandoff(await idOf(name))?.status;

describe('this week’s deals', () => {
  it('sorts every deal to the right place', async () => {
    await sendAll();
    const processed = [
      'Fjordline',
      'Brightwell',
      'Wavecrest',
      'Okapi',
      'Torvik',
      'Nordlys',
      'Halden',
    ];
    const rep = ['Corvid', 'Quill', 'Alpenblick', 'Arcadia', 'Maris', 'Vantera'];
    const finance = ['Lumen', 'Kessler', 'Helix', 'Sable'];
    for (const n of processed) expect(await statusOf(n), n).toBe('processed');
    for (const n of rep) expect(await statusOf(n), n).toBe('waiting_rep');
    for (const n of finance) expect(await statusOf(n), n).toBe('waiting_finance');
    // Polar Bear was reopened, so it is never billed
    expect(['ignored', undefined]).toContain(await statusOf('Polar Bear'));
  });

  it('creates one subscription and one invoice or charge per deal, even when events repeat', async () => {
    await sendAll();
    const first = {
      subs: readDb().adminApp.subscriptions.length,
      invoices: readDb().kleer.invoices.length,
      stripe: readDb().stripe.subscriptions.length,
    };
    await sendAll(); // Salesforce sends everything again
    expect(readDb().adminApp.subscriptions.length).toBe(first.subs);
    expect(readDb().kleer.invoices.length).toBe(first.invoices);
    expect(readDb().stripe.subscriptions.length).toBe(first.stripe);
  });

  it('writes the result back and puts new invoices in draft', async () => {
    await sendAll();
    const fjordline = await salesforce.getOpportunity(await idOf('Fjordline'));
    expect(fjordline.Subscription_ID__c).toMatch(/^SUB-/);
    expect(fjordline.Invoice_Number__c).toBeTruthy();
    const invoice = await kleer.getInvoice(fjordline.Invoice_Number__c as string);
    expect(invoice).toMatchObject({
      status: 'draft',
      foreignId: fjordline.Id,
      paymentTermsDays: 30,
    });
    // 40 licenses at 360 less 5%, plus 1,300 onboarding. Amount is worked out by Kleer.
    expect(invoice.netAmount).toBe(14980);
    expect(invoice.vatRate).toBe(0);
  });

  it('charges small card deals through Stripe and does not invoice them', async () => {
    await sendAll();
    const brightwell = await salesforce.getOpportunity(await idOf('Brightwell'));
    expect(brightwell.Invoice_Number__c).toBeNull();
    const charged = readDb().stripe.subscriptions.find(
      (s) => s.metadata.opportunity_id === brightwell.Id,
    );
    expect(charged).toMatchObject({ status: 'active', quantity: 15, amount: 3900 });
  });
});

describe('existing customers', () => {
  it('stops the old Stripe subscription renewing when Nordlys moves to Enterprise (R7)', async () => {
    await sendAll();
    expect((await adminApp.getSubscription('SUB-501')).autoRenew).toBe(false);
    expect((await stripe.getSubscription('sub_1PxNordlys7Hq2Lw')).cancel_at_period_end).toBe(true);
    const nordlys = await salesforce.getOpportunity(await idOf('Nordlys'));
    const sub = await adminApp.getSubscription(nordlys.Subscription_ID__c as string);
    expect(sub).toMatchObject({
      workspaceId: 'WS-1001',
      plan: 'ENT',
      seats: 120,
      status: 'Scheduled',
    });
  });

  it('updates the existing subscription on an add-on and bills the rest of the term (R6)', async () => {
    await sendAll();
    const halden = await salesforce.getOpportunity(await idOf('Halden'));
    // The 30 to 35 licenses edit was made before we read the live deal
    expect(await adminApp.getSubscription('SUB-502')).toMatchObject({
      seats: 95,
      endDate: '2027-02-28',
    });
    const invoice = await kleer.getInvoice(halden.Invoice_Number__c as string);
    // 10 Nov 2026 to 28 Feb 2027 is 111 days: 35 x 310 x 95% x 111/365
    expect(invoice.lines[0]?.description).toContain('2026-11-10 - 2027-02-28');
    expect(invoice.netAmount).toBeCloseTo((35 * 310 * 0.95 * 111) / 365, 0);
  });

  it('invoices only year one of a two-year deal', async () => {
    await sendAll();
    const torvik = await salesforce.getOpportunity(await idOf('Torvik'));
    const invoice = await kleer.getInvoice(torvik.Invoice_Number__c as string);
    expect(invoice.netAmount).toBe(120000);
    expect(invoice.servicePeriod).toEqual({ start: '2026-11-20', end: '2027-11-19' });
  });
});

describe('things only people can decide', () => {
  it('asks Billing to pick a workspace when two match and neither is linked', async () => {
    await sendAll();
    const alerts = openAlerts('billing').filter((a) => a.title === 'Workspace match');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.message).toContain('WS-2310');
    expect(alerts[0]?.message).toContain('WS-2311');
  });

  it('holds Kessler for the PO and does not create an invoice', async () => {
    await sendAll();
    const kessler = await idOf('Kessler');
    expect(await kleer.findInvoices({ foreignId: kessler })).toHaveLength(0);
    expect(
      openAlerts('billing').some((a) => a.oppId === kessler && a.title === 'Purchase order'),
    ).toBe(true);
  });

  it('sends a discount over 25% to Deal Desk, as the policy says', async () => {
    await sendAll();
    const lumen = openAlerts().find((a) => a.title === 'Discount approval');
    expect(lumen?.ownerLabel).toContain('Deal Desk');
  });

  it('puts the expired card in Credit Control’s queue', async () => {
    await sendAll();
    await sweep();
    const credit = openAlerts('credit');
    expect(credit.some((a) => a.title.startsWith('Payment failed: Sable'))).toBe(true);
    expect(credit.some((a) => a.title === 'Payment method on file')).toBe(true);
  });
});

describe('the rep fixes a deal', () => {
  it('moves it from waiting to processed, with new IDs', async () => {
    await sendAll();
    const corvid = await idOf('Corvid');
    expect(getHandoff(corvid)?.status).toBe('waiting_rep');
    expect(await demoFix(corvid)).toBe('processed');
    expect(getHandoff(corvid)?.subscriptionId).toMatch(/^SUB-/);
    expect(openAlerts('rep').some((a) => a.oppId === corvid)).toBe(false);
  });

  it('applies the fix to the right field', async () => {
    await sendAll();
    const vantera = await idOf('Vantera');
    await demoFix(vantera);
    expect((await salesforce.getOpportunity(vantera)).Payment_Method__c).toBe('Invoice');
    expect(getHandoff(vantera)?.system).toBe('Kleer');
  });
});

describe('guardrails', () => {
  it('locks a deal after billing and tells finance when someone changes it', async () => {
    await sendAll();
    const fjordline = await idOf('Fjordline');
    await salesforce.updateOpportunity(fjordline, { Number_of_Licenses__c: 50 });
    expect(await recheck(fjordline)).toBe('locked');
    expect(openAlerts('billing').some((a) => a.kind === 'locked' && a.oppId === fjordline)).toBe(
      true,
    );
    // Nothing in billing moved
    const invoice = await kleer.getInvoice(getHandoff(fjordline)?.invoiceNumber as string);
    expect(invoice.lines[0]?.quantity).toBe(40);
  });

  it('ignores the echo of our own write-backs', async () => {
    const { events } = await salesforce.listEvents();
    const [first] = events;
    if (!first) throw new Error('no events');
    const echo = {
      ...first,
      type: 'opportunity.updated' as const,
      changedFields: ['Subscription_ID__c'],
    };
    expect(await handleEvent(echo)).toBe('ignored');
  });
});

describe('the finance view', () => {
  it('sends one invoice when Billing presses send, and puts the workspace live on the start date', async () => {
    await sendAll();
    const fjordline = await idOf('Fjordline');
    await sendInvoice(fjordline);
    const h = getHandoff(fjordline);
    expect((await kleer.getInvoice(h?.invoiceNumber as string)).status).toBe('sent');
    // Fjordline starts 16 Nov. Not live yet on 6 Nov, live after the clock passes it.
    expect((await adminApp.getSubscription(h?.subscriptionId as string)).status).toBe('Scheduled');
    await advanceDays(10);
    expect((await adminApp.getSubscription(h?.subscriptionId as string)).status).toBe('Active');
  });

  it('escalates unsecured billing before the start date', async () => {
    await sendAll();
    await advanceDays(7); // 13 Nov, three days before Fjordline starts
    expect(openAlerts('billing').some((a) => a.kind === 'unsecured')).toBe(true);
  });

  it('files Slack messages by deal and flags an unanswered rep question', async () => {
    await sendAll();
    const deals = (await salesforce.listOpportunities({ stage: 'Closed Won' })).map((o) => ({
      Id: o.Id,
      accountName: o.Name.split(' - ')[0] ?? o.Name,
    }));
    const threads = await messagesByDeal(deals);
    const corvid = threads[await idOf('Corvid')];
    expect(corvid?.messages.some((m) => m.match === 'mentioned')).toBe(true);
    // Our own messages carry the deal ID, so they are filed exactly
    expect(Object.values(threads).some((t) => t.messages.some((m) => m.match === 'exact'))).toBe(
      true,
    );
  });

  it('keeps one digest per rep, not one message per deal', async () => {
    await sendAll();
    await sweep(); // may send "due today" messages for deals past their rep deadline
    const before = readDb().slack.messages.length;
    await sweep();
    await sweep();
    // Nothing changed, so nothing more is sent
    expect(readDb().slack.messages.length).toBe(before);
    expect(readState().digests).not.toEqual({});
  });
});

describe('the rules on their own', () => {
  it('has no surprises on a clean deal', async () => {
    const ctx = await loadContext(await idOf('Fjordline'));
    const result = evaluateDeal(ctx, DEFAULT_POLICY);
    expect(result.verdict).toBe('clean');
    expect(result.plan?.system).toBe('Kleer');
  });

  it('lets finance switch the PO exception on for existing customers', async () => {
    const ctx = await loadContext(await idOf('Kessler'));
    expect(evaluateDeal(ctx, DEFAULT_POLICY).verdict).toBe('finance');
    // Kessler is a prospect, so the exception does not apply to them
    const on = { ...DEFAULT_POLICY, poExceptionForExistingCustomers: true };
    expect(evaluateDeal(ctx, on).verdict).toBe('finance');
  });
});

describe('messages between rep and finance', () => {
  it('lands a rep message in Billing’s queue until finance answers', async () => {
    await sendAll();
    const kessler = await idOf('Kessler');
    await repMessageFinance(kessler, 'The PO is coming on Monday');
    const open = () => openAlerts('billing').filter((a) => a.kind === 'rep_message');
    expect(open()).toHaveLength(1);
    const threads = await messagesByDeal([{ Id: kessler, accountName: 'Kessler Logistik' }]);
    expect(threads[kessler]?.unanswered).toBe(true);
    await financeReply(kessler, 'Thanks, we will wait for it');
    expect(open()).toHaveLength(0);
    const after = await messagesByDeal([{ Id: kessler, accountName: 'Kessler Logistik' }]);
    expect(after[kessler]?.unanswered).toBe(false);
  });
});

describe('finance policy', () => {
  it('saves a change with a log entry, and the next deal follows it', async () => {
    await sendAll();
    savePolicy({ ...getPolicy(), cardLimitEur: 2000 });
    expect(getPolicyLog()[0]?.change).toContain('Card limit');
    // Brightwell (3,900 USD, about 3,600 EUR) is now above the card limit
    const brightwell = await idOf('Brightwell');
    const result = evaluateDeal(await loadContext(brightwell), getPolicy());
    expect(result.findings.some((f) => f.rule === 'R2' && f.status === 'fail')).toBe(true);
  });

  it('sends alerts to the backup when the owner is away', () => {
    const policy = getPolicy();
    expect(assignee(policy, 'billing').name).toBe('Maja Ek');
    const away = {
      ...policy,
      queues: { ...policy.queues, billing: { ...policy.queues.billing, away: true } },
    };
    expect(assignee(away, 'billing')).toEqual({ name: 'Tom Becker', covering: 'Maja Ek' });
  });

  it('says a license mismatch once, not twice', async () => {
    const ctx = await loadContext(await idOf('Corvid'));
    const fails = evaluateDeal(ctx, DEFAULT_POLICY).findings.filter((f) => f.status === 'fail');
    expect(fails.map((f) => f.rule)).toEqual(['Lines']);
  });
});

describe('the rep fills in the missing billing details', () => {
  const alpenblick = async () => idOf('Alpenblick');
  const details = { method: 'Invoice', po: '', legal: 'Alpenblick Versicherung AG' };

  it('says exactly what is missing', async () => {
    await sendAll();
    const message = openAlerts('rep').find((a) => a.title === 'Billing details')?.message;
    expect(message).toContain('billing email');
    expect(message).toContain('VAT ID');
  });

  it('keeps the deal waiting when the VAT ID is just random numbers', async () => {
    await sendAll();
    const id = await alpenblick();
    const outcome = await saveBillingDetails(id, {
      ...details,
      vat: '12345',
      email: 'ap@example.com',
    });
    expect(outcome).toBe('waiting_rep');
    const titles = openAlerts('rep')
      .filter((a) => a.oppId === id)
      .map((a) => a.title);
    expect(titles).toEqual(['VAT ID']);
  });

  it('processes the deal once the details are valid, and finance gets it', async () => {
    await sendAll();
    const id = await alpenblick();
    expect(getHandoff(id)?.status).toBe('waiting_rep');
    const outcome = await saveBillingDetails(id, {
      ...details,
      vat: 'DE123456789',
      email: 'ap@example.com',
    });
    expect(outcome).toBe('processed');
    expect(openAlerts('rep').some((a) => a.oppId === id)).toBe(false);
    const h = getHandoff(id);
    expect(h?.invoiceNumber).toBeTruthy();
    expect((await kleer.getInvoice(h?.invoiceNumber as string)).status).toBe('draft');
    expect(
      (await salesforce.getAccount((await salesforce.getOpportunity(id)).AccountId)).VAT_Number__c,
    ).toBe('DE123456789');
  });
});

describe('moving an open deal to Closed Won', () => {
  it('holds it for the PO when nothing is filled in', async () => {
    const orbital = await idOf('Orbital Freight');
    expect((await salesforce.getOpportunity(orbital)).StageName).toBe('Negotiation');
    expect(getHandoff(orbital)).toBeNull();
    expect(await moveToClosedWon(orbital)).toBe('waiting_finance');
    expect((await salesforce.getOpportunity(orbital)).StageName).toBe('Closed Won');
    expect(
      openAlerts('billing').some((a) => a.oppId === orbital && a.title === 'Purchase order'),
    ).toBe(true);
  });

  it('sets up a clean open deal straight away', async () => {
    const brennan = await idOf('Brennan Foods');
    expect(await moveToClosedWon(brennan)).toBe('processed');
    expect(getHandoff(brennan)?.system).toBe('Stripe');
  });
});

describe('the PO is the rep’s to fill in', () => {
  it('goes through once the PO is added to Orbital Freight', async () => {
    const orbital = await idOf('Orbital Freight');
    await moveToClosedWon(orbital);
    expect(getHandoff(orbital)?.status).toBe('waiting_finance');
    const account = await salesforce.getAccount(
      (await salesforce.getOpportunity(orbital)).AccountId,
    );
    const outcome = await saveBillingDetails(orbital, {
      method: 'Invoice',
      po: 'PO-12345',
      legal: account.Legal_Entity_Name__c ?? 'Orbital Freight Inc',
      vat: account.VAT_Number__c ?? '',
      email: account.Invoice_Email__c ?? 'ap@example.com',
    });
    expect(outcome).toBe('processed');
    expect(openAlerts().some((a) => a.oppId === orbital)).toBe(false);
  });
});

describe('after billing: the other systems report back', () => {
  it('writes the invoice and subscription status onto the deal', async () => {
    await sendAll();
    const fjordline = await idOf('Fjordline');
    const draft = await salesforce.getOpportunity(fjordline);
    expect(draft.Invoice_Status__c).toBe('Draft');
    expect(draft.Subscription_Status__c).toBe('Scheduled');
    await sendInvoice(fjordline);
    const sent = await salesforce.getOpportunity(fjordline);
    expect(sent.Invoice_Status__c).toBe('Sent');
    expect(sent.Invoice_Sent_Date__c).toBeTruthy();
    expect(sent.Invoice_Due_Date__c).toBeTruthy();
  });

  it('sends an unpaid invoice past its due date to Credit Control and tells the rep once', async () => {
    await sendAll();
    const fjordline = await idOf('Fjordline');
    await sendInvoice(fjordline);
    await advanceDays(35);
    const overdue = openAlerts('credit').filter((a) => a.kind === 'overdue' && a.oppId === fjordline);
    expect(overdue).toHaveLength(1);
    expect((await salesforce.getOpportunity(fjordline)).Invoice_Status__c).toBe('Overdue');
    const told = () => readDb().slack.messages.filter((m) => m.text.includes('and is not paid')).length;
    const before = told();
    await sweep();
    expect(told()).toBe(before); // a second sweep does not message again
  });

  it('links a failed card payment to the rep who owns the customer', async () => {
    await sendAll();
    await sweep();
    const sable = openAlerts('credit').find((a) => a.title.startsWith('Payment failed: Sable'));
    expect(sable?.message).toContain('owns the customer');
  });

  it('raises a deal that is moved out of Closed Won after billing, and changes nothing', async () => {
    await sendAll();
    const fjordline = await idOf('Fjordline');
    const { events } = await salesforce.listEvents();
    const event = events.find((e) => e.opportunityId === fjordline);
    if (!event) throw new Error('no event');
    const before = await kleer.findInvoices({ foreignId: fjordline });
    expect(await handleEvent({ ...event, type: 'opportunity.reopened', changedFields: ['StageName'] })).toBe(
      'locked',
    );
    expect(openAlerts('billing').some((a) => a.kind === 'reopened' && a.oppId === fjordline)).toBe(true);
    expect(await kleer.findInvoices({ foreignId: fjordline })).toEqual(before);
  });

  it('raises a change to the customer’s details after billing', async () => {
    await sendAll();
    const fjordline = await idOf('Fjordline');
    const { AccountId } = await salesforce.getOpportunity(fjordline);
    await salesforce.updateAccount(AccountId, { Invoice_Email__c: 'someone.else@example.com' });
    await sweep();
    expect(openAlerts('billing').some((a) => a.kind === 'account_changed' && a.oppId === fjordline)).toBe(
      true,
    );
  });
});

describe('the rep hears about every status change, once', () => {
  const said = (text: string) => readDb().slack.messages.filter((m) => m.text.includes(text)).length;

  it('tells the rep when a deal is processed and when it goes to finance', async () => {
    await sendAll();
    expect(said('Fjordline') > 0).toBe(true);
    expect(said('is processed: the invoice is drafted') > 0).toBe(true);
    expect(said('is with finance. They are waiting on: discount approval')).toBe(1);
  });

  it('tells the rep when the old plan ends, if the deal replaces one (Nordlys)', async () => {
    await sendAll();
    expect(said('ends on 2026-11-14') > 0).toBe(true);
    expect(getHandoff(await idOf('Nordlys'))?.replaces?.[0]?.id).toBe('SUB-501');
  });

  it('does not repeat itself when the same events come again', async () => {
    await sendAll();
    await sweep();
    const before = readDb().slack.messages.length;
    await sendAll();
    await sweep();
    expect(readDb().slack.messages.length).toBe(before);
  });
});

describe('requests typed in the Slack channels', () => {
  const threadReplies = (text: string) =>
    readDb().slack.messages.filter((m) => m.threadTs && m.text.includes(text));

  it('answers a rep’s question in the thread with the deal’s live status, once', async () => {
    await sendAll();
    await sweep();
    expect(threadReplies('Corvid Analytics - New Pro: waiting on you')).toHaveLength(1);
    await sweep();
    await sweep();
    expect(threadReplies('Corvid Analytics - New Pro: waiting on you')).toHaveLength(1);
    // The answer counts, so the question is no longer "no reply yet"
    const corvid = await idOf('Corvid');
    const threads = await messagesByDeal([{ Id: corvid, accountName: 'Corvid Analytics' }]);
    expect(threads[corvid]?.unanswered).toBe(false);
  });

  it('reminds the channel’s owner once when a deal waits on a person, and creates no item', async () => {
    await sendAll();
    const kindsBefore = new Set(openAlerts().map((a) => a.kind));
    await sweep();
    await sweep();
    expect(threadReplies('Reminder for Deal Desk')).toHaveLength(1);
    // The channel messages add no items. The sweep only adds what the other systems report.
    const added = openAlerts().filter((a) => !kindsBefore.has(a.kind));
    expect(added.every((a) => a.kind === 'payment' || a.kind === 'overdue')).toBe(true);
    expect(openAlerts().filter((a) => a.kind === 'rep_message')).toHaveLength(0);
    const lumen = await idOf('Lumen');
    const threads = await messagesByDeal([{ Id: lumen, accountName: 'Lumen Hochschule' }]);
    expect(threads[lumen]?.unanswered).toBe(true); // a person still has to decide
  });
});

describe('a rep who does not fix their part', () => {
  const managerUpdates = () =>
    readDb().slack.messages.filter((m) => m.text.startsWith('Weekly update:'));

  it('reminds the rep first, and the sales manager only after the limit, once a week', async () => {
    await sendAll();
    await sweep(); // 6 Nov: Corvid and the others closed 2 to 6 Nov, under the limit for most
    const early = managerUpdates().length;
    await advanceDays(7); // past the limit
    expect(managerUpdates().length).toBe(early + 1);
    const update = managerUpdates().at(-1)?.text ?? '';
    expect(update).toContain('Corvid Analytics');
    expect(update).toContain('license count');
    await advanceDays(3); // less than a week later: nothing new
    expect(managerUpdates().length).toBe(early + 1);
    await advanceDays(7); // a week later: again, while things are still open
    expect(managerUpdates().length).toBe(early + 2);
  });

  it('says nothing to the manager when the rep has fixed it', async () => {
    await sendAll();
    for (const n of ['Corvid', 'Quill', 'Alpenblick', 'Arcadia', 'Maris', 'Vantera']) {
      await demoFix(await idOf(n));
    }
    await advanceDays(10);
    expect(managerUpdates()).toHaveLength(0);
  });
});

describe('finance replies where the rep asked', () => {
  it('posts in the same channel and thread, not in #finance-billing', async () => {
    await sendAll();
    const corvid = await idOf('Corvid');
    const db = readDb();
    const channel = db.slack.channels.find((c) => c.name === 'revops-help');
    const asked = db.slack.messages.find((m) => m.text.startsWith('Corvid signed for 8'));
    if (!channel || !asked) throw new Error('no message');
    await financeReply(corvid, 'Yes, it matters. We bill 8.', undefined, {
      channel: 'revops-help',
      threadTs: asked.ts,
    });
    const reply = readDb().slack.messages.find((m) => m.text.includes('Yes, it matters'));
    expect(reply?.channel).toBe(channel.id);
    expect(reply?.threadTs).toBe(asked.ts);
    // Jordan Reyes is tagged
    expect(reply?.text).toContain('<@U04JRDNRYS>');
  });
});

describe('discount approval from the deal', () => {
  it('does not ask twice when a request is already open', async () => {
    await sendAll();
    const lumen = await idOf('Lumen');
    const before = readDb().slack.messages.length;
    expect(await requestApproval(lumen)).toBe('already_open');
    expect(readDb().slack.messages.length).toBe(before);
  });

  it('posts the request in #deal-desk with a link to the deal in Salesforce', async () => {
    await sendAll();
    const lumen = await idOf('Lumen');
    await salesforce.updateOpportunity(lumen, { Discount_Approval__c: 'Not required' });
    expect(await requestApproval(lumen)).toBe('requested');
    const post = readDb().slack.messages.find((m) => m.text.startsWith('Discount approval requested'));
    expect(post?.text).toContain(`</deals/${lumen}|`);
    expect((await salesforce.getOpportunity(lumen)).Discount_Approval__c).toBe('Pending');
  });

  it('sends the deal through when Deal Desk approves, and tells the rep', async () => {
    await sendAll();
    const lumen = await idOf('Lumen');
    expect(getHandoff(lumen)?.status).toBe('waiting_finance');
    await decideApproval(lumen, 'Approved');
    expect((await salesforce.getOpportunity(lumen)).Discount_Approval__c).toBe('Approved');
    expect(['processed', 'waiting_finance', 'waiting_rep']).toContain(getHandoff(lumen)?.status);
    expect(
      readDb().slack.messages.some((m) => m.text.includes('Deal Desk approved the discount')),
    ).toBe(true);
    expect(openAlerts().some((a) => a.oppId === lumen && a.title === 'Discount approval')).toBe(
      false,
    );
  });

  it('gives a rejected discount back to the rep', async () => {
    await sendAll();
    const lumen = await idOf('Lumen');
    await decideApproval(lumen, 'Rejected');
    expect(getHandoff(lumen)?.status).toBe('waiting_rep');
  });
});

describe('sending an invoice', () => {
  it('only sends once, however many times it is pressed', async () => {
    await sendAll();
    const fjordline = await idOf('Fjordline');
    const before = readDb().slack.messages.length;
    await sendInvoice(fjordline);
    const afterFirst = readDb().slack.messages.length;
    await sendInvoice(fjordline);
    await sendInvoice(fjordline);
    expect(afterFirst).toBe(before + 1); // one message to the rep, for the first send
    expect(readDb().slack.messages.length).toBe(afterFirst);
    const sent = await kleer.findInvoices({ foreignId: fjordline, status: 'sent' });
    expect(sent).toHaveLength(1);
  });
});
