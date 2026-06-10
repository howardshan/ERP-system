import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowLeft, BookOpen, ChevronRight } from 'lucide-react';

// Vite ?raw imports — bundled at build time, no filesystem access needed
import readmeMd from '../../docs/README.md?raw';
import glMd from '../../docs/modules/01_general-ledger.md?raw';
import approvalsMd from '../../docs/modules/02_approvals.md?raw';
import apArMd from '../../docs/modules/03_ap-ar.md?raw';
import reportsMd from '../../docs/modules/04_reports-periods.md?raw';
import workflowMd from '../../docs/modules/05_workflow-studio.md?raw';
import schemaMd from '../../docs/database/01_schema.md?raw';
import rpcMd from '../../docs/database/02_rpc-functions.md?raw';
import migrationsMd from '../../docs/database/03_migrations-and-edge-functions.md?raw';

interface NavItem {
  id: string;
  labelKey: string;
  content: string;
  group: string;
}

const NAV: NavItem[] = [
  { id: 'overview',   labelKey: 'docsPage.nav.overview',   content: readmeMd,      group: 'Overview' },
  { id: 'gl',         labelKey: 'docsPage.nav.gl',         content: glMd,          group: 'Modules' },
  { id: 'approvals',  labelKey: 'docsPage.nav.approvals',  content: approvalsMd,   group: 'Modules' },
  { id: 'ap-ar',      labelKey: 'docsPage.nav.apAr',       content: apArMd,        group: 'Modules' },
  { id: 'reports',    labelKey: 'docsPage.nav.reports',    content: reportsMd,     group: 'Modules' },
  { id: 'workflow',   labelKey: 'docsPage.nav.workflow',   content: workflowMd,    group: 'Modules' },
  { id: 'schema',     labelKey: 'docsPage.nav.schema',     content: schemaMd,      group: 'Database' },
  { id: 'rpc',        labelKey: 'docsPage.nav.rpc',        content: rpcMd,         group: 'Database' },
  { id: 'migrations', labelKey: 'docsPage.nav.migrations', content: migrationsMd,  group: 'Database' },
];

const GROUPS = ['Overview', 'Modules', 'Database'];
const GROUP_LABEL_KEYS: Record<string, string> = {
  Overview: 'docsPage.group.overview',
  Modules: 'docsPage.group.modules',
  Database: 'docsPage.group.database',
};

interface DocsPageProps {
  onHome: () => void;
}

export default function DocsPage({ onHome }: DocsPageProps) {
  const { t } = useTranslation('app');
  const [activeId, setActiveId] = useState('overview');
  const active = NAV.find(n => n.id === activeId)!;

  return (
    <div className="h-screen w-full bg-[#faf8f5] flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="h-12 bg-white border-b border-slate-200 flex items-center px-5 gap-3 shrink-0">
        <button
          onClick={onHome}
          className="flex items-center gap-1.5 text-slate-500 hover:text-slate-900 text-xs font-bold transition-colors"
        >
          <ArrowLeft size={14} /> {t('docsPage.home')}
        </button>
        <div className="w-px h-5 bg-slate-200" />
        <div className="flex items-center gap-2 text-slate-700">
          <BookOpen size={14} />
          <span className="text-sm font-bold">{t('docsPage.documentation')}</span>
        </div>
        <ChevronRight size={13} className="text-slate-400" />
        <span className="text-sm text-slate-500">{t(active.labelKey)}</span>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <nav className="w-56 bg-white border-r border-slate-200 flex flex-col py-4 overflow-y-auto shrink-0">
          {GROUPS.map(group => (
            <div key={group} className="mb-4">
              <p className="px-4 mb-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                {t(GROUP_LABEL_KEYS[group])}
              </p>
              {NAV.filter(n => n.group === group).map(item => (
                <button
                  key={item.id}
                  onClick={() => setActiveId(item.id)}
                  className={`w-full text-left px-4 py-2 text-xs font-medium transition-colors ${
                    activeId === item.id
                      ? 'bg-blue-50 text-blue-700 font-bold border-r-2 border-blue-600'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  {t(item.labelKey)}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* Content */}
        <main className="flex-1 overflow-y-auto px-12 py-10">
          <article className="max-w-3xl mx-auto prose prose-slate prose-sm
            prose-headings:font-bold prose-headings:text-slate-900
            prose-h1:text-2xl prose-h1:mb-6 prose-h1:pb-3 prose-h1:border-b prose-h1:border-slate-200
            prose-h2:text-lg prose-h2:mt-8 prose-h2:mb-3
            prose-h3:text-base prose-h3:mt-6 prose-h3:mb-2
            prose-p:text-slate-600 prose-p:leading-relaxed
            prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline
            prose-code:bg-slate-100 prose-code:text-slate-800 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-[12px]
            prose-pre:bg-slate-900 prose-pre:text-slate-100 prose-pre:rounded-xl prose-pre:p-4
            prose-table:text-xs prose-table:w-full
            prose-th:bg-slate-100 prose-th:text-slate-700 prose-th:font-bold prose-th:px-3 prose-th:py-2 prose-th:text-left
            prose-td:px-3 prose-td:py-2 prose-td:border-b prose-td:border-slate-100 prose-td:text-slate-600
            prose-li:text-slate-600
            prose-strong:text-slate-800
            prose-blockquote:border-l-4 prose-blockquote:border-blue-300 prose-blockquote:bg-blue-50 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-lg prose-blockquote:text-slate-600
          ">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {active.content}
            </ReactMarkdown>
          </article>
        </main>
      </div>
    </div>
  );
}
