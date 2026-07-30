'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/auth';
import { revalidatePath } from 'next/cache';

// ── Saudações da vendedora (dentro/fora do horário) ──────────────────────────
export async function saveGreetings(vendorId: number, greeting: string, greetingOff: string) {
  const user = await getCurrentUser();
  if (!user.isAdmin && !user.vendorIds.includes(vendorId)) {
    return { ok: false, error: 'Sem permissão para editar este vendedor.' };
  }
  const admin = createAdminClient();
  const { error } = await admin
    .from('vendors')
    .update({ greeting: greeting.trim(), greeting_off: greetingOff.trim() })
    .eq('id', vendorId);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/mensagens');
  return { ok: true };
}

// ── Mensagens rápidas (por login) ────────────────────────────────────────────
export async function addQuickReply(title: string, body: string) {
  const user = await getCurrentUser();
  if (!body.trim()) return { ok: false, error: 'Escreva a mensagem.' };
  const admin = createAdminClient();
  const { error } = await admin
    .from('quick_replies')
    .insert({ owner_user_id: user.id, title: title.trim() || null, body: body.trim() });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/mensagens');
  return { ok: true };
}

export async function updateQuickReply(id: string, title: string, body: string) {
  const user = await getCurrentUser();
  if (!body.trim()) return { ok: false, error: 'Escreva a mensagem.' };
  const admin = createAdminClient();
  const { error } = await admin
    .from('quick_replies')
    .update({ title: title.trim() || null, body: body.trim() })
    .eq('id', id).eq('owner_user_id', user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/mensagens');
  return { ok: true };
}

export async function deleteQuickReply(id: string) {
  const user = await getCurrentUser();
  const admin = createAdminClient();
  const { error } = await admin
    .from('quick_replies')
    .delete()
    .eq('id', id).eq('owner_user_id', user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/mensagens');
  return { ok: true };
}
