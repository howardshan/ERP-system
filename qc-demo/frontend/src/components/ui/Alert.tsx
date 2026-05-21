import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../../lib/utils';

type AlertVariant = 'success' | 'error' | 'info';

const styles: Record<AlertVariant, string> = {
  success: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  error: 'bg-red-50 text-red-900 border-red-200',
  info: 'bg-slate-50 text-slate-800 border-slate-200',
};

const icons: Record<AlertVariant, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
};

export function Alert({
  variant,
  children,
  onDismiss,
  className,
}: {
  variant: AlertVariant;
  children: React.ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const Icon = icons[variant];
  return (
    <div
      role="alert"
      className={cn('flex gap-3 rounded-lg border p-3 text-sm', styles[variant], className)}
    >
      <Icon className="h-5 w-5 shrink-0 mt-0.5" aria-hidden />
      <div className="flex-1 min-w-0">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 p-1 rounded-md hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
