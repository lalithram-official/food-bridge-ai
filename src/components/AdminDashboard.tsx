import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Database,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type { Donation, FoodSafetyRuleRow, VerificationStatus } from '../shared/types';
import { apiFetch, formatTimeRemaining, type WorkspaceState } from '../utils/api';
import type { Language } from '../i18n/translations';
import { translateStatus } from '../i18n/translations';

interface AdminDashboardProps {
  state: WorkspaceState;
  activeTab: string;
  lang: Language;
  onRefresh: () => Promise<void>;
  onSelectDonation: (d: Donation) => void;
  onToast: (msg: string, type?: 'success' | 'error') => void;
}

export function AdminDashboard({
  state,
  activeTab,
  lang,
  onRefresh,
  onSelectDonation,
  onToast,
}: AdminDashboardProps) {
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [reassignNgo, setReassignNgo] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [urgencyFilter, setUrgencyFilter] = useState('ALL');
  const [anomalySummary, setAnomalySummary] = useState<{ source: string; summary: string } | null>(null);
  const [rulesDraft, setRulesDraft] = useState<FoodSafetyRuleRow[]>(state.settings.foodSafetyRules);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRulesDraft(state.settings.foodSafetyRules);
  }, [state.settings.foodSafetyRules]);

  const loadAnomalySummary = async () => {
    try {
      const res = await apiFetch<{ source: string; summary: string }>('/api/ai/anomalies', {
        method: 'POST',
      });
      setAnomalySummary(res);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (state.user.role === 'admin' && (activeTab === 'overview' || activeTab === 'safety')) {
      loadAnomalySummary();
    }
  }, [activeTab, state.user.role]);

  const pendingReview = state.donations.filter((d) => d.status === 'Pending Review');
  const openPickupsNeedingDriver = state.pickups.filter((p) => p.status === 'Open');
  const pendingNgos = state.ngos.filter((n) => n.verificationStatus === 'Pending');

  const handleReview = async (donationId: string, decision: 'approve' | 'reject') => {
    const note =
      reviewNotes[donationId] ||
      (decision === 'approve'
        ? 'Approved after Food Safety Passport review.'
        : 'Rejected due to food safety documentation concern.');
    setBusy(true);
    try {
      await apiFetch(`/api/donations/${donationId}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision, note }),
      });
      await onRefresh();
      onToast(
        decision === 'approve'
          ? 'Approved & NGO Matching computed'
          : 'Donation rejected'
      );
    } catch (err) {
      onToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleNgoVerify = async (ngoId: string, status: VerificationStatus) => {
    setBusy(true);
    try {
      await apiFetch(`/api/ngos/${ngoId}/verify`, {
        method: 'POST',
        body: JSON.stringify({ status }),
      });
      await onRefresh();
      onToast(`NGO verification updated to ${status}`);
    } catch (err) {
      onToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleManualReassign = async (donationId: string) => {
    const targetNgoId = reassignNgo[donationId] || state.ngos.find((n) => n.verificationStatus === 'Verified')?.id;
    if (!targetNgoId) return;
    setBusy(true);
    try {
      await apiFetch(`/api/donations/${donationId}/reassign`, {
        method: 'POST',
        body: JSON.stringify({ ngoId: targetNgoId, note: 'Admin manual reassignment' }),
      });
      await onRefresh();
      onToast('Donation manually reassigned to selected NGO');
    } catch (err) {
      onToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handlePatchSettings = async (patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      await apiFetch('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      await onRefresh();
      onToast('Settings saved');
    } catch (err) {
      onToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSeedOrReset = async (mode: 'seed' | 'reset') => {
    setBusy(true);
    try {
      await apiFetch(`/api/admin/${mode}-demo`, { method: 'POST' });
      await onRefresh();
      onToast(mode === 'seed' ? 'Demo data seeded' : 'Demo data reset to baseline');
    } catch (err) {
      onToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const filteredDonations = state.donations.filter((d) => {
    if (statusFilter !== 'ALL' && d.status !== statusFilter) return false;
    if (urgencyFilter !== 'ALL' && d.urgency !== urgencyFilter) return false;
    if (
      search &&
      !d.title.toLowerCase().includes(search.toLowerCase()) &&
      !d.donorName.toLowerCase().includes(search.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  if (activeTab === 'ngos') {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              NGO Verification & Trust Score Queue
            </h2>
            <p className="text-xs text-slate-500">
              {pendingNgos.length} Pending · Only Verified NGOs receive offers unless Demo Pending toggle is enabled
            </p>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2.5 pr-4">NGO</th>
                <th className="py-2.5 pr-4">Area & Served</th>
                <th className="py-2.5 pr-4">Dietary / Storage</th>
                <th className="py-2.5 pr-4">Trust Score</th>
                <th className="py-2.5 pr-4">Status</th>
                <th className="py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {state.ngos.map((n) => (
                <tr key={n.id}>
                  <td className="py-3 pr-4">
                    <p className="font-semibold text-slate-900">{n.organizationName}</p>
                    <p className="text-[11px] text-slate-500">{n.phone}</p>
                  </td>
                  <td className="py-3 pr-4">
                    <p className="text-slate-800">{n.serviceArea}</p>
                    <p className="text-[11px] text-slate-500">
                      {n.peopleServed} served · {n.servedGroups.join(', ')}
                    </p>
                  </td>
                  <td className="py-3 pr-4 text-slate-700">
                    {n.dietaryRules.vegOnly ? 'Veg-only' : 'All'} · {n.storageCapacityKg.ambient}kg amb /{' '}
                    {n.storageCapacityKg.cold}kg cold
                  </td>
                  <td className="py-3 pr-4 font-mono font-bold tabular-nums text-emerald-800">
                    {n.trustScore}/100
                  </td>
                  <td className="py-3 pr-4 font-semibold">{n.verificationStatus}</td>
                  <td className="py-3 text-right space-x-1.5 whitespace-nowrap">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleNgoVerify(n.id, 'Verified')}
                      className="px-2.5 py-1 font-semibold text-white bg-emerald-700 rounded-md hover:bg-emerald-800 cursor-pointer"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleNgoVerify(n.id, 'Suspended')}
                      className="px-2.5 py-1 font-semibold text-red-700 border border-red-200 rounded-md hover:bg-red-50 cursor-pointer"
                    >
                      Suspend
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (activeTab === 'settings') {
    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Operational & Demo Settings
              </h2>
              <p className="text-xs text-slate-500">
                Configure escalation timeouts, AI demo mode, and database seeding
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => handleSeedOrReset('seed')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 cursor-pointer"
              >
                <Database className="w-3.5 h-3.5" />
                Seed Demo Data
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleSeedOrReset('reset')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-800 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Reset Demo Data
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <label className="p-3 rounded-lg border border-slate-200 flex items-center justify-between cursor-pointer">
              <div>
                <p className="font-semibold text-slate-900">Fast-Forward Timers (30s)</p>
                <p className="text-slate-500">Escalates unaccepted offers in 30s</p>
              </div>
              <input
                type="checkbox"
                checked={state.settings.fastForwardTimers}
                onChange={(e) => handlePatchSettings({ fastForwardTimers: e.target.checked })}
              />
            </label>
            <label className="p-3 rounded-lg border border-slate-200 flex items-center justify-between cursor-pointer">
              <div>
                <p className="font-semibold text-slate-900">Allow Pending NGOs (Demo)</p>
                <p className="text-slate-500">Include Pending NGOs in matching</p>
              </div>
              <input
                type="checkbox"
                checked={state.settings.allowPendingNgosForDemo}
                onChange={(e) => handlePatchSettings({ allowPendingNgosForDemo: e.target.checked })}
              />
            </label>
            <label className="p-3 rounded-lg border border-slate-200 flex items-center justify-between cursor-pointer">
              <div>
                <p className="font-semibold text-slate-900">Demo AI Mode</p>
                <p className="text-slate-500">Use labeled sample AI outputs</p>
              </div>
              <input
                type="checkbox"
                checked={state.settings.demoAiMode}
                onChange={(e) => handlePatchSettings({ demoAiMode: e.target.checked })}
              />
            </label>
          </div>
        </div>

        {/* Editable Food Safety Rule Table */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Editable Safe-Until Rule Table (Hours by Storage)
              </h3>
              <p className="text-xs font-medium text-amber-800">
                Prototype guidance, not a regulatory standard.
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => handlePatchSettings({ foodSafetyRules: rulesDraft })}
              className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 cursor-pointer"
            >
              Save Safety Rule Table
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-4">Category</th>
                  <th className="py-2 pr-4">Ambient (h)</th>
                  <th className="py-2 pr-4">Hot Held (h)</th>
                  <th className="py-2 pr-4">Refrigerated (h)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rulesDraft.map((row, idx) => (
                  <tr key={row.category}>
                    <td className="py-2 pr-4 font-semibold text-slate-900">{row.category}</td>
                    <td className="py-2 pr-4">
                      <input
                        type="number"
                        step="0.5"
                        value={row.ambientHours}
                        onChange={(e) => {
                          const next = [...rulesDraft];
                          next[idx] = { ...row, ambientHours: Number(e.target.value) };
                          setRulesDraft(next);
                        }}
                        className="w-20 px-2 py-1 font-mono border border-slate-300 rounded"
                      />
                    </td>
                    <td className="py-2 pr-4">
                      <input
                        type="number"
                        step="0.5"
                        value={row.hotHeldHours}
                        onChange={(e) => {
                          const next = [...rulesDraft];
                          next[idx] = { ...row, hotHeldHours: Number(e.target.value) };
                          setRulesDraft(next);
                        }}
                        className="w-20 px-2 py-1 font-mono border border-slate-300 rounded"
                      />
                    </td>
                    <td className="py-2 pr-4">
                      <input
                        type="number"
                        step="0.5"
                        value={row.refrigeratedHours}
                        onChange={(e) => {
                          const next = [...rulesDraft];
                          next[idx] = { ...row, refrigeratedHours: Number(e.target.value) };
                          setRulesDraft(next);
                        }}
                        className="w-20 px-2 py-1 font-mono border border-slate-300 rounded"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  if (activeTab === 'audit') {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h2 className="text-base font-bold text-slate-900">System Audit Log ({state.auditLog.length})</h2>
        <div className="space-y-2 max-h-[540px] overflow-y-auto text-xs">
          {state.auditLog.map((a) => (
            <div key={a.id} className="p-3 rounded-lg bg-[#F8FAF9] border border-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-slate-900">
                  {a.action} {a.donationId ? `(${a.donationId})` : ''}
                </span>
                <span className="font-mono text-slate-500">
                  {new Date(a.created_at).toLocaleString()}
                </span>
              </div>
              <p className="text-slate-600 mt-0.5">
                Actor: {a.actorName} ({a.actorRole})
                {a.fromStatus || a.toStatus ? ` · ${a.fromStatus || '—'} → ${a.toStatus || '—'}` : ''}
              </p>
              <p className="text-slate-700 mt-1">{a.note}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs text-slate-500">Pending Safety Review</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-amber-800 mt-1">
            {pendingReview.length}
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs text-slate-500">Needs Driver (Open Pickups)</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {openPickupsNeedingDriver.length}
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs text-slate-500">Pending NGO Verifications</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {pendingNgos.length}
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs text-slate-500">Flagged Anomalies</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-red-700 mt-1">
            {state.anomalies.length}
          </p>
        </div>
      </div>

      {/* Anomaly Alerts + Gemini Summary */}
      {state.anomalies.length > 0 && (
        <div className="bg-white border border-amber-200 rounded-xl p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-700" />
              Automated Anomaly & Duplicate Flags
            </h2>
            {anomalySummary && (
              <span className="text-[11px] text-slate-500 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-emerald-700" />
                {anomalySummary.source === 'fallback'
                  ? 'AI unavailable, showing rule-based result'
                  : anomalySummary.source === 'sample_demo'
                  ? 'Sample AI output'
                  : 'Gemini summary'}
              </span>
            )}
          </div>
          {anomalySummary && (
            <p className="text-xs text-slate-700 bg-[#F8FAF9] p-3 rounded-lg border border-slate-200">
              {anomalySummary.summary}
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            {state.anomalies.slice(0, 4).map((an, idx) => (
              <div key={idx} className="p-2.5 rounded-lg bg-amber-50/70 border border-amber-200 text-amber-950">
                <span className="font-mono font-semibold">{an.type}: </span>
                {an.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Donation Safety Review Queue */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-700" />
              Donation Safety Review Queue ({pendingReview.length})
            </h2>
            <p className="text-xs text-slate-500">
              AI never certifies food safety. Human approval with a mandatory note is required before NGO matching.
            </p>
          </div>
        </div>

        {pendingReview.length === 0 ? (
          <p className="text-xs text-slate-500 py-3">All submitted donations have been reviewed.</p>
        ) : (
          <div className="space-y-4">
            {pendingReview.map((don) => {
              const passport = state.passports.find((p) => p.donationId === don.id);
              const assessment = state.assessments.find((a) => a.donationId === don.id);
              return (
                <div
                  key={don.id}
                  className="p-4 rounded-xl border border-slate-200 bg-[#F8FAF9] space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-mono text-slate-500">
                        {don.donorName} · {don.category} · {don.dietaryType} · Safe Until:{' '}
                        {formatTimeRemaining(don.safeUntil, Date.now())}
                      </p>
                      <h3 className="text-sm font-bold text-slate-900 mt-0.5">{don.title}</h3>
                      <p className="text-xs text-slate-600">
                        {don.portions} meals ({don.quantityKg} kg) · Storage: {don.storageMethod}
                        {typeof don.temperatureC === 'number' ? ` (${don.temperatureC}°C)` : ''} · Allergens:{' '}
                        {don.allergens.join(', ')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onSelectDonation(don)}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                    >
                      Inspect Full Passport
                    </button>
                  </div>

                  {assessment && (
                    <div className="p-3 bg-white border border-slate-200 rounded-lg text-xs text-slate-700">
                      <span className="font-semibold text-slate-900">AI Screening ({assessment.humanReviewRecommendation}): </span>
                      {assessment.visibleConditionNotes}{' '}
                      <span className="text-slate-500">({assessment.confidenceNote})</span>
                    </div>
                  )}

                  {passport && passport.ruleFlags.length > 0 && (
                    <div className="flex flex-wrap gap-2 text-xs">
                      {passport.ruleFlags.map((f, idx) => (
                        <span
                          key={idx}
                          className="px-2.5 py-1 rounded-md bg-amber-50 border border-amber-200 text-amber-900"
                        >
                          {f.message}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={reviewNotes[don.id] ?? 'Safety Passport verified; cleared for matching.'}
                      onChange={(e) =>
                        setReviewNotes((prev) => ({ ...prev, [don.id]: e.target.value }))
                      }
                      placeholder="Mandatory human review note"
                      className="flex-1 min-w-[240px] px-3 py-1.5 text-xs border border-slate-300 rounded-lg bg-white"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleReview(don.id, 'approve')}
                      className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 cursor-pointer"
                    >
                      Approve & Match NGOs
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleReview(don.id, 'reject')}
                      className="px-3 py-1.5 text-xs font-semibold text-red-700 bg-white border border-red-300 rounded-lg hover:bg-red-50 cursor-pointer"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* All Donations Table (Filterable + Manual Reassignment) */}
      {activeTab !== 'safety' && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-bold text-slate-900">
              All Platform Donations ({filteredDonations.length})
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search donor or title..."
                  className="pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-300 rounded-lg"
              >
                <option value="ALL">All Statuses</option>
                <option value="Pending Review">Pending Review</option>
                <option value="Matching">Matching</option>
                <option value="Awaiting NGO Acceptance">Awaiting NGO</option>
                <option value="Accepted">Accepted</option>
                <option value="In Transit">In Transit</option>
                <option value="Completed">Completed</option>
                <option value="Rejected">Rejected</option>
                <option value="Expired">Expired</option>
              </select>
              <select
                value={urgencyFilter}
                onChange={(e) => setUrgencyFilter(e.target.value)}
                className="px-2.5 py-1.5 border border-slate-300 rounded-lg"
              >
                <option value="ALL">All Urgency</option>
                <option value="Critical">Critical</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Normal">Normal</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2.5 pr-4">Title & Donor</th>
                  <th className="py-2.5 pr-4">Qty</th>
                  <th className="py-2.5 pr-4">Status</th>
                  <th className="py-2.5 pr-4">Urgency</th>
                  <th className="py-2.5 pr-4">Assigned NGO</th>
                  <th className="py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredDonations.slice(0, 20).map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="py-2.5 pr-4">
                      <p className="font-semibold text-slate-900">{d.title}</p>
                      <p className="text-[11px] text-slate-500">{d.donorName}</p>
                    </td>
                    <td className="py-2.5 pr-4 font-mono tabular-nums">
                      {d.portions}m / {d.quantityKg}kg
                    </td>
                    <td className="py-2.5 pr-4 font-semibold">{translateStatus(lang, d.status)}</td>
                    <td className="py-2.5 pr-4">{d.urgency}</td>
                    <td className="py-2.5 pr-4">{d.assignedNgoName || '—'}</td>
                    <td className="py-2.5 text-right space-x-2 whitespace-nowrap">
                      {['Matching', 'Awaiting NGO Acceptance'].includes(d.status) && (
                        <>
                          <select
                            aria-label={`Reassign NGO for ${d.title}`}
                            value={reassignNgo[d.id] || ''}
                            onChange={(e) =>
                              setReassignNgo((prev) => ({ ...prev, [d.id]: e.target.value }))
                            }
                            className="px-2 py-1 border border-slate-300 rounded text-[11px]"
                          >
                            {state.ngos
                              .filter((n) => n.verificationStatus === 'Verified')
                              .map((n) => (
                                <option key={n.id} value={n.id}>
                                  {n.organizationName}
                                </option>
                              ))}
                          </select>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => handleManualReassign(d.id)}
                            className="px-2 py-1 font-semibold text-slate-700 border border-slate-300 rounded hover:bg-slate-100 cursor-pointer"
                          >
                            Reassign
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => onSelectDonation(d)}
                        className="px-2.5 py-1 font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded cursor-pointer"
                      >
                        Inspect
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
