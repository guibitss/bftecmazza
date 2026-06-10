import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { LabelsClient } from './labels-client';

export interface LabelRow {
  id: string;
  store_id: number;
  name: string;
  color: string;
  created_at: string;
}

export interface StoreRow {
  id: number;
  slug: string;
}

export default async function EtiquetasPage() {
  const user = await getCurrentUser();
  if (!user.isAdmin && user.managerOfStoreId == null) redirect('/');

  const supabase = await createClient();

  let storeIds: number[] = [];
  if (user.isAdmin) {
    const { data } = await supabase.from('stores').select('id').order('id');
    storeIds = (data ?? []).map((s: { id: number }) => s.id);
  } else if (user.managerOfStoreId != null) {
    storeIds = [user.managerOfStoreId];
  }

  const [{ data: stores }, { data: labels }] = await Promise.all([
    supabase.from('stores').select('id, slug').in('id', storeIds).order('id'),
    supabase
      .from('labels')
      .select('id, store_id, name, color, created_at')
      .in('store_id', storeIds)
      .order('created_at', { ascending: true }),
  ]);

  return (
    <LabelsClient
      stores={(stores ?? []) as StoreRow[]}
      initialLabels={(labels ?? []) as LabelRow[]}
    />
  );
}
