/**
 * Fluxo de transferência para vendedor.
 * Chamado de forma assíncrona (fire-and-forget) pelo process-messages.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getConversation } from '../_shared/chatwoot.ts';
import { sendText } from '../_shared/waha.ts';
import { summarizeForVendor } from '../_shared/openai.ts';
import { isWithinBusinessHours } from '../_shared/businessHours.ts';
import { loadStoreById, loadVendors, findVendorByLabels, assignNextVendor } from '../_shared/store.ts';
import type { TransferFlowInput, VendorConfig, ChatMessage } from '../_shared/types.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const QUEUE_TRIGGER_LABELS = new Set(['guilherme', 'agente-off']);

// fire-and-forget audit insert
function audit(
  source_id:  string | undefined,
  store_id:   number | undefined,
  telefone:   string | undefined,
  step:       string,
  vendor:     string | null = null,
  detail:     unknown = null
) {
  supabase
    .from('transfer_flow_audit')
    .insert({ source_id, store_id, telefone, step, vendor, detail })
    .then(({ error }: { error: unknown }) => {
      if (error) console.error('audit insert error:', error);
    });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('OK', { status: 200 });

  let input: TransferFlowInput;
  try {
    input = await req.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  try {
    await handleTransfer(input);
    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('transfer-flow error:', err);
    audit(input!?.source_id, input!?.store_id, input!?.telefone, 'fatal_error', null, { error: String(err) });
    return new Response(String(err), { status: 500 });
  }
});

async function handleTransfer(input: TransferFlowInput) {
  const storeId = input.store_id ?? 1;
  const src     = input.source_id;
  const tel     = input.telefone;
  const tagBase = `[transfer-flow store=${storeId} src=${src?.slice(0,8)} tel=${tel}]`;

  audit(src, storeId, tel, 'invoked', null, { waha_id: input.waha_id, id_conversa: input.id_conversa });

  // 0. Adquire lock ATOMICAMENTE
  const { data: acquired, error: lockErr } = await supabase.rpc('acquire_transfer_lock', {
    p_source_id: src,
    p_store_id:  storeId,
  });
  if (lockErr) {
    console.error(`${tagBase} lock RPC error:`, lockErr);
    audit(src, storeId, tel, 'lock_error', null, { error: String(lockErr) });
    return;
  }
  if (!acquired) {
    console.log(`${tagBase} aborted — lock held`);
    audit(src, storeId, tel, 'lock_aborted');
    return;
  }
  audit(src, storeId, tel, 'lock_acquired');

  const [store, vendors] = await Promise.all([
    loadStoreById(supabase, storeId),
    loadVendors(supabase, storeId),
  ]);

  // 1. Busca etiquetas atuais
  let currentLabels: string[] = [];
  try {
    const conv = await getConversation(input.id_conta, input.id_conversa);
    currentLabels = (conv.labels as string[]) ?? [];
  } catch (err) {
    console.error(`${tagBase} getConversation error:`, err);
    audit(src, storeId, tel, 'getConversation_error', null, { error: String(err) });
  }
  audit(src, storeId, tel, 'labels_read', null, { labels: currentLabels });

  // 2. Resolve vendedor
  const vendor = await resolveVendor(currentLabels, vendors, storeId, input.id_conta, input.id_conversa);
  if (!vendor) {
    audit(src, storeId, tel, 'no_vendor');
    return;
  }
  audit(src, storeId, tel, 'vendor_resolved', vendor.name, {
    via: currentLabels.some(l => vendors.find(v => v.label === l && v.queue_order !== null))
      ? 'existing_label'
      : 'queue',
  });

  const inHours = isWithinBusinessHours();
  const tag = `${tagBase} vendor=${vendor.name}`;
  console.log(`${tag} starting (inHours=${inHours})`);

  // 3. Saudação ao cliente
  const greeting = inHours ? vendor.greeting : vendor.greeting_off;
  // GOWS engine não consegue enviar para @lid — usa telefone@c.us como fallback
  const destId = input.waha_id.endsWith('@lid') && input.telefone
    ? input.telefone.replace(/^\+/, '') + '@c.us'
    : input.waha_id;
  try {
    const t0 = Date.now();
    await sendText(destId, greeting, vendor.waha_session, store.waha_url);
    audit(src, storeId, tel, 'greeting_ok', vendor.name, { ms: Date.now() - t0, session: vendor.waha_session });
  } catch (err) {
    console.error(`${tag} greeting FAILED:`, err);
    audit(src, storeId, tel, 'greeting_failed', vendor.name, { error: String(err), session: vendor.waha_session });
  }

  // 4. Resumo ao vendedor
  if (vendor.summary_chat) {
    const { data: memRow } = await supabase
      .from('conversation_memory')
      .select('messages')
      .eq('phone', tel)
      .eq('store_id', storeId)
      .maybeSingle();

    const history: ChatMessage[] = (memRow?.messages as ChatMessage[]) ?? [];

    if (history.length > 0) {
      try {
        const t0 = Date.now();
        const summary = await summarizeForVendor(history);
        const t1 = Date.now();
        await sendText(vendor.summary_chat, `${tel} - ${summary}`, store.bot_session, store.waha_url);
        audit(src, storeId, tel, 'summary_ok', vendor.name, {
          openai_ms: t1 - t0, send_ms: Date.now() - t1, to: vendor.summary_chat,
        });
      } catch (err) {
        console.error(`${tag} summary FAILED:`, err);
        audit(src, storeId, tel, 'summary_failed', vendor.name, {
          error: String(err), to: vendor.summary_chat,
        });
      }
    } else {
      audit(src, storeId, tel, 'summary_skipped_empty_history', vendor.name);
    }
  } else {
    audit(src, storeId, tel, 'summary_skipped_no_chat', vendor.name);
  }

  audit(src, storeId, tel, 'done', vendor.name);
}

async function resolveVendor(
  labels:         string[],
  vendors:        VendorConfig[],
  storeId:        number,
  accountId:      number,
  conversationId: number
): Promise<VendorConfig | undefined> {
  const supportLabels = vendors.filter(v => v.queue_order === null).map(v => v.label);
  const skipLabels = new Set([...QUEUE_TRIGGER_LABELS, ...supportLabels]);
  const activeLabels = labels.filter(l => !skipLabels.has(l));

  const existing = findVendorByLabels(vendors, activeLabels);
  if (existing) return existing;

  return assignNextVendor(supabase, storeId, vendors, accountId, conversationId, labels);
}
