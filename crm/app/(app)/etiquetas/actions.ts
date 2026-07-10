'use server';

import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth';

async function hasStoreAccess(storeId: number): Promise<boolean> {
  const user = await getCurrentUser();
  return (
    user.isAdmin ||
    user.managerOfStoreId === storeId ||
    user.groups.some(g => g.storeId === storeId)
  );
}

export async function createLabel(
  storeId: number,
  name: string,
  color: string,
  personal: boolean,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  if (!(await hasStoreAccess(storeId))) return { ok: false, error: 'Sem permissão' };
  const user = await getCurrentUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('labels')
    .insert({
      store_id: storeId,
      name: name.trim(),
      color,
      owner_user_id: personal ? user.id : null,
    })
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: (data as { id: string }).id };
}

export async function updateLabel(
  id: string,
  name: string,
  color: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  // RLS: só retorna etiquetas visíveis, e o UPDATE só passa se for geral
  // da loja com acesso ou pessoal do próprio usuário
  const { error, count } = await supabase
    .from('labels')
    .update({ name: name.trim(), color }, { count: 'exact' })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: 'Etiqueta não encontrada ou sem permissão' };
  return { ok: true };
}

export async function deleteLabel(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { error, count } = await supabase
    .from('labels')
    .delete({ count: 'exact' })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: 'Etiqueta não encontrada ou sem permissão' };
  return { ok: true };
}
