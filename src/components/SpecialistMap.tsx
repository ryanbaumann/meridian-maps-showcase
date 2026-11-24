import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AdvancedMarker,
  APILoadingStatus,
  Map as GoogleMap,
  RenderingType,
  useApiIsLoaded,
  useApiLoadingStatus,
  useMap,
} from '@vis.gl/react-google-maps';
import {
  Bike,
  Box,
  Car,
  Check,
  Compass,
  Crosshair,
  Footprints,
  Info,
  Map as MapIcon,
  Moon,
  Navigation,
  Orbit,
  Star,
  Sun,
} from 'lucide-react';
import { SHOWCASE_CONFIG } from '../config/showcase.ts';
import {
  getTravelModeVerb,
  useActiveRoute,
} from '../hooks/useActiveRoute.ts';
import type { ResolvedTheme } from '../hooks/useTheme.ts';
import type {
  Camera3DView,
  LatLng,
  MapViewMode,
  OriginLocation,
  Specialist,
  TravelMode,
} from '../types.ts';
import {
  computeVectorCameraTarget,
  easeOutCubic,
  interpolateAngle,
  prefersReducedMotion,
  type ViewportFraming,
} from '../utils/camera.ts';
import { buildPlaceDirectionsUrl } from '../utils/mapsSync.ts';
import { formatDistance, formatTravelTime } from '../utils/ranking.ts';
import { PhotorealisticMap3D } from './PhotorealisticMap3D.tsx';
import { PlaceDetailView } from './PlaceDetailView.tsx';

interface SpecialistMapProps {
  origin: OriginLocation | null;
  specialists: Specialist[];
  selectedId: string | null;
  inspectedSpecialist?: Specialist | null;
  inspectedRank?: number;
  isLoadingDetails?: boolean;
  hoveredId: string | null;
  syncedIds: string[];
  travelMode: TravelMode;
  mapViewMode: MapViewMode;
  camera3DView: Camera3DView;
  resolvedTheme: ResolvedTheme;
  hideSecondaryControlsOnMobile?: boolean;
  sidebarCollapsed?: boolean;
  onToggleTheme: () => void;
  onChangeCamera3DView: (view: Camera3DView) => void;
  onSelectSpecialist: (id: string | null) => void;
  onOpenDetails?: (id: string) => void;
  onCloseDetails?: () => void;
  onToggleSyncId?: (id: string) => void;
  onAskQuestion?: (question: string) => void;
  onRequestPlaceDetails?: (id: string) => void;
  onChangeTravelMode: (mode: TravelMode) => void;
  onChangeMapViewMode: (mode: MapViewMode) => void;
  onRouteMetricsUpdate?: (id: string, durationSeconds: number, distanceMeters: number) => void;
}

/**
 * Smooth cubic-out camera controller for the Vector Map.
 * Keyed strictly on spatial primitives so route-metric refreshes never abort active glides.
 */
function VectorCameraController({
  originLat,
  originLng,
  points,
  pointsKey,
  selectedId,
  focusedLat,
  focusedLng,
  tilted,
  framing,
  recenterSignal,
}: {
  originLat: number | null;
  originLng: number | null;
  points: LatLng[];
  pointsKey: string;
  selectedId: string | null;
  focusedLat: number | null;
  focusedLng: number | null;
  tilted: boolean;
  framing: ViewportFraming;
  recenterSignal: number;
}) {
  const map = useMap();
  const animFrameRef = useRef<number | null>(null);
  const pointsRef = useRef<LatLng[]>(points);
  pointsRef.current = points;
  const didMountForMapRef = useRef<google.maps.Map | null>(null);

  useEffect(() => {
    if (!map) return;

    const cancelAnimation = () => {
      if (animFrameRef.current != null) {
        window.cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };

    const dragListener = map.addListener('dragstart', cancelAnimation);
    const mapDiv = map.getDiv();
    mapDiv?.addEventListener('wheel', cancelAnimation, { passive: true });
    mapDiv?.addEventListener('touchstart', cancelAnimation, { passive: true });

    const target = computeVectorCameraTarget({
      origin: originLat != null && originLng != null ? { lat: originLat, lng: originLng } : null,
      points: pointsRef.current,
      focused: focusedLat != null && focusedLng != null ? { lat: focusedLat, lng: focusedLng } : null,
      tilted,
      framing,
      fallbackCenter: SHOWCASE_CONFIG.defaultCenter,
    });

    const isFreshMapInstance = didMountForMapRef.current !== map;
    didMountForMapRef.current = map;

    const currentCenter = map.getCenter();
    if (isFreshMapInstance || prefersReducedMotion() || !currentCenter) {
      map.moveCamera(target);
      return () => {
        cancelAnimation();
        dragListener.remove();
        mapDiv?.removeEventListener('wheel', cancelAnimation);
        mapDiv?.removeEventListener('touchstart', cancelAnimation);
      };
    }

    const startLat = currentCenter.lat();
    const startLng = currentCenter.lng();
    const startZoom = map.getZoom() ?? target.zoom;
    const startTilt = map.getTilt() ?? 0;
    const startHeading = map.getHeading() ?? 0;

    const durationMs = 760;
    const startTime = performance.now();

    const step = (now: number) => {
      const progress = Math.min((now - startTime) / durationMs, 1);
      const eased = easeOutCubic(progress);

      map.moveCamera({
        center: {
          lat: startLat + (target.center.lat - startLat) * eased,
          lng: startLng + (target.center.lng - startLng) * eased,
        },
        zoom: startZoom + (target.zoom - startZoom) * eased,
        tilt: startTilt + (target.tilt - startTilt) * eased,
        heading: interpolateAngle(startHeading, target.heading, eased),
      });

      if (progress < 1) {
        animFrameRef.current = window.requestAnimationFrame(step);
      } else {
        animFrameRef.current = null;
      }
    };

    animFrameRef.current = window.requestAnimationFrame(step);

    return () => {
      cancelAnimation();
      dragListener.remove();
      mapDiv?.removeEventListener('wheel', cancelAnimation);
      mapDiv?.removeEventListener('touchstart', cancelAnimation);
    };
  }, [
    map,
    originLat,
    originLng,
    pointsKey,
    selectedId,
    focusedLat,
    focusedLng,
    tilted,
    recenterSignal,
    framing.leftInsetPx,
    framing.bottomInsetPx,
    framing.topInsetPx,
    framing.widthPx,
    framing.heightPx,
  ]);

  return null;
}

/**
 * Draws the shared active route polyline on the Vector Map with crisp casing.
 */
function VectorRouteOverlay({
  path,
  isFallback,
  resolvedTheme,
}: {
  path: LatLng[];
  isFallback: boolean;
  resolvedTheme: ResolvedTheme;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || path.length < 2) return;

    const casing = new google.maps.Polyline({
      path,
      geodesic: true,
      strokeColor: resolvedTheme === 'dark' ? '#0f172a' : '#ffffff',
      strokeOpacity: 0.95,
      strokeWeight: 9,
      zIndex: 10,
      map,
    });

    const line = new google.maps.Polyline({
      path,
      geodesic: true,
      strokeColor: resolvedTheme === 'dark' ? '#2dd4bf' : '#0f766e',
      strokeOpacity: isFallback ? 0.7 : 0.98,
      strokeWeight: 5,
      zIndex: 11,
      map,
    });

    return () => {
      casing.setMap(null);
      line.setMap(null);
    };
  }, [map, path, isFallback, resolvedTheme]);

  return null;
}

export function SpecialistMap({
  origin,
  specialists,
  selectedId,
  inspectedSpecialist = null,
  inspectedRank = 1,
  isLoadingDetails = false,
  hoveredId,
  syncedIds,
  travelMode,
  mapViewMode,
  camera3DView,
  resolvedTheme,
  hideSecondaryControlsOnMobile = false,
  sidebarCollapsed = false,
  onToggleTheme,
  onChangeCamera3DView,
  onSelectSpecialist,
  onOpenDetails,
  onCloseDetails,
  onToggleSyncId,
  onAskQuestion,
  onRequestPlaceDetails,
  onChangeTravelMode,
  onChangeMapViewMode,
  onRouteMetricsUpdate,
}: SpecialistMapProps) {
  const isLoaded = useApiIsLoaded();
  const loadingStatus = useApiLoadingStatus();
  const stageRef = useRef<HTMLDivElement | null>(null);

  const [recenterSignal, setRecenterSignal] = useState(0);
  // Keep main Vector view strictly orthogonal (tilt: 0, heading: 0) until user opts into Tilt
  const [vectorTilted, setVectorTilted] = useState(false);
  const [stageSize, setStageSize] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
    viewportWidth: typeof window !== 'undefined' ? window.innerWidth : 1280,
  }));

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const vw = typeof window !== 'undefined' ? window.innerWidth : Math.round(rect.width);
      if (rect.width > 0 && rect.height > 0) {
        setStageSize((prev) =>
          Math.abs(prev.width - rect.width) < 1 &&
          Math.abs(prev.height - rect.height) < 1 &&
          prev.viewportWidth === vw
            ? prev
            : { width: Math.round(rect.width), height: Math.round(rect.height), viewportWidth: vw }
        );
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(updateSize);
      ro.observe(el);
      return () => {
        ro.disconnect();
        window.removeEventListener('resize', updateSize);
      };
    }

    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const selectedSpecialist =
    specialists.find((s) => s.id === selectedId) ?? null;

  const { routePath, metrics, isFallback } = useActiveRoute({
    origin: origin ? { lat: origin.lat, lng: origin.lng } : null,
    destinationId: selectedSpecialist?.id ?? null,
    destination: selectedSpecialist?.location ?? null,
    travelMode,
    onMetrics: onRouteMetricsUpdate,
  });

  // Map container sits cleanly beside desktop rail and above mobile sheet (zero Google logo overlap)
  const framing: ViewportFraming = useMemo(() => {
    const isDesktop = stageSize.viewportWidth >= 1024;
    return {
      widthPx: stageSize.width,
      heightPx: stageSize.height,
      leftInsetPx: isDesktop && inspectedSpecialist ? 384 : 0,
      bottomInsetPx: isDesktop && selectedSpecialist ? 96 : 36,
      topInsetPx: 68,
    };
  }, [
    stageSize.width,
    stageSize.height,
    stageSize.viewportWidth,
    selectedSpecialist,
    inspectedSpecialist,
  ]);

  const pointsList = useMemo(
    () => specialists.map((s) => s.location),
    [specialists]
  );

  const pointsKey = useMemo(
    () =>
      specialists
        .map((s) => `${s.id}:${s.location.lat.toFixed(5)},${s.location.lng.toFixed(5)}`)
        .join('|'),
    [specialists]
  );

  // Seed initial Vector camera on theme remount so the map stays on the active city
  const initialVectorCamera = useMemo(
    () =>
      computeVectorCameraTarget({
        origin: origin ? { lat: origin.lat, lng: origin.lng } : null,
        points: pointsList,
        focused: selectedSpecialist?.location ?? null,
        tilted: vectorTilted,
        framing,
        fallbackCenter: SHOWCASE_CONFIG.defaultCenter,
      }),
    // Recompute seed only when map color scheme remounts
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolvedTheme]
  );

  const syncedSet = useMemo(() => new Set(syncedIds), [syncedIds]);

  const activeDuration =
    metrics?.durationSeconds ?? selectedSpecialist?.travelDurationSeconds ?? null;
  const activeDistance =
    metrics?.distanceMeters ?? selectedSpecialist?.distanceMeters ?? null;

  const directionsHref = buildPlaceDirectionsUrl(origin, selectedSpecialist, travelMode);

  const mapColorScheme = resolvedTheme === 'dark' ? 'DARK' : 'LIGHT';
  const mapHasFailed =
    loadingStatus === APILoadingStatus.FAILED ||
    loadingStatus === APILoadingStatus.AUTH_FAILURE;

  return (
    <div
      ref={stageRef}
      className="relative w-full h-full bg-[var(--bg)] overflow-clip"
      data-testid="map-stage"
      data-map-view={mapViewMode}
    >
      {mapHasFailed ? (
        <div className="flex items-center justify-center w-full h-full bg-[var(--bg)] p-8 text-center">
          <div className="max-w-xs space-y-1.5">
            <h2 className="text-sm font-semibold text-[var(--ink)]">Map unavailable</h2>
            <p className="text-xs text-[var(--muted)]">
              Check your network or Google Maps API key.
            </p>
          </div>
        </div>
      ) : mapViewMode === '3d' ? (
        <PhotorealisticMap3D
          origin={origin}
          specialists={specialists}
          selectedId={selectedId}
          syncedIds={syncedIds}
          routePath={routePath}
          framing={framing}
          recenterSignal={recenterSignal}
          camera3DView={camera3DView}
          onCamera3DViewChange={onChangeCamera3DView}
          onSelectSpecialist={onSelectSpecialist}
          onSwitchToVector={() => onChangeMapViewMode('vector')}
        />
      ) : (
        <GoogleMap
          key={mapColorScheme}
          mapId="DEMO_MAP_ID"
          renderingType={RenderingType.VECTOR}
          colorScheme={mapColorScheme}
          defaultCenter={initialVectorCamera.center}
          defaultZoom={initialVectorCamera.zoom}
          defaultTilt={initialVectorCamera.tilt}
          defaultHeading={initialVectorCamera.heading}
          gestureHandling="greedy"
          disableDefaultUI
          clickableIcons={false}
          internalUsageAttributionIds={[...SHOWCASE_CONFIG.attributionIds]}
          className="w-full h-full"
          onClick={() => onSelectSpecialist(null)}
        >
          <VectorCameraController
            originLat={origin?.lat ?? null}
            originLng={origin?.lng ?? null}
            points={pointsList}
            pointsKey={pointsKey}
            selectedId={selectedId}
            focusedLat={selectedSpecialist?.location.lat ?? null}
            focusedLng={selectedSpecialist?.location.lng ?? null}
            tilted={vectorTilted}
            framing={framing}
            recenterSignal={recenterSignal}
          />

          <VectorRouteOverlay
            path={routePath}
            isFallback={isFallback}
            resolvedTheme={resolvedTheme}
          />

          {/* High-Contrast Anchored User Origin Marker */}
          {origin && (
            <AdvancedMarker
              position={{ lat: origin.lat, lng: origin.lng }}
              title={`Start: ${origin.label}`}
              zIndex={48}
            >
              <div className="flex flex-col items-center pointer-events-none select-none">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#0f172a] text-white border-2 border-white shadow-[0_6px_16px_rgba(15,23,42,0.45)] text-[11px] font-bold tracking-tight whitespace-nowrap">
                  <span className="h-2 w-2 rounded-full bg-[#2dd4bf] shrink-0" />
                  <span>Start</span>
                </div>
                <div
                  className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-[#0f172a] -mt-px"
                  aria-hidden="true"
                />
                <span className="relative flex items-center justify-center mt-0.5">
                  <span className="h-6 w-6 rounded-full bg-[#14b8a6]/30 flex items-center justify-center">
                    <span className="h-3 w-3 rounded-full bg-[#0f172a] border-2 border-white shadow-sm" />
                  </span>
                </span>
              </div>
            </AdvancedMarker>
          )}

          {/* High-Contrast Anchored Specialist Callout Pins (pointer caret + ground anchor dot) */}
          {specialists.map((specialist, index) => {
            const rank = index + 1;
            const isSelected = specialist.id === selectedId;
            const isHovered = specialist.id === hoveredId;
            const isSynced = syncedSet.has(specialist.id);
            const isTopThree = rank <= 3;

            const badgeTone = isSelected
              ? 'bg-[#0f766e] text-white border-2 border-white shadow-[0_8px_22px_rgba(15,23,42,0.45)] scale-105'
              : isSynced
                ? 'bg-[#1e1b4b] text-white border-2 border-[#fbbf24] shadow-[0_6px_18px_rgba(15,23,42,0.42)] hover:scale-105'
                : isTopThree
                  ? 'bg-[#0f172a] text-white border-2 border-white shadow-[0_6px_18px_rgba(15,23,42,0.42)] hover:scale-105'
                  : 'bg-white text-[#0f172a] border-2 border-[#0f172a] shadow-[0_5px_14px_rgba(15,23,42,0.3)] hover:scale-105';

            const caretColor = isSelected
              ? 'border-t-[#0f766e]'
              : isSynced
                ? 'border-t-[#1e1b4b]'
                : isTopThree
                  ? 'border-t-[#0f172a]'
                  : 'border-t-[#0f172a]';

            const dotBg = isSelected
              ? 'bg-[#0f766e]'
              : isSynced
                ? 'bg-[#fbbf24]'
                : 'bg-[#0f172a]';

            return (
              <AdvancedMarker
                key={specialist.id}
                position={specialist.location}
                title={`#${rank} ${specialist.name} · ${formatTravelTime(specialist.travelDurationSeconds)}`}
                zIndex={isSelected ? 60 : isHovered ? 52 : isSynced ? 44 : 38 - index}
                onClick={() => onSelectSpecialist(specialist.id)}
              >
                <div
                  className={`flex flex-col items-center cursor-pointer select-none transition-transform duration-150 ${
                    isHovered && !isSelected ? 'scale-105' : ''
                  }`}
                >
                  <div
                    className={`rounded-xl px-2 py-1.5 text-xs font-semibold tabular-nums transition-transform duration-150 ${badgeTone}`}
                  >
                    <div className="flex items-center gap-1.5 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center justify-center min-w-[20px] h-[20px] px-1 rounded-full font-mono text-[10px] font-bold leading-none ${
                          isSelected
                            ? 'bg-white text-[#0f766e]'
                            : isSynced
                              ? 'bg-[#fbbf24] text-[#0f172a]'
                              : isTopThree
                                ? 'bg-[#14b8a6] text-[#042f2e]'
                                : 'bg-[#0f172a] text-white'
                        }`}
                      >
                        {isSynced ? (
                          <Check className="w-3 h-3 stroke-[3]" aria-hidden="true" />
                        ) : (
                          `#${rank}`
                        )}
                      </span>
                      <span className="font-bold tracking-tight">
                        {formatTravelTime(specialist.travelDurationSeconds)}
                      </span>
                      {(isSelected || isHovered || isTopThree) && specialist.rating != null && (
                        <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold">
                          <Star
                            className="w-2.5 h-2.5 fill-[#fbbf24] text-[#fbbf24] shrink-0"
                            aria-hidden="true"
                          />
                          <span>{specialist.rating.toFixed(1)}</span>
                        </span>
                      )}
                    </div>
                    {isSelected && (
                      <div className="mt-0.5 max-w-[164px] truncate text-[10px] font-medium text-white/95 leading-tight">
                        {specialist.name}
                      </div>
                    )}
                  </div>
                  <div
                    className={`w-0 h-0 border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent -mt-px ${caretColor}`}
                    aria-hidden="true"
                  />
                  <span className="relative flex items-center justify-center mt-0.5">
                    {isSelected && (
                      <span className="absolute h-5 w-5 rounded-full bg-[#14b8a6]/35 animate-ping" />
                    )}
                    <span
                      className={`relative h-2.5 w-2.5 rounded-full border-2 border-white shadow-sm ${dotBg}`}
                    />
                  </span>
                </div>
              </AdvancedMarker>
            );
          })}
        </GoogleMap>
      )}

      {!isLoaded && !mapHasFailed && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--bg)]/80">
          <span className="text-sm font-medium text-[var(--muted)]">Loading map...</span>
        </div>
      )}

      {/* Top-Right Responsive Map Toolbar (2 compact rows below xl; 1 row on wide desktops) */}
      <div className="absolute top-3 right-3 sm:top-4 sm:right-4 z-20 flex flex-col xl:flex-row items-end xl:items-center gap-1.5 sm:gap-2 max-w-[calc(100vw-1.5rem)]">
        {/* Primary Row: Vector/3D + Travel Mode + Theme */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div
            role="group"
            aria-label="Map view mode"
            className="flex items-center p-0.5 bg-[var(--surface)]/95 border border-[var(--line)] rounded-xl shadow-sm"
          >
            <button
              type="button"
              onClick={() => onChangeMapViewMode('vector')}
              aria-pressed={mapViewMode === 'vector'}
              className={`inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[34px] px-2.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] ${
                mapViewMode === 'vector'
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)] border-[var(--accent)]'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-subtle)]'
              }`}
            >
              <MapIcon className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Vector</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeMapViewMode('3d')}
              aria-pressed={mapViewMode === '3d'}
              className={`inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[34px] px-2.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] ${
                mapViewMode === '3d'
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)] border-[var(--accent)]'
                  : 'border-transparent text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-subtle)]'
              }`}
            >
              <Box className="w-3.5 h-3.5" aria-hidden="true" />
              <span>3D</span>
            </button>
          </div>

          <div
            role="group"
            aria-label="Travel mode"
            className="flex items-center p-0.5 bg-[var(--surface)]/95 border border-[var(--line)] rounded-xl shadow-sm"
          >
            {(
              [
                { id: 'DRIVE', label: 'Drive', Icon: Car },
                { id: 'WALK', label: 'Walk', Icon: Footprints },
                { id: 'BICYCLE', label: 'Bike', Icon: Bike },
              ] as const
            ).map(({ id, label, Icon }) => {
              const active = travelMode === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onChangeTravelMode(id)}
                  aria-pressed={active}
                  aria-label={label}
                  title={label}
                  className={`inline-flex items-center justify-center gap-1.5 min-h-[44px] min-w-[44px] sm:min-h-[34px] sm:min-w-0 sm:px-2.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] ${
                    active
                      ? 'bg-[var(--accent)] text-[var(--accent-ink)] border-[var(--accent)]'
                      : 'border-transparent text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-subtle)]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            title={resolvedTheme === 'dark' ? 'Light theme' : 'Dark theme'}
            className="flex items-center justify-center min-h-[44px] min-w-[44px] sm:min-h-[38px] sm:min-w-[38px] bg-[var(--surface)]/95 border border-[var(--line)] rounded-xl shadow-sm text-[var(--ink)] hover:border-[var(--accent)] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
          >
            {resolvedTheme === 'dark' ? (
              <Sun className="w-4 h-4" aria-hidden="true" />
            ) : (
              <Moon className="w-4 h-4" aria-hidden="true" />
            )}
          </button>
        </div>

        {/* Camera Actions Row (drops cleanly below on < sm; inline on sm+) */}
        {(origin || specialists.length > 0) && (
          <div
            className={`${hideSecondaryControlsOnMobile ? 'hidden lg:flex' : 'flex'} items-center gap-1.5`}
          >
            {mapViewMode === 'vector' && selectedSpecialist && specialists.length > 1 && (
              <button
                type="button"
                onClick={() => onSelectSpecialist(null)}
                aria-label="Show all results and starting location"
                title="Show all results"
                className="inline-flex items-center justify-center min-h-[44px] sm:min-h-[38px] px-3 sm:px-2.5 text-xs font-medium rounded-xl border shadow-sm bg-[var(--surface)]/95 text-[var(--ink)] border-[var(--line)] hover:border-[var(--accent)] transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
              >
                All
              </button>
            )}

            {mapViewMode === 'vector' && selectedSpecialist && (
              <button
                type="button"
                onClick={() => setVectorTilted((v) => !v)}
                aria-pressed={vectorTilted}
                title={vectorTilted ? 'Switch to top-down 2D' : 'Tilt camera for 3D buildings'}
                className={`inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[38px] px-3 sm:px-2.5 text-xs font-medium rounded-xl border shadow-sm transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] ${
                  vectorTilted
                    ? 'bg-[var(--accent)] text-[var(--accent-ink)] border-[var(--accent)]'
                    : 'bg-[var(--surface)]/95 text-[var(--ink)] border-[var(--line)] hover:border-[var(--accent)]'
                }`}
              >
                <Compass className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Tilt</span>
              </button>
            )}

            {/* 3D Camera Views (Route corridor, Street close-up, Aerial sweep, and 360° Orbit) */}
            {mapViewMode === '3d' && (
              <div
                role="group"
                aria-label="3D camera view"
                className="flex items-center p-0.5 bg-[var(--surface)]/95 border border-[var(--line)] rounded-xl shadow-sm"
              >
                {(
                  [
                    { id: 'corridor', label: 'Route' },
                    { id: 'street', label: 'Street' },
                    { id: 'overview', label: 'Aerial' },
                  ] as const
                ).map(({ id, label }) => {
                  const active = camera3DView === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        onChangeCamera3DView(id);
                        setRecenterSignal((n) => n + 1);
                      }}
                      aria-pressed={active}
                      className={`inline-flex items-center justify-center min-h-[44px] sm:min-h-[34px] px-2.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] ${
                        active
                          ? 'bg-[var(--accent)] text-[var(--accent-ink)] border-[var(--accent)]'
                          : 'border-transparent text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-subtle)]'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
                {selectedSpecialist && (
                  <button
                    type="button"
                    onClick={() =>
                      onChangeCamera3DView(camera3DView === 'orbit' ? 'street' : 'orbit')
                    }
                    aria-pressed={camera3DView === 'orbit'}
                    aria-label={`Orbit ${selectedSpecialist.name} in 3D`}
                    title="Orbit selected place"
                    className={`inline-flex items-center justify-center gap-1 min-h-[44px] sm:min-h-[34px] px-2.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] ${
                      camera3DView === 'orbit'
                        ? 'bg-[var(--accent)] text-[var(--accent-ink)] border-[var(--accent)]'
                        : 'border-transparent text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-subtle)]'
                    }`}
                  >
                    <Orbit className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{camera3DView === 'orbit' ? 'Stop' : 'Orbit'}</span>
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                if (mapViewMode === '3d' && (camera3DView === 'free' || camera3DView === 'orbit')) {
                  onChangeCamera3DView('corridor');
                }
                setRecenterSignal((n) => n + 1);
              }}
              aria-label="Recenter camera"
              title="Recenter"
              className="flex items-center justify-center min-h-[44px] min-w-[44px] sm:min-h-[38px] sm:min-w-[38px] bg-[var(--surface)]/95 border border-[var(--line)] rounded-xl shadow-sm text-[var(--ink)] hover:border-[var(--accent)] active:scale-95 transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
            >
              <Crosshair className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {/* Desktop Side-by-Side Place Inspector Drawer (stays strictly above bottom-left Google logo) */}
      {inspectedSpecialist && (
        <aside
          aria-label={`Place details for ${inspectedSpecialist.name}`}
          data-testid="desktop-place-inspector"
          className={`hidden lg:flex flex-col absolute ${
            sidebarCollapsed ? 'top-16' : 'top-4'
          } left-4 bottom-12 w-[364px] max-w-[calc(100%-22rem)] z-30 rounded-xl shadow-xl border border-[var(--line)] bg-[var(--surface)] overflow-hidden`}
        >
          <div className="flex-1 agent-scroll">
            <PlaceDetailView
              specialist={inspectedSpecialist}
              rank={inspectedRank}
              origin={origin}
              travelMode={travelMode}
              isSynced={syncedSet.has(inspectedSpecialist.id)}
              isLoadingDetails={isLoadingDetails}
              backLabel="Close details"
              onBack={onCloseDetails}
              onToggleSync={(id) => onToggleSyncId?.(id)}
              onAskQuestion={onAskQuestion}
              onRequestDetails={onRequestPlaceDetails}
            />
          </div>
        </aside>
      )}

      {/* Desktop Bottom-Right Active Route Chip (lifted above Google Maps attribution bar) */}
      {selectedSpecialist && (
        <div
          className="hidden lg:flex absolute bottom-8 right-4 z-20 items-center gap-3 px-3.5 py-2.5 bg-[var(--surface)]/95 border border-[var(--line)] rounded-xl shadow-md max-w-lg"
          data-testid="active-route-bar"
        >
          <div className="min-w-0">
            <p className="text-xs font-semibold text-[var(--ink)] truncate">
              {selectedSpecialist.name}
            </p>
            <div className="flex items-center gap-1.5 text-xs text-[var(--muted)] tabular-nums mt-0.5">
              {activeDuration != null && (
                <span className="font-semibold text-[var(--accent-text)]">
                  {formatTravelTime(activeDuration)} {getTravelModeVerb(travelMode)}
                </span>
              )}
              {activeDistance != null && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{formatDistance(activeDistance)}</span>
                </>
              )}
              {selectedSpecialist.rating != null && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{selectedSpecialist.rating.toFixed(1)}★</span>
                </>
              )}
              {selectedSpecialist.openNow != null && (
                <>
                  <span aria-hidden="true">·</span>
                  <span
                    className="font-semibold"
                    style={{
                      color: selectedSpecialist.openNow
                        ? 'var(--status-open)'
                        : 'var(--status-closed)',
                    }}
                  >
                    {selectedSpecialist.openNow ? 'Open' : 'Closed'}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {onOpenDetails && (
              <button
                type="button"
                onClick={() => onOpenDetails(selectedSpecialist.id)}
                className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg bg-[var(--surface-subtle)] hover:bg-[var(--accent-soft)] text-[var(--ink)] border border-[var(--control-line)] hover:border-[var(--accent)] active:scale-[0.98] transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              >
                <Info className="w-3.5 h-3.5 text-[var(--accent-text)]" aria-hidden="true" />
                <span>Details</span>
              </button>
            )}
            {directionsHref && (
              <a
                href={directionsHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] hover:opacity-90 active:scale-[0.98] transition-opacity whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
              >
                <Navigation className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Route</span>
                <span className="sr-only"> to {selectedSpecialist.name}</span>
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
