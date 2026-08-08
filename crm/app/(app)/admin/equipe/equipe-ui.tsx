'use client';

import { useState, useTransition } from 'react';
import { UserPlus, Trash2, Plus, Check } from 'lucide-react';
import { addInternalContact, removeInternalContact } from './actions';
import { phoneDisplay } from '@/lib/phone';

// ---- Formulário de cadastro manual --------------------------------------
export function AddForm() {
  const [phone, setPhone] = useState('');
  const [nome, setNome] = useState('');
  const [motivo, setMotivo] = useState('');
  const [msg, setMsg] = useState('');
  const [pending, start] = useTransition();

  function submit() {
    if (!phone.trim()) { setMsg('Informe o telefone.'); return; }
    setMsg('');
    start(async () => {
      const r = await addInternalContact(phone, nome, motivo);
      if (r.ok) {
        setMsg(`Cadastrado.${r.remarcadas ? ` ${r.remarcadas} conversa(s) saíram das métricas.` : ''}`);
        setPhone(''); setNome(''); setMotivo('');
      } else {
        setMsg(r.error ?? 'Erro ao cadastrar.');
      }
      setTimeout(() => setMsg(''), 4000);
    });
  }

  return (
    <div className="space-y-3">
      <div className="grid sm:grid-cols-3 gap-2.5">
        <input
          value={phone} onChange={e => setPhone(e.target.value)}
          placeholder="Telefone (ex: 44 99999-9999)"
          className="h-10 px-3 rounded-lg border border-border bg-surface text-[13px] focus:outline-none focus:border-border-strong"
        />
        <input
          value={nome} onChange={e => setNome(e.target.value)}
          placeholder="Nome (opcional)"
          className="h-10 px-3 rounded-lg border border-border bg-surface text-[13px] focus:outline-none focus:border-border-strong"
        />
        <input
          value={motivo} onChange={e => setMotivo(e.target.value)}
          placeholder="Motivo (ex: sócio, estoque)"
          className="h-10 px-3 rounded-lg border border-border bg-surface text-[13px] focus:outline-none focus:border-border-strong"
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={submit} disabled={pending}
          className="h-9 px-4 rounded-lg bg-ink-950 dark:bg-white text-white dark:text-ink-950 text-[13px] font-medium flex items-center gap-1.5 transition-opacity disabled:opacity-50 hover:opacity-80"
        >
          <UserPlus size={15} /> Adicionar à equipe
        </button>
        {msg && <span className="text-[12px] text-fg-muted">{msg}</span>}
      </div>
    </div>
  );
}

// ---- Botão de "marcar sugestão como interno" ----------------------------
export function SuggestionRow({ phone, name }: { phone: string; name: string | null }) {
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);

  function add() {
    start(async () => {
      const r = await addInternalContact(phone, name ?? '', 'sugerido pelo sistema');
      if (r.ok) setDone(true);
    });
  }

  return (
    <div className="flex items-center justify-between gap-4 py-2.5 px-3 rounded-lg hover:bg-surface-muted/50 transition-colors">
      <div className="min-w-0">
        <div className="text-[13px] font-medium truncate">{name || 'Sem nome'}</div>
        <div className="text-[11.5px] text-fg-subtle num">{phoneDisplay(phone)}</div>
      </div>
      {done ? (
        <span className="text-[12px] text-green-500 flex items-center gap-1 shrink-0"><Check size={14} /> feito</span>
      ) : (
        <button
          onClick={add} disabled={pending}
          className="h-8 px-3 rounded-lg border border-border text-[12px] text-fg-muted hover:text-fg hover:border-border-strong transition-colors disabled:opacity-50 flex items-center gap-1.5 shrink-0"
        >
          <Plus size={13} /> é da equipe
        </button>
      )}
    </div>
  );
}

// ---- Remover contato interno --------------------------------------------
export function RemoveButton({ phoneNorm }: { phoneNorm: string }) {
  const [pending, start] = useTransition();

  function remove() {
    start(async () => { await removeInternalContact(phoneNorm); });
  }

  return (
    <button
      onClick={remove} disabled={pending}
      className="p-2 rounded-lg text-fg-subtle hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50 shrink-0"
      aria-label="Remover"
    >
      <Trash2 size={15} />
    </button>
  );
}
