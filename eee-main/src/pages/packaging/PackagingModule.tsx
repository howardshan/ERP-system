import React from 'react';
import { ArrowLeft, Package } from 'lucide-react';
import PackagingPage from './PackagingPage';

interface Props {
  onHome: () => void;
}

export default function PackagingModule({ onHome }: Props) {
  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      {/* Top action bar */}
      <header className="sticky top-0 z-30 bg-white/85 backdrop-blur border-b border-slate-200 px-6 py-2 flex items-center justify-between shrink-0">
        <button
          onClick={onHome}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100 transition-colors"
        >
          <ArrowLeft size={14} /> Module Hub
        </button>
        <span className="text-[10px] uppercase tracking-widest font-bold text-slate-400">
          Packaging
        </span>
      </header>

      {/* Page header */}
      <div className="px-8 pt-6 pb-4 border-b border-slate-200 bg-white shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
            <Package size={20} className="text-orange-700" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Packaging</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Dispatch released QC carts — FIFO order, scan support, days-in-stock tracking
            </p>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-h-0">
        <PackagingPage />
      </div>
    </div>
  );
}
