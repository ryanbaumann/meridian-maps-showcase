import { useState } from 'react';
import { Check, Clock, Info, MapPin, MessageSquare, Navigation, Star } from 'lucide-react';
import type {
  OriginLocation,
  RankedSynthesisResult,
  Specialist,
  TravelMode,
} from '../types.ts';
import { buildPlaceDirectionsUrl } from '../utils/mapsSync.ts';
import { formatDistance, formatTravelTime } from '../utils/ranking.ts';
import { safeExternalUrl } from '../utils/url.ts';

interface SynthesisSummaryCardProps {
  synthesis: RankedSynthesisResult;
  specialists: Specialist[];
  origin: OriginLocation | null;
  selectedId: string | null;
  syncedSet: Set<string>;
  travelMode: TravelMode;
  onSelectSpecialist: (id: string) => void;
  onHoverSpecialist: (id: string | null) => void;
  onToggleSyncId: (id: string) => void;
  onInspectDetails: (id: string) => void;
  onAskAboutSpecialist?: (specialist: Specialist) => void;
}

function getInitials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w));
  if (words.length === 0) return 'SP';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

function PlaceThumbnail({
  specialist,
  rank,
}: {
  specialist: Specialist;
  rank: number;
}) {
  const [imgError, setImgError] = useState(false);
  const photo = specialist.photo;
  const hasPhoto = Boolean(photo?.photoUrl) && !imgError;
  const author = photo?.authorAttributions?.[0];
  const authorHref = safeExternalUrl(author?.uri);

  return (
    <div className="relative w-[72px] h-[72px] sm:w-[76px] sm:h-[76px] rounded-lg overflow-clip shrink-0 border border-[var(--line)] bg-[var(--surface-subtle)]">
      {hasPhoto ? (
        <img
          src={photo!.photoUrl}
          alt={specialist.name}
          loading="lazy"
          decoding="async"
          onError={() => setImgError(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <div
          className="w-full h-full flex flex-col items-center justify-center bg-[var(--surface-subtle)] text-[var(--muted)]"
          aria-hidden="true"
        >
          <span className="font-display text-sm font-bold tracking-tight text-[var(--ink)]/75">
            {getInitials(specialist.name)}
          </span>
          <span className="text-[9px] uppercase tracking-wider text-[var(--muted)] mt-0.5">
            {specialist.specialty.slice(0, 8)}
          </span>
        </div>
      )}

      {/* Crisp Rank Marker */}
      <span
        className={`absolute top-1 left-1 inline-flex items-center justify-center min-w-[20px] h-[20px] px-1 rounded text-[10px] font-bold tabular-nums shadow-xs ${
          rank === 1
            ? 'bg-[var(--accent)] text-[var(--accent-ink)]'
            : 'bg-[var(--surface)]/95 text-[var(--ink)] border border-[var(--line)]'
        }`}
      >
        #{rank}
      </span>

      {/* Mandatory Places Photo Attribution when present */}
      {hasPhoto && author?.displayName && (
        <span
          className="absolute bottom-0 inset-x-0 px-1 py-[1px] bg-black/65 text-[8px] leading-tight text-white truncate"
          title={`Photo: ${author.displayName}`}
        >
          {authorHref ? (
            <a
              href={authorHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="hover:underline"
            >
              © {author.displayName}
            </a>
          ) : (
            <>© {author.displayName}</>
          )}
        </span>
      )}
    </div>
  );
}

export function SynthesisSummaryCard({
  synthesis,
  specialists,
  origin,
  selectedId,
  syncedSet,
  travelMode,
  onSelectSpecialist,
  onHoverSpecialist,
  onToggleSyncId,
  onInspectDetails,
  onAskAboutSpecialist,
}: SynthesisSummaryCardProps) {
  const byId = new Map(specialists.map((s) => [s.id, s]));
  const rows = synthesis.picks
    .map((pick) => {
      const specialist = byId.get(pick.specialistId);
      return specialist ? { pick, specialist } : null;
    })
    .filter(
      (entry): entry is { pick: RankedSynthesisResult['picks'][number]; specialist: Specialist } =>
        Boolean(entry)
    );

  if (rows.length === 0) return null;

  const modeVerb =
    travelMode === 'WALK' ? 'walk' : travelMode === 'BICYCLE' ? 'bike' : 'drive';

  return (
    <section
      aria-label={synthesis.headline}
      className="rounded-xl border border-[var(--line)] bg-[var(--bg)] overflow-clip"
    >
      {/* Unified Visual Brief Header */}
      <div className="px-3 py-2 border-b border-[var(--line)]/80 bg-[var(--surface-subtle)]/70 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="min-w-0">
          <h2 className="font-display text-xs font-bold tracking-tight text-[var(--ink)] truncate">
            {synthesis.headline}
          </h2>
          {synthesis.originLabel && (
            <p className="text-[10px] text-[var(--muted)] truncate">
              Weighted from {synthesis.originLabel}
            </p>
          )}
        </div>
        <div
          className="flex items-center gap-2 text-[10px] font-medium text-[var(--muted)] tabular-nums shrink-0"
          aria-label={`Weights: ${synthesis.weights.ratingPct}% Google rating, ${synthesis.weights.travelTimePct}% travel time, ${synthesis.weights.distancePct}% distance`}
        >
          <span className="inline-flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-[2px] shrink-0"
              style={{ backgroundColor: 'var(--status-warn)' }}
              aria-hidden="true"
            />
            {synthesis.weights.ratingPct}% Rating
          </span>
          <span className="inline-flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-[2px] shrink-0 bg-[var(--accent)]"
              aria-hidden="true"
            />
            {synthesis.weights.travelTimePct}% Time
          </span>
          <span className="inline-flex items-center gap-1">
            <span
              className="w-2 h-2 rounded-[2px] shrink-0"
              style={{ backgroundColor: 'var(--chart-distance)' }}
              aria-hidden="true"
            />
            {synthesis.weights.distancePct}% Dist
          </span>
        </div>
      </div>

      {/* Unified Ranked Visual Rows */}
      <ul role="list" className="divide-y divide-[var(--line)]/75">
        {rows.map(({ pick, specialist }) => {
          const isSelected = specialist.id === selectedId;
          const isSynced = syncedSet.has(specialist.id);
          const { overall, ratingScore, travelTimeScore, distanceScore, weights } =
            pick.scoreBreakdown;
          const ratingContrib = Math.max(0, Math.round(ratingScore * weights.rating));
          const timeContrib = Math.max(0, Math.round(travelTimeScore * weights.travelTime));
          const distContrib = Math.max(0, Math.round(distanceScore * weights.distance));
          const distLabel = formatDistance(specialist.distanceMeters);
          const dirHref = buildPlaceDirectionsUrl(origin, specialist, travelMode);

          return (
            <li
              key={specialist.id}
              onMouseEnter={() => onHoverSpecialist(specialist.id)}
              onMouseLeave={() => onHoverSpecialist(null)}
              className={`p-2.5 transition-colors ${
                isSelected ? 'bg-[var(--accent-soft)]/50' : 'hover:bg-[var(--surface-subtle)]/50'
              }`}
            >
              <div className="flex items-start gap-2.5">
                <button
                  type="button"
                  onClick={() => onSelectSpecialist(specialist.id)}
                  className="shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-[var(--accent)] cursor-pointer"
                  aria-label={`Focus ${specialist.name} on map`}
                >
                  <PlaceThumbnail specialist={specialist} rank={pick.rank} />
                </button>

                <div className="flex-1 min-w-0 space-y-1">
                  {/* Name + Weighted Total Score + Shortlist Checkbox */}
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectSpecialist(specialist.id)}
                      className="min-w-0 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded"
                    >
                      <span className="block text-[10px] font-semibold uppercase tracking-wide text-[var(--accent-text)] leading-none mb-0.5">
                        {pick.badge}
                      </span>
                      <span className="block text-[13px] font-semibold text-[var(--ink)] leading-snug truncate">
                        {specialist.name}
                      </span>
                    </button>

                    <div className="flex items-center gap-2 shrink-0">
                      <div
                        className="text-right tabular-nums"
                        title={`Weighted score ${overall}/100 (Rating ${ratingScore}, Time ${travelTimeScore}, Distance ${distanceScore})`}
                      >
                        <span className="font-mono text-sm font-bold text-[var(--ink)] leading-none">
                          {overall}
                        </span>
                        <span className="text-[10px] text-[var(--muted)]">/100</span>
                      </div>

                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={isSynced}
                        aria-label={`Shortlist ${specialist.name} for Google Maps`}
                        title={isSynced ? 'Remove from shortlist' : 'Shortlist for Google Maps'}
                        onClick={() => onToggleSyncId(specialist.id)}
                        className={`relative before:absolute before:-inset-2.5 sm:before:-inset-1.5 flex items-center justify-center w-5 h-5 rounded border transition-colors shrink-0 cursor-pointer active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] ${
                          isSynced
                            ? 'bg-[var(--ink)] border-[var(--ink)] text-[var(--surface)]'
                            : 'bg-[var(--surface)] border-[var(--control-line)] text-transparent hover:border-[var(--accent)]'
                        }`}
                      >
                        <Check className="w-3 h-3 stroke-[2.75]" aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {/* Primary Verified Metrics: Rating · Travel Time · Distance */}
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] tabular-nums text-[var(--muted)]">
                    <span className="inline-flex items-center gap-0.5 font-semibold text-[var(--ink)]">
                      <Star
                        className="w-3 h-3 shrink-0 fill-current"
                        style={{ color: 'var(--status-warn)' }}
                        aria-hidden="true"
                      />
                      {specialist.rating != null ? specialist.rating.toFixed(1) : 'N/A'}
                      {specialist.userRatingCount > 0 && (
                        <span className="font-normal text-[var(--muted)]">
                          ({specialist.userRatingCount.toLocaleString()})
                        </span>
                      )}
                    </span>

                    <span className="inline-flex items-center gap-0.5 font-medium text-[var(--accent-text)]">
                      <Navigation className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                      {formatTravelTime(specialist.travelDurationSeconds)} {modeVerb}
                    </span>

                    {distLabel && (
                      <span className="inline-flex items-center gap-0.5">
                        <MapPin className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                        {distLabel}
                      </span>
                    )}
                  </div>

                  {/* Proportional 3-Factor Weighted Score Graphic Bar */}
                  <div className="pt-0.5">
                    <div
                      className="w-full h-1.5 rounded-full bg-[var(--surface-subtle)] border border-[var(--line)]/60 overflow-hidden flex"
                      role="img"
                      aria-label={`Score ${overall} of 100: rating contributes ${ratingContrib}, travel time ${timeContrib}, distance ${distContrib}`}
                    >
                      <div
                        className="h-full transition-[width] duration-300"
                        style={{
                          width: `${ratingContrib}%`,
                          backgroundColor: 'var(--status-warn)',
                        }}
                      />
                      <div
                        className="h-full bg-[var(--accent)] transition-[width] duration-300"
                        style={{ width: `${timeContrib}%` }}
                      />
                      <div
                        className="h-full transition-[width] duration-300"
                        style={{
                          width: `${distContrib}%`,
                          backgroundColor: 'var(--chart-distance)',
                        }}
                      />
                    </div>
                  </div>

                  {/* Hours Line (dedicated full width so full opening hours never squeeze) */}
                  {(specialist.openNow != null || pick.todayHours) && (
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] pt-0.5">
                      {specialist.openNow != null && (
                        <span
                          className="font-semibold shrink-0"
                          style={{
                            color: specialist.openNow
                              ? 'var(--status-open)'
                              : 'var(--status-closed)',
                          }}
                        >
                          {specialist.openNow ? 'Open' : 'Closed'}
                        </span>
                      )}
                      {pick.todayHours && (
                        <span className="inline-flex items-center gap-1 text-[var(--muted)]">
                          <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
                          <span>{pick.todayHours}</span>
                        </span>
                      )}
                    </div>
                  )}

                  {/* Quick Actions Row: Details, Ask, Route */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <button
                      type="button"
                      onClick={() => onInspectDetails(specialist.id)}
                      className="inline-flex items-center gap-1 min-h-[36px] sm:min-h-[26px] px-2.5 text-[11px] font-semibold text-[var(--accent-text)] bg-[var(--accent-soft)] hover:bg-[var(--accent)] hover:text-[var(--accent-ink)] border border-[var(--accent)]/35 rounded-md shrink-0 cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                    >
                      <Info className="w-3 h-3" aria-hidden="true" />
                      <span>Details</span>
                      <span className="sr-only"> for {specialist.name}</span>
                    </button>
                    {onAskAboutSpecialist && (
                      <button
                        type="button"
                        onClick={() => onAskAboutSpecialist(specialist)}
                        className="inline-flex items-center gap-1 min-h-[36px] sm:min-h-[26px] px-2 text-[11px] font-medium text-[var(--ink)] bg-[var(--surface)] hover:bg-[var(--surface-subtle)] border border-[var(--line)] rounded-md shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                      >
                        <MessageSquare className="w-3 h-3 text-[var(--muted)]" aria-hidden="true" />
                        <span>Ask</span>
                        <span className="sr-only"> agent about {specialist.name}</span>
                      </button>
                    )}
                    {dirHref && (
                      <a
                        href={dirHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 min-h-[36px] sm:min-h-[26px] px-2 text-[11px] font-medium text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-subtle)] border border-transparent hover:border-[var(--line)] rounded-md shrink-0 focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                      >
                        <Navigation className="w-3 h-3" aria-hidden="true" />
                        <span>Route</span>
                        <span className="sr-only"> to {specialist.name}</span>
                      </a>
                    )}
                  </div>

                  {/* Concise Review / Editorial Synthesis Line */}
                  {pick.reviewSnippet && (
                    <p className="text-[11px] leading-snug text-[var(--muted)] line-clamp-2 pt-0.5">
                      “{pick.reviewSnippet}”
                    </p>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
