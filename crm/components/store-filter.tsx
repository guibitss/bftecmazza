'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export interface StoreOption { id: number; slug: string; }

export function StoreFilter({ stores }: { stores: StoreOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const atual = search.get('s') ?? '';

  function pick(s: string) {
    const sp = new URLSearchParams(search.toString());
    if (s) sp.set('s', s); else sp.delete('s');
    sp.delete('v'); // troca de loja limpa o filtro de vendedora
    router.push(`${pathname}?${sp.toString()}`, { scroll: false });
  }

  if (stores.length <= 1) return null;

  return (
    <select
      value={atual}
      onChange={e => pick(e.target.value)}
      className="h-7 px-2.5 rounded-full border border-border bg-surface text-[12px] font-medium text-fg focus:outline-none focus:border-border-strong transition-colors"
    >
      <option value="">Todas as lojas</option>
      {stores.map(s => (
        <option key={s.id} value={String(s.id)}>{s.slug}</option>
      ))}
    </select>
  );
}
