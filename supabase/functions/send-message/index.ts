/**
 * send-message
 * ---------------------------------------------------------------
 * Endpoint chamado pelo CRM quando alguém envia mensagem na thread.
 *
 * Fluxo:
 *  1. Valida que o usuário autenticado pode enviar na conversa (via RLS)
 *  2. Resolve sessão WAHA escolhida ("enviar como…") → store + URL + role
 *  3. Insere optimistic row em `messages` com status enviando
 *  4. Chama WAHA (/api/sendText, /api/sendImage, /api/sendFile, /api/sendVoice)
 *  5. Atualiza waha_message_id na row. Se erro, marca como falhou.
 *
 * Idempotência: WAHA pode disparar o webhook depois — INSERT do webhook
 * dará conflict no waha_message_id (UNIQUE) e será ignorado.
 */
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL  = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY   = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY      = Deno.env.get('SUPABASE_ANON_KEY')!;
const WAHA_API_KEY  = Deno.env.get('WAHA_API_KEY')!;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface SendInput {
  conversation_id: number;
  via_session:     string;   // sessão WAHA escolhida no dropdown
  kind:            'text' | 'image' | 'video' | 'audio' | 'document';
  body?:           string;   // texto (sempre) ou caption (mídia)
  media_url?:      string;   // URL pública do Supabase Storage
  media_mime?:     string;
  media_filename?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST')    return json({ ok: false, error: 'POST only' }, 405);

  // Pega user logado pela JWT
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient: SupabaseClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ ok: false, error: 'unauthorized' }, 401);

  let input: SendInput;
  try {
    input = await req.json();
  } catch {
    return json({ ok: false, error: 'bad json' }, 400);
  }

  if (!input.conversation_id || !input.via_session || !input.kind) {
    return json({ ok: false, error: 'missing fields' }, 400);
  }

  // 1. Pega a conversa (com RLS o user só vê conversas que pode acessar)
  const { data: conv, error: convErr } = await userClient
    .from('conversations')
    .select('id, inbox_id, store_id, waha_id, customer_phone')
    .eq('id', input.conversation_id)
    .maybeSingle();
  if (convErr || !conv) return json({ ok: false, error: 'conversation not found / no access' }, 403);

  // GOWS engine não consegue enviar para @lid — converte para @c.us
  const chatId = (conv.waha_id as string).endsWith('@lid') && conv.customer_phone
    ? (conv.customer_phone as string).replace(/^\+/, '') + '@c.us'
    : (conv.waha_id as string);

  // 2. Resolve sessão escolhida → store + URL + role/vendor
  const { data: resolved } = await admin.rpc('resolve_session', { p_session: input.via_session });
  const sessionInfo = Array.isArray(resolved) ? resolved[0] : resolved;
  if (!sessionInfo?.store_id) return json({ ok: false, error: 'sessão WAHA não cadastrada' }, 400);
  if (sessionInfo.store_id !== conv.store_id) {
    return json({ ok: false, error: 'sessão pertence a outra loja' }, 400);
  }

  // Pega URL do WAHA da loja
  const { data: store } = await admin
    .from('stores').select('waha_url').eq('id', conv.store_id).single();
  if (!store) return json({ ok: false, error: 'loja não encontrada' }, 500);
  const wahaUrl = store.waha_url as string;

  const authorType =
    sessionInfo.session_role === 'vendor'  ? 'vendor'  :
    sessionInfo.session_role === 'support' ? 'support' : 'ai';

  // 3. INSERT optimistic em messages (sem waha_message_id — atualizamos depois)
  const { data: inserted, error: insErr } = await admin
    .from('messages')
    .insert({
      conversation_id: conv.id,
      inbox_id:        conv.inbox_id,
      store_id:        conv.store_id,
      direction:       'out',
      author_type:     authorType,
      author_id:       sessionInfo.vendor_id ?? null,
      author_session:  input.via_session,
      kind:            input.kind,
      body:            input.body ?? null,
      media_url:       input.media_url ?? null,
      media_mime:      input.media_mime ?? null,
      media_filename:  input.media_filename ?? null,
      sent_via:        'manual',
      ack:             0,
    })
    .select('id')
    .single();
  if (insErr || !inserted) return json({ ok: false, error: `insert: ${insErr?.message}` }, 500);

  // 4. Chama WAHA
  try {
    const wahaRes = await callWaha(wahaUrl, input, chatId);
    // 5. Atualiza waha_message_id pra idempotência futura
    const wahaMessageId = String((wahaRes as { id?: string; ID?: string })?.id ?? (wahaRes as { ID?: string })?.ID ?? '');
    if (wahaMessageId) {
      await admin.from('messages')
        .update({ waha_message_id: wahaMessageId, ack: 1, raw: wahaRes as Record<string, unknown> })
        .eq('id', inserted.id);
    } else {
      await admin.from('messages').update({ ack: 1, raw: wahaRes as Record<string, unknown> }).eq('id', inserted.id);
    }
    return json({ ok: true, id: inserted.id, waha_message_id: wahaMessageId });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await admin.from('messages').update({
      kind: 'system',
      body: `[falha ao enviar] ${errMsg}`,
    }).eq('id', inserted.id);
    return json({ ok: false, error: errMsg }, 502);
  }
});

// Fallback para números BR com nono dígito: 55 + DDD(2) + 9DIGITOS → tenta sem o 9 inicial
function alternativeBrChatId(chatId: string): string | null {
  const m = chatId.match(/^(\d+)(@.+)$/);
  if (!m) return null;
  const [, number, suffix] = m;
  if (number.startsWith('55') && number.length === 13) {
    const phone = number.slice(4);
    if (phone.startsWith('9')) return `${number.slice(0, 4)}${phone.slice(1)}${suffix}`;
  }
  return null;
}

async function callWaha(wahaUrl: string, input: SendInput, chatId: string): Promise<unknown> {
  const headers = { 'X-Api-Key': WAHA_API_KEY, 'Content-Type': 'application/json' };
  const base = { chatId, session: input.via_session };

  let endpoint: string;
  let body: Record<string, unknown>;

  switch (input.kind) {
    case 'text':
      endpoint = `${wahaUrl}/api/sendText`;
      body = { ...base, text: input.body ?? '', linkPreview: true };
      break;
    case 'image':
      endpoint = `${wahaUrl}/api/sendImage`;
      body = { ...base, file: { url: input.media_url, mimetype: input.media_mime, filename: input.media_filename }, caption: input.body ?? '' };
      break;
    case 'video':
      endpoint = `${wahaUrl}/api/sendVideo`;
      body = { ...base, file: { url: input.media_url, mimetype: input.media_mime, filename: input.media_filename }, caption: input.body ?? '' };
      break;
    case 'audio':
      endpoint = `${wahaUrl}/api/sendVoice`;
      body = { ...base, file: { url: input.media_url, mimetype: input.media_mime, filename: input.media_filename } };
      break;
    case 'document':
      endpoint = `${wahaUrl}/api/sendFile`;
      body = { ...base, file: { url: input.media_url, mimetype: input.media_mime, filename: input.media_filename }, caption: input.body ?? '' };
      break;
    default:
      throw new Error(`kind não suportado: ${input.kind}`);
  }

  const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    // Tenta sem o nono dígito se o engine não encontrou o LID
    if (txt.includes('no LID found') || txt.includes('463')) {
      const alt = alternativeBrChatId(chatId);
      if (alt) {
        const res2 = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...body, chatId: alt }),
        });
        if (res2.ok) return await res2.json().catch(() => ({}));
        const txt2 = await res2.text().catch(() => '');
        throw new Error(`WAHA ${res2.status}: ${txt2.slice(0, 200)}`);
      }
    }
    throw new Error(`WAHA ${res.status}: ${txt.slice(0, 200)}`);
  }
  return await res.json().catch(() => ({}));
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
