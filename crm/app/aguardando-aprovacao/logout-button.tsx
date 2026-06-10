'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

export default function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handle() {
    setLoading(true);
    await createClient().auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <Button type="button" variant="secondary" size="md" onClick={handle} disabled={loading}>
      <LogOut size={14} /> {loading ? 'Saindo…' : 'Sair'}
    </Button>
  );
}
