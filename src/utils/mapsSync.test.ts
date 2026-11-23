import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildA2uiPlaceSurfaceMessages,
  buildA2uiSpecialistsBatchMessages,
  buildGoogleMapsSyncUrl,
  isValidGooglePlaceId,
  MAPS_A2UI_CATALOG_ID,
} from './mapsSync.ts';
import type { OriginLocation, Specialist } from '../types.ts';

const SF_ORIGIN: OriginLocation = {
  label: 'San Francisco, CA',
  formattedAddress: 'San Francisco, CA, USA',
  lat: 37.7749,
  lng: -122.4194,
};

const PLACE_A: Specialist = {
  id: 'ChIJd8BlQ2BZwokRAFUEcm_qrcA',
  name: 'Bay Dental Studio',
  specialty: 'Dentist',
  address: '450 Sutter St, San Francisco, CA',
  location: { lat: 37.7896, lng: -122.4075 },
  rating: 4.9,
  userRatingCount: 240,
  openNow: true,
  googleMapsUri: 'https://maps.google.com/?cid=111',
  travelDurationSeconds: 540,
  distanceMeters: 2100,
  isRouteVerified: true,
};

const PLACE_B: Specialist = {
  id: 'ChIJIQBpAG2ahYAR_6128GcTUEo',
  name: 'Pacific Smiles Dental',
  specialty: 'Dentist',
  address: '2100 Webster St, San Francisco, CA',
  location: { lat: 37.7905, lng: -122.4321 },
  rating: 4.8,
  userRatingCount: 180,
  openNow: true,
  googleMapsUri: 'https://maps.google.com/?cid=222',
  travelDurationSeconds: 660,
  distanceMeters: 3100,
  isRouteVerified: true,
};

const PLACE_C: Specialist = {
  id: 'ChIJk35bizx-j4AREil6UPp7wy4',
  name: 'Mission Dental Care',
  specialty: 'Dentist',
  address: '2480 Mission St, San Francisco, CA',
  location: { lat: 37.7575, lng: -122.4188 },
  rating: 4.7,
  userRatingCount: 95,
  openNow: false,
  travelDurationSeconds: 720,
  distanceMeters: 2600,
  isRouteVerified: true,
};

describe('isValidGooglePlaceId', () => {
  it('accepts real Google Place IDs and rejects synthetic fallback IDs', () => {
    assert.equal(isValidGooglePlaceId(PLACE_A.id), true);
    assert.equal(isValidGooglePlaceId('place-0-37.7749'), false);
    assert.equal(isValidGooglePlaceId('sdk-place-2'), false);
    assert.equal(isValidGooglePlaceId(''), false);
    assert.equal(isValidGooglePlaceId(null), false);
  });
});

describe('buildGoogleMapsSyncUrl', () => {
  it('returns null when no specialists are selected', () => {
    assert.equal(buildGoogleMapsSyncUrl(SF_ORIGIN, [], 'DRIVE'), null);
  });

  it('builds a single-stop directions URL with destination_place_id when origin is set', () => {
    const urlStr = buildGoogleMapsSyncUrl(SF_ORIGIN, [PLACE_A], 'WALK');
    assert.ok(urlStr);
    const url = new URL(urlStr);
    assert.equal(url.origin + url.pathname, 'https://www.google.com/maps/dir/');
    assert.equal(url.searchParams.get('api'), '1');
    assert.equal(url.searchParams.get('travelmode'), 'walking');
    assert.equal(url.searchParams.get('destination_place_id'), PLACE_A.id);
    assert.ok(url.searchParams.get('origin')?.includes('37.774900'));
  });

  it('returns direct googleMapsUri for single selection when no origin is set', () => {
    const urlStr = buildGoogleMapsSyncUrl(null, [PLACE_A], 'DRIVE');
    assert.equal(urlStr, PLACE_A.googleMapsUri);
  });

  it('builds a multi-stop Google Maps directions URL with waypoints and waypoint_place_ids', () => {
    const urlStr = buildGoogleMapsSyncUrl(SF_ORIGIN, [PLACE_A, PLACE_B, PLACE_C], 'BICYCLE');
    assert.ok(urlStr);
    const url = new URL(urlStr);
    assert.equal(url.origin + url.pathname, 'https://www.google.com/maps/dir/');
    assert.equal(url.searchParams.get('travelmode'), 'bicycling');
    assert.equal(url.searchParams.get('destination_place_id'), PLACE_C.id);
    assert.equal(
      url.searchParams.get('waypoint_place_ids'),
      `${PLACE_A.id}|${PLACE_B.id}`
    );
    assert.ok(url.searchParams.get('waypoints')?.includes('Bay Dental Studio'));
    assert.ok(url.searchParams.get('waypoints')?.includes('Pacific Smiles Dental'));
  });

  it('handles multi-stop selection without an origin by using first stop as origin', () => {
    const urlStr = buildGoogleMapsSyncUrl(null, [PLACE_A, PLACE_B], 'DRIVE');
    assert.ok(urlStr);
    const url = new URL(urlStr);
    assert.equal(url.searchParams.get('origin_place_id'), PLACE_A.id);
    assert.equal(url.searchParams.get('destination_place_id'), PLACE_B.id);
    assert.equal(url.searchParams.get('waypoints'), null);
  });
});

describe('A2UI v0.9 surface message builders', () => {
  it('builds a valid createSurface + updateComponents pair for PlaceDetailsCompact', () => {
    const msgs = buildA2uiPlaceSurfaceMessages('place_surf_1', PLACE_A.id, 'horizontal');
    assert.equal(msgs.length, 2);
    assert.equal(msgs[0].version, 'v0.9');
    assert.equal(msgs[0].createSurface?.surfaceId, 'place_surf_1');
    assert.equal(msgs[0].createSurface?.catalogId, MAPS_A2UI_CATALOG_ID);
    assert.equal(msgs[1].updateComponents?.components[0].id, 'root');
    assert.equal(msgs[1].updateComponents?.components[0].component, 'PlaceDetailsCompact');
    assert.equal(msgs[1].updateComponents?.components[0].placeId, PLACE_A.id);
  });

  it('builds a batch surface filtering out non-Google fallback IDs', () => {
    const synthetic: Specialist = { ...PLACE_B, id: 'place-1-37.7905' };
    const msgs = buildA2uiSpecialistsBatchMessages('batch_1', [PLACE_A, synthetic, PLACE_C]);
    assert.equal(msgs.length, 2);
    const comps = msgs[1].updateComponents?.components ?? [];
    // root Column + 2 valid places
    assert.equal(comps.length, 3);
    assert.deepEqual(comps[0].children, ['place_1', 'place_2']);
  });
});
