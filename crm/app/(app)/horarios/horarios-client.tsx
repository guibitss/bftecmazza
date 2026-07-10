'use client';

import { useState, useTransition } from 'react';
import { Check, UtensilsCrossed } from 'lucide-react';
import { cn } from '@/lib/utils';
import { updateLunch } from './actions';
import type { VendorScheduleRow, StoreRow } from './page';

function fmtName(name: string) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

// 'HH:MM:SS' → 'HH:MM' pro input type=time
function toInput(t: string | null): string {
  return t ? t.slice(0, 5) : '';
}

function VendorRow({ vendor }: { vendor: VendorScheduleRow }) {
  const [start, setStart] = useState(toInput(vendor.lunch_start));
  const [end, setEnd] = useState(toInput(vendor.lunch_end));
  const [saved, setSaved] = useState<string | null>(`${toInput(vendor.lunch_start)}|${toInput(vendor.lunch_end)}`);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = `${start}|${end}` !== saved;

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const res = await updateLunch(vendor.id, start || null, end || null);
      if (res.ok) {
        setSaved(`${start}|${end}`);
      } else {
        setError(res.error ?? 'Erro ao salvar');
      }
    });
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-surface">
      <span className="text-[13.5px] font-medium flex-1 truncate">{fmtName(vendor.name)}</span>

      {error && <span className="text-[11.5px] text-red-600 dark:text-red-400">{error}</span>}

      <input
        type="time"
        value={start}
        disabled={!vendor.canEdit || pending}
        onChange={(e) => setStart(e.target.value)}
        className={cn(
          'h-8 px-2 rounded-lg border border-border bg-surface text-[13px] num',
          'focus:outline-none focus:border-border-strong transition-colors',
          !vendor.canEdit && 'opacity-50 cursor-not-allowed',
        )}
      />
      <span className="text-fg-subtle text-[12px]">até</span>
      <input
        type="time"
        value={end}
        disabled={!vendor.canEdit || pending}
        onChange={(e) => setEnd(e.target.value)}
        className={cn(
          'h-8 px-2 rounded-lg border border-border bg-surface text-[13px] num',
          'focus:outline-none focus:border-border-strong transition-colors',
          !vendor.canEdit && 'opacity-50 cursor-not-allowed',
        )}
      />

      {vendor.canEdit && (
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || pending}
          className={cn(
            'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all',
            dirty
              ? 'bg-ink-950 dark:bg-white text-white dark:text-ink-950'
              : 'text-fg-subtle bg-surface-muted cursor-default',
            pending && 'opacity-50',
          )}
        >
          <Check size={12} strokeWidth={2.5} />
          {dirty ? 'Salvar' : 'Salvo'}
        </button>
      )}
    </div>
  );
}

export function HorariosClient({
  stores,
  vendors,
}: {
  stores: StoreRow[];
  vendors: VendorScheduleRow[];
}) {
  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      <div className="hairline-b h-16 px-8 flex items-center">
        <span className="text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
          Configurações · Horários
        </span>
      </div>

      <div className="px-8 py-10 max-w-3xl mx-auto">
        <h1 className="text-[32px] font-semibold tracking-[-0.03em] animate-slide-up flex items-center gap-3">
          <UtensilsCrossed size={26} strokeWidth={1.75} className="text-fg-subtle" />
          Horário de almoço
        </h1>
        <p className="mt-2 text-[14px] text-fg-muted">
          Deixe os dois campos vazios se a vendedora não faz pausa.
          Você pode editar o seu próprio horário; gerentes editam a loja toda.
        </p>

        {stores.map((store) => {
          const storeVendors = vendors.filter(v => v.store_id === store.id);
          if (storeVendors.length === 0) return null;
          return (
            <div key={store.id} className="mt-8">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-fg-subtle mb-3">
                {store.slug}
              </div>
              <div className="rounded-2xl border border-border overflow-hidden divide-y divide-border">
                {storeVendors.map(v => <VendorRow key={v.id} vendor={v} />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
