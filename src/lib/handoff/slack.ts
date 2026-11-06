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

export const dmRep = (opp: Opp, text: string) => dmOwner(opp.OwnerId, `${text}\n${dealRef(opp)}`);

/** Posts in #finance-billing on behalf of a person. The prefix lets us file it and tell who spoke. */
export const postAs = (
  kind: 'Rep message' | 'Finance reply',
  name: string,
  opp: Pick<Opp, 'Id' | 'Name'>,
  text: string,
) => postToFinance(opp, `${kind} from ${name}: ${text}`);

export const postToFinance = (opp: Pick<Opp, 'Id' | 'Name'>, text: string) =>
  slack.postMessage({ channel: FINANCE_CHANNEL, text: `${text}\n${dealRef(opp)}` });

// Templates. One place to change the wording.
export const TEMPLATES = {
  digest: (deals: { id: string; name: string; what: string }[]) =>
    `Your Closed Won deals that need something from you:\n${deals
      .map((d) => `• ${d.name}: ${d.what}\n${dealRef({ Id: d.id, Name: d.name })}`)
      .join('\n')}`,
  urgent: (name: string, what: string) =>
    `${name} is due today. Finance cannot bill it until this is fixed: ${what}`,
  confirmation: (name: string, what: string) => `${name}: ${what}`,
  locked: (name: string) =>
    `${name} has already been billed, so the change you just made was not applied. Create an amendment deal and finance will pick it up.`,
  askRep: (name: string, question: string) => `Finance has a question about ${name}: ${question}`,
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
}

export interface DealThread {
  oppId: string;
  messages: DealMessage[];
  /** The latest message is from a rep or about the deal by name, and finance has not answered it */
  unanswered: boolean;
}

const roleOf = (user: SlackUser | undefined): DealMessage['role'] => {
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
  // "Corvid" from "Corvid Analytics": enough to spot a mention, short enough to be a guess
  const names = deals.map((d) => ({ id: d.Id, word: d.accountName.split(/[\s&]+/)[0] ?? '' }));
  const out: Record<string, DealThread> = {};

  // Only recent messages: an old question is history, not something waiting for an answer
  const since = addDays(appToday(), -14);
  for (const { label, messages } of histories) {
    for (const m of messages as SlackMessage[]) {
      if (m.postedAt.slice(0, 10) < since) continue;
      const user = byUser.get(m.user);
      const exact = dealIdsOf(m.text);
      const guess = exact.length
        ? null
        : names.find((n) => n.word.length >= 4 && new RegExp(`\\b${n.word}\\b`, 'i').test(m.text));
      const ids = (exact.length ? exact : guess ? [guess.id] : []).filter((id) =>
        deals.some((d) => d.Id === id),
      );
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
          match: exact.length ? 'exact' : 'mentioned',
        });
      }
    }
  }
  for (const thread of Object.values(out)) {
    thread.messages.sort((a, b) => b.at.localeCompare(a.at));
    // Our own automatic messages don't count as an answer: only a person replying does
    const latest = thread.messages.find((m) => m.role !== 'app');
    thread.unanswered = !!latest && latest.role === 'rep';
  }
  return out;
}
