import { useId, useRef, useState, type FormEvent } from 'react';
import {
  ArrowRight,
  Check,
  ChevronRight,
  Clock,
  LocateFixed,
  Navigation,
  Star,
} from 'lucide-react';
import type { ResolvedTheme } from '../hooks/useTheme.ts';
import type {
  GenUiBlock,
  OriginLocation,
  RankedSynthesisResult,
  SortMode,
  Specialist,
  TravelMode,
} from '../types.ts';
import { getTodayHoursSummary } from '../utils/agentLogic.ts';
import { toGoogleMapsUrlTravelMode } from '../utils/mapsSync.ts';
import { formatDistance, formatTravelTime } from '../utils/ranking.ts';
import { buildRankedSynthesis } from '../utils/synthesis.ts';
import { safeExternalUrl } from '../utils/url.ts';
import { A2uiPlaceCard } from './A2uiPlaceCard.tsx';
import { PlaceDetailView } from './PlaceDetailView.tsx';
import { SynthesisSummaryCard } from './SynthesisSummaryCard.tsx';

interface GenUiBlockRendererProps {
  block: GenUiBlock;
  synthesis?: RankedSynthesisResult;
  specialists: Specialist[];
  origin: OriginLocation | null;
  travelMode: TravelMode;
  sortMode: SortMode;
  resolvedTheme: ResolvedTheme;
  isLatestTurn: boolean;
  selectedId: string | null;
  syncedSet: Set<string>;
  loadingDetailsId: string | null;
  isLocatingGps: boolean;
  onFocusSpecialist: (id: string) => void;
  onHoverSpecialist: (id: string | null) => void;
  onToggleSyncId: (id: string) => void;
  onSelectTopThree: () => void;
  onChangeSortMode: (mode: SortMode) => void;
  onUseGps: () => void;
  onSubmitLocationText: (locationText: string) => void;
  onAskAboutClinic: (specialist: Specialist) => void;
  onRequestPlaceDetails: (id: string) => void;
}

function getTravelModeShortLabel(mode: TravelMode): string {
  if (mode === 'WALK') return 'walk';
  if (mode === 'BICYCLE') return 'bike';
  return 'drive';
}

export function GenUiBlockRenderer({
  block,
  synthesis,
  specialists,
  origin,
  travelMode,
  sortMode,
  resolvedTheme,
  isLatestTurn,
  selectedId,
  syncedSet,
  loadingDetailsId,
  isLocatingGps,
  onFocusSpecialist,
  onHoverSpecialist,
  onToggleSyncId,
  onSelectTopThree,
  onChangeSortMode,
  onUseGps,
  onSubmitLocationText,
  onAskAboutClinic,
  onRequestPlaceDetails,
}: GenUiBlockRendererProps) {
  const inlineLocationId = useId();
  const windowScrollRef = useRef<HTMLDivElement | null>(null);
  const [showAllCards, setShowAllCards] = useState(false);
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [inlineLocation, setInlineLocation] = useState('');

  const openDetailInWindow = (id: string) => {
    setInspectedId(id);
    onFocusSpecialist(id);
    onRequestPlaceDetails(id);
    windowScrollRef.current?.scrollTo({ top: 0 });
  };

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
        className="p-3 rounded-xl border border-[var(--line)] bg-[var(--surface-subtle)] space-y-2.5"
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
      <div
        data-testid="genui-provider-spotlight"
        className="lg:max-h-[400px] lg:agent-scroll rounded-xl"
      >
        <PlaceDetailView
          specialist={clinic}
          rank={rank}
          origin={origin}
          travelMode={travelMode}
          isSynced={syncedSet.has(clinic.id)}
          isLoadingDetails={loadingDetailsId === clinic.id}
          onToggleSync={onToggleSyncId}
          onAskAboutClinic={onAskAboutClinic}
          onRequestDetails={onRequestPlaceDetails}
        />
      </div>
    );
  }

  if (block.type === 'comparison') {
    const items = block.specialistIds
      .map((id) => byId.get(id))
      .filter((s): s is Specialist => Boolean(s));
    if (items.length < 2) return null;

    const inspectedClinic = inspectedId
      ? items.find((item) => item.id === inspectedId) ?? null
      : null;

    const activeComparisonSynthesis =
      synthesis ??
      buildRankedSynthesis({
        specialists: items,
        specialistQuery: items[0]?.specialty,
        originLabel: origin?.label,
        sortMode,
        travelMode,
      });

    return (
      <div className="space-y-2.5">
        {!inspectedClinic && activeComparisonSynthesis && (
          <SynthesisSummaryCard
            synthesis={activeComparisonSynthesis}
            specialists={items}
            selectedId={selectedId}
            travelMode={travelMode}
            onSelectSpecialist={onFocusSpecialist}
            onInspectDetails={openDetailInWindow}
          />
        )}
        <div
          ref={windowScrollRef}
          data-testid="genui-comparison"
          className="lg:max-h-[380px] lg:agent-scroll rounded-xl border border-[var(--line)] bg-[var(--surface)]"
        >
        {inspectedClinic ? (
          <PlaceDetailView
            specialist={inspectedClinic}
            rank={globalRankFor(inspectedClinic.id, 0)}
            origin={origin}
            travelMode={travelMode}
            isSynced={syncedSet.has(inspectedClinic.id)}
            isLoadingDetails={loadingDetailsId === inspectedClinic.id}
            backLabel="Back to comparison"
            onBack={() => setInspectedId(null)}
            onToggleSync={onToggleSyncId}
            onAskAboutClinic={onAskAboutClinic}
            onRequestDetails={onRequestPlaceDetails}
          />
        ) : (
          <>
            <div className="sticky top-0 z-10 px-3 py-2 bg-[var(--surface-subtle)] border-b border-[var(--line)] flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold text-[var(--ink)]">
                {block.title || 'Comparison'}
              </h2>
              <span className="text-[11px] text-[var(--muted)] tabular-nums">
                {items.length} options
              </span>
            </div>

            <ul role="list" className="divide-y divide-[var(--line)]/70">
              {items.map((clinic, idx) => {
                const rank = globalRankFor(clinic.id, idx);
                const isSynced = syncedSet.has(clinic.id);
                const isFocused = clinic.id === selectedId;
                const todayHours = getTodayHoursSummary(clinic.weekdayDescriptions);
                const reviewSnippet = (clinic.topReviews?.[0]?.text || clinic.reviews?.[0]?.text || '').trim();
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
                          {clinic.rating.toFixed(1)} ({clinic.userRatingCount.toLocaleString()})
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

                    {todayHours && (
                      <div className="pl-7 flex items-center gap-1 text-[11px] text-[var(--muted)] tabular-nums">
                        <Clock className="w-3 h-3 shrink-0" aria-hidden="true" />
                        <span className="truncate">Today {todayHours}</span>
                      </div>
                    )}

                    {reviewSnippet && (
                      <p className="pl-7 text-[11px] text-[var(--muted)] leading-snug line-clamp-2">
                        “{reviewSnippet}”
                      </p>
                    )}

                    <div className="pl-7 flex items-center justify-between gap-2 pt-0.5 text-[11px]">
                      {dirHref ? (
                        <a
                          href={dirHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-0 px-1.5 sm:px-0 font-semibold text-[var(--accent-text)] hover:underline whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded"
                        >
                          <Navigation className="w-3 h-3" aria-hidden="true" />
                          <span>Route</span>
                          <span className="sr-only"> to {clinic.name}</span>
                        </a>
                      ) : (
                        <span />
                      )}

                      <button
                        type="button"
                        onClick={() => openDetailInWindow(clinic.id)}
                        className="inline-flex items-center gap-0.5 min-h-[44px] sm:min-h-0 font-semibold text-[var(--ink)] hover:text-[var(--accent-text)] whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded"
                      >
                        <span>Details</span>
                        <span className="sr-only"> for {clinic.name}</span>
                        <ChevronRight className="w-3 h-3" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        </div>
      </div>
    );
  }

  // Default: Bounded 3-Option Scroll Window with In-Window Next-Level Detail View
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
  const inspectedClinic = inspectedId
    ? orderedCards.find((item) => item.id === inspectedId) ?? null
    : null;

  const activeSynthesis = isLatestTurn
    ? buildRankedSynthesis({
        specialists: orderedCards,
        specialistQuery: orderedCards[0]?.specialty,
        originLabel: origin?.label,
        sortMode,
        travelMode,
      }) ?? synthesis
    : synthesis;

  return (
    <div className="space-y-2.5" data-testid="specialist-list">
      {!inspectedClinic && activeSynthesis && (
        <SynthesisSummaryCard
          synthesis={activeSynthesis}
          specialists={orderedCards}
          selectedId={selectedId}
          travelMode={travelMode}
          onSelectSpecialist={onFocusSpecialist}
          onInspectDetails={openDetailInWindow}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 text-xs">
          <h2 className="font-semibold text-[var(--ink)]">
            {block.title || `${orderedCards.length} matches`}
          </h2>
          <span aria-hidden="true" className="text-[var(--muted)] opacity-50">
            ·
          </span>
          <span className="text-[var(--muted)] tabular-nums">
            {showAllCards
              ? `${orderedCards.length} of ${orderedCards.length}`
              : `Top ${visibleCards.length} of ${orderedCards.length}`}
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

      {/* Desktop Contained Scroll Window / Seamless Full-Height Flow on Mobile */}
      <div
        ref={windowScrollRef}
        data-testid="options-scroll-window"
        className="lg:max-h-[540px] lg:agent-scroll rounded-xl border border-[var(--line)] bg-[var(--bg)]/70 p-2 space-y-2"
      >
        {inspectedClinic ? (
          <PlaceDetailView
            specialist={inspectedClinic}
            rank={globalRankFor(inspectedClinic.id, 0)}
            origin={origin}
            travelMode={travelMode}
            isSynced={syncedSet.has(inspectedClinic.id)}
            isLoadingDetails={loadingDetailsId === inspectedClinic.id}
            backLabel={`Back to ${visibleCards.length} options`}
            onBack={() => setInspectedId(null)}
            onToggleSync={onToggleSyncId}
            onAskAboutClinic={onAskAboutClinic}
            onRequestDetails={onRequestPlaceDetails}
          />
        ) : (
          <>
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
                    onOpenDetails={openDetailInWindow}
                    onHover={onHoverSpecialist}
                    onToggleSync={onToggleSyncId}
                  />
                </li>
              ))}
            </ul>

            {orderedCards.length > 3 && (
              <button
                type="button"
                onClick={() => setShowAllCards((v) => !v)}
                className="w-full min-h-[44px] sm:min-h-[34px] text-xs font-medium text-[var(--ink)] bg-[var(--surface)] hover:bg-[var(--surface-subtle)] border border-[var(--line)] rounded-lg transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
              >
                {showAllCards
                  ? 'Show top 3 only'
                  : `Browse ${hiddenCount} more inside this window`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
