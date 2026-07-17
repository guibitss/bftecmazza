import { createAdminClient } from '@/lib/supabase/admin';
import { Card } from '@/components/ui/card';
import type { Period } from '@/lib/period';

/**
 * Visão individual da vendedora — tiles + gráficos SVG server-rendered.
 * Paleta validada (dataviz): azul #2a78d6/#3987e5, aqua #1baf7a/#199e70
 * nas superfícies do CRM; rótulos diretos em tinta de texto (nunca na cor
 * da série); tooltips nativos via <title>.
 */

interface AnalysisRow {
  conversation_id: number;
  last_message_at: string;
  fechamento_count: number | null;
  followup_oportunidade: boolean;
  followup_feito: boolean;
  estoque_situacao: string;
  parcelamento_proativo: boolean | null;
  qualificou_antes_preco: boolean | null;
  desfecho: string;
  sugestoes: string[] | null;
  pontos_fortes: string[] | null;
}

interface QualityRow {
  vendor_id: number;
  vendor_name: string;
  convs_analisadas: number;
  fechamento_por_conv: number | null;
  followup_oportunidades: number;
  followup_feitos: number;
  parcelamento_proativo_pct: number | null;
  qualificacao_pct: number | null;
  vendidos: number;
  esfriados: number;
  prospeccao_ativa: number;
  audio_pct: number | null;
}

const DESFECHO_LABEL: Record<string, string> = {
  vendido: 'Vendido', agendou: 'Agendou visita', negociando: 'Negociando',
  esfriou: 'Esfriou', perdido: 'Perdido', indefinido: 'Indefinido',
};
const DESFECHO_ORDER = ['vendido', 'agendou', 'negociando', 'esfriou', 'perdido', 'indefinido'];

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

export async function VendorDetail({ vendorId, period }: { vendorId: number; period: Period }) {
  const admin = createAdminClient();
  const [{ data: rowsData }, { data: qData }] = await Promise.all([
    admin.from('conversation_analysis')
      .select('conversation_id, last_message_at, fechamento_count, followup_oportunidade, followup_feito, estoque_situacao, parcelamento_proativo, qualificou_antes_preco, desfecho, sugestoes, pontos_fortes')
      .eq('vendor_id', vendorId)
      .gte('last_message_at', period.from.toISOString())
      .lt('last_message_at', period.to.toISOString())
      .order('last_message_at', { ascending: true }),
    admin.rpc('vendor_quality_metrics', {
      p_from: period.from.toISOString(), p_to: period.to.toISOString(),
    }),
  ]);

  const rows = (rowsData ?? []) as AnalysisRow[];
  const all = (qData ?? []) as QualityRow[];
  const me = all.find(r => r.vendor_id === vendorId);

  if (!me) {
    return (
      <Card className="p-8 text-center text-[13px] text-fg-muted">
        Sem dados dessa vendedora no período.
      </Card>
    );
  }

  // Média do time (todas menos ela) pras comparações
  const peers = all.filter(r => r.vendor_id !== vendorId && r.convs_analisadas > 0);
  const avg = (f: (r: QualityRow) => number | null): number | null => {
    const vals = peers.map(f).filter((v): v is number => v != null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  };
  const teamFech = (() => {
    const vals = peers.map(r => r.fechamento_por_conv).filter((v): v is number => v != null);
    return vals.length ? Math.round(10 * vals.reduce((a, b) => Number(a) + Number(b), 0) / vals.length) / 10 : null;
  })();

  // Série por dia
  const byDay = new Map<string, number>();
  for (const r of rows) {
    const d = new Date(r.last_message_at).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  const days = Array.from(byDay.entries());

  // Desfechos
  const desfechos = DESFECHO_ORDER
    .map(k => ({ k, label: DESFECHO_LABEL[k], n: rows.filter(r => r.desfecho === k).length }))
    .filter(d => d.n > 0);

  // Comparação % — vendedora × média do time
  const fuPct = me.followup_oportunidades > 0
    ? Math.round(100 * me.followup_feitos / me.followup_oportunidades) : null;
  const teamFuPct = (() => {
    const op = peers.reduce((a, r) => a + Number(r.followup_oportunidades), 0);
    const ft = peers.reduce((a, r) => a + Number(r.followup_feitos), 0);
    return op > 0 ? Math.round(100 * ft / op) : null;
  })();
  const dims = [
    { label: 'Parcelamento proativo', mine: me.parcelamento_proativo_pct, team: avg(r => r.parcelamento_proativo_pct) },
    { label: 'Qualificação antes do preço', mine: me.qualificacao_pct, team: avg(r => r.qualificacao_pct) },
    { label: 'Follow-up realizado', mine: fuPct, team: teamFuPct },
    { label: 'Uso de áudio', mine: me.audio_pct, team: avg(r => r.audio_pct) },
  ];

  // Sugestões mais frequentes + pontos fortes recentes
  const sugCount = new Map<string, number>();
  for (const r of rows) for (const s of r.sugestoes ?? []) sugCount.set(s, (sugCount.get(s) ?? 0) + 1);
  const topSugestoes = Array.from(sugCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const fortes = Array.from(new Set(rows.flatMap(r => r.pontos_fortes ?? []))).slice(-3);

  return (
    <div className="viz-root space-y-6">
      <style>{`
        .viz-root { --s1: #2a78d6; --s2: #1baf7a; --ink: #0b0b0b; --ink-2: #52514e; --ink-mute: #898781; --grid: #e1e0d9; }
        .dark .viz-root { --s1: #3987e5; --s2: #199e70; --ink: #ffffff; --ink-2: #c3c2b7; --grid: #2c2c2a; }
      `}</style>

      {/* STAT TILES */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile label="Conversas analisadas" value={String(me.convs_analisadas)} hint={`${me.prospeccao_ativa} iniciadas por ela`} />
        <Tile label="Fechamento por conversa" value={me.fechamento_por_conv != null ? String(me.fechamento_por_conv) : '—'}
              hint={teamFech != null ? `média do time: ${teamFech}` : ''} />
        <Tile label="Follow-up" value={me.followup_oportunidades > 0 ? `${me.followup_feitos}/${me.followup_oportunidades}` : '—'}
              hint="feitos / oportunidades" />
        <Tile label="Vendidos" value={String(me.vendidos)} hint={`${me.esfriados} esfriaram`} good />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* CONVERSAS POR DIA */}
        <Card className="p-5">
          <ChartTitle>Conversas analisadas por dia</ChartTitle>
          {days.length === 0
            ? <Empty />
            : <DayBars days={days} />}
        </Card>

        {/* DESFECHOS */}
        <Card className="p-5">
          <ChartTitle>Desfecho das conversas</ChartTitle>
          {desfechos.length === 0
            ? <Empty />
            : <HBars items={desfechos.map(d => ({ label: d.label, value: d.n }))} max={Math.max(...desfechos.map(d => d.n))} />}
        </Card>
      </div>

      {/* VENDEDORA × TIME */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <ChartTitle>{cap(me.vendor_name)} × média do time</ChartTitle>
          <div className="flex items-center gap-4 text-[11px] text-fg-muted">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--s1)' }} /> {cap(me.vendor_name)}</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: 'var(--s2)' }} /> Média do time</span>
          </div>
        </div>
        <div className="mt-4 space-y-4">
          {dims.map(d => <CompareBar key={d.label} {...d} />)}
        </div>
      </Card>

      {/* SUGESTÕES DO AGENTE */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="p-5">
          <ChartTitle>Sugestões mais recorrentes do agente</ChartTitle>
          {topSugestoes.length === 0 ? <Empty /> : (
            <ul className="mt-3 space-y-2.5">
              {topSugestoes.map(([s, n]) => (
                <li key={s} className="flex items-start gap-2.5 text-[13px]">
                  <span className="mt-0.5 shrink-0 px-1.5 py-0.5 rounded-md bg-surface-muted text-[10.5px] num text-fg-subtle">{n}×</span>
                  <span className="text-fg">{s}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <ChartTitle>Pontos fortes observados</ChartTitle>
          {fortes.length === 0 ? <Empty /> : (
            <ul className="mt-3 space-y-2.5">
              {fortes.map(s => (
                <li key={s} className="flex items-start gap-2.5 text-[13px]">
                  <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--s2)' }} />
                  <span className="text-fg">{s}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Tile({ label, value, hint, good }: { label: string; value: string; hint?: string; good?: boolean }) {
  return (
    <Card className="p-5">
      <div className="text-[11px] uppercase tracking-[0.12em] text-fg-subtle">{label}</div>
      <div className={`mt-2 text-[30px] font-semibold tracking-[-0.03em] leading-none ${good ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
        {value}
      </div>
      {hint && <div className="mt-1.5 text-[11.5px] text-fg-muted">{hint}</div>}
    </Card>
  );
}

function ChartTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] uppercase tracking-[0.12em] text-fg-subtle">{children}</div>;
}

function Empty() {
  return <div className="py-8 text-center text-[12.5px] text-fg-muted">Sem dados no período.</div>;
}

// Barras verticais por dia — série única (sem legenda), tooltip nativo
function DayBars({ days }: { days: [string, number][] }) {
  const W = 560, H = 150, PAD = 6, LBL = 18;
  const max = Math.max(...days.map(([, n]) => n));
  const bw = Math.min(28, (W - PAD * 2) / days.length - 2);
  const step = (W - PAD * 2) / days.length;
  const showEvery = Math.ceil(days.length / 10);
  return (
    <svg viewBox={`0 0 ${W} ${H + LBL}`} className="mt-3 w-full" role="img" aria-label="Conversas por dia">
      {[0.5, 1].map(f => (
        <line key={f} x1={PAD} x2={W - PAD} y1={H - f * (H - 20)} y2={H - f * (H - 20)}
          stroke="var(--grid)" strokeWidth="1" />
      ))}
      {days.map(([d, n], i) => {
        const h = max > 0 ? (n / max) * (H - 20) : 0;
        const x = PAD + i * step + (step - bw) / 2;
        return (
          <g key={d}>
            <rect x={x} y={H - h} width={bw} height={h} rx="3" fill="var(--s1)">
              <title>{`${d}: ${n} conversa${n === 1 ? '' : 's'}`}</title>
            </rect>
            {n === max && (
              <text x={x + bw / 2} y={H - h - 5} textAnchor="middle" fontSize="10.5" fill="var(--ink-2)">{n}</text>
            )}
            {i % showEvery === 0 && (
              <text x={x + bw / 2} y={H + 13} textAnchor="middle" fontSize="9.5" fill="var(--ink-mute)">{d}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// Barras horizontais — série única, rótulo direto com o valor
function HBars({ items, max }: { items: { label: string; value: number }[]; max: number }) {
  return (
    <div className="mt-3 space-y-2.5">
      {items.map(it => (
        <div key={it.label} className="flex items-center gap-3" title={`${it.label}: ${it.value}`}>
          <span className="w-32 shrink-0 text-[12px] text-fg-muted text-right">{it.label}</span>
          <div className="flex-1 h-5 relative">
            <div className="absolute inset-y-0 left-0 rounded-r-[3px] rounded-l-[2px]"
              style={{ width: `${max > 0 ? Math.max(2, (it.value / max) * 100) : 0}%`, background: 'var(--s1)' }} />
          </div>
          <span className="w-8 shrink-0 text-[12.5px] num text-fg text-left">{it.value}</span>
        </div>
      ))}
    </div>
  );
}

// Par de barras % — vendedora (s1) × média do time (s2), rótulos em tinta de texto
function CompareBar({ label, mine, team }: { label: string; mine: number | null; team: number | null }) {
  return (
    <div title={`${label} — ela: ${mine ?? '—'}% · time: ${team ?? '—'}%`}>
      <div className="text-[12px] text-fg-muted mb-1.5">{label}</div>
      <div className="space-y-1">
        {[{ v: mine, c: 'var(--s1)' }, { v: team, c: 'var(--s2)' }].map(({ v, c }, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <div className="flex-1 h-3.5 relative">
              <div className="absolute inset-y-0 left-0 rounded-r-[3px] rounded-l-[2px]"
                style={{ width: v != null ? `${Math.max(2, v)}%` : '0%', background: c, opacity: v == null ? 0.15 : 1 }} />
            </div>
            <span className="w-10 shrink-0 text-[12px] num text-fg">{v != null ? `${v}%` : '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
