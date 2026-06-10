import { Suspense } from 'react';
import SignupForm from './signup-form';
import { LogoBadge } from '@/components/logo';
import { Ambient } from '@/components/ambient';

export default function SignupPage() {
  return (
    <div className="relative min-h-screen flex flex-col">
      <Ambient />
      <main className="flex-1 grid place-items-center px-6 py-16">
        <div className="w-full max-w-[420px] flex flex-col items-center">
          <div className="flex flex-col items-center text-center animate-slide-up">
            <LogoBadge size={64} animated />
            <h1 className="mt-8 text-[40px] leading-[1.05] font-semibold tracking-[-0.04em]">
              Criar conta
            </h1>
            <p className="mt-3 text-[14px] text-fg-muted max-w-sm">
              Depois do cadastro, o administrador precisa aprovar seu acesso antes do primeiro login.
            </p>
          </div>

          <div className="w-full mt-10 glass-strong rounded-3xl p-8 animate-slide-up" style={{ animationDelay: '120ms' }}>
            <Suspense fallback={<div className="h-48 grid place-items-center text-sm text-fg-muted">Carregando…</div>}>
              <SignupForm />
            </Suspense>
          </div>

          <a href="/login" className="mt-6 text-[12px] text-fg-muted hover:text-fg transition-colors animate-fade-in" style={{ animationDelay: '280ms' }}>
            Já tenho conta · Entrar
          </a>
        </div>
      </main>
    </div>
  );
}
