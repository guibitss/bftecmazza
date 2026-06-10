import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card } from '@/components/ui/card';
import UserForm, { type InboxOption } from '../user-form';

export default async function NovoUsuarioPage() {
  const me = await getCurrentUser();
  if (!me.isAdmin) redirect('/');

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from('inboxes')
    .select('id, store_id, kind, display_name, stores:store_id(slug)')
    .eq('active', true)
    .order('store_id')
    .order('kind');

  const inboxOptions: InboxOption[] = (rows ?? []).map(r => {
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
          <Link href="/admin/usuarios" className="flex items-center gap-2 text-[12px] text-fg-muted hover:text-fg transition-colors">
            <ChevronLeft size={14} /> Usuários
          </Link>
        </div>
      </div>
      <div className="px-8 py-12 max-w-2xl mx-auto">
        <div className="mb-10 animate-slide-up">
          <h1 className="text-[36px] leading-[1.05] font-semibold tracking-[-0.04em]">Convidar usuário</h1>
          <p className="mt-3 text-[14px] text-fg-muted">A pessoa vai receber um e-mail para definir a senha.</p>
        </div>
        <Card className="p-8 animate-slide-up" style={{ animationDelay: '60ms' }}>
          <UserForm mode="create" inboxOptions={inboxOptions} />
        </Card>
      </div>
    </div>
  );
}
