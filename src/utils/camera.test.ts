import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  compute3DCameraTarget,
  compute3DOrbitCamera,
  computeBearing,
  computePointsEnvelope,
  computeVectorCameraTarget,
  easeOutCubic,
  interpolateAngle,
  normalizeAngle,
  offsetCenterForInsets,
  zoomForSpanMeters,
} from './camera.ts';

const SF_ORIGIN = { lat: 37.7749, lng: -122.4194 };
const SF_NORTH = { lat: 37.7849, lng: -122.4194 };
const SF_EAST = { lat: 37.7749, lng: -122.4094 };
const SF_SOUTH = { lat: 37.7649, lng: -122.4194 };

const DESKTOP_FRAMING = {
  widthPx: 1440,
  heightPx: 900,
  leftInsetPx: 444,
  bottomInsetPx: 64,
  topInsetPx: 68,
};

const MOBILE_PEEK_FRAMING = {
  widthPx: 390,
  heightPx: 844,
  leftInsetPx: 0,
  bottomInsetPx: 144,
  topInsetPx: 68,
};

describe('angle and easing math', () => {
  it('normalizes negative and overflow angles into [0, 360)', () => {
    assert.equal(normalizeAngle(0), 0);
    assert.equal(normalizeAngle(-90), 270);
    assert.equal(normalizeAngle(450), 90);
    assert.equal(normalizeAngle(360), 0);
  });

  it('interpolates compass headings across the 359/0 seam along the shortest arc', () => {
    assert.equal(interpolateAngle(350, 10, 0.5), 0);
    assert.equal(interpolateAngle(10, 350, 0.5), 0);
    assert.equal(interpolateAngle(0, 90, 0.5), 45);
  });

  it('applies bounded cubic ease-out', () => {
    assert.equal(easeOutCubic(0), 0);
    assert.equal(easeOutCubic(1), 1);
    assert.equal(easeOutCubic(-0.5), 0);
    assert.equal(easeOutCubic(1.5), 1);
    assert.ok(easeOutCubic(0.5) > 0.85 && easeOutCubic(0.5) < 0.9);
  });

  it('computes cardinal compass bearings accurately', () => {
    const north = computeBearing(SF_ORIGIN, SF_NORTH);
    const east = computeBearing(SF_ORIGIN, SF_EAST);
    const south = computeBearing(SF_ORIGIN, SF_SOUTH);

    assert.ok(north < 1 || north > 359, `expected ~0°, got ${north}`);
    assert.ok(Math.abs(east - 90) < 1, `expected ~90°, got ${east}`);
    assert.ok(Math.abs(south - 180) < 1, `expected ~180°, got ${south}`);
  });
});

describe('viewport framing and rotated offset calculations', () => {
  it('computes midpoint and non-zero span for multiple points', () => {
    const env = computePointsEnvelope([SF_ORIGIN, SF_NORTH, SF_EAST]);
    assert.ok(env.spanMeters > 1200 && env.spanMeters < 1800);
    assert.ok(env.center.lat > SF_ORIGIN.lat && env.center.lat < SF_NORTH.lat);
    assert.ok(env.center.lng > SF_ORIGIN.lng && env.center.lng < SF_EAST.lng);
  });

  it('shifts center west when north-up and east when heading south so subject clears left rail', () => {
    const northUp = offsetCenterForInsets(SF_ORIGIN, 14, DESKTOP_FRAMING, 0);
    assert.ok(northUp.lng < SF_ORIGIN.lng, 'expected westward shift when heading 0°');

    const southUp = offsetCenterForInsets(SF_ORIGIN, 14, DESKTOP_FRAMING, 180);
    assert.ok(southUp.lng > SF_ORIGIN.lng, 'expected eastward shift when heading 180°');

    const eastUp = offsetCenterForInsets(SF_ORIGIN, 14, DESKTOP_FRAMING, 90);
    assert.ok(eastUp.lat > SF_ORIGIN.lat, 'expected northward shift when heading 90°');
  });

  it('shifts center south when a mobile bottom sheet is open (heading 0°)', () => {
    const shifted = offsetCenterForInsets(SF_ORIGIN, 14, MOBILE_PEEK_FRAMING, 0);
    assert.equal(shifted.lng, SF_ORIGIN.lng);
    assert.ok(shifted.lat < SF_ORIGIN.lat, 'expected southward latitude shift');
  });

  it('clamps zoom levels cleanly for tight and wide spans', () => {
    assert.equal(zoomForSpanMeters(50, SF_ORIGIN.lat, 800), 16.8);
    assert.equal(zoomForSpanMeters(100_000, SF_ORIGIN.lat, 800), 11);
  });
});

describe('Vector and 3D camera target builders', () => {
  it('applies 3D building tilt and route-aligned heading on focused Vector camera', () => {
    const cam = computeVectorCameraTarget({
      origin: SF_ORIGIN,
      points: [SF_EAST],
      focused: SF_EAST,
      tilted: true,
      framing: DESKTOP_FRAMING,
      fallbackCenter: SF_ORIGIN,
    });
    assert.equal(cam.tilt, 47.5);
    assert.ok(Math.abs(cam.heading - 90) <= 2, `expected heading ~90°, got ${cam.heading}`);
    assert.ok(cam.zoom >= 13 && cam.zoom <= 16.8);
  });

  it('resets tilt and heading to 0 on top-down or overview Vector camera', () => {
    const overview = computeVectorCameraTarget({
      origin: SF_ORIGIN,
      points: [SF_NORTH, SF_EAST, SF_SOUTH],
      focused: null,
      tilted: true,
      framing: DESKTOP_FRAMING,
      fallbackCenter: SF_ORIGIN,
    });
    assert.equal(overview.tilt, 0);
    assert.equal(overview.heading, 0);

    const flatFocus = computeVectorCameraTarget({
      origin: SF_ORIGIN,
      points: [SF_EAST],
      focused: SF_EAST,
      tilted: false,
      framing: DESKTOP_FRAMING,
      fallbackCenter: SF_ORIGIN,
    });
    assert.equal(flatFocus.tilt, 0);
    assert.equal(flatFocus.heading, 0);
  });

  it('builds corridor, street, overview, and orbit 3D cameras', () => {
    const corridor = compute3DCameraTarget({
      origin: SF_ORIGIN,
      points: [SF_EAST],
      focused: SF_EAST,
      framing: DESKTOP_FRAMING,
      fallbackCenter: SF_ORIGIN,
      view: 'corridor',
    });
    assert.equal(corridor.tilt, 62);
    assert.ok(Math.abs(corridor.heading - 90) <= 2);
    assert.ok(corridor.range >= 950 && corridor.range <= 7200);

    const street = compute3DCameraTarget({
      origin: SF_ORIGIN,
      points: [SF_EAST],
      focused: SF_EAST,
      framing: DESKTOP_FRAMING,
      fallbackCenter: SF_ORIGIN,
      view: 'street',
    });
    assert.equal(street.tilt, 74);
    assert.equal(street.range, 340);
    assert.ok(Math.abs(street.heading - 90) <= 2);

    const overview = compute3DCameraTarget({
      origin: SF_ORIGIN,
      points: [SF_NORTH, SF_EAST, SF_SOUTH],
      focused: SF_EAST,
      framing: DESKTOP_FRAMING,
      fallbackCenter: SF_ORIGIN,
      view: 'overview',
    });
    assert.equal(overview.tilt, 38);
    assert.ok(overview.range >= 1800 && overview.range <= 10500);

    const orbit = compute3DOrbitCamera(SF_EAST, SF_ORIGIN);
    assert.equal(orbit.center.lat, SF_EAST.lat);
    assert.equal(orbit.center.lng, SF_EAST.lng);
    assert.equal(orbit.center.altitude, 0);
    assert.equal(orbit.range, 420);
    assert.equal(orbit.tilt, 65);
    assert.ok(Math.abs(orbit.heading - 90) <= 2);
  });
});
