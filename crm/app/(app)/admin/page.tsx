import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card } from '@/components/ui/card';
import { Users, Building2, MessageSquare, Clock, ChevronRight, UserCheck, Tag, Wifi } from 'lucide-react';

export default async function AdminHome() {
  const user = await getCurrentUser();
  if (!user.isAdmin) redirect('/');

  // Contagem de solicitações pendentes (pra badge)
  const admin = createAdminClient();
  const { count: pendingCount } = await admin
    .from('app_users')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending');

  const SECTIONS = [
    {
      href: '/admin/solicitacoes',
      icon: UserCheck,
      title: 'Solicitações pendentes',
      desc: 'Aprovar/negar acesso de novas pessoas que se cadastraram',
      available: true,
      badge: pendingCount && pendingCount > 0 ? pendingCount : null,
    },
    {
      href: '/admin/usuarios',
      icon: Users,
      title: 'Usuários',
      desc: 'Gerenciar quem já tem acesso',
      available: true,
      badge: null,
    },
    {
      href: '/etiquetas',
      icon: Tag,
      title: 'Etiquetas',
      desc: 'Criar e editar etiquetas para classificar conversas por loja',
      available: true,
      badge: null,
    },
    {
      href: '/conexoes',
      icon: Wifi,
      title: 'Conexões',
      desc: 'Status das sessões de mensagens e reconexão via QR code',
      available: true,
      badge: null,
    },
    {
      href: '/admin/lojas',
      icon: Building2,
      title: 'Lojas',
      desc: 'Editar dados, sessões WAHA e endereços',
      available: false,
      badge: null,
    },
    {
      href: '/admin/prompts',
      icon: MessageSquare,
      title: 'Prompts da IA',
      desc: 'Editar instruções da Secretária por loja',
      available: false,
      badge: null,
    },
    {
      href: '/admin/horarios',
      icon: Clock,
      title: 'Horários',
      desc: 'Janelas de atendimento e saudações',
      available: false,
      badge: null,
    },
  ];

  return (
    <div className="min-h-screen">
      <div className="hairline-b">
        <div className="h-16 px-8 flex items-center">
          <div className="text-[10px] uppercase tracking-[0.18em] text-fg-subtle">Administração</div>
        </div>
      </div>

      <div className="px-8 py-12 max-w-5xl mx-auto">
        <div className="mb-12 animate-slide-up">
          <h1 className="text-[44px] leading-[1.05] font-semibold tracking-[-0.04em]">
            Configurações do sistema
          </h1>
          <p className="mt-4 text-[15px] text-fg-muted max-w-xl">
            Controle quem acessa o que. Aprovar solicitações, atribuir caixas e ajustar regras por loja.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {SECTIONS.map((s, i) => {
            const Icon = s.icon;
            const content = (
              <Card
                className={`group relative p-6 transition-all duration-300 ${
                  s.available
                    ? 'hover:-translate-y-1 hover:border-border-strong cursor-pointer'
                    : 'opacity-60'
                } animate-slide-up`}
                style={{ animationDelay: `${i * 60}ms` }}
              >
                <div className="flex items-start gap-4">
                  <div className="w-11 h-11 rounded-xl border border-border bg-surface-muted grid place-items-center text-fg-muted group-hover:text-fg group-hover:bg-surface transition-colors">
                    <Icon size={18} strokeWidth={1.75} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[15px] font-medium tracking-tight">{s.title}</h3>
                      {s.badge != null && (
                        <span className="bg-red-500 text-white text-[10px] font-semibold px-1.5 py-0.5 rounded-full min-w-[18px] text-center num">
                          {s.badge}
                        </span>
                      )}
                      {!s.available && (
                        <span className="text-[9px] uppercase tracking-[0.15em] text-fg-subtle border border-border rounded px-1.5 py-0.5">
                          em breve
                        </span>
                      )}
                    </div>
                    <p className="text-[13px] text-fg-muted mt-1 leading-relaxed">{s.desc}</p>
                  </div>
                  {s.available && (
                    <ChevronRight size={16} className="text-fg-subtle group-hover:text-fg group-hover:translate-x-0.5 transition-all mt-1" />
                  )}
                </div>
              </Card>
            );
            return s.available
              ? <Link key={s.href} href={s.href}>{content}</Link>
              : <div key={s.href}>{content}</div>;
          })}
        </div>
      </div>
    </div>
  );
}
