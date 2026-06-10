'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Building2, AlertCircle, CheckCircle2, Trash2, RefreshCw,
  Sparkles, Headset, User as UserIcon,
} from 'lucide-react';
import { inviteUser, updateUser, deleteUser, resendInvite } from './actions';

export interface InboxOption {
  id: number;
  storeId: number;
  storeSlug: string;
  kind: 'ai' | 'support' | 'vendor';
  displayName: string;
}

export interface InboxValue {
  inboxId: number;
  canSend: boolean;
  canManage: boolean;
}

interface Props {
  inboxOptions: InboxOption[];   // todas as inboxes do sistema
  mode: 'create' | 'edit';
  isSelf?: boolean;
  initial?: {
    id: string;
    email: string;
    name: string;
    isAdmin: boolean;
    active: boolean;
    inboxes: InboxValue[];
  };
}

function iconForKind(kind: InboxOption['kind']) {
  if (kind === 'ai')      return Sparkles;
  if (kind === 'support') return Headset;
  return UserIcon;
}

function labelForKind(kind: InboxOption['kind']) {
  if (kind === 'ai')      return 'ia';
  if (kind === 'support') return 'suporte';
  return 'vendedor';
}

export default function UserForm({ inboxOptions, mode, isSelf = false, initial }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [name, setName]   = useState(initial?.name ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [isAdmin, setAdmin] = useState(initial?.isAdmin ?? false);
  const [active, setActive] = useState(initial?.active ?? true);
  const [inboxes, setInboxes] = useState<InboxValue[]>(initial?.inboxes ?? []);

  const [error, setError]     = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // agrupa as opções por loja
  const byStore = new Map<number, { slug: string; items: InboxOption[] }>();
  for (const o of inboxOptions) {
    if (!byStore.has(o.storeId)) byStore.set(o.storeId, { slug: o.storeSlug, items: [] });
    byStore.get(o.storeId)!.items.push(o);
  }

  function toggleInbox(inboxId: number, checked: boolean) {
    setInboxes(prev => {
      if (checked) {
        if (prev.find(i => i.inboxId === inboxId)) return prev;
        return [...prev, { inboxId, canSend: true, canManage: false }];
      }
      return prev.filter(i => i.inboxId !== inboxId);
    });
  }

  function patchInbox(inboxId: number, patch: Partial<InboxValue>) {
    setInboxes(prev => prev.map(i => i.inboxId === inboxId ? { ...i, ...patch } : i));
  }

  function toggleAllInStore(storeId: number, allChecked: boolean) {
    const items = byStore.get(storeId)?.items ?? [];
    if (allChecked) {
      // desmarca todos
      const ids = new Set(items.map(i => i.id));
      setInboxes(prev => prev.filter(i => !ids.has(i.inboxId)));
    } else {
      // marca todos
      setInboxes(prev => {
        const existing = new Set(prev.map(i => i.inboxId));
        const adds = items
          .filter(i => !existing.has(i.id))
          .map(i => ({ inboxId: i.id, canSend: true, canManage: false }));
        return [...prev, ...adds];
      });
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSuccess(null);
    startTransition(async () => {
      const res = mode === 'create'
        ? await inviteUser({ email, name, inboxes })
        : await updateUser({ id: initial!.id, name, isAdmin, active, inboxes });
      if (!res.ok) { setError(res.error ?? 'Erro'); return; }
      setSuccess(mode === 'create'
        ? 'Convite enviado! O usuário recebeu um e-mail para definir a senha.'
        : 'Alterações salvas.');
      if (mode === 'create') setTimeout(() => router.push('/admin/usuarios'), 1200);
      else router.refresh();
    });
  }

  async function handleDelete() {
    if (!initial) return;
    if (!confirm(`Apagar ${initial.name}? Esta ação não pode ser desfeita.`)) return;
    startTransition(async () => {
      const res = await deleteUser(initial.id);
      if (!res.ok) { setError(res.error ?? 'Erro'); return; }
      router.push('/admin/usuarios');
    });
  }

  async function handleResend() {
    if (!initial) return;
    startTransition(async () => {
      const res = await resendInvite(initial.email);
      if (!res.ok) setError(res.error ?? 'Erro'); else setSuccess('Convite reenviado.');
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* DADOS */}
      <section>
        <h2 className="text-[10px] uppercase tracking-[0.14em] text-fg-subtle mb-3">Dados</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-[11px] font-medium text-fg-muted uppercase tracking-[0.1em] mb-1.5">Nome</label>
            <Input value={name} onChange={e => setName(e.target.value)} required autoFocus={mode === 'create'} />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-fg-muted uppercase tracking-[0.1em] mb-1.5">E-mail</label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required disabled={mode === 'edit'} />
            {mode === 'edit' && <p className="text-[11px] text-fg-subtle mt-1.5">E-mail não pode ser alterado.</p>}
          </div>
        </div>
      </section>

      {/* PERFIL */}
      {mode === 'edit' && (
        <section>
          <h2 className="text-[10px] uppercase tracking-[0.14em] text-fg-subtle mb-3">Perfil</h2>
          <div className="space-y-2">
            <label className="flex items-center gap-3 p-3 rounded-xl border border-border bg-surface cursor-pointer hover:border-border-strong transition-colors">
              <input type="checkbox" checked={isAdmin} onChange={e => setAdmin(e.target.checked)}
                     disabled={isSelf} className="accent-fg w-4 h-4" />
              <div className="flex-1">
                <div className="text-[13.5px] font-medium">Administrador</div>
                <div className="text-[11.5px] text-fg-muted">Acessa e gerencia todas as caixas e configurações</div>
              </div>
            </label>
            <label className="flex items-center gap-3 p-3 rounded-xl border border-border bg-surface cursor-pointer hover:border-border-strong transition-colors">
              <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)}
                     disabled={isSelf} className="accent-fg w-4 h-4" />
              <div className="flex-1">
                <div className="text-[13.5px] font-medium">Ativo</div>
                <div className="text-[11.5px] text-fg-muted">Desativar bloqueia o login sem apagar o histórico</div>
              </div>
            </label>
          </div>
        </section>
      )}

      {/* CAIXAS — agrupadas por loja */}
      {!isAdmin && (
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-[10px] uppercase tracking-[0.14em] text-fg-subtle">Caixas de entrada</h2>
            <span className="text-[11px] text-fg-subtle num">{inboxes.length} marcadas</span>
          </div>

          {Array.from(byStore.entries()).map(([storeId, group]) => {
            const items = group.items;
            const allChecked = items.every(i => inboxes.some(v => v.inboxId === i.id));
            const someChecked = items.some(i => inboxes.some(v => v.inboxId === i.id));
            return (
              <div key={storeId} className="rounded-xl border border-border bg-surface overflow-hidden mb-3">
                <div className="flex items-center justify-between gap-2 px-4 py-2.5 hairline-b bg-surface-muted/40">
                  <div className="flex items-center gap-2">
                    <Building2 size={14} className="text-fg-muted" />
                    <span className="text-[12.5px] font-medium uppercase tracking-wide">{group.slug}</span>
                  </div>
                  <button type="button" onClick={() => toggleAllInStore(storeId, allChecked)}
                          className="text-[11px] text-fg-subtle hover:text-fg transition-colors">
                    {allChecked ? 'Desmarcar' : someChecked ? 'Marcar todos' : 'Marcar todos'}
                  </button>
                </div>

                <div className="divide-y divide-border">
                  {items.map(opt => {
                    const ib = inboxes.find(i => i.inboxId === opt.id);
                    const checked = !!ib;
                    const Icon = iconForKind(opt.kind);
                    return (
                      <div key={opt.id}>
                        <label className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-surface-muted/40 transition-colors">
                          <input type="checkbox" checked={checked}
                                 onChange={e => toggleInbox(opt.id, e.target.checked)}
                                 className="accent-fg w-4 h-4" />
                          <Icon size={14} className="text-fg-muted" strokeWidth={1.75} />
                          <span className="text-[13px] font-medium flex-1">{opt.displayName}</span>
                          <span className="text-[10px] uppercase tracking-wider text-fg-subtle">{labelForKind(opt.kind)}</span>
                        </label>
                        {checked && (
                          <div className="px-12 pb-2.5 pt-1 flex gap-4">
                            <label className="flex items-center gap-2 text-[11.5px] cursor-pointer">
                              <input type="checkbox" checked={ib!.canSend}
                                     onChange={e => patchInbox(opt.id, { canSend: e.target.checked })}
                                     className="accent-fg w-3.5 h-3.5" />
                              <span>Enviar</span>
                            </label>
                            <label className="flex items-center gap-2 text-[11.5px] cursor-pointer">
                              <input type="checkbox" checked={ib!.canManage}
                                     onChange={e => patchInbox(opt.id, { canManage: e.target.checked })}
                                     className="accent-fg w-3.5 h-3.5" />
                              <span>Gerenciar</span>
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {error && (
        <div className="flex items-start gap-2 text-[13px] text-red-700 dark:text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-3.5 py-2.5">
          <AlertCircle size={15} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2 text-[13px] text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3.5 py-2.5">
          <CheckCircle2 size={15} className="mt-0.5 shrink-0" /><span>{success}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-4 border-t border-border">
        {mode === 'edit' && !isSelf ? (
          <div className="flex gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={handleResend} disabled={pending}>
              <RefreshCw size={13} /> Reenviar convite
            </Button>
            <Button type="button" variant="danger" size="sm" onClick={handleDelete} disabled={pending}>
              <Trash2 size={13} /> Apagar
            </Button>
          </div>
        ) : <div />}
        <Button type="submit" disabled={pending}>
          {pending ? 'Salvando…' : mode === 'create' ? 'Convidar' : 'Salvar alterações'}
        </Button>
      </div>
    </form>
  );
}
