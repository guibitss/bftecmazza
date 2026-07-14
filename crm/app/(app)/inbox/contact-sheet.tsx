'use client';

import { useEffect, useState, useTransition } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  X, Phone, Hash, MessageCircle, Calendar, Building2,
  StickyNote, Check, AlertCircle, Loader2, Tag, Plus,
} from 'lucide-react';
import { Avatar } from '@/components/avatar';
import { formatPhone } from '@/lib/format';
import { saveConversationNotes } from './actions';
import { cn } from '@/lib/utils';

interface ConvDetail {
  id: number;
  customer_name: string | null;
  customer_phone: string | null;
  waha_id: string;
  avatar_url: string | null;
  notes: string | null;
  notes_updated_at: string | null;
  first_message_at: string;
  last_message_at: string;
  inbox_id: number;
  store_id: number;
}

interface Props {
  convId: number;
  open: boolean;
  onClose: () => void;
  inboxLabel: string;
  storeSlug: string;
}

export function ContactSheet({ convId, open, onClose, inboxLabel, storeSlug }: Props) {
  const supabase = createClient();
  const [conv, setConv] = useState<ConvDetail | null>(null);
  const [msgCount, setMsgCount] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [savedNotes, setSavedNotes] = useState('');
  const [pending, startTransition] = useTransition();
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  // mounted = mantém no DOM durante animação de saída (300ms)
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Pequeno delay pra garantir que o elemento está no DOM antes de animar
      const t = setTimeout(() => setVisible(true), 10);
      return () => clearTimeout(t);
    } else {
      setVisible(false);
      const t = setTimeout(() => setMounted(false), 300);
      return () => clearTimeout(t);
    }
  }, [open]);

  // Fecha com ESC
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Fetch
  useEffect(() => {
    if (!open || !convId) return;
    let cancelled = false;
    setConv(null); setMsgCount(null); setSaveState('idle');
    (async () => {
      const [{ data: c }, { count }] = await Promise.all([
        supabase.from('conversations')
          .select('id, customer_name, customer_phone, waha_id, avatar_url, notes, notes_updated_at, first_message_at, last_message_at, inbox_id, store_id')
          .eq('id', convId).maybeSingle(),
        supabase.from('messages')
          .select('id', { count: 'exact', head: true }).eq('conversation_id', convId),
      ]);
      if (cancelled) return;
      setConv(c as ConvDetail | null);
      setMsgCount(count ?? 0);
      setNotes(c?.notes ?? '');
      setSavedNotes(c?.notes ?? '');
    })();
    return () => { cancelled = true; };
  }, [convId, open, supabase]);

  function handleSave() {
    setError(null);
    startTransition(async () => {
      setSaveState('saving');
      const res = await saveConversationNotes(convId, notes);
      if (res.ok) {
        setSavedNotes(notes); setSaveState('saved');
        setTimeout(() => setSaveState('idle'), 2000);
      } else {
        setSaveState('error');
        setError(res.error ?? 'Erro ao salvar');
      }
    });
  }

  const dirty = notes !== savedNotes;
  const displayName = conv?.customer_name ?? conv?.customer_phone ?? conv?.waha_id ?? '…';

  // Estilos controlados 100% por style inline — nunca muda a estrutura do DOM
  // (evita hydration mismatch entre SSR e cliente)
  const hideStyle: React.CSSProperties = { display: 'none' };
  const backdropStyle: React.CSSProperties = {
    opacity: visible ? 1 : 0,
    pointerEvents: visible ? 'auto' : 'none',
  };
  const sheetStyle: React.CSSProperties = {
    transform: visible ? 'translateX(0)' : 'translateX(100%)',
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 transition-opacity duration-200"
        style={mounted ? backdropStyle : hideStyle}
        onClick={onClose}
      />

      {/* Sheet */}
      <aside
        className="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[400px] bg-white dark:bg-zinc-950 hairline-l flex flex-col transition-transform duration-300 ease-out"
        style={mounted ? sheetStyle : hideStyle}
      >
        {/* Header */}
        <div className="hairline-b px-4 py-3 flex items-center justify-between shrink-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
            Dados do contato
          </div>
          <button
            type="button" onClick={onClose}
            className="p-2 rounded-lg text-fg-muted hover:text-fg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
            title="Fechar (ESC)"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        {/* Conteúdo */}
        <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6">
          {!conv ? (
            <SkeletonSheet />
          ) : (
            <>
              {/* Identidade */}
              <div className="flex flex-col items-center text-center">
                <Avatar src={conv.avatar_url} name={displayName} size={72} />
                <h2 className="mt-3 text-[18px] font-semibold tracking-tight">{displayName}</h2>
                {conv.customer_phone && (
                  <div className="text-[12.5px] text-fg-muted num mt-0.5">{formatPhone(conv.customer_phone)}</div>
                )}
              </div>

              {/* Atributos */}
              <div className="space-y-px rounded-xl border border-border overflow-hidden bg-surface">
                <Field icon={Building2} label="Loja">{storeSlug}</Field>
                <Field icon={Hash}     label="Caixa">{inboxLabel}</Field>
                <Field icon={MessageCircle} label="Mensagens trocadas">
                  <span className="num">{msgCount ?? '…'}</span>
                </Field>
                <Field icon={Calendar} label="Primeiro contato">
                  <span className="num">{fmtDate(conv.first_message_at)}</span>
                </Field>
                <Field icon={Calendar} label="Última mensagem">
                  <span className="num">{fmtDate(conv.last_message_at)}</span>
                </Field>
                <Field icon={Phone} label="ID WhatsApp">
                  <span className="num text-[11px] truncate">{conv.waha_id}</span>
                </Field>
              </div>

              {/* Etiquetas */}
              <div>
                <h3 className="text-[11px] font-medium text-fg-muted uppercase tracking-[0.12em] flex items-center gap-1.5 mb-2">
                  <Tag size={11} /> Etiquetas
                </h3>
                <SheetLabels convId={conv.id} storeId={conv.store_id} />
              </div>

              {/* Notas */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[11px] font-medium text-fg-muted uppercase tracking-[0.12em] flex items-center gap-1.5">
                    <StickyNote size={11} /> Observações
                  </h3>
                  {conv.notes_updated_at && (
                    <span className="text-[10px] text-fg-subtle num">
                      atualizado {fmtDateTime(conv.notes_updated_at)}
                    </span>
                  )}
                </div>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={6}
                  placeholder="Anote algo sobre esse cliente — preferências, histórico, próximos passos…"
                  className="w-full resize-none rounded-xl border border-border bg-surface px-3.5 py-3 text-[13.5px] placeholder:text-fg-subtle focus:outline-none focus:border-border-strong leading-relaxed"
                />
                {error && (
                  <div className="mt-2 flex items-start gap-2 text-[12px] text-red-700 dark:text-red-300">
                    <AlertCircle size={13} className="mt-0.5 shrink-0" /><span>{error}</span>
                  </div>
                )}
                <div className="mt-3 flex items-center justify-between">
                  <span className={cn('text-[11.5px] transition-colors',
                    saveState === 'saved'  ? 'text-emerald-600 dark:text-emerald-400'
                    : saveState === 'saving' ? 'text-fg-muted'
                    : dirty ? 'text-amber-600 dark:text-amber-400'
                    : 'text-fg-subtle',
                  )}>
                    {saveState === 'saved' ? '✓ salvo' :
                     saveState === 'saving' ? 'salvando…' :
                     dirty ? 'há alterações não salvas' : 'tudo sincronizado'}
                  </span>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={!dirty || pending}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium transition-all',
                      dirty
                        ? 'bg-ink-950 dark:bg-white text-white dark:text-ink-950 hover:opacity-90'
                        : 'bg-surface-muted text-fg-subtle cursor-not-allowed',
                    )}
                  >
                    {saveState === 'saving'
                      ? <><Loader2 size={12} className="animate-spin" /> Salvando</>
                      : <><Check size={12} /> Salvar</>}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

interface SheetLabelItem {
  id: string;
  name: string;
  color: string;
  owner_user_id: string | null;
}

function SheetLabels({ convId, storeId }: { convId: number; storeId: number }) {
  const supabase = createClient();
  const [labels, setLabels] = useState<SheetLabelItem[]>([]);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setExpanded(false);
    (async () => {
      // RLS filtra: gerais da loja + pessoais do próprio usuário
      const [{ data: lbls }, { data: cl }] = await Promise.all([
        supabase.from('labels')
          .select('id, name, color, owner_user_id')
          .eq('store_id', storeId)
          .order('created_at'),
        supabase.from('conversation_labels')
          .select('label_id')
          .eq('conversation_id', convId),
      ]);
      if (cancelled) return;
      setLabels((lbls ?? []) as SheetLabelItem[]);
      setApplied(new Set(((cl ?? []) as { label_id: string }[]).map(r => r.label_id)));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [convId, storeId, supabase]);

  async function toggle(labelId: string) {
    if (applied.has(labelId)) {
      setApplied(prev => { const s = new Set(prev); s.delete(labelId); return s; });
      await supabase.from('conversation_labels')
        .delete().eq('conversation_id', convId).eq('label_id', labelId);
    } else {
      setApplied(prev => new Set([...prev, labelId]));
      await supabase.from('conversation_labels')
        .insert({ conversation_id: convId, label_id: labelId });
    }
  }

  if (loading) return <div className="h-8 rounded-xl bg-surface-muted animate-pulse" />;

  const appliedLabels = labels.filter(l => applied.has(l.id));

  return (
    <div className="space-y-2">
      {/* Chips das aplicadas + botão adicionar */}
      <div className="flex flex-wrap items-center gap-1.5">
        {appliedLabels.map(l => (
          <span key={l.id}
            className="inline-flex items-center gap-1.5 pl-2 pr-1 py-0.5 rounded-full border border-border bg-surface text-[12px]">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
            {l.name}
            <button type="button" onClick={() => toggle(l.id)}
              className="p-0.5 rounded-full text-fg-subtle hover:text-fg hover:bg-surface-muted transition-colors"
              title="Remover etiqueta">
              <X size={11} strokeWidth={2} />
            </button>
          </span>
        ))}
        <button type="button" onClick={() => setExpanded(e => !e)}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-dashed border-border text-[12px] text-fg-muted hover:text-fg hover:border-border-strong transition-colors">
          <Plus size={11} strokeWidth={2} />
          {appliedLabels.length === 0 ? 'Adicionar etiqueta' : 'Adicionar'}
        </button>
      </div>

      {/* Lista expandida pra marcar/desmarcar */}
      {expanded && (
        <div className="rounded-xl border border-border overflow-hidden bg-surface divide-y divide-border">
          {labels.length === 0 ? (
            <div className="px-3 py-3 text-[12.5px] text-fg-muted text-center">
              Nenhuma etiqueta criada — crie na página Etiquetas.
            </div>
          ) : labels.map(l => (
            <button key={l.id} type="button" onClick={() => toggle(l.id)}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-surface-muted transition-colors text-left">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: l.color }} />
              <span className="text-[13px] flex-1 truncate">
                {l.name}
                {l.owner_user_id && (
                  <span className="ml-2 text-[9.5px] uppercase tracking-wider text-fg-subtle">pessoal</span>
                )}
              </span>
              {applied.has(l.id) && <Check size={12} className="shrink-0" strokeWidth={2.5} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({
  icon: Icon, label, children,
}: {
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  label: string; children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-surface">
      <Icon size={14} strokeWidth={1.75} className="text-fg-subtle shrink-0" />
      <span className="text-[11.5px] text-fg-muted uppercase tracking-wider w-28 shrink-0">{label}</span>
      <span className="text-[13px] text-fg font-medium truncate flex-1 text-right">{children}</span>
    </div>
  );
}

function SkeletonSheet() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="flex flex-col items-center gap-3">
        <div className="w-[72px] h-[72px] rounded-full bg-surface-muted" />
        <div className="h-4 w-32 bg-surface-muted rounded" />
        <div className="h-3 w-24 bg-surface-muted rounded" />
      </div>
      <div className="h-40 rounded-xl bg-surface-muted" />
      <div className="h-32 rounded-xl bg-surface-muted" />
    </div>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit' }).replace('.', '');
}
function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
