import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { getUsers } from '../../../services/authApi';
import type { ErpUser } from '../../../types/auth';

interface TreeNode extends ErpUser {
  children: TreeNode[];
}

function buildTree(users: ErpUser[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  for (const u of users) map.set(u.id, { ...u, children: [] });
  const roots: TreeNode[] = [];
  for (const u of map.values()) {
    if (u.manager_id && map.has(u.manager_id)) {
      map.get(u.manager_id)!.children.push(u);
    } else {
      roots.push(u);
    }
  }
  return roots;
}

function NodeCard({ node, onSelect, depth = 0 }: { node: TreeNode; onSelect: (id: string) => void; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  return (
    <div className="flex flex-col items-center">
      <div
        className="relative cursor-pointer group"
        onClick={() => onSelect(node.id)}
      >
        <div className="bg-white border-2 border-slate-200 group-hover:border-teal-400 rounded-xl px-4 py-3 shadow-sm transition-all min-w-[160px] text-center">
          <div className="w-8 h-8 rounded-full bg-teal-600 flex items-center justify-center text-white text-xs font-bold mx-auto mb-1.5">
            {node.full_name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <p className="text-xs font-bold text-slate-900 leading-tight">{node.full_name}</p>
          {node.role && <p className="text-[10px] text-slate-400 mt-0.5">{node.role}</p>}
          {node.department && <p className="text-[10px] text-teal-600 font-bold">{node.department}</p>}
        </div>
        {node.children.length > 0 && (
          <button
            onClick={e => { e.stopPropagation(); setExpanded(p => !p); }}
            className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-6 h-6 bg-teal-600 text-white rounded-full text-xs font-bold flex items-center justify-center hover:bg-teal-500 z-10"
          >
            {expanded ? '−' : node.children.length}
          </button>
        )}
      </div>

      {expanded && node.children.length > 0 && (
        <div className="mt-6 relative">
          <div className="absolute top-0 left-1/2 -translate-x-0.5 w-px h-4 bg-slate-300" />
          <div className="pt-4 flex gap-6">
            {node.children.map((child, i) => (
              <div key={child.id} className="relative flex flex-col items-center">
                {node.children.length > 1 && (
                  <div className={`absolute top-0 h-px bg-slate-300 ${
                    i === 0 ? 'left-1/2 right-0' : i === node.children.length - 1 ? 'left-0 right-1/2' : 'left-0 right-0'
                  }`} />
                )}
                <div className="absolute top-0 left-1/2 -translate-x-0.5 w-px h-4 bg-slate-300" />
                <div className="pt-4">
                  <NodeCard node={child} onSelect={onSelect} depth={depth + 1} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

interface Props {
  onSelectEmployee: (id: string) => void;
}

export default function OrgChart({ onSelectEmployee }: Props) {
  const { t } = useTranslation('hr');
  const [roots, setRoots] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getUsers().then(users => { setRoots(buildTree(users)); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      <div className="px-10 pt-8 pb-5 border-b border-slate-200 bg-white">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t('orgChart.breadcrumb')}</p>
        <h1 className="text-2xl font-bold text-slate-900">{t('orgChart.title')}</h1>
        <p className="text-sm text-slate-500 mt-1">{t('orgChart.subtitle')}</p>
      </div>

      <main className="flex-1 overflow-auto px-10 py-10">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 py-16 justify-center"><Loader2 size={18} className="animate-spin" /> {t('orgChart.loading')}</div>
        ) : (
          <div className="flex gap-12 flex-wrap justify-center">
            {roots.map(r => <NodeCard key={r.id} node={r} onSelect={onSelectEmployee} />)}
          </div>
        )}
      </main>
    </div>
  );
}
