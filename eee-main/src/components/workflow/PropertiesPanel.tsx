import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type Node } from '@xyflow/react';
import { X, Settings2 } from 'lucide-react';
import type { WorkflowNodeData, NodeCategory } from '../../types/workflow';

const CATEGORY_ACCENT: Record<NodeCategory, string> = {
  trigger:    'text-emerald-600',
  dataSource: 'text-blue-600',
  logic:      'text-amber-600',
  action:     'text-violet-600',
  output:     'text-slate-500',
};

// Static config fields per subtype
// `labelKey` is an i18n key under `propertiesPanel.fields.*`, resolved at render time.
const CONFIG_FIELDS: Record<string, { key: string; labelKey: string; type: 'text' | 'select' | 'number'; options?: string[] }[]> = {
  schedule:           [{ key: 'cron', labelKey: 'cronExpression', type: 'text' }],
  on_je_created:      [{ key: 'status_filter', labelKey: 'statusFilter', type: 'select', options: ['any','draft','pending_approval','posted'] }],
  on_inventory_change:[{ key: 'item_sku', labelKey: 'itemSku', type: 'text' }],
  gl_accounts:        [{ key: 'account_type', labelKey: 'accountType', type: 'select', options: ['all','asset','liability','equity','revenue','expense'] }],
  journal_entries:    [
    { key: 'status', labelKey: 'status', type: 'select', options: ['all','draft','pending_approval','posted','reversed'] },
    { key: 'date_range', labelKey: 'dateRange', type: 'text' },
  ],
  inventory_balance:  [{ key: 'warehouse', labelKey: 'warehouseCode', type: 'text' }],
  filter:             [{ key: 'condition', labelKey: 'condition', type: 'text' }],
  branch:             [{ key: 'condition', labelKey: 'ifCondition', type: 'text' }],
  aggregate:          [
    { key: 'function', labelKey: 'function', type: 'select', options: ['sum','count','avg','min','max'] },
    { key: 'field', labelKey: 'field', type: 'text' },
  ],
  transform:          [{ key: 'mapping', labelKey: 'fieldMapping', type: 'text' }],
  create_je:          [
    { key: 'journal_type', labelKey: 'journalType', type: 'select', options: ['general','adjustment','accrual','depreciation'] },
    { key: 'description_template', labelKey: 'descriptionTemplate', type: 'text' },
  ],
  post_je:            [{ key: 'on_error', labelKey: 'onError', type: 'select', options: ['stop','skip','notify'] }],
  send_notification:  [
    { key: 'channel', labelKey: 'channel', type: 'select', options: ['email','in_app','webhook'] },
    { key: 'message', labelKey: 'messageTemplate', type: 'text' },
  ],
  export_csv:         [{ key: 'filename', labelKey: 'filenameTemplate', type: 'text' }],
  email_report:       [
    { key: 'to', labelKey: 'toEmail', type: 'text' },
    { key: 'subject', labelKey: 'subjectTemplate', type: 'text' },
  ],
  webhook:            [
    { key: 'url', labelKey: 'endpointUrl', type: 'text' },
    { key: 'method', labelKey: 'method', type: 'select', options: ['POST','GET','PUT'] },
  ],
  dashboard_widget:   [{ key: 'widget_title', labelKey: 'widgetTitle', type: 'text' }],
};

interface PropertiesPanelProps {
  node: Node<WorkflowNodeData> | null;
  onUpdate: (id: string, data: Partial<WorkflowNodeData>) => void;
  onClose: () => void;
}

export function PropertiesPanel({ node, onUpdate, onClose }: PropertiesPanelProps) {
  const { t } = useTranslation('workflowBuilder');
  const [label, setLabel] = useState('');
  const [config, setConfig] = useState<Record<string, string>>({});

  useEffect(() => {
    if (node) {
      setLabel(node.data.label);
      const c: Record<string, string> = {};
      for (const [k, v] of Object.entries(node.data.config ?? {})) {
        c[k] = String(v ?? '');
      }
      setConfig(c);
    }
  }, [node?.id]);

  if (!node) {
    return (
      <div className="w-72 bg-[#faf8f5] border-l border-slate-200 flex flex-col items-center justify-center gap-3 text-slate-400">
        <Settings2 size={28} />
        <p className="text-xs text-center px-6">{t('propertiesPanel.emptyState')}</p>
      </div>
    );
  }

  const fields = CONFIG_FIELDS[node.data.subtype] ?? [];
  const accent = CATEGORY_ACCENT[node.data.category];

  function handleSave() {
    onUpdate(node!.id, { label, config });
  }

  function setField(key: string, value: string) {
    setConfig(prev => ({ ...prev, [key]: value }));
  }

  return (
    <div className="w-72 bg-[#faf8f5] border-l border-slate-200 flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <div>
          <p className={`text-[10px] font-bold uppercase tracking-widest ${accent}`}>
            {node.data.category}
          </p>
          <p className="text-slate-900 text-sm font-bold mt-0.5 truncate">{node.data.subtype}</p>
        </div>
        <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-800 transition-colors">
          <X size={15} />
        </button>
      </div>

      {/* Fields */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Label */}
        <div>
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
            {t('propertiesPanel.nodeLabel')}
          </label>
          <input
            value={label}
            onChange={e => setLabel(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {/* Config fields */}
        {fields.map(field => (
          <div key={field.key}>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">
              {t(`propertiesPanel.fields.${field.labelKey}`)}
            </label>
            {field.type === 'select' ? (
              <select
                value={config[field.key] ?? ''}
                onChange={e => setField(field.key, e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {field.options?.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : (
              <input
                type={field.type}
                value={config[field.key] ?? ''}
                onChange={e => setField(field.key, e.target.value)}
                className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-900 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder={field.key}
              />
            )}
          </div>
        ))}

        {fields.length === 0 && (
          <p className="text-slate-400 text-xs">{t('propertiesPanel.noConfig')}</p>
        )}
      </div>

      {/* Save */}
      <div className="px-4 py-3 border-t border-slate-200">
        <button
          onClick={handleSave}
          className="w-full bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold uppercase tracking-wider py-2.5 rounded-xl transition-colors"
        >
          {t('propertiesPanel.applyChanges')}
        </button>
      </div>
    </div>
  );
}
