import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const STATUS_LABEL: Record<string, string> = {
  pending: '待检',
  inspecting: '检验中',
  passed: '合格',
  hold: 'Hold',
  disposing: '处置中',
  closed: '已关闭',
};

export const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-900 border-amber-300',
  inspecting: 'bg-blue-100 text-blue-900 border-blue-300',
  passed: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  hold: 'bg-red-100 text-red-900 border-red-300',
  disposing: 'bg-purple-100 text-purple-900 border-purple-300',
  closed: 'bg-slate-100 text-slate-700 border-slate-300',
};
