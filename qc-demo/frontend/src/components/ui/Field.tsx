import { cn } from '../../lib/utils';
import { useShellAccent } from '../../context/ShellAccentContext';
import { getTone } from './tone';

type FieldProps = {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
};

export function Field({ label, hint, error, children, className }: FieldProps) {
  return (
    <div className={cn('block', className)}>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function useControlClassName(className?: string) {
  const accent = useShellAccent();
  const t = getTone(accent);
  return cn(
    'w-full border border-slate-300 rounded-lg bg-white text-slate-900 placeholder:text-slate-400 transition-shadow',
    'focus:outline-none focus:ring-2 focus:ring-offset-0 focus:border-transparent',
    t.ring.replace('focus-visible:', 'focus:'),
    'disabled:opacity-50 disabled:bg-slate-50 min-h-[44px] px-3 py-2',
    className
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={useControlClassName(className)} {...props} />;
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={useControlClassName(className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(useControlClassName(className), 'min-h-[80px] py-3')} {...props} />;
}
