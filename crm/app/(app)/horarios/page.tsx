import { getCurrentUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { HorariosClient } from './horarios-client';

export interface VendorScheduleRow {
  id: number;
  store_id: number;
  name: string;
  lunch_start: string | null;   // 'HH:MM:SS'
  lunch_end: string | null;
  canEdit: boolean;
}

export interface StoreRow {
  id: number;
  slug: string;
}

export default async function HorariosPage() {
  const user = await getCurrentUser();
  const admin = createAdminClient();

  let storeIds: number[] = [];
  if (user.isAdmin) {
    const { data } = await admin.from('stores').select('id').eq('active', true).order('id');
    storeIds = (data ?? []).map((s: { id: number }) => s.id);
  } else if (user.managerOfStoreId != null) {
    storeIds = [user.managerOfStoreId];
  } else {
    storeIds = Array.from(new Set(user.groups.map(g => g.storeId)));
  }

  const [{ data: stores }, { data: vendors }] = await Promise.all([
    admin.from('stores').select('id, slug').in('id', storeIds).order('id'),
    admin
      .from('vendors')
      .select('id, store_id, name, lunch_start, lunch_end')
      .in('store_id', storeIds)
      .eq('active', true)
      .order('store_id')
      .order('queue_order'),
  ]);

  const rows: VendorScheduleRow[] = (vendors ?? []).map(v => ({
    ...(v as Omit<VendorScheduleRow, 'canEdit'>),
    canEdit:
      user.isAdmin ||
      user.managerOfStoreId === (v as { store_id: number }).store_id ||
      user.vendorIds.includes((v as { id: number }).id),
  }));

  return <HorariosClient stores={(stores ?? []) as StoreRow[]} vendors={rows} />;
}
