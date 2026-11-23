import { useEffect, useState } from 'react';
import {
  Accessibility,
  ArrowLeft,
  Check,
  Clock,
  ExternalLink,
  Globe,
  MessageSquare,
  Navigation,
  Phone,
  Star,
} from 'lucide-react';
import type { OriginLocation, Specialist, TravelMode } from '../types.ts';
import { getTodayHoursSummary } from '../utils/agentLogic.ts';
import { toGoogleMapsUrlTravelMode } from '../utils/mapsSync.ts';
import { formatDistance, formatTravelTime } from '../utils/ranking.ts';
import { safeExternalUrl, safeTelHref } from '../utils/url.ts';

interface PlaceDetailViewProps {
  specialist: Specialist;
  rank: number;
  origin: OriginLocation | null;
  travelMode: TravelMode;
  isSynced: boolean;
  isLoadingDetails?: boolean;
  backLabel?: string;
  onBack?: () => void;
  onToggleSync: (id: string) => void;
  onAskAboutClinic?: (specialist: Specialist) => void;
  onRequestDetails?: (id: string) => void;
}

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

function getTravelModeShortLabel(mode: TravelMode): string {
  if (mode === 'WALK') return 'walk';
  if (mode === 'BICYCLE') return 'bike';
  return 'drive';
}

function splitWeekdayLine(line: string): { day: string; hours: string } {
  const idx = line.indexOf(':');
  if (idx < 0) return { day: line.trim(), hours: '' };
  return {
    day: line.slice(0, idx).trim(),
    hours: line.slice(idx + 1).trim(),
  };
}

/**
 * Next-level place detail view showing full star rating distribution,
 * 7-day opening hours schedule (today highlighted), real Google Maps reviews,
 * and direct contact/directions actions.
 */
export function PlaceDetailView({
  specialist,
  rank,
  origin,
  travelMode,
  isSynced,
  isLoadingDetails = false,
  backLabel,
  onBack,
  onToggleSync,
  onAskAboutClinic,
  onRequestDetails,
}: PlaceDetailViewProps) {
  const [photoErrored, setPhotoErrored] = useState(false);

  useEffect(() => {
    setPhotoErrored(false);
  }, [specialist.photo?.photoUrl]);

  useEffect(() => {
    if (!specialist.detailsLoaded && onRequestDetails) {
      onRequestDetails(specialist.id);
    }
  }, [specialist.id, specialist.detailsLoaded, onRequestDetails]);

  const todayName = DAY_NAMES[new Date().getDay()];
  const todayHours = getTodayHoursSummary(specialist.weekdayDescriptions);
  const reviews =
    specialist.reviews && specialist.reviews.length > 0
      ? specialist.reviews
      : specialist.topReviews ?? [];

  const directionsHref =
    safeExternalUrl(specialist.directionsUri) ||
    (origin
      ? `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${specialist.location.lat},${specialist.location.lng}&travelmode=${toGoogleMapsUrlTravelMode(travelMode)}`
      : safeExternalUrl(specialist.googleMapsUri));
  const websiteHref = safeExternalUrl(specialist.websiteUri);
  const mapsHref = safeExternalUrl(specialist.googleMapsUri);
  const phoneHref = safeTelHref(specialist.phoneNumber);
  const primaryAttribution = specialist.photo?.authorAttributions?.[0];

  return (
    <article
      data-testid={`place-detail-view-${rank}`}
      className="bg-[var(--surface)] rounded-xl border border-[var(--line)] overflow-clip"
    >
      {/* Sticky Navigation / Header Strip */}
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-3 py-2 bg-[var(--surface)]/95 backdrop-blur-xs border-b border-[var(--line)]">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-[30px] text-xs font-semibold text-[var(--accent-text)] hover:underline cursor-pointer whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded"
          >
            <ArrowLeft className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{backLabel || 'Back to options'}</span>
          </button>
        ) : (
          <span className="font-mono text-xs font-semibold text-[var(--muted)] tabular-nums">
            Option #{String(rank).padStart(2, '0')}
          </span>
        )}

        <button
          type="button"
          role="checkbox"
          aria-checked={isSynced}
          aria-label={`Shortlist ${specialist.name} for Google Maps`}
          onClick={() => onToggleSync(specialist.id)}
          className={`inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-[28px] px-2.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
            isSynced
              ? 'bg-[var(--ink)] text-[var(--surface)] border-[var(--ink)]'
              : 'bg-[var(--surface)] text-[var(--ink)] border-[var(--control-line)] hover:border-[var(--accent)]'
          }`}
        >
          <Check className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{isSynced ? 'Shortlisted' : 'Shortlist'}</span>
        </button>
      </div>

      <div className="p-3.5 space-y-4">
        {/* Hero Summary */}
        <div className="flex items-start gap-3">
          {specialist.photo?.photoUrl && !photoErrored && (
            <div className="w-20 h-20 rounded-lg overflow-clip bg-[var(--surface-subtle)] border border-[var(--line)] shrink-0">
              <img
                src={specialist.photo.photoUrl}
                alt={specialist.name}
                width={80}
                height={80}
                loading="lazy"
                decoding="async"
                referrerPolicy="no-referrer"
                onError={() => setPhotoErrored(true)}
                className="w-full h-full object-cover block"
              />
            </div>
          )}

          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="font-display text-sm font-bold text-[var(--ink)] leading-snug">
              {specialist.name}
            </h3>

            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-[var(--muted)] tabular-nums">
              <span className="font-mono font-semibold text-[var(--accent-text)]">
                {formatTravelTime(specialist.travelDurationSeconds)}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {formatDistance(specialist.distanceMeters)}{' '}
                {getTravelModeShortLabel(travelMode)}
              </span>
              {specialist.specialty && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">{specialist.specialty}</span>
                </>
              )}
            </div>

            {specialist.address && (
              <p className="text-xs text-[var(--muted)] leading-snug">{specialist.address}</p>
            )}

            {specialist.photo?.photoUrl && !photoErrored && primaryAttribution && (
              <p className="text-[11px] text-[var(--muted)] truncate">
                Photo:{' '}
                {safeExternalUrl(primaryAttribution.uri) ? (
                  <a
                    href={safeExternalUrl(primaryAttribution.uri)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center min-h-[44px] sm:min-h-0 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded"
                  >
                    {primaryAttribution.displayName}
                    <span className="sr-only"> (photo credit for {specialist.name})</span>
                  </a>
                ) : (
                  primaryAttribution.displayName
                )}
              </p>
            )}
          </div>
        </div>

        {specialist.editorialSummary && (
          <p className="text-xs text-[var(--ink)]/90 leading-relaxed">
            {specialist.editorialSummary}
          </p>
        )}

        {/* Primary Action Bar */}
        <div className="flex flex-wrap items-center gap-2">
          {directionsHref && (
            <a
              href={directionsHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[34px] px-3.5 text-xs font-semibold rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] hover:opacity-90 active:scale-[0.98] transition-opacity whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
            >
              <Navigation className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Directions</span>
              <span className="sr-only"> to {specialist.name}</span>
            </a>
          )}
          {phoneHref && (
            <a
              href={phoneHref}
              className="inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-[34px] px-3 text-xs font-medium text-[var(--ink)] bg-[var(--surface-subtle)] hover:bg-[var(--line)]/60 border border-[var(--line)] rounded-lg whitespace-nowrap tabular-nums focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              <Phone className="w-3.5 h-3.5 text-[var(--muted)]" aria-hidden="true" />
              <span>{specialist.phoneNumber}</span>
              <span className="sr-only"> call {specialist.name}</span>
            </a>
          )}
          {websiteHref && (
            <a
              href={websiteHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-[34px] px-3 text-xs font-medium text-[var(--ink)] bg-[var(--surface-subtle)] hover:bg-[var(--line)]/60 border border-[var(--line)] rounded-lg whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
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
              className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-[34px] px-2.5 text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)] whitespace-nowrap focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded-lg"
            >
              <span translate="no">Google Maps</span>
              <span className="sr-only"> listing for {specialist.name}</span>
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
          )}
        </div>

        {/* Ratings & Star Breakdown */}
        {specialist.rating != null && (
          <section
            aria-label="Ratings breakdown"
            className="pt-3 border-t border-[var(--line)]/80 space-y-2.5"
          >
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="text-xs font-semibold text-[var(--ink)]">Ratings</h4>
              <span className="text-[11px] text-[var(--muted)] tabular-nums">
                {specialist.userRatingCount.toLocaleString()} Google reviews
              </span>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-center shrink-0 min-w-[64px]">
                <div className="font-display text-2xl font-bold text-[var(--ink)] tabular-nums leading-none">
                  {specialist.rating.toFixed(1)}
                </div>
                <div className="flex items-center justify-center gap-0.5 mt-1" aria-hidden="true">
                  {[1, 2, 3, 4, 5].map((starIdx) => (
                    <Star
                      key={starIdx}
                      className={`w-3 h-3 ${
                        starIdx <= Math.round(specialist.rating!)
                          ? 'fill-amber-500 text-amber-500'
                          : 'text-[var(--line)]'
                      }`}
                    />
                  ))}
                </div>
              </div>

              {specialist.ratingDistribution && specialist.ratingDistribution.buckets.length > 0 && (
                <ul role="list" className="flex-1 space-y-1">
                  {specialist.ratingDistribution.buckets.map((bucket) => (
                    <li
                      key={bucket.stars}
                      className="flex items-center gap-2 text-[11px] text-[var(--muted)] tabular-nums"
                    >
                      <span className="w-3 text-right font-mono">{bucket.stars}</span>
                      <div
                        className="flex-1 h-1.5 rounded-full bg-[var(--surface-subtle)] overflow-hidden"
                        aria-hidden="true"
                      >
                        <div
                          className="h-full rounded-full bg-[var(--accent)]"
                          style={{ width: `${Math.max(bucket.percentage, bucket.count > 0 ? 4 : 0)}%` }}
                        />
                      </div>
                      <span className="w-8 text-right">{bucket.percentage}%</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {/* Opening Hours Schedule */}
        <section
          aria-label="Opening hours"
          className="pt-3 border-t border-[var(--line)]/80 space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <h4 className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--ink)]">
              <Clock className="w-3.5 h-3.5 text-[var(--muted)]" aria-hidden="true" />
              <span>Hours</span>
            </h4>
            {specialist.openNow !== null && (
              <span
                className="text-xs font-semibold"
                style={{
                  color: specialist.openNow ? 'var(--status-open)' : 'var(--muted)',
                }}
              >
                {specialist.openNow ? 'Open now' : 'Closed now'}
                {todayHours ? ` · ${todayHours}` : ''}
              </span>
            )}
          </div>

          {specialist.weekdayDescriptions && specialist.weekdayDescriptions.length > 0 ? (
            <ul role="list" className="space-y-1 text-xs tabular-nums">
              {specialist.weekdayDescriptions.map((line) => {
                const { day, hours } = splitWeekdayLine(line);
                const isToday = day.toLowerCase() === todayName.toLowerCase();
                return (
                  <li
                    key={line}
                    className={`flex items-baseline justify-between gap-3 px-2 py-1 rounded-md ${
                      isToday
                        ? 'bg-[var(--accent-soft)] text-[var(--ink)] font-semibold'
                        : 'text-[var(--muted)]'
                    }`}
                  >
                    <span>{day}</span>
                    <span className="text-right">{hours || line}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xs text-[var(--muted)]">
              {isLoadingDetails ? 'Loading weekly hours...' : 'Weekly schedule not listed on Google Maps.'}
            </p>
          )}
        </section>

        {/* Recent Google Reviews */}
        <section
          aria-label="Patient and visitor reviews"
          className="pt-3 border-t border-[var(--line)]/80 space-y-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold text-[var(--ink)]">Recent reviews</h4>
            {onAskAboutClinic && (
              <button
                type="button"
                onClick={() => onAskAboutClinic(specialist)}
                className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-[28px] px-1.5 text-xs font-semibold text-[var(--accent-text)] hover:underline cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded"
              >
                <MessageSquare className="w-3 h-3" aria-hidden="true" />
                <span>Ask agent</span>
                <span className="sr-only"> about {specialist.name}</span>
              </button>
            )}
          </div>

          {reviews.length > 0 ? (
            <ul role="list" className="space-y-2.5">
              {reviews.slice(0, 3).map((rev, idx) => {
                const reviewHref = safeExternalUrl(rev.googleMapsUri);
                const excerpt =
                  rev.text.length > 220 ? `${rev.text.slice(0, 219).trimEnd()}…` : rev.text;
                return (
                  <li
                    key={`${rev.authorName}-${idx}`}
                    className="pb-2.5 last:pb-0 border-b last:border-b-0 border-[var(--line)]/60 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2 text-[11px] tabular-nums">
                      <span className="font-semibold text-[var(--ink)] truncate">
                        {rev.authorName}
                      </span>
                      <span className="text-[var(--muted)] whitespace-nowrap shrink-0">
                        {rev.rating.toFixed(1)}★
                        {rev.relativePublishTime ? ` · ${rev.relativePublishTime}` : ''}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--muted)] leading-relaxed">“{excerpt}”</p>
                    {reviewHref && (
                      <a
                        href={reviewHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-[28px] text-[11px] font-medium text-[var(--accent-text)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded"
                      >
                        <span>Read on Google Maps</span>
                        <span className="sr-only">
                          {' '}
                          — review by {rev.authorName} for {specialist.name}
                        </span>
                        <ExternalLink className="w-2.5 h-2.5" aria-hidden="true" />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="space-y-1.5">
              <p className="text-xs text-[var(--muted)]">
                {isLoadingDetails
                  ? 'Loading reviews from Google Maps...'
                  : specialist.userRatingCount > 0
                    ? `Rated ${specialist.rating?.toFixed(1) ?? 'N/A'}★ across ${specialist.userRatingCount.toLocaleString()} reviews on Google Maps.`
                    : 'No review snippets returned for this listing yet.'}
              </p>
              {mapsHref && !isLoadingDetails && (
                <a
                  href={mapsHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-[28px] text-xs font-semibold text-[var(--accent-text)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded"
                >
                  <span>
                    Read{' '}
                    {specialist.userRatingCount > 0
                      ? `all ${specialist.userRatingCount.toLocaleString()} reviews`
                      : 'reviews'}{' '}
                    on Google Maps
                  </span>
                  <span className="sr-only"> for {specialist.name}</span>
                  <ExternalLink className="w-3 h-3" aria-hidden="true" />
                </a>
              )}
            </div>
          )}
        </section>

        {specialist.wheelchairAccessible && (
          <div className="pt-2 border-t border-[var(--line)]/80 flex items-center gap-1.5 text-xs text-[var(--muted)]">
            <Accessibility className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Wheelchair-accessible entrance</span>
          </div>
        )}
      </div>
    </article>
  );
}
