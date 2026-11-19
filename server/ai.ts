import fs from 'node:fs';
import path from 'node:path';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  AiAssessment,
  Donation,
  MatchCandidate,
  Role,
  RuleFlag,
  UrgencyLevel,
} from '../src/shared/types';
import { SAFETY_DISCLAIMER, type ForecastBaseline } from './engine';

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-4-hydrogen';

// Simple in-memory sliding-window rate limiter for AI endpoints
const aiCallTimestamps: number[] = [];
export function checkAiRateLimit(maxPerMinute = 40): boolean {
  const now = Date.now();
  while (aiCallTimestamps.length > 0 && now - aiCallTimestamps[0] > 60000) {
    aiCallTimestamps.shift();
  }
  if (aiCallTimestamps.length >= maxPerMinute) return false;
  aiCallTimestamps.push(now);
  return true;
}

function getClient(): GoogleGenAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key === 'MY_GEMINI_API_KEY' || key.trim() === '') return null;
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function withTimeoutAndRetry<T>(fn: () => Promise<T>, timeoutMs = 5500): Promise<T> {
  const runOnce = () =>
    Promise.race<T>([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Gemini API request timed out')), timeoutMs)
      ),
    ]);

  try {
    return await runOnce();
  } catch (err) {
    const msg = (err as Error).message || '';
    if (
      msg.includes('timed out') ||
      msg.includes('API_KEY') ||
      msg.includes('403') ||
      msg.includes('400') ||
      msg.includes('404')
    ) {
      throw err;
    }
    // 1 brief retry for transient network errors
    await new Promise((r) => setTimeout(r, 300));
    return await runOnce();
  }
}

function loadImageInlinePart(photoRef: string): { inlineData: { mimeType: string; data: string } } | null {
  try {
    if (photoRef.startsWith('data:image/')) {
      const match = photoRef.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
      if (match) {
        return { inlineData: { mimeType: match[1], data: match[2] } };
      }
    }
    if (photoRef.startsWith('/src/assets/')) {
      const diskPath = path.resolve(process.cwd(), photoRef.slice(1));
      if (fs.existsSync(diskPath)) {
        const buf = fs.readFileSync(diskPath);
        const ext = path.extname(diskPath).toLowerCase();
        const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
        return { inlineData: { mimeType, data: buf.toString('base64') } };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function assessFood(
  donation: Donation,
  ruleFlags: RuleFlag[],
  demoAiMode: boolean
): Promise<Omit<AiAssessment, 'id' | 'created_at' | 'updated_at'>> {
  if (demoAiMode) {
    return {
      donationId: donation.id,
      source: 'sample_demo',
      modelUsed: 'sample-demo-mode',
      categoryInterpretation: `Sample AI output: ${donation.category} (${donation.dietaryType}), ${donation.portions} portions (${donation.quantityKg} kg).`,
      missingInformation: ruleFlags.filter((f) => f.code.includes('MISSING')).map((f) => f.message),
      storageConcerns:
        ruleFlags.length > 0
          ? ruleFlags.map((f) => f.message)
          : [`Maintain ${donation.storageMethod} storage until handover.`],
      visibleConditionNotes:
        donation.photos.length > 0
          ? 'Sample AI output: Photo shows clean, sealed food-grade containers with uniform portioning and no visible spoilage.'
          : 'No photo provided; visual condition cannot be assessed.',
      urgencyRecommendation: donation.urgency,
      humanReviewRecommendation: ruleFlags.some((f) => f.severity === 'critical')
        ? 'Inspect Carefully'
        : 'Approve Recommended',
      confidenceNote: 'Sample AI output (Demo AI Mode enabled). Deterministic rule checks remain active.',
      disclaimer: SAFETY_DISCLAIMER,
    };
  }

  const ai = getClient();
  if (ai) {
    try {
      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
      for (const p of donation.photos.slice(0, 2)) {
        const inline = loadImageInlinePart(p);
        if (inline) parts.push(inline);
      }

      const prompt = `You are assisting a surplus food rescue platform's human safety reviewer.
Analyze the structured donation record and any attached photos (visible condition ONLY — never claim to certify food as safe).
Donation:
- Title: ${donation.title}
- Category: ${donation.category}
- Dietary: ${donation.dietaryType}
- Allergens declared: ${donation.allergens.join(', ') || 'None'}
- Quantity: ${donation.portions} portions (${donation.quantityKg} kg)
- Prepared At: ${donation.preparedAt}
- Safe Until (rule-computed): ${donation.safeUntil}
- Storage: ${donation.storageMethod}${typeof donation.temperatureC === 'number' ? `, Temp: ${donation.temperatureC}°C` : ''}
- Packaging: ${donation.packaging}
- Deterministic Rule Flags: ${ruleFlags.map((f) => `[${f.severity}] ${f.message}`).join('; ') || 'None'}

Return JSON matching the schema.`;

      parts.push({ text: prompt });

      const response = await withTimeoutAndRetry(() =>
        ai.models.generateContent({
          model: DEFAULT_MODEL,
          contents: { parts },
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            systemInstruction:
              'Be concise, factual, and safety-conscious. Never claim food is certified safe. Recommend human review based on flags and visible photo condition.',
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                categoryInterpretation: { type: Type.STRING },
                missingInformation: { type: Type.ARRAY, items: { type: Type.STRING } },
                storageConcerns: { type: Type.ARRAY, items: { type: Type.STRING } },
                visibleConditionNotes: { type: Type.STRING },
                urgencyRecommendation: {
                  type: Type.STRING,
                  enum: ['Critical', 'High', 'Medium', 'Normal'],
                },
                humanReviewRecommendation: {
                  type: Type.STRING,
                  enum: ['Approve Recommended', 'Inspect Carefully', 'Hold / Clarify'],
                },
                confidenceNote: { type: Type.STRING },
              },
              required: [
                'categoryInterpretation',
                'missingInformation',
                'storageConcerns',
                'visibleConditionNotes',
                'urgencyRecommendation',
                'humanReviewRecommendation',
                'confidenceNote',
              ],
            },
          },
        })
      );

      const parsed = JSON.parse((response.text ?? '{}').trim()) as {
        categoryInterpretation: string;
        missingInformation: string[];
        storageConcerns: string[];
        visibleConditionNotes: string;
        urgencyRecommendation: UrgencyLevel;
        humanReviewRecommendation: AiAssessment['humanReviewRecommendation'];
        confidenceNote: string;
      };

      return {
        donationId: donation.id,
        source: 'gemini',
        modelUsed: DEFAULT_MODEL,
        categoryInterpretation: parsed.categoryInterpretation,
        missingInformation: parsed.missingInformation ?? [],
        storageConcerns: parsed.storageConcerns ?? [],
        visibleConditionNotes: parsed.visibleConditionNotes,
        urgencyRecommendation: parsed.urgencyRecommendation || donation.urgency,
        humanReviewRecommendation: parsed.humanReviewRecommendation || 'Inspect Carefully',
        confidenceNote: parsed.confidenceNote,
        disclaimer: SAFETY_DISCLAIMER,
      };
    } catch (err) {
      console.warn('Gemini assessFood failed, using rule-based fallback:', (err as Error).message);
    }
  }

  // Deterministic rule-based fallback
  const criticalCount = ruleFlags.filter((f) => f.severity === 'critical').length;
  const warningCount = ruleFlags.filter((f) => f.severity === 'warning').length;
  return {
    donationId: donation.id,
    source: 'fallback',
    modelUsed: 'rule-based-fallback',
    categoryInterpretation: `${donation.category} (${donation.dietaryType}), ${donation.portions} portions / ${donation.quantityKg} kg via ${donation.storageMethod}.`,
    missingInformation: ruleFlags.filter((f) => f.code.includes('MISSING')).map((f) => f.message),
    storageConcerns: ruleFlags.map((f) => f.message),
    visibleConditionNotes:
      donation.photos.length > 0
        ? 'Photo attached for human inspection (AI visual check unavailable; showing rule-based result).'
        : 'No photo attached.',
    urgencyRecommendation: donation.urgency,
    humanReviewRecommendation:
      criticalCount > 0 ? 'Hold / Clarify' : warningCount > 0 ? 'Inspect Carefully' : 'Approve Recommended',
    confidenceNote: 'AI unavailable — showing deterministic rule-based screening.',
    disclaimer: SAFETY_DISCLAIMER,
  };
}

export async function explainMatch(
  donation: Donation,
  candidates: MatchCandidate[],
  demoAiMode: boolean
): Promise<{ source: 'gemini' | 'fallback' | 'sample_demo'; explanations: Record<string, string> }> {
  const eligible = candidates.filter((c) => c.eligible).slice(0, 5);
  const fallbackMap: Record<string, string> = {};
  for (const c of eligible) {
    fallbackMap[c.ngoId] = `${c.ngoName} scored ${c.matchScore}/100 (Urgency ${c.urgencyScore}, Proximity ${c.proximityScore} at ${c.distanceKm} km / ~${c.estimatedTravelMins} mins, Capacity/Trust ${c.capacityScore} with trust score ${c.trustScore}/100).${c.unmetRequirementKg > 0 ? ` Matches active ${c.unmetRequirementKg} kg category requirement.` : ''}`;
  }

  if (eligible.length === 0) {
    return { source: demoAiMode ? 'sample_demo' : 'fallback', explanations: fallbackMap };
  }

  if (demoAiMode) {
    const sampleMap: Record<string, string> = {};
    for (const c of eligible) {
      sampleMap[c.ngoId] = `Sample AI output: ${c.ngoName} ranks with a computed match score of ${c.matchScore}/100, driven by ${c.urgencyScore}/100 need urgency and ${c.distanceKm} km distance (${c.estimatedTravelMins} mins travel). Trust score ${c.trustScore}/100 indicates reliable handover readiness.`;
    }
    return { source: 'sample_demo', explanations: sampleMap };
  }

  const ai = getClient();
  if (ai) {
    try {
      const prompt = `Explain each ranked NGO match in 2 short sentences using ONLY the provided computed metrics. Never invent numbers or change scores.
Donation: ${donation.title} (${donation.category}, ${donation.quantityKg} kg, urgency: ${donation.urgency}).
Candidates JSON: ${JSON.stringify(
        eligible.map((c) => ({
          ngoId: c.ngoId,
          ngoName: c.ngoName,
          matchScore: c.matchScore,
          urgencyScore: c.urgencyScore,
          proximityScore: c.proximityScore,
          capacityScore: c.capacityScore,
          distanceKm: c.distanceKm,
          estimatedTravelMins: c.estimatedTravelMins,
          trustScore: c.trustScore,
          unmetRequirementKg: c.unmetRequirementKg,
        }))
      )}`;

      const response = await withTimeoutAndRetry(() =>
        ai.models.generateContent({
          model: DEFAULT_MODEL,
          contents: prompt,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                items: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      ngoId: { type: Type.STRING },
                      explanation: { type: Type.STRING },
                    },
                    required: ['ngoId', 'explanation'],
                  },
                },
              },
              required: ['items'],
            },
          },
        })
      );

      const parsed = JSON.parse((response.text ?? '{}').trim()) as {
        items?: Array<{ ngoId: string; explanation: string }>;
      };
      const result: Record<string, string> = { ...fallbackMap };
      for (const item of parsed.items ?? []) {
        if (item.ngoId && item.explanation) {
          result[item.ngoId] = item.explanation;
        }
      }
      return { source: 'gemini', explanations: result };
    } catch (err) {
      console.warn('Gemini explainMatch failed, using template fallback:', (err as Error).message);
    }
  }

  return { source: 'fallback', explanations: fallbackMap };
}

export async function forecastSurplusAndDemand(
  baseline: ForecastBaseline,
  demoAiMode: boolean
): Promise<{
  source: 'gemini' | 'fallback' | 'sample_demo';
  narrative: string;
  highSurplusPeriods: string[];
  frequentlyWastedCategories: string[];
  possibleShortages: string[];
  recommendedActions: string[];
}> {
  const topDay = [...baseline.byWeekday].sort((a, b) => b.avgSurplusKg - a.avgSurplusKg)[0];
  const topPeak = [...baseline.peakHours].sort((a, b) => b.count - a.count)[0];
  const wasted = baseline.topCategories.filter((c) => c.wastedKg > 0).slice(0, 3);
  const shortages = baseline.shortageCategories.slice(0, 3);

  const fallbackResult = {
    source: (demoAiMode ? 'sample_demo' : 'fallback') as 'fallback' | 'sample_demo',
    narrative: `${demoAiMode ? 'Sample AI output: ' : ''}Based on ${baseline.sampleSize} historical records (${baseline.isPreliminary ? 'Preliminary / sample estimate' : '30-day moving average'}), surplus peaks on ${topDay?.day ?? 'weekends'} (${topDay?.avgSurplusKg ?? 0} kg avg) during ${topPeak?.window ?? '20:00–24:00'}.`,
    highSurplusPeriods: [`${topDay?.day ?? 'Sat'} (${topDay?.avgSurplusKg ?? 0} kg avg)`, `${topPeak?.window ?? '20:00–24:00'} (${topPeak?.sharePct ?? 0}% of posts)`],
    frequentlyWastedCategories: wasted.map((w) => `${w.category}: ${w.wastedKg} kg expired/rejected`),
    possibleShortages: shortages.map((s) => `${s.category}: ${s.unmetDemandKg} kg requested by NGOs`),
    recommendedActions: [
      `Pre-position volunteers near high-surplus zones during ${topPeak?.window ?? 'evening windows'}.`,
      shortages[0] ? `Encourage catering donors to flag ${shortages[0].category} surplus early.` : 'Maintain multi-NGO broadcast offers for rapid turnaround.',
    ],
  };

  if (demoAiMode) return fallbackResult;

  const ai = getClient();
  if (ai) {
    try {
      const response = await withTimeoutAndRetry(() =>
        ai.models.generateContent({
          model: DEFAULT_MODEL,
          contents: `Narrate and summarize these deterministic surplus & demand baseline statistics without inventing numbers:\n${JSON.stringify(baseline)}`,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                narrative: { type: Type.STRING },
                highSurplusPeriods: { type: Type.ARRAY, items: { type: Type.STRING } },
                frequentlyWastedCategories: { type: Type.ARRAY, items: { type: Type.STRING } },
                possibleShortages: { type: Type.ARRAY, items: { type: Type.STRING } },
                recommendedActions: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: [
                'narrative',
                'highSurplusPeriods',
                'frequentlyWastedCategories',
                'possibleShortages',
                'recommendedActions',
              ],
            },
          },
        })
      );
      const parsed = JSON.parse((response.text ?? '{}').trim());
      return {
        source: 'gemini',
        narrative: parsed.narrative || fallbackResult.narrative,
        highSurplusPeriods: parsed.highSurplusPeriods ?? fallbackResult.highSurplusPeriods,
        frequentlyWastedCategories: parsed.frequentlyWastedCategories ?? fallbackResult.frequentlyWastedCategories,
        possibleShortages: parsed.possibleShortages ?? fallbackResult.possibleShortages,
        recommendedActions: parsed.recommendedActions ?? fallbackResult.recommendedActions,
      };
    } catch (err) {
      console.warn('Gemini forecast failed, using deterministic baseline:', (err as Error).message);
    }
  }

  return fallbackResult;
}

export async function summarizeAnomalies(
  flags: Array<{ type: string; donationId?: string; message: string; severity: 'warning' | 'critical' }>,
  demoAiMode: boolean
): Promise<{ source: 'gemini' | 'fallback' | 'sample_demo'; summary: string }> {
  const fallbackSummary =
    flags.length === 0
      ? 'No quantity anomalies, duplicate submissions, or repeat-expiry patterns detected.'
      : `${flags.length} operational anomalies flagged by code checks: ${flags
          .slice(0, 3)
          .map((f) => f.message)
          .join(' ')}`;

  if (demoAiMode) {
    return { source: 'sample_demo', summary: `Sample AI output: ${fallbackSummary}` };
  }

  const ai = getClient();
  if (ai && flags.length > 0) {
    try {
      const response = await withTimeoutAndRetry(() =>
        ai.models.generateContent({
          model: DEFAULT_MODEL,
          contents: `Summarize these code-detected surplus platform anomalies in 2 concise admin-facing sentences without inventing records:\n${JSON.stringify(flags)}`,
          config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
        })
      );
      if (response.text) {
        return { source: 'gemini', summary: response.text.trim() };
      }
    } catch {
      // fallback
    }
  }

  return { source: 'fallback', summary: fallbackSummary };
}

export async function runAssistant(
  question: string,
  role: Role,
  snapshot: unknown,
  demoAiMode: boolean
): Promise<{ source: 'gemini' | 'fallback' | 'sample_demo'; answer: string }> {
  const qLower = question.toLowerCase();
  const snap = snapshot as Record<string, unknown>;

  const buildRuleAnswer = (): string => {
    const active = (snap.activeDonations as Array<Record<string, unknown>>) || [];
    const reqs = (snap.topShortages as Array<Record<string, unknown>>) || [];
    const impact = (snap.impactSummary as Record<string, unknown>) || {};

    if (role === 'donor' && (qLower.includes('other donor') || qLower.includes('all donors'))) {
      return 'Access boundary: As a Donor, you can only inspect your own donations and aggregate platform impact—other donors’ private listings are restricted.';
    }
    if (qLower.includes('attention') || qLower.includes('urgent') || qLower.includes('now')) {
      if (active.length === 0) return 'No active donations currently require immediate action.';
      const top = active[0];
      return `Priority item: "${top.title}" (${top.id}) is currently "${top.status}" with urgency "${top.urgency}" (${top.portions} portions, Safe Until ${new Date(String(top.safeUntil)).toLocaleTimeString()}).`;
    }
    if (qLower.includes('shortage') || qLower.includes('ngo')) {
      if (reqs.length === 0) return 'Insufficient NGO requirement records to rank current shortages.';
      const topReq = reqs[0];
      return `Largest current shortage: ${topReq.ngoName} needs ${topReq.neededKg} kg of ${topReq.category} (Urgency: ${topReq.urgency}).`;
    }
    if (qLower.includes('week') || qLower.includes('impact') || qLower.includes('waste')) {
      return `Completed records show ${impact.mealsProvided ?? 0} meals (${impact.redistributedKg ?? 0} kg) redistributed, avoiding an estimated ${impact.estimatedCo2eKg ?? 0} kg CO2e using configured assumptions.`;
    }
    return `Based on your ${role} workspace snapshot: ${active.length} active donations are tracked, and ${impact.completedDonations ?? 0} donations have completed verified handover. Ask about urgent donations, NGO shortages, or weekly waste reduction.`;
  };

  if (demoAiMode) {
    return { source: 'sample_demo', answer: `Sample AI output: ${buildRuleAnswer()}` };
  }

  const ai = getClient();
  if (ai) {
    try {
      const response = await withTimeoutAndRetry(() =>
        ai.models.generateContent({
          model: DEFAULT_MODEL,
          contents: `User Role: ${role}
Role-Filtered Real Snapshot JSON:
${JSON.stringify(snapshot)}

User Question: ${question}`,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            systemInstruction:
              'You are FoodBridge AI assistant. Answer strictly using the provided role-filtered JSON snapshot. Never invent IDs, organizations, or metrics. If data is insufficient, state that clearly. Enforce strict role privacy (for example, donors must never receive private details about other donors). Keep answers concise (2-4 sentences).',
          },
        })
      );
      if (response.text) {
        return { source: 'gemini', answer: response.text.trim() };
      }
    } catch (err) {
      console.warn('Gemini assistant failed, using deterministic fallback:', (err as Error).message);
    }
  }

  return { source: 'fallback', answer: buildRuleAnswer() };
}

export async function generateDashboardInsights(
  role: Role,
  snapshot: Record<string, unknown>,
  demoAiMode: boolean
): Promise<{ source: 'gemini' | 'fallback' | 'sample_demo'; insights: string[] }> {
  const active = (snapshot.activeDonations as Array<Record<string, unknown>>) || [];
  const reqs = (snapshot.topShortages as Array<Record<string, unknown>>) || [];
  const impact = (snapshot.impactSummary as Record<string, unknown>) || {};

  const fallbackInsights: string[] = [];
  if (active.length > 0) {
    fallbackInsights.push(
      `${active.length} active donation(s) in flight; "${active[0].title}" has ${active[0].urgency} urgency.`
    );
  }
  if (reqs.length > 0) {
    fallbackInsights.push(
      `Top unmet need: ${reqs[0].ngoName} requests ${reqs[0].neededKg} kg of ${reqs[0].category}.`
    );
  }
  fallbackInsights.push(
    `Verified handovers have rescued ${impact.redistributedKg ?? 0} kg (${impact.mealsProvided ?? 0} meals) to date.`
  );
  if (role === 'volunteer') {
    fallbackInsights.push('Check grouped route suggestions to combine nearby pickups before Safe Until windows close.');
  } else if (role === 'admin') {
    fallbackInsights.push('Review pending NGO verifications and any temperature/allergen safety flags promptly.');
  }

  if (demoAiMode) {
    return {
      source: 'sample_demo',
      insights: fallbackInsights.map((i) => `Sample AI output: ${i}`),
    };
  }

  const ai = getClient();
  if (ai) {
    try {
      const response = await withTimeoutAndRetry(() =>
        ai.models.generateContent({
          model: DEFAULT_MODEL,
          contents: `Generate 3 concise, actionable operational insights for the "${role}" dashboard using ONLY these real numbers:\n${JSON.stringify(snapshot)}`,
          config: {
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                insights: { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ['insights'],
            },
          },
        })
      );
      const parsed = JSON.parse((response.text ?? '{}').trim()) as { insights?: string[] };
      if (parsed.insights && parsed.insights.length > 0) {
        return { source: 'gemini', insights: parsed.insights.slice(0, 4) };
      }
    } catch {
      // fallback
    }
  }

  return { source: 'fallback', insights: fallbackInsights.slice(0, 4) };
}
