import { Suspense } from 'react';
import { getCurrentUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card } from '@/components/ui/card';
import { Megaphone, TrendingUp } from 'lucide-react';
import { PeriodFilter } from '@/components/period-filter';
import { resolvePeriod, type Period } from '@/lib/period';

interface CampaignRow {
  campaign_id: string;
  campaign_name: string;
  leads: number;
  vendas: number;
  conversao: number | null;
  gasto: number | null;
  custo_lead: number | null;
  custo_venda: number | null;
}

function brl(v: number | null): string {
  if (v == null) return '—';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default async function MetricasPage({ searchParams }: {
  searchParams: Promise<{ p?: string; from?: string; to?: string }>;
}) {
  await getCurrentUser();   // exige login; visível a todos os papéis
  const period = resolvePeriod(await searchParams);

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="hairline-b h-16 px-8 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
          Métricas
        </span>
        <PeriodFilter />
      </div>

      <div className="px-8 py-10 max-w-5xl mx-auto">
        <h1 className="text-[32px] font-semibold tracking-[-0.03em] animate-slide-up">
          Métricas
        </h1>
        <p className="mt-2 text-[14px] text-fg-muted">
          Campanhas de anúncio e desempenho comercial — {period.label}.
        </p>

        {/* CAMPANHAS · META ADS */}
        <div className="mt-10">
          <div className="flex items-center gap-4 mb-5">
            <div className="text-[10px] uppercase tracking-[0.18em] text-fg-subtle flex items-center gap-2">
              <Megaphone size={12} /> Campanhas · Meta Ads
            </div>
            <div className="flex-1 h-px bg-border" />
          </div>
          <Suspense key={`${period.from.getTime()}-${period.to.getTime()}`} fallback={<TableSkeleton />}>
            <CampaignTable period={period} />
          </Suspense>
        </div>

        {/* Espaço reservado: métricas de vendedores */}
        <div className="mt-12">
          <div className="flex items-center gap-4 mb-5">
            <div className="text-[10px] uppercase tracking-[0.18em] text-fg-subtle flex items-center gap-2">
              <TrendingUp size={12} /> Vendedores
            </div>
            <div className="flex-1 h-px bg-border" />
          </div>
          <Card className="p-8 text-center text-[13px] text-fg-muted">
            Novas métricas de vendedores chegam aqui em breve.
          </Card>
        </div>
      </div>
    </div>
  );
}

async function CampaignTable({ period }: { period: Period }) {
  const admin = createAdminClient();
  const { data } = await admin.rpc('campaign_metrics_range', {
    p_from: period.from.toISOString(),
    p_to: period.to.toISOString(),
  });
  const rows = (data ?? []) as CampaignRow[];

  if (rows.length === 0) {
    return (
      <Card className="p-8 text-center text-[13px] text-fg-muted">
        Nenhum lead de anúncio no período. Os leads que clicam em anúncios
        Click-to-WhatsApp aparecem aqui automaticamente.
      </Card>
    );
  }

  const totLeads  = rows.reduce((a, r) => a + Number(r.leads), 0);
  const totVendas = rows.reduce((a, r) => a + Number(r.vendas), 0);
  const totGasto  = rows.reduce((a, r) => a + Number(r.gasto ?? 0), 0);

  return (
    <div className="rounded-2xl border border-border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-surface-muted/60 text-[10.5px] uppercase tracking-[0.12em] text-fg-subtle">
              <th className="text-left  px-4 py-3 font-medium">Campanha</th>
              <th className="text-right px-4 py-3 font-medium">Leads</th>
              <th className="text-right px-4 py-3 font-medium">Vendidos</th>
              <th className="text-right px-4 py-3 font-medium">Conversão</th>
              <th className="text-right px-4 py-3 font-medium">Gasto</th>
              <th className="text-right px-4 py-3 font-medium">Custo/Lead</th>
              <th className="text-right px-4 py-3 font-medium">Custo/Venda</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-surface">
            {rows.map(r => (
              <tr key={r.campaign_id}>
                <td className="px-4 py-3 font-medium max-w-[260px] truncate">
                  {r.campaign_name}
                  {r.campaign_id === 'nao_resolvido' && (
                    <span className="ml-2 text-[10px] uppercase tracking-wider text-amber-600 dark:text-amber-400">
                      aguardando Meta
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-right num">{r.leads}</td>
                <td className="px-4 py-3 text-right num font-semibold text-emerald-600 dark:text-emerald-400">{r.vendas}</td>
                <td className="px-4 py-3 text-right num">{r.conversao != null ? `${r.conversao}%` : '—'}</td>
                <td className="px-4 py-3 text-right num">{brl(r.gasto)}</td>
                <td className="px-4 py-3 text-right num">{brl(r.custo_lead)}</td>
                <td className="px-4 py-3 text-right num">{brl(r.custo_venda)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-surface-muted/60 font-semibold">
              <td className="px-4 py-3">Total</td>
              <td className="px-4 py-3 text-right num">{totLeads}</td>
              <td className="px-4 py-3 text-right num">{totVendas}</td>
              <td className="px-4 py-3 text-right num">
                {totLeads > 0 ? `${Math.round(1000 * totVendas / totLeads) / 10}%` : '—'}
              </td>
              <td className="px-4 py-3 text-right num">{brl(totGasto || null)}</td>
              <td className="px-4 py-3 text-right num">{totLeads > 0 && totGasto > 0 ? brl(totGasto / totLeads) : '—'}</td>
              <td className="px-4 py-3 text-right num">{totVendas > 0 && totGasto > 0 ? brl(totGasto / totVendas) : '—'}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="px-4 py-2.5 hairline-t bg-surface text-[11px] text-fg-subtle">
        "Vendido" = etiqueta aplicada pela vendedora na conversa do cliente.
        Gasto sincronizado da Meta 4x/dia.
      </div>
    </div>
  );
}

function TableSkeleton() {
  return (
    <Card className="p-6 space-y-3 animate-pulse">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-9 rounded-lg bg-surface-muted" />
      ))}
    </Card>
  );
}
