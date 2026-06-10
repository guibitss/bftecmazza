'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Check } from 'lucide-react';
import Link from 'next/link';

interface LabelItem {
  id: string;
  name: string;
  color: string;
}

interface Props {
  convId: number;
  storeId: number;
  onClose?: () => void;
}

export function LabelPicker({ convId, storeId, onClose }: Props) {
  const supabase = createClient();
  const ref = useRef<HTMLDivElement>(null);
  const [labels, setLabels] = useState<LabelItem[]>([]);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: lbls }, { data: cl }] = await Promise.all([
        supabase
          .from('labels')
          .select('id, name, color')
          .eq('store_id', storeId)
          .order('created_at'),
        supabase
          .from('conversation_labels')
          .select('label_id')
          .eq('conversation_id', convId),
      ]);
      if (cancelled) return;
      setLabels((lbls ?? []) as LabelItem[]);
      setApplied(
        new Set(((cl ?? []) as { label_id: string }[]).map((r) => r.label_id)),
      );
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [convId, storeId, supabase]);

  // Fecha ao clicar fora
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose?.();
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  async function toggleLabel(labelId: string) {
    if (applied.has(labelId)) {
      setApplied((prev) => { const s = new Set(prev); s.delete(labelId); return s; });
      await supabase
        .from('conversation_labels')
        .delete()
        .eq('conversation_id', convId)
        .eq('label_id', labelId);
    } else {
      setApplied((prev) => new Set([...prev, labelId]));
      await supabase
        .from('conversation_labels')
        .insert({ conversation_id: convId, label_id: labelId });
    }
  }

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 z-50 w-52 rounded-2xl border border-border bg-white dark:bg-zinc-900 shadow-lg overflow-hidden"
    >
      {/* Header */}
      <div className="px-3 py-2 hairline-b">
        <span className="text-[10.5px] uppercase tracking-[0.14em] text-fg-subtle">
          Etiquetas
        </span>
      </div>

      {loading ? (
        <div className="px-4 py-4 text-[12px] text-fg-muted text-center">
          Carregando…
        </div>
      ) : labels.length === 0 ? (
        <div className="px-4 py-5 text-[12.5px] text-fg-muted text-center space-y-1">
          <p>Nenhuma etiqueta criada.</p>
          <Link
            href="/etiquetas"
            className="text-fg-subtle hover:text-fg underline transition-colors"
            onClick={onClose}
          >
            Criar etiquetas →
          </Link>
        </div>
      ) : (
        <ul className="py-1">
          {labels.map((l) => (
            <li key={l.id}>
              <button
                type="button"
                onClick={() => toggleLabel(l.id)}
                className="w-full flex items-center gap-3 px-3 py-2 hover:bg-surface-muted transition-colors text-left"
              >
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: l.color }}
                />
                <span className="text-[13px] flex-1 truncate">{l.name}</span>
                {applied.has(l.id) && (
                  <Check size={12} className="text-fg shrink-0" strokeWidth={2.5} />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Footer */}
      <div className="hairline-t px-3 py-2">
        <Link
          href="/etiquetas"
          className="text-[11px] text-fg-subtle hover:text-fg transition-colors"
          onClick={onClose}
        >
          Gerenciar etiquetas →
        </Link>
      </div>
    </div>
  );
}
