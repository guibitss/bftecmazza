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
// Dois níveis: modelo simples (barato) só faz a TRIAGEM (é atendimento?);
// modelo forte faz a análise profunda (nuances de follow-up, objeção, nota).
const MODEL_DEEP  = Deno.env.get('OPENAI_MODEL_DEEP')  ?? 'gpt-4o';
const MODEL_LIGHT = Deno.env.get('OPENAI_MODEL_LIGHT') ?? 'gpt-4o-mini';
const PROMPT_VERSION = 5;

const DEFAULT_LIMIT   = 90;        // gpt-4o é mais lento; lotes menores + cron horário
const CONCURRENCY     = 6;
const TIME_BUDGET_MS  = 110_000;   // sai antes do timeout da função
const DEFAULT_WINDOW_H = 26;

const SYSTEM_PROMPT = `Você é um auditor especialista em vendas de varejo Apple via WhatsApp.
Analise a transcrição de UMA conversa entre VENDEDORA e CLIENTE e responda SOMENTE com JSON válido:

{
  "eh_atendimento": <bool — ver PRIMEIRO PASSO>,
  "fechamento_count": <int — nº de perguntas de fechamento da VENDEDORA. Fechamento = pergunta que empurra a decisão ("posso separar?", "quer vir buscar hoje?", "fechamos assim?"). Responder preço e silenciar NÃO conta>,
  "followup_oportunidade": <bool — o CLIENTE ficou de decidir depois OU parou de responder após receber preço/proposta/informação. Conta tanto o sinal explícito ("vou pensar", "te falo depois", "mês que vem", "vou calcular", "depois te aviso") quanto o silêncio do cliente após uma proposta>,
  "followup_feito": <bool — a VENDEDORA RETOMOU o contato por iniciativa própria após esse ponto. QUALQUER mensagem dela reabrindo a conversa depois de uma pausa (horas ou dias) conta como follow-up: saudação de retomada ("Bom dia Fulano 😄", "Oi, tudo bem?"), check-in ("ficou alguma dúvida?", "conseguiu ver?", "e aí, o que achou da proposta?", "ainda tem interesse?"), lembrete ou nova oferta não solicitada. NÃO exige que o cliente tenha respondido — basta a vendedora ter puxado de volta. Se houve adiamento e a vendedora reabriu depois, é TRUE.>,
  "estoque_situacao": <"nao_ocorreu" | "ponte" | "negativa_seca" — cliente pediu algo indisponível: "ponte" = negativa + alternativa concreta; "negativa_seca" = só o não>,
  "parcelamento_proativo": <bool|null — ao falar preço, já incluiu parcelamento sem o cliente pedir. null se preço não foi discutido>,
  "qualificou_antes_preco": <bool|null — antes do preço, perguntou modelo/uso/troca/estado. null se preço não foi discutido>,
  "desfecho": <"vendido"|"agendou"|"negociando"|"em_andamento"|"esfriou"|"perdido"|"indefinido">,
  "nota_geral": <int 0-10 — qualidade global do atendimento, ver régua>,
  "objecoes": [{"tipo":"preco|prazo|concorrencia|confianca|estoque|outro","quebrada":<true|false|null>,"trecho":"<citação curta>"}],
  "erros": [{"tipo":"preco_errado|resposta_evasiva|tom_inadequado|informacao_incompleta|demora_critica","trecho":"<citação>"}],
  "pontos_fortes": ["<max 2, específicos>"],
  "sugestoes": ["<max 2, práticas, específicas DESTA conversa>"],
  "evidencias": {"fechamento":"<citação ou vazio>","followup":"<citação ou vazio>","estoque":"<citação ou vazio>"}
}

PRIMEIRO PASSO — "eh_atendimento": a caixa da vendedora recebe TODO o WhatsApp dela, inclusive conversa particular. Marque false quando NÃO for atendimento comercial: papo pessoal (amigos, família, apelidos íntimos, combinar carona/encontro, endereço de clínica, assunto doméstico), coordenação interna entre colegas, spam/divulgação de terceiros, ou conversa sem qualquer relação com produto/serviço da loja.
Se eh_atendimento = false: devolva desfecho "indefinido", nota_geral null, listas vazias e ignore as demais análises — não invente métricas de venda para conversa pessoal.

DESFECHO — use com precisão (não jogue tudo em "indefinido"):
- "vendido": cliente confirmou a compra
- "agendou": marcou de ir à loja / horário combinado
- "negociando": discutindo preço/condições, conversa viva
- "em_andamento": conversa recente que ainda flui, sem conclusão — o normal de quem acabou de chegar
- "esfriou": cliente parou de responder ou adiou sem retomada
- "perdido": desistiu explicitamente ou foi para concorrente
- "indefinido": SOMENTE se a transcrição for curta/ruidosa demais para julgar
TEMPO — o usuário informa em CONTEXTO há quanto tempo foi a última mensagem. Use isso:
- Última mensagem recente (poucas horas) = conversa provavelmente VIVA → "em_andamento" ou "negociando", NUNCA "esfriou". Cliente que ainda não respondeu há pouco tempo NÃO é lead perdido.
- "esfriou" exige silêncio do cliente por tempo relevante (idealmente dias) DEPOIS de ter demonstrado interesse.
- "perdido" exige sinal EXPLÍCITO (desistiu, "já comprei", foi pro concorrente) — nunca deduza perda só por silêncio curto.

OBJEÇÕES — qualquer resistência ou hesitação do CLIENTE que precise ser contornada. Procure ativamente, elas são frequentes:
- preco: "tá caro", "consigo mais barato", questiona o valor ou o desconto oferecido, estranha que o preço não baixou
- prazo: "demora muito", "preciso pra hoje", incômodo com tempo de entrega/serviço
- concorrencia: cita outra loja, marketplace ou orçamento concorrente
- confianca: dúvida sobre garantia, procedência, se é original/lacrado, segurança da compra
- estoque: quer modelo/cor/capacidade que não há
- outro
"quebrada": true se a VENDEDORA dissolveu a resistência (argumento de valor, alternativa concreta, prova, condição melhor); false se ignorou, mudou de assunto ou apenas repetiu a informação.
IMPORTANTE — use null (indeterminado) quando a resposta da VENDEDORA à objeção veio em [áudio], [imagem] ou [vídeo]: você não tem acesso ao conteúdo e NÃO pode assumir que ela falhou. Marcar false nesse caso é erro grave de avaliação.

ERROS — procure ativamente, eles existem. Exemplos reais desta operação:
- preco_errado: valor com casas/zeros errados ("R$ 7.999,000"), preço divergente do mesmo produto na mesma conversa
- resposta_evasiva: cliente pergunta X e recebe outra pergunta ou resposta que não responde X
- tom_inadequado: informalidade excessiva para ticket alto, resposta seca ("não", "não tem"), ironia
- informacao_incompleta: preço sem parcelamento, produto sem especificação essencial, promessa sem prazo
- demora_critica: a própria VENDEDORA reconhece sumiço ("desculpa a demora", "estava em atendimento")
Se não houver erro, devolva [] — mas só depois de procurar de verdade.

RÉGUA DA NOTA — mede EFICÁCIA COMERCIAL, não educação. Ser cordial é o mínimo, não é mérito:
- 9-10: qualificou, argumentou valor, quebrou objeção, fechou e/ou fez follow-up que resgatou o cliente
- 7-8: bom atendimento, faltou fechar ou aprofundar
- 5-6: respondeu corretamente mas passivo (só respondeu o que foi perguntado)
- 3-4: passivo + falhas (negativa seca, preço sem parcelamento, evasivas)
- 0-2: cliente ficou sem resposta útil, erro grave, ou abandono

TETO OBRIGATÓRIO — nunca dê nota alta quando a venda se perdeu:
- Cliente informa que JÁ COMPROU em outro lugar, desistiu, ou sumiu após o preço:
  desfecho = "perdido" (ou "esfriou") e nota MÁXIMA 4 — por mais educada que a
  vendedora tenha sido. Cordialidade sem venda não é atendimento nota 10.
- Conversa que termina em agradecimento mútuo sem avanço comercial: nota máxima 5.

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
  let convOverride: number | null = null;
  let debugConv = false;
  try {
    const body = await req.json();
    if (body?.limit)    limit = Math.min(Number(body.limit), 400);
    if (body?.window_h) windowH = Number(body.window_h);
    if (body?.conv_id)  convOverride = Number(body.conv_id);   // reanalisa 1 conversa (teste)
    if (body?.debug)    debugConv = true;                      // retorna o erro no corpo
    if (body?.list_models) {                                   // probe: modelos disponíveis
      const r = await fetch('https://api.openai.com/v1/models', { headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` } });
      const j = await r.json();
      const ids = (j?.data ?? []).map((m: { id: string }) => m.id).filter((id: string) => /gpt|o1|o3|o4/.test(id)).sort();
      return json({ status: r.status, models: ids });
    }
  } catch { /* sem body */ }

  let queue: ConvRow[];
  if (convOverride) {
    const { data } = await supabase
      .from('conversations')
      .select('id, store_id, inbox_id, last_message_at, inboxes:inbox_id(vendor_id)')
      .eq('id', convOverride).maybeSingle();
    const vId = (data?.inboxes as { vendor_id?: number } | null)?.vendor_id ?? null;
    queue = data && vId ? [{ id: data.id, store_id: data.store_id, vendor_id: vId, last_message_at: data.last_message_at }] : [];
  } else {
    const since = new Date(Date.now() - windowH * 3600 * 1000).toISOString();
    const { data: convs, error } = await supabase.rpc('conversations_to_analyze', {
      p_since: since, p_limit: limit,
    });
    if (error) {
      console.error('select convs:', error);
      return json({ error: error.message }, 500);
    }
    queue = (convs ?? []) as ConvRow[];
  }

  let ok = 0, failed = 0, skipped = 0;
  let idx = 0;
  let lastError: string | null = null;

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
        if (debugConv) lastError = err instanceof Error ? err.message : String(err);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));

  return json({ analyzed: ok, failed, skipped, total: queue.length, ms: Date.now() - started, ...(lastError ? { error: lastError } : {}) });
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
    model:           MODEL_LIGHT,
    prompt_version:  PROMPT_VERSION,
    msg_count:       msgCount,
    analisavel:      false,
  }, { onConflict: 'conversation_id' });
}

async function analyzeOne(conv: ConvRow): Promise<boolean> {
  const { data: msgs } = await supabase
    .from('messages')
    .select('direction, kind, body, created_at, media_mime')
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
    // A ingestão às vezes grava mídia como kind='text' (mas com media_mime
    // certo) — o mime corrige o tipo pra o áudio/imagem não sumir da análise.
    const mime = (m.media_mime as string | null) ?? '';
    const ek = mime.startsWith('audio/') ? 'audio'
      : mime.startsWith('image/') ? 'image'
      : mime.startsWith('video/') ? 'video'
      : (m.kind as string);
    if (ek === 'audio')         { text = '[áudio]'; audioCount++; }
    else if (ek === 'image')      text = text ? `[imagem] ${text}` : '[imagem]';
    else if (ek === 'video')      text = '[vídeo]';
    else if (ek === 'document')   text = '[documento]';
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

  // Nível 1 — triagem barata: é atendimento comercial? (modelo simples)
  // Só faz a chamada extra se o modelo profundo for MAIS forte que o de
  // triagem; se forem iguais, o próprio prompt profundo decide eh_atendimento.
  const ehAtend = MODEL_DEEP === MODEL_LIGHT ? true : await classifyLight(transcript);
  if (!ehAtend) {
    await supabase.from('conversation_analysis').upsert({
      conversation_id: conv.id, store_id: conv.store_id, vendor_id: conv.vendor_id,
      analyzed_at: new Date().toISOString(), last_message_at: conv.last_message_at,
      model: MODEL_LIGHT, prompt_version: PROMPT_VERSION,
      eh_atendimento: false, analisavel: true, msg_count: list.length, audio_count: audioCount,
      fechamento_count: 0, followup_oportunidade: false, followup_feito: false,
      estoque_situacao: 'nao_ocorreu', desfecho: 'indefinido', nota_geral: null,
      objecoes: [], erros: [], pontos_fortes: [], sugestoes: [], evidencias: {},
    }, { onConflict: 'conversation_id' });
    return true;
  }

  // Nível 2 — análise profunda (modelo forte). Passa o CONTEXTO temporal pra
  // o modelo não confundir "cliente ainda não respondeu (recente)" com "esfriou".
  const horasDesde = (Date.now() - new Date(conv.last_message_at).getTime()) / 3_600_000;
  const tempoTxt = horasDesde < 1 ? 'menos de 1 hora'
    : horasDesde < 48 ? `cerca de ${Math.round(horasDesde)} horas`
    : `cerca de ${Math.round(horasDesde / 24)} dias`;
  const userMsg = `CONTEXTO: no momento desta análise, a última mensagem da conversa foi há ${tempoTxt}.\n\n${transcript}`;
  const out = await callJson(MODEL_DEEP, SYSTEM_PROMPT, userMsg);
  const DESFECHOS = ['vendido', 'agendou', 'negociando', 'em_andamento', 'esfriou', 'perdido', 'indefinido'];
  const nota = Number(out.nota_geral);

  // Guardrail: conversa recente não pode estar "esfriou" — o silêncio ainda não
  // aconteceu. Rebaixa pra "em_andamento". (perdido fica a cargo do prompt, que
  // exige sinal explícito.) Ajustável por FRESCO_MAX_H.
  const FRESCO_H = Number(Deno.env.get('FRESCO_MAX_H') ?? 4);
  let desf = DESFECHOS.includes(out.desfecho as string) ? (out.desfecho as string) : 'indefinido';
  if (desf === 'esfriou' && horasDesde < FRESCO_H) desf = 'em_andamento';

  const { error } = await supabase.from('conversation_analysis').upsert({
    conversation_id:        conv.id,
    store_id:               conv.store_id,
    vendor_id:              conv.vendor_id,
    analyzed_at:            new Date().toISOString(),
    last_message_at:        conv.last_message_at,
    model:                  MODEL_DEEP,
    prompt_version:         PROMPT_VERSION,
    eh_atendimento:         out.eh_atendimento !== false,
    analisavel:             true,
    msg_count:              list.length,
    audio_count:            audioCount,
    fechamento_count:       Number(out.fechamento_count ?? 0),
    followup_oportunidade:  Boolean(out.followup_oportunidade),
    followup_feito:         Boolean(out.followup_feito),
    estoque_situacao:       ['nao_ocorreu', 'ponte', 'negativa_seca'].includes(out.estoque_situacao as string) ? (out.estoque_situacao as string) : 'nao_ocorreu',
    parcelamento_proativo:  out.parcelamento_proativo === null ? null : Boolean(out.parcelamento_proativo),
    qualificou_antes_preco: out.qualificou_antes_preco === null ? null : Boolean(out.qualificou_antes_preco),
    desfecho:               desf,
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

const LIGHT_PROMPT = `Você classifica conversas de WhatsApp da caixa de uma vendedora de loja de iPhones.
Responda SOMENTE JSON: {"eh_atendimento": true|false}.
true = atendimento comercial (cliente interessado em produto/serviço, preço, troca, assistência).
false = papo pessoal (amigos, família, apelidos íntimos, combinar encontro/carona, assunto doméstico), coordenação interna entre colegas, spam/divulgação de terceiros, ou sem relação com a loja.`;

async function callJson(model: string, system: string, user: string): Promise<Record<string, unknown>> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, temperature: 0, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status} (${model}): ${(await res.text()).slice(0, 160)}`);
  return JSON.parse((await res.json()).choices[0].message.content);
}

async function classifyLight(transcript: string): Promise<boolean> {
  try {
    const out = await callJson(MODEL_LIGHT, LIGHT_PROMPT, transcript);
    return out?.eh_atendimento !== false;
  } catch {
    return true; // na dúvida, analisa (não perde atendimento por falha da triagem)
  }
}

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
}
