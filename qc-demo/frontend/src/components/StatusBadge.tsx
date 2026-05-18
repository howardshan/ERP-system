import { STATUS_COLOR, STATUS_LABEL } from '../lib/utils';
import { cn } from '../lib/utils';

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold border',
        STATUS_COLOR[status] ?? 'bg-slate-100 text-slate-700'
      )}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
