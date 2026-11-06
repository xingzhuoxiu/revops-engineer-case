import { adminApp, salesforce, stripe } from '@/lib/connectors';
import { getPolicy } from '@/lib/policy/policy';
import { type DealContext, type Evaluation, evaluateDeal, hostOf } from '@/lib/policy/rules';

/**
 * Reads the deal as it is right now, plus what the other systems know about
 * the customer. Always the live deal, never the event's copy: the event may be
 * older than the latest edit.
 */
export async function loadContext(oppId: string): Promise<DealContext> {
  const full = await salesforce.getOpportunity(oppId);
  const { OpportunityLineItems, ...opp } = full;
  const account = await salesforce.getAccount(opp.AccountId);
  const host = hostOf(account.Website);
  // Workspaces that could belong to this account: linked to it, named on it, or sharing its domain
  const [byAccount, byDomain, byField, subscriptions] = await Promise.all([
    adminApp.listWorkspaces({ salesforceAccountId: account.Id }),
    host ? adminApp.listWorkspaces({ domain: host }) : Promise.resolve([]),
    account.Workspace_ID__c
      ? adminApp.getWorkspace(account.Workspace_ID__c).then(
          (w) => [w],
          () => [],
        )
      : Promise.resolve([]),
    adminApp.listSubscriptions({ salesforceAccountId: account.Id }),
  ]);
  const workspaces = [...byAccount, ...byField, ...byDomain].filter(
    (w, i, all) => all.findIndex((x) => x.id === w.id) === i,
  );

  // The card on file, found through the workspace the Stripe customer was created for
  let cardOnFile: DealContext['cardOnFile'] = null;
  const linked = workspaces.find((w) => w.salesforceAccountId === account.Id) ?? workspaces[0];
  if (opp.Payment_Method__c === 'Card' && linked) {
    const [customer] = await stripe.findCustomers({ metadata: { workspace_id: linked.id } });
    const card = customer?.default_payment_method;
    if (card) cardOnFile = { expMonth: card.exp_month, expYear: card.exp_year };
  }
  return {
    opp,
    lines: OpportunityLineItems.records,
    account,
    workspaces,
    subscriptions,
    cardOnFile,
  };
}

export async function evaluateLive(
  oppId: string,
): Promise<{ ctx: DealContext; result: Evaluation }> {
  const ctx = await loadContext(oppId);
  return { ctx, result: evaluateDeal(ctx, getPolicy()) };
}
