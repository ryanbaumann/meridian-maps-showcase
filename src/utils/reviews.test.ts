import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeStarRatingDistribution,
  selectTopReviews,
  truncateReviewSnippet,
} from './reviews.ts';
import type { PlaceReview } from '../types.ts';

test('computeStarRatingDistribution returns null when there are no ratings or reviews', () => {
  assert.equal(computeStarRatingDistribution(null, 0, []), null);
  assert.equal(computeStarRatingDistribution(undefined, 0, undefined), null);
});

test('computeStarRatingDistribution returns exact distribution when all reviews are present', () => {
  const reviews: PlaceReview[] = [
    { authorName: 'Alice', rating: 5, text: 'Great dentist!' },
    { authorName: 'Bob', rating: 5, text: 'Very gentle and quick.' },
    { authorName: 'Cara', rating: 4, text: 'Clean office, short wait.' },
  ];
  const dist = computeStarRatingDistribution(4.7, 3, reviews);
  assert.ok(dist);
  assert.equal(dist.isEstimated, false);
  assert.equal(dist.sampleSize, 3);
  assert.equal(dist.buckets.find((b) => b.stars === 5)?.count, 2);
  assert.equal(dist.buckets.find((b) => b.stars === 4)?.count, 1);
  assert.equal(dist.buckets.find((b) => b.stars === 3)?.count, 0);
});

test('computeStarRatingDistribution estimates histogram matching aggregate mean and exact total count', () => {
  const reviews: PlaceReview[] = [
    { authorName: 'Pat', rating: 5, text: 'Wonderful staff and painless cleaning.' },
    { authorName: 'Sam', rating: 4, text: 'Friendly front desk, slightly busy.' },
  ];
  const dist = computeStarRatingDistribution(4.8, 500, reviews);
  assert.ok(dist);
  assert.equal(dist.isEstimated, true);
  assert.equal(dist.sampleSize, 2);

  const sumCount = dist.buckets.reduce((acc, b) => acc + b.count, 0);
  assert.equal(sumCount, 500);

  const weightedMean =
    dist.buckets.reduce((acc, b) => acc + b.stars * b.count, 0) / sumCount;
  assert.ok(Math.abs(weightedMean - 4.8) < 0.05, `expected ~4.8, got ${weightedMean}`);
  assert.ok((dist.buckets.find((b) => b.stars === 5)?.percentage ?? 0) >= 75);
  assert.ok((dist.buckets.find((b) => b.stars === 4)?.count ?? 0) >= 1);
});

test('computeStarRatingDistribution handles mid-range ratings smoothly', () => {
  const dist = computeStarRatingDistribution(3.5, 200, []);
  assert.ok(dist);
  const sumCount = dist.buckets.reduce((acc, b) => acc + b.count, 0);
  assert.equal(sumCount, 200);
  const weightedMean =
    dist.buckets.reduce((acc, b) => acc + b.stars * b.count, 0) / sumCount;
  assert.ok(Math.abs(weightedMean - 3.5) < 0.06, `expected ~3.5, got ${weightedMean}`);
});

test('selectTopReviews prioritizes substantive high-rated reviews and deduplicates', () => {
  const reviews: PlaceReview[] = [
    { authorName: 'A', rating: 5, text: 'Good.' },
    {
      authorName: 'B',
      rating: 5,
      text: 'Dr. Lee explained every step of my crown procedure clearly and made the whole visit completely stress-free.',
    },
    {
      authorName: 'B',
      rating: 5,
      text: 'Dr. Lee explained every step of my crown procedure clearly and made the whole visit completely stress-free.',
    },
    {
      authorName: 'C',
      rating: 4,
      text: 'Modern clinic with fast check-in and very thorough hygienists. Easy street parking right outside.',
    },
  ];

  const top = selectTopReviews(reviews, 2);
  assert.equal(top.length, 2);
  assert.equal(top[0].authorName, 'B');
  assert.equal(top[1].authorName, 'C');
});

test('truncateReviewSnippet truncates cleanly on word boundaries', () => {
  const longText =
    'This practice was super welcoming from the moment I walked in, with modern digital X-rays and zero wait time.';
  const short = truncateReviewSnippet(longText, 55);
  assert.ok(short.endsWith('…'));
  assert.ok(short.length <= 56);
  assert.equal(short.includes('momen…'), false);
});
