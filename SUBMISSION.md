# Submission

The case looks at three things: what I chose to build and what I gave up, how I handle messy data, and whether I can explain it clearly. I built my answers around those three. Everything I built is marked in violet in the app, so it's easy to tell from the starter code.

## What I built, and for whom

When a deal moves to Closed Won, Salesforce sends an event. My webhook reads the live deal, checks it against finance's rules (R1 to R8), and then either sets everything up or tells the right person what is missing. Nobody copies anything by hand.

Here's what it does with this week's 18 deals. 7 go through without anyone touching them. 6 wait on the rep, 4 wait on finance, and 1 (Polar Bear) was reopened, so nothing is billed. My test checks this split.

- **7 go through on their own:** workspace, subscription, a Kleer draft or a Stripe charge, and the IDs written back to the deal.
- **6 wait on the rep.** They get a checklist on the deal and one Slack message when it first needs them.
- **4 wait on finance**, so they go to the Needs action board with an owner and a due date.

Only 7 of 17 going straight through is on purpose. For the other 10, nothing is created until the data is fixed: no workspace, no subscription, no invoice. A bad deal never ends up half-billed.

Who uses it:

- **Sales reps, in Salesforce.** A checklist on the deal says what finance needs, what to fix, and where the deal is now (checked, invoice drafted, sent, paid, overdue). Reps already live in Salesforce, so they never open the admin app.
- **Finance, in the admin app.** Needs action (every deal waiting on someone, in columns by owner: Sales rep, Billing, Credit Control, Deal Desk), Ready to bill (deals that are set up, with the invoice to preview and send, one by one or several at once), and Rules (finance's numbers as settings, with a change log). Finance signs in with Slack, so a reply goes out under their own name.
- **Slack stays Slack.** A rep only gets a message when a deal first needs them, a reminder on the due date, and an alert if an invoice is overdue or a card fails. Everything else they check on the deal in Salesforce. When a rep asks finance something, the app doesn't answer for them. It puts a draft reply in the box for finance to read, change and send. Sales managers get one update a week for deals a rep still hasn't fixed.

My rule for the whole thing: revenue comes first. The process must never get in the way of a rep getting the contract signed. But once it's signed, the rep shares the work of making the finance side smooth, so the revenue is booked on time.

## Decisions

### 1. Trade-offs: five conflicts, what I went with, what I gave up

| Conflict | What I did | What I gave up |
| --- | --- | --- |
| **Review vs automation.** Maja wants to see every invoice. Kim doesn't want 50 clicks per deal. | The invoice is drafted for me. Billing previews and sends it in one click. Finance can switch to auto-send. | Not fully hands-off. |
| **Rep speed vs finance data.** Priya doesn't want a form before she can close. Maja and Tom want details before close. | I never block the contract from being signed. The rep fixes it after, with a 2 day deadline. Still open after 5 days, the sales manager sees it weekly. | A deal can close with gaps. |
| **Customer vs billing safety.** Hannah wants invoices without a PO. Lea wants the workspace live on the start date. Tom wants billing secured first. | PO exception is off, as a setting. The subscription waits until billing is secured, and I warn 3 days before the start. | Some customers get chased, some may wait. |
| **Too many messages vs no visibility.** Alex wants one message a day. Priya can't see her deal. | One message when a deal first needs the rep, a reminder on the due date, and an alert if an invoice is overdue or a card fails. Routine status is on the deal in Salesforce, not in Slack. | Priya has to look at the deal for the status, but she won't be pinged for it. |
| **The case has gaps.** The policy says Deal Desk approves discounts over 25%, but there is no Deal Desk person. There is no sales manager either. | The rep requests approval on the deal. A message with a link to the deal goes to #deal-desk, and Deal Desk approves on the deal in Salesforce. The owners, backups and the sales manager are settings I filled with guesses. | The owners need confirming. |

### 2. Messy data: six kinds, and what I do

| Kind | Examples this week | What I do |
| --- | --- | --- |
| Data that disagrees with itself | Corvid (10 licenses vs 8 on the line), Maris (deal and account in different currencies) | Check amount, lines and currency against the price book. Say it once, plainly, and the rep fixes it. |
| Missing or wrong details | Kessler (no PO), a wrong VAT format, Quill & Ink (starts before it closed) | A checklist on the deal with a 2 day deadline. PO goes to Billing, the rest to the rep. Nothing is created until it's fixed. |
| Changes after the fact | Halden (30 to 35 licenses after close), Polar Bear (reopened) | Always read the live deal, never the event copy. After billing nothing is changed. Finance gets a notice and the rep makes an amendment deal. |
| Duplicates | 21 events for 18 deals | One opportunity ID means one subscription and one invoice. I replayed everything twice and nothing was created twice. I also wiped the app's own record and replayed again: it finds the invoice in Kleer and the subscription in the admin app, and Stripe's idempotency key covers the charge. Nothing doubled. There is a test for it. |
| Needs a decision | Lumen (40% discount), an account that matches two workspaces | Goes to the right owner with a due date: Deal Desk for discounts, Billing for the workspace pick. |
| Existing customers and payments | Nordlys (card plan to invoice), Sable & Finch (expired card) | The old subscription stops renewing so nobody is billed twice. A failed card goes to Credit Control, and the rep is told before the customer calls. |

After billing I keep checking: invoice status goes back to Salesforce, and an overdue invoice goes to Credit Control and the rep.

### 3. Safeguards against double billing

Billing a customer twice is the worst thing this could do, so the checks sit in more than one place. Each one below is in the code. Where there's a test, I name it.

- **One deal, one subscription, one invoice.** The deal's ID is the key, so a repeated event finds what was made before. `run.ts`. Test: "creates one subscription and one invoice or charge per deal, even when events repeat".
- **Kleer is checked first.** Kleer accepts duplicates, so before creating an invoice I look for one with this deal's ID. `run.ts`. Covered by the replay test above and the wipe test below.
- **Stripe idempotency keys.** The customer and subscription calls carry `customer:<deal id>` and `subscription:<deal id>`. `run.ts`. The test for how keys behave is on the Stripe mock (`mock-systems.test.ts`), not on my own keys.
- **If the app loses its own record.** It finds the subscription again from the ID written on the deal, or from the invoice or charge reference. `run.ts`. Test: "creates nothing twice even if the app loses its own record and everything is replayed".
- **Locked after billing.** A change after billing becomes a notice for finance, not an edit. `run.ts`. Test: "locks a deal after billing and tells finance when someone changes it".
- **Send once.** If the invoice isn't a draft any more, `sendInvoice` does nothing. `run.ts`. Test: "only sends once, however many times it is pressed".
- **My own write-backs are ignored.** An event that only changed fields I wrote is skipped. `run.ts`. Test: "ignores the echo of our own write-backs".

What I didn't cover: two events for the same deal arriving at the same moment (my tests replay them one after another). And Stripe: the charge is only protected by the idempotency key. My mock keeps keys forever, real Stripe forgets them after about a day. So if the app lost its record and a deal was replayed more than a day later, it could create a second Stripe subscription. Kleer has a lookup for this, Stripe doesn't yet.

### 4. What I chose not to build

**Left out because of the mock or my time**

- Live Slack. The mock has no event feed, so the app reads channel history once a day. With Slack's Events API it would be instant.
- Credit notes and a new invoice when a billed deal changes. I raise it for Billing and stop.
- Updating the customer in Kleer or Stripe when the account changes, and marking invoices paid. The mocks have no call for it.
- Chasing overdue invoices. I alert Credit Control and the rep, but I don't send reminders to the customer.
- Real owners. There is no Deal Desk person or sales manager in the case, so they are settings with my guesses.

**It should sit in the CRM, not in my app**

- The rep checklist and the status fields. In real Salesforce this is a record-page component and a Flow. I built it in the mock deal page so you can see it.
- Discount approval. In real Salesforce the rep submits the deal for approval, a Flow posts to #deal-desk with a link to the deal, and Deal Desk approves in Salesforce. I built the same flow in the mock. Approve and Reject buttons in Slack are possible too, for simple one-step approvals, but I chose the link because it needs no setup per approver.
- Filtering deals by rep. Salesforce list views already do this. I added it so the mock shows it.
- The weekly update to the sales manager. In real life this is a Salesforce report or dashboard subscription.
- Warnings on the Opportunity for a missing PO or billing contact. These would be soft validation rules, not blockers, so reps can still close.

## Before it goes live

What I'd ask first, and what each answer could change:

- **Who owns Billing and Credit Control, and who covers?** I guessed. Could change who gets every alert.
- **Is the PO exception allowed for Relationship Managers' customers, and on what rule?** It's the one rule that changes what goes out the door.
- **Who is Deal Desk?** There's no name. This decides who gets the approval request.
- **Is 3 days the right warning before the start date, and is 2 days the right deadline for reps?**
- **Should small invoices go out straight away, or always be previewed?**
- **Can we install a Slack app that reads #finance-billing, #deal-desk and #revops-help?** Without it, the app only reads Slack once a day, so a rep's question can wait for finance's draft reply.
- **Who calls the customer on an overdue invoice, Credit Control or the rep?**
- **What should a rep do when a billed deal changes?** My wording is a placeholder.

## How to try it

1. `npm install`, then `npm run dev`, and open http://localhost:3000/your-app (**Closed Won hand-off** in the sidebar).
2. Press **Send this week's deals from Salesforce**. This is Salesforce sending the week's events.
3. **Admin app > Ready to bill.** Pick Fjordline, press **Preview and send invoice**, then **Send invoice**. It can't be sent twice. To send several, tick them and press the bulk send button, check the review page, and send.
4. **Admin app > Needs action.** One card per deal, in Sales rep, Billing, Credit Control and Deal Desk. Press **Sign in with Slack** and pick a finance person, then on a card press **Ask** to send the draft reply under their name. On Lumen, open the deal from the Deal Desk card and press **Demo: Deal Desk approves**. The rep gets a Slack message and the deal goes through. To see the request side, open a deal with a discount over 25% and press **Request Deal Desk approval**. The message in #deal-desk has a link to the deal.
5. **Salesforce > Deals.** Filter by owner or search by name. Open **Corvid Analytics** to see the rep's checklist. Fill in the missing details, or press **Demo: pretend I fixed it in Salesforce**.
6. Open **Orbital Freight** (an open deal) and press **Demo: move this deal to Closed Won** to see what finance would stop on.
7. **Ready to bill > Demo controls: +7 days** and **+35 days.** Deadlines pass, subscriptions go live, and sent invoices become overdue. Send an invoice first: a draft never goes overdue. Check Needs action and Slack.
8. **Dev tools > Reset all systems** starts again.

`npm test` runs my tests. I didn't change `src/lib/mock/` or `data/seed/`. Nothing else is needed.

## What I'd do next

- Move the rep checklist into a real Salesforce record page, and the write-back into a Flow.
- Use Slack's Events API and buttons, so answers and approvals are instant.
- Before creating a Stripe subscription, look in Stripe for one with this deal's ID, like I already do for Kleer invoices. Then a replay can't double-charge even after Stripe forgets its keys.
- Amendments: when a billed deal changes, create the credit note and a new draft for Billing to approve.
- Update the Kleer and Stripe customer when the account changes.
- Let a rep say "I'll provide it by Friday" on the checklist. That moves the due date, so they don't get a reminder for something they've already told finance about.
- Let finance add PO exception rules as real checks.
- A weekly report for RevOps: how many deals went straight through, and which rule stops most. The most repeated problem gets fixed at the source.

## Working with your AI tool

Your first prompt, pasted as you wrote it:

> here's the context for the business, read the files. I want to understand how the business is set up and how the systems connect: Salesforce, the admin app, Kleer, Stripe and Slack. Then walk me through what happens after a deal is marked Closed Won, step by step. Where does it go wrong, who feels it, and what could we build to fix it?
> Let's go step by step: pain points first, then solutions, then code.
>
> Your principles: balance the stakeholders' experience, but revenue is the top priority. As long as the process doesn't block reps from closing, they should take some responsibility for making the finance stage smoother and faster, so revenue is registered on time.

Something my tool suggested or built that I changed or threw away, and why:

- The first version of the finance pages was long tables, top to bottom like a form. I asked for something closer to a CRM, so Ready to bill is a list with a detail panel, and Needs action is in columns by owner. Later I made the admin app flatter and simpler too, and grouped the menu so each deal is in one place only.
- It first sent discounts to "Finance or the sales manager". The policy says Deal Desk, so I had it changed.
- It showed a missing PO to the rep as "nothing for you to do". The PO comes from the customer through the rep, so I made it the rep's to fix.
- Send invoice could be pressed twice and email the customer again. I made it send once.
- It stopped at creating the invoice. I asked how the five systems connect, and we found what happens after billing: status back to Salesforce, overdue invoices, failed payments.
- It wanted to turn every Slack request into an admin app item. That's more work for finance, so I asked for a better way. Approvals now happen from the deal.
- It had the app answer a rep's question in the thread with the deal status. On Corvid the rep was asking about the seat count, and the status reply ignored it. So now finance gets a draft reply in the box and decides what to send.
- It sent the rep a message on every status change. That's too noisy and reps can check Salesforce, so now only things that matter get a message, like a due date or an overdue invoice.

Roughly where I spent my time (3 hr 53 min in total):

Most of my time went on working out the process: where the hand-off breaks, who feels it, and what is worth fixing. Claude wrote the code fast. I spent the rest on testing it, finding what felt wrong, and getting it fixed.

- **About 30 mins:** understanding the business. How the five systems connect, where the hand-off breaks, who feels it.
- **About 40 mins:** the rules and the messy data. What goes through, what the rep fixes, what finance decides. I checked it against this week's deals.
- **About 1 hr:** the rep side and the finance side. What each person needs to see and do, and fixing the layout when it felt wrong.
- **About 45-50 mins:** how people get told and decide. Slack, discount approval, and what happens when a rep doesn't fix their part.
- **About 45-50 mins:** what happens after billing, and making it easy for you to review.

## Video

Link: https://www.loom.com/share/e7dab33af59c48e4bddeed0058f43d98
