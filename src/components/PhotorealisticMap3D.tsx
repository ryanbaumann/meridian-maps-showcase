import { useEffect, useMemo, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { SHOWCASE_CONFIG } from '../config/showcase.ts';
import type { Camera3DView, LatLng, OriginLocation, Specialist } from '../types.ts';
import {
  compute3DCameraTarget,
  compute3DOrbitCamera,
  computeBearing,
  prefersReducedMotion,
  type ViewportFraming,
} from '../utils/camera.ts';
import { formatTravelTime } from '../utils/ranking.ts';

interface PhotorealisticMap3DProps {
  origin: OriginLocation | null;
  specialists: Specialist[];
  selectedId: string | null;
  syncedIds: string[];
  routePath: LatLng[];
  framing: ViewportFraming;
  recenterSignal: number;
  camera3DView: Camera3DView;
  onCamera3DViewChange: (view: Camera3DView) => void;
  onSelectSpecialist: (id: string | null) => void;
  onSwitchToVector: () => void;
}

interface Map3DElementShape extends HTMLElement {
  center?: { lat: number; lng: number; altitude: number };
  range?: number;
  tilt?: number;
  heading?: number;
  mode?: string;
  defaultUIHidden?: boolean;
  flyCameraTo?: (options: {
    endCamera: {
      center: { lat: number; lng: number; altitude: number };
      range: number;
      tilt: number;
      heading: number;
      altitudeMode?: string;
    };
    durationMillis?: number;
  }) => void;
  flyCameraAround?: (options: {
    camera: {
      center: { lat: number; lng: number; altitude: number };
      range: number;
      tilt: number;
      heading: number;
      altitudeMode?: string;
    };
    durationMillis?: number;
    repeatCount?: number;
  }) => void;
  stopCameraAnimation?: () => void;
}

interface Maps3dLibraryShape {
  Map3DElement?: new (options?: Record<string, unknown>) => Map3DElementShape;
  Marker3DInteractiveElement?: new (options?: Record<string, unknown>) => HTMLElement;
  Marker3DElement?: new (options?: Record<string, unknown>) => HTMLElement;
  Model3DInteractiveElement?: new (options?: Record<string, unknown>) => HTMLElement;
  Model3DElement?: new (options?: Record<string, unknown>) => HTMLElement;
  Polyline3DElement?: new (options?: Record<string, unknown>) => HTMLElement & {
    path?: Array<{ lat: number; lng: number; altitude?: number }>;
    coordinates?: Array<{ lat: number; lng: number; altitude?: number }>;
  };
  MapMode?: { HYBRID?: string; SATELLITE?: string };
  AltitudeMode?: {
    CLAMP_TO_GROUND?: string;
    RELATIVE_TO_GROUND?: string;
    RELATIVE_TO_MESH?: string;
  };
}

/**
 * Photorealistic 3D Map powered by Maps JS `maps3d` (`Map3DElement`,
 * `Model3DInteractiveElement`, `Marker3DInteractiveElement`, `Polyline3DElement`)
 * featuring custom PBR `.glb` 3D beacons over buildings, street-following 3D routes,
 * and multi-preset camera views (`corridor`, `street`, `overview`, `orbit`).
 */
export function PhotorealisticMap3D({
  origin,
  specialists,
  selectedId,
  syncedIds,
  routePath,
  framing,
  recenterSignal,
  camera3DView,
  onCamera3DViewChange,
  onSelectSpecialist,
  onSwitchToVector,
}: PhotorealisticMap3DProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const map3dRef = useRef<Map3DElementShape | null>(null);
  const markersRef = useRef<HTMLElement[]>([]);
  const modelsRef = useRef<HTMLElement[]>([]);
  const polylineRef = useRef<HTMLElement | null>(null);
  const orbitGenRef = useRef(0);

  const onSelectRef = useRef(onSelectSpecialist);
  onSelectRef.current = onSelectSpecialist;

  const onCamera3DViewChangeRef = useRef(onCamera3DViewChange);
  onCamera3DViewChangeRef.current = onCamera3DViewChange;

  const camera3DViewRef = useRef(camera3DView);
  camera3DViewRef.current = camera3DView;

  const maps3dLib = useMapsLibrary('maps3d') as unknown as Maps3dLibraryShape | null;
  const markerLib = useMapsLibrary('marker');
  const [initError, setInitError] = useState<string | null>(null);

  const focusedSpecialist = useMemo(
    () => specialists.find((s) => s.id === selectedId) ?? null,
    [specialists, selectedId]
  );

  // Stable spatial signature across all results so route-metric updates never restart active flights
  const pointsKey = useMemo(
    () =>
      specialists
        .map((s) => `${s.id}:${s.location.lat.toFixed(5)},${s.location.lng.toFixed(5)}`)
        .join('|'),
    [specialists]
  );
  const specialistsPointsRef = useRef<LatLng[]>([]);
  specialistsPointsRef.current = specialists.map((s) => s.location);

  const originLat = origin?.lat ?? null;
  const originLng = origin?.lng ?? null;
  const focusedId = focusedSpecialist?.id ?? null;
  const focusedLat = focusedSpecialist?.location.lat ?? null;
  const focusedLng = focusedSpecialist?.location.lng ?? null;

  // Instantiate Map3DElement once when maps3d library resolves
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !maps3dLib?.Map3DElement) return;

    try {
      const initialPreset =
        camera3DView === 'street' || camera3DView === 'overview' ? camera3DView : 'corridor';
      const initialCamera = compute3DCameraTarget({
        origin: originLat != null && originLng != null ? { lat: originLat, lng: originLng } : null,
        points: specialistsPointsRef.current,
        focused: focusedLat != null && focusedLng != null ? { lat: focusedLat, lng: focusedLng } : null,
        framing,
        fallbackCenter: SHOWCASE_CONFIG.defaultCenter,
        view: initialPreset,
      });

      const map3d = new maps3dLib.Map3DElement({
        center: initialCamera.center,
        range: initialCamera.range,
        tilt: initialCamera.tilt,
        heading: initialCamera.heading,
        minTilt: 0,
        maxTilt: 68,
        mode: maps3dLib.MapMode?.HYBRID ?? 'HYBRID',
        defaultUIHidden: true,
        internalUsageAttributionIds: [...SHOWCASE_CONFIG.attributionIds],
      });
      // Space-separated per HTML attribute specification
      map3d.setAttribute(
        'internal-usage-attribution-ids',
        SHOWCASE_CONFIG.attributionIds.join(' ')
      );
      map3d.style.width = '100%';
      map3d.style.height = '100%';
      map3d.style.display = 'block';

      const stopAnimationOnUserGesture = () => {
        orbitGenRef.current += 1;
        try {
          map3d.stopCameraAnimation?.();
        } catch {
          // Ignore if idle
        }
        if (camera3DViewRef.current !== 'free') {
          onCamera3DViewChangeRef.current('free');
        }
      };

      // Distinguish drags (>6px) from marker/beacon clicks so gmp-click sees the live preset
      let pointerDownPos: { x: number; y: number } | null = null;
      const onPointerDown = (e: PointerEvent) => {
        pointerDownPos = { x: e.clientX, y: e.clientY };
      };
      const onPointerMove = (e: PointerEvent) => {
        if (!pointerDownPos) return;
        const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
        if (dist > 6) {
          pointerDownPos = null;
          stopAnimationOnUserGesture();
        }
      };
      const clearPointerDown = () => {
        pointerDownPos = null;
      };

      const onError = () => {
        setInitError('WebGL2 or 3D tiles unavailable in this browser.');
      };

      map3d.addEventListener('pointerdown', onPointerDown, { passive: true });
      map3d.addEventListener('pointermove', onPointerMove, { passive: true });
      map3d.addEventListener('pointerup', clearPointerDown, { passive: true });
      map3d.addEventListener('pointercancel', clearPointerDown, { passive: true });
      map3d.addEventListener('wheel', stopAnimationOnUserGesture, { passive: true });
      map3d.addEventListener('gmp-error', onError);

      container.replaceChildren(map3d);
      map3dRef.current = map3d;
      setInitError(null);

      return () => {
        orbitGenRef.current += 1;
        map3d.removeEventListener('pointerdown', onPointerDown);
        map3d.removeEventListener('pointermove', onPointerMove);
        map3d.removeEventListener('pointerup', clearPointerDown);
        map3d.removeEventListener('pointercancel', clearPointerDown);
        map3d.removeEventListener('wheel', stopAnimationOnUserGesture);
        map3d.removeEventListener('gmp-error', onError);
        markersRef.current.forEach((el) => el.remove());
        markersRef.current = [];
        modelsRef.current.forEach((el) => el.remove());
        modelsRef.current = [];
        polylineRef.current?.remove();
        polylineRef.current = null;
        map3d.remove();
        map3dRef.current = null;
      };
    } catch (err) {
      setInitError(err instanceof Error ? err.message : 'Unable to start Photorealistic 3D.');
    }
    // Intentionally initialize once when maps3dLib becomes ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maps3dLib]);

  // Mount custom self-hosted PBR .glb 3D models for the focused destination and origin
  useEffect(() => {
    const map3d = map3dRef.current;
    modelsRef.current.forEach((el) => el.remove());
    modelsRef.current = [];

    if (!map3d || !maps3dLib) return;
    const ModelInteractive = maps3dLib.Model3DInteractiveElement;
    const ModelBasic = maps3dLib.Model3DElement;
    if (!ModelInteractive && !ModelBasic) return;

    const meshMode =
      maps3dLib.AltitudeMode?.RELATIVE_TO_MESH ??
      maps3dLib.AltitudeMode?.RELATIVE_TO_GROUND ??
      'RELATIVE_TO_MESH';

    const routeHeading =
      originLat != null && originLng != null && focusedLat != null && focusedLng != null
        ? Math.round(
            computeBearing(
              { lat: originLat, lng: originLng },
              { lat: focusedLat, lng: focusedLng }
            )
          )
        : 0;

    // 1. Custom sculpted Meridian 3D Beacon hovering cleanly over the focused rooftop
    if (focusedId && focusedLat != null && focusedLng != null) {
      const BeaconCtor = ModelInteractive ?? ModelBasic!;
      const beaconModel = new BeaconCtor({
        src: SHOWCASE_CONFIG.models.destinationBeaconUrl,
        position: { lat: focusedLat, lng: focusedLng, altitude: 4 },
        altitudeMode: meshMode,
        // glTF +Y up -> Maps 3D +Z up via tilt: 270
        orientation: { heading: routeHeading, tilt: 270, roll: 0 },
        scale: 5.5,
      });

      const onBeaconClick = () => {
        onCamera3DViewChangeRef.current(
          camera3DViewRef.current === 'orbit' ? 'street' : 'orbit'
        );
      };
      beaconModel.addEventListener('gmp-click', onBeaconClick);

      map3d.appendChild(beaconModel);
      modelsRef.current.push(beaconModel);
    }

    // 2. Custom dark-slate Origin 3D Compass Beacon at the starting location
    if (originLat != null && originLng != null) {
      const OriginCtor = ModelBasic ?? ModelInteractive!;
      const originModel = new OriginCtor({
        src: SHOWCASE_CONFIG.models.originBeaconUrl,
        position: { lat: originLat, lng: originLng, altitude: 3 },
        altitudeMode: meshMode,
        orientation: { heading: routeHeading, tilt: 270, roll: 0 },
        scale: 4.2,
      });
      map3d.appendChild(originModel);
      modelsRef.current.push(originModel);
    }

    return () => {
      modelsRef.current.forEach((el) => el.remove());
      modelsRef.current = [];
    };
  }, [maps3dLib, originLat, originLng, focusedId, focusedLat, focusedLng]);

  // Sync 3D markers independently of async route polyline & .glb model resolution
  useEffect(() => {
    const map3d = map3dRef.current;
    if (!map3d || !maps3dLib) return;

    markersRef.current.forEach((el) => el.remove());
    markersRef.current = [];

    const MarkerInteractive = maps3dLib.Marker3DInteractiveElement;
    const MarkerBasic = maps3dLib.Marker3DElement;
    const PinElement = markerLib?.PinElement;
    const hasCustomModels = Boolean(
      maps3dLib.Model3DInteractiveElement || maps3dLib.Model3DElement
    );
    const relativeMode = maps3dLib.AltitudeMode?.RELATIVE_TO_GROUND ?? 'RELATIVE_TO_GROUND';
    const meshMode = maps3dLib.AltitudeMode?.RELATIVE_TO_MESH ?? relativeMode;
    const syncedSet = new Set(syncedIds);

    if (origin && (MarkerBasic || MarkerInteractive)) {
      const Ctor = MarkerBasic ?? MarkerInteractive!;
      const originMarker = new Ctor({
        position: { lat: origin.lat, lng: origin.lng, altitude: hasCustomModels ? 10 : 16 },
        altitudeMode: hasCustomModels ? meshMode : relativeMode,
        label: 'Start',
        extruded: !hasCustomModels,
      });
      if (PinElement && !hasCustomModels) {
        const pin = new PinElement({
          background: '#0f172a',
          borderColor: '#ffffff',
          glyphColor: '#ffffff',
          scale: 0.95,
        });
        originMarker.appendChild(pin);
      }
      map3d.appendChild(originMarker);
      markersRef.current.push(originMarker);
    }

    specialists.forEach((specialist, index) => {
      const rank = index + 1;
      const isSelected = specialist.id === selectedId;
      const isSynced = syncedSet.has(specialist.id);
      const Ctor = MarkerInteractive ?? MarkerBasic;
      if (!Ctor) return;

      const labelPrefix = isSynced ? `✓ #${rank}` : `#${rank}`;
      const uses3DModel = isSelected && hasCustomModels;

      const marker = new Ctor({
        position: {
          lat: specialist.location.lat,
          lng: specialist.location.lng,
          altitude: uses3DModel ? 26 : 18,
        },
        altitudeMode: uses3DModel ? meshMode : relativeMode,
        label: `${labelPrefix} · ${formatTravelTime(specialist.travelDurationSeconds)}`,
        title: specialist.name,
        extruded: !uses3DModel,
      });

      // Let the sculpted 3D Beacon stand cleanly on the focused building while unselected places show pins
      if (PinElement && !uses3DModel) {
        const pin = new PinElement({
          background: isSelected ? '#0f766e' : isSynced ? '#0f172a' : '#ffffff',
          borderColor: isSelected ? '#134e4a' : isSynced ? '#ffffff' : '#0f172a',
          glyphColor: isSelected || isSynced ? '#ffffff' : '#0f172a',
          glyphText: String(rank),
          scale: isSelected ? 1.2 : 1.0,
        });
        marker.appendChild(pin);
      }

      marker.addEventListener('gmp-click', () => {
        if (specialist.id === selectedId) {
          onCamera3DViewChangeRef.current(
            camera3DViewRef.current === 'orbit' ? 'street' : 'orbit'
          );
          return;
        }
        onSelectRef.current(specialist.id);
      });

      map3d.appendChild(marker);
      markersRef.current.push(marker);
    });
  }, [maps3dLib, markerLib, origin, specialists, selectedId, syncedIds]);

  // Sync street-following 3D route polyline in its own effect so markers and models stay stable
  useEffect(() => {
    const map3d = map3dRef.current;
    polylineRef.current?.remove();
    polylineRef.current = null;

    if (!map3d || !maps3dLib?.Polyline3DElement || routePath.length < 2) return;

    const clampMode = maps3dLib.AltitudeMode?.CLAMP_TO_GROUND ?? 'CLAMP_TO_GROUND';
    const polyline = new maps3dLib.Polyline3DElement({
      strokeColor: '#0d9488',
      outerColor: '#ffffff',
      outerWidth: 0.35,
      strokeWidth: 8,
      altitudeMode: clampMode,
      drawsOccludedSegments: true,
    });
    if ('path' in polyline) {
      polyline.path = routePath;
    } else {
      polyline.coordinates = routePath;
    }
    map3d.appendChild(polyline);
    polylineRef.current = polyline;

    return () => {
      polyline.remove();
      if (polylineRef.current === polyline) {
        polylineRef.current = null;
      }
    };
  }, [maps3dLib, routePath]);

  // Multi-view 3D camera controller: corridor, street approach, aerial overview, and 360° orbit
  useEffect(() => {
    const map3d = map3dRef.current;
    if (!map3d || camera3DView === 'free') return;

    const myGen = ++orbitGenRef.current;
    const reduced = prefersReducedMotion();
    const originPoint =
      originLat != null && originLng != null ? { lat: originLat, lng: originLng } : null;
    const focusedPoint =
      focusedLat != null && focusedLng != null ? { lat: focusedLat, lng: focusedLng } : null;

    try {
      map3d.stopCameraAnimation?.();
    } catch {
      // Ignore if idle
    }

    const meshMode =
      maps3dLib?.AltitudeMode?.RELATIVE_TO_MESH ??
      maps3dLib?.AltitudeMode?.RELATIVE_TO_GROUND ??
      'RELATIVE_TO_MESH';

    if (camera3DView === 'orbit' && focusedPoint) {
      const baseOrbitCamera = compute3DOrbitCamera(focusedPoint, originPoint);
      const orbitCamera = { ...baseOrbitCamera, altitudeMode: meshMode };

      if (reduced || typeof map3d.flyCameraAround !== 'function') {
        if (typeof map3d.flyCameraTo === 'function') {
          try {
            map3d.flyCameraTo({ endCamera: orbitCamera, durationMillis: 0 });
          } catch {
            map3d.center = orbitCamera.center;
            map3d.range = orbitCamera.range;
            map3d.tilt = orbitCamera.tilt;
            map3d.heading = orbitCamera.heading;
          }
        } else {
          map3d.center = orbitCamera.center;
          map3d.range = orbitCamera.range;
          map3d.tilt = orbitCamera.tilt;
          map3d.heading = orbitCamera.heading;
        }
        onCamera3DViewChangeRef.current('street');
        return;
      }

      const onOrbitDone = () => {
        if (orbitGenRef.current === myGen) {
          onCamera3DViewChangeRef.current('street');
        }
      };

      const startOrbit = () => {
        if (orbitGenRef.current !== myGen) return;
        map3d.addEventListener('gmp-animationend', onOrbitDone, { once: true });
        try {
          map3d.flyCameraAround?.({
            camera: orbitCamera,
            durationMillis: 18000,
            repeatCount: 1,
          });
        } catch {
          map3d.removeEventListener('gmp-animationend', onOrbitDone);
          onCamera3DViewChangeRef.current('street');
        }
      };

      // Defer one tick so any gmp-animationend from stopCameraAnimation flushes first
      const launchTimer = window.setTimeout(() => {
        if (orbitGenRef.current !== myGen) return;
        if (typeof map3d.flyCameraTo === 'function') {
          map3d.addEventListener('gmp-animationend', startOrbit, { once: true });
          try {
            map3d.flyCameraTo({ endCamera: orbitCamera, durationMillis: 1100 });
          } catch {
            map3d.removeEventListener('gmp-animationend', startOrbit);
            startOrbit();
          }
        } else {
          startOrbit();
        }
      }, 20);

      return () => {
        orbitGenRef.current += 1;
        window.clearTimeout(launchTimer);
        map3d.removeEventListener('gmp-animationend', startOrbit);
        map3d.removeEventListener('gmp-animationend', onOrbitDone);
        try {
          map3d.stopCameraAnimation?.();
        } catch {
          // Ignore
        }
      };
    }

    const preset: Exclude<Camera3DView, 'orbit' | 'free'> =
      camera3DView === 'street' || camera3DView === 'overview' ? camera3DView : 'corridor';

    const baseEndCamera = compute3DCameraTarget({
      origin: originPoint,
      points: specialistsPointsRef.current,
      focused: focusedPoint,
      framing,
      fallbackCenter: SHOWCASE_CONFIG.defaultCenter,
      view: preset,
    });
    const endCamera = { ...baseEndCamera, altitudeMode: meshMode };

    if (typeof map3d.flyCameraTo === 'function') {
      try {
        map3d.flyCameraTo({
          endCamera,
          durationMillis: reduced ? 0 : preset === 'street' ? 1400 : 1200,
        });
        return;
      } catch {
        // Fall through to direct assignment
      }
    }

    map3d.center = endCamera.center;
    map3d.range = endCamera.range;
    map3d.tilt = endCamera.tilt;
    map3d.heading = endCamera.heading;
  }, [
    maps3dLib,
    originLat,
    originLng,
    pointsKey,
    selectedId,
    focusedLat,
    focusedLng,
    recenterSignal,
    camera3DView,
    framing.leftInsetPx,
    framing.bottomInsetPx,
    framing.widthPx,
    framing.heightPx,
    framing.topInsetPx,
  ]);

  return (
    <div
      className="relative w-full h-full bg-[var(--bg)]"
      data-testid="map-3d-stage"
    >
      <div ref={containerRef} className="w-full h-full" />

      {!maps3dLib && !initError && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--bg)]/85 text-sm font-medium text-[var(--muted)]">
          Loading 3D view...
        </div>
      )}

      {initError && (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg)] p-6 text-center">
          <div className="max-w-xs space-y-3">
            <p className="text-sm text-[var(--muted)]">{initError}</p>
            <button
              type="button"
              onClick={onSwitchToVector}
              className="inline-flex items-center justify-center min-h-[44px] px-4 text-xs font-semibold rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              Switch to Vector
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
