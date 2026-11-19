import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Plus, ShieldCheck, Star, XCircle } from 'lucide-react';
import type { Donation, FoodCategory, NgoProfile, UrgencyLevel } from '../shared/types';
import { apiFetch, formatTimeRemaining, type WorkspaceState } from '../utils/api';
import type { Language } from '../i18n/translations';
import { tr, translateStatus } from '../i18n/translations';

interface NgoDashboardProps {
  state: WorkspaceState;
  lang: Language;
  onRefresh: () => Promise<void>;
  onSelectDonation: (d: Donation) => void;
  onToast: (msg: string, type?: 'success' | 'error') => void;
}

const REJECTION_REASONS = [
  'Storage capacity full',
  'Dietary mismatch',
  'Volunteer / transport unavailable',
  'Kitchen closed / staff shortage',
  'Quantity exceeds immediate serving capacity',
];

export function NgoDashboard({
  state,
  lang,
  onRefresh,
  onSelectDonation,
  onToast,
}: NgoDashboardProps) {
  const ngo = state.profile as NgoProfile | null;
  const [reqCategory, setReqCategory] = useState<FoodCategory>('Cooked Veg Curry / Meals');
  const [reqKg, setReqKg] = useState(25);
  const [reqUrgency, setReqUrgency] = useState<UrgencyLevel>('High');
  const [reqNotes, setReqNotes] = useState('Evening community meal distribution');

  const [rejectingOfferId, setRejectingOfferId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState(REJECTION_REASONS[0]);

  const [qrImages, setQrImages] = useState<Record<string, string>>({});
  const [otpVerifyInput, setOtpVerifyInput] = useState<Record<string, string>>({});
  const [ratingCond, setRatingCond] = useState(5);
  const [ratingPack, setRatingPack] = useState(5);
  const [ratingComment, setRatingComment] = useState('Fresh, cleanly packed, and well-labeled.');
  const [busy, setBusy] = useState(false);

  const myOffers = state.offers.filter((o) => o.ngoId === ngo?.id);
  const pendingOffers = myOffers.filter((o) => o.status === 'Pending');
  const myRequirements = state.ngoRequirements.filter((r) => r.ngoId === ngo?.id);
  const myAssignedDonations = state.donations.filter(
    (d) =>
      d.assignedNgoId === ngo?.id &&
      ['Accepted', 'Pickup Scheduled', 'In Transit', 'Delivered'].includes(d.status)
  );
  const myCompletedDonations = state.donations.filter(
    (d) => d.assignedNgoId === ngo?.id && d.status === 'Completed'
  );

  useEffect(() => {
    const genQrs = async () => {
      const nextMap: Record<string, string> = {};
      for (const del of state.deliveries) {
        if (del.ngoId === ngo?.id && del.qrToken) {
          nextMap[del.donationId] = await QRCode.toDataURL(del.qrToken, { width: 96, margin: 1 });
        }
      }
      setQrImages(nextMap);
    };
    genQrs();
  }, [state.deliveries, ngo?.id]);

  const handleAddRequirement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ngo) return;
    setBusy(true);
    try {
      await apiFetch(`/api/ngos/${ngo.id}/requirements`, {
        method: 'POST',
        body: JSON.stringify({
          category: reqCategory,
          neededKg: Number(reqKg),
          urgency: reqUrgency,
          notes: reqNotes,
        }),
      });
      await onRefresh();
      onToast('Requirement added to NGO profile');
    } catch (err) {
      onToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleAccept = async (offerId: string, selfDeliver = false) => {
    setBusy(true);
    try {
      await apiFetch(`/api/offers/${offerId}/accept`, {
        method: 'POST',
        body: JSON.stringify({ selfDeliver }),
      });
      await onRefresh();
      onToast(selfDeliver ? 'Accepted with NGO self-pickup!' : 'Offer accepted! Pickup task published to volunteers.');
    } catch (err) {
      onToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async (offerId: string) => {
    setBusy(true);
    try {
      await apiFetch(`/api/offers/${offerId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: rejectReason }),
      });
      setRejectingOfferId(null);
      await onRefresh();
      onToast('Offer rejected and escalated to next eligible NGO');
    } catch (err) {
      onToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmReceiptOtp = async (donationId: string) => {
    const val = (otpVerifyInput[donationId] || '').trim();
    if (!val) {
      onToast('Enter the 6-digit OTP or QR token', 'error');
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/api/deliveries/${donationId}/verify-otp`, {
        method: 'POST',
        body: JSON.stringify(val.startsWith('FB-QR-') ? { qrToken: val } : { otp: val }),
      });
      await onRefresh();
      onToast('Receipt confirmed! Please submit condition rating to generate certificate.');
    } catch (err) {
      onToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleRateAndComplete = async (donationId: string) => {
    setBusy(true);
    try {
      const res = await apiFetch<{ certificate: { id: string } }>(
        `/api/deliveries/${donationId}/rate`,
        {
          method: 'POST',
          body: JSON.stringify({
            foodConditionScore: ratingCond,
            donorPackagingScore: ratingPack,
            comment: ratingComment,
          }),
        }
      );
      await onRefresh();
      onToast(`Completed! Certificate ${res.certificate.id} issued.`);
    } catch (err) {
      onToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* NGO Verification & Trust Score Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs text-slate-500">Verification Status</p>
          <p className="text-lg font-bold text-emerald-800 flex items-center gap-1.5 mt-1">
            <ShieldCheck className="w-4 h-4" />
            {ngo?.verificationStatus || 'Verified'}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            {ngo?.dietaryRules.vegOnly ? 'Veg-Only Kitchen' : 'Veg & Non-Veg'} · {ngo?.servedGroups.join(', ')}
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs text-slate-500">Derived Trust Score</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {ngo?.trustScore ?? 90}/100
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            {ngo?.completedPickups}/{ngo?.totalAssignedPickups} pickups · ~{ngo?.avgResponseMinutes}m avg reply
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs text-slate-500">Available Storage</p>
          <p className="text-lg font-bold font-mono tabular-nums text-slate-900 mt-1">
            {ngo ? ngo.storageCapacityKg.ambient - ngo.currentUsedKg.ambient : 0} kg Ambient
          </p>
          <p className="text-[11px] text-slate-500 mt-1">
            {ngo ? ngo.storageCapacityKg.cold - ngo.currentUsedKg.cold : 0} kg Cold remaining
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs text-slate-500">Completed Meals Received</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-emerald-800 mt-1">
            {myCompletedDonations.reduce((s, d) => s + d.portions, 0)}
          </p>
        </div>
      </div>

      {/* Incoming Matched Offers */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Incoming Ranked Offers ({pendingOffers.length})
            </h2>
            <p className="text-xs text-slate-500">
              Accept atomically or reject with a reason (auto-escalates if timed out)
            </p>
          </div>
        </div>

        {pendingOffers.length === 0 ? (
          <p className="text-xs text-slate-500 py-4">
            No pending offers right now. Keep requirements updated below to improve matching urgency scores.
          </p>
        ) : (
          <div className="space-y-3">
            {pendingOffers.map((off) => {
              const don = state.donations.find((d) => d.id === off.donationId);
              const match = state.matches
                .find((m) => m.donationId === off.donationId)
                ?.candidates.find((c) => c.ngoId === ngo?.id);
              if (!don) return null;

              return (
                <div
                  key={off.id}
                  className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/30 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-mono text-slate-500">
                        Offer #{off.rankOrder} · Timeout in {formatTimeRemaining(off.expiresAt, Date.now())}
                      </p>
                      <h3 className="text-sm font-bold text-slate-900 mt-0.5">{don.title}</h3>
                      <p className="text-xs text-slate-600">
                        {don.portions} meals ({don.quantityKg} kg) · {don.category} · {don.dietaryType} ·{' '}
                        {don.location.area}
                      </p>
                    </div>
                    {match && (
                      <div className="text-right">
                        <p className="text-sm font-mono font-bold text-emerald-800">
                          Match Score: {match.matchScore}/100
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {match.distanceKm} km (~{match.estimatedTravelMins} mins)
                        </p>
                      </div>
                    )}
                  </div>

                  {match?.aiExplanation && (
                    <p className="text-xs text-slate-700 bg-white p-2.5 rounded-lg border border-slate-200">
                      {match.aiExplanation}
                    </p>
                  )}

                  {rejectingOfferId === off.id ? (
                    <div className="p-3 bg-white border border-red-200 rounded-lg space-y-2">
                      <label htmlFor={`rej-${off.id}`} className="block text-xs font-semibold text-slate-800">
                        Select Rejection Reason (feeds analytics)
                      </label>
                      <select
                        id={`rej-${off.id}`}
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-lg"
                      >
                        {REJECTION_REASONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleReject(off.id)}
                          className="px-3 py-1.5 text-xs font-semibold text-white bg-red-700 rounded-md hover:bg-red-800 cursor-pointer"
                        >
                          Confirm Reject & Escalate
                        </button>
                        <button
                          type="button"
                          onClick={() => setRejectingOfferId(null)}
                          className="px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 rounded-md cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleAccept(off.id, false)}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 cursor-pointer"
                      >
                        <Check className="w-3.5 h-3.5" />
                        {tr(lang, 'accept')}
                      </button>
                      {ngo?.hasVehicle && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleAccept(off.id, true)}
                          className="px-3 py-2 text-xs font-semibold text-emerald-800 bg-white border border-emerald-300 rounded-lg hover:bg-emerald-50 cursor-pointer"
                        >
                          Accept & Self-Pickup
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setRejectingOfferId(off.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-red-700 bg-white border border-red-200 rounded-lg hover:bg-red-50 cursor-pointer"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        {tr(lang, 'reject')}
                      </button>
                      <button
                        type="button"
                        onClick={() => onSelectDonation(don)}
                        className="px-3 py-2 text-xs font-medium text-slate-700 hover:underline cursor-pointer"
                      >
                        Safety Passport
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Active Handovers: Show OTP / QR + Confirm Receipt + Rate */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h2 className="text-base font-bold text-slate-900">
          Active Deliveries, Handover OTP/QR & Rating ({myAssignedDonations.length})
        </h2>

        {myAssignedDonations.length === 0 ? (
          <p className="text-xs text-slate-500">No active deliveries awaiting handover.</p>
        ) : (
          <div className="space-y-4">
            {myAssignedDonations.map((don) => {
              const del = state.deliveries.find((d) => d.donationId === don.id);
              const pk = state.pickups.find((p) => p.donationId === don.id);
              return (
                <div key={don.id} className="p-4 rounded-xl border border-slate-200 bg-[#F8FAF9] space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-mono text-slate-500">
                        {translateStatus(lang, don.status)} · Safe Until: {formatTimeRemaining(don.safeUntil, Date.now())}
                      </p>
                      <h3 className="text-sm font-bold text-slate-900">{don.title}</h3>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Donor: {don.donorName} ({don.donorContactPhone || 'Phone shared'}) · {don.location.address}
                      </p>
                      <p className="text-xs text-slate-600">
                        Courier: {pk?.volunteerName || 'Awaiting volunteer claim'}
                      </p>
                    </div>

                    {del?.otpPlainForAuthorizedRoles && (
                      <div className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-lg">
                        <div>
                          <p className="text-[11px] text-slate-500">Show Handover OTP</p>
                          <p className="text-xl font-mono font-bold text-emerald-800 tracking-wider">
                            {del.otpPlainForAuthorizedRoles}
                          </p>
                        </div>
                        {qrImages[don.id] && (
                          <img src={qrImages[don.id]} alt="Handover QR" className="w-16 h-16" />
                        )}
                      </div>
                    )}
                  </div>

                  {don.status === 'In Transit' && (
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200">
                      <input
                        type="text"
                        value={otpVerifyInput[don.id] ?? del?.otpPlainForAuthorizedRoles ?? ''}
                        onChange={(e) =>
                          setOtpVerifyInput((prev) => ({ ...prev, [don.id]: e.target.value }))
                        }
                        placeholder="Enter 6-digit OTP"
                        className="px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg bg-white"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleConfirmReceiptOtp(don.id)}
                        className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 cursor-pointer"
                      >
                        {tr(lang, 'confirmOtp')}
                      </button>
                    </div>
                  )}

                  {don.status === 'Accepted' && pk?.status === 'Open' && (
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch(`/api/pickups/${pk.id}/self-deliver`, { method: 'POST' });
                        await onRefresh();
                        onToast('Assigned to NGO Self-Delivery');
                      }}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-100 cursor-pointer"
                    >
                      Self-Pickup with NGO Vehicle
                    </button>
                  )}

                  {don.status === 'Delivered' && (
                    <div className="p-3 bg-white border border-emerald-200 rounded-lg space-y-2.5">
                      <p className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <Star className="w-3.5 h-3.5 text-amber-500" />
                        Rate Donor & Food Condition to Generate Certificate
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                        <div>
                          <label className="block text-slate-600 mb-1">Food Condition (1–5)</label>
                          <select
                            value={ratingCond}
                            onChange={(e) => setRatingCond(Number(e.target.value))}
                            className="w-full px-2 py-1.5 border border-slate-300 rounded-md"
                          >
                            {[5, 4, 3, 2, 1].map((n) => (
                              <option key={n} value={n}>
                                {n} / 5
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-slate-600 mb-1">Packaging (1–5)</label>
                          <select
                            value={ratingPack}
                            onChange={(e) => setRatingPack(Number(e.target.value))}
                            className="w-full px-2 py-1.5 border border-slate-300 rounded-md"
                          >
                            {[5, 4, 3, 2, 1].map((n) => (
                              <option key={n} value={n}>
                                {n} / 5
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-slate-600 mb-1">Comment</label>
                          <input
                            type="text"
                            value={ratingComment}
                            onChange={(e) => setRatingComment(e.target.value)}
                            className="w-full px-2 py-1.5 border border-slate-300 rounded-md"
                          />
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleRateAndComplete(don.id)}
                        className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 cursor-pointer"
                      >
                        {tr(lang, 'rateComplete')}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Current NGO Requirements Editor */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleAddRequirement}
          className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-3"
        >
          <h3 className="text-sm font-bold text-slate-900">Set Current Food Requirements</h3>
          <div>
            <label htmlFor="req-cat" className="block text-xs font-medium text-slate-700 mb-1">
              Category
            </label>
            <select
              id="req-cat"
              value={reqCategory}
              onChange={(e) => setReqCategory(e.target.value as FoodCategory)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
            >
              <option value="Cooked Veg Curry / Meals">Cooked Veg Curry / Meals</option>
              <option value="Cooked Rice / Dal">Cooked Rice / Dal</option>
              <option value="Bakery & Bread">Bakery & Bread</option>
              <option value="Raw Produce">Raw Produce</option>
              <option value="Dairy & Sweets">Dairy & Sweets</option>
              <option value="Cooked Non-Veg">Cooked Non-Veg</option>
              <option value="Packaged / Dry Goods">Packaged / Dry Goods</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="req-kg" className="block text-xs font-medium text-slate-700 mb-1">
                Needed (kg)
              </label>
              <input
                id="req-kg"
                type="number"
                min={1}
                value={reqKg}
                onChange={(e) => setReqKg(Number(e.target.value))}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="req-urg" className="block text-xs font-medium text-slate-700 mb-1">
                Urgency
              </label>
              <select
                id="req-urg"
                value={reqUrgency}
                onChange={(e) => setReqUrgency(e.target.value as UrgencyLevel)}
                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
              >
                <option value="Critical">Critical</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Normal">Normal</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="req-notes" className="block text-xs font-medium text-slate-700 mb-1">
              Notes
            </label>
            <input
              id="req-notes"
              type="text"
              value={reqNotes}
              onChange={(e) => setReqNotes(e.target.value)}
              className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Requirement
          </button>
        </form>

        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-3">
            Active Shortage Requests ({myRequirements.length})
          </h3>
          {myRequirements.length === 0 ? (
            <p className="text-xs text-slate-500">No active requirements logged.</p>
          ) : (
            <div className="space-y-2">
              {myRequirements.map((r) => (
                <div
                  key={r.id}
                  className="p-3 rounded-lg bg-[#F8FAF9] border border-slate-200 flex items-center justify-between text-xs"
                >
                  <div>
                    <p className="font-semibold text-slate-900">{r.category}</p>
                    <p className="text-slate-600">{r.notes}</p>
                  </div>
                  <div className="text-right font-mono">
                    <p className="font-bold text-emerald-800">{r.neededKg} kg</p>
                    <p className="text-[11px] text-amber-800">{r.urgency}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
