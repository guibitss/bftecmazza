import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { StoreConfig, VendorConfig } from './types.ts';

export async function loadStoreByInboxId(
  supabase: SupabaseClient,
  inboxId: number
): Promise<StoreConfig | null> {
  const { data, error } = await supabase
    .from('stores')
    .select('*')
    .eq('inbox_id', inboxId)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function loadStoreById(
  supabase: SupabaseClient,
  storeId: number
): Promise<StoreConfig> {
  const { data, error } = await supabase
    .from('stores')
    .select('*')
    .eq('id', storeId)
    .single();
  if (error) throw error;
  return data;
}

export async function loadVendors(
  supabase: SupabaseClient,
  storeId: number
): Promise<VendorConfig[]> {
  const { data, error } = await supabase
    .from('vendors')
    .select('*')
    .eq('store_id', storeId)
    .eq('active', true);
  if (error) throw error;
  return data ?? [];
}

export function findVendorByLabels(
  vendors: VendorConfig[],
  labels: string[]
): VendorConfig | undefined {
  for (const label of labels) {
    const v = vendors.find(v => v.label === label && v.queue_order !== null);
    if (v) return v;
  }
  return undefined;
}

export async function assignNextVendor(
  supabase: SupabaseClient,
  storeId: number,
  vendors: VendorConfig[],
  accountId: number,
  conversationId: number,
  existingLabels: string[] = []
): Promise<VendorConfig | undefined> {
  const queueVendors = vendors
    .filter(v => v.queue_order !== null)
    .sort((a, b) => a.queue_order! - b.queue_order!);

  if (queueVendors.length === 0) return undefined;

  // Usa RPC atômica (SELECT FOR UPDATE internamente) para evitar race condition
  const { data: nextName, error } = await supabase
    .rpc('assign_next_vendor', { p_store_id: storeId });

  if (error) throw error;
  if (!nextName) return undefined;

  const next = queueVendors.find(v => v.name === nextName);
  if (!next) return undefined;

  // Aplica etiqueta do vendedor preservando as existentes.
  // Chatwoot POST /labels SUBSTITUI a lista — então fazemos merge antes.
  const mergedLabels = Array.from(new Set([...existingLabels, next.name]));
  const CHATWOOT_URL   = Deno.env.get('CHATWOOT_URL')!;
  const CHATWOOT_TOKEN = Deno.env.get('CHATWOOT_API_TOKEN')!;
  await fetch(
    `${CHATWOOT_URL}/api/v1/accounts/${accountId}/conversations/${conversationId}/labels`,
    {
      method:  'POST',
      headers: { 'api_access_token': CHATWOOT_TOKEN, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ labels: mergedLabels }),
    }
  ).catch(err => console.error('addLabel vendor error:', err));

  return next;
}
