import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { cn } from '../../../lib/utils';
import type { NodeCategory } from '../../../types/workflow';

const CATEGORY_STYLES: Record<NodeCategory, {
  header: string;
  border: string;
  dot: string;
}> = {
  trigger:    { header: 'bg-emerald-600',  border: 'border-emerald-500/40', dot: 'bg-emerald-400' },
  dataSource: { header: 'bg-blue-600',     border: 'border-blue-500/40',    dot: 'bg-blue-400'    },
  logic:      { header: 'bg-amber-600',    border: 'border-amber-500/40',   dot: 'bg-amber-400'   },
  action:     { header: 'bg-violet-600',   border: 'border-violet-500/40',  dot: 'bg-violet-400'  },
  output:     { header: 'bg-slate-600',    border: 'border-slate-500/40',   dot: 'bg-slate-400'   },
};

interface BaseNodeProps {
  category: NodeCategory;
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  configRows?: { key: string; value: string }[];
  selected?: boolean;
  hasInput?: boolean;
  hasOutput?: boolean;
  outputHandles?: { id: string; label: string; top: number }[]; // for branch nodes
}

export function BaseNode({
  category,
  icon,
  label,
  sublabel,
  configRows = [],
  selected = false,
  hasInput = true,
  hasOutput = true,
  outputHandles,
}: BaseNodeProps) {
  const styles = CATEGORY_STYLES[category];

  return (
    <div
      className={cn(
        'rounded-xl overflow-hidden w-56 shadow-xl border transition-all',
        'bg-[#111827]',
        styles.border,
        selected && 'ring-2 ring-white/30 scale-[1.02]',
      )}
    >
      {/* Header */}
      <div className={cn('px-3 py-2.5 flex items-center gap-2', styles.header)}>
        <span className="text-white/90 shrink-0">{icon}</span>
        <div className="min-w-0">
          <p className="text-white text-[11px] font-bold truncate leading-tight">{label}</p>
          {sublabel && (
            <p className="text-white/60 text-[9px] uppercase tracking-wider font-bold">{sublabel}</p>
          )}
        </div>
        <div className={cn('ml-auto w-2 h-2 rounded-full shrink-0', styles.dot)} />
      </div>

      {/* Body */}
      {configRows.length > 0 && (
        <div className="px-3 py-2 space-y-1.5 border-t border-white/5">
          {configRows.map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-2">
              <span className="text-slate-500 text-[10px] uppercase tracking-wide font-bold truncate">{row.key}</span>
              <span className="text-slate-300 text-[10px] font-mono truncate max-w-[100px]">{row.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Handles */}
      {hasInput && (
        <Handle
          type="target"
          position={Position.Left}
          className="!w-3 !h-3 !bg-slate-600 !border-2 !border-slate-400 hover:!bg-white transition-colors"
        />
      )}

      {outputHandles ? (
        outputHandles.map((h) => (
          <Handle
            key={h.id}
            id={h.id}
            type="source"
            position={Position.Right}
            style={{ top: `${h.top}%` }}
            className="!w-3 !h-3 !bg-slate-600 !border-2 !border-slate-400 hover:!bg-white transition-colors"
          />
        ))
      ) : (
        hasOutput && (
          <Handle
            type="source"
            position={Position.Right}
            className="!w-3 !h-3 !bg-slate-600 !border-2 !border-slate-400 hover:!bg-white transition-colors"
          />
        )
      )}
    </div>
  );
}
