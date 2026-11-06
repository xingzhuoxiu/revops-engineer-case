import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/format';
import type { DealThread } from '@/lib/handoff/slack';

/**
 * The Slack messages filed under a deal. Messages that carry the deal ID are
 * certain. Messages that only name the customer are shown as "may be about
 * this deal": a suggestion, never an alert.
 */
export function Messages({ thread, limit = 5 }: { thread?: DealThread; limit?: number }) {
  if (!thread || thread.messages.length === 0) {
    return <p className="text-muted-foreground text-sm">No Slack messages about this deal.</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {thread.messages.slice(0, limit).map((m) => (
        <li key={m.ts} className="rounded-lg border p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
            <span className="font-medium text-foreground">{m.author}</span>
            <span>{m.channel}</span>
            <span>{formatDateTime(m.at)}</span>
            {m.match === 'mentioned' ? (
              <Badge variant="outline">May be about this deal</Badge>
            ) : null}
          </div>
          <p className="mt-1 whitespace-pre-line">{m.text}</p>
        </li>
      ))}
      {thread.unanswered ? (
        <li className="text-amber-700 text-xs dark:text-amber-400">
          The latest message is from a rep and has no reply yet.
        </li>
      ) : null}
    </ul>
  );
}
