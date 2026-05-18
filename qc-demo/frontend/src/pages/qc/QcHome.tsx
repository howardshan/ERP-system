import { Link } from 'react-router-dom';
import { Layout } from '../../components/Layout';

const links = [
  { to: '/qc/lots', label: '生产批管理', desc: '查看或新建生产批、登记烘干子批' },
  { to: '/qc/pending', label: '待检队列', desc: '出房待检子批，按等待时间排序' },
];

export function QcHome() {
  return (
    <Layout
      nav={[
        { to: '/qc/lots', label: '生产批' },
        { to: '/qc/pending', label: '待检' },
      ]}
    >
      <h1 className="text-2xl font-bold mb-6">QC 工作台</h1>
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
    </Layout>
  );
}
