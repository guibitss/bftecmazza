import { cn } from '@/lib/utils';
import { LogoMark } from './logo-mark';

/**
 * Logo oficial BF Tec Mazza. Herda a cor via `fill="currentColor"` no SVG —
 * fica preta em light, branca em dark, ou na `tone` que você travar.
 */
export function Logo({
  className,
  size = 32,
  tone = 'auto',
}: {
  className?: string;
  size?: number;
  tone?: 'auto' | 'dark' | 'light';
}) {
  const colorClass =
    tone === 'dark'  ? 'text-ink-950' :
    tone === 'light' ? 'text-white' :
    'text-fg';

  return <LogoMark size={size} className={cn(colorClass, className)} />;
}

/**
 * Versão "selo": logo dentro de quadrado preto vitrificado com brilho
 * superior, edge highlight Apple-style e shine sweep opcional.
 */
export function LogoBadge({
  className,
  size = 64,
  animated = false,
  padding = 0.22,
}: {
  className?: string;
  size?: number;
  animated?: boolean;
  padding?: number;
}) {
  const inner = Math.round(size * (1 - padding * 2));
  return (
    <span
      className={cn(
        'relative inline-flex items-center justify-center rounded-[28%]',
        'overflow-hidden select-none',
        'bg-[radial-gradient(120%_120%_at_30%_20%,oklch(0.30_0_0),oklch(0.04_0_0))]',
        'dark:bg-[radial-gradient(120%_120%_at_30%_20%,oklch(0.40_0_0),oklch(0_0_0))]',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <span aria-hidden className="absolute inset-0 rounded-[28%] ring-1 ring-inset ring-white/[0.06]" />
      <span aria-hidden className="absolute inset-x-3 bottom-0 h-1/3 rounded-b-[28%] bg-gradient-to-t from-white/[0.03] to-transparent" />

      <Logo size={inner} tone="light" />

      {animated && (
        <span
          aria-hidden
          className="absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shine"
        />
      )}
    </span>
  );
}
