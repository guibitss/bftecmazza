'use client';

import { useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';

const PRESETS = [
  { p: 'hoje', label: 'Hoje' },
  { p: '7',    label: 'Semana' },
  { p: '30',   label: 'Mês' },
];

export function PeriodFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const atual = search.get('p') ?? '30';
  const [showCustom, setShowCustom] = useState(atual === 'custom');
  const [from, setFrom] = useState(search.get('from') ?? '');
  const [to, setTo] = useState(search.get('to') ?? '');

  function go(params: URLSearchParams) {
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function pick(p: string) {
    setShowCustom(false);
    const sp = new URLSearchParams(search.toString());
    sp.set('p', p); sp.delete('from'); sp.delete('to');
    go(sp);
  }

  function applyCustom() {
    if (!from || !to) return;
    const sp = new URLSearchParams(search.toString());
    sp.set('p', 'custom'); sp.set('from', from); sp.set('to', to);
    go(sp);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PRESETS.map(({ p, label }) => (
        <button key={p} type="button" onClick={() => pick(p)}
          className={cn(
            'px-3 py-1 rounded-full text-[12px] font-medium border transition-colors',
            atual === p
              ? 'bg-ink-950 dark:bg-white text-white dark:text-ink-950 border-transparent'
              : 'border-border text-fg-muted hover:text-fg',
          )}>
          {label}
        </button>
      ))}
      <button type="button" onClick={() => setShowCustom(s => !s)}
        className={cn(
          'px-3 py-1 rounded-full text-[12px] font-medium border transition-colors',
          atual === 'custom'
            ? 'bg-ink-950 dark:bg-white text-white dark:text-ink-950 border-transparent'
            : 'border-dashed border-border text-fg-muted hover:text-fg',
        )}>
        Personalizado
      </button>
      {showCustom && (
        <span className="flex items-center gap-1.5 ml-1">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="h-7 px-2 rounded-lg border border-border bg-surface text-[12px] num" />
          <span className="text-[11px] text-fg-subtle">até</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="h-7 px-2 rounded-lg border border-border bg-surface text-[12px] num" />
          <button type="button" onClick={applyCustom} disabled={!from || !to}
            className="px-2.5 py-1 rounded-lg bg-ink-950 dark:bg-white text-white dark:text-ink-950 text-[11.5px] font-medium disabled:opacity-40">
            Aplicar
          </button>
        </span>
      )}
    </div>
  );
}
