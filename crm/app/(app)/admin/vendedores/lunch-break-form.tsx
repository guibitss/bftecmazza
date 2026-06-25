'use client';

import { useState, useTransition } from 'react';
import { saveLunchBreak } from './actions';

interface Props {
  vendorId: number;
  lunchStart: string;
  lunchEnd: string;
}

export function LunchBreakForm({ vendorId, lunchStart, lunchEnd }: Props) {
  const [start, setStart] = useState(lunchStart ? lunchStart.slice(0, 5) : '');
  const [end,   setEnd]   = useState(lunchEnd   ? lunchEnd.slice(0, 5)   : '');
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState('');

  function handleSave() {
    if ((start && !end) || (!start && end)) {
      setMsg('Preencha início e fim ou deixe ambos vazios.');
      return;
    }
    if (start && end && start >= end) {
      setMsg('O início deve ser antes do fim.');
      return;
    }
    setMsg('');
    startTransition(async () => {
      const res = await saveLunchBreak(vendorId, start, end);
      setMsg(res.ok ? 'Salvo!' : (res.error ?? 'Erro ao salvar.'));
      setTimeout(() => setMsg(''), 2500);
    });
  }

  function handleClear() {
    setStart('');
    setEnd('');
    setMsg('');
    startTransition(async () => {
      const res = await saveLunchBreak(vendorId, '', '');
      setMsg(res.ok ? 'Removido!' : (res.error ?? 'Erro.'));
      setTimeout(() => setMsg(''), 2500);
    });
  }

  return (
    <div className="flex items-center gap-3 shrink-0">
      <div className="flex items-center gap-2">
        <input
          type="time"
          value={start}
          onChange={e => setStart(e.target.value)}
          className="h-8 px-2 rounded-lg border border-border bg-surface text-[13px] text-fg focus:outline-none focus:border-border-strong w-[110px]"
          placeholder="início"
        />
        <span className="text-[12px] text-fg-subtle">–</span>
        <input
          type="time"
          value={end}
          onChange={e => setEnd(e.target.value)}
          className="h-8 px-2 rounded-lg border border-border bg-surface text-[13px] text-fg focus:outline-none focus:border-border-strong w-[110px]"
          placeholder="fim"
        />
      </div>

      <button
        onClick={handleSave}
        disabled={isPending}
        className="h-8 px-3 rounded-lg bg-fg text-bg text-[12px] font-medium transition-opacity disabled:opacity-50 hover:opacity-80"
      >
        Salvar
      </button>

      {(start || end) && (
        <button
          onClick={handleClear}
          disabled={isPending}
          className="h-8 px-3 rounded-lg border border-border text-[12px] text-fg-muted hover:text-fg hover:border-border-strong transition-colors disabled:opacity-50"
        >
          Limpar
        </button>
      )}

      {msg && (
        <span className={`text-[12px] ${msg === 'Salvo!' || msg === 'Removido!' ? 'text-green-500' : 'text-red-500'}`}>
          {msg}
        </span>
      )}
    </div>
  );
}
