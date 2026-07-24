/**
 * sales-coach
 * ----------------------------------------------------------------
 * Agente especialista em vendas — o "balãozinho" do CRM. Responde dúvidas
 * do vendedor/gerente com base nas MÉTRICAS reais da loja (via RPCs) e dá
 * dicas práticas. Aceita texto, transcreve áudio (Whisper) e lê imagem
 * (vision). Não altera nada — é consultivo.
 *
 * Body: {
 *   messages: [{role:'user'|'assistant', content:string}],
 *   store_id?: number, vendor_id?: number,
 *   image_url?: string,     // foto pública pra análise (print de conversa etc.)
 *   audio_url?: string      // áudio pra transcrever antes de responder
 * }
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')!;
const MODEL = Deno.env.get('OPENAI_MODEL_DEEP') ?? 'gpt-4o-mini';

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SYSTEM = `Você é um COACH ESPECIALISTA EM VENDAS de varejo Apple (iPhones, troca, acessórios), falando com a equipe de uma loja pelo CRM.
Seu papel: dar orientação prática, direta e acionável para o vendedor vender mais e melhor. Fale como um mentor experiente de loja, em português do Brasil, tom próximo mas profissional. Nada de textão — vá ao ponto, com passos concretos e exemplos de frases prontas que ele pode copiar e usar.

Você RECEBE, quando disponível, um resumo das MÉTRICAS reais do vendedor/loja (tempo de resposta, fechamento, follow-up, objeções, conversão). Use esses números para embasar conselhos ("você fez follow-up em só 3 de 12 oportunidades — foca nisso"). Se não houver métrica, dê o melhor conselho geral.

Quando o vendedor mandar um PRINT de conversa (imagem) ou perguntar "o que eu devia ter respondido", analise a situação e ofereça a melhor resposta possível, com a frase pronta.

Princípios de venda que você defende: qualificar antes do preço; sempre oferecer parcelamento junto do valor; nunca dar um "não" sem alternativa; fazer pergunta de fechamento; e follow-up de quem não respondeu. Seja específico ao contexto da mensagem.`;

function b64ToBytes(dataOrB64: string): Uint8Array {
  const b64 = dataOrB64.includes(',') ? dataOrB64.split(',')[1] : dataOrB64;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function transcribeBytes(bytes: Uint8Array): Promise<string> {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: 'audio/webm' }), 'audio.webm');
  fd.append('model', 'whisper-1');
  fd.append('language', 'pt');
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST', headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` }, body: fd,
  });
  if (!r.ok) return '';
  return (await r.json())?.text ?? '';
}

async function metricsContext(storeId?: number, vendorId?: number): Promise<string> {
  if (!storeId && !vendorId) return '';
  const from = new Date(Date.now() - 30 * 86400_000).toISOString();
  const to = new Date().toISOString();
  const { data } = await supabase.rpc('vendor_quality_metrics', { p_from: from, p_to: to });
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const pick = vendorId ? rows.filter(r => r.vendor_id === vendorId) : rows;
  if (pick.length === 0) return '';
  const linhas = pick.map(r =>
    `- ${r.vendor_name}: nota ${r.nota_media ?? '—'}, fechamento/conv ${r.fechamento_por_conv ?? '—'}, ` +
    `follow-up ${r.followup_feitos}/${r.followup_oportunidades}, vendidos ${r.vendidos}, ` +
    `objeções contornadas ${r.objecoes_quebradas}/${r.objecoes_total}, áudio ${r.audio_pct ?? '—'}%`,
  ).join('\n');
  return `\n\nMÉTRICAS DOS ÚLTIMOS 30 DIAS (use para embasar):\n${linhas}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: {
    messages?: { role: string; content: string }[];
    store_id?: number; vendor_id?: number; image_b64?: string; audio_b64?: string;
  };
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  const history = (body.messages ?? []).slice(-12);
  let transcript = '';

  try {
    // Áudio → transcreve e vira a última mensagem do usuário
    if (body.audio_b64) {
      transcript = await transcribeBytes(b64ToBytes(body.audio_b64));
      if (transcript) history.push({ role: 'user', content: transcript });
    }

    const ctx = await metricsContext(body.store_id, body.vendor_id);

    // Monta as mensagens; se veio imagem, anexa na última do usuário (vision)
    const msgs: Array<Record<string, unknown>> = [{ role: 'system', content: SYSTEM + ctx }];
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
