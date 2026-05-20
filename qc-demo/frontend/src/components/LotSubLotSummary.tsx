import { SubLotStatusCounts } from '../api/client';

const SEGMENTS: Array<{
  key: keyof Pick<SubLotStatusCounts, 'drying' | 'pending' | 'passed' | 'hold' | 'disposing' | 'closed'>;
  label: string;
  color: string;
}> = [
  { key: 'drying', label: 'Drying', color: '#0ea5e9' },
  { key: 'pending', label: 'Pending', color: '#f59e0b' },
  { key: 'passed', label: 'Passed', color: '#10b981' },
  { key: 'hold', label: 'Hold', color: '#ef4444' },
  { key: 'disposing', label: 'Disposing', color: '#a855f7' },
  { key: 'closed', label: 'Closed', color: '#94a3b8' },
];

function passRatePercent(counts: SubLotStatusCounts): number | null {
  if (counts.total === 0) return null;
  return Math.round((counts.passed / counts.total) * 100);
}

function StatusDonut({ counts, size = 72 }: { counts: SubLotStatusCounts; size?: number }) {
  const stroke = 9;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const rate = passRatePercent(counts);

  if (counts.total === 0) {
    return (
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="block">
          <circle
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke="#e2e8f0"
            strokeWidth={stroke}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400">
          <span className="text-lg font-bold">—</span>
          <span className="text-[10px] leading-none mt-0.5">Pass rate</span>
        </div>
      </div>
    );
  }

  const slices = SEGMENTS.map((seg) => ({
    ...seg,
    value: counts[seg.key],
  })).filter((s) => s.value > 0);

  let cumulative = 0;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-hidden>
      <svg width={size} height={size} className="block -rotate-90">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f1f5f9" strokeWidth={stroke} />
        {slices.map((slice) => {
          const len = (slice.value / counts.total) * circumference;
          const offset = cumulative;
          cumulative += len;
          return (
            <circle
              key={slice.key}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={slice.color}
              strokeWidth={stroke}
              strokeDasharray={`${len} ${circumference - len}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="text-lg font-bold text-slate-800 tabular-nums leading-none">{rate}%</span>
        <span className="text-[10px] text-slate-500 leading-none mt-0.5">Pass rate</span>
      </div>
    </div>
  );
}

export function LotSubLotSummary({ counts }: { counts: SubLotStatusCounts }) {
  const rate = passRatePercent(counts);
  const visible = SEGMENTS.filter((s) => counts[s.key] > 0);

  return (
    <div className="mt-3 flex items-center justify-between gap-4 w-full">
      <div className="min-w-0 flex-1">
        {counts.total === 0 ? (
          <p className="text-sm text-slate-500">No sub-lots yet</p>
        ) : (
          <>
            <p className="text-xs text-slate-500 mb-1.5">
              {counts.total} sub-lot{counts.total === 1 ? '' : 's'}
              {rate != null && (
                <span className="text-slate-600">
                  {' '}
                  · {counts.passed} passed
                </span>
              )}
            </p>
            <ul className="flex flex-wrap gap-x-3 gap-y-1">
              {visible.map((s) => (
                <li key={s.key} className="flex items-center gap-1 text-xs text-slate-600">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                  <span>
                    {s.label} <span className="font-semibold tabular-nums">{counts[s.key]}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <StatusDonut counts={counts} />
    </div>
  );
}
