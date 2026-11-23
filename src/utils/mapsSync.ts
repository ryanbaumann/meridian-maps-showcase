import type {
  A2uiSurfaceMessage,
  OriginLocation,
  Specialist,
  TravelMode,
} from '../types.ts';
import { safeExternalUrl } from './url.ts';

export const MAPS_A2UI_CATALOG_ID = 'a2ui://maps-agentic-ui-catalog.json';

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

function formatPlaceQueryLabel(specialist: Specialist): string {
  return specialist.address
    ? `${specialist.name}, ${specialist.address}`
    : `${specialist.name} (${specialist.location.lat.toFixed(5)},${specialist.location.lng.toFixed(5)})`;
}

/**
 * Builds a shareable/openable Google Maps URL that syncs all selected specialists.
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

  const urlMode = toGoogleMapsUrlTravelMode(travelMode);

  // Single selected option
  if (selectedSpecialists.length === 1) {
    const only = selectedSpecialists[0];
    if (!origin) {
      const safeMapsUri = safeExternalUrl(only.googleMapsUri);
      if (safeMapsUri) {
        return safeMapsUri;
      }
      const params = new URLSearchParams({
        api: '1',
        query: formatPlaceQueryLabel(only),
      });
      if (isValidGooglePlaceId(only.id)) {
        params.set('query_place_id', only.id);
      }
      return `https://www.google.com/maps/search/?${params.toString()}`;
    }

    const params = new URLSearchParams({
      api: '1',
      origin: `${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}`,
      destination: formatPlaceQueryLabel(only),
      travelmode: urlMode,
    });
    if (isValidGooglePlaceId(only.id)) {
      params.set('destination_place_id', only.id);
    }
    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }

  // Multi-stop sync (up to 10 stops when origin is present: 9 waypoints + 1 destination)
  const capped = selectedSpecialists.slice(0, 10);
  const destination = capped[capped.length - 1];
  const params = new URLSearchParams({
    api: '1',
    travelmode: urlMode,
  });

  let waypoints: Specialist[];
  if (origin) {
    params.set('origin', `${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}`);
    waypoints = capped.slice(0, -1);
  } else {
    const first = capped[0];
    params.set('origin', formatPlaceQueryLabel(first));
    if (isValidGooglePlaceId(first.id)) {
      params.set('origin_place_id', first.id);
    }
    waypoints = capped.slice(1, -1);
  }

  params.set('destination', formatPlaceQueryLabel(destination));
  if (isValidGooglePlaceId(destination.id)) {
    params.set('destination_place_id', destination.id);
  }

  if (waypoints.length > 0) {
    params.set('waypoints', waypoints.map(formatPlaceQueryLabel).join('|'));
    if (waypoints.every((w) => isValidGooglePlaceId(w.id))) {
      params.set('waypoint_place_ids', waypoints.map((w) => w.id).join('|'));
    }
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
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
