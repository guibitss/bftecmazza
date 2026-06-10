import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Clock, LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { LogoBadge } from '@/components/logo';
import { Ambient } from '@/components/ambient';
import { Button } from '@/components/ui/button';
import LogoutButton from './logout-button';

export default async function AguardandoAprovacaoPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('app_users')
    .select('name, email, status, active')
    .eq('id', user.id)
    .maybeSingle();

  // se já aprovado/rejeitado/sem perfil, sai daqui
  if (!profile || profile.status === 'approved') redirect('/');
  const rejected = profile.status === 'rejected' || !profile.active;

  return (
    <div className="relative min-h-screen flex flex-col">
      <Ambient />
      <main className="flex-1 grid place-items-center px-6 py-16">
        <div className="w-full max-w-[440px] flex flex-col items-center text-center animate-slide-up">
          <LogoBadge size={64} animated={false} />

          <h1 className="mt-8 text-[32px] leading-[1.1] font-semibold tracking-[-0.04em]">
            {rejected ? 'Acesso negado' : 'Aguardando aprovação'}
          </h1>

          <div className={`mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-medium ${
            rejected
              ? 'bg-red-500/10 text-red-700 dark:text-red-300 border border-red-500/20'
              : 'bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20'
          }`}>
            <Clock size={12} />
            <span>{profile.email}</span>
          </div>

          <p className="mt-6 text-[14px] text-fg-muted max-w-sm leading-relaxed">
            {rejected
              ? 'Sua solicitação foi negada ou seu acesso foi desativado. Entre em contato com o administrador.'
              : 'Sua solicitação está em análise pelo administrador. Você receberá acesso assim que for aprovado.'}
          </p>

          <div className="mt-10">
            <LogoutButton />
          </div>
        </div>
      </main>
    </div>
  );
}
