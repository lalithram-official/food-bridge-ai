import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertTransition,
  canTransition,
  computeGroupedPickupRoute,
  computeNgoTrustScore,
  computeUrgency,
  haversineDistanceKm,
  matchNgosForDonation,
  runRuleBasedSafetyChecks,
  signCertificatePayload,
  verifyCertificateSignature,
} from './engine';
import type {
  AppSettings,
  CertificatePayload,
  Donation,
  NgoProfile,
  NgoRequirement,
  Pickup,
} from '../src/shared/types';

const defaultSettings: AppSettings = {
  id: 'global',
  escalationTimeoutSeconds: 600,
  fastForwardTimers: false,
  volunteerClaimTimeoutSeconds: 300,
  allowPendingNgosForDemo: false,
  demoAiMode: false,
  groupedPickupRadiusKm: 3.5,
  urgencyThresholdsMinutes: { criticalMax: 60, highMax: 120, mediumMax: 240 },
  assumptions: { kgPerMeal: 0.4, co2eKgPerKgFood: 2.5 },
  foodSafetyRules: [
    {
      category: 'Cooked Veg Curry / Meals',
      ambientHours: 2,
      hotHeldHours: 4,
      refrigeratedHours: 24,
      frozenHours: 72,
      hotMinTempC: 60,
      coldMaxTempC: 5,
      photoRecommended: true,
    },
  ],
  updated_at: new Date().toISOString(),
};

test('Lifecycle state machine allows valid transitions and blocks illegal ones', () => {
  assert.equal(canTransition('Pending Review', 'Approved'), true);
  assert.equal(canTransition('Awaiting NGO Acceptance', 'Accepted'), true);
  assert.equal(canTransition('Draft', 'Completed'), false);
  assert.equal(canTransition('Rejected', 'Accepted'), false);
  assert.throws(() => assertTransition('Delivered', 'Pending Review'), /Illegal lifecycle transition/);
});

test('Safe Until rule checks flag expired window, temperature breach, and missing allergens', () => {
  const nowMs = Date.UTC(2026, 10, 18, 12, 0, 0);
  const preparedAt = new Date(nowMs - 30 * 60 * 1000).toISOString();
  const res = runRuleBasedSafetyChecks(
    {
      preparedAt,
      category: 'Cooked Veg Curry / Meals',
      storageMethod: 'Hot Held',
      temperatureC: 48, // below 60C hot hold limit
      allergens: [],
      quantityKg: 60,
      photos: [],
      donorAverageKg: 10,
    },
    defaultSettings.foodSafetyRules,
    nowMs
  );

  const codes = res.flags.map((f) => f.code);
  assert.ok(codes.includes('TEMP_BELOW_HOT_HOLD'));
  assert.ok(codes.includes('MISSING_ALLERGENS'));
  assert.ok(codes.includes('QUANTITY_ANOMALY'));
  assert.ok(codes.includes('COOKED_PHOTO_MISSING'));
  assert.equal(computeUrgency(res.safeUntil, nowMs, defaultSettings.urgencyThresholdsMinutes), 'Medium');
});

test('Deterministic Matching Engine filters ineligible NGOs and computes exact weighted score', () => {
  const nowMs = Date.UTC(2026, 10, 18, 12, 0, 0);
  const donation: Donation = {
    id: 'don_test',
    donorId: 'd1',
    donorName: 'Test Kitchen',
    title: '25 Veg Meals',
    category: 'Cooked Veg Curry / Meals',
    dietaryType: 'Veg',
    allergens: ['Dairy'],
    portions: 25,
    quantityKg: 10,
    preparedAt: new Date(nowMs - 20 * 60000).toISOString(),
    readyBy: new Date(nowMs).toISOString(),
    pickupWindowEnd: new Date(nowMs + 120 * 60000).toISOString(),
    storageMethod: 'Hot Held',
    packaging: 'Sealed steel trays',
    photos: [],
    status: 'Approved',
    urgency: 'High',
    safeUntil: new Date(nowMs + 220 * 60000).toISOString(),
    isBulkEvent: false,
    location: { lat: 12.9716, lng: 77.5946, area: 'MG Road', address: '1 MG Road' },
    created_at: new Date(nowMs).toISOString(),
    updated_at: new Date(nowMs).toISOString(),
  };

  const ngos: NgoProfile[] = [
    {
      id: 'ngo_eligible',
      userId: 'u1',
      organizationName: 'Akshaya Shelter Kitchen',
      serviceArea: 'Indiranagar',
      peopleServed: 250,
      servedGroups: ['general'],
      operatingHours: { openHour: 6, closeHour: 23 },
      storageCapacityKg: { cold: 50, ambient: 80 },
      currentUsedKg: { cold: 10, ambient: 20 },
      hasVehicle: true,
      dietaryRules: { vegOnly: true, allowsEgg: false, allowsNonVeg: false },
      verificationStatus: 'Verified',
      trustScore: 92,
      completedPickups: 24,
      totalAssignedPickups: 25,
      avgResponseMinutes: 4,
      avgDonorRating: 4.8,
      isAvailable: true,
      location: { lat: 12.9784, lng: 77.6408, area: 'Indiranagar', address: '100 Ft Rd' },
      phone: '+91-9000000001',
      created_at: new Date(nowMs).toISOString(),
      updated_at: new Date(nowMs).toISOString(),
    },
    {
      id: 'ngo_unverified',
      userId: 'u2',
      organizationName: 'Pending Trust Center',
      serviceArea: 'Koramangala',
      peopleServed: 100,
      servedGroups: ['general'],
      operatingHours: { openHour: 6, closeHour: 23 },
      storageCapacityKg: { cold: 50, ambient: 50 },
      currentUsedKg: { cold: 0, ambient: 0 },
      hasVehicle: false,
      dietaryRules: { vegOnly: false, allowsEgg: true, allowsNonVeg: true },
      verificationStatus: 'Pending',
      trustScore: 70,
      completedPickups: 3,
      totalAssignedPickups: 4,
      avgResponseMinutes: 10,
      avgDonorRating: 4.0,
      isAvailable: true,
      location: { lat: 12.9352, lng: 77.6245, area: 'Koramangala', address: '80 Ft Rd' },
      phone: '+91-9000000002',
      created_at: new Date(nowMs).toISOString(),
      updated_at: new Date(nowMs).toISOString(),
    },
    {
      id: 'ngo_low_cap',
      userId: 'u3',
      organizationName: 'Tiny Pantry',
      serviceArea: 'Jayanagar',
      peopleServed: 50,
      servedGroups: ['elderly'],
      operatingHours: { openHour: 6, closeHour: 23 },
      storageCapacityKg: { cold: 20, ambient: 15 },
      currentUsedKg: { cold: 5, ambient: 12 }, // only 3kg ambient left < 10kg
      hasVehicle: false,
      dietaryRules: { vegOnly: true, allowsEgg: false, allowsNonVeg: false },
      verificationStatus: 'Verified',
      trustScore: 85,
      completedPickups: 10,
      totalAssignedPickups: 11,
      avgResponseMinutes: 6,
      avgDonorRating: 4.5,
      isAvailable: true,
      location: { lat: 12.925, lng: 77.5938, area: 'Jayanagar', address: '4th Block' },
      phone: '+91-9000000003',
      created_at: new Date(nowMs).toISOString(),
      updated_at: new Date(nowMs).toISOString(),
    },
  ];

  const reqs: NgoRequirement[] = [
    {
      id: 'req1',
      ngoId: 'ngo_eligible',
      category: 'Cooked Veg Curry / Meals',
      neededKg: 15,
      urgency: 'High',
      notes: 'Evening shelter meal',
      created_at: new Date(nowMs).toISOString(),
      updated_at: new Date(nowMs).toISOString(),
    },
  ];

  const result = matchNgosForDonation(donation, ngos, reqs, defaultSettings, nowMs);
  assert.equal(result.candidates[0].ngoId, 'ngo_eligible');
  assert.equal(result.candidates[0].eligible, true);
  // Check exact weighted score formula: 0.50*U + 0.30*D + 0.20*C
  const top = result.candidates[0];
  const expectedScore =
    Math.round((0.5 * top.urgencyScore + 0.3 * top.proximityScore + 0.2 * top.capacityScore) * 10) / 10;
  assert.equal(top.matchScore, expectedScore);

  const pendingNgo = result.candidates.find((c) => c.ngoId === 'ngo_unverified')!;
  assert.equal(pendingNgo.eligible, false);
  assert.ok(pendingNgo.excludedReasons[0].includes('Pending'));

  const lowCapNgo = result.candidates.find((c) => c.ngoId === 'ngo_low_cap')!;
  assert.equal(lowCapNgo.eligible, false);
  assert.ok(lowCapNgo.excludedReasons[0].includes('Insufficient ambient storage'));
});

test('HMAC-SHA256 certificate signing detects valid vs tampered payloads', () => {
  const payload: CertificatePayload = {
    certificateId: 'CERT-1001',
    donationId: 'don_1001',
    donorName: 'Annapoorna Kitchen',
    ngoName: 'Hope Shelter',
    title: '25 Veg Meals',
    category: 'Cooked Veg Curry / Meals',
    dietaryType: 'Veg',
    portions: 25,
    quantityKg: 10,
    preparedAt: '2026-11-18T10:00:00.000Z',
    safeUntil: '2026-11-18T14:00:00.000Z',
    handoverAt: '2026-11-18T12:15:00.000Z',
    handoverMethod: 'OTP',
    safetySummary: 'Hot held 68°C, sealed trays',
    issuedAt: '2026-11-18T12:16:00.000Z',
  };

  const sig = signCertificatePayload(payload, 'test-secret');
  assert.equal(verifyCertificateSignature(payload, sig, 'test-secret'), true);

  // Tamper quantityKg
  const tampered: CertificatePayload = { ...payload, quantityKg: 100 };
  assert.equal(verifyCertificateSignature(tampered, sig, 'test-secret'), false);
});

test('Grouped pickup route pairs nearby open pickups within radius', () => {
  const nowMs = Date.UTC(2026, 10, 18, 12, 0, 0);
  const safeUntil = new Date(nowMs + 180 * 60000).toISOString();
  const pickups: Pickup[] = [
    {
      id: 'pk1',
      donationId: 'd1',
      ngoId: 'n1',
      status: 'Open',
      pickupLocation: { lat: 12.9716, lng: 77.5946, area: 'MG Road', address: 'A' },
      dropoffLocation: { lat: 12.9784, lng: 77.6408, area: 'Indiranagar', address: 'B' },
      distanceKm: 5,
      etaMins: 20,
      safeUntil,
      checklistCompleted: false,
      created_at: new Date(nowMs).toISOString(),
      updated_at: new Date(nowMs).toISOString(),
    },
    {
      id: 'pk2',
      donationId: 'd2',
      ngoId: 'n2',
      status: 'Open',
      pickupLocation: { lat: 12.975, lng: 77.602, area: 'Brigade Rd', address: 'C' },
      dropoffLocation: { lat: 12.98, lng: 77.638, area: 'Indiranagar East', address: 'D' },
      distanceKm: 4,
      etaMins: 18,
      safeUntil,
      checklistCompleted: false,
      created_at: new Date(nowMs).toISOString(),
      updated_at: new Date(nowMs).toISOString(),
    },
  ];

  const grouped = computeGroupedPickupRoute(pickups, { lat: 12.97, lng: 77.59 }, 3.5, nowMs);
  assert.ok(grouped !== null);
  assert.equal(grouped!.stops.length, 4);
  assert.ok(haversineDistanceKm(pickups[0].pickupLocation, pickups[1].pickupLocation) < 3.5);
  assert.ok(computeNgoTrustScore({ completedPickups: 18, totalAssignedPickups: 20, avgResponseMinutes: 5, avgDonorRating: 4.8 }) > 80);
});
