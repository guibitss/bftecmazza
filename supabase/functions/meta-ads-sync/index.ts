/**
 * meta-ads-sync
 * ----------------------------------------------------------------
 * pg_cron 4x/dia. Duas tarefas:
 *
 * 1. RESOLVE anúncios pendentes: conversations com ad_source_id sem
 *    ad_resolved_at → Graph API → nome do anúncio/conjunto/campanha
 * 2. SINCRONIZA gasto diário por campanha (últimos 30 dias) das contas
 *    do grupo BF → ad_campaign_spend
 *
 * Usa META_ADS_TOKEN (secret). Escopo restrito às contas do grupo BF.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);
const TOKEN = Deno.env.get('META_ADS_TOKEN')!;
const GRAPH = 'https://graph.facebook.com/v21.0';

// SOMENTE contas do grupo BF — o token tem acesso a contas de terceiros
// que este sistema não deve tocar
const BF_AD_ACCOUNTS = [
  'act_570626447632131',   // CA - BfTecMazza
  'act_400028483173379',   // Grupo BF TEC Mazza
  'act_1206469193649009',  // CA - XMAZZA
];

Deno.serve(async () => {
  const out: Record<string, unknown> = {};
  try { out.resolved = await resolvePendingAds(); }
  catch (err) { console.error('resolve error:', err); out.resolve_error = String(err); }
  try { out.spend_rows = await syncSpend(); }
  catch (err) { console.error('spend error:', err); out.spend_error = String(err); }
  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } });
});

async function resolvePendingAds(): Promise<number> {
  const { data: pending } = await supabase
    .from('conversations')
    .select('id, ad_source_id')
    .not('ad_source_id', 'is', null)
    .is('ad_resolved_at', null)
    .limit(50);

  let ok = 0;
  for (const row of pending ?? []) {
    try {
      const res = await fetch(
        `${GRAPH}/${encodeURIComponent(row.ad_source_id as string)}?fields=name,adset{name},campaign{id,name}&access_token=${TOKEN}`,
      );
      if (res.ok) {
        const ad = await res.json();
        await supabase.from('conversations').update({
          ad_resolved_at:   new Date().toISOString(),
          ad_name:          ad?.name ?? null,
          ad_adset_name:    ad?.adset?.name ?? null,
          ad_campaign_id:   ad?.campaign?.id ?? null,
          ad_campaign_name: ad?.campaign?.name ?? null,
        }).eq('id', row.id);
        ok++;
        continue;
      }
      const body = await res.text();
      // Token quebrado (190 = auth/checkpoint): aborta o lote inteiro e
      // NÃO marca nada — tudo tenta de novo quando o token voltar
      if (body.includes('"code":190')) {
        console.error(`token Meta inválido/checkpoint — abortando resolve: ${body.slice(0, 150)}`);
        break;
      }
      // id definitivamente inválido (anúncio apagado etc.): marca resolvido
      // com nomes nulos pra não tentar pra sempre
      if (res.status === 400 && body.includes('"code":100')) {
        console.warn(`ad ${row.ad_source_id} inexistente — marcando`);
        await supabase.from('conversations')
          .update({ ad_resolved_at: new Date().toISOString() })
          .eq('id', row.id);
        continue;
      }
      // Qualquer outro erro (rate limit, 5xx): tenta no próximo ciclo
      console.warn(`ad ${row.ad_source_id}: ${res.status} ${body.slice(0, 120)}`);
    } catch (err) {
      console.error(`ad ${row.ad_source_id}:`, err);
    }
  }
  return ok;
}

async function syncSpend(): Promise<number> {
  let rows = 0;
  for (const account of BF_AD_ACCOUNTS) {
    let url =
      `${GRAPH}/${account}/insights?level=campaign&fields=campaign_id,campaign_name,spend` +
      `&time_increment=1&date_preset=last_30d&limit=500&access_token=${TOKEN}`;
    // paginação
    for (let page = 0; page < 10 && url; page++) {
      const res = await fetch(url);
      if (!res.ok) {
        console.error(`insights ${account}: ${res.status} ${(await res.text()).slice(0, 200)}`);
        break;
      }
      const body = await res.json();
      for (const r of body?.data ?? []) {
        const { error } = await supabase.from('ad_campaign_spend').upsert({
          campaign_id:   r.campaign_id,
          date:          r.date_start,
          campaign_name: r.campaign_name ?? null,
          account_id:    account,
          spend:         Number(r.spend ?? 0),
          synced_at:     new Date().toISOString(),
        }, { onConflict: 'campaign_id,date' });
        if (!error) rows++;
        else console.error('spend upsert:', error);
      }
      url = body?.paging?.next ?? null;
    }
  }
  return rows;
}
