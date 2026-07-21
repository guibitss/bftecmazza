/**
 * chateau-report
 * ----------------------------------------------------------------
 * Reporta a saúde técnica DESTE sistema pro cockpit de monitoramento
 * da Chateau Labs. SÓ telemetria agregada — nunca conteúdo de conversa,
 * telefone ou qualquer dado de cliente final (LGPD).
 *
 * Disparado pelo pg_cron:
 *   - modo "heartbeat" a cada 10 min ("estou no ar")
 *   - modo "metric" 1x/dia (atendimentos do mês + % resolvido sem humano)
 *
 * Também emite um "event" de erro quando detecta a ingestão de mensagens
 * parada em horário comercial (dependência crítica: WAHA).
 *
 * Token e URL ficam em variáveis de ambiente (secrets), nunca no código.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);
const INGEST_URL   = Deno.env.get('CHATEAU_INGEST_URL')!;
const INGEST_TOKEN = Deno.env.get('CHATEAU_INGEST_TOKEN')!;

// Só considera "ingestão parada" um problema durante o horário de operação
const STALL_THRESHOLD_SECS = 30 * 60; // 30 min sem mensagem nova

async function report(payload: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(INGEST_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${INGEST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`ingest ${res.status}: ${JSON.stringify(body).slice(0, 150)}`);
  return body;
}

function isBusinessHours(): boolean {
  // Hora local BRT (UTC-3) — reporta stall só entre 8h e 22h
  const brtHour = (new Date().getUTCHours() + 24 - 3) % 24;
  return brtHour >= 8 && brtHour < 22;
}

Deno.serve(async (req) => {
  let mode = 'heartbeat';
  try {
    const body = await req.json();
    if (body?.mode) mode = String(body.mode);
  } catch { /* sem body → heartbeat */ }

  try {
    if (mode === 'metric') {
      const { data, error } = await supabase.rpc('chateau_telemetry');
      if (error) throw new Error(`rpc chateau_telemetry: ${error.message ?? JSON.stringify(error)}`);
      const row = Array.isArray(data) ? data[0] : data;
      const msgs = Number(row?.atendimentos ?? 0);
      const resolvedPct = Number(row?.resolved_pct ?? 0);
      const ageSecs = Number(row?.last_msg_age_secs ?? 0);

      const metricRes = await report({ kind: 'metric', msgs, resolved_pct: resolvedPct });

      // Dependência crítica: ingestão de mensagens (WAHA) parada em horário útil
      let eventRes: unknown = null;
      if (ageSecs > STALL_THRESHOLD_SECS && isBusinessHours()) {
        eventRes = await report({
          kind: 'event',
          ok: false,
          note: `ingestao de mensagens parada ha ${Math.round(ageSecs / 60)}min`,
        });
      }
      return json({ ok: true, mode, sent: { msgs, resolved_pct: resolvedPct }, metricRes, eventRes });
    }

    // heartbeat (padrão)
    const hb = await report({ kind: 'heartbeat' });
    return json({ ok: true, mode: 'heartbeat', hb });
  } catch (err) {
    // Falha do próprio reporter / dependência → tenta registrar como evento
    const msg = err instanceof Error ? err.message : JSON.stringify(err);
    const note = `chateau-report ${mode} falhou: ${msg.slice(0, 120)}`;
    console.error(note);
    try { await report({ kind: 'event', ok: false, note }); } catch { /* ignora */ }
    return json({ ok: false, error: msg }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
}
