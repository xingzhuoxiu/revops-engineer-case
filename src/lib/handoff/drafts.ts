/**
 * A draft message to the rep, written for finance to read, change and send. Nothing is
 * sent on its own: the draft is put in the message box on the deal. The text answers
 * what the rep needs to know (what to fix, and why it matters), so finance only checks it.
 */
import { statusReply } from './channels';
import type { Alert, Handoff } from './store';

/** What to tell the rep, per kind of open item. Falls back to the item's own message. */
function line(a: Alert): string {
  switch (a.title) {
    case 'License count': {
      // "Deal says 10 licenses, the product line and the amount say 8."
      const n = /says? (\d+)\./.exec(a.message)?.[1];
      return `${a.message} This matters: the seats in the workspace and the renewal price follow the license field. ${
        n
          ? `If ${n} is what the customer signed for, please set licenses to ${n} on the deal.`
          : 'Please set it to what the customer signed for.'
      }`;
    }
    case 'Amount':
      return `${a.message} Please correct the amount or the discount on the deal. Billing works from the price book.`;
    case 'Currency':
      return `${a.message} Please fix it on the deal so the invoice goes out in the right currency.`;
    case 'Card limit':
      return `${a.message} Please change the payment method to invoice.`;
    case 'Purchase order':
      return 'The account requires a PO. Can you get it from the customer and add it to the deal? Billing cannot invoice without it.';
    case 'Billing details':
    case 'VAT ID':
    case 'Start date':
      return `${a.message} Can you check it with the customer and update the deal?`;
    case 'Workspace match':
      return 'Do you know which workspace the customer uses?';
    case 'Payment method on file':
      return 'The card on file has expired. Can you ask for a new card, or switch them to invoice?';
    default:
      if (a.kind === 'overdue')
        return 'This invoice is past due. Can you check in with the customer about payment?';
      if (a.kind === 'payment')
        return 'The customer’s card payment failed. Can you ask them to update their card?';
      return a.message;
  }
}

/**
 * The draft for a deal. `asked` is true when the rep wrote in a channel, so the draft
 * is an answer. With nothing open and a question, it falls back to the deal's status.
 */
export function draftReply(h: Handoff, items: Alert[], asked: boolean): string {
  const first = h.repName.split(' ')[0];
  const lines = items.filter((a) => a.kind !== 'rep_message').map(line);
  if (lines.length) return `Hi ${first}, ${asked ? 'thanks for asking. ' : ''}${lines.join(' ')}`;
  if (asked) return `Hi ${first}, ${statusReply(h, h.dealName).text}`;
  return '';
}
