import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useShellAccent } from '../../context/ShellAccentContext';
import { getTone } from './tone';
import type { ShellAccent } from '../../context/ShellAccentContext';

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'lg';
  tone?: ShellAccent;
  loading?: boolean;
  fullWidth?: boolean;
};

export function Button({
  variant = 'primary',
  size = 'md',
  tone,
  loading,
  fullWidth,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  const shellAccent = useShellAccent();
  const accent = tone ?? shellAccent;
  const t = getTone(accent);

  const base =
    'inline-flex items-center justify-center gap-2 font-medium rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none';

  const sizes = {
    md: 'min-h-[44px] px-4 py-2 text-sm',
    lg: 'min-h-[52px] px-5 py-3 text-base',
  };

  const variants = {
    primary: t.primary,
    secondary:
      'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 focus-visible:ring-slate-400',
    ghost: 'bg-transparent text-slate-700 hover:bg-slate-100 focus-visible:ring-slate-400',
    danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500',
  };

  return (
    <button
      type={type}
      className={cn(base, sizes[size], variants[variant], fullWidth && 'w-full', className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />}
      {children}
    </button>
  );
}
