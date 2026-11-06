import { saveBilling } from '@/app/(shell)/handoff-actions';
import { Fields } from '@/components/data/fields';
import { Section } from '@/components/shell/page';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getHandoff } from '@/lib/handoff/store';
import { getPolicy } from '@/lib/policy/policy';
import type {
  SalesforceAccount,
  SalesforceContact,
  SalesforceOpportunity,
} from '@/lib/systems/types';
import { BuiltNote } from './built';

/** What a valid VAT ID looks like, shown as the hint in the field. */
const VAT_EXAMPLE: Record<string, string> = {
  Germany: 'DE123456789',
  France: 'FR12345678901',
  Netherlands: 'NL123456789B01',
  Ireland: 'IE1234567T',
  Spain: 'ESB12345678',
  Denmark: 'DK12345678',
  Austria: 'ATU12345678',
  'United Kingdom': 'GB123456789',
};

const MISSING = 'border-amber-500 ring-2 ring-amber-500/40';

/**
 * The billing details on the deal page, now editable. Saving writes to
 * Salesforce (the deal and its account) and checks the deal again. Fields
 * finance would stop on are marked, so the rep sees exactly what to fill in.
 */
export function BillingEditor({
  opportunity,
  account,
  contact,
}: {
  opportunity: SalesforceOpportunity;
  account: SalesforceAccount;
  contact: SalesforceContact | null;
}) {
  const policy = getPolicy();

  // Billed already: show the details plainly. Changing them now needs an amendment deal.
  if (getHandoff(opportunity.Id)?.status === 'processed') {
    return (
      <Section title="Billing">
        <div id="billing" />
        <Card>
          <CardContent className="flex flex-col gap-3">
            <Fields
              columns={2}
              items={[
                ['Payment method', opportunity.Payment_Method__c],
                ['PO number', opportunity.PO_Number__c],
                ['Legal entity', account.Legal_Entity_Name__c],
                ['VAT number', account.VAT_Number__c],
                ['Invoice email', account.Invoice_Email__c],
                ['Country', account.BillingCountry],
                ['PO required', account.PO_Required__c ? 'Yes' : 'No'],
                ['Billing contact', contact ? contact.Name : null],
              ]}
            />
            <p className="text-muted-foreground text-xs">
              Locked, because this deal has been billed. A change now needs an amendment deal.
            </p>
          </CardContent>
        </Card>
      </Section>
    );
  }

  const invoice = opportunity.Payment_Method__c !== 'Card';
  const need = {
    legal: invoice && !account.Legal_Entity_Name__c,
    email: invoice && !account.Invoice_Email__c,
    vat:
      invoice &&
      !account.VAT_Number__c &&
      policy.vatRequiredCountries.includes(account.BillingCountry),
    po: invoice && account.PO_Required__c && !opportunity.PO_Number__c,
  };
  const anyMissing = need.legal || need.email || need.vat || !!need.po;
  const field = (
    id: string,
    label: string,
    value: string | null,
    missing: boolean,
    why: string,
    placeholder?: string,
  ) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={id}
        defaultValue={value ?? ''}
        placeholder={placeholder}
        className={missing ? MISSING : undefined}
      />
      {missing ? <span className="text-amber-700 text-xs dark:text-amber-400">{why}</span> : null}
    </div>
  );

  return (
    <Section title="Billing">
      <div id="billing" />
      {/* Purple only while something is missing, same as the checklist above */}
      <Card className={anyMissing ? 'ring-2 ring-violet-500/60' : undefined}>
        <CardContent className="flex flex-col gap-4">
          {anyMissing ? (
            <BuiltNote title="Fill in what’s missing and save.">
              It goes to Salesforce, and the deal is checked again right away. In real Salesforce,
              saving would trigger that check by itself.
            </BuiltNote>
          ) : null}
          <form action={saveBilling} className="flex flex-col gap-4">
            <input type="hidden" name="oppId" value={opportunity.Id} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label htmlFor="method">Payment method</Label>
                <select
                  id="method"
                  name="method"
                  defaultValue={opportunity.Payment_Method__c ?? 'Invoice'}
                  className="h-8 rounded-lg border bg-background px-2 text-sm"
                >
                  <option value="Invoice">Invoice</option>
                  <option value="Card">Card</option>
                </select>
              </div>
              {field(
                'po',
                'PO number',
                opportunity.PO_Number__c,
                !!need.po,
                'This account requires a PO.',
              )}
              {field(
                'legal',
                'Legal entity',
                account.Legal_Entity_Name__c,
                need.legal,
                'Needed on the invoice.',
              )}
              {field(
                'vat',
                'VAT number',
                account.VAT_Number__c,
                need.vat,
                `Needed for EU customers outside Sweden. Like ${VAT_EXAMPLE[account.BillingCountry] ?? 'the country code and digits'}.`,
                VAT_EXAMPLE[account.BillingCountry],
              )}
              {field(
                'email',
                'Invoice email',
                account.Invoice_Email__c,
                need.email,
                'Needed to send the invoice.',
              )}
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground text-xs">Country</dt>
                <dd>{account.BillingCountry}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">PO required</dt>
                <dd>{account.PO_Required__c ? 'Yes' : 'No'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Billing contact</dt>
                <dd>{contact ? contact.Name : 'None'}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Credit card payment (legacy)</dt>
                <dd>{opportunity.Credit_Card_Payment__c ? 'Yes' : 'No'}</dd>
              </div>
            </dl>
            <div>
              <Button type="submit" className="bg-violet-600 text-white hover:bg-violet-700">
                Save and check again
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </Section>
  );
}
