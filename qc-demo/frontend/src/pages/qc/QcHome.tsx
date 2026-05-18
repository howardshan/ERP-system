import { Link } from 'react-router-dom';
import { AppShell } from '../../components/AppShell';

const links = [
  { to: '/qc/lots', label: '生产批管理', desc: '登记生产批、烘干子批进/出房时间' },
  { to: '/qc/pending', label: '待检队列', desc: '出房待检子批，按等待时间排序' },
];

export function QcHome() {
  return (
    <AppShell variant="qc" title="QC 工作台">
      <p className="text-slate-600 mb-6">请选择下方入口开始现场作业。</p>
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
