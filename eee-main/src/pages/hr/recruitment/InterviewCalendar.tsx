import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, CheckCircle2, XCircle } from 'lucide-react';
import { getCalendarEvents } from '../../../services/hrApi';
import type { CalendarEvent } from '../../../services/hrApi';

interface Props {
  currentErpId: string;
  onRespond: (id: number, status: 'confirmed' | 'declined') => Promise<void>;
}

const HOUR_START = 8;
const HOUR_END = 20;
const SLOT_H = 48; // px per 30-min slot
const TOTAL_SLOTS = (HOUR_END - HOUR_START) * 2;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function fmtDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fmtLabel(d: Date): string {
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function getEventStyle(ev: CalendarEvent): { top: number; height: number } {
  const start = new Date(ev.start_time);
  const end = new Date(ev.end_time);
  const startMins = (start.getHours() - HOUR_START) * 60 + start.getMinutes();
  const durationMins = (end.getTime() - start.getTime()) / 60000;
  const top = (startMins / 30) * SLOT_H;
  const height = Math.max((durationMins / 30) * SLOT_H, SLOT_H * 0.75);
  return { top, height };
}

function eventColorClass(status: CalendarEvent['status']): string {
  switch (status) {
    case 'confirmed': return 'bg-teal-100 border-teal-300 text-teal-800';
    case 'tentative': return 'bg-amber-100 border-amber-300 text-amber-800';
    case 'declined':  return 'bg-slate-100 border-slate-300 text-slate-500 opacity-60';
    case 'cancelled': return 'bg-slate-100 border-slate-200 text-slate-400 opacity-40';
  }
}

export default function InterviewCalendar({ currentErpId, onRespond }: Props) {
  const { t } = useTranslation('hr');
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date()));
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [popup, setPopup] = useState<{ ev: CalendarEvent; x: number; y: number } | null>(null);
  const [responding, setResponding] = useState(false);

  const load = useCallback(async () => {
    if (!currentErpId) return;
    setLoading(true);
    const weekEnd = addDays(weekStart, 7);
    try {
      const evs = await getCalendarEvents(currentErpId, fmtDate(weekStart), fmtDate(weekEnd));
      setEvents(evs);
    } finally {
      setLoading(false);
    }
  }, [currentErpId, weekStart]);

  useEffect(() => { load(); }, [load]);

  function prevWeek() { setWeekStart(w => addDays(w, -7)); }
  function nextWeek() { setWeekStart(w => addDays(w, 7)); }
  function goToday()  { setWeekStart(startOfWeek(new Date())); }

  function handleEventClick(ev: CalendarEvent, e: React.MouseEvent) {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopup({ ev, x: rect.left, y: rect.bottom + 8 });
  }

  async function handleRespond(id: number, status: 'confirmed' | 'declined') {
    setResponding(true);
    try {
      await onRespond(id, status);
      setPopup(null);
      load();
    } finally {
      setResponding(false);
    }
  }

  const totalGridH = TOTAL_SLOTS * SLOT_H;

  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col" onClick={() => setPopup(null)}>
      {/* Header */}
      <div className="px-10 pt-8 pb-5 border-b border-slate-200 bg-white">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t('interviewCalendar.breadcrumb')}</p>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">{t('interviewCalendar.title')}</h1>
          <div className="flex items-center gap-2">
            <button onClick={prevWeek} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600"><ChevronLeft size={18} /></button>
            <button onClick={goToday} className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">{t('interviewCalendar.today')}</button>
            <button onClick={nextWeek} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600"><ChevronRight size={18} /></button>
            <span className="ml-3 text-sm font-semibold text-slate-700">
              {fmtLabel(weekStart)} – {fmtLabel(addDays(weekStart, 6))}
            </span>
          </div>
        </div>
      </div>

      <main className="flex-1 overflow-auto px-6 py-5">
        {loading && (
          <div className="flex items-center justify-center py-16 text-slate-400 text-sm">{t('interviewCalendar.loading')}</div>
        )}

        {!loading && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {/* Day header row */}
            <div className="grid border-b border-slate-200" style={{ gridTemplateColumns: '56px repeat(7, 1fr)' }}>
              <div className="border-r border-slate-100" />
              {DAYS.map((day, i) => {
                const d = addDays(weekStart, i);
                const isToday = fmtDate(d) === fmtDate(new Date());
                return (
                  <div key={day} className={`py-3 text-center border-r border-slate-100 last:border-r-0 ${isToday ? 'bg-teal-50' : ''}`}>
                    <p className={`text-[10px] font-bold uppercase tracking-wider ${isToday ? 'text-teal-600' : 'text-slate-400'}`}>{t(`interviewCalendar.days.${day}`)}</p>
                    <p className={`text-sm font-bold mt-0.5 ${isToday ? 'text-teal-700' : 'text-slate-700'}`}>{d.getDate()}</p>
                  </div>
                );
              })}
            </div>

            {/* Grid body */}
            <div className="grid overflow-y-auto" style={{ gridTemplateColumns: '56px repeat(7, 1fr)', maxHeight: '70vh' }}>
              {/* Time labels */}
              <div className="relative border-r border-slate-100" style={{ height: totalGridH }}>
                {Array.from({ length: TOTAL_SLOTS }).map((_, i) => (
                  i % 2 === 0 ? (
                    <div key={i} className="absolute right-2 text-[10px] text-slate-400 leading-none"
                      style={{ top: i * SLOT_H - 6 }}>
                      {String(HOUR_START + i / 2).padStart(2, '0')}:00
                    </div>
                  ) : null
                ))}
              </div>

              {/* Day columns */}
              {DAYS.map((_, di) => {
                const d = addDays(weekStart, di);
                const dayStr = fmtDate(d);
                const isToday = dayStr === fmtDate(new Date());
                const dayEvents = events.filter(ev => {
                  const evDay = new Date(ev.start_time);
                  return fmtDate(evDay) === dayStr;
                });

                return (
                  <div key={di}
                    className={`relative border-r border-slate-100 last:border-r-0 ${isToday ? 'bg-teal-50/30' : ''}`}
                    style={{ height: totalGridH }}>
                    {/* Slot lines */}
                    {Array.from({ length: TOTAL_SLOTS }).map((_, si) => (
                      <div key={si}
                        className={`absolute left-0 right-0 border-t ${si % 2 === 0 ? 'border-slate-200' : 'border-slate-100'}`}
                        style={{ top: si * SLOT_H }} />
                    ))}

                    {/* Events */}
                    {dayEvents.map(ev => {
                      const { top, height } = getEventStyle(ev);
                      if (top < 0 || top > totalGridH) return null;
                      return (
                        <div key={ev.id}
                          onClick={(e) => handleEventClick(ev, e)}
                          className={`absolute left-1 right-1 rounded border px-1.5 py-1 cursor-pointer hover:brightness-95 transition-all overflow-hidden ${eventColorClass(ev.status)}`}
                          style={{ top: top + 1, height: height - 2, zIndex: 10 }}>
                          <p className="text-[11px] font-semibold leading-tight truncate">{ev.title}</p>
                          {ev.candidate_name && (
                            <p className="text-[10px] opacity-75 truncate">{ev.candidate_name}</p>
                          )}
                          <p className="text-[10px] opacity-60">{fmtTime(ev.start_time)}</p>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="flex items-center gap-5 mt-4 px-1">
          {[
            { status: 'tentative', label: t('interviewCalendar.status.tentative'), cls: 'bg-amber-200' },
            { status: 'confirmed', label: t('interviewCalendar.status.confirmed'), cls: 'bg-teal-200' },
            { status: 'declined',  label: t('interviewCalendar.status.declined'),  cls: 'bg-slate-200' },
          ].map(({ status, label, cls }) => (
            <div key={status} className="flex items-center gap-1.5">
              <span className={`w-3 h-3 rounded ${cls}`} />
              <span className="text-xs text-slate-500">{label}</span>
            </div>
          ))}
        </div>
      </main>

      {/* Event popup */}
      {popup && (
        <div
          className="fixed z-50 bg-white border border-slate-200 rounded-xl shadow-xl p-4 w-72"
          style={{ left: Math.min(popup.x, window.innerWidth - 300), top: Math.min(popup.y, window.innerHeight - 220) }}
          onClick={e => e.stopPropagation()}>
          <div className="flex items-start justify-between mb-2">
            <p className="font-semibold text-slate-900 text-sm leading-tight pr-2">{popup.ev.title}</p>
            <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${
              popup.ev.status === 'confirmed' ? 'bg-emerald-100 text-emerald-700' :
              popup.ev.status === 'tentative' ? 'bg-amber-100 text-amber-700' :
              'bg-slate-100 text-slate-500'
            }`}>{t(`interviewCalendar.status.${popup.ev.status}`)}</span>
          </div>
          {popup.ev.candidate_name && (
            <p className="text-xs text-slate-500 mb-1">{t('interviewCalendar.candidate', { name: popup.ev.candidate_name })}</p>
          )}
          <p className="text-xs text-slate-500 mb-3">
            {fmtTime(popup.ev.start_time)} – {fmtTime(popup.ev.end_time)}
          </p>
          {popup.ev.notes && (
            <p className="text-xs text-slate-600 bg-slate-50 rounded-lg p-2 mb-3">{popup.ev.notes}</p>
          )}

          {popup.ev.status === 'tentative' && popup.ev.owner_id === currentErpId && (
            <div className="flex gap-2">
              <button
                disabled={responding}
                onClick={() => handleRespond(popup.ev.id, 'confirmed')}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold rounded-lg disabled:opacity-50">
                <CheckCircle2 size={13} /> {t('interviewCalendar.accept')}
              </button>
              <button
                disabled={responding}
                onClick={() => handleRespond(popup.ev.id, 'declined')}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-semibold rounded-lg disabled:opacity-50">
                <XCircle size={13} /> {t('interviewCalendar.decline')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
