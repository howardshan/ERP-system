import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  key?: string | number;
}

export function Card({ children, className, title }: CardProps) {
  return (
    <div className={cn("bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden", className)}>
      {title && (
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <h3 className="text-sm font-bold text-slate-800 uppercase tracking-tight">{title}</h3>
        </div>
      )}
      <div className="p-6">
        {children}
      </div>
    </div>
  );
}

interface MetricCardProps {
  label: string;
  value: string;
  icon: React.ElementType;
  trend?: {
    value: string;
    isPositive: boolean;
  };
  className?: string;
}

export function MetricCard({ label, value, icon: Icon, trend, className }: MetricCardProps) {
  const { t } = useTranslation('ui');
  return (
    <div className={cn("bg-white p-6 border border-slate-200 rounded-lg shadow-sm flex items-start justify-between", className)}>
      <div>
        <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">{label}</p>
        <h4 className="text-2xl font-bold text-slate-900">{value}</h4>
        {trend && (
          <p className={cn(
            "text-[10px] font-bold mt-2",
            trend.isPositive ? "text-emerald-600" : "text-rose-600"
          )}>
            {trend.isPositive ? '↑' : '↓'} {trend.value} <span className="text-slate-400 font-normal">{t('cards.vsLastPeriod')}</span>
          </p>
        )}
      </div>
      <div className="p-3 bg-blue-50 text-blue-600 rounded-lg">
        <Icon size={20} />
      </div>
    </div>
  );
}

export function Badge({ children, type = 'neutral' }: { children: React.ReactNode, type?: 'positive' | 'negative' | 'warning' | 'neutral' | 'info' }) {
  const styles = {
    positive: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    negative: 'bg-rose-50 text-rose-700 border-rose-100',
    warning: 'bg-amber-50 text-amber-700 border-amber-100',
    neutral: 'bg-slate-50 text-slate-600 border-slate-200',
    info: 'bg-blue-50 text-blue-700 border-blue-100',
  };

  return (
    <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tight border", styles[type])}>
      {children}
    </span>
  );
}
