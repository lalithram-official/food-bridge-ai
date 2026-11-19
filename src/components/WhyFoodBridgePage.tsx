import { CheckCircle2, ShieldAlert } from 'lucide-react';

export function WhyFoodBridgePage() {
  const scenarios = [
    {
      title: 'What if an NGO does not respond?',
      mechanism: 'Auto-Escalation Engine + Timeout Watchdog',
      outcome:
        'After the configured timeout (10 minutes default, 30 seconds in Fast-Forward Demo mode), the unaccepted offer expires, logs an audit entry, and automatically sends the offer to the next eligible ranked NGO without donor intervention.',
    },
    {
      title: 'What if no volunteer claims the pickup?',
      mechanism: 'Needs-Driver Escalation + Self-Delivery Fallback',
      outcome:
        'An admin alert banner ("Needs driver") is triggered automatically, while both the donor and the assigned NGO can click Self-Deliver so food never remains stranded.',
    },
    {
      title: 'What if Gemini AI is unavailable or quota-limited?',
      mechanism: 'Deterministic Engine + Rule-Based Fallback',
      outcome:
        'All scoring, Safe Until deadlines, lifecycle transitions, and OTP/certificate cryptography run in pure deterministic code. Gemini calls time out cleanly, retry once, and fall back to a clearly labeled rule-based summary with a Retry button.',
    },
    {
      title: 'What if food is nearing expiry?',
      mechanism: 'Live Safe Until Urgency Escalation & Watchdog',
      outcome:
        'Urgency dynamically shifts from Normal -> Medium -> High -> Critical (<60m left), boosting urgency score U and firing a 30-minute Safe Until warning. Past the limit, the donation transitions to Expired and blocks handover.',
    },
    {
      title: 'What if unsafe or poorly documented food is posted?',
      mechanism: 'Rule Checks + Human Admin Gate',
      outcome:
        'Missing prep times, temperature breaches, or missing cooked-food photos raise severity flags. AI never certifies food safety—every listing sits in Pending Review until a human admin approves or rejects with a mandatory note.',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-xl font-bold font-display text-slate-900 mb-1">
          Why FoodBridge AI?
        </h2>
        <p className="text-sm text-slate-600 mb-6">
          Comparison between typical surplus listing boards and FoodBridge AI’s end-to-end operational safeguards.
        </p>

        <div className="overflow-x-auto border border-slate-200 rounded-lg">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Capability</th>
                <th className="py-3 px-4">Typical Listing App</th>
                <th className="py-3 px-4 text-emerald-800">FoodBridge AI</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {[
                ['Matching', 'Distance-only or manual feed', 'Hard eligibility filters + 0.50 Need/Urgency + 0.30 Proximity + 0.20 Capacity/Trust'],
                ['Safety Trail', 'Unverified text post', 'Food Safety Passport, rule flags, Gemini photo notes, mandatory human approval'],
                ['Logistics', 'No courier layer', 'Volunteer claim lock, 4-point pickup checklist, grouped stops & OpenStreetMap'],
                ['Escalation', 'Expires silently if ignored', 'Auto-escalates to next ranked NGO + broadcasts for Bulk Event Alerts'],
                ['Handover Proof', 'None or informal chat', '6-digit OTP/QR verification + HMAC-SHA256 signed public Donation Certificate'],
                ['Intelligence & Access', 'Static lists, English only', 'Moving-average + Gemini forecast, role-scoped assistant, Hindi/Tamil & Low-Data mode'],
              ].map(([cap, typ, fb]) => (
                <tr key={cap}>
                  <td className="py-3 px-4 font-semibold text-slate-900">{cap}</td>
                  <td className="py-3 px-4 text-slate-500">{typ}</td>
                  <td className="py-3 px-4 text-slate-900 font-medium">
                    <span className="inline-flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                      <span>{fb}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <h3 className="text-lg font-bold font-display text-slate-900 mb-1">
          “What if…?” Failure-Mode Resilience
        </h3>
        <p className="text-sm text-slate-600 mb-5">
          How FoodBridge AI prevents real-world food rescue failures without manual guesswork.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {scenarios.map((s) => (
            <div key={s.title} className="p-4 border border-slate-200 rounded-lg bg-[#F8FAF9]">
              <div className="flex items-center gap-2 mb-1.5">
                <ShieldAlert className="w-4 h-4 text-emerald-700 shrink-0" />
                <h4 className="text-sm font-bold text-slate-900">{s.title}</h4>
              </div>
              <p className="text-xs font-semibold text-emerald-800 mb-1.5">{s.mechanism}</p>
              <p className="text-xs text-slate-600 leading-relaxed">{s.outcome}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
