export type Role = 'donor' | 'ngo' | 'volunteer' | 'admin';

export type DonationStatus =
  | 'Draft'
  | 'Pending Review'
  | 'Approved'
  | 'Matching'
  | 'Awaiting NGO Acceptance'
  | 'Accepted'
  | 'Pickup Scheduled'
  | 'In Transit'
  | 'Delivered'
  | 'Completed'
  | 'Rejected'
  | 'Cancelled'
  | 'Expired'
  | 'Escalated';

export type FoodCategory =
  | 'Cooked Rice / Dal'
  | 'Cooked Veg Curry / Meals'
  | 'Cooked Non-Veg'
  | 'Dairy & Sweets'
  | 'Bakery & Bread'
  | 'Raw Produce'
  | 'Packaged / Dry Goods';

export type DietaryType = 'Veg' | 'Non-veg' | 'Contains egg';

export type StorageMethod = 'Hot Held' | 'Refrigerated' | 'Ambient' | 'Frozen';

export type UrgencyLevel = 'Critical' | 'High' | 'Medium' | 'Normal';

export type VerificationStatus = 'Unverified' | 'Pending' | 'Verified' | 'Suspended';

export type ServedGroup = 'children' | 'elderly' | 'shelter' | 'general';

export interface GeoPoint {
  lat: number;
  lng: number;
  area: string;
  address: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  phone: string;
  profileId: string;
  created_at: string;
  updated_at: string;
}

export interface DonorProfile {
  id: string;
  userId: string;
  organizationName: string;
  businessType: 'Restaurant' | 'Hotel' | 'Supermarket' | 'Caterer' | 'Canteen' | 'Event Organizer';
  fssaiLicenseNumber: string; // Field only, no external verification
  location: GeoPoint;
  averagePortions: number;
  recurringTemplates: RecurringTemplate[];
  created_at: string;
  updated_at: string;
}

export interface RecurringTemplate {
  id: string;
  title: string;
  category: FoodCategory;
  dietaryType: DietaryType;
  allergens: string[];
  portions: number;
  quantityKg: number;
  storageMethod: StorageMethod;
  packaging: string;
  scheduleLabel: string; // e.g. "Daily at 21:00"
  active: boolean;
}

export interface NgoProfile {
  id: string;
  userId: string;
  organizationName: string;
  serviceArea: string;
  peopleServed: number;
  servedGroups: ServedGroup[];
  operatingHours: { openHour: number; closeHour: number }; // 0-23
  storageCapacityKg: { cold: number; ambient: number };
  currentUsedKg: { cold: number; ambient: number };
  hasVehicle: boolean;
  dietaryRules: {
    vegOnly: boolean;
    allowsEgg: boolean;
    allowsNonVeg: boolean;
  };
  verificationStatus: VerificationStatus;
  trustScore: number; // 0-100 derived deterministically
  completedPickups: number;
  totalAssignedPickups: number;
  avgResponseMinutes: number;
  avgDonorRating: number;
  isAvailable: boolean;
  location: GeoPoint;
  phone: string;
  created_at: string;
  updated_at: string;
}

export interface VolunteerProfile {
  id: string;
  userId: string;
  name: string;
  vehicleType: 'Bike' | 'Cargo Scooter' | 'Car' | 'Van' | 'E-Rickshaw';
  area: string;
  isAvailable: boolean;
  maxRadiusKm: number;
  location: GeoPoint;
  tasksCompleted: number;
  mealsMoved: number;
  badges: string[];
  created_at: string;
  updated_at: string;
}

export interface Donation {
  id: string;
  donorId: string;
  donorName: string;
  title: string;
  category: FoodCategory;
  dietaryType: DietaryType;
  allergens: string[];
  portions: number;
  quantityKg: number;
  preparedAt: string;
  readyBy: string;
  pickupWindowEnd: string;
  storageMethod: StorageMethod;
  temperatureC?: number;
  packaging: string;
  photos: string[];
  status: DonationStatus;
  urgency: UrgencyLevel;
  safeUntil: string;
  isBulkEvent: boolean;
  eventName?: string;
  location: GeoPoint;
  assignedNgoId?: string;
  assignedNgoName?: string;
  adminNote?: string;
  isSeededDemo?: boolean;
  created_at: string;
  updated_at: string;
}

export interface RuleFlag {
  code: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

export interface FoodSafetyPassport {
  id: string;
  donationId: string;
  preparedAt: string;
  storageMethod: StorageMethod;
  temperatureC?: number;
  allergens: string[];
  dietaryType: DietaryType;
  packaging: string;
  safeUntil: string;
  ruleFlags: RuleFlag[];
  pickupPhoto?: string;
  checklistResults?: {
    foodSealed: boolean;
    labeledWithTime: boolean;
    tempMaintained: boolean;
    photoCaptured: boolean;
    completedAt: string;
    volunteerId: string;
  };
  created_at: string;
  updated_at: string;
}

export interface AiAssessment {
  id: string;
  donationId: string;
  source: 'gemini' | 'fallback' | 'sample_demo';
  modelUsed: string;
  categoryInterpretation: string;
  missingInformation: string[];
  storageConcerns: string[];
  visibleConditionNotes: string;
  urgencyRecommendation: UrgencyLevel;
  humanReviewRecommendation: 'Approve Recommended' | 'Inspect Carefully' | 'Hold / Clarify';
  confidenceNote: string;
  disclaimer: string;
  created_at: string;
  updated_at: string;
}

export interface NgoRequirement {
  id: string;
  ngoId: string;
  category: FoodCategory;
  neededKg: number;
  urgency: UrgencyLevel;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface MatchCandidate {
  ngoId: string;
  ngoName: string;
  eligible: boolean;
  excludedReasons: string[];
  matchScore: number; // 0-100
  urgencyScore: number; // U (0-100)
  proximityScore: number; // D (0-100)
  capacityScore: number; // C (0-100)
  distanceKm: number;
  estimatedTravelMins: number;
  trustScore: number;
  hasVehicle: boolean;
  servedGroups: ServedGroup[];
  unmetRequirementKg: number;
  warnings: string[];
  aiExplanation?: string;
}

export interface MatchRecommendation {
  id: string;
  donationId: string;
  weights: { urgency: number; proximity: number; capacity: number };
  candidates: MatchCandidate[];
  aiSummarySource: 'gemini' | 'fallback' | 'sample_demo';
  created_at: string;
  updated_at: string;
}

export interface Offer {
  id: string;
  donationId: string;
  ngoId: string;
  ngoName: string;
  rankOrder: number;
  broadcastGroupId?: string;
  status: 'Pending' | 'Accepted' | 'Rejected' | 'Timed Out' | 'Auto-Released' | 'Cancelled';
  rejectionReason?: string;
  sentAt: string;
  expiresAt: string;
  respondedAt?: string;
  created_at: string;
  updated_at: string;
}

export interface Acceptance {
  id: string;
  donationId: string;
  offerId: string;
  ngoId: string;
  acceptedByUserId: string;
  acceptedAt: string;
  created_at: string;
  updated_at: string;
}

export interface Pickup {
  id: string;
  donationId: string;
  ngoId: string;
  volunteerId?: string;
  volunteerName?: string;
  selfDeliveryBy?: 'ngo' | 'donor';
  status: 'Open' | 'Claimed' | 'In Transit' | 'Delivered' | 'Cancelled';
  pickupLocation: GeoPoint;
  dropoffLocation: GeoPoint;
  simulatedVolunteerCoords?: { lat: number; lng: number; updatedAt: string };
  distanceKm: number;
  etaMins: number;
  safeUntil: string;
  checklistCompleted: boolean;
  claimedAt?: string;
  pickedUpAt?: string;
  deliveredAt?: string;
  created_at: string;
  updated_at: string;
}

export interface Delivery {
  id: string;
  donationId: string;
  pickupId: string;
  ngoId: string;
  otpHash: string;
  otpPlainForAuthorizedRoles: string; // Returned only to authorized NGO/Admin/Donor endpoints
  qrToken: string;
  verifiedAt?: string;
  verifiedByMethod?: 'OTP' | 'QR';
  ratedAt?: string;
  created_at: string;
  updated_at: string;
}

export interface CertificatePayload {
  certificateId: string;
  donationId: string;
  donorName: string;
  ngoName: string;
  title: string;
  category: FoodCategory;
  dietaryType: DietaryType;
  portions: number;
  quantityKg: number;
  preparedAt: string;
  safeUntil: string;
  handoverAt: string;
  handoverMethod: 'OTP' | 'QR';
  safetySummary: string;
  issuedAt: string;
}

export interface Certificate {
  id: string;
  donationId: string;
  payload: CertificatePayload;
  signature: string; // HMAC-SHA256 hex
  algorithm: 'HMAC-SHA256';
  created_at: string;
  updated_at: string;
}

export interface AppNotification {
  id: string;
  targetRole: Role | 'all';
  targetUserId?: string;
  eventType:
    | 'new_donation'
    | 'approved'
    | 'rejected'
    | 'ngo_offer'
    | 'escalation'
    | 'accepted'
    | 'volunteer_needed'
    | 'pickup_scheduled'
    | 'in_transit'
    | 'delivered'
    | 'certificate_ready'
    | 'safety_warning'
    | 'safe_until_warning'
    | 'expired';
  title: string;
  message: string;
  donationId?: string;
  read: boolean;
  created_at: string;
  updated_at: string;
}

export interface OutboxMessage {
  id: string;
  channel: 'SMS' | 'WhatsApp';
  recipientName: string;
  recipientPhone: string;
  language: 'en' | 'hi' | 'ta';
  body: string;
  donationId?: string;
  simulated: true;
  created_at: string;
  updated_at: string;
}

export interface Rating {
  id: string;
  donationId: string;
  donorId: string;
  ngoId: string;
  foodConditionScore: number; // 1-5
  donorPackagingScore: number; // 1-5
  ngoResponsivenessScore?: number; // 1-5
  comment: string;
  created_at: string;
  updated_at: string;
}

export interface ImpactRecord {
  id: string;
  donationId: string;
  donorId: string;
  ngoId: string;
  volunteerId?: string;
  mealsProvided: number;
  quantityKg: number;
  estimatedCo2eAvoidedKg: number;
  completedAt: string;
  created_at: string;
  updated_at: string;
}

export interface AuditLogEntry {
  id: string;
  donationId?: string;
  actorUserId: string;
  actorName: string;
  actorRole: Role | 'system';
  action: string;
  fromStatus?: string;
  toStatus?: string;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface ReportIssue {
  id: string;
  donationId?: string;
  reporterUserId: string;
  reporterName: string;
  severity: 'low' | 'medium' | 'high';
  category: string;
  description: string;
  status: 'Open' | 'Resolved';
  created_at: string;
  updated_at: string;
}

export interface FoodSafetyRuleRow {
  category: FoodCategory;
  ambientHours: number;
  hotHeldHours: number;
  refrigeratedHours: number;
  frozenHours: number;
  hotMinTempC?: number;
  coldMaxTempC?: number;
  photoRecommended: boolean;
}

export interface AppSettings {
  id: 'global';
  escalationTimeoutSeconds: number; // Default 600 (10m) or 30 in fast-forward
  fastForwardTimers: boolean;
  volunteerClaimTimeoutSeconds: number;
  allowPendingNgosForDemo: boolean;
  demoAiMode: boolean;
  groupedPickupRadiusKm: number;
  urgencyThresholdsMinutes: {
    criticalMax: number; // 60
    highMax: number; // 120
    mediumMax: number; // 240
  };
  assumptions: {
    kgPerMeal: number; // 0.4
    co2eKgPerKgFood: number; // 2.5
  };
  foodSafetyRules: FoodSafetyRuleRow[];
  updated_at: string;
}

export interface DatabaseSchema {
  users: User[];
  donors: DonorProfile[];
  ngos: NgoProfile[];
  volunteers: VolunteerProfile[];
  donations: Donation[];
  food_safety_passports: FoodSafetyPassport[];
  ai_assessments: AiAssessment[];
  ngo_requirements: NgoRequirement[];
  match_recommendations: MatchRecommendation[];
  offers: Offer[];
  acceptances: Acceptance[];
  pickups: Pickup[];
  deliveries: Delivery[];
  certificates: Certificate[];
  notifications: AppNotification[];
  outbox_messages: OutboxMessage[];
  ratings: Rating[];
  impact_records: ImpactRecord[];
  audit_log: AuditLogEntry[];
  reports_issues: ReportIssue[];
  settings: AppSettings[];
}
