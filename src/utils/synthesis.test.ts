import test from 'node:test';
import assert from 'node:assert/strict';
import type { Specialist } from '../types.ts';
import { rankSpecialists } from './ranking.ts';
import { buildRankedSynthesis } from './synthesis.ts';

const makeSpecialist = (overrides: Partial<Specialist>): Specialist => ({
  id: 'place-1',
  name: 'Bay Dental Studio',
  specialty: 'Dentist',
  address: '100 Market St, San Francisco, CA',
  location: { lat: 37.7936, lng: -122.3958 },
  rating: 4.8,
  userRatingCount: 240,
  openNow: true,
  travelDurationSeconds: 420,
  distanceMeters: 2200,
  isRouteVerified: true,
  ...overrides,
});

test('buildRankedSynthesis synthesizes top 3 picks with explicit weights, badges, and score breakdowns', () => {
  const candidates = rankSpecialists(
    [
      makeSpecialist({
        id: 'balanced-winner',
        name: 'Union Square Dental',
        rating: 4.9,
        userRatingCount: 380,
        travelDurationSeconds: 360,
        distanceMeters: 1600,
        weekdayDescriptions: ['Monday: 8:00 AM – 6:00 PM'],
        topReviews: [
          {
            authorName: 'Alex',
            rating: 5,
            text: 'Gentle cleaning and transparent pricing.',
          },
        ],
      }),
      makeSpecialist({
        id: 'fastest-close',
        name: 'Mission Quick Dental',
        rating: 4.5,
        userRatingCount: 150,
        travelDurationSeconds: 180,
        distanceMeters: 700,
      }),
      makeSpecialist({
        id: 'highest-rated-far',
        name: 'Pacific Heights Smiles',
        rating: 5.0,
        userRatingCount: 520,
        travelDurationSeconds: 1320,
        distanceMeters: 6400,
      }),
      makeSpecialist({
        id: 'fourth-option',
        name: 'Sunset Dental',
        rating: 4.4,
        userRatingCount: 80,
        travelDurationSeconds: 1500,
        distanceMeters: 7500,
      }),
    ],
    'balanced'
  );

  const synthesis = buildRankedSynthesis({
    specialists: candidates,
    specialistQuery: 'dentist',
    originLabel: 'San Francisco, CA',
    sortMode: 'balanced',
    travelMode: 'DRIVE',
  });

  assert.ok(synthesis);
  assert.equal(synthesis.picks.length, 3);
  assert.equal(
    synthesis.weights.ratingPct + synthesis.weights.travelTimePct + synthesis.weights.distancePct,
    100
  );
  assert.equal(synthesis.picks[0].rank, 1);
  assert.equal(synthesis.picks[0].specialistId, 'balanced-winner');
  assert.equal(synthesis.picks[0].badge, 'Best Overall');
  assert.ok(synthesis.picks[0].reviewSnippet?.includes('Gentle cleaning'));
  assert.ok(synthesis.picks[0].scoreBreakdown.overall > synthesis.picks[2].scoreBreakdown.overall);
});

test('buildRankedSynthesis returns undefined for empty specialist lists', () => {
  const result = buildRankedSynthesis({
    specialists: [],
    specialistQuery: 'dentist',
    sortMode: 'balanced',
    travelMode: 'DRIVE',
  });
  assert.equal(result, undefined);
});
