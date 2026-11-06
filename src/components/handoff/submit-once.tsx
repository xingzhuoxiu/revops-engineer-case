'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';

/** A submit button that locks as soon as it is pressed, so a double click can't send twice. */
export function SubmitOnce({
  children,
  pendingText = 'Working...',
}: {
  children: ReactNode;
  pendingText?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? pendingText : children}
    </Button>
  );
}
