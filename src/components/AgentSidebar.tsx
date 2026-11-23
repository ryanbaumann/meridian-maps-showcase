import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type TouchEvent,
} from 'react';
import {
  ArrowRight,
  ArrowUp,
  Box,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  ExternalLink,
  LocateFixed,
  MapPin,
  Navigation,
  Orbit,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { SHOWCASE_CONFIG } from '../config/showcase.ts';
import type { ResolvedTheme } from '../hooks/useTheme.ts';
import type {
  AgentTurn,
  MapViewMode,
  OriginLocation,
  SortMode,
  Specialist,
  TravelMode,
} from '../types.ts';
import { prefersReducedMotion } from '../utils/camera.ts';
import {
  buildGoogleMapsSyncUrl,
  toGoogleMapsUrlTravelMode,
} from '../utils/mapsSync.ts';
import { formatTravelTime } from '../utils/ranking.ts';
import { safeExternalUrl } from '../utils/url.ts';
import { GenUiBlockRenderer } from './GenUiBlocks.tsx';

export type MobileSheetSnap = 'peek' | 'half' | 'full';

interface AgentSidebarProps {
  open: boolean;
  mobileSnap: MobileSheetSnap;
  origin: OriginLocation | null;
  travelMode: TravelMode;
  sortMode: SortMode;
  mapViewMode: MapViewMode;
  isOrbiting: boolean;
  resolvedTheme: ResolvedTheme;
  turns: AgentTurn[];
  specialists: Specialist[];
  selectedId: string | null;
  syncedIds: string[];
  isLoading: boolean;
  isLocatingGps: boolean;
  onToggleOpen: () => void;
  onChangeMobileSnap: (snap: MobileSheetSnap) => void;
  onToggleOrbit: () => void;
  onSubmitMessage: (message: string) => void;
  onUseGps: () => void;
  onSetLocationText: (locationText: string) => void;
  onChangeSortMode: (mode: SortMode) => void;
  onSelectSpecialist: (id: string) => void;
  onInspectIn3D: (id: string) => void;
  onHoverSpecialist: (id: string | null) => void;
  onToggleSyncId: (id: string) => void;
  onSelectTopThree: () => void;
  onClearSynced: () => void;
  onReset: () => void;
}

const MOBILE_SNAP_HEIGHT_CLASS: Record<MobileSheetSnap, string> = {
  peek: 'h-auto max-h-[192px]',
  half: 'h-[50dvh]',
  full: 'h-[86dvh]',
};

export function AgentSidebar({
  open,
  mobileSnap,
  origin,
  travelMode,
  sortMode,
  mapViewMode,
  isOrbiting,
  resolvedTheme,
  turns,
  specialists,
  selectedId,
  syncedIds,
  isLoading,
  isLocatingGps,
  onToggleOpen,
  onChangeMobileSnap,
  onToggleOrbit,
  onSubmitMessage,
  onUseGps,
  onSetLocationText,
  onChangeSortMode,
  onSelectSpecialist,
  onInspectIn3D,
  onHoverSpecialist,
  onToggleSyncId,
  onSelectTopThree,
  onClearSynced,
  onReset,
}: AgentSidebarProps) {
  const locationInputId = useId();
  const [messageInput, setMessageInput] = useState('');
  const [editingLocation, setEditingLocation] = useState(false);
  const [locationDraft, setLocationDraft] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLInputElement | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const selectedSpecialist = useMemo(
    () => specialists.find((s) => s.id === selectedId) ?? null,
    [specialists, selectedId]
  );

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'end',
    });
  }, [turns.length, isLoading]);

  const syncedSpecialists = useMemo(() => {
    const byId = new Map(specialists.map((s) => [s.id, s]));
    return syncedIds
      .map((id) => byId.get(id))
      .filter((s): s is Specialist => Boolean(s));
  }, [specialists, syncedIds]);

  const syncedSet = useMemo(() => new Set(syncedIds), [syncedIds]);

  const googleMapsSyncUrl = useMemo(
    () => buildGoogleMapsSyncUrl(origin, syncedSpecialists, travelMode),
    [origin, syncedSpecialists, travelMode]
  );

  const handleCopySyncLink = async () => {
    if (!googleMapsSyncUrl) return;
    try {
      await navigator.clipboard.writeText(googleMapsSyncUrl);
      setCopiedLink(true);
      window.setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      // Ignore clipboard failures in restricted contexts
    }
  };

  const handleSend = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = messageInput.trim();
    if (!trimmed || isLoading) return;
    setMessageInput('');
    onChangeMobileSnap('half');
    onSubmitMessage(trimmed);
  };

  const handleLocationSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = locationDraft.trim();
    if (!trimmed) return;
    setEditingLocation(false);
    onSetLocationText(trimmed);
  };

  const handleAskAboutClinic = (clinic: Specialist) => {
    if (isLoading) return;
    onChangeMobileSnap('half');
    onSubmitMessage(`Hours and reviews for ${clinic.name}`);
  };

  const cycleMobileSnap = () => {
    if (mobileSnap === 'peek') {
      onChangeMobileSnap('half');
    } else if (mobileSnap === 'half') {
      onChangeMobileSnap('full');
    } else {
      onChangeMobileSnap('peek');
    }
  };

  const handleGrabTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
  };

  const handleGrabTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    const startY = touchStartYRef.current;
    touchStartYRef.current = null;
    const endY = e.changedTouches[0]?.clientY;
    if (startY == null || endY == null) return;
    const dy = endY - startY;
    if (dy < -32) {
      onChangeMobileSnap(mobileSnap === 'peek' ? 'half' : 'full');
    } else if (dy > 32) {
      onChangeMobileSnap(mobileSnap === 'full' ? 'half' : 'peek');
    }
  };

  const openSearchFromPeek = () => {
    onChangeMobileSnap('half');
    window.setTimeout(() => composerRef.current?.focus(), 60);
  };

  const selectedDirectionsHref =
    safeExternalUrl(selectedSpecialist?.directionsUri) ||
    (selectedSpecialist && origin
      ? `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${selectedSpecialist.location.lat},${selectedSpecialist.location.lng}&travelmode=${toGoogleMapsUrlTravelMode(travelMode)}`
      : safeExternalUrl(selectedSpecialist?.googleMapsUri));

  // Desktop collapsed floating pill (retains accessible H1 for screen reader outline)
  if (!open) {
    return (
      <div className="hidden lg:block absolute top-4 left-4 z-30">
        <h1 className="sr-only">{SHOWCASE_CONFIG.brandName}</h1>
        <button
          type="button"
          onClick={onToggleOpen}
          aria-label={`Open ${SHOWCASE_CONFIG.brandName} panel`}
          className="inline-flex items-center gap-2 h-10 px-3.5 bg-[var(--surface)]/95 border border-[var(--line)] rounded-xl shadow-sm text-sm font-semibold text-[var(--ink)] hover:border-[var(--accent)] active:scale-[0.98] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
        >
          <span className="font-display tracking-tight">{SHOWCASE_CONFIG.brandName}</span>
          {specialists.length > 0 && (
            <span className="text-xs font-normal text-[var(--muted)] tabular-nums">
              · {specialists.length}
            </span>
          )}
          <ChevronRight className="w-4 h-4 text-[var(--muted)]" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <aside
      aria-label={`${SHOWCASE_CONFIG.brandName} search and cards`}
      className={`
        fixed inset-x-0 bottom-0 z-30 flex flex-col
        bg-[var(--surface)]/97 border-t border-[var(--line)] rounded-t-2xl shadow-lg
        transition-[height] duration-200 ease-out
        ${MOBILE_SNAP_HEIGHT_CLASS[mobileSnap]}
        lg:absolute lg:inset-x-auto lg:top-4 lg:left-4 lg:bottom-4 lg:h-auto lg:max-h-none lg:w-[428px]
        lg:rounded-2xl lg:border lg:shadow-md
        overflow-clip
      `}
    >
      {/* Mobile Grab Handle (tap or vertical swipe; pan-x keeps horizontal gestures free) */}
      <div
        className="lg:hidden flex items-center justify-center shrink-0 touch-pan-x"
        onTouchStart={handleGrabTouchStart}
        onTouchEnd={handleGrabTouchEnd}
      >
        <button
          type="button"
          onClick={cycleMobileSnap}
          aria-label={
            mobileSnap === 'full'
              ? 'Collapse drawer to reveal map'
              : 'Expand results drawer'
          }
          className="flex items-center justify-center w-28 min-h-[44px] cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded-full"
        >
          <span className="w-9 h-1 rounded-full bg-[var(--line)]" />
        </button>
      </div>

      {/* Slim Header: Brand + Origin Pill + Controls */}
      <header
        className={`px-3.5 py-2 border-b border-[var(--line)]/80 shrink-0 space-y-2 ${
          mobileSnap === 'peek' && !selectedSpecialist
            ? 'pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:pb-2'
            : ''
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <h1 className="font-display text-sm font-bold tracking-tight text-[var(--ink)] whitespace-nowrap shrink-0">
              {SHOWCASE_CONFIG.brandName}
            </h1>
            {!editingLocation && (
              <>
                <span aria-hidden="true" className="text-[var(--muted)] opacity-40">
                  ·
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setLocationDraft(origin?.label || '');
                    setEditingLocation(true);
                    if (mobileSnap === 'peek') onChangeMobileSnap('half');
                  }}
                  className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-[36px] px-1.5 -mx-1.5 text-xs text-[var(--muted)] hover:text-[var(--ink)] min-w-0 cursor-pointer rounded-md focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                >
                  <MapPin
                    className={`w-3.5 h-3.5 shrink-0 ${
                      origin ? 'text-[var(--accent-text)]' : 'text-[var(--muted)]'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="truncate font-medium">
                    {origin ? origin.label : 'Location'}
                  </span>
                </button>
              </>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {mobileSnap === 'peek' && (
              <button
                type="button"
                onClick={openSearchFromPeek}
                aria-label="Open search"
                title="Search"
                className="lg:hidden inline-flex items-center justify-center min-h-[44px] min-w-[44px] text-[var(--ink)] hover:bg-[var(--surface-subtle)] active:scale-95 rounded-lg transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              >
                <Search className="w-4 h-4" aria-hidden="true" />
              </button>
            )}

            {(turns.length > 0 || origin) && (
              <button
                type="button"
                onClick={onReset}
                aria-label="Reset search"
                title="Reset"
                className="inline-flex items-center justify-center gap-1 min-h-[44px] min-w-[44px] sm:min-h-[34px] sm:min-w-0 px-2 text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-subtle)] active:scale-95 rounded-lg transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Reset</span>
              </button>
            )}

            <button
              type="button"
              onClick={() =>
                onChangeMobileSnap(mobileSnap === 'peek' ? 'half' : 'peek')
              }
              aria-label={mobileSnap === 'peek' ? 'Show cards' : 'Show full map'}
              className="lg:hidden inline-flex items-center gap-1 min-h-[44px] px-2.5 text-xs font-medium text-[var(--ink)] hover:bg-[var(--surface-subtle)] active:scale-95 rounded-lg transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              {mobileSnap === 'peek' ? (
                <>
                  <span>Cards</span>
                  <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                </>
              ) : (
                <>
                  <span>Map</span>
                  <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                </>
              )}
            </button>

            <button
              type="button"
              onClick={onToggleOpen}
              aria-label="Collapse panel"
              title="Collapse"
              className="hidden lg:inline-flex items-center justify-center h-8 w-8 text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-subtle)] rounded-lg transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              <ChevronLeft className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {editingLocation && (
          <form onSubmit={handleLocationSubmit} className="flex items-center gap-1.5">
            <label htmlFor={locationInputId} className="sr-only">
              Starting location
            </label>
            <input
              id={locationInputId}
              name="location"
              type="text"
              autoComplete="street-address"
              enterKeyHint="go"
              autoFocus
              value={locationDraft}
              onChange={(e) => setLocationDraft(e.target.value)}
              placeholder="City, ZIP, or street..."
              className="flex-1 min-w-0 min-h-[44px] sm:min-h-[36px] px-2.5 text-base sm:text-xs text-[var(--ink)] placeholder:text-[var(--muted)] bg-[var(--bg)] border border-[var(--control-line)] rounded-lg focus:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
            />
            <button
              type="submit"
              className="min-h-[44px] sm:min-h-[36px] px-3 text-xs font-semibold text-[var(--accent-ink)] bg-[var(--accent)] active:scale-[0.98] rounded-lg whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              Set
            </button>
            <button
              type="button"
              onClick={() => setEditingLocation(false)}
              className="min-h-[44px] sm:min-h-[36px] px-2 text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)] rounded-lg whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              Cancel
            </button>
          </form>
        )}
      </header>

      {/* Mobile Peek Strip: compact active specialist bar with safe-area bottom padding */}
      {mobileSnap === 'peek' && selectedSpecialist && (
        <div className="lg:hidden px-3.5 py-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onChangeMobileSnap('half')}
            className="min-w-0 min-h-[44px] text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded"
          >
            <p className="text-xs font-semibold text-[var(--ink)] truncate">
              {selectedSpecialist.name}
            </p>
            <p className="text-[11px] text-[var(--muted)] tabular-nums">
              <span className="font-semibold text-[var(--accent-text)]">
                {formatTravelTime(selectedSpecialist.travelDurationSeconds)}
              </span>
              {selectedSpecialist.rating != null && (
                <span> · {selectedSpecialist.rating.toFixed(1)}★</span>
              )}
            </p>
          </button>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (mapViewMode === '3d') {
                  onToggleOrbit();
                } else {
                  onInspectIn3D(selectedSpecialist.id);
                }
              }}
              aria-pressed={mapViewMode === '3d' ? isOrbiting : undefined}
              aria-label={
                mapViewMode === '3d'
                  ? `Orbit ${selectedSpecialist.name} in 3D`
                  : `Inspect ${selectedSpecialist.name} in 3D`
              }
              className={`inline-flex items-center justify-center gap-1 min-h-[44px] px-3 text-xs font-medium rounded-lg border cursor-pointer active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
                mapViewMode === '3d' && isOrbiting
                  ? 'bg-[var(--accent)] text-[var(--accent-ink)] border-[var(--accent)]'
                  : 'border-[var(--line)] text-[var(--ink)]'
              }`}
            >
              {mapViewMode === '3d' ? (
                <>
                  <Orbit className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{isOrbiting ? 'Stop' : 'Orbit'}</span>
                </>
              ) : (
                <>
                  <Box className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>3D</span>
                </>
              )}
            </button>
            {selectedDirectionsHref && (
              <a
                href={selectedDirectionsHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1 min-h-[44px] px-3 text-xs font-semibold rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
              >
                <Navigation className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Route</span>
                <span className="sr-only"> to {selectedSpecialist.name}</span>
              </a>
            )}
          </div>
        </div>
      )}

      {/* Main Scrollable Thread & A2UI Cards (hidden on mobile peek so map owns the viewport) */}
      <div
        role="log"
        aria-live="polite"
        aria-label={`Conversation with ${SHOWCASE_CONFIG.brandName}`}
        className={`flex-1 agent-scroll px-3 py-3.5 space-y-4 ${
          mobileSnap === 'peek' ? 'hidden lg:block' : 'block'
        }`}
      >
        <maui-providers additional-attribution-ids={SHOWCASE_CONFIG.attributionIds.join(',')}>
          {turns.length === 0 && (
            <div className="space-y-3.5 px-0.5" data-testid="agent-welcome">
              <h2 className="font-display text-lg font-bold text-[var(--ink)] leading-snug">
                {SHOWCASE_CONFIG.headline}
              </h2>

              <ul role="list" className="space-y-1.5">
                {SHOWCASE_CONFIG.starters.map((starter) => (
                  <li key={starter.label}>
                    <button
                      type="button"
                      disabled={isLoading}
                      onClick={() => onSubmitMessage(starter.prompt)}
                      className="w-full flex items-center justify-between gap-3 min-h-[44px] px-3.5 py-2.5 text-left text-xs font-medium text-[var(--ink)] bg-[var(--surface-subtle)] hover:bg-[var(--accent-soft)] border border-[var(--line)] hover:border-[var(--accent)] active:scale-[0.99] rounded-xl transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
                    >
                      <span>{starter.label}</span>
                      <ArrowRight
                        className="w-3.5 h-3.5 text-[var(--muted)] shrink-0"
                        aria-hidden="true"
                      />
                    </button>
                  </li>
                ))}
              </ul>

              {!origin && (
                <button
                  type="button"
                  onClick={onUseGps}
                  disabled={isLocatingGps}
                  className="inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-[36px] text-xs font-medium text-[var(--accent-text)] hover:underline cursor-pointer disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded"
                >
                  <LocateFixed className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{isLocatingGps ? 'Locating...' : 'Use my location'}</span>
                </button>
              )}
            </div>
          )}

          {turns.map((turn, idx) => {
            const isLatestTurn = idx === turns.length - 1;

            if (turn.role === 'user') {
              return (
                <div key={turn.id} className="flex justify-end">
                  <div className="max-w-[85%] px-3 py-2 rounded-2xl rounded-br-sm bg-[var(--accent-soft)] text-[var(--ink)] border border-[var(--accent)]/30 text-xs sm:text-sm leading-snug">
                    {turn.text}
                  </div>
                </div>
              );
            }

            const turnSpecialists =
              isLatestTurn && specialists.length > 0
                ? specialists
                : turn.specialistsSnapshot ?? specialists;

            return (
              <div key={turn.id} data-testid={`agent-turn-${idx}`} className="space-y-2.5">
                {turn.error ? (
                  <div
                    role="alert"
                    className="p-3 rounded-xl text-xs leading-relaxed border"
                    style={{
                      backgroundColor: 'var(--status-error-bg)',
                      borderColor: 'var(--status-error-border)',
                      color: 'var(--status-error)',
                    }}
                  >
                    {turn.error}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--ink)] leading-relaxed px-0.5">
                    {turn.text}
                  </p>
                )}

                {turn.geminiNotice && !turn.error && (
                  <div
                    role="status"
                    data-testid="gemini-notice"
                    className="px-3 py-2 rounded-lg text-[11px] leading-relaxed border"
                    style={{
                      backgroundColor: 'var(--status-warn-bg)',
                      borderColor: 'var(--status-warn-border)',
                      color: 'var(--status-warn)',
                    }}
                  >
                    {turn.geminiNotice}
                  </div>
                )}

                {/* Compact Google Maps Grounding Source Pills with required "Google Maps" attribution */}
                {turn.groundingSources && turn.groundingSources.length > 0 && (() => {
                  const safeSources = turn.groundingSources
                    .slice(0, 3)
                    .map((src) => ({ ...src, safeHref: safeExternalUrl(src.uri) }))
                    .filter((src): src is typeof src & { safeHref: string } => Boolean(src.safeHref));
                  if (safeSources.length === 0) return null;
                  return (
                    <div
                      className="flex flex-wrap items-center gap-1.5 px-0.5"
                      data-testid="maps-links"
                    >
                      <span
                        translate="no"
                        className="text-[11px] font-medium text-[var(--muted)] whitespace-nowrap"
                      >
                        Google Maps
                      </span>
                      <ul role="list" className="flex flex-wrap items-center gap-1.5">
                        {safeSources.map((src) => (
                          <li key={src.safeHref}>
                            <a
                              href={src.safeHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-[28px] px-2.5 sm:px-2 py-0.5 rounded-md text-[11px] font-medium text-[var(--accent-text)] bg-[var(--surface-subtle)] hover:bg-[var(--accent-soft)] border border-[var(--line)] transition-colors max-w-[190px] focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                            >
                              <span className="truncate">{src.title}</span>
                              <ExternalLink className="w-2.5 h-2.5 shrink-0 opacity-75" aria-hidden="true" />
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })()}

                {turn.genUiBlock && (
                  <GenUiBlockRenderer
                    block={turn.genUiBlock}
                    specialists={turnSpecialists}
                    origin={origin}
                    travelMode={turn.travelMode ?? travelMode}
                    sortMode={sortMode}
                    resolvedTheme={resolvedTheme}
                    isLatestTurn={isLatestTurn}
                    selectedId={selectedId}
                    syncedSet={syncedSet}
                    isLocatingGps={isLocatingGps}
                    onFocusSpecialist={onSelectSpecialist}
                    onInspectIn3D={onInspectIn3D}
                    onHoverSpecialist={onHoverSpecialist}
                    onToggleSyncId={onToggleSyncId}
                    onSelectTopThree={onSelectTopThree}
                    onChangeSortMode={onChangeSortMode}
                    onUseGps={onUseGps}
                    onSubmitLocationText={onSetLocationText}
                    onAskAboutClinic={handleAskAboutClinic}
                  />
                )}

                {isLatestTurn &&
                  !isLoading &&
                  turn.suggestedFollowUps &&
                  turn.suggestedFollowUps.length > 0 && (
                    <ul
                      role="list"
                      aria-label="Follow-up prompts"
                      className="flex flex-wrap gap-1.5 pt-0.5"
                      data-testid="guided-followups"
                    >
                      {turn.suggestedFollowUps.slice(0, 3).map((item) => (
                        <li key={item.label}>
                          <button
                            type="button"
                            onClick={() => onSubmitMessage(item.prompt)}
                            className="min-h-[44px] sm:min-h-[34px] px-2.5 py-1.5 text-xs font-medium text-[var(--accent-text)] bg-[var(--surface)] hover:bg-[var(--accent-soft)] border border-[var(--line)] hover:border-[var(--accent)] active:scale-[0.98] rounded-lg transition-colors text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                          >
                            {item.label}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
              </div>
            );
          })}

          {isLoading && (
            <div className="space-y-2 pt-1" aria-busy="true">
              <div className="flex items-center gap-2 text-xs font-medium text-[var(--muted)]">
                <progress
                  aria-label="Finding places and routes"
                  className="loading-spinner"
                />
                <span>Finding places and routes...</span>
              </div>
              <div
                aria-hidden="true"
                className="p-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] space-y-2"
              >
                <div className="h-3 w-1/2 bg-[var(--surface-subtle)] rounded animate-pulse" />
                <div className="h-16 w-full bg-[var(--surface-subtle)] rounded-lg animate-pulse" />
              </div>
            </div>
          )}
        </maui-providers>
        <div ref={threadEndRef} />
      </div>

      {/* Multi-Stop Sync to Google Maps Bar */}
      {syncedSpecialists.length > 0 && googleMapsSyncUrl && mobileSnap !== 'peek' && (
        <div
          data-testid="maps-sync-bar"
          className="px-3.5 py-2.5 border-t border-[var(--accent)]/30 bg-[var(--accent-soft)] shrink-0 space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-[var(--ink)] tabular-nums truncate">
              {syncedSpecialists.length} selected ·{' '}
              <span className="font-normal text-[var(--muted)]">
                {syncedSpecialists.map((s) => s.name).join(' → ')}
              </span>
            </p>
            <button
              type="button"
              onClick={onClearSynced}
              aria-label="Clear selection"
              className="inline-flex items-center justify-center min-w-[44px] min-h-[44px] sm:min-w-[28px] sm:min-h-[28px] -mr-2 sm:mr-0 rounded-md text-[var(--muted)] hover:text-[var(--ink)] shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <a
              href={googleMapsSyncUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="maps-sync-open-link"
              className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[36px] px-3 text-xs font-semibold text-[var(--accent-ink)] bg-[var(--accent)] hover:opacity-90 active:scale-[0.98] rounded-lg transition-opacity whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
            >
              <span>Open in Google Maps</span>
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </a>

            <button
              type="button"
              onClick={handleCopySyncLink}
              data-testid="maps-sync-copy-btn"
              className="inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[36px] px-3 text-xs font-semibold text-[var(--ink)] bg-[var(--surface)] border border-[var(--line)] hover:border-[var(--accent)] active:scale-[0.98] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              {copiedLink ? (
                <>
                  <Check className="w-3.5 h-3.5 text-[var(--accent-text)]" aria-hidden="true" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Semantic <search> Composer (hidden on mobile peek so peek stays compact) */}
      <search
        className={`shrink-0 ${
          mobileSnap === 'peek' ? 'hidden lg:block' : 'block'
        }`}
      >
        <form
          onSubmit={handleSend}
          className="px-3 py-2.5 border-t border-[var(--line)]/80 bg-[var(--surface)] pb-[max(0.625rem,env(safe-area-inset-bottom))]"
        >
          <label htmlFor="agent-composer-input" className="sr-only">
            Search specialists or ask a follow-up
          </label>
          <div className="flex items-center gap-1.5 p-1 bg-[var(--bg)] border border-[var(--control-line)] rounded-xl focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent)]/25 transition-colors">
            <button
              type="button"
              onClick={onUseGps}
              disabled={isLocatingGps}
              title="Use current location"
              aria-label="Use current location"
              className="flex items-center justify-center min-w-[44px] min-h-[44px] sm:min-w-[36px] sm:min-h-[36px] rounded-lg text-[var(--muted)] hover:text-[var(--accent-text)] hover:bg-[var(--accent-soft)] active:scale-95 transition-colors shrink-0 cursor-pointer disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              <LocateFixed className="w-4 h-4" aria-hidden="true" />
            </button>

            <input
              ref={composerRef}
              id="agent-composer-input"
              name="query"
              type="search"
              enterKeyHint="search"
              value={messageInput}
              onChange={(e) => setMessageInput(e.target.value)}
              onFocus={() => {
                if (mobileSnap === 'peek') onChangeMobileSnap('half');
              }}
              placeholder={
                turns.length > 0
                  ? SHOWCASE_CONFIG.followUpPlaceholder
                  : SHOWCASE_CONFIG.composerPlaceholder
              }
              className="flex-1 min-w-0 bg-transparent text-base sm:text-sm text-[var(--ink)] placeholder:text-[var(--muted)] focus:outline-none px-1"
            />

            <button
              type="submit"
              disabled={isLoading || !messageInput.trim()}
              aria-label="Send"
              className="flex items-center justify-center min-w-[44px] min-h-[44px] sm:min-w-[36px] sm:min-h-[36px] rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] hover:opacity-90 active:scale-95 disabled:opacity-35 transition-opacity shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
            >
              <ArrowUp className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </form>
      </search>
    </aside>
  );
}
