import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUser } from '@/lib/auth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, ChevronLeft, ShieldCheck, Mail } from 'lucide-react';

export default async function UsuariosPage() {
  const me = await getCurrentUser();
  if (!me.isAdmin) redirect('/');

  const admin = createAdminClient();

  const { data: users } = await admin
    .from('app_users')
    .select('id, email, name, is_admin, active, created_at')
    .order('created_at', { ascending: false });

  const { data: accesses } = await admin
    .from('user_inboxes')
    .select('user_id, inbox_id, can_manage, inboxes:inbox_id(store_id, stores:store_id(slug))');

  // por user → contagem por loja
  const byUser = new Map<string, Map<string, { count: number; canManage: boolean }>>();
  (accesses ?? []).forEach((r) => {
    const ib = r.inboxes as unknown;
    const ibObj = Array.isArray(ib) ? ib[0] : ib;
    if (!ibObj) return;
    const storeRel = (ibObj as { stores?: unknown }).stores;
    const storeArr = Array.isArray(storeRel) ? storeRel : [storeRel];
    const slug = (storeArr[0] as { slug?: string } | undefined)?.slug ?? '?';
    const uid = r.user_id as string;
    if (!byUser.has(uid)) byUser.set(uid, new Map());
    const m = byUser.get(uid)!;
    const cur = m.get(slug) ?? { count: 0, canManage: false };
    m.set(slug, { count: cur.count + 1, canManage: cur.canManage || (r.can_manage as boolean) });
  });

  return (
    <div className="min-h-screen">
      <div className="hairline-b">
        <div className="h-16 px-8 flex items-center justify-between">
          <Link href="/admin" className="flex items-center gap-2 text-[12px] text-fg-muted hover:text-fg transition-colors">
            <ChevronLeft size={14} /> Administração
          </Link>
          <Link href="/admin/usuarios/novo">
            <Button size="sm"><Plus size={14} /> Convidar usuário</Button>
          </Link>
        </div>
      </div>

      <div className="px-8 py-12 max-w-5xl mx-auto">
        <div className="mb-10 animate-slide-up">
          <h1 className="text-[44px] leading-[1.05] font-semibold tracking-[-0.04em]">Usuários</h1>
          <p className="mt-4 text-[15px] text-fg-muted max-w-xl">
            Defina quem acessa quais caixas de entrada. Admins enxergam tudo automaticamente.
          </p>
        </div>

        {(users?.length ?? 0) === 0 ? (
          <Card className="p-12 text-center"><p className="text-fg-muted text-sm">Nenhum usuário ainda.</p></Card>
        ) : (
          <Card className="overflow-hidden p-0 animate-slide-up">
            <table className="w-full">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-[0.14em] text-fg-subtle">
                  <th className="px-6 py-3 font-medium">Nome</th>
                  <th className="px-4 py-3 font-medium">E-mail</th>
                  <th className="px-4 py-3 font-medium">Caixas</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-6 py-3 font-medium text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {users!.map((u) => {
                  const storeMap = byUser.get(u.id) ?? new Map();
                  return (
                    <tr key={u.id} className="border-t border-border hover:bg-surface-muted/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full overflow-hidden bg-ink-950 text-white grid place-items-center text-[11px] font-semibold tracking-tight">
                            {u.name?.split(' ').map((s: string) => s[0]).slice(0, 2).join('').toUpperCase() ?? '?'}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[13.5px] font-medium">{u.name}</span>
                            {u.is_admin && <ShieldCheck size={13} className="text-fg" />}
                            {u.id === me.id && <span className="text-[10px] uppercase tracking-wider text-fg-subtle">· você</span>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-[12.5px] text-fg-muted">{u.email}</td>
                      <td className="px-4 py-4">
                        {u.is_admin ? (
                          <span className="text-[11px] text-fg-subtle">todas (admin)</span>
                        ) : storeMap.size === 0 ? (
                          <span className="text-[11px] text-fg-subtle italic">nenhuma</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {Array.from(storeMap.entries()).map(([slug, info]) => (
                              <span key={slug}
                                    className="inline-flex items-center gap-1 text-[10.5px] px-1.5 py-0.5 rounded border border-border bg-surface-muted"
                                    title={info.canManage ? 'pode gerenciar' : 'só atender'}>
                                {slug} <span className="text-fg-subtle num">·{info.count}</span>
                                {info.canManage && <span className="text-fg-subtle">★</span>}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`text-[10.5px] uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                          u.active
                            ? 'text-emerald-700 dark:text-emerald-300 border-emerald-500/30 bg-emerald-500/5'
                            : 'text-fg-subtle border-border bg-surface-muted'
                        }`}>
                          {u.active ? 'ativo' : 'inativo'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link href={`/admin/usuarios/${u.id}`} className="text-[12px] text-fg-muted hover:text-fg transition-colors">
                          Editar →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}

        <div className="mt-6 text-[11px] text-fg-subtle flex items-center gap-1.5">
          <Mail size={12} /> Ao convidar, o sistema envia automaticamente um e-mail com link de definição de senha.
        </div>
      </div>
    </div>
  );
}
