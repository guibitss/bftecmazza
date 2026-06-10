'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { ConversationList } from './conversation-list';
import { Thread } from './thread';
import { ArrowLeft, Inbox as InboxIcon } from 'lucide-react';
import type { InboxGroup, InboxAccess } from '@/lib/auth';
import { cn } from '@/lib/utils';

interface Props {
  userId: string;
  isAdmin: boolean;
  groups: InboxGroup[];
}

export function InboxShell({ groups }: Props) {
  const router = useRouter();
  const search = useSearchParams();
  const inboxId = search.get('inbox');
  const convId  = search.get('conv');

  const allInboxes: InboxAccess[] = useMemo(
    () => groups.flatMap(g => g.inboxes),
    [groups],
  );

  const currentInbox = allInboxes.find(i => String(i.inboxId) === inboxId) ?? null;

  function selectConv(id: number | null) {
    const sp = new URLSearchParams(search.toString());
    if (id) sp.set('conv', String(id)); else sp.delete('conv');
    router.push(`/inbox?${sp.toString()}`, { scroll: false });
  }

  // Sem nenhuma caixa atribuída
  if (allInboxes.length === 0) {
    return (
      <div className="flex-1 grid place-items-center px-6">
        <div className="text-center max-w-sm">
          <InboxIcon size={32} className="mx-auto text-fg-subtle" strokeWidth={1.5} />
          <h2 className="mt-4 text-[18px] font-medium tracking-tight">Nenhuma caixa</h2>
          <p className="mt-2 text-[13px] text-fg-muted">
            Peça ao administrador pra liberar acesso a uma caixa de entrada.
          </p>
        </div>
      </div>
    );
  }

  // Nenhuma inbox selecionada → empty state com sugestão
  if (!currentInbox) {
    return (
      <div className="flex-1 grid place-items-center px-6">
        <div className="text-center max-w-sm">
          <InboxIcon size={32} className="mx-auto text-fg-subtle" strokeWidth={1.5} />
          <h2 className="mt-4 text-[18px] font-medium tracking-tight">Selecione uma caixa</h2>
          <p className="mt-2 text-[13px] text-fg-muted">
            Escolha na barra lateral para ver as conversas.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-w-0 min-h-0 overflow-hidden">
      {/* COLUNA 1: lista de conversas — visível em desktop sempre; mobile só quando não há conv */}
      <aside
        className={cn(
          'w-full md:w-[340px] lg:w-[380px] shrink-0 flex flex-col min-h-0 overflow-hidden md:hairline-r',
          convId && 'hidden md:flex',
        )}
      >
        <ConversationList
          inbox={currentInbox}
          selectedConvId={convId ? Number(convId) : null}
          onSelect={selectConv}
        />
      </aside>

      {/* COLUNA 2: thread — visível em desktop sempre; mobile só quando há conv
          h-[calc(100dvh-3.5rem)] = viewport – mobile top bar (h-14 = 3.5rem)
          md:h-dvh = no top bar on desktop */}
      <section
        className={cn(
          'flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden',
          'h-[calc(100dvh-3.5rem)] md:h-dvh',
          !convId && 'hidden md:flex',
        )}
      >
        {convId ? (
          <Thread
            convId={Number(convId)}
            inbox={currentInbox}
            sendableInboxes={allInboxes.filter(i => i.storeId === currentInbox.storeId && i.canSend)}
            onBack={() => selectConv(null)}
          />
        ) : (
          <div className="flex-1 grid place-items-center text-center text-fg-muted">
            <div className="max-w-xs">
              <div className="text-[13px]">Selecione uma conversa à esquerda.</div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
