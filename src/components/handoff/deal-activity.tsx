import { messageFinance } from '@/app/(shell)/handoff-actions';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { messagesByDeal } from '@/lib/handoff/slack';
import { Messages } from './messages';

/**
 * The rep's side of the conversation with finance, on the deal. A message goes to
 * #finance-billing with the deal attached, and finance sees it on the deal in the
 * admin app, so it doesn't get lost in the channel.
 */
export async function DealActivity({ oppId, accountName }: { oppId: string; accountName: string }) {
  const thread = (await messagesByDeal([{ Id: oppId, accountName }]))[oppId];
  return (
    <div className="flex flex-col gap-4">
      <form action={messageFinance} className="flex flex-col gap-2">
        <input type="hidden" name="oppId" value={oppId} />
        <Textarea
          name="text"
          rows={2}
          placeholder="Message finance, for example: the PO is coming on Monday"
        />
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm">
            Send to #finance-billing
          </Button>
          <span className="text-muted-foreground text-xs">
            Finance sees it on this deal too, so it doesn’t get lost in the channel.
          </span>
        </div>
      </form>
      <Messages thread={thread} limit={20} />
    </div>
  );
}
