import crypto from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import type {
  Certificate,
  CertificatePayload,
  Donation,
  FoodCategory,
  Role,
  User,
} from './src/shared/types';
import {
  assessFood,
  checkAiRateLimit,
  explainMatch,
  forecastSurplusAndDemand,
  generateDashboardInsights,
  runAssistant,
  summarizeAnomalies,
} from './server/ai';
import {
  appendAudit,
  appendNotification,
  appendOutbox,
  getDb,
  nextId,
  resetDatabase,
  withTransaction,
} from './server/db';
import {
  assertTransition,
  computeForecastBaseline,
  computeGroupedPickupRoute,
  computeNgoTrustScore,
  computeUrgency,
  estimateTravelMinutes,
  hashOtp,
  haversineDistanceKm,
  IMPACT_FOOTER_DISCLAIMER,
  matchNgosForDonation,
  runRuleBasedSafetyChecks,
  signCertificatePayload,
  verifyCertificateSignature,
} from './server/engine';
import { runLifecycleTick, startScheduler } from './server/scheduler';
import { demoPasswordHash } from './server/seed';

dotenv.config();

const PORT = 3000;
const SESSION_SECRET =
  process.env.CERTIFICATE_SIGNING_SECRET || 'foodbridge-session-signing-secret';

interface AuthedRequest extends Request {
  authUser?: User;
}

function createSessionToken(user: User): string {
  const payload = Buffer.from(
    JSON.stringify({ userId: user.id, role: user.role, iat: Date.now() })
  ).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifySessionToken(token: string): { userId: string; role: Role } | null {
  try {
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return null;
    const expected = crypto
      .createHmac('sha256', SESSION_SECRET)
      .update(payload)
      .digest('base64url');
    if (sig !== expected) return null;
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as {
      userId: string;
      role: Role;
    };
    return parsed;
  } catch {
    return null;
  }
}

function authMiddleware(req: AuthedRequest, _res: Response, next: NextFunction) {
  const headerToken = req.headers['x-fb-token'];
  const authHeader = req.headers.authorization;
  const raw =
    typeof headerToken === 'string'
      ? headerToken
      : typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : '';
  if (raw) {
    const decoded = verifySessionToken(raw);
    if (decoded) {
      const db = getDb();
      const user = db.users.find((u) => u.id === decoded.userId);
      if (user) req.authUser = user;
    }
  }
  next();
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.authUser) {
    return res.status(401).json({ error: 'Authentication required. Please log in or select a demo role.' });
  }
  next();
}

function requireRole(...roles: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.authUser) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!roles.includes(req.authUser.role)) {
      return res.status(403).json({
        error: `Access denied for role "${req.authUser.role}". Allowed: ${roles.join(', ')}.`,
      });
    }
    next();
  };
}

function sanitizeUser(u: User) {
  const { passwordHash: _ph, ...safe } = u;
  return safe;
}

// Role-based redaction for donations, contacts, and OTPs
function buildRoleScopedView(user: User | undefined) {
  const db = getDb();
  const settings = db.settings[0];

  const isAcceptedOrBeyond = (status: Donation['status']) =>
    ['Accepted', 'Pickup Scheduled', 'In Transit', 'Delivered', 'Completed'].includes(status);

  const scopedDonations = db.donations
    .filter((d) => {
      if (!user) return d.status === 'Completed';
      if (user.role === 'donor') return d.donorId === user.profileId;
      return true;
    })
    .map((d) => {
      const donor = db.donors.find((dn) => dn.id === d.donorId);
      const donorUser = db.users.find((u) => u.id === donor?.userId);
      const canSeeDonorContact =
        user?.role === 'admin' ||
        (user?.role === 'donor' && d.donorId === user.profileId) ||
        (user?.role === 'ngo' &&
          d.assignedNgoId === user.profileId &&
          isAcceptedOrBeyond(d.status)) ||
        (user?.role === 'volunteer' && isAcceptedOrBeyond(d.status));

      return {
        ...d,
        donorContactPhone: canSeeDonorContact ? donorUser?.phone : undefined,
        location: canSeeDonorContact
          ? d.location
          : { ...d.location, address: `${d.location.area} (Exact address shared upon acceptance)` },
      };
    });

  const scopedDeliveries = db.deliveries.map((del) => {
    const canSeeOtp =
      user?.role === 'admin' ||
      (user?.role === 'ngo' && del.ngoId === user.profileId);
    return {
      id: del.id,
      donationId: del.donationId,
      pickupId: del.pickupId,
      ngoId: del.ngoId,
      verifiedAt: del.verifiedAt,
      verifiedByMethod: del.verifiedByMethod,
      ratedAt: del.ratedAt,
      otpPlainForAuthorizedRoles: canSeeOtp ? del.otpPlainForAuthorizedRoles : undefined,
      qrToken: canSeeOtp ? del.qrToken : undefined,
    };
  });

  return {
    donations: scopedDonations,
    deliveries: scopedDeliveries,
    settings,
  };
}

function detectAnomalies(db = getDb()) {
  const flags: Array<{
    type: string;
    donationId?: string;
    message: string;
    severity: 'warning' | 'critical';
  }> = [];

  for (const d of db.donations) {
    const donor = db.donors.find((dn) => dn.id === d.donorId);
    const avgKg = (donor?.averagePortions ?? 40) * 0.4;
    if (d.quantityKg >= avgKg * 5) {
      flags.push({
        type: 'QUANTITY_ANOMALY',
        donationId: d.id,
        severity: 'warning',
        message: `${d.donorName} posted ${d.quantityKg} kg (${d.title}), >5× usual average (${avgKg.toFixed(1)} kg).`,
      });
    }
    const fsp = db.food_safety_passports.find((p) => p.donationId === d.id);
    for (const rf of fsp?.ruleFlags ?? []) {
      if (rf.severity === 'critical') {
        flags.push({
          type: rf.code,
          donationId: d.id,
          severity: 'critical',
          message: `${d.title}: ${rf.message}`,
        });
      }
    }
  }

  // Repeated rejections or expiries by donor
  const expiredByDonor = new Map<string, number>();
  for (const d of db.donations) {
    if (d.status === 'Expired' || d.status === 'Rejected') {
      expiredByDonor.set(d.donorName, (expiredByDonor.get(d.donorName) ?? 0) + 1);
    }
  }
  for (const [donorName, count] of expiredByDonor.entries()) {
    if (count >= 2) {
      flags.push({
        type: 'REPEAT_EXPIRY_OR_REJECTION',
        severity: 'warning',
        message: `${donorName} has ${count} expired or rejected donations requiring follow-up.`,
      });
    }
  }

  return flags;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '6mb' }));
  app.use(authMiddleware);

  // Start background escalation & expiry scheduler
  startScheduler();

  // Health
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      geminiConfigured: Boolean(
        process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
      ),
      model: process.env.GEMINI_MODEL || 'gemini-4-hydrogen',
    });
  });

  // Public impact summary (for Landing page)
  app.get('/api/public/impact', (_req, res) => {
    const db = getDb();
    const settings = db.settings[0];
    const completed = db.donations.filter((d) => d.status === 'Completed');
    const totalKg = Math.round(completed.reduce((s, d) => s + d.quantityKg, 0) * 10) / 10;
    const totalMeals = completed.reduce((s, d) => s + d.portions, 0);
    const ngosSupported = new Set(completed.map((d) => d.assignedNgoId).filter(Boolean)).size;
    const co2eAvoided = Math.round(totalKg * settings.assumptions.co2eKgPerKgFood * 10) / 10;
    res.json({
      completedDonations: completed.length,
      redistributedKg: totalKg,
      mealsProvided: totalMeals,
      ngosSupported,
      estimatedCo2eAvoidedKg: co2eAvoided,
      verifiedNgosCount: db.ngos.filter((n) => n.verificationStatus === 'Verified').length,
      activeVolunteersCount: db.volunteers.filter((v) => v.isAvailable).length,
      assumptions: settings.assumptions,
      disclaimer: IMPACT_FOOTER_DISCLAIMER,
    });
  });

  // Auth routes
  app.get('/api/auth/me', (req: AuthedRequest, res) => {
    if (!req.authUser) return res.json({ user: null });
    const db = getDb();
    const profile =
      req.authUser.role === 'donor'
        ? db.donors.find((d) => d.id === req.authUser!.profileId)
        : req.authUser.role === 'ngo'
        ? db.ngos.find((n) => n.id === req.authUser!.profileId)
        : req.authUser.role === 'volunteer'
        ? db.volunteers.find((v) => v.id === req.authUser!.profileId)
        : { id: 'admin_prof_1', organizationName: 'FoodBridge Operations' };
    res.json({ user: sanitizeUser(req.authUser), profile });
  });

  app.post('/api/auth/demo-switch', (req, res) => {
    const { role, email } = req.body as { role?: Role; email?: string };
    const db = getDb();
    const user = email
      ? db.users.find((u) => u.email === email)
      : db.users.find((u) => u.role === role);
    if (!user) return res.status(404).json({ error: 'Demo account not found.' });
    const token = createSessionToken(user);
    res.json({ token, user: sanitizeUser(user) });
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }
    const db = getDb();
    const user = db.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user || user.passwordHash !== demoPasswordHash(password)) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    const token = createSessionToken(user);
    res.json({ token, user: sanitizeUser(user) });
  });

  app.post('/api/auth/register', async (req, res) => {
    const {
      name,
      email,
      password,
      role,
      phone,
      organizationName,
      businessType,
      fssaiLicenseNumber,
      area,
      address,
      vehicleType,
      peopleServed,
      vegOnly,
    } = req.body as Record<string, unknown>;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'Name, email, password, and role are required.' });
    }
    if (!['donor', 'ngo', 'volunteer'].includes(String(role))) {
      return res.status(400).json({ error: 'Public registration is allowed for donor, ngo, or volunteer only.' });
    }

    try {
      const result = await withTransaction((db) => {
        const cleanEmail = String(email).trim().toLowerCase();
        if (db.users.some((u) => u.email.toLowerCase() === cleanEmail)) {
          throw Object.assign(new Error('An account with this email already exists.'), { status: 409 });
        }
        const now = new Date().toISOString();
        const userId = nextId('usr');
        const profileId = nextId(String(role).slice(0, 3));
        const userRole = role as Role;
        const geo = {
          lat: 12.9716 + (Math.random() - 0.5) * 0.04,
          lng: 77.5946 + (Math.random() - 0.5) * 0.04,
          area: String(area || 'Central Bengaluru'),
          address: String(address || 'MG Road, Bengaluru'),
        };

        const newUser: User = {
          id: userId,
          name: String(name),
          email: cleanEmail,
          passwordHash: demoPasswordHash(String(password)),
          role: userRole,
          phone: String(phone || '+91-98000-00000'),
          profileId,
          created_at: now,
          updated_at: now,
        };
        db.users.push(newUser);

        if (userRole === 'donor') {
          db.donors.push({
            id: profileId,
            userId,
            organizationName: String(organizationName || `${name} Kitchen`),
            businessType: (businessType as 'Restaurant') || 'Restaurant',
            fssaiLicenseNumber: String(fssaiLicenseNumber || ''),
            location: geo,
            averagePortions: 35,
            recurringTemplates: [],
            created_at: now,
            updated_at: now,
          });
        } else if (userRole === 'ngo') {
          db.ngos.push({
            id: profileId,
            userId,
            organizationName: String(organizationName || `${name} Foundation`),
            serviceArea: geo.area,
            peopleServed: Number(peopleServed) || 120,
            servedGroups: ['general'],
            operatingHours: { openHour: 7, closeHour: 22 },
            storageCapacityKg: { cold: 40, ambient: 80 },
            currentUsedKg: { cold: 0, ambient: 0 },
            hasVehicle: false,
            dietaryRules: {
              vegOnly: Boolean(vegOnly),
              allowsEgg: !Boolean(vegOnly),
              allowsNonVeg: !Boolean(vegOnly),
            },
            verificationStatus: 'Pending',
            trustScore: 75,
            completedPickups: 0,
            totalAssignedPickups: 0,
            avgResponseMinutes: 10,
            avgDonorRating: 4.5,
            isAvailable: true,
            location: geo,
            phone: newUser.phone,
            created_at: now,
            updated_at: now,
          });
        } else {
          db.volunteers.push({
            id: profileId,
            userId,
            name: String(name),
            vehicleType: (vehicleType as 'Bike') || 'Bike',
            area: geo.area,
            isAvailable: true,
            maxRadiusKm: 12,
            location: geo,
            tasksCompleted: 0,
            mealsMoved: 0,
            badges: ['New Volunteer'],
            created_at: now,
            updated_at: now,
          });
        }

        appendAudit(db, {
          actorUserId: userId,
          actorName: newUser.name,
          actorRole: userRole,
          action: 'User Registered',
          note: `New ${userRole} registered (${cleanEmail}).`,
        });

        return { token: createSessionToken(newUser), user: sanitizeUser(newUser) };
      });
      res.status(201).json(result);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      res.status(e.status || 400).json({ error: e.message || 'Registration failed.' });
    }
  });

  // Main synchronized dashboard snapshot endpoint
  app.get('/api/workspace/state', requireAuth, async (req: AuthedRequest, res) => {
    await runLifecycleTick();
    const db = getDb();
    const user = req.authUser!;
    const scoped = buildRoleScopedView(user);

    const openPickups = db.pickups.filter((p) => p.status === 'Open');
    const volunteerProfile =
      user.role === 'volunteer'
        ? db.volunteers.find((v) => v.id === user.profileId)
        : db.volunteers[0];
    const groupedRoute = volunteerProfile
      ? computeGroupedPickupRoute(
          openPickups,
          volunteerProfile.location,
          db.settings[0].groupedPickupRadiusKm
        )
      : null;

    const myDonorProfile =
      user.role === 'donor' ? db.donors.find((d) => d.id === user.profileId) : undefined;
    const myNgoProfile =
      user.role === 'ngo' ? db.ngos.find((n) => n.id === user.profileId) : undefined;

    const notifications = db.notifications.filter(
      (n) =>
        n.targetRole === 'all' ||
        n.targetRole === user.role ||
        (n.targetUserId && n.targetUserId === user.id)
    );

    const visibleOffers =
      user.role === 'admin'
        ? db.offers
        : user.role === 'ngo'
        ? db.offers.filter((o) => o.ngoId === user.profileId)
        : user.role === 'donor'
        ? db.offers.filter((o) =>
            scoped.donations.some((d) => d.id === o.donationId)
          )
        : [];

    res.json({
      user: sanitizeUser(user),
      profile: myDonorProfile || myNgoProfile || volunteerProfile || null,
      donations: scoped.donations,
      passports: db.food_safety_passports.filter((p) =>
        scoped.donations.some((d) => d.id === p.donationId)
      ),
      assessments: db.ai_assessments.filter((a) =>
        scoped.donations.some((d) => d.id === a.donationId)
      ),
      matches: db.match_recommendations.filter((m) =>
        scoped.donations.some((d) => d.id === m.donationId)
      ),
      offers: visibleOffers,
      pickups: db.pickups,
      groupedRoute,
      deliveries: scoped.deliveries,
      certificates: db.certificates.filter((c) =>
        user.role === 'admin' || scoped.donations.some((d) => d.id === c.donationId)
      ),
      ngos: db.ngos.map((n) => ({
        ...n,
        phone: user.role === 'admin' || n.id === user.profileId ? n.phone : undefined,
      })),
      ngoRequirements: db.ngo_requirements,
      volunteers: db.volunteers,
      donors: user.role === 'admin' ? db.donors : db.donors.map((d) => ({ id: d.id, organizationName: d.organizationName, businessType: d.businessType, location: d.location })),
      notifications,
      outboxMessages: db.outbox_messages,
      ratings: db.ratings,
      auditLog:
        user.role === 'admin'
          ? db.audit_log
          : db.audit_log.filter((a) => !a.donationId || scoped.donations.some((d) => d.id === a.donationId)),
      reports: db.reports_issues,
      anomalies: user.role === 'admin' ? detectAnomalies(db) : [],
      settings: scoped.settings,
      demoAccounts: db.users
        .filter((u) =>
          ['donor@foodbridge.demo', 'ngo@foodbridge.demo', 'hope@foodbridge.demo', 'volunteer@foodbridge.demo', 'admin@foodbridge.demo'].includes(
            u.email
          )
        )
        .map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role })),
    });
  });

  // Create Donation (Donor or Admin) with Validation, Duplicate Check, Safety Passport & Gemini Assessment
  app.post('/api/donations', requireRole('donor', 'admin'), async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const body = req.body as Record<string, unknown>;
    const title = String(body.title || '').trim();
    const category = body.category as FoodCategory;
    const dietaryType = body.dietaryType as Donation['dietaryType'];
    const portions = Number(body.portions);
    const quantityKg = Number(body.quantityKg);
    const preparedAt = String(body.preparedAt || '');
    const readyBy = String(body.readyBy || new Date().toISOString());
    const pickupWindowEnd = String(
      body.pickupWindowEnd || new Date(Date.now() + 2 * 3600000).toISOString()
    );
    const storageMethod = body.storageMethod as Donation['storageMethod'];
    const temperatureC =
      body.temperatureC !== undefined && body.temperatureC !== ''
        ? Number(body.temperatureC)
        : undefined;
    const packaging = String(body.packaging || 'Sealed food-grade containers').trim();
    const allergens = Array.isArray(body.allergens)
      ? body.allergens.map(String)
      : ['None declared'];
    const photos = Array.isArray(body.photos) ? body.photos.map(String).slice(0, 3) : [];
    const isBulkEvent = Boolean(body.isBulkEvent);
    const eventName = body.eventName ? String(body.eventName).trim() : undefined;

    if (!title || !category || !dietaryType || !storageMethod) {
      return res.status(400).json({ error: 'Title, category, dietary type, and storage method are required.' });
    }
    if (!Number.isFinite(portions) || portions < 1 || portions > 5000) {
      return res.status(400).json({ error: 'Portions must be between 1 and 5000.' });
    }
    if (!Number.isFinite(quantityKg) || quantityKg <= 0 || quantityKg > 2000) {
      return res.status(400).json({ error: 'Quantity (kg) must be between 0.1 and 2000.' });
    }
    if (new Date(readyBy).getTime() < Date.now() - 15 * 60000) {
      return res.status(400).json({ error: 'Ready-by time cannot be more than 15 minutes in the past.' });
    }

    // Validate photo payloads
    for (const p of photos) {
      const isAllowedLocal = p.startsWith('/src/assets/');
      const isAllowedData = p.startsWith('data:image/') && p.length < 3_500_000;
      if (!isAllowedLocal && !isAllowedData) {
        return res.status(400).json({ error: 'Invalid photo format or file exceeds 2.5 MB limit.' });
      }
    }

    try {
      const created = await withTransaction(async (db) => {
        const donor =
          db.donors.find((d) => d.id === (body.donorId || user.profileId)) || db.donors[0];
        if (!donor) throw Object.assign(new Error('Donor profile not found.'), { status: 404 });

        // Duplicate submission check (same donor + category + within 30 mins of readyBy)
        const readyMs = new Date(readyBy).getTime();
        const duplicate = db.donations.find(
          (d) =>
            d.donorId === donor.id &&
            d.category === category &&
            !['Cancelled', 'Rejected', 'Expired'].includes(d.status) &&
            Math.abs(new Date(d.readyBy).getTime() - readyMs) < 30 * 60000 &&
            d.title.toLowerCase() === title.toLowerCase()
        );
        if (duplicate) {
          throw Object.assign(
            new Error(
              `Duplicate donation blocked: "${duplicate.title}" for ${category} already exists in this 30-minute window.`
            ),
            { status: 409 }
          );
        }

        const settings = db.settings[0];
        const nowIso = new Date().toISOString();
        const safetyCheck = runRuleBasedSafetyChecks(
          {
            preparedAt,
            category,
            storageMethod,
            temperatureC,
            allergens,
            quantityKg,
            photos,
            donorAverageKg: donor.averagePortions * settings.assumptions.kgPerMeal,
          },
          settings.foodSafetyRules
        );

        const urgency = computeUrgency(
          safetyCheck.safeUntil,
          Date.now(),
          settings.urgencyThresholdsMinutes
        );

        const donId = nextId('don');
        const donation: Donation = {
          id: donId,
          donorId: donor.id,
          donorName: donor.organizationName,
          title,
          category,
          dietaryType,
          allergens,
          portions,
          quantityKg,
          preparedAt: preparedAt || nowIso,
          readyBy,
          pickupWindowEnd,
          storageMethod,
          temperatureC,
          packaging,
          photos,
          status: 'Pending Review',
          urgency,
          safeUntil: safetyCheck.safeUntil,
          isBulkEvent,
          eventName,
          location: donor.location,
          created_at: nowIso,
          updated_at: nowIso,
        };

        db.donations.unshift(donation);

        db.food_safety_passports.unshift({
          id: nextId('fsp'),
          donationId: donId,
          preparedAt: donation.preparedAt,
          storageMethod,
          temperatureC,
          allergens,
          dietaryType,
          packaging,
          safeUntil: safetyCheck.safeUntil,
          ruleFlags: safetyCheck.flags,
          created_at: nowIso,
          updated_at: nowIso,
        });

        const assessmentData = await assessFood(
          donation,
          safetyCheck.flags,
          settings.demoAiMode
        );
        const assessment = {
          id: nextId('aia'),
          ...assessmentData,
          created_at: nowIso,
          updated_at: nowIso,
        };
        db.ai_assessments.unshift(assessment);

        appendAudit(db, {
          donationId: donId,
          actorUserId: user.id,
          actorName: user.name,
          actorRole: user.role,
          action: isBulkEvent ? 'Bulk Event Alert Submitted' : 'Donation Submitted',
          toStatus: 'Pending Review',
          note: `${portions} portions (${quantityKg} kg) of ${title}. ${safetyCheck.flags.length} safety flag(s).`,
        });

        appendNotification(db, {
          targetRole: 'admin',
          eventType: safetyCheck.flags.some((f) => f.severity === 'critical')
            ? 'safety_warning'
            : 'new_donation',
          title: isBulkEvent ? 'Bulk Event Surplus awaiting review' : 'New donation awaiting safety review',
          message: `${donor.organizationName} posted "${title}" (${portions} meals).`,
          donationId: donId,
        });

        return { donation, assessment, ruleFlags: safetyCheck.flags };
      });

      res.status(201).json(created);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      res.status(e.status || 400).json({ error: e.message || 'Could not create donation.' });
    }
  });

  // Save or trigger recurring donation template
  app.post('/api/donor/recurring-templates', requireRole('donor'), async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const body = req.body as Record<string, unknown>;
    if (!body.title || !body.category) {
      return res.status(400).json({ error: 'Template title and category are required.' });
    }
    const template = await withTransaction((db) => {
      const donor = db.donors.find((d) => d.id === user.profileId);
      if (!donor) throw new Error('Donor profile not found');
      const tmpl = {
        id: nextId('tmpl'),
        title: String(body.title),
        category: body.category as FoodCategory,
        dietaryType: (body.dietaryType as Donation['dietaryType']) || 'Veg',
        allergens: Array.isArray(body.allergens) ? body.allergens.map(String) : ['None declared'],
        portions: Number(body.portions) || 25,
        quantityKg: Number(body.quantityKg) || 10,
        storageMethod: (body.storageMethod as Donation['storageMethod']) || 'Hot Held',
        packaging: String(body.packaging || 'Sealed trays'),
        scheduleLabel: String(body.scheduleLabel || 'Daily at 21:00'),
        active: true,
      };
      donor.recurringTemplates.push(tmpl);
      donor.updated_at = new Date().toISOString();
      return tmpl;
    });
    res.status(201).json(template);
  });

  // Retry Gemini Assessment
  app.post('/api/ai/assess/:donationId', requireAuth, async (req: AuthedRequest, res) => {
    if (!checkAiRateLimit()) return res.status(429).json({ error: 'AI rate limit reached; try again shortly.' });
    try {
      const updated = await withTransaction(async (db) => {
        const donation = db.donations.find((d) => d.id === req.params.donationId);
        if (!donation) throw Object.assign(new Error('Donation not found.'), { status: 404 });
        const passport = db.food_safety_passports.find((p) => p.donationId === donation.id);
        const data = await assessFood(
          donation,
          passport?.ruleFlags ?? [],
          db.settings[0].demoAiMode
        );
        const now = new Date().toISOString();
        const idx = db.ai_assessments.findIndex((a) => a.donationId === donation.id);
        const record = { id: idx >= 0 ? db.ai_assessments[idx].id : nextId('aia'), ...data, created_at: now, updated_at: now };
        if (idx >= 0) db.ai_assessments[idx] = record;
        else db.ai_assessments.unshift(record);
        return record;
      });
      res.json(updated);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      res.status(e.status || 400).json({ error: e.message || 'AI assessment failed.' });
    }
  });

  // Admin Safety Review (Approve or Reject with mandatory note) -> triggers Matching Engine on Approval
  app.post('/api/donations/:id/review', requireRole('admin'), async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const { decision, note } = req.body as { decision?: 'approve' | 'reject'; note?: string };
    if (!decision || !note || note.trim().length < 3) {
      return res.status(400).json({ error: 'Decision ("approve" or "reject") and a mandatory review note are required.' });
    }

    try {
      const result = await withTransaction(async (db) => {
        const donation = db.donations.find((d) => d.id === req.params.id);
        if (!donation) throw Object.assign(new Error('Donation not found.'), { status: 404 });
        const prev = donation.status;
        const now = new Date().toISOString();

        if (decision === 'reject') {
          assertTransition(prev, 'Rejected');
          donation.status = 'Rejected';
          donation.adminNote = note.trim();
          donation.updated_at = now;

          appendAudit(db, {
            donationId: donation.id,
            actorUserId: user.id,
            actorName: user.name,
            actorRole: 'admin',
            action: 'Donation Rejected',
            fromStatus: prev,
            toStatus: 'Rejected',
            note: note.trim(),
          });

          const donor = db.donors.find((dn) => dn.id === donation.donorId);
          appendNotification(db, {
            targetRole: 'donor',
            targetUserId: donor?.userId,
            eventType: 'rejected',
            title: 'Donation rejected during safety review',
            message: `${donation.title}: ${note.trim()}`,
            donationId: donation.id,
          });
          return { donation };
        }

        // Approve -> compute deterministic matches + Gemini match explanations
        assertTransition(prev, 'Approved');
        donation.status = 'Approved';
        donation.adminNote = note.trim();
        assertTransition('Approved', 'Matching');
        donation.status = 'Matching';
        donation.updated_at = now;

        const settings = db.settings[0];
        const matchRes = matchNgosForDonation(
          donation,
          db.ngos,
          db.ngo_requirements,
          settings
        );
        const explainRes = await explainMatch(
          donation,
          matchRes.candidates,
          settings.demoAiMode
        );
        for (const cand of matchRes.candidates) {
          if (explainRes.explanations[cand.ngoId]) {
            cand.aiExplanation = explainRes.explanations[cand.ngoId];
          }
        }

        const existingMatchIdx = db.match_recommendations.findIndex(
          (m) => m.donationId === donation.id
        );
        const matchRec = {
          id: existingMatchIdx >= 0 ? db.match_recommendations[existingMatchIdx].id : nextId('mr'),
          donationId: donation.id,
          weights: matchRes.weights,
          candidates: matchRes.candidates,
          aiSummarySource: explainRes.source,
          created_at: now,
          updated_at: now,
        };
        if (existingMatchIdx >= 0) db.match_recommendations[existingMatchIdx] = matchRec;
        else db.match_recommendations.unshift(matchRec);

        appendAudit(db, {
          donationId: donation.id,
          actorUserId: user.id,
          actorName: user.name,
          actorRole: 'admin',
          action: 'Safety Review Approved & Matched',
          fromStatus: prev,
          toStatus: 'Matching',
          note: `${note.trim()} (${matchRes.candidates.filter((c) => c.eligible).length} eligible NGOs ranked)`,
        });

        const donor = db.donors.find((dn) => dn.id === donation.donorId);
        appendNotification(db, {
          targetRole: 'donor',
          targetUserId: donor?.userId,
          eventType: 'approved',
          title: 'Donation approved & NGOs matched',
          message: `${donation.title} approved. Ready to send offers to ranked NGOs.`,
          donationId: donation.id,
        });

        // If Bulk Event Alert, automatically broadcast to top 3 NGOs
        if (donation.isBulkEvent) {
          const top3 = matchRes.candidates.filter((c) => c.eligible).slice(0, 3);
          if (top3.length > 0) {
            assertTransition(donation.status, 'Awaiting NGO Acceptance');
            donation.status = 'Awaiting NGO Acceptance';
            const groupId = nextId('bcast');
            const timeoutMs =
              (settings.fastForwardTimers ? 30 : settings.escalationTimeoutSeconds) * 1000;
            const expiresAt = new Date(Date.now() + timeoutMs).toISOString();
            top3.forEach((cand, idx) => {
              db.offers.push({
                id: nextId('off'),
                donationId: donation.id,
                ngoId: cand.ngoId,
                ngoName: cand.ngoName,
                rankOrder: idx + 1,
                broadcastGroupId: groupId,
                status: 'Pending',
                sentAt: now,
                expiresAt,
                created_at: now,
                updated_at: now,
              });
              const targetNgo = db.ngos.find((n) => n.id === cand.ngoId);
              if (targetNgo) {
                appendNotification(db, {
                  targetRole: 'ngo',
                  targetUserId: targetNgo.userId,
                  eventType: 'ngo_offer',
                  title: 'Bulk Event Alert Offer',
                  message: `${donation.eventName || donation.title} (${donation.portions} meals) — first valid NGO acceptance wins.`,
                  donationId: donation.id,
                });
                appendOutbox(db, {
                  channel: 'WhatsApp',
                  recipientName: targetNgo.organizationName,
                  recipientPhone: targetNgo.phone,
                  language: 'en',
                  body: `[Simulated WhatsApp] BULK EVENT ALERT: ${donation.portions} meals (${donation.quantityKg} kg) from ${donation.donorName}. First acceptance wins!`,
                  donationId: donation.id,
                });
              }
            });
          }
        }

        return { donation, matchRec };
      });
      res.json(result);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      res.status(e.status || 400).json({ error: e.message || 'Review failed.' });
    }
  });

  // Send Offer (Top 1 or Broadcast Top 3)
  app.post('/api/donations/:id/send-offer', requireRole('donor', 'admin'), async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const { mode } = req.body as { mode?: 'top1' | 'broadcast' };
    try {
      const result = await withTransaction((db) => {
        const donation = db.donations.find((d) => d.id === req.params.id);
        if (!donation) throw Object.assign(new Error('Donation not found.'), { status: 404 });
        if (user.role === 'donor' && donation.donorId !== user.profileId) {
          throw Object.assign(new Error('Cannot send offers for another donor’s listing.'), { status: 403 });
        }
        assertTransition(donation.status, 'Awaiting NGO Acceptance');

        const matchRec = db.match_recommendations.find((m) => m.donationId === donation.id);
        const eligible = (matchRec?.candidates ?? []).filter((c) => c.eligible);
        if (eligible.length === 0) {
          throw Object.assign(new Error('No eligible NGOs found for this donation.'), { status: 400 });
        }

        const targets = mode === 'broadcast' ? eligible.slice(0, 3) : eligible.slice(0, 1);
        const settings = db.settings[0];
        const timeoutMs =
          (settings.fastForwardTimers ? 30 : settings.escalationTimeoutSeconds) * 1000;
        const now = new Date().toISOString();
        const expiresAt = new Date(Date.now() + timeoutMs).toISOString();
        const groupId = mode === 'broadcast' ? nextId('bcast') : undefined;

        const prev = donation.status;
        donation.status = 'Awaiting NGO Acceptance';
        donation.updated_at = now;

        const createdOffers = targets.map((cand, idx) => {
          const offer = {
            id: nextId('off'),
            donationId: donation.id,
            ngoId: cand.ngoId,
            ngoName: cand.ngoName,
            rankOrder: idx + 1,
            broadcastGroupId: groupId,
            status: 'Pending' as const,
            sentAt: now,
            expiresAt,
            created_at: now,
            updated_at: now,
          };
          db.offers.push(offer);

          const targetNgo = db.ngos.find((n) => n.id === cand.ngoId);
          if (targetNgo) {
            appendNotification(db, {
              targetRole: 'ngo',
              targetUserId: targetNgo.userId,
              eventType: 'ngo_offer',
              title: mode === 'broadcast' ? 'Broadcast surplus offer' : 'New surplus offer',
              message: `${donation.title} (${donation.portions} meals, Match ${cand.matchScore}/100) from ${donation.donorName}.`,
              donationId: donation.id,
            });
            appendOutbox(db, {
              channel: 'SMS',
              recipientName: targetNgo.organizationName,
              recipientPhone: targetNgo.phone,
              language: 'en',
              body: `[Simulated SMS] FoodBridge AI Offer: ${donation.title} (${donation.portions} meals, ${donation.quantityKg} kg). Match Score ${cand.matchScore}/100. Respond before timeout.`,
              donationId: donation.id,
            });
          }
          return offer;
        });

        appendAudit(db, {
          donationId: donation.id,
          actorUserId: user.id,
          actorName: user.name,
          actorRole: user.role,
          action: mode === 'broadcast' ? 'Offer Broadcast Sent (Top 3)' : 'Offer Sent to Top NGO',
          fromStatus: prev,
          toStatus: 'Awaiting NGO Acceptance',
          note: `Sent to ${targets.map((t) => t.ngoName).join(', ')} (timeout ${settings.fastForwardTimers ? 30 : settings.escalationTimeoutSeconds}s).`,
        });

        return { donation, offers: createdOffers };
      });
      res.json(result);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      res.status(e.status || 400).json({ error: e.message || 'Could not send offer.' });
    }
  });

  // NGO Accept Offer (Atomic lock prevents double-acceptance!)
  app.post('/api/offers/:id/accept', requireRole('ngo', 'admin'), async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const { selfDeliver } = (req.body || {}) as { selfDeliver?: boolean };
    try {
      const result = await withTransaction((db) => {
        const offer = db.offers.find((o) => o.id === req.params.id);
        if (!offer) throw Object.assign(new Error('Offer not found.'), { status: 404 });
        if (user.role === 'ngo' && offer.ngoId !== user.profileId) {
          throw Object.assign(new Error('You can only accept offers addressed to your NGO.'), { status: 403 });
        }

        const donation = db.donations.find((d) => d.id === offer.donationId);
        if (!donation) throw Object.assign(new Error('Donation not found.'), { status: 404 });

        // Atomic uniqueness check
        const existingAcceptance = db.acceptances.find((a) => a.donationId === donation.id);
        if (existingAcceptance || offer.status !== 'Pending') {
          throw Object.assign(
            new Error(
              `Acceptance blocked: donation was already accepted or offer is "${offer.status}".`
            ),
            { status: 409 }
          );
        }

        assertTransition(donation.status, 'Accepted');
        const now = new Date().toISOString();
        const ngo = db.ngos.find((n) => n.id === offer.ngoId)!;

        offer.status = 'Accepted';
        offer.respondedAt = now;
        offer.updated_at = now;

        // Auto-release any other pending offers for this donation (Broadcast mode)
        for (const other of db.offers) {
          if (other.donationId === donation.id && other.id !== offer.id && other.status === 'Pending') {
            other.status = 'Auto-Released';
            other.respondedAt = now;
            other.updated_at = now;
          }
        }

        const acceptance = {
          id: nextId('acc'),
          donationId: donation.id,
          offerId: offer.id,
          ngoId: ngo.id,
          acceptedByUserId: user.id,
          acceptedAt: now,
          created_at: now,
          updated_at: now,
        };
        db.acceptances.push(acceptance);

        donation.status = 'Accepted';
        donation.assignedNgoId = ngo.id;
        donation.assignedNgoName = ngo.organizationName;
        donation.updated_at = now;

        // Update NGO storage & response metrics
        if (donation.storageMethod === 'Refrigerated' || donation.storageMethod === 'Frozen') {
          ngo.currentUsedKg.cold += donation.quantityKg;
        } else {
          ngo.currentUsedKg.ambient += donation.quantityKg;
        }
        ngo.totalAssignedPickups += 1;
        const respMins = Math.max(
          1,
          Math.round((Date.now() - new Date(offer.sentAt).getTime()) / 60000)
        );
        ngo.avgResponseMinutes = Math.round((ngo.avgResponseMinutes * 3 + respMins) / 4);
        ngo.trustScore = computeNgoTrustScore(ngo);
        ngo.updated_at = now;

        // Create Pickup automatically
        const dist = haversineDistanceKm(donation.location, ngo.location);
        const pkId = nextId('pk');
        const pickup = {
          id: pkId,
          donationId: donation.id,
          ngoId: ngo.id,
          status: selfDeliver ? ('Claimed' as const) : ('Open' as const),
          selfDeliveryBy: selfDeliver ? ('ngo' as const) : undefined,
          volunteerName: selfDeliver ? `${ngo.organizationName} Vehicle` : undefined,
          pickupLocation: donation.location,
          dropoffLocation: ngo.location,
          distanceKm: dist,
          etaMins: estimateTravelMinutes(dist),
          safeUntil: donation.safeUntil,
          checklistCompleted: false,
          claimedAt: selfDeliver ? now : undefined,
          created_at: now,
          updated_at: now,
        };
        db.pickups.unshift(pickup);

        if (selfDeliver) {
          assertTransition('Accepted', 'Pickup Scheduled');
          donation.status = 'Pickup Scheduled';
        }

        // Create Delivery with 6-digit OTP & QR token
        const otp = String(Math.floor(100000 + Math.random() * 900000));
        const delivery = {
          id: nextId('del'),
          donationId: donation.id,
          pickupId: pkId,
          ngoId: ngo.id,
          otpHash: hashOtp(otp),
          otpPlainForAuthorizedRoles: otp,
          qrToken: `FB-QR-${donation.id}-${otp}`,
          created_at: now,
          updated_at: now,
        };
        db.deliveries.unshift(delivery);

        const donor = db.donors.find((dn) => dn.id === donation.donorId);
        appendAudit(db, {
          donationId: donation.id,
          actorUserId: user.id,
          actorName: user.name,
          actorRole: user.role,
          action: selfDeliver ? 'Offer Accepted (NGO Self-Pickup)' : 'Offer Accepted',
          fromStatus: 'Awaiting NGO Acceptance',
          toStatus: donation.status,
          note: `${ngo.organizationName} accepted ${donation.portions} meals. Handover OTP generated.`,
        });

        appendNotification(db, {
          targetRole: 'donor',
          targetUserId: donor?.userId,
          eventType: 'accepted',
          title: 'NGO accepted your donation',
          message: `${ngo.organizationName} accepted "${donation.title}".`,
          donationId: donation.id,
        });

        if (!selfDeliver) {
          appendNotification(db, {
            targetRole: 'volunteer',
            eventType: 'volunteer_needed',
            title: 'New open pickup task',
            message: `${donation.location.area} -> ${ngo.serviceArea} (${dist} km, ${donation.quantityKg} kg).`,
            donationId: donation.id,
          });
        }

        return { donation, acceptance, pickup, deliveryOtp: otp };
      });
      res.json(result);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      res.status(e.status || 400).json({ error: e.message || 'Could not accept offer.' });
    }
  });

  // NGO Reject Offer (requires reason, auto-escalates to next ranked NGO)
  app.post('/api/offers/:id/reject', requireRole('ngo', 'admin'), async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const { reason } = req.body as { reason?: string };
    if (!reason || reason.trim().length < 2) {
      return res.status(400).json({ error: 'A rejection reason is required.' });
    }
    try {
      const result = await withTransaction((db) => {
        const offer = db.offers.find((o) => o.id === req.params.id);
        if (!offer) throw Object.assign(new Error('Offer not found.'), { status: 404 });
        if (user.role === 'ngo' && offer.ngoId !== user.profileId) {
          throw Object.assign(new Error('Forbidden'), { status: 403 });
        }
        if (offer.status !== 'Pending') {
          throw Object.assign(new Error(`Offer is already "${offer.status}".`), { status: 409 });
        }
        const now = new Date().toISOString();
        offer.status = 'Rejected';
        offer.rejectionReason = reason.trim();
        offer.respondedAt = now;
        offer.updated_at = now;

        const donation = db.donations.find((d) => d.id === offer.donationId);
        let escalatedOffer = null;
        if (donation && donation.status === 'Awaiting NGO Acceptance') {
          const stillPending = db.offers.some(
            (o) => o.donationId === donation.id && o.status === 'Pending'
          );
          if (!stillPending) {
            const matchRec = db.match_recommendations.find((m) => m.donationId === donation.id);
            const tried = new Set(
              db.offers.filter((o) => o.donationId === donation.id).map((o) => o.ngoId)
            );
            const nextCand = matchRec?.candidates.find(
              (c) => c.eligible && !tried.has(c.ngoId)
            );
            if (nextCand) {
              const settings = db.settings[0];
              const timeoutMs =
                (settings.fastForwardTimers ? 30 : settings.escalationTimeoutSeconds) * 1000;
              escalatedOffer = {
                id: nextId('off'),
                donationId: donation.id,
                ngoId: nextCand.ngoId,
                ngoName: nextCand.ngoName,
                rankOrder: offer.rankOrder + 1,
                status: 'Pending' as const,
                sentAt: now,
                expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
                created_at: now,
                updated_at: now,
              };
              db.offers.push(escalatedOffer);
              const nextNgo = db.ngos.find((n) => n.id === nextCand.ngoId);
              if (nextNgo) {
                appendNotification(db, {
                  targetRole: 'ngo',
                  targetUserId: nextNgo.userId,
                  eventType: 'escalation',
                  title: 'Escalated offer available',
                  message: `${donation.title} (${donation.portions} meals) assigned to ${nextNgo.organizationName}.`,
                  donationId: donation.id,
                });
              }
            }
          }
        }

        appendAudit(db, {
          donationId: offer.donationId,
          actorUserId: user.id,
          actorName: user.name,
          actorRole: user.role,
          action: 'Offer Rejected',
          note: `${offer.ngoName} rejected: ${reason.trim()}.${escalatedOffer ? ` Auto-escalated to ${escalatedOffer.ngoName}.` : ''}`,
        });

        return { offer, escalatedOffer };
      });
      res.json(result);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      res.status(e.status || 400).json({ error: e.message || 'Rejection failed.' });
    }
  });

  // Volunteer Claim Pickup (Atomic lock prevents race condition!)
  app.post('/api/pickups/:id/claim', requireRole('volunteer', 'admin'), async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    try {
      const result = await withTransaction((db) => {
        const pk = db.pickups.find((p) => p.id === req.params.id);
        if (!pk) throw Object.assign(new Error('Pickup task not found.'), { status: 404 });
        if (pk.status !== 'Open' || pk.volunteerId) {
          throw Object.assign(
            new Error(`Pickup claim failed: already claimed by ${pk.volunteerName || 'another courier'}.`),
            { status: 409 }
          );
        }
        const donation = db.donations.find((d) => d.id === pk.donationId);
        if (!donation) throw Object.assign(new Error('Donation not found.'), { status: 404 });
        assertTransition(donation.status, 'Pickup Scheduled');

        const volunteer =
          db.volunteers.find((v) => v.id === user.profileId) || db.volunteers[0];
        const now = new Date().toISOString();

        pk.volunteerId = volunteer.id;
        pk.volunteerName = volunteer.name;
        pk.status = 'Claimed';
        pk.claimedAt = now;
        pk.simulatedVolunteerCoords = {
          lat: volunteer.location.lat,
          lng: volunteer.location.lng,
          updatedAt: now,
        };
        pk.updated_at = now;

        donation.status = 'Pickup Scheduled';
        donation.updated_at = now;

        appendAudit(db, {
          donationId: donation.id,
          actorUserId: user.id,
          actorName: user.name,
          actorRole: user.role,
          action: 'Pickup Claimed',
          fromStatus: 'Accepted',
          toStatus: 'Pickup Scheduled',
          note: `${volunteer.name} (${volunteer.vehicleType}) claimed pickup.`,
        });

        appendNotification(db, {
          targetRole: 'all',
          eventType: 'pickup_scheduled',
          title: 'Volunteer assigned for pickup',
          message: `${volunteer.name} is heading to ${donation.donorName}.`,
          donationId: donation.id,
        });

        return { pickup: pk, donation };
      });
      res.json(result);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      res.status(e.status || 409).json({ error: e.message || 'Claim failed.' });
    }
  });

  // Donor or NGO Self-Delivery fallback
  app.post('/api/pickups/:id/self-deliver', requireRole('donor', 'ngo', 'admin'), async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    try {
      const result = await withTransaction((db) => {
        const pk = db.pickups.find((p) => p.id === req.params.id);
        if (!pk) throw Object.assign(new Error('Pickup not found.'), { status: 404 });
        if (pk.status !== 'Open') throw Object.assign(new Error('Pickup is already assigned.'), { status: 409 });
        const donation = db.donations.find((d) => d.id === pk.donationId)!;
        assertTransition(donation.status, 'Pickup Scheduled');
        const now = new Date().toISOString();
        pk.selfDeliveryBy = user.role === 'donor' ? 'donor' : 'ngo';
        pk.volunteerName = `${user.name} (Self-Delivery)`;
        pk.status = 'Claimed';
        pk.claimedAt = now;
        pk.simulatedVolunteerCoords = { ...pk.pickupLocation, updatedAt: now };
        pk.updated_at = now;
        donation.status = 'Pickup Scheduled';
        donation.updated_at = now;

        appendAudit(db, {
          donationId: donation.id,
          actorUserId: user.id,
          actorName: user.name,
          actorRole: user.role,
          action: 'Self-Delivery Assigned',
          fromStatus: 'Accepted',
          toStatus: 'Pickup Scheduled',
          note: `${user.role.toUpperCase()} opted to self-deliver.`,
        });
        return { pickup: pk, donation };
      });
      res.json(result);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      res.status(e.status || 400).json({ error: e.message || 'Self-delivery failed.' });
    }
  });

  // Volunteer Safety Checklist -> In Transit
  app.post('/api/pickups/:id/checklist', requireRole('volunteer', 'donor', 'ngo', 'admin'), async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const { foodSealed, labeledWithTime, tempMaintained, photoCaptured, pickupPhoto } =
      req.body as Record<string, unknown>;

    if (!foodSealed || !labeledWithTime || !tempMaintained || !photoCaptured) {
      return res.status(400).json({
        error: 'All 4 safety checklist items (sealed, labeled, temperature maintained, pickup photo) must be confirmed.',
      });
    }

    try {
      const result = await withTransaction((db) => {
        const pk = db.pickups.find((p) => p.id === req.params.id);
        if (!pk) throw Object.assign(new Error('Pickup not found.'), { status: 404 });
        const donation = db.donations.find((d) => d.id === pk.donationId)!;
        assertTransition(donation.status, 'In Transit');

        const now = new Date().toISOString();
        pk.checklistCompleted = true;
        pk.status = 'In Transit';
        pk.pickedUpAt = now;
        pk.simulatedVolunteerCoords = {
          lat: pk.pickupLocation.lat,
          lng: pk.pickupLocation.lng,
          updatedAt: now,
        };
        pk.updated_at = now;

        donation.status = 'In Transit';
        donation.updated_at = now;

        const passport = db.food_safety_passports.find((p) => p.donationId === donation.id);
        if (passport) {
          passport.pickupPhoto =
            typeof pickupPhoto === 'string' && pickupPhoto.length > 0
              ? pickupPhoto
              : donation.photos[0] || '/src/assets/images/sample_veg_meals_1795069683150.jpg';
          passport.checklistResults = {
            foodSealed: true,
            labeledWithTime: true,
            tempMaintained: true,
            photoCaptured: true,
            completedAt: now,
            volunteerId: pk.volunteerId || user.profileId,
          };
          passport.updated_at = now;
        }

        appendAudit(db, {
          donationId: donation.id,
          actorUserId: user.id,
          actorName: user.name,
          actorRole: user.role,
          action: 'Pickup Safety Checklist Passed -> In Transit',
          fromStatus: 'Pickup Scheduled',
          toStatus: 'In Transit',
          note: 'Food sealed, time-labeled, temperature verified, pickup photo logged.',
        });

        const ngo = db.ngos.find((n) => n.id === pk.ngoId);
        appendNotification(db, {
          targetRole: 'ngo',
          targetUserId: ngo?.userId,
          eventType: 'in_transit',
          title: 'Donation In Transit',
          message: `${donation.title} has been picked up and is en route to ${ngo?.organizationName}.`,
          donationId: donation.id,
        });

        return { pickup: pk, donation };
      });
      res.json(result);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      res.status(e.status || 400).json({ error: e.message || 'Checklist update failed.' });
    }
  });

  // Handover Verification via 6-digit OTP or QR Token -> Delivered
  app.post('/api/deliveries/:donationId/verify-otp', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const { otp, qrToken } = req.body as { otp?: string; qrToken?: string };
    if (!otp && !qrToken) {
      return res.status(400).json({ error: 'Enter the 6-digit OTP or scan/paste the QR token.' });
    }

    try {
      const result = await withTransaction((db) => {
        const delivery = db.deliveries.find((d) => d.donationId === req.params.donationId);
        if (!delivery) throw Object.assign(new Error('Delivery record not found.'), { status: 404 });
        const donation = db.donations.find((d) => d.id === req.params.donationId)!;
        assertTransition(donation.status, 'Delivered');

        let method: 'OTP' | 'QR' = 'OTP';
        if (qrToken) {
          if (qrToken.trim() !== delivery.qrToken) {
            throw Object.assign(new Error('Invalid QR handover token.'), { status: 400 });
          }
          method = 'QR';
        } else {
          if (hashOtp(String(otp).trim()) !== delivery.otpHash) {
            throw Object.assign(new Error('Incorrect 6-digit handover OTP. Please check with the NGO.'), { status: 400 });
          }
        }

        const now = new Date().toISOString();
        delivery.verifiedAt = now;
        delivery.verifiedByMethod = method;
        delivery.updated_at = now;

        const pk = db.pickups.find((p) => p.id === delivery.pickupId);
        if (pk) {
          pk.status = 'Delivered';
          pk.deliveredAt = now;
          pk.simulatedVolunteerCoords = { ...pk.dropoffLocation, updatedAt: now };
          pk.updated_at = now;
        }

        donation.status = 'Delivered';
        donation.updated_at = now;

        appendAudit(db, {
          donationId: donation.id,
          actorUserId: user.id,
          actorName: user.name,
          actorRole: user.role,
          action: `Handover Verified (${method})`,
          fromStatus: 'In Transit',
          toStatus: 'Delivered',
          note: `Confirmed receipt via ${method}. Awaiting NGO condition rating for completion.`,
        });

        appendNotification(db, {
          targetRole: 'all',
          eventType: 'delivered',
          title: 'Handover confirmed via ' + method,
          message: `${donation.title} delivered to ${donation.assignedNgoName}.`,
          donationId: donation.id,
        });

        return { delivery, donation };
      });
      res.json(result);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      res.status(e.status || 400).json({ error: e.message || 'OTP verification failed.' });
    }
  });

  // NGO Rates Food Condition -> Completed + Tamper-Evident Donation Certificate + Impact + Trust Score
  app.post('/api/deliveries/:donationId/rate', requireRole('ngo', 'admin'), async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const { foodConditionScore, donorPackagingScore, comment } = req.body as {
      foodConditionScore?: number;
      donorPackagingScore?: number;
      comment?: string;
    };
    const cond = Number(foodConditionScore);
    const pack = Number(donorPackagingScore);
    if (!cond || cond < 1 || cond > 5 || !pack || pack < 1 || pack > 5) {
      return res.status(400).json({ error: 'Food condition and packaging ratings (1–5) are required.' });
    }

    try {
      const result = await withTransaction((db) => {
        const donation = db.donations.find((d) => d.id === req.params.donationId);
        if (!donation) throw Object.assign(new Error('Donation not found.'), { status: 404 });
        if (user.role === 'ngo' && donation.assignedNgoId !== user.profileId) {
          throw Object.assign(new Error('Only the receiving NGO can rate this delivery.'), { status: 403 });
        }
        assertTransition(donation.status, 'Completed');

        const now = new Date().toISOString();
        const delivery = db.deliveries.find((d) => d.donationId === donation.id);
        const pk = db.pickups.find((p) => p.donationId === donation.id);
        const passport = db.food_safety_passports.find((p) => p.donationId === donation.id);
        const ngo = db.ngos.find((n) => n.id === donation.assignedNgoId);
        const settings = db.settings[0];

        if (delivery) {
          delivery.ratedAt = now;
          delivery.updated_at = now;
        }
        donation.status = 'Completed';
        donation.updated_at = now;

        db.ratings.unshift({
          id: nextId('rat'),
          donationId: donation.id,
          donorId: donation.donorId,
          ngoId: donation.assignedNgoId || '',
          foodConditionScore: cond,
          donorPackagingScore: pack,
          ngoResponsivenessScore: 5,
          comment: String(comment || 'Handover completed safely.'),
          created_at: now,
          updated_at: now,
        });

        // Update NGO trust score & volunteer stats
        if (ngo) {
          ngo.completedPickups += 1;
          ngo.avgDonorRating = Math.round(((ngo.avgDonorRating * 4 + cond) / 5) * 10) / 10;
          ngo.trustScore = computeNgoTrustScore(ngo);
          ngo.updated_at = now;
        }
        if (pk?.volunteerId) {
          const vol = db.volunteers.find((v) => v.id === pk.volunteerId);
          if (vol) {
            vol.tasksCompleted += 1;
            vol.mealsMoved += donation.portions;
            if (vol.tasksCompleted >= 1 && !vol.badges.includes('First Pickup')) {
              vol.badges.push('First Pickup');
            }
            if (vol.mealsMoved >= 500 && !vol.badges.includes('500 Meals Moved')) {
              vol.badges.push('500 Meals Moved');
            }
            vol.updated_at = now;
          }
        }

        // Update Impact Records
        const co2e =
          Math.round(donation.quantityKg * settings.assumptions.co2eKgPerKgFood * 10) / 10;
        db.impact_records.unshift({
          id: nextId('imp'),
          donationId: donation.id,
          donorId: donation.donorId,
          ngoId: donation.assignedNgoId || '',
          volunteerId: pk?.volunteerId,
          mealsProvided: donation.portions,
          quantityKg: donation.quantityKg,
          estimatedCo2eAvoidedKg: co2e,
          completedAt: now,
          created_at: now,
          updated_at: now,
        });

        // Generate Tamper-Evident Donation Certificate (HMAC-SHA256)
        const certId = `CERT-${Date.now().toString().slice(-6)}`;
        const payload: CertificatePayload = {
          certificateId: certId,
          donationId: donation.id,
          donorName: donation.donorName,
          ngoName: donation.assignedNgoName || ngo?.organizationName || 'Verified NGO',
          title: donation.title,
          category: donation.category,
          dietaryType: donation.dietaryType,
          portions: donation.portions,
          quantityKg: donation.quantityKg,
          preparedAt: donation.preparedAt,
          safeUntil: donation.safeUntil,
          handoverAt: delivery?.verifiedAt || now,
          handoverMethod: delivery?.verifiedByMethod || 'OTP',
          safetySummary: `${donation.storageMethod}${
            typeof donation.temperatureC === 'number' ? ` (${donation.temperatureC}°C)` : ''
          }, ${passport?.checklistResults ? 'checklist verified' : 'standard handover'}`,
          issuedAt: now,
        };
        const certificate: Certificate = {
          id: certId,
          donationId: donation.id,
          payload,
          signature: signCertificatePayload(payload),
          algorithm: 'HMAC-SHA256',
          created_at: now,
          updated_at: now,
        };
        db.certificates.unshift(certificate);

        appendAudit(db, {
          donationId: donation.id,
          actorUserId: user.id,
          actorName: user.name,
          actorRole: user.role,
          action: 'Completed & Certificate Issued',
          fromStatus: 'Delivered',
          toStatus: 'Completed',
          note: `Rated ${cond}/5. Signed Certificate ${certId} generated.`,
        });

        const donor = db.donors.find((dn) => dn.id === donation.donorId);
        appendNotification(db, {
          targetRole: 'donor',
          targetUserId: donor?.userId,
          eventType: 'certificate_ready',
          title: 'Donation Certificate ready',
          message: `Certificate ${certId} issued for "${donation.title}" (${donation.portions} meals).`,
          donationId: donation.id,
        });

        return { donation, certificate };
      });
      res.json(result);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      res.status(e.status || 400).json({ error: e.message || 'Completion rating failed.' });
    }
  });

  // Public Certificate Verification (No Login Required!)
  app.get('/api/certificates/:id/verify', (req, res) => {
    const db = getDb();
    const cert = db.certificates.find(
      (c) => c.id.toLowerCase() === req.params.id.trim().toLowerCase()
    );
    if (!cert) {
      return res.json({ status: 'Not Found', certificate: null });
    }
    const isValid = verifyCertificateSignature(cert.payload, cert.signature);
    res.json({
      status: isValid ? 'Valid' : 'Tampered',
      certificate: cert,
    });
  });

  // Public Tamper-Check Tester (allows judges to verify altered JSON fails signature check)
  app.post('/api/certificates/verify-payload', (req, res) => {
    const { payload, signature } = req.body as {
      payload?: CertificatePayload;
      signature?: string;
    };
    if (!payload || !signature) {
      return res.status(400).json({ status: 'Invalid Input' });
    }
    const db = getDb();
    const exists = db.certificates.find((c) => c.id === payload.certificateId);
    if (!exists) {
      return res.json({ status: 'Not Found' });
    }
    const isValid = verifyCertificateSignature(payload, signature);
    res.json({
      status: isValid ? 'Valid' : 'Tampered',
      expectedRecordId: exists.id,
    });
  });

  // Admin: NGO Verification Queue
  app.post('/api/ngos/:id/verify', requireRole('admin'), async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const { status } = req.body as { status?: 'Verified' | 'Suspended' | 'Pending' };
    if (!status) return res.status(400).json({ error: 'Verification status is required.' });
    const ngo = await withTransaction((db) => {
      const n = db.ngos.find((x) => x.id === req.params.id);
      if (!n) throw Object.assign(new Error('NGO not found.'), { status: 404 });
      const prev = n.verificationStatus;
      n.verificationStatus = status;
      n.updated_at = new Date().toISOString();
      appendAudit(db, {
        actorUserId: user.id,
        actorName: user.name,
        actorRole: 'admin',
        action: 'NGO Verification Updated',
        fromStatus: prev,
        toStatus: status,
        note: `${n.organizationName} verification changed to ${status}.`,
      });
      return n;
    });
    res.json(ngo);
  });

  // Admin: Manual Reassignment
  app.post('/api/donations/:id/reassign', requireRole('admin'), async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const { ngoId, note } = req.body as { ngoId?: string; note?: string };
    if (!ngoId) return res.status(400).json({ error: 'Target NGO ID is required.' });
    try {
      const result = await withTransaction((db) => {
        const donation = db.donations.find((d) => d.id === req.params.id);
        const ngo = db.ngos.find((n) => n.id === ngoId);
        if (!donation || !ngo) throw Object.assign(new Error('Donation or NGO not found.'), { status: 404 });
        const now = new Date().toISOString();
        const prev = donation.status;
        if (['Completed', 'Delivered', 'Rejected', 'Cancelled', 'Expired'].includes(prev)) {
          throw Object.assign(new Error(`Cannot reassign a ${prev} donation.`), { status: 400 });
        }

        // Cancel existing pending offers and send new offer to chosen NGO
        for (const off of db.offers) {
          if (off.donationId === donation.id && off.status === 'Pending') {
            off.status = 'Cancelled';
            off.updated_at = now;
          }
        }
        donation.status = 'Awaiting NGO Acceptance';
        donation.updated_at = now;
        const timeoutMs =
          (db.settings[0].fastForwardTimers ? 30 : db.settings[0].escalationTimeoutSeconds) * 1000;
        const newOffer = {
          id: nextId('off'),
          donationId: donation.id,
          ngoId: ngo.id,
          ngoName: ngo.organizationName,
          rankOrder: 1,
          status: 'Pending' as const,
          sentAt: now,
          expiresAt: new Date(Date.now() + timeoutMs).toISOString(),
          created_at: now,
          updated_at: now,
        };
        db.offers.push(newOffer);

        appendAudit(db, {
          donationId: donation.id,
          actorUserId: user.id,
          actorName: user.name,
          actorRole: 'admin',
          action: 'Admin Manual Reassignment',
          fromStatus: prev,
          toStatus: 'Awaiting NGO Acceptance',
          note: `${note || 'Manually reassigned'} -> ${ngo.organizationName}`,
        });
        return { donation, offer: newOffer };
      });
      res.json(result);
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string };
      res.status(e.status || 400).json({ error: e.message || 'Reassign failed.' });
    }
  });

  // NGO Requirements Update
  app.post('/api/ngos/:id/requirements', requireRole('ngo', 'admin'), async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    if (user.role === 'ngo' && user.profileId !== req.params.id) {
      return res.status(403).json({ error: 'Cannot edit requirements for another NGO.' });
    }
    const { category, neededKg, urgency, notes } = req.body as Record<string, unknown>;
    if (!category || !neededKg) {
      return res.status(400).json({ error: 'Category and needed kg are required.' });
    }
    const reqItem = await withTransaction((db) => {
      const now = new Date().toISOString();
      const item = {
        id: nextId('req'),
        ngoId: req.params.id,
        category: category as FoodCategory,
        neededKg: Number(neededKg),
        urgency: (urgency as Donation['urgency']) || 'High',
        notes: String(notes || ''),
        created_at: now,
        updated_at: now,
      };
      db.ngo_requirements.unshift(item);
      return item;
    });
    res.status(201).json(reqItem);
  });

  // Volunteer Availability Toggle
  app.patch('/api/volunteers/availability', requireRole('volunteer'), async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const { isAvailable } = req.body as { isAvailable?: boolean };
    const vol = await withTransaction((db) => {
      const v = db.volunteers.find((x) => x.id === user.profileId);
      if (!v) throw Object.assign(new Error('Volunteer profile not found.'), { status: 404 });
      v.isAvailable = Boolean(isAvailable);
      v.updated_at = new Date().toISOString();
      return v;
    });
    res.json(vol);
  });

  // Notifications Read
  app.post('/api/notifications/mark-read', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    await withTransaction((db) => {
      for (const n of db.notifications) {
        if (n.targetRole === 'all' || n.targetRole === user.role || n.targetUserId === user.id) {
          n.read = true;
        }
      }
    });
    res.json({ ok: true });
  });

  // Settings (Editable Safety Rule Table, Timeouts, Fast-Forward, Assumptions, Demo AI Mode)
  app.patch('/api/settings', requireAuth, async (req: AuthedRequest, res) => {
    const user = req.authUser!;
    const patch = req.body as Record<string, unknown>;
    // Allow anyone in demo to toggle fastForwardTimers or demoAiMode, restrict rule table edits to admin
    const isAdminOnlyEdit =
      patch.foodSafetyRules !== undefined ||
      patch.allowPendingNgosForDemo !== undefined ||
      patch.escalationTimeoutSeconds !== undefined;
    if (isAdminOnlyEdit && user.role !== 'admin') {
      return res.status(403).json({ error: 'Only Admin can modify food safety rules or system thresholds.' });
    }

    const updated = await withTransaction((db) => {
      const s = db.settings[0];
      if (typeof patch.fastForwardTimers === 'boolean') {
        s.fastForwardTimers = patch.fastForwardTimers;
        // Also shorten any currently pending offers so judges see escalation within 30s
        if (patch.fastForwardTimers) {
          const cap = Date.now() + 30000;
          for (const off of db.offers) {
            if (off.status === 'Pending' && new Date(off.expiresAt).getTime() > cap) {
              off.expiresAt = new Date(cap).toISOString();
            }
          }
        }
      }
      if (typeof patch.demoAiMode === 'boolean') s.demoAiMode = patch.demoAiMode;
      if (typeof patch.allowPendingNgosForDemo === 'boolean')
        s.allowPendingNgosForDemo = patch.allowPendingNgosForDemo;
      if (typeof patch.escalationTimeoutSeconds === 'number')
        s.escalationTimeoutSeconds = Math.max(15, patch.escalationTimeoutSeconds);
      if (patch.assumptions && typeof patch.assumptions === 'object') {
        const a = patch.assumptions as { kgPerMeal?: number; co2eKgPerKgFood?: number };
        if (typeof a.kgPerMeal === 'number' && a.kgPerMeal > 0) s.assumptions.kgPerMeal = a.kgPerMeal;
        if (typeof a.co2eKgPerKgFood === 'number' && a.co2eKgPerKgFood > 0)
          s.assumptions.co2eKgPerKgFood = a.co2eKgPerKgFood;
      }
      if (Array.isArray(patch.foodSafetyRules)) {
        s.foodSafetyRules = patch.foodSafetyRules;
      }
      s.updated_at = new Date().toISOString();
      return s;
    });
    res.json(updated);
  });

  // Impact Analytics & Statistical + Gemini Forecast
  app.get('/api/analytics/impact', requireAuth, async (req: AuthedRequest, res) => {
    const db = getDb();
    const settings = db.settings[0];
    const all = db.donations;
    const completed = all.filter((d) => d.status === 'Completed');
    const deliveredOrCompleted = all.filter((d) => d.status === 'Completed' || d.status === 'Delivered');

    const kgRedistributed = Math.round(completed.reduce((s, d) => s + d.quantityKg, 0) * 10) / 10;
    const mealsProvided = completed.reduce((s, d) => s + d.portions, 0);
    const estimatedCo2eKg = Math.round(kgRedistributed * settings.assumptions.co2eKgPerKgFood * 10) / 10;
    const successRatePct = all.length > 0 ? Math.round((completed.length / all.length) * 1000) / 10 : 0;
    const cancelledOrExpired = all.filter((d) => d.status === 'Cancelled' || d.status === 'Expired').length;
    const cancelExpireRatePct = all.length > 0 ? Math.round((cancelledOrExpired / all.length) * 1000) / 10 : 0;
    const ngosSupported = new Set(completed.map((d) => d.assignedNgoId).filter(Boolean)).size;
    const volunteerPickups = db.pickups.filter((p) => p.status === 'Delivered' && p.volunteerId).length;

    // Avg post -> acceptance (mins) and acceptance -> delivery (mins)
    let acceptSum = 0;
    let acceptCount = 0;
    let deliverSum = 0;
    let deliverCount = 0;
    for (const d of deliveredOrCompleted) {
      const acc = db.acceptances.find((a) => a.donationId === d.id);
      const del = db.deliveries.find((dl) => dl.donationId === d.id);
      if (acc) {
        acceptSum += Math.max(2, (new Date(acc.acceptedAt).getTime() - new Date(d.created_at).getTime()) / 60000);
        acceptCount++;
      }
      if (acc && del?.verifiedAt) {
        deliverSum += Math.max(5, (new Date(del.verifiedAt).getTime() - new Date(acc.acceptedAt).getTime()) / 60000);
        deliverCount++;
      }
    }

    // Funnel counts
    const funnel = [
      { stage: 'Posted', count: all.length },
      { stage: 'Approved', count: all.filter((d) => !['Draft', 'Pending Review', 'Rejected'].includes(d.status)).length },
      { stage: 'Matched', count: db.match_recommendations.length + completed.length },
      { stage: 'Accepted', count: all.filter((d) => ['Accepted', 'Pickup Scheduled', 'In Transit', 'Delivered', 'Completed'].includes(d.status)).length },
      { stage: 'Delivered', count: deliveredOrCompleted.length },
      { stage: 'Completed', count: completed.length },
    ];

    // Category mix
    const catMap = new Map<string, number>();
    for (const d of completed) {
      catMap.set(d.category, (catMap.get(d.category) ?? 0) + d.quantityKg);
    }
    const categoryMix = Array.from(catMap.entries()).map(([category, kg]) => ({
      category,
      kg: Math.round(kg * 10) / 10,
    }));

    // Rejection reasons
    const rejMap = new Map<string, number>();
    for (const off of db.offers) {
      if (off.status === 'Rejected' && off.rejectionReason) {
        rejMap.set(off.rejectionReason, (rejMap.get(off.rejectionReason) ?? 0) + 1);
      }
    }
    const rejectionReasons = Array.from(rejMap.entries()).map(([reason, count]) => ({ reason, count }));

    // NGO distribution
    const ngoDistMap = new Map<string, number>();
    for (const d of completed) {
      if (d.assignedNgoName) {
        ngoDistMap.set(d.assignedNgoName, (ngoDistMap.get(d.assignedNgoName) ?? 0) + d.portions);
      }
    }
    const ngoDistribution = Array.from(ngoDistMap.entries())
      .map(([ngoName, meals]) => ({ ngoName, meals }))
      .sort((a, b) => b.meals - a.meals);

    // Time series over past 14 days
    const dayBuckets = new Map<string, { date: string; kg: number; meals: number }>();
    for (let i = 13; i >= 0; i--) {
      const dt = new Date(Date.now() - i * 86400000);
      const key = dt.toISOString().slice(0, 10);
      dayBuckets.set(key, { date: key.slice(5), kg: 0, meals: 0 });
    }
    for (const d of completed) {
      const key = d.created_at.slice(0, 10);
      const b = dayBuckets.get(key);
      if (b) {
        b.kg = Math.round((b.kg + d.quantityKg) * 10) / 10;
        b.meals += d.portions;
      }
    }

    const baselineForecast = computeForecastBaseline(db.donations, db.ngo_requirements);

    res.json({
      kpis: {
        kgRedistributed,
        mealsProvided,
        wasteAvoidedKg: kgRedistributed,
        completedDonations: completed.length,
        successRatePct,
        ngosSupported,
        peopleReachedEstimate: mealsProvided,
        volunteerPickups,
        avgPostToAcceptMins: acceptCount > 0 ? Math.round(acceptSum / acceptCount) : 8,
        avgAcceptToDeliverMins: deliverCount > 0 ? Math.round(deliverSum / deliverCount) : 29,
        cancelExpireRatePct,
        estimatedCo2eKg,
      },
      assumptions: settings.assumptions,
      disclaimer: IMPACT_FOOTER_DISCLAIMER,
      charts: {
        overTime: Array.from(dayBuckets.values()),
        categoryMix,
        funnel,
        ngoDistribution,
        rejectionReasons,
      },
      forecastBaseline: baselineForecast,
    });
  });

  // AI Endpoints (Forecast, Anomalies, Insights, Assistant)
  app.post('/api/ai/forecast', requireAuth, async (_req, res) => {
    if (!checkAiRateLimit()) return res.status(429).json({ error: 'AI rate limit reached.' });
    const db = getDb();
    const baseline = computeForecastBaseline(db.donations, db.ngo_requirements);
    const result = await forecastSurplusAndDemand(baseline, db.settings[0].demoAiMode);
    res.json({ baseline, ...result });
  });

  app.post('/api/ai/anomalies', requireRole('admin'), async (_req, res) => {
    if (!checkAiRateLimit()) return res.status(429).json({ error: 'AI rate limit reached.' });
    const db = getDb();
    const flags = detectAnomalies(db);
    const summary = await summarizeAnomalies(flags, db.settings[0].demoAiMode);
    res.json({ flags, ...summary });
  });

  app.post('/api/ai/insights', requireAuth, async (req: AuthedRequest, res) => {
    if (!checkAiRateLimit()) return res.status(429).json({ error: 'AI rate limit reached.' });
    const user = req.authUser!;
    const db = getDb();
    const scoped = buildRoleScopedView(user);
    const active = scoped.donations
      .filter((d) => !['Completed', 'Rejected', 'Cancelled', 'Expired'].includes(d.status))
      .slice(0, 6)
      .map((d) => ({ id: d.id, title: d.title, status: d.status, urgency: d.urgency, portions: d.portions }));
    const completed = db.donations.filter((d) => d.status === 'Completed');
    const snapshot = {
      activeDonations: active,
      topShortages: db.ngo_requirements.slice(0, 4).map((r) => ({
        ngoName: db.ngos.find((n) => n.id === r.ngoId)?.organizationName || r.ngoId,
        category: r.category,
        neededKg: r.neededKg,
        urgency: r.urgency,
      })),
      impactSummary: {
        completedDonations: completed.length,
        mealsProvided: completed.reduce((s, d) => s + d.portions, 0),
        redistributedKg: Math.round(completed.reduce((s, d) => s + d.quantityKg, 0) * 10) / 10,
      },
    };
    const result = await generateDashboardInsights(user.role, snapshot, db.settings[0].demoAiMode);
    res.json(result);
  });

  app.post('/api/ai/assistant', requireAuth, async (req: AuthedRequest, res) => {
    if (!checkAiRateLimit()) return res.status(429).json({ error: 'AI rate limit reached.' });
    const user = req.authUser!;
    const { question } = req.body as { question?: string };
    if (!question || question.trim().length < 2) {
      return res.status(400).json({ error: 'Please enter a question.' });
    }
    const db = getDb();
    const scoped = buildRoleScopedView(user);
    const completed = db.donations.filter((d) => d.status === 'Completed');
    const settings = db.settings[0];
    const totalKg = Math.round(completed.reduce((s, d) => s + d.quantityKg, 0) * 10) / 10;

    // Compact role-filtered real snapshot
    const snapshot = {
      role: user.role,
      activeDonations: scoped.donations
        .filter((d) => !['Rejected', 'Cancelled', 'Expired'].includes(d.status))
        .slice(0, 12)
        .map((d) => ({
          id: d.id,
          title: d.title,
          category: d.category,
          status: d.status,
          urgency: d.urgency,
          portions: d.portions,
          quantityKg: d.quantityKg,
          safeUntil: d.safeUntil,
          assignedNgoName: d.assignedNgoName,
        })),
      topShortages: db.ngo_requirements.slice(0, 6).map((r) => ({
        ngoName: db.ngos.find((n) => n.id === r.ngoId)?.organizationName || r.ngoId,
        category: r.category,
        neededKg: r.neededKg,
        urgency: r.urgency,
      })),
      impactSummary: {
        completedDonations: completed.length,
        mealsProvided: completed.reduce((s, d) => s + d.portions, 0),
        redistributedKg: totalKg,
        estimatedCo2eKg: Math.round(totalKg * settings.assumptions.co2eKgPerKgFood * 10) / 10,
      },
    };

    const result = await runAssistant(question.trim(), user.role, snapshot, settings.demoAiMode);
    res.json(result);
  });

  // Admin: Seed / Reset Demo Data & Manual Timer Tick
  app.post('/api/admin/seed-demo', requireRole('admin'), (_req, res) => {
    resetDatabase(true);
    res.json({ ok: true, message: 'Demo dataset seeded.' });
  });

  app.post('/api/admin/reset-demo', requireRole('admin'), (_req, res) => {
    resetDatabase(true);
    res.json({ ok: true, message: 'Demo dataset reset to clean baseline.' });
  });

  app.post('/api/admin/tick-timers', requireAuth, async (_req, res) => {
    const tick = await runLifecycleTick();
    res.json(tick);
  });

  // Fast-forward force-expire pending offer (for deterministic demo/testing of escalation)
  app.post('/api/offers/:id/simulate-timeout', requireAuth, async (req, res) => {
    await withTransaction((db) => {
      const off = db.offers.find((o) => o.id === req.params.id);
      if (off && off.status === 'Pending') {
        off.expiresAt = new Date(Date.now() - 1000).toISOString();
      }
    });
    const tick = await runLifecycleTick();
    res.json({ ok: true, ...tick });
  });

  // Vite or static production build
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`FoodBridge AI server running on http://localhost:${PORT}`);
  });
}

startServer();
