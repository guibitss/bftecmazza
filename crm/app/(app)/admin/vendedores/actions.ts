'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';

export async function saveLunchBreak(
  vendorId: number,
  lunchStart: string,
  lunchEnd: string,
) {
  const admin = createAdminClient();

  const patch = lunchStart && lunchEnd
    ? { lunch_start: lunchStart, lunch_end: lunchEnd }
    : { lunch_start: null,       lunch_end: null };

  const { error } = await admin
    .from('vendors')
    .update(patch)
    .eq('id', vendorId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/vendedores');
  return { ok: true };
}
