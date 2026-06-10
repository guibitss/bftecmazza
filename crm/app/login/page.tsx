import { Suspense } from 'react';
import LoginForm from './login-form';
import { Logo, LogoBadge } from '@/components/logo';
import { Ambient } from '@/components/ambient';

export default function LoginPage() {
  return (
    <div className="relative min-h-screen flex flex-col">
      <Ambient />

      <main className="flex-1 grid place-items-center px-6 py-16">
        <div className="w-full max-w-[420px] flex flex-col items-center">

          {/* HERO */}
          <div className="flex flex-col items-center text-center animate-slide-up">
            <LogoBadge size={64} animated />

            <h1
              className="mt-8 text-[44px] leading-[1.05] font-semibold tracking-[-0.04em]"
              style={{ fontFeatureSettings: '"ss01"' }}
            >
              BF Tec Mazza
            </h1>

            <div className="mt-3 flex items-center gap-2 text-[13px] text-fg-muted">
              <span className="inline-block w-1 h-1 rounded-full bg-fg-subtle" />
              <span className="tracking-wide">Apple Authorized Reseller</span>
              <span className="inline-block w-1 h-1 rounded-full bg-fg-subtle" />
            </div>

            <p className="mt-6 text-[15px] text-fg-muted max-w-sm">
              Painel de atendimento e gestão das lojas.
              Acesso restrito à equipe.
            </p>
          </div>

          {/* GLASS CARD */}
          <div
            className="w-full mt-10 glass-strong rounded-3xl p-8 animate-slide-up"
            style={{ animationDelay: '120ms' }}
          >
            <Suspense fallback={<div className="h-48 grid place-items-center text-sm text-fg-muted">Carregando…</div>}>
              <LoginForm />
            </Suspense>
          </div>

          {/* CTA signup */}
          <a
            href="/signup"
            className="mt-6 text-[12px] text-fg-muted hover:text-fg transition-colors animate-fade-in"
            style={{ animationDelay: '240ms' }}
          >
            Não tem conta? <span className="underline">Solicitar acesso</span>
          </a>

          {/* footnote */}
          <div
            className="mt-6 text-[11px] uppercase tracking-[0.15em] text-fg-subtle animate-fade-in"
            style={{ animationDelay: '320ms' }}
          >
            v1.0 · Chateau Labs
          </div>
        </div>
      </main>
    </div>
  );
}
