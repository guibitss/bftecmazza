import { Suspense } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUser, type CurrentUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card } from '@/components/ui/card';
import { ArrowUpRight, MessagesSquare, UserCheck, Sparkles, ShieldUser } from 'lucide-react';
import { VendorMetricsTable, VendorMetricsHero, type VendorMetric } from '@/components/vendor-metrics-table';

type Trend = 'up' | 'down' | 'flat';
function fmt(n: number) { return n.toLocaleString('pt-BR'); }

// Cache em memória: métricas de 30 dias não precisam de frescor por request.
// Processo único no VPS → módulo compartilhado entre requests.
const metricsCache = new Map<number, { rows: VendorMetric[]; at: number }>();
const METRICS_TTL_MS = 120_000;

async function loadStoreVendorMetrics(storeId: number): Promise<VendorMetric[]> {
  const hit = metricsCache.get(storeId);
  if (hit && Date.now() - hit.at < METRICS_TTL_MS) return hit.rows;
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('store_vendor_metrics', { p_store_id: storeId, p_days: 30 });
  const rows = (data ?? []) as VendorMetric[];
  // Erro (ex: timeout) não entra no cache — senão a tabela fica presa em "Sem dados"
  if (!error) metricsCache.set(storeId, { rows, at: Date.now() });
  return rows;
}

export default async function Dashboard() {
  const supabase = await createClient();
  const user = await getCurrentUser();
  const firstName = user.name.split(' ')[0];

  // ──── Métricas gerais (cards do topo) ────
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const sevenDaysAgo = new Date(today); sevenDaysAgo.setDate(today.getDate() - 7);

  const [todayRes, ydayRes, weekRes, doneRes, invokedRes, stores] = await Promise.all([
    supabase.from('conversation_memory').select('phone', { count: 'exact', head: true })
      .gte('updated_at', today.toISOString()),
    supabase.from('conversation_memory').select('phone', { count: 'exact', head: true })
      .gte('updated_at', yesterday.toISOString()).lt('updated_at', today.toISOString()),
    supabase.from('conversation_memory').select('phone', { count: 'exact', head: true })
      .gte('updated_at', sevenDaysAgo.toISOString()),
    supabase.from('transfer_flow_audit').select('source_id', { count: 'exact', head: true })
      .eq('step', 'done').gte('ts', sevenDaysAgo.toISOString()),
    supabase.from('transfer_flow_audit').select('source_id', { count: 'exact', head: true })
      .eq('step', 'invoked').gte('ts', sevenDaysAgo.toISOString()),
    supabase.from('stores').select('id, slug').eq('active', true).order('id'),
  ]);

  const todayCount = todayRes.count ?? 0;
  const ydayCount = ydayRes.count ?? 0;
  const weekCount = weekRes.count ?? 0;
  const done = doneRes.count ?? 0;
  const invoked = invokedRes.count ?? 0;
  const transferRate = invoked > 0 ? Math.round((done / invoked) * 100) : 0;
  const delta = todayCount - ydayCount;
  const deltaTrend: Trend = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
  const deltaLabel = ydayCount > 0
    ? `${delta > 0 ? '+' : ''}${Math.round((delta / ydayCount) * 100)}% vs ontem`
    : 'sem dado de ontem';

  const stats = [
    { icon: MessagesSquare, label: 'Conversas hoje',      value: fmt(todayCount), hint: deltaLabel, trend: deltaTrend },
    { icon: Sparkles,       label: 'Últimos 7 dias',      value: fmt(weekCount),  hint: `${fmt(Math.round(weekCount / 7))}/dia em média` },
    { icon: UserCheck,      label: 'Transferências (7d)', value: fmt(done),       hint: `${transferRate}% de conclusão` },
    { icon: ShieldUser,     label: 'Seu perfil',          value: user.isAdmin ? 'Admin' : user.managerOfStoreId ? 'Gerente' : user.vendorIds.length > 0 ? 'Vendedor' : '—', hint: user.isAdmin ? 'todas as lojas' : user.managerOfStoreId ? `loja #${user.managerOfStoreId}` : `${user.vendorIds.length} vendedor(es)` },
  ];

  return (
    <div className="relative min-h-screen">
      {/* Top bar */}
      <div className="hairline-b">
        <div className="h-16 px-8 flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-[0.18em] text-fg-subtle">Painel · BF Tec Mazza</div>
          <div className="text-[11px] text-fg-subtle num">
            {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
          </div>
        </div>
      </div>

      <div className="px-8 py-12 max-w-6xl mx-auto">
        {/* HERO */}
        <div className="mb-14 animate-slide-up">
          <div className="text-[11px] uppercase tracking-[0.18em] text-fg-subtle mb-3">Olá, {firstName}</div>
          <h1 className="text-[56px] leading-[1.02] font-semibold tracking-[-0.04em]">
            Hoje, <span className="text-fg-subtle num">{fmt(todayCount)}</span> conversas
          </h1>
          <p className="mt-4 text-[15px] text-fg-muted max-w-xl">
            {user.isAdmin    && 'Visão completa de todas as caixas e métricas dos vendedores.'}
            {user.managerOfStoreId && !user.isAdmin && 'Métricas da sua loja e da equipe que você gerencia.'}
            {!user.isAdmin && !user.managerOfStoreId && user.vendorIds.length > 0 && 'Suas métricas pessoais dos últimos 30 dias.'}
            {!user.isAdmin && !user.managerOfStoreId && user.vendorIds.length === 0 && 'Sem caixas atribuídas. Peça ao administrador.'}
          </p>
        </div>

        {/* STAT GRID */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-12">
          {stats.map((s, i) => {
            const Icon = s.icon;
            return (
              <Card key={s.label} className="group p-6 transition-all duration-300 hover:-translate-y-1 hover:border-border-strong animate-slide-up"
                    style={{ animationDelay: `${i * 80}ms` }}>
                <div className="flex items-start justify-between mb-8">
                  <div className="w-10 h-10 rounded-xl border border-border bg-surface-muted grid place-items-center text-fg-muted group-hover:text-fg group-hover:bg-surface transition-colors">
                    <Icon size={17} strokeWidth={1.75} />
                  </div>
                </div>
                <div className="text-[32px] font-semibold tracking-[-0.03em] num leading-none">{s.value}</div>
                <div className="text-[12.5px] text-fg-muted mt-2">{s.label}</div>
                {s.hint && <div className="text-[11px] text-fg-subtle mt-1 truncate">{s.hint}</div>}
              </Card>
            );
          })}
        </div>

        {/* MÉTRICAS (streaming: a página abre na hora, tabelas chegam depois) */}
        <Suspense fallback={<MetricsSkeleton />}>
          <MetricsSection user={user} stores={stores.data ?? []} />
        </Suspense>
      </div>
    </div>
  );
}

function MetricsSkeleton() {
  return (
    <div className="mb-10 animate-pulse">
      <div className="h-3 w-56 rounded bg-surface-muted mb-5" />
      <Card className="p-6 space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-9 rounded-lg bg-surface-muted" />
        ))}
      </Card>
    </div>
  );
}

// ──── Métricas de vendedores conforme o perfil (async → Suspense) ────
// Admin → todas as lojas | Gerente → sua loja | Vendedor → métricas pessoais
async function MetricsSection({ user, stores }: {
  user: CurrentUser;
  stores: { id: number; slug: string }[];
}) {
  const adminClient = createAdminClient();

  let perStoreMetrics: { storeId: number; storeSlug: string; rows: VendorMetric[] }[] = [];
  let personalMetric: VendorMetric | null = null;

  if (user.isAdmin) {
    perStoreMetrics = await Promise.all(
      stores.map(async s => ({
        storeId: s.id,
        storeSlug: s.slug,
        rows: await loadStoreVendorMetrics(s.id),
      })),
    );
  } else if (user.managerOfStoreId) {
    const storeRow = stores.find(s => s.id === user.managerOfStoreId);
    perStoreMetrics = [{
      storeId: user.managerOfStoreId,
      storeSlug: storeRow?.slug ?? '',
      rows: await loadStoreVendorMetrics(user.managerOfStoreId),
    }];
  } else if (user.vendorIds.length === 1) {
    const [{ data: rh }, { data: ro }, { data: vol }, { data: vendor }] = await Promise.all([
      adminClient.rpc('vendor_response_metrics', { p_vendor_id: user.vendorIds[0], p_days: 30, p_in_hours: true }),
      adminClient.rpc('vendor_response_metrics', { p_vendor_id: user.vendorIds[0], p_days: 30, p_in_hours: false }),
      adminClient.rpc('vendor_volume_metrics', { p_vendor_id: user.vendorIds[0], p_days: 30 }),
      adminClient.from('vendors').select('id, name').eq('id', user.vendorIds[0]).single(),
    ]);
    personalMetric = {
      vendor_id: vendor!.id,
      vendor_name: vendor!.name,
      in_hours_avg_secs: rh?.[0]?.avg_seconds ?? null,
      in_hours_count: rh?.[0]?.responses_count ?? 0,
      off_hours_avg_secs: ro?.[0]?.avg_seconds ?? null,
      off_hours_count: ro?.[0]?.responses_count ?? 0,
      contacts: vol?.[0]?.contacts ?? 0,
      msgs_per_contact: vol?.[0]?.msgs_per_contact ?? null,
    };
  }

  return (
    <>
      {/* MÉTRICAS PESSOAIS (vendedor) */}
      {personalMetric && (
        <div className="mb-12">
          <div className="flex items-center gap-4 mb-5">
            <div className="text-[10px] uppercase tracking-[0.18em] text-fg-subtle">Suas métricas — 30 dias</div>
            <div className="flex-1 h-px bg-border" />
          </div>
          <VendorMetricsHero metric={personalMetric} />
        </div>
      )}

      {/* MÉTRICAS POR LOJA (admin / gerente) */}
      {perStoreMetrics.map((m) => (
        <div key={m.storeId} className="mb-10">
          <div className="flex items-center gap-4 mb-5">
            <div className="text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
              Métricas dos vendedores · {m.storeSlug}
            </div>
            <div className="flex-1 h-px bg-border" />
          </div>
          <VendorMetricsTable
            rows={m.rows}
            subtitle="Últimos 30 dias · tempo entre msg do cliente e 1ª resposta do vendedor"
          />
        </div>
      ))}
    </>
  );
}
