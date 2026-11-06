/**
 * Salesforce calls this URL for every Closed Won event (the Dev tools page
 * sends this week's events here, one at a time, in order).
 *
 * The handler reads the live deal, checks finance's rules and either sets
 * everything up or raises an alert. It always answers 202 when the event was
 * understood, even if the deal is waiting for someone: that is a result, not
 * an error, and Salesforce should not retry it.
 */
import { handleEvent } from '@/lib/handoff/run';
import type { SalesforceEvent } from '@/lib/systems/types';

export async function POST(request: Request) {
  const event = (await request.json()) as SalesforceEvent;
  const outcome = await handleEvent(event);
  console.log(
    `[webhook] ${event.type} ${event.opportunity.Name} (replayId ${event.replayId}): ${outcome}`,
  );
  return Response.json({ received: true, outcome }, { status: 202 });
}
