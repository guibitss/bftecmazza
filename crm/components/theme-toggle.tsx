'use client';

import { Sun, Moon } from 'lucide-react';
import { useTheme } from './theme-provider';
import { cn } from '@/lib/utils';

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      title={isDark ? 'Mudar para claro' : 'Mudar para escuro'}
      aria-label="Alternar tema"
      className={cn(
        'p-2 rounded-lg text-fg-muted hover:text-fg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors',
        className,
      )}
    >
      {isDark ? <Sun size={15} strokeWidth={1.75} /> : <Moon size={15} strokeWidth={1.75} />}
    </button>
  );
}
