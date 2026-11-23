import 'dotenv/config';
import express, { type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildProviderMapLinks,
  classifyIntentWithHydrogen,
  getGeminiClient,
  isMapsGroundingReady,
  markMapsGroundingQuotaCooldown,
  runGroundedPlacesSynthesis,
  runHydrogenMapsGrounding,
  runOpenEndedChatAnswer,
  type HydrogenMapsGroundingResult,
} from './server/geminiAgent.ts';
import {
  fetchPlaceDetailsInsights,
  fetchPlacePhotoUri,
  geocodeAddressServer,
  getMapsApiKey,
  getRequestReferer,
  QuotaExceededError,
  ReferrerRestrictedError,
  reverseGeocodeServer,
  searchPlacesWithRoutingServer,
} from './server/mapsApi.ts';
import type {
  AgentSearchResponse,
  ChatHistoryItem,
  GenUiBlock,
  GroundingSource,
  OriginLocation,
  ParsedIntent,
  SortMode,
  Specialist,
  TravelMode,
} from './src/types.ts';
import {
  buildContextualFollowUps,
  buildDeterministicAgentReply,
  detectConversationalAction,
  isStandaloneOpenEndedQuestion,
} from './src/utils/agentLogic.ts';
import { classifyGeminiError, formatGeminiUserNotice } from './src/utils/geminiError.ts';
import { buildA2uiSpecialistsBatchMessages } from './src/utils/mapsSync.ts';
import { parseFastUserMessage, rankSpecialists } from './src/utils/ranking.ts';
import { safeExternalUrl } from './src/utils/url.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidCoordinate(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function sanitizeOrigin(raw: unknown): OriginLocation | null {
  if (!isRecord(raw)) return null;
  if (!isValidCoordinate(raw.lat, raw.lng)) return null;
  const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, 120) : '';
  const formattedAddress =
    typeof raw.formattedAddress === 'string' ? raw.formattedAddress.trim().slice(0, 200) : '';
  return {
    label: label || formattedAddress || `${(raw.lat as number).toFixed(4)}, ${(raw.lng as number).toFixed(4)}`,
    formattedAddress: formattedAddress || label || `${(raw.lat as number).toFixed(4)}, ${(raw.lng as number).toFixed(4)}`,
    lat: raw.lat as number,
    lng: raw.lng as number,
  };
}

function sanitizeHistory(raw: unknown): ChatHistoryItem[] {
  if (!Array.isArray(raw)) return [];
  const items: ChatHistoryItem[] = [];
  for (const entry of raw.slice(-6)) {
    if (!isRecord(entry)) continue;
    const role = entry.role === 'user' || entry.role === 'assistant' ? entry.role : null;
    const text = typeof entry.text === 'string' ? entry.text.trim().slice(0, 400) : '';
    if (role && text) {
      items.push({ role, text });
    }
  }
  return items;
}

function sanitizeSpecialists(raw: unknown): Specialist[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 12)
    .filter(
      (item): item is Specialist =>
        isRecord(item) &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        isRecord(item.location) &&
        isValidCoordinate(item.location.lat, item.location.lng)
    )
    .map((item) => ({
      ...item,
      googleMapsUri: safeExternalUrl(item.googleMapsUri),
      directionsUri: safeExternalUrl(item.directionsUri),
      websiteUri: safeExternalUrl(item.websiteUri),
    }));
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  // Public runtime Maps config (never exposes GEMINI_API_KEY)
  app.get('/api/config', (_req: Request, res: Response) => {
    res.json({ mapsApiKey: getMapsApiKey() });
  });

  // On-demand Place Photos (New) proxy — never caches photo resource names per GMP ToS 3.2.3(b)
  app.get('/api/place-photo', async (req: Request, res: Response) => {
    const mapsKey = getMapsApiKey();
    if (!mapsKey) return res.status(503).end();

    const rawName = typeof req.query.name === 'string' ? req.query.name.trim() : '';
    if (!/^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/.test(rawName)) {
      return res.status(400).json({ error: 'Invalid photo resource name.' });
    }

    const rawW = Number(req.query.maxWidthPx);
    const rawH = Number(req.query.maxHeightPx);
    const maxWidthPx = Math.round(Math.min(Math.max(Number.isFinite(rawW) && rawW > 0 ? rawW : 480, 64), 1200));
    const maxHeightPx = Math.round(Math.min(Math.max(Number.isFinite(rawH) && rawH > 0 ? rawH : 320, 64), 1200));

    try {
      const result = await fetchPlacePhotoUri(
        rawName,
        maxWidthPx,
        maxHeightPx,
        mapsKey,
        getRequestReferer(req)
      );
      if (result.quotaExceeded) return res.status(429).json({ quotaExceeded: true });
      if (!result.photoUri) return res.status(result.status).end();

      res.setHeader('Cache-Control', 'no-store');
      return res.redirect(302, result.photoUri);
    } catch {
      return res.status(502).end();
    }
  });

  // On-demand Place Details (New) proxy
  app.get('/api/place-details', async (req: Request, res: Response) => {
    const mapsKey = getMapsApiKey();
    const placeId = typeof req.query.placeId === 'string' ? req.query.placeId.trim() : '';

    if (!/^[A-Za-z0-9_-]{10,160}$/.test(placeId)) {
      return res.status(400).json({ error: 'Invalid Google Place ID.' });
    }
    if (!mapsKey) {
      return res.status(503).json({
        needsClientDetailsFallback: true,
        error: 'Maps API key not configured on server.',
      });
    }

    try {
      const { status, payload } = await fetchPlaceDetailsInsights(
        placeId,
        mapsKey,
        getRequestReferer(req)
      );
      if (status === 200) res.setHeader('Cache-Control', 'no-store');
      return res.status(status).json(payload);
    } catch {
      return res.status(502).json({ error: 'Unable to fetch place details right now.' });
    }
  });

  // Forward and reverse geocoding proxy
  app.post('/api/geocode', async (req: Request, res: Response) => {
    const mapsKey = getMapsApiKey();
    const referer = getRequestReferer(req);
    const body = isRecord(req.body) ? req.body : {};
    const address = typeof body.address === 'string' ? body.address.trim().slice(0, 200) : '';
    const lat = body.lat;
    const lng = body.lng;

    try {
      if (lat !== undefined || lng !== undefined) {
        if (!isValidCoordinate(lat, lng)) {
          return res.status(400).json({ error: 'Invalid latitude or longitude.' });
        }
        const origin = await reverseGeocodeServer(lat, lng as number, mapsKey, referer);
        return res.json({ origin });
      }
      if (address) {
        const origin = await geocodeAddressServer(address, mapsKey, referer);
        if (!origin) {
          return res.status(404).json({
            error: `Could not locate "${address}". Try a city, ZIP, or street address.`,
          });
        }
        return res.json({ origin });
      }
      return res.status(400).json({ error: 'Provide either an address or coordinates.' });
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        return res.status(429).json({ quotaExceeded: true, error: err.message });
      }
      if (err instanceof ReferrerRestrictedError) {
        return res.json({
          origin: null,
          needsClientGeocode: address || null,
        });
      }
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Geocoding failed.',
      });
    }
  });

  // Main conversational agent endpoint: Gemini 4 Hydrogen + Maps Grounding + Places API (New)
  app.post('/api/agent', async (req: Request, res: Response) => {
    const body = isRecord(req.body) ? req.body : {};
    const userText = typeof body.message === 'string' ? body.message.trim().slice(0, 500) : '';
    const explicitSpecialty =
      typeof body.explicitSpecialty === 'string'
        ? body.explicitSpecialty.trim().slice(0, 120) || null
        : null;
    const activeSpecialty =
      typeof body.activeSpecialty === 'string'
        ? body.activeSpecialty.trim().slice(0, 120) || null
        : null;
    const providedOrigin = sanitizeOrigin(body.origin);
    const providedTravelMode = body.travelMode;

    if (!userText && !explicitSpecialty) {
      return res.status(400).json({ error: 'Enter a specialist or location to start.' });
    }

    const ai = getGeminiClient();
    const mapsKey = getMapsApiKey();
    const referer = getRequestReferer(req);
    let activeTravelMode: TravelMode =
      providedTravelMode === 'WALK' || providedTravelMode === 'BICYCLE'
        ? providedTravelMode
        : 'DRIVE';
    const existingList = sanitizeSpecialists(body.currentSpecialists);
    const safeHistory = sanitizeHistory(body.history);
    const syncedCount = Array.isArray(body.syncedIds) ? body.syncedIds.length : 0;

    try {
      // 1. Fast follow-up actions on an existing result set
      const conversational = !explicitSpecialty
        ? detectConversationalAction(userText, existingList, activeTravelMode)
        : null;

      if (conversational && existingList.length > 0) {
        if (conversational.kind === 'sync_select') {
          const targetSet = new Set(conversational.targetIds ?? []);
          const picked = existingList.filter((s) => targetSet.has(s.id));
          return res.json({
            action: 'sync_select',
            origin: providedOrigin ?? null,
            specialistQuery: activeSpecialty ?? null,
            travelMode: activeTravelMode,
            agentSummary: buildDeterministicAgentReply({
              action: 'sync_select',
              specialists: picked,
              origin: providedOrigin ?? null,
              travelMode: activeTravelMode,
            }),
            specialists: existingList,
            groundingSources: [],
            selectForSyncIds: picked.map((s) => s.id),
            focusSpecialistId: conversational.focusId ?? picked[0]?.id ?? null,
            suggestedFollowUps: buildContextualFollowUps({
              origin: providedOrigin ?? null,
              specialists: existingList,
              travelMode: activeTravelMode,
              actionJustTaken: 'sync_select',
              syncedCount: picked.length,
            }),
          } satisfies AgentSearchResponse);
        }

        if (conversational.kind === 'sort_change' && conversational.sortMode) {
          const reordered = rankSpecialists(existingList, conversational.sortMode);
          return res.json({
            action: 'sort_change',
            origin: providedOrigin ?? null,
            specialistQuery: activeSpecialty ?? null,
            travelMode: activeTravelMode,
            sortMode: conversational.sortMode,
            agentSummary: buildDeterministicAgentReply({
              action: 'sort_change',
              specialists: reordered,
              origin: providedOrigin ?? null,
              travelMode: activeTravelMode,
              sortMode: conversational.sortMode,
            }),
            specialists: reordered,
            groundingSources: [],
            focusSpecialistId: reordered[0]?.id ?? null,
            genUiBlock: {
              type: 'place_cards',
              specialistIds: reordered.slice(0, 4).map((s) => s.id),
              title:
                conversational.sortMode === 'fastest'
                  ? 'Fastest'
                  : conversational.sortMode === 'rating'
                    ? 'Top rated'
                    : 'Best match',
            },
            suggestedFollowUps: buildContextualFollowUps({
              origin: providedOrigin ?? null,
              specialists: reordered,
              travelMode: activeTravelMode,
              actionJustTaken: 'sort_change',
              syncedCount,
            }),
          } satisfies AgentSearchResponse);
        }

        if (conversational.kind === 'filter_open') {
          const openIds = conversational.targetIds ?? [];
          const openSpecialists = existingList.filter((s) => openIds.includes(s.id));
          let summary = buildDeterministicAgentReply({
            action: 'filter_open',
            specialists: openSpecialists,
            origin: providedOrigin ?? null,
            travelMode: activeTravelMode,
          });
          let groundingSources: GroundingSource[] = [];
          let geminiNotice: string | undefined;

          if (ai && openSpecialists.length > 0) {
            try {
              const g = await runGroundedPlacesSynthesis(
                ai,
                userText,
                openSpecialists,
                providedOrigin ?? null,
                activeTravelMode,
                safeHistory
              );
              if (g.summary) summary = g.summary;
              groundingSources = g.groundingSources;
            } catch (err) {
              console.warn('[Meridian] Follow-up synthesis unavailable:', classifyGeminiError(err));
              geminiNotice = formatGeminiUserNotice(err);
            }
          }

          if (groundingSources.length === 0 && openSpecialists.length > 0) {
            groundingSources = buildProviderMapLinks(openSpecialists, summary, 3);
          }

          return res.json({
            action: 'filter_open',
            origin: providedOrigin ?? null,
            specialistQuery: activeSpecialty ?? null,
            travelMode: activeTravelMode,
            agentSummary: summary,
            specialists: existingList,
            groundingSources,
            geminiNotice,
            focusSpecialistId: openSpecialists[0]?.id ?? existingList[0]?.id ?? null,
            genUiBlock:
              openSpecialists.length > 0
                ? {
                    type: 'place_cards',
                    specialistIds: openSpecialists.map((s) => s.id),
                    title: 'Open now',
                  }
                : undefined,
            suggestedFollowUps: buildContextualFollowUps({
              origin: providedOrigin ?? null,
              specialists: existingList,
              travelMode: activeTravelMode,
              actionJustTaken: 'filter_open',
              syncedCount,
            }),
          } satisfies AgentSearchResponse);
        }

        if (conversational.kind === 'compare') {
          const targetIds = conversational.targetIds ?? existingList.slice(0, 3).map((s) => s.id);
          const targets = targetIds
            .map((id) => existingList.find((s) => s.id === id))
            .filter((s): s is Specialist => Boolean(s));

          let summary = buildDeterministicAgentReply({
            action: 'compare',
            specialists: targets,
            origin: providedOrigin ?? null,
            travelMode: activeTravelMode,
          });
          let groundingSources: GroundingSource[] = [];
          let geminiNotice: string | undefined;

          if (ai && targets.length >= 2) {
            try {
              const g = await runGroundedPlacesSynthesis(
                ai,
                userText,
                targets,
                providedOrigin ?? null,
                activeTravelMode,
                safeHistory
              );
              if (g.summary) summary = g.summary;
              groundingSources = g.groundingSources;
            } catch (err) {
              console.warn('[Meridian] Compare synthesis unavailable:', classifyGeminiError(err));
              geminiNotice = formatGeminiUserNotice(err);
            }
          }

          if (groundingSources.length === 0 && targets.length > 0) {
            groundingSources = buildProviderMapLinks(targets, summary, 3);
          }

          return res.json({
            action: 'compare',
            origin: providedOrigin ?? null,
            specialistQuery: activeSpecialty ?? null,
            travelMode: activeTravelMode,
            agentSummary: summary,
            specialists: existingList,
            groundingSources,
            geminiNotice,
            focusSpecialistId: targets[0]?.id ?? null,
            genUiBlock: {
              type: 'comparison',
              specialistIds: targets.map((s) => s.id),
              title: `Top ${targets.length} comparison`,
            },
            suggestedFollowUps: buildContextualFollowUps({
              origin: providedOrigin ?? null,
              specialists: existingList,
              travelMode: activeTravelMode,
              actionJustTaken: 'compare',
              syncedCount,
            }),
          } satisfies AgentSearchResponse);
        }

        if (conversational.kind === 'provider_qa' || conversational.kind === 'general_qa') {
          const focused =
            existingList.find((s) => s.id === conversational.focusId) ?? existingList[0];
          let summary = buildDeterministicAgentReply({
            action: 'provider_qa',
            specialists: existingList,
            origin: providedOrigin ?? null,
            travelMode: activeTravelMode,
            focused,
          });
          let groundingSources: GroundingSource[] = [];
          let suggestedFollowUps = buildContextualFollowUps({
            origin: providedOrigin ?? null,
            specialists: existingList,
            travelMode: activeTravelMode,
            actionJustTaken: 'provider_qa',
            syncedCount,
          });
          let geminiNotice: string | undefined;

          if (ai) {
            try {
              const g = await runOpenEndedChatAnswer(
                ai,
                userText,
                conversational.kind === 'provider_qa' && focused ? [focused] : existingList,
                providedOrigin ?? null,
                activeTravelMode,
                safeHistory
              );
              if (g.summary) summary = g.summary;
              if (g.groundingSources.length > 0) groundingSources = g.groundingSources;
              if (g.suggestedFollowUps.length > 0) suggestedFollowUps = g.suggestedFollowUps;
            } catch (err) {
              console.warn('[Meridian] QA synthesis unavailable:', classifyGeminiError(err));
              geminiNotice = formatGeminiUserNotice(err);
            }
          }

          if (groundingSources.length === 0) {
            groundingSources = buildProviderMapLinks(
              conversational.kind === 'provider_qa' && focused ? [focused] : existingList,
              summary,
              3
            );
          }

          return res.json({
            action: 'qa',
            origin: providedOrigin ?? null,
            specialistQuery: activeSpecialty ?? null,
            travelMode: activeTravelMode,
            agentSummary: summary,
            specialists: existingList,
            groundingSources,
            geminiNotice,
            focusSpecialistId: focused?.id ?? null,
            genUiBlock:
              conversational.kind === 'provider_qa' && focused
                ? { type: 'provider_spotlight', specialistId: focused.id }
                : undefined,
            suggestedFollowUps: suggestedFollowUps.slice(0, 3),
          } satisfies AgentSearchResponse);
        }

        if (conversational.kind === 'mode_change' && conversational.travelMode) {
          activeTravelMode = conversational.travelMode;
        }
      }

      // 2. Standalone general questions before any search
      if (!explicitSpecialty && existingList.length === 0 && isStandaloneOpenEndedQuestion(userText)) {
        let summary = 'Share a city or ZIP to map nearby specialists with live travel times.';
        let suggestedFollowUps = buildContextualFollowUps({
          origin: providedOrigin ?? null,
          specialists: [],
          travelMode: activeTravelMode,
          actionJustTaken: 'qa',
          syncedCount: 0,
        });
        let groundingSources: GroundingSource[] = [];
        let geminiNotice: string | undefined;

        if (ai) {
          try {
            const g = await runOpenEndedChatAnswer(
              ai,
              userText,
              [],
              providedOrigin ?? null,
              activeTravelMode,
              safeHistory
            );
            if (g.summary) summary = g.summary;
            if (g.suggestedFollowUps.length > 0) suggestedFollowUps = g.suggestedFollowUps;
            groundingSources = g.groundingSources;
          } catch (err) {
            console.warn('[Meridian] Open-ended chat unavailable:', classifyGeminiError(err));
            geminiNotice = formatGeminiUserNotice(err);
          }
        }

        if (groundingSources.length === 0) {
          const mapsQuery = encodeURIComponent(
            providedOrigin ? `${userText} near ${providedOrigin.label}` : userText
          );
          groundingSources = [
            {
              title: 'Search on Google Maps',
              uri: `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`,
            },
          ];
        }

        return res.json({
          action: 'qa',
          origin: providedOrigin ?? null,
          specialistQuery: activeSpecialty ?? null,
          travelMode: activeTravelMode,
          agentSummary: summary,
          specialists: [],
          groundingSources,
          geminiNotice,
          suggestedFollowUps: suggestedFollowUps.slice(0, 3),
        } satisfies AgentSearchResponse);
      }

      // 3. Intent extraction (fast deterministic parser -> Gemini fallback)
      let intent: ParsedIntent;
      if (conversational?.kind === 'mode_change' && activeSpecialty) {
        intent = {
          action: 'search',
          specialistQuery: activeSpecialty,
          locationText: null,
          travelMode: activeTravelMode,
        };
      } else if (explicitSpecialty) {
        intent = {
          action: 'search',
          specialistQuery: explicitSpecialty,
          locationText: null,
          travelMode: activeTravelMode,
        };
      } else {
        const fastParsed = parseFastUserMessage(userText, Boolean(providedOrigin));
        if (fastParsed) {
          intent = fastParsed;
        } else if (ai) {
          try {
            intent = await classifyIntentWithHydrogen(ai, userText, Boolean(providedOrigin));
          } catch (err) {
            console.warn('[Meridian] Intent classification fallback:', classifyGeminiError(err));
            intent = {
              action: providedOrigin ? 'search' : 'set_location_only',
              specialistQuery: providedOrigin ? userText : null,
              locationText: providedOrigin ? null : userText,
            };
          }
        } else {
          intent = {
            action: providedOrigin ? 'search' : 'set_location_only',
            specialistQuery: providedOrigin ? userText : null,
            locationText: providedOrigin ? null : userText,
          };
        }
      }

      if (intent.travelMode) activeTravelMode = intent.travelMode;

      // 4. Geocode starting location if provided
      let resolvedOrigin: OriginLocation | null = providedOrigin ?? null;
      let needsClientGeocode: string | null = null;

      if (intent.locationText) {
        try {
          const geocoded = await geocodeAddressServer(intent.locationText, mapsKey, referer);
          if (geocoded) {
            resolvedOrigin = geocoded;
          } else {
            return res.status(404).json({
              error: `Could not find "${intent.locationText}". Add a city, state, or ZIP.`,
            });
          }
        } catch (err) {
          if (err instanceof QuotaExceededError) {
            return res.status(429).json({ quotaExceeded: true, error: err.message });
          }
          if (err instanceof ReferrerRestrictedError) {
            needsClientGeocode = intent.locationText;
          } else {
            throw err;
          }
        }
      }

      if (intent.action === 'set_location_only') {
        return res.json({
          action: 'set_location_only',
          origin: resolvedOrigin,
          specialistQuery: null,
          travelMode: activeTravelMode,
          agentSummary: resolvedOrigin
            ? `Centered on ${resolvedOrigin.label}. Pick a specialist below or type one.`
            : `Locating "${intent.locationText}"...`,
          specialists: [],
          groundingSources: [],
          needsClientGeocode,
          suggestedFollowUps: buildContextualFollowUps({
            origin: resolvedOrigin,
            specialists: [],
            travelMode: activeTravelMode,
            actionJustTaken: 'set_location_only',
            syncedCount: 0,
          }),
        } satisfies AgentSearchResponse);
      }

      if (!resolvedOrigin && !needsClientGeocode) {
        return res.json({
          action: 'needs_location',
          origin: null,
          specialistQuery: intent.specialistQuery,
          travelMode: activeTravelMode,
          agentSummary: `Where are you starting from?`,
          specialists: [],
          groundingSources: [],
          genUiBlock: {
            type: 'location_prompt',
            pendingSpecialty: intent.specialistQuery,
          },
          suggestedFollowUps: [
            {
              label: 'San Francisco, CA',
              prompt: `${intent.specialistQuery || 'Dentist'} near San Francisco, CA`,
            },
            {
              label: 'Brooklyn, NY',
              prompt: `${intent.specialistQuery || 'Dentist'} near Brooklyn, NY`,
            },
            {
              label: 'Austin, TX',
              prompt: `${intent.specialistQuery || 'Dentist'} near Austin, TX`,
            },
          ],
        } satisfies AgentSearchResponse);
      }

      const specialistQuery = intent.specialistQuery || userText;

      if (!resolvedOrigin && needsClientGeocode) {
        return res.json({
          action: 'search',
          origin: null,
          specialistQuery,
          travelMode: activeTravelMode,
          agentSummary: `Searching near ${needsClientGeocode}...`,
          specialists: [],
          groundingSources: [],
          needsClientGeocode,
          needsClientPlacesFallback: true,
        } satisfies AgentSearchResponse);
      }

      // 5. Parallel Places API (New) routing search + Gemini Maps Grounding
      const shouldTryGrounding = Boolean(ai) && isMapsGroundingReady();
      const [placesOutcome, groundingOutcome] = await Promise.allSettled([
        searchPlacesWithRoutingServer(
          specialistQuery,
          resolvedOrigin!,
          activeTravelMode,
          mapsKey,
          referer
        ),
        shouldTryGrounding
          ? runHydrogenMapsGrounding(
              ai!,
              specialistQuery,
              resolvedOrigin!,
              activeTravelMode,
              userText || `${specialistQuery} near ${resolvedOrigin!.label}`,
              safeHistory
            )
          : Promise.resolve<HydrogenMapsGroundingResult>({
              summary: '',
              groundingSources: [],
            }),
      ]);

      let specialists: Specialist[] = [];
      let needsClientPlacesFallback = false;

      if (placesOutcome.status === 'fulfilled') {
        specialists = placesOutcome.value;
      } else {
        if (placesOutcome.reason instanceof QuotaExceededError) {
          return res.status(429).json({
            quotaExceeded: true,
            error: placesOutcome.reason.message,
          });
        }
        needsClientPlacesFallback = true;
      }

      let resolvedSortMode: SortMode = 'balanced';
      if (/\b(?:fastest|closest|nearest|shortest|quickest)\b/i.test(userText)) {
        resolvedSortMode = 'fastest';
        specialists = rankSpecialists(specialists, 'fastest');
      } else if (/\b(?:highest\s+rated|top\s+rated|best\s+rated)\b/i.test(userText)) {
        resolvedSortMode = 'rating';
        specialists = rankSpecialists(specialists, 'rating');
      }

      let agentSummary = '';
      let groundingSources: GroundingSource[] = [];
      let geminiFailure: unknown = null;

      if (groundingOutcome.status === 'fulfilled') {
        agentSummary = groundingOutcome.value.summary;
        groundingSources = groundingOutcome.value.groundingSources;
      } else {
        geminiFailure = groundingOutcome.reason;
        if (classifyGeminiError(geminiFailure) === 'quota') {
          markMapsGroundingQuotaCooldown();
        }
      }

      if (!agentSummary && ai && specialists.length > 0) {
        try {
          const synth = await runGroundedPlacesSynthesis(
            ai,
            userText || `${specialistQuery} near ${resolvedOrigin!.label}`,
            specialists,
            resolvedOrigin,
            activeTravelMode,
            safeHistory
          );
          if (synth.summary) {
            agentSummary = synth.summary;
            geminiFailure = null;
          }
        } catch (synthErr) {
          geminiFailure = synthErr;
        }
      }

      const geminiNotice = geminiFailure ? formatGeminiUserNotice(geminiFailure) : undefined;

      if (!agentSummary) {
        agentSummary = buildDeterministicAgentReply({
          action: 'search',
          specialists,
          origin: resolvedOrigin,
          travelMode: activeTravelMode,
          specialistQuery,
        });
      }

      const askedOpenOnly = /\b(?:open\s+now|open\s+right\s+now|open\s+today)\b/i.test(userText);
      const openFiltered = askedOpenOnly
        ? specialists.filter((s) => s.openNow === true)
        : [];
      const genUiIds =
        openFiltered.length > 0
          ? openFiltered.map((s) => s.id)
          : specialists.map((s) => s.id);

      const formattedQueryTitle = /^top[\s-]/i.test(specialistQuery)
        ? `${specialistQuery.charAt(0).toUpperCase()}${specialistQuery.slice(1)}`
        : `Top ${specialistQuery}`;

      const genUiBlock: GenUiBlock | undefined =
        genUiIds.length > 0
          ? {
              type: 'place_cards',
              specialistIds: genUiIds,
              title: openFiltered.length > 0 ? `Open ${specialistQuery}` : formattedQueryTitle,
            }
          : undefined;

      if (groundingSources.length === 0 && specialists.length > 0) {
        groundingSources = buildProviderMapLinks(specialists, agentSummary, 3);
      }

      return res.json({
        action: 'search',
        origin: resolvedOrigin,
        specialistQuery,
        travelMode: activeTravelMode,
        sortMode: resolvedSortMode,
        agentSummary,
        specialists,
        groundingSources,
        a2uiMessages:
          specialists.length > 0
            ? buildA2uiSpecialistsBatchMessages(`specialists_${Date.now()}`, specialists, 'horizontal')
            : [],
        genUiBlock,
        focusSpecialistId: genUiIds[0] ?? specialists[0]?.id ?? null,
        suggestedFollowUps: buildContextualFollowUps({
          origin: resolvedOrigin,
          specialists,
          travelMode: activeTravelMode,
          actionJustTaken: 'search',
          syncedCount,
        }),
        needsClientPlacesFallback,
        geminiNotice,
        error:
          specialists.length === 0 && !needsClientPlacesFallback && geminiNotice
            ? geminiNotice
            : undefined,
      } satisfies AgentSearchResponse);
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        return res.status(429).json({ quotaExceeded: true, error: err.message });
      }
      console.error('Agent error:', err);
      return res.status(500).json({
        error: err instanceof Error ? err.message : 'Unexpected server error.',
      });
    }
  });

  // Mount Vite in dev or static dist in production (AI Studio convention)
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Meridian server running on http://0.0.0.0:${port}`);
  });
}

startServer();
