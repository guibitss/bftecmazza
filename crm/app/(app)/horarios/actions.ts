'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/auth';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function updateLunch(
  vendorId: number,
  lunchStart: string | null,
  lunchEnd: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  const admin = createAdminClient();

  const { data: vendor } = await admin
    .from('vendors')
    .select('id, store_id')
    .eq('id', vendorId)
    .maybeSingle();
  if (!vendor) return { ok: false, error: 'Vendedor não encontrado' };

  const canEdit =
    user.isAdmin ||
    user.managerOfStoreId === (vendor as { store_id: number }).store_id ||
    user.vendorIds.includes(vendorId);
  if (!canEdit) return { ok: false, error: 'Sem permissão' };

  // Ambos preenchidos (com início antes do fim) ou ambos vazios (sem pausa)
  const start = lunchStart?.trim() || null;
  const end = lunchEnd?.trim() || null;
  if ((start == null) !== (end == null)) {
    return { ok: false, error: 'Preencha início e fim, ou deixe ambos vazios' };
  }
  if (start && end) {
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) {
      return { ok: false, error: 'Horário inválido (use HH:MM)' };
    }
    if (start >= end) return { ok: false, error: 'O início deve ser antes do fim' };
  }

  const { error } = await admin
    .from('vendors')
    .update({ lunch_start: start, lunch_end: end })
    .eq('id', vendorId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
