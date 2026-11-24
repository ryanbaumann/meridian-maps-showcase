import type { Request } from 'express';
import { SHOWCASE_CONFIG } from '../src/config/showcase.ts';
import type {
  OriginLocation,
  PhotoAuthorAttribution,
  PlaceDetailsInsightsResponse,
  PlacePhotoInfo,
  PlaceReview,
  Specialist,
  TravelMode,
} from '../src/types.ts';
import {
  estimateTravelSeconds,
  haversineMeters,
  parseDurationSeconds,
  rankSpecialists,
} from '../src/utils/ranking.ts';
import {
  computeStarRatingDistribution,
  selectTopReviews,
} from '../src/utils/reviews.ts';
import { isUsableApiKey } from '../src/utils/sanitize.ts';
import { isAllowedGooglePhotoRedirectUrl } from '../src/utils/url.ts';

const ATTRIBUTION_SOLUTION_ID = SHOWCASE_CONFIG.primarySolutionId;

export class QuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

export class ReferrerRestrictedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReferrerRestrictedError';
  }
}

export function isUsableMapsApiKey(value: string | undefined | null): value is string {
  return isUsableApiKey(value);
}

export function getMapsApiKey(): string {
  const candidates = [
    process.env.GOOGLE_MAPS_API_KEY,
    process.env.VITE_GOOGLE_MAPS_API_KEY,
  ];
  for (const candidate of candidates) {
    if (isUsableMapsApiKey(candidate)) {
      return candidate.trim();
    }
  }
  return '';
}

export function getRequestReferer(req: Request): string {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.startsWith('http')) return origin;
  const referer = req.headers.referer;
  if (typeof referer === 'string' && referer.startsWith('http')) return referer;
  if (process.env.APP_URL && process.env.APP_URL.startsWith('http')) {
    return process.env.APP_URL;
  }
  return 'http://localhost:3000/';
}

function shortenAddressLabel(formatted: string, fallback: string): string {
  const parts = formatted
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const cleaned = parts.filter((p) => !/^(USA|United States)$/i.test(p));
    if (cleaned.length >= 2) {
      return `${cleaned[0]}, ${cleaned[1]}`;
    }
    return cleaned[0] || fallback;
  }
  return formatted || fallback;
}

function normalizeAttributionUri(uri?: string): string | undefined {
  if (!uri) return undefined;
  const trimmed = uri.trim();
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return undefined;
}

interface RawPlaceReview {
  rating?: number;
  relativePublishTimeDescription?: string;
  text?: { text?: string };
  originalText?: { text?: string };
  googleMapsUri?: string;
  authorAttribution?: {
    displayName?: string;
    uri?: string;
  };
}

function mapRawReviews(rawReviews?: RawPlaceReview[]): PlaceReview[] {
  return (rawReviews ?? [])
    .filter((r) => Boolean((r.text?.text || r.originalText?.text)?.trim()))
    .slice(0, 5)
    .map((r) => ({
      authorName:
        r.authorAttribution?.displayName?.trim() || SHOWCASE_CONFIG.agent.reviewerFallbackName,
      authorUri: normalizeAttributionUri(r.authorAttribution?.uri),
      rating: typeof r.rating === 'number' ? r.rating : 5,
      text: (r.text?.text || r.originalText?.text || '').trim(),
      relativePublishTime: r.relativePublishTimeDescription,
      googleMapsUri: normalizeAttributionUri(r.googleMapsUri),
    }));
}

export async function geocodeAddressServer(
  addressText: string,
  mapsKey: string,
  referer: string
): Promise<OriginLocation | null> {
  if (!mapsKey) return null;

  const encoded = encodeURIComponent(addressText.trim());
  const v4Url = `https://geocode.googleapis.com/v4/geocode/address/${encoded}`;

  try {
    const v4Res = await fetch(v4Url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': mapsKey,
        'X-Goog-FieldMask': 'results.placeId,results.location,results.formattedAddress',
        'X-Goog-Maps-Solution-ID': ATTRIBUTION_SOLUTION_ID,
        Referer: referer,
      },
    });

    if (v4Res.status === 429) {
      throw new QuotaExceededError('Google Maps Platform quota reached.');
    }

    if (v4Res.ok) {
      const data = (await v4Res.json()) as {
        results?: Array<{
          location?: { latitude?: number; longitude?: number };
          formattedAddress?: string;
        }>;
      };
      const first = data.results?.[0];
      if (first?.location?.latitude != null && first?.location?.longitude != null) {
        const formatted = first.formattedAddress || addressText;
        return {
          label: shortenAddressLabel(formatted, addressText),
          formattedAddress: formatted,
          lat: first.location.latitude,
          lng: first.location.longitude,
        };
      }
    } else if (v4Res.status === 403) {
      const bodyText = await v4Res.text().catch(() => '');
      if (bodyText.includes('RESOURCE_EXHAUSTED')) {
        throw new QuotaExceededError('Google Maps Platform quota reached.');
      }
    }
  } catch (err) {
    if (err instanceof QuotaExceededError) throw err;
  }

  // Fallback to standard Geocoding REST API when Geocoding v4 is unavailable
  const fallbackUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encoded}&key=${encodeURIComponent(mapsKey)}`;
  const res = await fetch(fallbackUrl, {
    headers: {
      'X-Goog-Maps-Solution-ID': ATTRIBUTION_SOLUTION_ID,
      Referer: referer,
    },
  });

  if (res.status === 429) {
    throw new QuotaExceededError('Google Maps Platform quota reached.');
  }

  const json = (await res.json()) as {
    status?: string;
    error_message?: string;
    results?: Array<{
      formatted_address?: string;
      geometry?: { location?: { lat?: number; lng?: number } };
    }>;
  };

  if (json.status === 'OVER_QUERY_LIMIT') {
    throw new QuotaExceededError('Google Maps Platform quota reached.');
  }
  if (json.status === 'REQUEST_DENIED') {
    throw new ReferrerRestrictedError(json.error_message || 'Geocoding API request denied.');
  }

  const first = json.results?.[0];
  if (first?.geometry?.location?.lat != null && first?.geometry?.location?.lng != null) {
    const formatted = first.formatted_address || addressText;
    return {
      label: shortenAddressLabel(formatted, addressText),
      formattedAddress: formatted,
      lat: first.geometry.location.lat,
      lng: first.geometry.location.lng,
    };
  }

  return null;
}

export async function reverseGeocodeServer(
  lat: number,
  lng: number,
  mapsKey: string,
  referer: string
): Promise<OriginLocation> {
  const fallback: OriginLocation = {
    label: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    formattedAddress: `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
    lat,
    lng,
  };
  if (!mapsKey) return fallback;

  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${encodeURIComponent(mapsKey)}`;
    const res = await fetch(url, {
      headers: {
        'X-Goog-Maps-Solution-ID': ATTRIBUTION_SOLUTION_ID,
        Referer: referer,
      },
    });
    if (res.status === 429) {
      throw new QuotaExceededError('Google Maps Platform quota reached.');
    }
    const json = (await res.json()) as {
      status?: string;
      results?: Array<{ formatted_address?: string }>;
    };
    if (json.status === 'OVER_QUERY_LIMIT') {
      throw new QuotaExceededError('Google Maps Platform quota reached.');
    }
    const formatted = json.results?.[0]?.formatted_address;
    if (formatted) {
      return {
        label: shortenAddressLabel(formatted, formatted),
        formattedAddress: formatted,
        lat,
        lng,
      };
    }
  } catch (err) {
    if (err instanceof QuotaExceededError) throw err;
  }

  return fallback;
}

interface PlacesTextSearchResponse {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
    rating?: number;
    userRatingCount?: number;
    regularOpeningHours?: {
      openNow?: boolean;
      weekdayDescriptions?: string[];
    };
    editorialSummary?: { text?: string };
    accessibilityOptions?: {
      wheelchairAccessibleEntrance?: boolean;
    };
    reviews?: RawPlaceReview[];
    nationalPhoneNumber?: string;
    websiteUri?: string;
    googleMapsUri?: string;
    googleMapsLinks?: {
      directionsUri?: string;
      placeUri?: string;
      reviewsUri?: string;
    };
    primaryTypeDisplayName?: { text?: string };
    photos?: Array<{
      name?: string;
      widthPx?: number;
      heightPx?: number;
      authorAttributions?: Array<{
        displayName?: string;
        uri?: string;
      }>;
    }>;
  }>;
  routingSummaries?: Array<{
    legs?: Array<{ duration?: string; distanceMeters?: number }>;
    directionsUri?: string;
  }>;
  error?: { status?: string; message?: string; code?: number };
}

export async function searchPlacesWithRoutingServer(
  specialistQuery: string,
  origin: OriginLocation,
  travelMode: TravelMode,
  mapsKey: string,
  referer: string
): Promise<Specialist[]> {
  if (!mapsKey) {
    throw new ReferrerRestrictedError('Maps API key not configured on server.');
  }

  const endpoint = 'https://places.googleapis.com/v1/places:searchText';
  const fieldMask = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.location',
    'places.rating',
    'places.userRatingCount',
    'places.regularOpeningHours.openNow',
    'places.regularOpeningHours.weekdayDescriptions',
    'places.editorialSummary',
    'places.accessibilityOptions',
    'places.reviews',
    'places.nationalPhoneNumber',
    'places.websiteUri',
    'places.googleMapsUri',
    'places.googleMapsLinks.directionsUri',
    'places.googleMapsLinks.placeUri',
    'places.googleMapsLinks.reviewsUri',
    'places.primaryTypeDisplayName',
    'places.photos',
    'routingSummaries',
  ].join(',');

  const body = {
    textQuery: `${specialistQuery} near ${origin.formattedAddress}`,
    maxResultCount: SHOWCASE_CONFIG.maxResults,
    locationBias: {
      circle: {
        center: { latitude: origin.lat, longitude: origin.lng },
        radius: SHOWCASE_CONFIG.searchRadiusMeters,
      },
    },
    routingParameters: {
      origin: { latitude: origin.lat, longitude: origin.lng },
      travelMode,
      routingPreference: travelMode === 'DRIVE' ? 'TRAFFIC_AWARE' : undefined,
    },
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': mapsKey,
      'X-Goog-FieldMask': fieldMask,
      'X-Goog-Maps-Solution-ID': ATTRIBUTION_SOLUTION_ID,
      Referer: referer,
    },
    body: JSON.stringify(body),
  });

  if (res.status === 429) {
    throw new QuotaExceededError('Google Maps Platform quota reached.');
  }

  const data = (await res.json()) as PlacesTextSearchResponse;
  if (!res.ok) {
    if (data.error?.status === 'RESOURCE_EXHAUSTED') {
      throw new QuotaExceededError('Google Maps Platform quota reached.');
    }
    if (res.status === 403 || data.error?.status === 'PERMISSION_DENIED') {
      throw new ReferrerRestrictedError(data.error?.message || 'Places API permission denied.');
    }
    throw new Error(data.error?.message || `Places API error (${res.status})`);
  }

  const places = data.places ?? [];
  const summaries = data.routingSummaries ?? [];
  const specialists: Specialist[] = [];

  for (let i = 0; i < places.length; i++) {
    const place = places[i];
    const lat = place.location?.latitude;
    const lng = place.location?.longitude;
    const name = place.displayName?.text;
    if (!name || lat == null || lng == null) continue;

    const summary = summaries[i];
    const leg = summary?.legs?.[0];
    const parsedDuration = parseDurationSeconds(leg?.duration);
    const verifiedDistance = typeof leg?.distanceMeters === 'number' ? leg.distanceMeters : null;

    const fallbackDistance = haversineMeters({ lat: origin.lat, lng: origin.lng }, { lat, lng });
    const distanceMeters = verifiedDistance ?? Math.round(fallbackDistance);
    const travelDurationSeconds =
      parsedDuration ?? estimateTravelSeconds(distanceMeters, travelMode);

    const topPhoto = place.photos?.[0];
    let photo: PlacePhotoInfo | undefined;
    if (topPhoto?.name && /^places\/[^/]+\/photos\/[^/]+$/.test(topPhoto.name)) {
      const attributions: PhotoAuthorAttribution[] = (topPhoto.authorAttributions ?? [])
        .filter((a) => Boolean(a.displayName))
        .map((a) => ({
          displayName: a.displayName!.trim(),
          uri: normalizeAttributionUri(a.uri),
        }));
      photo = {
        photoUrl: `/api/place-photo?name=${encodeURIComponent(topPhoto.name)}&maxWidthPx=480&maxHeightPx=320`,
        widthPx: topPhoto.widthPx,
        heightPx: topPhoto.heightPx,
        authorAttributions: attributions,
      };
    }

    const reviews = mapRawReviews(place.reviews);
    const placeRating = typeof place.rating === 'number' ? place.rating : null;
    const placeRatingCount =
      typeof place.userRatingCount === 'number' ? place.userRatingCount : 0;

    specialists.push({
      id: place.id || `place-${i}-${lat.toFixed(4)}`,
      name,
      specialty: place.primaryTypeDisplayName?.text || specialistQuery,
      address: place.formattedAddress || '',
      location: { lat, lng },
      rating: placeRating,
      userRatingCount: placeRatingCount,
      openNow:
        typeof place.regularOpeningHours?.openNow === 'boolean'
          ? place.regularOpeningHours.openNow
          : null,
      weekdayDescriptions: place.regularOpeningHours?.weekdayDescriptions,
      editorialSummary: place.editorialSummary?.text?.trim() || undefined,
      reviews: reviews.length > 0 ? reviews : undefined,
      ratingDistribution: computeStarRatingDistribution(placeRating, placeRatingCount, reviews),
      topReviews: selectTopReviews(reviews, 2),
      detailsLoaded: reviews.length > 0,
      wheelchairAccessible:
        typeof place.accessibilityOptions?.wheelchairAccessibleEntrance === 'boolean'
          ? place.accessibilityOptions.wheelchairAccessibleEntrance
          : undefined,
      phoneNumber: place.nationalPhoneNumber,
      websiteUri: place.websiteUri,
      googleMapsUri: place.googleMapsUri || place.googleMapsLinks?.placeUri,
      directionsUri: summary?.directionsUri || place.googleMapsLinks?.directionsUri,
      reviewsUri: place.googleMapsLinks?.reviewsUri,
      photo,
      travelDurationSeconds,
      distanceMeters,
      isRouteVerified: parsedDuration !== null,
    });
  }

  return rankSpecialists(specialists, 'balanced');
}

export async function fetchPlacePhotoUri(
  photoResourceName: string,
  maxWidthPx: number,
  maxHeightPx: number,
  mapsKey: string,
  referer: string
): Promise<{ status: number; photoUri?: string; quotaExceeded?: boolean }> {
  const mediaUrl = `https://places.googleapis.com/v1/${photoResourceName}/media?maxWidthPx=${maxWidthPx}&maxHeightPx=${maxHeightPx}&skipHttpRedirect=true`;
  const metaRes = await fetch(mediaUrl, {
    headers: {
      'X-Goog-Api-Key': mapsKey,
      'X-Goog-Maps-Solution-ID': ATTRIBUTION_SOLUTION_ID,
      Referer: referer,
    },
  });

  if (metaRes.status === 429) {
    return { status: 429, quotaExceeded: true };
  }
  if (!metaRes.ok) {
    return { status: metaRes.status };
  }

  const json = (await metaRes.json()) as { photoUri?: string };
  if (!json.photoUri || !isAllowedGooglePhotoRedirectUrl(json.photoUri)) {
    return { status: 404 };
  }

  return { status: 200, photoUri: json.photoUri };
}

export async function fetchPlaceDetailsInsights(
  placeId: string,
  mapsKey: string,
  referer: string
): Promise<{ status: number; payload: PlaceDetailsInsightsResponse }> {
  const fieldMask = [
    'id',
    'rating',
    'userRatingCount',
    'reviews',
    'editorialSummary',
    'regularOpeningHours.openNow',
    'regularOpeningHours.weekdayDescriptions',
    'nationalPhoneNumber',
    'websiteUri',
    'googleMapsUri',
    'googleMapsLinks.placeUri',
    'googleMapsLinks.reviewsUri',
  ].join(',');

  const detailsUrl = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`;
  const apiRes = await fetch(detailsUrl, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': mapsKey,
      'X-Goog-FieldMask': fieldMask,
      'X-Goog-Maps-Solution-ID': ATTRIBUTION_SOLUTION_ID,
      Referer: referer,
    },
  });

  if (apiRes.status === 429) {
    return {
      status: 429,
      payload: {
        placeId,
        rating: null,
        userRatingCount: 0,
        reviews: [],
        topReviews: [],
        ratingDistribution: null,
        quotaExceeded: true,
        error: 'Google Maps Platform quota reached.',
      },
    };
  }

  const data = (await apiRes.json()) as {
    id?: string;
    rating?: number;
    userRatingCount?: number;
    editorialSummary?: { text?: string };
    regularOpeningHours?: {
      openNow?: boolean;
      weekdayDescriptions?: string[];
    };
    nationalPhoneNumber?: string;
    websiteUri?: string;
    googleMapsUri?: string;
    googleMapsLinks?: {
      placeUri?: string;
      reviewsUri?: string;
    };
    reviews?: RawPlaceReview[];
    error?: { status?: string; message?: string };
  };

  if (!apiRes.ok) {
    if (data.error?.status === 'RESOURCE_EXHAUSTED') {
      return {
        status: 429,
        payload: {
          placeId,
          rating: null,
          userRatingCount: 0,
          reviews: [],
          topReviews: [],
          ratingDistribution: null,
          quotaExceeded: true,
          error: 'Google Maps Platform quota reached.',
        },
      };
    }
    if (apiRes.status === 403 || data.error?.status === 'PERMISSION_DENIED') {
      return {
        status: 200,
        payload: {
          placeId,
          rating: null,
          userRatingCount: 0,
          reviews: [],
          topReviews: [],
          ratingDistribution: null,
          needsClientDetailsFallback: true,
        },
      };
    }
    return {
      status: apiRes.status,
      payload: {
        placeId,
        rating: null,
        userRatingCount: 0,
        reviews: [],
        topReviews: [],
        ratingDistribution: null,
        error: 'Unable to fetch place details.',
      },
    };
  }

  const reviews = mapRawReviews(data.reviews);
  const rating = typeof data.rating === 'number' ? data.rating : null;
  const userRatingCount =
    typeof data.userRatingCount === 'number' ? data.userRatingCount : reviews.length;

  return {
    status: 200,
    payload: {
      placeId: data.id || placeId,
      rating,
      userRatingCount,
      reviews,
      topReviews: selectTopReviews(reviews, 2),
      ratingDistribution: computeStarRatingDistribution(rating, userRatingCount, reviews),
      editorialSummary: data.editorialSummary?.text?.trim() || undefined,
      weekdayDescriptions: data.regularOpeningHours?.weekdayDescriptions,
      openNow:
        typeof data.regularOpeningHours?.openNow === 'boolean'
          ? data.regularOpeningHours.openNow
          : null,
      phoneNumber: data.nationalPhoneNumber,
      websiteUri: data.websiteUri,
      googleMapsUri: data.googleMapsUri || data.googleMapsLinks?.placeUri,
      reviewsUri: data.googleMapsLinks?.reviewsUri,
    },
  };
}
