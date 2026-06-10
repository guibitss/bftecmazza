'use server';

import { revalidatePath } from 'next/cache';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/auth';

interface CreateInput {
  storeId:        number;
  vendorId:       number | null;   // null = agregado da loja
  metric:         string;
  comparison:     'gt' | 'lt';
  threshold:      number;
  whatsappNumber: string;
  frequency:      'once_per_hour' | 'once_per_day' | 'always';
}

export async function createMetricAlert(input: CreateInput): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentUser();
  if (!me.isAdmin && me.managerOfStoreId !== input.storeId) {
    return { ok: false, error: 'Você não gerencia essa loja' };
  }
  const admin = createAdminClient();
  const phone = input.whatsappNumber.replace(/\D/g, '');
  if (phone.length < 10) return { ok: false, error: 'WhatsApp inválido' };

  // Valida no WhatsApp
  let normalized = phone;
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/validate-whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone }),
    });
    const data = await res.json();
    if (!data.valid) return { ok: false, error: data.error ?? 'WhatsApp não encontrado' };
    normalized = data.normalized;
  } catch (err) {
    return { ok: false, error: 'Falha ao validar: ' + (err instanceof Error ? err.message : String(err)) };
  }

  const { error } = await admin.from('metric_alerts').insert({
    user_id: me.id,
    store_id: input.storeId,
    vendor_id: input.vendorId,
    metric: input.metric,
    comparison: input.comparison,
    threshold: input.threshold,
    whatsapp_number: normalized,
    frequency: input.frequency,
    enabled: true,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/alertas');
  return { ok: true };
}

export async function toggleAlert(id: number, enabled: boolean): Promise<{ ok: boolean }> {
  const me = await getCurrentUser();
  const admin = createAdminClient();
  await admin.from('metric_alerts').update({ enabled }).eq('id', id).eq('user_id', me.id);
  revalidatePath('/alertas');
  return { ok: true };
}

export async function deleteAlert(id: number): Promise<{ ok: boolean }> {
  const me = await getCurrentUser();
  const admin = createAdminClient();
  await admin.from('metric_alerts').delete().eq('id', id).eq('user_id', me.id);
  revalidatePath('/alertas');
  return { ok: true };
}
