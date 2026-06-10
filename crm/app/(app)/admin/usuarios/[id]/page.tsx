import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card } from '@/components/ui/card';
import UserForm, { type InboxOption, type InboxValue } from '../user-form';

export default async function EditarUsuarioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await getCurrentUser();
  if (!me.isAdmin) redirect('/');

  const admin = createAdminClient();

  const [{ data: user }, { data: inboxRows }, { data: accesses }] = await Promise.all([
    admin.from('app_users').select('id, email, name, is_admin, active').eq('id', id).maybeSingle(),
    admin.from('inboxes').select('id, store_id, kind, display_name, stores:store_id(slug)')
      .eq('active', true).order('store_id').order('kind'),
    admin.from('user_inboxes').select('inbox_id, can_send, can_manage').eq('user_id', id),
  ]);

  if (!user) notFound();

  const inboxOptions: InboxOption[] = (inboxRows ?? []).map(r => {
    const storeRel = r.stores as { slug?: string } | { slug: string }[] | null;
    const slug = Array.isArray(storeRel) ? storeRel[0]?.slug ?? '' : storeRel?.slug ?? '';
    return {
      id: r.id as number,
      storeId: r.store_id as number,
      storeSlug: slug,
      kind: r.kind as InboxOption['kind'],
      displayName: r.display_name as string,
    };
  });

  const inboxes: InboxValue[] = (accesses ?? []).map(a => ({
    inboxId:   a.inbox_id as number,
    canSend:   a.can_send  as boolean,
    canManage: a.can_manage as boolean,
  }));

  return (
    <div className="min-h-screen">
      <div className="hairline-b">
        <div className="h-16 px-8 flex items-center">
          <Link href="/admin/usuarios" className="flex items-center gap-2 text-[12px] text-fg-muted hover:text-fg transition-colors">
            <ChevronLeft size={14} /> Usuários
          </Link>
        </div>
      </div>
      <div className="px-8 py-12 max-w-2xl mx-auto">
        <div className="mb-10 animate-slide-up">
          <h1 className="text-[36px] leading-[1.05] font-semibold tracking-[-0.04em]">{user.name}</h1>
          <p className="mt-3 text-[14px] text-fg-muted">{user.email}</p>
        </div>
        <Card className="p-8 animate-slide-up" style={{ animationDelay: '60ms' }}>
          <UserForm
            mode="edit"
            isSelf={id === me.id}
            inboxOptions={inboxOptions}
            initial={{
              id: user.id,
              email: user.email,
              name: user.name ?? '',
              isAdmin: user.is_admin,
              active: user.active,
              inboxes,
            }}
          />
        </Card>
      </div>
    </div>
  );
}
