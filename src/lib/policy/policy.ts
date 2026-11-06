/**
 * Finance's rules as data. Finance edits these on the admin app's Rules tab,
 * the code only reads them. Saved in `db.app.policy`, with a change log.
 *
 * Everything here is a setting, not logic, so a rule can change without a deploy.
 */
import { readDb, updateDb } from '@/lib/db';

export type QueueId = 'billing' | 'credit';

export interface Queue {
  name: string;
  owner: string;
  backup: string;
  /** When on, alerts go to the backup instead */
  away: boolean;
}

export interface Policy {
  /** R2: card is allowed up to this first-year amount, in EUR */
  cardLimitEur: number;
  /** Above this discount, Deal Desk has to approve the deal before it is booked */
  discountApprovalPct: number;
  /** A rep has this many days after Closed Won to fix their part */
  repDeadlineDays: number;
  /** A deal still waiting on its rep this many days after close goes into the sales manager's weekly update */
  managerEscalationDays: number;
  /** Who gets the weekly update. There is no sales manager in the case, so this is a setting. */
  salesManager: string;
  /** Finance items are due this many days before the start date */
  financeDeadlineDaysBeforeStart: number;
  /** Warn when billing is still not secured this many days before the start date */
  escalateDaysBeforeStart: number;
  /** R3: skip the PO check for existing customers. Off until Finance decides. */
  poExceptionForExistingCustomers: boolean;
  /** "review": Billing previews and sends each invoice. "auto": sent straight away. */
  invoiceSendMode: 'review' | 'auto';
  /** Rough FX, only used to compare a card amount with the EUR limit */
  fxToEur: Record<string, number>;
  /** EU countries where an invoice needs a VAT ID (Sweden is not one of them) */
  vatRequiredCountries: string[];
  /** Shape of a valid VAT ID per country */
  vatFormats: Record<string, string>;
  queues: Record<QueueId, Queue>;
}

export const DEFAULT_POLICY: Policy = {
  cardLimitEur: 10000,
  discountApprovalPct: 25,
  repDeadlineDays: 2,
  managerEscalationDays: 5,
  // Placeholder: the case has no sales manager, and Kim is the only manager role. Set the real one.
  salesManager: 'Kim Andersson',
  financeDeadlineDaysBeforeStart: 3,
  escalateDaysBeforeStart: 3,
  poExceptionForExistingCustomers: false,
  invoiceSendMode: 'review',
  fxToEur: { EUR: 1, SEK: 0.092, USD: 0.92, GBP: 1.15, CHF: 1.05, NOK: 0.085, DKK: 0.134 },
  vatRequiredCountries: [
    'Austria',
    'Belgium',
    'Bulgaria',
    'Croatia',
    'Cyprus',
    'Czechia',
    'Denmark',
    'Estonia',
    'Finland',
    'France',
    'Germany',
    'Greece',
    'Hungary',
    'Ireland',
    'Italy',
    'Latvia',
    'Lithuania',
    'Luxembourg',
    'Malta',
    'Netherlands',
    'Poland',
    'Portugal',
    'Romania',
    'Slovakia',
    'Slovenia',
    'Spain',
  ],
  vatFormats: {
    Germany: '^DE\\d{9}$',
    Ireland: '^IE\\d{7}[A-Z]{1,2}$',
    Spain: '^ES[A-Z0-9]\\d{7}[A-Z0-9]$',
    France: '^FR[A-Z0-9]{2}\\d{9}$',
    Netherlands: '^NL\\d{9}B\\d{2}$',
    Denmark: '^DK\\d{8}$',
    Austria: '^ATU\\d{8}$',
    Sweden: '^SE\\d{12}$',
    Norway: '^NO\\d{9}MVA$',
    'United Kingdom': '^GB\\d{9}$',
    Switzerland: '^CHE-\\d{3}\\.\\d{3}\\.\\d{3} (MWST|TVA|IVA)$',
  },
  // Suggested by me, not from the case: who owns each queue and who covers.
  queues: {
    billing: { name: 'Billing', owner: 'Maja Ek', backup: 'Tom Becker', away: false },
    credit: { name: 'Credit Control', owner: 'Tom Becker', backup: 'Maja Ek', away: false },
  },
};

export interface PolicyChange {
  at: string;
  by: string;
  change: string;
}

interface Stored {
  current?: Policy;
  log?: PolicyChange[];
}

const stored = (): Stored => (readDb().app.policy as Stored | undefined) ?? {};

export function getPolicy(): Policy {
  const current = stored().current;
  // Merge over the defaults so a new setting never breaks an older saved policy
  return current
    ? { ...DEFAULT_POLICY, ...current, queues: { ...DEFAULT_POLICY.queues, ...current.queues } }
    : DEFAULT_POLICY;
}

export function getPolicyLog(): PolicyChange[] {
  return stored().log ?? [];
}

const LABELS: Partial<Record<keyof Policy, string>> = {
  cardLimitEur: 'Card limit (EUR)',
  discountApprovalPct: 'Discount needing Deal Desk approval (%)',
  repDeadlineDays: 'Rep deadline (days after close)',
  managerEscalationDays: 'Sales manager update after (days since close)',
  salesManager: 'Sales manager',
  financeDeadlineDaysBeforeStart: 'Finance deadline (days before start)',
  escalateDaysBeforeStart: 'Escalate unsecured billing (days before start)',
  poExceptionForExistingCustomers: 'PO exception for existing customers',
  invoiceSendMode: 'Invoice sending',
};

/** Saves the policy and writes what changed to the log. */
export function savePolicy(next: Policy, by = 'Maja Ek'): PolicyChange[] {
  const before = getPolicy();
  const changes: PolicyChange[] = [];
  const at = new Date().toISOString();
  for (const key of Object.keys(LABELS) as (keyof Policy)[]) {
    if (before[key] !== next[key]) {
      changes.push({ at, by, change: `${LABELS[key]}: ${before[key]} to ${next[key]}` });
    }
  }
  for (const id of Object.keys(next.queues) as QueueId[]) {
    const a = before.queues[id];
    const b = next.queues[id];
    if (a.owner !== b.owner || a.backup !== b.backup || a.away !== b.away) {
      const text = `${b.name} queue: ${b.owner}, backup ${b.backup}${b.away ? ', owner away' : ''}`;
      changes.push({ at, by, change: text });
    }
  }
  updateDb((db) => {
    const old = (db.app.policy as Stored | undefined) ?? {};
    db.app.policy = { current: next, log: [...changes, ...(old.log ?? [])].slice(0, 50) };
  });
  return changes;
}

/** Who gets an alert in a queue today: the owner, or the backup when the owner is away. */
export function assignee(policy: Policy, queue: QueueId) {
  const q = policy.queues[queue];
  return q.away ? { name: q.backup, covering: q.owner } : { name: q.owner, covering: null };
}
