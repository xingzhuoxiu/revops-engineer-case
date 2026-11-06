import Link from 'next/link';
import { slackText } from '@/lib/slack-text';
import type { SlackUser } from '@/lib/systems/types';

/** Slack message text: mentions as @Name, and `</deals/ID|label>` links as real links. */
export function SlackRich({ text, users }: { text: string; users: SlackUser[] }) {
  const parts = text.split(/(<\/[^|>]+\|[^>]+>)/g);
  return (
    <>
      {parts.map((part, i) => {
        const link = /^<(\/[^|>]+)\|([^>]+)>$/.exec(part);
        return link ? (
          <Link
            // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one message never reorder
            key={i}
            href={link[1] as string}
            className="underline"
          >
            {link[2]}
          </Link>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one message never reorder
          <span key={i}>{slackText(part, users)}</span>
        );
      })}
    </>
  );
}
