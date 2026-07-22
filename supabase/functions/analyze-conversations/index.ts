/**
 * analyze-conversations  (agente v2)
 * ----------------------------------------------------------------
 * Agente especialista em vendas analisa as conversas das caixas de
 * vendedora e grava as dimensões de qualidade em conversation_analysis,
 * sempre com trechos citados como evidência (auditável).
 *
 * Rubrica calibrada nas análises manuais de Giovanna/Mateus (jul/2026).
 * v2: critérios explícitos de erro operacional, taxonomia de objeções,
 * nota geral (0-10) e desfecho que separa "em andamento" de "indefinido".
 *
 * Processa em paralelo (CONCURRENCY) e respeita um orçamento de tempo
 * para caber no limite da Edge Function.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!;
const MODEL = 'gpt-4o-mini';
const PROMPT_VERSION = 2;

const DEFAULT_LIMIT   = 120;
const CONCURRENCY     = 6;
const TIME_BUDGET_MS  = 110_000;   // sai antes do timeout da função
const DEFAULT_WINDOW_H = 26;

const SYSTEM_PROMPT = `Você é um auditor especialista em vendas de varejo Apple via WhatsApp.
Analise a transcrição de UMA conversa entre VENDEDORA e CLIENTE e responda SOMENTE com JSON válido:

{
  "fechamento_count": <int — nº de perguntas de fechamento da VENDEDORA. Fechamento = pergunta que empurra a decisão ("posso separar?", "quer vir buscar hoje?", "fechamos assim?"). Responder preço e silenciar NÃO conta>,
  "followup_oportunidade": <bool — o CLIENTE sinalizou adiamento ("vou pensar", "te falo depois", "mês que vem")>,
  "followup_feito": <bool — DEPOIS do adiamento, a VENDEDORA retomou por iniciativa própria>,
  "estoque_situacao": <"nao_ocorreu" | "ponte" | "negativa_seca" — cliente pediu algo indisponível: "ponte" = negativa + alternativa concreta; "negativa_seca" = só o não>,
  "parcelamento_proativo": <bool|null — ao falar preço, já incluiu parcelamento sem o cliente pedir. null se preço não foi discutido>,
  "qualificou_antes_preco": <bool|null — antes do preço, perguntou modelo/uso/troca/estado. null se preço não foi discutido>,
  "desfecho": <"vendido"|"agendou"|"negociando"|"em_andamento"|"esfriou"|"perdido"|"indefinido">,
  "nota_geral": <int 0-10 — qualidade global do atendimento, ver régua>,
  "objecoes": [{"tipo":"preco|prazo|concorrencia|confianca|estoque|outro","quebrada":<bool>,"trecho":"<citação curta>"}],
  "erros": [{"tipo":"preco_errado|resposta_evasiva|tom_inadequado|informacao_incompleta|demora_critica","trecho":"<citação>"}],
  "pontos_fortes": ["<max 2, específicos>"],
  "sugestoes": ["<max 2, práticas, específicas DESTA conversa>"],
  "evidencias": {"fechamento":"<citação ou vazio>","followup":"<citação ou vazio>","estoque":"<citação ou vazio>"}
}

DESFECHO — use com precisão (não jogue tudo em "indefinido"):
- "vendido": cliente confirmou a compra
- "agendou": marcou de ir à loja / horário combinado
- "negociando": discutindo preço/condições, conversa viva
- "em_andamento": conversa recente que ainda flui, sem conclusão — o normal de quem acabou de chegar
- "esfriou": cliente parou de responder ou adiou sem retomada
- "perdido": desistiu explicitamente ou foi para concorrente
- "indefinido": SOMENTE se a transcrição for curta/ruidosa demais para julgar

OBJEÇÕES — qualquer resistência ou hesitação do CLIENTE que precise ser contornada. Procure ativamente, elas são frequentes:
- preco: "tá caro", "consigo mais barato", questiona o valor ou o desconto oferecido, estranha que o preço não baixou
- prazo: "demora muito", "preciso pra hoje", incômodo com tempo de entrega/serviço
- concorrencia: cita outra loja, marketplace ou orçamento concorrente
- confianca: dúvida sobre garantia, procedência, se é original/lacrado, segurança da compra
- estoque: quer modelo/cor/capacidade que não há
- outro
"quebrada": true se a VENDEDORA dissolveu a resistência (argumento de valor, alternativa concreta, prova, condição melhor); false se ignorou, mudou de assunto ou apenas repetiu a informação.

ERROS — procure ativamente, eles existem. Exemplos reais desta operação:
- preco_errado: valor com casas/zeros errados ("R$ 7.999,000"), preço divergente do mesmo produto na mesma conversa
- resposta_evasiva: cliente pergunta X e recebe outra pergunta ou resposta que não responde X
- tom_inadequado: informalidade excessiva para ticket alto, resposta seca ("não", "não tem"), ironia
- informacao_incompleta: preço sem parcelamento, produto sem especificação essencial, promessa sem prazo
- demora_critica: a própria VENDEDORA reconhece sumiço ("desculpa a demora", "estava em atendimento")
Se não houver erro, devolva [] — mas só depois de procurar de verdade.

RÉGUA DA NOTA:
- 9-10: qualificou, argumentou valor, quebrou objeção, fechou e/ou fez follow-up
- 7-8: bom atendimento, faltou fechar ou aprofundar
- 5-6: respondeu corretamente mas passivo (só respondeu o que foi perguntado)
- 3-4: passivo + falhas (negativa seca, preço sem parcelamento, evasivas)
- 0-2: cliente ficou sem resposta útil, erro grave, ou abandono

Regras: cite trechos REAIS (máx 100 chars). [áudio]/[imagem] são mídias que você não acessou — não invente o conteúdo delas, e não penalize a vendedora por elas. Na dúvida sobre uma pergunta de fechamento, NÃO conte.`;

interface ConvRow {
  id: number;
  store_id: number;
  vendor_id: number;
  last_message_at: string;
}

Deno.serve(async (req) => {
  const started = Date.now();
  let limit = DEFAULT_LIMIT;
  let windowH = DEFAULT_WINDOW_H;
  try {
    const body = await req.json();
    if (body?.limit)    limit = Math.min(Number(body.limit), 400);
    if (body?.window_h) windowH = Number(body.window_h);
  } catch { /* sem body */ }

  const since = new Date(Date.now() - windowH * 3600 * 1000).toISOString();
  const { data: convs, error } = await supabase.rpc('conversations_to_analyze', {
    p_since: since, p_limit: limit,
  });
  if (error) {
    console.error('select convs:', error);
    return json({ error: error.message }, 500);
  }

  const queue = (convs ?? []) as ConvRow[];
  let ok = 0, failed = 0, skipped = 0;
  let idx = 0;

  async function worker() {
    while (idx < queue.length) {
      if (Date.now() - started > TIME_BUDGET_MS) { skipped++; idx = queue.length; return; }
      const conv = queue[idx++];
      try {
        const done = await analyzeOne(conv);
        if (done) ok++; else skipped++;
      } catch (err) {
        console.error(`conv ${conv.id}:`, err);
        failed++;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  return json({ analyzed: ok, failed, skipped, total: queue.length, ms: Date.now() - started });
});

/**
 * Conversa curta demais pra analisar: grava um marcador para ela sair da
 * fila (senão volta em todo lote e entope o limite) e ficar fora dos
 * agregados via analisavel = false.
 */
async function markUnanalyzable(conv: ConvRow, msgCount: number): Promise<void> {
  await supabase.from('conversation_analysis').upsert({
    conversation_id: conv.id,
    store_id:        conv.store_id,
    vendor_id:       conv.vendor_id,
    analyzed_at:     new Date().toISOString(),
    last_message_at: conv.last_message_at,
    model:           MODEL,
    prompt_version:  PROMPT_VERSION,
    msg_count:       msgCount,
    analisavel:      false,
  }, { onConflict: 'conversation_id' });
}

async function analyzeOne(conv: ConvRow): Promise<boolean> {
  const { data: msgs } = await supabase
    .from('messages')
    .select('direction, kind, body, created_at')
    .eq('conversation_id', conv.id)
    .order('created_at', { ascending: true })
    .limit(150);

  const list = msgs ?? [];
  if (list.length < 3) { await markUnanalyzable(conv, list.length); return false; }

  let audioCount = 0;
  const lines: string[] = [];
  for (const m of list) {
    const who = m.direction === 'in' ? 'CLIENTE' : 'VENDEDORA';
    let text = (m.body as string | null)?.trim() ?? '';
    if (m.kind === 'audio')         { text = '[áudio]'; audioCount++; }
    else if (m.kind === 'image')      text = text ? `[imagem] ${text}` : '[imagem]';
    else if (m.kind === 'video')      text = '[vídeo]';
    else if (m.kind === 'document')   text = '[documento]';
    else if (['sticker', 'system', 'reaction'].includes(m.kind as string)) continue;
    if (!text) continue;
    const hora = new Date(m.created_at as string).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    lines.push(`[${hora}] ${who}: ${text.slice(0, 300)}`);
  }
  if (lines.length < 3) { await markUnanalyzable(conv, list.length); return false; }
  // Conversa longa: mantém o INÍCIO (onde acontece a qualificação) e o FIM
  // (onde está o desfecho/fechamento) — cortar só o fim escondia metade da análise
  const full = lines.join('\n');
  const transcript = full.length <= 7000
    ? full
    : `${full.slice(0, 3000)}\n[…trecho intermediário omitido…]\n${full.slice(-4000)}`;

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
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const out = JSON.parse((await res.json()).choices[0].message.content);

  const DESFECHOS = ['vendido', 'agendou', 'negociando', 'em_andamento', 'esfriou', 'perdido', 'indefinido'];
  const nota = Number(out.nota_geral);

  const { error } = await supabase.from('conversation_analysis').upsert({
    conversation_id:        conv.id,
    store_id:               conv.store_id,
    vendor_id:              conv.vendor_id,
    analyzed_at:            new Date().toISOString(),
    last_message_at:        conv.last_message_at,
    model:                  MODEL,
    prompt_version:         PROMPT_VERSION,
    msg_count:              list.length,
    audio_count:            audioCount,
    fechamento_count:       Number(out.fechamento_count ?? 0),
    followup_oportunidade:  Boolean(out.followup_oportunidade),
    followup_feito:         Boolean(out.followup_feito),
    estoque_situacao:       ['nao_ocorreu', 'ponte', 'negativa_seca'].includes(out.estoque_situacao) ? out.estoque_situacao : 'nao_ocorreu',
    parcelamento_proativo:  out.parcelamento_proativo === null ? null : Boolean(out.parcelamento_proativo),
    qualificou_antes_preco: out.qualificou_antes_preco === null ? null : Boolean(out.qualificou_antes_preco),
    desfecho:               DESFECHOS.includes(out.desfecho) ? out.desfecho : 'indefinido',
    nota_geral:             Number.isFinite(nota) ? Math.max(0, Math.min(10, Math.round(nota))) : null,
    objecoes:               Array.isArray(out.objecoes) ? out.objecoes : [],
    erros:                  Array.isArray(out.erros) ? out.erros : [],
    pontos_fortes:          Array.isArray(out.pontos_fortes) ? out.pontos_fortes : [],
    sugestoes:              Array.isArray(out.sugestoes) ? out.sugestoes : [],
    evidencias:             out.evidencias ?? {},
  }, { onConflict: 'conversation_id' });
  if (error) throw error;
  return true;
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
}
