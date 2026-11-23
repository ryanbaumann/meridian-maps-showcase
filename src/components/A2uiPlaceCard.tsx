import { useEffect, useRef, useState } from 'react';
import { A2UIRenderer } from '@googlemaps/a2ui/lit';
import { useApiIsLoaded } from '@vis.gl/react-google-maps';
import {
  Check,
  ChevronRight,
  Clock,
  Navigation,
  Star,
} from 'lucide-react';
import type { ResolvedTheme } from '../hooks/useTheme.ts';
import type { OriginLocation, Specialist, TravelMode } from '../types.ts';
import { getTodayHoursSummary } from '../utils/agentLogic.ts';
import {
  buildA2uiPlaceSurfaceMessages,
  isValidGooglePlaceId,
  toGoogleMapsUrlTravelMode,
} from '../utils/mapsSync.ts';
import { formatDistance, formatTravelTime } from '../utils/ranking.ts';
import { safeExternalUrl } from '../utils/url.ts';

interface A2uiPlaceCardProps {
  specialist: Specialist;
  rank: number;
  origin: OriginLocation | null;
  travelMode: TravelMode;
  resolvedTheme: ResolvedTheme;
  isFocused: boolean;
  isSynced: boolean;
  onFocus: (id: string) => void;
  onOpenDetails: (id: string) => void;
  onHover: (id: string | null) => void;
  onToggleSync: (id: string) => void;
}

function getTravelModeShortLabel(mode: TravelMode): string {
  if (mode === 'WALK') return 'walk';
  if (mode === 'BICYCLE') return 'bike';
  return 'drive';
}

/**
 * Decision-ready specialist card powered by Google Maps A2UI (`@googlemaps/a2ui`
 * `<a2ui-surface>` rendering `PlaceDetailsCompact` -> `<gmp-place-details-compact>`).
 * Surfaces rating + review count, live travel time, explicit open/closed hours,
 * and a concise review quote at a glance, with a single "More details" affordance
 * for full hours, rating breakdown, and reviews.
 */
export function A2uiPlaceCard({
  specialist,
  rank,
  origin,
  travelMode,
  resolvedTheme,
  isFocused,
  isSynced,
  onFocus,
  onOpenDetails,
  onHover,
  onToggleSync,
}: A2uiPlaceCardProps) {
  const surfaceHostRef = useRef<HTMLDivElement | null>(null);
  const surfaceElRef = useRef<(HTMLElement & { surface?: unknown }) | null>(null);

  const apiIsLoaded = useApiIsLoaded();
  const hasValidPlaceId = isValidGooglePlaceId(specialist.id);
  const [a2uiFailed, setA2uiFailed] = useState(!hasValidPlaceId);
  const [photoErrored, setPhotoErrored] = useState(false);
  const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 395 ? 'vertical' : 'horizontal'
  );

  useEffect(() => {
    setPhotoErrored(false);
  }, [specialist.photo?.photoUrl]);

  // Keep Google Places UI Kit thumbnail visible: switch to vertical below 350px host width
  useEffect(() => {
    const hostEl = surfaceHostRef.current;
    if (!hostEl || typeof ResizeObserver === 'undefined') return;

    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width <= 0) return;
      const next: 'horizontal' | 'vertical' = width < 350 ? 'vertical' : 'horizontal';
      setOrientation((prev) => (prev === next ? prev : next));
    });
    ro.observe(hostEl);
    return () => ro.disconnect();
  }, [a2uiFailed]);

  // Mount @googlemaps/a2ui surface once Google Maps JS API is loaded
  useEffect(() => {
    if (!hasValidPlaceId) {
      setA2uiFailed(true);
      return;
    }
    if (!apiIsLoaded) return;

    setA2uiFailed(false);

    const surfaceEl = surfaceElRef.current;
    const hostEl = surfaceHostRef.current;
    if (!surfaceEl || !hostEl) return;

    const surfaceId = `place_card_${specialist.id}_${orientation}`;
    const renderer = new A2UIRenderer();
    const messages = buildA2uiPlaceSurfaceMessages(surfaceId, specialist.id, orientation);

    try {
      renderer.processResponse(
        messages.map((message) => ({ type: 'a2ui' as const, message }))
      );
      const surface = renderer.getSurface(surfaceId);
      if (surface) {
        surfaceEl.surface = surface;
      } else {
        setA2uiFailed(true);
        return;
      }
    } catch {
      setA2uiFailed(true);
      return;
    }

    const onErrorEvent = () => setA2uiFailed(true);
    hostEl.addEventListener('gmp-error', onErrorEvent, true);

    let checkTimer: number | null = null;
    const scheduleHeightCheck = () => {
      if (checkTimer != null) return;
      checkTimer = window.setTimeout(() => {
        checkTimer = null;
        if (hostEl.offsetParent === null) return;
        const rect = hostEl.getBoundingClientRect();
        if (rect.height < 40) {
          setA2uiFailed(true);
        }
      }, 5000);
    };

    let observer: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          scheduleHeightCheck();
          observer?.disconnect();
        }
      });
      observer.observe(hostEl);
    } else {
      scheduleHeightCheck();
    }

    return () => {
      if (checkTimer != null) window.clearTimeout(checkTimer);
      observer?.disconnect();
      hostEl.removeEventListener('gmp-error', onErrorEvent, true);
    };
  }, [specialist.id, orientation, hasValidPlaceId, apiIsLoaded]);

  const directionsHref =
    safeExternalUrl(specialist.directionsUri) ||
    (origin
      ? `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${specialist.location.lat},${specialist.location.lng}&travelmode=${toGoogleMapsUrlTravelMode(travelMode)}`
      : safeExternalUrl(specialist.googleMapsUri));

  const primaryAttribution = specialist.photo?.authorAttributions?.[0];
  const todayHours = getTodayHoursSummary(specialist.weekdayDescriptions);
  const leadReview =
    (specialist.topReviews && specialist.topReviews.length > 0
      ? specialist.topReviews[0]
      : specialist.reviews?.[0]) ?? null;
  const leadReviewSnippet = leadReview
    ? leadReview.text.length > 105
      ? `${leadReview.text.slice(0, 104).trimEnd()}…`
      : leadReview.text
    : null;

  return (
    <article
      data-testid={`specialist-card-${rank}`}
      onMouseEnter={() => onHover(specialist.id)}
      onMouseLeave={() => onHover(null)}
      className={`rounded-xl border p-2.5 transition-colors ${
        isFocused
          ? 'bg-[var(--accent-soft)] border-[var(--accent)]'
          : isSynced
            ? 'bg-[var(--surface)] border-[var(--ink)]'
            : 'bg-[var(--surface)] border-[var(--line)] hover:border-[var(--muted)]/60'
      }`}
    >
      {/* Metric Header: Shortlist + Rank + Travel + Rating */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            role="checkbox"
            aria-checked={isSynced}
            aria-label={`Shortlist ${specialist.name} for Google Maps`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleSync(specialist.id);
            }}
            className={`relative before:absolute before:-inset-3 sm:before:-inset-2 flex items-center justify-center w-5 h-5 rounded border transition-colors shrink-0 cursor-pointer active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] ${
              isSynced
                ? 'bg-[var(--ink)] border-[var(--ink)] text-[var(--surface)]'
                : 'bg-[var(--surface)] border-[var(--control-line)] text-transparent hover:border-[var(--accent)]'
            }`}
          >
            <Check className="w-3 h-3 stroke-[2.75]" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => onFocus(specialist.id)}
            aria-label={`Focus #${rank} ${specialist.name} on map`}
            className="flex items-center gap-1.5 min-w-0 min-h-[44px] sm:min-h-[28px] text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] rounded"
          >
            <span
              className={`font-mono text-xs font-semibold tabular-nums shrink-0 ${
                isFocused ? 'text-[var(--accent-text)]' : 'text-[var(--muted)]'
              }`}
            >
              {String(rank).padStart(2, '0')}
            </span>
            <span className="font-mono text-xs font-semibold text-[var(--accent-text)] tabular-nums whitespace-nowrap">
              {formatTravelTime(specialist.travelDurationSeconds)}
            </span>
            <span aria-hidden="true" className="text-[var(--muted)] text-xs opacity-50">
              ·
            </span>
            <span className="text-xs text-[var(--muted)] tabular-nums truncate">
              {formatDistance(specialist.distanceMeters)}{' '}
              {getTravelModeShortLabel(travelMode)}
            </span>
          </button>
        </div>

        {specialist.rating != null && (
          <div className="inline-flex items-center gap-1 text-xs font-medium text-[var(--ink)] tabular-nums whitespace-nowrap shrink-0">
            <Star className="w-3 h-3 fill-amber-500 text-amber-500 shrink-0" aria-hidden="true" />
            <span>{specialist.rating.toFixed(1)}</span>
            {specialist.userRatingCount > 0 && (
              <span className="text-[11px] font-normal text-[var(--muted)]">
                ({specialist.userRatingCount.toLocaleString()})
              </span>
            )}
          </div>
        )}
      </div>

      {/* Main Official @googlemaps/a2ui PlaceDetailsCompact Surface */}
      <div
        onClick={() => onFocus(specialist.id)}
        className="cursor-pointer"
        data-a2ui-status={a2uiFailed ? 'fallback' : 'active'}
      >
        {!a2uiFailed && apiIsLoaded ? (
          <div
            ref={surfaceHostRef}
            className="w-full overflow-clip rounded-lg"
            style={{
              colorScheme: resolvedTheme,
              ['--color-scheme' as string]: resolvedTheme,
              ['--gmp-card-border-radius' as string]: '8px',
              ['--gmp-card-border' as string]: 'none',
              ['--gmp-card-box-shadow' as string]: 'none',
              ['--gmp-mat-color-surface' as string]: 'transparent',
              ['--gmp-mat-color-outline-decorative' as string]: 'transparent',
            }}
          >
            <a2ui-surface ref={surfaceElRef} />
          </div>
        ) : (
          <div className="flex items-start gap-2.5 py-0.5">
            {specialist.photo?.photoUrl && !photoErrored && (
              <div className="w-20 h-16 rounded-lg overflow-clip bg-[var(--surface-subtle)] border border-[var(--line)] shrink-0">
                <img
                  src={specialist.photo.photoUrl}
                  alt={specialist.name}
                  width={80}
                  height={64}
                  loading="lazy"
                  decoding="async"
                  fetchPriority={rank === 1 ? 'auto' : 'low'}
                  referrerPolicy="no-referrer"
                  onError={() => setPhotoErrored(true)}
                  className="w-full h-full object-cover block"
                />
              </div>
            )}

            <div className="flex-1 min-w-0 space-y-0.5">
              <h3 className="text-sm font-semibold text-[var(--ink)] leading-snug line-clamp-1">
                {specialist.name}
              </h3>
              <p className="text-xs text-[var(--muted)] truncate">{specialist.specialty}</p>
              {specialist.address && (
                <p className="text-xs text-[var(--muted)] truncate">{specialist.address}</p>
              )}
              {specialist.photo?.photoUrl && !photoErrored && primaryAttribution && (
                <p className="text-[11px] text-[var(--muted)] truncate">
                  Photo:{' '}
                  {safeExternalUrl(primaryAttribution.uri) ? (
                    <a
                      href={safeExternalUrl(primaryAttribution.uri)}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="hover:underline focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded"
                    >
                      {primaryAttribution.displayName}
                    </a>
                  ) : (
                    <span>{primaryAttribution.displayName}</span>
                  )}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Decision Context: Open Status + Today's Hours + Review Excerpt */}
      <div className="mt-2 pt-2 border-t border-[var(--line)]/80 space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs tabular-nums min-w-0">
          <Clock className="w-3 h-3 shrink-0 text-[var(--muted)] opacity-80" aria-hidden="true" />
          {specialist.openNow !== null && (
            <span
              className="font-semibold whitespace-nowrap shrink-0"
              style={{
                color: specialist.openNow ? 'var(--status-open)' : 'var(--muted)',
              }}
            >
              {specialist.openNow ? 'Open' : 'Closed'}
            </span>
          )}
          {specialist.openNow !== null && todayHours && (
            <span aria-hidden="true" className="text-[var(--muted)] opacity-50">
              ·
            </span>
          )}
          <span className="text-[var(--muted)] truncate">
            {todayHours ? `Today ${todayHours}` : specialist.address}
          </span>
        </div>

        {leadReviewSnippet && (
          <p className="text-[11px] text-[var(--muted)] leading-snug line-clamp-2">
            “{leadReviewSnippet}”
            {leadReview?.authorName ? ` — ${leadReview.authorName}` : ''}
          </p>
        )}

        <div className="flex items-center justify-between gap-2 pt-0.5 text-xs">
          {directionsHref ? (
            <a
              href={directionsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-[28px] font-semibold text-[var(--accent-text)] hover:underline whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] rounded"
            >
              <Navigation className="w-3 h-3" aria-hidden="true" />
              <span>Route</span>
              <span className="sr-only"> to {specialist.name}</span>
            </a>
          ) : (
            <span />
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onFocus(specialist.id);
              onOpenDetails(specialist.id);
            }}
            className="inline-flex items-center gap-0.5 min-h-[44px] sm:min-h-[28px] font-semibold text-[var(--ink)] hover:text-[var(--accent-text)] whitespace-nowrap cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] rounded"
          >
            <span>Hours, ratings &amp; reviews</span>
            <span className="sr-only"> for {specialist.name}</span>
            <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  );
}
