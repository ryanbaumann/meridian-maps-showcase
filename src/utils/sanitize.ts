import type {
  ChatHistoryItem,
  OriginLocation,
  PhotoAuthorAttribution,
  PlacePhotoInfo,
  PlaceReview,
  RatingDistribution,
  Specialist,
} from '../types.ts';
import { safeExternalUrl, safePhotoUrl } from './url.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rejects empty, whitespace-containing, or template placeholder API keys before
 * sending them to Google Maps or Gemini APIs.
 */
export function isUsableApiKey(value: string | undefined | null): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  if (/^(?:MY_|YOUR_|PLACEHOLDER|REPLACE_|ENTER_|<)/i.test(trimmed)) return false;
  return true;
}

/**
 * Collapses control characters and trims a string to a safe maximum length.
 */
export function cleanBoundedText(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, maxLen);
}

export function isValidCoordinate(lat: unknown, lng: unknown): lat is number {
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

function clampFiniteNumber(
  value: unknown,
  min: number,
  max: number
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(Math.max(value, min), max);
}

export function sanitizeOrigin(raw: unknown): OriginLocation | null {
  if (!isRecord(raw)) return null;
  if (!isValidCoordinate(raw.lat, raw.lng)) return null;
  const label = cleanBoundedText(raw.label, 120);
  const formattedAddress = cleanBoundedText(raw.formattedAddress, 200);
  const fallback = `${(raw.lat as number).toFixed(4)}, ${(raw.lng as number).toFixed(4)}`;
  return {
    label: label || formattedAddress || fallback,
    formattedAddress: formattedAddress || label || fallback,
    lat: raw.lat as number,
    lng: raw.lng as number,
  };
}

export function sanitizeHistory(raw: unknown): ChatHistoryItem[] {
  if (!Array.isArray(raw)) return [];
  const items: ChatHistoryItem[] = [];
  for (const entry of raw.slice(-6)) {
    if (!isRecord(entry)) continue;
    const role = entry.role === 'user' || entry.role === 'assistant' ? entry.role : null;
    const text = cleanBoundedText(entry.text, 400);
    if (role && text) {
      items.push({ role, text });
    }
  }
  return items;
}

function sanitizeReviews(raw: unknown, maxCount = 5): PlaceReview[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const reviews: PlaceReview[] = [];
  for (const entry of raw.slice(0, maxCount)) {
    if (!isRecord(entry)) continue;
    const text = cleanBoundedText(entry.text, 320);
    if (!text) continue;
    const authorName = cleanBoundedText(entry.authorName, 80) || 'Reviewer';
    const rating = clampFiniteNumber(entry.rating, 1, 5) ?? 5;
    const relativePublishTime = cleanBoundedText(entry.relativePublishTime, 48) || undefined;
    reviews.push({
      authorName,
      authorUri: safeExternalUrl(typeof entry.authorUri === 'string' ? entry.authorUri : undefined),
      rating,
      text,
      relativePublishTime,
      googleMapsUri: safeExternalUrl(
        typeof entry.googleMapsUri === 'string' ? entry.googleMapsUri : undefined
      ),
    });
  }
  return reviews.length > 0 ? reviews : undefined;
}

function sanitizePhoto(raw: unknown): PlacePhotoInfo | undefined {
  if (!isRecord(raw)) return undefined;
  const photoUrl = safePhotoUrl(typeof raw.photoUrl === 'string' ? raw.photoUrl : undefined);
  if (!photoUrl) return undefined;

  const authorAttributions: PhotoAuthorAttribution[] = [];
  if (Array.isArray(raw.authorAttributions)) {
    for (const attr of raw.authorAttributions.slice(0, 3)) {
      if (!isRecord(attr)) continue;
      const displayName = cleanBoundedText(attr.displayName, 80);
      if (!displayName) continue;
      authorAttributions.push({
        displayName,
        uri: safeExternalUrl(typeof attr.uri === 'string' ? attr.uri : undefined),
      });
    }
  }

  return {
    photoUrl,
    widthPx: clampFiniteNumber(raw.widthPx, 1, 4096) ?? undefined,
    heightPx: clampFiniteNumber(raw.heightPx, 1, 4096) ?? undefined,
    authorAttributions,
  };
}

function sanitizeRatingDistribution(raw: unknown): RatingDistribution | null | undefined {
  if (raw === null) return null;
  if (!isRecord(raw) || !Array.isArray(raw.buckets)) return undefined;
  const sampleSize = clampFiniteNumber(raw.sampleSize, 0, 10_000_000);
  if (sampleSize === null) return undefined;

  const buckets: RatingDistribution['buckets'] = [];
  for (const b of raw.buckets.slice(0, 5)) {
    if (!isRecord(b)) continue;
    const stars = b.stars;
    if (stars !== 1 && stars !== 2 && stars !== 3 && stars !== 4 && stars !== 5) continue;
    const count = clampFiniteNumber(b.count, 0, 10_000_000);
    const percentage = clampFiniteNumber(b.percentage, 0, 100);
    if (count === null || percentage === null) continue;
    buckets.push({ stars, count: Math.round(count), percentage: Math.round(percentage) });
  }
  if (buckets.length === 0) return undefined;
  return {
    buckets,
    isEstimated: Boolean(raw.isEstimated),
    sampleSize: Math.round(sampleSize),
  };
}

/**
 * Reconstructs client-supplied specialist objects using an explicit field allowlist,
 * strict string length caps, numeric bounds, and URL sanitization to prevent prompt
 * amplification (OWASP LLM10), prompt smuggling (LLM01), and unsafe URL echo.
 */
export function sanitizeSpecialists(raw: unknown): Specialist[] {
  if (!Array.isArray(raw)) return [];
  const sanitized: Specialist[] = [];

  for (const item of raw.slice(0, 12)) {
    if (!isRecord(item) || !isRecord(item.location)) continue;
    if (!isValidCoordinate(item.location.lat, item.location.lng)) continue;

    const id = cleanBoundedText(item.id, 160);
    const name = cleanBoundedText(item.name, 140);
    if (!id || !name) continue;

    const weekdayDescriptions = Array.isArray(item.weekdayDescriptions)
      ? item.weekdayDescriptions
          .slice(0, 7)
          .map((line) => cleanBoundedText(line, 96))
          .filter(Boolean)
      : undefined;

    const reviews = sanitizeReviews(item.reviews, 5);
    const topReviews = sanitizeReviews(item.topReviews, 2);

    sanitized.push({
      id,
      name,
      specialty: cleanBoundedText(item.specialty, 80) || 'Specialist',
      address: cleanBoundedText(item.address, 200),
      location: {
        lat: item.location.lat as number,
        lng: item.location.lng as number,
      },
      rating: clampFiniteNumber(item.rating, 0, 5),
      userRatingCount: Math.round(clampFiniteNumber(item.userRatingCount, 0, 10_000_000) ?? 0),
      openNow: typeof item.openNow === 'boolean' ? item.openNow : null,
      weekdayDescriptions:
        weekdayDescriptions && weekdayDescriptions.length > 0 ? weekdayDescriptions : undefined,
      editorialSummary: cleanBoundedText(item.editorialSummary, 240) || undefined,
      reviews,
      topReviews,
      ratingDistribution: sanitizeRatingDistribution(item.ratingDistribution),
      detailsLoaded: typeof item.detailsLoaded === 'boolean' ? item.detailsLoaded : undefined,
      wheelchairAccessible:
        typeof item.wheelchairAccessible === 'boolean' ? item.wheelchairAccessible : undefined,
      phoneNumber: cleanBoundedText(item.phoneNumber, 40) || undefined,
      websiteUri: safeExternalUrl(typeof item.websiteUri === 'string' ? item.websiteUri : undefined),
      googleMapsUri: safeExternalUrl(
        typeof item.googleMapsUri === 'string' ? item.googleMapsUri : undefined
      ),
      directionsUri: safeExternalUrl(
        typeof item.directionsUri === 'string' ? item.directionsUri : undefined
      ),
      photo: sanitizePhoto(item.photo),
      travelDurationSeconds: clampFiniteNumber(item.travelDurationSeconds, 0, 86_400),
      distanceMeters: clampFiniteNumber(item.distanceMeters, 0, 500_000),
      isRouteVerified: Boolean(item.isRouteVerified),
      compositeScore: clampFiniteNumber(item.compositeScore, 0, 100) ?? undefined,
    });
  }

  return sanitized;
}
