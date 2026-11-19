import { useEffect, useState } from 'react';
import { ArrowRight, Check, ShieldCheck, Truck, Users, Utensils } from 'lucide-react';
import type { Role } from '../shared/types';
import { apiFetch } from '../utils/api';

interface PublicImpact {
  completedDonations: number;
  redistributedKg: number;
  mealsProvided: number;
  ngosSupported: number;
  estimatedCo2eAvoidedKg: number;
  verifiedNgosCount: number;
  activeVolunteersCount: number;
  disclaimer: string;
}

interface LandingPageProps {
  onOpenWorkspace: (initialRole?: Role) => void;
  onOpenVerify: () => void;
  onOpenLogin: () => void;
}

export function LandingPage({ onOpenWorkspace, onOpenVerify, onOpenLogin }: LandingPageProps) {
  const [impact, setImpact] = useState<PublicImpact | null>(null);
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    apiFetch<PublicImpact>('/api/public/impact')
      .then(setImpact)
      .catch(() => setImpact(null));
  }, []);

  const sixQuestions = [
    {
      num: '01',
      title: 'What surplus is available, and what comes next?',
      desc: 'Structured donation intake plus weekday and hour-window forecasting from historical rescue logs.',
    },
    {
      num: '02',
      title: 'Is it documented and screened for safety?',
      desc: 'Every listing builds a Food Safety Passport with Safe Until deadlines, rule flags, and Gemini visual review.',
    },
    {
      num: '03',
      title: 'Which verified NGO needs it and can use it?',
      desc: 'Hard filters block dietary, allergen, capacity, and hours mismatches before scoring Urgency, Distance, and Trust.',
    },
    {
      num: '04',
      title: 'Who will physically move it, and by when?',
      desc: 'Auto-created courier tasks, grouped nearby pickups, and auto-escalation when an NGO does not respond.',
    },
    {
      num: '05',
      title: 'Was it handed over safely, with proof?',
      desc: '6-digit OTP/QR receipt confirmation generates an HMAC-SHA256 signed Donation Certificate verifiable publicly.',
    },
    {
      num: '06',
      title: 'What measurable impact resulted?',
      desc: 'Measured meals and kg separated clearly from assumption-based CO2e estimates across all dashboards.',
    },
  ];

  const workflowSteps = [
    '01. Donor Posts Surplus',
    '02. AI & Rule Safety Check',
    '03. Human Admin Approval',
    '04. Need-Based NGO Match',
    '05. Volunteer Pickup & Map',
    '06. OTP / QR Handover',
    '07. Signed Proof & Impact',
  ];

  return (
    <div className="min-h-screen bg-[#F8FAF9] text-slate-900">
      {/* 3-Zone Top Navigation Contract */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between gap-8">
          <a
            href="#top"
            className="text-xl font-bold tracking-tight text-emerald-800 whitespace-nowrap shrink-0 font-display"
          >
            FoodBridge AI
          </a>

          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            <a href="#how-it-works" className="hover:text-emerald-800 transition-colors whitespace-nowrap shrink-0">
              How It Works
            </a>
            <a href="#features" className="hover:text-emerald-800 transition-colors whitespace-nowrap shrink-0">
              Capabilities
            </a>
            <a href="#compare" className="hover:text-emerald-800 transition-colors whitespace-nowrap shrink-0">
              Why FoodBridge
            </a>
            <button
              type="button"
              onClick={onOpenVerify}
              className="hover:text-emerald-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Verify Certificate
            </button>
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={onOpenLogin}
              className="px-5 py-2.5 text-sm font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Open Workspace
            </button>
          </div>
        </div>
      </header>

      <main id="top">
        {/* Hero Split Section */}
        <section className="max-w-7xl mx-auto px-6 pt-12 pb-14">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
            <div className="lg:col-span-6 flex flex-col justify-center">
              <p className="text-xs font-medium text-emerald-800 tracking-wide mb-3">
                Surplus Food Rescue · Verified Redistribution · Safety Passport
              </p>
              <h1
                className="font-display font-bold tracking-tight text-slate-900 leading-[1.1] mb-5"
                style={{ fontSize: 'clamp(2.25rem, 3.8vw, 3.4rem)', textWrap: 'balance' }}
              >
                Turning surplus into support with verified food rescue.
              </h1>
              <p className="text-base text-slate-600 leading-relaxed max-w-xl mb-7">
                Listing boards fail when pickups stall, diets mismatch, or safety goes unverified.
                FoodBridge AI pairs deterministic need-based matching, human-approved Food Safety
                Passports, volunteer routing, and cryptographic handover certificates.
              </p>

              <div className="flex flex-wrap items-center gap-3 mb-6">
                <button
                  type="button"
                  onClick={() => onOpenWorkspace('donor')}
                  className="inline-flex items-center gap-2 px-5 py-3 text-sm font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 transition-colors whitespace-nowrap cursor-pointer"
                >
                  Launch Interactive Demo
                  <ArrowRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={onOpenVerify}
                  className="inline-flex items-center gap-2 px-4 py-3 text-sm font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer"
                >
                  Verify a Certificate
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                <span>Human-in-the-loop safety</span>
                <span aria-hidden="true">·</span>
                <span>Auto-escalation on timeout</span>
                <span aria-hidden="true">·</span>
                <span>English, Hindi & Tamil</span>
              </div>
            </div>

            <div className="lg:col-span-6">
              <div className="h-full min-h-[320px] rounded-xl overflow-hidden border border-slate-200 bg-emerald-950 relative">
                {!imgFailed ? (
                  <img
                    src="/src/assets/images/hero_food_rescue_1795069684094.jpg"
                    alt="Kitchen staff and volunteers sealing freshly cooked surplus meals for redistribution"
                    referrerPolicy="no-referrer"
                    onError={() => setImgFailed(true)}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center p-8 text-emerald-50 bg-gradient-to-br from-emerald-900 to-slate-900">
                    <Utensils className="w-10 h-10 mb-3 text-emerald-300" />
                    <p className="font-display font-semibold text-lg">FoodBridge AI Redistribution Network</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Full-width 4-column Live Seeded Impact Strip below Hero Split */}
          <div className="mt-10 bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-4 mb-5 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-900">
                Live Platform Ledger
              </h2>
              <span className="text-xs text-slate-500">
                Demo data · Measured from completed handovers
              </span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
              <div>
                <p className="text-xs text-slate-500 mb-1">Meals Redistributed (Completed)</p>
                <p className="text-3xl font-bold font-mono tabular-nums text-emerald-800">
                  {impact ? impact.mealsProvided.toLocaleString() : '1,580'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Food Rescued (kg)</p>
                <p className="text-3xl font-bold font-mono tabular-nums text-slate-900">
                  {impact ? `${impact.redistributedKg.toLocaleString()} kg` : '632 kg'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Verified NGOs · Couriers</p>
                <p className="text-3xl font-bold font-mono tabular-nums text-slate-900">
                  {impact ? `${impact.verifiedNgosCount} · ${impact.activeVolunteersCount}` : '7 · 5'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Estimated CO2e Avoided (2.5 kg/kg)</p>
                <p className="text-3xl font-bold font-mono tabular-nums text-emerald-800">
                  {impact ? `${impact.estimatedCo2eAvoidedKg.toLocaleString()} kg` : '1,580 kg'}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* How It Works */}
        <section id="how-it-works" className="bg-white border-y border-slate-200 py-14">
          <div className="max-w-7xl mx-auto px-6">
            <div className="max-w-2xl mb-8">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 mb-2">
                Six questions answered for every surplus batch
              </h2>
              <p className="text-sm text-slate-600">
                Every status transition is enforced by code—from donor intake to human safety approval,
                matched NGO acceptance, volunteer checklist, and tamper-evident proof.
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-10">
              {workflowSteps.map((step) => (
                <div
                  key={step}
                  className="px-3 py-3 rounded-lg border border-slate-200 bg-[#F8FAF9] text-xs font-semibold text-slate-800"
                >
                  {step}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {sixQuestions.map((q) => (
                <div key={q.num} className="p-6 rounded-xl border border-slate-200 bg-white">
                  <p className="text-xs font-mono font-semibold text-emerald-700 mb-2">
                    Question {q.num}
                  </p>
                  <h3 className="text-base font-semibold text-slate-900 mb-2">{q.title}</h3>
                  <p className="text-sm text-slate-600 leading-relaxed">{q.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Role Entry Cards */}
        <section id="features" className="max-w-7xl mx-auto px-6 py-14">
          <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 mb-2">
                Four role-specific workspaces, one synchronized store
              </h2>
              <p className="text-sm text-slate-600">
                Open any role directly to inspect or walk through the complete rescue loop.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            <div className="p-6 bg-white border border-slate-200 rounded-xl flex flex-col justify-between">
              <div>
                <Utensils className="w-5 h-5 text-emerald-700 mb-3" />
                <h3 className="text-base font-semibold text-slate-900 mb-2">Donor Kitchens</h3>
                <p className="text-sm text-slate-600 mb-5">
                  One-tap Quick Donate, recurring templates, Bulk Event Alerts, live tracker, and
                  downloadable CSR certificates.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenWorkspace('donor')}
                className="w-full py-2 px-4 text-sm font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors cursor-pointer"
              >
                Enter as Donor
              </button>
            </div>

            <div className="p-6 bg-white border border-slate-200 rounded-xl flex flex-col justify-between">
              <div>
                <Users className="w-5 h-5 text-emerald-700 mb-3" />
                <h3 className="text-base font-semibold text-slate-900 mb-2">Verified NGOs</h3>
                <p className="text-sm text-slate-600 mb-5">
                  Set category shortages, accept matched offers atomically, display 6-digit OTP/QR,
                  and track Trust Score.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenWorkspace('ngo')}
                className="w-full py-2 px-4 text-sm font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors cursor-pointer"
              >
                Enter as NGO
              </button>
            </div>

            <div className="p-6 bg-white border border-slate-200 rounded-xl flex flex-col justify-between">
              <div>
                <Truck className="w-5 h-5 text-emerald-700 mb-3" />
                <h3 className="text-base font-semibold text-slate-900 mb-2">Volunteer Couriers</h3>
                <p className="text-sm text-slate-600 mb-5">
                  Claim nearby pickups, combine grouped stops on OpenStreetMap, complete the safety
                  checklist, and deliver.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenWorkspace('volunteer')}
                className="w-full py-2 px-4 text-sm font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors cursor-pointer"
              >
                Enter as Volunteer
              </button>
            </div>

            <div className="p-6 bg-white border border-slate-200 rounded-xl flex flex-col justify-between">
              <div>
                <ShieldCheck className="w-5 h-5 text-emerald-700 mb-3" />
                <h3 className="text-base font-semibold text-slate-900 mb-2">Operations Admin</h3>
                <p className="text-sm text-slate-600 mb-5">
                  Human safety review queue, NGO verification, anomaly alerts, editable rule tables,
                  and full audit trail.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenWorkspace('admin')}
                className="w-full py-2 px-4 text-sm font-semibold text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Enter as Admin
              </button>
            </div>
          </div>
        </section>

        {/* Comparison Table: Why Not Just a Listing App? */}
        <section id="compare" className="bg-white border-t border-slate-200 py-14">
          <div className="max-w-7xl mx-auto px-6">
            <div className="max-w-2xl mb-8">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 mb-2">
                Why not just a food-listing app?
              </h2>
              <p className="text-sm text-slate-600">
                Typical listing boards stop once a post goes live. FoodBridge AI closes every operational
                failure point between kitchen and recipient.
              </p>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="py-3.5 px-5">Operational Dimension</th>
                    <th className="py-3.5 px-5">Typical Listing App</th>
                    <th className="py-3.5 px-5 text-emerald-800">FoodBridge AI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {[
                    ['NGO Matching', 'Nearest NGO or first-come broadcast only', 'Hard dietary/allergen/capacity filters + transparent 0.50U + 0.30D + 0.20C score'],
                    ['Food Safety', 'No prep time or storage audit trail', 'Food Safety Passport, live Safe Until countdown, Gemini photo screening & human approval'],
                    ['Unanswered Offers', 'Silent failure until food spoils', 'Auto-escalation to next ranked NGO on timeout (30s fast-forward demo mode)'],
                    ['Physical Pickup', 'Assumes donor or NGO figures out transport', 'Dedicated Volunteer layer with atomic claim, 4-point checklist & grouped route stops'],
                    ['Proof of Handover', 'Trust-only checkbox or none', '6-digit OTP/QR verification + HMAC-SHA256 signed public Donation Certificate'],
                    ['Forecasting & Access', 'Reactive, English-only heavy UI', 'Statistical surplus/shortage forecast, Hindi/Tamil UI, Low-Data mode & SMS/WhatsApp outbox'],
                  ].map(([dim, typical, fb]) => (
                    <tr key={dim} className="hover:bg-slate-50/60">
                      <td className="py-3.5 px-5 font-semibold text-slate-900">{dim}</td>
                      <td className="py-3.5 px-5 text-slate-500">{typical}</td>
                      <td className="py-3.5 px-5 text-slate-900 font-medium">
                        <span className="inline-flex items-start gap-2">
                          <Check className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                          <span>{fb}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#F8FAF9] border-t border-slate-200 py-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs text-slate-500">
          <div>
            <span className="font-semibold text-slate-800">FoodBridge AI</span>
            <span className="mx-2">·</span>
            <span>SIH26234 · Team NOURISHNEX</span>
          </div>
          <p>
            AI-assisted screening does not certify food safety. Demo data is labeled clearly throughout the workspace.
          </p>
        </div>
      </footer>
    </div>
  );
}
