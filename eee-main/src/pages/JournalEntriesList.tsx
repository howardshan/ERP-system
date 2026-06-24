import React, { useState, useEffect, useCallback } from 'react';
import { Card, Badge } from '../components/ui/Cards';
import { Search, Pencil, Eye, ChevronLeft, ChevronRight, Loader2, Plus } from 'lucide-react';
import { formatCurrency } from '../lib/utils';
import { JournalEntry } from '../types';
import { getJournalEntries } from '../services/api';
import { usePermissions } from '../contexts/PermissionContext';
import { useTranslation } from 'react-i18next';

const PAGE_SIZE = 20;

const statusColor: Record<string, 'positive' | 'neutral' | 'negative' | 'warning'> = {
  posted: 'positive',
  draft: 'neutral',
  reversed: 'negative',
};

export default function JournalEntriesList({ onNavigate }: { onNavigate?: (screen: string) => void }) {
  const { t } = useTranslation('finance');
  const { can } = usePermissions();
  const canCreate = can('finance', 'journal_entry', 'create');
  const canEdit   = can('finance', 'journal_entry', 'edit');
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getJournalEntries({
        status: statusFilter || undefined,
        search: search || undefined,
        page,
        pageSize: PAGE_SIZE,
      });
      setEntries(result.entries);
      setTotal(result.total);
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, page]);

  useEffect(() => { load(); }, [load]);

  function openEntry(entry: JournalEntry) {
    onNavigate?.(`je-edit:${entry.id}`);
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{t('journalEntriesList.title')}</h2>
          <p className="text-xs text-slate-500 mt-1 uppercase font-bold tracking-wider">{t('journalEntriesList.recordsTotal', { count: total })}</p>
        </div>
        {canCreate && (
          <button
            onClick={() => onNavigate?.('je-create')}
            className="px-4 py-2 text-xs font-bold bg-blue-600 text-white rounded-lg shadow hover:bg-blue-700 flex items-center gap-2 uppercase tracking-wide"
          >
            <Plus size={14} /> {t('journalEntriesList.newEntry')}
          </button>
        )}
      </div>

      <Card className="p-0">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder={t('journalEntriesList.searchPlaceholder')}
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              className="w-full pl-10 pr-4 py-2 text-sm bg-white border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(0); }}
            className="bg-white border border-slate-200 rounded px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-600"
          >
            <option value="">{t('journalEntriesList.allStatuses')}</option>
            <option value="posted">{t('journalEntriesList.statusPosted')}</option>
            <option value="draft">{t('journalEntriesList.statusDraft')}</option>
            <option value="reversed">{t('journalEntriesList.statusReversed')}</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20 gap-3 text-slate-400">
              <Loader2 size={20} className="animate-spin" />
              <span className="text-sm">{t('journalEntriesList.loading')}</span>
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
              <p className="text-sm">{t('journalEntriesList.noEntries')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-200">
                  <th className="px-6 py-4">{t('journalEntriesList.colEntryNumber')}</th>
                  <th className="px-6 py-4">{t('journalEntriesList.colDate')}</th>
                  <th className="px-6 py-4">{t('journalEntriesList.colDescription')}</th>
                  <th className="px-6 py-4 text-right">{t('journalEntriesList.colAmount')}</th>
                  <th className="px-6 py-4">{t('journalEntriesList.colPeriod')}</th>
                  <th className="px-6 py-4">{t('journalEntriesList.colStatus')}</th>
                  <th className="px-6 py-4 w-16" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {entries.map(entry => (
                  <tr
                    key={entry.id}
                    onClick={() => openEntry(entry)}
                    className="hover:bg-blue-50/30 transition-colors cursor-pointer group"
                  >
                    <td className="px-6 py-4 font-bold text-sm text-blue-600 font-mono">
                      {entry.entry_number}
                    </td>
                    <td className="px-6 py-4 text-xs font-medium text-slate-500">{entry.entry_date}</td>
                    <td className="px-6 py-4 text-sm text-slate-700">{entry.description || '—'}</td>
                    <td className="px-6 py-4 text-right font-mono text-sm font-bold text-slate-900">
                      {formatCurrency(entry.total_debit ?? 0)}
                    </td>
                    <td className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">
                      {entry.period_name || '—'}
                    </td>
                    <td className="px-6 py-4">
                      <Badge type={statusColor[entry.status] ?? 'neutral'}>{entry.status}</Badge>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {entry.status === 'draft' && canEdit
                        ? <Pencil size={15} className="text-slate-300 group-hover:text-blue-500 transition-colors inline" />
                        : <Eye size={15} className="text-slate-300 group-hover:text-slate-500 transition-colors inline" />
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </div>

        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-between items-center text-[10px] font-bold uppercase text-slate-500 tracking-widest">
          <span>{t('journalEntriesList.showingRange', { from: Math.min(page * PAGE_SIZE + 1, total), to: Math.min((page + 1) * PAGE_SIZE, total), total })}</span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => p - 1)}
              disabled={page === 0}
              className="p-1 border border-slate-200 rounded disabled:opacity-30"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={page >= totalPages - 1}
              className="p-1 border border-slate-200 rounded disabled:opacity-30"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}
