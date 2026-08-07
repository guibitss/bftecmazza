'use client';

import { useEffect, useState, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { isDemo } from '@/lib/supabase/schema';
import type { InboxAccess } from '@/lib/auth';
import { timeRelative, initials } from '@/lib/format';
import { Search, Sparkles, Headset, User as UserIcon, Inbox as InboxIcon, Tag, X, Check, Archive, ArchiveRestore } from 'lucide-react';
import { Avatar } from '@/components/avatar';
import { cn } from '@/lib/utils';

interface LabelChip { id: string; name: string; color: string; }

export interface ConvRow {
  id: number;
  inbox_id: number;
  customer_name: string | null;
  customer_phone: string | null;
  waha_id: string;
  last_message_at: string;
  last_message_preview: string | null;
  unread_count: number;
  status: string;
  avatar_url: string | null;
  archived_at?: string | null;
  conversation_labels?: { labels: LabelChip | null }[];
}

interface Props {
  inbox: InboxAccess;
  selectedConvId: number | null;
  onSelect: (id: number) => void;
}

function iconForKind(kind: InboxAccess['kind']) {
  if (kind === 'ai')      return Sparkles;
  if (kind === 'support') return Headset;
  return UserIcon;
}

export function ConversationList({ inbox, selectedConvId, onSelect }: Props) {
  const supabase = createClient();
  const [convs, setConvs] = useState<ConvRow[] | null>(null);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Renderização incremental: o iPad travava com a lista inteira no DOM.
  // Mantemos todas as conversas em memória (a busca varre tudo) mas só
  // montamos um pedaço, crescendo conforme rola.
  const PAGE = 40;
  const [visible, setVisible] = useState(PAGE);

  // Arquivadas: somem da caixa e ficam numa visão à parte (igual WhatsApp)
  const [showArchived, setShowArchived] = useState(false);
  const [swipe, setSwipe] = useState<{ id: number; dx: number } | null>(null);
  const swipeRef = useRef<{ id: number; x0: number; y0: number; locked: boolean } | null>(null);
  const ARCHIVE_AT = 96; // arrastar além disso arquiva

  async function toggleArchive(id: number, arquivar: boolean) {
    setConvs(prev => prev?.map(c => c.id === id
      ? { ...c, archived_at: arquivar ? new Date().toISOString() : null }
      : c) ?? prev);
    await supabase
      .from('conversations')
      .update({ archived_at: arquivar ? new Date().toISOString() : null })
      .eq('id', id);
  }

  function onSwipeStart(e: React.PointerEvent, id: number) {
    if (e.pointerType === 'mouse' && e.buttons !== 1) return;
    swipeRef.current = { id, x0: e.clientX, y0: e.clientY, locked: false };
  }
  function onSwipeMove(e: React.PointerEvent) {
    const s = swipeRef.current;
    if (!s) return;
    const dx = e.clientX - s.x0, dy = e.clientY - s.y0;
    // só entra em modo swipe se o gesto for claramente horizontal
    if (!s.locked) {
      if (Math.abs(dy) > Math.abs(dx)) { swipeRef.current = null; return; }
      if (Math.abs(dx) < 12) return;
      s.locked = true;
    }
    setSwipe({ id: s.id, dx: Math.max(-180, Math.min(0, dx)) });
  }
  function onSwipeEnd() {
    const s = swipeRef.current;
    swipeRef.current = null;
    if (!s?.locked) { setSwipe(null); return; }
    const dx = swipe?.dx ?? 0;
    if (Math.abs(dx) >= ARCHIVE_AT) {
      const alvo = (convs ?? []).find(c => c.id === s.id);
      toggleArchive(s.id, !alvo?.archived_at);
    }
    setSwipe(null);
  }

  // Filtro por etiqueta (ids selecionados) — conversa passa se tem QUALQUER uma
  const [labelFilter, setLabelFilter] = useState<Set<string>>(new Set());
  const [showLabels, setShowLabels] = useState(false);
  const labelBoxRef = useRef<HTMLDivElement>(null);

  // Etiquetas presentes nesta caixa, com quantas conversas cada uma tem
  const labelOptions = (() => {
    const m = new Map<string, LabelChip & { count: number }>();
    for (const c of convs ?? []) {
      for (const rel of c.conversation_labels ?? []) {
        const l = rel.labels;
        if (!l) continue;
        const cur = m.get(l.id);
        if (cur) cur.count++;
        else m.set(l.id, { ...l, count: 1 });
      }
    }
    return [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  })();

  // Fecha o seletor ao clicar fora
  useEffect(() => {
    if (!showLabels) return;
    function onDown(e: MouseEvent) {
      if (labelBoxRef.current && !labelBoxRef.current.contains(e.target as Node)) setShowLabels(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [showLabels]);

  // Some com etiquetas que não existem mais na caixa (ex: ao trocar de inbox)
  useEffect(() => { setLabelFilter(new Set()); setShowLabels(false); }, [inbox.inboxId]);

  // Volta ao topo da renderização quando muda o que está sendo listado
  useEffect(() => { setVisible(PAGE); }, [inbox.inboxId, query, labelFilter, showArchived]);

  // Cresce a lista ao chegar perto do fim (para quando já mostrou tudo)
  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 400) {
      setVisible(v => (v >= filtered.length ? v : v + PAGE));
    }
  }

  function toggleLabel(id: string) {
    setLabelFilter(prev => {
      const s = new Set(prev);
      if (s.has(id)) s.delete(id); else s.add(id);
      return s;
    });
  }

  // Fetch inicial
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setConvs(null);
      try {
        const { data, error } = await supabase
          .from('conversations')
          .select('id, inbox_id, customer_name, customer_phone, waha_id, last_message_at, last_message_preview, unread_count, status, avatar_url, archived_at, conversation_labels(labels(id, name, color))')
          .eq('inbox_id', inbox.inboxId)
          .order('last_message_at', { ascending: false })
          .limit(600);
        if (!cancelled) setConvs((data ?? []) as ConvRow[]);
      } catch {
        if (!cancelled) setConvs([]);
      }
    })();
    return () => { cancelled = true; };
  }, [inbox.inboxId, supabase]);

  // Realtime — desligado no modo demo (dados estáticos, sem mensagens ao vivo)
  useEffect(() => {
    if (isDemo()) return;
    const ch = supabase
      .channel(`inbox-${inbox.inboxId}-convs`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations', filter: `inbox_id=eq.${inbox.inboxId}` },
        (payload: { eventType: string; new: ConvRow; old: Partial<ConvRow> }) => {
          setConvs(prev => {
            if (!prev) return prev;
            const row = (payload.new ?? payload.old) as ConvRow | undefined;
            if (!row) return prev;
            if (payload.eventType === 'DELETE') return prev.filter(c => c.id !== row.id);
            const newRow = payload.new as ConvRow;
            const idx = prev.findIndex(c => c.id === newRow.id);
            const next = idx >= 0 ? [...prev] : [newRow, ...prev];
            if (idx >= 0) next[idx] = { ...next[idx], ...newRow };
            return next.sort((a, b) => b.last_message_at.localeCompare(a.last_message_at));
          });
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [inbox.inboxId, supabase]);

  const Icon = iconForKind(inbox.kind);
  const arquivadasCount = (convs ?? []).filter(c => c.archived_at).length;
  const filtered = (convs ?? []).filter(c => {
    // Arquivadas ficam fora da caixa (e só elas aparecem na visão de arquivadas)
    if (showArchived ? !c.archived_at : !!c.archived_at) return false;
    // Etiqueta: conversa passa se tem QUALQUER uma das selecionadas
    if (labelFilter.size > 0) {
      const ids = (c.conversation_labels ?? []).map(r => r.labels?.id).filter(Boolean) as string[];
      if (!ids.some(id => labelFilter.has(id))) return false;
    }
    if (!query) return true;
    const q       = query.toLowerCase().trim();
    if (!q) return true;

    // Busca textual — nome e prévia da última mensagem
    if ((c.customer_name ?? '').toLowerCase().includes(q)) return true;
    if ((c.last_message_preview ?? '').toLowerCase().includes(q)) return true;

    // Busca por número — extrai só os dígitos do que o usuário digitou
    // Ex: "44 9898-1234" → "449898 1234" → "4498981234"
    const qDigits = q.replace(/\D/g, '');
    const searchNum = qDigits.length > 0 ? qDigits : q;
    // customer_phone: "5544999999999" | waha_id: "5544999999999@c.us" ou "@lid"
    const phone   = c.customer_phone ?? '';
    const wahaNum = (c.waha_id ?? '').split('@')[0];
    if (phone.includes(searchNum))   return true;
    if (wahaNum.includes(searchNum)) return true;

    return false;
  });

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden bg-surface-2/40">
      {/* Header — mais respiro */}
      <div className="px-5 py-4 hairline-b flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl border border-border bg-surface grid place-items-center text-fg-muted shrink-0">
          <Icon size={17} strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold tracking-tight truncate">{inbox.displayName}</div>
          <div className="text-[10.5px] uppercase tracking-[0.12em] text-fg-subtle mt-0.5">
            {inbox.storeSlug} · {inbox.kind === 'ai' ? 'ia' : inbox.kind}
          </div>
        </div>
        {convs && (
          <span className="text-[11px] text-fg-subtle num tabular-nums px-2 py-0.5 rounded-md border border-border">
            {labelFilter.size > 0 || query ? `${filtered.length}/${convs.length}` : convs.length}
          </span>
        )}
      </div>

      {/* Busca + filtro por etiqueta */}
      <div className="px-4 pt-3 pb-2 space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome, número ou texto…"
              className="w-full h-10 pl-10 pr-3 rounded-xl border border-border bg-surface text-[13px] placeholder:text-fg-subtle focus:outline-none focus:border-border-strong transition-colors"
            />
          </div>

          {labelOptions.length > 0 && (
            <div className="relative shrink-0" ref={labelBoxRef}>
              <button
                type="button"
                onClick={() => setShowLabels(v => !v)}
                title="Filtrar por etiqueta"
                className={cn(
                  'h-10 px-3 rounded-xl border flex items-center gap-1.5 text-[12.5px] transition-colors',
                  labelFilter.size > 0
                    ? 'border-ink-950 dark:border-ink-300 bg-surface text-fg'
                    : 'border-border bg-surface text-fg-muted hover:text-fg hover:border-border-strong',
                )}
              >
                <Tag size={14} strokeWidth={1.75} />
                {labelFilter.size > 0 && <span className="num">{labelFilter.size}</span>}
              </button>

              {showLabels && (
                <div className="absolute right-0 top-full mt-1.5 z-40 w-60 max-h-80 overflow-y-auto rounded-xl border border-border bg-surface shadow-lg animate-fade-in">
                  <div className="px-3 py-2 hairline-b flex items-center justify-between sticky top-0 bg-surface">
                    <span className="text-[10px] uppercase tracking-[0.14em] text-fg-subtle">Etiquetas</span>
                    {labelFilter.size > 0 && (
                      <button
                        type="button"
                        onClick={() => setLabelFilter(new Set())}
                        className="text-[11px] text-fg-subtle hover:text-fg transition-colors"
                      >
                        limpar
                      </button>
                    )}
                  </div>
                  <ul className="py-1">
                    {labelOptions.map(l => {
                      const on = labelFilter.has(l.id);
                      return (
                        <li key={l.id}>
                          <button
                            type="button"
                            onClick={() => toggleLabel(l.id)}
                            className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-surface-muted transition-colors text-left"
                          >
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
                            <span className="text-[13px] flex-1 truncate">{l.name}</span>
                            <span className="text-[11px] text-fg-subtle num">{l.count}</span>
                            {on && <Check size={13} strokeWidth={2.5} className="shrink-0" />}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Arquivadas */}
        {(arquivadasCount > 0 || showArchived) && (
          <button
            type="button"
            onClick={() => setShowArchived(v => !v)}
            className={cn(
              'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] transition-colors',
              showArchived
                ? 'bg-surface-muted text-fg'
                : 'text-fg-muted hover:text-fg hover:bg-surface-muted/60',
            )}
          >
            {showArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
            <span className="flex-1 text-left">
              {showArchived ? 'Voltar para a caixa' : 'Arquivadas'}
            </span>
            {!showArchived && <span className="num text-fg-subtle">{arquivadasCount}</span>}
          </button>
        )}

        {/* Etiquetas ativas no filtro */}
        {labelFilter.size > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {labelOptions.filter(l => labelFilter.has(l.id)).map(l => (
              <button
                key={l.id}
                type="button"
                onClick={() => toggleLabel(l.id)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium hover:opacity-75 transition-opacity"
                style={{ backgroundColor: `${l.color}22`, color: l.color }}
                title="Remover do filtro"
              >
                {l.name}
                <X size={10} strokeWidth={2.5} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Lista — cards com border + espaçamento */}
      <div ref={containerRef} onScroll={onScroll} className="flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
        {convs === null ? (
          <ListSkeleton />
        ) : filtered.length === 0 ? (
          <EmptyState query={query} filtering={labelFilter.size > 0} archived={showArchived} />
        ) : (
          <ul className="flex flex-col gap-1.5 pt-1">
            {filtered.slice(0, visible).map((c) => {
              const active = c.id === selectedConvId;
              const hasUnread = c.unread_count > 0;
              const displayName = c.customer_name ?? c.customer_phone ?? c.waha_id;
              const labels = (c.conversation_labels ?? [])
                .map(x => x.labels).filter((l): l is LabelChip => !!l);
              const sw = swipe?.id === c.id ? swipe.dx : 0;
              const vaiArquivar = Math.abs(sw) >= ARCHIVE_AT;
              return (
                <li key={c.id} className="relative rounded-xl overflow-hidden">
                  {/* Fundo revelado ao arrastar */}
                  {sw !== 0 && (
                    <div className={cn(
                      'absolute inset-0 flex items-center justify-end pr-4 rounded-xl transition-colors',
                      vaiArquivar ? 'bg-amber-500' : 'bg-amber-500/40',
                    )}>
                      <span className="flex items-center gap-1.5 text-white text-[12px] font-medium">
                        {c.archived_at ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                        {c.archived_at ? 'Restaurar' : 'Arquivar'}
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => { if (!swipe) onSelect(c.id); }}
                    onPointerDown={(e) => onSwipeStart(e, c.id)}
                    onPointerMove={onSwipeMove}
                    onPointerUp={onSwipeEnd}
                    onPointerCancel={onSwipeEnd}
                    style={sw !== 0 ? { transform: `translateX(${sw}px)` } : undefined}
                    className={cn(
                      'relative w-full flex items-start gap-3 rounded-xl border px-3 py-3 text-left transition-colors duration-150 touch-pan-y',
                      sw === 0 && 'transition-transform',
                      active
                        ? 'border-ink-950 dark:border-ink-300 bg-surface shadow-sm'
                        : 'border-border bg-surface hover:border-border-strong hover:bg-surface',
                    )}
                  >
                    <Avatar src={c.avatar_url} name={c.customer_name ?? c.customer_phone ?? '?'} size={40} />

                    {/* Conteúdo */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={cn(
                          'text-[13.5px] tracking-tight truncate',
                          hasUnread ? 'font-semibold text-fg' : 'font-medium text-fg',
                        )}>
                          {displayName}
                        </span>
                        <span className="text-[10.5px] text-fg-subtle shrink-0 num">
                          {timeRelative(c.last_message_at)}
                        </span>
                      </div>

                      <div className="flex items-end justify-between gap-2 mt-1">
                        <span className={cn(
                          'text-[12.5px] truncate leading-snug',
                          hasUnread ? 'text-fg' : 'text-fg-muted',
                        )}>
                          {c.last_message_preview ?? '—'}
                        </span>
                        {hasUnread && (
                          <span className="shrink-0 min-w-[20px] h-[20px] px-1.5 rounded-full bg-ink-950 dark:bg-white text-white dark:text-ink-950 text-[11px] font-semibold grid place-items-center num leading-none">
                            {c.unread_count > 99 ? '99+' : c.unread_count}
                          </span>
                        )}
                      </div>

                      {/* Etiquetas no cantinho */}
                      {labels.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1 mt-1.5">
                          {labels.slice(0, 4).map(l => (
                            <span
                              key={l.id}
                              className="inline-flex items-center gap-1 max-w-[120px] px-1.5 py-0.5 rounded-md text-[10px] font-medium leading-none truncate"
                              style={{ backgroundColor: `${l.color}22`, color: l.color }}
                              title={l.name}
                            >
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
                              <span className="truncate">{l.name}</span>
                            </span>
                          ))}
                          {labels.length > 4 && (
                            <span className="text-[10px] text-fg-subtle">+{labels.length - 4}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="flex flex-col gap-1.5 pt-1">
      {Array.from({ length: 7 }).map((_, i) => (
        <li key={i} className="flex items-start gap-3 rounded-xl border border-border bg-surface px-3 py-3 animate-pulse">
          <div className="w-10 h-10 rounded-full bg-surface-muted" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-3 w-2/3 bg-surface-muted rounded" />
            <div className="h-2.5 w-full bg-surface-muted/70 rounded" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ query, filtering, archived }: { query: string; filtering?: boolean; archived?: boolean }) {
  const msg = archived
    ? 'Nenhuma conversa arquivada.'
    : filtering
    ? (query ? 'Nada encontrado com essa busca e etiqueta.' : 'Nenhuma conversa com essa etiqueta.')
    : (query ? 'Nada encontrado.' : 'Sem conversas ainda.');
  const Icon = archived ? Archive : filtering ? Tag : InboxIcon;
  return (
    <div className="grid place-items-center h-full px-6 py-12 text-center">
      <div className="max-w-xs">
        <Icon size={24} className="mx-auto text-fg-subtle" strokeWidth={1.5} />
        <p className="mt-3 text-[13px] text-fg-muted">{msg}</p>
        {!archived && !filtering && !query && (
          <p className="mt-1.5 text-[11.5px] text-fg-subtle">Arraste uma conversa para o lado para arquivar.</p>
        )}
      </div>
    </div>
  );
}
