import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpCircle, Search, ChevronDown, ChevronRight, ArrowLeft, X } from 'lucide-react';

interface FaqItem { q: string; a: string; }
interface FaqCategory { id: string; title: string; items: FaqItem[]; }

export default function FaqModule({ onHome }: { onHome: () => void }) {
  const { t } = useTranslation('faq');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());

  const categories = (t('categories', { returnObjects: true }) as unknown as FaqCategory[]) || [];
  const q = query.trim().toLowerCase();

  const filtered = useMemo<FaqCategory[]>(() => {
    if (!Array.isArray(categories)) return [];
    if (!q) return categories;
    return categories
      .map(c => ({ ...c, items: (c.items || []).filter(it => `${it.q} ${it.a}`.toLowerCase().includes(q)) }))
      .filter(c => c.items.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, JSON.stringify(categories)]);

  const total = filtered.reduce((n, c) => n + (c.items?.length ?? 0), 0);
  const searching = q.length > 0;
  const keyOf = (ci: number, ii: number) => `${ci}:${ii}`;
  const toggle = (k: string) =>
    setOpen(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <div className="min-h-screen bg-[#faf8f5]">
      <div className="max-w-3xl mx-auto p-8">
        {/* Header */}
        <button
          type="button"
          onClick={onHome}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 mb-4"
        >
          <ArrowLeft size={13} /> {t('back')}
        </button>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center">
            <HelpCircle size={22} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{t('title')}</h1>
        </div>
        <p className="text-sm text-slate-500 mb-5 ml-[52px] -mt-1">{t('subtitle')}</p>

        {/* Search bar */}
        <div className="relative mb-5">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="w-full pl-9 pr-9 py-2.5 border border-slate-300 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              aria-label={t('clear')}
            >
              <X size={15} />
            </button>
          )}
        </div>

        {searching && (
          <p className="text-xs text-slate-500 mb-3">{t('resultsCount', { count: total })}</p>
        )}

        {filtered.length === 0 ? (
          <p className="text-sm text-slate-400 italic text-center py-16">{t('noResults')}</p>
        ) : (
          <div className="space-y-6">
            {filtered.map((cat, ci) => (
              <section key={cat.id ?? ci}>
                <h2 className="text-[11px] font-bold uppercase tracking-widest text-violet-700 mb-2">
                  {cat.title}
                </h2>
                <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden">
                  {(cat.items || []).map((it, ii) => {
                    const k = keyOf(ci, ii);
                    const expanded = searching || open.has(k);
                    return (
                      <div key={k}>
                        <button
                          type="button"
                          onClick={() => toggle(k)}
                          className="w-full flex items-start gap-2 px-4 py-3 text-left hover:bg-slate-50"
                        >
                          {expanded
                            ? <ChevronDown size={15} className="text-slate-400 shrink-0 mt-0.5" />
                            : <ChevronRight size={15} className="text-slate-400 shrink-0 mt-0.5" />}
                          <span className="text-sm font-semibold text-slate-900 flex-1">{it.q}</span>
                        </button>
                        {expanded && (
                          <p className="px-4 pb-3.5 pl-10 text-sm text-slate-600 leading-relaxed whitespace-pre-line">
                            {it.a}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
