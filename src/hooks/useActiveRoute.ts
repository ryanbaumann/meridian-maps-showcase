import { useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import type { LatLng, TravelMode } from '../types.ts';

export interface RouteMetrics {
  durationSeconds: number;
  distanceMeters: number;
}

interface CachedRoute {
  path: LatLng[];
  durationSeconds?: number;
  distanceMeters?: number;
  isFallback: boolean;
}

export function mapTravelModeToSdk(mode: TravelMode): 'DRIVING' | 'WALKING' | 'BICYCLING' {
  if (mode === 'WALK') return 'WALKING';
  if (mode === 'BICYCLE') return 'BICYCLING';
  return 'DRIVING';
}

export function getTravelModeVerb(mode: TravelMode): string {
  if (mode === 'WALK') return 'walk';
  if (mode === 'BICYCLE') return 'bike';
  return 'drive';
}

/**
 * Computes and caches the active road/walk/bike route using the modern Maps JS Routes library
 * (`Route.computeRoutes`). Shared between Vector 2D and Photorealistic 3D maps so both views
 * render the same street-following route with zero duplicate API calls.
 */
export function useActiveRoute(opts: {
  origin: LatLng | null;
  destinationId: string | null;
  destination: LatLng | null;
  travelMode: TravelMode;
  onMetrics?: (id: string, durationSeconds: number, distanceMeters: number) => void;
}): {
  routePath: LatLng[];
  metrics: RouteMetrics | null;
  isFallback: boolean;
} {
  const { origin, destinationId, destination, travelMode, onMetrics } = opts;
  const routesLib = useMapsLibrary('routes');
  const cacheRef = useRef<Record<string, CachedRoute>>({});
  const onMetricsRef = useRef(onMetrics);
  onMetricsRef.current = onMetrics;

  const [routePath, setRoutePath] = useState<LatLng[]>([]);
  const [metrics, setMetrics] = useState<RouteMetrics | null>(null);
  const [isFallback, setIsFallback] = useState(false);

  const originLat = origin?.lat ?? null;
  const originLng = origin?.lng ?? null;
  const destLat = destination?.lat ?? null;
  const destLng = destination?.lng ?? null;

  useEffect(() => {
    if (
      originLat == null ||
      originLng == null ||
      !destinationId ||
      destLat == null ||
      destLng == null
    ) {
      setRoutePath([]);
      setMetrics(null);
      setIsFallback(false);
      return;
    }

    const fallbackPath: LatLng[] = [
      { lat: originLat, lng: originLng },
      { lat: destLat, lng: destLng },
    ];

    const cacheKey = `${originLat.toFixed(5)},${originLng.toFixed(5)}->${destinationId}:${travelMode}`;
    const cached = cacheRef.current[cacheKey];
    if (cached) {
      setRoutePath(cached.path);
      setIsFallback(cached.isFallback);
      if (cached.durationSeconds != null && cached.distanceMeters != null) {
        setMetrics({
          durationSeconds: cached.durationSeconds,
          distanceMeters: cached.distanceMeters,
        });
        onMetricsRef.current?.(destinationId, cached.durationSeconds, cached.distanceMeters);
      } else {
        setMetrics(null);
      }
      return;
    }

    if (!routesLib) {
      setRoutePath(fallbackPath);
      setMetrics(null);
      setIsFallback(true);
      return;
    }

    const routeCtor = (routesLib as unknown as {
      Route?: {
        computeRoutes?: (req: unknown) => Promise<{ routes?: Array<Record<string, unknown>> }>;
      };
    }).Route;

    if (!routeCtor?.computeRoutes) {
      setRoutePath(fallbackPath);
      setMetrics(null);
      setIsFallback(true);
      return;
    }

    let cancelled = false;

    routeCtor
      .computeRoutes({
        origin: { lat: originLat, lng: originLng },
        destination: { lat: destLat, lng: destLng },
        travelMode: mapTravelModeToSdk(travelMode),
        fields: ['path', 'distanceMeters', 'durationMillis', 'viewport'],
      })
      .then((res) => {
        if (cancelled) return;
        const primary = res?.routes?.[0] as
          | {
              path?: Array<google.maps.LatLng | LatLng>;
              distanceMeters?: number;
              durationMillis?: number;
            }
          | undefined;

        if (!primary || !Array.isArray(primary.path) || primary.path.length < 2) {
          setRoutePath(fallbackPath);
          setMetrics(null);
          setIsFallback(true);
          return;
        }

        const extractedPath: LatLng[] = primary.path.map((pt) => ({
          lat: typeof (pt as google.maps.LatLng).lat === 'function'
            ? (pt as google.maps.LatLng).lat()
            : (pt as LatLng).lat,
          lng: typeof (pt as google.maps.LatLng).lng === 'function'
            ? (pt as google.maps.LatLng).lng()
            : (pt as LatLng).lng,
        }));

        const durationSeconds =
          typeof primary.durationMillis === 'number'
            ? Math.round(primary.durationMillis / 1000)
            : undefined;
        const distanceMeters =
          typeof primary.distanceMeters === 'number' ? primary.distanceMeters : undefined;

        cacheRef.current[cacheKey] = {
          path: extractedPath,
          durationSeconds,
          distanceMeters,
          isFallback: false,
        };

        setRoutePath(extractedPath);
        setIsFallback(false);

        if (durationSeconds != null && distanceMeters != null) {
          setMetrics({ durationSeconds, distanceMeters });
          onMetricsRef.current?.(destinationId, durationSeconds, distanceMeters);
        } else {
          setMetrics(null);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('OVER_QUERY_LIMIT')) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        setRoutePath(fallbackPath);
        setMetrics(null);
        setIsFallback(true);
      });

    return () => {
      cancelled = true;
    };
  }, [routesLib, originLat, originLng, destinationId, destLat, destLng, travelMode]);

  return { routePath, metrics, isFallback };
}
