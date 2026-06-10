import React, { useEffect, useState } from 'react';
import { Plus, GitBranch, Play, Archive, Pencil, Trash2, Clock, ArrowLeft } from 'lucide-react';
import { getWorkflows, deleteWorkflow, updateWorkflowStatus, createWorkflow } from '../services/workflowApi';
import type { WorkflowDefinition } from '../types/workflow';
import { format } from 'date-fns';
import { usePermissions } from '../contexts/PermissionContext';
import { useTranslation } from 'react-i18next';

const STATUS_STYLES: Record<WorkflowDefinition['status'], string> = {
  draft:    'bg-slate-100 text-slate-600 border-slate-200',
  active:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  paused:   'bg-amber-50 text-amber-700 border-amber-200',
  archived: 'bg-slate-100 text-slate-500 border-slate-200',
};

interface WorkflowListProps {
  onNavigate: (screen: string) => void;
}

export default function WorkflowList({ onNavigate }: WorkflowListProps) {
  const { t } = useTranslation('workflowBuilder');
  const { can } = usePermissions();
  const canCreate  = can('workflow', 'workflow', 'create');
  const canEdit    = can('workflow', 'workflow', 'edit');
  const canDelete  = can('workflow', 'workflow', 'delete');
  const canExecute = can('workflow', 'workflow', 'execute');
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setWorkflows(await getWorkflows());
    } catch { /* empty */ }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleCreate() {
    setCreating(true);
    try {
      const wf = await createWorkflow({ name: 'New Workflow' });
      onNavigate(`wf-builder:${wf.id}`);
    } catch { setCreating(false); }
  }

  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  async function handleDelete(id: number) {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      setTimeout(() => setConfirmDelete(null), 3000);
      return;
    }
    setConfirmDelete(null);
    await deleteWorkflow(id);
    await load();
  }

  async function handleToggleStatus(wf: WorkflowDefinition) {
    const next = wf.status === 'active' ? 'paused' : 'active';
    await updateWorkflowStatus(wf.id, next);
    await load();
  }

  function nodeCount(wf: WorkflowDefinition): number {
    try { return (JSON.parse(wf.nodes_json) as unknown[]).length; } catch { return 0; }
  }

  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      {/* Header */}
      <div className="px-10 pt-10 pb-6 flex items-center justify-between">
        <div>
          <button
            onClick={() => onNavigate('home')}
            className="flex items-center gap-1.5 text-slate-400 hover:text-slate-700 text-[10px] uppercase tracking-widest font-bold mb-2 transition-colors"
          >
            <ArrowLeft size={12} /> {t('workflowList.allModules')}
          </button>
          <h1 className="text-3xl font-bold text-slate-900">{t('workflowList.title')}</h1>
          <p className="text-slate-500 text-sm mt-1.5">
            {t('workflowList.subtitle')}
          </p>
        </div>
        {canCreate && (
          <button
            onClick={handleCreate}
            disabled={creating}
            className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-bold rounded-xl transition-colors"
          >
            <Plus size={16} /> {t('workflowList.newWorkflow')}
          </button>
        )}
      </div>

      <div className="mx-10 h-px bg-slate-200 mb-8" />

      {/* Content */}
      <main className="flex-1 px-10 pb-10">
        {loading ? (
          <div className="flex items-center justify-center py-32 text-slate-400 text-sm">{t('workflowList.loading')}</div>
        ) : workflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center">
              <GitBranch size={28} className="text-slate-400" />
            </div>
            <p className="text-slate-500 text-sm">{t('workflowList.empty')}</p>
            {canCreate && (
              <button
                onClick={handleCreate}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-xl transition-colors"
              >
                {t('workflowList.createFirst')}
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {workflows.map(wf => (
              <div
                key={wf.id}
                className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col gap-4 hover:border-slate-300 hover:shadow-sm transition-all"
              >
                {/* Top row */}
                <div className="flex items-start justify-between gap-3">
                  <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center shrink-0">
                    <GitBranch size={16} className="text-blue-600" />
                  </div>
                  <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full border ${STATUS_STYLES[wf.status]}`}>
                    {wf.status}
                  </span>
                </div>

                {/* Name + description */}
                <div>
                  <h3 className="text-slate-900 font-bold text-sm truncate">{wf.name}</h3>
                  {wf.description && (
                    <p className="text-slate-500 text-xs mt-1 line-clamp-2">{wf.description}</p>
                  )}
                </div>

                {/* Stats */}
                <div className="flex items-center gap-4 text-[10px] text-slate-400 font-mono">
                  <span>{t('workflowList.nodes', { count: nodeCount(wf) })}</span>
                  {wf.updated_at && (
                    <span className="flex items-center gap-1">
                      <Clock size={9} />
                      {format(new Date(wf.updated_at), 'MMM d, HH:mm')}
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                  {canEdit && (
                    <button
                      onClick={() => onNavigate(`wf-builder:${wf.id}`)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                    >
                      <Pencil size={11} /> {t('workflowList.edit')}
                    </button>
                  )}
                  {canExecute && (
                    <button
                      onClick={() => handleToggleStatus(wf)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors"
                    >
                      {wf.status === 'active' ? (
                        <><Archive size={11} /> {t('workflowList.pause')}</>
                      ) : (
                        <><Play size={11} /> {t('workflowList.activate')}</>
                      )}
                    </button>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => handleDelete(wf.id)}
                      className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                        confirmDelete === wf.id
                          ? 'bg-red-500 text-white'
                          : 'text-red-400 hover:text-red-600 hover:bg-red-50'
                      }`}
                    >
                      <Trash2 size={11} />
                      {confirmDelete === wf.id && <span>{t('workflowList.confirm')}</span>}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
