import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'h-12 w-full rounded-xl bg-surface px-4 text-[15px]',
        'border border-border',
        'placeholder:text-fg-subtle',
        'transition-all duration-200',
        'hover:border-border-strong',
        'focus:outline-none focus:border-fg/40 focus:ring-4 focus:ring-fg/5',
        'disabled:opacity-60 disabled:cursor-not-allowed',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
