import { Hash, Lock } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SlackRich } from '@/components/handoff/slack-rich';
import { slack } from '@/lib/connectors';
import { formatDateTime, initials } from '@/lib/format';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Slack' };

/** Avatar colours, picked by name so each person keeps theirs */
const COLOURS = ['#e8912d', '#2eb67d', '#36c5f0', '#e01e5a', '#4a154b', '#1264a3'];
const colourOf = (name: string) =>
  COLOURS[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % COLOURS.length];

export default async function SlackPage(props: PageProps<'/slack'>) {
  const { channel } = await props.searchParams;
  const [channels, users, direct] = await Promise.all([
    slack.listChannels(),
    slack.listUsers(),
    slack.listDirectMessages(),
  ]);
  const directIds = direct.map((d) => d.user);
  const selected = typeof channel === 'string' ? channel : (channels[0]?.id ?? '');
  const isDirect = directIds.includes(selected);
  const messages = await slack.history(selected).catch(() => []);
  const person = (id: string) => users.find((u) => u.id === id);
  const title = isDirect
    ? (person(selected)?.real_name ?? selected)
    : (channels.find((c) => c.id === selected)?.name ?? '');
  // The API returns newest first. Slack shows the oldest at the top.
  const ordered = [...messages].reverse();
  // Replies are grouped under the message they answer, like a Slack thread
  const known = new Set(ordered.map((m) => m.ts));
  const topLevel = ordered.filter((m) => !m.threadTs || !known.has(m.threadTs));
  const repliesTo = new Map<string, typeof ordered>();
  for (const m of ordered) {
    if (m.threadTs && known.has(m.threadTs)) {
      repliesTo.set(m.threadTs, [...(repliesTo.get(m.threadTs) ?? []), m]);
    }
  }

  const line = (m: (typeof ordered)[number], small: boolean) => {
    const author = person(m.user);
    const name = author?.real_name ?? 'Your app';
    // The deal reference our app adds to every message is plumbing, so it is shown small
    const [body, ref] = m.text.split(/\n(?=Deal 006)/);
    return (
      <div key={m.ts} className="flex gap-3 px-5 py-1.5 hover:bg-[#f8f8f8]">
        <div
          className={cn(
            'flex shrink-0 items-center justify-center rounded-md font-semibold text-white text-xs',
            small ? 'size-7' : 'size-9',
          )}
          style={{ background: author ? colourOf(name) : '#1264a3' }}
        >
          {author ? initials(name) : 'APP'}
        </div>
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-bold text-[15px]">{name}</span>
            {author ? null : (
              <span className="rounded bg-[#e8e8e8] px-1 text-[#616061] text-[10px]">APP</span>
            )}
            <span className="text-[#616061] text-xs">{formatDateTime(m.postedAt)}</span>
          </div>
          <p className="whitespace-pre-wrap text-[15px] leading-snug">
            <SlackRich text={body ?? m.text} users={users} />
          </p>
          {ref ? <p className="text-[#868686] text-[11px]">{ref}</p> : null}
        </div>
      </div>
    );
  };

  const item = (active: boolean) =>
    cn(
      'flex items-center gap-2 rounded-md px-3 py-1 text-[15px] text-white/75 hover:bg-white/10',
      active && 'bg-[#1164a3] font-medium text-white hover:bg-[#1164a3]',
    );

  return (
    <div className="grid min-h-[calc(100svh-6.5rem)] md:grid-cols-[17rem_1fr]">
      <nav className="flex flex-col gap-0.5 bg-[#3f0e40] p-3 text-sm">
        <div className="px-3 pt-1 pb-3 font-bold text-lg text-white">Mentimeter</div>
        <div className="px-3 pb-1 text-white/60 text-xs">Channels</div>
        {channels.map((c) => (
          <Link key={c.id} href={`/slack?channel=${c.id}`} className={item(c.id === selected)}>
            <Hash className="size-3.5 opacity-70" />
            {c.name}
          </Link>
        ))}
        <div className="px-3 pt-4 pb-1 text-white/60 text-xs">Direct messages</div>
        {directIds.length === 0 ? <div className="px-3 text-white/50 text-xs">None yet</div> : null}
        {directIds.map((id) => (
          <Link key={id} href={`/slack?channel=${id}`} className={item(id === selected)}>
            <span className="size-2 rounded-full bg-[#2bac76]" />
            {person(id)?.real_name ?? id}
          </Link>
        ))}
      </nav>

      <section className="flex min-w-0 flex-col bg-white text-[#1d1c1d]">
        <header className="flex items-center gap-2 border-b px-5 py-3">
          <span className="flex items-center gap-1 font-bold text-lg">
            {isDirect ? null : <Hash className="size-4" />}
            {title}
          </span>
          {isDirect ? null : <Lock className="size-3 text-[#616061]" />}
        </header>

        <div className="flex flex-1 flex-col gap-0.5 py-4">
          {ordered.length === 0 ? (
            <p className="px-5 text-[#616061] text-sm">No messages yet.</p>
          ) : null}
          {topLevel.map((m) => {
            const replies = repliesTo.get(m.ts) ?? [];
            return (
              <div key={m.ts}>
                {line(m, false)}
                {replies.length > 0 ? (
                  <div className="mb-1 ml-[3.75rem] border-[#dddddd] border-l-2 pl-3">
                    <div className="px-2 pt-0.5 font-medium text-[#1264a3] text-xs">
                      {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
                    </div>
                    {replies.map((r) => line(r, true))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="p-4 pt-0">
          <div className="rounded-lg border border-[#868686] px-3 py-2.5 text-[#616061] text-sm">
            Message {isDirect ? title : `#${title}`}
            <span className="ml-2 text-xs">(read only here. Messages come from the app.)</span>
          </div>
        </div>
      </section>
    </div>
  );
}
