import { useState } from 'react';
import { ChevronRight, Play, X } from 'lucide-react';
import type { Role } from '../shared/types';

interface JudgeDemoPanelProps {
  currentRole: Role;
  fastForwardTimers: boolean;
  onToggleFastForward: () => void;
  onSwitchRole: (role: Role, email?: string) => Promise<void>;
  onNavigateTab: (tab: string) => void;
}

const DEMO_STEPS: Array<{
  step: number;
  title: string;
  instruction: string;
  role: Role;
  email?: string;
  tab: string;
}> = [
  {
    step: 1,
    title: '1. Donor posts 25 Veg Cooked Meals',
    instruction: 'Switch to Donor and submit a 25-meal Veg Cooked Food donation with allergens & photo.',
    role: 'donor',
    email: 'donor@foodbridge.demo',
    tab: 'overview',
  },
  {
    step: 2,
    title: '2. AI Screening & Safe Until Starts',
    instruction: 'Inspect the Food Safety Passport countdown and Gemini screening (with fallback safety).',
    role: 'donor',
    email: 'donor@foodbridge.demo',
    tab: 'overview',
  },
  {
    step: 3,
    title: '3. Admin Safety Review & Approval',
    instruction: 'Switch to Admin -> Safety Review Queue -> Approve with a mandatory review note.',
    role: 'admin',
    email: 'admin@foodbridge.demo',
    tab: 'safety',
  },
  {
    step: 4,
    title: '4. Transparent NGO Match & Exclusions',
    instruction: 'Open the donation details to see ranked NGO scores (0.50U+0.30D+0.20C) and excluded NGOs.',
    role: 'admin',
    email: 'admin@foodbridge.demo',
    tab: 'overview',
  },
  {
    step: 5,
    title: '5. Offer & 30s Auto-Escalation',
    instruction: 'Send offer to NGO #1 with Fast-Forward enabled (or trigger timeout) to escalate to NGO #2.',
    role: 'admin',
    email: 'admin@foodbridge.demo',
    tab: 'overview',
  },
  {
    step: 6,
    title: '6. Second NGO Accepts Atomically',
    instruction: 'Switch to NGO #2 (Hope Urban Shelter) and Accept Offer. Concurrent accepts are blocked.',
    role: 'ngo',
    email: 'hope@foodbridge.demo',
    tab: 'overview',
  },
  {
    step: 7,
    title: '7. Volunteer Claims & Checklist -> In Transit',
    instruction: 'Switch to Volunteer, claim the open pickup, pass the 4-point Safety Checklist -> In Transit.',
    role: 'volunteer',
    email: 'volunteer@foodbridge.demo',
    tab: 'overview',
  },
  {
    step: 8,
    title: '8. OTP/QR Handover & Rating -> Certificate',
    instruction: 'Verify the NGO 6-digit OTP, then as NGO submit the food condition rating to generate the Certificate.',
    role: 'ngo',
    email: 'hope@foodbridge.demo',
    tab: 'overview',
  },
  {
    step: 9,
    title: '9. Public Verify Certificate & Impact Sync',
    instruction: 'Open Verify Certificate (or Impact & Forecast) to verify HMAC-SHA256 validity and updated metrics.',
    role: 'admin',
    email: 'admin@foodbridge.demo',
    tab: 'impact',
  },
];

export function JudgeDemoPanel({
  currentRole,
  fastForwardTimers,
  onToggleFastForward,
  onSwitchRole,
  onNavigateTab,
}: JudgeDemoPanelProps) {
  const [open, setOpen] = useState(false);
  const [activeStep, setActiveStep] = useState(1);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 rounded-xl shadow-lg hover:bg-slate-800 cursor-pointer"
      >
        <Play className="w-3.5 h-3.5 text-emerald-400" />
        Guided Demo
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Judge Guided Demo Panel"
      className="fixed bottom-5 right-5 z-40 w-[360px] max-w-[calc(100vw-2rem)] bg-white border border-slate-300 rounded-xl shadow-2xl overflow-hidden"
    >
      <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between">
        <div>
          <p className="text-xs font-bold">Judge Demo Walkthrough</p>
          <p className="text-[11px] text-slate-300">Current Role: {currentRole.toUpperCase()}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close Guided Demo"
          className="p-1 text-slate-300 hover:text-white cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs">
        <span className="font-medium text-slate-800">Fast-Forward Timers (30s)</span>
        <button
          type="button"
          onClick={onToggleFastForward}
          className={`px-2.5 py-1 rounded-md font-semibold cursor-pointer ${
            fastForwardTimers
              ? 'bg-emerald-700 text-white'
              : 'bg-white border border-slate-300 text-slate-700'
          }`}
        >
          {fastForwardTimers ? 'ON (30s)' : 'OFF (10m)'}
        </button>
      </div>

      <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
        {DEMO_STEPS.map((s) => (
          <button
            key={s.step}
            type="button"
            onClick={async () => {
              setActiveStep(s.step);
              await onSwitchRole(s.role, s.email);
              onNavigateTab(s.tab);
            }}
            className={`w-full px-4 py-2.5 text-left transition-colors cursor-pointer flex items-start justify-between gap-2 ${
              activeStep === s.step ? 'bg-emerald-50' : 'hover:bg-slate-50'
            }`}
          >
            <div>
              <p className="text-xs font-semibold text-slate-900">{s.title}</p>
              <p className="text-[11px] text-slate-600 mt-0.5">{s.instruction}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
          </button>
        ))}
      </div>

      <div className="px-4 py-2.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs">
        <button
          type="button"
          onClick={() => onNavigateTab('why')}
          className="font-semibold text-emerald-800 hover:underline cursor-pointer"
        >
          Why FoodBridge AI & What-Ifs
        </button>
        <button
          type="button"
          onClick={() => onNavigateTab('verify')}
          className="font-semibold text-slate-700 hover:underline cursor-pointer"
        >
          Verify Certificate
        </button>
      </div>
    </div>
  );
}
