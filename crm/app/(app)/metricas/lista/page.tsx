import { getCurrentUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolvePeriod } from '@/lib/period';
import { PeriodFilter } from '@/components/period-filter';
import { VendorFilter, type VendorOption } from '@/components/vendor-filter';
import { StoreFilter, type StoreOption } from '@/components/store-filter';
import { ArrowUpRight, MessageSquare } from 'lucide-react';

interface Row {
  conversation_id: number;
  inbox_id: number | null;
  vendor_id: number;
  vendor_name: string;
  customer_name: string;
  last_message_at: string;
  nota_geral: number | null;
  desfecho: string;
  preview: string | null;
  sugestao: string | null;
}

function convHref(r: { conversation_id: number; inbox_id: number | null }): string {
  return r.inbox_id
    ? `/inbox?inbox=${r.inbox_id}&conv=${r.conversation_id}`
    : `/inbox?conv=${r.conversation_id}`;
}

const TITULOS: Record<string, { titulo: string; explica: string }> = {
  sem_fechamento:   { titulo: 'Poderiam ter pergunta de fechamento', explica: 'Conversas em que a vendedora não fez nenhuma pergunta que empurrasse a decisão de compra.' },
  followup_perdido: { titulo: 'Follow-ups não feitos', explica: 'O cliente sinalizou que decidiria depois e não houve retomada por parte da vendedora.' },
  negativa_seca:    { titulo: 'Negativas sem alternativa', explica: 'Cliente pediu algo indisponível e recebeu só o "não", sem oferta de alternativa.' },
  esfriou:          { titulo: 'Leads que esfriaram', explica: 'Conversas em que o cliente parou de responder ou desistiu.' },
  todas:            { titulo: 'Conversas analisadas', explica: 'Todas as conversas de atendimento analisadas no período.' },
};

function tituloDe(tipo: string, tituloParam?: string) {
  if (tipo === 'sugestao' && tituloParam) {
    return { titulo: tituloParam, explica: 'Conversas em que o agente sugeriu exatamente isso.' };
  }
  if (tipo.startsWith('objecao_')) {
    const t = tipo.slice(8);
    const nomes: Record<string, string> = { preco: 'preço', prazo: 'prazo', concorrencia: 'concorrência', confianca: 'confiança', estoque: 'estoque' };
    return { titulo: `Objeções de ${nomes[t] ?? t} não contornadas`, explica: `Conversas em que o cliente levantou uma objeção de ${nomes[t] ?? t} e ela não foi dissolvida.` };
  }
  return TITULOS[tipo] ?? { titulo: 'Conversas', explica: '' };
}

const DESFECHO_LABEL: Record<string, string> = {
  vendido: 'Vendido', agendou: 'Agendou', negociando: 'Negociando',
  em_andamento: 'Em andamento', esfriou: 'Esfriou', perdido: 'Perdido', indefinido: 'Indefinido',
};

function cap(s: string) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
}

export default async function ListaPage({ searchParams }: {
  searchParams: Promise<{ tipo?: string; v?: string; s?: string; sug?: string; titulo?: string; p?: string; from?: string; to?: string }>;
}) {
  await getCurrentUser();
  const sp = await searchParams;
  const tipo = sp.tipo ?? 'todas';
  const vendorId = sp.v ? Number(sp.v) : null;
  const storeId = sp.s ? Number(sp.s) : null;
  const period = resolvePeriod(sp);
  const { titulo, explica } = tituloDe(tipo, sp.titulo);

  const admin = createAdminClient();
  const [{ data }, { data: vendorRows }, { data: storeRows }] = await Promise.all([
    admin.rpc('analysis_conversas', {
      p_tipo: tipo,
      p_from: period.from.toISOString(),
      p_to: period.to.toISOString(),
      p_vendor: vendorId,
      p_store: storeId,
      p_sug_regex: sp.sug ?? null,
    }),
    admin.from('vendors').select('id, name, stores:store_id(slug)').eq('active', true).order('store_id').order('queue_order'),
    admin.from('stores').select('id, slug').eq('active', true).order('id'),
  ]);
  const rows = (data ?? []) as Row[];
  const vendors: VendorOption[] = (vendorRows ?? []).map((v: Record<string, unknown>) => {
    const storeRel = v.stores as { slug?: string } | { slug: string }[] | null;
    const slug = Array.isArray(storeRel) ? storeRel[0]?.slug ?? '' : storeRel?.slug ?? '';
    return { id: v.id as number, name: v.name as string, storeSlug: slug };
  });
  const stores = (storeRows ?? []) as StoreOption[];

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="hairline-b h-16 px-8 flex items-center justify-between gap-3">
        <span className="text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
          Métricas · Conversas
        </span>
        <div className="flex flex-wrap items-center gap-3">
          <StoreFilter stores={stores} />
          <VendorFilter vendors={vendors} />
          <PeriodFilter />
        </div>
      </div>

      <div className="px-8 py-10 max-w-4xl mx-auto">
        <h1 className="text-[26px] font-semibold tracking-[-0.03em]">{titulo}</h1>
        {explica && <p className="mt-2 text-[13.5px] text-fg-muted max-w-2xl">{explica}</p>}
        <div className="mt-1.5 text-[12px] text-fg-subtle">
          {period.label} · {rows.length} conversa{rows.length === 1 ? '' : 's'}
        </div>

        {rows.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-border bg-surface p-10 text-center text-[13px] text-fg-muted">
            Nenhuma conversa nessa situação no período. 🎉
          </div>
        ) : (
          <ul className="mt-6 space-y-2">
            {rows.map(r => (
              <li key={r.conversation_id}>
                <a
                  href={convHref(r)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-start gap-3 rounded-xl border border-border bg-surface p-4 hover:border-border-strong transition-colors"
                >
                  <div className="w-9 h-9 rounded-lg border border-border bg-surface-muted grid place-items-center text-fg-subtle shrink-0">
                    <MessageSquare size={15} strokeWidth={1.75} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[14px] font-medium truncate">{r.customer_name}</span>
                      <span className="text-[11px] text-fg-subtle shrink-0 num">{fmtDate(r.last_message_at)}</span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-fg-muted flex items-center gap-2 flex-wrap">
                      <span>{cap(r.vendor_name)}</span>
                      <span className="text-fg-subtle">·</span>
                      <span>{DESFECHO_LABEL[r.desfecho] ?? r.desfecho}</span>
                      {r.nota_geral != null && (
                        <>
                          <span className="text-fg-subtle">·</span>
                          <span className="num">nota {r.nota_geral}/10</span>
                        </>
                      )}
                    </div>
                    {r.preview && (
                      <div className="mt-1.5 text-[12px] text-fg-subtle truncate">"{r.preview}"</div>
                    )}
                    {r.sugestao && (
                      <div className="mt-1.5 text-[11.5px] text-amber-600 dark:text-amber-400">💡 {r.sugestao}</div>
                    )}
                  </div>
                  <ArrowUpRight size={15} className="text-fg-subtle group-hover:text-fg shrink-0 mt-1 transition-colors" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
