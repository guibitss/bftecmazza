import { getCurrentUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card } from '@/components/ui/card';
import { ClipboardList } from 'lucide-react';
import TratativasClient from './tratativas-client';

interface Store { id: number; slug: string }

export default async function TratativasPage() {
  const user = await getCurrentUser();
  const admin = createAdminClient();

  // Lojas que esse user pode usar (via inboxes ou managerOfStoreId ou admin)
  let stores: Store[];
  if (user.isAdmin) {
    const { data } = await admin.from('stores').select('id, slug').eq('active', true).order('id');
    stores = data ?? [];
  } else {
    const storeIds = user.managerOfStoreId
      ? [user.managerOfStoreId]
      : Array.from(new Set(user.inboxes.map(i => i.storeId)));
    if (storeIds.length === 0) stores = [];
    else {
      const { data } = await admin.from('stores').select('id, slug').in('id', storeIds).order('id');
      stores = data ?? [];
    }
  }

  const { data: tratativas } = await admin
    .from('tratativas')
    .select('id, customer_name, customer_phone, notes, send_at, status, sent_at, error_msg, store_id, stores!store_id(slug)')
    .eq('user_id', user.id)
    .order('send_at', { ascending: false })
    .limit(100);

  // Lê whatsapp atual do user
  const { data: profile } = await admin.from('app_users').select('whatsapp_number').eq('id', user.id).single();

  return (
    <div className="min-h-screen">
      <div className="hairline-b">
        <div className="h-16 px-8 flex items-center">
          <div className="text-[10px] uppercase tracking-[0.18em] text-fg-subtle">Minhas tratativas</div>
        </div>
      </div>

      <div className="px-8 py-12 max-w-5xl mx-auto">
        <div className="mb-10 animate-slide-up">
          <h1 className="text-[44px] leading-[1.05] font-semibold tracking-[-0.04em]">
            Tratativas comerciais
          </h1>
          <p className="mt-4 text-[15px] text-fg-muted max-w-xl">
            Programe um lembrete pra você mesmo. Na data marcada, o sistema envia uma mensagem
            no seu WhatsApp com os dados do cliente e a observação.
          </p>
        </div>

        {stores.length === 0 ? (
          <Card className="p-12 text-center">
            <ClipboardList size={28} className="mx-auto text-fg-subtle" strokeWidth={1.5} />
            <p className="text-fg-muted text-[14px] mt-3">Você precisa ter acesso a alguma caixa para cadastrar tratativas.</p>
          </Card>
        ) : (
          <TratativasClient
            stores={stores}
            tratativas={(tratativas ?? []).map(t => {
              const s = t.stores as { slug?: string } | { slug: string }[] | null;
              const slug = Array.isArray(s) ? s[0]?.slug ?? '' : s?.slug ?? '';
              return {
                id: t.id, customerName: t.customer_name, customerPhone: t.customer_phone,
                notes: t.notes, sendAt: t.send_at, status: t.status,
                sentAt: t.sent_at, errorMsg: t.error_msg, storeSlug: slug,
              };
            })}
            currentWhatsapp={profile?.whatsapp_number ?? null}
          />
        )}
      </div>
    </div>
  );
}
