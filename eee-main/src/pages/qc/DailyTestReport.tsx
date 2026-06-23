import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FileSignature, History, ClipboardList, CheckCircle2, Download, Lock, AlertTriangle,
} from 'lucide-react';
import {
  getDailyTestData, listDailyReports, signDailyReport, getDailyReportPdfUrl,
  formatQcDateTime, DailyTestRow, DailyReportListItem,
} from '../../services/qcApi';
import { usePermissions } from '../../contexts/PermissionContext';
import { cn } from '../../lib/utils';
import { PermissionDenied } from './components/PermissionDenied';
import { SignaturePad, SignatureValue } from './components/SignaturePad';
import { buildDailyReportPdf } from './dailyReportPdf';

/** Today's date as YYYY-MM-DD in the app's display timezone (America/Chicago). */
function todayStr(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export default function DailyTestReport() {
  const { t } = useTranslation('qc');
  const { can, erpUser } = usePermissions();
  const canView = can('qc', 'daily_report', 'view');
  const canSign = can('qc', 'daily_report', 'sign');

  const [activeTab, setActiveTab] = useState<'report' | 'history'>('report');
  const [reports, setReports] = useState<DailyReportListItem[]>([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const today = useMemo(() => todayStr(), []);
  const loadReports = useCallback(() => {
    listDailyReports().then(setReports).catch(e => setError(e.message));
  }, []);
  useEffect(() => { loadReports(); }, [loadReports]);

  if (!canView) {
    return <PermissionDenied permission="qc.daily_report.view" feature={t('dailyTestReport.title')} />;
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-1">{t('dailyTestReport.title')}</h1>
      <p className="text-xs text-slate-500 mb-4">{t('dailyTestReport.subtitle')}</p>

      <div className="flex gap-1 mb-5 bg-slate-100 rounded-lg p-1 w-fit">
        <button
          type="button"
          onClick={() => setActiveTab('report')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors',
            activeTab === 'report' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
          )}
        >
          <ClipboardList size={12} /> {t('dailyTestReport.tabReport')}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('history')}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold transition-colors',
            activeTab === 'history' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
          )}
        >
          <History size={12} /> {t('dailyTestReport.tabHistory')}
        </button>
      </div>

      {msg && <p className="text-emerald-700 bg-emerald-50 p-2 rounded-lg mb-3 text-sm flex items-center gap-2">
        <CheckCircle2 size={14} /> {msg}
      </p>}
      {error && <p className="text-red-600 bg-red-50 p-2 rounded-lg mb-3 text-sm">{error}</p>}

      {activeTab === 'report' ? (
        <ReportTab
          today={today}
          reports={reports}
          canSign={canSign}
          defaultName={erpUser?.full_name ?? ''}
          onSigned={(m) => { setMsg(m); loadReports(); }}
          onError={setError}
        />
      ) : (
        <HistoryTab reports={reports} onError={setError} />
      )}
    </div>
  );
}

// ─── Report (current / selected day) ────────────────────────────────────────

function ReportTab({
  today, reports, canSign, defaultName, onSigned, onError,
}: {
  today: string;
  reports: DailyReportListItem[];
  canSign: boolean;
  defaultName: string;
  onSigned: (msg: string) => void;
  onError: (m: string) => void;
}) {
  const { t } = useTranslation('qc');
  const [date, setDate] = useState(today);
  const [rows, setRows] = useState<DailyTestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const existing = useMemo(() => reports.find(r => r.report_date === date) ?? null, [reports, date]);
  const isBackdated = date < today;

  useEffect(() => {
    setLoading(true);
    getDailyTestData(date)
      .then(setRows)
      .catch(e => onError(e.message))
      .finally(() => setLoading(false));
  }, [date, onError]);

  const passCount = rows.filter(r => r.result === 'pass').length;
  const failCount = rows.filter(r => r.result === 'fail').length;

  const signDisabled = busy || !signature || (isBackdated && !reason.trim());

  const handleSign = async () => {
    if (!signature) return;
    if (isBackdated && !reason.trim()) return;
    setBusy(true);
    try {
      const signedAt = new Date().toISOString();
      const snapshot = {
        report_date: date,
        rows,
        summary: { test_count: rows.length, pass_count: passCount, fail_count: failCount },
        signed_at: signedAt,
        signer_name: defaultName,
        backdate_reason: isBackdated ? reason.trim() : null,
      };
      const doc = buildDailyReportPdf({
        date,
        rows,
        signerName: defaultName,
        signedAt,
        signatureImg: signature.dataUrl,
        backdateReason: isBackdated ? reason.trim() : null,
      });
      const pdfBlob = doc.output('blob');
      await signDailyReport({
        date,
        signatureType: signature.type,
        signatureData: signature.dataUrl,
        snapshot,
        pdfBlob,
        backdateReason: isBackdated ? reason.trim() : null,
      });
      onSigned(t('dailyTestReport.signSuccess', { date }));
      setSignature(null);
      setReason('');
    } catch (e) {
      onError(e instanceof Error ? e.message : t('dailyTestReport.signFailed'));
    }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      {/* Date picker + summary */}
      <div className="bg-white border rounded-xl p-4 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">
            {t('dailyTestReport.reportDate')}
          </label>
          <input
            type="date"
            value={date}
            max={today}
            onChange={e => setDate(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="text-xs text-slate-600 flex gap-4">
          <span>{t('dailyTestReport.totalTests')} <span className="font-bold text-slate-900">{rows.length}</span></span>
          <span className="text-emerald-700">{t('dailyTestReport.pass')} <span className="font-bold">{passCount}</span></span>
          <span className="text-red-700">{t('dailyTestReport.fail')} <span className="font-bold">{failCount}</span></span>
        </div>
        {isBackdated && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-300">
            <AlertTriangle size={11} /> {t('dailyTestReport.backdatedBadge')}
          </span>
        )}
      </div>

      {/* Test table */}
      <div className="bg-white border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="text-left px-3 py-2 font-bold">{t('dailyTestReport.colSample')}</th>
              <th className="text-left px-3 py-2 font-bold">{t('dailyTestReport.colCart')}</th>
              <th className="text-left px-3 py-2 font-bold">{t('dailyTestReport.colProduct')}</th>
              <th className="text-left px-3 py-2 font-bold">{t('dailyTestReport.colReadings')}</th>
              <th className="text-left px-3 py-2 font-bold">{t('dailyTestReport.colResult')}</th>
              <th className="text-left px-3 py-2 font-bold">{t('dailyTestReport.colTime')}</th>
              <th className="text-left px-3 py-2 font-bold">{t('dailyTestReport.colInspector')}</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400 text-xs">{t('dailyTestReport.loading')}</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-400 text-xs">{t('dailyTestReport.noTests')}</td></tr>
            ) : rows.map((r, i) => (
              <tr key={r.inspection_id} className={cn('border-t border-slate-100', i % 2 ? 'bg-slate-50/40' : '')}>
                <td className="px-3 py-2 font-mono font-bold text-slate-900">{r.sample_id ?? '—'}</td>
                <td className="px-3 py-2 font-mono text-slate-700">{r.sub_lot_code}</td>
                <td className="px-3 py-2 text-slate-700">{r.sku_name ?? '—'}</td>
                <td className="px-3 py-2 text-slate-600 text-xs">
                  {r.readings.length === 0 ? '—' : r.readings.map(x => `${x.item_name}: ${x.value}${x.unit ? ` ${x.unit}` : ''}`).join('  ·  ')}
                </td>
                <td className="px-3 py-2">
                  <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full',
                    r.result === 'pass' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700')}>
                    {r.result === 'pass' ? t('dailyTestReport.pass') : t('dailyTestReport.fail')}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-500 text-xs">{formatQcDateTime(r.submitted_at)}</td>
                <td className="px-3 py-2 text-slate-600 text-xs">{r.inspector ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Signature / locked state */}
      {existing ? (
        <SignedBanner report={existing} onError={onError} />
      ) : !canSign ? (
        <div className="bg-white border rounded-xl p-6 text-center text-sm text-slate-500">
          {t('dailyTestReport.noSignPermission')}
        </div>
      ) : (
        <div className="bg-white border rounded-xl p-4 space-y-4">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <FileSignature size={15} /> {t('dailyTestReport.signSection')}
          </h3>

          {isBackdated && (
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-amber-800">
                {t('dailyTestReport.backdateReasonLabel')} <span className="text-red-600">*</span>
              </label>
              <textarea
                value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder={t('dailyTestReport.backdateReasonPlaceholder')}
                className="w-full border border-amber-300 bg-amber-50/40 rounded-lg px-3 py-2 text-sm min-h-[56px] focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
            </div>
          )}

          <SignaturePad defaultName={defaultName} onChange={setSignature} disabled={busy} />

          <button
            type="button"
            onClick={handleSign}
            disabled={signDisabled}
            className="w-full bg-slate-900 hover:bg-slate-700 text-white py-2.5 rounded-lg text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? t('dailyTestReport.signing') : t('dailyTestReport.signAndArchive')}
          </button>
        </div>
      )}
    </div>
  );
}

function SignedBanner({ report, onError }: { report: DailyReportListItem; onError: (m: string) => void }) {
  const { t } = useTranslation('qc');
  const download = async () => {
    if (!report.pdf_storage_path) return;
    try {
      const url = await getDailyReportPdfUrl(report.pdf_storage_path);
      window.open(url, '_blank');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'download failed');
    }
  };
  return (
    <div className="bg-emerald-50 border-2 border-emerald-200 rounded-xl p-4 flex flex-wrap items-center gap-3">
      <Lock size={18} className="text-emerald-700" />
      <div className="text-sm flex-1 min-w-0">
        <p className="font-bold text-emerald-900">{t('dailyTestReport.signedLocked')}</p>
        <p className="text-xs text-emerald-700 mt-0.5">
          {t('dailyTestReport.signedBy', { name: report.signer_name, time: formatQcDateTime(report.signed_at) })}
          {report.is_backdated && report.backdate_reason && (
            <span className="block text-amber-700 mt-0.5">
              {t('dailyTestReport.backdatedReasonShown', { reason: report.backdate_reason })}
            </span>
          )}
        </p>
      </div>
      {report.pdf_storage_path && (
        <button
          type="button"
          onClick={download}
          className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg bg-white border border-emerald-300 text-emerald-800 hover:bg-emerald-100"
        >
          <Download size={13} /> {t('dailyTestReport.downloadPdf')}
        </button>
      )}
    </div>
  );
}

// ─── History ────────────────────────────────────────────────────────────────

function HistoryTab({ reports, onError }: { reports: DailyReportListItem[]; onError: (m: string) => void }) {
  const { t } = useTranslation('qc');
  const download = async (path: string | null) => {
    if (!path) return;
    try {
      const url = await getDailyReportPdfUrl(path);
      window.open(url, '_blank');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'download failed');
    }
  };

  if (reports.length === 0) {
    return <div className="bg-white border rounded-xl p-10 text-center text-sm text-slate-500">{t('dailyTestReport.noHistory')}</div>;
  }

  return (
    <div className="bg-white border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
          <tr>
            <th className="text-left px-3 py-2 font-bold">{t('dailyTestReport.reportDate')}</th>
            <th className="text-left px-3 py-2 font-bold">{t('dailyTestReport.colSigner')}</th>
            <th className="text-left px-3 py-2 font-bold">{t('dailyTestReport.colSignedAt')}</th>
            <th className="text-left px-3 py-2 font-bold">{t('dailyTestReport.colCounts')}</th>
            <th className="text-left px-3 py-2 font-bold">{t('dailyTestReport.colFlags')}</th>
            <th className="text-right px-3 py-2 font-bold">{t('dailyTestReport.colPdf')}</th>
          </tr>
        </thead>
        <tbody>
          {reports.map(r => (
            <tr key={r.id} className="border-t border-slate-100">
              <td className="px-3 py-2 font-mono font-bold text-slate-900">{r.report_date}</td>
              <td className="px-3 py-2 text-slate-700">{r.signer_name}</td>
              <td className="px-3 py-2 text-slate-500 text-xs">{formatQcDateTime(r.signed_at)}</td>
              <td className="px-3 py-2 text-xs">
                <span className="text-emerald-700 font-bold">{r.pass_count}</span>
                <span className="text-slate-400"> / </span>
                <span className="text-red-700 font-bold">{r.fail_count}</span>
                <span className="text-slate-400"> ({r.test_count})</span>
              </td>
              <td className="px-3 py-2">
                {r.is_backdated && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-300"
                    title={r.backdate_reason ?? ''}
                  >
                    <AlertTriangle size={9} /> {t('dailyTestReport.backdatedBadge')}
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  type="button"
                  onClick={() => download(r.pdf_storage_path)}
                  disabled={!r.pdf_storage_path}
                  className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:border-blue-400 hover:text-blue-700 disabled:opacity-40"
                >
                  <Download size={12} /> {t('dailyTestReport.downloadPdf')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
