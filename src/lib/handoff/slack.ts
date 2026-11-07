/**
 * One Slack sender for every message, with templates, and the grouping of
 * Slack messages by deal.
 *
 * Slack cannot regroup a channel, so every message we send carries the deal's
 * opportunity ID. That is how a message is filed under its deal in the admin
 * app. Messages written by hand that mention a customer by name are shown as
 * "may be about this deal" only: they are suggestions, never alerts.
 */
import { cache } from 'react';
import { salesforce, slack } from '@/lib/connectors';
import { addDays } from '@/lib/policy/rules';
import type { SalesforceOpportunity, SlackMessage, SlackUser } from '@/lib/systems/types';
import { appToday } from './store';

export const FINANCE_CHANNEL = 'finance-billing';
export const DEAL_DESK_CHANNEL = 'deal-desk';
const SLACK_CHANNELS = ['finance-billing', 'deal-desk', 'revops-help'];
const FINANCE_TITLES = ['Billing Specialist', 'Credit Controller'];

/** The line every message about a deal ends with. Parsed back out by `dealIdOf`. */
export const dealRef = (opp: Pick<SalesforceOpportunity, 'Id' | 'Name'>) => `Deal ${opp.Id}`;
const REF = /Deal (006[A-Za-z0-9]{12,15})/g;
/** Every deal a message points at. A daily digest can list several. */
export const dealIdsOf = (text: string) => [...text.matchAll(REF)].map((m) => m[1] as string);

type Opp = Pick<SalesforceOpportunity, 'Id' | 'Name' | 'OwnerId'>;

/** A direct message to a Salesforce user, found in Slack through their work email. Silent if they are not in Slack. */
export async function dmOwner(ownerId: string, text: string) {
  try {
    const owner = await salesforce.getUser(ownerId);
    const user: SlackUser = await slack.lookupUserByEmail(owner.Email);
    return await slack.postMessage({ channel: user.id, text });
  } catch {
    return null;
  }
}

/** A Slack mention of a Salesforce user, so they get a notification. Empty if they are not in Slack. */
export async function mentionOf(ownerId: string): Promise<string> {
  try {
    const owner = await salesforce.getUser(ownerId);
    const user: SlackUser = await slack.lookupUserByEmail(owner.Email);
    return `<@${user.id}>`;
  } catch {
    return '';
  }
}

export const dmRep = (opp: Opp, text: string) => dmOwner(opp.OwnerId, `${text}\n${dealRef(opp)}`);

/** Posts in #finance-billing on behalf of a person. The prefix lets us file it and tell who spoke. */
export const postAs = (
  kind: 'Rep message' | 'Finance reply',
  name: string,
  opp: Pick<Opp, 'Id' | 'Name'>,
  text: string,
  /** Reply where the question was asked: that channel, in that thread. Default is #finance-billing. */
  target?: { channel: string; threadTs?: string },
) =>
  target
    ? slack.postMessage({
        channel: target.channel,
        text: `${kind} from ${name}: ${text}\n${dealRef(opp)}`,
        thread_ts: target.threadTs,
      })
    : postToFinance(opp, `${kind} from ${name}: ${text}`);

export const postToFinance = (opp: Pick<Opp, 'Id' | 'Name'>, text: string) =>
  slack.postMessage({ channel: FINANCE_CHANNEL, text: `${text}\n${dealRef(opp)}` });

/** Posts in #deal-desk, where discounts are approved. */
export const postToDealDesk = (opp: Pick<Opp, 'Id' | 'Name'>, text: string) =>
  slack.postMessage({ channel: DEAL_DESK_CHANNEL, text: `${text}\n${dealRef(opp)}` });

// Templates. One place to change the wording.
export const TEMPLATES = {
  digest: (deals: { id: string; name: string; what: string }[], managerNote = '') =>
    `Your Closed Won deals that need something from you:\n${deals
      .map((d) => `• ${d.name}: ${d.what}\n${dealRef({ Id: d.id, Name: d.name })}`)
      .join('\n')}${managerNote}`,
  urgent: (name: string, what: string) =>
    `${name} is due today. Finance cannot bill it until this is fixed: ${what}`,
  confirmation: (name: string, what: string) => `${name}: ${what}`,
  locked: (name: string) =>
    `${name} has already been billed, so the change you just made was not applied. Create an amendment deal and finance will pick it up.`,
  askRep: (name: string, question: string) => `Finance has a question about ${name}: ${question}`,
  managerUpdate: (
    rows: { rep: string; deal: string; value: string; what: string; days: number }[],
    total: string,
  ) => {
    const reps = [...new Set(rows.map((r) => r.rep))];
    return `Weekly update: ${rows.length} closed ${rows.length === 1 ? 'deal is' : 'deals are'} not booked by finance because the rep has not fixed something. They count in the forecast (about ${total}) but cannot be processed.\n${reps
      .map(
        (rep) =>
          `${rep}\n${rows
            .filter((r) => r.rep === rep)
            .map((r) => `  • ${r.deal} (${r.value}): ${r.what}, ${r.days} days since close`)
            .join('\n')}`,
      )
      .join('\n')}`;
  },
  processed: (name: string, what: string) => `${name} is processed: ${what}`,
  withFinance: (name: string, what: string, due: string | null) =>
    `${name} is with finance. They are waiting on: ${what}.${due ? ` Due ${due}.` : ''} Nothing for you to do unless they ask.`,
  approvalRequested: (
    oppId: string,
    name: string,
    pct: number | null,
    licenses: number | null,
    rep: string,
  ) =>
    `Discount approval requested for ${name}: ${pct}% on ${licenses} licenses, from ${rep}. Approve or reject on the deal in Salesforce: </deals/${oppId}|${name}>`,
  approved: (name: string) =>
    `Deal Desk approved the discount on ${name}. Finance can book it now.`,
  rejected: (name: string) =>
    `Deal Desk did not approve the discount on ${name}. Change the discount on the deal and request approval again.`,
  paid: (name: string, invoice: string) => `${name}: invoice ${invoice} has been paid.`,
  overdue: (name: string, invoice: string, due: string) =>
    `Invoice ${invoice} for ${name} was due ${due} and is not paid. Credit Control is on it. A word from you to the customer would help.`,
  paymentFailed: (customer: string, error?: string) =>
    `The card payment for ${customer} failed${error ? `: ${error}` : ''}. Credit Control is on it. The customer may lose access, so it's worth asking them to update their card.`,
};

// ── Messages by deal ─────────────────────────────────────────

export interface DealMessage {
  ts: string;
  at: string;
  channel: string;
  author: string;
  role: 'rep' | 'finance' | 'app' | 'other';
  text: string;
  /** "exact": the message carries the deal ID. "mentioned": it only names the customer. */
  match: 'exact' | 'mentioned';
  /** The message this one replies to, in a thread */
  threadTs: string | null;
}

/** Ends a status reply that still needs a person, so it doesn't count as an answer. */
export const NEEDS_PERSON = 'A person still has to decide.';

/** Which of these deals a message is about: by deal ID, or failing that by the customer's name. */
export function matchDeals(text: string, deals: { Id: string; accountName: string }[]) {
  const exact = dealIdsOf(text).filter((id) => deals.some((d) => d.Id === id));
  if (exact.length) return { ids: exact, exact: true };
  // "Corvid" from "Corvid Analytics": enough to spot a mention, short enough to be a guess
  const guess = deals.find((d) => {
    const word = d.accountName.split(/[\s&]+/)[0] ?? '';
    return word.length >= 4 && new RegExp(`\\b${word}\\b`, 'i').test(text);
  });
  return { ids: guess ? [guess.Id] : [], exact: false };
}

/** A reply in the same thread as a person's message. Filed under the deal like everything else. */
export const postThreadReply = (
  channel: string,
  threadTs: string,
  opp: Pick<Opp, 'Id' | 'Name'>,
  text: string,
) => slack.postMessage({ channel, text: `${text}\n${dealRef(opp)}`, thread_ts: threadTs });

export interface DealThread {
  oppId: string;
  messages: DealMessage[];
  /** The latest message is from a rep or about the deal by name, and finance has not answered it */
  unanswered: boolean;
}

export const roleOf = (user: SlackUser | undefined): DealMessage['role'] => {
  if (!user) return 'other';
  if (user.is_bot) return 'app';
  if (FINANCE_TITLES.includes(user.title)) return 'finance';
  if (/Account Executive|Relationship Manager|Customer Success/.test(user.title)) return 'rep';
  return 'other';
};

/**
 * Reads the channels (and the direct messages our app has sent) and files each
 * message under its deal. `deals` are the deals to look for.
 */
/**
 * Everything we read from Slack, fetched once per page request. `cache` makes
 * repeat calls during one render share the result, so a page that shows
 * messages in two places doesn't read every channel twice.
 */
export const slackUsers = cache(() => slack.listUsers());

const readSlack = cache(async () => {
  const [channels, users, dms] = await Promise.all([
    slack.listChannels(),
    slack.listUsers(),
    slack.listDirectMessages(),
  ]);
  const wanted = channels.filter((c) => SLACK_CHANNELS.includes(c.name));
  const histories = await Promise.all([
    ...wanted.map(async (c) => ({ label: `#${c.name}`, messages: await slack.history(c.id) })),
    ...dms.map(async (d) => ({ label: 'DM', messages: await slack.history(d.id) })),
  ]);
  return { users, histories };
});

export async function messagesByDeal(
  deals: { Id: string; accountName: string }[],
): Promise<Record<string, DealThread>> {
  const { users, histories } = await readSlack();
  const byUser = new Map(users.map((u) => [u.id, u]));
  const out: Record<string, DealThread> = {};

  // Only recent messages: an old question is history, not something waiting for an answer
  const since = addDays(appToday(), -14);
  for (const { label, messages } of histories) {
    for (const m of messages as SlackMessage[]) {
      if (m.postedAt.slice(0, 10) < since) continue;
      const user = byUser.get(m.user);
      const { ids, exact } = matchDeals(m.text, deals);
      // Our app posts as one bot. A prefix says whether a rep or finance is speaking.
      const onBehalf = /^(Rep message|Finance reply) from ([^:]+): /.exec(m.text);
      const fromApp = m.user === 'U04HANDOFF';
      const role: DealMessage['role'] = !fromApp
        ? roleOf(user)
        : onBehalf?.[1] === 'Rep message'
          ? 'rep'
          : onBehalf?.[1] === 'Finance reply'
            ? 'finance'
            : 'app';
      for (const oppId of ids) {
        const thread = out[oppId] ?? { oppId, messages: [], unanswered: false };
        out[oppId] = thread;
        thread.messages.push({
          ts: m.ts,
          at: m.postedAt,
          channel: label,
          author: fromApp ? (onBehalf?.[2] ?? 'MentOS') : (user?.real_name ?? m.user),
          role,
          text: m.text
            .replace(onBehalf?.[0] ?? '', '')
            .replace(REF, '')
            .replace(/\n\s*\n/g, '\n')
            .trim(),
          match: exact ? 'exact' : 'mentioned',
          threadTs: m.threadTs,
        });
      }
    }
  }
  for (const thread of Object.values(out)) {
    thread.messages.sort((a, b) => b.at.localeCompare(a.at));
    // Our own automatic messages don't count as an answer: only a person replying does
    const latest = thread.messages.find((m) => m.role !== 'app');
    // The app's status reply in the thread is an answer, unless it says a person still has to decide
    const answeredByApp = thread.messages.some(
      (m) => m.role === 'app' && m.threadTs === latest?.ts && !m.text.includes(NEEDS_PERSON),
    );
    thread.unanswered = !!latest && latest.role === 'rep' && !answeredByApp;
  }
  return out;
}
