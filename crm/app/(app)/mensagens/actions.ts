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
export interface QuickMedia {
  url: string; mime: string | null; filename: string | null; kind: string;
}

export async function addQuickReply(title: string, body: string, media?: QuickMedia[] | QuickMedia | null) {
  const user = await getCurrentUser();
  const itens = Array.isArray(media) ? media : media ? [media] : [];
  if (!body.trim() && itens.length === 0) {
    return { ok: false, error: 'Escreva a mensagem ou anexe um arquivo.' };
  }
  const primeiro = itens[0];
  const admin = createAdminClient();
  const { error } = await admin.from('quick_replies').insert({
    owner_user_id:  user.id,
    title:          title.trim() || null,
    body:           body.trim() || null,
    media_items:    itens,
    // Espelha o primeiro anexo nas colunas antigas (compatibilidade)
    media_url:      primeiro?.url ?? null,
    media_mime:     primeiro?.mime ?? null,
    media_filename: primeiro?.filename ?? null,
    kind:           primeiro?.kind ?? 'text',
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/mensagens');
  return { ok: true };
}

export async function updateQuickReply(id: string, title: string, body: string) {
  const user = await getCurrentUser();
  const admin = createAdminClient();
  // Sem body só é válido se já houver mídia salva
  if (!body.trim()) {
    const { data: atual } = await admin
      .from('quick_replies').select('media_url, media_items')
      .eq('id', id).eq('owner_user_id', user.id).maybeSingle();
    const temMidia = !!atual?.media_url || ((atual?.media_items as unknown[] | null)?.length ?? 0) > 0;
    if (!temMidia) return { ok: false, error: 'Escreva a mensagem.' };
  }
  const { error } = await admin
    .from('quick_replies')
    .update({ title: title.trim() || null, body: body.trim() || null })
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
