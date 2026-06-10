import React, { useEffect, useRef, useState } from 'react';
import { Globe, Check, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGS } from '../i18n';
import { cn } from '../lib/utils';

/** Language selector (中文 / English / Español). Persists to localStorage via
 *  i18next-browser-languagedetector (key `erp_lang`). */
export function LanguageSwitcher({ dark = false }: { dark?: boolean }) {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const active = i18n.resolvedLanguage ?? i18n.language ?? 'en';
  const current = SUPPORTED_LANGS.find(l => active.startsWith(l.code)) ?? SUPPORTED_LANGS[1];

  const pick = (code: string) => {
    void i18n.changeLanguage(code);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title={t('language')}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors',
          dark
            ? 'text-slate-300 hover:text-white hover:bg-white/10'
            : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100',
        )}
      >
        <Globe size={15} />
        <span className="hidden sm:inline">{current.label}</span>
        <ChevronDown size={11} className={cn('transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-32 bg-white border border-slate-200 rounded-lg shadow-xl z-50 py-1">
          {SUPPORTED_LANGS.map(l => (
            <button
              key={l.code}
              type="button"
              onClick={() => pick(l.code)}
              className={cn(
                'w-full flex items-center justify-between px-3 py-1.5 text-xs text-left transition-colors',
                current.code === l.code ? 'text-blue-700 font-semibold bg-blue-50' : 'text-slate-700 hover:bg-slate-50',
              )}
            >
              {l.label}
              {current.code === l.code && <Check size={13} className="text-blue-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
