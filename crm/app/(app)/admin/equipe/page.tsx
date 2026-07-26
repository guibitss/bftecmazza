import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getCurrentUser } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card } from '@/components/ui/card';
import { ChevronLeft, Users, ShieldCheck, Sparkles } from 'lucide-react';
import { phoneNorm, phoneDisplay } from '@/lib/phone';
import { AddForm, SuggestionRow, RemoveButton } from './equipe-ui';

export default async function EquipePage() {
  const user = await getCurrentUser();
  if (!user.isAdmin) redirect('/');

  const admin = createAdminClient();

  const [{ data: internos }, { data: vendors }, { data: sugRaw }] = await Promise.all([
    admin.from('internal_contacts').select('phone_norm, nome, motivo, created_at').order('created_at', { ascending: false }),
    admin.from('vendors').select('id, name, summary_chat').eq('active', true),
    // Sugestões: contatos com nome "de loja" que provavelmente são equipe
    admin.from('conversations')
      .select('customer_phone, customer_name')
      .not('customer_phone', 'is', null)
      .or('customer_name.ilike.%bf tec%,customer_name.ilike.%bftec%,customer_name.ilike.%bfcm%,customer_name.ilike.%mazza%')
      .limit(300),
  ]);

  const registrados = new Set((internos ?? []).map(c => c.phone_norm as string));
  const vendorNorms = new Set(
    (vendors ?? []).map(v => phoneNorm(v.summary_chat as string)).filter(Boolean),
  );

  // Dedup das sugestões por telefone normalizado, tirando já-cadastrados e vendedoras
  const sugMap = new Map<string, { phone: string; name: string | null }>();
  for (const c of sugRaw ?? []) {
    const norm = phoneNorm(c.customer_phone as string);
    if (!norm || norm.length < 10) continue;
    if (registrados.has(norm) || vendorNorms.has(norm)) continue;
    if (!sugMap.has(norm)) sugMap.set(norm, { phone: c.customer_phone as string, name: c.customer_name as string | null });
  }
  const sugestoes = Array.from(sugMap.values()).slice(0, 12);

  return (
    <div className="min-h-screen">
      <div className="hairline-b">
        <div className="h-16 px-8 flex items-center gap-4">
          <Link href="/admin" className="text-fg-subtle hover:text-fg transition-colors">
            <ChevronLeft size={16} />
          </Link>
          <div className="text-[10px] uppercase tracking-[0.18em] text-fg-subtle">Admin · Equipe</div>
        </div>
      </div>

      <div className="px-8 py-12 max-w-3xl mx-auto">
        <div className="mb-10 animate-slide-up">
          <div className="w-12 h-12 rounded-2xl border border-border bg-surface-muted grid place-items-center text-fg-muted mb-5">
            <Users size={20} strokeWidth={1.5} />
          </div>
          <h1 className="text-[38px] leading-[1.05] font-semibold tracking-[-0.04em]">
            Contatos da equipe
          </h1>
          <p className="mt-3 text-[14px] text-fg-muted max-w-xl leading-relaxed">
            A caixa da vendedora recebe TODO o WhatsApp dela — inclusive sócios, estoque, colegas.
            Esses números não são clientes: cadastrados aqui, saem da análise e das métricas, e param
            de puxar as notas pra baixo. As próprias vendedoras já são ignoradas automaticamente.
          </p>
        </div>

        {/* Cadastro manual */}
        <Card className="p-5 mb-6 animate-slide-up">
          <div className="text-[11px] uppercase tracking-[0.12em] text-fg-subtle mb-3">
            Cadastrar número da equipe
          </div>
          <AddForm />
        </Card>

        {/* Sugestões do sistema */}
        {sugestoes.length > 0 && (
          <Card className="p-5 mb-6 animate-slide-up">
            <div className="text-[11px] uppercase tracking-[0.12em] text-fg-subtle flex items-center gap-2 mb-1">
              <Sparkles size={12} /> Provavelmente são da equipe
            </div>
            <p className="text-[12px] text-fg-muted mb-3">
              O sistema achou esses contatos com nome da loja salvos nas caixas. Confirme os que forem equipe.
            </p>
            <div className="divide-y divide-border/60">
              {sugestoes.map(s => (
                <SuggestionRow key={s.phone} phone={s.phone} name={s.name} />
              ))}
            </div>
          </Card>
        )}

        {/* Cadastrados */}
        <Card className="p-5 animate-slide-up">
          <div className="text-[11px] uppercase tracking-[0.12em] text-fg-subtle flex items-center gap-2 mb-3">
            <ShieldCheck size={12} /> Cadastrados como equipe ({internos?.length ?? 0})
          </div>
          {(internos ?? []).length === 0 ? (
            <div className="py-6 text-center text-[12.5px] text-fg-muted">
              Nenhum contato interno cadastrado ainda.
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {(internos ?? []).map(c => (
                <div key={c.phone_norm} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium truncate">{c.nome || 'Sem nome'}</div>
                    <div className="text-[11.5px] text-fg-subtle num">
                      {phoneDisplay(c.phone_norm as string)}
                      {c.motivo ? <span className="text-fg-subtle"> · {c.motivo}</span> : null}
                    </div>
                  </div>
                  <RemoveButton phoneNorm={c.phone_norm as string} />
                </div>
              ))}
            </div>
          )}
        </Card>

        <p className="mt-4 text-[11px] text-fg-subtle leading-relaxed">
          As {vendorNorms.size} linhas de vendedoras já são excluídas automaticamente (uma vendedora
          falando com outra não conta como atendimento).
        </p>
      </div>
    </div>
  );
}
