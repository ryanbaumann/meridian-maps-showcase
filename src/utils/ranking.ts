import type { LatLng, ParsedIntent, SortMode, Specialist, TravelMode } from '../types';

/**
 * Parses Google Routes/Places duration strings like "597s" or "1240.5s" into integer seconds.
 */
export function parseDurationSeconds(duration: string | number | null | undefined): number | null {
  if (typeof duration === 'number' && Number.isFinite(duration) && duration >= 0) {
    return Math.round(duration);
  }
  if (typeof duration !== 'string') return null;
  const trimmed = duration.trim();
  const match = /^(\d+(?:\.\d+)?)s$/i.exec(trimmed);
  if (!match) return null;
  return Math.round(parseFloat(match[1]));
}

/**
 * Formats duration in seconds into compact human-readable text (e.g., "6 min", "1 hr 12 min").
 */
export function formatTravelTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) {
    return 'Time N/A';
  }
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return mins === 0 ? `${hours} hr` : `${hours} hr ${mins} min`;
}

/**
 * Formats distance in meters to miles (default) or km.
 */
export function formatDistance(meters: number | null | undefined, unit: 'mi' | 'km' = 'mi'): string {
  if (meters == null || !Number.isFinite(meters) || meters < 0) {
    return '';
  }
  if (unit === 'km') {
    const km = meters / 1000;
    return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
  }
  const miles = meters / 1609.344;
  if (miles < 0.1) return '<0.1 mi';
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

/**
 * Haversine straight-line distance in meters between two coordinates.
 * Used as a fallback estimator only when live route summaries are unavailable.
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Estimates travel duration in seconds from straight-line distance when route summaries are unavailable.
 */
export function estimateTravelSeconds(distanceMeters: number, mode: TravelMode): number {
  // Road factor ~1.3x straight line
  const roadMeters = distanceMeters * 1.3;
  const speedMetersPerSec: Record<TravelMode, number> = {
    DRIVE: 9.5, // ~21 mph urban average
    BICYCLE: 4.4, // ~10 mph
    WALK: 1.35, // ~3 mph
  };
  return Math.max(60, Math.round(roadMeters / speedMetersPerSec[mode]));
}

/**
 * Bayesian-adjusted rating on a 0–5 scale.
 * Dampens high ratings with very few reviews toward a prior mean of 4.2.
 */
export function computeBayesianRating(rating: number | null, reviewCount: number): number {
  if (rating == null || !Number.isFinite(rating) || rating <= 0) {
    return 3.5;
  }
  const priorMean = 4.2;
  const priorWeight = 20;
  const safeCount = Math.max(0, reviewCount || 0);
  return (safeCount * rating + priorWeight * priorMean) / (safeCount + priorWeight);
}

/**
 * Computes a 0–100 composite score blending Bayesian rating quality (55%)
 * and travel-time convenience (45%).
 */
export function computeCompositeScore(specialist: Specialist, maxDurationSeconds: number): number {
  const bayesRating = computeBayesianRating(specialist.rating, specialist.userRatingCount);
  // Map 3.0–5.0 Bayesian rating cleanly into 0–1
  const ratingNorm = Math.max(0, Math.min(1, (bayesRating - 3.0) / 2.0));

  let timeNorm = 0.5;
  if (specialist.travelDurationSeconds != null && Number.isFinite(specialist.travelDurationSeconds)) {
    const ceiling = Math.max(600, maxDurationSeconds); // at least 10-min reference window
    // Shorter travel time => closer to 1.0
    timeNorm = Math.max(0, Math.min(1, 1 - specialist.travelDurationSeconds / (ceiling * 1.15)));
  }

  const raw = (ratingNorm * 0.55 + timeNorm * 0.45) * 100;
  return Math.round(raw);
}

/**
 * Ranks specialists according to the chosen sort mode without mutating the input array.
 */
export function rankSpecialists(specialists: Specialist[], sortMode: SortMode): Specialist[] {
  if (specialists.length === 0) return [];

  const validDurations = specialists
    .map((s) => s.travelDurationSeconds)
    .filter((d): d is number => d != null && Number.isFinite(d));
  const maxDuration = validDurations.length > 0 ? Math.max(...validDurations) : 1800;

  const scored = specialists.map((item) => ({
    ...item,
    compositeScore: computeCompositeScore(item, maxDuration),
  }));

  return scored.sort((a, b) => {
    if (sortMode === 'fastest') {
      const aTime = a.travelDurationSeconds ?? Number.POSITIVE_INFINITY;
      const bTime = b.travelDurationSeconds ?? Number.POSITIVE_INFINITY;
      if (aTime !== bTime) return aTime - bTime;
      return computeBayesianRating(b.rating, b.userRatingCount) - computeBayesianRating(a.rating, a.userRatingCount);
    }

    if (sortMode === 'rating') {
      const aBayes = computeBayesianRating(a.rating, a.userRatingCount);
      const bBayes = computeBayesianRating(b.rating, b.userRatingCount);
      if (Math.abs(bBayes - aBayes) > 0.001) return bBayes - aBayes;
      const aTime = a.travelDurationSeconds ?? Number.POSITIVE_INFINITY;
      const bTime = b.travelDurationSeconds ?? Number.POSITIVE_INFINITY;
      return aTime - bTime;
    }

    // Default: balanced composite score
    const scoreDiff = (b.compositeScore ?? 0) - (a.compositeScore ?? 0);
    if (scoreDiff !== 0) return scoreDiff;
    const aTime = a.travelDurationSeconds ?? Number.POSITIVE_INFINITY;
    const bTime = b.travelDurationSeconds ?? Number.POSITIVE_INFINITY;
    return aTime - bTime;
  });
}

const KNOWN_SPECIALISTS = [
  'dentist',
  'dental',
  'orthodontist',
  'endodontist',
  'periodontist',
  'pediatric dentist',
  'cosmetic dentist',
  'oral surgeon',
  'dermatologist',
  'optometrist',
  'ophthalmologist',
  'physical therapist',
  'physical therapy',
  'chiropractor',
  'cardiologist',
  'pediatrician',
  'primary care',
  'urgent care',
  'ent',
  'allergist',
  'podiatrist',
  'therapist',
  'psychiatrist',
  'psychologist',
  'obgyn',
  'gynecologist',
  'neurologist',
  'orthopedist',
  'orthopedic',
  'urologist',
  'gastroenterologist',
  'doctor',
  'clinic',
  'specialist',
  'veterinarian',
  'vet',
];

/**
 * Fast deterministic parser for common specialist + location phrasings so simple queries
 * skip an extra LLM round-trip and respond near-instantly.
 */
export function parseFastUserMessage(
  rawMessage: string,
  hasExistingOrigin: boolean
): ParsedIntent | null {
  const message = rawMessage.trim();
  if (!message) return null;

  const lower = message.toLowerCase();

  // Detect optional travel mode mentions
  let travelMode: TravelMode | undefined;
  if (/\b(walk|walking|on foot)\b/i.test(lower)) {
    travelMode = 'WALK';
  } else if (/\b(bike|biking|cycling|bicycle)\b/i.test(lower)) {
    travelMode = 'BICYCLE';
  } else if (/\b(drive|driving|car)\b/i.test(lower)) {
    travelMode = 'DRIVE';
  }

  const containsSpecialist = KNOWN_SPECIALISTS.some((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}s?\\b`, 'i').test(lower);
  });

  // Explicit location-setting phrases without a specialist:
  // e.g. "I'm in Austin, TX", "My location is 94107", "location: Seattle, WA"
  const locationOnlyMatch =
    /^(?:i(?:'m| am)\s+(?:in|at|near)|my location is|set location(?: to)?|location:?|from)\s+(.+)$/i.exec(
      message
    );
  if (locationOnlyMatch && !containsSpecialist) {
    return {
      action: 'set_location_only',
      specialistQuery: null,
      locationText: locationOnlyMatch[1].trim().replace(/[.!?]+$/, ''),
      travelMode,
    };
  }

  // Bare zip code, "City, ST", or street address when no specialist keyword is present
  const looksLikeZip = /^\d{5}(?:-\d{4})?$/.test(message);
  const looksLikeCityState = /^[A-Za-z][A-Za-z\s.'-]{1,40},\s*[A-Za-z]{2,20}(?:\s+\d{5})?$/.test(message);
  const looksLikeStreetAddress = /^\d{1,6}\s+[A-Za-z0-9\s.'-]+(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|pkwy|parkway|pl|place|ct|court)\b/i.test(
    message
  );

  if (!containsSpecialist && (looksLikeZip || looksLikeCityState || looksLikeStreetAddress)) {
    return {
      action: 'set_location_only',
      specialistQuery: null,
      locationText: message,
      travelMode,
    };
  }

  // "<specialist query> near/in/around <location>"
  const splitMatch = /^(.+?)\s+(?:near|in|around|by)\s+(.+)$/i.exec(message);
  if (splitMatch && containsSpecialist) {
    const left = splitMatch[1].trim();
    const right = splitMatch[2]
      .trim()
      .replace(/\s+\b(?:walking|driving|biking|cycling|on foot|by car|by bike)\b$/i, '')
      .replace(/[.!?]+$/, '');
    const isNearMe = /^(?:me|here|my location|my area)$/i.test(right);
    const cleanedLeft = left
      .replace(
        /^(?:find(?:\s+me)?|search(?:\s+for)?|show(?:\s+me)?|looking for|i need|need)\s+/i,
        ''
      )
      .replace(/^(?:a|an|the|some|best|top|good)\s+/i, '')
      .trim();
    return {
      action: 'search',
      specialistQuery: cleanedLeft || left,
      locationText: isNearMe ? null : right,
      travelMode,
    };
  }

  // If user already has an origin locked and typed a specialist query (e.g. "gentle dentist open late")
  if (hasExistingOrigin && containsSpecialist) {
    const cleaned = message
      .replace(
        /^(?:find(?:\s+me)?|search(?:\s+for)?|show(?:\s+me)?|looking for|i need|need)\s+/i,
        ''
      )
      .replace(/^(?:a|an|the)\s+/i, '')
      .trim();
    return {
      action: 'search',
      specialistQuery: cleaned || message,
      locationText: null,
      travelMode,
    };
  }

  return null;
}
