import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ChevronLeft, Clock, Inbox as InboxIcon } from 'lucide-react';
import { getCurrentUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card } from '@/components/ui/card';

export default async function SolicitacoesPage() {
  const me = await getCurrentUser();
  if (!me.isAdmin) redirect('/');

  const admin = createAdminClient();
  const { data: pending } = await admin
    .from('app_users')
    .select('id, name, email, requested_at, status')
    .eq('status', 'pending')
    .order('requested_at', { ascending: false });

  return (
    <div className="min-h-screen">
      <div className="hairline-b">
        <div className="h-16 px-8 flex items-center">
          <Link href="/admin" className="flex items-center gap-2 text-[12px] text-fg-muted hover:text-fg transition-colors">
            <ChevronLeft size={14} /> Administração
          </Link>
        </div>
      </div>

      <div className="px-8 py-12 max-w-4xl mx-auto">
        <div className="mb-10 animate-slide-up">
          <h1 className="text-[44px] leading-[1.05] font-semibold tracking-[-0.04em]">
            Solicitações pendentes
          </h1>
          <p className="mt-4 text-[15px] text-fg-muted max-w-xl">
            Pessoas que se cadastraram e aguardam aprovação para acessar o sistema.
          </p>
        </div>

        {(pending?.length ?? 0) === 0 ? (
          <Card className="p-12 text-center">
            <InboxIcon size={28} className="mx-auto text-fg-subtle" strokeWidth={1.5} />
            <p className="text-fg-muted text-[14px] mt-3">Nenhuma solicitação pendente.</p>
          </Card>
        ) : (
          <Card className="overflow-hidden p-0 animate-slide-up">
            <table className="w-full">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-fg-subtle">
                  <th className="px-6 py-3 font-medium">Nome</th>
                  <th className="px-4 py-3 font-medium">E-mail</th>
                  <th className="px-4 py-3 font-medium">Solicitado</th>
                  <th className="px-6 py-3 font-medium text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {pending!.map(u => (
                  <tr key={u.id} className="border-t border-border hover:bg-surface-muted/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full overflow-hidden bg-ink-950 text-white grid place-items-center text-[11px] font-semibold tracking-tight">
                          {u.name?.split(' ').map((s: string) => s[0]).slice(0, 2).join('').toUpperCase() ?? '?'}
                        </div>
                        <span className="text-[13.5px] font-medium">{u.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-[12.5px] text-fg-muted">{u.email}</td>
                    <td className="px-4 py-4 text-[11.5px] text-fg-subtle">
                      <span className="inline-flex items-center gap-1">
                        <Clock size={11} />
                        {new Date(u.requested_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Link
                        href={`/admin/solicitacoes/${u.id}`}
                        className="text-[12px] font-medium underline-offset-2 hover:underline transition-colors"
                      >
                        Revisar →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}
