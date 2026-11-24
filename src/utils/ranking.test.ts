import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBayesianRating,
  computeCompositeScore,
  computeScoreBreakdown,
  estimateTravelSeconds,
  formatDistance,
  formatTravelTime,
  haversineMeters,
  parseDurationSeconds,
  parseFastUserMessage,
  rankSpecialists,
} from './ranking.ts';
import type { Specialist } from '../types.ts';

const makeSpecialist = (overrides: Partial<Specialist>): Specialist => ({
  id: 'place-1',
  name: 'Test Clinic',
  specialty: 'Dentist',
  address: '123 Main St',
  location: { lat: 37.7749, lng: -122.4194 },
  rating: 4.8,
  userRatingCount: 200,
  openNow: true,
  travelDurationSeconds: 600,
  distanceMeters: 3200,
  isRouteVerified: true,
  ...overrides,
});

test('parseDurationSeconds handles Google Routes duration strings and numbers', () => {
  assert.equal(parseDurationSeconds('597s'), 597);
  assert.equal(parseDurationSeconds('120.6s'), 121);
  assert.equal(parseDurationSeconds(420), 420);
  assert.equal(parseDurationSeconds(null), null);
  assert.equal(parseDurationSeconds('invalid'), null);
});

test('formatTravelTime and formatDistance format values cleanly', () => {
  assert.equal(formatTravelTime(45), '1 min');
  assert.equal(formatTravelTime(597), '10 min');
  assert.equal(formatTravelTime(3600), '1 hr');
  assert.equal(formatTravelTime(4500), '1 hr 15 min');
  assert.equal(formatTravelTime(null), 'Time N/A');

  assert.equal(formatDistance(1609.344), '1.0 mi');
  assert.equal(formatDistance(50), '<0.1 mi');
  assert.equal(formatDistance(20000), '12 mi');
  assert.equal(formatDistance(2500, 'km'), '2.5 km');
});

test('computeBayesianRating dampens low-review-count perfection relative to established practices', () => {
  const twoReviews = computeBayesianRating(5.0, 2);
  const established = computeBayesianRating(4.9, 400);
  assert.ok(established > twoReviews, `Expected established (${established}) > twoReviews (${twoReviews})`);
});

test('rankSpecialists reorders deterministically across balanced, fastest, and rating modes', () => {
  const farPerfect = makeSpecialist({
    id: 'far-perfect',
    name: 'Elite Dental Studio',
    rating: 5.0,
    userRatingCount: 500,
    travelDurationSeconds: 2100, // 35 min
  });
  const closeGreat = makeSpecialist({
    id: 'close-great',
    name: 'Neighborhood Smile',
    rating: 4.8,
    userRatingCount: 320,
    travelDurationSeconds: 300, // 5 min
  });
  const closestMediocre = makeSpecialist({
    id: 'closest-mediocre',
    name: 'Corner Quick Dental',
    rating: 3.4,
    userRatingCount: 150,
    travelDurationSeconds: 180, // 3 min
  });

  const input = [farPerfect, closestMediocre, closeGreat];

  const balanced = rankSpecialists(input, 'balanced');
  assert.equal(balanced[0].id, 'close-great');
  assert.ok((balanced[0].compositeScore ?? 0) > (balanced[2].compositeScore ?? 0));

  const fastest = rankSpecialists(input, 'fastest');
  assert.deepEqual(
    fastest.map((s) => s.id),
    ['closest-mediocre', 'close-great', 'far-perfect']
  );

  const byRating = rankSpecialists(input, 'rating');
  assert.deepEqual(
    byRating.map((s) => s.id),
    ['far-perfect', 'close-great', 'closest-mediocre']
  );
});

test('haversineMeters and estimateTravelSeconds return sane values', () => {
  const dist = haversineMeters({ lat: 37.7749, lng: -122.4194 }, { lat: 37.7849, lng: -122.4094 });
  assert.ok(dist > 1300 && dist < 1500, `Unexpected distance: ${dist}`);
  const driveSec = estimateTravelSeconds(dist, 'DRIVE');
  const walkSec = estimateTravelSeconds(dist, 'WALK');
  assert.ok(walkSec > driveSec * 4);
});

test('parseFastUserMessage detects location-only messages vs specialist searches', () => {
  const loc1 = parseFastUserMessage("I'm in Austin, TX", false);
  assert.deepEqual(loc1, {
    action: 'set_location_only',
    specialistQuery: null,
    locationText: 'Austin, TX',
    travelMode: undefined,
  });

  const loc2 = parseFastUserMessage('94107', false);
  assert.equal(loc2?.action, 'set_location_only');
  assert.equal(loc2?.locationText, '94107');

  const loc3 = parseFastUserMessage('1600 Amphitheatre Parkway, Mountain View, CA', false);
  assert.equal(loc3?.action, 'set_location_only');

  const searchWithLoc = parseFastUserMessage('Find a pediatric dentist near Mission District, SF', false);
  assert.equal(searchWithLoc?.action, 'search');
  assert.equal(searchWithLoc?.specialistQuery, 'pediatric dentist');
  assert.equal(searchWithLoc?.locationText, 'Mission District, SF');

  const searchNearMe = parseFastUserMessage('dermatologist near me walking', true);
  assert.equal(searchNearMe?.action, 'search');
  assert.equal(searchNearMe?.specialistQuery, 'dermatologist');
  assert.equal(searchNearMe?.locationText, null);
  assert.equal(searchNearMe?.travelMode, 'WALK');

  const followUp = parseFastUserMessage('gentle dentist open late', true);
  assert.equal(followUp?.action, 'search');
  assert.equal(followUp?.specialistQuery, 'gentle dentist open late');
});

test('computeCompositeScore returns bounded 0-100 integers', () => {
  const s = makeSpecialist({ rating: 4.9, userRatingCount: 400, travelDurationSeconds: 240 });
  const score = computeCompositeScore(s, 1800);
  assert.ok(score >= 0 && score <= 100);
  assert.equal(Number.isInteger(score), true);
});

test('computeScoreBreakdown explicitly weights Google rating, travel time, and distance', () => {
  const closer = makeSpecialist({
    id: 'closer',
    rating: 4.8,
    userRatingCount: 250,
    travelDurationSeconds: 480,
    distanceMeters: 1200,
  });
  const farther = makeSpecialist({
    id: 'farther',
    rating: 4.8,
    userRatingCount: 250,
    travelDurationSeconds: 480,
    distanceMeters: 7800,
  });

  const closerBreakdown = computeScoreBreakdown(closer, 1200, 8000);
  const fartherBreakdown = computeScoreBreakdown(farther, 1200, 8000);

  assert.equal(closerBreakdown.ratingScore, fartherBreakdown.ratingScore);
  assert.equal(closerBreakdown.travelTimeScore, fartherBreakdown.travelTimeScore);
  assert.ok(closerBreakdown.distanceScore > fartherBreakdown.distanceScore);
  assert.ok(closerBreakdown.overall > fartherBreakdown.overall);
});
