import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  dashboardSummary,
  createDisposition,
  createDispositionsBulk,
  formatQcDateTime,
  DashboardSummary,
  SubLot,
  TodayInspectionItem,
} from '../../services/qcApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { QcStatusBadge } from './components/QcStatusBadge';
import { SelectAllCheckbox } from './components/SelectAllCheckbox';
import { PermissionDenied } from './components/PermissionDenied';
import { cn } from '../../lib/utils';

type Panel = 'pending' | 'hold' | 'passed' | 'rate';

const DISP_TYPES = [
  { value: 'rework' as const,     labelKey: 'adminDashboard.dispRework' },
  { value: 'grind' as const,      labelKey: 'adminDashboard.dispGrind' },
  { value: 'scrap' as const,      labelKey: 'adminDashboard.dispScrap' },
  { value: 'concession' as const, labelKey: 'adminDashboard.dispConcession' },
];

export default function AdminDashboard() {
  const { t } = useTranslation('qc');
  const { can } = usePermissions();
  const canView = can('qc', 'dashboard', 'view');
  // Admin dashboard uses the legacy 4-type disposition picker; require all three
  // disposition types for full functionality, or any to show the panel.
  const canDispose =
    can('qc', 'testing', 'dispose_redry') ||
    can('qc', 'testing', 'dispose_room_temp') ||
    can('qc', 'testing', 'dispose_scrap_concession');

  const [data, setData] = useState<DashboardSummary | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const [selectedHold, setSelectedHold] = useState<SubLot | null>(null);
  const [dispType, setDispType] = useState<'rework' | 'grind' | 'scrap' | 'concession'>('rework');
  const [dispRemark, setDispRemark] = useState('');

  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkDispType, setBulkDispType] = useState<'rework' | 'grind' | 'scrap' | 'concession'>('rework');
  const [bulkDispRemark, setBulkDispRemark] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => {
    dashboardSummary()
      .then((d) => {
        setData(d);
        if (selectedHold) {
          const still = d.holds.find(h => h.id === selectedHold.id);
          if (!still) setSelectedHold(null);
        }
        // Drop selected holds that are no longer in hold list
        setBulkSelected((prev) => {
          const next = new Set<string>();
          for (const id of prev) {
            if (d.holds.some(h => h.id === id)) next.add(id);
          }
          return next;
        });
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
    const enabled = selectedHold === null && bulkSelected.size === 0;
    if (!enabled) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHold, bulkSelected.size]);

  const togglePanel = (p: Panel) => {
    setPanel(cur => (cur === p ? null : p));
    setSelectedHold(null);
    setBulkSelected(new Set());
    setMsg('');
  };

  const submitDisposition = async () => {
    if (!selectedHold) return;
    setError('');
    try {
      await createDisposition({
        drying_sub_lot_id: selectedHold.id,
        type: dispType,
        remark: dispRemark || undefined,
      });
      setMsg(t('adminDashboard.dispositionCompleted', { code: selectedHold.sub_lot_code }));
      setSelectedHold(null);
      setDispRemark('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('adminDashboard.dispositionFailed'));
    }
  };

  const bulkDispose = async () => {
    if (bulkSelected.size === 0) return;
    setBusy(true);
    setError('');
    try {
      await createDispositionsBulk([...bulkSelected], bulkDispType, bulkDispRemark || null);
      setMsg(t('adminDashboard.bulkDisposed', { count: bulkSelected.size, type: bulkDispType }));
      setBulkSelected(new Set());
      setBulkDispRemark('');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('adminDashboard.bulkDispositionFailed'));
    }
    setBusy(false);
  };

  const toggleBulkSelect = (id: string) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSelectedHold(null);
  };

  const toggleBulkSelectAll = () => {
    if (!data) return;
    if (bulkSelected.size === data.holds.length) setBulkSelected(new Set());
    else setBulkSelected(new Set(data.holds.map(h => h.id)));
  };

  const pollingEnabled = selectedHold === null && bulkSelected.size === 0;

  if (!canView) {
    return <PermissionDenied permission="qc.dashboard.view" feature={t('adminDashboard.qualityDashboard')} />;
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">{t('adminDashboard.qualityDashboard')}</h1>
      <p className="text-xs text-slate-500 mb-4">
        {t('adminDashboard.subtitle')}{!pollingEnabled ? t('adminDashboard.pausedWhileDisposing') : ''}
      </p>

      {msg && <p className="text-emerald-700 bg-emerald-50 p-2 rounded-lg mb-3 text-sm">{msg}</p>}
      {error && <p className="text-red-600 mb-3 text-sm">{error}</p>}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <StatCard label={t('adminDashboard.pending')}      value={data.pending_count}                                         accent="amber"   active={panel === 'pending'} onClick={() => togglePanel('pending')} />
            <StatCard label={t('adminDashboard.hold')}         value={data.hold_count}                                            accent="red"     active={panel === 'hold'}    onClick={() => togglePanel('hold')} />
            <StatCard label={t('adminDashboard.passedToday')} value={data.today_passed}                                          accent="emerald" active={panel === 'passed'}  onClick={() => togglePanel('passed')} />
            <StatCard label={t('adminDashboard.passRate')}    value={data.pass_rate != null ? `${data.pass_rate}%` : '—'}        accent="blue"    active={panel === 'rate'}    onClick={() => togglePanel('rate')} />
          </div>

          {data.longest_wait_minutes != null && panel !== 'pending' && (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
              {t('adminDashboard.longestPendingWait', { minutes: data.longest_wait_minutes })}
            </p>
          )}

          {panel === 'pending' && (
            <DetailPanel title={t('adminDashboard.pendingSubLots')}>
              {data.longest_wait_minutes != null && (
                <p className="text-sm text-amber-800 mb-3">{t('adminDashboard.longestWait', { minutes: data.longest_wait_minutes })}</p>
              )}
              <SubLotList items={data.pending_items} emptyText={t('adminDashboard.noPendingSubLots')} showWait />
            </DetailPanel>
          )}

          {panel === 'hold' && (
            <DetailPanel title={t('adminDashboard.holdSubLots')}>
              {data.holds.length === 0 ? (
                <p className="text-slate-500 text-sm">{t('adminDashboard.noHolds')}</p>
              ) : (
                <>
                  {canDispose && (
                    <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-3 flex-wrap gap-2">
                      <SelectAllCheckbox
                        total={data.holds.length}
                        selected={bulkSelected.size}
                        onToggleAll={toggleBulkSelectAll}
                        label={t('adminDashboard.selectAllHolds')}
                      />
                      {bulkSelected.size > 0 && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <select
                            className="border rounded-lg px-2 py-1 text-xs"
                            value={bulkDispType}
                            onChange={(e) => setBulkDispType(e.target.value as any)}
                          >
                            {DISP_TYPES.map(d => <option key={d.value} value={d.value}>{t(d.labelKey)}</option>)}
                          </select>
                          <input
                            type="text"
                            placeholder={t('adminDashboard.remarkOptional')}
                            value={bulkDispRemark}
                            onChange={(e) => setBulkDispRemark(e.target.value)}
                            className="border rounded-lg px-2 py-1 text-xs w-48"
                          />
                          <button
                            type="button"
                            onClick={bulkDispose}
                            disabled={busy}
                            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-red-600 hover:bg-red-500 text-white disabled:opacity-50"
                          >
                            {busy ? t('adminDashboard.disposing') : t('adminDashboard.disposeCount', { count: bulkSelected.size })}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  <ul className="space-y-2 mb-4">
                    {data.holds.map((h) => {
                      const checked = bulkSelected.has(h.id);
                      const single = selectedHold?.id === h.id;
                      return (
                        <li key={h.id} className={cn(
                          'flex items-start gap-3 bg-white rounded-xl border-2 p-3',
                          single ? 'border-blue-500' : checked ? 'border-blue-400 bg-blue-50/30' : 'border-red-200',
                        )}>
                          {canDispose && (
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleBulkSelect(h.id)}
                              className="w-4 h-4 rounded accent-blue-600 mt-1"
                            />
                          )}
                          <button
                            type="button"
                            onClick={() => { setSelectedHold(h); setBulkSelected(new Set()); setMsg(''); }}
                            className="flex-1 text-left min-w-0"
                            disabled={!canDispose}
                          >
                            <div className="flex justify-between items-start gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="font-semibold text-slate-900">{h.sub_lot_code}</div>
                                <p className="text-xs text-slate-600">{h.sku_name}</p>
                                {h.hold_reason && (
                                  <p className="text-xs text-red-700 mt-1 leading-snug">{t('adminDashboard.holdReason', { reason: h.hold_reason })}</p>
                                )}
                                {h.hold_inspected_at && (
                                  <p className="text-[11px] text-slate-500 mt-1">
                                    {t('adminDashboard.inspected', { time: formatQcDateTime(h.hold_inspected_at) })}
                                  </p>
                                )}
                              </div>
                              <QcStatusBadge status={h.status} />
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {selectedHold && canDispose && (
                    <div className="bg-white rounded-xl border p-4 space-y-3">
                      <p className="font-medium text-slate-900">{t('adminDashboard.disposeLabel', { code: selectedHold.sub_lot_code })}</p>
                      {selectedHold.hold_reason && (
                        <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-3">
                          {selectedHold.hold_reason}
                        </p>
                      )}
                      <select
                        className="w-full border rounded-lg px-3 py-2 text-sm"
                        value={dispType}
                        onChange={(e) => setDispType(e.target.value as any)}
                      >
                        {DISP_TYPES.map(d => <option key={d.value} value={d.value}>{t(d.labelKey)}</option>)}
                      </select>
                      <textarea
                        className="w-full border rounded-lg px-3 py-2 text-sm min-h-[80px]"
                        placeholder={t('adminDashboard.remarks')}
                        value={dispRemark}
                        onChange={(e) => setDispRemark(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={submitDisposition}
                          className="flex-1 bg-red-600 hover:bg-red-500 text-white py-2 rounded-lg text-sm font-medium"
                        >
                          {t('adminDashboard.confirmDisposition')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedHold(null)}
                          className="px-4 py-2 rounded-lg border text-sm"
                        >
                          {t('adminDashboard.cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </DetailPanel>
          )}

          {panel === 'passed' && (
            <DetailPanel title={t('adminDashboard.passedInspectionsToday')}>
              <TodayInspectionList items={data.today_passed_items} emptyText={t('adminDashboard.noPassedInspectionsToday')} />
            </DetailPanel>
          )}

          {panel === 'rate' && (
            <DetailPanel title={t('adminDashboard.todaysInspectionSummary')}>
              <div className="grid sm:grid-cols-3 gap-3 mb-4 text-sm">
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                  <p className="text-slate-600 text-xs">{t('adminDashboard.passed')}</p>
                  <p className="text-xl font-bold text-emerald-800">{data.today_passed}</p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-slate-600 text-xs">{t('adminDashboard.failed')}</p>
                  <p className="text-xl font-bold text-red-800">{data.today_failed}</p>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                  <p className="text-slate-600 text-xs">{t('adminDashboard.passRate')}</p>
                  <p className="text-xl font-bold text-blue-800">
                    {data.pass_rate != null ? `${data.pass_rate}%` : '—'}
                  </p>
                </div>
              </div>
              {data.today_failed > 0 && (
                <>
                  <h3 className="font-medium text-red-800 mb-2 text-sm">{t('adminDashboard.failedTodayOnHold')}</h3>
                  <TodayInspectionList items={data.today_failed_items} emptyText="" />
                </>
              )}
              {data.today_passed === 0 && data.today_failed === 0 && (
                <p className="text-slate-500 text-sm">{t('adminDashboard.noInspectionsToday')}</p>
              )}
            </DetailPanel>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({
  label, value, accent, active, onClick,
}: { label: string; value: number | string; accent: string; active: boolean; onClick: () => void }) {
  const colors: Record<string, string> = {
    amber:   'bg-amber-50 border-amber-200 hover:border-amber-400',
    red:     'bg-red-50 border-red-200 hover:border-red-400',
    emerald: 'bg-emerald-50 border-emerald-200 hover:border-emerald-400',
    blue:    'bg-blue-50 border-blue-200 hover:border-blue-400',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl border-2 p-3 text-left transition-shadow',
        colors[accent],
        active && 'ring-2 ring-blue-500 border-blue-500 shadow-md',
      )}
    >
      <p className="text-[11px] text-slate-600">{label}</p>
      <p className="text-xl font-bold mt-1 text-slate-900">{value}</p>
    </button>
  );
}

function DetailPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border rounded-xl p-4 mb-4">
      <h2 className="font-semibold text-base text-slate-900 mb-3">{title}</h2>
      {children}
    </section>
  );
}

function SubLotList({ items, emptyText, showWait }: { items: SubLot[]; emptyText: string; showWait?: boolean }) {
  const { t } = useTranslation('qc');
  if (items.length === 0) return <p className="text-slate-500 text-sm">{emptyText}</p>;
  return (
    <ul className="space-y-2">
      {items.map((s) => (
        <li key={s.id} className="border rounded-lg p-3 flex justify-between items-start gap-2">
          <div>
            <div className="font-medium text-slate-900">{s.sub_lot_code}</div>
            <p className="text-xs text-slate-600">{s.sku_name}{s.location_name ? ` · ${s.location_name}` : ''}</p>
            <p className="text-xs text-slate-500 mt-1">{t('adminDashboard.inTime', { time: formatQcDateTime(s.in_time) })}</p>
            <p className="text-xs text-slate-500">{t('adminDashboard.outTime', { time: formatQcDateTime(s.out_time) })}</p>
            {showWait && s.wait_minutes != null && (
              <p className="text-xs text-amber-800 mt-1">{t('adminDashboard.waiting', { minutes: s.wait_minutes })}</p>
            )}
          </div>
          <QcStatusBadge status={s.status} />
        </li>
      ))}
    </ul>
  );
}

function TodayInspectionList({ items, emptyText }: { items: TodayInspectionItem[]; emptyText: string }) {
  const { t } = useTranslation('qc');
  if (items.length === 0) {
    return emptyText ? <p className="text-slate-500 text-sm">{emptyText}</p> : null;
  }
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={`${item.sub_lot_id}-${item.submitted_at}`} className="border rounded-lg p-3">
          <div className="flex justify-between items-start gap-2">
            <div>
              <div className="font-medium text-slate-900">{item.sub_lot_code}</div>
              <p className="text-xs text-slate-600">{item.sku_name}</p>
            </div>
            <QcStatusBadge status={item.status} />
          </div>
          <p className="text-xs mt-2 text-slate-600">
            {t('adminDashboard.aw', { value: item.aw ?? '—', time: formatQcDateTime(item.submitted_at) })}
          </p>
          {item.fail_reason && (
            <p className="text-xs text-red-700 mt-1">{item.fail_reason}</p>
          )}
        </li>
      ))}
    </ul>
  );
}
