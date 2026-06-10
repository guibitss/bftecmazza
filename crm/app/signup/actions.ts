'use server';

import { createAdminClient } from '@/lib/supabase/admin';

export async function createPendingProfile(
  userId: string,
  email: string,
  name: string,
): Promise<{ ok: boolean; error?: string }> {
  const admin = createAdminClient();

  const { error } = await admin.from('app_users').upsert({
    id: userId,
    email,
    name,
    is_admin: false,
    active: true,
    status: 'pending',
  }, { onConflict: 'id' });

  if (error && !error.message.includes('duplicate')) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
