import { supabase } from '../lib/supabase';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HrDepartment {
  id: number;
  name: string;
  code: string;
  head_id: string | null;
  head_name?: string;
  cost_center: string | null;
  is_active: boolean;
  headcount?: number;
  created_at: string;
}

export interface JobRequisition {
  id: number;
  title: string;
  department_id: number | null;
  department_name?: string;
  hiring_manager: string | null;
  hiring_manager_name?: string;
  status: 'draft' | 'open' | 'on_hold' | 'filled' | 'cancelled';
  headcount: number;
  job_description: string | null;
  requirements: string | null;
  salary_min: number | null;
  salary_max: number | null;
  target_fill_date: string | null;
  created_by: string | null;
  created_at: string;
  closed_at: string | null;
  candidate_count?: number;
}

export interface Candidate {
  id: number;
  requisition_id: number | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  resume_url: string | null;
  status: 'new' | 'screening' | 'interview' | 'offer' | 'hired' | 'rejected' | 'withdrawn';
  applied_at: string;
  notes: string | null;
}

export interface Interview {
  id: number;
  candidate_id: number;
  candidate_name?: string;
  requisition_id: number | null;
  round: number;
  interview_type: string;
  scheduled_at: string | null;
  duration_mins: number;
  location: string | null;
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show';
  created_by: string | null;
  created_at: string;
  panelists?: InterviewPanelist[];
}

export interface InterviewPanelist {
  interview_id: number;
  interviewer_id: string;
  interviewer_name?: string;
  role: 'lead' | 'support' | 'observer';
  scorecard?: InterviewScorecard;
}

export interface InterviewScorecard {
  id: number;
  interview_id: number;
  interviewer_id: string;
  submitted_at: string;
  overall_rating: number | null;
  recommendation: string | null;
  technical_score: number | null;
  communication_score: number | null;
  problem_solving_score: number | null;
  culture_fit_score: number | null;
  leadership_score: number | null;
  strengths: string | null;
  weaknesses: string | null;
  notes: string | null;
}

export interface Offer {
  id: number;
  candidate_id: number;
  requisition_id: number | null;
  offered_salary: number;
  start_date: string | null;
  offer_expiry: string | null;
  status: 'draft' | 'sent' | 'accepted' | 'declined' | 'expired';
  approved_by: string | null;
  created_at: string;
  notes: string | null;
}

export interface LeaveType {
  id: number;
  name: string;
  code: string;
  is_paid: boolean;
  accrual_enabled: boolean;
  accrual_rate_monthly: number | null;
  max_balance: number | null;
  carry_over_days: number;
  requires_approval: boolean;
  requires_document: boolean;
  min_notice_days: number;
  is_active: boolean;
}

export interface LeaveBalance {
  id: number;
  employee_id: string;
  leave_type_id: number;
  leave_type_name?: string;
  leave_type_code?: string;
  year: number;
  accrued: number;
  used: number;
  pending: number;
  adjusted: number;
  carry_over: number;
  available: number; // computed: accrued + carry_over + adjusted - used - pending
}

export interface LeaveRequest {
  id: number;
  employee_id: string;
  employee_name?: string;
  leave_type_id: number;
  leave_type_name?: string;
  start_date: string;
  end_date: string;
  days_requested: number;
  half_day: boolean;
  half_day_period: string | null;
  reason: string | null;
  document_url: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | 'recalled';
  approver_id: string | null;
  approver_name?: string;
  approved_at: string | null;
  rejection_reason: string | null;
  created_at: string;
}

export interface LeaveRecall {
  id: number;
  leave_request_id: number;
  recall_date: string;
  days_recalled: number;
  reason: string | null;
  approved_by: string | null;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export interface Holiday {
  id: number;
  date: string;
  name: string;
  year: number;
}

export interface SalaryRecord {
  id: number;
  employee_id: string;
  effective_date: string;
  salary: number;
  pay_frequency: 'monthly' | 'bi_weekly' | 'weekly';
  currency: string;
  pay_grade: string | null;
  reason: string | null;
  created_by: string | null;
  created_at: string;
}

export interface OvertimeRequest {
  id: number;
  employee_id: string;
  employee_name?: string;
  date: string;
  hours: number;
  type: 'weekday' | 'weekend' | 'holiday';
  reason: string | null;
  project_code: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'paid';
  approver_id: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface BonusTemplate {
  id: number;
  name: string;
  department_id: number | null;
  department_name?: string;
  formula_type: 'fixed' | 'multiplier' | 'tiered' | 'performance_based';
  base: 'monthly_salary' | 'annual_salary' | 'fixed_amount';
  multiplier: number | null;
  fixed_amount: number | null;
  tiers: { min: number; max: number | null; rate: number }[] | null;
  min_tenure_months: number;
  requires_active: boolean;
  performance_weight: number;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export interface BonusRun {
  id: number;
  name: string;
  template_id: number;
  template_name?: string;
  period_start: string;
  period_end: string;
  status: 'draft' | 'calculating' | 'review' | 'approved' | 'paid' | 'cancelled';
  total_amount: number | null;
  created_by: string | null;
  approved_by: string | null;
  created_at: string;
  paid_at: string | null;
}

export interface BonusLine {
  id: number;
  bonus_run_id: number;
  employee_id: string;
  employee_name?: string;
  department?: string;
  base_amount: number;
  calculated_amount: number;
  manual_override: number | null;
  final_amount: number;
  performance_score: number | null;
  calculation_detail: Record<string, unknown> | null;
}

export interface PayRun {
  id: number;
  name: string;
  period_start: string;
  period_end: string;
  pay_date: string;
  status: 'draft' | 'processing' | 'review' | 'approved' | 'paid' | 'cancelled';
  total_gross: number | null;
  total_deductions: number | null;
  total_net: number | null;
  created_by: string | null;
  approved_by: string | null;
  created_at: string;
}

export interface PaySlip {
  id: number;
  pay_run_id: number;
  employee_id: string;
  employee_name?: string;
  department?: string;
  base_salary: number;
  overtime_amount: number;
  bonus_amount: number;
  allowances: { name: string; amount: number }[] | null;
  gross_pay: number;
  income_tax: number;
  social_insurance: number;
  housing_fund: number;
  other_deductions: { name: string; amount: number }[] | null;
  total_deductions: number;
  net_pay: number;
  je_id: number | null;
}

export interface BenefitPlan {
  id: number;
  name: string;
  type: string;
  provider: string | null;
  employee_contribution_rate: number | null;
  employer_contribution_rate: number | null;
  employee_fixed: number | null;
  employer_fixed: number | null;
  applies_to: 'all' | 'full_time' | 'management';
  is_active: boolean;
}

export interface EmployeeBenefit {
  id: number;
  employee_id: string;
  benefit_plan_id: number;
  benefit_plan_name?: string;
  benefit_plan_type?: string;
  enrolled_at: string;
  ended_at: string | null;
  employee_contribution: number | null;
  employer_contribution: number | null;
}

export interface ReviewCycle {
  id: number;
  name: string;
  period_start: string;
  period_end: string;
  status: 'draft' | 'active' | 'self_review' | 'manager_review' | 'calibration' | 'completed';
  created_by: string | null;
  created_at: string;
}

export interface Review {
  id: number;
  cycle_id: number;
  employee_id: string;
  employee_name?: string;
  reviewer_id: string | null;
  reviewer_name?: string;
  self_rating: number | null;
  self_summary: string | null;
  self_goals_met: string | null;
  manager_rating: number | null;
  manager_summary: string | null;
  final_rating: number | null;
  strengths: string | null;
  improvements: string | null;
  status: 'pending' | 'self_complete' | 'manager_complete' | 'calibrated';
  completed_at: string | null;
}

export interface Goal {
  id: number;
  employee_id: string;
  review_cycle_id: number | null;
  title: string;
  description: string | null;
  target: string | null;
  progress: number;
  status: 'on_track' | 'at_risk' | 'completed' | 'cancelled';
  due_date: string | null;
  created_at: string;
}

export interface TrainingCourse {
  id: number;
  title: string;
  category: string | null;
  provider: string | null;
  duration_hours: number | null;
  is_mandatory: boolean;
  target_roles: string[] | null;
  description: string | null;
  is_active: boolean;
  created_at: string;
  enrollment_count?: number;
}

export interface TrainingEnrollment {
  id: number;
  course_id: number;
  course_title?: string;
  employee_id: string;
  employee_name?: string;
  status: 'enrolled' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  enrolled_at: string;
  completed_at: string | null;
  score: number | null;
  certificate_url: string | null;
}

export interface CalendarEvent {
  id: number;
  owner_id: string;
  owner_name?: string;
  interview_id: number | null;
  title: string;
  start_time: string;
  end_time: string;
  status: 'tentative' | 'confirmed' | 'declined' | 'cancelled';
  requested_by: string | null;
  requested_by_name?: string;
  responded_at: string | null;
  notes: string | null;
  created_at: string;
  candidate_name?: string;
  interview_type?: string;
}

export interface HrAuditLog {
  id: number;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_auth_id: string | null;
  actor_name: string;
  changed_at: string;
  before_snapshot: Record<string, unknown> | null;
  after_snapshot: Record<string, unknown> | null;
  diff: Record<string, { before: unknown; after: unknown }> | null;
  entry_number: string | null;
  description: string | null;
}

// ── Audit Logger ──────────────────────────────────────────────────────────────

async function logHrAction(params: {
  entity_type: string;
  entity_id: string;
  action: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  entry_number?: string;
  description?: string;
}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    let actorName = 'Unknown';
    const { data: eu } = await supabase
      .from('erp_user')
      .select('full_name')
      .eq('auth_user_id', user.id)
      .single();
    if (eu?.full_name) actorName = eu.full_name;

    const diff: Record<string, unknown> = {};
    if (params.before && params.after) {
      for (const key of new Set([...Object.keys(params.before), ...Object.keys(params.after)])) {
        if (JSON.stringify(params.before[key]) !== JSON.stringify(params.after[key])) {
          diff[key] = { before: params.before[key], after: params.after[key] };
        }
      }
    }

    await supabase.from('hr_audit_log').insert({
      entity_type: params.entity_type,
      entity_id: params.entity_id,
      action: params.action,
      actor_auth_id: user.id,
      actor_name: actorName,
      before_snapshot: params.before ?? null,
      after_snapshot: params.after ?? null,
      diff: Object.keys(diff).length > 0 ? diff : null,
      entry_number: params.entry_number ?? null,
      description: params.description ?? null,
    });
  } catch {
    // fire-and-forget; never throw
  }
}

// ── Departments ───────────────────────────────────────────────────────────────

export async function getDepartments(): Promise<HrDepartment[]> {
  const { data, error } = await supabase
    .from('hr_department')
    .select(`
      *,
      head:erp_user!head_id(full_name)
    `)
    .order('name');
  if (error) throw error;

  const headcounts: Record<number, number> = {};
  const { data: users } = await supabase
    .from('erp_user')
    .select('department')
    .eq('is_active', true);
  if (users) {
    for (const u of users) {
      if (u.department) headcounts[u.department] = (headcounts[u.department] ?? 0) + 1;
    }
  }

  return (data ?? []).map((d: any) => ({
    ...d,
    head_name: d.head?.full_name ?? null,
    headcount: headcounts[d.name] ?? 0,
  }));
}

export async function createDepartment(data: Partial<HrDepartment>): Promise<HrDepartment> {
  const { data: row, error } = await supabase
    .from('hr_department')
    .insert({ name: data.name, code: data.code, head_id: data.head_id, cost_center: data.cost_center })
    .select()
    .single();
  if (error) throw error;
  logHrAction({ entity_type: 'department', entity_id: String(row.id), action: 'created', after: row, entry_number: row.code, description: `Department "${row.name}" created` });
  return row;
}

export async function updateDepartment(id: number, patch: Partial<HrDepartment>): Promise<void> {
  const { data: before } = await supabase.from('hr_department').select().eq('id', id).single();
  const { error } = await supabase.from('hr_department').update(patch).eq('id', id);
  if (error) throw error;
  const { data: after } = await supabase.from('hr_department').select().eq('id', id).single();
  logHrAction({ entity_type: 'department', entity_id: String(id), action: 'updated', before, after, entry_number: after?.code, description: `Department "${after?.name}" updated` });
}

// ── Recruitment ───────────────────────────────────────────────────────────────

export async function getRequisitions(params?: { status?: string; search?: string }): Promise<JobRequisition[]> {
  let q = supabase
    .from('hr_job_requisition')
    .select(`*, department:hr_department!department_id(name), manager:erp_user!hiring_manager(full_name)`)
    .order('created_at', { ascending: false });
  if (params?.status) q = q.eq('status', params.status);
  if (params?.search) q = q.ilike('title', `%${params.search}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    ...r,
    department_name: r.department?.name ?? null,
    hiring_manager_name: r.manager?.full_name ?? null,
  }));
}

export async function createRequisition(data: Partial<JobRequisition>): Promise<JobRequisition> {
  const { data: row, error } = await supabase
    .from('hr_job_requisition')
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  logHrAction({ entity_type: 'job_requisition', entity_id: String(row.id), action: 'created', after: row, description: `Job requisition "${row.title}" created` });
  return row;
}

export async function updateRequisition(id: number, patch: Partial<JobRequisition>): Promise<void> {
  const { data: before } = await supabase.from('hr_job_requisition').select().eq('id', id).single();
  const { error } = await supabase.from('hr_job_requisition').update(patch).eq('id', id);
  if (error) throw error;
  const { data: after } = await supabase.from('hr_job_requisition').select().eq('id', id).single();
  logHrAction({ entity_type: 'job_requisition', entity_id: String(id), action: 'updated', before, after, description: `Job requisition "${after?.title}" updated` });
}

export async function getCandidates(requisitionId?: number): Promise<Candidate[]> {
  let q = supabase.from('hr_candidate').select('*').order('applied_at', { ascending: false });
  if (requisitionId) q = q.eq('requisition_id', requisitionId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function createCandidate(data: Partial<Candidate>): Promise<Candidate> {
  const { data: row, error } = await supabase.from('hr_candidate').insert(data).select().single();
  if (error) throw error;
  logHrAction({ entity_type: 'candidate', entity_id: String(row.id), action: 'created', after: row, description: `Candidate "${row.full_name}" added` });
  return row;
}

export async function updateCandidateStatus(id: number, status: Candidate['status'], notes?: string): Promise<void> {
  const { data: before } = await supabase.from('hr_candidate').select().eq('id', id).single();
  const patch: any = { status };
  if (notes !== undefined) patch.notes = notes;
  const { error } = await supabase.from('hr_candidate').update(patch).eq('id', id);
  if (error) throw error;
  logHrAction({ entity_type: 'candidate', entity_id: String(id), action: 'status_changed', before, after: { ...before, ...patch }, description: `Candidate status changed to ${status}` });
}

export async function getInterviews(params?: { candidateId?: number; myInterviews?: boolean; authUserId?: string }): Promise<Interview[]> {
  let q = supabase
    .from('hr_interview')
    .select(`*, candidate:hr_candidate!candidate_id(full_name)`)
    .order('scheduled_at', { ascending: true });
  if (params?.candidateId) q = q.eq('candidate_id', params.candidateId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, candidate_name: r.candidate?.full_name ?? null }));
}

export async function createInterview(data: Partial<Interview>): Promise<Interview> {
  const { data: row, error } = await supabase.from('hr_interview').insert(data).select().single();
  if (error) throw error;
  logHrAction({ entity_type: 'interview', entity_id: String(row.id), action: 'created', after: row, description: `Interview round ${row.round} scheduled` });
  return row;
}

export async function scheduleInterviewWithPanelists(
  interviewData: Partial<Interview>,
  panelists: Array<{ id: string; role: InterviewPanelist['role'] }>
): Promise<Interview> {
  const interview = await createInterview(interviewData);

  await Promise.all(panelists.map(p =>
    supabase.from('hr_interview_panelist').insert({ interview_id: interview.id, interviewer_id: p.id, role: p.role })
  ));

  if (interview.scheduled_at && interview.duration_mins && panelists.length > 0) {
    const start = new Date(interview.scheduled_at);
    const end = new Date(start.getTime() + interview.duration_mins * 60000);
    const { data: { user } } = await supabase.auth.getUser();
    let requestedBy: string | null = null;
    if (user) {
      const { data: eu } = await supabase.from('erp_user').select('id').eq('auth_user_id', user.id).single();
      if (eu) requestedBy = eu.id;
    }
    const candidateName = (interview as any).candidate_name ?? `Interview Round ${interview.round}`;
    await supabase.from('hr_calendar_event').insert(
      panelists.map(p => ({
        owner_id: p.id,
        interview_id: interview.id,
        title: candidateName,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        status: 'tentative',
        requested_by: requestedBy,
      }))
    );
  }
  return interview;
}

export async function updateInterview(id: number, patch: Partial<Interview>): Promise<void> {
  const { error } = await supabase.from('hr_interview').update(patch).eq('id', id);
  if (error) throw error;
}

export async function addPanelist(interviewId: number, interviewerId: string, role: InterviewPanelist['role']): Promise<void> {
  const { error } = await supabase.from('hr_interview_panelist').insert({ interview_id: interviewId, interviewer_id: interviewerId, role });
  if (error) throw error;
}

export async function removePanelist(interviewId: number, interviewerId: string): Promise<void> {
  const { error } = await supabase.from('hr_interview_panelist').delete().eq('interview_id', interviewId).eq('interviewer_id', interviewerId);
  if (error) throw error;
}

export async function getInterviewPanelists(interviewId: number): Promise<InterviewPanelist[]> {
  const { data, error } = await supabase
    .from('hr_interview_panelist')
    .select(`*, interviewer:erp_user!interviewer_id(full_name)`)
    .eq('interview_id', interviewId);
  if (error) throw error;
  return (data ?? []).map((p: any) => ({ ...p, interviewer_name: p.interviewer?.full_name ?? null }));
}

export async function submitScorecard(data: Partial<InterviewScorecard>): Promise<void> {
  const { error } = await supabase.from('hr_interview_scorecard').upsert(data, { onConflict: 'interview_id,interviewer_id' });
  if (error) throw error;
  logHrAction({ entity_type: 'interview_scorecard', entity_id: String(data.interview_id), action: 'submitted', after: data as any, description: `Scorecard submitted for interview ${data.interview_id}` });
}

export async function getScorecards(interviewId: number): Promise<InterviewScorecard[]> {
  const { data, error } = await supabase.from('hr_interview_scorecard').select('*').eq('interview_id', interviewId);
  if (error) throw error;
  return data ?? [];
}

export async function createOffer(data: Partial<Offer>): Promise<Offer> {
  const { data: row, error } = await supabase.from('hr_offer').insert(data).select().single();
  if (error) throw error;
  logHrAction({ entity_type: 'offer', entity_id: String(row.id), action: 'created', after: row, description: `Offer created for candidate ${row.candidate_id}` });
  return row;
}

export async function updateOffer(id: number, patch: Partial<Offer>): Promise<void> {
  const { data: before } = await supabase.from('hr_offer').select().eq('id', id).single();
  const { error } = await supabase.from('hr_offer').update(patch).eq('id', id);
  if (error) throw error;
  const { data: after } = await supabase.from('hr_offer').select().eq('id', id).single();
  logHrAction({ entity_type: 'offer', entity_id: String(id), action: `status_${after?.status}`, before, after, description: `Offer status changed to ${after?.status}` });
}

export async function getOffers(candidateId?: number): Promise<Offer[]> {
  let q = supabase.from('hr_offer').select('*').order('created_at', { ascending: false });
  if (candidateId) q = q.eq('candidate_id', candidateId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// ── Leave Management ──────────────────────────────────────────────────────────

export async function getLeaveTypes(): Promise<LeaveType[]> {
  const { data, error } = await supabase.from('hr_leave_type').select('*').order('name');
  if (error) throw error;
  return data ?? [];
}

export async function createLeaveType(data: Partial<LeaveType>): Promise<LeaveType> {
  const { data: row, error } = await supabase.from('hr_leave_type').insert(data).select().single();
  if (error) throw error;
  return row;
}

export async function updateLeaveType(id: number, patch: Partial<LeaveType>): Promise<void> {
  const { error } = await supabase.from('hr_leave_type').update(patch).eq('id', id);
  if (error) throw error;
}

export async function getLeaveBalances(employeeId: string, year: number): Promise<LeaveBalance[]> {
  const { data, error } = await supabase
    .from('hr_leave_balance')
    .select(`*, leave_type:hr_leave_type!leave_type_id(name, code)`)
    .eq('employee_id', employeeId)
    .eq('year', year);
  if (error) throw error;
  return (data ?? []).map((b: any) => ({
    ...b,
    leave_type_name: b.leave_type?.name ?? null,
    leave_type_code: b.leave_type?.code ?? null,
    available: Number(b.accrued) + Number(b.carry_over) + Number(b.adjusted) - Number(b.used) - Number(b.pending),
  }));
}

export async function ensureLeaveBalances(employeeId: string, year: number): Promise<void> {
  const { data: types } = await supabase.from('hr_leave_type').select('id').eq('is_active', true);
  if (!types) return;
  for (const t of types) {
    await supabase.from('hr_leave_balance').upsert(
      { employee_id: employeeId, leave_type_id: t.id, year, accrued: 0, used: 0, pending: 0, adjusted: 0, carry_over: 0 },
      { onConflict: 'employee_id,leave_type_id,year', ignoreDuplicates: true }
    );
  }
}

export async function getHolidays(year: number): Promise<Holiday[]> {
  const { data, error } = await supabase.from('hr_holiday').select('*').eq('year', year).order('date');
  if (error) throw error;
  return data ?? [];
}

export async function createHoliday(data: Partial<Holiday>): Promise<Holiday> {
  const { data: row, error } = await supabase.from('hr_holiday').insert(data).select().single();
  if (error) throw error;
  return row;
}

export async function deleteHoliday(id: number): Promise<void> {
  const { error } = await supabase.from('hr_holiday').delete().eq('id', id);
  if (error) throw error;
}

function countWorkdays(start: string, end: string, holidays: Set<string>): number {
  let count = 0;
  const cur = new Date(start);
  const fin = new Date(end);
  while (cur <= fin) {
    const dow = cur.getDay();
    const iso = cur.toISOString().slice(0, 10);
    if (dow !== 0 && dow !== 6 && !holidays.has(iso)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

export async function submitLeaveRequest(data: {
  employee_id: string;
  leave_type_id: number;
  start_date: string;
  end_date: string;
  half_day?: boolean;
  half_day_period?: string;
  reason?: string;
  document_url?: string;
  approver_id?: string;
}): Promise<LeaveRequest> {
  const holidays = await getHolidays(new Date(data.start_date).getFullYear());
  const holidaySet = new Set(holidays.map(h => h.date));
  let days = data.half_day ? 0.5 : countWorkdays(data.start_date, data.end_date, holidaySet);

  const { data: row, error } = await supabase.from('hr_leave_request').insert({
    ...data,
    days_requested: days,
    status: 'pending',
  }).select().single();
  if (error) throw error;

  // Update pending balance
  await supabase.from('hr_leave_balance')
    .upsert({ employee_id: data.employee_id, leave_type_id: data.leave_type_id, year: new Date(data.start_date).getFullYear(), accrued: 0, used: 0, pending: 0, adjusted: 0, carry_over: 0 }, { onConflict: 'employee_id,leave_type_id,year', ignoreDuplicates: true });
  const balYear = new Date(data.start_date).getFullYear();
  const { data: bal } = await supabase.from('hr_leave_balance').select('pending').eq('employee_id', data.employee_id).eq('leave_type_id', data.leave_type_id).eq('year', balYear).single();
  if (bal) {
    await supabase.from('hr_leave_balance').update({ pending: (bal.pending ?? 0) + days }).eq('employee_id', data.employee_id).eq('leave_type_id', data.leave_type_id).eq('year', balYear);
  }

  logHrAction({ entity_type: 'leave_request', entity_id: String(row.id), action: 'submitted', after: row, description: `Leave request submitted: ${days} day(s) from ${data.start_date} to ${data.end_date}` });
  return row;
}

export async function approveLeaveRequest(id: number, approverId: string): Promise<void> {
  const { data: req } = await supabase.from('hr_leave_request').select().eq('id', id).single();
  if (!req) throw new Error('Leave request not found');

  const { error } = await supabase.from('hr_leave_request').update({ status: 'approved', approver_id: approverId, approved_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;

  // Move from pending to used
  await supabase.from('hr_leave_balance')
    .select('pending, used')
    .eq('employee_id', req.employee_id)
    .eq('leave_type_id', req.leave_type_id)
    .eq('year', new Date(req.start_date).getFullYear())
    .then(async ({ data: b }) => {
      if (b?.[0]) {
        await supabase.from('hr_leave_balance').update({
          pending: Math.max(0, Number(b[0].pending) - Number(req.days_requested)),
          used: Number(b[0].used) + Number(req.days_requested),
        }).eq('employee_id', req.employee_id).eq('leave_type_id', req.leave_type_id).eq('year', new Date(req.start_date).getFullYear());
      }
    });

  logHrAction({ entity_type: 'leave_request', entity_id: String(id), action: 'approved', before: req, after: { ...req, status: 'approved' }, description: `Leave request approved: ${req.days_requested} day(s)` });
}

export async function rejectLeaveRequest(id: number, approverId: string, reason: string): Promise<void> {
  const { data: req } = await supabase.from('hr_leave_request').select().eq('id', id).single();
  if (!req) throw new Error('Leave request not found');

  const { error } = await supabase.from('hr_leave_request').update({ status: 'rejected', approver_id: approverId, rejection_reason: reason }).eq('id', id);
  if (error) throw error;

  // Release pending balance
  await supabase.from('hr_leave_balance')
    .select('pending')
    .eq('employee_id', req.employee_id)
    .eq('leave_type_id', req.leave_type_id)
    .eq('year', new Date(req.start_date).getFullYear())
    .then(async ({ data: b }) => {
      if (b?.[0]) {
        await supabase.from('hr_leave_balance').update({
          pending: Math.max(0, Number(b[0].pending) - Number(req.days_requested)),
        }).eq('employee_id', req.employee_id).eq('leave_type_id', req.leave_type_id).eq('year', new Date(req.start_date).getFullYear());
      }
    });

  logHrAction({ entity_type: 'leave_request', entity_id: String(id), action: 'rejected', before: req, after: { ...req, status: 'rejected', rejection_reason: reason }, description: `Leave request rejected: ${reason}` });
}

export async function cancelLeaveRequest(id: number): Promise<void> {
  const { data: req } = await supabase.from('hr_leave_request').select().eq('id', id).single();
  if (!req) throw new Error('Leave request not found');
  const { error } = await supabase.from('hr_leave_request').update({ status: 'cancelled' }).eq('id', id);
  if (error) throw error;

  if (req.status === 'pending') {
    await supabase.from('hr_leave_balance')
      .select('pending')
      .eq('employee_id', req.employee_id)
      .eq('leave_type_id', req.leave_type_id)
      .eq('year', new Date(req.start_date).getFullYear())
      .then(async ({ data: b }) => {
        if (b?.[0]) {
          await supabase.from('hr_leave_balance').update({
            pending: Math.max(0, Number(b[0].pending) - Number(req.days_requested)),
          }).eq('employee_id', req.employee_id).eq('leave_type_id', req.leave_type_id).eq('year', new Date(req.start_date).getFullYear());
        }
      });
  }
  logHrAction({ entity_type: 'leave_request', entity_id: String(id), action: 'cancelled', before: req, description: 'Leave request cancelled' });
}

export async function submitLeaveRecall(data: { leave_request_id: number; recall_date: string; days_recalled: number; reason?: string }): Promise<LeaveRecall> {
  const { data: row, error } = await supabase.from('hr_leave_recall').insert({ ...data, status: 'pending' }).select().single();
  if (error) throw error;
  return row;
}

export async function approveLeaveRecall(id: number, approverId: string): Promise<void> {
  const { data: recall } = await supabase.from('hr_leave_recall').select('*, leave_request:hr_leave_request!leave_request_id(*)').eq('id', id).single();
  if (!recall) throw new Error('Recall not found');
  const { error } = await supabase.from('hr_leave_recall').update({ status: 'approved', approved_by: approverId }).eq('id', id);
  if (error) throw error;

  const req = recall.leave_request;
  if (req) {
    await supabase.from('hr_leave_balance')
      .select('used')
      .eq('employee_id', req.employee_id)
      .eq('leave_type_id', req.leave_type_id)
      .eq('year', new Date(req.start_date).getFullYear())
      .then(async ({ data: b }) => {
        if (b?.[0]) {
          await supabase.from('hr_leave_balance').update({
            used: Math.max(0, Number(b[0].used) - Number(recall.days_recalled)),
          }).eq('employee_id', req.employee_id).eq('leave_type_id', req.leave_type_id).eq('year', new Date(req.start_date).getFullYear());
        }
      });
    await supabase.from('hr_leave_request').update({ status: 'recalled' }).eq('id', req.id);
  }
  logHrAction({ entity_type: 'leave_recall', entity_id: String(id), action: 'approved', description: `Leave recall approved: ${recall.days_recalled} day(s) credited back` });
}

export async function getLeaveRequests(params?: { employeeId?: string; status?: string; year?: number }): Promise<LeaveRequest[]> {
  let q = supabase
    .from('hr_leave_request')
    .select(`*, employee:erp_user!employee_id(full_name), leave_type:hr_leave_type!leave_type_id(name), approver:erp_user!approver_id(full_name)`)
    .order('created_at', { ascending: false });
  if (params?.employeeId) q = q.eq('employee_id', params.employeeId);
  if (params?.status) q = q.eq('status', params.status);
  if (params?.year) {
    q = q.gte('start_date', `${params.year}-01-01`).lte('start_date', `${params.year}-12-31`);
  }
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    ...r,
    employee_name: r.employee?.full_name ?? null,
    leave_type_name: r.leave_type?.name ?? null,
    approver_name: r.approver?.full_name ?? null,
  }));
}

// ── Payroll ───────────────────────────────────────────────────────────────────

export async function getSalaryHistory(employeeId: string): Promise<SalaryRecord[]> {
  const { data, error } = await supabase
    .from('hr_salary_record')
    .select('*')
    .eq('employee_id', employeeId)
    .order('effective_date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getCurrentSalary(employeeId: string): Promise<SalaryRecord | null> {
  const { data, error } = await supabase
    .from('hr_salary_record')
    .select('*')
    .eq('employee_id', employeeId)
    .lte('effective_date', new Date().toISOString().slice(0, 10))
    .order('effective_date', { ascending: false })
    .limit(1)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data ?? null;
}

export async function setSalary(employeeId: string, data: Partial<SalaryRecord>): Promise<void> {
  const { error } = await supabase.from('hr_salary_record').insert({ employee_id: employeeId, ...data });
  if (error) throw error;
  logHrAction({ entity_type: 'salary_record', entity_id: employeeId, action: 'updated', after: { employee_id: employeeId, ...data } as any, description: `Salary updated to ${data.salary} ${data.currency ?? 'CNY'} (${data.reason ?? ''})` });
}

export async function getOvertimeRequests(params?: { employeeId?: string; status?: string }): Promise<OvertimeRequest[]> {
  let q = supabase
    .from('hr_overtime_request')
    .select(`*, employee:erp_user!employee_id(full_name)`)
    .order('date', { ascending: false });
  if (params?.employeeId) q = q.eq('employee_id', params.employeeId);
  if (params?.status) q = q.eq('status', params.status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, employee_name: r.employee?.full_name ?? null }));
}

export async function submitOvertime(data: Partial<OvertimeRequest>): Promise<OvertimeRequest> {
  const { data: row, error } = await supabase.from('hr_overtime_request').insert({ ...data, status: 'pending' }).select().single();
  if (error) throw error;
  logHrAction({ entity_type: 'overtime', entity_id: String(row.id), action: 'submitted', after: row, description: `Overtime ${row.hours}h on ${row.date} submitted` });
  return row;
}

export async function approveOvertime(id: number, approverId: string): Promise<void> {
  const { data: before } = await supabase.from('hr_overtime_request').select().eq('id', id).single();
  const { error } = await supabase.from('hr_overtime_request').update({ status: 'approved', approver_id: approverId, approved_at: new Date().toISOString() }).eq('id', id);
  if (error) throw error;
  logHrAction({ entity_type: 'overtime', entity_id: String(id), action: 'approved', before, description: 'Overtime approved' });
}

export async function rejectOvertime(id: number, approverId: string): Promise<void> {
  const { data: before } = await supabase.from('hr_overtime_request').select().eq('id', id).single();
  const { error } = await supabase.from('hr_overtime_request').update({ status: 'rejected', approver_id: approverId }).eq('id', id);
  if (error) throw error;
  logHrAction({ entity_type: 'overtime', entity_id: String(id), action: 'rejected', before, description: 'Overtime rejected' });
}

export async function getBonusTemplates(): Promise<BonusTemplate[]> {
  const { data, error } = await supabase
    .from('hr_bonus_template')
    .select(`*, department:hr_department!department_id(name)`)
    .order('name');
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, department_name: r.department?.name ?? null }));
}

export async function createBonusTemplate(data: Partial<BonusTemplate>): Promise<BonusTemplate> {
  const { data: row, error } = await supabase.from('hr_bonus_template').insert(data).select().single();
  if (error) throw error;
  logHrAction({ entity_type: 'bonus_template', entity_id: String(row.id), action: 'created', after: row, description: `Bonus template "${row.name}" created` });
  return row;
}

export async function updateBonusTemplate(id: number, patch: Partial<BonusTemplate>): Promise<void> {
  const { error } = await supabase.from('hr_bonus_template').update(patch).eq('id', id);
  if (error) throw error;
}

export async function getBonusRuns(): Promise<BonusRun[]> {
  const { data, error } = await supabase
    .from('hr_bonus_run')
    .select(`*, template:hr_bonus_template!template_id(name)`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, template_name: r.template?.name ?? null }));
}

export async function createBonusRun(data: Partial<BonusRun>): Promise<BonusRun> {
  const { data: row, error } = await supabase.from('hr_bonus_run').insert(data).select().single();
  if (error) throw error;
  return row;
}

export async function calculateBonusRun(runId: number): Promise<void> {
  await supabase.from('hr_bonus_run').update({ status: 'calculating' }).eq('id', runId);

  const { data: run } = await supabase.from('hr_bonus_run').select('*, template:hr_bonus_template!template_id(*)').eq('id', runId).single();
  if (!run) throw new Error('Bonus run not found');
  const template = run.template;

  // Get eligible employees
  let empQ = supabase.from('erp_user').select('*').eq('is_active', true);
  if (template.department_id) {
    const { data: dept } = await supabase.from('hr_department').select('name').eq('id', template.department_id).single();
    if (dept) empQ = empQ.eq('department', dept.name);
  }
  const { data: employees } = await empQ;
  if (!employees) { await supabase.from('hr_bonus_run').update({ status: 'review' }).eq('id', runId); return; }

  // Delete previous lines
  await supabase.from('hr_bonus_line').delete().eq('bonus_run_id', runId);

  const lines = [];
  for (const emp of employees) {
    if (template.min_tenure_months > 0 && emp.start_date) {
      const start = new Date(emp.start_date);
      const now = new Date(run.period_end);
      const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
      if (months < template.min_tenure_months) continue;
    }

    const salaryRec = await getCurrentSalary(emp.id);
    const monthlySalary = salaryRec ? (template.base === 'annual_salary' ? salaryRec.salary / 12 : salaryRec.salary) : 0;
    const baseSalary = template.base === 'fixed_amount' ? (template.fixed_amount ?? 0) : monthlySalary;

    let calculated = 0;
    const detail: Record<string, unknown> = { employee: emp.full_name, base_salary: baseSalary, formula_type: template.formula_type };

    if (template.formula_type === 'fixed') {
      calculated = template.fixed_amount ?? 0;
      detail.fixed_amount = template.fixed_amount;
    } else if (template.formula_type === 'multiplier') {
      calculated = baseSalary * (template.multiplier ?? 1);
      detail.multiplier = template.multiplier;
      detail.result = calculated;
    } else if (template.formula_type === 'tiered' && template.tiers) {
      const tiers = template.tiers as { min: number; max: number | null; rate: number }[];
      const tier = tiers.find(t => baseSalary >= t.min && (t.max === null || baseSalary < t.max));
      if (tier) { calculated = baseSalary * tier.rate; detail.tier = tier; detail.result = calculated; }
    } else if (template.formula_type === 'performance_based') {
      calculated = baseSalary * (template.multiplier ?? 1);
      detail.base_calc = calculated;
    }

    lines.push({
      bonus_run_id: runId,
      employee_id: emp.id,
      base_amount: baseSalary,
      calculated_amount: Math.round(calculated * 100) / 100,
      calculation_detail: detail,
    });
  }

  if (lines.length > 0) {
    await supabase.from('hr_bonus_line').insert(lines);
  }

  const total = lines.reduce((s, l) => s + l.calculated_amount, 0);
  await supabase.from('hr_bonus_run').update({ status: 'review', total_amount: total }).eq('id', runId);
  logHrAction({ entity_type: 'bonus_run', entity_id: String(runId), action: 'calculated', description: `Bonus run calculated: ${lines.length} employees, total ${total}` });
}

export async function getBonusLines(runId: number): Promise<BonusLine[]> {
  const { data, error } = await supabase
    .from('hr_bonus_line')
    .select(`*, employee:erp_user!employee_id(full_name, department)`)
    .eq('bonus_run_id', runId)
    .order('employee_id');
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, employee_name: r.employee?.full_name ?? null, department: r.employee?.department ?? null }));
}

export async function updateBonusLine(id: number, manualOverride: number | null): Promise<void> {
  const { error } = await supabase.from('hr_bonus_line').update({ manual_override: manualOverride }).eq('id', id);
  if (error) throw error;
}

export async function approveBonusRun(runId: number, approverId: string): Promise<void> {
  const { error } = await supabase.from('hr_bonus_run').update({ status: 'approved', approved_by: approverId }).eq('id', runId);
  if (error) throw error;
  logHrAction({ entity_type: 'bonus_run', entity_id: String(runId), action: 'approved', description: 'Bonus run approved' });
}

export async function getPayRuns(): Promise<PayRun[]> {
  const { data, error } = await supabase.from('hr_pay_run').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createPayRun(data: Partial<PayRun>): Promise<PayRun> {
  const { data: row, error } = await supabase.from('hr_pay_run').insert(data).select().single();
  if (error) throw error;
  logHrAction({ entity_type: 'pay_run', entity_id: String(row.id), action: 'created', after: row, description: `Pay run "${row.name}" created for ${row.period_start} to ${row.period_end}` });
  return row;
}

export async function calculatePayRun(runId: number): Promise<void> {
  await supabase.from('hr_pay_run').update({ status: 'processing' }).eq('id', runId);
  const { data: run } = await supabase.from('hr_pay_run').select().eq('id', runId).single();
  if (!run) throw new Error('Pay run not found');

  const { data: employees } = await supabase.from('erp_user').select('*').eq('is_active', true);
  if (!employees) { await supabase.from('hr_pay_run').update({ status: 'review' }).eq('id', runId); return; }

  await supabase.from('hr_pay_slip').delete().eq('pay_run_id', runId);

  const slips = [];
  let totalGross = 0, totalDeductions = 0, totalNet = 0;

  for (const emp of employees) {
    const salaryRec = await getCurrentSalary(emp.id);
    const baseSalary = salaryRec?.salary ?? 0;

    // Overtime for period
    const { data: ot } = await supabase.from('hr_overtime_request')
      .select('hours, type')
      .eq('employee_id', emp.id)
      .eq('status', 'approved')
      .gte('date', run.period_start)
      .lte('date', run.period_end);
    const hourlyRate = baseSalary / (21.75 * 8);
    const otAmount = (ot ?? []).reduce((s: number, o: any) => {
      const rate = o.type === 'weekday' ? 1.5 : o.type === 'weekend' ? 2 : 3;
      return s + o.hours * hourlyRate * rate;
    }, 0);

    // Simplified tax (progressive brackets)
    const gross = baseSalary + otAmount;
    const taxable = Math.max(0, gross - 5000); // 5000 threshold
    let tax = 0;
    if (taxable <= 3000) tax = taxable * 0.03;
    else if (taxable <= 12000) tax = 90 + (taxable - 3000) * 0.10;
    else if (taxable <= 25000) tax = 990 + (taxable - 12000) * 0.20;
    else tax = 3590 + (taxable - 25000) * 0.25;

    const si = gross * 0.105; // social insurance 10.5%
    const hf = gross * 0.12;  // housing fund 12%
    const totalDed = Math.round((tax + si + hf) * 100) / 100;
    const net = Math.round((gross - totalDed) * 100) / 100;

    slips.push({
      pay_run_id: runId,
      employee_id: emp.id,
      base_salary: Math.round(baseSalary * 100) / 100,
      overtime_amount: Math.round(otAmount * 100) / 100,
      bonus_amount: 0,
      gross_pay: Math.round(gross * 100) / 100,
      income_tax: Math.round(tax * 100) / 100,
      social_insurance: Math.round(si * 100) / 100,
      housing_fund: Math.round(hf * 100) / 100,
      total_deductions: totalDed,
      net_pay: net,
    });
    totalGross += gross;
    totalDeductions += totalDed;
    totalNet += net;
  }

  if (slips.length > 0) await supabase.from('hr_pay_slip').insert(slips);
  await supabase.from('hr_pay_run').update({ status: 'review', total_gross: Math.round(totalGross * 100) / 100, total_deductions: Math.round(totalDeductions * 100) / 100, total_net: Math.round(totalNet * 100) / 100 }).eq('id', runId);
}

export async function approvePayRun(runId: number, approverId: string): Promise<void> {
  const { error } = await supabase.from('hr_pay_run').update({ status: 'approved', approved_by: approverId }).eq('id', runId);
  if (error) throw error;
  logHrAction({ entity_type: 'pay_run', entity_id: String(runId), action: 'approved', description: 'Pay run approved' });
}

export async function getPaySlips(payRunId: number): Promise<PaySlip[]> {
  const { data, error } = await supabase
    .from('hr_pay_slip')
    .select(`*, employee:erp_user!employee_id(full_name, department)`)
    .eq('pay_run_id', payRunId)
    .order('employee_id');
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, employee_name: r.employee?.full_name ?? null, department: r.employee?.department ?? null }));
}

export async function getMyPaySlips(employeeId: string): Promise<PaySlip[]> {
  const { data, error } = await supabase
    .from('hr_pay_slip')
    .select(`*, pay_run:hr_pay_run!pay_run_id(name, pay_date, status)`)
    .eq('employee_id', employeeId)
    .order('pay_run_id', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// ── Benefits ──────────────────────────────────────────────────────────────────

export async function getBenefitPlans(): Promise<BenefitPlan[]> {
  const { data, error } = await supabase.from('hr_benefit_plan').select('*').eq('is_active', true).order('type');
  if (error) throw error;
  return data ?? [];
}

export async function createBenefitPlan(data: Partial<BenefitPlan>): Promise<BenefitPlan> {
  const { data: row, error } = await supabase.from('hr_benefit_plan').insert(data).select().single();
  if (error) throw error;
  return row;
}

export async function getEmployeeBenefits(employeeId: string): Promise<EmployeeBenefit[]> {
  const { data, error } = await supabase
    .from('hr_employee_benefit')
    .select(`*, plan:hr_benefit_plan!benefit_plan_id(name, type)`)
    .eq('employee_id', employeeId)
    .is('ended_at', null);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, benefit_plan_name: r.plan?.name ?? null, benefit_plan_type: r.plan?.type ?? null }));
}

export async function enrollBenefit(employeeId: string, planId: number): Promise<void> {
  const { data: plan } = await supabase.from('hr_benefit_plan').select().eq('id', planId).single();
  const { data: emp } = await supabase.from('hr_salary_record').select('salary').eq('employee_id', employeeId).order('effective_date', { ascending: false }).limit(1).single();
  const salary = emp?.salary ?? 0;
  const empContrib = plan?.employee_contribution_rate ? salary * plan.employee_contribution_rate : (plan?.employee_fixed ?? 0);
  const emplContrib = plan?.employer_contribution_rate ? salary * plan.employer_contribution_rate : (plan?.employer_fixed ?? 0);

  const { error } = await supabase.from('hr_employee_benefit').upsert({
    employee_id: employeeId, benefit_plan_id: planId,
    enrolled_at: new Date().toISOString().slice(0, 10),
    employee_contribution: empContrib,
    employer_contribution: emplContrib,
  }, { onConflict: 'employee_id,benefit_plan_id' });
  if (error) throw error;
}

// ── Performance ───────────────────────────────────────────────────────────────

export async function getReviewCycles(): Promise<ReviewCycle[]> {
  const { data, error } = await supabase.from('hr_review_cycle').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createReviewCycle(data: Partial<ReviewCycle>): Promise<ReviewCycle> {
  const { data: row, error } = await supabase.from('hr_review_cycle').insert(data).select().single();
  if (error) throw error;
  return row;
}

export async function updateReviewCycle(id: number, patch: Partial<ReviewCycle>): Promise<void> {
  const { error } = await supabase.from('hr_review_cycle').update(patch).eq('id', id);
  if (error) throw error;
}

export async function getReviews(cycleId: number): Promise<Review[]> {
  const { data, error } = await supabase
    .from('hr_review')
    .select(`*, employee:erp_user!employee_id(full_name), reviewer:erp_user!reviewer_id(full_name)`)
    .eq('cycle_id', cycleId);
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, employee_name: r.employee?.full_name ?? null, reviewer_name: r.reviewer?.full_name ?? null }));
}

export async function submitSelfReview(reviewId: number, data: { self_rating: number; self_summary: string; self_goals_met: string }): Promise<void> {
  const { error } = await supabase.from('hr_review').update({ ...data, status: 'self_complete' }).eq('id', reviewId);
  if (error) throw error;
  logHrAction({ entity_type: 'review', entity_id: String(reviewId), action: 'self_reviewed', description: `Self review submitted (rating: ${data.self_rating}/5)` });
}

export async function submitManagerReview(reviewId: number, data: { manager_rating: number; manager_summary: string; final_rating: number; strengths: string; improvements: string }): Promise<void> {
  const { error } = await supabase.from('hr_review').update({ ...data, status: 'manager_complete', completed_at: new Date().toISOString() }).eq('id', reviewId);
  if (error) throw error;
  logHrAction({ entity_type: 'review', entity_id: String(reviewId), action: 'manager_reviewed', description: `Manager review submitted (final: ${data.final_rating}/5)` });
}

export async function getGoals(employeeId: string, cycleId?: number): Promise<Goal[]> {
  let q = supabase.from('hr_goal').select('*').eq('employee_id', employeeId).order('created_at', { ascending: false });
  if (cycleId) q = q.eq('review_cycle_id', cycleId);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function createGoal(data: Partial<Goal>): Promise<Goal> {
  const { data: row, error } = await supabase.from('hr_goal').insert(data).select().single();
  if (error) throw error;
  return row;
}

export async function updateGoalProgress(goalId: number, progress: number, status?: Goal['status']): Promise<void> {
  const patch: any = { progress };
  if (status) patch.status = status;
  const { error } = await supabase.from('hr_goal').update(patch).eq('id', goalId);
  if (error) throw error;
}

// ── Training ──────────────────────────────────────────────────────────────────

export async function getTrainingCourses(): Promise<TrainingCourse[]> {
  const { data, error } = await supabase.from('hr_training_course').select('*').eq('is_active', true).order('title');
  if (error) throw error;
  return data ?? [];
}

export async function createTrainingCourse(data: Partial<TrainingCourse>): Promise<TrainingCourse> {
  const { data: row, error } = await supabase.from('hr_training_course').insert(data).select().single();
  if (error) throw error;
  return row;
}

export async function getEnrollments(params?: { employeeId?: string; courseId?: number }): Promise<TrainingEnrollment[]> {
  let q = supabase
    .from('hr_training_enrollment')
    .select(`*, course:hr_training_course!course_id(title), employee:erp_user!employee_id(full_name)`)
    .order('enrolled_at', { ascending: false });
  if (params?.employeeId) q = q.eq('employee_id', params.employeeId);
  if (params?.courseId) q = q.eq('course_id', params.courseId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r: any) => ({ ...r, course_title: r.course?.title ?? null, employee_name: r.employee?.full_name ?? null }));
}

export async function enrollInCourse(employeeId: string, courseId: number): Promise<void> {
  const { error } = await supabase.from('hr_training_enrollment').insert({ employee_id: employeeId, course_id: courseId, status: 'enrolled' });
  if (error) throw error;
}

export async function updateEnrollment(id: number, patch: Partial<TrainingEnrollment>): Promise<void> {
  const { error } = await supabase.from('hr_training_enrollment').update(patch).eq('id', id);
  if (error) throw error;
}

// ── HR Audit Log ──────────────────────────────────────────────────────────────

export async function getHrAuditLog(params?: {
  entity_type?: string;
  search?: string;
  limit?: number;
  offset?: number;
}): Promise<{ logs: HrAuditLog[]; total: number }> {
  const PAGE = params?.limit ?? 50;
  const OFFSET = params?.offset ?? 0;

  let q = supabase.from('hr_audit_log').select('*', { count: 'exact' }).order('changed_at', { ascending: false }).range(OFFSET, OFFSET + PAGE - 1);
  if (params?.entity_type) q = q.eq('entity_type', params.entity_type);
  if (params?.search) q = q.or(`description.ilike.%${params.search}%,entry_number.ilike.%${params.search}%`);

  const { data, error, count } = await q;
  if (error) throw error;
  return { logs: data ?? [], total: count ?? 0 };
}

// ── Calendar Events ────────────────────────────────────────────────────────────

export async function getCalendarEvents(ownerId: string, startDate: string, endDate: string): Promise<CalendarEvent[]> {
  const { data, error } = await supabase
    .from('hr_calendar_event')
    .select(`*, interview:hr_interview!interview_id(interview_type, candidate:hr_candidate!candidate_id(full_name))`)
    .eq('owner_id', ownerId)
    .gte('start_time', startDate)
    .lte('end_time', endDate)
    .order('start_time', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((e: any) => ({
    ...e,
    interview_type: e.interview?.interview_type ?? null,
    candidate_name: e.interview?.candidate?.full_name ?? null,
  }));
}

export async function getTeamAvailability(
  userIds: string[],
  startTime: string,
  endTime: string
): Promise<Record<string, CalendarEvent[]>> {
  if (userIds.length === 0) return {};
  const { data, error } = await supabase
    .from('hr_calendar_event')
    .select('*')
    .in('owner_id', userIds)
    .in('status', ['tentative', 'confirmed'])
    .lt('start_time', endTime)
    .gt('end_time', startTime);
  if (error) throw error;
  const result: Record<string, CalendarEvent[]> = {};
  for (const uid of userIds) result[uid] = [];
  for (const ev of (data ?? [])) {
    if (result[ev.owner_id]) result[ev.owner_id].push(ev);
  }
  return result;
}

export async function respondToCalendarEvent(
  eventId: number,
  status: 'confirmed' | 'declined',
  notes?: string
): Promise<void> {
  const patch: Record<string, unknown> = { status, responded_at: new Date().toISOString() };
  if (notes !== undefined) patch.notes = notes;
  const { error } = await supabase.from('hr_calendar_event').update(patch).eq('id', eventId);
  if (error) throw error;
}

export async function getMyPendingInterviewEvents(ownerId: string): Promise<CalendarEvent[]> {
  const { data, error } = await supabase
    .from('hr_calendar_event')
    .select(`*, interview:hr_interview!interview_id(interview_type, candidate:hr_candidate!candidate_id(full_name))`)
    .eq('owner_id', ownerId)
    .eq('status', 'tentative')
    .gte('end_time', new Date().toISOString())
    .order('start_time', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((e: any) => ({
    ...e,
    interview_type: e.interview?.interview_type ?? null,
    candidate_name: e.interview?.candidate?.full_name ?? null,
  }));
}
