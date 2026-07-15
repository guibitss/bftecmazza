import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { ConversationContext } from '../_shared/types.ts';
import { loadStoreByInboxId, loadVendors } from '../_shared/store.ts';
import { sendText } from '../_shared/waha.ts';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// Quando definido, só processa mensagens desses números (modo teste).
// Formato: números separados por vírgula, ex: "+5541996920735,+5544999999999"
const TEST_WHITELIST = Deno.env.get('TEST_WHITELIST') ?? '';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('OK', { status: 200 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  try {
    await handleWebhook(body);
  } catch (err) {
    console.error('Webhook error:', err);
  }

  return new Response('OK', { status: 200 });
});

async function handleWebhook(body: Record<string, unknown>) {
  const conversation   = (body.conversation ?? {}) as Record<string, unknown>;
  const contactInbox   = (conversation.contact_inbox ?? {}) as Record<string, unknown>;
  const messages       = (conversation.messages as unknown[]) ?? [];
  const firstMsg       = (messages[0] ?? {}) as Record<string, unknown>;
  const sender         = (firstMsg.sender ?? {}) as Record<string, unknown>;
  const customAttrs    = (sender.custom_attributes ?? {}) as Record<string, unknown>;
  const msgAttachments = (firstMsg.attachments as unknown[]) ?? [];
  const firstAttach    = (msgAttachments[0] ?? {}) as Record<string, unknown>;
  const senderTop      = (body.sender ?? {}) as Record<string, unknown>;

  const ctx: ConversationContext = {
    id_mensagem:       Number(body.id),
    id_conta:          Number((body.account as Record<string, unknown>)?.id),
    id_conversa:       Number(conversation.id),
    telefone:          String(senderTop.phone_number ?? ''),
    mensagem:          String(body.content ?? ''),
    mensagem_de_audio: String(firstAttach.file_type ?? ''),
    timestamp:         Number(body.created_at ?? 0),
    tipo:              String(body.message_type ?? ''),
    etiquetas:         (conversation.labels as string[]) ?? [],
    waha_id:           String(customAttrs.waha_whatsapp_chat_id ?? ''),
    source_id:         String(contactInbox.source_id ?? ''),
    contact_id:        Number(contactInbox.contact_id ?? 0),
    nome:              String(sender.name ?? ''),
  };

  const inboxId = Number(contactInbox.inbox_id ?? 0);

  // Filtros base
  if (ctx.tipo !== 'incoming')        return;
  if (ctx.etiquetas.includes('equipe')) {
    // Cliente já encaminhado pra equipe voltou a chamar: avisa o responsável
    // e registra pro reengajamento da IA (reengage-check) se ninguém responder
    await handleTeamReturn(ctx, inboxId, firstAttach);
    return;
  }
  if (ctx.mensagem.includes('👥'))    return;
  if (!ctx.waha_id)                   return;

  // Carrega loja pelo inbox_id — ignora webhooks de inboxes não configuradas
  const store = await loadStoreByInboxId(supabase, inboxId);
  if (!store) return;

  // Filtro de whitelist para modo teste
  if (TEST_WHITELIST) {
    const allowed = TEST_WHITELIST.split(',').map(n => n.trim());
    if (!allowed.includes(ctx.telefone) && !allowed.includes(ctx.waha_id)) return;
  }

  let mensagem = ctx.mensagem;
  const fileType = ctx.mensagem_de_audio;

  // Áudio e imagem: salva URL no buffer com marcador.
  // A transcrição/visão acontece no process-messages, sem risco de timeout aqui.
  if (!mensagem && fileType.startsWith('audio')) {
    const audioUrl = String(firstAttach.data_url ?? '');
    if (!audioUrl) return;
    mensagem = `__AUDIO__:${audioUrl}`;
  }

  if (!mensagem && fileType.startsWith('image')) {
    const imageUrl = String(firstAttach.data_url ?? '');
    if (!imageUrl) return;
    const mime = imageUrl.includes('.png') ? 'image/png'
               : imageUrl.includes('.webp') ? 'image/webp'
               : 'image/jpeg';
    mensagem = `__IMAGE:${mime}__:${imageUrl}`;
  }

  if (!mensagem.trim()) return;

  const phone = ctx.telefone || ctx.waha_id;

  const { error } = await supabase.rpc('upsert_message_buffer', {
    p_waha_id:           ctx.waha_id,
    p_message:           mensagem,
    p_phone:             phone,
    p_conversation_data: ctx,
    p_store_id:          store.id,
  });

  if (error) throw error;
}

const NOTIFY_THROTTLE_MS = 60 * 60 * 1000; // 1 aviso por hora por conversa

/**
 * Conversa etiquetada 'equipe' recebeu mensagem nova do cliente.
 * 1. Registra/atualiza o episódio em reengage_state
 * 2. Avisa o responsável (vendedora da etiqueta ou suporte da loja) — 1x/hora
 * O reengajamento da IA (após 3h sem resposta humana) roda no reengage-check.
 */
async function handleTeamReturn(
  ctx: ConversationContext,
  inboxId: number,
  firstAttach: Record<string, unknown>,
) {
  try {
    const store = await loadStoreByInboxId(supabase, inboxId);
    if (!store) return;

    // Resume mídia pra exibição/replay
    let msg = ctx.mensagem;
    const fileType = ctx.mensagem_de_audio;
    if (!msg && fileType.startsWith('audio')) msg = `__AUDIO__:${String(firstAttach.data_url ?? '')}`;
    if (!msg && fileType.startsWith('image')) msg = `__IMAGE:image/jpeg__:${String(firstAttach.data_url ?? '')}`;
    if (!msg.trim()) return;

    const { data: st } = await supabase
      .from('reengage_state')
      .select('*')
      .eq('account_id', ctx.id_conta)
      .eq('conversation_id', ctx.id_conversa)
      .maybeSingle();

    const now = Date.now();
    const episodioFechado = st && (st.resolved_at || st.taken_over_at);
    const row = {
      account_id:          ctx.id_conta,
      conversation_id:     ctx.id_conversa,
      store_id:            store.id,
      phone:               ctx.telefone || ctx.waha_id,
      waha_id:             ctx.waha_id,
      last_msg:            msg,
      ctx:                 ctx as unknown as Record<string, unknown>,
      // Episódio novo (nunca visto ou o anterior já foi fechado): reinicia o relógio
      first_unanswered_at: (!st || episodioFechado) ? new Date(now).toISOString() : st.first_unanswered_at,
      taken_over_at:       (!st || episodioFechado) ? null : st.taken_over_at,
      resolved_at:         null,
      last_notified_at:    st?.last_notified_at ?? null,
    };

    const deveNotificar =
      !row.last_notified_at ||
      now - new Date(row.last_notified_at as string).getTime() > NOTIFY_THROTTLE_MS;

    if (deveNotificar) {
      // Vendedora da etiqueta > suporte da loja
      const vendors = await loadVendors(supabase, store.id);
      const vendor = vendors.find(v => ctx.etiquetas.includes(v.label) && v.summary_chat);
      const target = vendor?.summary_chat ?? store.support_notify_chat;
      if (target) {
        const preview = msg.startsWith('__AUDIO__') ? '[áudio]'
                      : msg.startsWith('__IMAGE') ? '[imagem]'
                      : msg.slice(0, 120);
        const nome = ctx.nome ? `${ctx.nome} — ` : '';
        await sendText(
          target,
          `🔁 *Cliente voltou a chamar no número principal*\n\n${nome}${ctx.telefone || ctx.waha_id}\n"${preview}"\n\n_Responda por lá — se ninguém responder em 3h, a IA reassume._`,
          store.bot_session,
          store.waha_url,
        );
        row.last_notified_at = new Date(now).toISOString();
      }
    }

    const { error } = await supabase
      .from('reengage_state')
      .upsert(row, { onConflict: 'account_id,conversation_id' });
    if (error) console.error('reengage upsert:', error);
  } catch (err) {
    // Nunca propaga — o webhook precisa responder 200 sempre
    console.error('handleTeamReturn:', err);
  }
}
