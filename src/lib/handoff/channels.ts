/**
 * Requests that reps type into the Slack channels. Nothing is turned into an
 * item in the admin app, and the app does not answer on its own. Finance answers, with
 * a draft ready on the deal (see drafts.ts). If nobody has replied after one business
 * day, the app reminds the channel's owner in the same thread, once.
 *
 * In a real Slack this would run on Slack's Events API. The mock has no event
 * feed, so it reads channel history in the daily check.
 */
import { slack } from '@/lib/connectors';
import { addDays } from '@/lib/policy/rules';
import { matchDeals, NEEDS_PERSON, postThreadReply, roleOf } from './slack';
import { appToday, type Handoff, markChannelDone, readState } from './store';

/** Who to remind when a request in a channel is waiting on a person. */
const CHANNEL_OWNER: Record<string, string> = {
  'finance-billing': 'Billing (<@U04MAJAEK0>)',
  'deal-desk': 'Deal Desk',
  'revops-help': 'RevOps (<@U04KIMANDS>)',
};

const BILLING_WORDS: Record<string, string> = {
  Draft: 'The invoice is drafted and Billing will send it.',
  Sent: 'The invoice has been sent. Waiting for payment.',
  Paid: 'The invoice has been paid.',
  Overdue: 'The invoice is overdue. Credit Control is on it.',
  'Paid by card': 'The card has been charged.',
  'Payment failed': 'The card payment failed. Credit Control is on it.',
};

/** The deal's status in one or two plain sentences, and whether it still needs a person. */
export function statusReply(h: Handoff | undefined, dealName: string) {
  const alerts = readState().alerts.filter((a) => a.oppId === h?.oppId && a.status === 'open');
  if (!h || h.status === 'ignored') {
    return { text: `${dealName}: not with finance yet.`, needsPerson: false };
  }
  if (h.status === 'waiting_rep') {
    const what = alerts
      .filter((a) => a.queue === 'rep')
      .map((a) => a.message)
      .join(' ');
    return {
      text: `${dealName}: waiting on you. ${what} Fix it on the deal and it goes through on its own.`,
      needsPerson: false,
    };
  }
  if (h.status === 'waiting_finance') {
    const what = alerts
      .filter((a) => a.queue !== 'rep')
      .map((a) => a.title.toLowerCase())
      .join(', ');
    return {
      text: `${dealName}: with finance, waiting on ${what || 'a decision'}. Nothing for you to do unless asked. ${NEEDS_PERSON}`,
      needsPerson: true,
    };
  }
  const billing = h.written?.Invoice_Status__c ?? '';
  return {
    text: `${dealName}: processed. ${BILLING_WORDS[billing] ?? 'Everything is set up.'}`,
    needsPerson: false,
  };
}

export async function answerChannels() {
  const state = readState();
  const deals = Object.values(state.handoffs).map((h) => ({
    Id: h.oppId,
    accountName: h.accountName,
  }));
  if (deals.length === 0) return;
  const today = appToday();
  const since = addDays(today, -14);
  const [channels, users] = await Promise.all([slack.listChannels(), slack.listUsers()]);
  const byUser = new Map(users.map((u) => [u.id, u]));

  for (const channel of channels.filter((c) => c.name in CHANNEL_OWNER)) {
    const messages = await slack.history(channel.id);
    for (const m of messages) {
      const day = m.postedAt.slice(0, 10);
      if (day < since || m.threadTs || m.user === 'U04HANDOFF') continue;
      // Only reps asking. Finance and RevOps talking to each other are left alone.
      if (roleOf(byUser.get(m.user)) !== 'rep') continue;
      const { ids } = matchDeals(m.text, deals);
      const oppId = ids[0];
      const h = oppId ? state.handoffs[oppId] : undefined;
      if (!oppId || !h) continue;
      const opp = { Id: oppId, Name: h.dealName };

      // Nothing is posted for the rep's question. Finance gets a draft on the deal, to read and send.
      // If nobody has replied after one business day, remind the channel's owner, once.
      if (addDays(day, 1) <= today) {
        const replied = messages.some(
          (x) => x.threadTs === m.ts && x.user !== 'U04HANDOFF' && x.postedAt >= m.postedAt,
        );
        if (!replied && markChannelDone(`nudge:${m.ts}`)) {
          await postThreadReply(
            channel.id,
            m.ts,
            opp,
            `Reminder for ${CHANNEL_OWNER[channel.name]}: this has been open since ${day}. ${h.repName} is waiting for an answer. ${NEEDS_PERSON}`,
          );
        }
      }
    }
  }
}
