/**
 * The Closed Won hand-off. A Salesforce event comes in, we read the live deal,
 * check it against finance's rules, and either
 *   - set everything up (workspace, subscription, invoice draft or card charge,
 *     and write the IDs back to Salesforce), or
 *   - raise an alert for whoever has to act, with a deadline.
 *
 * Two automations in total: `handleEvent` (on every event) and `sweep` (daily).
 * Everything is safe to run twice: one opportunity ID means one subscription
 * and one invoice or charge (R5).
 */
import { adminApp, ConnectorError, kleer, salesforce, stripe } from '@/lib/connectors';
import { getPolicy } from '@/lib/policy/policy';
import {
  addDays,
  type DealContext,
  type Evaluation,
  type Finding,
  firstYearAmount,
  yearsOf,
} from '@/lib/policy/rules';
import type { SalesforceEvent, Workspace } from '@/lib/systems/types';
import { answerChannels } from './channels';
import { evaluateLive } from './context';
import { dmOwner, dmRep, mentionOf, postAs, postToDealDesk, TEMPLATES } from './slack';
import { accountSnapshotOf, SYNC_FIELDS, syncBack } from './sync';
import {
  type Alert,
  appToday,
  changeState,
  getHandoff,
  type Handoff,
  markNotified,
  openAlerts,
  raiseAlert,
  readState,
  resolveAlert,
  saveHandoff,
  syncAlerts,
} from './store';

/** Fields our own hand-off writes back. An event that changes only these is our own echo. */
const OWN_FIELDS = new Set([
  'Subscription_ID__c',
  'Invoice_Number__c',
  'Handoff_Processed_At__c',
  'LastModifiedDate',
  ...SYNC_FIELDS,
]);

/** Fields that change what is billed. After billing, a change to any of these cannot be applied. */
const BILLING_FIELDS = [
  'Plan__c',
  'Number_of_Licenses__c',
  'Total_Licenses__c',
  'Price_per_License_per_Year__c',
  'Discount__c',
  'Amount',
  'CurrencyIsoCode',
  'Contract_Term__c',
  'Start_Date__c',
  'End_Date__c',
  'Payment_Method__c',
  'PO_Number__c',
];

export type Outcome =
  | 'processed'
  | 'waiting_rep'
  | 'waiting_finance'
  | 'ignored'
  | 'duplicate'
  | 'locked'
  | 'blocked';

export async function handleEvent(event: SalesforceEvent): Promise<Outcome> {
  if (event.type === 'opportunity.updated' && event.changedFields.every((f) => OWN_FIELDS.has(f))) {
    return 'ignored';
  }
  if (event.type === 'opportunity.reopened') return reopened(event.opportunityId);
  return processDeal(event.opportunityId);
}

/**
 * A deal moved out of Closed Won. Before billing, nothing was done, so there is
 * nothing to undo. After billing, an invoice and a subscription exist and a
 * person has to decide: we raise it and change nothing.
 */
async function reopened(oppId: string): Promise<Outcome> {
  const h = getHandoff(oppId);
  if (!h) return 'ignored';
  if (h.status !== 'processed') {
    saveHandoff({ ...h, status: 'ignored' });
    syncAlerts(oppId, []);
    return 'ignored';
  }
  const invoice = h.invoiceNumber ? await kleer.getInvoice(h.invoiceNumber) : null;
  raiseAlert({
    oppId,
    kind: 'reopened',
    title: 'Moved out of Closed Won after billing',
    message: `${h.dealName} was billed and then moved out of Closed Won. ${invoice ? `Invoice ${invoice.invoiceNumber} is ${invoice.status}: credit it if the deal is off. ` : h.stripeSubscriptionId ? `The card was charged (${h.stripeSubscriptionId}): refund it if the deal is off. ` : ''}Subscription ${h.subscriptionId} is still set up. Nothing was changed automatically.`,
    queue: 'billing',
    ownerLabel: null,
    due: appToday(),
  });
  return 'locked';
}

/** Checks a deal again, e.g. after the rep fixed something. Safe to call any time. */
export const recheck = (oppId: string) => processDeal(oppId);

const queueOf = (f: Finding): Alert['queue'] =>
  f.owner === 'rep' ? 'rep' : f.owner === 'credit' ? 'credit' : 'billing';

const TITLES: Record<string, string> = {
  R8: 'Amount',
  Lines: 'License count',
  Currency: 'Currency',
  R2: 'Card limit',
  R3: 'Purchase order',
  R4: 'Billing details',
  VAT: 'VAT ID',
  Dates: 'Start date',
  Discount: 'Discount approval',
  R6: 'Add-on target',
  Workspace: 'Workspace match',
  Payment: 'Payment method on file',
};

async function processDeal(oppId: string): Promise<Outcome> {
  const { ctx, result } = await evaluateLive(oppId);
  const { opp } = ctx;
  const existing = getHandoff(oppId);
  const owner = await salesforce.getUser(opp.OwnerId).catch(() => null);
  const base: Handoff = existing ?? {
    oppId,
    dealName: opp.Name,
    accountName: ctx.account.Name,
    repName: owner?.Name ?? opp.OwnerId,
    ownerId: opp.OwnerId,
    accountId: ctx.account.Id,
    closeDate: opp.CloseDate,
    receivedAt: new Date().toISOString(),
    status: 'ignored',
    snapshot: null,
    system: null,
    workspaceId: null,
    subscriptionId: null,
    invoiceNumber: null,
    stripeSubscriptionId: null,
    processedAt: null,
    urgentSentOn: null,
  };

  // Already billed: the deal is locked. A change after that is a notice, never an edit.
  if (existing?.status === 'processed') {
    const now = snapshotOf(ctx);
    const changed = Object.keys(now).filter(
      (k) => JSON.stringify(now[k]) !== JSON.stringify(existing.snapshot?.[k]),
    );
    if (changed.length === 0) return 'duplicate';
    const raised = raiseAlert({
      oppId,
      kind: 'locked',
      title: 'Changed after billing',
      message: `${changed.join(', ')} changed after the deal was billed. Nothing was changed in billing. The rep has been asked to create an amendment deal.`,
      queue: 'billing',
      ownerLabel: null,
      due: null,
    });
    if (raised) await dmRep(opp, TEMPLATES.locked(opp.Name));
    return 'locked';
  }

  if (result.verdict === 'ignored') {
    saveHandoff({ ...base, status: 'ignored' });
    syncAlerts(oppId, []);
    return 'ignored';
  }

  const fails = result.findings.filter((f) => f.status === 'fail');
  const raised = syncAlerts(
    oppId,
    fails.map((f) => ({
      kind: 'rule' as const,
      title: TITLES[f.rule] ?? f.rule,
      message: f.message,
      queue: queueOf(f),
      ownerLabel:
        f.owner === 'deal_desk' ? 'Deal Desk (approves discounts over 25%)' : null,
      due: result.due,
    })),
  );

  if (result.verdict === 'clean') {
    // A rep who fixed everything: any earlier "blocked" alert starts again from scratch
    syncAlerts(oppId, [], ['blocked']);
    return runHandoff(ctx, result, base);
  }
  const status = result.verdict === 'rep' ? 'waiting_rep' : 'waiting_finance';
  saveHandoff({ ...base, status });
  if (raised.some((a) => a.queue === 'rep')) await sendDigests();
  // The rep is told when finance takes the deal, and why, once per set of reasons
  if (status === 'waiting_finance') {
    const what = fails.map((f) => (TITLES[f.rule] ?? f.rule).toLowerCase()).join(', ');
    if (markNotified(oppId, `finance:${what}`)) {
      await dmRep(opp, TEMPLATES.withFinance(opp.Name, what, result.due));
    }
  }
  return status;
}

const snapshotOf = (ctx: DealContext) =>
  Object.fromEntries(BILLING_FIELDS.map((k) => [k, ctx.opp[k] ?? null]));

// ── Setting everything up ────────────────────────────────────

async function runHandoff(ctx: DealContext, result: Evaluation, start: Handoff): Promise<Outcome> {
  const { opp, account } = ctx;
  const plan = result.plan;
  if (!plan) return 'ignored';
  const policy = getPolicy();
  const today = appToday();
  let h: Handoff = { ...start, system: plan.system };
  const save = (patch: Partial<Handoff>) => {
    h = { ...h, ...patch };
    saveHandoff(h);
  };
  const licenses = opp.Number_of_Licenses__c ?? 0;
  const price = opp.Price_per_License_per_Year__c ?? 0;

  try {
    // 1. Workspace: the one that matches the account, or a new one
    let workspace: Workspace | undefined;
    if (result.workspace.kind === 'linked') {
      workspace = result.workspace.workspace;
      if (!workspace.salesforceAccountId) {
        workspace = await adminApp.updateWorkspace(workspace.id, {
          salesforceAccountId: account.Id,
        });
      }
    } else if (h.workspaceId) {
      workspace = await adminApp.getWorkspace(h.workspaceId);
    } else {
      workspace = await adminApp.createWorkspace({
        name: account.Name,
        salesforceAccountId: account.Id,
        domain: new URL(account.Website).hostname.replace(/^www\./, ''),
        region: String(account.Region__c).includes('North America') ? 'US' : 'EU',
      });
    }
    save({ workspaceId: workspace.id });

    // 2. Billing: a Kleer draft for invoice deals, a Stripe charge for card deals
    let invoiceNumber = h.invoiceNumber;
    let stripeSubscriptionId = h.stripeSubscriptionId;
    let kleerCustomer = account.Kleer_Customer_Number__c;
    let secured = false;
    if (plan.system === 'Kleer' && !invoiceNumber) {
      // R5: Kleer accepts duplicates, so look for this deal's invoice before making one
      const found = (await kleer.findInvoices({ foreignId: opp.Id })).find(
        (i) => i.type === 'invoice' && i.status !== 'credited',
      );
      let invoice = found;
      if (!invoice) {
        const customer = await findOrCreateKleerCustomer(ctx);
        kleerCustomer = customer;
        const planLine = ctx.lines.find((l) => l.ProductCode === opp.Plan__c);
        const paidUpfront = yearsOf(opp) > 1 && opp.Multi_Year_Payment_Terms__c === 'Paid upfront';
        const prorate = opp.RecordType.DeveloperName === 'Add_on';
        const { services } = firstYearAmount(ctx);
        const unit = prorate
          ? round2((plan.billNow - services) / licenses / (1 - (opp.Discount__c ?? 0) / 100))
          : paidUpfront
            ? price * yearsOf(opp)
            : price;
        const billContact = opp.Billing_Contact__c
          ? await salesforce.getContact(opp.Billing_Contact__c).catch(() => null)
          : null;
        invoice = await kleer.createInvoice({
          customerNumber: customer,
          currency: opp.CurrencyIsoCode,
          lines: [
            {
              articleNumber: opp.Plan__c ?? '',
              description: `${planLine?.Name ?? opp.Plan__c} licenses, ${plan.servicePeriod.start} - ${plan.servicePeriod.end}`,
              quantity: licenses,
              unitPrice: unit,
              discountPercent: opp.Discount__c ?? 0,
            },
            ...ctx.lines
              .filter((l) => l.ProductCode !== opp.Plan__c)
              .map((l) => ({
                articleNumber: l.ProductCode,
                description: l.Name,
                quantity: l.Quantity,
                unitPrice: l.UnitPrice,
                discountPercent: l.Discount,
              })),
          ],
          paymentTermsDays: 30,
          servicePeriod: plan.servicePeriod,
          poNumber: opp.PO_Number__c,
          yourReference: billContact?.Name ?? null,
          ourReference: policy.queues.billing.owner,
          foreignId: opp.Id,
        });
      }
      invoiceNumber = invoice.invoiceNumber;
      if (policy.invoiceSendMode === 'auto')
        invoice = await kleer.sendInvoice(invoice.invoiceNumber);
      secured = invoice.status === 'sent' || invoice.status === 'paid';
      save({ invoiceNumber });
    } else if (plan.system === 'Stripe' && !stripeSubscriptionId) {
      const [existingCustomer] = await stripe.findCustomers({
        metadata: { workspace_id: workspace.id },
      });
      const customer =
        existingCustomer ??
        (await stripe.createCustomer(
          {
            name: account.Legal_Entity_Name__c ?? account.Name,
            email: account.Invoice_Email__c ?? '',
            currency: opp.CurrencyIsoCode.toLowerCase(),
            metadata: { workspace_id: workspace.id },
          },
          { idempotencyKey: `customer:${opp.Id}` },
        ));
      const charge = await stripe.createSubscription(
        {
          customer: customer.id,
          plan: opp.Plan__c ?? '',
          quantity: licenses,
          currency: opp.CurrencyIsoCode.toLowerCase(),
          amount: plan.billNow,
          start_date: plan.servicePeriod.start,
          metadata: { opportunity_id: opp.Id },
        },
        { idempotencyKey: `subscription:${opp.Id}` },
      );
      stripeSubscriptionId = charge.id;
      secured = charge.status === 'active';
      save({ stripeSubscriptionId });
    } else {
      secured = await isSecured(h);
    }
    const reference = invoiceNumber ?? stripeSubscriptionId;

    // 3. Subscription: update the existing one on an add-on, otherwise book the new term
    let subscriptionId = h.subscriptionId;
    if (!subscriptionId) {
      if (plan.updates) {
        const updated = await adminApp.updateSubscription(plan.updates.id, {
          seats: opp.Total_Licenses__c ?? plan.updates.seats + licenses,
        });
        subscriptionId = updated.id;
      } else {
        // Goes live on the start date, and only when billing is secured
        const created = await adminApp.createSubscription({
          workspaceId: workspace.id,
          salesforceAccountId: account.Id,
          plan: opp.Plan__c ?? '',
          seats: opp.Total_Licenses__c ?? licenses,
          startDate: plan.servicePeriod.start,
          endDate: opp.End_Date__c ?? plan.servicePeriod.end,
          billingSystem: plan.system,
          billingReference: reference,
          status: secured && plan.servicePeriod.start <= today ? 'Active' : 'Scheduled',
          autoRenew: plan.system === 'Stripe',
        });
        subscriptionId = created.id;
      }
      save({ subscriptionId });
    }

    // 4. R7: the old subscription stops renewing, so the customer is not billed twice
    for (const old of plan.supersedes) {
      await adminApp.updateSubscription(old.id, { autoRenew: false });
      if (old.billingSystem === 'Stripe' && old.billingReference) {
        await stripe.updateSubscription(old.billingReference, { cancel_at_period_end: true });
      }
    }
    if (plan.supersedes.length) {
      save({ replaces: plan.supersedes.map((s) => ({ id: s.id, endDate: s.endDate })) });
    }

    // 5. Write the result back to Salesforce, so the rep can see it
    await salesforce.updateOpportunity(opp.Id, {
      Subscription_ID__c: subscriptionId,
      Invoice_Number__c: invoiceNumber ?? null,
      Handoff_Processed_At__c: today,
    });
    const accountFields: Record<string, string> = {};
    if (!account.Workspace_ID__c) accountFields.Workspace_ID__c = workspace.id;
    if (kleerCustomer && !account.Kleer_Customer_Number__c) {
      accountFields.Kleer_Customer_Number__c = kleerCustomer;
    }
    if (Object.keys(accountFields).length)
      await salesforce.updateAccount(account.Id, accountFields);

    save({
      status: 'processed',
      processedAt: today,
      snapshot: snapshotOf(ctx),
      accountId: account.Id,
      accountSnapshot: accountSnapshotOf(account),
    });
    syncAlerts(opp.Id, [], ['rule', 'blocked']);
    await syncBack([opp.Id]);
    // The rep hears that it went through. A sent invoice or a charged card is the final word.
    // A draft invoice is told as "processed", and the send is told again when Billing sends it.
    if (secured) {
      if (markNotified(opp.Id, 'sent')) {
        await dmRep(opp, TEMPLATES.confirmation(opp.Name, billingDone(plan.system)));
      }
    } else if (markNotified(opp.Id, 'processed')) {
      await dmRep(
        opp,
        TEMPLATES.processed(
          opp.Name,
          `the invoice is drafted and Billing will review and send it. You do not need to do anything.${endsNote(h.replaces)}`,
        ),
      );
    }
    return 'processed';
  } catch (error) {
    if (!(error instanceof ConnectorError)) throw error;
    raiseAlert({
      oppId: opp.Id,
      kind: 'blocked',
      title: 'Hand-off stopped',
      message: `${error.system} said: ${error.message}. Nothing was created twice. Fix it and check the deal again.`,
      queue: 'billing',
      ownerLabel: null,
      due: result.due,
    });
    saveHandoff({ ...h, status: 'waiting_finance' });
    return 'blocked';
  }
}

/** When this deal replaces a plan, the customer needs the new billing secured before the old one ends. */
const endsNote = (replaces: Handoff['replaces']) =>
  replaces?.length
    ? ` The customer's current plan (${replaces.map((r) => r.id).join(', ')}) ends on ${replaces.map((r) => r.endDate).sort().at(-1)}. The invoice has to be sent before then, or they lose access.`
    : '';

const billingDone = (system: 'Kleer' | 'Stripe') =>
  system === 'Stripe'
    ? 'the card has been charged. You do not need to do anything.'
    : 'the invoice has been sent. You do not need to do anything.';

const round2 = (n: number) => Math.round(n * 100) / 100;

async function findOrCreateKleerCustomer(ctx: DealContext): Promise<string> {
  const { account } = ctx;
  if (account.Kleer_Customer_Number__c) return account.Kleer_Customer_Number__c;
  const name = account.Legal_Entity_Name__c ?? account.Name;
  const [found] = account.VAT_Number__c
    ? await kleer.findCustomers({ vatNumber: account.VAT_Number__c })
    : await kleer.findCustomers({ name });
  if (found) return found.customerNumber;
  const created = await kleer.createCustomer({
    name,
    email: account.Invoice_Email__c ?? '',
    country: account.BillingCountry,
    currency: account.CurrencyIsoCode,
    vatNumber: account.VAT_Number__c,
    address: [account.BillingStreet, account.BillingPostalCode, account.BillingCity]
      .filter(Boolean)
      .join(', '),
  });
  return created.customerNumber;
}

/** Billing is secured when the card was charged, or the invoice has been sent. */
async function isSecured(h: Handoff): Promise<boolean> {
  if (h.system === 'Stripe' && h.stripeSubscriptionId) {
    return (await stripe.getSubscription(h.stripeSubscriptionId)).status === 'active';
  }
  if (h.invoiceNumber) {
    const status = (await kleer.getInvoice(h.invoiceNumber)).status;
    return status === 'sent' || status === 'paid';
  }
  return false;
}

/** Billing sends the draft. The subscription goes live if its start date has passed. */
export async function sendInvoice(oppId: string) {
  const h = getHandoff(oppId);
  if (!h?.invoiceNumber) return;
  const invoice = await kleer.getInvoice(h.invoiceNumber);
  // Already sent: do nothing, so a second click can't email the customer or message the rep again
  if (invoice.status !== 'draft') return;
  await kleer.sendInvoice(h.invoiceNumber);
  await activateDue();
  const opp = await salesforce.getOpportunity(oppId);
  if (markNotified(oppId, 'sent')) {
    await dmRep(opp, TEMPLATES.confirmation(opp.Name, billingDone('Kleer')));
  }
  syncAlerts(oppId, [], ['unsecured']);
  await syncBack([oppId]);
}

// ── Messages between finance and the rep ─────────────────────

/** A rep writes to finance from the deal. It lands in #finance-billing and in the Billing queue until answered. */
export async function repMessageFinance(oppId: string, text: string) {
  const opp = await salesforce.getOpportunity(oppId);
  const owner = await salesforce.getUser(opp.OwnerId);
  await postAs('Rep message', owner.Name, opp, text);
  raiseAlert({
    oppId,
    kind: 'rep_message',
    title: 'Message from the rep',
    message: text,
    queue: 'billing',
    ownerLabel: null,
    due: addDays(appToday(), 1),
  });
}

/** Finance answers. The reply is filed under the deal and the open message is closed. */
export async function financeReply(
  oppId: string,
  text: string,
  by = getPolicy().queues.billing.owner,
  target?: { channel: string; threadTs?: string },
) {
  const opp = await salesforce.getOpportunity(oppId);
  // The rep is tagged, so the reply reaches them as a notification, not just a line in a channel
  const tag = await mentionOf(opp.OwnerId);
  await postAs('Finance reply', by, opp, tag ? `${tag} ${text}` : text, target);
  for (const a of openAlerts('billing')) {
    if (a.oppId === oppId && a.kind === 'rep_message') resolveAlert(a.id);
  }
}

/**
 * The rep presses "Request Deal Desk approval" on the deal. One structured message
 * goes to #deal-desk with the deal attached, and the deal is marked Pending. If a
 * request is already open (the rep asked in the channel, or pressed twice), nothing
 * is posted again. In a real Salesforce this is an approval process with a Slack
 * message and Approve / Reject buttons.
 */
export async function requestApproval(oppId: string): Promise<'requested' | 'already_open'> {
  const opp = await salesforce.getOpportunity(oppId);
  if (opp.Discount_Approval__c === 'Pending') return 'already_open';
  const owner = await salesforce.getUser(opp.OwnerId).catch(() => null);
  await salesforce.updateOpportunity(oppId, { Discount_Approval__c: 'Pending' });
  await postToDealDesk(
    opp,
    TEMPLATES.approvalRequested(
      opp.Id,
      opp.Name,
      opp.Discount__c,
      opp.Number_of_Licenses__c,
      owner?.Name ?? 'the rep',
    ),
  );
  await processDeal(oppId);
  return 'requested';
}

/**
 * Deal Desk decides. In real Slack this is a button on the request. Here the Exceptions
 * card has the same two buttons. The decision is written to the deal, the deal is checked
 * again (so an approved deal goes straight through), and the rep is told.
 */
export async function decideApproval(oppId: string, decision: 'Approved' | 'Rejected') {
  const opp = await salesforce.getOpportunity(oppId);
  await salesforce.updateOpportunity(oppId, { Discount_Approval__c: decision });
  await postToDealDesk(
    opp,
    decision === 'Approved'
      ? `Approved by Deal Desk: ${opp.Name}.`
      : `Not approved by Deal Desk: ${opp.Name}.`,
  );
  await dmRep(opp, decision === 'Approved' ? TEMPLATES.approved(opp.Name) : TEMPLATES.rejected(opp.Name));
  return processDeal(oppId);
}

/** Finance asks the rep something, as a direct message tagged with the deal. */
export async function askRep(oppId: string, question: string) {
  const opp = await salesforce.getOpportunity(oppId);
  await dmRep(opp, TEMPLATES.askRep(opp.Name, question));
}

// ── The daily sweep ──────────────────────────────────────────

/** One digest per rep, only when it changed. Not one message per deal. */
export async function sendDigests() {
  const state = readState();
  const today = appToday();
  const byOwner = new Map<string, { id: string; name: string; what: string }[]>();
  for (const h of Object.values(state.handoffs)) {
    if (h.status !== 'waiting_rep') continue;
    const what = state.alerts
      .filter((a) => a.oppId === h.oppId && a.status === 'open' && a.queue === 'rep')
      .map((a) => a.title.toLowerCase())
      .join(', ');
    byOwner.set(h.ownerId, [
      ...(byOwner.get(h.ownerId) ?? []),
      { id: h.oppId, name: h.dealName, what },
    ]);
  }
  for (const [ownerId, deals] of byOwner) {
    const policy = getPolicy();
    const text = TEMPLATES.digest(
      deals,
      `\nIf it is still open ${policy.managerEscalationDays} days after close, ${policy.salesManager} sees it in the weekly update.`,
    );
    const last = state.digests[ownerId];
    if (last?.text === text && last.on === today) continue;
    await dmOwner(ownerId, text);
    changeState((s) => {
      s.digests[ownerId] = { on: today, text };
    });
  }
}

/**
 * A rep who still hasn't fixed what finance needs, past the limit, is in the sales
 * manager's weekly update. Reps get the first reminders (the daily message, the urgent
 * one at the deadline). The manager is responsible for their team's numbers, and these
 * deals count in the forecast but finance cannot book them. One message a week, by
 * rep, with the value, only when there is something to say.
 */
export async function sendManagerUpdate() {
  const policy = getPolicy();
  const state = readState();
  const today = appToday();
  const last = state.managerUpdateOn;
  if (last && today < addDays(last, 7)) return;

  const waiting = Object.values(state.handoffs).filter((h) => {
    if (h.status !== 'waiting_rep' || !h.closeDate) return false;
    const days = Math.round((+new Date(today) - +new Date(h.closeDate)) / 864e5);
    return days >= policy.managerEscalationDays;
  });
  if (waiting.length === 0) return;

  const users = await salesforce.listUsers();
  const manager = users.find((u) => u.Name === policy.salesManager);
  if (!manager) return;
  const opps = new Map((await salesforce.listOpportunities()).map((o) => [o.Id, o]));
  const rows = waiting
    .map((h) => {
      const opp = opps.get(h.oppId);
      const amount = opp?.Amount ?? 0;
      const cur = opp?.CurrencyIsoCode ?? 'EUR';
      return {
        rep: h.repName,
        deal: h.dealName,
        value: `${Math.round(amount).toLocaleString('en-GB')} ${cur}`,
        eur: amount * (policy.fxToEur[cur] ?? 1),
        what: state.alerts
          .filter((a) => a.oppId === h.oppId && a.status === 'open' && a.queue === 'rep')
          .map((a) => a.title.toLowerCase())
          .join(', '),
        days: Math.round((+new Date(today) - +new Date(h.closeDate as string)) / 864e5),
      };
    })
    .sort((a, b) => a.rep.localeCompare(b.rep));
  const total = `${Math.round(rows.reduce((n, r) => n + r.eur, 0)).toLocaleString('en-GB')} EUR`;
  await dmOwner(manager.Id, TEMPLATES.managerUpdate(rows, total));
  changeState((s) => {
    s.managerUpdateOn = today;
  });
}

/** Puts a subscription live once its start date has come and billing is secured. */
async function activateDue() {
  const today = appToday();
  for (const h of Object.values(readState().handoffs)) {
    if (h.status !== 'processed' || !h.subscriptionId) continue;
    const sub = await adminApp.getSubscription(h.subscriptionId);
    if (sub.status === 'Scheduled' && sub.startDate <= today && (await isSecured(h))) {
      await adminApp.updateSubscription(sub.id, { status: 'Active' });
    }
  }
}

export async function sweep() {
  const policy = getPolicy();
  const today = appToday();
  const state = readState();

  // 1. Deals waiting on someone are checked again, in case the fix happened without an event
  for (const h of Object.values(state.handoffs)) {
    if (h.status === 'waiting_rep' || h.status === 'waiting_finance') await processDeal(h.oppId);
  }

  // 2. Subscriptions go live; billing still not secured close to the start date is escalated
  await activateDue();
  for (const h of Object.values(readState().handoffs)) {
    if (h.status !== 'processed' || !h.subscriptionId) continue;
    const sub = await adminApp.getSubscription(h.subscriptionId);
    const secured = await isSecured(h);
    const daysLeft = Math.round((+new Date(sub.startDate) - +new Date(today)) / 864e5);
    if (!secured && sub.status === 'Scheduled' && daysLeft <= policy.escalateDaysBeforeStart) {
      raiseAlert({
        oppId: h.oppId,
        kind: 'unsecured',
        title: 'Billing not secured',
        message: `${h.dealName} goes live ${sub.startDate} but the invoice has not been sent. Customer Success (Lea Fischer) should know the workspace will not open.${endsNote(h.replaces)}`,
        queue: 'billing',
        ownerLabel: null,
        due: sub.startDate,
      });
    } else if (secured) {
      syncAlerts(h.oppId, [], ['unsecured']);
    }
  }

  // 3. Billing moves on: write status back to Salesforce, overdue invoices and failed card
  // payments go to Credit Control (and the rep is told), account edits after billing are raised
  await syncBack();

  // 4. A rep deadline reached: one urgent message for that deal, once
  for (const h of Object.values(readState().handoffs)) {
    if (h.status !== 'waiting_rep' || h.urgentSentOn === today) continue;
    const alerts = openAlerts('rep').filter((a) => a.oppId === h.oppId);
    const due = alerts[0]?.due;
    if (due && due <= today) {
      const opp = await salesforce.getOpportunity(h.oppId);
      await dmRep(opp, TEMPLATES.urgent(h.dealName, alerts.map((a) => a.message).join(' ')));
      saveHandoff({ ...h, urgentSentOn: today });
    }
  }

  // 5. Requests reps typed in the Slack channels: answered in the thread, nudged if a person is slow
  await answerChannels();

  // 6. The daily digest to reps, then the weekly update to the sales manager for what is still open
  await sendDigests();
  await sendManagerUpdate();
}

/**
 * The rep edits the billing details on the deal. They are saved to Salesforce
 * (the deal and its account), and if the deal was already sent, it is checked
 * again. A real Salesforce would fire an update event on save, and the same
 * check would run from that.
 */
export async function saveBillingDetails(
  oppId: string,
  v: { method: string; po: string; legal: string; vat: string; email: string },
): Promise<Outcome | null> {
  const opp = await salesforce.getOpportunity(oppId);
  const orNull = (s: string) => s.trim() || null;
  await salesforce.updateOpportunity(oppId, {
    Payment_Method__c: v.method === 'Card' ? 'Card' : 'Invoice',
    PO_Number__c: orNull(v.po),
  });
  await salesforce.updateAccount(opp.AccountId, {
    Legal_Entity_Name__c: orNull(v.legal),
    VAT_Number__c: orNull(v.vat),
    Invoice_Email__c: orNull(v.email),
  });
  return getHandoff(oppId) ? recheck(oppId) : null;
}

/**
 * Demo only: the rep moves an open deal to Closed Won, whatever is or isn't filled in.
 * In Salesforce, changing the stage publishes the event by itself. The mock's PATCH
 * doesn't, so we send the same event to the same handler here. The close date is
 * set to today, as Salesforce stage changes usually do.
 */
export async function moveToClosedWon(oppId: string): Promise<Outcome> {
  await salesforce.updateOpportunity(oppId, { StageName: 'Closed Won', CloseDate: appToday() });
  const { OpportunityLineItems: _lines, ...opportunity } = await salesforce.getOpportunity(oppId);
  const { latestReplayId } = await salesforce.listEvents();
  return handleEvent({
    replayId: latestReplayId + 1,
    type: 'opportunity.closed_won',
    occurredAt: new Date().toISOString(),
    opportunityId: oppId,
    changedFields: ['StageName', 'CloseDate'],
    opportunity,
  });
}

/** Demo only: moves the app's clock forward and runs the sweep, to see deadlines and escalation. */
export async function advanceDays(days: number) {
  changeState((s) => {
    s.demoDays += days;
  });
  await sweep();
}
