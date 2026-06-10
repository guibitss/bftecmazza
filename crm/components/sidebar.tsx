'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import {
  LayoutDashboard,
  Inbox as InboxIcon,
  Settings,
  LogOut,
  Sparkles,
  Headset,
  User as UserIcon,
  ClipboardList,
  Bell,
  Tag,
  Wifi,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { cn } from '@/lib/utils';
import type { CurrentUser, InboxAccess } from '@/lib/auth';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number; strokeWidth?: number }>;
  adminOnly?: boolean;
  managerOnly?: boolean;
}

const NAV: NavItem[] = [
  { href: '/',           label: 'Visão geral', icon: LayoutDashboard },
  { href: '/inbox',      label: 'Inbox',       icon: InboxIcon },
  { href: '/tratativas', label: 'Tratativas',  icon: ClipboardList },
  { href: '/alertas',    label: 'Alertas',     icon: Bell, managerOnly: true },
  { href: '/etiquetas',  label: 'Etiquetas',   icon: Tag, managerOnly: true },
  { href: '/conexoes',   label: 'Conexões',    icon: Wifi,     adminOnly: true },
  { href: '/admin',      label: 'Admin',       icon: Settings, adminOnly: true },
];

function iconForKind(kind: InboxAccess['kind']) {
  if (kind === 'ai')      return Sparkles;
  if (kind === 'support') return Headset;
  return UserIcon;
}

export function Sidebar({ user }: { user: CurrentUser }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  const visibleNav = NAV.filter((item) =>
    (!item.adminOnly  || user.isAdmin) &&
    (!item.managerOnly || user.isAdmin || user.managerOfStoreId != null),
  );
  const initials = user.name
    .split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase();

  const activeInbox = pathname.startsWith('/inbox') ? search.get('inbox') : null;

  return (
    <aside className="w-[260px] shrink-0 flex flex-col h-full hairline-r bg-white dark:bg-zinc-950">
      {/* Brand */}
      <Link href="/" className="flex items-center gap-3 px-5 h-16 hairline-b">
        <Logo size={32} />
        <div className="leading-tight">
          <div className="text-[13px] font-semibold tracking-tight">BF Tec Mazza</div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-fg-subtle">CRM</div>
        </div>
      </Link>

      {/* Conteúdo com scroll próprio */}
      <div className="flex-1 overflow-y-auto min-h-0">
      <div className="px-5 pt-6 pb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-fg-subtle">
        Navegação
      </div>
      <nav className="flex flex-col gap-px px-3">
        {visibleNav.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href) && !activeInbox);
          return (
            <Link key={item.href} href={item.href} className={cn(
              'group relative flex items-center gap-3 px-3 py-2.5 rounded-xl',
              'text-[13.5px] font-medium transition-all duration-150',
              active
                ? 'bg-surface-muted text-fg'
                : 'text-fg-muted hover:text-fg hover:bg-surface-muted/60',
            )}>
              {active && (
                <span aria-hidden className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full bg-fg" />
              )}
              <Icon size={16} strokeWidth={1.75} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Caixas agrupadas por loja */}
      {user.groups.length > 0 && (
        <div className="mt-2 pb-2">
          {user.groups.map(group => (
            <div key={group.storeId} className="mt-4">
              <div className="px-5 pb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-fg-subtle">
                {group.storeSlug}
              </div>
              <div className="flex flex-col gap-px px-3">
                {group.inboxes.map(ib => {
                  const Icon = iconForKind(ib.kind);
                  const href = `/inbox?inbox=${ib.inboxId}`;
                  const active = activeInbox === String(ib.inboxId);
                  return (
                    <Link key={ib.inboxId} href={href} className={cn(
                      'group relative flex items-center gap-2.5 px-3 py-1.5 rounded-lg',
                      'text-[12.5px] transition-all duration-150',
                      active
                        ? 'bg-surface-muted text-fg'
                        : 'text-fg-muted hover:text-fg hover:bg-surface-muted/60',
                    )}>
                      <Icon size={13} strokeWidth={1.75} className={cn(
                        ib.kind === 'ai' && 'text-fg-subtle',
                      )} />
                      <span className="truncate flex-1">{ib.displayName}</span>
                      {ib.canManage && (
                        <span className="text-[9px] uppercase tracking-wider text-fg-subtle">★</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      </div>

      {/* User card — sempre no fim, fora do scroll */}
      <div className="hairline-t bg-white dark:bg-zinc-950 px-3 py-3">
        <div className="flex items-center gap-3 p-2.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
          <div className="relative w-10 h-10 rounded-full overflow-hidden bg-ink-950 text-white grid place-items-center text-[13px] font-semibold tracking-tight shadow-inner">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium truncate leading-tight">{user.name}</div>
            <div className="text-[10.5px] uppercase tracking-[0.1em] text-fg-subtle truncate mt-0.5">
              {user.isAdmin ? 'admin' : `${user.inboxes.length} caixa${user.inboxes.length === 1 ? '' : 's'}`}
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <ThemeToggle />
            <button type="button" onClick={handleLogout} disabled={loggingOut} title="Sair"
              className="p-2 rounded-lg text-fg-muted hover:text-fg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50">
              <LogOut size={15} strokeWidth={1.75} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
