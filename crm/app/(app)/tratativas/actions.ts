'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/auth';

interface CreateInput {
  storeId:        number;
  customerName:   string;
  customerPhone:  string;
  notes:          string;
  sendAt:         string;   // ISO
}

export async function createTratativa(input: CreateInput): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentUser();
  const admin = createAdminClient();

  if (!input.customerName.trim() || !input.customerPhone.trim() || !input.sendAt) {
    return { ok: false, error: 'Preencha cliente, número e data' };
  }
  if (new Date(input.sendAt).getTime() <= Date.now()) {
    return { ok: false, error: 'Data deve ser no futuro' };
  }

  const { error } = await admin.from('tratativas').insert({
    user_id: me.id,
    store_id: input.storeId,
    customer_name: input.customerName.trim(),
    customer_phone: input.customerPhone.trim(),
    notes: input.notes?.trim() || null,
    send_at: input.sendAt,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/tratativas');
  return { ok: true };
}

export async function cancelTratativa(id: number): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentUser();
  const admin = createAdminClient();

  const { error } = await admin
    .from('tratativas')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('user_id', me.id)
    .eq('status', 'pending');
  if (error) return { ok: false, error: error.message };

  revalidatePath('/tratativas');
  return { ok: true };
}

export async function setMyWhatsapp(num: string): Promise<{ ok: boolean; error?: string; normalized?: string }> {
  const me = await getCurrentUser();
  const admin = createAdminClient();

  const digits = num.replace(/\D/g, '');
  if (digits.length < 10) return { ok: false, error: 'Número curto demais' };

  // Valida no WhatsApp via Edge Function
  let normalized = digits;
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/validate-whatsapp`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ phone: digits }),
    });
    const data = await res.json();
    if (!data.valid) {
      return { ok: false, error: data.error ?? 'Esse número não tem WhatsApp ativo' };
    }
    normalized = data.normalized;
  } catch (err) {
    return { ok: false, error: 'Falha ao validar com o WhatsApp: ' + (err instanceof Error ? err.message : String(err)) };
  }

  const { error } = await admin.from('app_users').update({ whatsapp_number: normalized }).eq('id', me.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/tratativas');
  revalidatePath('/alertas');
  return { ok: true, normalized };
}
