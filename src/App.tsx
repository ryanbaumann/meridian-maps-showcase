import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import { AgentSidebar, type MobileSheetSnap } from './components/AgentSidebar.tsx';
import {
  ClientPlacesBridge,
  type PendingClientFallback,
} from './components/ClientPlacesBridge.tsx';
import { SpecialistMap } from './components/SpecialistMap.tsx';
import { useTheme } from './hooks/useTheme.ts';
import type {
  AgentSearchResponse,
  AgentTurn,
  Camera3DView,
  ChatHistoryItem,
  MapViewMode,
  OriginLocation,
  PlaceDetailsInsightsResponse,
  SortMode,
  Specialist,
  TravelMode,
} from './types.ts';
import { buildContextualFollowUps } from './utils/agentLogic.ts';
import { rankSpecialists } from './utils/ranking.ts';

function isUsableMapsApiKey(value: string | undefined | null): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (/^(?:MY_|YOUR_|PLACEHOLDER|REPLACE_|ENTER_)/i.test(trimmed)) return false;
  return true;
}

const RAW_INITIAL_MAPS_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();
const INITIAL_MAPS_KEY = isUsableMapsApiKey(RAW_INITIAL_MAPS_KEY) ? RAW_INITIAL_MAPS_KEY : '';

function makeTurnId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function estimateMobileSheetPixels(snap: MobileSheetSnap, hasSelection: boolean): number {
  const vh = typeof window !== 'undefined' ? window.innerHeight : 760;
  if (snap === 'peek') return hasSelection ? 148 : 96;
  if (snap === 'full') return Math.round(vh * 0.86);
  return Math.round(vh * 0.5);
}

export default function App() {
  const { resolvedTheme, toggleTheme } = useTheme();

  const [mapsApiKey, setMapsApiKey] = useState<string>(INITIAL_MAPS_KEY);
  const [configLoaded, setConfigLoaded] = useState<boolean>(Boolean(INITIAL_MAPS_KEY));
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileSnap, setMobileSnap] = useState<MobileSheetSnap>('half');
  const [origin, setOrigin] = useState<OriginLocation | null>(null);
  const [activeSpecialty, setActiveSpecialty] = useState<string | null>(null);
  const [travelMode, setTravelMode] = useState<TravelMode>('DRIVE');
  const [sortMode, setSortMode] = useState<SortMode>('balanced');
  const [mapViewMode, setMapViewMode] = useState<MapViewMode>('vector');
  const [camera3DView, setCamera3DView] = useState<Camera3DView>('corridor');

  const [turns, setTurns] = useState<AgentTurn[]>([]);
  const [rawSpecialists, setRawSpecialists] = useState<Specialist[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [syncedIds, setSyncedIds] = useState<string[]>([]);

  const [isLoading, setIsLoading] = useState(false);
  const [isLocatingGps, setIsLocatingGps] = useState(false);
  const [loadingDetailsId, setLoadingDetailsId] = useState<string | null>(null);
  const [pendingClientFallback, setPendingClientFallback] =
    useState<PendingClientFallback | null>(null);

  const activeRequestAbortRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef(0);
  const detailsFetchedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const onQuota = () => setQuotaExceeded(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => window.removeEventListener('gmp-quota-exceeded', onQuota);
  }, []);

  useEffect(() => {
    if ((mapViewMode !== '3d' || !selectedId) && camera3DView === 'orbit') {
      setCamera3DView('corridor');
    }
  }, [mapViewMode, selectedId, camera3DView]);

  useEffect(() => {
    if (INITIAL_MAPS_KEY) return;
    let active = true;
    fetch('/api/config')
      .then((r) => r.json())
      .then((data: { mapsApiKey?: string }) => {
        if (active && isUsableMapsApiKey(data.mapsApiKey)) {
          setMapsApiKey(data.mapsApiKey.trim());
        }
      })
      .catch(() => {
        // Handled cleanly in map stage
      })
      .finally(() => {
        if (active) setConfigLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const rankedSpecialists = useMemo(
    () => rankSpecialists(rawSpecialists, sortMode),
    [rawSpecialists, sortMode]
  );

  const mobileBottomInsetPx = useMemo(
    () => estimateMobileSheetPixels(mobileSnap, Boolean(selectedId)),
    [mobileSnap, selectedId]
  );

  const runAgentRequest = useCallback(
    async (opts: {
      message: string;
      displayUserText?: string;
      explicitSpecialty?: string;
      overrideOrigin?: OriginLocation | null;
      overrideTravelMode?: TravelMode;
    }) => {
      activeRequestAbortRef.current?.abort();
      const controller = new AbortController();
      activeRequestAbortRef.current = controller;
      const mySeq = ++requestSeqRef.current;

      const targetOrigin = opts.overrideOrigin !== undefined ? opts.overrideOrigin : origin;
      const targetMode = opts.overrideTravelMode ?? travelMode;
      const userBubbleText = (opts.displayUserText ?? opts.message).trim();

      if (userBubbleText) {
        setTurns((prev) => [
          ...prev,
          { id: makeTurnId('u'), role: 'user', text: userBubbleText },
        ]);
      }

      setIsLoading(true);
      setPendingClientFallback(null);

      const historyPayload: ChatHistoryItem[] = turns
        .slice(-6)
        .map((t) => ({ role: t.role, text: t.text }));

      try {
        const res = await fetch('/api/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({
            message: opts.message,
            explicitSpecialty: opts.explicitSpecialty ?? null,
            activeSpecialty,
            origin: targetOrigin,
            travelMode: targetMode,
            currentSpecialists: rankedSpecialists,
            syncedIds,
            history: historyPayload,
          }),
        });

        if (mySeq !== requestSeqRef.current) return;

        const data = (await res.json()) as AgentSearchResponse & {
          quotaExceeded?: boolean;
        };

        if (mySeq !== requestSeqRef.current) return;

        if (res.status === 429 || data.quotaExceeded) {
          setQuotaExceeded(true);
          setTurns((prev) => [
            ...prev,
            {
              id: makeTurnId('a'),
              role: 'assistant',
              text: '',
              error: 'Google Maps Platform quota reached.',
            },
          ]);
          setIsLoading(false);
          return;
        }

        if (!res.ok) {
          setTurns((prev) => [
            ...prev,
            {
              id: makeTurnId('a'),
              role: 'assistant',
              text: '',
              error: data.error || 'Could not complete your request.',
            },
          ]);
          setIsLoading(false);
          return;
        }

        if (data.origin) setOrigin(data.origin);
        if (data.travelMode) setTravelMode(data.travelMode);
        if (data.sortMode) setSortMode(data.sortMode);
        if (data.specialistQuery) setActiveSpecialty(data.specialistQuery);

        if (data.needsClientGeocode || data.needsClientPlacesFallback) {
          setPendingClientFallback({
            specialistQuery: data.specialistQuery || '',
            origin: data.origin,
            geocodeQuery: data.needsClientGeocode || null,
            travelMode: data.travelMode || targetMode,
          });
          return;
        }

        // Changing cities without a search clears stale specialists from the prior city
        if (data.action === 'set_location_only') {
          setRawSpecialists([]);
          setSelectedId(null);
          setSyncedIds([]);
          setCamera3DView('corridor');
        }

        const nextSpecialists = data.specialists || [];
        if (nextSpecialists.length > 0 || data.action === 'search') {
          setRawSpecialists(nextSpecialists);
          const nextIdSet = new Set(nextSpecialists.map((s) => s.id));
          setSyncedIds((prev) => prev.filter((id) => nextIdSet.has(id)));
        }

        if (data.selectForSyncIds && data.selectForSyncIds.length > 0) {
          setSyncedIds((prev) => {
            const merged = new Set(prev);
            data.selectForSyncIds!.forEach((id) => merged.add(id));
            return Array.from(merged);
          });
        }

        if (data.focusSpecialistId) {
          setSelectedId(data.focusSpecialistId);
        } else if (data.action === 'search') {
          setSelectedId(nextSpecialists[0]?.id ?? null);
        }

        setTurns((prev) => [
          ...prev,
          {
            id: makeTurnId('a'),
            role: 'assistant',
            text: data.agentSummary || 'Mapped nearby options.',
            groundingSources: data.groundingSources,
            genUiBlock: data.genUiBlock,
            suggestedFollowUps: data.suggestedFollowUps,
            specialistsSnapshot: nextSpecialists.length > 0 ? nextSpecialists : undefined,
            travelMode: data.travelMode || targetMode,
            geminiNotice: data.geminiNotice,
            error: data.error,
          },
        ]);
        setIsLoading(false);
      } catch (err) {
        if (controller.signal.aborted || mySeq !== requestSeqRef.current) return;
        setTurns((prev) => [
          ...prev,
          {
            id: makeTurnId('a'),
            role: 'assistant',
            text: '',
            error: err instanceof Error ? err.message : 'Network error.',
          },
        ]);
        setIsLoading(false);
      }
    },
    [origin, travelMode, activeSpecialty, rankedSpecialists, syncedIds, turns]
  );

  const handleClientFallbackResolved = useCallback(
    (result: { origin?: OriginLocation; specialists?: Specialist[]; error?: string }) => {
      setPendingClientFallback(null);
      if (result.origin) setOrigin(result.origin);

      if (result.error) {
        setTurns((prev) => [
          ...prev,
          { id: makeTurnId('a'), role: 'assistant', text: '', error: result.error },
        ]);
      } else if (result.specialists) {
        setRawSpecialists(result.specialists);
        setSelectedId(result.specialists[0]?.id ?? null);
        const nextIdSet = new Set(result.specialists.map((s) => s.id));
        setSyncedIds((prev) => prev.filter((id) => nextIdSet.has(id)));
        const top = result.specialists[0];
        setTurns((prev) => [
          ...prev,
          {
            id: makeTurnId('a'),
            role: 'assistant',
            text: top
              ? `Found ${result.specialists!.length} options near ${result.origin?.label || 'you'}. ${top.name} ranks #1.`
              : 'No nearby matches found.',
            genUiBlock:
              result.specialists!.length > 0
                ? {
                    type: 'place_cards',
                    specialistIds: result.specialists!.map((s) => s.id),
                    title: 'Top matches',
                  }
                : undefined,
            suggestedFollowUps: buildContextualFollowUps({
              origin: result.origin ?? origin,
              specialists: result.specialists!,
              travelMode,
              actionJustTaken: 'search',
              syncedCount: 0,
            }),
            specialistsSnapshot: result.specialists,
            travelMode,
          },
        ]);
      } else if (result.origin) {
        setRawSpecialists([]);
        setSelectedId(null);
        setSyncedIds([]);
        setTurns((prev) => [
          ...prev,
          {
            id: makeTurnId('a'),
            role: 'assistant',
            text: `Centered on ${result.origin!.label}. Pick a specialist below or type one.`,
            suggestedFollowUps: buildContextualFollowUps({
              origin: result.origin!,
              specialists: [],
              travelMode,
              actionJustTaken: 'set_location_only',
              syncedCount: 0,
            }),
          },
        ]);
      }
      setIsLoading(false);
    },
    [origin, travelMode]
  );

  const handleSetLocationText = useCallback(
    async (locationText: string) => {
      activeRequestAbortRef.current?.abort();
      const controller = new AbortController();
      activeRequestAbortRef.current = controller;
      const mySeq = ++requestSeqRef.current;

      setIsLoading(true);
      try {
        const res = await fetch('/api/geocode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal,
          body: JSON.stringify({ address: locationText }),
        });
        if (mySeq !== requestSeqRef.current) return;

        const data = (await res.json()) as {
          origin?: OriginLocation | null;
          needsClientGeocode?: string | null;
          quotaExceeded?: boolean;
          error?: string;
        };
        if (mySeq !== requestSeqRef.current) return;

        if (res.status === 429 || data.quotaExceeded) {
          setQuotaExceeded(true);
          setIsLoading(false);
          return;
        }

        if (!res.ok) {
          setTurns((prev) => [
            ...prev,
            {
              id: makeTurnId('a'),
              role: 'assistant',
              text: '',
              error: data.error || 'Could not locate that address.',
            },
          ]);
          setIsLoading(false);
          return;
        }

        if (data.needsClientGeocode) {
          setPendingClientFallback({
            specialistQuery: activeSpecialty || '',
            origin: null,
            geocodeQuery: data.needsClientGeocode,
            travelMode,
          });
          return;
        }

        if (data.origin) {
          setOrigin(data.origin);
          if (activeSpecialty) {
            await runAgentRequest({
              message: `${activeSpecialty} near ${data.origin.label}`,
              displayUserText: `Start from ${data.origin.label}`,
              explicitSpecialty: activeSpecialty,
              overrideOrigin: data.origin,
            });
          } else {
            setRawSpecialists([]);
            setSelectedId(null);
            setSyncedIds([]);
            setTurns((prev) => [
              ...prev,
              { id: makeTurnId('u'), role: 'user', text: data.origin!.label },
              {
                id: makeTurnId('a'),
                role: 'assistant',
                text: `Centered on ${data.origin!.label}. Pick a specialist below.`,
                suggestedFollowUps: buildContextualFollowUps({
                  origin: data.origin!,
                  specialists: [],
                  travelMode,
                  actionJustTaken: 'set_location_only',
                  syncedCount: 0,
                }),
              },
            ]);
            setIsLoading(false);
          }
        } else {
          setIsLoading(false);
        }
      } catch (err) {
        if (controller.signal.aborted || mySeq !== requestSeqRef.current) return;
        setTurns((prev) => [
          ...prev,
          {
            id: makeTurnId('a'),
            role: 'assistant',
            text: '',
            error: err instanceof Error ? err.message : 'Unable to geocode location.',
          },
        ]);
        setIsLoading(false);
      }
    },
    [activeSpecialty, travelMode, runAgentRequest]
  );

  const handleUseGps = useCallback(() => {
    if (!navigator.geolocation) {
      setTurns((prev) => [
        ...prev,
        {
          id: makeTurnId('a'),
          role: 'assistant',
          text: '',
          error: 'Geolocation unavailable. Type a city or ZIP instead.',
        },
      ]);
      return;
    }

    activeRequestAbortRef.current?.abort();
    const mySeq = ++requestSeqRef.current;
    setIsLoading(false);
    setPendingClientFallback(null);
    setIsLocatingGps(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (mySeq !== requestSeqRef.current) {
          setIsLocatingGps(false);
          return;
        }
        const { latitude: lat, longitude: lng } = pos.coords;
        const coordFallback: OriginLocation = {
          label: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
          formattedAddress: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
          lat,
          lng,
        };
        try {
          const controller = new AbortController();
          activeRequestAbortRef.current = controller;
          const res = await fetch('/api/geocode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({ lat, lng }),
          });
          if (mySeq !== requestSeqRef.current) {
            setIsLocatingGps(false);
            return;
          }
          const data = (await res.json()) as {
            origin?: OriginLocation;
            quotaExceeded?: boolean;
          };
          if (mySeq !== requestSeqRef.current) {
            setIsLocatingGps(false);
            return;
          }
          if (res.status === 429 || data.quotaExceeded) setQuotaExceeded(true);

          const resolved = data.origin || coordFallback;
          setOrigin(resolved);
          setIsLocatingGps(false);

          if (activeSpecialty) {
            runAgentRequest({
              message: `${activeSpecialty} near ${resolved.label}`,
              displayUserText: `Near ${resolved.label}`,
              explicitSpecialty: activeSpecialty,
              overrideOrigin: resolved,
            });
          } else {
            setRawSpecialists([]);
            setSelectedId(null);
            setSyncedIds([]);
            setTurns((prev) => [
              ...prev,
              { id: makeTurnId('u'), role: 'user', text: resolved.label },
              {
                id: makeTurnId('a'),
                role: 'assistant',
                text: `Centered on ${resolved.label}. Pick a specialist below.`,
                suggestedFollowUps: buildContextualFollowUps({
                  origin: resolved,
                  specialists: [],
                  travelMode,
                  actionJustTaken: 'set_location_only',
                  syncedCount: 0,
                }),
              },
            ]);
          }
        } catch {
          if (mySeq !== requestSeqRef.current) {
            setIsLocatingGps(false);
            return;
          }
          setOrigin(coordFallback);
          setIsLocatingGps(false);
        }
      },
      () => {
        setIsLocatingGps(false);
        if (mySeq !== requestSeqRef.current) return;
        setTurns((prev) => [
          ...prev,
          {
            id: makeTurnId('a'),
            role: 'assistant',
            text: '',
            error: 'Location access declined. Type a city or ZIP instead.',
          },
        ]);
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }, [activeSpecialty, travelMode, runAgentRequest]);

  const handleChangeTravelMode = useCallback(
    (nextMode: TravelMode) => {
      if (nextMode === travelMode) return;
      setTravelMode(nextMode);
      if (origin && activeSpecialty) {
        const modeLabel =
          nextMode === 'WALK' ? 'walking' : nextMode === 'BICYCLE' ? 'biking' : 'driving';
        runAgentRequest({
          message: `${activeSpecialty} near ${origin.label}`,
          displayUserText: `Switch to ${modeLabel}`,
          explicitSpecialty: activeSpecialty,
          overrideOrigin: origin,
          overrideTravelMode: nextMode,
        });
      }
    },
    [travelMode, origin, activeSpecialty, runAgentRequest]
  );

  // Bail out if values are already identical so active camera flights never restart
  const handleRouteMetricsUpdate = useCallback(
    (id: string, durationSeconds: number, distanceMeters: number) => {
      setRawSpecialists((prev) => {
        const target = prev.find((item) => item.id === id);
        if (
          !target ||
          (target.travelDurationSeconds === durationSeconds &&
            target.distanceMeters === distanceMeters &&
            target.isRouteVerified)
        ) {
          return prev;
        }
        return prev.map((item) =>
          item.id === id
            ? {
                ...item,
                travelDurationSeconds: durationSeconds,
                distanceMeters,
                isRouteVerified: true,
              }
            : item
        );
      });
    },
    []
  );

  const handleSelectSpecialistFromMap = useCallback((id: string | null) => {
    setSelectedId(id);
    if (id) {
      setCamera3DView((prev) => (prev === 'free' || prev === 'orbit' ? 'corridor' : prev));
    }
    if (id && window.innerWidth < 1024) {
      setMobileSnap('peek');
    }
  }, []);

  const handleSelectSpecialistFromSidebar = useCallback((id: string) => {
    setSelectedId(id);
    setCamera3DView((prev) => (prev === 'free' || prev === 'orbit' ? 'corridor' : prev));
  }, []);

  const handleRequestPlaceDetails = useCallback(async (placeId: string) => {
    if (!placeId || detailsFetchedRef.current.has(placeId)) return;
    detailsFetchedRef.current.add(placeId);
    setLoadingDetailsId(placeId);
    try {
      const res = await fetch(`/api/place-details?placeId=${encodeURIComponent(placeId)}`);
      if (res.status === 429) {
        setQuotaExceeded(true);
        return;
      }
      let details: PlaceDetailsInsightsResponse | null = null;
      if (res.ok) {
        const parsed = (await res.json()) as PlaceDetailsInsightsResponse;
        if (parsed.quotaExceeded) {
          setQuotaExceeded(true);
          return;
        }
        if (!parsed.error) details = parsed;
      }

      let reviews = details?.reviews ?? [];
      let editorialSummary = details?.editorialSummary;
      let weekdayDescriptions = details?.weekdayDescriptions;

      // If REST Place Details did not return reviews (e.g. key restriction), try Maps JS Place.fetchFields
      if (
        reviews.length === 0 &&
        typeof window !== 'undefined' &&
        window.google?.maps?.importLibrary
      ) {
        try {
          const placesLib = (await window.google.maps.importLibrary(
            'places'
          )) as google.maps.PlacesLibrary;
          if (placesLib?.Place) {
            const place = new placesLib.Place({ id: placeId });
            await place.fetchFields({
              fields: ['reviews', 'editorialSummary', 'regularOpeningHours'],
            });
            const rawReviews = (place as unknown as {
              reviews?: Array<{
                authorAttribution?: { displayName?: string; uri?: string };
                rating?: number;
                text?: string;
                relativePublishTimeDescription?: string;
                googleMapsURI?: string;
              }>;
              editorialSummary?: string;
              regularOpeningHours?: { weekdayDescriptions?: string[] };
            });
            if (Array.isArray(rawReviews.reviews) && rawReviews.reviews.length > 0) {
              reviews = rawReviews.reviews
                .filter((r) => Boolean(r.text?.trim()))
                .slice(0, 5)
                .map((r) => ({
                  authorName: r.authorAttribution?.displayName?.trim() || 'Reviewer',
                  authorUri: r.authorAttribution?.uri,
                  rating: typeof r.rating === 'number' ? r.rating : 5,
                  text: r.text!.trim(),
                  relativePublishTime: r.relativePublishTimeDescription,
                  googleMapsUri: r.googleMapsURI,
                }));
            }
            if (!editorialSummary && typeof rawReviews.editorialSummary === 'string') {
              editorialSummary = rawReviews.editorialSummary;
            }
            if (
              (!weekdayDescriptions || weekdayDescriptions.length === 0) &&
              rawReviews.regularOpeningHours?.weekdayDescriptions?.length
            ) {
              weekdayDescriptions = rawReviews.regularOpeningHours.weekdayDescriptions;
            }
          }
        } catch {
          // Best-effort client hydration; Places REST fields remain intact
        }
      }

      setRawSpecialists((prev) =>
        prev.map((item) =>
          item.id === placeId
            ? {
                ...item,
                rating: details?.rating ?? item.rating,
                userRatingCount: details?.userRatingCount || item.userRatingCount,
                reviews: reviews.length > 0 ? reviews : item.reviews,
                topReviews:
                  details?.topReviews && details.topReviews.length > 0
                    ? details.topReviews
                    : reviews.length > 0
                      ? reviews.slice(0, 2)
                      : item.topReviews,
                ratingDistribution: details?.ratingDistribution ?? item.ratingDistribution,
                editorialSummary: editorialSummary ?? item.editorialSummary,
                weekdayDescriptions: weekdayDescriptions ?? item.weekdayDescriptions,
                openNow: details?.openNow !== undefined ? details.openNow : item.openNow,
                phoneNumber: details?.phoneNumber ?? item.phoneNumber,
                websiteUri: details?.websiteUri ?? item.websiteUri,
                googleMapsUri: details?.googleMapsUri ?? item.googleMapsUri,
                detailsLoaded: true,
              }
            : item
        )
      );
    } catch {
      detailsFetchedRef.current.delete(placeId);
    } finally {
      setLoadingDetailsId((curr) => (curr === placeId ? null : curr));
    }
  }, []);

  const handleChangeMapViewMode = useCallback((mode: MapViewMode) => {
    setMapViewMode(mode);
    if (mode === '3d') {
      setCamera3DView((prev) => (prev === 'free' ? 'corridor' : prev));
      if (window.innerWidth < 1024) {
        setMobileSnap('peek');
      }
    }
  }, []);

  const handleToggleSyncId = useCallback((id: string) => {
    setSyncedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }, []);

  const handleSelectTopThree = useCallback(() => {
    setSyncedIds(rankedSpecialists.slice(0, 3).map((s) => s.id));
  }, [rankedSpecialists]);

  const handleReset = useCallback(() => {
    activeRequestAbortRef.current?.abort();
    requestSeqRef.current += 1;
    setOrigin(null);
    setActiveSpecialty(null);
    setTurns([]);
    setRawSpecialists([]);
    setSelectedId(null);
    setHoveredId(null);
    setSyncedIds([]);
    setCamera3DView('corridor');
    setPendingClientFallback(null);
    setIsLoading(false);
    setIsLocatingGps(false);
    setLoadingDetailsId(null);
    detailsFetchedRef.current.clear();
    setMobileSnap('half');
  }, []);

  return (
    <div className="relative flex flex-col w-full h-[100dvh] overflow-clip bg-[var(--bg)] text-[var(--ink)]">
      <a
        href="#main-content"
        className="visually-hidden fixed top-2 left-2 z-50 px-3 py-2 rounded-lg text-xs font-semibold bg-[var(--accent)] text-[var(--accent-ink)] shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ink)]"
      >
        Skip to map and search
      </a>

      {/* Required Google Maps Platform Demo Key Quota Banner */}
      {quotaExceeded && (
        <div
          role="alert"
          className="px-4 py-2 text-xs text-center z-50 shrink-0 border-b"
          style={{
            backgroundColor: 'var(--status-warn-bg)',
            borderColor: 'var(--status-warn-border)',
            color: 'var(--status-warn)',
          }}
        >
          Google Maps Platform quota reached. If you are the app owner, visit{' '}
          <a
            href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
            target="_blank"
            rel="noopener noreferrer"
            className="underline font-semibold"
          >
            maps developer site
          </a>{' '}
          for instructions to update your account.
        </div>
      )}

      {/* Full-Bleed Map Canvas + Floating Rail (Desktop) / Snap Bottom Sheet (Mobile) */}
      <main
        id="main-content"
        tabIndex={-1}
        className="relative flex-1 min-h-0 overflow-clip focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]"
      >
        {configLoaded && mapsApiKey ? (
          <APIProvider
            apiKey={mapsApiKey}
            version="beta"
            libraries={['marker', 'routes', 'places', 'maps3d']}
            language="en"
            region="US"
          >
            <ClientPlacesBridge
              pendingFallback={pendingClientFallback}
              onResolved={handleClientFallbackResolved}
            />

            <div className="absolute inset-0">
              <SpecialistMap
                origin={origin}
                specialists={rankedSpecialists}
                selectedId={selectedId}
                hoveredId={hoveredId}
                syncedIds={syncedIds}
                travelMode={travelMode}
                mapViewMode={mapViewMode}
                camera3DView={camera3DView}
                sidebarOpen={sidebarOpen}
                mobileBottomInsetPx={mobileBottomInsetPx}
                resolvedTheme={resolvedTheme}
                onToggleTheme={toggleTheme}
                onChangeCamera3DView={setCamera3DView}
                onSelectSpecialist={handleSelectSpecialistFromMap}
                onChangeTravelMode={handleChangeTravelMode}
                onChangeMapViewMode={handleChangeMapViewMode}
                onRouteMetricsUpdate={handleRouteMetricsUpdate}
              />
            </div>

            <AgentSidebar
              open={sidebarOpen}
              mobileSnap={mobileSnap}
              origin={origin}
              travelMode={travelMode}
              sortMode={sortMode}
              resolvedTheme={resolvedTheme}
              turns={turns}
              specialists={rankedSpecialists}
              selectedId={selectedId}
              syncedIds={syncedIds}
              loadingDetailsId={loadingDetailsId}
              isLoading={isLoading}
              isLocatingGps={isLocatingGps}
              onToggleOpen={() => setSidebarOpen((v) => !v)}
              onChangeMobileSnap={setMobileSnap}
              onSubmitMessage={(msg) => runAgentRequest({ message: msg })}
              onUseGps={handleUseGps}
              onSetLocationText={handleSetLocationText}
              onChangeSortMode={setSortMode}
              onSelectSpecialist={handleSelectSpecialistFromSidebar}
              onHoverSpecialist={setHoveredId}
              onToggleSyncId={handleToggleSyncId}
              onSelectTopThree={handleSelectTopThree}
              onClearSynced={() => setSyncedIds([])}
              onRequestPlaceDetails={handleRequestPlaceDetails}
              onReset={handleReset}
            />
          </APIProvider>
        ) : (
          <div className="flex items-center justify-center w-full h-full bg-[var(--bg)] p-6 text-center">
            <span className="text-sm font-medium text-[var(--muted)]">
              {configLoaded
                ? 'Set GOOGLE_MAPS_API_KEY in .env.local to load the map.'
                : 'Loading...'}
            </span>
          </div>
        )}
      </main>
    </div>
  );
}
