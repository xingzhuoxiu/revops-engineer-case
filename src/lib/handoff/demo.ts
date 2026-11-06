/**
 * DEMO ONLY. Stands in for the rep opening Salesforce and correcting the deal,
 * so you can watch a deal go from "waiting on the rep" to "ready to bill".
 * It writes to the mock Salesforce through its API, like a rep's edit would.
 * Dev tools > Reset puts the data back.
 */
import { salesforce } from '@/lib/connectors';
import { addDays } from '@/lib/policy/rules';
import { recheck } from './run';

type Fix = (opp: Awaited<ReturnType<typeof salesforce.getOpportunity>>) => Promise<unknown>;

const FIXES: Record<string, Fix> = {
  'Corvid Analytics': (o) =>
    salesforce.updateOpportunity(o.Id, { Number_of_Licenses__c: 8, Total_Licenses__c: 8 }),
  'Quill & Ink Publishing': (o) =>
    salesforce.updateOpportunity(o.Id, {
      Start_Date__c: o.CloseDate,
      End_Date__c: addDays(
        o.CloseDate.replace(/^(\d{4})/, (y) => String(+y + 1)),
        -1,
      ),
    }),
  'Maris Shipping': (o) => salesforce.updateOpportunity(o.Id, { CurrencyIsoCode: 'CHF' }),
  'Vantera Group': (o) => salesforce.updateOpportunity(o.Id, { Payment_Method__c: 'Invoice' }),
  'Alpenblick Versicherung': (o) =>
    salesforce.updateAccount(o.AccountId, {
      Invoice_Email__c: 'billing@alpenblick.example',
      VAT_Number__c: 'DE123456789',
    }),
  'Arcadia Retail': (o) =>
    salesforce.updateAccount(o.AccountId, { VAT_Number__c: 'FR12345678901' }),
};

export const hasDemoFix = (accountName: string) => accountName in FIXES;

/** Corrects the deal the way the rep would, then checks it again. */
export async function demoFix(oppId: string) {
  const opp = await salesforce.getOpportunity(oppId);
  const account = await salesforce.getAccount(opp.AccountId);
  const fix = FIXES[account.Name];
  if (fix) await fix(opp);
  return recheck(oppId);
}
