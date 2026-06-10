'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { Sidebar } from '@/components/sidebar';
import { Logo } from '@/components/logo';
import type { CurrentUser } from '@/lib/auth';
import { cn } from '@/lib/utils';

export function AppShell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Fecha drawer ao navegar
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  // ESC fecha drawer
  useEffect(() => {
    if (!drawerOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [drawerOpen]);

  return (
    <div className="relative h-dvh flex overflow-hidden">
      {/* Sidebar desktop (>= md) */}
      <div className="hidden md:flex">
        <Sidebar user={user} />
      </div>

      {/* Drawer mobile */}
      <div
        className={cn(
          'md:hidden fixed inset-0 z-40 transition-opacity duration-200',
          drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
        aria-hidden={!drawerOpen}
      >
        <div
          className="absolute inset-0 bg-black/40"
          onClick={() => setDrawerOpen(false)}
        />
        <div
          className={cn(
            'absolute left-0 top-0 bottom-0 transition-transform duration-300 ease-out',
            drawerOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <Sidebar user={user} />
        </div>
      </div>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        {/* Top bar mobile */}
        <div className="md:hidden sticky top-0 z-30 h-14 flex items-center gap-3 px-3 hairline-b bg-surface/85 backdrop-blur-md">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="p-2 -ml-1 rounded-lg hover:bg-surface-muted transition-colors"
            aria-label="Abrir menu"
          >
            <Menu size={20} strokeWidth={1.75} />
          </button>
          <Logo size={24} />
          <span className="text-[13px] font-semibold tracking-tight">BF Tec Mazza</span>
        </div>

        {/* Inbox precisa de altura fixa (sem scroll no main) para o composer ficar preso no fundo.
            Outras páginas ganham um wrapper com scroll vertical. */}
        {pathname.startsWith('/inbox') ? (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {children}
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto">
            {children}
          </div>
        )}
      </main>

      {/* Close button no drawer (no canto) */}
      {drawerOpen && (
        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          className="md:hidden fixed top-3 right-3 z-50 p-2 rounded-lg bg-surface hairline hover:bg-surface-muted transition-colors"
          aria-label="Fechar menu"
        >
          <X size={18} strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}
