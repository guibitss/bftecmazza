import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card } from '@/components/ui/card';
import { ChevronLeft, UtensilsCrossed } from 'lucide-react';
import { LunchBreakForm } from './lunch-break-form';

export default async function VendedoresPage() {
  const user = await getCurrentUser();
  if (!user.isAdmin) redirect('/');

  const admin = createAdminClient();

  const { data: stores } = await admin
    .from('stores')
    .select('id, slug')
    .eq('active', true)
    .order('id');

  const { data: vendors } = await admin
    .from('vendors')
    .select('id, store_id, name, lunch_start, lunch_end, queue_order, active')
    .eq('active', true)
    .order('store_id')
    .order('queue_order');

  const storeMap = new Map((stores ?? []).map(s => [s.id, s.slug]));

  const byStore = new Map<number, typeof vendors>();
  for (const v of vendors ?? []) {
    if (!byStore.has(v.store_id)) byStore.set(v.store_id, []);
    byStore.get(v.store_id)!.push(v);
  }

  function displaySlug(slug: string) {
    const map: Record<string, string> = {
      bftecmazza: 'BF Tec Mazza · Campo Mourão',
      xmazza:     'XMazza',
      gp:         'BF Tec Mazza · Guarapuava',
    };
    return map[slug] ?? slug;
  }

  return (
    <div className="min-h-screen">
      <div className="hairline-b">
        <div className="h-16 px-8 flex items-center gap-4">
          <Link href="/admin" className="text-fg-subtle hover:text-fg transition-colors">
            <ChevronLeft size={16} />
          </Link>
          <div className="text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
            Admin · Vendedores
          </div>
        </div>
      </div>

      <div className="px-8 py-12 max-w-4xl mx-auto">
        <div className="mb-10 animate-slide-up">
          <div className="w-12 h-12 rounded-2xl border border-border bg-surface-muted grid place-items-center text-fg-muted mb-5">
            <UtensilsCrossed size={20} strokeWidth={1.5} />
          </div>
          <h1 className="text-[38px] leading-[1.05] font-semibold tracking-[-0.04em]">
            Vendedores
          </h1>
          <p className="mt-3 text-[14px] text-fg-muted max-w-lg leading-relaxed">
            Configure o horário de almoço de cada vendedor. Durante esse período a IA não encaminhará leads para eles.
            Se não configurado, recebem leads normalmente.
          </p>
        </div>

        <div className="space-y-10">
          {Array.from(byStore.entries()).map(([storeId, storeVendors]) => (
            <div key={storeId} className="animate-slide-up">
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-[17px] font-semibold tracking-tight">
                  {displaySlug(storeMap.get(storeId) ?? String(storeId))}
                </h2>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="flex flex-col gap-3">
                {storeVendors!.map(v => (
                  <Card key={v.id} className="p-5">
                    <div className="flex items-center justify-between gap-6">
                      <div>
                        <div className="text-[14px] font-medium capitalize">{v.name}</div>
                        <div className="text-[12px] text-fg-subtle mt-0.5">
                          {v.lunch_start && v.lunch_end
                            ? `Almoço: ${v.lunch_start.slice(0, 5)} – ${v.lunch_end.slice(0, 5)}`
                            : 'Sem horário de almoço configurado'}
                        </div>
                      </div>
                      <LunchBreakForm
                        vendorId={v.id}
                        lunchStart={v.lunch_start ?? ''}
                        lunchEnd={v.lunch_end ?? ''}
                      />
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
