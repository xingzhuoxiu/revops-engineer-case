import { signInAction, signOutAction } from '@/app/(shell)/handoff-actions';
import { Button } from '@/components/ui/button';
import { currentFinanceUser, financeUsers } from '@/lib/handoff/session';

/** Finance signs in with Slack. Replies then go out under their own name. */
export async function SignIn() {
  const [me, people] = await Promise.all([currentFinanceUser(), financeUsers()]);
  if (me) {
    return (
      <form action={signOutAction} className="flex flex-col gap-1 border-t pt-3 text-xs">
        <span className="text-muted-foreground">Signed in with Slack as</span>
        <span className="font-medium text-sm">{me.real_name}</span>
        <span className="text-muted-foreground">{me.title}</span>
        <Button type="submit" variant="ghost" size="sm" className="-ml-2.5 w-fit">
          Sign out
        </Button>
      </form>
    );
  }
  return (
    <form action={signInAction} className="flex flex-col gap-2 border-t pt-3 text-xs">
      <span className="text-muted-foreground">
        Sign in with your Slack account to reply to reps. Your name shows on the message.
      </span>
      <select name="user" className="h-8 rounded-md border bg-background px-2 text-sm">
        {people.map((u) => (
          <option key={u.id} value={u.id}>
            {u.real_name}
          </option>
        ))}
      </select>
      <Button type="submit" size="sm">
        Sign in with Slack
      </Button>
    </form>
  );
}
