import { GoogleGenAI, ThinkingLevel, Type, type FunctionDeclaration } from '@google/genai';
import { SHOWCASE_CONFIG } from '../src/config/showcase.ts';
import type {
  ChatHistoryItem,
  GroundingSource,
  LatLng,
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
  isInvalidArgumentError,
  shouldCooldownPrimaryModel,
  shouldFallbackFromPrimaryModel,
} from '../src/utils/geminiError.ts';
import { formatDistance, formatTravelTime } from '../src/utils/ranking.ts';
import { cleanBoundedText, isUsableApiKey } from '../src/utils/sanitize.ts';

const HYDROGEN_MODEL = 'gemini-4-hydrogen';
const FALLBACK_FLASH_MODEL = 'gemini-3.8-flash';
const LOW_THINKING_CONFIG = { thinkingLevel: ThinkingLevel.LOW } as const;
const QUOTA_COOLDOWN_MS = 5 * 60_000;

let mapsGroundingCooldownUntil = 0;
let geminiApiCooldownUntil = 0;
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

export function isGeminiApiReady(): boolean {
  return Date.now() >= geminiApiCooldownUntil;
}

export function markGeminiQuotaCooldown(): void {
  geminiApiCooldownUntil = Date.now() + QUOTA_COOLDOWN_MS;
}

export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!isUsableApiKey(apiKey)) return null;
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
        if (shouldCooldownPrimaryModel(err)) {
          hydrogenModelCooldownUntil = Date.now() + QUOTA_COOLDOWN_MS;
        }
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

function buildMapsToolConfig(
  coords?: LatLng | null
): Record<string, unknown> | undefined {
  if (!coords || !Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) {
    return undefined;
  }
  return {
    retrievalConfig: {
      latLng: {
        latitude: coords.lat,
        longitude: coords.lng,
      },
    },
  };
}

function resolveGroundingCoords(
  origin: OriginLocation | null,
  specialists: Specialist[]
): LatLng | null {
  if (origin) return { lat: origin.lat, lng: origin.lng };
  if (specialists[0]?.location) return specialists[0].location;
  return null;
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
    .map((h) => `${h.role === 'user' ? 'User' : SHOWCASE_CONFIG.brandName}: ${h.text}`)
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
      const safeName = cleanBoundedText(s.name, 120) || 'Specialist';
      const safeSpecialty = cleanBoundedText(s.specialty, 80) || 'Specialist';
      const todayHours = cleanBoundedText(getTodayHoursSummary(s.weekdayDescriptions), 80);
      const editorial = cleanBoundedText(s.editorialSummary, 110);
      const revList = (s.topReviews && s.topReviews.length > 0 ? s.topReviews : s.reviews) ?? [];
      const revNote = revList
        .slice(0, 2)
        .map((r) => `"${cleanBoundedText(r.text, 120)}" (${r.rating}★)`)
        .join(' / ');
      const open =
        s.openNow === true ? 'Open now' : s.openNow === false ? 'Closed now' : 'Hours unknown';
      const dist = formatDistance(s.distanceMeters) || 'distance N/A';
      const breakdown = s.scoreBreakdown
        ? `Weighted ${s.scoreBreakdown.overall}/100 [Rating ${s.scoreBreakdown.ratingScore}, Time ${s.scoreBreakdown.travelTimeScore}, Dist ${s.scoreBreakdown.distanceScore}]`
        : s.compositeScore != null
          ? `Weighted ${s.compositeScore}/100`
          : '';
      const access = s.wheelchairAccessible ? ', wheelchair accessible' : '';
      return `#${idx + 1} ${safeName} (${safeSpecialty}) — ${breakdown ? `${breakdown} | ` : ''}${s.rating?.toFixed(1) ?? 'N/A'}★ (${s.userRatingCount} reviews), ${formatTravelTime(s.travelDurationSeconds)} ${modeLabel} (${dist}), ${open}${todayHours ? `, today: ${todayHours}` : ''}${access}${editorial ? ` | Summary: ${editorial}` : ''}${revNote ? ` | Reviews: ${revNote}` : ''}`;
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

const ROUTE_AGENT_ACTION_DECLARATION: FunctionDeclaration = {
  name: 'route_agent_action',
  description:
    'Route the user request to either set a starting location or run a local specialist search.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      action: {
        type: Type.STRING,
        description:
          'Either "set_location_only" if the user only shared a location, or "search" if they want a local specialist or place.',
      },
      specialistQuery: {
        type: Type.STRING,
        description:
          'Concrete local specialist or place category to search on Google Maps (translate symptoms or needs into a specialist type). Omit if only setting a location.',
      },
      locationText: {
        type: Type.STRING,
        description: 'City, neighborhood, ZIP, or street address mentioned by the user, if any.',
      },
      travelMode: {
        type: Type.STRING,
        description: 'Optional travel mode: DRIVE, WALK, or BICYCLE.',
      },
      preferences: {
        type: Type.STRING,
        description: 'Optional user preferences such as open now, wheelchair accessible, or pediatric.',
      },
    },
    required: ['action'],
  },
};

function normalizeParsedIntent(
  raw: Record<string, unknown>,
  fallbackMessage: string,
  hasExistingOrigin: boolean
): ParsedIntent {
  const specialistQuery = cleanBoundedText(raw.specialistQuery, 120) || null;
  const locationText = cleanBoundedText(raw.locationText, 200) || null;
  const preferences = cleanBoundedText(raw.preferences, 160) || null;
  const validMode =
    raw.travelMode === 'WALK' || raw.travelMode === 'BICYCLE' || raw.travelMode === 'DRIVE'
      ? raw.travelMode
      : undefined;

  const normalizedAction =
    raw.action === 'set_location_only' && !specialistQuery ? 'set_location_only' : 'search';

  if (normalizedAction === 'search' && !specialistQuery && !locationText) {
    const safeFallback = cleanBoundedText(fallbackMessage, 120);
    return {
      action: hasExistingOrigin ? 'search' : 'set_location_only',
      specialistQuery: hasExistingOrigin ? safeFallback || null : null,
      locationText: hasExistingOrigin ? null : cleanBoundedText(fallbackMessage, 200) || null,
      travelMode: validMode,
      preferences,
    };
  }

  return {
    action: normalizedAction,
    specialistQuery,
    locationText,
    travelMode: validMode,
    preferences,
  };
}

function parseKeyValueIntentLines(
  text: string | undefined,
  fallbackMessage: string,
  hasExistingOrigin: boolean
): ParsedIntent {
  const fields: Record<string, string> = {};
  for (const line of (text ?? '').split('\n')) {
    const match = line.match(/^\s*(ACTION|SPECIALIST|LOCATION|MODE|PREFERENCES)\s*:\s*(.+?)\s*$/i);
    if (!match) continue;
    const key = match[1].toUpperCase();
    const val = match[2].trim();
    if (val && !/^(?:none|null|n\/a)$/i.test(val)) {
      fields[key] = val;
    }
  }

  return normalizeParsedIntent(
    {
      action: fields.ACTION?.toLowerCase(),
      specialistQuery: fields.SPECIALIST,
      locationText: fields.LOCATION,
      travelMode: fields.MODE?.toUpperCase(),
      preferences: fields.PREFERENCES,
    },
    fallbackMessage,
    hasExistingOrigin
  );
}

/**
 * Classifies user intent via Gemini Function Calling without attaching Maps Grounding,
 * keeping routing fast, immune to hybrid tool 400 errors, and conserving Maps Grounding quota.
 */
export async function classifyIntentWithHydrogen(
  ai: GoogleGenAI,
  message: string,
  hasExistingOrigin: boolean,
  origin: OriginLocation | null = null
): Promise<ParsedIntent> {
  const { persona, intentGuidance, entitySingular } = SHOWCASE_CONFIG.agent;
  const safeMessage = cleanBoundedText(message, 400);
  const contents = `Classify this user message for ${persona}.
Origin set: ${hasExistingOrigin ? `yes (${cleanBoundedText(origin?.formattedAddress, 180) || 'current'})` : 'no'}.
Message: "${safeMessage}"`;

  const systemInstruction = `You are ${persona}. ${intentGuidance} Always invoke the route_agent_action tool to return your routing decision: use action="set_location_only" if the user only shared a location, or action="search" if they want a local ${entitySingular} or place.`;

  const response = await generateWithFallback(ai, contents, {
    systemInstruction,
    tools: [{ functionDeclarations: [ROUTE_AGENT_ACTION_DECLARATION] }],
  });

  const call =
    response.functionCalls?.find((fc) => fc.name === 'route_agent_action') ??
    response.functionCalls?.[0];
  if (call?.args && typeof call.args === 'object') {
    return normalizeParsedIntent(
      call.args as Record<string, unknown>,
      safeMessage,
      hasExistingOrigin
    );
  }

  return parseKeyValueIntentLines(response.text, safeMessage, hasExistingOrigin);
}

/**
 * Primary search recommendation grounded directly in Google Maps via Gemini.
 */
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

  const prompt = `${recentHistory ? `Recent:\n${recentHistory}\n\n` : ''}User: "${cleanBoundedText(userMessage, 400)}"
Category: ${cleanBoundedText(specialistQuery, 120)}
Origin: ${cleanBoundedText(origin.formattedAddress, 200)} (${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)})
Mode: ${modeLabel}

Reply in 2 crisp sentences (under 55 words, plain text, no markdown). Name the standout pick with its rating/review count, ${modeLabel} time, open hours if available, and one concrete takeaway from reviews to help the user decide.`;

  const response = await generateWithFallback(ai, prompt, {
    systemInstruction: `You are ${SHOWCASE_CONFIG.agent.persona}. Keep answers concise, decision-focused, and grounded in Google Maps.`,
    tools: [{ googleMaps: {} }],
    toolConfig: buildMapsToolConfig({ lat: origin.lat, lng: origin.lng }),
  });

  return extractGroundingResult(response);
}

/**
 * Synthesis for comparisons, open-now filtering, sorting, and shortlist decisions.
 * Uses Google Maps Grounding when enabled and ready, and degrades cleanly to ungrounded
 * synthesis over the live Places results if Maps Grounding hits quota or is unavailable.
 */
export async function runGroundedPlacesSynthesis(
  ai: GoogleGenAI,
  userMessage: string,
  specialists: Specialist[],
  origin: OriginLocation | null,
  travelMode: TravelMode,
  history: ChatHistoryItem[] = [],
  options: { useMapsGrounding?: boolean } = {}
): Promise<HydrogenMapsGroundingResult> {
  const recentHistory = formatRecentHistory(history);
  const context = formatSpecialistsContext(specialists, travelMode);
  const coords = resolveGroundingCoords(origin, specialists);
  const toolConfig = buildMapsToolConfig(coords);
  const tryMapsGrounding = options.useMapsGrounding ?? isMapsGroundingReady();

  const { rating, travelTime, distance } = SHOWCASE_CONFIG.agent.rankingWeights;
  const weightLine = `Weighted ranking formula: ${Math.round(rating * 100)}% Google rating & review volume, ${Math.round(travelTime * 100)}% travel time, ${Math.round(distance * 100)}% distance.`;

  const prompt = `${recentHistory ? `Recent:\n${recentHistory}\n\n` : ''}Origin: ${cleanBoundedText(origin?.formattedAddress, 200) || 'Not specified'}
${weightLine}
Live mapped options with place details:
${context}

User: "${cleanBoundedText(userMessage, 400)}"

Synthesize a crisp 2-sentence decision verdict (under 65 words, plain text, no markdown). Explain why #1 leads on the weighted balance of Google rating, travel time, and distance (citing hours or a concrete review detail), and name the strongest #2 alternative (e.g. faster trip or higher rating).`;

  const systemInstruction = `You are ${SHOWCASE_CONFIG.agent.persona}. Reason carefully over the live place details (Google ratings, review counts, travel times, distances, hours, and reviews) and ground recommendations in Google Maps.`;

  if (tryMapsGrounding) {
    try {
      const response = await generateWithFallback(ai, prompt, {
        systemInstruction,
        tools: [{ googleMaps: {} }],
        ...(toolConfig ? { toolConfig } : {}),
      });
      return extractGroundingResult(response);
    } catch (err) {
      const kind = classifyGeminiError(err);
      if (kind === 'quota' || isInvalidArgumentError(err)) {
        markMapsGroundingQuotaCooldown();
        // Fall through to ungrounded synthesis over already-fetched live Places results
      } else {
        throw err;
      }
    }
  }

  const ungrounded = await generateWithFallback(ai, prompt, { systemInstruction });
  return extractGroundingResult(ungrounded);
}

/**
 * Q&A for place-specific questions (hours, reviews, suitability) and open-ended guidance.
 * Uses Google Maps Grounding when ready, and falls back to ungrounded Gemini synthesis
 * over live mapped options when Maps Grounding is unavailable or rate-limited.
 */
export async function runOpenEndedChatAnswer(
  ai: GoogleGenAI,
  userMessage: string,
  specialists: Specialist[],
  origin: OriginLocation | null,
  travelMode: TravelMode,
  history: ChatHistoryItem[] = [],
  options: { useMapsGrounding?: boolean } = {}
): Promise<OpenEndedAnswerResult> {
  const recentHistory = formatRecentHistory(history);
  const context = formatSpecialistsContext(specialists, travelMode);
  const coords = resolveGroundingCoords(origin, specialists);
  const toolConfig = buildMapsToolConfig(coords);
  const tryMapsGrounding = options.useMapsGrounding ?? isMapsGroundingReady();

  const prompt = `${recentHistory ? `Recent:\n${recentHistory}\n\n` : ''}Origin: ${cleanBoundedText(origin?.formattedAddress, 200) || 'Not set'}
${context ? `Mapped options:\n${context}\n\n` : ''}User: "${cleanBoundedText(userMessage, 400)}"

Answer directly in 2 crisp sentences (under 55 words, plain prose, no markdown), citing real hours, ratings, and review takeaways whenever relevant.`;

  const systemInstruction = `You are ${SHOWCASE_CONFIG.agent.persona}. Answer concisely using live Google Maps grounding and the mapped options when present.`;

  let response;
  if (tryMapsGrounding) {
    try {
      response = await generateWithFallback(ai, prompt, {
        systemInstruction,
        tools: [{ googleMaps: {} }],
        ...(toolConfig ? { toolConfig } : {}),
      });
    } catch (err) {
      const kind = classifyGeminiError(err);
      if (kind === 'quota' || isInvalidArgumentError(err)) {
        markMapsGroundingQuotaCooldown();
        response = await generateWithFallback(ai, prompt, { systemInstruction });
      } else {
        throw err;
      }
    }
  } else {
    response = await generateWithFallback(ai, prompt, { systemInstruction });
  }

  const grounded = extractGroundingResult(response);
  const groundingSources =
    grounded.groundingSources.length > 0
      ? grounded.groundingSources
      : buildProviderMapLinks(specialists, grounded.summary, 3);

  return {
    summary: grounded.summary,
    suggestedFollowUps: [],
    groundingSources,
  };
}
