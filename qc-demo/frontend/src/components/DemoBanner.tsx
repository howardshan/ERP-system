import { Info } from 'lucide-react';

export function DemoBanner() {
  return (
    <div className="bg-amber-50 border-b border-amber-200/80 text-amber-950 flex items-center justify-center gap-2 text-center text-xs py-2 px-3">
      <Info className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
      <span>
        Demo system · Data and limits are for demonstration; production standards require on-site
        validation
      </span>
    </div>
  );
}
