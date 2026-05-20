import { Link } from 'react-router-dom';
import { AppShell } from '../../components/AppShell';

const links = [
  { to: '/qc/lots', label: 'Production Lots', desc: 'Register lots and sub-lot check-in / check-out times' },
  { to: '/qc/pending', label: 'Pending Queue', desc: 'Sub-lots awaiting inspection, sorted by wait time' },
];

export function QcHome() {
  return (
    <AppShell variant="qc" title="QC Home">
      <p className="text-slate-600 mb-6">Choose an entry point below to start floor work.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {links.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            className="block bg-white rounded-2xl border-2 border-slate-200 p-6 min-h-[120px] hover:border-blue-400 transition"
          >
            <div className="text-xl font-semibold text-blue-700">{l.label}</div>
            <p className="text-slate-600 mt-2 text-sm">{l.desc}</p>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
