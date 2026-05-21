import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { AppShell } from '../../components/AppShell';
import { NumericKeypad } from '../../components/NumericKeypad';
import { StatusBadge } from '../../components/StatusBadge';
import { Alert, Button, Card, PageHeader, PageSkeleton } from '../../components/ui';
import { cn } from '../../lib/utils';

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!subLotId) return;
    setLoading(true);
    api
      .inspectionTemplate(subLotId)
      .then((d) => {
        setSubCode(d.sub_lot.sub_lot_code);
        setStatus(d.sub_lot.status);
        setLimits([d.template.lower_limit, d.template.upper_limit]);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
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

  if (loading && !subCode) {
    return (
      <AppShell variant="qc">
        <PageSkeleton />
      </AppShell>
    );
  }

  const passed = result === 'pass';

  return (
    <AppShell variant="qc">
      <PageHeader
        title={subCode || 'Inspection'}
        description={
          limits
            ? `Water Activity (Aw) acceptable range: [${limits[0]}, ${limits[1]}]`
            : undefined
        }
        action={status ? <StatusBadge status={status} /> : undefined}
      />

      {result ? (
        <Card
          variant="elevated"
          className={cn(
            'p-8 text-center mb-6 border-2',
            passed ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'
          )}
        >
          {passed ? (
            <CheckCircle2 className="h-16 w-16 text-emerald-600 mx-auto mb-4" aria-hidden />
          ) : (
            <XCircle className="h-16 w-16 text-red-600 mx-auto mb-4" aria-hidden />
          )}
          <p className={cn('text-3xl font-bold', passed ? 'text-emerald-900' : 'text-red-900')}>
            {passed ? 'Passed' : 'Failed · On Hold'}
          </p>
          <Button variant="secondary" tone="qc" fullWidth size="lg" className="mt-6" onClick={() => navigate('/qc/pending')}>
            Back to pending queue
          </Button>
        </Card>
      ) : (
        <div className="max-w-md mx-auto">
          <Card variant="elevated" className="p-8 mb-6 text-center border-2 border-teal-100">
            <p className="text-sm font-medium text-slate-500 mb-2 uppercase tracking-wide">Water Activity (Aw)</p>
            <p className="text-6xl font-bold tabular-nums text-slate-900">{aw || '—'}</p>
          </Card>
          <NumericKeypad value={aw} onChange={setAw} />
          {error && (
            <div className="mt-4">
              <Alert variant="error">{error}</Alert>
            </div>
          )}
          <Button
            variant="primary"
            tone="qc"
            fullWidth
            size="lg"
            className="mt-6"
            disabled={!aw || submitting}
            loading={submitting}
            onClick={submit}
          >
            Submit inspection
          </Button>
        </div>
      )}
    </AppShell>
  );
}
