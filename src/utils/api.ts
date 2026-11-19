import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import type {
  AiAssessment,
  AppNotification,
  AppSettings,
  AuditLogEntry,
  Certificate,
  Donation,
  DonorProfile,
  FoodSafetyPassport,
  MatchRecommendation,
  NgoProfile,
  NgoRequirement,
  Offer,
  OutboxMessage,
  Pickup,
  Rating,
  ReportIssue,
  Role,
  User,
  VolunteerProfile,
} from '../shared/types';

const TOKEN_KEY = 'foodbridge_session_token';

export function getStoredToken(): string {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setStoredToken(token: string): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) headers['x-fb-token'] = token;

  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  }
  return data as T;
}

export interface WorkspaceState {
  user: Omit<User, 'passwordHash'>;
  profile: DonorProfile | NgoProfile | VolunteerProfile | null;
  donations: (Donation & { donorContactPhone?: string })[];
  passports: FoodSafetyPassport[];
  assessments: AiAssessment[];
  matches: MatchRecommendation[];
  offers: Offer[];
  pickups: Pickup[];
  groupedRoute: {
    pickupIds: string[];
    stops: Array<{
      pickupId: string;
      donationId: string;
      type: 'pickup' | 'dropoff';
      label: string;
      location: { lat: number; lng: number; area: string; address: string };
      legDistanceKm: number;
    }>;
    totalDistanceKm: number;
    estimatedTotalMins: number;
  } | null;
  deliveries: Array<{
    id: string;
    donationId: string;
    pickupId: string;
    ngoId: string;
    verifiedAt?: string;
    verifiedByMethod?: 'OTP' | 'QR';
    ratedAt?: string;
    otpPlainForAuthorizedRoles?: string;
    qrToken?: string;
  }>;
  certificates: Certificate[];
  ngos: NgoProfile[];
  ngoRequirements: NgoRequirement[];
  volunteers: VolunteerProfile[];
  donors: Array<Partial<DonorProfile> & { id: string; organizationName: string }>;
  notifications: AppNotification[];
  outboxMessages: OutboxMessage[];
  ratings: Rating[];
  auditLog: AuditLogEntry[];
  reports: ReportIssue[];
  anomalies: Array<{
    type: string;
    donationId?: string;
    message: string;
    severity: 'warning' | 'critical';
  }>;
  settings: AppSettings;
  demoAccounts: Array<{ id: string; name: string; email: string; role: Role }>;
}

export interface ImpactAnalyticsResponse {
  kpis: {
    kgRedistributed: number;
    mealsProvided: number;
    wasteAvoidedKg: number;
    completedDonations: number;
    successRatePct: number;
    ngosSupported: number;
    peopleReachedEstimate: number;
    volunteerPickups: number;
    avgPostToAcceptMins: number;
    avgAcceptToDeliverMins: number;
    cancelExpireRatePct: number;
    estimatedCo2eKg: number;
  };
  assumptions: { kgPerMeal: number; co2eKgPerKgFood: number };
  disclaimer: string;
  charts: {
    overTime: Array<{ date: string; kg: number; meals: number }>;
    categoryMix: Array<{ category: string; kg: number }>;
    funnel: Array<{ stage: string; count: number }>;
    ngoDistribution: Array<{ ngoName: string; meals: number }>;
    rejectionReasons: Array<{ reason: string; count: number }>;
  };
  forecastBaseline: {
    isPreliminary: boolean;
    sampleSize: number;
    byWeekday: Array<{ day: string; avgSurplusKg: number; expectedDonations: number }>;
    peakHours: Array<{ window: string; count: number; sharePct: number }>;
    topCategories: Array<{ category: string; totalKg: number; wastedKg: number }>;
    shortageCategories: Array<{ category: string; unmetDemandKg: number }>;
  };
}

export function formatTimeRemaining(isoTarget: string, nowMs: number): string {
  const diff = new Date(isoTarget).getTime() - nowMs;
  if (diff <= 0) return 'Expired';
  const totalSec = Math.floor(diff / 1000);
  const hrs = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hrs > 0) return `${hrs}h ${String(mins).padStart(2, '0')}m`;
  return `${mins}m ${String(secs).padStart(2, '0')}s`;
}

export async function downloadCertificatePdf(cert: Certificate) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const p = cert.payload;

  doc.setFillColor(21, 128, 61);
  doc.rect(0, 0, 595, 86, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.text('FoodBridge AI — Verified Donation Certificate', 40, 44);
  doc.setFontSize(10);
  doc.text(`Certificate ID: ${p.certificateId}   |   Algorithm: ${cert.algorithm}`, 40, 66);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(12);
  let y = 124;
  const rows: Array<[string, string]> = [
    ['Donation ID', p.donationId],
    ['Listing Title', p.title],
    ['Donor Organization', p.donorName],
    ['Recipient NGO', p.ngoName],
    ['Category & Dietary', `${p.category} (${p.dietaryType})`],
    ['Quantity Redistributed', `${p.portions} meals (${p.quantityKg} kg)`],
    ['Prepared At', new Date(p.preparedAt).toLocaleString()],
    ['Safe Until Limit', new Date(p.safeUntil).toLocaleString()],
    ['Handover Confirmed', `${new Date(p.handoverAt).toLocaleString()} (${p.handoverMethod})`],
    ['Safety Passport Summary', p.safetySummary],
    ['Issued At', new Date(p.issuedAt).toLocaleString()],
  ];

  for (const [label, value] of rows) {
    doc.setFont('helvetica', 'bold');
    doc.text(`${label}:`, 40, y);
    doc.setFont('helvetica', 'normal');
    doc.text(value, 200, y, { maxWidth: 350 });
    y += 26;
  }

  doc.setDrawColor(226, 232, 240);
  doc.line(40, y + 10, 555, y + 10);
  y += 32;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('HMAC-SHA256 Signature:', 40, y);
  doc.setFont('courier', 'normal');
  doc.setFontSize(8);
  doc.text(cert.signature, 40, y + 16, { maxWidth: 380 });

  const verifyUrl = `${window.location.origin}/?verify=${encodeURIComponent(cert.id)}`;
  const qrDataUrl = await QRCode.toDataURL(verifyUrl, { width: 110, margin: 1 });
  doc.addImage(qrDataUrl, 'PNG', 445, y - 10, 105, 105);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Scan to verify authenticity', 447, y + 105);

  doc.save(`${cert.id}.pdf`);
}

export function downloadCertificateJson(cert: Certificate) {
  const blob = new Blob([JSON.stringify(cert, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${cert.id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
