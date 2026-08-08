import { getCurrentUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { MessageSquareText, Clock } from 'lucide-react';
import { GreetingForm, QuickReplyManager } from './mensagens-ui';

export default async function MensagensPage() {
  const user = await getCurrentUser();
  const admin = createAdminClient();

  // Vendedores que este login pode editar (os dele; admin sem vínculo vê os ativos)
  let vendorsQuery = admin.from('vendors').select('id, name, greeting, greeting_off').eq('active', true);
  if (user.vendorIds.length > 0) {
    vendorsQuery = vendorsQuery.in('id', user.vendorIds);
  } else if (!user.isAdmin) {
    vendorsQuery = vendorsQuery.in('id', [-1]); // ninguém
  }
  const [{ data: vendors }, { data: qrs }] = await Promise.all([
    vendorsQuery.order('name'),
    admin.from('quick_replies')
      .select('id, title, body, media_url, media_filename, kind, media_items')
      .eq('owner_user_id', user.id)
      .order('sort').order('created_at'),
  ]);

  return (
    <div className="min-h-screen">
      <div className="hairline-b">
        <div className="h-16 px-8 flex items-center">
          <div className="text-[10px] uppercase tracking-[0.18em] text-fg-subtle">Minhas mensagens</div>
        </div>
      </div>

      <div className="px-8 py-12 max-w-3xl mx-auto space-y-12">
        <div className="animate-slide-up">
          <h1 className="text-[38px] leading-[1.05] font-semibold tracking-[-0.04em]">Minhas mensagens</h1>
          <p className="mt-3 text-[14px] text-fg-muted max-w-xl leading-relaxed">
            Personalize sua saudação, a mensagem de fora do horário e suas respostas prontas.
          </p>
        </div>

        {/* Saudações */}
        <section className="animate-slide-up">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={15} className="text-fg-muted" />
            <h2 className="text-[16px] font-semibold tracking-tight">Saudações automáticas</h2>
          </div>
          {(vendors ?? []).length === 0 ? (
            <p className="text-[13px] text-fg-muted">
              Seu login não está vinculado a um número de vendedora, então não há saudação para personalizar.
            </p>
          ) : (
            <div className="space-y-4">
              {(vendors ?? []).map(v => (
                <GreetingForm
                  key={v.id}
                  vendorId={v.id}
                  name={v.name}
                  greeting={v.greeting ?? ''}
                  greetingOff={v.greeting_off ?? ''}
                />
              ))}
            </div>
          )}
        </section>

        {/* Mensagens rápidas */}
        <section className="animate-slide-up">
          <div className="flex items-center gap-2 mb-4">
            <MessageSquareText size={15} className="text-fg-muted" />
            <h2 className="text-[16px] font-semibold tracking-tight">Mensagens rápidas</h2>
          </div>
          <p className="text-[13px] text-fg-muted mb-4 max-w-xl leading-relaxed">
            Respostas prontas que aparecem no botão de atalho do inbox, pra você inserir com um clique.
          </p>
          <QuickReplyManager initial={(qrs ?? []).map(q => ({
            id: q.id, title: q.title, body: q.body,
            media_url: q.media_url, media_filename: q.media_filename, kind: q.kind,
            media_items: q.media_items,
          }))} />
        </section>
      </div>
    </div>
  );
}
