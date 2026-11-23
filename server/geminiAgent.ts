import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  ChatHistoryItem,
  GroundingSource,
  OriginLocation,
  ParsedIntent,
  ReviewSnippet,
  Specialist,
  SuggestedPrompt,
  TravelMode,
} from '../src/types.ts';
import { getTodayHoursSummary } from '../src/utils/agentLogic.ts';
import {
  classifyGeminiError,
  extractRetryDelayMs,
  isHardQuotaExhausted,
  shouldFallbackFromPrimaryModel,
} from '../src/utils/geminiError.ts';
import { formatDistance, formatTravelTime } from '../src/utils/ranking.ts';

const HYDROGEN_MODEL = 'gemini-4-hydrogen';
const FALLBACK_FLASH_MODEL = 'gemini-3.8-flash';
const LOW_THINKING_CONFIG = { thinkingLevel: ThinkingLevel.LOW } as const;
const QUOTA_COOLDOWN_MS = 5 * 60_000;

let mapsGroundingCooldownUntil = 0;
let hydrogenModelCooldownUntil = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isMapsGroundingReady(): boolean {
  return Date.now() >= mapsGroundingCooldownUntil;
}

export function markMapsGroundingQuotaCooldown(): void {
  mapsGroundingCooldownUntil = Date.now() + QUOTA_COOLDOWN_MS;
}

export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: { 'User-Agent': 'aistudio-build' },
      retryOptions: {
        // Keep retries fast; callGeminiWithRetry handles short transient backoffs.
        attempts: 1,
      },
    },
  });
}

async function callGeminiWithRetry<T>(fn: () => Promise<T>, maxAttempts = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const kind = classifyGeminiError(err);
      if (kind === 'auth' || isHardQuotaExhausted(err)) {
        throw err;
      }
      if (attempt < maxAttempts - 1 && (kind === 'transient' || kind === 'quota')) {
        const delayMs = extractRetryDelayMs(err, 2000) ?? 400 * (attempt + 1);
        await sleep(delayMs);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function generateWithFallback(
  ai: GoogleGenAI,
  contents: string,
  baseConfig: Record<string, unknown> = {}
) {
  const configWithLowThinking = {
    ...baseConfig,
    thinkingConfig: LOW_THINKING_CONFIG,
  };

  const tryHydrogen = Date.now() >= hydrogenModelCooldownUntil;
  if (tryHydrogen) {
    try {
      return await callGeminiWithRetry(() =>
        ai.models.generateContent({
          model: HYDROGEN_MODEL,
          contents,
          config: configWithLowThinking,
        })
      );
    } catch (err) {
      if (shouldFallbackFromPrimaryModel(err)) {
        hydrogenModelCooldownUntil = Date.now() + QUOTA_COOLDOWN_MS;
        return await callGeminiWithRetry(() =>
          ai.models.generateContent({
            model: FALLBACK_FLASH_MODEL,
            contents,
            config: configWithLowThinking,
          })
        );
      }
      throw err;
    }
  }

  return await callGeminiWithRetry(() =>
    ai.models.generateContent({
      model: FALLBACK_FLASH_MODEL,
      contents,
      config: configWithLowThinking,
    })
  );
}

export interface HydrogenMapsGroundingResult {
  summary: string;
  groundingSources: GroundingSource[];
}

export interface OpenEndedAnswerResult {
  summary: string;
  suggestedFollowUps: SuggestedPrompt[];
  groundingSources: GroundingSource[];
}

function formatRecentHistory(history: ChatHistoryItem[]): string {
  return history
    .slice(-4)
    .map((h) => `${h.role === 'user' ? 'User' : 'Meridian'}: ${h.text}`)
    .join('\n');
}

function formatSpecialistsContext(
  specialists: Specialist[],
  travelMode: TravelMode
): string {
  const modeLabel =
    travelMode === 'WALK' ? 'walking' : travelMode === 'BICYCLE' ? 'biking' : 'driving';

  return specialists
    .slice(0, 6)
    .map((s, idx) => {
      const todayHours = getTodayHoursSummary(s.weekdayDescriptions);
      const rev = s.topReviews?.[0]?.text || s.reviews?.[0]?.text;
      const revNote = rev ? ` | Review: "${rev.slice(0, 120)}"` : '';
      const open =
        s.openNow === true ? 'Open' : s.openNow === false ? 'Closed' : 'Hours unknown';
      return `#${idx + 1} ${s.name} (${s.specialty}) — ${s.rating?.toFixed(1) ?? 'N/A'}★ (${s.userRatingCount}), ${formatTravelTime(s.travelDurationSeconds)} ${modeLabel} (${formatDistance(s.distanceMeters)}), ${open}${todayHours ? `, today: ${todayHours}` : ''}${revNote}`;
    })
    .join('\n');
}

function extractGroundingResult(response: {
  text?: string;
  candidates?: Array<{
    groundingMetadata?: {
      groundingChunks?: unknown[];
    };
  }>;
}): HydrogenMapsGroundingResult {
  const summary = (response.text ?? '').replace(/\*\*([^*]+)\*\*/g, '$1').trim();
  const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const groundingSources: GroundingSource[] = [];
  const seenUris = new Set<string>();

  for (const chunk of rawChunks as Array<{
    maps?: {
      uri?: string;
      title?: string;
      placeId?: string;
      placeAnswerSources?: {
        reviewSnippets?: Array<{
          reviewText?: string;
          text?: string;
          content?: string;
          googleMapsUri?: string;
          uri?: string;
        }>;
      };
    };
  }>) {
    const maps = chunk.maps;
    if (!maps?.uri || seenUris.has(maps.uri)) continue;
    seenUris.add(maps.uri);

    const snippets: ReviewSnippet[] = [];
    for (const snip of maps.placeAnswerSources?.reviewSnippets ?? []) {
      const text = (snip.reviewText || snip.text || snip.content || '').trim();
      if (text) {
        snippets.push({
          text,
          uri: snip.googleMapsUri || snip.uri || maps.uri,
        });
      }
    }

    groundingSources.push({
      title: maps.title?.trim() || 'View on Google Maps',
      uri: maps.uri,
      placeId: maps.placeId,
      reviewSnippets: snippets.length > 0 ? snippets : undefined,
    });
  }

  return { summary, groundingSources };
}

export function buildProviderMapLinks(
  specialists: Specialist[],
  summaryText: string,
  maxLinks = 3
): GroundingSource[] {
  if (!specialists.length) return [];
  const lower = summaryText.toLowerCase();
  const mentioned = specialists.filter((s) => {
    if (!s.googleMapsUri) return false;
    const nameLower = s.name.toLowerCase();
    if (lower.includes(nameLower)) return true;
    const firstWord = nameLower.split(/[^a-z0-9]+/).find((w) => w.length >= 5);
    return Boolean(firstWord && lower.includes(firstWord));
  });

  const pool =
    mentioned.length > 0
      ? mentioned
      : specialists.filter((s) => Boolean(s.googleMapsUri));

  return pool.slice(0, maxLinks).map((s) => ({
    title: s.name,
    uri: s.googleMapsUri!,
    placeId: s.id,
  }));
}

function parseJsonObject<T>(rawText: string | undefined): Partial<T> {
  const cleaned = (rawText ?? '{}')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  return JSON.parse(cleaned || '{}') as Partial<T>;
}

export async function classifyIntentWithHydrogen(
  ai: GoogleGenAI,
  message: string,
  hasExistingOrigin: boolean
): Promise<ParsedIntent> {
  const contents = `Classify this user message for a local specialist finder.
Origin set: ${hasExistingOrigin ? 'yes' : 'no'}.
Message: "${message}"`;

  const response = await generateWithFallback(ai, contents, {
    systemInstruction:
      'Return action="set_location_only" if the user only shared a location, or action="search" if they want a specialist or place. Extract locationText, specialistQuery (translate symptoms to specialist type), and optional travelMode (DRIVE, WALK, or BICYCLE).',
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING },
        specialistQuery: { type: Type.STRING, nullable: true },
        locationText: { type: Type.STRING, nullable: true },
        travelMode: { type: Type.STRING, nullable: true },
        preferences: { type: Type.STRING, nullable: true },
      },
      required: ['action'],
    },
  });

  const parsed = parseJsonObject<ParsedIntent>(response.text);
  const normalizedAction =
    parsed.action === 'set_location_only' && !parsed.specialistQuery
      ? 'set_location_only'
      : 'search';
  const validMode =
    parsed.travelMode === 'WALK' ||
    parsed.travelMode === 'BICYCLE' ||
    parsed.travelMode === 'DRIVE'
      ? parsed.travelMode
      : undefined;

  return {
    action: normalizedAction,
    specialistQuery: parsed.specialistQuery?.trim() || null,
    locationText: parsed.locationText?.trim() || null,
    travelMode: validMode,
    preferences: parsed.preferences?.trim() || null,
  };
}

export async function runHydrogenMapsGrounding(
  ai: GoogleGenAI,
  specialistQuery: string,
  origin: OriginLocation,
  travelMode: TravelMode,
  userMessage: string,
  history: ChatHistoryItem[] = []
): Promise<HydrogenMapsGroundingResult> {
  const modeLabel =
    travelMode === 'WALK' ? 'walking' : travelMode === 'BICYCLE' ? 'biking' : 'driving';
  const recentHistory = formatRecentHistory(history);

  const prompt = `${recentHistory ? `Recent:\n${recentHistory}\n\n` : ''}User: "${userMessage}"
Specialty: ${specialistQuery}
Origin: ${origin.formattedAddress} (${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)})
Mode: ${modeLabel}

Reply in 1 to 2 crisp sentences (under 38 words, plain text, no markdown). Name the standout pick balancing ratings and ${modeLabel} time, and let the map cards show the details.`;

  const response = await generateWithFallback(ai, prompt, {
    tools: [{ googleMaps: {} }],
    toolConfig: {
      retrievalConfig: {
        latLng: { latitude: origin.lat, longitude: origin.lng },
      },
    },
  });

  return extractGroundingResult(response);
}

export async function runGroundedPlacesSynthesis(
  ai: GoogleGenAI,
  userMessage: string,
  specialists: Specialist[],
  origin: OriginLocation | null,
  travelMode: TravelMode,
  history: ChatHistoryItem[] = []
): Promise<HydrogenMapsGroundingResult> {
  const recentHistory = formatRecentHistory(history);
  const context = formatSpecialistsContext(specialists, travelMode);

  const prompt = `${recentHistory ? `Recent:\n${recentHistory}\n\n` : ''}Origin: ${origin?.formattedAddress || 'Not specified'}
Mapped options:
${context}

User: "${userMessage}"

Reply in 1 to 2 crisp sentences (under 38 words, plain text, no markdown). Highlight the clearest trade-off using real ratings, travel times, or hours above.`;

  const response = await generateWithFallback(ai, prompt);
  return extractGroundingResult(response);
}

export async function runOpenEndedChatAnswer(
  ai: GoogleGenAI,
  userMessage: string,
  specialists: Specialist[],
  origin: OriginLocation | null,
  travelMode: TravelMode,
  history: ChatHistoryItem[] = []
): Promise<OpenEndedAnswerResult> {
  const recentHistory = formatRecentHistory(history);
  const context = formatSpecialistsContext(specialists, travelMode);

  const prompt = `${recentHistory ? `Recent:\n${recentHistory}\n\n` : ''}Origin: ${origin?.formattedAddress || 'Not set'}
${context ? `Mapped options:\n${context}\n\n` : ''}User: "${userMessage}"

Answer directly in 1 to 2 crisp sentences (under 40 words, plain prose, no markdown). Propose 2 to 3 short follow-up buttons (label <= 30 chars).`;

  const response = await generateWithFallback(ai, prompt, {
    responseMimeType: 'application/json',
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        answer: { type: Type.STRING },
        followUps: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              label: { type: Type.STRING },
              prompt: { type: Type.STRING },
            },
            required: ['label', 'prompt'],
          },
        },
      },
      required: ['answer', 'followUps'],
    },
  });

  const parsed = parseJsonObject<{
    answer?: string;
    followUps?: Array<{ label?: string; prompt?: string }>;
  }>(response.text);

  const summary = (parsed.answer ?? '').replace(/\*\*([^*]+)\*\*/g, '$1').trim();
  const suggestedFollowUps = (parsed.followUps ?? [])
    .filter((f) => Boolean(f.label?.trim() && f.prompt?.trim()))
    .slice(0, 3)
    .map((f) => ({
      label: f.label!.trim().slice(0, 34),
      prompt: f.prompt!.trim(),
    }));

  return {
    summary,
    suggestedFollowUps,
    groundingSources: buildProviderMapLinks(specialists, summary, 3),
  };
}
