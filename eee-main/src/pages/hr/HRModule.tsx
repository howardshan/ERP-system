import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import {
  Users,
  Network,
  Building2,
  Briefcase,
  UserCheck,
  ClipboardList,
  CalendarDays,
  DollarSign,
  TrendingUp,
  BookOpen,
  ScrollText,
  LayoutGrid,
  HelpCircle,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useSidebar, sidebarOffCanvas, SidebarScrim, SidebarToggle } from '../../components/layout/mobileNav';
import { usePermissions } from '../../contexts/PermissionContext';
import EmployeeDirectory from './employees/EmployeeDirectory';
import EmployeeProfile from './employees/EmployeeProfile';
import Departments from './employees/Departments';
import OrgChart from './employees/OrgChart';
import JobRequisitions from './recruitment/JobRequisitions';
import CandidatePipeline from './recruitment/CandidatePipeline';
import Interviews from './recruitment/Interviews';
import InterviewCalendar from './recruitment/InterviewCalendar';
import OnboardingDashboard from './onboarding/OnboardingDashboard';
import LeaveRequests from './leave/LeaveRequests';
import MyLeave from './leave/MyLeave';
import SalaryRecords from './payroll/SalaryRecords';
import OvertimePage from './payroll/OvertimePage';
import BonusRules from './payroll/BonusRules';
import PayRuns from './payroll/PayRuns';
import BenefitsPlans from './benefits/BenefitsPlans';
import ReviewCycles from './performance/ReviewCycles';
import Goals from './performance/Goals';
import TrainingCatalog from './training/TrainingCatalog';
import HRAuditLog from './audit/HRAuditLog';

interface Props {
  onHome: () => void;
}

function NavItem({ icon: Icon, label, isActive, onClick }: { icon: React.ElementType; label: string; isActive: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors relative',
        isActive ? 'text-white bg-white/10 font-semibold' : 'text-slate-400 hover:text-white hover:bg-white/5',
      )}
    >
      {isActive && <div className="absolute left-0 top-0 bottom-0 w-1 bg-teal-400" />}
      <Icon size={18} />
      <span className="flex-1 text-left">{label}</span>
    </button>
  );
}

function NavSection({ title }: { title: string }) {
  return (
    <div className="px-4 pt-5 pb-1">
      <span className="text-[9px] font-bold text-slate-600 uppercase tracking-widest">{title}</span>
    </div>
  );
}

export default function HRModule({ onHome }: Props) {
  const { t } = useTranslation('hr');
  const { can } = usePermissions();
  const [screen, setScreen] = useState('employees');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [currentErpId, setCurrentErpId] = useState('');

  const canViewEmployees  = can('hr', 'employees', 'view');
  const canViewDepts      = can('hr', 'departments', 'view');
  const canViewRecruit    = can('hr', 'recruitment', 'view');
  const canViewOnboarding = can('hr', 'onboarding', 'view');
  const canViewLeave      = can('hr', 'leave', 'view');
  const canViewOwnLeave   = can('hr', 'leave', 'view_own');
  const canViewPayroll    = can('hr', 'payroll', 'view');
  const canViewBenefits   = can('hr', 'benefits', 'view');
  const canViewPerf       = can('hr', 'performance', 'view');
  const canViewTraining   = can('hr', 'training', 'view');
  const canViewAudit      = can('hr', 'audit_log', 'view');

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: eu } = await supabase.from('erp_user').select('id').eq('auth_user_id', user.id).single();
        if (eu) setCurrentErpId(eu.id);
      }
    })();
  }, []);

  const isActive = (id: string) => screen === id || screen.startsWith(id + ':');

  const { open, openSidebar, closeSidebar } = useSidebar();
  function navigate(s: string) { setScreen(s); closeSidebar(); }

  function renderContent() {
    if (screen === 'employees') {
      return <EmployeeDirectory onSelectEmployee={(id) => { setSelectedEmployeeId(id); setScreen('employee-profile'); }} />;
    }
    if (screen === 'employee-profile' && selectedEmployeeId) {
      return <EmployeeProfile employeeId={selectedEmployeeId} onBack={() => setScreen('employees')} />;
    }
    if (screen === 'org-chart')      return <OrgChart onSelectEmployee={(id) => { setSelectedEmployeeId(id); setScreen('employee-profile'); }} />;
    if (screen === 'departments')    return <Departments />;
    if (screen === 'requisitions')   return <JobRequisitions onSelectRequisition={(id) => setScreen(`candidates:${id}`)} />;
    if (screen.startsWith('candidates:')) {
      const reqId = parseInt(screen.split(':')[1], 10);
      return <CandidatePipeline requisitionId={reqId} onBack={() => setScreen('requisitions')} />;
    }
    if (screen === 'interviews')          return <Interviews />;
    if (screen === 'interview-calendar')  return <InterviewCalendar currentErpId={currentErpId} onRespond={async () => {}} />;
    if (screen === 'onboarding')     return <OnboardingDashboard />;
    if (screen === 'leave-requests') return <LeaveRequests />;
    if (screen === 'my-leave')       return <MyLeave />;
    if (screen === 'salary')         return <SalaryRecords />;
    if (screen === 'overtime')       return <OvertimePage />;
    if (screen === 'bonus')          return <BonusRules />;
    if (screen === 'pay-runs')       return <PayRuns />;
    if (screen === 'benefits')       return <BenefitsPlans />;
    if (screen === 'reviews')        return <ReviewCycles />;
    if (screen === 'goals')          return <Goals />;
    if (screen === 'training')       return <TrainingCatalog />;
    if (screen === 'hr-audit')       return <HRAuditLog />;
    return <EmployeeDirectory onSelectEmployee={(id) => { setSelectedEmployeeId(id); setScreen('employee-profile'); }} />;
  }

  return (
    <div className="min-h-screen bg-[#faf8f5] flex">
      {/* Sidebar */}
      <SidebarScrim open={open} onClose={closeSidebar} />
      <aside className={cn('w-64 bg-[#0a0f1d] border-r border-white/10 flex flex-col h-screen fixed left-0 top-0', sidebarOffCanvas(open))}>
        <div className="p-5 mb-1">
          <button
            onClick={onHome}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-white/5 transition-colors group text-left"
          >
            <div className="w-7 h-7 rounded-lg bg-teal-600 flex items-center justify-center shrink-0">
              <LayoutGrid size={14} className="text-white" />
            </div>
            <div>
              <p className="text-white font-bold text-sm leading-none">{t('hRModule.humanResources')}</p>
              <p className="text-[9px] text-slate-500 uppercase tracking-widest font-bold mt-0.5 group-hover:text-slate-400 transition-colors">
                {t('hRModule.allModules')}
              </p>
            </div>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto space-y-0.5 pb-4">
          {(canViewEmployees || canViewDepts) && <NavSection title={t('hRModule.sectionPeople')} />}
          {canViewEmployees && (
            <>
              <NavItem icon={Users}    label={t('hRModule.employeeDirectory')} isActive={isActive('employees') || isActive('employee-profile')} onClick={() => navigate('employees')} />
              <NavItem icon={Network}  label={t('hRModule.orgChart')}          isActive={isActive('org-chart')}    onClick={() => navigate('org-chart')} />
            </>
          )}
          {canViewDepts && (
            <NavItem icon={Building2} label={t('hRModule.departments')} isActive={isActive('departments')} onClick={() => navigate('departments')} />
          )}

          {canViewRecruit && <NavSection title={t('hRModule.sectionRecruitment')} />}
          {canViewRecruit && (
            <>
              <NavItem icon={Briefcase}   label={t('hRModule.jobRequisitions')} isActive={isActive('requisitions') || isActive('candidates')} onClick={() => navigate('requisitions')} />
              <NavItem icon={UserCheck}   label={t('hRModule.interviews')}          isActive={isActive('interviews')}          onClick={() => navigate('interviews')} />
              <NavItem icon={CalendarDays} label={t('hRModule.interviewCalendar')} isActive={isActive('interview-calendar')} onClick={() => navigate('interview-calendar')} />
            </>
          )}

          {canViewOnboarding && <NavSection title={t('hRModule.sectionOnboarding')} />}
          {canViewOnboarding && (
            <NavItem icon={ClipboardList} label={t('hRModule.onboardingTasks')} isActive={isActive('onboarding')} onClick={() => navigate('onboarding')} />
          )}

          {(canViewLeave || canViewOwnLeave) && <NavSection title={t('hRModule.sectionTimeLeave')} />}
          {canViewLeave && (
            <NavItem icon={CalendarDays} label={t('hRModule.leaveRequests')} isActive={isActive('leave-requests')} onClick={() => navigate('leave-requests')} />
          )}
          {(canViewLeave || canViewOwnLeave) && (
            <NavItem icon={CalendarDays} label={t('hRModule.myLeave')}       isActive={isActive('my-leave')}       onClick={() => navigate('my-leave')} />
          )}

          {canViewPayroll && <NavSection title={t('hRModule.sectionPayroll')} />}
          {canViewPayroll && (
            <>
              <NavItem icon={DollarSign}  label={t('hRModule.payRuns')}       isActive={isActive('pay-runs')} onClick={() => navigate('pay-runs')} />
              <NavItem icon={DollarSign}  label={t('hRModule.salaryRecords')} isActive={isActive('salary')}   onClick={() => navigate('salary')} />
              <NavItem icon={DollarSign}  label={t('hRModule.overtime')}      isActive={isActive('overtime')} onClick={() => navigate('overtime')} />
              <NavItem icon={TrendingUp}  label={t('hRModule.bonusRules')}    isActive={isActive('bonus')}    onClick={() => navigate('bonus')} />
            </>
          )}

          {canViewBenefits && <NavSection title={t('hRModule.sectionBenefits')} />}
          {canViewBenefits && (
            <NavItem icon={DollarSign} label={t('hRModule.benefitsPlans')} isActive={isActive('benefits')} onClick={() => navigate('benefits')} />
          )}

          {canViewPerf && <NavSection title={t('hRModule.sectionPerformance')} />}
          {canViewPerf && (
            <>
              <NavItem icon={TrendingUp} label={t('hRModule.reviewCycles')} isActive={isActive('reviews')} onClick={() => navigate('reviews')} />
              <NavItem icon={TrendingUp} label={t('hRModule.goalsOkrs')}  isActive={isActive('goals')}   onClick={() => navigate('goals')} />
            </>
          )}

          {canViewTraining && <NavSection title={t('hRModule.sectionTraining')} />}
          {canViewTraining && (
            <NavItem icon={BookOpen} label={t('hRModule.trainingCatalog')} isActive={isActive('training')} onClick={() => navigate('training')} />
          )}

          {canViewAudit && <NavSection title={t('hRModule.sectionAdministration')} />}
          {canViewAudit && (
            <NavItem icon={ScrollText} label={t('hRModule.hrAuditLog')} isActive={isActive('hr-audit')} onClick={() => navigate('hr-audit')} />
          )}
        </nav>

        <div className="p-4 border-t border-white/5">
          <button className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors">
            <HelpCircle size={18} />
            <span>{t('hRModule.support')}</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:ml-64 flex-1 min-w-0 min-h-screen">
        {/* Mobile-only bar to open the nav (HR has no desktop top bar). */}
        <div className="lg:hidden sticky top-0 z-20 bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-2">
          <SidebarToggle onClick={openSidebar} className="-ml-1" />
          <span className="text-sm font-bold text-slate-700">{t('hRModule.title', 'Human Resources')}</span>
        </div>
        {renderContent()}
      </div>
    </div>
  );
}
