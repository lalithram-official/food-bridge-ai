import { useCallback, useEffect, useState } from 'react';
import {
  Award,
  BarChart3,
  Bell,
  Bot,
  FileCheck2,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Settings,
  ShieldCheck,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import type { Donation, Role } from '../shared/types';
import { apiFetch, setStoredToken, type WorkspaceState } from '../utils/api';
import type { Language } from '../i18n/translations';
import { tr } from '../i18n/translations';
import { AdminDashboard } from './AdminDashboard';
import { AiAssistantDrawer } from './AiAssistantDrawer';
import { DonationDetailModal } from './DonationDetailModal';
import { DonorDashboard } from './DonorDashboard';
import { ImpactAnalyticsPage } from './ImpactAnalyticsPage';
import { JudgeDemoPanel } from './JudgeDemoPanel';
import { NgoDashboard } from './NgoDashboard';
import { VerifyCertificatePage } from './VerifyCertificatePage';
import { VolunteerDashboard } from './VolunteerDashboard';
import { WhyFoodBridgePage } from './WhyFoodBridgePage';

interface WorkspaceShellProps {
  onExitToLanding: () => void;
  onOpenVerify: (certId?: string) => void;
}

export function WorkspaceShell({ onExitToLanding, onOpenVerify }: WorkspaceShellProps) {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [lang, setLang] = useState<Language>('en');
  const [lowDataMode, setLowDataMode] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedDonationId, setSelectedDonationId] = useState<string | null>(null);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showOutbox, setShowOutbox] = useState(false);
  const [showAiDrawer, setShowAiDrawer] = useState(false);
  const [verifyCertId, setVerifyCertId] = useState('');
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [insights, setInsights] = useState<{ source: string; insights: string[] } | null>(null);

  const showToast = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const refreshState = useCallback(async () => {
    try {
      const data = await apiFetch<WorkspaceState>('/api/workspace/state');
      setState(data);
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  }, [showToast]);

  useEffect(() => {
    refreshState();
  }, [refreshState]);

  useEffect(() => {
    const intervalMs = state?.settings.fastForwardTimers ? 5000 : 12000;
    const id = setInterval(() => {
      refreshState();
    }, intervalMs);
    return () => clearInterval(id);
  }, [refreshState, state?.settings.fastForwardTimers]);

  useEffect(() => {
    if (!state?.user.role) return;
    apiFetch<{ source: string; insights: string[] }>('/api/ai/insights', { method: 'POST' })
      .then(setInsights)
      .catch(() => setInsights(null));
  }, [state?.user.role, state?.donations.length]);

  const handleDemoRoleSwitch = async (role: Role, email?: string) => {
    try {
      const res = await apiFetch<{ token: string }>('/api/auth/demo-switch', {
        method: 'POST',
        body: JSON.stringify({ role, email }),
      });
      setStoredToken(res.token);
      const nextState = await apiFetch<WorkspaceState>('/api/workspace/state');
      setSelectedDonationId(null);
      setActiveTab('overview');
      setState(nextState);
      showToast(`Switched to ${role.toUpperCase()} demo workspace`);
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  };

  const handleToggleFastForward = async () => {
    if (!state) return;
    try {
      await apiFetch('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ fastForwardTimers: !state.settings.fastForwardTimers }),
      });
      await refreshState();
      showToast(
        !state.settings.fastForwardTimers
          ? 'Fast-Forward Timers ON (30s offer escalation)'
          : 'Fast-Forward Timers OFF (10m default)'
      );
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  };

  if (!state) {
    return (
      <div className="min-h-screen bg-[#F8FAF9] flex items-center justify-center p-6 text-sm text-slate-600">
        Loading FoodBridge AI workspace...
      </div>
    );
  }

  const role = state.user.role;
  const unreadNotifs = state.notifications.filter((n) => !n.read).length;
  const selectedDonation = selectedDonationId
    ? state.donations.find((d) => d.id === selectedDonationId) || null
    : null;

  const navItems: Array<{ id: string; label: string; icon: React.ReactNode }> = [
    { id: 'overview', label: tr(lang, 'overview'), icon: <LayoutDashboard className="w-4 h-4" /> },
    ...(role === 'donor'
      ? [{ id: 'csr', label: 'Impact & CSR Badges', icon: <Award className="w-4 h-4" /> }]
      : []),
    ...(role === 'admin'
      ? [
          { id: 'safety', label: tr(lang, 'safetyQueue'), icon: <ShieldCheck className="w-4 h-4" /> },
          { id: 'ngos', label: tr(lang, 'ngoQueue'), icon: <Users className="w-4 h-4" /> },
          { id: 'audit', label: tr(lang, 'auditLog'), icon: <FileCheck2 className="w-4 h-4" /> },
          { id: 'settings', label: tr(lang, 'settings'), icon: <Settings className="w-4 h-4" /> },
        ]
      : []),
    { id: 'impact', label: tr(lang, 'impactAnalytics'), icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'verify', label: tr(lang, 'verifyCertificate'), icon: <FileCheck2 className="w-4 h-4" /> },
    { id: 'why', label: tr(lang, 'whyFoodBridge'), icon: <HelpCircle className="w-4 h-4" /> },
  ];

  const handleOpenCertificateInTab = (certId: string) => {
    setSelectedDonationId(null);
    setVerifyCertId(certId);
    setActiveTab('verify');
  };

  return (
    <div className="min-h-screen bg-[#F8FAF9] flex">
      {/* Sidebar (Desktop + Mobile Drawer) */}
      <aside
        className={`${
          mobileMenuOpen ? 'fixed inset-y-0 left-0 z-40 flex overflow-y-auto' : 'hidden lg:flex lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto'
        } w-64 bg-white border-r border-slate-200 flex-col justify-between shrink-0`}
      >
        <div className="p-5 space-y-6">
          <div className="flex items-center justify-between">
            <span className="text-lg font-bold tracking-tight text-emerald-800 font-display">
              {tr(lang, 'appName')}
            </span>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden p-1 text-slate-500 cursor-pointer"
              aria-label="Close navigation menu"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-3 rounded-lg bg-[#F8FAF9] border border-slate-200 text-xs">
            <p className="font-bold text-slate-900 truncate">{state.user.name}</p>
            <p className="text-slate-600 capitalize">{role} Account</p>
          </div>

          <nav className="space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveTab(item.id);
                  setMobileMenuOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                  activeTab === item.id
                    ? 'bg-emerald-700 text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {item.icon}
                <span className="truncate">{item.label}</span>
              </button>
            ))}
          </nav>

          {/* Clearly Labeled Demo Tool: Role Switcher */}
          <div className="pt-4 border-t border-slate-200 space-y-2">
            <p className="text-[11px] font-semibold text-slate-500">
              {tr(lang, 'demoRoleSwitcher')}
            </p>
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              {[
                { label: 'Donor', role: 'donor' as Role, email: 'donor@foodbridge.demo' },
                { label: 'NGO #1', role: 'ngo' as Role, email: 'ngo@foodbridge.demo' },
                { label: 'NGO #2', role: 'ngo' as Role, email: 'hope@foodbridge.demo' },
                { label: 'NGO #3', role: 'ngo' as Role, email: 'annadanam@foodbridge.demo' },
                { label: 'Volunteer', role: 'volunteer' as Role, email: 'volunteer@foodbridge.demo' },
                { label: 'Admin', role: 'admin' as Role, email: 'admin@foodbridge.demo' },
              ].map((d) => (
                <button
                  key={d.label}
                  type="button"
                  onClick={() => handleDemoRoleSwitch(d.role, d.email)}
                  className={`px-2 py-1.5 rounded-md border font-semibold cursor-pointer whitespace-nowrap ${
                    state.user.email === d.email
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-200 space-y-2">
          <button
            type="button"
            onClick={() => onOpenVerify()}
            className="w-full py-2 px-3 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 cursor-pointer"
          >
            Public Certificate Lookup
          </button>
          <button
            type="button"
            onClick={onExitToLanding}
            className="w-full flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-100 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            {tr(lang, 'signOut')}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Workspace Header */}
        <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation menu"
              className="lg:hidden p-1.5 text-slate-700 border border-slate-200 rounded-lg cursor-pointer"
            >
              <Menu className="w-4 h-4" />
            </button>
            <span className="lg:hidden font-bold text-emerald-800 text-sm font-display whitespace-nowrap">
              FoodBridge AI
            </span>
            <div className="text-xs text-slate-500 flex items-center gap-1.5">
              <span className="font-semibold text-slate-900 capitalize">{role}</span>
              <span>/</span>
              <span>{navItems.find((i) => i.id === activeTab)?.label || activeTab}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Language Switcher */}
            <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden text-xs">
              {(['en', 'hi', 'ta'] as Language[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLang(l)}
                  className={`px-2.5 py-1.5 font-semibold uppercase cursor-pointer ${
                    lang === l ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>

            {/* Low-Data Mode Toggle */}
            <button
              type="button"
              onClick={() => setLowDataMode((m) => !m)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border cursor-pointer whitespace-nowrap ${
                lowDataMode
                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <WifiOff className="w-3.5 h-3.5" />
              {tr(lang, 'lowDataMode')}
            </button>

            {/* Outbox (Simulated SMS/WhatsApp) */}
            <button
              type="button"
              onClick={() => {
                setShowOutbox((s) => !s);
                setShowNotifs(false);
              }}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              <MessageSquare className="w-3.5 h-3.5 text-emerald-700" />
              Outbox ({state.outboxMessages.length})
            </button>

            {/* Notifications */}
            <button
              type="button"
              onClick={async () => {
                setShowNotifs((s) => !s);
                setShowOutbox(false);
                if (unreadNotifs > 0) {
                  await apiFetch('/api/notifications/mark-read', { method: 'POST' });
                  refreshState();
                }
              }}
              aria-label="Notifications"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap"
            >
              <Bell className="w-3.5 h-3.5" />
              <span className="font-mono">{unreadNotifs}</span>
            </button>

            {/* AI Assistant */}
            <button
              type="button"
              onClick={() => setShowAiDrawer(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 cursor-pointer whitespace-nowrap"
            >
              <Bot className="w-3.5 h-3.5" />
              {tr(lang, 'askAi')}
            </button>
          </div>
        </header>

        {/* Notifications Popover */}
        {showNotifs && (
          <div className="mx-4 sm:mx-6 mt-3 bg-white border border-slate-200 rounded-xl p-4 shadow-md">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-bold text-slate-900">{tr(lang, 'notifications')}</h3>
              <button
                type="button"
                onClick={() => setShowNotifs(false)}
                className="text-xs text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                Close
              </button>
            </div>
            <div className="space-y-2 max-h-56 overflow-y-auto text-xs">
              {state.notifications.slice(0, 12).map((n) => (
                <div key={n.id} className="p-2.5 rounded-lg bg-[#F8FAF9] border border-slate-200">
                  <p className="font-semibold text-slate-900">{n.title}</p>
                  <p className="text-slate-600">{n.message}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Simulated SMS/WhatsApp Outbox Popover */}
        {showOutbox && (
          <div className="mx-4 sm:mx-6 mt-3 bg-white border border-slate-200 rounded-xl p-4 shadow-md">
            <div className="flex items-center justify-between mb-2">
              <div>
                <h3 className="text-xs font-bold text-slate-900">{tr(lang, 'outbox')}</h3>
                <p className="text-[11px] text-slate-500">
                  Simulated SMS & WhatsApp messages queued for feature-phone / low-connectivity NGOs
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowOutbox(false)}
                className="text-xs text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                Close
              </button>
            </div>
            <div className="space-y-2 max-h-56 overflow-y-auto text-xs">
              {state.outboxMessages.slice(0, 12).map((m) => (
                <div key={m.id} className="p-2.5 rounded-lg bg-emerald-50/40 border border-emerald-200">
                  <p className="font-semibold text-slate-900">
                    [{m.channel} · Simulated] To: {m.recipientName} ({m.recipientPhone})
                  </p>
                  <p className="text-slate-700 mt-0.5">{m.body}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Toast Banner */}
        {toast && (
          <div
            role="status"
            className={`mx-4 sm:mx-6 mt-4 p-3 rounded-lg border text-xs font-semibold flex items-center justify-between ${
              toast.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-900'
                : 'bg-emerald-50 border-emerald-200 text-emerald-900'
            }`}
          >
            <span>{toast.msg}</span>
            <button type="button" onClick={() => setToast(null)} className="cursor-pointer">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Main Workspace Canvas */}
        <main className="flex-1 p-4 sm:p-6 max-w-7xl w-full mx-auto">
          {activeTab === 'impact' ? (
            <ImpactAnalyticsPage onToast={showToast} />
          ) : activeTab === 'verify' ? (
            <VerifyCertificatePage initialCertId={verifyCertId} />
          ) : activeTab === 'why' ? (
            <WhyFoodBridgePage />
          ) : role === 'donor' ? (
            <DonorDashboard
              state={state}
              activeTab={activeTab}
              lang={lang}
              lowDataMode={lowDataMode}
              insights={insights}
              onRefresh={refreshState}
              onSelectDonation={(d: Donation) => setSelectedDonationId(d.id)}
              onOpenCertificate={handleOpenCertificateInTab}
              onToast={showToast}
            />
          ) : role === 'ngo' ? (
            <NgoDashboard
              state={state}
              lang={lang}
              onRefresh={refreshState}
              onSelectDonation={(d: Donation) => setSelectedDonationId(d.id)}
              onToast={showToast}
            />
          ) : role === 'volunteer' ? (
            <VolunteerDashboard
              state={state}
              lang={lang}
              lowDataMode={lowDataMode}
              onRefresh={refreshState}
              onSelectDonation={(d: Donation) => setSelectedDonationId(d.id)}
              onToast={showToast}
            />
          ) : (
            <AdminDashboard
              state={state}
              activeTab={activeTab}
              lang={lang}
              onRefresh={refreshState}
              onSelectDonation={(d: Donation) => setSelectedDonationId(d.id)}
              onToast={showToast}
            />
          )}
        </main>
      </div>

      {/* Donation Detail Modal */}
      {selectedDonation && (
        <DonationDetailModal
          donation={selectedDonation}
          state={state}
          lowDataMode={lowDataMode}
          onClose={() => setSelectedDonationId(null)}
          onRefresh={refreshState}
          onOpenCertificate={handleOpenCertificateInTab}
          onToast={showToast}
        />
      )}

      {/* AI Assistant Drawer */}
      {showAiDrawer && (
        <AiAssistantDrawer role={role} onClose={() => setShowAiDrawer(false)} />
      )}

      {/* Floating Judge Guided Demo Panel */}
      <JudgeDemoPanel
        currentRole={role}
        fastForwardTimers={state.settings.fastForwardTimers}
        onToggleFastForward={handleToggleFastForward}
        onSwitchRole={handleDemoRoleSwitch}
        onNavigateTab={(tab) => setActiveTab(tab)}
      />
    </div>
  );
}
