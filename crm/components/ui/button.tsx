import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const button = cva(
  [
    'group relative inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'rounded-full font-medium tracking-tight',
    'transition-all duration-300 ease-out',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fg/30 focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
    'disabled:opacity-50 disabled:pointer-events-none',
    'overflow-hidden',
  ],
  {
    variants: {
      variant: {
        // Preto profundo com brilho superior (Apple "Buy" button)
        primary: [
          'bg-ink-950 text-white',
          'shadow-[inset_0_1px_0_oklch(1_0_0/0.18),0_1px_2px_oklch(0_0_0/0.2),0_8px_24px_-6px_oklch(0_0_0/0.3)]',
          'hover:shadow-[inset_0_1px_0_oklch(1_0_0/0.22),0_2px_4px_oklch(0_0_0/0.25),0_16px_36px_-8px_oklch(0_0_0/0.4)]',
          'hover:-translate-y-px active:translate-y-0',
          'dark:bg-white dark:text-ink-950',
          'dark:shadow-[inset_0_1px_0_oklch(1_0_0/0.5),0_1px_2px_oklch(0_0_0/0.4),0_8px_24px_-6px_oklch(0_0_0/0.5)]',
        ],
        // Glass branco com hairline
        secondary: [
          'glass text-fg',
          'hover:bg-surface-muted',
        ],
        // Sem fundo
        ghost: [
          'text-fg-muted hover:text-fg hover:bg-surface-muted',
        ],
        danger: [
          'bg-red-500 text-white',
          'hover:bg-red-600',
        ],
      },
      size: {
        sm:  'h-8  px-3.5 text-[13px]',
        md:  'h-10 px-5   text-sm',
        lg:  'h-12 px-7   text-[15px]',
        icon:'h-9  w-9',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {}

export function Button({ className, variant, size, children, ...props }: ButtonProps) {
  return (
    <button className={cn(button({ variant, size }), className)} {...props}>
      {/* sheen line on primary */}
      {variant !== 'ghost' && variant !== 'secondary' && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent"
        />
      )}
      <span className="relative inline-flex items-center gap-2">{children}</span>
    </button>
  );
}
