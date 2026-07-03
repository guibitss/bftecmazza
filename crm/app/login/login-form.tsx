'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ArrowRight, AlertCircle } from 'lucide-react';

export default function LoginForm() {
  const search = useSearchParams();
  const next = search.get('next') ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      setError(
        signInError.message === 'Invalid login credentials'
          ? 'E-mail ou senha incorretos'
          : signInError.message,
      );
      setLoading(false);
      return;
    }

    // Navegação completa única: garante cookies frescos no SSR sem o
    // par push+refresh, que disparava múltiplos round trips RSC
    window.location.assign(next);
  }

  return (
    <form onSubmit={handleLogin} className="space-y-5">
      <div className="space-y-1.5">
        <label htmlFor="email" className="block text-[11px] font-medium text-fg-muted uppercase tracking-[0.12em]">
          E-mail
        </label>
        <Input
          id="email"
          type="email"
          required
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="voce@email.com"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="block text-[11px] font-medium text-fg-muted uppercase tracking-[0.12em]">
          Senha
        </label>
        <Input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 text-[13px] text-red-700 dark:text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-3.5 py-2.5 animate-fade-in">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <Button type="submit" disabled={loading} size="lg" className="w-full mt-2">
        {loading ? (
          'Entrando…'
        ) : (
          <>
            Continuar
            <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
          </>
        )}
      </Button>
    </form>
  );
}
