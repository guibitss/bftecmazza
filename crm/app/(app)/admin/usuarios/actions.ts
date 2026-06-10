'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/auth';

interface InboxAccessInput {
  inboxId: number;
  canSend: boolean;
  canManage: boolean;
}

interface InviteInput {
  email: string;
  name: string;
  inboxes: InboxAccessInput[];
}

interface UpdateInput {
  id: string;
  name: string;
  isAdmin: boolean;
  active: boolean;
  inboxes: InboxAccessInput[];
}

async function requireAdmin() {
  const me = await getCurrentUser();
  if (!me.isAdmin) throw new Error('Acesso negado');
  return me;
}

export async function inviteUser(input: InviteInput): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const admin = createAdminClient();

  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();
  if (!email || !name) return { ok: false, error: 'Nome e e-mail são obrigatórios' };

  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { name },
  });
  if (inviteErr || !invited.user) {
    return { ok: false, error: inviteErr?.message ?? 'Falha ao criar usuário' };
  }
  const userId = invited.user.id;

  const { error: profileErr } = await admin.from('app_users').insert({
    id: userId, email, name, is_admin: false, active: true,
  });
  if (profileErr) {
    await admin.auth.admin.deleteUser(userId);
    return { ok: false, error: `Perfil: ${profileErr.message}` };
  }

  if (input.inboxes.length > 0) {
    const { error: inboxErr } = await admin.from('user_inboxes').insert(
      input.inboxes.map(ib => ({
        user_id: userId,
        inbox_id: ib.inboxId,
        can_send: ib.canSend,
        can_manage: ib.canManage,
      })),
    );
    if (inboxErr) return { ok: false, error: `Caixas: ${inboxErr.message}` };
  }

  revalidatePath('/admin/usuarios');
  return { ok: true };
}

export async function updateUser(input: UpdateInput): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAdmin();
  if (input.id === me.id && !input.isAdmin) {
    return { ok: false, error: 'Você não pode tirar o próprio acesso admin' };
  }
  if (input.id === me.id && !input.active) {
    return { ok: false, error: 'Você não pode desativar o próprio usuário' };
  }

  const admin = createAdminClient();
  const { error: updErr } = await admin
    .from('app_users')
    .update({
      name: input.name.trim(),
      is_admin: input.isAdmin,
      active: input.active,
    })
    .eq('id', input.id);
  if (updErr) return { ok: false, error: updErr.message };

  await admin.from('user_inboxes').delete().eq('user_id', input.id);
  if (input.inboxes.length > 0) {
    const { error: insErr } = await admin.from('user_inboxes').insert(
      input.inboxes.map(ib => ({
        user_id: input.id,
        inbox_id: ib.inboxId,
        can_send: ib.canSend,
        can_manage: ib.canManage,
      })),
    );
    if (insErr) return { ok: false, error: `Caixas: ${insErr.message}` };
  }

  revalidatePath('/admin/usuarios');
  revalidatePath(`/admin/usuarios/${input.id}`);
  return { ok: true };
}

export async function resendInvite(email: string): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.inviteUserByEmail(email.trim().toLowerCase());
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteUser(id: string): Promise<{ ok: boolean; error?: string }> {
  const me = await requireAdmin();
  if (id === me.id) return { ok: false, error: 'Você não pode apagar o próprio usuário' };
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/usuarios');
  return { ok: true };
}
