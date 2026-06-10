'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, AlertCircle, CheckCircle2, X, ShieldUser, Sparkles, Headset, User as UserIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { approveUser, rejectUser } from '../actions';

export interface InboxOption {
  id: number;
  storeId: number;
  storeSlug: string;
  kind: 'ai' | 'support' | 'vendor';
  displayName: string;
}
export interface StoreOption {
  id: number;
  slug: string;
}

interface Props {
  userId: string;
  userName: string;
  stores: StoreOption[];
  inboxOptions: InboxOption[];
}

interface InboxValue {
  inboxId: number;
  canSend: boolean;
  canManage: boolean;
}

function iconForKind(kind: InboxOption['kind']) {
  if (kind === 'ai')      return Sparkles;
  if (kind === 'support') return Headset;
  return UserIcon;
}

export default function ReviewForm({ userId, userName, stores, inboxOptions }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [managerOfStoreId, setManagerOfStoreId] = useState<number | null>(null);
  const [inboxes, setInboxes] = useState<InboxValue[]>([]);

  function toggleInbox(id: number, checked: boolean) {
    setInboxes(prev => checked
      ? (prev.find(i => i.inboxId === id) ? prev : [...prev, { inboxId: id, canSend: true, canManage: false }])
      : prev.filter(i => i.inboxId !== id),
    );
  }
  function patchInbox(id: number, patch: Partial<InboxValue>) {
    setInboxes(prev => prev.map(i => i.inboxId === id ? { ...i, ...patch } : i));
  }

  // Quando vira gerente de uma loja, sugere acesso a todas as caixas dela
  function setManager(storeId: number | null) {
    setManagerOfStoreId(storeId);
    if (storeId === null) return;
    setInboxes(prev => {
      const next = [...prev];
      for (const ib of inboxOptions.filter(i => i.storeId === storeId)) {
        if (!next.find(x => x.inboxId === ib.id)) {
          next.push({ inboxId: ib.id, canSend: true, canManage: true });
        } else {
          const idx = next.findIndex(x => x.inboxId === ib.id);
          next[idx] = { ...next[idx], canManage: true };
        }
      }
      return next;
    });
  }

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const res = await approveUser({ userId, managerOfStoreId, inboxes });
      if (!res.ok) { setError(res.error ?? 'Erro'); return; }
      router.push('/admin/solicitacoes');
    });
  }
  function handleReject() {
    if (!confirm(`Negar acesso a ${userName}?`)) return;
    setError(null);
    startTransition(async () => {
      const res = await rejectUser(userId);
      if (!res.ok) { setError(res.error ?? 'Erro'); return; }
      router.push('/admin/solicitacoes');
    });
  }

  // Agrupa caixas por loja
  const byStore = new Map<number, { slug: string; inboxes: InboxOption[] }>();
  for (const ib of inboxOptions) {
    if (!byStore.has(ib.storeId)) byStore.set(ib.storeId, { slug: ib.storeSlug, inboxes: [] });
    byStore.get(ib.storeId)!.inboxes.push(ib);
  }

  return (
    <div className="space-y-8">
      {/* GERENTE DE LOJA */}
      <section>
        <h2 className="text-[10px] uppercase tracking-[0.14em] text-fg-subtle mb-3">Perfil de gerente</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className={`relative p-3 rounded-xl border cursor-pointer transition-all ${
            managerOfStoreId === null
              ? 'border-fg bg-surface-muted'
              : 'border-border hover:border-border-strong bg-surface'
          }`}>
            <input
              type="radio" name="manager" checked={managerOfStoreId === null}
              onChange={() => setManager(null)} className="absolute opacity-0"
            />
            <div className="text-[13.5px] font-medium">Não é gerente</div>
            <div className="text-[11.5px] text-fg-muted mt-0.5">Acesso só às caixas marcadas abaixo</div>
          </label>
          {stores.map(s => (
            <label key={s.id} className={`relative p-3 rounded-xl border cursor-pointer transition-all ${
              managerOfStoreId === s.id
                ? 'border-fg bg-surface-muted'
                : 'border-border hover:border-border-strong bg-surface'
            }`}>
              <input
                type="radio" name="manager" checked={managerOfStoreId === s.id}
                onChange={() => setManager(s.id)} className="absolute opacity-0"
              />
              <div className="flex items-center gap-1.5">
                <ShieldUser size={13} />
                <span className="text-[13.5px] font-medium">Gerente de {s.slug}</span>
              </div>
              <div className="text-[11.5px] text-fg-muted mt-0.5">Vê métricas + dados de toda a loja</div>
            </label>
          ))}
        </div>
      </section>

      {/* CAIXAS */}
      <section>
        <h2 className="text-[10px] uppercase tracking-[0.14em] text-fg-subtle mb-3">Caixas que pode operar</h2>
        <div className="space-y-3">
          {Array.from(byStore.entries()).map(([storeId, group]) => (
            <div key={storeId} className="rounded-xl border border-border bg-surface overflow-hidden">
              <div className="px-3 py-2 hairline-b text-[10.5px] uppercase tracking-[0.14em] text-fg-muted bg-surface-muted/40">
                {group.slug}
                {managerOfStoreId === storeId && (
                  <span className="ml-2 inline-flex items-center gap-1 text-[9.5px] font-medium text-fg">
                    <ShieldUser size={10} /> gerente
                  </span>
                )}
              </div>
              <ul className="divide-y divide-border">
                {group.inboxes.map(ib => {
                  const Icon = iconForKind(ib.kind);
                  const access = inboxes.find(i => i.inboxId === ib.id);
                  const checked = !!access;
                  return (
                    <li key={ib.id}>
                      <label className="flex items-center gap-3 p-3 cursor-pointer hover:bg-surface-muted/40 transition-colors">
                        <input
                          type="checkbox" checked={checked}
                          onChange={e => toggleInbox(ib.id, e.target.checked)}
                          className="accent-fg w-4 h-4"
                        />
                        <Icon size={14} className="text-fg-muted" />
                        <span className="text-[13px] font-medium flex-1">{ib.displayName}</span>
                        {checked && (
                          <div className="flex gap-2 text-[11px]">
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input type="checkbox" checked={access!.canSend}
                                onChange={e => patchInbox(ib.id, { canSend: e.target.checked })}
                                className="accent-fg w-3 h-3" />
                              <span>enviar</span>
                            </label>
                            <label className="flex items-center gap-1 cursor-pointer">
                              <input type="checkbox" checked={access!.canManage}
                                onChange={e => patchInbox(ib.id, { canManage: e.target.checked })}
                                className="accent-fg w-3 h-3" />
                              <span>gerenciar</span>
                            </label>
                          </div>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {error && (
        <div className="flex items-start gap-2 text-[13px] text-red-700 dark:text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-3.5 py-2.5">
          <AlertCircle size={15} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-4 border-t border-border">
        <Button type="button" variant="danger" size="md" onClick={handleReject} disabled={pending}>
          <X size={14} /> Negar acesso
        </Button>
        <Button type="button" onClick={handleApprove} disabled={pending}>
          <CheckCircle2 size={14} /> {pending ? 'Aprovando…' : 'Aprovar acesso'}
        </Button>
      </div>
    </div>
  );
}
