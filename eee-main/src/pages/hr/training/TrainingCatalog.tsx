import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Plus, BookOpen, CheckCircle2 } from 'lucide-react';
import { getTrainingCourses, getEnrollments, enrollInCourse, updateEnrollment } from '../../../services/hrApi';
import type { TrainingCourse, TrainingEnrollment } from '../../../services/hrApi';
import { getUsers } from '../../../services/authApi';
import type { ErpUser } from '../../../types/auth';
import { usePermissions } from '../../../contexts/PermissionContext';
import { supabase } from '../../../lib/supabase';

const STATUS_COLORS: Record<string, string> = {
  enrolled: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-600',
  cancelled: 'bg-slate-100 text-slate-500',
};

const CATEGORY_COLORS: Record<string, string> = {
  technical: 'bg-blue-100 text-blue-700',
  compliance: 'bg-red-100 text-red-600',
  leadership: 'bg-purple-100 text-purple-700',
  soft_skills: 'bg-emerald-100 text-emerald-700',
};

export default function TrainingCatalog() {
  const { t } = useTranslation('hr');
  const { can } = usePermissions();
  const canManage = can('hr', 'training', 'manage');

  const [courses, setCourses] = useState<TrainingCourse[]>([]);
  const [enrollments, setEnrollments] = useState<TrainingEnrollment[]>([]);
  const [employees, setEmployees] = useState<ErpUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'catalog' | 'enrollments'>('catalog');
  const [currentErpId, setCurrentErpId] = useState('');
  const [selectedEmp, setSelectedEmp] = useState('');
  const [enrollModal, setEnrollModal] = useState<TrainingCourse | null>(null);
  const [enrollTargetEmp, setEnrollTargetEmp] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: eu } = await supabase.from('erp_user').select('id').eq('auth_user_id', user.id).single();
        if (eu) { setCurrentErpId(eu.id); setSelectedEmp(eu.id); }
      }
    })();
    Promise.all([getTrainingCourses(), getUsers().catch(() => [])]).then(([c, e]) => {
      setCourses(c); setEmployees(e); setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (selectedEmp) getEnrollments({ employeeId: selectedEmp }).then(setEnrollments).catch(() => setEnrollments([]));
    else setEnrollments([]);
  }, [selectedEmp]);

  async function enroll() {
    if (!enrollModal || !enrollTargetEmp) return;
    setSaving(true);
    await enrollInCourse(enrollTargetEmp, enrollModal.id);
    setEnrollModal(null);
    getEnrollments({ employeeId: selectedEmp || enrollTargetEmp }).then(setEnrollments);
    setSaving(false);
  }

  async function markComplete(enrollmentId: number) {
    await updateEnrollment(enrollmentId, { status: 'completed' });
    if (selectedEmp) getEnrollments({ employeeId: selectedEmp }).then(setEnrollments);
  }

  async function markInProgress(enrollmentId: number) {
    await updateEnrollment(enrollmentId, { status: 'in_progress' });
    if (selectedEmp) getEnrollments({ employeeId: selectedEmp }).then(setEnrollments);
  }

  const enrolledCourseIds = new Set(enrollments.map(e => e.course_id));

  return (
    <div className="min-h-screen bg-[#faf8f5] flex flex-col">
      <div className="px-10 pt-8 pb-5 border-b border-slate-200 bg-white">
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">{t('trainingCatalog.breadcrumb')}</p>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-900">{t('trainingCatalog.title')}</h1>
        </div>
        <div className="flex gap-1 mt-4">
          {(['catalog', 'enrollments'] as const).map(tabKey => (
            <button key={tabKey} onClick={() => setTab(tabKey)}
              className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors ${tab === tabKey ? 'bg-teal-600 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
              {tabKey === 'catalog' ? t('trainingCatalog.tabCatalog') : t('trainingCatalog.tabEnrollments')}
            </button>
          ))}
        </div>
      </div>

      <main className="flex-1 overflow-y-auto px-10 py-7">
        {loading ? (
          <div className="flex items-center gap-2 text-slate-400 py-16 justify-center"><Loader2 size={18} className="animate-spin" /></div>
        ) : tab === 'catalog' ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
            {courses.length === 0 && (
              <div className="col-span-3 bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-400 text-sm">{t('trainingCatalog.noCourses')}</div>
            )}
            {courses.map(c => {
              const alreadyEnrolled = enrolledCourseIds.has(c.id);
              return (
                <div key={c.id} className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1.5">
                        {c.category && (
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${CATEGORY_COLORS[c.category] ?? 'bg-slate-100 text-slate-600'}`}>
                            {c.category.replace('_', ' ')}
                          </span>
                        )}
                        {c.is_mandatory && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-600">{t('trainingCatalog.mandatory')}</span>
                        )}
                      </div>
                      <h3 className="text-sm font-bold text-slate-900">{c.title}</h3>
                      {c.provider && <p className="text-xs text-slate-400 mt-0.5">{c.provider}</p>}
                    </div>
                  </div>
                  {c.description && <p className="text-xs text-slate-500 mb-3 flex-1">{c.description}</p>}
                  <div className="flex items-center justify-between mt-auto pt-3 border-t border-slate-100">
                    <span className="text-xs text-slate-400">{c.duration_hours ? `${c.duration_hours}h` : '—'}</span>
                    {alreadyEnrolled ? (
                      <span className="flex items-center gap-1 text-xs font-bold text-emerald-600"><CheckCircle2 size={13} /> {t('trainingCatalog.enrolled')}</span>
                    ) : (
                      <button onClick={() => { setEnrollModal(c); setEnrollTargetEmp(currentErpId); }}
                        className="flex items-center gap-1 px-3 py-1.5 bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold rounded-lg">
                        <Plus size={12} /> {t('trainingCatalog.enroll')}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div>
            {canManage && (
              <div className="mb-6 max-w-xs">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('trainingCatalog.viewEmployee')}</label>
                <select value={selectedEmp} onChange={e => setSelectedEmp(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="">{t('trainingCatalog.selectEmployee')}</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select>
              </div>
            )}

            {!selectedEmp ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
                <BookOpen size={40} className="opacity-30" />
                <p className="text-sm">{t('trainingCatalog.selectEmployeePrompt')}</p>
              </div>
            ) : enrollments.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
                <BookOpen size={40} className="opacity-30" />
                <p className="text-sm">{t('trainingCatalog.noEnrollments')}</p>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead><tr className="bg-slate-50 border-b border-slate-200">
                    {['course','category','duration','enrolledAt','status','score','actions'].map(h =>
                      <th key={h} className="px-5 py-3 text-left text-[10px] font-bold text-slate-500 uppercase tracking-wider">{t(`trainingCatalog.col.${h}`)}</th>)}
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {enrollments.map(e => {
                      const course = courses.find(c => c.id === e.course_id);
                      return (
                        <tr key={e.id} className="text-sm">
                          <td className="px-5 py-3.5 font-semibold text-slate-900">{course?.title ?? `Course #${e.course_id}`}</td>
                          <td className="px-5 py-3.5">
                            {course?.category && (
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${CATEGORY_COLORS[course.category] ?? 'bg-slate-100 text-slate-600'}`}>
                                {course.category.replace('_', ' ')}
                              </span>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-slate-500">{course?.duration_hours ? `${course.duration_hours}h` : '—'}</td>
                          <td className="px-5 py-3.5 text-slate-500">{e.enrolled_at?.slice(0, 10) ?? '—'}</td>
                          <td className="px-5 py-3.5">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COLORS[e.status]}`}>{e.status.replace('_', ' ')}</span>
                          </td>
                          <td className="px-5 py-3.5 text-slate-500">{e.score != null ? `${e.score}%` : '—'}</td>
                          <td className="px-5 py-3.5">
                            <div className="flex gap-1">
                              {e.status === 'enrolled' && (
                                <button onClick={() => markInProgress(e.id)} className="text-xs font-bold text-blue-600 hover:underline">{t('trainingCatalog.start')}</button>
                              )}
                              {(e.status === 'enrolled' || e.status === 'in_progress') && (
                                <button onClick={() => markComplete(e.id)} className="text-xs font-bold text-emerald-600 hover:underline ml-2">{t('trainingCatalog.complete')}</button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>

      {enrollModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold text-slate-900 mb-1">{t('trainingCatalog.enrollInCourse')}</h2>
            <p className="text-sm text-slate-500 mb-5">{enrollModal.title}</p>
            {canManage && (
              <div className="mb-4">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">{t('trainingCatalog.enrollEmployee')}</label>
                <select value={enrollTargetEmp} onChange={e => setEnrollTargetEmp(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500">
                  <option value="">{t('trainingCatalog.selectEmployee')}</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
                </select>
              </div>
            )}
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setEnrollModal(null)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">{t('trainingCatalog.cancel')}</button>
              <button onClick={enroll} disabled={saving || !enrollTargetEmp}
                className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
                {saving ? t('trainingCatalog.enrolling') : t('trainingCatalog.confirmEnrollment')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
