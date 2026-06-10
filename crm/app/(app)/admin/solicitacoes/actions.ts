'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/auth';

interface InboxAccessInput {
  inboxId: number;
  canSend: boolean;
  canManage: boolean;
}

interface ApproveInput {
  userId: string;
  managerOfStoreId: number | null;   // null = não é gerente
  inboxes: InboxAccessInput[];
}

async function requireAdmin() {
  const me = await getCurrentUser();
  if (!me.isAdmin) throw new Error('Acesso negado');
  return me;
}

export async function approveUser(input: ApproveInput): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAdmin();
  const admin = createAdminClient();

  // 1. Atualiza app_users → approved + manager_of_store_id
  const { error: updErr } = await admin.from('app_users').update({
    status: 'approved',
    approved_at: new Date().toISOString(),
    approved_by: me.id,
    manager_of_store_id: input.managerOfStoreId,
  }).eq('id', input.userId);
  if (updErr) return { ok: false, error: updErr.message };

  // 2. Limpa caixas anteriores (caso fosse reaprovação) e cria novas
  await admin.from('user_inboxes').delete().eq('user_id', input.userId);
  if (input.inboxes.length > 0) {
    const { error: insErr } = await admin.from('user_inboxes').insert(
      input.inboxes.map(ib => ({
        user_id: input.userId,
        inbox_id: ib.inboxId,
        can_send: ib.canSend,
        can_manage: ib.canManage,
      })),
    );
    if (insErr) return { ok: false, error: `Caixas: ${insErr.message}` };
  }

  revalidatePath('/admin/solicitacoes');
  revalidatePath('/admin/usuarios');
  return { ok: true };
}

export async function rejectUser(userId: string): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAdmin();
  const admin = createAdminClient();

  const { error } = await admin.from('app_users').update({
    status: 'rejected',
    approved_at: new Date().toISOString(),
    approved_by: me.id,
  }).eq('id', userId);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/solicitacoes');
  return { ok: true };
}

export async function deletePending(userId: string): Promise<void> {
  await requireAdmin();
  const admin = createAdminClient();
  await admin.auth.admin.deleteUser(userId);
  revalidatePath('/admin/solicitacoes');
  redirect('/admin/solicitacoes');
}
