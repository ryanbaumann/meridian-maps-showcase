import type { Camera3DView, LatLng } from '../types.ts';
import { haversineMeters } from './ranking.ts';

export interface VectorCameraState {
  center: LatLng;
  zoom: number;
  tilt: number;
  heading: number;
}

export interface Camera3DState {
  center: { lat: number; lng: number; altitude: number };
  range: number;
  tilt: number;
  heading: number;
}

export interface ViewportFraming {
  widthPx: number;
  heightPx: number;
  /** Left pixels covered by floating desktop rail */
  leftInsetPx: number;
  /** Bottom pixels covered by mobile sheet or route bar */
  bottomInsetPx: number;
  /** Top pixels covered by floating map toolbar */
  topInsetPx: number;
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const EARTH_CIRCUMFERENCE_METERS = 40_075_016.686;

/**
 * Clamps a numeric value into [min, max].
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Wraps an angle in degrees cleanly into [0, 360).
 */
export function normalizeAngle(deg: number): number {
  const mod = deg % 360;
  return mod < 0 ? mod + 360 : mod;
}

/**
 * Cubic ease-out curve for natural camera glides.
 */
export function easeOutCubic(t: number): number {
  const clamped = clamp(t, 0, 1);
  return 1 - Math.pow(1 - clamped, 3);
}

/**
 * Interpolates between two compass headings along the shortest angular arc.
 */
export function interpolateAngle(fromDeg: number, toDeg: number, t: number): number {
  const start = normalizeAngle(fromDeg);
  const end = normalizeAngle(toDeg);
  let delta = end - start;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return normalizeAngle(start + delta * clamp(t, 0, 1));
}

/**
 * Computes the forward compass bearing in degrees [0, 360) from `origin` toward `target`.
 */
export function computeBearing(origin: LatLng, target: LatLng): number {
  const lat1 = origin.lat * DEG_TO_RAD;
  const lat2 = target.lat * DEG_TO_RAD;
  const dLng = (target.lng - origin.lng) * DEG_TO_RAD;

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  if (Math.abs(x) < 1e-12 && Math.abs(y) < 1e-12) {
    return 0;
  }
  return normalizeAngle(Math.atan2(y, x) * RAD_TO_DEG);
}

/**
 * Computes the bounding midpoint and corner-to-corner span in meters.
 */
export function computePointsEnvelope(points: LatLng[]): {
  center: LatLng;
  spanMeters: number;
  latSpan: number;
  lngSpan: number;
} {
  if (points.length === 0) {
    return {
      center: { lat: 37.7749, lng: -122.4194 },
      spanMeters: 2500,
      latSpan: 0.02,
      lngSpan: 0.02,
    };
  }

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  const center = {
    lat: (minLat + maxLat) / 2,
    lng: (minLng + maxLng) / 2,
  };
  const spanMeters =
    points.length === 1
      ? 600
      : haversineMeters({ lat: minLat, lng: minLng }, { lat: maxLat, lng: maxLng });

  return {
    center,
    spanMeters,
    latSpan: Math.max(maxLat - minLat, 0.002),
    lngSpan: Math.max(maxLng - minLng, 0.002),
  };
}

/**
 * Converts a ground span and available pixel size into a Web Mercator fractional zoom level.
 */
export function zoomForSpanMeters(
  spanMeters: number,
  latDeg: number,
  availablePx: number,
  minZoom = 11,
  maxZoom = 16.8
): number {
  const safePx = Math.max(availablePx, 180);
  const safeSpan = Math.max(spanMeters, 220);
  const cosLat = Math.max(Math.cos(latDeg * DEG_TO_RAD), 0.2);
  const metersPerPixel = (safeSpan * 1.45) / safePx;
  const rawZoom = Math.log2((EARTH_CIRCUMFERENCE_METERS * cosLat) / (256 * metersPerPixel));
  return clamp(Number(rawZoom.toFixed(2)), minZoom, maxZoom);
}

/**
 * Projects a screen-space meter shift (left to clear desktop rail, down to clear bottom sheet)
 * through the camera compass `heading` into geographic `(lat, lng)` coordinates.
 */
function applyRotatedScreenShift(
  center: LatLng,
  shiftLeftMeters: number,
  shiftDownMeters: number,
  headingDeg: number
): LatLng {
  const h = normalizeAngle(headingDeg) * DEG_TO_RAD;
  // Screen-right in (East, North) is (cos h, -sin h); screen-up is (sin h, cos h).
  // Moving center toward screen-left (-right) and screen-down (-up) pushes subjects right & up.
  const dEastMeters = -shiftLeftMeters * Math.cos(h) - shiftDownMeters * Math.sin(h);
  const dNorthMeters = shiftLeftMeters * Math.sin(h) - shiftDownMeters * Math.cos(h);

  const cosLat = Math.max(Math.cos(center.lat * DEG_TO_RAD), 0.2);
  const dLng = dEastMeters / (111_320 * cosLat);
  const dLat = dNorthMeters / 110_540;

  return {
    lat: clamp(center.lat + dLat, -84, 84),
    lng: center.lng + dLng,
  };
}

/**
 * Shifts a geographic center so markers render centered inside the unobstructed map area
 * regardless of camera rotation (`headingDeg`).
 */
export function offsetCenterForInsets(
  center: LatLng,
  zoom: number,
  framing: ViewportFraming,
  headingDeg = 0
): LatLng {
  const cosLat = Math.max(Math.cos(center.lat * DEG_TO_RAD), 0.2);
  const metersPerPx =
    (EARTH_CIRCUMFERENCE_METERS * cosLat) / (256 * Math.pow(2, zoom));

  const shiftLeftMeters = framing.leftInsetPx * 0.48 * metersPerPx;
  const shiftDownMeters = (framing.bottomInsetPx - framing.topInsetPx) * 0.42 * metersPerPx;

  return applyRotatedScreenShift(center, shiftLeftMeters, shiftDownMeters, headingDeg);
}

/**
 * Computes the ideal Vector Map camera (`center`, `zoom`, `tilt`, `heading`).
 */
export function computeVectorCameraTarget(opts: {
  origin: LatLng | null;
  points: LatLng[];
  focused: LatLng | null;
  tilted: boolean;
  framing: ViewportFraming;
  fallbackCenter: LatLng;
}): VectorCameraState {
  const { origin, points, focused, tilted, framing, fallbackCenter } = opts;
  const availW = Math.max(framing.widthPx - framing.leftInsetPx - 48, 220);
  const availH = Math.max(framing.heightPx - framing.topInsetPx - framing.bottomInsetPx - 48, 200);
  const minAvail = Math.min(availW, availH);

  if (focused && origin) {
    const dist = haversineMeters(origin, focused);
    const target: LatLng = {
      lat: origin.lat * 0.38 + focused.lat * 0.62,
      lng: origin.lng * 0.38 + focused.lng * 0.62,
    };
    const baseZoom = zoomForSpanMeters(Math.max(dist, 420), target.lat, minAvail, 12.2, 16.5);
    const zoom = tilted ? clamp(baseZoom + 0.35, 13.0, 16.8) : baseZoom;
    const heading = tilted ? Math.round(computeBearing(origin, focused)) : 0;
    const tilt = tilted ? 47.5 : 0;

    return {
      center: offsetCenterForInsets(target, zoom, framing, heading),
      zoom,
      tilt,
      heading,
    };
  }

  if (focused) {
    const zoom = tilted ? 16.5 : 15.2;
    const heading = tilted ? 24 : 0;
    return {
      center: offsetCenterForInsets(focused, zoom, framing, heading),
      zoom,
      tilt: tilted ? 47.5 : 0,
      heading,
    };
  }

  const allPoints = origin ? [origin, ...points] : points;
  if (allPoints.length > 0) {
    const envelope = computePointsEnvelope(allPoints);
    const zoom =
      allPoints.length === 1
        ? 13.5
        : zoomForSpanMeters(envelope.spanMeters, envelope.center.lat, minAvail, 11, 15.5);
    return {
      center: offsetCenterForInsets(envelope.center, zoom, framing, 0),
      zoom,
      tilt: 0,
      heading: 0,
    };
  }

  return {
    center: offsetCenterForInsets(fallbackCenter, 12.5, framing, 0),
    zoom: 12.5,
    tilt: 0,
    heading: 0,
  };
}

/**
 * Computes the ideal Photorealistic 3D Map camera (`center`, `range`, `tilt`, `heading`)
 * across `corridor`, `street`, and `overview` presets with heading-aware inset shifting.
 */
export function compute3DCameraTarget(opts: {
  origin: LatLng | null;
  points: LatLng[];
  focused: LatLng | null;
  framing: ViewportFraming;
  fallbackCenter: LatLng;
  view?: Exclude<Camera3DView, 'orbit' | 'free'>;
}): Camera3DState {
  const { origin, points, focused, framing, fallbackCenter, view = 'corridor' } = opts;
  const isDesktop = framing.widthPx >= 1024;

  const shift3DCenter = (base: LatLng, range: number, heading: number): LatLng => {
    const shiftLeftMeters = isDesktop && framing.leftInsetPx > 0 ? range * 0.14 : 0;
    const shiftDownMeters = !isDesktop && framing.bottomInsetPx > 140 ? range * 0.11 : 0;
    return applyRotatedScreenShift(base, shiftLeftMeters, shiftDownMeters, heading);
  };

  if (view === 'street') {
    const subject = focused ?? origin ?? points[0] ?? fallbackCenter;
    const heading =
      focused && origin ? Math.round(computeBearing(origin, focused)) : 24;
    const range = 340;
    const shifted = shift3DCenter(subject, range, heading);
    return {
      center: { lat: shifted.lat, lng: shifted.lng, altitude: 0 },
      range,
      tilt: 74,
      heading,
    };
  }

  if (view === 'overview') {
    const allPoints = origin ? [origin, ...points] : points;
    const env =
      allPoints.length > 0
        ? computePointsEnvelope(allPoints)
        : { center: focused ?? fallbackCenter, spanMeters: 2400 };
    const range =
      allPoints.length <= 1
        ? 2400
        : clamp(Math.round(env.spanMeters * 1.65), 1800, 10500);
    const heading = 12;
    const shifted = shift3DCenter(env.center, range, heading);
    return {
      center: { lat: shifted.lat, lng: shifted.lng, altitude: 0 },
      range,
      tilt: 38,
      heading,
    };
  }

  if (focused && origin) {
    const dist = haversineMeters(origin, focused);
    const heading = Math.round(computeBearing(origin, focused));
    const range = clamp(Math.round(dist * 1.45), 950, 7200);
    const mid: LatLng = {
      lat: origin.lat * 0.36 + focused.lat * 0.64,
      lng: origin.lng * 0.36 + focused.lng * 0.64,
    };
    const shifted = shift3DCenter(mid, range, heading);
    return {
      center: { lat: shifted.lat, lng: shifted.lng, altitude: 0 },
      range,
      tilt: 62,
      heading,
    };
  }

  if (focused) {
    const range = 820;
    const heading = 22;
    const shifted = shift3DCenter(focused, range, heading);
    return {
      center: { lat: shifted.lat, lng: shifted.lng, altitude: 0 },
      range,
      tilt: 64,
      heading,
    };
  }

  const allPoints = origin ? [origin, ...points] : points;
  if (allPoints.length > 0) {
    const env = computePointsEnvelope(allPoints);
    const range =
      allPoints.length === 1
        ? 2200
        : clamp(Math.round(env.spanMeters * 1.55), 1600, 9500);
    const heading = 12;
    const shifted = shift3DCenter(env.center, range, heading);
    return {
      center: { lat: shifted.lat, lng: shifted.lng, altitude: 0 },
      range,
      tilt: 54,
      heading,
    };
  }

  const heading = 15;
  const shifted = shift3DCenter(fallbackCenter, 2600, heading);
  return {
    center: { lat: shifted.lat, lng: shifted.lng, altitude: 0 },
    range: 2600,
    tilt: 58,
    heading,
  };
}

/**
 * Computes a tight close-up camera centered on a focused place for `flyCameraAround`.
 */
export function compute3DOrbitCamera(
  focused: LatLng,
  origin: LatLng | null
): Camera3DState {
  const heading = origin ? Math.round(computeBearing(origin, focused)) : 20;
  return {
    center: { lat: focused.lat, lng: focused.lng, altitude: 0 },
    range: 420,
    tilt: 65,
    heading,
  };
}

/**
 * Checks whether the user prefers reduced motion so animations can jump directly.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
