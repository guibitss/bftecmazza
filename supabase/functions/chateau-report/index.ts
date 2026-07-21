/**
 * chateau-report
 * ----------------------------------------------------------------
 * Reporta a saúde técnica DESTE sistema pro cockpit da Chateau Labs.
 * SÓ telemetria agregada — nunca conteúdo de conversa, telefone ou
 * qualquer dado de cliente final (LGPD).
 *
 * DADOS SEPARADOS POR SERVIÇO: cada loja e o CRM têm token próprio no
 * cockpit; cada um reporta somente o seu escopo.
 *   - IA BFCM   (loja 1) → CHATEAU_TOKEN_BFCM
 *   - IA XMazza (loja 2) → CHATEAU_TOKEN_XMAZZA
 *   - IA BFGP   (loja 3) → CHATEAU_TOKEN_BFGP
 *   - CRM Grupo BF (app) → CHATEAU_TOKEN_CRM
 *
 * pg_cron: modo "heartbeat" a cada 10 min, "metric" 1x/hora. Emite
 * "event" quando a ingestão de uma loja para em horário comercial.
 * Tokens/URL em variáveis de ambiente, nunca no código.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);
const INGEST_URL = Deno.env.get('CHATEAU_INGEST_URL')!;
const CRM_URL    = 'https://crm.bftecmazza.com.br/login';

interface Service {
  key: string;
  token: string;
  storeId: number | null;   // null = serviço do CRM (não é uma loja)
}
const SERVICES: Service[] = [
  { key: 'BFCM',   token: Deno.env.get('CHATEAU_TOKEN_BFCM')   ?? '', storeId: 1 },
  { key: 'XMAZZA', token: Deno.env.get('CHATEAU_TOKEN_XMAZZA') ?? '', storeId: 2 },
  { key: 'BFGP',   token: Deno.env.get('CHATEAU_TOKEN_BFGP')   ?? '', storeId: 3 },
  { key: 'CRM',    token: Deno.env.get('CHATEAU_TOKEN_CRM')    ?? '', storeId: null },
].filter(s => s.token);

const STALL_THRESHOLD_SECS = 45 * 60; // 45 min sem mensagem numa loja

async function report(token: string, payload: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(INGEST_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`ingest ${res.status}: ${JSON.stringify(body).slice(0, 120)}`);
  return body;
}

function isBusinessHours(): boolean {
  const brtHour = (new Date().getUTCHours() + 24 - 3) % 24;
  return brtHour >= 8 && brtHour < 22;
}

async function doHeartbeat(svc: Service): Promise<unknown> {
  // CRM: confirma que o app web responde antes de bater o heartbeat
  if (svc.storeId === null) {
    try {
      const res = await fetch(CRM_URL, { method: 'HEAD' });
      if (!res.ok) {
        return await report(svc.token, { kind: 'event', ok: false, note: `CRM respondeu HTTP ${res.status}` });
      }
    } catch (err) {
      return await report(svc.token, { kind: 'event', ok: false, note: `CRM inacessivel: ${String(err).slice(0, 80)}` });
    }
  }
  return await report(svc.token, { kind: 'heartbeat' });
}

async function doMetric(svc: Service): Promise<unknown> {
  if (svc.storeId === null) {
    // CRM: volume de envios manuais + taxa de entrega
    const { data, error } = await supabase.rpc('chateau_crm_telemetry');
    if (error) throw new Error(`rpc crm: ${error.message ?? JSON.stringify(error)}`);
    const row = Array.isArray(data) ? data[0] : data;
    return await report(svc.token, {
      kind: 'metric',
      msgs: Number(row?.msgs ?? 0),
      resolved_pct: Number(row?.delivered_pct ?? 0),
    });
  }

  // Loja: atendimentos do mês + % resolvido sem humano
  const { data, error } = await supabase.rpc('chateau_telemetry', { p_store_id: svc.storeId });
  if (error) throw new Error(`rpc loja ${svc.storeId}: ${error.message ?? JSON.stringify(error)}`);
  const row = Array.isArray(data) ? data[0] : data;
  const ageSecs = Number(row?.last_msg_age_secs ?? 0);

  const metricRes = await report(svc.token, {
    kind: 'metric',
    msgs: Number(row?.atendimentos ?? 0),
    resolved_pct: Number(row?.resolved_pct ?? 0),
  });

  // Ingestão da loja parada em horário comercial → evento de erro
  if (ageSecs > STALL_THRESHOLD_SECS && isBusinessHours()) {
    await report(svc.token, {
      kind: 'event', ok: false,
      note: `ingestao parada ha ${Math.round(ageSecs / 60)}min`,
    });
  }
  return metricRes;
}

Deno.serve(async (req) => {
  let mode = 'heartbeat';
  try {
    const body = await req.json();
    if (body?.mode) mode = String(body.mode);
  } catch { /* sem body → heartbeat */ }

  const results: Record<string, unknown> = {};
  for (const svc of SERVICES) {
    try {
      results[svc.key] = mode === 'metric' ? await doMetric(svc) : await doHeartbeat(svc);
    } catch (err) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      console.error(`[${svc.key}] ${mode} falhou:`, msg);
      results[svc.key] = { error: msg };
      // registra a falha do reporter como evento no serviço afetado
      try { await report(svc.token, { kind: 'event', ok: false, note: `reporter ${mode}: ${msg.slice(0, 100)}` }); } catch { /* ignora */ }
    }
  }
  return new Response(JSON.stringify({ mode, results }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
