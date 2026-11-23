import { useId, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Check,
  Clock,
  LocateFixed,
  Navigation,
  Star,
} from 'lucide-react';
import type { ResolvedTheme } from '../hooks/useTheme.ts';
import type {
  GenUiBlock,
  OriginLocation,
  SortMode,
  Specialist,
  TravelMode,
} from '../types.ts';
import { getTodayHoursSummary } from '../utils/agentLogic.ts';
import { toGoogleMapsUrlTravelMode } from '../utils/mapsSync.ts';
import { formatDistance, formatTravelTime } from '../utils/ranking.ts';
import { safeExternalUrl } from '../utils/url.ts';
import { A2uiPlaceCard } from './A2uiPlaceCard.tsx';

interface GenUiBlockRendererProps {
  block: GenUiBlock;
  specialists: Specialist[];
  origin: OriginLocation | null;
  travelMode: TravelMode;
  sortMode: SortMode;
  resolvedTheme: ResolvedTheme;
  isLatestTurn: boolean;
  selectedId: string | null;
  syncedSet: Set<string>;
  isLocatingGps: boolean;
  onFocusSpecialist: (id: string) => void;
  onInspectIn3D: (id: string) => void;
  onHoverSpecialist: (id: string | null) => void;
  onToggleSyncId: (id: string) => void;
  onSelectTopThree: () => void;
  onChangeSortMode: (mode: SortMode) => void;
  onUseGps: () => void;
  onSubmitLocationText: (locationText: string) => void;
  onAskAboutClinic: (specialist: Specialist) => void;
}

function getTravelModeShortLabel(mode: TravelMode): string {
  if (mode === 'WALK') return 'walk';
  if (mode === 'BICYCLE') return 'bike';
  return 'drive';
}

export function GenUiBlockRenderer({
  block,
  specialists,
  origin,
  travelMode,
  sortMode,
  resolvedTheme,
  isLatestTurn,
  selectedId,
  syncedSet,
  isLocatingGps,
  onFocusSpecialist,
  onInspectIn3D,
  onHoverSpecialist,
  onToggleSyncId,
  onSelectTopThree,
  onChangeSortMode,
  onUseGps,
  onSubmitLocationText,
  onAskAboutClinic,
}: GenUiBlockRendererProps) {
  const inlineLocationId = useId();
  const [showAllCards, setShowAllCards] = useState(false);
  const [inlineLocation, setInlineLocation] = useState('');

  if (block.type === 'location_prompt') {
    const handleLocationForm = (e: FormEvent) => {
      e.preventDefault();
      const trimmed = inlineLocation.trim();
      if (!trimmed) return;
      setInlineLocation('');
      onSubmitLocationText(trimmed);
    };

    return (
      <div
        data-testid="genui-location-prompt"
        className="mt-2 p-3 rounded-xl border border-[var(--line)] bg-[var(--surface-subtle)] space-y-2.5"
      >
        <form onSubmit={handleLocationForm} className="flex items-center gap-2">
          <label htmlFor={inlineLocationId} className="sr-only">
            Starting location
          </label>
          <input
            id={inlineLocationId}
            name="location"
            type="text"
            autoComplete="street-address"
            enterKeyHint="go"
            value={inlineLocation}
            onChange={(e) => setInlineLocation(e.target.value)}
            placeholder="City, ZIP, or street..."
            className="flex-1 min-w-0 min-h-[44px] sm:min-h-[38px] px-3 text-base sm:text-sm text-[var(--ink)] placeholder:text-[var(--muted)] bg-[var(--surface)] border border-[var(--control-line)] rounded-lg focus:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
          />
          <button
            type="submit"
            className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-[38px] px-3.5 text-xs font-semibold text-[var(--accent-ink)] bg-[var(--accent)] hover:opacity-90 active:scale-[0.98] rounded-lg whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            <span>Set</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </form>
        <button
          type="button"
          onClick={onUseGps}
          disabled={isLocatingGps}
          className="inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-[36px] text-xs font-medium text-[var(--accent-text)] hover:underline cursor-pointer disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] rounded"
        >
          <LocateFixed className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{isLocatingGps ? 'Locating...' : 'Use GPS'}</span>
        </button>
      </div>
    );
  }

  const byId = new Map(specialists.map((s) => [s.id, s]));
  const globalRankFor = (id: string, fallbackIndex: number): number => {
    const idx = specialists.findIndex((s) => s.id === id);
    return idx >= 0 ? idx + 1 : fallbackIndex + 1;
  };

  if (block.type === 'provider_spotlight') {
    const clinic = byId.get(block.specialistId);
    if (!clinic) return null;
    const rank = globalRankFor(clinic.id, 0);
    return (
      <div className="mt-2" data-testid="genui-provider-spotlight">
        <A2uiPlaceCard
          specialist={clinic}
          rank={rank}
          origin={origin}
          travelMode={travelMode}
          resolvedTheme={resolvedTheme}
          isFocused={clinic.id === selectedId}
          isSynced={syncedSet.has(clinic.id)}
          defaultExpandedDetails
          onFocus={onFocusSpecialist}
          onInspectIn3D={onInspectIn3D}
          onHover={onHoverSpecialist}
          onToggleSync={onToggleSyncId}
          onAskAboutClinic={onAskAboutClinic}
        />
      </div>
    );
  }

  if (block.type === 'comparison') {
    const items = block.specialistIds
      .map((id) => byId.get(id))
      .filter((s): s is Specialist => Boolean(s));
    if (items.length < 2) return null;

    return (
      <div
        data-testid="genui-comparison"
        className="mt-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] overflow-clip"
      >
        <div className="px-3 py-2 bg-[var(--surface-subtle)] border-b border-[var(--line)]">
          <span className="text-xs font-semibold text-[var(--ink)]">
            {block.title || 'Comparison'}
          </span>
        </div>

        <ul role="list" className="divide-y divide-[var(--line)]/70">
          {items.map((clinic, idx) => {
            const rank = globalRankFor(clinic.id, idx);
            const isSynced = syncedSet.has(clinic.id);
            const isFocused = clinic.id === selectedId;
            const todayHours = getTodayHoursSummary(clinic.weekdayDescriptions);
            const dirHref =
              safeExternalUrl(clinic.directionsUri) ||
              (origin
                ? `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${clinic.location.lat},${clinic.location.lng}&travelmode=${toGoogleMapsUrlTravelMode(travelMode)}`
                : safeExternalUrl(clinic.googleMapsUri));

            return (
              <li
                key={clinic.id}
                onMouseEnter={() => onHoverSpecialist(clinic.id)}
                onMouseLeave={() => onHoverSpecialist(null)}
                className={`p-3 space-y-1.5 transition-colors ${
                  isFocused ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--surface-subtle)]/60'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={isSynced}
                      aria-label={`Shortlist ${clinic.name}`}
                      onClick={() => onToggleSyncId(clinic.id)}
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
                      onClick={() => onFocusSpecialist(clinic.id)}
                      className="flex items-center gap-1.5 min-w-0 min-h-[44px] sm:min-h-[28px] text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] rounded"
                    >
                      <span className="font-mono text-[11px] font-semibold text-[var(--muted)] tabular-nums shrink-0">
                        #{rank}
                      </span>
                      <span className="text-xs font-semibold text-[var(--ink)] truncate">
                        {clinic.name}
                      </span>
                    </button>
                  </div>

                  <span className="font-mono text-xs font-semibold text-[var(--accent-text)] tabular-nums whitespace-nowrap shrink-0">
                    {formatTravelTime(clinic.travelDurationSeconds)}
                  </span>
                </div>

                <div className="pl-7 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--muted)] tabular-nums">
                  {clinic.rating != null && (
                    <span className="inline-flex items-center gap-0.5 font-medium text-[var(--ink)]">
                      <Star
                        className="w-3 h-3 fill-amber-500 text-amber-500"
                        aria-hidden="true"
                      />
                      {clinic.rating.toFixed(1)} ({clinic.userRatingCount})
                    </span>
                  )}
                  <span aria-hidden="true" className="opacity-50">
                    ·
                  </span>
                  <span>
                    {formatDistance(clinic.distanceMeters)}{' '}
                    {getTravelModeShortLabel(travelMode)}
                  </span>
                  {clinic.openNow !== null && (
                    <>
                      <span aria-hidden="true" className="opacity-50">
                        ·
                      </span>
                      <span
                        className="font-medium"
                        style={{
                          color: clinic.openNow ? 'var(--status-open)' : 'var(--muted)',
                        }}
                      >
                        {clinic.openNow ? 'Open' : 'Closed'}
                      </span>
                    </>
                  )}
                </div>

                <div className="pl-7 flex items-center justify-between gap-2 text-[11px]">
                  {todayHours ? (
                    <span className="inline-flex items-center gap-1 text-[var(--muted)] truncate">
                      <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{todayHours}</span>
                    </span>
                  ) : (
                    <span className="text-[var(--muted)] truncate">{clinic.address}</span>
                  )}

                  {dirHref && (
                    <a
                      href={dirHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-0 px-1.5 sm:px-0 font-medium text-[var(--accent-text)] hover:underline whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded"
                    >
                      <Navigation className="w-3 h-3" aria-hidden="true" />
                      <span>Route</span>
                      <span className="sr-only"> to {clinic.name}</span>
                    </a>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  // Default: ranked A2UI place cards
  const orderedCards = (() => {
    const idSet = new Set(block.specialistIds);
    const liveMatches = specialists.filter((s) => idSet.has(s.id));
    if (liveMatches.length > 0 && isLatestTurn) {
      return liveMatches;
    }
    return block.specialistIds
      .map((id) => byId.get(id))
      .filter((s): s is Specialist => Boolean(s));
  })();

  if (orderedCards.length === 0) return null;

  const visibleCards = showAllCards ? orderedCards : orderedCards.slice(0, 3);
  const hiddenCount = orderedCards.length - visibleCards.length;

  return (
    <div className="mt-2 space-y-2" data-testid="specialist-list">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 text-xs">
          <span className="font-semibold text-[var(--ink)]">
            {block.title || `${orderedCards.length} matches`}
          </span>
          {isLatestTurn && orderedCards.length >= 2 && (
            <>
              <span aria-hidden="true" className="text-[var(--muted)] opacity-50">
                ·
              </span>
              <button
                type="button"
                onClick={onSelectTopThree}
                className="inline-flex items-center min-h-[44px] sm:min-h-0 font-medium text-[var(--accent-text)] hover:underline whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded"
              >
                Select top {Math.min(3, orderedCards.length)}
              </button>
            </>
          )}
        </div>

        {isLatestTurn && orderedCards.length > 1 && (
          <div
            role="group"
            aria-label="Rank by"
            className="flex items-center gap-0.5 p-0.5 bg-[var(--surface-subtle)] border border-[var(--line)]/70 rounded-lg shrink-0"
          >
            {(
              [
                { id: 'balanced', label: 'Best' },
                { id: 'fastest', label: 'Fastest' },
                { id: 'rating', label: 'Rating' },
              ] as const
            ).map(({ id, label }) => {
              const active = sortMode === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onChangeSortMode(id)}
                  aria-pressed={active}
                  className={`min-h-[44px] sm:min-h-[28px] px-3 sm:px-2.5 py-1 text-[11px] font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
                    active
                      ? 'bg-[var(--surface)] text-[var(--ink)] border-[var(--accent)] shadow-xs'
                      : 'border-transparent text-[var(--muted)] hover:text-[var(--ink)]'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <ul role="list" className="space-y-2">
        {visibleCards.map((clinic, idx) => (
          <li key={clinic.id}>
            <A2uiPlaceCard
              specialist={clinic}
              rank={globalRankFor(clinic.id, idx)}
              origin={origin}
              travelMode={travelMode}
              resolvedTheme={resolvedTheme}
              isFocused={clinic.id === selectedId}
              isSynced={syncedSet.has(clinic.id)}
              onFocus={onFocusSpecialist}
              onInspectIn3D={onInspectIn3D}
              onHover={onHoverSpecialist}
              onToggleSync={onToggleSyncId}
              onAskAboutClinic={onAskAboutClinic}
            />
          </li>
        ))}
      </ul>

      {orderedCards.length > 3 && (
        <button
          type="button"
          onClick={() => setShowAllCards((v) => !v)}
          className="w-full min-h-[44px] sm:min-h-[38px] text-xs font-medium text-[var(--ink)] bg-[var(--surface-subtle)] hover:bg-[var(--line)]/60 border border-[var(--line)] rounded-xl transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
        >
          {showAllCards ? 'Show fewer' : `Show ${hiddenCount} more`}
        </button>
      )}
    </div>
  );
}
