'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';

export default function SignupForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);

    const supabase = createClient();
    const { data, error: signErr } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: { data: { name: name.trim() } },
    });

    if (signErr) {
      setError(signErr.message); setLoading(false); return;
    }

    // cria o perfil em app_users com status=pending (RLS permite SELF insert)
    if (data.user) {
      const { error: pErr } = await supabase.from('app_users').insert({
        id: data.user.id,
        email: email.trim().toLowerCase(),
        name: name.trim(),
        is_admin: false,
        active: true,
        // status default = 'pending'
      });
      if (pErr && !pErr.message.includes('duplicate')) {
        setError(`Perfil: ${pErr.message}`); setLoading(false); return;
      }
    }

    setDone(true); setLoading(false);
  }

  if (done) {
    return (
      <div className="text-center py-6 animate-fade-in space-y-4">
        <CheckCircle2 size={40} className="mx-auto text-emerald-500" strokeWidth={1.5} />
        <div>
          <h3 className="text-[16px] font-semibold tracking-tight">Conta criada</h3>
          <p className="text-[13px] text-fg-muted mt-2 max-w-xs mx-auto">
            Você receberá acesso assim que o administrador revisar e aprovar sua solicitação.
          </p>
        </div>
        <Button type="button" variant="secondary" size="md" onClick={() => router.push('/login')}>
          Voltar para login <ArrowRight size={14} />
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSignup} className="space-y-5">
      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-fg-muted uppercase tracking-[0.12em]">Nome completo</label>
        <Input value={name} onChange={e => setName(e.target.value)} required autoFocus placeholder="Maria Silva" />
      </div>
      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-fg-muted uppercase tracking-[0.12em]">E-mail</label>
        <Input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" placeholder="voce@email.com" />
      </div>
      <div className="space-y-1.5">
        <label className="text-[11px] font-medium text-fg-muted uppercase tracking-[0.12em]">Senha</label>
        <Input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} autoComplete="new-password" placeholder="mínimo 6 caracteres" />
      </div>

      {error && (
        <div className="flex items-start gap-2 text-[13px] text-red-700 dark:text-red-300 bg-red-500/10 border border-red-500/20 rounded-xl px-3.5 py-2.5">
          <AlertCircle size={15} className="mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      <Button type="submit" disabled={loading} size="lg" className="w-full">
        {loading ? 'Criando…' : (<>Solicitar acesso <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" /></>)}
      </Button>
    </form>
  );
}
