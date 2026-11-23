import { useEffect, useId, useRef, useState } from 'react';
import { A2UIRenderer } from '@googlemaps/a2ui/lit';
import {
  Box,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  Globe,
  MessageSquare,
  Navigation,
  Phone,
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
import { safeExternalUrl, safeTelHref } from '../utils/url.ts';

interface A2uiPlaceCardProps {
  specialist: Specialist;
  rank: number;
  origin: OriginLocation | null;
  travelMode: TravelMode;
  resolvedTheme: ResolvedTheme;
  isFocused: boolean;
  isSynced: boolean;
  defaultExpandedDetails?: boolean;
  onFocus: (id: string) => void;
  onInspectIn3D?: (id: string) => void;
  onHover: (id: string | null) => void;
  onToggleSync: (id: string) => void;
  onAskAboutClinic?: (specialist: Specialist) => void;
}

function getTravelModeShortLabel(mode: TravelMode): string {
  if (mode === 'WALK') return 'walk';
  if (mode === 'BICYCLE') return 'bike';
  return 'drive';
}

/**
 * Unified specialist card powered by Google Maps A2UI (`@googlemaps/a2ui`
 * `<a2ui-surface>` rendering `PlaceDetailsCompact` -> `<gmp-place-details-compact>`).
 * Uses a single outer border, switches to vertical layout below Google's 350px thumbnail
 * threshold on compact phones, and syncs natively with light/dark mode.
 */
export function A2uiPlaceCard({
  specialist,
  rank,
  origin,
  travelMode,
  resolvedTheme,
  isFocused,
  isSynced,
  defaultExpandedDetails = false,
  onFocus,
  onInspectIn3D,
  onHover,
  onToggleSync,
  onAskAboutClinic,
}: A2uiPlaceCardProps) {
  const detailsPanelId = useId();
  const surfaceHostRef = useRef<HTMLDivElement | null>(null);
  const surfaceElRef = useRef<(HTMLElement & { surface?: unknown }) | null>(null);

  const hasValidPlaceId = isValidGooglePlaceId(specialist.id);
  const [a2uiFailed, setA2uiFailed] = useState(!hasValidPlaceId);
  const [photoErrored, setPhotoErrored] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(defaultExpandedDetails);
  const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>(() =>
    typeof window !== 'undefined' && window.innerWidth < 395 ? 'vertical' : 'horizontal'
  );

  useEffect(() => {
    setPhotoErrored(false);
  }, [specialist.photo?.photoUrl]);

  useEffect(() => {
    if (defaultExpandedDetails) {
      setDetailsExpanded(true);
    }
  }, [defaultExpandedDetails]);

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

  // Mount @googlemaps/a2ui surface (keyed by specialist.id + orientation, not rank, so sorting never reloads)
  useEffect(() => {
    if (!hasValidPlaceId) {
      setA2uiFailed(true);
      return;
    }

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

    // Only verify rendered height once the card is actually visible (never fail while hidden in mobile peek)
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
  }, [specialist.id, orientation, hasValidPlaceId]);

  const directionsHref =
    safeExternalUrl(specialist.directionsUri) ||
    (origin
      ? `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${specialist.location.lat},${specialist.location.lng}&travelmode=${toGoogleMapsUrlTravelMode(travelMode)}`
      : safeExternalUrl(specialist.googleMapsUri));

  const primaryAttribution = specialist.photo?.authorAttributions?.[0];
  const todayHours = getTodayHoursSummary(specialist.weekdayDescriptions);
  const websiteHref = safeExternalUrl(specialist.websiteUri);
  const mapsHref = safeExternalUrl(specialist.googleMapsUri);
  const phoneHref = safeTelHref(specialist.phoneNumber);
  const hasRichDetails = Boolean(
    specialist.weekdayDescriptions?.length ||
      specialist.reviews?.length ||
      specialist.editorialSummary ||
      phoneHref ||
      websiteHref
  );

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
      {/* Compact Metric Header: Shortlist + Rank + Live Travel + Open Dot + 3D */}
      <div className="flex items-center justify-between gap-2 mb-2">
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
            className={`relative before:absolute before:-inset-2.5 sm:before:-inset-2 flex items-center justify-center w-6 h-6 rounded-md border transition-colors shrink-0 cursor-pointer active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] ${
              isSynced
                ? 'bg-[var(--ink)] border-[var(--ink)] text-[var(--surface)]'
                : 'bg-[var(--surface)] border-[var(--control-line)] text-transparent hover:border-[var(--accent)]'
            }`}
          >
            <Check className="w-3.5 h-3.5 stroke-[2.75]" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={() => onFocus(specialist.id)}
            aria-label={`Focus #${rank} ${specialist.name} on map`}
            className="flex items-center gap-1.5 min-w-0 min-h-[44px] sm:min-h-[32px] text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] rounded"
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
            <span aria-hidden="true" className="text-[var(--muted)] text-xs opacity-60">
              ·
            </span>
            <span className="text-xs text-[var(--muted)] tabular-nums truncate">
              {formatDistance(specialist.distanceMeters)}{' '}
              {getTravelModeShortLabel(travelMode)}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {specialist.openNow !== null && (
            <span
              className="inline-flex items-center gap-1 text-[11px] font-medium whitespace-nowrap"
              style={{
                color: specialist.openNow ? 'var(--status-open)' : 'var(--muted)',
              }}
            >
              <span
                aria-hidden="true"
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  backgroundColor: specialist.openNow ? 'var(--status-open)' : 'var(--muted)',
                }}
              />
              <span>{specialist.openNow ? 'Open' : 'Closed'}</span>
            </span>
          )}

          {onInspectIn3D && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onInspectIn3D(specialist.id);
              }}
              aria-label={`Inspect ${specialist.name} in 3D`}
              title="Fly to 3D"
              className="inline-flex items-center justify-center gap-1 min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:h-7 px-2.5 sm:px-2 rounded-md text-[11px] font-medium text-[var(--muted)] hover:text-[var(--ink)] bg-[var(--surface-subtle)] hover:bg-[var(--line)]/60 active:scale-[0.98] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
            >
              <Box className="w-3 h-3" aria-hidden="true" />
              <span>3D</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Official @googlemaps/a2ui PlaceDetailsCompact Surface */}
      <div
        onClick={() => onFocus(specialist.id)}
        className="cursor-pointer"
        data-a2ui-status={a2uiFailed ? 'fallback' : 'active'}
      >
        {!a2uiFailed ? (
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
          <div className="flex items-start gap-3 py-0.5">
            {specialist.photo?.photoUrl && !photoErrored && (
              <div className="w-24 h-20 rounded-lg overflow-clip bg-[var(--surface-subtle)] border border-[var(--line)] shrink-0">
                <img
                  src={specialist.photo.photoUrl}
                  alt={specialist.name}
                  width={96}
                  height={80}
                  loading="lazy"
                  decoding="async"
                  fetchPriority={rank === 1 ? 'auto' : 'low'}
                  referrerPolicy="no-referrer"
                  onError={() => setPhotoErrored(true)}
                  className="w-full h-full object-cover block"
                />
              </div>
            )}

            <div className="flex-1 min-w-0 space-y-1">
              <h2 className="text-sm font-semibold text-[var(--ink)] leading-snug line-clamp-1">
                {specialist.name}
              </h2>

              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-[var(--muted)] tabular-nums">
                {specialist.rating != null ? (
                  <span className="inline-flex items-center gap-0.5 font-medium text-[var(--ink)]">
                    <Star
                      className="w-3 h-3 fill-amber-500 text-amber-500"
                      aria-hidden="true"
                    />
                    {specialist.rating.toFixed(1)}
                    <span className="font-normal text-[var(--muted)] ml-0.5">
                      ({specialist.userRatingCount})
                    </span>
                  </span>
                ) : (
                  <span>No rating</span>
                )}
                <span aria-hidden="true" className="opacity-50">
                  ·
                </span>
                <span className="truncate">{specialist.specialty}</span>
              </div>

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

      {/* Minimal Footer Strip: Today's Hours + Route + Details Toggle */}
      <div className="mt-2 pt-2 border-t border-[var(--line)]/80 space-y-2">
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 min-w-0 text-[var(--muted)]">
            {todayHours ? (
              <span className="inline-flex items-center gap-1 truncate">
                <Clock className="w-3 h-3 shrink-0 opacity-75" aria-hidden="true" />
                <span className="truncate">{todayHours}</span>
              </span>
            ) : (
              specialist.address && <span className="truncate">{specialist.address}</span>
            )}
          </div>

          <div className="flex items-center gap-1 sm:gap-3 shrink-0">
            {directionsHref && (
              <a
                href={directionsHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-0 px-2 sm:px-0 font-semibold text-[var(--accent-text)] hover:underline whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] rounded"
              >
                <Navigation className="w-3 h-3" aria-hidden="true" />
                <span>Route</span>
                <span className="sr-only"> to {specialist.name}</span>
              </a>
            )}
            {hasRichDetails && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setDetailsExpanded((v) => !v);
                  onFocus(specialist.id);
                }}
                aria-expanded={detailsExpanded}
                aria-controls={detailsPanelId}
                className="inline-flex items-center gap-0.5 min-h-[44px] sm:min-h-0 px-2 sm:px-0 font-medium text-[var(--muted)] hover:text-[var(--ink)] whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] rounded"
              >
                <span>{detailsExpanded ? 'Less' : 'Details'}</span>
                <span className="sr-only"> for {specialist.name}</span>
                {detailsExpanded ? (
                  <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* On-Demand Provider Details Drawer */}
        {detailsExpanded && (
          <div
            id={detailsPanelId}
            className="pt-2 space-y-2 border-t border-[var(--line)]/80 text-xs text-[var(--ink)]"
          >
            {specialist.editorialSummary && (
              <p className="text-[var(--muted)] leading-relaxed">
                {specialist.editorialSummary}
              </p>
            )}

            {(specialist.topReviews?.length || specialist.reviews?.length) ? (
              <blockquote className="text-[var(--muted)] leading-relaxed">
                {(() => {
                  const rev =
                    (specialist.topReviews && specialist.topReviews.length > 0
                      ? specialist.topReviews[0]
                      : specialist.reviews?.[0])!;
                  const snippet =
                    rev.text.length > 160 ? `${rev.text.slice(0, 159)}…` : rev.text;
                  return (
                    <>
                      “{snippet}”
                      <footer className="mt-0.5 text-[11px] tabular-nums opacity-85">
                        {rev.authorName} · {rev.rating.toFixed(1)}★
                        {rev.relativePublishTime ? ` · ${rev.relativePublishTime}` : ''}
                      </footer>
                    </>
                  );
                })()}
              </blockquote>
            ) : null}

            {specialist.weekdayDescriptions && specialist.weekdayDescriptions.length > 0 && (
              <ul
                role="list"
                className="grid grid-cols-1 gap-0.5 text-[11px] text-[var(--muted)] tabular-nums"
              >
                {specialist.weekdayDescriptions.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap items-center gap-3 pt-0.5">
              {phoneHref && (
                <a
                  href={phoneHref}
                  className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-[32px] font-medium text-[var(--ink)] hover:underline whitespace-nowrap tabular-nums focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded"
                >
                  <Phone className="w-3.5 h-3.5 text-[var(--muted)]" aria-hidden="true" />
                  <span>{specialist.phoneNumber}</span>
                </a>
              )}
              {websiteHref && (
                <a
                  href={websiteHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-[32px] font-medium text-[var(--ink)] hover:underline whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded"
                >
                  <Globe className="w-3.5 h-3.5 text-[var(--muted)]" aria-hidden="true" />
                  <span>Website</span>
                  <span className="sr-only"> for {specialist.name}</span>
                </a>
              )}
              {mapsHref && (
                <a
                  href={mapsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-[32px] font-medium text-[var(--ink)] hover:underline whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-[var(--muted)]" aria-hidden="true" />
                  <span>Maps</span>
                  <span className="sr-only"> listing for {specialist.name}</span>
                </a>
              )}
              {onAskAboutClinic && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAskAboutClinic(specialist);
                  }}
                  className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-[32px] font-semibold text-[var(--accent-text)] hover:underline whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded"
                >
                  <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Ask</span>
                  <span className="sr-only"> about {specialist.name}</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
