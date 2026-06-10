import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ChevronLeft, Clock, Mail } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card } from '@/components/ui/card';
import ReviewForm, { type InboxOption, type StoreOption } from './review-form';

export default async function RevisarSolicitacaoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await getCurrentUser();
  if (!me.isAdmin) redirect('/');

  const admin = createAdminClient();

  const [{ data: user }, { data: stores }, { data: inboxRows }] = await Promise.all([
    admin.from('app_users').select('id, name, email, status, requested_at').eq('id', id).maybeSingle(),
    admin.from('stores').select('id, slug').eq('active', true).order('id'),
    admin.from('inboxes').select('id, store_id, kind, display_name, stores:store_id(slug)')
      .eq('active', true).order('store_id').order('kind'),
  ]);

  if (!user) notFound();
  if (user.status !== 'pending') redirect('/admin/solicitacoes');

  const storeOptions: StoreOption[] = (stores ?? []).map(s => ({ id: s.id, slug: s.slug }));
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

  return (
    <div className="min-h-screen">
      <div className="hairline-b">
        <div className="h-16 px-8 flex items-center">
          <Link href="/admin/solicitacoes" className="flex items-center gap-2 text-[12px] text-fg-muted hover:text-fg transition-colors">
            <ChevronLeft size={14} /> Solicitações
          </Link>
        </div>
      </div>

      <div className="px-8 py-12 max-w-3xl mx-auto">
        <div className="mb-10 animate-slide-up">
          <div className="text-[11px] uppercase tracking-[0.18em] text-fg-subtle mb-3">Revisar solicitação</div>
          <h1 className="text-[36px] leading-[1.1] font-semibold tracking-[-0.04em]">{user.name}</h1>
          <div className="mt-3 flex items-center gap-4 text-[12.5px] text-fg-muted">
            <span className="inline-flex items-center gap-1.5"><Mail size={12} /> {user.email}</span>
            <span className="inline-flex items-center gap-1.5">
              <Clock size={12} />
              {new Date(user.requested_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
            </span>
          </div>
        </div>

        <Card className="p-8 animate-slide-up" style={{ animationDelay: '60ms' }}>
          <ReviewForm
            userId={user.id}
            userName={user.name ?? user.email}
            stores={storeOptions}
            inboxOptions={inboxOptions}
          />
        </Card>
      </div>
    </div>
  );
}
