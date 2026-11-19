import crypto from 'node:crypto';
import type {
  AiAssessment,
  AppNotification,
  AppSettings,
  AuditLogEntry,
  Certificate,
  CertificatePayload,
  DatabaseSchema,
  Delivery,
  Donation,
  DonationStatus,
  DonorProfile,
  FoodCategory,
  FoodSafetyPassport,
  ImpactRecord,
  NgoProfile,
  NgoRequirement,
  Offer,
  OutboxMessage,
  Pickup,
  Rating,
  ReportIssue,
  User,
  VolunteerProfile,
} from '../src/shared/types';
import {
  computeNgoTrustScore,
  computeSafeUntil,
  computeUrgency,
  haversineDistanceKm,
  estimateTravelMinutes,
  hashOtp,
  matchNgosForDonation,
  runRuleBasedSafetyChecks,
  SAFETY_DISCLAIMER,
  signCertificatePayload,
} from './engine';

export function demoPasswordHash(password: string): string {
  return crypto.createHash('sha256').update(`fb_salt_${password}`).digest('hex');
}

export function createSeedDatabase(): DatabaseSchema {
  const nowMs = Date.now();
  const iso = (offsetMinutes = 0) => new Date(nowMs + offsetMinutes * 60000).toISOString();

  const defaultSettings: AppSettings = {
    id: 'global',
    escalationTimeoutSeconds: 600,
    fastForwardTimers: false,
    volunteerClaimTimeoutSeconds: 300,
    allowPendingNgosForDemo: false,
    demoAiMode: false,
    groupedPickupRadiusKm: 3.5,
    urgencyThresholdsMinutes: {
      criticalMax: 60,
      highMax: 120,
      mediumMax: 240,
    },
    assumptions: {
      kgPerMeal: 0.4,
      co2eKgPerKgFood: 2.5,
    },
    foodSafetyRules: [
      {
        category: 'Cooked Rice / Dal',
        ambientHours: 2.5,
        hotHeldHours: 4,
        refrigeratedHours: 24,
        frozenHours: 72,
        hotMinTempC: 60,
        coldMaxTempC: 5,
        photoRecommended: true,
      },
      {
        category: 'Cooked Veg Curry / Meals',
        ambientHours: 3,
        hotHeldHours: 4.5,
        refrigeratedHours: 24,
        frozenHours: 72,
        hotMinTempC: 60,
        coldMaxTempC: 5,
        photoRecommended: true,
      },
      {
        category: 'Cooked Non-Veg',
        ambientHours: 1.5,
        hotHeldHours: 3,
        refrigeratedHours: 18,
        frozenHours: 48,
        hotMinTempC: 63,
        coldMaxTempC: 4,
        photoRecommended: true,
      },
      {
        category: 'Dairy & Sweets',
        ambientHours: 2,
        hotHeldHours: 2,
        refrigeratedHours: 24,
        frozenHours: 72,
        coldMaxTempC: 5,
        photoRecommended: false,
      },
      {
        category: 'Bakery & Bread',
        ambientHours: 18,
        hotHeldHours: 12,
        refrigeratedHours: 48,
        frozenHours: 168,
        photoRecommended: false,
      },
      {
        category: 'Raw Produce',
        ambientHours: 24,
        hotHeldHours: 12,
        refrigeratedHours: 72,
        frozenHours: 168,
        coldMaxTempC: 8,
        photoRecommended: false,
      },
      {
        category: 'Packaged / Dry Goods',
        ambientHours: 168,
        hotHeldHours: 72,
        refrigeratedHours: 240,
        frozenHours: 720,
        photoRecommended: false,
      },
    ],
    updated_at: iso(),
  };

  const passHash = demoPasswordHash('demo123');

  // 7 Donors across Bengaluru
  const donorSeed: Array<{
    userId: string;
    profileId: string;
    name: string;
    email: string;
    phone: string;
    org: string;
    type: DonorProfile['businessType'];
    fssai: string;
    lat: number;
    lng: number;
    area: string;
    address: string;
    avgPortions: number;
  }> = [
    {
      userId: 'usr_donor_1',
      profileId: 'don_prof_1',
      name: 'Rajesh Sharma',
      email: 'donor@foodbridge.demo',
      phone: '+91-98450-11223',
      org: 'Annapoorna Grand Kitchen',
      type: 'Restaurant',
      fssai: '11223344000512',
      lat: 12.9746,
      lng: 77.6062,
      area: 'MG Road',
      address: '42 Church Street, MG Road, Bengaluru',
      avgPortions: 35,
    },
    {
      userId: 'usr_donor_2',
      profileId: 'don_prof_2',
      name: 'Meera Nair',
      email: 'emerald@foodbridge.demo',
      phone: '+91-98450-22334',
      org: 'Emerald Hotel & Banquets',
      type: 'Hotel',
      fssai: '11223344000819',
      lat: 12.9718,
      lng: 77.6412,
      area: 'Indiranagar',
      address: '100 Feet Road, HAL 2nd Stage, Indiranagar',
      avgPortions: 80,
    },
    {
      userId: 'usr_donor_3',
      profileId: 'don_prof_3',
      name: 'Karthik Rao',
      email: 'freshmart@foodbridge.demo',
      phone: '+91-98450-33445',
      org: 'FreshMart Superstore',
      type: 'Supermarket',
      fssai: '11223344001204',
      lat: 12.9355,
      lng: 77.6242,
      area: 'Koramangala',
      address: '80 Feet Road, 4th Block, Koramangala',
      avgPortions: 60,
    },
    {
      userId: 'usr_donor_4',
      profileId: 'don_prof_4',
      name: 'Ananya Deshmukh',
      email: 'spicegarden@foodbridge.demo',
      phone: '+91-98450-44556',
      org: 'Spice Garden Catering',
      type: 'Caterer',
      fssai: '11223344001498',
      lat: 12.9592,
      lng: 77.6974,
      area: 'Marathahalli',
      address: 'Outer Ring Road, Marathahalli',
      avgPortions: 120,
    },
    {
      userId: 'usr_donor_5',
      profileId: 'don_prof_5',
      name: 'Vikram Patel',
      email: 'techpark@foodbridge.demo',
      phone: '+91-98450-55667',
      org: 'TechPark Central Canteen',
      type: 'Canteen',
      fssai: '11223344001901',
      lat: 12.9279,
      lng: 77.6271,
      area: 'Koramangala South',
      address: 'ST Bed Layout, Koramangala',
      avgPortions: 95,
    },
    {
      userId: 'usr_donor_6',
      profileId: 'don_prof_6',
      name: 'Priya Menon',
      email: 'lotus@foodbridge.demo',
      phone: '+91-98450-66778',
      org: 'Lotus Wedding Palace',
      type: 'Event Organizer',
      fssai: '11223344002150',
      lat: 12.9982,
      lng: 77.553,
      area: 'Malleshwaram',
      address: 'Sampige Road, Malleshwaram',
      avgPortions: 180,
    },
    {
      userId: 'usr_donor_7',
      profileId: 'don_prof_7',
      name: 'Arjun Kapoor',
      email: 'dailycrust@foodbridge.demo',
      phone: '+91-98450-77889',
      org: 'Daily Crust Artisan Bakery',
      type: 'Restaurant',
      fssai: '11223344002488',
      lat: 12.9698,
      lng: 77.6001,
      area: 'Brigade Road',
      address: '14 Brigade Road, Ashok Nagar',
      avgPortions: 45,
    },
  ];

  // 9 NGOs (7 Verified, 2 Pending)
  const ngoSeed: Array<{
    userId: string;
    profileId: string;
    name: string;
    email: string;
    phone: string;
    org: string;
    area: string;
    address: string;
    lat: number;
    lng: number;
    peopleServed: number;
    groups: NgoProfile['servedGroups'];
    openHour: number;
    closeHour: number;
    coldCap: number;
    ambientCap: number;
    coldUsed: number;
    ambientUsed: number;
    hasVehicle: boolean;
    vegOnly: boolean;
    allowsEgg: boolean;
    allowsNonVeg: boolean;
    verification: NgoProfile['verificationStatus'];
    completedPickups: number;
    totalAssigned: number;
    avgResp: number;
    avgRating: number;
  }> = [
    {
      userId: 'usr_ngo_1',
      profileId: 'ngo_prof_1',
      name: 'Lakshmi Devi',
      email: 'ngo@foodbridge.demo',
      phone: '+91-99001-10001',
      org: 'Karuna Community Kitchen',
      area: 'Indiranagar',
      address: '12th Main, HAL 2nd Stage, Indiranagar',
      lat: 12.9765,
      lng: 77.6382,
      peopleServed: 320,
      groups: ['shelter', 'general'],
      openHour: 0,
      closeHour: 23,
      coldCap: 80,
      ambientCap: 150,
      coldUsed: 15,
      ambientUsed: 25,
      hasVehicle: true,
      vegOnly: true,
      allowsEgg: false,
      allowsNonVeg: false,
      verification: 'Verified',
      completedPickups: 28,
      totalAssigned: 29,
      avgResp: 4,
      avgRating: 4.9,
    },
    {
      userId: 'usr_ngo_2',
      profileId: 'ngo_prof_2',
      name: 'Samuel Thomas',
      email: 'hope@foodbridge.demo',
      phone: '+91-99001-10002',
      org: 'Hope Urban Shelter Trust',
      area: 'Shivajinagar',
      address: '18 Infantry Road, Shivajinagar',
      lat: 12.9815,
      lng: 77.6032,
      peopleServed: 260,
      groups: ['shelter', 'elderly'],
      openHour: 0,
      closeHour: 23,
      coldCap: 60,
      ambientCap: 120,
      coldUsed: 10,
      ambientUsed: 20,
      hasVehicle: false,
      vegOnly: false,
      allowsEgg: true,
      allowsNonVeg: true,
      verification: 'Verified',
      completedPickups: 22,
      totalAssigned: 24,
      avgResp: 6,
      avgRating: 4.7,
    },
    {
      userId: 'usr_ngo_3',
      profileId: 'ngo_prof_3',
      name: 'Kavitha Krishnan',
      email: 'balashram@foodbridge.demo',
      phone: '+91-99001-10003',
      org: 'Balashram Children Home',
      area: 'Koramangala',
      address: '3rd Block, Koramangala',
      lat: 12.9312,
      lng: 77.6305,
      peopleServed: 140,
      groups: ['children'], // Nut-containing food will be auto-excluded here!
      openHour: 6,
      closeHour: 22,
      coldCap: 50,
      ambientCap: 90,
      coldUsed: 8,
      ambientUsed: 12,
      hasVehicle: true,
      vegOnly: true,
      allowsEgg: true,
      allowsNonVeg: false,
      verification: 'Verified',
      completedPickups: 19,
      totalAssigned: 20,
      avgResp: 5,
      avgRating: 4.8,
    },
    {
      userId: 'usr_ngo_4',
      profileId: 'ngo_prof_4',
      name: 'Ramesh Gowda',
      email: 'sevasadan@foodbridge.demo',
      phone: '+91-99001-10004',
      org: 'Seva Sadan Elder Care',
      area: 'Jayanagar',
      address: '4th T Block, Jayanagar',
      lat: 12.9255,
      lng: 77.5932,
      peopleServed: 110,
      groups: ['elderly'],
      openHour: 0,
      closeHour: 23,
      coldCap: 45,
      ambientCap: 70,
      coldUsed: 12,
      ambientUsed: 15,
      hasVehicle: false,
      vegOnly: true,
      allowsEgg: false,
      allowsNonVeg: false,
      verification: 'Verified',
      completedPickups: 15,
      totalAssigned: 17,
      avgResp: 8,
      avgRating: 4.6,
    },
    {
      userId: 'usr_ngo_5',
      profileId: 'ngo_prof_5',
      name: 'Fatima Begum',
      email: 'sahara@foodbridge.demo',
      phone: '+91-99001-10005',
      org: 'Sahara Night Refuge',
      area: 'Ulsoor',
      address: 'Cambridge Layout, Ulsoor',
      lat: 12.9752,
      lng: 77.6248,
      peopleServed: 210,
      groups: ['shelter', 'general'],
      openHour: 0,
      closeHour: 23,
      coldCap: 40,
      ambientCap: 110,
      coldUsed: 5,
      ambientUsed: 22,
      hasVehicle: true,
      vegOnly: false,
      allowsEgg: true,
      allowsNonVeg: true,
      verification: 'Verified',
      completedPickups: 20,
      totalAssigned: 22,
      avgResp: 5,
      avgRating: 4.7,
    },
    {
      userId: 'usr_ngo_6',
      profileId: 'ngo_prof_6',
      name: 'Deepak Verma',
      email: 'janaseva@foodbridge.demo',
      phone: '+91-99001-10006',
      org: 'Jana Seva Hostel Pantry',
      area: 'Malleshwaram',
      address: '8th Cross, Malleshwaram',
      lat: 12.9995,
      lng: 77.5712,
      peopleServed: 180,
      groups: ['general'],
      openHour: 0,
      closeHour: 23,
      coldCap: 60,
      ambientCap: 100,
      coldUsed: 10,
      ambientUsed: 18,
      hasVehicle: false,
      vegOnly: true,
      allowsEgg: false,
      allowsNonVeg: false,
      verification: 'Verified',
      completedPickups: 14,
      totalAssigned: 16,
      avgResp: 9,
      avgRating: 4.5,
    },
    {
      userId: 'usr_ngo_7',
      profileId: 'ngo_prof_7',
      name: 'Sunita Kulkarni',
      email: 'annadanam@foodbridge.demo',
      phone: '+91-99001-10007',
      org: 'Annadanam Express Kitchen',
      area: 'Domlur',
      address: 'ESI Road, Domlur',
      lat: 12.961,
      lng: 77.6387,
      peopleServed: 290,
      groups: ['general', 'shelter'],
      openHour: 0,
      closeHour: 23,
      coldCap: 70,
      ambientCap: 140,
      coldUsed: 14,
      ambientUsed: 30,
      hasVehicle: true,
      vegOnly: false,
      allowsEgg: true,
      allowsNonVeg: true,
      verification: 'Verified',
      completedPickups: 25,
      totalAssigned: 26,
      avgResp: 3,
      avgRating: 4.9,
    },
    {
      userId: 'usr_ngo_8',
      profileId: 'ngo_prof_8',
      name: 'Nikhil Hegde',
      email: 'greenplate@foodbridge.demo',
      phone: '+91-99001-10008',
      org: 'GreenPlate Youth Collective',
      area: 'HSR Layout',
      address: '27th Main, HSR Layout',
      lat: 12.9121,
      lng: 77.6446,
      peopleServed: 90,
      groups: ['general'],
      openHour: 7,
      closeHour: 21,
      coldCap: 30,
      ambientCap: 60,
      coldUsed: 5,
      ambientUsed: 10,
      hasVehicle: false,
      vegOnly: true,
      allowsEgg: false,
      allowsNonVeg: false,
      verification: 'Pending',
      completedPickups: 2,
      totalAssigned: 2,
      avgResp: 7,
      avgRating: 4.4,
    },
    {
      userId: 'usr_ngo_9',
      profileId: 'ngo_prof_9',
      name: 'Shalini Iyer',
      email: 'ashakiran@foodbridge.demo',
      phone: '+91-99001-10009',
      org: 'Asha Kiran Women Shelter',
      area: 'Whitefield',
      address: 'ITPL Main Road, Whitefield',
      lat: 12.9698,
      lng: 77.7499,
      peopleServed: 75,
      groups: ['general', 'children'],
      openHour: 7,
      closeHour: 22,
      coldCap: 25,
      ambientCap: 45,
      coldUsed: 4,
      ambientUsed: 8,
      hasVehicle: false,
      vegOnly: true,
      allowsEgg: true,
      allowsNonVeg: false,
      verification: 'Pending',
      completedPickups: 0,
      totalAssigned: 0,
      avgResp: 12,
      avgRating: 4.0,
    },
  ];

  // 5 Volunteers
  const volunteerSeed: Array<{
    userId: string;
    profileId: string;
    name: string;
    email: string;
    phone: string;
    vehicle: VolunteerProfile['vehicleType'];
    area: string;
    lat: number;
    lng: number;
    tasks: number;
    meals: number;
    badges: string[];
  }> = [
    {
      userId: 'usr_vol_1',
      profileId: 'vol_prof_1',
      name: 'Rohan Kulkarni',
      email: 'volunteer@foodbridge.demo',
      phone: '+91-97400-10001',
      vehicle: 'Cargo Scooter',
      area: 'MG Road / Indiranagar',
      lat: 12.9735,
      lng: 77.6195,
      tasks: 18,
      meals: 640,
      badges: ['First Pickup', 'Rapid Responder', '500 Meals Moved'],
    },
    {
      userId: 'usr_vol_2',
      profileId: 'vol_prof_2',
      name: 'Aisha Khan',
      email: 'aisha.vol@foodbridge.demo',
      phone: '+91-97400-10002',
      vehicle: 'Van',
      area: 'Koramangala / HSR',
      lat: 12.936,
      lng: 77.628,
      tasks: 24,
      meals: 1420,
      badges: ['First Pickup', 'Bulk Rescue Lead', '1000 Meals Moved'],
    },
    {
      userId: 'usr_vol_3',
      profileId: 'vol_prof_3',
      name: 'Manoj Kumar',
      email: 'manoj.vol@foodbridge.demo',
      phone: '+91-97400-10003',
      vehicle: 'E-Rickshaw',
      area: 'Shivajinagar / Ulsoor',
      lat: 12.979,
      lng: 77.612,
      tasks: 12,
      meals: 410,
      badges: ['First Pickup', 'Zero-Waste Hero'],
    },
    {
      userId: 'usr_vol_4',
      profileId: 'vol_prof_4',
      name: 'Sneha Reddy',
      email: 'sneha.vol@foodbridge.demo',
      phone: '+91-97400-10004',
      vehicle: 'Car',
      area: 'Jayanagar / Malleshwaram',
      lat: 12.952,
      lng: 77.588,
      tasks: 9,
      meals: 315,
      badges: ['First Pickup'],
    },
    {
      userId: 'usr_vol_5',
      profileId: 'vol_prof_5',
      name: 'Tariq Ahmed',
      email: 'tariq.vol@foodbridge.demo',
      phone: '+91-97400-10005',
      vehicle: 'Bike',
      area: 'Domlur / Marathahalli',
      lat: 12.962,
      lng: 77.655,
      tasks: 15,
      meals: 490,
      badges: ['First Pickup', 'Night Shift Runner'],
    },
  ];

  const users: User[] = [
    ...donorSeed.map((d) => ({
      id: d.userId,
      name: d.name,
      email: d.email,
      passwordHash: passHash,
      role: 'donor' as const,
      phone: d.phone,
      profileId: d.profileId,
      created_at: iso(-60 * 24 * 30),
      updated_at: iso(),
    })),
    ...ngoSeed.map((n) => ({
      id: n.userId,
      name: n.name,
      email: n.email,
      passwordHash: passHash,
      role: 'ngo' as const,
      phone: n.phone,
      profileId: n.profileId,
      created_at: iso(-60 * 24 * 30),
      updated_at: iso(),
    })),
    ...volunteerSeed.map((v) => ({
      id: v.userId,
      name: v.name,
      email: v.email,
      passwordHash: passHash,
      role: 'volunteer' as const,
      phone: v.phone,
      profileId: v.profileId,
      created_at: iso(-60 * 24 * 30),
      updated_at: iso(),
    })),
    {
      id: 'usr_admin_1',
      name: 'NOURISHNEX Admin',
      email: 'admin@foodbridge.demo',
      passwordHash: passHash,
      role: 'admin',
      phone: '+91-80-4000-2623',
      profileId: 'admin_prof_1',
      created_at: iso(-60 * 24 * 30),
      updated_at: iso(),
    },
  ];

  const donors: DonorProfile[] = donorSeed.map((d, idx) => ({
    id: d.profileId,
    userId: d.userId,
    organizationName: d.org,
    businessType: d.type,
    fssaiLicenseNumber: d.fssai,
    location: { lat: d.lat, lng: d.lng, area: d.area, address: d.address },
    averagePortions: d.avgPortions,
    recurringTemplates:
      idx === 0
        ? [
            {
              id: 'tmpl_1',
              title: 'Daily Evening Buffet Veg Surplus',
              category: 'Cooked Veg Curry / Meals',
              dietaryType: 'Veg',
              allergens: ['Dairy'],
              portions: 30,
              quantityKg: 12,
              storageMethod: 'Hot Held',
              packaging: 'Sealed SS gastronorm containers',
              scheduleLabel: 'Daily at 21:00',
              active: true,
            },
          ]
        : [],
    created_at: iso(-60 * 24 * 30),
    updated_at: iso(),
  }));

  const ngos: NgoProfile[] = ngoSeed.map((n) => ({
    id: n.profileId,
    userId: n.userId,
    organizationName: n.org,
    serviceArea: n.area,
    peopleServed: n.peopleServed,
    servedGroups: n.groups,
    operatingHours: { openHour: n.openHour, closeHour: n.closeHour },
    storageCapacityKg: { cold: n.coldCap, ambient: n.ambientCap },
    currentUsedKg: { cold: n.coldUsed, ambient: n.ambientUsed },
    hasVehicle: n.hasVehicle,
    dietaryRules: {
      vegOnly: n.vegOnly,
      allowsEgg: n.allowsEgg,
      allowsNonVeg: n.allowsNonVeg,
    },
    verificationStatus: n.verification,
    trustScore: computeNgoTrustScore({
      completedPickups: n.completedPickups,
      totalAssignedPickups: n.totalAssigned,
      avgResponseMinutes: n.avgResp,
      avgDonorRating: n.avgRating,
    }),
    completedPickups: n.completedPickups,
    totalAssignedPickups: n.totalAssigned,
    avgResponseMinutes: n.avgResp,
    avgDonorRating: n.avgRating,
    isAvailable: true,
    location: { lat: n.lat, lng: n.lng, area: n.area, address: n.address },
    phone: n.phone,
    created_at: iso(-60 * 24 * 30),
    updated_at: iso(),
  }));

  const volunteers: VolunteerProfile[] = volunteerSeed.map((v) => ({
    id: v.profileId,
    userId: v.userId,
    name: v.name,
    vehicleType: v.vehicle,
    area: v.area,
    isAvailable: true,
    maxRadiusKm: 12,
    location: { lat: v.lat, lng: v.lng, area: v.area, address: `${v.area}, Bengaluru` },
    tasksCompleted: v.tasks,
    mealsMoved: v.meals,
    badges: v.badges,
    created_at: iso(-60 * 24 * 30),
    updated_at: iso(),
  }));

  const ngo_requirements: NgoRequirement[] = [
    {
      id: 'req_1',
      ngoId: 'ngo_prof_1',
      category: 'Cooked Veg Curry / Meals',
      neededKg: 25,
      urgency: 'High',
      notes: 'Evening dinner distribution for shelter residents',
      created_at: iso(-120),
      updated_at: iso(-60),
    },
    {
      id: 'req_2',
      ngoId: 'ngo_prof_2',
      category: 'Cooked Rice / Dal',
      neededKg: 30,
      urgency: 'Critical',
      notes: 'Night refuge dinner shortage',
      created_at: iso(-90),
      updated_at: iso(-30),
    },
    {
      id: 'req_3',
      ngoId: 'ngo_prof_3',
      category: 'Bakery & Bread',
      neededKg: 15,
      urgency: 'Medium',
      notes: 'Breakfast loaves for children home',
      created_at: iso(-240),
      updated_at: iso(-120),
    },
    {
      id: 'req_4',
      ngoId: 'ngo_prof_5',
      category: 'Cooked Non-Veg',
      neededKg: 22,
      urgency: 'High',
      notes: 'Protein-rich evening meals',
      created_at: iso(-180),
      updated_at: iso(-40),
    },
    {
      id: 'req_5',
      ngoId: 'ngo_prof_7',
      category: 'Cooked Veg Curry / Meals',
      neededKg: 40,
      urgency: 'High',
      notes: 'Community lunch counter replenishment',
      created_at: iso(-200),
      updated_at: iso(-50),
    },
    {
      id: 'req_6',
      ngoId: 'ngo_prof_4',
      category: 'Raw Produce',
      neededKg: 18,
      urgency: 'Normal',
      notes: 'Fresh vegetables for elder kitchen',
      created_at: iso(-300),
      updated_at: iso(-120),
    },
  ];

  // Build 44 realistic donations across all statuses & past 28 days
  const donations: Donation[] = [];
  const food_safety_passports: FoodSafetyPassport[] = [];
  const ai_assessments: AiAssessment[] = [];
  const match_recommendations: DatabaseSchema['match_recommendations'] = [];
  const offers: Offer[] = [];
  const acceptances: DatabaseSchema['acceptances'] = [];
  const pickups: Pickup[] = [];
  const deliveries: Delivery[] = [];
  const certificates: Certificate[] = [];
  const ratings: Rating[] = [];
  const impact_records: ImpactRecord[] = [];
  const audit_log: AuditLogEntry[] = [];
  const notifications: AppNotification[] = [];
  const outbox_messages: OutboxMessage[] = [];
  const reports_issues: ReportIssue[] = [];

  const categories: FoodCategory[] = [
    'Cooked Veg Curry / Meals',
    'Cooked Rice / Dal',
    'Bakery & Bread',
    'Raw Produce',
    'Dairy & Sweets',
    'Cooked Non-Veg',
    'Packaged / Dry Goods',
  ];

  const sampleTitles: Record<FoodCategory, string[]> = {
    'Cooked Veg Curry / Meals': ['Dal Tadka, Rice & Sabzi Meals', 'Paneer Curry & Roti Trays', 'Sambar Rice & Poriyal Packs'],
    'Cooked Rice / Dal': ['Jeera Rice & Yellow Dal Packs', 'Curd Rice & Vegetable Pulao', 'Khichdi & Kadhi Containers'],
    'Bakery & Bread': ['Assorted Sourdough & Whole Wheat Loaves', 'Multigrain Sandwich Rolls', 'Fresh Croissants & Buns'],
    'Raw Produce': ['Fresh Tomatoes, Carrots & Greens Crates', 'Seasonal Bananas & Apples', 'Leafy Spinach & Vegetables'],
    'Dairy & Sweets': ['Fresh Paneer & Curd Packs', 'Kheer & Milk-based Desserts'],
    'Cooked Non-Veg': ['Chicken Biryani Bulk Trays', 'Grilled Chicken & Rice Boxes'],
    'Packaged / Dry Goods': ['Sealed Biscuits & Cereal Cartons', 'Sealed Juice & Granola Packs'],
  };

  // 34 historical Completed donations over last 25 days (for rich analytics + forecasting)
  for (let i = 1; i <= 34; i++) {
    const donor = donors[i % donors.length];
    const ngo = ngos[i % 7]; // verified NGOs
    const vol = volunteers[i % volunteers.length];
    const cat = categories[i % categories.length];
    const isNonVeg = cat === 'Cooked Non-Veg';
    const effectiveNgo = isNonVeg && ngo.dietaryRules.vegOnly ? ngos[1] : ngo;
    const daysAgo = Math.floor((i * 25) / 34) + 1;
    const createdOffsetMins = -(daysAgo * 24 * 60 + (i % 4) * 180);
    const portions = 20 + (i % 6) * 15;
    const quantityKg = Math.round(portions * 0.4 * 10) / 10;
    const storage =
      cat === 'Bakery & Bread' || cat === 'Packaged / Dry Goods'
        ? 'Ambient'
        : cat === 'Dairy & Sweets' || cat === 'Raw Produce'
        ? 'Refrigerated'
        : 'Hot Held';
    const preparedAt = iso(createdOffsetMins - 25);
    const safeUntil = computeSafeUntil(preparedAt, cat, storage, defaultSettings.foodSafetyRules);
    const donId = `don_hist_${1000 + i}`;
    const titles = sampleTitles[cat];
    const title = titles[i % titles.length];
    const photo =
      cat.startsWith('Cooked')
        ? '/src/assets/images/sample_veg_meals_1795069683150.jpg'
        : '/src/assets/images/sample_bakery_produce_1795069683841.jpg';

    const donation: Donation = {
      id: donId,
      donorId: donor.id,
      donorName: donor.organizationName,
      title,
      category: cat,
      dietaryType: isNonVeg ? 'Non-veg' : 'Veg',
      allergens: cat === 'Bakery & Bread' ? ['Gluten'] : cat === 'Dairy & Sweets' ? ['Dairy'] : ['None declared'],
      portions,
      quantityKg,
      preparedAt,
      readyBy: iso(createdOffsetMins),
      pickupWindowEnd: iso(createdOffsetMins + 120),
      storageMethod: storage,
      temperatureC: storage === 'Hot Held' ? 68 : storage === 'Refrigerated' ? 4 : undefined,
      packaging: 'Sealed food-grade containers',
      photos: [photo],
      status: 'Completed',
      urgency: i % 3 === 0 ? 'High' : 'Medium',
      safeUntil,
      isBulkEvent: i % 11 === 0,
      eventName: i % 11 === 0 ? 'Corporate Banquet Surplus' : undefined,
      location: donor.location,
      assignedNgoId: effectiveNgo.id,
      assignedNgoName: effectiveNgo.organizationName,
      adminNote: 'Approved after Food Safety Passport inspection.',
      isSeededDemo: true,
      created_at: iso(createdOffsetMins),
      updated_at: iso(createdOffsetMins + 55),
    };
    donations.push(donation);

    food_safety_passports.push({
      id: `fsp_hist_${i}`,
      donationId: donId,
      preparedAt,
      storageMethod: storage,
      temperatureC: donation.temperatureC,
      allergens: donation.allergens,
      dietaryType: donation.dietaryType,
      packaging: donation.packaging,
      safeUntil,
      ruleFlags: [],
      pickupPhoto: photo,
      checklistResults: {
        foodSealed: true,
        labeledWithTime: true,
        tempMaintained: true,
        photoCaptured: true,
        completedAt: iso(createdOffsetMins + 22),
        volunteerId: vol.id,
      },
      created_at: iso(createdOffsetMins),
      updated_at: iso(createdOffsetMins + 55),
    });

    ai_assessments.push({
      id: `aia_hist_${i}`,
      donationId: donId,
      source: 'sample_demo',
      modelUsed: 'gemini-4-hydrogen',
      categoryInterpretation: `${cat} (${donation.dietaryType}) in ${donation.packaging}.`,
      missingInformation: [],
      storageConcerns: [],
      visibleConditionNotes: 'Containers appear clean, sealed, and evenly portioned.',
      urgencyRecommendation: donation.urgency,
      humanReviewRecommendation: 'Approve Recommended',
      confidenceNote: 'Sample AI output for seeded historical record.',
      disclaimer: SAFETY_DISCLAIMER,
      created_at: iso(createdOffsetMins),
      updated_at: iso(createdOffsetMins),
    });

    const dist = haversineDistanceKm(donor.location, effectiveNgo.location);
    const pkId = `pk_hist_${i}`;
    pickups.push({
      id: pkId,
      donationId: donId,
      ngoId: effectiveNgo.id,
      volunteerId: vol.id,
      volunteerName: vol.name,
      status: 'Delivered',
      pickupLocation: donor.location,
      dropoffLocation: effectiveNgo.location,
      distanceKm: dist,
      etaMins: estimateTravelMinutes(dist),
      safeUntil,
      checklistCompleted: true,
      claimedAt: iso(createdOffsetMins + 14),
      pickedUpAt: iso(createdOffsetMins + 24),
      deliveredAt: iso(createdOffsetMins + 48),
      created_at: iso(createdOffsetMins + 10),
      updated_at: iso(createdOffsetMins + 48),
    });

    const otp = String(100000 + ((i * 7919) % 899999));
    deliveries.push({
      id: `del_hist_${i}`,
      donationId: donId,
      pickupId: pkId,
      ngoId: effectiveNgo.id,
      otpHash: hashOtp(otp),
      otpPlainForAuthorizedRoles: otp,
      qrToken: `FB-QR-${donId}-${otp}`,
      verifiedAt: iso(createdOffsetMins + 50),
      verifiedByMethod: i % 2 === 0 ? 'OTP' : 'QR',
      ratedAt: iso(createdOffsetMins + 55),
      created_at: iso(createdOffsetMins + 10),
      updated_at: iso(createdOffsetMins + 55),
    });

    const certId = `CERT-${202600 + i}`;
    const certPayload: CertificatePayload = {
      certificateId: certId,
      donationId: donId,
      donorName: donor.organizationName,
      ngoName: effectiveNgo.organizationName,
      title: donation.title,
      category: donation.category,
      dietaryType: donation.dietaryType,
      portions: donation.portions,
      quantityKg: donation.quantityKg,
      preparedAt: donation.preparedAt,
      safeUntil: donation.safeUntil,
      handoverAt: iso(createdOffsetMins + 50),
      handoverMethod: i % 2 === 0 ? 'OTP' : 'QR',
      safetySummary: `${storage}${donation.temperatureC ? ` (${donation.temperatureC}°C)` : ''}, checklist verified`,
      issuedAt: iso(createdOffsetMins + 55),
    };
    certificates.push({
      id: certId,
      donationId: donId,
      payload: certPayload,
      signature: signCertificatePayload(certPayload),
      algorithm: 'HMAC-SHA256',
      created_at: iso(createdOffsetMins + 55),
      updated_at: iso(createdOffsetMins + 55),
    });

    ratings.push({
      id: `rat_hist_${i}`,
      donationId: donId,
      donorId: donor.id,
      ngoId: effectiveNgo.id,
      foodConditionScore: i % 4 === 0 ? 4 : 5,
      donorPackagingScore: 5,
      ngoResponsivenessScore: 5,
      comment: 'Fresh, well-sealed, and distributed immediately.',
      created_at: iso(createdOffsetMins + 55),
      updated_at: iso(createdOffsetMins + 55),
    });

    impact_records.push({
      id: `imp_hist_${i}`,
      donationId: donId,
      donorId: donor.id,
      ngoId: effectiveNgo.id,
      volunteerId: vol.id,
      mealsProvided: portions,
      quantityKg,
      estimatedCo2eAvoidedKg: Math.round(quantityKg * defaultSettings.assumptions.co2eKgPerKgFood * 10) / 10,
      completedAt: iso(createdOffsetMins + 55),
      created_at: iso(createdOffsetMins + 55),
      updated_at: iso(createdOffsetMins + 55),
    });
  }

  // 10 Recent / Active / Rejected / Expired / Escalated donations (so every queue & chart is populated)
  const specialCases: Array<{
    id: string;
    donorIdx: number;
    title: string;
    cat: FoodCategory;
    dietary: Donation['dietaryType'];
    allergens: string[];
    portions: number;
    kg: number;
    storage: Donation['storageMethod'];
    tempC?: number;
    status: DonationStatus;
    prepOffsetMins: number;
    ngoIdx?: number;
    volIdx?: number;
    rejectionReason?: string;
    bulk?: boolean;
    eventName?: string;
  }> = [
    {
      id: 'don_active_1',
      donorIdx: 0,
      title: 'Evening Veg Biryani & Raita Trays',
      cat: 'Cooked Veg Curry / Meals',
      dietary: 'Veg',
      allergens: ['Dairy'],
      portions: 35,
      kg: 14,
      storage: 'Hot Held',
      tempC: 66,
      status: 'Pending Review',
      prepOffsetMins: -20,
    },
    {
      id: 'don_active_2',
      donorIdx: 6,
      title: 'Fresh Sourdough & Multigrain Loaves',
      cat: 'Bakery & Bread',
      dietary: 'Veg',
      allergens: ['Gluten'],
      portions: 40,
      kg: 12,
      storage: 'Ambient',
      status: 'Awaiting NGO Acceptance',
      prepOffsetMins: -45,
      ngoIdx: 0,
    },
    {
      id: 'don_active_3',
      donorIdx: 2,
      title: 'Fresh Mixed Vegetables & Spinach Crates',
      cat: 'Raw Produce',
      dietary: 'Veg',
      allergens: ['None declared'],
      portions: 50,
      kg: 20,
      storage: 'Refrigerated',
      tempC: 5,
      status: 'Accepted', // Open pickup task #1 (MG Road/Koramangala)
      prepOffsetMins: -60,
      ngoIdx: 2,
    },
    {
      id: 'don_active_4',
      donorIdx: 1,
      title: 'Banquet Jeera Rice & Dal Makhani',
      cat: 'Cooked Rice / Dal',
      dietary: 'Veg',
      allergens: ['Dairy'],
      portions: 60,
      kg: 24,
      storage: 'Hot Held',
      tempC: 69,
      status: 'Accepted', // Open pickup task #2 (close to MG Road/Indiranagar for grouped route!)
      prepOffsetMins: -35,
      ngoIdx: 4,
    },
    {
      id: 'don_active_5',
      donorIdx: 3,
      title: 'Corporate Lunch Veg Meals',
      cat: 'Cooked Veg Curry / Meals',
      dietary: 'Veg',
      allergens: ['None declared'],
      portions: 45,
      kg: 18,
      storage: 'Hot Held',
      tempC: 65,
      status: 'In Transit',
      prepOffsetMins: -50,
      ngoIdx: 6,
      volIdx: 0,
    },
    {
      id: 'don_active_6',
      donorIdx: 4,
      title: 'Canteen Rice & Curry Trays (Delivered, awaiting OTP)',
      cat: 'Cooked Rice / Dal',
      dietary: 'Veg',
      allergens: ['None declared'],
      portions: 30,
      kg: 12,
      storage: 'Hot Held',
      tempC: 64,
      status: 'Pickup Scheduled',
      prepOffsetMins: -40,
      ngoIdx: 1,
      volIdx: 1,
    },
    {
      id: 'don_hist_rej_1',
      donorIdx: 3,
      title: 'Unrefrigerated Dairy Kheer Batch',
      cat: 'Dairy & Sweets',
      dietary: 'Veg',
      allergens: ['Dairy'],
      portions: 40,
      kg: 16,
      storage: 'Ambient',
      tempC: 24,
      status: 'Rejected',
      prepOffsetMins: -320,
      rejectionReason: 'Dairy held at ambient temperature beyond safety limit.',
    },
    {
      id: 'don_hist_rej_2',
      donorIdx: 5,
      title: 'Wedding Buffet Mixed Sweets',
      cat: 'Dairy & Sweets',
      dietary: 'Veg',
      allergens: ['Dairy', 'Tree Nuts'],
      portions: 85,
      kg: 34,
      storage: 'Ambient',
      status: 'Rejected',
      prepOffsetMins: -620,
      rejectionReason: 'Missing preparation timestamp and temperature log.',
    },
    {
      id: 'don_hist_exp_1',
      donorIdx: 0,
      title: 'Late Night Chicken Curry Surplus',
      cat: 'Cooked Non-Veg',
      dietary: 'Non-veg',
      allergens: ['None declared'],
      portions: 25,
      kg: 10,
      storage: 'Ambient',
      status: 'Expired',
      prepOffsetMins: -400,
    },
    {
      id: 'don_hist_can_1',
      donorIdx: 2,
      title: 'Bakery Rolls Surplus',
      cat: 'Bakery & Bread',
      dietary: 'Veg',
      allergens: ['Gluten'],
      portions: 20,
      kg: 8,
      storage: 'Ambient',
      status: 'Cancelled',
      prepOffsetMins: -1800,
    },
  ];

  for (const sc of specialCases) {
    const donor = donors[sc.donorIdx];
    const prepAt = iso(sc.prepOffsetMins);
    const rulesCheck = runRuleBasedSafetyChecks(
      {
        preparedAt: prepAt,
        category: sc.cat,
        storageMethod: sc.storage,
        temperatureC: sc.tempC,
        allergens: sc.allergens,
        quantityKg: sc.kg,
        photos: sc.cat.startsWith('Cooked') ? ['/src/assets/images/sample_veg_meals_1795069683150.jpg'] : ['/src/assets/images/sample_bakery_produce_1795069683841.jpg'],
        donorAverageKg: donor.averagePortions * 0.4,
      },
      defaultSettings.foodSafetyRules,
      nowMs
    );
    const urgency = computeUrgency(rulesCheck.safeUntil, nowMs, defaultSettings.urgencyThresholdsMinutes);
    const ngo = typeof sc.ngoIdx === 'number' ? ngos[sc.ngoIdx] : undefined;

    const donation: Donation = {
      id: sc.id,
      donorId: donor.id,
      donorName: donor.organizationName,
      title: sc.title,
      category: sc.cat,
      dietaryType: sc.dietary,
      allergens: sc.allergens,
      portions: sc.portions,
      quantityKg: sc.kg,
      preparedAt: prepAt,
      readyBy: iso(sc.prepOffsetMins + 15),
      pickupWindowEnd: iso(sc.prepOffsetMins + 180),
      storageMethod: sc.storage,
      temperatureC: sc.tempC,
      packaging: 'Sealed food-grade containers',
      photos: [
        sc.cat.startsWith('Cooked')
          ? '/src/assets/images/sample_veg_meals_1795069683150.jpg'
          : '/src/assets/images/sample_bakery_produce_1795069683841.jpg',
      ],
      status: sc.status,
      urgency,
      safeUntil: rulesCheck.safeUntil,
      isBulkEvent: Boolean(sc.bulk),
      eventName: sc.eventName,
      location: donor.location,
      assignedNgoId: sc.status === 'Accepted' || sc.status === 'Pickup Scheduled' || sc.status === 'In Transit' ? ngo?.id : undefined,
      assignedNgoName: sc.status === 'Accepted' || sc.status === 'Pickup Scheduled' || sc.status === 'In Transit' ? ngo?.organizationName : undefined,
      adminNote: sc.rejectionReason || (sc.status !== 'Pending Review' ? 'Reviewed and cleared for matching.' : undefined),
      isSeededDemo: true,
      created_at: iso(sc.prepOffsetMins + 10),
      updated_at: iso(-5),
    };
    donations.push(donation);

    food_safety_passports.push({
      id: `fsp_${sc.id}`,
      donationId: sc.id,
      preparedAt: prepAt,
      storageMethod: sc.storage,
      temperatureC: sc.tempC,
      allergens: sc.allergens,
      dietaryType: sc.dietary,
      packaging: donation.packaging,
      safeUntil: rulesCheck.safeUntil,
      ruleFlags: rulesCheck.flags,
      created_at: donation.created_at,
      updated_at: donation.updated_at,
    });

    ai_assessments.push({
      id: `aia_${sc.id}`,
      donationId: sc.id,
      source: 'sample_demo',
      modelUsed: 'gemini-4-hydrogen',
      categoryInterpretation: `${sc.cat} · ${sc.dietary} · ${sc.portions} meals (${sc.kg} kg).`,
      missingInformation: [],
      storageConcerns: rulesCheck.flags.map((f) => f.message),
      visibleConditionNotes: 'Food trays look neatly sealed with visible batch labeling.',
      urgencyRecommendation: urgency,
      humanReviewRecommendation: rulesCheck.flags.some((f) => f.severity === 'critical')
        ? 'Inspect Carefully'
        : 'Approve Recommended',
      confidenceNote: 'Sample AI output for seeded demo item.',
      disclaimer: SAFETY_DISCLAIMER,
      created_at: donation.created_at,
      updated_at: donation.updated_at,
    });

    if (
      sc.status === 'Awaiting NGO Acceptance' ||
      sc.status === 'Accepted' ||
      sc.status === 'Pickup Scheduled' ||
      sc.status === 'In Transit'
    ) {
      const matchRes = matchNgosForDonation(donation, ngos, ngo_requirements, defaultSettings, nowMs);
      match_recommendations.push({
        id: `mr_${sc.id}`,
        donationId: sc.id,
        weights: matchRes.weights,
        candidates: matchRes.candidates,
        aiSummarySource: 'sample_demo',
        created_at: donation.created_at,
        updated_at: donation.updated_at,
      });

      if (sc.status === 'Awaiting NGO Acceptance' && ngo) {
        offers.push({
          id: `off_${sc.id}_1`,
          donationId: sc.id,
          ngoId: ngo.id,
          ngoName: ngo.organizationName,
          rankOrder: 1,
          status: 'Pending',
          sentAt: iso(-3),
          expiresAt: iso(7),
          created_at: iso(-3),
          updated_at: iso(-3),
        });
      }

      if ((sc.status === 'Accepted' || sc.status === 'Pickup Scheduled' || sc.status === 'In Transit') && ngo) {
        const offId = `off_${sc.id}_acc`;
        offers.push({
          id: offId,
          donationId: sc.id,
          ngoId: ngo.id,
          ngoName: ngo.organizationName,
          rankOrder: 1,
          status: 'Accepted',
          sentAt: iso(-20),
          expiresAt: iso(-10),
          respondedAt: iso(-16),
          created_at: iso(-20),
          updated_at: iso(-16),
        });
        acceptances.push({
          id: `acc_${sc.id}`,
          donationId: sc.id,
          offerId: offId,
          ngoId: ngo.id,
          acceptedByUserId: ngo.userId,
          acceptedAt: iso(-16),
          created_at: iso(-16),
          updated_at: iso(-16),
        });

        const dist = haversineDistanceKm(donor.location, ngo.location);
        const vol = typeof sc.volIdx === 'number' ? volunteers[sc.volIdx] : undefined;
        const pkId = `pk_${sc.id}`;
        pickups.push({
          id: pkId,
          donationId: sc.id,
          ngoId: ngo.id,
          volunteerId: vol?.id,
          volunteerName: vol?.name,
          status: sc.status === 'In Transit' ? 'In Transit' : sc.status === 'Pickup Scheduled' ? 'Claimed' : 'Open',
          pickupLocation: donor.location,
          dropoffLocation: ngo.location,
          simulatedVolunteerCoords: vol
            ? {
                lat: (donor.location.lat + ngo.location.lat) / 2,
                lng: (donor.location.lng + ngo.location.lng) / 2,
                updatedAt: iso(-2),
              }
            : undefined,
          distanceKm: dist,
          etaMins: estimateTravelMinutes(dist),
          safeUntil: donation.safeUntil,
          checklistCompleted: sc.status === 'In Transit',
          claimedAt: vol ? iso(-12) : undefined,
          pickedUpAt: sc.status === 'In Transit' ? iso(-5) : undefined,
          created_at: iso(-16),
          updated_at: iso(-2),
        });

        const otp = sc.id === 'don_active_5' ? '482910' : '639204';
        deliveries.push({
          id: `del_${sc.id}`,
          donationId: sc.id,
          pickupId: pkId,
          ngoId: ngo.id,
          otpHash: hashOtp(otp),
          otpPlainForAuthorizedRoles: otp,
          qrToken: `FB-QR-${sc.id}-${otp}`,
          created_at: iso(-16),
          updated_at: iso(-16),
        });
      }
    }
  }

  // Seed a realistic Escalated offer history for analytics (Rejection Reasons + Escalation log)
  offers.push({
    id: 'off_seed_rej_1',
    donationId: 'don_hist_1005',
    ngoId: 'ngo_prof_4',
    ngoName: 'Seva Sadan Elder Care',
    rankOrder: 1,
    status: 'Rejected',
    rejectionReason: 'Storage capacity full',
    sentAt: iso(-4200),
    expiresAt: iso(-4190),
    respondedAt: iso(-4195),
    created_at: iso(-4200),
    updated_at: iso(-4195),
  });
  offers.push({
    id: 'off_seed_rej_2',
    donationId: 'don_hist_1008',
    ngoId: 'ngo_prof_6',
    ngoName: 'Jana Seva Hostel Pantry',
    rankOrder: 1,
    status: 'Rejected',
    rejectionReason: 'Volunteer / transport unavailable',
    sentAt: iso(-6400),
    expiresAt: iso(-6390),
    respondedAt: iso(-6394),
    created_at: iso(-6400),
    updated_at: iso(-6394),
  });
  offers.push({
    id: 'off_seed_timeout_1',
    donationId: 'don_hist_1012',
    ngoId: 'ngo_prof_2',
    ngoName: 'Hope Urban Shelter Trust',
    rankOrder: 1,
    status: 'Timed Out',
    sentAt: iso(-8400),
    expiresAt: iso(-8390),
    created_at: iso(-8400),
    updated_at: iso(-8390),
  });

  audit_log.push(
    {
      id: 'aud_seed_1',
      donationId: 'don_active_1',
      actorUserId: 'usr_donor_1',
      actorName: 'Rajesh Sharma',
      actorRole: 'donor',
      action: 'Donation Created',
      toStatus: 'Pending Review',
      note: 'Submitted 35 portions of Evening Veg Biryani & Raita Trays.',
      created_at: iso(-15),
      updated_at: iso(-15),
    },
    {
      id: 'aud_seed_2',
      donationId: 'don_active_5',
      actorUserId: 'usr_vol_1',
      actorName: 'Rohan Kulkarni',
      actorRole: 'volunteer',
      action: 'Pickup Started (In Transit)',
      fromStatus: 'Pickup Scheduled',
      toStatus: 'In Transit',
      note: 'Safety checklist verified: sealed, time-labeled, 65°C maintained.',
      created_at: iso(-5),
      updated_at: iso(-5),
    },
    {
      id: 'aud_seed_3',
      donationId: 'don_hist_exp_1',
      actorUserId: 'system',
      actorName: 'Safety Watchdog',
      actorRole: 'system',
      action: 'Safe Until Expired',
      fromStatus: 'Awaiting NGO Acceptance',
      toStatus: 'Expired',
      note: 'Safe Until window elapsed prior to handover.',
      created_at: iso(-280),
      updated_at: iso(-280),
    }
  );

  notifications.push(
    {
      id: 'ntf_seed_1',
      targetRole: 'admin',
      eventType: 'new_donation',
      title: 'New donation awaiting safety review',
      message: 'Annapoorna Grand Kitchen submitted 35 meals (Evening Veg Biryani & Raita Trays).',
      donationId: 'don_active_1',
      read: false,
      created_at: iso(-15),
      updated_at: iso(-15),
    },
    {
      id: 'ntf_seed_2',
      targetRole: 'ngo',
      targetUserId: 'usr_ngo_1',
      eventType: 'ngo_offer',
      title: 'New matched donation offer',
      message: 'Daily Crust Artisan Bakery offered 12 kg Bakery & Bread (40 portions).',
      donationId: 'don_active_2',
      read: false,
      created_at: iso(-3),
      updated_at: iso(-3),
    },
    {
      id: 'ntf_seed_3',
      targetRole: 'volunteer',
      eventType: 'volunteer_needed',
      title: '2 nearby pickups can be grouped',
      message: 'MG Road & Indiranagar pickups are within 3.5 km — grouped route available.',
      donationId: 'don_active_3',
      read: false,
      created_at: iso(-10),
      updated_at: iso(-10),
    }
  );

  outbox_messages.push(
    {
      id: 'out_seed_1',
      channel: 'WhatsApp',
      recipientName: 'Karuna Community Kitchen',
      recipientPhone: '+91-99001-10001',
      language: 'en',
      body: '[Simulated WhatsApp] FoodBridge AI Offer: 12 kg Fresh Sourdough & Multigrain Loaves (40 meals) from Daily Crust Bakery. Safe Until 16h left. Reply YES to accept or open dashboard.',
      donationId: 'don_active_2',
      simulated: true,
      created_at: iso(-3),
      updated_at: iso(-3),
    },
    {
      id: 'out_seed_2',
      channel: 'SMS',
      recipientName: 'Annadanam Express Kitchen',
      recipientPhone: '+91-99001-10007',
      language: 'hi',
      body: '[Simulated SMS] FoodBridge AI: आपके लिए 18 kg पका हुआ शाकाहारी भोजन (45 थाली) पिकअप के लिए रवाना है। OTP: 482910',
      donationId: 'don_active_5',
      simulated: true,
      created_at: iso(-5),
      updated_at: iso(-5),
    }
  );

  reports_issues.push({
    id: 'rep_seed_1',
    donationId: 'don_hist_exp_1',
    reporterUserId: 'usr_admin_1',
    reporterName: 'NOURISHNEX Admin',
    severity: 'medium',
    category: 'Late Night Expiry',
    description: 'Cooked non-veg surplus posted after 23:00 expired before courier claim.',
    status: 'Open',
    created_at: iso(-270),
    updated_at: iso(-270),
  });

  return {
    users,
    donors,
    ngos,
    volunteers,
    donations,
    food_safety_passports,
    ai_assessments,
    ngo_requirements,
    match_recommendations,
    offers,
    acceptances,
    pickups,
    deliveries,
    certificates,
    notifications,
    outbox_messages,
    ratings,
    impact_records,
    audit_log,
    reports_issues,
    settings: [defaultSettings],
  };
}
