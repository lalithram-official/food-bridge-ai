import { useState } from 'react';
import { Award, CheckSquare, MapPin, Navigation, Truck } from 'lucide-react';
import type { Donation, VolunteerProfile } from '../shared/types';
import { apiFetch, formatTimeRemaining, type WorkspaceState } from '../utils/api';
import type { Language } from '../i18n/translations';
import { tr } from '../i18n/translations';
import { LogisticsMap } from './LogisticsMap';

interface VolunteerDashboardProps {
  state: WorkspaceState;
  lang: Language;
  lowDataMode: boolean;
  onRefresh: () => Promise<void>;
  onSelectDonation: (d: Donation) => void;
  onToast: (msg: string, type?: 'success' | 'error') => void;
}

export function VolunteerDashboard({
  state,
  lang,
  lowDataMode,
  onRefresh,
  onSelectDonation,
  onToast,
}: VolunteerDashboardProps) {
  const vol = state.profile as VolunteerProfile | null;
  const [maxRadiusKm, setMaxRadiusKm] = useState(12);
  const [checklistPickupId, setChecklistPickupId] = useState<string | null>(null);
  const [foodSealed, setFoodSealed] = useState(true);
  const [labeledWithTime, setLabeledWithTime] = useState(true);
  const [tempMaintained, setTempMaintained] = useState(true);
  const [photoCaptured, setPhotoCaptured] = useState(true);
  const [otpEntry, setOtpEntry] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const openPickups = state.pickups.filter(
    (p) => p.status === 'Open' && p.distanceKm <= maxRadiusKm
  );
  const myActivePickups = state.pickups.filter(
    (p) => p.volunteerId === vol?.id && ['Claimed', 'In Transit'].includes(p.status)
  );

  const toggleAvailability = async () => {
    if (!vol) return;
    setBusy(true);
    try {
      await apiFetch('/api/volunteers/availability', {
        method: 'PATCH',
        body: JSON.stringify({ isAvailable: !vol.isAvailable }),
      });
      await onRefresh();
      onToast(!vol.isAvailable ? 'Marked Available for pickups' : 'Marked Offline');
    } catch (err) {
      onToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleClaim = async (pickupId: string) => {
    setBusy(true);
    try {
      await apiFetch(`/api/pickups/${pickupId}/claim`, { method: 'POST' });
      await onRefresh();
      onToast('Pickup task claimed! Complete the Safety Checklist at pickup.');
    } catch (err) {
      onToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCompleteChecklist = async (pickupId: string) => {
    setBusy(true);
    try {
      await apiFetch(`/api/pickups/${pickupId}/checklist`, {
        method: 'POST',
        body: JSON.stringify({
          foodSealed,
          labeledWithTime,
          tempMaintained,
          photoCaptured,
        }),
      });
      setChecklistPickupId(null);
      await onRefresh();
      onToast('Safety checklist passed — status updated to In Transit!');
    } catch (err) {
      onToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleDeliverWithOtp = async (donationId: string) => {
    const val = (otpEntry[donationId] || '').trim();
    if (!val) {
      onToast('Enter the 6-digit OTP shown by the NGO', 'error');
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/api/deliveries/${donationId}/verify-otp`, {
        method: 'POST',
        body: JSON.stringify(val.startsWith('FB-QR-') ? { qrToken: val } : { otp: val }),
      });
      await onRefresh();
      onToast('Handover verified — Delivered!');
    } catch (err) {
      onToast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Volunteer Profile & Availability Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white border border-slate-200 rounded-xl flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">Courier Status ({vol?.vehicleType})</p>
            <p className="text-base font-bold text-slate-900 mt-0.5">
              {vol?.isAvailable ? 'Available' : 'Offline'}
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={toggleAvailability}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap shrink-0 ${
              vol?.isAvailable
                ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                : 'bg-slate-200 text-slate-800 hover:bg-slate-300'
            }`}
          >
            {vol?.isAvailable ? 'Go Offline' : 'Go Online'}
          </button>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs text-slate-500">Pickups Completed</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-emerald-800 mt-1">
            {vol?.tasksCompleted ?? 0}
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs text-slate-500">Meals Moved</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {vol?.mealsMoved ?? 0}
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs text-slate-500">Badges Earned</p>
          <div className="flex flex-wrap gap-1.5 mt-1 text-xs font-semibold text-emerald-800">
            <Award className="w-4 h-4 shrink-0" />
            <span>{(vol?.badges ?? []).join(' · ')}</span>
          </div>
        </div>
      </div>

      {/* Grouped Route Suggestion */}
      {state.groupedRoute && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Navigation className="w-4 h-4 text-emerald-800" />
              <h2 className="text-sm font-bold text-emerald-950">
                Grouped Route Suggestion (Nearest-Neighbour Optimization)
              </h2>
            </div>
            <span className="text-xs font-mono font-semibold text-emerald-900">
              {state.groupedRoute.totalDistanceKm} km total · ~{state.groupedRoute.estimatedTotalMins} mins
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            {state.groupedRoute.stops.map((st, idx) => (
              <div key={idx} className="p-2.5 bg-white border border-emerald-200 rounded-lg text-xs">
                <p className="font-mono text-[11px] text-emerald-700 font-semibold">
                  Stop {idx + 1} · {st.legDistanceKm} km
                </p>
                <p className="font-semibold text-slate-900">{st.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Map */}
      <LogisticsMap
        pickups={[...myActivePickups, ...openPickups]}
        groupedStops={state.groupedRoute?.stops}
        lowDataMode={lowDataMode}
      />

      {/* Active Assigned Pickups */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <h2 className="text-base font-bold text-slate-900">
          Your Active Pickups ({myActivePickups.length})
        </h2>
        {myActivePickups.length === 0 ? (
          <p className="text-xs text-slate-500">Claim an open task below to begin a pickup.</p>
        ) : (
          <div className="space-y-3">
            {myActivePickups.map((pk) => {
              const don = state.donations.find((d) => d.id === pk.donationId);
              if (!don) return null;
              return (
                <div key={pk.id} className="p-4 rounded-xl border border-slate-200 bg-[#F8FAF9] space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-mono text-slate-500">
                        {pk.status} · Safe Until: {formatTimeRemaining(pk.safeUntil, Date.now())}
                      </p>
                      <h3 className="text-sm font-bold text-slate-900">{don.title}</h3>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Pickup: {pk.pickupLocation.address} → Dropoff: {pk.dropoffLocation.address} (
                        {pk.distanceKm} km, ~{pk.etaMins} mins)
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onSelectDonation(don)}
                      className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-md cursor-pointer"
                    >
                      View Passport
                    </button>
                  </div>

                  {pk.status === 'Claimed' && checklistPickupId !== pk.id && (
                    <button
                      type="button"
                      onClick={() => setChecklistPickupId(pk.id)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 cursor-pointer"
                    >
                      <CheckSquare className="w-3.5 h-3.5" />
                      Complete Pickup Safety Checklist → {tr(lang, 'markInTransit')}
                    </button>
                  )}

                  {checklistPickupId === pk.id && (
                    <div className="p-3 bg-white border border-emerald-200 rounded-lg space-y-2 text-xs">
                      <p className="font-bold text-slate-900">Pickup Safety Checklist (All 4 Required)</p>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={foodSealed}
                          onChange={(e) => setFoodSealed(e.target.checked)}
                        />
                        Containers sealed & tamper-free
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={labeledWithTime}
                          onChange={(e) => setLabeledWithTime(e.target.checked)}
                        />
                        Labeled with preparation & Safe Until time
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={tempMaintained}
                          onChange={(e) => setTempMaintained(e.target.checked)}
                        />
                        Hot/cold holding condition maintained
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={photoCaptured}
                          onChange={(e) => setPhotoCaptured(e.target.checked)}
                        />
                        Pickup condition photo captured
                      </label>
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleCompleteChecklist(pk.id)}
                          className="px-4 py-1.5 font-semibold text-white bg-emerald-700 rounded-md hover:bg-emerald-800 cursor-pointer"
                        >
                          Confirm & Start Transit
                        </button>
                        <button
                          type="button"
                          onClick={() => setChecklistPickupId(null)}
                          className="px-3 py-1.5 text-slate-700 border border-slate-300 rounded-md cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {pk.status === 'In Transit' && (
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200">
                      <input
                        type="text"
                        value={otpEntry[don.id] || ''}
                        onChange={(e) =>
                          setOtpEntry((prev) => ({ ...prev, [don.id]: e.target.value }))
                        }
                        placeholder="Enter 6-digit OTP from NGO"
                        className="px-3 py-1.5 text-xs font-mono border border-slate-300 rounded-lg bg-white"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleDeliverWithOtp(don.id)}
                        className="px-4 py-1.5 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 cursor-pointer"
                      >
                        Verify Handover & Mark Delivered
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Open Pickup Tasks */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Open Pickup Tasks ({openPickups.length})
            </h2>
            <p className="text-xs text-slate-500">
              First valid claim wins; concurrent claims are blocked atomically.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <label htmlFor="vol-radius" className="text-slate-600">
              Radius:
            </label>
            <select
              id="vol-radius"
              value={maxRadiusKm}
              onChange={(e) => setMaxRadiusKm(Number(e.target.value))}
              className="px-2.5 py-1.5 border border-slate-300 rounded-lg"
            >
              <option value={5}>Within 5 km</option>
              <option value={12}>Within 12 km</option>
              <option value={30}>All Bengaluru</option>
            </select>
          </div>
        </div>

        {openPickups.length === 0 ? (
          <p className="text-xs text-slate-500 py-3">No open pickup tasks within {maxRadiusKm} km.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {openPickups.map((pk) => {
              const don = state.donations.find((d) => d.id === pk.donationId);
              if (!don) return null;
              return (
                <div
                  key={pk.id}
                  className="p-4 rounded-xl border border-slate-200 flex flex-col justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                      <span className="font-mono">{pk.distanceKm} km · ~{pk.etaMins} mins</span>
                      <span className="font-mono font-semibold text-amber-800">
                        Safe Until: {formatTimeRemaining(pk.safeUntil, Date.now())}
                      </span>
                    </div>
                    <h3 className="text-sm font-bold text-slate-900">{don.title}</h3>
                    <p className="text-xs text-slate-600 mt-1 flex items-start gap-1">
                      <MapPin className="w-3.5 h-3.5 text-emerald-700 shrink-0 mt-0.5" />
                      <span>
                        {pk.pickupLocation.area} → {pk.dropoffLocation.area} ({don.quantityKg} kg)
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleClaim(pk.id)}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 cursor-pointer"
                    >
                      <Truck className="w-3.5 h-3.5" />
                      {tr(lang, 'claim')}
                    </button>
                    <button
                      type="button"
                      onClick={() => onSelectDonation(don)}
                      className="px-3 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                    >
                      Details
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
