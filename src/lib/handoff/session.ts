/**
 * Who is using the admin app. Finance signs in with their Slack account, so the admin
 * app and Slack know the same person. A reply then goes out under their name.
 * In real life this is "Sign in with Slack" (OAuth). Here it is a cookie holding the
 * Slack user ID, picked from the finance people in Slack. There is no password.
 */
import { cookies } from 'next/headers';
import { slack } from '@/lib/connectors';
import type { SlackUser } from '@/lib/systems/types';
import { roleOf } from './slack';

export const SESSION_COOKIE = 'admin_user';

export async function financeUsers(): Promise<SlackUser[]> {
  return (await slack.listUsers()).filter((u) => roleOf(u) === 'finance');
}

export async function currentFinanceUser(): Promise<SlackUser | null> {
  const id = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!id) return null;
  return (await financeUsers()).find((u) => u.id === id) ?? null;
}
