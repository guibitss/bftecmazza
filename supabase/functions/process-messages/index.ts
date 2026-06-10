/**
 * Processador de mensagens com debounce.
 *
 * Pode ser chamado de duas formas:
 * 1. Pelo trigger do banco (via pg_net): recebe { chat_id } no body,
 *    dorme até process_after e processa só aquele chat.
 * 2. Pelo pg_cron (safety-net): sem body, processa todos os chats prontos.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { runSecretaria, summarizeForVendor, transcribeAudio, describeImage } from '../_shared/openai.ts';
import { sendText } from '../_shared/waha.ts';
import { downloadAttachment, addLabels } from '../_shared/chatwoot.ts';
import { isWithinBusinessHours } from '../_shared/businessHours.ts';
import { loadStoreById } from '../_shared/store.ts';
import type {
  ConversationContext,
  ChatMessage,
  MessageBufferRow,
  SecretariaOutput,
  TransferFlowInput,
  StoreConfig,
} from '../_shared/types.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  let chatId: string | undefined;

  if (req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    chatId = body?.chat_id;
  }

  try {
    if (chatId) {
      await processWithDebounce(chatId);
    } else {
      await processAllReady();
    }
  } catch (err) {
    console.error('process-messages fatal:', err);
  }
  return new Response('OK', { status: 200 });
});

async function processWithDebounce(chatId: string) {
  const { data: row, error: rowErr } = await supabase
    .from('message_buffer')
    .select('process_after')
    .eq('chat_id', chatId)
    .maybeSingle();

  if (rowErr) { console.error('buffer select error:', rowErr); return; }
  if (!row)   return;

  const waitMs = new Date(row.process_after).getTime() - Date.now();
  if (waitMs > 0) {
    await new Promise(r => setTimeout(r, waitMs + 200));
  }

  const { data: rows, error: popErr } = await supabase.rpc('pop_specific_chat', { p_chat_id: chatId });
  if (popErr) { console.error('pop error:', popErr); return; }
  if (!rows || rows.length === 0) return;

  const results = await Promise.allSettled(rows.map((r: MessageBufferRow) => processRow(r)));
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.error(`processRow[${i}] rejected:`, r.reason);
  });
}

async function processAllReady() {
  const { data: rows, error } = await supabase.rpc('pop_ready_messages', { p_limit: 10 });
  if (error) throw error;
  if (!rows || rows.length === 0) return;
  await Promise.allSettled((rows as MessageBufferRow[]).map(processRow));
}

async function processRow(row: MessageBufferRow) {
  const ctx = row.conversation_data as ConversationContext & { chat_id?: string };
  if (!ctx.waha_id && ctx.chat_id) ctx.waha_id = ctx.chat_id;

  const storeId = row.store_id ?? 1;
  let store: StoreConfig;
  try {
    store = await loadStoreById(supabase, storeId);
  } catch (err) {
    console.error(`loadStore(${storeId}) error:`, err);
    return;
  }

  let fullMessage = Array.isArray(row.messages)
    ? row.messages.join('\n')
    : String(row.messages);

  const { data: memRow } = await supabase
    .from('conversation_memory')
    .select('messages')
    .eq('phone', row.phone)
    .eq('store_id', storeId)
    .maybeSingle();

  const history: ChatMessage[] = (memRow?.messages as ChatMessage[]) ?? [];

  // Resolve anexos deferidos do chatwoot-webhook
  if (fullMessage.startsWith('__AUDIO__:')) {
    const audioUrl = fullMessage.slice('__AUDIO__:'.length);
    try {
      const buffer = await downloadAttachment(audioUrl);
      fullMessage = await transcribeAudio(buffer);
    } catch (err) {
      console.error('Deferred transcription error:', err);
      return;
    }
  } else {
    const imageMatch = fullMessage.match(/^__IMAGE:(.+?)__:(.+)$/);
    if (imageMatch) {
      const [, mime, imageUrl] = imageMatch;
      try {
        const buffer = await downloadAttachment(imageUrl);
        fullMessage = await describeImage(buffer, mime);
      } catch (err) {
        console.error('Deferred vision error:', err);
        return;
      }
    }
  }

  let output: SecretariaOutput;
  try {
    output = await runSecretaria(fullMessage, history, store.system_prompt);
  } catch (err) {
    console.error(`Secretária error (${row.chat_id}):`, err);
    return;
  }

  const updatedHistory: ChatMessage[] = [
    ...history,
    { role: 'user',      content: fullMessage },
    { role: 'assistant', content: output.mensagem },
  ];

  const { error: memErr } = await supabase
    .from('conversation_memory')
    .upsert(
      { phone: row.phone, store_id: storeId, messages: updatedHistory, updated_at: new Date().toISOString() },
      { onConflict: 'phone,store_id' }
    );
  if (memErr) console.error('Memory upsert error:', memErr);

  await sendText(ctx.waha_id, output.mensagem, store.bot_session, store.waha_url)
    .catch(err => console.error('sendText error:', err));

  await resetChatwootTyping(ctx.id_conta, ctx.id_conversa)
    .catch((err: unknown) => console.error('resetTyping error:', err));

  if (output.transferir) {
    const locked = await isTransferLocked(ctx.source_id);
    // audit em transfer_flow_audit p/ rastrear se fire foi disparado várias vezes
    supabase.from('transfer_flow_audit').insert({
      source_id: ctx.source_id, store_id: storeId, telefone: row.phone,
      step: locked ? 'fire_skipped_locked' : 'fire_transfer',
      detail: { id_conversa: ctx.id_conversa, msg_count: row.messages?.length ?? 0 },
    }).then(({ error }: { error: unknown }) => { if (error) console.error('audit:', error); });

    if (!locked) fireTransferFlow({
      telefone:              row.phone,
      nome:                  ctx.nome,
      ultima_mensagem:       fullMessage,
      id_conta:              ctx.id_conta,
      id_conversa:           ctx.id_conversa,
      source_id:             ctx.source_id,
      contact_id:            ctx.contact_id,
      ultima_mensagem_da_IA: output.mensagem,
      waha_id:               ctx.waha_id,
      store_id:              storeId,
    });
    return;
  }

  if (output.suporte) {
    const locked = await isTransferLocked(ctx.source_id);
    if (!locked) await handleSupport(ctx, row.phone, updatedHistory, store);
  }
}

async function resetChatwootTyping(accountId: number, conversationId: number) {
  const CHATWOOT_URL   = Deno.env.get('CHATWOOT_URL')!;
  const CHATWOOT_TOKEN = Deno.env.get('CHATWOOT_API_TOKEN')!;

  await fetch(
    `${CHATWOOT_URL}/api/v1/accounts/${accountId}/conversations/${conversationId}/toggle_typing_status`,
    {
      method:  'POST',
      headers: { 'api_access_token': CHATWOOT_TOKEN, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ typing_status: 'off' }),
    }
  );
}

async function isTransferLocked(sourceId: string): Promise<boolean> {
  const { data } = await supabase
    .from('transfer_locks')
    .select('source_id')
    .eq('source_id', sourceId)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();
  return !!data;
}

async function handleSupport(
  ctx:     ConversationContext,
  phone:   string,
  history: ChatMessage[],
  store:   StoreConfig
) {
  const inHours = isWithinBusinessHours();
  const clientMsg = inHours
    ? 'Olá. Esperamos que você esteja bem! Sou um dos responsáveis pelo suporte.'
    : 'Olá. Esperamos que você esteja bem! Sou um dos responsáveis pelo suporte. No momento estamos fora do nosso horário de atendimento mas assim que possível vou retornar você. Obrigado pela compreensão!!';

  await sendText(ctx.waha_id, clientMsg, store.support_session, store.waha_url).catch(console.error);

  if (history.length > 0) {
    try {
      const summary = await summarizeForVendor(history);
      await sendText(store.support_notify_chat, `${phone} - ${summary}`, store.bot_session, store.waha_url);
    } catch (err) {
      console.error('Support summary error:', err);
    }
  }

  await addLabels(ctx.id_conta, ctx.id_conversa, [store.support_label]).catch(console.error);

  const { error: lockErr } = await supabase
    .from('transfer_locks')
    .upsert({
      source_id:  ctx.source_id,
      store_id:   store.id,
      expires_at: new Date(Date.now() + 86400_000).toISOString(),
      created_at: new Date().toISOString(),
    });
  if (lockErr) console.error('transfer_lock error:', lockErr);
}

function fireTransferFlow(input: TransferFlowInput) {
  fetch(`${SUPABASE_URL}/functions/v1/transfer-flow`, {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(input),
  }).catch(err => console.error('transfer-flow fire error:', err));
}
