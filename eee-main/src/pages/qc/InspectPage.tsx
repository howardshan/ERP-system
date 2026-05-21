import React, { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import {
  inspectionTemplateForSubLot,
  submitInspection,
} from '../../services/qcApi';
import { QcStatusBadge } from './components/QcStatusBadge';
import { NumericKeypad } from './components/NumericKeypad';

interface Props {
  subLotId: string;
  onBack: () => void;
}

export default function InspectPage({ subLotId, onBack }: Props) {
  const [subCode, setSubCode] = useState('');
  const [status, setStatus] = useState('');
  const [limits, setLimits] = useState<[number, number] | null>(null);
  const [aw, setAw] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!subLotId) return;
    inspectionTemplateForSubLot(subLotId)
      .then((d) => {
        setSubCode(d.sub_lot.sub_lot_code);
        setStatus(d.sub_lot.status);
        setLimits([d.template.lower_limit, d.template.upper_limit]);
      })
      .catch((e) => setError(e.message));
  }, [subLotId]);

  const submit = async () => {
    if (!subLotId || !aw) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await submitInspection(subLotId, parseFloat(aw));
      setResult(res.result);
      setStatus(res.new_status);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-8 max-w-2xl mx-auto">
      <button onClick={onBack} className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 mb-4">
        <ArrowLeft size={14} /> Back to queue
      </button>

      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold text-slate-900">{subCode || 'Inspection'}</h1>
        {status && <QcStatusBadge status={status} />}
      </div>

      {limits && (
        <p className="text-sm text-slate-600 mb-4">
          Water Activity (Aw) acceptable range: [{limits[0]}, {limits[1]}]
        </p>
      )}

      {result ? (
        <div className={`rounded-2xl p-8 text-center mb-6 ${
          result === 'pass' ? 'bg-emerald-100 text-emerald-900' : 'bg-red-100 text-red-900'
        }`}>
          <p className="text-3xl font-bold">{result === 'pass' ? 'Passed' : 'Failed · On Hold'}</p>
          <button
            type="button"
            className="mt-6 w-full bg-slate-800 text-white py-3 rounded-xl text-sm font-bold"
            onClick={onBack}
          >
            Back to pending queue
          </button>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border-2 p-6 mb-6 text-center">
            <p className="text-xs text-slate-500 mb-2">Water Activity (Aw)</p>
            <p className="text-5xl font-bold tabular-nums text-slate-900">{aw || '—'}</p>
          </div>
          <NumericKeypad value={aw} onChange={setAw} />
          {error && <p className="text-red-600 mt-4 text-center text-sm">{error}</p>}
          <button
            type="button"
            disabled={!aw || submitting}
            onClick={submit}
            className="mt-6 w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-base font-semibold py-3 rounded-xl"
          >
            {submitting ? 'Submitting…' : 'Submit inspection'}
          </button>
        </>
      )}
    </div>
  );
}
