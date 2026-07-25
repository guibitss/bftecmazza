import { createAdminClient } from '@/lib/supabase/admin';
import { Card } from '@/components/ui/card';
import { Trophy, AlertTriangle, ShieldQuestion, Star } from 'lucide-react';
import type { Period } from '@/lib/period';
import { cachedMetric } from '@/lib/metrics-cache';
import { VerMais } from './ver-mais';

/**
 * Destaques do período: melhor atendimento (com trecho real), oportunidades
 * perdidas ("dinheiro na mesa") e taxonomia de objeções — tudo derivado da
 * análise do agente, com evidência auditável.
 */

const OBJ_LABEL: Record<string, string> = {
  preco: 'Preço', prazo: 'Prazo', concorrencia: 'Concorrência',
  confianca: 'Confiança', estoque: 'Estoque', outro: 'Outro',
};

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

interface BestRow {
  conversation_id: number;
  nota_geral: number;
  pontos_fortes: string[] | null;
  vendor_id: number;
  desfecho: string;
  msg_count: number;
}

const DESFECHO_BADGE: Record<string, string> = {
  vendido: 'Vendido', agendou: 'Visita agendada',
};

export async function Destaques({ period }: { period: Period }) {
  const admin = createAdminClient();
  const from = period.from.toISOString();
  const to = period.to.toISOString();

  const { best, vendors, perdas, objs, risco, notaCounts } = await cachedMetric(`destaques:${period.key}`, async () => {
    // Contagem exata por nota (0..10): head+count não transfere linha, então
    // não esbarra no teto de linhas do PostgREST (o mês tem >2k conversas).
    const notaQ = (k: number) => admin.from('conversation_analysis')
      .select('*', { count: 'exact', head: true })
      .gte('last_message_at', from).lt('last_message_at', to)
      .eq('analisavel', true).eq('eh_atendimento', true)
      .eq('nota_geral', k)
      .then(r => r.count ?? 0);

    const [base, notaCounts] = await Promise.all([
      Promise.all([
        // Melhor atendimento = eficácia comercial, não só nota alta: exige
        // desfecho positivo e conversa com substância (evita "cliente já comprou
        // em outro lugar" ganhando destaque por cordialidade)
        admin.from('conversation_analysis')
          .select('conversation_id, nota_geral, pontos_fortes, vendor_id, desfecho, msg_count')
          .gte('last_message_at', from).lt('last_message_at', to)
          .eq('analisavel', true)
          .eq('eh_atendimento', true)
          .in('desfecho', ['vendido', 'agendou'])
          .gte('msg_count', 12)
          .not('nota_geral', 'is', null)
          .order('nota_geral', { ascending: false })
          .order('msg_count', { ascending: false })
          .limit(1),
        admin.from('vendors').select('id, name'),
        admin.rpc('analysis_perdas', { p_from: from, p_to: to }),
        admin.rpc('analysis_objecoes', { p_from: from, p_to: to }),
        admin.rpc('analysis_valor_risco', { p_from: from, p_to: to }),
      ]),
      Promise.all(Array.from({ length: 11 }, (_, k) => notaQ(k))),
    ]);
    const [{ data: best }, { data: vendors }, { data: perdas }, { data: objs }, { data: risco }] = base;
    return { best, vendors, perdas, objs, risco, notaCounts };
  });

  // Histograma de qualidade: soma as contagens exatas em faixas + média real.
  const nc = (notaCounts ?? []) as number[];
  const totalNotas = nc.reduce((a, b) => a + b, 0);
  const mediaNota = totalNotas > 0 ? (nc.reduce((a, c, k) => a + c * k, 0) / totalNotas).toFixed(1) : null;
  const notaBands = [
    { label: '9–10', n: (nc[9] ?? 0) + (nc[10] ?? 0) },
    { label: '7–8',  n: (nc[7] ?? 0) + (nc[8] ?? 0) },
    { label: '4–6',  n: (nc[4] ?? 0) + (nc[5] ?? 0) + (nc[6] ?? 0) },
    { label: '0–3',  n: (nc[0] ?? 0) + (nc[1] ?? 0) + (nc[2] ?? 0) + (nc[3] ?? 0) },
  ];
  const maxBand = Math.max(1, ...notaBands.map(b => b.n));

  const nameById = new Map((vendors ?? []).map((v: { id: number; name: string }) => [v.id, v.name]));
  const top = (best ?? [])[0] as BestRow | undefined;
  const perda = (Array.isArray(perdas) ? perdas[0] : perdas) as
    { esfriados: number; followup_perdidos: number; negativas_secas: number } | undefined;
  const objRows = (objs ?? []) as { tipo: string; total: number; avaliaveis: number; quebradas: number; indeterminadas: number }[];
  const riscoRows = (risco ?? []) as { slug: string; ticket_medio: number; followup_perdidos: number; conversao_pct: number; valor_risco: number }[];
  const valorTotal = riscoRows.reduce((a, r) => a + Number(r.valor_risco ?? 0), 0);
  const brl0 = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

  // Trecho real da melhor conversa (últimas trocas)
  let trecho: { direction: string; body: string | null; kind: string }[] = [];
  if (top) {
    const { data } = await admin.from('messages')
      .select('direction, body, kind')
      .eq('conversation_id', top.conversation_id)
      .order('created_at', { ascending: false })
      .limit(6);
    trecho = ((data ?? []) as typeof trecho).reverse();
  }

  return (
    <div className="grid lg:grid-cols-2 gap-6 items-start">
     <div className="space-y-6">
      {/* MELHOR ATENDIMENTO */}
      <Card className="p-5">
        <div className="text-[11px] uppercase tracking-[0.12em] text-fg-subtle flex items-center gap-2">
          <Trophy size={12} /> Melhor atendimento do período
        </div>
        {!top ? (
          <div className="py-8 text-center text-[12.5px] text-fg-muted">
            Nenhum atendimento com venda ou visita agendada no período.
          </div>
        ) : (
          <>
            <div className="mt-3 flex items-baseline gap-3 flex-wrap">
              <span className="text-[26px] font-semibold tracking-[-0.03em]">
                {cap(nameById.get(top.vendor_id) ?? '—')}
              </span>
              <span className="text-[13px] text-fg-muted num">nota {top.nota_geral}/10</span>
              {DESFECHO_BADGE[top.desfecho] && (
                <span className="px-2 py-0.5 rounded-full border border-border text-[10.5px] uppercase tracking-wider text-fg-muted">
                  {DESFECHO_BADGE[top.desfecho]}
                </span>
              )}
            </div>
            {(top.pontos_fortes ?? []).length > 0 && (
              <ul className="mt-2.5 space-y-1">
                {(top.pontos_fortes ?? []).map(p => (
                  <li key={p} className="text-[12.5px] text-fg-muted">• {p}</li>
                ))}
              </ul>
            )}
            {trecho.length > 0 && (
              <div className="mt-4 rounded-xl border border-border bg-surface-muted/40 p-3 space-y-1.5 max-h-52 overflow-y-auto">
                {trecho.map((m, i) => (
                  <div key={i} className={m.direction === 'in' ? '' : 'text-right'}>
                    <span className={[
                      'inline-block max-w-[85%] px-2.5 py-1.5 rounded-xl text-[12px] leading-snug',
                      m.direction === 'in'
                        ? 'bg-surface border border-border text-fg'
                        : 'bg-ink-950 dark:bg-white text-white dark:text-ink-950',
                    ].join(' ')}>
                      {m.kind === 'text' ? (m.body ?? '') : `[${m.kind}]`}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <a href={`/inbox?conv=${top.conversation_id}`}
               className="mt-3 inline-block text-[11.5px] text-fg-subtle hover:text-fg transition-colors">
              Ver conversa completa →
            </a>
          </>
        )}
      </Card>

      {/* DISTRIBUIÇÃO DAS NOTAS */}
      <Card className="p-5">
        <div className="text-[11px] uppercase tracking-[0.12em] text-fg-subtle flex items-center gap-2">
          <Star size={12} /> Distribuição das notas
        </div>
        {totalNotas === 0 ? (
          <div className="py-6 text-center text-[12.5px] text-fg-muted">
            Nenhum atendimento avaliado no período.
          </div>
        ) : (
          <>
            <div className="mt-3 flex items-baseline gap-2.5">
              <span className="text-[26px] font-semibold tracking-[-0.03em] leading-none num">{mediaNota}</span>
              <span className="text-[12px] text-fg-muted">
                nota média · {totalNotas.toLocaleString('pt-BR')} atendimentos avaliados
              </span>
            </div>
            <div className="mt-4 space-y-2.5">
              {notaBands.map(b => (
                <div key={b.label} className="flex items-center gap-3">
                  <span className="w-12 shrink-0 text-[12px] num text-fg-muted text-right">{b.label}</span>
                  <div className="flex-1 h-4 relative">
                    <div className="absolute inset-y-0 left-0 rounded-r-[3px] rounded-l-[2px] bg-zinc-900 dark:bg-zinc-100"
                      style={{ width: `${b.n > 0 ? Math.max(3, (b.n / maxBand) * 100) : 0}%` }} />
                  </div>
                  <span className="w-20 shrink-0 text-[11.5px] num text-fg-muted text-right">
                    {b.n} · {Math.round((100 * b.n) / totalNotas)}%
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] text-fg-subtle leading-relaxed">
              Faixas de qualidade (0–10) atribuídas pelo agente. Só entram conversas avaliáveis.
            </p>
          </>
        )}
      </Card>
     </div>

      <div className="space-y-6">
        {/* DINHEIRO NA MESA */}
        <Card className="p-5">
          <div className="text-[11px] uppercase tracking-[0.12em] text-fg-subtle flex items-center gap-2">
            <AlertTriangle size={12} /> Oportunidades perdidas
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Metric n={perda?.esfriados ?? 0} label="leads esfriaram" tipo="esfriou" period={period} />
            <Metric n={perda?.followup_perdidos ?? 0} label="follow-ups não feitos" tipo="followup_perdido" period={period} />
            <Metric n={perda?.negativas_secas ?? 0} label="negativas sem alternativa" tipo="negativa_seca" period={period} />
          </div>
          {valorTotal > 0 && (
            <div className="mt-4 pt-3 hairline-t">
              <div className="text-[11px] uppercase tracking-[0.12em] text-fg-subtle">
                Valor em risco no período
              </div>
              <div className="mt-1.5 text-[30px] font-semibold tracking-[-0.03em] leading-none num">
                {brl0(valorTotal)}
              </div>
              <div className="mt-2.5 space-y-1">
                {riscoRows.map(r => (
                  <div key={r.slug} className="flex items-baseline justify-between text-[11.5px]">
                    <span className="text-fg-muted uppercase tracking-wider">{r.slug}</span>
                    <span className="num text-fg">
                      {brl0(Number(r.valor_risco))}
                      <span className="ml-2 text-fg-subtle">
                        {r.followup_perdidos} × {brl0(Number(r.ticket_medio))} × {r.conversao_pct}%
                      </span>
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2.5 text-[11px] text-fg-subtle leading-relaxed">
                Cálculo conservador: follow-ups não feitos × ticket médio da loja ×
                taxa de conversão observada nela. Não assume que todo lead viraria venda.
              </p>
            </div>
          )}
        </Card>

        {/* OBJEÇÕES */}
        <Card className="p-5">
          <div className="text-[11px] uppercase tracking-[0.12em] text-fg-subtle flex items-center gap-2">
            <ShieldQuestion size={12} /> Objeções mais frequentes
          </div>
          {objRows.length === 0 ? (
            <div className="py-6 text-center text-[12.5px] text-fg-muted">Nenhuma objeção detectada no período.</div>
          ) : (
            <div className="mt-3 space-y-2.5">
              {objRows.map(o => {
                const pct = o.avaliaveis > 0 ? Math.round(100 * o.quebradas / o.avaliaveis) : null;
                const max = Math.max(...objRows.map(r => Number(r.total)));
                return (
                  <div key={o.tipo} className="flex items-center gap-3"
                    title={`${o.quebradas} de ${o.avaliaveis} contornadas · ${o.indeterminadas} por áudio (não avaliável)`}>
                    <span className="w-24 shrink-0 text-[12px] text-fg-muted text-right">
                      {OBJ_LABEL[o.tipo] ?? o.tipo}
                    </span>
                    <div className="flex-1 h-4 relative">
                      <div className="absolute inset-y-0 left-0 rounded-r-[3px] rounded-l-[2px] bg-zinc-900 dark:bg-zinc-100"
                        style={{ width: `${max > 0 ? Math.max(3, (Number(o.total) / max) * 100) : 0}%` }} />
                    </div>
                    <span className="w-20 shrink-0 text-[11.5px] num text-fg-muted text-right">
                      {o.total} · {pct != null ? `${pct}%` : '—'}
                    </span>
                    <span className="w-24 shrink-0 text-right">
                      <VerMais tipo={`objecao_${o.tipo}`} period={period} label="ver" />
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-3 text-[11px] text-fg-subtle leading-relaxed">
            % = objeções contornadas entre as avaliáveis. Objeção respondida por
            áudio não entra na conta (o agente não escuta o áudio).
          </p>
        </Card>
      </div>
    </div>
  );
}

function Metric({ n, label, tipo, period }: { n: number; label: string; tipo?: string; period?: Period }) {
  return (
    <div>
      <div className="text-[24px] font-semibold tracking-[-0.03em] leading-none num">{n}</div>
      <div className="mt-1 text-[11px] text-fg-muted leading-tight">{label}</div>
      {tipo && period && n > 0 && (
        <div className="mt-1.5"><VerMais tipo={tipo} period={period} /></div>
      )}
    </div>
  );
}
