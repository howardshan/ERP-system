import { ArrowRight, ClipboardCheck, Package } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AppShell } from '../../components/AppShell';
import { Card, PageHeader } from '../../components/ui';

const links = [
  {
    to: '/qc/lots',
    label: 'Production Lots',
    desc: 'Register lots and sub-lot check-in / check-out times',
    icon: Package,
  },
  {
    to: '/qc/pending',
    label: 'Pending Queue',
    desc: 'Sub-lots awaiting inspection, sorted by wait time',
    icon: ClipboardCheck,
  },
];

export function QcHome() {
  return (
    <AppShell variant="qc">
      <PageHeader
        title="QC Home"
        description="Choose an entry point below to start floor work."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {links.map((l) => {
          const Icon = l.icon;
          return (
            <Link key={l.to} to={l.to} className="block group">
              <Card variant="interactive" className="p-6 min-h-[140px] border-2 border-transparent hover:border-teal-200">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700 ring-1 ring-teal-100">
                    <Icon className="h-6 w-6" aria-hidden />
                  </div>
                  <ArrowRight className="h-5 w-5 text-slate-300 group-hover:text-teal-600 transition-colors shrink-0 mt-1" />
                </div>
                <div className="text-xl font-semibold text-slate-900 mt-4 group-hover:text-teal-800">
                  {l.label}
                </div>
                <p className="text-slate-600 mt-2 text-sm leading-relaxed">{l.desc}</p>
              </Card>
            </Link>
          );
        })}
      </div>
    </AppShell>
  );
}
