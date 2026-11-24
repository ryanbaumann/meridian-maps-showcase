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
  CollisionBehavior?: {
    REQUIRED?: string;
    REQUIRED_AND_HIDES_OPTIONAL?: string;
    OPTIONAL_AND_HIDES_LOWER_PRIORITY?: string;
  };
  GestureHandling?: {
    AUTO?: string;
    COOPERATIVE?: string;
    GREEDY?: string;
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

      const greedyGesture = maps3dLib.GestureHandling?.GREEDY ?? 'GREEDY';
      const map3d = new maps3dLib.Map3DElement({
        center: initialCamera.center,
        range: initialCamera.range,
        tilt: initialCamera.tilt,
        heading: initialCamera.heading,
        minTilt: 0,
        maxTilt: 68,
        mode: maps3dLib.MapMode?.HYBRID ?? 'HYBRID',
        gestureHandling: greedyGesture,
        defaultUIHidden: true,
        internalUsageAttributionIds: [...SHOWCASE_CONFIG.attributionIds],
      });
      // Space-separated per HTML attribute specification
      map3d.setAttribute(
        'internal-usage-attribution-ids',
        SHOWCASE_CONFIG.attributionIds.join(' ')
      );
      map3d.setAttribute('gesture-handling', 'greedy');
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

    // 1. Custom sculpted Meridian 3D Beacon seated cleanly on the focused rooftop below the elevated marker
    if (focusedId && focusedLat != null && focusedLng != null) {
      const BeaconCtor = ModelInteractive ?? ModelBasic!;
      const beaconModel = new BeaconCtor({
        src: SHOWCASE_CONFIG.models.destinationBeaconUrl,
        position: { lat: focusedLat, lng: focusedLng, altitude: 2 },
        altitudeMode: meshMode,
        // glTF +Y up -> Maps 3D +Z up via tilt: 270
        orientation: { heading: routeHeading, tilt: 270, roll: 0 },
        scale: 6.0,
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
        scale: 7.0,
      });
      map3d.appendChild(originModel);
      modelsRef.current.push(originModel);
    }

    return () => {
      modelsRef.current.forEach((el) => el.remove());
      modelsRef.current = [];
    };
  }, [maps3dLib, originLat, originLng, focusedId, focusedLat, focusedLng]);

  // Sync high-contrast custom SVG 3D markers with crisp text outline colors & collision priority
  useEffect(() => {
    const map3d = map3dRef.current;
    if (!map3d || !maps3dLib) return;

    markersRef.current.forEach((el) => el.remove());
    markersRef.current = [];

    const MarkerInteractive = maps3dLib.Marker3DInteractiveElement;
    const MarkerBasic = maps3dLib.Marker3DElement;
    const PinElement = markerLib?.PinElement;
    const meshMode =
      maps3dLib.AltitudeMode?.RELATIVE_TO_MESH ??
      maps3dLib.AltitudeMode?.RELATIVE_TO_GROUND ??
      'RELATIVE_TO_MESH';
    const requiredHidesOptional =
      maps3dLib.CollisionBehavior?.REQUIRED_AND_HIDES_OPTIONAL ?? 'REQUIRED_AND_HIDES_OPTIONAL';
    const optionalHidesLower =
      maps3dLib.CollisionBehavior?.OPTIONAL_AND_HIDES_LOWER_PRIORITY ??
      'OPTIONAL_AND_HIDES_LOWER_PRIORITY';
    const syncedSet = new Set(syncedIds);
    const svgNS = 'http://www.w3.org/2000/svg';

    const createOutlinedText = (options: {
      x: number;
      y: number;
      text: string;
      fill: string;
      stroke: string;
      strokeWidth: number;
      fontSize: number;
      anchor?: 'start' | 'middle' | 'end';
      fontWeight?: string;
    }): SVGTextElement => {
      const el = document.createElementNS(svgNS, 'text');
      el.setAttribute('x', String(options.x));
      el.setAttribute('y', String(options.y));
      el.setAttribute('fill', options.fill);
      el.setAttribute('stroke', options.stroke);
      el.setAttribute('stroke-width', String(options.strokeWidth));
      el.setAttribute('stroke-linejoin', 'round');
      el.setAttribute('paint-order', 'stroke fill');
      el.setAttribute('font-family', 'Inter, system-ui, -apple-system, sans-serif');
      el.setAttribute('font-size', String(options.fontSize));
      el.setAttribute('font-weight', options.fontWeight ?? '800');
      el.setAttribute('text-anchor', options.anchor ?? 'middle');
      el.setAttribute('dominant-baseline', 'central');
      el.textContent = options.text;
      return el;
    };

    // 1. Origin ("Start") marker: high-contrast compass emblem + outlined START label
    const buildOriginGraphicTemplate = (): HTMLTemplateElement | null => {
      if (typeof document === 'undefined') return null;
      const tpl = document.createElement('template');
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('xmlns', svgNS);
      svg.setAttribute('width', '92');
      svg.setAttribute('height', '68');
      svg.setAttribute('viewBox', '0 0 92 68');

      // Outlined START pill badge
      const pill = document.createElementNS(svgNS, 'rect');
      pill.setAttribute('x', '16');
      pill.setAttribute('y', '2');
      pill.setAttribute('width', '60');
      pill.setAttribute('height', '22');
      pill.setAttribute('rx', '11');
      pill.setAttribute('fill', '#0f172a');
      pill.setAttribute('stroke', '#ffffff');
      pill.setAttribute('stroke-width', '2.5');

      const label = createOutlinedText({
        x: 46,
        y: 13.5,
        text: 'START',
        fill: '#ffffff',
        stroke: '#020617',
        strokeWidth: 3.5,
        fontSize: 11.5,
      });

      // Vertical connector stem to compass bullseye
      const stem = document.createElementNS(svgNS, 'line');
      stem.setAttribute('x1', '46');
      stem.setAttribute('y1', '24');
      stem.setAttribute('x2', '46');
      stem.setAttribute('y2', '32');
      stem.setAttribute('stroke', '#ffffff');
      stem.setAttribute('stroke-width', '3');

      // High-contrast obsidian + teal compass bullseye
      const outerHalo = document.createElementNS(svgNS, 'circle');
      outerHalo.setAttribute('cx', '46');
      outerHalo.setAttribute('cy', '47');
      outerHalo.setAttribute('r', '17');
      outerHalo.setAttribute('fill', '#0f172a');
      outerHalo.setAttribute('stroke', '#ffffff');
      outerHalo.setAttribute('stroke-width', '3.5');

      const tealRing = document.createElementNS(svgNS, 'circle');
      tealRing.setAttribute('cx', '46');
      tealRing.setAttribute('cy', '47');
      tealRing.setAttribute('r', '9.5');
      tealRing.setAttribute('fill', '#14b8a6');
      tealRing.setAttribute('stroke', '#ffffff');
      tealRing.setAttribute('stroke-width', '2');

      const core = document.createElementNS(svgNS, 'circle');
      core.setAttribute('cx', '46');
      core.setAttribute('cy', '47');
      core.setAttribute('r', '3.5');
      core.setAttribute('fill', '#ffffff');

      svg.append(stem, pill, label, outerHalo, tealRing, core);
      tpl.content.append(svg);
      return tpl;
    };

    // 2. Specialist marker: custom SVG basic graphics + bold text outline color for legibility over 3D buildings
    const buildSpecialistGraphicTemplate = (params: {
      rank: number;
      timeText: string;
      ratingText: string | null;
      isSelected: boolean;
      isSynced: boolean;
      isTopThree: boolean;
    }): HTMLTemplateElement | null => {
      if (typeof document === 'undefined') return null;
      const { rank, timeText, ratingText, isSelected, isSynced, isTopThree } = params;
      const tpl = document.createElement('template');
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('xmlns', svgNS);

      // Compact high-contrast circular pin with outlined rank for ranks #4+ (unselected & not shortlisted)
      if (!isSelected && !isSynced && !isTopThree) {
        const w = 52;
        const h = 58;
        svg.setAttribute('width', String(w));
        svg.setAttribute('height', String(h));
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

        // Pointer triangle with white outline
        const pointer = document.createElementNS(svgNS, 'polygon');
        pointer.setAttribute('points', '19,38 33,38 26,51');
        pointer.setAttribute('fill', '#0f172a');
        pointer.setAttribute('stroke', '#ffffff');
        pointer.setAttribute('stroke-width', '2.5');
        pointer.setAttribute('stroke-linejoin', 'round');

        // Outer badge circle
        const circle = document.createElementNS(svgNS, 'circle');
        circle.setAttribute('cx', '26');
        circle.setAttribute('cy', '22');
        circle.setAttribute('r', '18');
        circle.setAttribute('fill', '#0f172a');
        circle.setAttribute('stroke', '#ffffff');
        circle.setAttribute('stroke-width', '3');

        // Subtle inner sky accent ring
        const innerRing = document.createElementNS(svgNS, 'circle');
        innerRing.setAttribute('cx', '26');
        innerRing.setAttribute('cy', '22');
        innerRing.setAttribute('r', '13.5');
        innerRing.setAttribute('fill', 'none');
        innerRing.setAttribute('stroke', '#38bdf8');
        innerRing.setAttribute('stroke-width', '1.5');
        innerRing.setAttribute('stroke-opacity', '0.85');

        // Ground anchor dot
        const dot = document.createElementNS(svgNS, 'circle');
        dot.setAttribute('cx', '26');
        dot.setAttribute('cy', '54');
        dot.setAttribute('r', '3');
        dot.setAttribute('fill', '#38bdf8');
        dot.setAttribute('stroke', '#020617');
        dot.setAttribute('stroke-width', '1.5');

        const rankLabel = createOutlinedText({
          x: 26,
          y: 22.5,
          text: String(rank),
          fill: '#ffffff',
          stroke: '#020617',
          strokeWidth: 4,
          fontSize: rank >= 10 ? 14 : 16,
        });

        svg.append(pointer, circle, innerRing, rankLabel, dot);
        tpl.content.append(svg);
        return tpl;
      }

      // Rich callout graphic badge for Selected, Shortlisted, and Top 3 picks
      const showRating = isSelected && Boolean(ratingText);
      const primaryText = isSynced && !isSelected ? `✓ ${timeText}` : timeText;
      const textChars = primaryText.length + (showRating && ratingText ? ratingText.length + 2 : 0);
      const badgeW = Math.max(isSelected ? 132 : 108, 46 + textChars * 8.6);
      const badgeH = isSelected ? 40 : 34;
      const totalW = Math.ceil(badgeW + 12);
      const totalH = badgeH + 22;
      const cx = totalW / 2;

      svg.setAttribute('width', String(totalW));
      svg.setAttribute('height', String(totalH));
      svg.setAttribute('viewBox', `0 0 ${totalW} ${totalH}`);

      const bgFill = isSelected ? '#0f766e' : isSynced ? '#1e1b4b' : '#0f172a';
      const borderStroke = isSelected ? '#ffffff' : isSynced ? '#fbbf24' : '#ffffff';
      const textStroke = isSelected ? '#042f2e' : '#020617';
      const textFill = isSynced && !isSelected ? '#fef3c7' : '#ffffff';

      // Outer dark halo behind badge + pointer for crisp separation over bright concrete roofs
      const haloRect = document.createElementNS(svgNS, 'rect');
      haloRect.setAttribute('x', '4');
      haloRect.setAttribute('y', '3');
      haloRect.setAttribute('width', String(totalW - 8));
      haloRect.setAttribute('height', String(badgeH));
      haloRect.setAttribute('rx', String(badgeH / 2));
      haloRect.setAttribute('fill', 'none');
      haloRect.setAttribute('stroke', '#020617');
      haloRect.setAttribute('stroke-width', '5.5');
      haloRect.setAttribute('stroke-opacity', '0.7');

      // Pointer caret
      const tipY = badgeH + 14;
      const pointer = document.createElementNS(svgNS, 'polygon');
      pointer.setAttribute('points', `${cx - 8},${badgeH + 1} ${cx + 8},${badgeH + 1} ${cx},${tipY}`);
      pointer.setAttribute('fill', bgFill);
      pointer.setAttribute('stroke', borderStroke);
      pointer.setAttribute('stroke-width', '2.5');
      pointer.setAttribute('stroke-linejoin', 'round');

      // Main pill graphic
      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('x', '4');
      rect.setAttribute('y', '3');
      rect.setAttribute('width', String(totalW - 8));
      rect.setAttribute('height', String(badgeH));
      rect.setAttribute('rx', String(badgeH / 2));
      rect.setAttribute('fill', bgFill);
      rect.setAttribute('stroke', borderStroke);
      rect.setAttribute('stroke-width', isSelected ? '3' : '2.5');

      // Rank medallion circle on left
      const medalR = isSelected ? 13 : 11.5;
      const medalCx = 4 + badgeH / 2;
      const medalCy = 3 + badgeH / 2;
      const medal = document.createElementNS(svgNS, 'circle');
      medal.setAttribute('cx', String(medalCx));
      medal.setAttribute('cy', String(medalCy));
      medal.setAttribute('r', String(medalR));
      medal.setAttribute(
        'fill',
        isSelected ? '#ffffff' : isSynced ? '#fbbf24' : '#14b8a6'
      );
      medal.setAttribute('stroke', textStroke);
      medal.setAttribute('stroke-width', '1.5');

      const medalText = createOutlinedText({
        x: medalCx,
        y: medalCy + 0.5,
        text: String(rank),
        fill: '#0f172a',
        stroke: '#ffffff',
        strokeWidth: isSelected ? 0 : 1.2,
        fontSize: isSelected ? 14 : 12.5,
      });

      // Crisp outlined travel time (+ gold star rating on selected marker)
      const labelStartX = medalCx + medalR + 8;
      const timeLabel = createOutlinedText({
        x: labelStartX,
        y: medalCy + 0.5,
        text: primaryText,
        fill: textFill,
        stroke: textStroke,
        strokeWidth: 3.8,
        fontSize: isSelected ? 14 : 12.5,
        anchor: 'start',
      });

      // Ground anchor beacon dot right under the caret
      const anchorDot = document.createElementNS(svgNS, 'circle');
      anchorDot.setAttribute('cx', String(cx));
      anchorDot.setAttribute('cy', String(totalH - 3.5));
      anchorDot.setAttribute('r', isSelected ? '3.5' : '2.8');
      anchorDot.setAttribute('fill', isSelected ? '#2dd4bf' : isSynced ? '#fbbf24' : '#ffffff');
      anchorDot.setAttribute('stroke', '#020617');
      anchorDot.setAttribute('stroke-width', '1.5');

      svg.append(haloRect, pointer, rect, medal, medalText, timeLabel, anchorDot);

      if (showRating && ratingText) {
        const ratingLabel = createOutlinedText({
          x: totalW - 14,
          y: medalCy + 0.5,
          text: ratingText,
          fill: '#fde68a',
          stroke: '#042f2e',
          strokeWidth: 3.5,
          fontSize: 13,
          anchor: 'end',
        });
        svg.append(ratingLabel);
      }

      tpl.content.append(svg);
      return tpl;
    };

    if (origin && (MarkerBasic || MarkerInteractive)) {
      const Ctor = MarkerBasic ?? MarkerInteractive!;
      const originMarker = new Ctor({
        position: { lat: origin.lat, lng: origin.lng, altitude: 48 },
        altitudeMode: meshMode,
        title: `Start: ${origin.label}`,
        extruded: true,
        collisionBehavior: requiredHidesOptional,
        drawsWhenOccluded: true,
        sizePreserved: true,
        zIndex: 900,
      });

      const originSvgTpl = buildOriginGraphicTemplate();
      if (originSvgTpl) {
        originMarker.appendChild(originSvgTpl);
      } else if (PinElement) {
        const pin = new PinElement({
          background: '#0f172a',
          borderColor: '#ffffff',
          glyphColor: '#2dd4bf',
          glyphText: 'S',
          scale: 1.2,
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
      const isTopThree = rank <= 3;
      const Ctor = MarkerInteractive ?? MarkerBasic;
      if (!Ctor) return;

      const timeText = formatTravelTime(specialist.travelDurationSeconds);
      const ratingText =
        specialist.rating != null ? `★${specialist.rating.toFixed(1)}` : null;

      // Elevate the active destination high above surrounding buildings & its rooftop beacon
      // with an extruded stem and REQUIRED_AND_HIDES_OPTIONAL so it is never occluded or hidden.
      const marker = new Ctor({
        position: {
          lat: specialist.location.lat,
          lng: specialist.location.lng,
          altitude: isSelected ? 105 : isSynced ? 52 : isTopThree ? 42 : 28,
        },
        altitudeMode: meshMode,
        title: `#${rank} ${specialist.name} · ${timeText}`,
        extruded: true,
        collisionBehavior: isSelected ? requiredHidesOptional : optionalHidesLower,
        drawsWhenOccluded: isSelected,
        sizePreserved: true,
        zIndex: isSelected
          ? 1000
          : isSynced
            ? 200 - index
            : isTopThree
              ? 120 - index
              : Math.max(20, 60 - index),
      });

      const svgTpl = buildSpecialistGraphicTemplate({
        rank,
        timeText,
        ratingText,
        isSelected,
        isSynced,
        isTopThree,
      });

      if (svgTpl) {
        marker.appendChild(svgTpl);
      } else if (PinElement) {
        const pin = new PinElement({
          background: isSelected ? '#0d9488' : isSynced ? '#1e1b4b' : '#0f172a',
          borderColor: isSynced ? '#fbbf24' : '#ffffff',
          glyphColor: isSelected ? '#ffffff' : '#2dd4bf',
          glyphText: String(rank),
          scale: isSelected ? 1.4 : 1.1,
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
      strokeColor: '#14b8a6',
      outerColor: '#0f172a',
      outerWidth: 0.4,
      strokeWidth: 11,
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
