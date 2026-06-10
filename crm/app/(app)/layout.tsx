import { getCurrentUser } from '@/lib/auth';
import { AppShell } from '@/components/app-shell';
import { Ambient } from '@/components/ambient';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <>
      <Ambient />
      <AppShell user={user}>{children}</AppShell>
    </>
  );
}
