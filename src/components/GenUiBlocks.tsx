import { useId, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, LocateFixed } from 'lucide-react';
import type { ResolvedTheme } from '../hooks/useTheme.ts';
import type {
  GenUiBlock,
  OriginLocation,
  RankedSynthesisResult,
  SortMode,
  Specialist,
  TravelMode,
} from '../types.ts';
import { buildRankedSynthesis } from '../utils/synthesis.ts';
import { AddressAutocompleteInput } from './AddressAutocompleteInput.tsx';
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
  onSelectOrigin: (origin: OriginLocation) => void;
  onAskAboutClinic: (specialist: Specialist) => void;
  onAskQuestion: (question: string) => void;
  onOpenDetails: (id: string) => void;
  onRequestPlaceDetails: (id: string) => void;
}

export function GenUiBlockRenderer({
  block,
  synthesis,
  specialists,
  origin,
  travelMode,
  sortMode,
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
  onSelectOrigin,
  onAskAboutClinic,
  onAskQuestion,
  onOpenDetails,
  onRequestPlaceDetails,
}: GenUiBlockRendererProps) {
  const inlineLocationId = useId();
  const windowScrollRef = useRef<HTMLDivElement | null>(null);
  const [showAllCards, setShowAllCards] = useState(false);
  const [inlineLocation, setInlineLocation] = useState('');

  const openDetailInInspector = (id: string) => {
    onOpenDetails(id);
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
          <AddressAutocompleteInput
            id={inlineLocationId}
            name="location"
            value={inlineLocation}
            onChange={setInlineLocation}
            onSelectOrigin={(selected) => {
              setInlineLocation('');
              onSelectOrigin(selected);
            }}
            locationBiasCenter={origin ? { lat: origin.lat, lng: origin.lng } : null}
            placeholder="City, ZIP, or street..."
            className="min-h-[44px] sm:min-h-[38px] px-3 text-base sm:text-sm text-[var(--ink)] placeholder:text-[var(--muted)] bg-[var(--surface)] border border-[var(--control-line)] rounded-lg focus:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
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
        className="lg:max-h-[400px] lg:overflow-y-auto lg:agent-scroll rounded-xl"
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
          onAskQuestion={onAskQuestion}
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

    const activeComparisonSynthesis =
      synthesis ??
      buildRankedSynthesis({
        specialists: items,
        specialistQuery: items[0]?.specialty,
        originLabel: origin?.label,
        sortMode,
        travelMode,
        maxPicks: items.length,
      });

    return (
      <div
        ref={windowScrollRef}
        data-testid="genui-comparison"
        className="lg:max-h-[460px] lg:overflow-y-auto lg:agent-scroll rounded-xl"
      >
        {activeComparisonSynthesis && (
          <SynthesisSummaryCard
            synthesis={activeComparisonSynthesis}
            specialists={items}
            origin={origin}
            selectedId={selectedId}
            syncedSet={syncedSet}
            travelMode={travelMode}
            onSelectSpecialist={onFocusSpecialist}
            onHoverSpecialist={onHoverSpecialist}
            onToggleSyncId={onToggleSyncId}
            onInspectDetails={openDetailInInspector}
            onAskAboutSpecialist={onAskAboutClinic}
          />
        )}
      </div>
    );
  }

  // Unified Ranked Results Window: single visual synthesis list (no duplicate cards)
  // with inline sort controls, shortlist checkboxes, expandable "more" options, and in-window Details.
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

  const visibleCount = showAllCards ? orderedCards.length : Math.min(3, orderedCards.length);
  const hiddenCount = orderedCards.length - visibleCount;

  const activeSynthesis =
    buildRankedSynthesis({
      specialists: orderedCards,
      specialistQuery: orderedCards[0]?.specialty || block.title,
      originLabel: origin?.label,
      sortMode,
      travelMode,
      maxPicks: visibleCount,
    }) ?? synthesis;

  return (
    <div className="space-y-2" data-testid="specialist-list">
      {/* Compact Controls Strip: Count, Quick Shortlist, Sort Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5 text-xs">
          <span className="font-medium text-[var(--muted)] tabular-nums">
            {showAllCards
              ? `${orderedCards.length} of ${orderedCards.length}`
              : `Top ${visibleCount} of ${orderedCards.length}`}
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
                Shortlist top {Math.min(3, orderedCards.length)}
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

      {/* Single Unified Window: Desktop Contained Scroll / Mobile Seamless Flow */}
      <div
        ref={windowScrollRef}
        data-testid="options-scroll-window"
        className="lg:max-h-[540px] lg:overflow-y-auto lg:agent-scroll rounded-xl"
      >
        {activeSynthesis && (
          <SynthesisSummaryCard
            synthesis={activeSynthesis}
            specialists={orderedCards}
            origin={origin}
            selectedId={selectedId}
            syncedSet={syncedSet}
            travelMode={travelMode}
            onSelectSpecialist={onFocusSpecialist}
            onHoverSpecialist={onHoverSpecialist}
            onToggleSyncId={onToggleSyncId}
            onInspectDetails={openDetailInInspector}
            onAskAboutSpecialist={onAskAboutClinic}
          />
        )}
      </div>

      {orderedCards.length > 3 && (
        <button
          type="button"
          onClick={() => setShowAllCards((v) => !v)}
          className="w-full min-h-[44px] sm:min-h-[36px] text-xs font-medium text-[var(--ink)] bg-[var(--surface)] hover:bg-[var(--surface-subtle)] border border-[var(--line)] rounded-lg transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
        >
          {showAllCards
            ? 'Show top 3 only'
            : `Show ${hiddenCount} more options`}
        </button>
      )}
    </div>
  );
}
