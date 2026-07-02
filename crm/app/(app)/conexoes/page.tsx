import { Wifi } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { SessionCard, type SessionDef } from './session-card';

function displaySlug(slug: string) {
  const map: Record<string, string> = {
    bftecmazza: 'BF Tec Mazza · Campo Mourão',
    xmazza:     'XMazza',
    gp:         'BF Tec Mazza · Guarapuava',
  };
  return map[slug] ?? slug;
}

export default async function ConexoesPage() {
  const user = await getCurrentUser();
  const admin = createAdminClient();

  // Busca todas as lojas ativas para pegar waha_url
  const { data: stores } = await admin
    .from('stores')
    .select('id, slug, waha_url, bot_session, support_session')
    .eq('active', true)
    .order('id');

  const storeMap = new Map((stores ?? []).map(s => [s.id, s]));

  let storeGroups: { storeId: number; storeSlug: string; sessions: SessionDef[] }[] = [];

  if (user.isAdmin) {
    // Admin vê todas as sessões de todas as lojas
    const { data: vendors } = await admin
      .from('vendors')
      .select('store_id, name, waha_session')
      .eq('active', true);

    const vendorList = vendors ?? [];

    storeGroups = (stores ?? []).map(store => {
      const sessions: SessionDef[] = [];

      if (store.bot_session) {
        sessions.push({ session: store.bot_session, label: 'Secretária IA', role: 'bot', wahaUrl: store.waha_url });
      }
      if (store.support_session) {
        sessions.push({ session: store.support_session, label: 'Suporte', role: 'support', wahaUrl: store.waha_url });
      }

      for (const v of vendorList.filter(v => v.store_id === store.id && v.waha_session)) {
        if (!sessions.some(s => s.session === v.waha_session)) {
          sessions.push({
            session: v.waha_session!,
            label: v.name.replace(/\b\w/g, (c: string) => c.toUpperCase()),
            role: 'vendor',
            wahaUrl: store.waha_url,
          });
        }
      }

      return { storeId: store.id, storeSlug: store.slug, sessions };
    });
  } else if (user.managerOfStoreId) {
    // Gerente: vê TODAS as sessões da sua loja
    const { data: allInboxes } = await admin
      .from('inboxes')
      .select('id, store_id, kind, waha_session, display_name')
      .eq('store_id', user.managerOfStoreId)
      .eq('active', true)
      .order('kind');

    const sessions: SessionDef[] = [];
    const store = storeMap.get(user.managerOfStoreId);
    if (store) {
      for (const inbox of allInboxes ?? []) {
        const kind = inbox.kind as string;
        sessions.push({
          session: inbox.waha_session as string,
          label:   inbox.display_name as string,
          role:    kind === 'ai' ? 'bot' : kind === 'support' ? 'support' : 'vendor',
          wahaUrl: store.waha_url,
        });
      }
      storeGroups = [{ storeId: user.managerOfStoreId, storeSlug: store.slug, sessions }];
    }
  } else {
    // Vendedor/colaborador: vê apenas as sessões das suas inboxes
    const byStore = new Map<number, SessionDef[]>();
    for (const inbox of user.inboxes) {
      const store = storeMap.get(inbox.storeId);
      if (!store) continue;
      if (!byStore.has(inbox.storeId)) byStore.set(inbox.storeId, []);
      const sessions = byStore.get(inbox.storeId)!;
      if (!sessions.some(s => s.session === inbox.wahaSession)) {
        sessions.push({
          session: inbox.wahaSession,
          label:   inbox.displayName,
          role:    inbox.kind === 'ai' ? 'bot' : inbox.kind === 'support' ? 'support' : 'vendor',
          wahaUrl: store.waha_url,
        });
      }
    }
    storeGroups = Array.from(byStore.entries()).map(([storeId, sessions]) => ({
      storeId,
      storeSlug: storeMap.get(storeId)?.slug ?? String(storeId),
      sessions,
    }));
  }

  // Remove grupos sem sessões
  const groups = storeGroups.filter(g => g.sessions.length > 0);

  return (
    <div className="min-h-screen">
      <div className="hairline-b">
        <div className="h-16 px-8 flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-[0.18em] text-fg-subtle">
            Conexões
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-fg-subtle">
            <span className="w-1.5 h-1.5 rounded-full bg-fg-subtle/40 animate-pulse" />
            Atualização automática a cada 12s
          </div>
        </div>
      </div>

      <div className="px-8 py-12 max-w-5xl mx-auto">
        <div className="mb-12 animate-slide-up">
          <div className="w-12 h-12 rounded-2xl border border-border bg-surface-muted grid place-items-center text-fg-muted mb-5">
            <Wifi size={20} strokeWidth={1.5} />
          </div>
          <h1 className="text-[38px] leading-[1.05] font-semibold tracking-[-0.04em]">
            Conexões
          </h1>
          <p className="mt-3 text-[14px] text-fg-muted max-w-lg leading-relaxed">
            Status em tempo real das suas sessões de mensagens.
            Clique em <strong className="font-medium text-fg">Ver QR code</strong> para reconectar um número.
          </p>
        </div>

        {groups.length === 0 ? (
          <p className="text-[14px] text-fg-muted">Nenhuma sessão disponível.</p>
        ) : (
          <div className="space-y-10">
            {groups.map(({ storeId, storeSlug, sessions }) => (
              <div key={storeId} className="animate-slide-up">
                <div className="flex items-center gap-3 mb-4">
                  <h2 className="text-[17px] font-semibold tracking-tight">
                    {displaySlug(storeSlug)}
                  </h2>
                  <span className="text-[10px] uppercase tracking-[0.14em] text-fg-subtle border border-border rounded px-1.5 py-0.5">
                    {sessions.length} sessão{sessions.length !== 1 ? 'ões' : ''}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {sessions.map(def => (
                    <SessionCard key={`${storeId}-${def.session}`} def={def} storeSlug={storeSlug} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
