'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { phoneNorm } from '@/lib/phone';

/**
 * Cadastra um número como CONTATO INTERNO (equipe/sócio/parceiro). A partir
 * daí a fila de análise o ignora; e re-marcamos as análises já existentes
 * como não-atendimento para saírem das métricas na hora.
 */
export async function addInternalContact(phoneRaw: string, nome: string, motivo: string) {
  const user = await getCurrentUser();
  if (!user.isAdmin) return { ok: false, error: 'Sem permissão.' };

  const norm = phoneNorm(phoneRaw);
  if (norm.length < 10) return { ok: false, error: 'Telefone inválido.' };

  const admin = createAdminClient();

  const { error: insErr } = await admin
    .from('internal_contacts')
    .upsert(
      { phone_norm: norm, nome: nome.trim() || null, motivo: motivo.trim() || null },
      { onConflict: 'phone_norm' },
    );
  if (insErr) return { ok: false, error: insErr.message };

  // Re-marca análises já feitas desse número como não-atendimento.
  const last8 = norm.slice(-8);
  const { data: convs } = await admin
    .from('conversations')
    .select('id, customer_phone')
    .ilike('customer_phone', `%${last8}%`);
  const ids = (convs ?? [])
    .filter(c => phoneNorm(c.customer_phone as string) === norm)
    .map(c => c.id as number);
  let remarcadas = 0;
  if (ids.length > 0) {
    const { error: upErr, count } = await admin
      .from('conversation_analysis')
      .update({ eh_atendimento: false }, { count: 'exact' })
      .in('conversation_id', ids);
    if (upErr) return { ok: false, error: upErr.message };
    remarcadas = count ?? ids.length;
  }

  revalidatePath('/admin/equipe');
  revalidatePath('/metricas');
  return { ok: true, remarcadas };
}

export async function removeInternalContact(phoneNormValue: string) {
  const user = await getCurrentUser();
  if (!user.isAdmin) return { ok: false, error: 'Sem permissão.' };

  const admin = createAdminClient();
  const { error } = await admin
    .from('internal_contacts')
    .delete()
    .eq('phone_norm', phoneNormValue);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/equipe');
  return { ok: true };
}
