import { ArrowUpRight } from 'lucide-react';
import type { Period } from '@/lib/period';

/**
 * Link "ver mais" que abre, em NOVA GUIA, a lista de conversas por trás de
 * uma métrica. Mantém o período atual.
 */
export function VerMais({ tipo, period, vendorId, label = 'ver conversas' }: {
  tipo: string; period: Period; vendorId?: number; label?: string;
}) {
  const sp = new URLSearchParams({ tipo });
  if (period.key.startsWith('custom:')) {
    const [, from, to] = period.key.split(':');
    sp.set('p', 'custom'); sp.set('from', from); sp.set('to', to);
  } else {
    sp.set('p', period.key);
  }
  if (vendorId) sp.set('v', String(vendorId));

  return (
    <a
      href={`/metricas/lista?${sp.toString()}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-0.5 text-[11px] text-fg-subtle hover:text-fg transition-colors whitespace-nowrap"
    >
      {label} <ArrowUpRight size={11} />
    </a>
  );
}
