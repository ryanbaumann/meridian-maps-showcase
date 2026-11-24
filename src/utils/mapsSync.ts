import type {
  A2uiSurfaceMessage,
  OriginLocation,
  Specialist,
  TravelMode,
} from '../types.ts';
import { safeExternalUrl } from './url.ts';

export const MAPS_A2UI_CATALOG_ID = 'a2ui://maps-agentic-ui-catalog.json';

/** Official Google Maps URLs maximum safe length (2,048 characters). */
export const MAX_GOOGLE_MAPS_URL_LENGTH = 2048;

const MAPS_URL_UTM_SOURCE = 'meridian_specialist_finder';

/**
 * Checks whether an ID is a genuine Google Place ID rather than a synthetic fallback key.
 */
export function isValidGooglePlaceId(id: string | undefined | null): id is string {
  if (!id || typeof id !== 'string') return false;
  const trimmed = id.trim();
  if (trimmed.length < 10) return false;
  if (trimmed.startsWith('place-') || trimmed.startsWith('sdk-place-')) return false;
  return /^[A-Za-z0-9_-]+$/.test(trimmed);
}

/**
 * Maps internal travel mode to the Google Maps Universal URL `travelmode` parameter.
 */
export function toGoogleMapsUrlTravelMode(
  mode: TravelMode
): 'driving' | 'walking' | 'bicycling' {
  if (mode === 'WALK') return 'walking';
  if (mode === 'BICYCLE') return 'bicycling';
  return 'driving';
}

function formatPlaceQueryLabel(specialist: Specialist, compact = false): string {
  if (compact) {
    return specialist.name.trim() || `${specialist.location.lat.toFixed(5)},${specialist.location.lng.toFixed(5)}`;
  }
  return specialist.address
    ? `${specialist.name}, ${specialist.address}`
    : `${specialist.name} (${specialist.location.lat.toFixed(5)},${specialist.location.lng.toFixed(5)})`;
}

/**
 * Builds an official cross-platform Google Maps Search URL for a general query string.
 */
export function buildGoogleMapsSearchUrl(
  query: string,
  campaign: string = 'general_search'
): string {
  const params = new URLSearchParams({
    api: '1',
    query: query.trim() || 'Google Maps',
    utm_source: MAPS_URL_UTM_SOURCE,
    utm_campaign: campaign,
  });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

/**
 * Builds a Google Maps Search URL that opens a browsable list of places in the active area
 * (rather than a multi-stop driving route), ideal when the user wants to browse a shortlist
 * category on Google Maps.
 */
export function buildGoogleMapsListSearchUrl(
  specialtyQuery: string | null | undefined,
  origin: OriginLocation | null,
  selectedSpecialists: Specialist[]
): string | null {
  if (!selectedSpecialists || selectedSpecialists.length === 0) return null;
  if (selectedSpecialists.length === 1) {
    return buildPlaceDetailsUrl(selectedSpecialists[0]) ?? null;
  }

  const category =
    specialtyQuery?.trim() ||
    selectedSpecialists[0]?.specialty?.trim() ||
    selectedSpecialists[0]?.name?.trim() ||
    'specialists';
  const area = origin?.label?.trim();
  const query = area ? `${category} near ${area}` : category;
  return buildGoogleMapsSearchUrl(query, 'shortlist_search');
}

/**
 * Formats shortlisted specialists into a clean shareable plain-text shortlist
 * with ratings, travel times, and direct Google Maps Place links.
 */
export function buildShortlistShareText(
  origin: OriginLocation | null,
  selectedSpecialists: Specialist[],
  travelMode: TravelMode
): string {
  if (!selectedSpecialists || selectedSpecialists.length === 0) return '';
  const modeLabel =
    travelMode === 'WALK' ? 'walk' : travelMode === 'BICYCLE' ? 'bike' : 'drive';
  const header = origin
    ? `Shortlist near ${origin.label}:`
    : 'Specialist Shortlist:';
  const lines = selectedSpecialists.map((s, idx) => {
    const mins =
      s.travelDurationSeconds != null
        ? `${Math.max(1, Math.round(s.travelDurationSeconds / 60))} min ${modeLabel}`
        : null;
    const rating = s.rating != null ? `${s.rating.toFixed(1)}★` : null;
    const meta = [rating, mins].filter(Boolean).join(' · ');
    const placeUrl = buildPlaceDetailsUrl(s) || '';
    const detailLine = [meta, s.address].filter(Boolean).join(' — ');
    return `${idx + 1}. ${s.name}${detailLine ? ` (${detailLine})` : ''}${placeUrl ? `\n   ${placeUrl}` : ''}`;
  });
  return [header, ...lines].join('\n');
}

/**
 * Builds a universal Google Maps URL to open a specific place's details page.
 * Prefers the Places API `googleMapsUri` when available, otherwise constructs a properly
 * encoded `https://www.google.com/maps/search/?api=1` URL paired with `query_place_id`.
 */
export function buildPlaceDetailsUrl(specialist: Specialist | null | undefined): string | undefined {
  if (!specialist) return undefined;
  const directUri = safeExternalUrl(specialist.googleMapsUri);
  if (directUri) return directUri;

  const params = new URLSearchParams({
    api: '1',
    query: formatPlaceQueryLabel(specialist),
  });
  if (isValidGooglePlaceId(specialist.id)) {
    params.set('query_place_id', specialist.id);
  }
  params.set('utm_source', MAPS_URL_UTM_SOURCE);
  params.set('utm_campaign', 'place_details_search');
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

/**
 * Builds a universal Google Maps URL to view reviews for a specific place.
 * Prefers the Places API `googleMapsLinks.reviewsUri`, falling back to `buildPlaceDetailsUrl`.
 */
export function buildPlaceReviewsUrl(specialist: Specialist | null | undefined): string | undefined {
  if (!specialist) return undefined;
  return safeExternalUrl(specialist.reviewsUri) || buildPlaceDetailsUrl(specialist);
}

/**
 * Builds a universal cross-platform Google Maps Directions URL (`api=1`) for a single specialist.
 *
 * - Always respects the user's active `origin` and `travelMode` (avoiding stale `directionsUri`
 *   links locked to device GPS or driving mode after switching travel mode or starting address).
 * - Always includes `destination_place_id` when a valid Google Place ID is present for guaranteed
 *   establishment accuracy.
 * - When `origin` is absent, prefers the Places API `directionsUri` or omits `origin` so Google
 *   Maps automatically routes from the user's current device location.
 */
export function buildPlaceDirectionsUrl(
  origin: OriginLocation | null,
  specialist: Specialist | null | undefined,
  travelMode: TravelMode
): string | undefined {
  if (!specialist) return undefined;

  const urlMode = toGoogleMapsUrlTravelMode(travelMode);

  if (!origin) {
    if (travelMode === 'DRIVE') {
      const directDirections = safeExternalUrl(specialist.directionsUri);
      if (directDirections) return directDirections;
    }
    const params = new URLSearchParams({
      api: '1',
      destination: formatPlaceQueryLabel(specialist),
      travelmode: urlMode,
    });
    if (isValidGooglePlaceId(specialist.id)) {
      params.set('destination_place_id', specialist.id);
    }
    params.set('utm_source', MAPS_URL_UTM_SOURCE);
    params.set('utm_campaign', 'directions_request');
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }

  const params = new URLSearchParams({
    api: '1',
    origin: `${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}`,
    destination: formatPlaceQueryLabel(specialist),
    travelmode: urlMode,
  });
  if (isValidGooglePlaceId(specialist.id)) {
    params.set('destination_place_id', specialist.id);
  }
  params.set('utm_source', MAPS_URL_UTM_SOURCE);
  params.set('utm_campaign', 'directions_request');
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function encodeMultiStopDirectionsUrl(
  origin: OriginLocation | null,
  stops: Specialist[],
  travelMode: TravelMode,
  compactLabels: boolean
): string {
  const urlMode = toGoogleMapsUrlTravelMode(travelMode);
  const destination = stops[stops.length - 1];
  const params = new URLSearchParams({
    api: '1',
    travelmode: urlMode,
  });

  let waypoints: Specialist[];
  if (origin) {
    params.set('origin', `${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}`);
    waypoints = stops.slice(0, -1);
  } else {
    const first = stops[0];
    params.set('origin', formatPlaceQueryLabel(first, compactLabels));
    if (isValidGooglePlaceId(first.id)) {
      params.set('origin_place_id', first.id);
    }
    waypoints = stops.slice(1, -1);
  }

  params.set('destination', formatPlaceQueryLabel(destination, compactLabels));
  if (isValidGooglePlaceId(destination.id)) {
    params.set('destination_place_id', destination.id);
  }

  if (waypoints.length > 0) {
    params.set(
      'waypoints',
      waypoints.map((w) => formatPlaceQueryLabel(w, compactLabels)).join('|')
    );
    if (waypoints.every((w) => isValidGooglePlaceId(w.id))) {
      params.set('waypoint_place_ids', waypoints.map((w) => w.id).join('|'));
    }
  }

  params.set('utm_source', MAPS_URL_UTM_SOURCE);
  params.set('utm_campaign', 'multi_stop_directions');
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * Builds a shareable/openable universal Google Maps URL that syncs all selected specialists,
 * enforcing Google Maps URLs' 2,048-character maximum length limit.
 *
 * - 1 specialist with origin: Google Maps Directions URL with destination_place_id.
 * - 1 specialist without origin: direct Google Maps Place link or Search URL with query_place_id.
 * - 2+ specialists: Multi-stop Google Maps Directions URL plotting origin (if set) through all
 *   selected specialists in order (up to Google Maps' 9 intermediate waypoint limit).
 */
export function buildGoogleMapsSyncUrl(
  origin: OriginLocation | null,
  selectedSpecialists: Specialist[],
  travelMode: TravelMode
): string | null {
  if (!selectedSpecialists || selectedSpecialists.length === 0) {
    return null;
  }

  // Single selected option
  if (selectedSpecialists.length === 1) {
    const only = selectedSpecialists[0];
    if (!origin) {
      return buildPlaceDetailsUrl(only) ?? null;
    }
    return buildPlaceDirectionsUrl(origin, only, travelMode) ?? null;
  }

  // Multi-stop sync (up to 10 stops when origin is present: 9 waypoints + 1 destination)
  const capped = selectedSpecialists.slice(0, 10);

  // Try full descriptive labels first; if over 2,048 chars, compact labels, then trim waypoints
  const fullUrl = encodeMultiStopDirectionsUrl(origin, capped, travelMode, false);
  if (fullUrl.length <= MAX_GOOGLE_MAPS_URL_LENGTH) {
    return fullUrl;
  }

  const compactUrl = encodeMultiStopDirectionsUrl(origin, capped, travelMode, true);
  if (compactUrl.length <= MAX_GOOGLE_MAPS_URL_LENGTH) {
    return compactUrl;
  }

  for (let count = capped.length - 1; count >= 2; count--) {
    const trimmedStops = [...capped.slice(0, count - 1), capped[capped.length - 1]];
    const candidate = encodeMultiStopDirectionsUrl(origin, trimmedStops, travelMode, true);
    if (candidate.length <= MAX_GOOGLE_MAPS_URL_LENGTH) {
      return candidate;
    }
  }

  return buildPlaceDirectionsUrl(origin, capped[capped.length - 1], travelMode) ?? null;
}

/**
 * Generates compliant A2UI v0.9 surface messages for a single Google Maps
 * `PlaceDetailsCompact` component (from `@googlemaps/a2ui`).
 */
export function buildA2uiPlaceSurfaceMessages(
  surfaceId: string,
  placeId: string,
  orientation: 'horizontal' | 'vertical' = 'horizontal'
): A2uiSurfaceMessage[] {
  return [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId,
        catalogId: MAPS_A2UI_CATALOG_ID,
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          {
            id: 'root',
            component: 'PlaceDetailsCompact',
            placeId,
            orientation,
          },
        ],
      },
    },
  ];
}

/**
 * Generates an A2UI v0.9 list surface containing a `PlaceDetailsCompact` card
 * for every returned specialist with a valid Google Place ID.
 */
export function buildA2uiSpecialistsBatchMessages(
  surfaceId: string,
  specialists: Specialist[],
  orientation: 'horizontal' | 'vertical' = 'horizontal'
): A2uiSurfaceMessage[] {
  const validPlaces = specialists.filter((s) => isValidGooglePlaceId(s.id));
  if (validPlaces.length === 0) return [];

  const childIds: string[] = [];
  const placeComponents: Array<Record<string, unknown>> = [];

  for (let i = 0; i < validPlaces.length; i++) {
    const compId = `place_${i + 1}`;
    childIds.push(compId);
    placeComponents.push({
      id: compId,
      component: 'PlaceDetailsCompact',
      placeId: validPlaces[i].id,
      orientation,
    });
  }

  return [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId,
        catalogId: MAPS_A2UI_CATALOG_ID,
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId,
        components: [
          {
            id: 'root',
            component: 'Column',
            children: childIds,
          },
          ...placeComponents,
        ],
      },
    },
  ];
}
