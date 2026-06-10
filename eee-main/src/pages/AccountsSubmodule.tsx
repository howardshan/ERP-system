import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, MetricCard, Badge } from '../components/ui/Cards';
import { Search, Plus, Filter, Wallet, Receipt, Clock, AlertTriangle } from 'lucide-react';
import { formatCurrency, cn } from '../lib/utils';

export default function AccountsSubmodule({ type }: { type: 'AP' | 'AR' }) {
  const { t } = useTranslation('finance');
  const isInbound = type === 'AR';
  
  const invoices = [
    { id: 'INV-2023-0891', entity: 'Grain Supply Co.', date: '2023-10-12', due: '2023-11-12', amount: 12450, balanced: 12450, status: 'Open' },
    { id: 'INV-2023-0888', entity: 'Protein Processing Ltd.', date: '2023-10-05', due: '2023-11-05', amount: 45000, balanced: 0, status: 'Paid' },
    { id: 'INV-2023-0902', entity: 'Global Logistics Partners', date: '2023-10-14', due: '2023-11-14', amount: 3200, balanced: 3200, status: 'Open' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
            {isInbound ? t('accountsSubmodule.titleAR') : t('accountsSubmodule.titleAP')}
          </h2>
          <p className="text-xs text-slate-500 mt-1 uppercase font-bold tracking-wider">
            {isInbound ? t('accountsSubmodule.subtitleAR') : t('accountsSubmodule.subtitleAP')}
          </p>
        </div>
        <button className="px-4 py-2 text-xs font-bold bg-blue-600 text-white rounded shadow hover:bg-blue-700 transition-colors uppercase tracking-wide flex items-center gap-2">
          <Plus size={14} /> {isInbound ? t('accountsSubmodule.createInvoice') : t('accountsSubmodule.recordInvoice')}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <MetricCard label={t('accountsSubmodule.totalOutstanding')} value="$142,550.00" icon={isInbound ? Receipt : Wallet} trend={{ value: '4.2%', isPositive: !isInbound }} />
        <MetricCard label={t('accountsSubmodule.dueToday')} value="$12,400.00" icon={Clock} />
        <div className="bg-slate-900 text-white p-6 rounded-lg flex items-center justify-between border border-white/10 shadow-lg relative overflow-hidden">
          <div className="z-10">
            <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest mb-1">{t('accountsSubmodule.riskAlert')}</p>
            <h4 className="text-xl font-bold">{t('accountsSubmodule.overdueItems', { count: 3 })}</h4>
            <p className="text-[10px] text-slate-400 font-medium mt-1">{t('accountsSubmodule.requiresControllerReview')}</p>
          </div>
          <AlertTriangle size={48} className="text-white/5 absolute -right-2 -bottom-2" />
        </div>
      </div>

      <Card className="p-0">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
           <div className="relative w-64">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder={t('accountsSubmodule.searchPlaceholder')}
              className="w-full pl-10 pr-4 py-2 text-sm bg-white border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-200">
                <th className="px-6 py-4">{t('accountsSubmodule.colInvoiceNo')}</th>
                <th className="px-6 py-4">{isInbound ? t('accountsSubmodule.colCustomer') : t('accountsSubmodule.colSupplier')}</th>
                <th className="px-6 py-4">{t('accountsSubmodule.colDate')}</th>
                <th className="px-6 py-4 text-right">{t('accountsSubmodule.colAmount')}</th>
                <th className="px-6 py-4 text-right">{t('accountsSubmodule.colBalance')}</th>
                <th className="px-6 py-4 text-center">{t('accountsSubmodule.colStatus')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map(inv => (
                <tr key={inv.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 font-bold text-sm text-blue-600 cursor-pointer">{inv.id}</td>
                  <td className="px-6 py-4 text-sm font-semibold text-slate-700">{inv.entity}</td>
                  <td className="px-6 py-4 text-xs text-slate-500 font-medium">{inv.date}</td>
                  <td className="px-6 py-4 text-right font-mono text-sm">{formatCurrency(inv.amount)}</td>
                  <td className="px-6 py-4 text-right font-mono text-sm font-bold text-slate-900">{formatCurrency(inv.balanced)}</td>
                  <td className="px-6 py-4 text-center">
                    <Badge type={inv.status === 'Paid' ? 'positive' : 'warning'}>{t(`accountsSubmodule.status.${inv.status}`)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {isInbound && (
        <Card title={t('accountsSubmodule.agingSummary')}>
          <div className="flex items-center gap-1 mt-2">
            {[
              { label: t('accountsSubmodule.aging0to30'), value: 65, color: 'bg-emerald-500' },
              { label: t('accountsSubmodule.aging31to60'), value: 20, color: 'bg-amber-500' },
              { label: t('accountsSubmodule.aging61to90'), value: 10, color: 'bg-rose-500' },
              { label: t('accountsSubmodule.aging90plus'), value: 5, color: 'bg-slate-800' },
            ].map(tier => (
              <div key={tier.label} style={{ flex: tier.value }} className="space-y-1">
                <div className={cn("h-4 rounded-sm", tier.color)} title={`${tier.label}: ${tier.value}%`} />
                <p className="text-[9px] font-bold text-slate-400 text-center uppercase tracking-tighter">{tier.label}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
