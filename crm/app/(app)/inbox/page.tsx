import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/auth';
import { InboxShell } from './inbox-shell';

export default async function InboxPage() {
  const user = await getCurrentUser();
  return (
    <Suspense fallback={<div className="flex-1 grid place-items-center text-sm text-fg-muted">Carregando…</div>}>
      <InboxShell
        userId={user.id}
        groups={user.groups}
        isAdmin={user.isAdmin}
      />
    </Suspense>
  );
}
