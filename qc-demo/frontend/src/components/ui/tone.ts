import type { ShellAccent } from '../../context/ShellAccentContext';

export const toneStyles = {
  admin: {
    primary: 'bg-indigo-600 text-white hover:bg-indigo-700 focus-visible:ring-indigo-500',
    primarySoft: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    navActive: 'bg-indigo-50 text-indigo-900 border-indigo-600',
    ring: 'focus-visible:ring-indigo-500',
    link: 'text-indigo-600 hover:text-indigo-800',
    outlineAccent: 'border-indigo-400 ring-indigo-100',
  },
  qc: {
    primary: 'bg-teal-600 text-white hover:bg-teal-700 focus-visible:ring-teal-500',
    primarySoft: 'bg-teal-50 text-teal-900 border-teal-200',
    navActive: 'bg-teal-50 text-teal-900 border-teal-600',
    ring: 'focus-visible:ring-teal-500',
    link: 'text-teal-600 hover:text-teal-800',
    outlineAccent: 'border-teal-400 ring-teal-100',
  },
} as const;

export type ToneStyle = (typeof toneStyles)[ShellAccent];

export function getTone(accent?: ShellAccent): ToneStyle {
  return toneStyles[accent ?? 'admin'];
}
