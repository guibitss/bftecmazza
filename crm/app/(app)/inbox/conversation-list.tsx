'use client';

import { useEffect, useState, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { isDemo } from '@/lib/supabase/schema';
import type { InboxAccess } from '@/lib/auth';
import { timeRelative, initials } from '@/lib/format';
import { Search, Sparkles, Headset, User as UserIcon, Inbox as InboxIcon } from 'lucide-react';
import { Avatar } from '@/components/avatar';
import { cn } from '@/lib/utils';

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

  // Fetch inicial
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setConvs(null);
      try {
        const { data, error } = await supabase
          .from('conversations')
          .select('id, inbox_id, customer_name, customer_phone, waha_id, last_message_at, last_message_preview, unread_count, status, avatar_url')
          .eq('inbox_id', inbox.inboxId)
          .order('last_message_at', { ascending: false })
          .limit(1500);
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
  const filtered = (convs ?? []).filter(c => {
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
            {convs.length}
          </span>
        )}
      </div>

      {/* Busca — mais padding lateral, altura confortável */}
      <div className="px-4 pt-3 pb-2">
        <div className="relative">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-fg-subtle" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nome, número ou texto…"
            className="w-full h-10 pl-10 pr-3 rounded-xl border border-border bg-surface text-[13px] placeholder:text-fg-subtle focus:outline-none focus:border-border-strong transition-colors"
          />
        </div>
      </div>

      {/* Lista — cards com border + espaçamento */}
      <div ref={containerRef} className="flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
        {convs === null ? (
          <ListSkeleton />
        ) : filtered.length === 0 ? (
          <EmptyState query={query} />
        ) : (
          <ul className="flex flex-col gap-1.5 pt-1">
            {filtered.map((c) => {
              const active = c.id === selectedConvId;
              const hasUnread = c.unread_count > 0;
              const displayName = c.customer_name ?? c.customer_phone ?? c.waha_id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    className={cn(
                      'relative w-full flex items-start gap-3 rounded-xl border px-3 py-3 text-left transition-all duration-150',
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

function EmptyState({ query }: { query: string }) {
  return (
    <div className="grid place-items-center h-full px-6 py-12 text-center">
      <div className="max-w-xs">
        <InboxIcon size={24} className="mx-auto text-fg-subtle" strokeWidth={1.5} />
        <p className="mt-3 text-[13px] text-fg-muted">
          {query ? 'Nada encontrado.' : 'Sem conversas ainda.'}
        </p>
      </div>
    </div>
  );
}
