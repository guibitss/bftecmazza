import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export interface InboxAccess {
  inboxId:     number;
  storeId:     number;
  storeSlug:   string;
  displayName: string;       // 'Bot', 'Maria Júlia', 'Suporte'…
  kind:        'ai' | 'support' | 'vendor';
  wahaSession: string;
  canSend:     boolean;
  canManage:   boolean;
}

export interface InboxGroup {
  storeId:   number;
  storeSlug: string;
  inboxes:   InboxAccess[];
}

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  managerOfStoreId: number | null;   // se gerencia uma loja específica
  vendorIds: number[];                // vendor_ids das inboxes que opera
  inboxes: InboxAccess[];     // flat
  groups:  InboxGroup[];      // agrupado por loja pra UI
}

export const getCurrentUser = cache(async (): Promise<CurrentUser> => {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Dispara profile + ambas as queries de inbox em paralelo para minimizar latência
  const [{ data: profile }, { data: adminInboxData }, { data: userInboxData }] =
    await Promise.all([
      supabase
        .from('app_users')
        .select('id, email, name, is_admin, active, status, manager_of_store_id')
        .eq('id', user.id)
        .maybeSingle(),
      supabase
        .from('inboxes')
        .select('id, store_id, kind, waha_session, display_name, vendor_id, stores:store_id(slug)')
        .eq('active', true)
        .order('store_id')
        .order('kind'),
      supabase
        .from('user_inboxes')
        .select(`
          can_send, can_manage,
          inboxes:inbox_id (
            id, store_id, kind, waha_session, display_name, vendor_id,
            stores:store_id(slug)
          )
        `)
        .eq('user_id', user.id),
    ]);

  if (!profile || !profile.active) redirect('/login');
  if (profile.status !== 'approved') redirect('/aguardando-aprovacao');

  let inboxes: InboxAccess[] = [];
  let vendorIds: number[] = [];

  if (profile.is_admin) {
    inboxes = (adminInboxData ?? []).map(r => {
      const storeRel = r.stores as { slug?: string } | { slug: string }[] | null;
      const slug = Array.isArray(storeRel) ? storeRel[0]?.slug ?? '' : storeRel?.slug ?? '';
      return {
        inboxId:     r.id as number,
        storeId:     r.store_id as number,
        storeSlug:   slug,
        displayName: r.display_name as string,
        kind:        r.kind as InboxAccess['kind'],
        wahaSession: r.waha_session as string,
        canSend:     true,
        canManage:   true,
      };
    });
  } else {
    const data = userInboxData;

    inboxes = (data ?? []).flatMap((r) => {
      const ibRel = r.inboxes as unknown;
      const ib = Array.isArray(ibRel) ? ibRel[0] : ibRel;
      if (!ib) return [];
      const storeRel = (ib as { stores?: unknown }).stores;
      const storeArr = Array.isArray(storeRel) ? storeRel : [storeRel];
      const slug = (storeArr[0] as { slug?: string } | undefined)?.slug ?? '';
      const inbox = ib as {
        id: number; store_id: number; kind: InboxAccess['kind'];
        waha_session: string; display_name: string; vendor_id: number | null;
      };
      if (inbox.kind === 'vendor' && inbox.vendor_id && r.can_send) {
        vendorIds.push(inbox.vendor_id);
      }
      return [{
        inboxId:     inbox.id,
        storeId:     inbox.store_id,
        storeSlug:   slug,
        displayName: inbox.display_name,
        kind:        inbox.kind,
        wahaSession: inbox.waha_session,
        canSend:     r.can_send as boolean,
        canManage:   r.can_manage as boolean,
      }];
    });
  }

  // Agrupa por loja
  const byStore = new Map<number, InboxGroup>();
  for (const ib of inboxes) {
    if (!byStore.has(ib.storeId)) {
      byStore.set(ib.storeId, { storeId: ib.storeId, storeSlug: ib.storeSlug, inboxes: [] });
    }
    byStore.get(ib.storeId)!.inboxes.push(ib);
  }
  const groups = Array.from(byStore.values()).map(g => ({
    ...g,
    inboxes: g.inboxes.sort((a, b) => {
      const order = { ai: 0, support: 1, vendor: 2 };
      return order[a.kind] - order[b.kind] || a.displayName.localeCompare(b.displayName);
    }),
  })).sort((a, b) => a.storeId - b.storeId);

  return {
    id: profile.id,
    email: profile.email,
    name: profile.name ?? user.email!.split('@')[0],
    isAdmin: profile.is_admin,
    managerOfStoreId: profile.manager_of_store_id ?? null,
    vendorIds: Array.from(new Set(vendorIds)),
    inboxes,
    groups,
  };
});
