import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center py-12 px-4 rounded-xl border border-dashed border-slate-200 bg-slate-50/50',
        className
      )}
    >
      {Icon && (
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white ring-1 ring-slate-200">
          <Icon className="h-6 w-6 text-slate-400" aria-hidden />
        </div>
      )}
      <p className="font-medium text-slate-700">{title}</p>
      {description && <p className="text-sm text-slate-500 mt-1 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
