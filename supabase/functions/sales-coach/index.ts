/**
 * sales-coach
 * ----------------------------------------------------------------
 * Agente especialista em vendas — o "balãozinho" do CRM. Responde dúvidas
 * do vendedor/gerente com base nas MÉTRICAS reais da loja (via RPCs) e dá
 * dicas práticas. Aceita texto, transcreve áudio (Whisper) e lê imagem
 * (vision). Não altera nada — é consultivo.
 *
 * ESCOPO POR IDENTIDADE (segurança): a função descobre QUEM está falando a
 * partir do token de login (Authorization: Bearer <jwt do usuário>), NÃO do
 * corpo da requisição. Uma vendedora só enxerga os atendimentos do próprio
 * número; um gerente vê a loja dele; um admin vê tudo. O cliente não
 * consegue pedir dados de outra vendedora trocando um id na requisição.
 *
 * Body: {
 *   messages: [{role:'user'|'assistant', content:string}],
 *   focus_vendor_id?: number,   // só respeitado se o caller tiver direito a esse vendedor
 *   image_b64?: string,         // print de conversa pra análise (vision)
 *   audio_b64?: string          // áudio pra transcrever antes de responder
 * }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!;
const MODEL = Deno.env.get('OPENAI_MODEL_DEEP') ?? 'gpt-4o-mini';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-app-schema',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Db = typeof supabase;

// Cliente no schema pedido pelo front. Demo lê do schema 'demo' (dados
// fictícios, isolados); qualquer outra coisa cai em produção (public).
function dbFor(req: Request): Db {
  if (req.headers.get('x-app-schema') === 'demo') {
    return createClient(SUPABASE_URL, SERVICE_KEY, { db: { schema: 'demo' } }) as unknown as Db;
  }
  return supabase;
}

const SYSTEM = `Você é um COACH ESPECIALISTA EM VENDAS de varejo Apple (iPhones, troca, acessórios), falando com a equipe de uma loja pelo CRM.
Seu papel: dar orientação prática, direta e acionável para o vendedor vender mais e melhor. Fale como um mentor experiente de loja, em português do Brasil, tom próximo mas profissional. Nada de textão — vá ao ponto, com passos concretos e exemplos de frases prontas que ele pode copiar e usar.

Você RECEBE, quando disponível, um resumo das MÉTRICAS reais do vendedor/loja (tempo de resposta, fechamento, follow-up, objeções, conversão). Use esses números para embasar conselhos ("você fez follow-up em só 3 de 12 oportunidades — foca nisso"). Se não houver métrica, dê o melhor conselho geral.

Quando o vendedor mandar um PRINT de conversa (imagem) ou perguntar "o que eu devia ter respondido", analise a situação e ofereça a melhor resposta possível, com a frase pronta.

Princípios de venda que você defende: qualificar antes do preço; sempre oferecer parcelamento junto do valor; nunca dar um "não" sem alternativa; fazer pergunta de fechamento; e follow-up de quem não respondeu. Seja específico ao contexto da mensagem.

O ESCOPO DE ACESSO de quem está falando vem descrito no fim deste prompt — siga-o à risca. Só aplique restrição de dados quando o escopo mandar; se o escopo disser que a pessoa tem acesso total, responda com naturalidade, sem hedging e sem dizer que "não pode compartilhar".`;

interface Caller {
  userId: string;
  name: string;
  isAdmin: boolean;
  managerStoreId: number | null;
  vendorIds: number[];   // vendedores cujo número este login opera
}

/**
 * Descobre a identidade do chamador pelo token de login. Retorna null se o
 * token for inválido / usuário inativo (a função responde 401).
 */
async function resolveCaller(db: Db, authHeader: string | null): Promise<Caller | null> {
  const token = (authHeader ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  const { data: userData, error } = await db.auth.getUser(token);
  if (error || !userData?.user) return null;
  const uid = userData.user.id;

  const { data: profile } = await db
    .from('app_users')
    .select('name, is_admin, manager_of_store_id, active, status')
    .eq('id', uid).maybeSingle();
  if (!profile || !profile.active || profile.status !== 'approved') return null;

  const { data: ui } = await db
    .from('user_inboxes')
    .select('can_send, inboxes:inbox_id(kind, vendor_id)')
    .eq('user_id', uid);
  const vendorIds = new Set<number>();
  for (const row of ui ?? []) {
    const rel = (row as { inboxes?: unknown }).inboxes;
    const ib = (Array.isArray(rel) ? rel[0] : rel) as { kind?: string; vendor_id?: number | null } | null;
    if (ib && ib.kind === 'vendor' && ib.vendor_id && (row as { can_send?: boolean }).can_send) {
      vendorIds.add(ib.vendor_id);
    }
  }

  return {
    userId: uid,
    name: (profile.name as string) ?? 'colega',
    isAdmin: !!profile.is_admin,
    managerStoreId: (profile.manager_of_store_id as number | null) ?? null,
    vendorIds: Array.from(vendorIds),
  };
}

/** Conjunto de vendedores que o chamador tem direito de enxergar. */
async function allowedVendorSet(
  caller: Caller,
  vendors: Map<number, { name: string; store_id: number }>,
): Promise<Set<number>> {
  if (caller.isAdmin) return new Set(vendors.keys());
  const allowed = new Set<number>(caller.vendorIds);
  if (caller.managerStoreId != null) {
    for (const [id, v] of vendors) if (v.store_id === caller.managerStoreId) allowed.add(id);
  }
  return allowed;
}

async function loadVendors(db: Db): Promise<Map<number, { name: string; store_id: number }>> {
  const { data } = await db.from('vendors').select('id, name, store_id');
  const m = new Map<number, { name: string; store_id: number }>();
  for (const v of (data ?? []) as Array<{ id: number; name: string; store_id: number }>) {
    m.set(v.id, { name: v.name, store_id: v.store_id });
  }
  return m;
}

function b64ToBytes(dataOrB64: string): Uint8Array {
  const b64 = dataOrB64.includes(',') ? dataOrB64.split(',')[1] : dataOrB64;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function transcribeBytes(bytes: Uint8Array): Promise<string> {
  const fd = new FormData();
  const part = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  fd.append('file', new Blob([part], { type: 'audio/webm' }), 'audio.webm');
  fd.append('model', 'whisper-1');
  fd.append('language', 'pt');
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` }, body: fd,
  });
  if (!r.ok) return '';
  return (await r.json())?.text ?? '';
}

/**
 * Contexto de métricas ESCOPADO: só entram vendedores do conjunto `allowed`;
 * se houver `focus`, restringe a esse único vendedor.
 */
async function metricsContext(
  db: Db,
  allowed: Set<number>,
  focus: number | null,
): Promise<string> {
  if (allowed.size === 0) return '';
  const from = new Date(Date.now() - 30 * 86400_000).toISOString();
  const to = new Date().toISOString();
  const { data } = await db.rpc('vendor_quality_metrics', { p_from: from, p_to: to });
  let rows = ((data ?? []) as Array<Record<string, unknown>>)
    .filter(r => allowed.has(r.vendor_id as number));
  if (focus) rows = rows.filter(r => r.vendor_id === focus);
  if (rows.length === 0) return '';
  const linhas = rows.map(r =>
    `- ${r.vendor_name}: fechamento/conv ${r.fechamento_por_conv ?? '—'}, ` +
    `follow-up ${r.followup_feitos}/${r.followup_oportunidades}, vendidos ${r.vendidos}, ` +
    `esfriados ${r.esfriados ?? '—'}, qualificação ${r.qualificacao_pct ?? '—'}%, ` +
    `parc. proativo ${r.parcelamento_proativo_pct ?? '—'}%, áudio ${r.audio_pct ?? '—'}%`,
  ).join('\n');
  return `\n\nMÉTRICAS DOS ÚLTIMOS 30 DIAS (use para embasar):\n${linhas}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  // Schema (produção ou demo) e identidade — identidade vem do token, nunca do corpo.
  const db = dbFor(req);
  const caller = await resolveCaller(db, req.headers.get('Authorization'));
  if (!caller) return json({ error: 'não autenticado' }, 401);

  let body: {
    messages?: { role: string; content: string }[];
    focus_vendor_id?: number; image_b64?: string; audio_b64?: string;
  };
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  const history = (body.messages ?? []).slice(-12);
  let transcript = '';

  try {
    const vendors = await loadVendors(db);
    const allowed = await allowedVendorSet(caller, vendors);
    const isSupervisor = caller.isAdmin || caller.managerStoreId != null;

    // Escopo de foco:
    // - vendedora comum (1 número, sem papel de gestão) → SEMPRE o número dela;
    // - supervisor → pode focar num vendedor específico, desde que tenha direito.
    let focus: number | null = null;
    if (!isSupervisor && caller.vendorIds.length === 1) {
      focus = caller.vendorIds[0];
    } else if (body.focus_vendor_id && allowed.has(body.focus_vendor_id)) {
      focus = body.focus_vendor_id;
    }

    // Nota de escopo pro modelo — deixa explícito de quem ele pode falar.
    let scopeNote = '';
    if (isSupervisor) {
      const papel = caller.isAdmin ? 'ADMIN' : 'GERENTE';
      scopeNote = `\n\nVocê está falando com ${caller.name}, ${papel} — tem ACESSO TOTAL aos dados da equipe. ` +
        `Responda com naturalidade sobre QUALQUER vendedora que apareça nas métricas acima: mostre os números, compare, faça ranking, o que pedirem. ` +
        `NUNCA diga que "não pode compartilhar" nem hesite — ele(a) tem permissão total. Se perguntarem de alguém que não aparece, é só porque não teve atendimento no período.`;
    } else if (focus) {
      const v = vendors.get(focus);
      scopeNote = `\n\nVocê está falando com ${caller.name}, VENDEDORA${v ? ` (${v.name})` : ''}. ` +
        `Analise SOMENTE os atendimentos DELA — os números acima são só dela. ` +
        `Se pedirem dados de outra vendedora, ranking ou da loja inteira, recuse com educação (você só tem acesso aos dados dela) e redirecione pro desempenho dela. Nunca invente dados de terceiros.`;
    }

    // Áudio → transcreve e vira a última mensagem do usuário
    if (body.audio_b64) {
      transcript = await transcribeBytes(b64ToBytes(body.audio_b64));
      if (transcript) history.push({ role: 'user', content: transcript });
    }

    const ctx = await metricsContext(db, allowed, focus);

    const msgs: Array<Record<string, unknown>> = [{ role: 'system', content: SYSTEM + ctx + scopeNote }];
    for (let i = 0; i < history.length; i++) {
      const m = history[i];
      const isLastUser = i === history.length - 1 && m.role === 'user';
      if (isLastUser && body.image_b64) {
        msgs.push({ role: 'user', content: [
          { type: 'text', text: m.content || 'Analise este print de conversa e me diga o que eu devia responder.' },
          { type: 'image_url', image_url: { url: body.image_b64 } },
        ] });
      } else {
        msgs.push({ role: m.role, content: m.content });
      }
    }

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, temperature: 0.4, messages: msgs }),
    });
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const reply = (await r.json())?.choices?.[0]?.message?.content ?? 'Não consegui responder agora.';
    return json({ reply, transcript: transcript || undefined });
  } catch (err) {
    console.error('sales-coach:', err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
