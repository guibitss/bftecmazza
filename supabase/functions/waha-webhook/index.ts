/**
 * waha-webhook
 * ----------------------------------------------------------------
 * Recebe eventos diretos do WAHA (configurado por sessão) e ingere
 * em conversations + messages.
 *
 * MODO SHADOW: por enquanto NÃO chama process-messages — apenas
 * armazena pra validar a migração paralela do Chatwoot.
 *
 * Eventos suportados:
 *   - message / message.any  → grava nova mensagem
 *   - message.ack            → atualiza ack
 *   - session.status         → log only
 *
 * Idempotência: messages.waha_message_id é UNIQUE.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

interface WahaPayload {
  id?: string;
  event?: string;
  session?: string;
  payload?: Record<string, unknown>;
  me?: { id?: string };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('OK', { status: 200 });

  let body: WahaPayload;
  try {
    body = await req.json();
  } catch {
    return new Response('bad json', { status: 400 });
  }

  try {
    await dispatch(body);
  } catch (err) {
    console.error('waha-webhook error:', err, JSON.stringify(body).slice(0, 400));
  }

  // Sempre 200: WAHA tira a sessão do ar se receber muito 5xx
  return new Response('OK', { status: 200 });
});

async function dispatch(body: WahaPayload) {
  const event = body.event ?? '';
  const session = body.session ?? '';

  if (!session) return;

  switch (event) {
    case 'message':
    case 'message.any':
      await ingestMessage(body);
      break;
    case 'message.ack':
      await updateAck(body);
      break;
    case 'session.status':
      console.log(`session ${session} → ${(body.payload as { status?: string })?.status}`);
      break;
    default:
      // ignora event não suportado por enquanto
      break;
  }
}

async function ingestMessage(body: WahaPayload) {
  const session = body.session!;
  const p = (body.payload ?? {}) as Record<string, unknown>;

  const wahaMessageId = String(p.id ?? '');
  if (!wahaMessageId) return;

  const fromMe = p.fromMe === true || p.fromMe === 'true';
  const from   = typeof p.from === 'string' ? p.from : '';
  const to     = typeof p.to   === 'string' ? p.to   : '';
  // NOWEB põe o chat em _data.Info.Chat, sempre coerente; senão fallback pra from/to
  const nowebChat = String(((p._data as { Info?: { Chat?: string } })?.Info?.Chat) ?? '');
  const chatId   = nowebChat || (fromMe ? to : from);
  if (!chatId) {
    console.warn(`waha-webhook: sem chatId — fromMe=${fromMe} from=${from} to=${to} id=${wahaMessageId.slice(0, 24)}`);
    return;
  }

  // Resolve sessão → inbox/store/role/vendor
  const { data: resolved } = await supabase.rpc('resolve_session', { p_session: session });
  const sessionInfo = Array.isArray(resolved) ? resolved[0] : resolved;
  if (!sessionInfo?.inbox_id) {
    console.warn(`session "${session}" não cadastrada como inbox — ignorando`);
    return;
  }

  const inboxId  = sessionInfo.inbox_id as number;
  const storeId  = sessionInfo.store_id as number;
  const vendorId = sessionInfo.vendor_id as number | null;
  const role     = sessionInfo.session_role as 'ai' | 'support' | 'vendor';

  // Tipo da mídia — NOWEB usa _data.Info.MediaType / Type; WEBJS usa p.type
  const nowebMediaType = String(((p._data as { Info?: { MediaType?: string } })?.Info?.MediaType) ?? '').toLowerCase();
  const nowebType      = String(((p._data as { Info?: { Type?: string } })?.Info?.Type) ?? '').toLowerCase();
  const wahaType       = String(p.type ?? '').toLowerCase();
  const kind = mapKind(nowebMediaType || wahaType || nowebType);

  // Texto / caption
  const bodyText: string | null =
    (typeof p.body === 'string' && p.body) ||
    ((p.caption as string | undefined) ?? null);

  // Baixa mídia — hasMedia vem como string ou boolean dependendo do engine
  const hasMedia =
    p.hasMedia === true ||
    p.hasMedia === 'true' ||
    (p.media != null && typeof p.media === 'object');

  let mediaUrl: string | null = null;
  let mediaMime: string | null = null;
  let mediaFilename: string | null = null;
  if (hasMedia && p.media) {
    const m = await downloadAndStoreMedia(p.media, wahaMessageId, storeId);
    mediaUrl      = m.url;
    mediaMime     = m.mime;
    mediaFilename = m.filename;
  }

  // Extrai nome + telefone real (suporta engines WEBJS e NOWEB do WAHA)
  const customerName = extractCustomerName(p);
  const customerPhone = extractCustomerPhone(p, chatId);

  // Pega ou cria a conversa (uma por inbox+chatId)
  const conversationId = await upsertConversation({
    inboxId,
    storeId,
    wahaId: chatId,
    customerPhone,
    customerName,
    session,
  });

  // Determina autor
  const direction = fromMe ? 'out' : 'in';
  const authorType =
    direction === 'in' ? 'customer' :
    role === 'vendor'  ? 'vendor'   :
    role === 'support' ? 'support'  :
    'ai';

  const { error } = await supabase.from('messages').insert({
    conversation_id: conversationId,
    inbox_id:        inboxId,
    store_id:        storeId,
    waha_message_id: wahaMessageId,
    direction,
    author_type:     authorType,
    author_id:       vendorId,
    author_session:  session,
    kind,
    body:            bodyText,
    media_url:       mediaUrl,
    media_mime:      mediaMime,
    media_filename:  mediaFilename,
    ack:             Number(p.ack ?? 0),
    sent_via:        'waha',
    raw:             p,
  });

  // Ignora duplicata silenciosamente (idempotência)
  if (error && !String(error.message).includes('duplicate')) {
    console.error('insert message error:', error);
  }
}

async function updateAck(body: WahaPayload) {
  const p = (body.payload ?? {}) as Record<string, unknown>;
  const wahaMessageId = String(p.id ?? '');
  if (!wahaMessageId) return;
  const ack = Number(p.ack ?? 0);
  await supabase.from('messages').update({ ack }).eq('waha_message_id', wahaMessageId);
}

async function upsertConversation(opts: {
  inboxId: number;
  storeId: number;
  wahaId: string;
  customerPhone: string | null;
  customerName: string | null;
  session: string;
}): Promise<number> {
  const { data: existing } = await supabase
    .from('conversations')
    .select('id, avatar_url')
    .eq('inbox_id', opts.inboxId)
    .eq('waha_id', opts.wahaId)
    .maybeSingle();

  if (existing?.id) {
    // Atualiza nome/telefone caso ainda estejam vazios (ex: chegaram em payload posterior)
    const patch: Record<string, string> = {};
    if (opts.customerName)  patch.customer_name  = opts.customerName;
    if (opts.customerPhone) patch.customer_phone = opts.customerPhone;
    if (Object.keys(patch).length > 0) {
      await supabase
        .from('conversations')
        .update(patch)
        .eq('id', existing.id)
        .or('customer_name.is.null,customer_phone.is.null');
    }
    // Se ainda não tem avatar, tenta buscar (fire-and-forget)
    if (!existing.avatar_url) {
      fetchAndStoreAvatar(opts.session, opts.wahaId, opts.storeId, existing.id as number)
        .catch(err => console.error('avatar bg:', err));
    }
    return existing.id as number;
  }

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({
      inbox_id:        opts.inboxId,
      store_id:        opts.storeId,
      waha_id:         opts.wahaId,
      customer_phone:  opts.customerPhone,
      customer_name:   opts.customerName,
    })
    .select('id')
    .single();

  if (error) {
    // race condition: re-busca
    const { data: again } = await supabase
      .from('conversations')
      .select('id')
      .eq('inbox_id', opts.inboxId)
      .eq('waha_id', opts.wahaId)
      .single();
    return again!.id as number;
  }

  // Busca foto em segundo plano (não bloqueia ingest)
  fetchAndStoreAvatar(opts.session, opts.wahaId, opts.storeId, created!.id as number)
    .catch(err => console.error('avatar bg:', err));

  return created!.id as number;
}

/**
 * Busca a foto de perfil do WhatsApp via WAHA, baixa, salva no Storage
 * e atualiza conversations.avatar_url. Tudo opcional — silencia erros.
 */
async function fetchAndStoreAvatar(
  session: string,
  chatId: string,
  storeId: number,
  convId: number,
): Promise<void> {
  const WAHA_API_KEY = Deno.env.get('WAHA_API_KEY');
  if (!WAHA_API_KEY) return;

  const { data: store } = await supabase
    .from('stores').select('waha_url').eq('id', storeId).single();
  if (!store) return;
  const wahaUrl = store.waha_url as string;

  // 1. Pede URL da foto ao WAHA
  let pictureUrl: string | null = null;
  try {
    const r = await fetch(
      `${wahaUrl}/api/contacts/profile-picture?session=${encodeURIComponent(session)}&contactId=${encodeURIComponent(chatId)}`,
      { headers: { 'X-Api-Key': WAHA_API_KEY } },
    );
    if (!r.ok) {
      await supabase.from('conversations')
        .update({ avatar_fetched_at: new Date().toISOString() })
        .eq('id', convId);
      return;
    }
    const data = await r.json();
    pictureUrl = data?.profilePictureURL ?? null;
  } catch { return; }

  if (!pictureUrl) {
    await supabase.from('conversations')
      .update({ avatar_fetched_at: new Date().toISOString() })
      .eq('id', convId);
    return;
  }

  // 2. Baixa a foto
  let bytes: Uint8Array;
  try {
    const r = await fetch(pictureUrl);
    if (!r.ok) return;
    bytes = new Uint8Array(await r.arrayBuffer());
  } catch { return; }

  // 3. Sobe pro Storage
  const safe = chatId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const path = `avatars/store-${storeId}/${safe}.jpg`;
  const { error: upErr } = await supabase.storage
    .from('media')
    .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
  if (upErr) {
    console.error('avatar upload error:', upErr);
    return;
  }

  // 4. Atualiza conversation
  const { data: pub } = supabase.storage.from('media').getPublicUrl(path);
  await supabase.from('conversations').update({
    avatar_url: pub.publicUrl,
    avatar_fetched_at: new Date().toISOString(),
  }).eq('id', convId);
}

function extractPhone(wahaId: string): string | null {
  // Aceita só @c.us ou @s.whatsapp.net — @lid não é número telefônico
  const m = wahaId.match(/^(\d{10,15})@(?:c\.us|s\.whatsapp\.net)/);
  return m ? '+' + m[1] : null;
}

interface WahaInfo {
  PushName?: string;
  SenderAlt?: string;
}
interface WahaData {
  Info?: WahaInfo;
  notifyName?: string;
  pushname?: string;
  pushName?: string;
}

function extractCustomerName(p: Record<string, unknown>): string | null {
  const data = (p._data ?? {}) as WahaData;
  return data.Info?.PushName    // NOWEB engine
      ?? data.notifyName        // WEBJS engine
      ?? data.pushname
      ?? data.pushName
      ?? null;
}

function extractCustomerPhone(p: Record<string, unknown>, chatId: string): string | null {
  // Prioridade 1: SenderAlt @s.whatsapp.net (NOWEB)
  const data = (p._data ?? {}) as WahaData;
  const senderAlt = data.Info?.SenderAlt ?? '';
  const m = senderAlt.match(/^(\d{10,15})(?::\d+)?@s\.whatsapp\.net/);
  if (m) return '+' + m[1];

  // Prioridade 2: chat_id se for @c.us / @s.whatsapp.net
  return extractPhone(chatId);
}

function mapKind(t: string): string {
  if (!t || t === 'chat' || t === 'text')               return 'text';
  if (t === 'ptt' || t === 'audio' || t === 'voice')    return 'audio';
  if (t === 'image')                                     return 'image';
  if (t === 'video')                                     return 'video';
  if (t === 'document')                                  return 'document';
  if (t === 'location' || t === 'live_location')         return 'location';
  if (t === 'sticker')                                   return 'sticker';
  if (t === 'reaction')                                  return 'reaction';
  // tipos NOWEB que ignoramos visualmente
  if (t === 'collection' || t === 'contact_array' || t === 'vcard') return 'system';
  return 'text';
}

interface MediaRef {
  url?: string;
  mimetype?: string;
  filename?: string;
  data?: string; // base64 (alguns engines)
}

async function downloadAndStoreMedia(
  media: unknown,
  wahaMessageId: string,
  storeId: number
): Promise<{ url: string | null; mime: string | null; filename: string | null }> {
  const m = (media ?? {}) as MediaRef;
  const mime = m.mimetype ?? null;
  const filename = m.filename ?? null;

  let bytes: Uint8Array | null = null;

  if (m.url) {
    try {
      // URLs internas do WAHA exigem X-Api-Key
      const wahaApiKey = Deno.env.get('WAHA_API_KEY');
      const headers: Record<string, string> = {};
      if (wahaApiKey && m.url.includes('/api/files/')) {
        headers['X-Api-Key'] = wahaApiKey;
      }
      const r = await fetch(m.url, { headers });
      if (r.ok) {
        bytes = new Uint8Array(await r.arrayBuffer());
      } else {
        console.error(`media fetch ${r.status} ${m.url.slice(-60)}`);
      }
    } catch (err) {
      console.error('media fetch error:', err);
    }
  } else if (m.data) {
    bytes = Uint8Array.from(atob(m.data), c => c.charCodeAt(0));
  }

  if (!bytes) return { url: null, mime, filename };

  const ext = guessExt(mime, filename);
  const safeId = wahaMessageId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const path = `store-${storeId}/${safeId}${ext}`;

  const { error } = await supabase.storage
    .from('media')
    .upload(path, bytes, {
      contentType: mime ?? 'application/octet-stream',
      upsert: true,
    });
  if (error) {
    console.error('storage upload error:', error);
    return { url: null, mime, filename };
  }

  const { data: pub } = supabase.storage.from('media').getPublicUrl(path);
  return { url: pub.publicUrl, mime, filename };
}

function guessExt(mime: string | null, filename: string | null): string {
  if (filename) {
    const m = filename.match(/(\.[a-zA-Z0-9]+)$/);
    if (m) return m[1];
  }
  if (!mime) return '';
  const map: Record<string, string> = {
    'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/wav': '.wav',
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
    'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm',
    'application/pdf': '.pdf',
  };
  return map[mime] ?? '';
}
