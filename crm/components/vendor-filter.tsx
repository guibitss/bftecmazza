'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export interface VendorOption {
  id: number;
  name: string;
  storeSlug: string;
}

export function VendorFilter({ vendors }: { vendors: VendorOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const atual = search.get('v') ?? '';

  function pick(v: string) {
    const sp = new URLSearchParams(search.toString());
    if (v) sp.set('v', v); else sp.delete('v');
    router.push(`${pathname}?${sp.toString()}`, { scroll: false });
  }

  return (
    <select
      value={atual}
      onChange={e => pick(e.target.value)}
      className="h-7 px-2.5 rounded-full border border-border bg-surface text-[12px] font-medium text-fg focus:outline-none focus:border-border-strong transition-colors"
    >
      <option value="">Todas as vendedoras</option>
      {vendors.map(v => (
        <option key={v.id} value={String(v.id)}>
          {v.name.charAt(0).toUpperCase() + v.name.slice(1)} · {v.storeSlug}
        </option>
      ))}
    </select>
  );
}
