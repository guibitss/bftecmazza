'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/auth';

export async function saveConversationNotes(
  conversationId: number,
  notes: string,
): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentUser();
  const admin = createAdminClient();

  // Verifica acesso: user precisa ter acesso a essa conversa (via inbox da loja)
  const { data: conv } = await admin
    .from('conversations').select('id, store_id').eq('id', conversationId).maybeSingle();
  if (!conv) return { ok: false, error: 'Conversa não encontrada' };

  if (!me.isAdmin && me.managerOfStoreId !== conv.store_id) {
    const allowed = me.inboxes.some(i => i.storeId === conv.store_id);
    if (!allowed) return { ok: false, error: 'Sem acesso a essa conversa' };
  }

  const { error } = await admin.from('conversations').update({
    notes: notes.trim() || null,
    notes_updated_at: new Date().toISOString(),
    notes_updated_by: me.id,
  }).eq('id', conversationId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/inbox');
  return { ok: true };
}
