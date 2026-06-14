import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Ban, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { Combobox, type ComboOption } from '../../components/ui/Combobox';
import { usePermissions } from '../../contexts/PermissionContext';
import { PermissionDenied } from '../qc/components/PermissionDenied';
import { listMachines, type MachineOption } from '../../services/productionRunApi';
import {
  listDevices, createDevice, updateDevice, disableDevice,
  type DeviceRow, type DeviceInput,
} from '../../services/productionDeviceApi';

interface Draft {
  code: string; name: string; machine_id: string; pin: string; active: boolean;
}
const emptyDraft = (): Draft => ({ code: '', name: '', machine_id: '', pin: '', active: true });
const rowToDraft = (r: DeviceRow): Draft => ({
  code: r.code, name: r.name ?? '', machine_id: r.machine_id, pin: r.pin, active: r.active,
});

export default function DevicePage() {
  const { t } = useTranslation('production');
  const { can } = usePermissions();
  const canView = can('production', 'device', 'view');
  const canCreate = can('production', 'device', 'create');
  const canEdit = can('production', 'device', 'edit');
  const canDisable = can('production', 'device', 'disable');

  const [rows, setRows] = useState<DeviceRow[]>([]);
  const [machines, setMachines] = useState<MachineOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState<'new' | string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());

  useEffect(() => {
    listMachines().then(setMachines).catch((e) => setError(e.message));
  }, []);

  const load = () => {
    if (!canView) return;
    setLoading(true);
    listDevices().then(setRows).catch((e) => setError(e.message)).finally(() => setLoading(false));
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [canView]);

  const machineOpts = useMemo<ComboOption[]>(
    () => machines.map((m) => ({ value: m.id, label: m.code })), [machines]);

  if (!canView) {
    return <PermissionDenied permission="production.device.view" feature={t('device.feature')} />;
  }

  const openNew = () => { setError(''); setMsg(''); setDraft(emptyDraft()); setDrawer('new'); };
  const openEdit = (r: DeviceRow) => { setError(''); setMsg(''); setDraft(rowToDraft(r)); setDrawer(r.id); };
  const close = () => { setDrawer(null); setDraft(emptyDraft()); setError(''); };

  const buildInput = (): DeviceInput | null => {
    if (!draft.code.trim()) { setError(t('device.errCode')); return null; }
    if (!draft.machine_id) { setError(t('device.errMachine')); return null; }
    if (!draft.pin.trim()) { setError(t('device.errPin')); return null; }
    return {
      code: draft.code.trim(), name: draft.name.trim() || null,
      machine_id: draft.machine_id, pin: draft.pin.trim(), active: draft.active,
    };
  };

  const save = async () => {
    const input = buildInput();
    if (!input) return;
    setBusy(true); setError('');
    try {
      if (drawer && drawer !== 'new') await updateDevice(drawer, input);
      else await createDevice(input);
      setMsg(t('device.saved'));
      close();
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doDisable = async (id: string) => {
    if (!window.confirm(t('device.disableConfirm'))) return;
    setBusy(true); setError('');
    try {
      await disableDevice(id);
      setMsg(t('device.disabled'));
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const th = 'px-3 py-2.5 text-[10px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap';
  const td = 'px-3 py-2.5 text-sm text-slate-700';
  const inputCls = 'w-full border border-slate-300 rounded-lg px-2.5 h-9 text-sm mt-1 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400';

  return (
    <div className="p-6 max-w-5xl">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-slate-900">{t('device.title')}</h1>
        <p className="text-slate-600 text-sm mt-0.5">{t('device.subtitle')}</p>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <span className="text-xs text-slate-500">{t('device.rowCount', { count: rows.length })}</span>
        {canCreate && (
          <button onClick={openNew}
            className="ml-auto flex items-center gap-1.5 px-4 h-9 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold">
            <Plus size={14} /> {t('device.addDevice')}
          </button>
        )}
      </div>

      {msg && <p className="text-emerald-700 bg-emerald-50 p-2 rounded-lg mb-3 text-sm">{msg}</p>}
      {error && !drawer && <p className="text-red-600 bg-red-50 p-2 rounded-lg mb-3 text-sm">{error}</p>}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className={cn(th, 'text-left')}>{t('device.colCode')}</th>
                <th className={cn(th, 'text-left')}>{t('device.colName')}</th>
                <th className={cn(th, 'text-left')}>{t('device.colMachine')}</th>
                <th className={cn(th, 'text-left')}>{t('device.colStatus')}</th>
                <th className={cn(th, 'text-right w-24')}>{t('device.actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => (canEdit ? openEdit(r) : undefined)}>
                  <td className={cn(td, 'font-mono font-medium whitespace-nowrap')}>{r.code}</td>
                  <td className={td}>{r.name ?? '—'}</td>
                  <td className={cn(td, 'whitespace-nowrap')}>{r.machine_code ?? '—'}</td>
                  <td className={td}>
                    <span className={cn('inline-block px-1.5 py-0.5 rounded text-xs font-semibold',
                      r.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                      {r.active ? t('device.statusActive') : t('device.statusDisabled')}
                    </span>
                  </td>
                  <td className={cn(td, 'text-right whitespace-nowrap')} onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      {canEdit && (
                        <button onClick={() => openEdit(r)} disabled={busy}
                          className="p-1.5 rounded hover:bg-slate-200 text-slate-500 disabled:opacity-40" title={t('device.edit')}>
                          <Pencil size={14} />
                        </button>
                      )}
                      {canDisable && r.active && (
                        <button onClick={() => doDisable(r.id)} disabled={busy}
                          className="p-1.5 rounded hover:bg-red-100 text-red-500 disabled:opacity-40" title={t('device.disable')}>
                          <Ban size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-400">{t('device.empty')}</td></tr>
              )}
              {loading && (
                <tr><td colSpan={5} className="px-4 py-12 text-center text-sm text-slate-400">{t('device.loading')}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-slate-900/30" onClick={close} />
          <aside className="relative w-full max-w-md bg-white h-full shadow-2xl flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
              <h2 className="text-base font-bold text-slate-900">
                {t(drawer === 'new' ? 'device.drawerTitleNew' : 'device.drawerTitleEdit')}
              </h2>
              <button onClick={close} className="p-1.5 rounded hover:bg-slate-100 text-slate-500" title={t('device.close')}>
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {error && <p className="text-red-600 bg-red-50 p-2 rounded-lg text-sm">{error}</p>}

              <label className="block">
                <span className="text-xs font-medium text-slate-600">{t('device.colCode')}<span className="text-red-500"> *</span></span>
                <input className={inputCls} value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">{t('device.colName')}</span>
                <input className={inputCls} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">{t('device.colMachine')}<span className="text-red-500"> *</span></span>
                <Combobox className={inputCls} value={draft.machine_id}
                  onChange={(v) => setDraft({ ...draft, machine_id: v })}
                  options={machineOpts} placeholder={t('device.selectPlaceholder')} />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-slate-600">{t('device.colPin')}<span className="text-red-500"> *</span></span>
                <input className={inputCls} value={draft.pin} onChange={(e) => setDraft({ ...draft, pin: e.target.value })} />
                <span className="text-[11px] text-slate-400 mt-1 inline-block">{t('device.pinHint')}</span>
              </label>
              <label className="flex items-center gap-2 mt-1">
                <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                <span className="text-sm text-slate-700">{t('device.activeLabel')}</span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 shrink-0">
              <button onClick={close} disabled={busy}
                className="px-4 h-9 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-semibold">
                {t('device.cancel')}
              </button>
              <button onClick={save} disabled={busy}
                className="px-5 h-9 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold disabled:opacity-50">
                {busy ? t('device.saving') : t('device.save')}
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
