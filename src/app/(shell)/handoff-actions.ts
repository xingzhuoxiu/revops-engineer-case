'use server';

import { revalidatePath } from 'next/cache';
import { demoFix } from '@/lib/handoff/demo';
import {
  advanceDays,
  askRep,
  decideApproval,
  requestApproval,
  financeReply,
  moveToClosedWon,
  recheck,
  repMessageFinance,
  saveBillingDetails,
  sendInvoice,
} from '@/lib/handoff/run';
import {
  DEFAULT_POLICY,
  getPolicy,
  type Policy,
  type QueueId,
  savePolicy,
} from '@/lib/policy/policy';

const text = (f: FormData, key: string) => String(f.get(key) ?? '').trim();
const number = (f: FormData, key: string, fallback: number) => {
  const n = Number(f.get(key));
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};
const refresh = () => revalidatePath('/', 'layout');

// ── Rep (Salesforce deal page) ───────────────────────────────

export async function checkAgain(f: FormData) {
  await recheck(text(f, 'oppId'));
  refresh();
}

/**
 * The rep edits the billing details on the deal. They are saved to Salesforce,
 * and if the deal was already sent, the check runs again. In a real Salesforce
 * the save would fire an update event, and the same check would run from that.
 */
export async function saveBilling(f: FormData) {
  await saveBillingDetails(text(f, 'oppId'), {
    method: text(f, 'method'),
    po: text(f, 'po'),
    legal: text(f, 'legal'),
    vat: text(f, 'vat'),
    email: text(f, 'email'),
  });
  refresh();
}

/** Demo only: moves an open deal to Closed Won, filled in or not, and sends the event. */
export async function closeDeal(f: FormData) {
  await moveToClosedWon(text(f, 'oppId'));
  refresh();
}

export async function messageFinance(f: FormData) {
  if (text(f, 'text')) await repMessageFinance(text(f, 'oppId'), text(f, 'text'));
  refresh();
}

/** Demo only: does what the rep would do in Salesforce, then checks the deal again. */
export async function pretendFixed(f: FormData) {
  await demoFix(text(f, 'oppId'));
  refresh();
}

// ── Finance (Admin app) ──────────────────────────────────────

export async function sendInvoiceAction(f: FormData) {
  await sendInvoice(text(f, 'oppId'));
  refresh();
}

export async function askRepAction(f: FormData) {
  if (text(f, 'text')) await askRep(text(f, 'oppId'), text(f, 'text'));
  refresh();
}

export async function requestApprovalAction(f: FormData) {
  await requestApproval(text(f, 'oppId'));
  refresh();
}

export async function decideApprovalAction(f: FormData) {
  const decision = text(f, 'decision') === 'Rejected' ? 'Rejected' : 'Approved';
  await decideApproval(text(f, 'oppId'), decision);
  refresh();
}

export async function replyAction(f: FormData) {
  // Reply where the rep asked: the same channel and thread. Without one, #finance-billing.
  const channel = text(f, 'channel');
  const target = channel ? { channel, threadTs: text(f, 'threadTs') || undefined } : undefined;
  if (text(f, 'text')) {
    await financeReply(text(f, 'oppId'), text(f, 'text'), undefined, target);
  }
  refresh();
}

export async function savePolicyAction(f: FormData) {
  const current = getPolicy();
  const next: Policy = {
    ...current,
    cardLimitEur: number(f, 'cardLimitEur', current.cardLimitEur),
    discountApprovalPct: number(f, 'discountApprovalPct', current.discountApprovalPct),
    repDeadlineDays: number(f, 'repDeadlineDays', current.repDeadlineDays),
    managerEscalationDays: number(f, 'managerEscalationDays', current.managerEscalationDays),
    salesManager: text(f, 'salesManager') || current.salesManager,
    financeDeadlineDaysBeforeStart: number(
      f,
      'financeDeadlineDaysBeforeStart',
      current.financeDeadlineDaysBeforeStart,
    ),
    escalateDaysBeforeStart: number(f, 'escalateDaysBeforeStart', current.escalateDaysBeforeStart),
    poExceptionForExistingCustomers: f.get('poExceptionForExistingCustomers') === 'on',
    invoiceSendMode: text(f, 'invoiceSendMode') === 'auto' ? 'auto' : 'review',
    queues: Object.fromEntries(
      (Object.keys(DEFAULT_POLICY.queues) as QueueId[]).map((id) => [
        id,
        {
          ...current.queues[id],
          owner: text(f, `${id}.owner`) || current.queues[id].owner,
          backup: text(f, `${id}.backup`) || current.queues[id].backup,
          away: f.get(`${id}.away`) === 'on',
        },
      ]),
    ) as Policy['queues'],
  };
  savePolicy(next);
  refresh();
}

/** Demo only: moves the clock forward, then runs the daily sweep. */
export async function advanceAction(f: FormData) {
  await advanceDays(number(f, 'days', 7));
  refresh();
}
