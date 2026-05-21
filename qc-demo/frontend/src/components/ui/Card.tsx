import { cn } from '../../lib/utils';

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: 'elevated' | 'outline' | 'interactive';
  accent?: boolean;
};

export function Card({ variant = 'elevated', accent, className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl bg-white',
        variant === 'elevated' && 'shadow-sm ring-1 ring-slate-200/80',
        variant === 'outline' && 'border border-slate-200',
        variant === 'interactive' &&
          'shadow-sm ring-1 ring-slate-200/80 transition-shadow hover:shadow-md hover:ring-slate-300/80',
        accent && 'border-2 ring-2',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}
