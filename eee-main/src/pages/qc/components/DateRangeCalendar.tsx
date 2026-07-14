import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addMonths, eachDayOfInterval, endOfMonth, endOfWeek, isSameDay, isSameMonth,
  startOfMonth, startOfWeek,
} from 'date-fns';
import { Calendar as CalIcon, ChevronLeft, ChevronRight, X } from 'lucide-react';

interface Props {
  start: Date | null;
  end: Date | null;
  /** Fires with the normalized [start, end]; both null when cleared. */
  onChange: (start: Date | null, end: Date | null) => void;
  /** BCP-47 tag used for month / weekday / range labels (defaults to browser). */
  locale?: string;
  labels: { placeholder: string; clear: string };
}

// A single-calendar date-range picker. First click sets the start, second click
// sets the end; clicking the same day twice selects that one day. Clicking again
// after a full range is picked starts a fresh selection.
export default function DateRangeCalendar({ start, end, onChange, locale, labels }: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<Date>(start ?? new Date());
  const [hover, setHover] = useState<Date | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const dayFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', year: 'numeric' }),
    [locale],
  );
  const monthFmt = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }),
    [locale],
  );
  const weekdayFmt = useMemo(() => new Intl.DateTimeFormat(locale, { weekday: 'short' }), [locale]);

  // Grid of days covering full weeks around the viewed month.
  const days = useMemo(() => {
    const from = startOfWeek(startOfMonth(view));
    const to = endOfWeek(endOfMonth(view));
    return eachDayOfInterval({ start: from, end: to });
  }, [view]);

  const weekdays = useMemo(() => {
    const base = startOfWeek(new Date());
    return Array.from({ length: 7 }, (_, i) => weekdayFmt.format(addDays(base, i)));
  }, [weekdayFmt]);

  function pick(day: Date) {
    // Nothing chosen yet, or a full range already chosen → begin new selection.
    if (!start || (start && end)) {
      onChange(day, null);
      return;
    }
    // Start chosen, choosing the end. Order-tolerant: earlier click becomes start.
    if (day < start) onChange(day, start);
    else onChange(start, day);          // same day → single-day range
  }

  const label =
    start && end
      ? isSameDay(start, end)
        ? dayFmt.format(start)
        : `${dayFmt.format(start)} – ${dayFmt.format(end)}`
      : start
        ? dayFmt.format(start)
        : labels.placeholder;

  // Preview end (hover) while picking the second date.
  const previewEnd = start && !end && hover ? hover : end;
  function inRange(d: Date): boolean {
    if (!start) return false;
    const lo = previewEnd && previewEnd < start ? previewEnd : start;
    const hi = previewEnd && previewEnd < start ? start : previewEnd ?? start;
    return d >= stripTime(lo) && d <= stripTime(hi);
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={
          'flex items-center gap-2 h-9 pl-3 pr-2 rounded-lg border text-sm transition-colors ' +
          (start
            ? 'border-blue-300 bg-blue-50 text-blue-700'
            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300')
        }
      >
        <CalIcon size={15} className="shrink-0" />
        <span className="truncate max-w-[220px]">{label}</span>
        {start && (
          <X
            size={15}
            className="shrink-0 text-blue-400 hover:text-blue-700"
            onClick={e => { e.stopPropagation(); onChange(null, null); }}
          />
        )}
      </button>

      {open && (
        <div className="absolute z-30 mt-2 right-0 w-72 bg-white border border-slate-200 rounded-xl shadow-lg p-3">
          {/* Month nav */}
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => setView(v => addMonths(v, -1))}
              className="p-1 rounded hover:bg-slate-100 text-slate-500">
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-bold text-slate-700 capitalize">{monthFmt.format(view)}</span>
            <button type="button" onClick={() => setView(v => addMonths(v, 1))}
              className="p-1 rounded hover:bg-slate-100 text-slate-500">
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Weekday header */}
          <div className="grid grid-cols-7 mb-1">
            {weekdays.map((w, i) => (
              <div key={i} className="text-center text-[10px] font-bold text-slate-400 uppercase py-1">{w}</div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-y-0.5">
            {days.map(day => {
              const muted = !isSameMonth(day, view);
              const isStart = start && isSameDay(day, start);
              const isEnd = previewEnd && isSameDay(day, previewEnd);
              const isEdge = isStart || isEnd;
              const within = inRange(day);
              const today = isSameDay(day, new Date());
              return (
                <button
                  key={day.toISOString()}
                  type="button"
                  onClick={() => pick(day)}
                  onMouseEnter={() => setHover(day)}
                  className={
                    'h-8 text-xs flex items-center justify-center transition-colors ' +
                    (isEdge
                      ? 'bg-blue-600 text-white font-bold rounded-lg'
                      : within
                        ? 'bg-blue-100 text-blue-800'
                        : muted
                          ? 'text-slate-300 hover:bg-slate-50 rounded-lg'
                          : 'text-slate-700 hover:bg-slate-100 rounded-lg') +
                    (today && !isEdge ? ' ring-1 ring-inset ring-blue-300 rounded-lg' : '')
                  }
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          {start && (
            <button
              type="button"
              onClick={() => { onChange(null, null); }}
              className="mt-2 w-full text-xs font-semibold text-slate-500 hover:text-slate-700 py-1.5"
            >
              {labels.clear}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function stripTime(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}
