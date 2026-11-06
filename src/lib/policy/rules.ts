/**
 * Finance's rules (R1 to R8 in docs/context/billing-policy.md) as one pure
 * function: a deal and what we know around it go in, findings come out.
 * Nothing here calls a system, so every rule is easy to test.
 */
import type {
  OpportunityLineItem,
  SalesforceAccount,
  SalesforceOpportunity,
  Subscription,
  Workspace,
} from '@/lib/systems/types';
import type { Policy } from './policy';

/** Who has to act on a finding. Rep fixes it, a queue works it. */
export type Owner = 'rep' | 'billing' | 'credit' | 'finance_or_manager';

export interface Finding {
  rule: string;
  status: 'pass' | 'fail' | 'info';
  owner: Owner | null;
  /** One plain sentence */
  message: string;
}

export type WorkspaceMatch =
  | { kind: 'linked'; workspace: Workspace; how: 'account' | 'field' | 'domain' }
  | { kind: 'ambiguous'; candidates: Workspace[] }
  | { kind: 'none' };

/** What the rules need to know. The hand-off gathers it from the live systems. */
export interface DealContext {
  opp: SalesforceOpportunity;
  lines: OpportunityLineItem[];
  account: SalesforceAccount;
  workspaces: Workspace[];
  /** Admin app subscriptions on the account */
  subscriptions: Subscription[];
  /** The card on file for the account's existing Stripe customer, if any */
  cardOnFile: { expMonth: number; expYear: number } | null;
}

export type Verdict = 'ignored' | 'clean' | 'rep' | 'finance';

export interface Plan {
  system: 'Kleer' | 'Stripe';
  /** What is billed now: year one, or the prorated rest of the term on an add-on */
  billNow: number;
  servicePeriod: { start: string; end: string };
  /** Admin app subscription to update, for an add-on */
  updates: Subscription | null;
  /** Old subscriptions to stop renewing, when a customer moves to a new plan */
  supersedes: Subscription[];
}

export interface Evaluation {
  verdict: Verdict;
  findings: Finding[];
  /** When the owner has to act by */
  due: string | null;
  plan: Plan | null;
  workspace: WorkspaceMatch;
}

// ── small helpers ────────────────────────────────────────────

const day = (s: string) => new Date(`${s}T00:00:00Z`);
export const addDays = (s: string, n: number) => {
  const d = day(s);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysInclusive = (a: string, b: string) => Math.round((+day(b) - +day(a)) / 864e5) + 1;
const money = (n: number, cur: string) =>
  `${n.toLocaleString('en-GB', { maximumFractionDigits: 2 })} ${cur}`;

export function hostOf(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    return new URL(website).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Find the account's workspace: Salesforce account ID first, then the ID on the account, then domain. */
export function matchWorkspace(account: SalesforceAccount, all: Workspace[]): WorkspaceMatch {
  const byAccount = all.filter((w) => w.salesforceAccountId === account.Id);
  if (byAccount.length === 1 && byAccount[0]) {
    return { kind: 'linked', workspace: byAccount[0], how: 'account' };
  }
  if (byAccount.length > 1) return { kind: 'ambiguous', candidates: byAccount };
  const byField = all.find((w) => w.id === account.Workspace_ID__c);
  if (byField) return { kind: 'linked', workspace: byField, how: 'field' };
  const host = hostOf(account.Website);
  const byDomain = host ? all.filter((w) => w.domain === host && !w.salesforceAccountId) : [];
  if (byDomain.length === 1 && byDomain[0]) {
    return { kind: 'linked', workspace: byDomain[0], how: 'domain' };
  }
  if (byDomain.length > 1) return { kind: 'ambiguous', candidates: byDomain };
  return { kind: 'none' };
}

export function yearsOf(opp: SalesforceOpportunity): number {
  if (!opp.Multi_Year_deal__c) return 1;
  const months = Number.parseInt(opp.Contract_Term__c ?? '', 10);
  return Number.isFinite(months) && months >= 24 ? Math.round(months / 12) : 2;
}

/** The first-year amount: subscription lines for year one, plus any services (e.g. onboarding). */
export function firstYearAmount(ctx: DealContext) {
  const { opp, lines } = ctx;
  const licenses = opp.Number_of_Licenses__c ?? 0;
  const price = opp.Price_per_License_per_Year__c ?? 0;
  const yearly = licenses * price * (1 - (opp.Discount__c ?? 0) / 100);
  const services = lines
    .filter((l) => l.ProductCode !== opp.Plan__c)
    .reduce((sum, l) => sum + l.TotalPrice, 0);
  return { yearly, services, firstYear: yearly + services };
}

// ── what a rep can do about each rule ────────────────────────

export const FIX: Record<string, { what: string; how: string; where: string }> = {
  R8: {
    what: 'Amount does not match licenses x price x discount',
    how: 'Correct the amount, the licenses or the discount so they agree with the price book.',
    where: 'Opportunity > Amount',
  },
  Lines: {
    what: 'License count differs between the deal and its product line',
    how: 'Make Number of Licenses and the product line quantity match.',
    where: 'Opportunity > Products',
  },
  Currency: {
    what: 'Deal currency differs from the account currency',
    how: 'Use the account currency, or ask finance to change the account.',
    where: 'Opportunity > Currency',
  },
  R2: {
    what: 'Card payment is above the card limit',
    how: 'Change Payment Method to Invoice, or reduce the first-year amount.',
    where: 'Opportunity > Payment Method',
  },
  R4: {
    what: 'Billing details missing',
    how: 'Ask the customer for them and fill them in on the account.',
    where: 'Account > Billing details',
  },
  R3: {
    what: 'Purchase order missing',
    how: 'Ask the customer for their PO number and add it. Billing cannot invoice without it.',
    where: 'Opportunity > PO Number',
  },
  VAT: {
    what: 'VAT ID looks wrong',
    how: 'Check the VAT ID with the customer. EU IDs start with the country code, then digits.',
    where: 'Account > VAT Number',
  },
  Dates: {
    what: 'Start date is before the close date',
    how: 'Set a start date on or after the close date, or ask finance to approve backdating.',
    where: 'Opportunity > Start Date',
  },
};

// ── the rules ────────────────────────────────────────────────

export function evaluateDeal(ctx: DealContext, policy: Policy): Evaluation {
  const { opp, account, lines } = ctx;
  const findings: Finding[] = [];
  const add = (rule: string, status: Finding['status'], owner: Owner | null, message: string) =>
    findings.push({ rule, status, owner, message });
  const workspace = matchWorkspace(account, ctx.workspaces);

  if (opp.StageName !== 'Closed Won') {
    add(
      'Stage',
      'info',
      null,
      `Stage is ${opp.StageName}. Ignored until the deal is Closed Won again.`,
    );
    return { verdict: 'ignored', findings, due: null, plan: null, workspace };
  }

  const cur = opp.CurrencyIsoCode;
  const years = yearsOf(opp);
  const licenses = opp.Number_of_Licenses__c ?? 0;
  const { yearly, services, firstYear } = firstYearAmount(ctx);
  const price = opp.Price_per_License_per_Year__c ?? 0;
  const expected = yearly * years + services;
  const method = opp.Payment_Method__c === 'Card' ? 'Card' : 'Invoice';
  const system = method === 'Card' ? 'Stripe' : 'Kleer';

  // R8: the amount is licenses x price x (1 - discount)
  const planLine = lines.find((l) => l.ProductCode === opp.Plan__c);
  const lineMismatch = planLine && planLine.Quantity !== licenses;
  // If the amount follows the product line, the real problem is the license count, so say that once
  const amountFollowsLine =
    lineMismatch &&
    Math.abs(
      (opp.Amount ?? 0) -
        (planLine.Quantity * price * (1 - (opp.Discount__c ?? 0) / 100) * years + services),
    ) <= 0.5;
  if (lineMismatch) {
    add(
      'Lines',
      'fail',
      'rep',
      `Deal says ${licenses} licenses, the product line${amountFollowsLine ? ' and the amount say' : ' says'} ${planLine.Quantity}.`,
    );
  }
  if (amountFollowsLine) {
    add('R8', 'info', null, 'The amount matches the product line.');
  } else if (Math.abs(expected - (opp.Amount ?? 0)) > 0.5) {
    add(
      'R8',
      'fail',
      'rep',
      `Amount is ${money(opp.Amount ?? 0, cur)}, the price book gives ${money(expected, cur)}.`,
    );
  } else {
    add('R8', 'pass', null, `Amount checks out at ${money(expected, cur)}.`);
  }

  if (cur !== account.CurrencyIsoCode) {
    add(
      'Currency',
      'fail',
      'rep',
      `Deal is in ${cur}, the account is in ${account.CurrencyIsoCode}. Kleer would bill the wrong currency.`,
    );
  } else {
    add('Currency', 'pass', null, `Deal and account both in ${cur}.`);
  }

  // R1: where it is billed
  add('R1', 'info', null, `Payment method ${method}, so billing goes to ${system}.`);

  // R2: card limit
  const firstYearEur = firstYear * (policy.fxToEur[cur] ?? 1);
  if (method === 'Card' && firstYearEur > policy.cardLimitEur) {
    add(
      'R2',
      'fail',
      'rep',
      `Card payment of about ${Math.round(firstYearEur).toLocaleString('en-GB')} EUR is above the ${policy.cardLimitEur.toLocaleString('en-GB')} EUR card limit. It must be invoiced.`,
    );
  } else {
    add(
      'R2',
      'pass',
      null,
      method === 'Card' ? 'Card amount is within the limit.' : 'Invoice deal, no card limit.',
    );
  }

  // Discount: Finance or the sales manager reviews, because it affects commission
  const discount = opp.Discount__c ?? 0;
  if (discount > policy.discountApprovalPct && opp.Discount_Approval__c !== 'Approved') {
    add(
      'Discount',
      'fail',
      'finance_or_manager',
      `Discount is ${discount}% and approval is ${opp.Discount_Approval__c ?? 'missing'}. Needs review before booking.`,
    );
  } else {
    add('Discount', 'pass', null, `Discount ${discount}%.`);
  }

  // R3: PO
  if (method === 'Invoice' && account.PO_Required__c && !opp.PO_Number__c) {
    if (policy.poExceptionForExistingCustomers && account.Type === 'Customer') {
      add(
        'R3',
        'info',
        null,
        'PO missing, but the PO exception for existing customers is on. Invoice goes out, PO chased afterwards.',
      );
    } else {
      add(
        'R3',
        'fail',
        'billing',
        'The account requires a PO and there is none on the deal. Nothing goes to Kleer until there is one.',
      );
    }
  } else {
    add('R3', 'pass', null, account.PO_Required__c ? 'PO present.' : 'No PO required.');
  }

  // R4: what an invoice needs
  if (method === 'Invoice') {
    const missing: string[] = [];
    if (!account.Legal_Entity_Name__c) missing.push('legal entity name');
    if (!account.Invoice_Email__c) missing.push('billing email');
    const country = account.BillingCountry;
    if (policy.vatRequiredCountries.includes(country) && !account.VAT_Number__c) {
      missing.push('VAT ID (EU customer outside Sweden)');
    }
    if (missing.length) add('R4', 'fail', 'rep', `Missing for invoicing: ${missing.join(', ')}.`);
    else add('R4', 'pass', null, 'Invoice details complete.');
    const format = policy.vatFormats[country];
    if (account.VAT_Number__c && format && !new RegExp(format).test(account.VAT_Number__c)) {
      add(
        'VAT',
        'fail',
        'rep',
        `VAT ID ${account.VAT_Number__c} does not look like a ${country} VAT ID. Kleer would work out VAT wrongly.`,
      );
    }
  }

  // Dates
  const start = opp.Start_Date__c;
  const end = opp.End_Date__c;
  if (!start || !end) {
    add('Dates', 'fail', 'rep', 'Start or end date is missing.');
  } else if (start < opp.CloseDate) {
    add(
      'Dates',
      'fail',
      'rep',
      `Start date ${start} is before the close date ${opp.CloseDate}. The service period would be backdated.`,
    );
  } else {
    add('Dates', 'pass', null, `Service period ${start} to ${end}.`);
  }

  // R6, R7: what happens to existing subscriptions
  const live = ctx.subscriptions.filter((s) => s.status === 'Active' || s.status === 'Scheduled');
  let updates: Subscription | null = null;
  let supersedes: Subscription[] = [];
  let billNow = firstYear;
  let periodEnd = end ?? '';
  if (opp.RecordType.DeveloperName === 'Add_on') {
    updates = live.find((s) => s.plan === opp.Plan__c) ?? null;
    if (!updates) {
      add(
        'R6',
        'fail',
        'billing',
        'This is an add-on but there is no active subscription to add to.',
      );
    } else if (start) {
      periodEnd = updates.endDate;
      const days = daysInclusive(start, updates.endDate);
      billNow = (firstYear * days) / 365;
      add(
        'R6',
        'info',
        null,
        `Add-on: update ${updates.id}, co-termed to ${updates.endDate}. Billed ${days}/365 of a year: ${money(billNow, cur)}.`,
      );
    }
  } else if (opp.RecordType.DeveloperName === 'Renewal') {
    add(
      'R6',
      'info',
      null,
      'Renewal: a new term is booked from the start date and the old one stops renewing.',
    );
    supersedes = live;
  } else if (live.length > 0) {
    supersedes = live;
    add(
      'R7',
      'info',
      null,
      `Customer already has ${live.map((s) => s.id).join(', ')}. It will stop renewing so they are not billed twice.`,
    );
  }
  if (years > 1 && start) {
    const paidUpfront = opp.Multi_Year_Payment_Terms__c === 'Paid upfront';
    if (paidUpfront) billNow = firstYear + yearly * (years - 1);
    periodEnd = paidUpfront
      ? (end ?? '')
      : addDays(
          start.replace(/^(\d{4})/, (y) => String(+y + 1)),
          -1,
        );
    add(
      'Multi-year',
      'info',
      null,
      `${years}-year deal, ${paidUpfront ? 'paid upfront' : 'invoiced annually'}. Billed now: ${money(billNow, cur)}.`,
    );
  }

  // Other systems: workspace and payment
  if (workspace.kind === 'ambiguous') {
    const names = workspace.candidates.map((w) => `${w.id} ${w.name}`).join(' and ');
    add(
      'Workspace',
      'fail',
      'billing',
      `More than one workspace could belong to this account: ${names}. Someone must pick one.`,
    );
  }
  if (method === 'Card' && ctx.cardOnFile) {
    const { expMonth, expYear } = ctx.cardOnFile;
    const [y, m] = [Number(ctx.opp.CloseDate.slice(0, 4)), Number(ctx.opp.CloseDate.slice(5, 7))];
    if (expYear < y || (expYear === y && expMonth < m)) {
      add(
        'Payment',
        'fail',
        'credit',
        `The card on file expired ${expMonth}/${expYear}. Billing is not secured.`,
      );
    }
  }

  // R5 is kept by the hand-off: one opportunity ID, one subscription, one invoice or charge.
  add(
    'R5',
    'pass',
    null,
    'The opportunity ID is the idempotency key, so a repeated event creates nothing twice.',
  );

  const fails = findings.filter((f) => f.status === 'fail');
  const verdict: Verdict =
    fails.length === 0 ? 'clean' : fails.some((f) => f.owner === 'rep') ? 'rep' : 'finance';
  const due =
    verdict === 'clean'
      ? null
      : verdict === 'rep'
        ? addDays(opp.CloseDate, policy.repDeadlineDays)
        : addDays(start ?? opp.CloseDate, -policy.financeDeadlineDaysBeforeStart);
  const plan: Plan | null =
    verdict === 'clean' && start
      ? {
          system,
          billNow,
          servicePeriod: { start, end: periodEnd || end || start },
          updates,
          supersedes,
        }
      : null;
  return { verdict, findings, due, plan, workspace };
}
