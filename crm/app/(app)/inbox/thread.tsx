'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ArrowLeft, MoreVertical } from 'lucide-react';
import { MessageBubble, type MsgRow } from './message-bubble';
import { Composer } from './composer';
import { ContactSheet } from './contact-sheet';
import { Avatar } from '@/components/avatar';
import { formatPhone } from '@/lib/format';
import type { InboxAccess } from '@/lib/auth';

interface ConvHeader {
  id: number;
  customer_name: string | null;
  customer_phone: string | null;
  waha_id: string;
  unread_count: number;
  avatar_url: string | null;
}

interface Props {
  convId: number;
  inbox: InboxAccess;
  sendableInboxes: InboxAccess[];
  onBack: () => void;
}

export function Thread({ convId, inbox, sendableInboxes, onBack }: Props) {
  const supabase = createClient();
  const [conv, setConv]   = useState<ConvHeader | null>(null);
  const [msgs, setMsgs]   = useState<MsgRow[] | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch inicial conv + msgs
  useEffect(() => {
    let cancelled = false;
    setConv(null); setMsgs(null);
    (async () => {
      const [{ data: c }, { data: m }] = await Promise.all([
        supabase
          .from('conversations')
          .select('id, customer_name, customer_phone, waha_id, unread_count, avatar_url')
          .eq('id', convId).maybeSingle(),
        supabase
          .from('messages')
          .select('id, conversation_id, direction, author_type, author_id, author_session, kind, body, media_url, media_mime, media_filename, ack, created_at')
          .eq('conversation_id', convId)
          .order('created_at', { ascending: true })
          .limit(200),
      ]);
      if (cancelled) return;
      setConv(c as ConvHeader | null);
      setMsgs((m ?? []) as MsgRow[]);
    })();
    return () => { cancelled = true; };
  }, [convId, supabase]);

  // Realtime: novas mensagens
  useEffect(() => {
    const ch = supabase
      .channel(`conv-${convId}-msgs`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `conversation_id=eq.${convId}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setMsgs(prev => prev ? [...prev, payload.new as MsgRow] : prev);
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as MsgRow;
            setMsgs(prev => prev?.map(x => x.id === updated.id ? { ...x, ...updated } : x) ?? prev);
          } else if (payload.eventType === 'DELETE') {
            const old = payload.old as { id: number };
            setMsgs(prev => prev?.filter(x => x.id !== old.id) ?? prev);
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [convId, supabase]);

  // Auto-scroll pra última msg ao abrir conversa ou chegar nova
  useEffect(() => {
    if (!msgs || msgs.length === 0) return;
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [msgs]);

  // Marca como lida (zera unread_count) ao abrir
  useEffect(() => {
    if (!conv || conv.unread_count === 0) return;
    supabase.from('conversations').update({ unread_count: 0 }).eq('id', convId).then(() => {});
  }, [conv, convId, supabase]);

  const headerName = conv?.customer_name ?? conv?.customer_phone ?? conv?.waha_id ?? '…';

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="h-14 shrink-0 px-3 sm:px-4 hairline-b bg-white dark:bg-zinc-950 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="md:hidden p-2 -ml-1 rounded-lg hover:bg-surface-muted transition-colors"
          aria-label="Voltar"
        >
          <ArrowLeft size={18} strokeWidth={1.75} />
        </button>
        <Avatar src={conv?.avatar_url} name={conv?.customer_name ?? conv?.customer_phone ?? '?'} size={36} />
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-semibold tracking-tight truncate">{headerName}</div>
          <div className="text-[11px] text-fg-subtle truncate">
            {conv?.customer_phone ? formatPhone(conv.customer_phone) : conv?.waha_id ?? '—'}
            <span className="text-fg-subtle/70 mx-1.5">·</span>
            {inbox.displayName}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="p-2 rounded-lg text-fg-muted hover:text-fg hover:bg-surface-muted transition-colors"
          aria-label="Dados do contato"
          title="Dados do contato"
        >
          <MoreVertical size={16} strokeWidth={1.75} />
        </button>
      </div>

      <ContactSheet
        convId={convId}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        inboxLabel={inbox.displayName}
        storeSlug={inbox.storeSlug}
      />

      {/* Mensagens — scroll interno próprio */}
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 sm:px-6 py-4 space-y-2"
      >
        {msgs === null ? (
          <ThreadSkeleton />
        ) : msgs.length === 0 ? (
          <div className="h-full grid place-items-center text-center">
            <div className="text-[13px] text-fg-muted">Sem mensagens nessa conversa ainda.</div>
          </div>
        ) : (
          groupByDay(msgs).map((group, i) => (
            <div key={i} className="space-y-2">
              <div className="flex justify-center my-3">
                <span className="text-[10.5px] uppercase tracking-[0.12em] text-fg-subtle bg-surface/80 backdrop-blur-sm px-3 py-1 rounded-full border border-border">
                  {group.label}
                </span>
              </div>
              {group.msgs.map(m => <MessageBubble key={m.id} msg={m} />)}
            </div>
          ))
        )}
      </div>

      {/* Composer */}
      <Composer convId={convId} inbox={inbox} sendableInboxes={sendableInboxes} canSend={inbox.canSend} />
    </div>
  );
}

function ThreadSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className={`flex ${i % 2 ? 'justify-end' : 'justify-start'} animate-pulse`}>
          <div className="h-10 w-48 bg-surface-muted rounded-2xl" />
        </div>
      ))}
    </div>
  );
}

function groupByDay(msgs: MsgRow[]): { label: string; msgs: MsgRow[] }[] {
  const out: { label: string; msgs: MsgRow[] }[] = [];
  let lastDay = '';
  for (const m of msgs) {
    const d = new Date(m.created_at);
    const dayKey = d.toDateString();
    if (dayKey !== lastDay) {
      out.push({ label: dayLabel(d), msgs: [] });
      lastDay = dayKey;
    }
    out[out.length - 1].msgs.push(m);
  }
  return out;
}

function dayLabel(d: Date): string {
  const today = new Date(); today.setHours(0,0,0,0);
  const target = new Date(d); target.setHours(0,0,0,0);
  const diff = Math.round((today.getTime() - target.getTime()) / 86400000);
  if (diff === 0) return 'Hoje';
  if (diff === 1) return 'Ontem';
  if (diff < 7)   return d.toLocaleDateString('pt-BR', { weekday: 'long' });
  return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });
}
