/**
 * reengage-check
 * ----------------------------------------------------------------
 * pg_cron a cada 15 min. Fecha o ciclo da Opção C:
 *
 * Conversas etiquetadas 'equipe' que receberam mensagem nova do cliente
 * (registradas em reengage_state pelo chatwoot-webhook) e ficaram 3h
 * sem NENHUMA resposta humana no Chatwoot:
 *   1. Remove a etiqueta 'equipe' → a IA volta a atender a conversa
 *   2. Reinjeta a última mensagem do cliente no buffer → IA responde já
 *   3. Avisa o suporte da loja que reassumiu
 *
 * Se um humano respondeu dentro das 3h, o episódio é marcado resolvido.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getConversation, getMessages, addLabels } from '../_shared/chatwoot.ts';
import { sendText } from '../_shared/waha.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const TAKEOVER_HOURS = 3;

interface ReengageRow {
  account_id: number;
  conversation_id: number;
  store_id: number | null;
  phone: string | null;
  waha_id: string | null;
  last_msg: string | null;
  ctx: Record<string, unknown> | null;
  first_unanswered_at: string;
}

Deno.serve(async () => {
  try {
    const cutoff = new Date(Date.now() - TAKEOVER_HOURS * 3600 * 1000).toISOString();
    const { data: pending } = await supabase
      .from('reengage_state')
      .select('*')
      .is('resolved_at', null)
      .is('taken_over_at', null)
      .lt('first_unanswered_at', cutoff);

    for (const st of (pending ?? []) as ReengageRow[]) {
      try {
        await checkOne(st);
      } catch (err) {
        console.error(`reengage conv=${st.conversation_id}:`, err);
      }
    }
  } catch (err) {
    console.error('reengage-check fatal:', err);
  }
  return new Response('OK');
});

async function checkOne(st: ReengageRow) {
  const keys = { account_id: st.account_id, conversation_id: st.conversation_id };

  // Humano respondeu depois que o cliente voltou? (message_type 1 = outgoing)
  const msgs = await getMessages(st.account_id, st.conversation_id);
  const list = ((msgs?.payload ?? []) as { message_type: number; created_at: number }[]);
  const cutoffEpoch = new Date(st.first_unanswered_at).getTime() / 1000;
  const humanReplied = list.some(m => m.message_type === 1 && Number(m.created_at) > cutoffEpoch);

  if (humanReplied) {
    await supabase.from('reengage_state')
      .update({ resolved_at: new Date().toISOString() })
      .match(keys);
    return;
  }

  // Sem resposta em 3h → IA reassume
  const conv = await getConversation(st.account_id, st.conversation_id);
  const labels = ((conv.labels ?? []) as string[]).filter(l => l !== 'equipe');
  await addLabels(st.account_id, st.conversation_id, labels);

  if (st.waha_id && st.last_msg && st.ctx && st.store_id) {
    const { error: bufErr } = await supabase.rpc('upsert_message_buffer', {
      p_waha_id:           st.waha_id,
      p_message:           st.last_msg,
      p_phone:             st.phone ?? st.waha_id,
      p_conversation_data: st.ctx,
      p_store_id:          st.store_id,
    });
    if (bufErr) throw bufErr;
  }

  await supabase.from('reengage_state')
    .update({ taken_over_at: new Date().toISOString() })
    .match(keys);

  console.log(`IA reassumiu conv=${st.conversation_id} phone=${st.phone}`);

  // Aviso ao suporte da loja (best-effort)
  if (st.store_id) {
    const { data: store } = await supabase
      .from('stores')
      .select('waha_url, bot_session, support_notify_chat')
      .eq('id', st.store_id)
      .single();
    if (store?.support_notify_chat) {
      await sendText(
        store.support_notify_chat as string,
        `🤖 *IA reassumiu o atendimento*\n\n${st.phone ?? st.waha_id}\nMotivo: cliente voltou a chamar e ninguém respondeu em ${TAKEOVER_HOURS}h.`,
        store.bot_session as string,
        store.waha_url as string,
      ).catch(() => {});
    }
  }
}
