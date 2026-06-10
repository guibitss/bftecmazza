'use client';

import { useState, useTransition } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Plus, Calendar, AlertCircle, Phone, Clock,
  Trash2, Check, Pencil, X,
} from 'lucide-react';
import { createTratativa, cancelTratativa, setMyWhatsapp } from './actions';
import { cn } from '@/lib/utils';

interface Store { id: number; slug: string }
interface Tratativa {
  id: number;
  customerName: string;
  customerPhone: string;
  notes: string | null;
  sendAt: string;
  status: string;
  sentAt: string | null;
  errorMsg: string | null;
  storeSlug: string;
}
interface Props {
  stores: Store[];
  tratativas: Tratativa[];
  currentWhatsapp: string | null;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
  });
}
function fmtPhone(n: string): string {
  const d = n.replace(/\D/g, '');
  if (d.length <= 12) return '+' + d;
  const m = d.match(/^(\d{2})(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+${m[1]} (${m[2]}) ${m[3]}-${m[4]}` : '+' + d;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { txt: string; cls: string }> = {
    pending:   { txt: 'aguardando', cls: 'text-amber-700 dark:text-amber-300 border-amber-500/30 bg-amber-500/10' },
    sent:      { txt: 'enviado',    cls: 'text-emerald-700 dark:text-emerald-300 border-emerald-500/30 bg-emerald-500/10' },
    failed:    { txt: 'falhou',     cls: 'text-red-700 dark:text-red-300 border-red-500/30 bg-red-500/10' },
    cancelled: { txt: 'cancelado',  cls: 'text-fg-subtle border-border bg-surface-muted' },
  };
  const v = map[status] ?? map.pending;
  return (
    <span className={cn('text-[10.5px] uppercase tracking-wider px-2 py-0.5 rounded-full border', v.cls)}>
      {v.txt}
    </span>
  );
}

export default function TratativasClient({ stores, tratativas, currentWhatsapp }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [storeId, setStoreId]             = useState<number>(stores[0]?.id ?? 0);
  const [customerName, setCustomerName]   = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [notes, setNotes]                 = useState('');
  const [sendAt, setSendAt]               = useState('');

  const [whatsapp, setWhatsapp] = useState(currentWhatsapp ?? '');
  const [editingWhatsapp, setEditingWhatsapp] = useState(!currentWhatsapp);

  function handleCreate(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    startTransition(async () => {
      const res = await createTratativa({
        storeId, customerName, customerPhone, notes,
        sendAt: new Date(sendAt).toISOString(),
      });
      if (!res.ok) { setError(res.error ?? 'Erro'); return; }
      setCustomerName(''); setCustomerPhone(''); setNotes(''); setSendAt('');
    });
  }
  function handleCancel(id: number) {
    if (!confirm('Cancelar essa tratativa?')) return;
    startTransition(async () => { await cancelTratativa(id); });
  }
  const [whatsappFeedback, setWhatsappFeedback] = useState<string | null>(null);
  function handleSaveWhatsapp() {
    setError(null); setWhatsappFeedback(null);
    startTransition(async () => {
      const res = await setMyWhatsapp(whatsapp);
      if (!res.ok) { setError(res.error ?? 'Erro'); return; }
      if (res.normalized && res.normalized !== whatsapp.replace(/\D/g, '')) {
        setWhatsappFeedback(`Salvo como ${res.normalized} (ajustado pelo WhatsApp)`);
        setWhatsapp(res.normalized);
      }
      setEditingWhatsapp(false);
    });
  }

  const upcoming = tratativas.filter(t => t.status === 'pending');
  const history  = tratativas.filter(t => t.status !== 'pending');

  return (
    <div className="space-y-10">
      {/* ───────── WHATSAPP BOX (compacto, 1 linha) ───────── */}
      <Card className="px-5 py-3.5">
        <div className="flex items-center gap-4">
          <div className="w-9 h-9 rounded-lg border border-border bg-surface-muted grid place-items-center text-fg-muted shrink-0">
            <Phone size={15} strokeWidth={1.75} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium leading-tight">Seu WhatsApp para receber lembretes</div>
            {!editingWhatsapp && currentWhatsapp ? (
              <div className="text-[12.5px] text-fg-muted num leading-tight mt-0.5">
                {fmtPhone(currentWhatsapp)}
              </div>
            ) : (
              <div className="text-[11px] text-fg-subtle leading-tight mt-0.5">
                Disparado pela IA da loja escolhida na tratativa
              </div>
            )}
          </div>
          {whatsappFeedback && (
            <div className="text-[11px] text-emerald-600 dark:text-emerald-400 text-right max-w-[200px] leading-tight">
              {whatsappFeedback}
            </div>
          )}
          {!editingWhatsapp ? (
            <button type="button" onClick={() => setEditingWhatsapp(true)}
              className="inline-flex items-center gap-1.5 text-[11.5px] text-fg-muted hover:text-fg transition-colors px-2.5 py-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800">
              <Pencil size={11} /> {currentWhatsapp ? 'alterar' : 'cadastrar'}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <input value={whatsapp} onChange={e => setWhatsapp(e.target.value)}
                placeholder="554198765432"
                className="h-9 w-44 rounded-lg border border-border bg-surface px-3 text-[13px] num focus:outline-none focus:border-border-strong" />
              <Button type="button" size="sm" onClick={handleSaveWhatsapp} disabled={pending}>
                <Check size={13} /> Salvar
              </Button>
              {currentWhatsapp && (
                <button type="button" onClick={() => { setEditingWhatsapp(false); setWhatsapp(currentWhatsapp); }}
                  className="p-1.5 rounded-lg text-fg-muted hover:text-fg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors">
                  <X size={13} />
                </button>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* ───────── FORM NOVA TRATATIVA ───────── */}
      <Card className="overflow-hidden p-0">
        <div className="px-6 pt-6 pb-4 hairline-b">
          <h3 className="text-[15px] font-semibold tracking-tight">Nova tratativa</h3>
          <p className="text-[12px] text-fg-muted mt-0.5">
            Programe um lembrete pra você ligar ou atender o cliente em data futura.
          </p>
        </div>
        <form onSubmit={handleCreate} className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Loja */}
            <div className="space-y-1.5">
              <label className="text-[10.5px] font-medium text-fg-muted uppercase tracking-[0.12em]">Loja</label>
              {stores.length === 1 ? (
                <div className="h-11 flex items-center px-3.5 rounded-lg border border-border bg-surface-muted text-[14px] font-medium">
                  {stores[0].slug}
                </div>
              ) : (
                <select value={storeId} onChange={e => setStoreId(Number(e.target.value))}
                  className="h-11 w-full rounded-lg border border-border bg-surface px-3.5 text-[14px] focus:outline-none focus:border-border-strong">
                  {stores.map(s => <option key={s.id} value={s.id}>{s.slug}</option>)}
                </select>
              )}
            </div>

            {/* Data/hora */}
            <div className="space-y-1.5">
              <label className="text-[10.5px] font-medium text-fg-muted uppercase tracking-[0.12em]">Quando avisar</label>
              <Input type="datetime-local" value={sendAt} onChange={e => setSendAt(e.target.value)} required className="h-11" />
            </div>

            {/* Nome */}
            <div className="space-y-1.5">
              <label className="text-[10.5px] font-medium text-fg-muted uppercase tracking-[0.12em]">Nome do cliente</label>
              <Input value={customerName} onChange={e => setCustomerName(e.target.value)} required placeholder="João Silva" className="h-11" />
            </div>

            {/* Phone */}
            <div className="space-y-1.5">
              <label className="text-[10.5px] font-medium text-fg-muted uppercase tracking-[0.12em]">WhatsApp do cliente</label>
              <Input value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} required placeholder="(44) 99999-0000" className="h-11" />
            </div>
          </div>

          {/* Notes — largura total */}
          <div className="space-y-1.5">
            <label className="text-[10.5px] font-medium text-fg-muted uppercase tracking-[0.12em]">Observação</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              placeholder="Ex: ligar para falar do iPhone 17 256GB"
              className="w-full resize-none rounded-lg border border-border bg-surface px-3.5 py-2.5 text-[14px] placeholder:text-fg-subtle focus:outline-none focus:border-border-strong" />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-[13px] text-red-700 dark:text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg px-3.5 py-2.5">
              <AlertCircle size={15} className="mt-0.5 shrink-0" /><span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2 hairline-t -mx-6 px-6 pt-4">
            <Button type="submit" disabled={pending}>
              <Plus size={14} /> {pending ? 'Programando…' : 'Programar lembrete'}
            </Button>
          </div>
        </form>
      </Card>

      {/* ───────── LISTA: PRÓXIMOS ───────── */}
      {upcoming.length > 0 && (
        <section>
          <SectionHeader title="Próximos" count={upcoming.length} />
          <ul className="space-y-2.5">
            {upcoming.map(t => (
              <TratativaItem key={t.id} t={t} onCancel={handleCancel} pending={pending} />
            ))}
          </ul>
        </section>
      )}

      {/* ───────── LISTA: HISTÓRICO ───────── */}
      <section>
        <SectionHeader title="Histórico" count={history.length} />
        {history.length === 0 && upcoming.length === 0 ? (
          <Card className="p-12 text-center">
            <Calendar size={28} className="mx-auto text-fg-subtle" strokeWidth={1.5} />
            <p className="text-fg-muted text-[13px] mt-3">Nenhuma tratativa programada ainda.</p>
          </Card>
        ) : history.length === 0 ? null : (
          <ul className="space-y-2.5">
            {history.map(t => (
              <TratativaItem key={t.id} t={t} onCancel={handleCancel} pending={pending} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <h2 className="text-[11px] font-medium uppercase tracking-[0.18em] text-fg-subtle">{title}</h2>
      <span className="text-[11px] text-fg-subtle num">{count}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

function TratativaItem({
  t, onCancel, pending,
}: {
  t: Tratativa;
  onCancel: (id: number) => void;
  pending: boolean;
}) {
  return (
    <li>
      <Card className="px-5 py-4">
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-lg border border-border bg-surface-muted grid place-items-center text-fg-muted shrink-0">
            <Clock size={15} strokeWidth={1.75} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[14px] font-medium">{t.customerName}</span>
              <span className="text-[11.5px] text-fg-muted num">· {fmtPhone(t.customerPhone)}</span>
              <StatusBadge status={t.status} />
            </div>
            <div className="text-[11.5px] text-fg-muted mt-1.5 flex items-center gap-3 flex-wrap">
              <span className="num">{fmtDateTime(t.sendAt)}</span>
              <span>·</span>
              <span className="uppercase tracking-wider text-[10.5px]">{t.storeSlug}</span>
            </div>
            {t.notes && (
              <p className="text-[12.5px] text-fg-muted mt-2 leading-relaxed line-clamp-2">{t.notes}</p>
            )}
            {t.errorMsg && (
              <p className="text-[11px] text-red-600 dark:text-red-400 mt-1.5">{t.errorMsg}</p>
            )}
          </div>

          {t.status === 'pending' && (
            <button onClick={() => onCancel(t.id)} disabled={pending}
              title="Cancelar"
              className="p-2 rounded-lg text-fg-muted hover:text-red-600 dark:hover:text-red-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shrink-0">
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </Card>
    </li>
  );
}
