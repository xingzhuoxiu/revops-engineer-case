/**
 * What happens after a deal is billed. The hand-off sets things up once. This
 * keeps Salesforce, Credit Control and the rep up to date as the other systems
 * move on: the invoice is sent, paid or overdue, the subscription goes live, the
 * card payment fails, or the customer's details change on the account.
 *
 * One function, `syncBack`, runs in the daily sweep and after anything that
 * changes billing. It reads Kleer, Stripe and the admin app once each, then goes
 * through the processed deals.
 */
import { adminApp, kleer, salesforce, stripe } from '@/lib/connectors';
import type { KleerInvoice, SalesforceAccount } from '@/lib/systems/types';
import { dmOwner, dmRep, TEMPLATES } from './slack';
import { appToday, markNotified, patchHandoff, raiseAlert, readState, syncAlerts } from './store';

/** Fields we write onto the Opportunity so the rep, and Salesforce reports, can see billing. */
export const SYNC_FIELDS = [
  'Invoice_Status__c',
  'Invoice_Sent_Date__c',
  'Invoice_Due_Date__c',
  'Invoice_Paid_Date__c',
  'Subscription_Status__c',
];

/** Customer details that end up on an invoice or a Stripe customer. */
const ACCOUNT_FIELDS = [
  'Legal_Entity_Name__c',
  'VAT_Number__c',
  'Invoice_Email__c',
  'BillingStreet',
  'BillingCity',
  'BillingPostalCode',
  'BillingCountry',
] as const;

export const accountSnapshotOf = (a: SalesforceAccount) =>
  Object.fromEntries(ACCOUNT_FIELDS.map((k) => [k, a[k] ?? null]));

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

export const isOverdue = (i: KleerInvoice, today: string) =>
  i.status === 'sent' && i.dueDate < today;

/** The words a rep sees for an invoice. */
export const invoiceLabel = (i: KleerInvoice, today: string) =>
  i.status === 'draft'
    ? 'Draft'
    : i.status === 'paid'
      ? 'Paid'
      : isOverdue(i, today)
        ? 'Overdue'
        : i.status === 'sent'
          ? 'Sent'
          : 'Credited';

export async function syncBack(only?: string[]) {
  const today = appToday();
  const processed = Object.values(readState().handoffs).filter(
    (h) => h.status === 'processed' && (!only || only.includes(h.oppId)),
  );
  if (processed.length === 0 && only) return;

  const [invoices, subscriptions, stripeSubs] = await Promise.all([
    kleer.findInvoices(),
    adminApp.listSubscriptions(),
    stripe.listSubscriptions(),
  ]);
  const accountIds = [
    ...new Set(processed.map((h) => h.accountId).filter((id): id is string => !!id)),
  ];
  const accounts = new Map(
    (accountIds.length ? await salesforce.listAccounts(accountIds) : []).map((a) => [a.Id, a]),
  );

  for (const h of processed) {
    const invoice = invoices.find((i) => i.invoiceNumber === h.invoiceNumber);
    const card = stripeSubs.find((s) => s.id === h.stripeSubscriptionId);
    const sub = subscriptions.find((s) => s.id === h.subscriptionId);

    // 1. Billing and subscription status, written to the deal
    const next: Record<string, string | null> = {
      Invoice_Status__c: invoice
        ? invoiceLabel(invoice, today)
        : card
          ? card.status === 'active'
            ? 'Paid by card'
            : card.status === 'past_due'
              ? 'Payment failed'
              : card.status
          : null,
      Invoice_Sent_Date__c: day(invoice?.sentAt ?? null),
      Invoice_Due_Date__c: invoice && invoice.status !== 'draft' ? invoice.dueDate : null,
      Invoice_Paid_Date__c: day(invoice?.paidAt ?? null),
      Subscription_Status__c: sub?.status ?? null,
    };
    const written = h.written ?? {};
    const patch = Object.fromEntries(Object.entries(next).filter(([k, v]) => written[k] !== v));
    if (Object.keys(patch).length > 0) {
      await salesforce.updateOpportunity(h.oppId, patch);
      patchHandoff(h.oppId, { written: next });
    }

    // The rep hears when the invoice is paid
    if (invoice && next.Invoice_Status__c === 'Paid' && markNotified(h.oppId, 'paid')) {
      await dmRep(
        { Id: h.oppId, Name: h.dealName, OwnerId: h.ownerId },
        TEMPLATES.paid(h.dealName, invoice.invoiceNumber),
      );
    }

    // 2. An unpaid invoice past its due date goes to Credit Control, and the rep is told once
    if (invoice && isOverdue(invoice, today)) {
      const raised = raiseAlert({
        oppId: h.oppId,
        kind: 'overdue',
        title: `Invoice ${invoice.invoiceNumber} overdue`,
        message: `${h.dealName}: ${invoice.currency} ${invoice.totalAmount} was due ${invoice.dueDate} and is not paid. ${h.repName} owns the customer and has been told.`,
        queue: 'credit',
        ownerLabel: null,
        due: today,
      });
      if (raised) {
        await dmRep(
          { Id: h.oppId, Name: h.dealName, OwnerId: h.ownerId },
          TEMPLATES.overdue(h.dealName, invoice.invoiceNumber, invoice.dueDate),
        );
      }
    } else {
      syncAlerts(h.oppId, [], ['overdue']);
    }

    // 3. Customer details changed on the account after billing
    const account = accounts.get(h.accountId ?? '') ?? null;
    if (account) {
      const now = accountSnapshotOf(account);
      if (!h.accountSnapshot) {
        patchHandoff(h.oppId, { accountSnapshot: now });
      } else {
        const changed = Object.keys(now).filter(
          (k) => JSON.stringify(now[k]) !== JSON.stringify(h.accountSnapshot?.[k]),
        );
        if (changed.length > 0) {
          const where = h.system === 'Stripe' ? 'the Stripe customer' : 'the Kleer customer';
          raiseAlert(
            {
              oppId: h.oppId,
              kind: 'account_changed',
              title: 'Customer details changed after billing',
              message: `${changed.join(', ')} changed on the account. ${invoice ? `Invoice ${invoice.invoiceNumber} was issued with the old details. ` : ''}Update ${where}. If the VAT ID or legal name changed, the invoice needs a credit note and a new one.`,
              queue: 'billing',
              ownerLabel: null,
              due: null,
            },
            false,
          );
          patchHandoff(h.oppId, { accountSnapshot: now });
        }
      }
    }
  }

  if (only) return;

  // 4. Overdue invoices that did not come through this hand-off (older deals): Credit Control still owns them
  const ours = new Set(processed.map((h) => h.invoiceNumber));
  for (const invoice of invoices) {
    if (ours.has(invoice.invoiceNumber) || invoice.type !== 'invoice' || !isOverdue(invoice, today))
      continue;
    const customer = await kleer.getCustomer(invoice.customerNumber).catch(() => null);
    raiseAlert({
      oppId: invoice.foreignId,
      kind: 'overdue',
      title: `Invoice ${invoice.invoiceNumber} overdue`,
      message: `${customer?.name ?? invoice.customerNumber}: ${invoice.currency} ${invoice.totalAmount} was due ${invoice.dueDate} and is not paid.`,
      queue: 'credit',
      ownerLabel: null,
      due: today,
    });
  }

  // 5. Failed card payments: linked to the deal when we know it, and the rep is told
  await paymentFailures(
    stripeSubs.filter((s) => s.status === 'past_due'),
    today,
  );
}

async function paymentFailures(
  failed: Awaited<ReturnType<typeof stripe.listSubscriptions>>,
  today: string,
) {
  const handoffs = Object.values(readState().handoffs);
  for (const sub of failed) {
    const customer = await stripe.getCustomer(sub.customer);
    const h =
      handoffs.find((x) => x.stripeSubscriptionId === sub.id) ??
      handoffs.find((x) => x.oppId === sub.metadata.opportunity_id);
    // Not one of our deals: find the rep through the workspace and its account
    let ownerId = h?.ownerId ?? null;
    let repName = h?.repName ?? null;
    if (!ownerId && customer.metadata.workspace_id) {
      const workspace = await adminApp
        .getWorkspace(customer.metadata.workspace_id)
        .catch(() => null);
      const account = workspace?.salesforceAccountId
        ? await salesforce.getAccount(workspace.salesforceAccountId).catch(() => null)
        : null;
      const owner = account ? await salesforce.getUser(account.OwnerId).catch(() => null) : null;
      ownerId = owner?.Id ?? null;
      repName = owner?.Name ?? null;
    }
    const raised = raiseAlert({
      oppId: h?.oppId ?? null,
      kind: 'payment',
      title: `Payment failed: ${customer.name}`,
      message: `${sub.last_payment_error ?? 'The payment failed.'} Subscription ${sub.id}, ${sub.currency.toUpperCase()} ${sub.amount}.${repName ? ` ${repName} owns the customer and has been told.` : ''}`,
      queue: 'credit',
      ownerLabel: null,
      due: today,
    });
    if (raised && ownerId) {
      const text = TEMPLATES.paymentFailed(customer.name, sub.last_payment_error);
      if (h) await dmRep({ Id: h.oppId, Name: h.dealName, OwnerId: ownerId }, text);
      else await dmOwner(ownerId, text);
    }
  }
}
