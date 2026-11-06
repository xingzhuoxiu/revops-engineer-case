/**
 * Our own state, kept in `db.app.closedWon`: one record per deal (what the
 * hand-off did) and one list of alerts. One Alert record covers every kind of
 * problem, so there is a single queue to look at and a single place to add cover.
 */

import { today as caseToday } from '@/lib/clock';
import { readDb, updateDb } from '@/lib/db';
import type { QueueId } from '@/lib/policy/policy';
import { addDays } from '@/lib/policy/rules';

export type HandoffStatus = 'waiting_rep' | 'waiting_finance' | 'processed' | 'ignored';

export interface Handoff {
  oppId: string;
  dealName: string;
  accountName: string;
  repName: string;
  /** Salesforce user ID of the deal owner */
  ownerId: string;
  receivedAt: string;
  status: HandoffStatus;
  /** Billing fields as they were when we processed the deal. A later difference means a change after close. */
  snapshot: Record<string, unknown> | null;
  system: 'Kleer' | 'Stripe' | null;
  workspaceId: string | null;
  subscriptionId: string | null;
  invoiceNumber: string | null;
  stripeSubscriptionId: string | null;
  processedAt: string | null;
  /** Dates we have already sent the rep an urgent message, so we only send it once */
  urgentSentOn: string | null;
}

export type AlertQueue = QueueId | 'rep';

export interface Alert {
  id: string;
  /** Null for alerts that are not about one deal, e.g. a failed card payment */
  oppId: string | null;
  title: string;
  message: string;
  queue: AlertQueue;
  /** Shown instead of the queue owner when the item is for "Finance or the sales manager" */
  ownerLabel: string | null;
  due: string | null;
  status: 'open' | 'resolved';
  createdAt: string;
  /** What raised it: a rule, a blocked step, a locked change, a failed payment, a rep message ... */
  kind: 'rule' | 'blocked' | 'locked' | 'payment' | 'unsecured' | 'rep_message';
}

interface AppState {
  handoffs: Record<string, Handoff>;
  alerts: Alert[];
  /** Demo only: days the clock has been moved forward */
  demoDays: number;
  /** Rep (Salesforce user ID) -> the last digest we sent, so we never send the same one twice in a day */
  digests: Record<string, { on: string; text: string }>;
}

const empty = (): AppState => ({ handoffs: {}, alerts: [], demoDays: 0, digests: {} });

export function readState(): AppState {
  return { ...empty(), ...((readDb().app.closedWon as Partial<AppState> | undefined) ?? {}) };
}

export function changeState<T>(change: (state: AppState) => T): T {
  return updateDb((db) => {
    const state: AppState = { ...empty(), ...((db.app.closedWon as Partial<AppState>) ?? {}) };
    const result = change(state);
    db.app.closedWon = state;
    return result;
  });
}

/** Today in the app. The case clock, plus any days the demo has moved forward. */
export function appToday(): string {
  return addDays(caseToday(), readState().demoDays);
}

export const getHandoff = (oppId: string) => readState().handoffs[oppId] ?? null;

export const saveHandoff = (h: Handoff) =>
  changeState((s) => {
    s.handoffs[h.oppId] = h;
  });

/**
 * Makes the open alerts for a deal match the problems found right now: new
 * problems are raised, ones that are fixed are resolved. Returns what is new.
 */
export function syncAlerts(
  oppId: string,
  wanted: Omit<Alert, 'id' | 'oppId' | 'status' | 'createdAt'>[],
  kinds: Alert['kind'][] = ['rule'],
): Alert[] {
  return changeState((s) => {
    const raised: Alert[] = [];
    const keep = new Set(wanted.map((w) => `${w.kind}:${w.title}`));
    for (const a of s.alerts) {
      if (a.oppId === oppId && a.status === 'open' && kinds.includes(a.kind)) {
        if (!keep.has(`${a.kind}:${a.title}`)) a.status = 'resolved';
      }
    }
    for (const w of wanted) {
      const exists = s.alerts.find(
        (a) => a.oppId === oppId && a.status === 'open' && a.kind === w.kind && a.title === w.title,
      );
      if (exists) {
        exists.message = w.message;
        exists.due = w.due;
        exists.queue = w.queue;
        continue;
      }
      const alert: Alert = {
        ...w,
        id: `AL-${s.alerts.length + 1}`,
        oppId,
        status: 'open',
        createdAt: new Date().toISOString(),
      };
      s.alerts.push(alert);
      raised.push(alert);
    }
    return raised;
  });
}

/** Raises one alert that is not tied to a deal rule (payment, locked change, rep message ...). */
export function raiseAlert(
  a: Omit<Alert, 'id' | 'status' | 'createdAt'>,
  dedupe = true,
): Alert | null {
  return changeState((s) => {
    if (
      dedupe &&
      s.alerts.some(
        (x) =>
          x.status === 'open' && x.kind === a.kind && x.oppId === a.oppId && x.title === a.title,
      )
    ) {
      return null;
    }
    const alert: Alert = {
      ...a,
      id: `AL-${s.alerts.length + 1}`,
      status: 'open',
      createdAt: new Date().toISOString(),
    };
    s.alerts.push(alert);
    return alert;
  });
}

export const resolveAlert = (id: string) =>
  changeState((s) => {
    const a = s.alerts.find((x) => x.id === id);
    if (a) a.status = 'resolved';
  });

export const openAlerts = (queue?: AlertQueue) =>
  readState().alerts.filter((a) => a.status === 'open' && (!queue || a.queue === queue));
