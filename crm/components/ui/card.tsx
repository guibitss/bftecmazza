import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-3xl border border-border bg-surface',
        'shadow-[0_1px_0_oklch(1_0_0/0.5)_inset,0_1px_2px_oklch(0_0_0/0.03),0_8px_24px_-12px_oklch(0_0_0/0.08)]',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Versão vidro/glass do Card — usar quando estiver flutuando sobre o Ambient.
 */
export function GlassCard({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-3xl glass',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-6 pt-6 pb-3', className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('text-xs font-medium uppercase tracking-[0.08em] text-fg-muted', className)} {...props} />
  );
}
export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-6 pb-6', className)} {...props} />;
}
