import type { PlaceReview, RatingDistribution, StarRatingBucket } from '../types';

const STAR_LEVELS: ReadonlyArray<5 | 4 | 3 | 2 | 1> = [5, 4, 3, 2, 1];

/**
 * Truncates a review quote cleanly on a word boundary so snippets stay scannable.
 */
export function truncateReviewSnippet(text: string, maxChars = 190): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= maxChars) return cleaned;
  const slice = cleaned.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  const cutoff = lastSpace > Math.floor(maxChars * 0.65) ? lastSpace : maxChars;
  return `${slice.slice(0, cutoff).replace(/[,;:\-–—\s]+$/, '')}…`;
}

/**
 * Selects the highest-signal patient review snippets for the "Top reviews" display.
 * Prefers substantive, higher-rated reviews while preserving original Google relevance order on ties.
 */
export function selectTopReviews(
  reviews?: PlaceReview[] | null,
  maxCount = 2
): PlaceReview[] {
  if (!reviews || reviews.length === 0 || maxCount <= 0) return [];

  const seen = new Set<string>();
  const unique: Array<{ review: PlaceReview; index: number; score: number }> = [];

  reviews.forEach((rev, index) => {
    const cleanText = rev.text?.replace(/\s+/g, ' ').trim() ?? '';
    if (!cleanText) return;
    const dedupKey = `${(rev.authorName || '').toLowerCase()}|${cleanText.slice(0, 60).toLowerCase()}`;
    if (seen.has(dedupKey)) return;
    seen.add(dedupKey);

    const len = cleanText.length;
    const lengthBonus =
      len >= 50 && len <= 360 ? 2.0 : len > 360 ? 1.4 : len >= 20 ? 0.8 : 0.2;
    const ratingWeight = Number.isFinite(rev.rating) ? rev.rating * 1.15 : 4.0;
    const relevanceBonus = Math.max(0, 0.5 - index * 0.08);

    unique.push({
      review: { ...rev, text: cleanText },
      index,
      score: ratingWeight + lengthBonus + relevanceBonus,
    });
  });

  unique.sort((a, b) => b.score - a.score || a.index - b.index);
  return unique.slice(0, maxCount).map((entry) => entry.review);
}

/**
 * Computes a 5★ -> 1★ rating distribution for a specialist.
 *
 * Google Places API (New) returns the aggregate `rating`, `userRatingCount`, and up to 5
 * individual `reviews`. When all reviews are present (`reviews.length >= userRatingCount`),
 * exact tallies are returned (`isEstimated: false`). Otherwise, solves a maximum-entropy
 * distribution over {1..5} constrained to match the exact overall average rating and anchored
 * by any observed review ratings (`isEstimated: true`).
 */
export function computeStarRatingDistribution(
  rating: number | null | undefined,
  userRatingCount: number | null | undefined,
  reviews?: PlaceReview[] | null
): RatingDistribution | null {
  const validReviews = (reviews ?? []).filter(
    (r) => typeof r.rating === 'number' && r.rating >= 1 && r.rating <= 5
  );

  const observedCounts: Record<1 | 2 | 3 | 4 | 5, number> = {
    5: 0,
    4: 0,
    3: 0,
    2: 0,
    1: 0,
  };
  for (const rev of validReviews) {
    const star = Math.min(5, Math.max(1, Math.round(rev.rating))) as 1 | 2 | 3 | 4 | 5;
    observedCounts[star] += 1;
  }

  const totalCount =
    typeof userRatingCount === 'number' && userRatingCount > 0
      ? Math.round(userRatingCount)
      : validReviews.length;

  if (totalCount <= 0) return null;

  // Exact tally when we have every review for the place
  if (validReviews.length >= totalCount && validReviews.length > 0) {
    const exactTotal = validReviews.length;
    const buckets: StarRatingBucket[] = STAR_LEVELS.map((stars) => {
      const count = observedCounts[stars];
      return {
        stars,
        count,
        percentage: Math.round((count / exactTotal) * 100),
      };
    });
    return {
      buckets,
      isEstimated: false,
      sampleSize: validReviews.length,
    };
  }

  const clampedMean =
    typeof rating === 'number' && Number.isFinite(rating)
      ? Math.min(5, Math.max(1, rating))
      : validReviews.length > 0
        ? validReviews.reduce((sum, r) => sum + r.rating, 0) / validReviews.length
        : null;

  if (clampedMean == null) return null;

  // Remaining unobserved ratings to distribute so overall mean matches `clampedMean`
  const observedTotal = validReviews.length;
  const remaining = Math.max(0, totalCount - observedTotal);

  const finalCounts: Record<1 | 2 | 3 | 4 | 5, number> = { ...observedCounts };

  if (remaining > 0) {
    const observedSum =
      observedCounts[5] * 5 +
      observedCounts[4] * 4 +
      observedCounts[3] * 3 +
      observedCounts[2] * 2 +
      observedCounts[1] * 1;
    const targetRemainingMean = Math.min(
      5,
      Math.max(1, (clampedMean * totalCount - observedSum) / remaining)
    );

    const probs = solveMaxEntropyStarProbabilities(targetRemainingMean);
    const rawCounts = STAR_LEVELS.map((stars, idx) => ({
      stars,
      exact: probs[idx] * remaining,
      floor: Math.floor(probs[idx] * remaining),
    }));

    let assigned = rawCounts.reduce((sum, item) => sum + item.floor, 0);
    let leftover = remaining - assigned;

    // Largest-remainder allocation so integer counts sum cleanly to `remaining`
    const byRemainder = [...rawCounts].sort(
      (a, b) => b.exact - b.floor - (a.exact - a.floor)
    );
    for (let i = 0; i < byRemainder.length && leftover > 0; i++) {
      byRemainder[i].floor += 1;
      leftover -= 1;
      assigned += 1;
    }

    for (const item of rawCounts) {
      finalCounts[item.stars] += item.floor;
    }
  }

  const buckets: StarRatingBucket[] = STAR_LEVELS.map((stars) => {
    const count = finalCounts[stars];
    const pct = totalCount > 0 ? Math.round((count / totalCount) * 100) : 0;
    return {
      stars,
      count,
      percentage: pct,
    };
  });

  return {
    buckets,
    isEstimated: true,
    sampleSize: validReviews.length,
  };
}

/**
 * Solves maximum-entropy probabilities p_s proportional to exp(beta * s) for s in [5, 4, 3, 2, 1]
 * such that sum(s * p_s) === targetMean. Returns probabilities ordered [5★, 4★, 3★, 2★, 1★].
 */
function solveMaxEntropyStarProbabilities(targetMean: number): number[] {
  if (targetMean >= 4.995) return [1, 0, 0, 0, 0];
  if (targetMean <= 1.005) return [0, 0, 0, 0, 1];

  let lo = -12;
  let hi = 12;

  const expectedForBeta = (beta: number) => {
    const weights = STAR_LEVELS.map((s) => Math.exp(beta * (s - 3)));
    const z = weights.reduce((a, b) => a + b, 0);
    const probs = weights.map((w) => w / z);
    const mean = STAR_LEVELS.reduce((sum, s, i) => sum + s * probs[i], 0);
    return { probs, mean };
  };

  let result = expectedForBeta(0);
  for (let iter = 0; iter < 40; iter++) {
    const mid = (lo + hi) / 2;
    result = expectedForBeta(mid);
    if (Math.abs(result.mean - targetMean) < 1e-4) break;
    if (result.mean < targetMean) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  return result.probs;
}
