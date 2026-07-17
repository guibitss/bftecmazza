/**
 * analyze-conversations
 * ----------------------------------------------------------------
 * pg_cron diário (madrugada). Agente especialista em vendas analisa as
 * conversas de vendedoras com atividade recente e grava as dimensões de
 * qualidade em conversation_analysis (com evidências citadas).
 *
 * Rubrica calibrada nas análises manuais de Giovana/Mateus (jul/2026):
 * perguntas de fechamento, follow-up de lead frio, ponte na falta de
 * estoque, parcelamento proativo, qualificação antes do preço, erros
 * operacionais e desfecho.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!;
const MODEL = 'gpt-4o-mini';
const MAX_CONVS_PER_RUN = 60;
const WINDOW_HOURS = 26;

const SYSTEM_PROMPT = `Você é um auditor especialista em vendas de varejo Apple via WhatsApp.
Analise a transcrição de UMA conversa entre vendedora (VENDEDORA) e cliente (CLIENTE) e responda SOMENTE com JSON válido no formato:

{
  "fechamento_count": <int — nº de perguntas de fechamento que a VENDEDORA fez. Pergunta de fechamento = pergunta que empurra a decisão: "posso separar?", "quer vir buscar hoje?", "fechamos assim?". Responder preço e ficar em silêncio NÃO conta>,
  "followup_oportunidade": <bool — o CLIENTE sinalizou adiamento? ("vou pensar", "te falo depois", "mês que vem")>,
  "followup_feito": <bool — DEPOIS do adiamento, a VENDEDORA retomou o contato por iniciativa própria?>,
  "estoque_situacao": <"nao_ocorreu" | "ponte" | "negativa_seca" — se o cliente pediu algo indisponível: "ponte" = negativa acompanhada de alternativa (outro modelo/cor + preço); "negativa_seca" = só o não>,
  "parcelamento_proativo": <bool|null — quando falou preço, a VENDEDORA já incluiu parcelamento sem o cliente pedir? null se preço não foi discutido>,
  "qualificou_antes_preco": <bool|null — antes de dar preço, perguntou modelo/uso/troca/estado do aparelho? null se preço não foi discutido>,
  "desfecho": <"vendido" | "agendou" | "negociando" | "esfriou" | "perdido" | "indefinido">,
  "erros": [{"tipo": "<preco_errado|resposta_evasiva|tom_inadequado|informacao_incompleta>", "trecho": "<citação curta>"}],
  "pontos_fortes": ["<max 2, específicos>"],
  "sugestoes": ["<max 2, práticas e específicas pra ESTA conversa>"],
  "evidencias": {"fechamento": "<citação ou vazio>", "followup": "<citação ou vazio>", "estoque": "<citação ou vazio>"}
}

Regras: cite trechos REAIS da transcrição nas evidências (máx 100 chars cada). Marcadores [áudio]/[imagem] são mídia que você não ouviu/viu — não invente conteúdo pra eles. Seja rigoroso: na dúvida entre contar ou não uma pergunta de fechamento, NÃO conte.`;

interface ConvRow {
  id: number;
  store_id: number;
  vendor_id: number;
  last_message_at: string;
}

Deno.serve(async (req) => {
  let limit = MAX_CONVS_PER_RUN;
  try {
    const body = await req.json();
    if (body?.limit) limit = Math.min(Number(body.limit), 200);
  } catch { /* sem body */ }

  const since = new Date(Date.now() - WINDOW_HOURS * 3600 * 1000).toISOString();

  // Conversas de caixas de vendedora com atividade recente, ainda não
  // analisadas OU com mensagens novas desde a última análise
  const { data: convs, error } = await supabase.rpc('conversations_to_analyze', {
    p_since: since, p_limit: limit,
  });
  if (error) {
    console.error('select convs:', error);
    return new Response(JSON.stringify({ error: String(error.message) }), { status: 500 });
  }

  let ok = 0, failed = 0;
  for (const conv of (convs ?? []) as ConvRow[]) {
    try {
      await analyzeOne(conv);
      ok++;
    } catch (err) {
      console.error(`conv ${conv.id}:`, err);
      failed++;
    }
  }
  return new Response(JSON.stringify({ analyzed: ok, failed, total: (convs ?? []).length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});

async function analyzeOne(conv: ConvRow) {
  const { data: msgs } = await supabase
    .from('messages')
    .select('direction, author_type, kind, body, created_at')
    .eq('conversation_id', conv.id)
    .order('created_at', { ascending: true })
    .limit(150);

  const list = msgs ?? [];
  if (list.length < 3) return;

  let audioCount = 0;
  const lines: string[] = [];
  for (const m of list) {
    const who = m.direction === 'in' ? 'CLIENTE' : 'VENDEDORA';
    let text = (m.body as string | null)?.trim() ?? '';
    if (m.kind === 'audio')    { text = '[áudio]'; audioCount++; }
    else if (m.kind === 'image')  text = text ? `[imagem] ${text}` : '[imagem]';
    else if (m.kind === 'video')  text = '[vídeo]';
    else if (m.kind === 'document') text = '[documento]';
    else if (m.kind === 'sticker' || m.kind === 'system' || m.kind === 'reaction') continue;
    if (!text) continue;
    const hora = new Date(m.created_at as string).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    lines.push(`[${hora}] ${who}: ${text.slice(0, 300)}`);
  }
  // Limita o transcript (conversas longas: mantém o fim, onde está o desfecho)
  const transcript = lines.join('\n').slice(-7000);

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: transcript },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const out = JSON.parse((await res.json()).choices[0].message.content);

  const { error } = await supabase.from('conversation_analysis').upsert({
    conversation_id:        conv.id,
    store_id:               conv.store_id,
    vendor_id:              conv.vendor_id,
    analyzed_at:            new Date().toISOString(),
    last_message_at:        conv.last_message_at,
    model:                  MODEL,
    msg_count:              list.length,
    audio_count:            audioCount,
    fechamento_count:       Number(out.fechamento_count ?? 0),
    followup_oportunidade:  Boolean(out.followup_oportunidade),
    followup_feito:         Boolean(out.followup_feito),
    estoque_situacao:       ['nao_ocorreu', 'ponte', 'negativa_seca'].includes(out.estoque_situacao) ? out.estoque_situacao : 'nao_ocorreu',
    parcelamento_proativo:  out.parcelamento_proativo === null ? null : Boolean(out.parcelamento_proativo),
    qualificou_antes_preco: out.qualificou_antes_preco === null ? null : Boolean(out.qualificou_antes_preco),
    desfecho:               ['vendido','agendou','negociando','esfriou','perdido','indefinido'].includes(out.desfecho) ? out.desfecho : 'indefinido',
    erros:                  out.erros ?? [],
    pontos_fortes:          out.pontos_fortes ?? [],
    sugestoes:              out.sugestoes ?? [],
    evidencias:             out.evidencias ?? {},
  }, { onConflict: 'conversation_id' });
  if (error) throw error;
}
