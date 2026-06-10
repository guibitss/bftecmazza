'use server';

import { createClient } from '@/lib/supabase/server';
import { getCurrentUser } from '@/lib/auth';

async function canManageStore(storeId: number): Promise<boolean> {
  const user = await getCurrentUser();
  return user.isAdmin || user.managerOfStoreId === storeId;
}

export async function createLabel(
  storeId: number,
  name: string,
  color: string,
): Promise<{ ok: boolean; error?: string; id?: string }> {
  if (!(await canManageStore(storeId))) return { ok: false, error: 'Sem permissão' };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('labels')
    .insert({ store_id: storeId, name: name.trim(), color })
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
  const { data: label } = await supabase
    .from('labels')
    .select('store_id')
    .eq('id', id)
    .maybeSingle();
  if (!label) return { ok: false, error: 'Etiqueta não encontrada' };
  if (!(await canManageStore((label as { store_id: number }).store_id)))
    return { ok: false, error: 'Sem permissão' };
  const { error } = await supabase
    .from('labels')
    .update({ name: name.trim(), color })
    .eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteLabel(id: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: label } = await supabase
    .from('labels')
    .select('store_id')
    .eq('id', id)
    .maybeSingle();
  if (!label) return { ok: false, error: 'Etiqueta não encontrada' };
  if (!(await canManageStore((label as { store_id: number }).store_id)))
    return { ok: false, error: 'Sem permissão' };
  const { error } = await supabase.from('labels').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
