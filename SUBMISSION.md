# Submission

## What I built, and for whom

When a deal is moved to Closed Won, Salesforce sends an event. The webhook now reads the live deal, checks it against finance's rules (R1 to R8), and either sets everything up or tells the right person what is missing.

- **Clean deals** (7 of this week's 18) are set up on their own: workspace (found or created), subscription, a Kleer draft invoice or a Stripe card charge, and the IDs written back to the Salesforce deal. Billing previews and sends the invoice.
- **Deals with a rep problem** (6) wait, with a plain-language checklist and one Slack message a day. The rep fixes it in Salesforce and the deal goes through.
- **Deals that need a person in finance** (4) go to an exceptions queue with a due date and an owner.

Two users, two places:

- **Sales reps, in Salesforce** (the deal page): a *Rep self-QA checklist* card. It shows what finance needs, what to fix, and what happened after the deal was sent. Reps never need the admin app. In a real Salesforce this is a record-page component. Here the mock Salesforce deal page stands in for it.
- **Finance, in the admin app**: three new tabs. *Ready to bill* (what arrived, what was set up, preview and send the invoice), *Exceptions* (everything waiting on finance, with owners, due dates and "Ask rep in Slack"), *Rules* (finance's rules as editable settings, with a change log).

## Decisions

- **Rules are data, not code.** Card limit, discount threshold, deadlines, PO exception and invoice sending live in one settings record that finance edits and saves. Every change is logged. Rules were written down in `src/lib/policy/rules.ts` as one pure function, so each one is easy to test.
- **Always read the live deal.** An event can be older than the latest edit. Halden was edited from 30 to 35 licenses after it closed. We bill 35, and the later "updated" event changes nothing.
- **One opportunity ID means one subscription and one invoice or charge (R5).** Kleer and the admin app accept duplicates silently, so we look first. Stripe gets an idempotency key. Replaying all 21 events twice creates nothing twice (tested). This is a silent guardrail. Finance only sees a notice when something is blocked.
- **Lock after billing.** After a deal is processed, a change to any billing field is not applied. Finance sees a notice, and the rep is asked to create an amendment deal. Our own write-backs are ignored when Salesforce echoes them back.
- **Discounts over 25%** go to *Finance or the sales manager*, because they affect commission. Deal Desk is not a team here, only a Slack channel.
- **The PO exception for existing customers (R3) is off.** Nobody has decided it. It is a setting, and the Rules tab notes how it could grow into real criteria (contract terms, credit score, payment history).
- **Alerts belong to a queue, not a person.** Billing (Maja Ek, backup Tom Becker) and Credit Control (Tom Becker, backup Maja Ek), with an "Away" switch that reroutes to the backup. Owners and backups are my suggestion, not from the case.
- **One Alert record, one Slack sender with templates, two automations** (the event handler and a daily sweep). I kept the number of custom objects small so a hand-over or a holiday does not break it. New Salesforce fields: only `Handoff_Processed_At__c`. `Subscription_ID__c`, `Invoice_Number__c`, `Workspace_ID__c` already existed.
- **Failed card payments** (Sable & Finch) go to Credit Control, found by the daily sweep. The new subscription is held until billing is secured, and the workspace only goes live on its start date once the invoice is sent. If it is still a draft 3 days before the start date, Billing and Customer Success are warned.
- **Slack messages are filed by deal.** Slack cannot regroup a channel, so every message the app sends carries the opportunity ID, and the admin app groups messages by it. A message a rep sends from the deal lands in Billing's queue until finance answers. Messages that only name a customer are shown as "may be about this deal", never as alerts.
- **Not built:** reading free-form Slack in real time (the mock has no event feed, so we read channel history), credit notes for amendments, a Deal Desk team, a RevOps view (RevOps owns and runs the system).

## Before it goes live

- Who owns each queue, and who covers? (I suggested Billing and Credit Control with each other as backup.) Does the workspace-match decision belong to Billing or to Customer Success (Lea Fischer)?
- Is the PO exception for Relationship Managers' customers allowed, and on what criteria? It is the one rule that could change what goes out the door.
- Is 3 days the right time to warn about unsecured billing? Is 48 hours the right deadline for reps?
- Should invoices be sent straight away for small amounts, or always previewed? Today Billing previews every one.
- Slack: can we install an app that reads `#finance-billing`, `#deal-desk` and `#revops-help`? Is one daily message per rep what they want?
- Amendment deals: what should the rep actually do when a billed deal changes? The wording is a placeholder.

## How to try

1. `npm install`, then `npm run dev`, open http://localhost:3000.
2. Open **Closed Won hand-off** in the sidebar. It lists everything I built (marked in violet, with notes on what each piece would be in a real system), and has the button that sends this week's deals. The same button is on **Dev tools** (**Send all 21 to webhook**). Either way, this is Salesforce sending this week's events.
3. **Admin app > Ready to bill**: 7 processed, 6 waiting on rep, 4 with finance, Polar Bear ignored. Open Fjordline, press **Preview invoice**, then **Send invoice**.
4. **Admin app > Exceptions**: the four finance items, and the failed Sable & Finch payment. Press **Ask the rep** on a row to send the Slack message. The Slack conversations stay in Slack, so they are folded at the bottom, and open on each deal under Ready to bill.
5. **Admin app > Rules**: change the card limit, press Save, see the change log. Turn Maja "away" and see the exceptions move to Tom.
6. **Deals > Corvid Analytics**: the rep's checklist. Press **Demo: pretend I fixed it in Salesforce**. The deal goes through to Ready to bill with new IDs. Also try **Message finance**.
7. **Ready to bill > Demo controls > +7 days** moves the clock: deadlines pass, subscriptions go live, unsecured billing escalates.
8. **Dev tools > Reset all systems** starts again. The demo-only pieces are the "pretend I fixed it" button and "+7 days".

`npm test` runs the new tests in `test/closed-won.test.ts`. I did not change `src/lib/mock/` or `data/seed/`.

## What I'd do next

- Move the rep checklist into a real Salesforce record page, and the write-back to a Flow or Apex trigger.
- Replace channel history with Slack's Events API and a "Message finance about a deal" shortcut.
- Amendments: when a billed deal changes, create the credit note and a new draft for Billing to approve.
- Let finance add PO exception criteria as real checks.
- A weekly report to RevOps: how many deals went straight through, and which rule stops most deals.

## Working with your AI tool

Your first prompt, pasted as you wrote it:

> _Add yours here_

Something your tool suggested or built that you changed or threw away, and why:

_Add yours here. One honest example from this build: an early version of the hand-off page was a wall of text for finance. You asked for it to be concise, with detail folded away and an invoice preview instead._

Roughly where you spent your time:

_Add yours here._

## Video

Link:
