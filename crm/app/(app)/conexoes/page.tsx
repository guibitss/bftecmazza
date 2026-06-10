import { redirect } from 'next/navigation';
import { Wifi } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { SessionCard, type SessionDef } from './session-card';

interface StoreRow {
  id: number;
  slug: string;
  waha_url: string;
  bot_session: string | null;
  support_session: string | null;
}

interface VendorRow {
  store_id: number;
  name: string;
  waha_session: string | null;
}

function displaySlug(slug: string) {
  const map: Record<string, string> = {
    bftecmazza: 'BF Tec Mazza · Campo Mourão',
    xmazza:     'XMazza',
    gp:         'BF Tec Mazza · Guarapuava',
  };
  return map[slug] ?? slug;
}

function vendorLabel(name: string) {
  // Capitaliza cada palavra
  return name.replace(/\b\w/g, c => c.toUpperCase());
}

export default async function ConexoesPage() {
  const user = await getCurrentUser();
  if (!user.isAdmin) redirect('/');

  const admin = createAdminClient();

  const [{ data: stores }, { data: vendors }] = await Promise.all([
    admin
      .from('stores')
      .select('id, slug, waha_url, bot_session, support_session')
      .eq('active', true)
      .order('id'),
    admin
      .from('vendors')
      .select('store_id, name, waha_session')
      .eq('active', true),
  ]);

  const storeList = (stores ?? []) as StoreRow[];
  const vendorList = (vendors ?? []) as VendorRow[];

  // Monta lista de sessões por loja
  const storeGroups: { store: StoreRow; sessions: SessionDef[] }[] = storeList.map(store => {
    const sessions: SessionDef[] = [];

    if (store.bot_session) {
      sessions.push({
        session: store.bot_session,
        label: 'Secretária IA',
        role: 'bot',
        wahaUrl: store.waha_url,
      });
    }

    if (store.support_session) {
      sessions.push({
        session: store.support_session,
        label: 'Suporte',
        role: 'support',
        wahaUrl: store.waha_url,
      });
    }

    const storeVendors = vendorList.filter(v => v.store_id === store.id && v.waha_session);
    for (const v of storeVendors) {
      // Evita duplicar sessões que já foram listadas (bot/suporte podem coincidir)
      const alreadyAdded = sessions.some(s => s.session === v.waha_session);
      if (!alreadyAdded) {
        sessions.push({
          session: v.waha_session!,
          label: vendorLabel(v.name),
          role: 'vendor',
          wahaUrl: store.waha_url,
        });
      }
    }

    return { store, sessions };
  });

  return (
    <div className="min-h-screen">
      {/* Top bar */}
      <div className="hairline-b">
        <div className="h-16 px-8 flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
            Administração · Conexões
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
            <span className="w-1.5 h-1.5 rounded-full bg-fg-subtle/40 animate-pulse" />
            Atualização automática a cada 12s
          </div>
        </div>
      </div>

      <div className="px-8 py-12 max-w-5xl mx-auto">
        {/* Título */}
        <div className="mb-12 animate-slide-up">
          <div className="w-12 h-12 rounded-2xl border border-border bg-surface-muted grid place-items-center text-fg-muted mb-5">
            <Wifi size={20} strokeWidth={1.5} />
          </div>
          <h1 className="text-[38px] leading-[1.05] font-semibold tracking-[-0.04em]">
            Conexões
          </h1>
          <p className="mt-3 text-[14px] text-fg-muted max-w-lg leading-relaxed">
            Status em tempo real de todas as sessões de mensagens.
            Clique em <strong className="font-medium text-fg">Ver QR code</strong> para reconectar um número.
          </p>
        </div>

        {/* Grupos por loja */}
        <div className="space-y-10">
          {storeGroups.map(({ store, sessions }) => (
            <div key={store.id} className="animate-slide-up">
              {/* Nome da loja */}
              <div className="flex items-center gap-3 mb-4">
                <h2 className="text-[17px] font-semibold tracking-tight">
                  {displaySlug(store.slug)}
                </h2>
                <span className="text-[10px] uppercase tracking-[0.14em] text-fg-subtle border border-border rounded px-1.5 py-0.5">
                  {sessions.length} sessão{sessions.length !== 1 ? 'ões' : ''}
                </span>
              </div>

              {sessions.length === 0 ? (
                <p className="text-[13px] text-fg-muted">Nenhuma sessão configurada.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {sessions.map(def => (
                    <SessionCard
                      key={`${store.id}-${def.session}`}
                      def={def}
                      storeSlug={store.slug}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
