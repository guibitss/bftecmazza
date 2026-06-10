/**
 * process-metric-alerts
 * ----------------------------------------------------------------
 * pg_cron minuto a minuto. Pra cada alerta enabled, calcula a métrica
 * e dispara WAHA se passou do threshold (respeitando a frequência).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);
const WAHA_API_KEY = Deno.env.get('WAHA_API_KEY')!;

interface AlertRow {
  id: number;
  user_id: string;
  store_id: number;
  vendor_id: number | null;
  metric: 'avg_response_in_hours' | 'avg_response_off_hours' | 'contacts' | 'msgs_per_contact';
  comparison: 'gt' | 'lt';
  threshold: number;
  whatsapp_number: string;
  frequency: 'once_per_hour' | 'once_per_day' | 'always';
  last_triggered_at: string | null;
  stores: { waha_url: string; bot_session: string };
  vendors: { name: string } | null;
}

Deno.serve(async () => {
  try {
    const { data: alerts } = await supabase
      .from('metric_alerts')
      .select('*, stores!store_id(waha_url, bot_session), vendors!vendor_id(name)')
      .eq('enabled', true);

    for (const a of (alerts ?? []) as AlertRow[]) {
      await checkAndFire(a);
    }
  } catch (err) {
    console.error('process-metric-alerts fatal:', err);
  }
  return new Response('OK');
});

function withinCooldown(a: AlertRow): boolean {
  if (!a.last_triggered_at) return false;
  const last = new Date(a.last_triggered_at).getTime();
  const now  = Date.now();
  if (a.frequency === 'always')        return false;
  if (a.frequency === 'once_per_hour') return now - last < 60 * 60 * 1000;
  if (a.frequency === 'once_per_day')  return now - last < 24 * 60 * 60 * 1000;
  return false;
}

async function calcMetric(a: AlertRow): Promise<{ value: number | null; label: string }> {
  // Por vendedor específico
  if (a.vendor_id) {
    if (a.metric === 'avg_response_in_hours') {
      const { data } = await supabase.rpc('vendor_response_metrics', {
        p_vendor_id: a.vendor_id, p_days: 30, p_in_hours: true,
      });
      return { value: data?.[0]?.avg_seconds ?? null, label: 'tempo de resposta comercial (s)' };
    }
    if (a.metric === 'avg_response_off_hours') {
      const { data } = await supabase.rpc('vendor_response_metrics', {
        p_vendor_id: a.vendor_id, p_days: 30, p_in_hours: false,
      });
      return { value: data?.[0]?.avg_seconds ?? null, label: 'tempo de resposta fora hor. (s)' };
    }
    if (a.metric === 'contacts') {
      const { data } = await supabase.rpc('vendor_volume_metrics', {
        p_vendor_id: a.vendor_id, p_days: 30,
      });
      return { value: data?.[0]?.contacts ?? null, label: 'contatos' };
    }
    if (a.metric === 'msgs_per_contact') {
      const { data } = await supabase.rpc('vendor_volume_metrics', {
        p_vendor_id: a.vendor_id, p_days: 30,
      });
      return { value: data?.[0]?.msgs_per_contact ?? null, label: 'msgs/contato' };
    }
  }

  // Agregado da loja: média/soma entre todos vendedores
  const { data: rows } = await supabase.rpc('store_vendor_metrics', {
    p_store_id: a.store_id, p_days: 30,
  });
  if (!rows || rows.length === 0) return { value: null, label: '' };
  if (a.metric === 'avg_response_in_hours') {
    const vals = rows.map((r: { in_hours_avg_secs: number | null }) => r.in_hours_avg_secs).filter((v: number | null): v is number => v != null);
    return { value: vals.length ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : null, label: 'tempo de resposta comercial (s)' };
  }
  if (a.metric === 'avg_response_off_hours') {
    const vals = rows.map((r: { off_hours_avg_secs: number | null }) => r.off_hours_avg_secs).filter((v: number | null): v is number => v != null);
    return { value: vals.length ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : null, label: 'tempo de resposta fora hor. (s)' };
  }
  if (a.metric === 'contacts') {
    return { value: rows.reduce((acc: number, r: { contacts: number }) => acc + Number(r.contacts), 0), label: 'contatos' };
  }
  if (a.metric === 'msgs_per_contact') {
    const vals = rows.map((r: { msgs_per_contact: number | null }) => r.msgs_per_contact).filter((v: number | null): v is number => v != null);
    return { value: vals.length ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : null, label: 'msgs/contato' };
  }
  return { value: null, label: '' };
}

async function checkAndFire(a: AlertRow) {
  if (withinCooldown(a)) return;

  const { value, label } = await calcMetric(a);
  if (value == null) return;

  const violated = a.comparison === 'gt' ? value > Number(a.threshold) : value < Number(a.threshold);
  if (!violated) return;

  const rawPhone = a.whatsapp_number.replace(/\D/g, '');
  if (!rawPhone) return;
  const variations = brazilianPhoneVariations(rawPhone);

  const scope = a.vendor_id ? `vendedora *${a.vendors?.name ?? ''}*` : 'loja inteira';
  const cmp = a.comparison === 'gt' ? 'acima' : 'abaixo';
  const fmtValue = (label.includes('(s)') && value > 60)
    ? `${Math.round(value / 60)}min`
    : value.toFixed(1);
  const fmtThreshold = (label.includes('(s)') && Number(a.threshold) > 60)
    ? `${Math.round(Number(a.threshold) / 60)}min`
    : Number(a.threshold).toFixed(1);

  const text =
`⚠️ *Alerta de métrica*

${scope}
${label}: *${fmtValue}* (${cmp} de ${fmtThreshold})
_últimos 30 dias_`;

  for (const phone of variations) {
    try {
      const res = await fetch(`${a.stores.waha_url}/api/sendText`, {
        method: 'POST',
        headers: { 'X-Api-Key': WAHA_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: `${phone}@c.us`, text, session: a.stores.bot_session, linkPreview: false }),
      });
      if (res.ok) {
        await supabase.from('metric_alerts')
          .update({ last_triggered_at: new Date().toISOString() })
          .eq('id', a.id);
        return;
      }
      const body = await res.text();
      if (!body.includes('no LID found') && !body.includes('UNKNOWN')) {
        console.error(`alerta ${a.id} WAHA error:`, body.slice(0, 200));
        return;
      }
    } catch (err) {
      console.error(`alerta ${a.id} fetch err:`, err);
    }
  }
  console.error(`alerta ${a.id} falhou em todas variações`);
}

function brazilianPhoneVariations(phone: string): string[] {
  const variations = [phone];
  const m13 = phone.match(/^(55)(\d{2})9(\d{8})$/);
  if (m13) variations.push(`${m13[1]}${m13[2]}${m13[3]}`);
  const m12 = phone.match(/^(55)(\d{2})(\d{8})$/);
  if (m12 && !m12[3].startsWith('9')) variations.push(`${m12[1]}${m12[2]}9${m12[3]}`);
  return variations;
}
