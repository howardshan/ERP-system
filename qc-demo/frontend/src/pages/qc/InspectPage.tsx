import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { AppShell } from '../../components/AppShell';
import { NumericKeypad } from '../../components/NumericKeypad';
import { StatusBadge } from '../../components/StatusBadge';

export function InspectPage() {
  const { subLotId } = useParams<{ subLotId: string }>();
  const navigate = useNavigate();
  const [subCode, setSubCode] = useState('');
  const [status, setStatus] = useState('');
  const [limits, setLimits] = useState<[number, number] | null>(null);
  const [aw, setAw] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!subLotId) return;
    api
      .inspectionTemplate(subLotId)
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
      const res = await api.submitInspection(subLotId, parseFloat(aw));
      setResult(res.result);
      setStatus(res.new_status);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell variant="qc" title={subCode || 'Inspection'}>
      <div className="flex justify-end -mt-2 mb-2">
        {status && <StatusBadge status={status} />}
      </div>
      {limits && (
        <p className="text-sm text-slate-600 mb-4">
          Water Activity (Aw) acceptable range: [{limits[0]}, {limits[1]}]
        </p>
      )}

      {result ? (
        <div
          className={`rounded-2xl p-8 text-center mb-6 ${
            result === 'pass' ? 'bg-emerald-100 text-emerald-900' : 'bg-red-100 text-red-900'
          }`}
        >
          <p className="text-3xl font-bold">{result === 'pass' ? 'Passed' : 'Failed · On Hold'}</p>
          <button
            type="button"
            className="mt-6 w-full bg-slate-800 text-white py-3 rounded-xl min-h-[48px]"
            onClick={() => navigate('/qc/pending')}
          >
            Back to pending queue
          </button>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border-2 p-6 mb-6 text-center">
            <p className="text-sm text-slate-500 mb-2">Water Activity (Aw)</p>
            <p className="text-5xl font-bold tabular-nums">{aw || '—'}</p>
          </div>
          <NumericKeypad value={aw} onChange={setAw} />
          {error && <p className="text-red-600 mt-4 text-center">{error}</p>}
          <button
            type="button"
            disabled={!aw || submitting}
            onClick={submit}
            className="mt-6 w-full bg-blue-600 text-white text-lg font-semibold py-4 rounded-xl min-h-[52px] disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit inspection'}
          </button>
        </>
      )}
    </AppShell>
  );
}
