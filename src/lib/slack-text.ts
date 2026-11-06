import type { SlackUser } from '@/lib/systems/types';

/** Shows Slack mentions like `<@U04MAJAEK0>` as `@Maja Ek`. */
export function slackText(text: string, users: SlackUser[]) {
  return text
    .replace(/<@([A-Z0-9]+)>/g, (mention, id: string) => {
      const user = users.find((u) => u.id === id);
      return user ? `@${user.real_name}` : mention;
    })
    .replace(/<\/[^|>]+\|([^>]+)>/g, '$1');
}
