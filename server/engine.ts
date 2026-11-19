import crypto from 'node:crypto';
import type {
  AppSettings,
  CertificatePayload,
  Donation,
  DonationStatus,
  FoodCategory,
  FoodSafetyRuleRow,
  GeoPoint,
  MatchCandidate,
  NgoProfile,
  NgoRequirement,
  Pickup,
  RuleFlag,
  StorageMethod,
  UrgencyLevel,
} from '../src/shared/types';

export const SAFETY_DISCLAIMER =
  'AI-assisted screening only. This does not certify food as safe. Donors and recipients must follow applicable FSSAI and local food-safety guidance. Human approval is required.';

export const IMPACT_FOOTER_DISCLAIMER =
  'Measured values come from completed donations in this system. Estimates use the assumptions shown. Projections are not achieved results.';

// Strict Lifecycle State Machine
export const ALLOWED_TRANSITIONS: Record<DonationStatus, DonationStatus[]> = {
  Draft: ['Pending Review', 'Cancelled'],
  'Pending Review': ['Approved', 'Rejected', 'Cancelled', 'Expired'],
  Approved: ['Matching', 'Awaiting NGO Acceptance', 'Cancelled', 'Expired'],
  Matching: ['Awaiting NGO Acceptance', 'Cancelled', 'Expired'],
  'Awaiting NGO Acceptance': ['Accepted', 'Escalated', 'Cancelled', 'Expired'],
  Escalated: ['Awaiting NGO Acceptance', 'Cancelled', 'Expired'],
  Accepted: ['Pickup Scheduled', 'Cancelled', 'Expired'],
  'Pickup Scheduled': ['In Transit', 'Cancelled', 'Expired'],
  'In Transit': ['Delivered', 'Cancelled', 'Expired'],
  Delivered: ['Completed', 'Expired'],
  Completed: [],
  Rejected: [],
  Cancelled: [],
  Expired: [],
};

export function canTransition(from: DonationStatus, to: DonationStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}

export function assertTransition(from: DonationStatus, to: DonationStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal lifecycle transition from "${from}" to "${to}".`);
  }
}

export function haversineDistanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return Math.round(R * c * 100) / 100;
}

export function estimateTravelMinutes(distanceKm: number): number {
  // Average urban courier speed ~20 km/h + 6 min pickup buffer
  return Math.max(8, Math.round((distanceKm / 20) * 60 + 6));
}

export function computeSafeUntil(
  preparedAtIso: string,
  category: FoodCategory,
  storageMethod: StorageMethod,
  rules: FoodSafetyRuleRow[]
): string {
  const rule = rules.find((r) => r.category === category);
  let hours = 3;
  if (rule) {
    if (storageMethod === 'Ambient') hours = rule.ambientHours;
    else if (storageMethod === 'Hot Held') hours = rule.hotHeldHours;
    else if (storageMethod === 'Refrigerated') hours = rule.refrigeratedHours;
    else if (storageMethod === 'Frozen') hours = rule.frozenHours;
  }
  const baseMs = new Date(preparedAtIso).getTime();
  return new Date(baseMs + hours * 3600 * 1000).toISOString();
}

export function computeUrgency(
  safeUntilIso: string,
  nowMs: number,
  thresholds: { criticalMax: number; highMax: number; mediumMax: number }
): UrgencyLevel {
  const minsLeft = (new Date(safeUntilIso).getTime() - nowMs) / 60000;
  if (minsLeft <= thresholds.criticalMax) return 'Critical';
  if (minsLeft <= thresholds.highMax) return 'High';
  if (minsLeft <= thresholds.mediumMax) return 'Medium';
  return 'Normal';
}

export function runRuleBasedSafetyChecks(
  input: {
    preparedAt: string;
    category: FoodCategory;
    storageMethod: StorageMethod;
    temperatureC?: number;
    allergens: string[];
    quantityKg: number;
    photos: string[];
    donorAverageKg: number;
  },
  rules: FoodSafetyRuleRow[],
  nowMs: number = Date.now()
): { safeUntil: string; flags: RuleFlag[] } {
  const flags: RuleFlag[] = [];
  const rule = rules.find((r) => r.category === input.category);

  if (!input.preparedAt || Number.isNaN(new Date(input.preparedAt).getTime())) {
    flags.push({
      code: 'MISSING_PREP_TIME',
      severity: 'critical',
      message: 'Preparation time is missing or invalid.',
    });
  }

  const safeUntil = computeSafeUntil(
    input.preparedAt || new Date(nowMs).toISOString(),
    input.category,
    input.storageMethod,
    rules
  );

  if (new Date(safeUntil).getTime() <= nowMs) {
    flags.push({
      code: 'WINDOW_EXPIRED',
      severity: 'critical',
      message: 'Computed Safe Until deadline has already passed.',
    });
  } else if (new Date(safeUntil).getTime() - nowMs <= 60 * 60 * 1000) {
    flags.push({
      code: 'CRITICAL_WINDOW',
      severity: 'warning',
      message: 'Less than 60 minutes remaining before Safe Until limit.',
    });
  }

  if (typeof input.temperatureC === 'number' && rule) {
    if (input.storageMethod === 'Hot Held' && rule.hotMinTempC && input.temperatureC < rule.hotMinTempC) {
      flags.push({
        code: 'TEMP_BELOW_HOT_HOLD',
        severity: 'critical',
        message: `Hot-held temperature (${input.temperatureC}°C) is below prototype threshold (${rule.hotMinTempC}°C).`,
      });
    }
    if (
      (input.storageMethod === 'Refrigerated' || input.storageMethod === 'Frozen') &&
      rule.coldMaxTempC &&
      input.temperatureC > rule.coldMaxTempC
    ) {
      flags.push({
        code: 'TEMP_ABOVE_COLD_LIMIT',
        severity: 'critical',
        message: `Cold storage temperature (${input.temperatureC}°C) exceeds prototype threshold (${rule.coldMaxTempC}°C).`,
      });
    }
  }

  if (!input.allergens || input.allergens.length === 0) {
    flags.push({
      code: 'MISSING_ALLERGENS',
      severity: 'warning',
      message: 'No allergens declared (specify "None declared" or select applicable allergens).',
    });
  }

  if (input.donorAverageKg > 0 && input.quantityKg >= input.donorAverageKg * 5) {
    flags.push({
      code: 'QUANTITY_ANOMALY',
      severity: 'warning',
      message: `Quantity (${input.quantityKg} kg) is over 5× donor historical average (${input.donorAverageKg.toFixed(1)} kg).`,
    });
  }

  const isCooked = input.category.startsWith('Cooked');
  if (isCooked && (!input.photos || input.photos.length === 0)) {
    flags.push({
      code: 'COOKED_PHOTO_MISSING',
      severity: 'warning',
      message: 'Photo is strongly recommended for cooked surplus food review.',
    });
  }

  return { safeUntil, flags };
}

export function isNgoOpenAtArrival(ngo: NgoProfile, arrivalMs: number): boolean {
  const d = new Date(arrivalMs);
  const hour = d.getHours();
  const { openHour, closeHour } = ngo.operatingHours;
  if (openHour <= closeHour) {
    return hour >= openHour && hour <= closeHour;
  }
  return hour >= openHour || hour <= closeHour;
}

export function matchNgosForDonation(
  donation: Donation,
  ngos: NgoProfile[],
  requirements: NgoRequirement[],
  settings: AppSettings,
  nowMs: number = Date.now()
): {
  weights: { urgency: number; proximity: number; capacity: number };
  candidates: MatchCandidate[];
} {
  const weights = { urgency: 0.5, proximity: 0.3, capacity: 0.2 };
  const safeUntilMs = new Date(donation.safeUntil).getTime();

  const candidates: MatchCandidate[] = ngos.map((ngo) => {
    const excludedReasons: string[] = [];
    const warnings: string[] = [];

    // 1. Verification filter
    const verificationOk =
      ngo.verificationStatus === 'Verified' ||
      (settings.allowPendingNgosForDemo && ngo.verificationStatus === 'Pending');
    if (!verificationOk) {
      excludedReasons.push(`Verification status is ${ngo.verificationStatus} (Verified required)`);
    }

    // 2. Dietary rules filter
    if (donation.dietaryType === 'Non-veg' && !ngo.dietaryRules.allowsNonVeg) {
      excludedReasons.push('Dietary mismatch: Veg-only kitchen cannot receive Non-veg food');
    }
    if (donation.dietaryType === 'Contains egg' && !ngo.dietaryRules.allowsEgg) {
      excludedReasons.push('Dietary mismatch: Kitchen does not accept egg-containing food');
    }

    // 3. Allergen and serving-group compatibility
    const hasNuts = donation.allergens.some((a) =>
      ['Peanuts', 'Tree Nuts', 'Nuts'].includes(a)
    );
    if (hasNuts && ngo.servedGroups.includes('children') && ngo.servedGroups.length === 1) {
      excludedReasons.push('Allergen safety: Nut-containing donation excluded for child-only kitchen');
    } else if (hasNuts && ngo.servedGroups.includes('children')) {
      warnings.push('Contains nuts — verify allergen segregation for children served');
    }

    // 4. Availability & Operating hours
    const distanceKm = haversineDistanceKm(donation.location, ngo.location);
    const estimatedTravelMins = estimateTravelMinutes(distanceKm);
    const estimatedArrivalMs = nowMs + (estimatedTravelMins + 15) * 60 * 1000;

    if (!ngo.isAvailable) {
      excludedReasons.push('Kitchen currently marked unavailable');
    } else if (!isNgoOpenAtArrival(ngo, estimatedArrivalMs)) {
      excludedReasons.push(
        `Outside operating hours (${ngo.operatingHours.openHour}:00–${ngo.operatingHours.closeHour}:00) at estimated arrival`
      );
    }

    // 5. Storage capacity
    const needsCold =
      donation.storageMethod === 'Refrigerated' || donation.storageMethod === 'Frozen';
    const remainingCold = Math.max(0, ngo.storageCapacityKg.cold - ngo.currentUsedKg.cold);
    const remainingAmbient = Math.max(0, ngo.storageCapacityKg.ambient - ngo.currentUsedKg.ambient);
    const relevantRemaining = needsCold ? remainingCold : remainingAmbient;

    if (relevantRemaining < donation.quantityKg) {
      excludedReasons.push(
        `Insufficient ${needsCold ? 'cold' : 'ambient'} storage (${relevantRemaining.toFixed(1)} kg free vs ${donation.quantityKg} kg offered)`
      );
    }

    // 6. Safe Until arrival deadline
    if (estimatedArrivalMs > safeUntilMs) {
      excludedReasons.push(
        `Estimated arrival (${estimatedTravelMins + 15} mins) exceeds Safe Until deadline`
      );
    }

    const eligible = excludedReasons.length === 0;

    // Step 2: Deterministic Scoring
    const matchingReq = requirements.find(
      (r) => r.ngoId === ngo.id && r.category === donation.category
    );
    const totalNgoReqKg = requirements
      .filter((r) => r.ngoId === ngo.id)
      .reduce((acc, r) => acc + r.neededKg, 0);

    const unmetRequirementKg = matchingReq ? matchingReq.neededKg : 0;

    // U: Urgency & Need Suitability (0 - 100)
    let urgencyScore = 0;
    if (matchingReq) {
      urgencyScore += 35;
      const fitRatio = Math.min(1, donation.quantityKg / Math.max(1, matchingReq.neededKg));
      urgencyScore += Math.round(fitRatio * 25);
      if (matchingReq.urgency === 'Critical') urgencyScore += 18;
      else if (matchingReq.urgency === 'High') urgencyScore += 14;
      else if (matchingReq.urgency === 'Medium') urgencyScore += 10;
      else urgencyScore += 6;
    } else if (totalNgoReqKg > 0) {
      urgencyScore += 25;
    } else {
      urgencyScore += 12;
    }
    // People served & donation urgency boost
    const peopleFactor = Math.min(12, Math.round((ngo.peopleServed / 400) * 12));
    const donationUrgencyBoost =
      donation.urgency === 'Critical'
        ? 10
        : donation.urgency === 'High'
        ? 8
        : donation.urgency === 'Medium'
        ? 5
        : 3;
    urgencyScore = Math.min(100, urgencyScore + peopleFactor + donationUrgencyBoost);

    // D: Proximity (0 - 100)
    const proximityScore = Math.max(0, Math.min(100, Math.round(100 - distanceKm * 6.5)));

    // C: Capacity & Availability (0 - 100)
    const headroomRatio =
      relevantRemaining > 0
        ? Math.min(1, (relevantRemaining - donation.quantityKg) / Math.max(20, relevantRemaining))
        : 0;
    const headroomPoints = Math.round(headroomRatio * 30);
    const vehiclePoints = ngo.hasVehicle ? 20 : 8;
    const trustPoints = Math.round((ngo.trustScore / 100) * 35);
    const responsePoints = Math.max(0, Math.min(15, Math.round(15 - ngo.avgResponseMinutes * 0.5)));
    const capacityScore = Math.min(100, headroomPoints + vehiclePoints + trustPoints + responsePoints);

    const matchScore = eligible
      ? Math.round((0.5 * urgencyScore + 0.3 * proximityScore + 0.2 * capacityScore) * 10) / 10
      : 0;

    return {
      ngoId: ngo.id,
      ngoName: ngo.organizationName,
      eligible,
      excludedReasons,
      matchScore,
      urgencyScore,
      proximityScore,
      capacityScore,
      distanceKm,
      estimatedTravelMins,
      trustScore: ngo.trustScore,
      hasVehicle: ngo.hasVehicle,
      servedGroups: ngo.servedGroups,
      unmetRequirementKg,
      warnings,
    };
  });

  candidates.sort((a, b) => {
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    return b.matchScore - a.matchScore;
  });

  return { weights, candidates };
}

export function computeNgoTrustScore(ngo: {
  completedPickups: number;
  totalAssignedPickups: number;
  avgResponseMinutes: number;
  avgDonorRating: number;
}): number {
  const completionRate =
    ngo.totalAssignedPickups > 0
      ? Math.min(1, ngo.completedPickups / ngo.totalAssignedPickups)
      : 0.85;
  const responseFactor = Math.max(0, Math.min(1, 1 - ngo.avgResponseMinutes / 30));
  const ratingFactor = Math.max(0, Math.min(1, (ngo.avgDonorRating || 4.2) / 5));

  const score = Math.round(completionRate * 45 + responseFactor * 25 + ratingFactor * 30);
  return Math.max(0, Math.min(100, score));
}

export function hashOtp(otp: string): string {
  return crypto.createHash('sha256').update(otp).digest('hex');
}

export function getSigningSecret(): string {
  return process.env.CERTIFICATE_SIGNING_SECRET || 'foodbridge-sih26234-hmac-secret-key';
}

export function canonicalizeCertificatePayload(payload: CertificatePayload): string {
  return JSON.stringify({
    certificateId: payload.certificateId,
    donationId: payload.donationId,
    donorName: payload.donorName,
    ngoName: payload.ngoName,
    title: payload.title,
    category: payload.category,
    dietaryType: payload.dietaryType,
    portions: payload.portions,
    quantityKg: payload.quantityKg,
    preparedAt: payload.preparedAt,
    safeUntil: payload.safeUntil,
    handoverAt: payload.handoverAt,
    handoverMethod: payload.handoverMethod,
    safetySummary: payload.safetySummary,
    issuedAt: payload.issuedAt,
  });
}

export function signCertificatePayload(payload: CertificatePayload, secret = getSigningSecret()): string {
  return crypto
    .createHmac('sha256', secret)
    .update(canonicalizeCertificatePayload(payload))
    .digest('hex');
}

export function verifyCertificateSignature(
  payload: CertificatePayload,
  signature: string,
  secret = getSigningSecret()
): boolean {
  const expected = signCertificatePayload(payload, secret);
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
}

export interface GroupedRouteSuggestion {
  pickupIds: string[];
  stops: Array<{
    pickupId: string;
    donationId: string;
    type: 'pickup' | 'dropoff';
    label: string;
    location: GeoPoint;
    legDistanceKm: number;
  }>;
  totalDistanceKm: number;
  estimatedTotalMins: number;
}

export function computeGroupedPickupRoute(
  openPickups: Pickup[],
  startLocation: { lat: number; lng: number },
  radiusKm: number,
  nowMs: number = Date.now()
): GroupedRouteSuggestion | null {
  if (openPickups.length < 2) return null;

  // Find a pair of open pickups whose pickup points are within radiusKm and both have >= 60 mins left
  const viable = openPickups.filter(
    (p) => p.status === 'Open' && new Date(p.safeUntil).getTime() - nowMs > 45 * 60 * 1000
  );
  if (viable.length < 2) return null;

  let bestPair: [Pickup, Pickup] | null = null;
  let bestPairDist = Infinity;

  for (let i = 0; i < viable.length; i++) {
    for (let j = i + 1; j < viable.length; j++) {
      const dist = haversineDistanceKm(viable[i].pickupLocation, viable[j].pickupLocation);
      if (dist <= radiusKm && dist < bestPairDist) {
        bestPairDist = dist;
        bestPair = [viable[i], viable[j]];
      }
    }
  }

  if (!bestPair) return null;

  // Nearest-neighbour ordering: start -> closer pickup -> second pickup -> closer dropoff -> second dropoff
  const [p1, p2] = bestPair;
  const d1 = haversineDistanceKm(startLocation, p1.pickupLocation);
  const d2 = haversineDistanceKm(startLocation, p2.pickupLocation);
  const first = d1 <= d2 ? p1 : p2;
  const second = d1 <= d2 ? p2 : p1;

  const stops: GroupedRouteSuggestion['stops'] = [];
  let cursor: { lat: number; lng: number } = startLocation;

  const addStop = (pickup: Pickup, type: 'pickup' | 'dropoff', loc: GeoPoint, label: string) => {
    const legDistanceKm = haversineDistanceKm(cursor, loc);
    stops.push({ pickupId: pickup.id, donationId: pickup.donationId, type, label, location: loc, legDistanceKm });
    cursor = loc;
  };

  addStop(first, 'pickup', first.pickupLocation, `Pickup #1: ${first.pickupLocation.area}`);
  addStop(second, 'pickup', second.pickupLocation, `Pickup #2: ${second.pickupLocation.area}`);

  const dropDist1 = haversineDistanceKm(cursor, first.dropoffLocation);
  const dropDist2 = haversineDistanceKm(cursor, second.dropoffLocation);
  if (dropDist1 <= dropDist2) {
    addStop(first, 'dropoff', first.dropoffLocation, `Deliver #1: ${first.dropoffLocation.area}`);
    addStop(second, 'dropoff', second.dropoffLocation, `Deliver #2: ${second.dropoffLocation.area}`);
  } else {
    addStop(second, 'dropoff', second.dropoffLocation, `Deliver #1: ${second.dropoffLocation.area}`);
    addStop(first, 'dropoff', first.dropoffLocation, `Deliver #2: ${first.dropoffLocation.area}`);
  }

  const totalDistanceKm = Math.round(stops.reduce((s, st) => s + st.legDistanceKm, 0) * 100) / 100;
  const estimatedTotalMins = Math.round((totalDistanceKm / 20) * 60 + stops.length * 6);

  return {
    pickupIds: [first.id, second.id],
    stops,
    totalDistanceKm,
    estimatedTotalMins,
  };
}

export interface ForecastBaseline {
  isPreliminary: boolean;
  sampleSize: number;
  byWeekday: Array<{ day: string; avgSurplusKg: number; expectedDonations: number }>;
  peakHours: Array<{ window: string; count: number; sharePct: number }>;
  topCategories: Array<{ category: FoodCategory; totalKg: number; wastedKg: number }>;
  shortageCategories: Array<{ category: FoodCategory; unmetDemandKg: number }>;
}

export function computeForecastBaseline(
  donations: Donation[],
  requirements: NgoRequirement[]
): ForecastBaseline {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayBuckets = days.map((day) => ({ day, totalKg: 0, count: 0 }));

  const hourWindows = [
    { window: '08:00–12:00', min: 8, max: 12, count: 0 },
    { window: '12:00–16:00', min: 12, max: 16, count: 0 },
    { window: '16:00–20:00', min: 16, max: 20, count: 0 },
    { window: '20:00–24:00', min: 20, max: 24, count: 0 },
  ];

  const categoryTotals = new Map<FoodCategory, { totalKg: number; wastedKg: number }>();

  for (const d of donations) {
    const dt = new Date(d.created_at);
    const wd = dt.getDay();
    dayBuckets[wd].totalKg += d.quantityKg;
    dayBuckets[wd].count += 1;

    const hr = dt.getHours();
    const hw = hourWindows.find((w) => hr >= w.min && hr < w.max) ?? hourWindows[3];
    hw.count += 1;

    const prev = categoryTotals.get(d.category) ?? { totalKg: 0, wastedKg: 0 };
    prev.totalKg += d.quantityKg;
    if (d.status === 'Expired' || d.status === 'Rejected') {
      prev.wastedKg += d.quantityKg;
    }
    categoryTotals.set(d.category, prev);
  }

  const weeksObserved = Math.max(1, Math.ceil(donations.length / 10));
  const byWeekday = dayBuckets.map((b) => ({
    day: b.day,
    avgSurplusKg: Math.round((b.totalKg / weeksObserved) * 10) / 10,
    expectedDonations: Math.round((b.count / weeksObserved) * 10) / 10,
  }));

  const totalD = Math.max(1, donations.length);
  const peakHours = hourWindows.map((w) => ({
    window: w.window,
    count: w.count,
    sharePct: Math.round((w.count / totalD) * 100),
  }));

  const topCategories = Array.from(categoryTotals.entries())
    .map(([category, vals]) => ({
      category,
      totalKg: Math.round(vals.totalKg * 10) / 10,
      wastedKg: Math.round(vals.wastedKg * 10) / 10,
    }))
    .sort((a, b) => b.totalKg - a.totalKg);

  const reqTotals = new Map<FoodCategory, number>();
  for (const r of requirements) {
    reqTotals.set(r.category, (reqTotals.get(r.category) ?? 0) + r.neededKg);
  }
  const shortageCategories = Array.from(reqTotals.entries())
    .map(([category, unmetDemandKg]) => ({
      category,
      unmetDemandKg: Math.round(unmetDemandKg * 10) / 10,
    }))
    .sort((a, b) => b.unmetDemandKg - a.unmetDemandKg);

  return {
    isPreliminary: donations.length < 30,
    sampleSize: donations.length,
    byWeekday,
    peakHours,
    topCategories,
    shortageCategories,
  };
}
