import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card } from '@/components/ui/card';
import { Bell } from 'lucide-react';
import AlertasClient from './alertas-client';

export default async function AlertasPage() {
  const user = await getCurrentUser();
  if (!user.isAdmin && !user.managerOfStoreId) redirect('/');

  const admin = createAdminClient();

  // Stores que o user pode criar alertas
  let stores;
  if (user.isAdmin) {
    const { data } = await admin.from('stores').select('id, slug').eq('active', true).order('id');
    stores = data ?? [];
  } else {
    const { data } = await admin.from('stores').select('id, slug').eq('id', user.managerOfStoreId!).single();
    stores = data ? [data] : [];
  }

  // Vendors das stores que o user pode escolher
  const { data: vendors } = await admin
    .from('vendors').select('id, name, store_id')
    .in('store_id', stores.map(s => s.id))
    .eq('active', true)
    .order('queue_order');

  // Alertas atuais
  const { data: alerts } = await admin
    .from('metric_alerts')
    .select('id, store_id, vendor_id, metric, comparison, threshold, whatsapp_number, frequency, enabled, last_triggered_at, stores!store_id(slug), vendors!vendor_id(name)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });

  // whatsapp default do user
  const { data: profile } = await admin.from('app_users').select('whatsapp_number').eq('id', user.id).single();

  return (
    <div className="min-h-screen">
      <div className="hairline-b">
        <div className="h-16 px-8 flex items-center">
          <div className="text-[10px] uppercase tracking-[0.18em] text-fg-subtle">Alertas de métrica</div>
        </div>
      </div>

      <div className="px-8 py-12 max-w-5xl mx-auto">
        <div className="mb-10 animate-slide-up">
          <h1 className="text-[44px] leading-[1.05] font-semibold tracking-[-0.04em]">Alertas</h1>
          <p className="mt-4 text-[15px] text-fg-muted max-w-xl">
            Configure alertas sobre as métricas dos vendedores. Quando o valor passar do limite,
            o sistema envia uma mensagem da IA da loja pro seu WhatsApp.
          </p>
        </div>

        {stores.length === 0 ? (
          <Card className="p-12 text-center">
            <Bell size={28} className="mx-auto text-fg-subtle" strokeWidth={1.5} />
            <p className="text-fg-muted text-[14px] mt-3">Você precisa gerenciar uma loja para criar alertas.</p>
          </Card>
        ) : (
          <AlertasClient
            stores={stores}
            vendors={vendors ?? []}
            alerts={(alerts ?? []).map(a => {
              const s = a.stores as { slug?: string } | { slug: string }[] | null;
              const v = a.vendors as { name?: string } | { name: string }[] | null;
              return {
                id: a.id, storeId: a.store_id,
                storeSlug: Array.isArray(s) ? s[0]?.slug ?? '' : s?.slug ?? '',
                vendorId: a.vendor_id,
                vendorName: Array.isArray(v) ? v[0]?.name ?? null : v?.name ?? null,
                metric: a.metric, comparison: a.comparison,
                threshold: Number(a.threshold), whatsappNumber: a.whatsapp_number,
                frequency: a.frequency, enabled: a.enabled, lastTriggeredAt: a.last_triggered_at,
              };
            })}
            defaultWhatsapp={profile?.whatsapp_number ?? ''}
          />
        )}
      </div>
    </div>
  );
}
