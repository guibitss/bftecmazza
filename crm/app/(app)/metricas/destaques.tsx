import { createAdminClient } from '@/lib/supabase/admin';
import { Card } from '@/components/ui/card';
import { Trophy, AlertTriangle, ShieldQuestion } from 'lucide-react';
import type { Period } from '@/lib/period';

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
}

export async function Destaques({ period }: { period: Period }) {
  const admin = createAdminClient();
  const from = period.from.toISOString();
  const to = period.to.toISOString();

  const [{ data: best }, { data: vendors }, { data: perdas }, { data: objs }] = await Promise.all([
    admin.from('conversation_analysis')
      .select('conversation_id, nota_geral, pontos_fortes, vendor_id, desfecho')
      .gte('last_message_at', from).lt('last_message_at', to)
      .not('nota_geral', 'is', null)
      .order('nota_geral', { ascending: false })
      .limit(1),
    admin.from('vendors').select('id, name'),
    admin.rpc('analysis_perdas', { p_from: from, p_to: to }),
    admin.rpc('analysis_objecoes', { p_from: from, p_to: to }),
  ]);

  const nameById = new Map((vendors ?? []).map((v: { id: number; name: string }) => [v.id, v.name]));
  const top = (best ?? [])[0] as BestRow | undefined;
  const perda = (Array.isArray(perdas) ? perdas[0] : perdas) as
    { esfriados: number; followup_perdidos: number; negativas_secas: number } | undefined;
  const objRows = (objs ?? []) as { tipo: string; total: number; avaliaveis: number; quebradas: number; indeterminadas: number }[];

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
    <div className="grid lg:grid-cols-2 gap-6">
      {/* MELHOR ATENDIMENTO */}
      <Card className="p-5">
        <div className="text-[11px] uppercase tracking-[0.12em] text-fg-subtle flex items-center gap-2">
          <Trophy size={12} /> Melhor atendimento do período
        </div>
        {!top ? (
          <div className="py-8 text-center text-[12.5px] text-fg-muted">Sem análises no período.</div>
        ) : (
          <>
            <div className="mt-3 flex items-baseline gap-3">
              <span className="text-[26px] font-semibold tracking-[-0.03em]">
                {cap(nameById.get(top.vendor_id) ?? '—')}
              </span>
              <span className="text-[13px] text-fg-muted num">nota {top.nota_geral}/10</span>
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

      <div className="space-y-6">
        {/* DINHEIRO NA MESA */}
        <Card className="p-5">
          <div className="text-[11px] uppercase tracking-[0.12em] text-fg-subtle flex items-center gap-2">
            <AlertTriangle size={12} /> Oportunidades perdidas
          </div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Metric n={perda?.esfriados ?? 0} label="leads esfriaram" />
            <Metric n={perda?.followup_perdidos ?? 0} label="follow-ups não feitos" />
            <Metric n={perda?.negativas_secas ?? 0} label="negativas sem alternativa" />
          </div>
          <p className="mt-3 text-[11.5px] text-fg-subtle leading-relaxed">
            Cada follow-up não feito é um cliente que sinalizou interesse e não foi retomado.
          </p>
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

function Metric({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <div className="text-[24px] font-semibold tracking-[-0.03em] leading-none num">{n}</div>
      <div className="mt-1 text-[11px] text-fg-muted leading-tight">{label}</div>
    </div>
  );
}
