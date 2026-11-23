import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContextualFollowUps,
  buildDeterministicAgentReply,
  detectConversationalAction,
  findReferencedSpecialists,
  getTodayHoursSummary,
  isStandaloneOpenEndedQuestion,
} from './agentLogic.ts';
import type { OriginLocation, Specialist } from '../types.ts';

const ORIGIN: OriginLocation = {
  label: 'San Francisco, CA',
  formattedAddress: 'San Francisco, CA, USA',
  lat: 37.7749,
  lng: -122.4194,
};

const SPECIALISTS: Specialist[] = [
  {
    id: 'ChIJ5-kuSyd-j4ARnl1Y0ECYXco',
    name: 'SOMA Dental',
    specialty: 'Dentist',
    address: '148 South Van Ness Ave, San Francisco, CA',
    location: { lat: 37.7714, lng: -122.4183 },
    rating: 4.9,
    userRatingCount: 55,
    openNow: false,
    weekdayDescriptions: [
      'Monday: 8:00 AM – 5:00 PM',
      'Tuesday: 8:00 AM – 5:00 PM',
      'Wednesday: 8:00 AM – 5:00 PM',
      'Thursday: 8:00 AM – 5:00 PM',
      'Friday: 8:00 AM – 3:00 PM',
      'Saturday: Closed',
      'Sunday: Closed',
    ],
    reviews: [
      {
        authorName: 'Alex M.',
        rating: 5,
        text: 'Super gentle hygienist and zero wait time.',
      },
    ],
    travelDurationSeconds: 120,
    distanceMeters: 420,
    isRouteVerified: true,
  },
  {
    id: 'ChIJ5yOqqq2BhYAR5diy9BAn6_0',
    name: 'Folsom Street Dental',
    specialty: 'Dentist',
    address: '1130 Folsom St, San Francisco, CA',
    location: { lat: 37.7764, lng: -122.4087 },
    rating: 4.9,
    userRatingCount: 1092,
    openNow: true,
    weekdayDescriptions: [
      'Monday: 7:30 AM – 6:00 PM',
      'Tuesday: 7:30 AM – 6:00 PM',
      'Wednesday: 7:30 AM – 6:00 PM',
      'Thursday: 7:30 AM – 6:00 PM',
      'Friday: 7:30 AM – 5:00 PM',
      'Saturday: 9:00 AM – 2:00 PM',
      'Sunday: Closed',
    ],
    travelDurationSeconds: 300,
    distanceMeters: 1280,
    isRouteVerified: true,
  },
  {
    id: 'ChIJ_dentist_group_sf_999',
    name: 'The Dentist Group',
    specialty: 'Dental Clinic',
    address: '90 Gough St, San Francisco, CA',
    location: { lat: 37.7731, lng: -122.4222 },
    rating: 4.7,
    userRatingCount: 262,
    openNow: true,
    travelDurationSeconds: 180,
    distanceMeters: 480,
    isRouteVerified: true,
  },
];

describe('findReferencedSpecialists', () => {
  it('matches clinics by name or rank ordinal', () => {
    const byName = findReferencedSpecialists('Tell me about Folsom Street Dental', SPECIALISTS);
    assert.equal(byName.length, 1);
    assert.equal(byName[0].id, SPECIALISTS[1].id);

    const byRank = findReferencedSpecialists('Compare #1 and #3', SPECIALISTS);
    assert.deepEqual(
      byRank.map((s) => s.id),
      [SPECIALISTS[0].id, SPECIALISTS[2].id]
    );
  });
});

describe('detectConversationalAction', () => {
  it('detects comparison requests and resolves top N or named targets', () => {
    const top2 = detectConversationalAction('Compare the top 2 options', SPECIALISTS, 'DRIVE');
    assert.equal(top2?.kind, 'compare');
    assert.deepEqual(top2?.targetIds, [SPECIALISTS[0].id, SPECIALISTS[1].id]);

    const named = detectConversationalAction('Compare #1 and #3 side by side', SPECIALISTS, 'DRIVE');
    assert.equal(named?.kind, 'compare');
    assert.deepEqual(named?.targetIds, [SPECIALISTS[0].id, SPECIALISTS[2].id]);
  });

  it('detects open-now filtering, travel mode switching, sorting, and shortlist selection', () => {
    const openNow = detectConversationalAction('Which of these are open right now?', SPECIALISTS, 'DRIVE');
    assert.equal(openNow?.kind, 'filter_open');
    assert.deepEqual(openNow?.targetIds, [SPECIALISTS[1].id, SPECIALISTS[2].id]);

    const walk = detectConversationalAction('Switch to walking travel times', SPECIALISTS, 'DRIVE');
    assert.equal(walk?.kind, 'mode_change');
    assert.equal(walk?.travelMode, 'WALK');

    const fastest = detectConversationalAction('Show me the fastest option', SPECIALISTS, 'DRIVE');
    assert.equal(fastest?.kind, 'sort_change');
    assert.equal(fastest?.sortMode, 'fastest');

    const shortlist = detectConversationalAction(
      'Select the top 2 options to sync to Google Maps',
      SPECIALISTS,
      'DRIVE'
    );
    assert.equal(shortlist?.kind, 'sync_select');
    assert.deepEqual(shortlist?.targetIds, [SPECIALISTS[0].id, SPECIALISTS[1].id]);
  });

  it('returns null when the user requests a new specialty or new location', () => {
    assert.equal(
      detectConversationalAction('Now find a dermatologist near Austin, TX', SPECIALISTS, 'DRIVE'),
      null
    );
    assert.equal(
      detectConversationalAction('Actually I need a cardiologist', SPECIALISTS, 'DRIVE'),
      null
    );
  });

  it('detects single-provider Q&A spotlight', () => {
    const qa = detectConversationalAction(
      'What are the reviews and hours for SOMA Dental?',
      SPECIALISTS,
      'DRIVE'
    );
    assert.equal(qa?.kind, 'provider_qa');
    assert.equal(qa?.focusId, SPECIALISTS[0].id);
  });
});

describe('getTodayHoursSummary & buildContextualFollowUps', () => {
  it('extracts today hours cleanly for a given day of week', () => {
    // 2026-11-23 is a Monday
    const monday = new Date('2026-11-23T12:00:00Z');
    const summary = getTodayHoursSummary(SPECIALISTS[0].weekdayDescriptions, monday);
    assert.equal(summary, '8:00 AM – 5:00 PM');
  });

  it('generates contextual follow-up prompts excluding the action just taken', () => {
    const afterSearch = buildContextualFollowUps({
      origin: ORIGIN,
      specialists: SPECIALISTS,
      travelMode: 'DRIVE',
      actionJustTaken: 'search',
      syncedCount: 0,
    });
    assert.ok(afterSearch.some((p) => p.label.toLowerCase().includes('compare')));
    assert.ok(afterSearch.some((p) => p.label.toLowerCase().includes('open')));

    const afterCompare = buildContextualFollowUps({
      origin: ORIGIN,
      specialists: SPECIALISTS,
      travelMode: 'DRIVE',
      actionJustTaken: 'compare',
      syncedCount: 2,
    });
    assert.ok(!afterCompare.some((p) => p.label.toLowerCase().includes('compare')));
  });

  it('builds factual deterministic replies with ratings and travel times', () => {
    const reply = buildDeterministicAgentReply({
      action: 'provider_qa',
      specialists: SPECIALISTS,
      origin: ORIGIN,
      travelMode: 'DRIVE',
      focused: SPECIALISTS[0],
    });
    assert.ok(reply.includes('SOMA Dental'));
    assert.ok(reply.includes('4.9★'));
    assert.ok(reply.includes('Super gentle hygienist'));
  });

  it('detects standalone and follow-up open-ended questions without hijacking searches', () => {
    assert.equal(
      isStandaloneOpenEndedQuestion('Should I see an optometrist or an ophthalmologist for blurry vision?'),
      true
    );
    assert.equal(
      isStandaloneOpenEndedQuestion('What should I ask a dentist before my first visit?'),
      true
    );
    assert.equal(
      isStandaloneOpenEndedQuestion('Find a top-rated dentist near San Francisco, CA'),
      false
    );

    const followUp = detectConversationalAction(
      'What should I bring to my first visit?',
      SPECIALISTS,
      'DRIVE'
    );
    assert.equal(followUp?.kind, 'general_qa');
  });
});
