/**
 * suggest-reply
 * ----------------------------------------------------------------
 * Sugere a PRÓXIMA mensagem que a vendedora poderia enviar ao cliente,
 * com base na conversa. É o "balão de sugestão da IA" do inbox: pronto
 * pra copiar/editar, no tom de WhatsApp de varejo Apple, aplicando boas
 * práticas de venda. Não envia nada — só devolve o texto sugerido.
 *
 * Segurança: valida o login (JWT) e o ACESSO à conversa via RLS (userClient),
 * igual ao send-message. Sem acesso → 403.
 *
 * Body: { conversation_id: number }
 * Resp: { ok: true, suggestion: string } | { ok: false, error }
 */
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!;
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!;
const MODEL = Deno.env.get('OPENAI_MODEL_DEEP') ?? 'gpt-4o-mini';

const admin = createClient(SUPABASE_URL, SERVICE_KEY);

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey, x-app-schema',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Cliente service-role no schema pedido (demo lê dados fictícios isolados).
function dbFor(req: Request): SupabaseClient {
  return req.headers.get('x-app-schema') === 'demo'
    ? createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: 'demo' } }) as unknown as SupabaseClient
    : admin;
}

interface ConvRow { id: number; store_id: number; customer_name: string | null }

const SYSTEM = `Você é a VENDEDORA de uma loja de iPhones (Apple) atendendo um cliente pelo WhatsApp.
Com base na conversa, escreva a PRÓXIMA mensagem para enviar AO CLIENTE — pronta pra copiar e colar.

Regras:
- Fale em 1ª pessoa, como a vendedora, no tom WhatsApp brasileiro: próximo, simpático e profissional (pode usar 1 emoji quando couber, sem exagero).
- Seja concisa: 1 a 4 linhas. Nada de textão.
- Aplique boas práticas SÓ quando fizer sentido no contexto: qualificar antes de dar preço, oferecer parcelamento junto do valor, terminar com uma pergunta de fechamento, e retomar com gentileza o cliente que sumiu.
- Se o cliente fez uma pergunta objetiva, responda ela primeiro.
- Não invente preço, estoque, prazo ou condição que não apareceram na conversa — se faltar esse dado, conduza com uma pergunta.
- Responda SOMENTE com o texto da mensagem. Sem aspas, sem "Sugestão:", sem explicação.`;

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient: SupabaseClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ ok: false, error: 'unauthorized' }, 401);

  let body: { conversation_id?: number };
  try { body = await req.json(); } catch { return json({ ok: false, error: 'bad json' }, 400); }
  if (!body.conversation_id) return json({ ok: false, error: 'missing conversation_id' }, 400);

  const isDemo = req.headers.get('x-app-schema') === 'demo';
  const db = dbFor(req);

  // Acesso à conversa:
  // - produção: RLS (userClient) — o usuário só enxerga o que pode ver;
  // - demo: dados fictícios num schema isolado (login único admin). O RLS da
  //   demo não é replicado, então validamos que é um app_user do demo e lemos
  //   a conversa via service role no schema demo.
  let conv: ConvRow | null = null;
  if (isDemo) {
    const { data: prof } = await db.from('app_users').select('id').eq('id', user.id).maybeSingle();
    if (!prof) return json({ ok: false, error: 'sem acesso' }, 403);
    const { data } = await db
      .from('conversations').select('id, store_id, customer_name')
      .eq('id', body.conversation_id).maybeSingle();
    conv = (data ?? null) as ConvRow | null;
  } else {
    const { data, error: convErr } = await userClient
      .from('conversations').select('id, store_id, customer_name')
      .eq('id', body.conversation_id).maybeSingle();
    if (convErr) return json({ ok: false, error: 'sem acesso a esta conversa' }, 403);
    conv = (data ?? null) as ConvRow | null;
  }
  if (!conv) return json({ ok: false, error: 'sem acesso a esta conversa' }, 403);

  try {
    const { data: msgs } = await db
      .from('messages')
      .select('direction, kind, body, created_at')
      .eq('conversation_id', conv.id)
      .order('created_at', { ascending: false })
      .limit(25);
    const list = (msgs ?? []).reverse();
    if (list.length === 0) return json({ ok: false, error: 'conversa vazia' }, 400);

    const lines: string[] = [];
    for (const m of list) {
      const who = m.direction === 'in' ? 'CLIENTE' : 'VENDEDORA';
      let text = (m.body as string | null)?.trim() ?? '';
      if (m.kind === 'audio') text = '[áudio]';
      else if (m.kind === 'image') text = text ? `[imagem] ${text}` : '[imagem]';
      else if (m.kind === 'video') text = '[vídeo]';
      else if (m.kind === 'document') text = '[documento]';
      else if (['sticker', 'system', 'reaction'].includes(m.kind as string)) continue;
      if (!text) continue;
      lines.push(`${who}: ${text.slice(0, 400)}`);
    }
    if (lines.length === 0) return json({ ok: false, error: 'sem texto pra analisar' }, 400);

    const cliente = (conv.customer_name as string | null)?.trim();
    const userMsg = `${cliente ? `Cliente: ${cliente}\n` : ''}Conversa até agora:\n${lines.join('\n')}\n\nEscreva a próxima mensagem da VENDEDORA.`;

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.6,
        max_tokens: 300,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: userMsg }],
      }),
    });
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 160)}`);
    let suggestion = (await r.json())?.choices?.[0]?.message?.content ?? '';
    suggestion = String(suggestion).trim().replace(/^["']|["']$/g, '');
    if (!suggestion) return json({ ok: false, error: 'sem sugestão' }, 502);

    return json({ ok: true, suggestion });
  } catch (err) {
    console.error('suggest-reply:', err);
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
