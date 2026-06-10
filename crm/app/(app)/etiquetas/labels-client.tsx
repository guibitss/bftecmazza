'use client';

import { useState, useTransition } from 'react';
import { Pencil, Trash2, Plus, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createLabel, updateLabel, deleteLabel } from './actions';
import type { LabelRow, StoreRow } from './page';

const COLORS = [
  '#6b7280', // Cinza
  '#3b82f6', // Azul
  '#14b8a6', // Teal
  '#22c55e', // Verde
  '#f59e0b', // Âmbar
  '#f97316', // Laranja
  '#f43f5e', // Rosa
  '#a855f7', // Roxo
];

function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={cn(
            'w-6 h-6 rounded-full transition-all',
            value === c
              ? 'ring-2 ring-offset-1 ring-ink-950 dark:ring-white scale-110'
              : 'hover:scale-105',
          )}
          style={{ backgroundColor: c }}
          title={c}
        />
      ))}
    </div>
  );
}

interface LabelFormProps {
  initialName?: string;
  initialColor?: string;
  onSave: (name: string, color: string) => void;
  onCancel: () => void;
  pending: boolean;
}

function LabelForm({
  initialName = '',
  initialColor = COLORS[0],
  onSave,
  onCancel,
  pending,
}: LabelFormProps) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);

  return (
    <div className="flex flex-col gap-3 px-4 py-3 bg-surface-muted/50">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nome da etiqueta…"
        maxLength={32}
        className="h-9 px-3 rounded-lg border border-border bg-surface text-[13.5px] focus:outline-none focus:border-border-strong transition-colors"
        autoFocus
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) onSave(name, color);
          if (e.key === 'Escape') onCancel();
        }}
      />
      <ColorPicker value={color} onChange={setColor} />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => name.trim() && onSave(name, color)}
          disabled={!name.trim() || pending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ink-950 dark:bg-white text-white dark:text-ink-950 text-[12.5px] font-medium disabled:opacity-50 transition-opacity"
        >
          <Check size={12} strokeWidth={2.5} />
          Salvar
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 rounded-lg text-[12.5px] text-fg-muted hover:text-fg hover:bg-surface-muted transition-colors"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

export function LabelsClient({
  stores,
  initialLabels,
}: {
  stores: StoreRow[];
  initialLabels: LabelRow[];
}) {
  const [labels, setLabels] = useState<LabelRow[]>(initialLabels);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creatingForStore, setCreatingForStore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function labelsForStore(storeId: number) {
    return labels.filter((l) => l.store_id === storeId);
  }

  function handleCreate(storeId: number, name: string, color: string) {
    setError(null);
    startTransition(async () => {
      const res = await createLabel(storeId, name, color);
      if (res.ok && res.id) {
        const newLabel: LabelRow = {
          id: res.id,
          store_id: storeId,
          name,
          color,
          created_at: new Date().toISOString(),
        };
        setLabels((prev) => [...prev, newLabel]);
        setCreatingForStore(null);
      } else {
        setError(res.error ?? 'Erro ao criar');
      }
    });
  }

  function handleUpdate(id: string, name: string, color: string) {
    setError(null);
    startTransition(async () => {
      const res = await updateLabel(id, name, color);
      if (res.ok) {
        setLabels((prev) =>
          prev.map((l) => (l.id === id ? { ...l, name, color } : l)),
        );
        setEditingId(null);
      } else {
        setError(res.error ?? 'Erro ao salvar');
      }
    });
  }

  function handleDelete(id: string) {
    if (!window.confirm('Excluir etiqueta? Ela será removida de todas as conversas.')) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteLabel(id);
      if (res.ok) {
        setLabels((prev) => prev.filter((l) => l.id !== id));
      } else {
        setError(res.error ?? 'Erro ao excluir');
      }
    });
  }

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950">
      {/* Header */}
      <div className="hairline-b h-16 px-8 flex items-center">
        <span className="text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
          Configurações · Etiquetas
        </span>
      </div>

      <div className="px-8 py-10 max-w-3xl mx-auto">
        <h1 className="text-[32px] font-semibold tracking-[-0.03em] animate-slide-up">
          Etiquetas
        </h1>
        <p className="mt-2 text-[14px] text-fg-muted">
          Organize conversas com etiquetas coloridas por loja.
        </p>

        {error && (
          <div className="mt-4 text-[12.5px] text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3">
            {error}
          </div>
        )}

        {stores.map((store) => {
          const storeLabels = labelsForStore(store.id);
          const isCreating = creatingForStore === store.id;

          return (
            <div key={store.id} className="mt-8">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-fg-subtle mb-3">
                {store.slug}
              </div>

              <div className="rounded-2xl border border-border overflow-hidden divide-y divide-border">
                {storeLabels.length === 0 && !isCreating && (
                  <div className="px-4 py-6 text-[13px] text-fg-muted text-center bg-surface">
                    Nenhuma etiqueta ainda.
                  </div>
                )}

                {storeLabels.map((label) =>
                  editingId === label.id ? (
                    <LabelForm
                      key={label.id}
                      initialName={label.name}
                      initialColor={label.color}
                      onSave={(name, color) => handleUpdate(label.id, name, color)}
                      onCancel={() => setEditingId(null)}
                      pending={pending}
                    />
                  ) : (
                    <div
                      key={label.id}
                      className="flex items-center gap-3 px-4 py-3 bg-surface"
                    >
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: label.color }}
                      />
                      <span className="text-[13.5px] font-medium flex-1">{label.name}</span>
                      <button
                        type="button"
                        onClick={() => setEditingId(label.id)}
                        className="p-1.5 rounded-lg text-fg-subtle hover:text-fg hover:bg-surface-muted transition-colors"
                        title="Editar"
                      >
                        <Pencil size={13} strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(label.id)}
                        className="p-1.5 rounded-lg text-fg-subtle hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                        title="Excluir"
                      >
                        <Trash2 size={13} strokeWidth={1.75} />
                      </button>
                    </div>
                  ),
                )}

                {isCreating && (
                  <LabelForm
                    onSave={(name, color) => handleCreate(store.id, name, color)}
                    onCancel={() => setCreatingForStore(null)}
                    pending={pending}
                  />
                )}
              </div>

              {!isCreating && editingId == null && (
                <button
                  type="button"
                  onClick={() => setCreatingForStore(store.id)}
                  className="flex items-center gap-2 mt-2 px-1 py-1 text-[13px] text-fg-muted hover:text-fg transition-colors"
                >
                  <Plus size={14} strokeWidth={1.75} />
                  Nova etiqueta
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
