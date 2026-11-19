import {
  appendAudit,
  appendNotification,
  appendOutbox,
  nextId,
  withTransaction,
} from './db';
import { assertTransition, computeUrgency } from './engine';

export async function runLifecycleTick(): Promise<{
  escalatedCount: number;
  expiredCount: number;
  movedPickups: number;
}> {
  return withTransaction((db) => {
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const settings = db.settings[0];
    const timeoutMs =
      (settings.fastForwardTimers ? 30 : settings.escalationTimeoutSeconds) * 1000;

    let escalatedCount = 0;
    let expiredCount = 0;
    let movedPickups = 0;

    // 1. Safe Until warnings (30 mins left) & Expiry watchdog
    const terminalStatuses = new Set(['Completed', 'Delivered', 'Rejected', 'Cancelled', 'Expired']);
    for (const donation of db.donations) {
      if (terminalStatuses.has(donation.status)) continue;

      // Update urgency deterministically
      donation.urgency = computeUrgency(
        donation.safeUntil,
        nowMs,
        settings.urgencyThresholdsMinutes
      );

      const msLeft = new Date(donation.safeUntil).getTime() - nowMs;
      if (msLeft <= 0) {
        const prev = donation.status;
        if (prev !== 'Expired') {
          try {
            assertTransition(prev, 'Expired');
            donation.status = 'Expired';
            donation.updated_at = nowIso;
            expiredCount++;

            // Cancel any pending offers or open pickups
            for (const off of db.offers) {
              if (off.donationId === donation.id && off.status === 'Pending') {
                off.status = 'Cancelled';
                off.updated_at = nowIso;
              }
            }
            for (const pk of db.pickups) {
              if (pk.donationId === donation.id && pk.status === 'Open') {
                pk.status = 'Cancelled';
                pk.updated_at = nowIso;
              }
            }

            appendAudit(db, {
              donationId: donation.id,
              actorUserId: 'system',
              actorName: 'Safety Watchdog',
              actorRole: 'system',
              action: 'Safe Until Expired',
              fromStatus: prev,
              toStatus: 'Expired',
              note: 'Safe Until deadline elapsed prior to handover completion.',
            });

            appendNotification(db, {
              targetRole: 'admin',
              eventType: 'expired',
              title: 'Donation expired before handover',
              message: `${donation.title} (${donation.id}) passed its Safe Until window.`,
              donationId: donation.id,
            });
          } catch {
            // ignore illegal
          }
        }
      } else if (msLeft <= 30 * 60 * 1000) {
        const alreadyWarned = db.notifications.some(
          (n) => n.donationId === donation.id && n.eventType === 'safe_until_warning'
        );
        if (!alreadyWarned) {
          appendNotification(db, {
            targetRole: 'all',
            eventType: 'safe_until_warning',
            title: 'Safe Until warning (<30 min left)',
            message: `${donation.title} has less than 30 minutes remaining before expiry.`,
            donationId: donation.id,
          });
        }
      }
    }

    // 2. Auto-escalation for unresponded NGO offers
    const pendingOffers = db.offers.filter((o) => o.status === 'Pending');
    const timedOutByDonation = new Map<string, typeof pendingOffers>();
    for (const off of pendingOffers) {
      if (new Date(off.expiresAt).getTime() <= nowMs) {
        const arr = timedOutByDonation.get(off.donationId) ?? [];
        arr.push(off);
        timedOutByDonation.set(off.donationId, arr);
      }
    }

    for (const [donationId, expiredOffers] of timedOutByDonation.entries()) {
      const donation = db.donations.find((d) => d.id === donationId);
      if (!donation || donation.status !== 'Awaiting NGO Acceptance') continue;

      // Mark timed-out offers
      for (const off of expiredOffers) {
        off.status = 'Timed Out';
        off.respondedAt = nowIso;
        off.updated_at = nowIso;
      }

      // Check if there are still other pending offers (e.g. broadcast mode)
      const stillPending = db.offers.some(
        (o) => o.donationId === donationId && o.status === 'Pending'
      );
      if (stillPending) continue;

      // Find next ranked eligible NGO from match_recommendations
      const matchRec = db.match_recommendations.find((m) => m.donationId === donationId);
      const triedNgoIds = new Set(
        db.offers.filter((o) => o.donationId === donationId).map((o) => o.ngoId)
      );
      const nextCandidate = matchRec?.candidates.find(
        (c) => c.eligible && !triedNgoIds.has(c.ngoId)
      );

      if (nextCandidate) {
        assertTransition(donation.status, 'Escalated');
        donation.status = 'Escalated';
        assertTransition('Escalated', 'Awaiting NGO Acceptance');
        donation.status = 'Awaiting NGO Acceptance';
        donation.updated_at = nowIso;

        const maxRank = db.offers
          .filter((o) => o.donationId === donationId)
          .reduce((m, o) => Math.max(m, o.rankOrder), 0);

        const nextOfferExpires = new Date(nowMs + timeoutMs).toISOString();
        const newOffer = {
          id: nextId('off'),
          donationId,
          ngoId: nextCandidate.ngoId,
          ngoName: nextCandidate.ngoName,
          rankOrder: maxRank + 1,
          status: 'Pending' as const,
          sentAt: nowIso,
          expiresAt: nextOfferExpires,
          created_at: nowIso,
          updated_at: nowIso,
        };
        db.offers.push(newOffer);
        escalatedCount++;

        const targetNgo = db.ngos.find((n) => n.id === nextCandidate.ngoId);
        appendAudit(db, {
          donationId,
          actorUserId: 'system',
          actorName: 'Auto-Escalation Engine',
          actorRole: 'system',
          action: 'Offer Auto-Escalated',
          fromStatus: 'Awaiting NGO Acceptance',
          toStatus: 'Awaiting NGO Acceptance',
          note: `Previous offer timed out; escalated to rank #${newOffer.rankOrder}: ${nextCandidate.ngoName} (Match Score ${nextCandidate.matchScore}).`,
        });

        appendNotification(db, {
          targetRole: 'ngo',
          targetUserId: targetNgo?.userId,
          eventType: 'escalation',
          title: 'Escalated surplus offer assigned',
          message: `${donation.title} (${donation.portions} meals) escalated to ${nextCandidate.ngoName}.`,
          donationId,
        });

        appendNotification(db, {
          targetRole: 'admin',
          eventType: 'escalation',
          title: 'Offer auto-escalated',
          message: `${donation.title} moved from ${expiredOffers.map((e) => e.ngoName).join(', ')} to ${nextCandidate.ngoName}.`,
          donationId,
        });

        if (targetNgo) {
          appendOutbox(db, {
            channel: 'WhatsApp',
            recipientName: targetNgo.organizationName,
            recipientPhone: targetNgo.phone,
            language: 'en',
            body: `[Simulated WhatsApp] Escalated Offer: ${donation.title} (${donation.portions} portions, ${donation.quantityKg} kg) from ${donation.donorName}. Please respond promptly.`,
            donationId,
          });
        }
      } else {
        // Exhausted all candidates -> alert admin
        const alreadyExhausted = db.notifications.some(
          (n) =>
            n.donationId === donationId &&
            n.targetRole === 'admin' &&
            n.title.includes('All matched NGOs exhausted')
        );
        if (!alreadyExhausted) {
          appendAudit(db, {
            donationId,
            actorUserId: 'system',
            actorName: 'Auto-Escalation Engine',
            actorRole: 'system',
            action: 'Escalation Exhausted',
            note: 'All eligible ranked NGOs timed out or rejected. Admin manual intervention required.',
          });
          appendNotification(db, {
            targetRole: 'admin',
            eventType: 'escalation',
            title: 'All matched NGOs exhausted',
            message: `${donation.title} received no NGO acceptance; manual reassignment needed.`,
            donationId,
          });
        }
      }
    }

    // 3. Simulated volunteer movement + volunteer claim timeout alert
    for (const pk of db.pickups) {
      if (pk.status === 'Open') {
        const ageMs = nowMs - new Date(pk.created_at).getTime();
        const volTimeoutMs =
          (settings.fastForwardTimers ? 30 : settings.volunteerClaimTimeoutSeconds) * 1000;
        if (ageMs > volTimeoutMs) {
          const alreadyFlagged = db.notifications.some(
            (n) => n.donationId === pk.donationId && n.eventType === 'volunteer_needed' && n.targetRole === 'admin'
          );
          if (!alreadyFlagged) {
            appendNotification(db, {
              targetRole: 'admin',
              eventType: 'volunteer_needed',
              title: 'Needs driver: uncollected pickup alert',
              message: `Pickup for ${pk.pickupLocation.area} -> ${pk.dropoffLocation.area} awaits volunteer or NGO/donor self-delivery.`,
              donationId: pk.donationId,
            });
          }
        }
      } else if (pk.status === 'In Transit' && pk.simulatedVolunteerCoords) {
        const step = settings.fastForwardTimers ? 0.32 : 0.12;
        const cur = pk.simulatedVolunteerCoords;
        const target = pk.dropoffLocation;
        const nextLat = cur.lat + (target.lat - cur.lat) * step;
        const nextLng = cur.lng + (target.lng - cur.lng) * step;
        pk.simulatedVolunteerCoords = {
          lat: Math.round(nextLat * 100000) / 100000,
          lng: Math.round(nextLng * 100000) / 100000,
          updatedAt: nowIso,
        };
        movedPickups++;
      }
    }

    return { escalatedCount, expiredCount, movedPickups };
  });
}

let intervalHandle: ReturnType<typeof setInterval> | null = null;

export function startScheduler() {
  if (intervalHandle) return;
  intervalHandle = setInterval(() => {
    runLifecycleTick().catch((err) => console.error('Scheduler tick error:', err));
  }, 5000);
}
