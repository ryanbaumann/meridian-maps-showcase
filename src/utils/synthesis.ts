import { SHOWCASE_CONFIG } from '../config/showcase.ts';
import type {
  RankedSynthesisResult,
  SortMode,
  Specialist,
  SynthesisPick,
  TravelMode,
} from '../types.ts';
import { getTodayHoursSummary } from './agentLogic.ts';
import {
  computeBayesianRating,
  computeScoreBreakdown,
  formatDistance,
  formatTravelTime,
} from './ranking.ts';

function pickReviewExcerpt(specialist: Specialist, maxLen = 96): string | undefined {
  const raw = (
    specialist.topReviews?.[0]?.text ||
    specialist.reviews?.[0]?.text ||
    specialist.editorialSummary ||
    ''
  )
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return undefined;
  return raw.length > maxLen ? `${raw.slice(0, maxLen - 1).trimEnd()}…` : raw;
}

function getModeVerb(mode: TravelMode): string {
  return mode === 'WALK' ? 'walk' : mode === 'BICYCLE' ? 'bike' : 'drive';
}

function capitalizeQuery(query: string | null | undefined): string {
  const clean = (query || SHOWCASE_CONFIG.agent.defaultCategory)
    .trim()
    .replace(/^(?:top[\s-]?rated|highest[\s-]?rated|best[\s-]?rated|top|best)\s+/i, '')
    .trim();
  if (!clean) return SHOWCASE_CONFIG.agent.defaultCategory;
  return `${clean.charAt(0).toUpperCase()}${clean.slice(1)}`;
}

/**
 * Builds a structured, data-grounded Top-3 weighted synthesis brief from live ranked places.
 * Every number (rating, review count, travel time, distance, weighted score, hours) comes
 * directly from live Google Maps Platform data.
 */
export function buildRankedSynthesis(opts: {
  specialists: Specialist[];
  specialistQuery?: string | null;
  originLabel?: string | null;
  sortMode: SortMode;
  travelMode: TravelMode;
  maxPicks?: number;
}): RankedSynthesisResult | undefined {
  const { specialists, specialistQuery, originLabel, sortMode, travelMode, maxPicks = 3 } = opts;
  if (!specialists || specialists.length === 0) return undefined;

  const top = specialists.slice(0, Math.max(1, maxPicks));
  const validDurations = specialists
    .map((s) => s.travelDurationSeconds)
    .filter((d): d is number => d != null && Number.isFinite(d));
  const maxDuration = validDurations.length > 0 ? Math.max(...validDurations) : 1800;

  const validDistances = specialists
    .map((s) => s.distanceMeters)
    .filter((d): d is number => d != null && Number.isFinite(d));
  const maxDistance = validDistances.length > 0 ? Math.max(...validDistances) : 8000;

  const fastestId = [...top].sort(
    (a, b) =>
      (a.travelDurationSeconds ?? Number.POSITIVE_INFINITY) -
      (b.travelDurationSeconds ?? Number.POSITIVE_INFINITY)
  )[0]?.id;

  const closestId = [...top].sort(
    (a, b) =>
      (a.distanceMeters ?? Number.POSITIVE_INFINITY) -
      (b.distanceMeters ?? Number.POSITIVE_INFINITY)
  )[0]?.id;

  const highestRatedId = [...top].sort(
    (a, b) =>
      computeBayesianRating(b.rating, b.userRatingCount) -
      computeBayesianRating(a.rating, a.userRatingCount)
  )[0]?.id;

  const verb = getModeVerb(travelMode);

  const picks: SynthesisPick[] = top.map((item, idx) => {
    const rank = idx + 1;
    const scoreBreakdown =
      item.scoreBreakdown ?? computeScoreBreakdown(item, maxDuration, maxDistance);

    let badge: string;
    if (rank === 1) {
      badge =
        sortMode === 'fastest'
          ? 'Fastest Pick'
          : sortMode === 'rating'
            ? 'Top Rated'
            : 'Best Overall';
    } else if (item.id === highestRatedId && rank <= 3) {
      badge = 'Highest Rated';
    } else if (item.id === fastestId && rank <= 3) {
      badge = 'Fastest Trip';
    } else if (item.id === closestId && rank <= 3) {
      badge = 'Closest Distance';
    } else if (item.openNow === true) {
      badge = 'Open Now';
    } else {
      badge = `Option #${rank}`;
    }

    const parts: string[] = [];
    if (item.rating != null) {
      parts.push(
        item.userRatingCount > 0
          ? `${item.rating.toFixed(1)}★ (${item.userRatingCount.toLocaleString()})`
          : `${item.rating.toFixed(1)}★`
      );
    }
    const timeText = formatTravelTime(item.travelDurationSeconds);
    const distText = formatDistance(item.distanceMeters);
    if (timeText !== 'Time N/A') {
      parts.push(distText ? `${timeText} ${verb} · ${distText}` : `${timeText} ${verb}`);
    } else if (distText) {
      parts.push(distText);
    }

    const todayHours = getTodayHoursSummary(item.weekdayDescriptions);
    if (item.openNow === true) {
      parts.push(todayHours ? `Open (${todayHours})` : 'Open now');
    } else if (item.openNow === false) {
      parts.push('Closed now');
    }

    return {
      specialistId: item.id,
      rank,
      badge,
      rationale: parts.join(' · '),
      reviewSnippet: pickReviewExcerpt(item),
      todayHours,
      scoreBreakdown,
    };
  });

  const { rating, travelTime, distance } = SHOWCASE_CONFIG.agent.rankingWeights;
  const label = capitalizeQuery(specialistQuery);
  const headline =
    top.length === 1
      ? `Top ${label} Match`
      : top.length <= 3
        ? `Top ${top.length} ${label} Picks`
        : `All ${top.length} ${label} Options`;

  return {
    headline,
    weights: {
      ratingPct: Math.round(rating * 100),
      travelTimePct: Math.round(travelTime * 100),
      distancePct: Math.round(distance * 100),
    },
    sortMode,
    travelMode,
    originLabel: originLabel ?? null,
    picks,
  };
}
