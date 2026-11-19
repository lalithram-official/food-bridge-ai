import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  Clock,
  HelpCircle,
  RefreshCw,
  Send,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { Donation } from '../shared/types';
import { apiFetch, formatTimeRemaining, type WorkspaceState } from '../utils/api';

interface DonationDetailModalProps {
  donation: Donation & { donorContactPhone?: string };
  state: WorkspaceState;
  lowDataMode?: boolean;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  onOpenCertificate: (certId: string) => void;
  onToast: (msg: string, type?: 'success' | 'error') => void;
}

const LIFECYCLE_STEPS = [
  'Pending Review',
  'Approved',
  'Matching',
  'Awaiting NGO Acceptance',
  'Accepted',
  'Pickup Scheduled',
  'In Transit',
  'Delivered',
  'Completed',
];

export function DonationDetailModal({
  donation,
  state,
  lowDataMode,
  onClose,
  onRefresh,
  onOpenCertificate,
  onToast,
}: DonationDetailModalProps) {
  const [nowMs, setNowMs] = useState(Date.now());
  const [showFormula, setShowFormula] = useState(false);
  const [busy, setBusy] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [adminNote, setAdminNote] = useState('Safety Passport verified; cleared for NGO matching.');

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const passport = state.passports.find((p) => p.donationId === donation.id);
  const assessment = state.assessments.find((a) => a.donationId === donation.id);
  const matchRec = state.matches.find((m) => m.donationId === donation.id);
  const offers = state.offers.filter((o) => o.donationId === donation.id);
  const pickup = state.pickups.find((p) => p.donationId === donation.id);
  const delivery = state.deliveries.find((d) => d.donationId === donation.id);
  const certificate = state.certificates.find((c) => c.donationId === donation.id);
  const audits = state.auditLog.filter((a) => a.donationId === donation.id);

  const role = state.user.role;
  const currentStepIdx = LIFECYCLE_STEPS.indexOf(donation.status);

  const handleReview = async (decision: 'approve' | 'reject') => {
    setBusy(true);
    try {
      await apiFetch(`/api/donations/${donation.id}/review`, {
        method: 'POST',
        body: JSON.stringify({ decision, note: adminNote }),
      });
      await onRefresh();
      onToast(decision === 'approve' ? 'Donation approved & NGOs matched' : 'Donation rejected');
    } catch (err) {
      onToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSendOffer = async (mode: 'top1' | 'broadcast') => {
    setBusy(true);
    try {
      await apiFetch(`/api/donations/${donation.id}/send-offer`, {
        method: 'POST',
        body: JSON.stringify({ mode }),
      });
      await onRefresh();
      onToast(mode === 'broadcast' ? 'Broadcast sent to top 3 NGOs' : 'Offer sent to top-ranked NGO');
    } catch (err) {
      onToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRetryAi = async () => {
    setBusy(true);
    try {
      await apiFetch(`/api/ai/assess/${donation.id}`, { method: 'POST' });
      await onRefresh();
      onToast('AI assessment refreshed');
    } catch (err) {
      onToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleSimulateOfferTimeout = async (offerId: string) => {
    setBusy(true);
    try {
      await apiFetch(`/api/offers/${offerId}/simulate-timeout`, { method: 'POST' });
      await onRefresh();
      onToast('Offer timeout triggered — escalated to next NGO');
    } catch (err) {
      onToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const payload = otpInput.trim().startsWith('FB-QR-')
        ? { qrToken: otpInput.trim() }
        : { otp: otpInput.trim() };
      await apiFetch(`/api/deliveries/${donation.id}/verify-otp`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await onRefresh();
      onToast('Handover verified — status updated to Delivered');
    } catch (err) {
      onToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Donation details: ${donation.title}`}
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-xl">
        <div className="px-6 py-4 border-b border-slate-200 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-slate-500 font-mono">
              {donation.id} · {donation.donorName} · {donation.status}
            </p>
            <h2 className="text-lg font-bold text-slate-900 mt-0.5">{donation.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close donation details"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          {/* Lifecycle Stepper */}
          <div>
            <p className="text-xs font-semibold text-slate-700 mb-2">Lifecycle Progress</p>
            <div className="grid grid-cols-3 sm:grid-cols-9 gap-1.5">
              {LIFECYCLE_STEPS.map((step, idx) => {
                const done = currentStepIdx >= idx && currentStepIdx !== -1;
                const active = donation.status === step;
                return (
                  <div
                    key={step}
                    className={`px-2 py-2 rounded-md border text-[11px] font-medium leading-tight ${
                      active
                        ? 'bg-emerald-700 text-white border-emerald-700'
                        : done
                        ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                        : 'bg-slate-50 text-slate-500 border-slate-200'
                    }`}
                  >
                    {step}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Food Safety Passport + AI Assessment */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="p-4 rounded-xl border border-slate-200 bg-[#F8FAF9] space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-700" />
                  Food Safety Passport
                </h3>
                <span className="text-xs font-mono font-semibold text-amber-800 flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  Safe Until: {formatTimeRemaining(donation.safeUntil, nowMs)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-500 block">Category & Diet</span>
                  <span className="font-semibold text-slate-900">
                    {donation.category} · {donation.dietaryType}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Quantity</span>
                  <span className="font-semibold font-mono tabular-nums text-slate-900">
                    {donation.portions} meals ({donation.quantityKg} kg)
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Storage & Temp</span>
                  <span className="font-semibold text-slate-900">
                    {donation.storageMethod}
                    {typeof donation.temperatureC === 'number' ? ` (${donation.temperatureC}°C)` : ''}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Allergens</span>
                  <span className="font-semibold text-slate-900">
                    {donation.allergens.join(', ')}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Prepared At</span>
                  <span className="font-medium text-slate-800">
                    {new Date(donation.preparedAt).toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Packaging</span>
                  <span className="font-medium text-slate-800">{donation.packaging}</span>
                </div>
              </div>

              {!lowDataMode && donation.photos.length > 0 && (
                <div className="flex gap-2 pt-1">
                  {donation.photos.map((photo, idx) => (
                    <img
                      key={idx}
                      src={photo}
                      alt={`${donation.title} photo ${idx + 1}`}
                      referrerPolicy="no-referrer"
                      className="w-24 h-18 object-cover rounded-lg border border-slate-200"
                    />
                  ))}
                </div>
              )}

              {passport && passport.ruleFlags.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-xs font-semibold text-slate-700">Rule-Based Checks:</p>
                  {passport.ruleFlags.map((flag, i) => (
                    <div
                      key={i}
                      className={`px-2.5 py-1.5 rounded-md text-xs flex items-center gap-2 ${
                        flag.severity === 'critical'
                          ? 'bg-red-50 text-red-900 border border-red-200'
                          : 'bg-amber-50 text-amber-900 border border-amber-200'
                      }`}
                    >
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{flag.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {passport?.checklistResults && (
                <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
                  Pickup Checklist Verified: Sealed, Time-Labeled, Temp Maintained, Photo Logged.
                </div>
              )}
            </div>

            {/* AI Food Assessment */}
            <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900">Gemini AI Food Screening</h3>
                <div className="flex items-center gap-2">
                  {assessment?.source === 'fallback' && (
                    <span className="text-[11px] font-medium text-amber-800">
                      AI unavailable, showing rule-based result
                    </span>
                  )}
                  {assessment?.source === 'sample_demo' && (
                    <span className="text-[11px] font-medium text-slate-600">
                      Sample AI output
                    </span>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleRetryAi}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Retry AI
                  </button>
                </div>
              </div>

              {assessment ? (
                <div className="space-y-2.5 text-xs">
                  <p className="text-slate-700">
                    <span className="font-semibold text-slate-900">Interpretation: </span>
                    {assessment.categoryInterpretation}
                  </p>
                  <p className="text-slate-700">
                    <span className="font-semibold text-slate-900">Visible Condition: </span>
                    {assessment.visibleConditionNotes}
                  </p>
                  <p className="text-slate-700">
                    <span className="font-semibold text-slate-900">Human Review Suggestion: </span>
                    <span className="font-semibold text-emerald-800">
                      {assessment.humanReviewRecommendation}
                    </span>
                    {' · '}
                    <span>Urgency: {assessment.urgencyRecommendation}</span>
                  </p>
                  <p className="text-slate-500">{assessment.confidenceNote}</p>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-[11px] text-slate-600 leading-relaxed">
                    {assessment.disclaimer}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-500">No AI assessment recorded yet.</p>
              )}
            </div>
          </div>

          {/* Admin Safety Review Gate */}
          {role === 'admin' && donation.status === 'Pending Review' && (
            <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/40 space-y-3">
              <h3 className="text-sm font-bold text-slate-900">
                Admin Human Safety Approval Gate
              </h3>
              <div>
                <label htmlFor="admin-review-note" className="block text-xs font-medium text-slate-700 mb-1">
                  Mandatory Review Note
                </label>
                <input
                  id="admin-review-note"
                  type="text"
                  value={adminNote}
                  onChange={(e) => setAdminNote(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                />
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleReview('approve')}
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 cursor-pointer"
                >
                  Approve & Run Matching Engine
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleReview('reject')}
                  className="px-4 py-2 text-xs font-semibold text-red-700 bg-white border border-red-300 rounded-lg hover:bg-red-50 cursor-pointer"
                >
                  Reject Donation
                </button>
              </div>
            </div>
          )}

          {/* Matching Engine Results (with U/D/C Breakdown & Exclusions) */}
          {matchRec && (
            <div className="border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Deterministic NGO Matching Results
                  </h3>
                  <p className="text-xs text-slate-500">
                    Weights: Urgency 50% · Proximity 30% · Capacity & Trust 20%
                  </p>
                </div>

                <div className="flex items-center gap-2 relative">
                  <button
                    type="button"
                    onClick={() => setShowFormula((s) => !s)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                    How is this calculated?
                  </button>

                  {(role === 'donor' || role === 'admin') && donation.status === 'Matching' && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleSendOffer('top1')}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 cursor-pointer"
                      >
                        <Send className="w-3.5 h-3.5" />
                        Send Offer to #1 NGO
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleSendOffer('broadcast')}
                        className="px-3 py-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 cursor-pointer"
                      >
                        Broadcast Top 3
                      </button>
                    </>
                  )}
                </div>
              </div>

              {showFormula && (
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-1">
                  <p className="font-semibold text-slate-900">
                    Match Score = 0.50 × U + 0.30 × D + 0.20 × C
                  </p>
                  <p>
                    1) Hard filters exclude unverified NGOs, dietary/nut-child mismatches, closed operating hours,
                    insufficient storage capacity, or arrival past Safe Until.
                  </p>
                  <p>
                    2) U scores category need & urgency; D scores Haversine distance & ETA; C scores storage
                    headroom, vehicle availability, and verified Trust Score (0–100).
                  </p>
                </div>
              )}

              <div className="space-y-2">
                {matchRec.candidates.map((cand, idx) => (
                  <div
                    key={cand.ngoId}
                    className={`p-3 rounded-lg border text-xs ${
                      cand.eligible
                        ? 'border-slate-200 bg-white'
                        : 'border-slate-200 bg-slate-50 text-slate-500'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-semibold text-slate-900">
                          {cand.eligible ? `#${idx + 1} ` : 'Excluded: '}
                          {cand.ngoName}
                        </span>
                        <span className="ml-2 text-slate-500">
                          {cand.distanceKm} km (~{cand.estimatedTravelMins} mins) · Trust {cand.trustScore}/100
                        </span>
                      </div>
                      {cand.eligible ? (
                        <span className="font-mono font-bold text-emerald-800 tabular-nums">
                          Score: {cand.matchScore}/100 (U:{cand.urgencyScore} · D:{cand.proximityScore} · C:{cand.capacityScore})
                        </span>
                      ) : (
                        <span className="font-medium text-red-700">
                          {cand.excludedReasons.join('; ')}
                        </span>
                      )}
                    </div>
                    {cand.eligible && cand.aiExplanation && (
                      <p className="text-slate-600 mt-1.5">{cand.aiExplanation}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Active Offers & Escalation Timeline */}
          {offers.length > 0 && (
            <div className="border border-slate-200 rounded-xl p-4 space-y-2.5">
              <h3 className="text-sm font-bold text-slate-900">NGO Offer & Escalation Log</h3>
              {offers.map((off) => (
                <div
                  key={off.id}
                  className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs"
                >
                  <div>
                    <span className="font-semibold text-slate-900">
                      Rank #{off.rankOrder}: {off.ngoName}
                    </span>
                    <span className="mx-2 text-slate-400">·</span>
                    <span className="font-medium text-slate-700">{off.status}</span>
                    {off.status === 'Pending' && (
                      <span className="ml-2 font-mono text-amber-800">
                        (Timeout in {formatTimeRemaining(off.expiresAt, nowMs)})
                      </span>
                    )}
                    {off.rejectionReason && (
                      <span className="ml-2 text-red-700">Reason: {off.rejectionReason}</span>
                    )}
                  </div>
                  {off.status === 'Pending' && (role === 'admin' || role === 'donor') && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleSimulateOfferTimeout(off.id)}
                      className="px-2.5 py-1 text-xs font-medium text-amber-900 bg-amber-100 border border-amber-300 rounded-md hover:bg-amber-200 cursor-pointer"
                    >
                      Trigger Timeout Escalation Now
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Handover & Certificate Section */}
          {(delivery || certificate) && (
            <div className="border border-slate-200 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-bold text-slate-900">Handover & Proof</h3>
              {delivery?.otpPlainForAuthorizedRoles && (
                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold text-emerald-900">NGO Handover OTP: </span>
                    <span className="font-mono font-bold text-base text-emerald-900">
                      {delivery.otpPlainForAuthorizedRoles}
                    </span>
                  </div>
                  <span className="font-mono text-emerald-800">{delivery.qrToken}</span>
                </div>
              )}

              {donation.status === 'In Transit' && (
                <form onSubmit={handleVerifyOtp} className="flex flex-wrap items-center gap-2">
                  <label htmlFor="detail-otp-input" className="sr-only">
                    Enter 6-digit OTP or QR Token
                  </label>
                  <input
                    id="detail-otp-input"
                    type="text"
                    required
                    value={otpInput}
                    onChange={(e) => setOtpInput(e.target.value)}
                    placeholder="Enter 6-digit NGO OTP or FB-QR token"
                    className="flex-1 min-w-[220px] px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                  <button
                    type="submit"
                    disabled={busy}
                    className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 cursor-pointer"
                  >
                    Verify Handover OTP/QR
                  </button>
                </form>
              )}

              {certificate && (
                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs text-emerald-900">
                    <Award className="w-4 h-4 text-emerald-700" />
                    <span>
                      Certificate <strong className="font-mono">{certificate.id}</strong> issued ({certificate.algorithm})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenCertificate(certificate.id)}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 cursor-pointer"
                  >
                    Verify Public Certificate
                  </button>
                </div>
              )}

              {pickup && (
                <p className="text-xs text-slate-600">
                  Courier: {pickup.volunteerName || 'Unassigned'} · Distance: {pickup.distanceKm} km · Status: {pickup.status}
                </p>
              )}
            </div>
          )}

          {/* Audit Trail */}
          {audits.length > 0 && (
            <div className="border border-slate-200 rounded-xl p-4">
              <h3 className="text-sm font-bold text-slate-900 mb-2">Audit Trail</h3>
              <div className="space-y-2 max-h-44 overflow-y-auto text-xs">
                {audits.map((a) => (
                  <div key={a.id} className="flex items-start gap-2 text-slate-600">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold text-slate-900">{a.action}</span>
                      {' · '}
                      <span>{a.actorName} ({a.actorRole})</span>
                      {' · '}
                      <span className="font-mono text-[11px]">{new Date(a.created_at).toLocaleTimeString()}</span>
                      <p className="text-slate-500">{a.note}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
