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
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  ExternalLink,
  Info,
  ListChecks,
  LocateFixed,
  MapPin,
  Maximize2,
  Minimize2,
  Navigation,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import { SHOWCASE_CONFIG } from '../config/showcase.ts';
import type { ResolvedTheme } from '../hooks/useTheme.ts';
import type {
  AgentTurn,
  OriginLocation,
  SortMode,
  Specialist,
  TravelMode,
} from '../types.ts';
import { prefersReducedMotion } from '../utils/camera.ts';
import {
  buildGoogleMapsShortlistUrl,
  buildGoogleMapsSyncUrl,
  buildPlaceDetailsUrl,
  buildPlaceDirectionsUrl,
  buildShortlistShareText,
} from '../utils/mapsSync.ts';
import { formatTravelTime } from '../utils/ranking.ts';
import { safeExternalUrl } from '../utils/url.ts';
import { AddressAutocompleteInput } from './AddressAutocompleteInput.tsx';
import { GenUiBlockRenderer } from './GenUiBlocks.tsx';
import { PlaceDetailView } from './PlaceDetailView.tsx';

export type MobileSheetSnap = 'peek' | 'half' | 'full';

interface AgentSidebarProps {
  open: boolean;
  mobileSnap: MobileSheetSnap;
  origin: OriginLocation | null;
  activeSpecialty: string | null;
  travelMode: TravelMode;
  sortMode: SortMode;
  resolvedTheme: ResolvedTheme;
  turns: AgentTurn[];
  specialists: Specialist[];
  selectedId: string | null;
  inspectedId: string | null;
  syncedIds: string[];
  loadingDetailsId: string | null;
  isLoading: boolean;
  isLocatingGps: boolean;
  onToggleOpen: () => void;
  onChangeMobileSnap: (snap: MobileSheetSnap) => void;
  onSubmitMessage: (message: string) => void;
  onUseGps: () => void;
  onSetLocationText: (locationText: string) => void;
  onSelectOrigin: (origin: OriginLocation) => void;
  onChangeSortMode: (mode: SortMode) => void;
  onSelectSpecialist: (id: string) => void;
  onOpenDetails: (id: string) => void;
  onCloseDetails: () => void;
  onHoverSpecialist: (id: string | null) => void;
  onToggleSyncId: (id: string) => void;
  onSelectTopThree: () => void;
  onClearSynced: () => void;
  onRequestPlaceDetails: (id: string) => void;
  onReset: () => void;
}

const MOBILE_SNAP_HEIGHT_CLASS: Record<MobileSheetSnap, string> = {
  peek: 'h-auto max-h-[33dvh]',
  half: 'h-[min(58dvh,calc(100%-112px))]',
  full: 'h-[min(86dvh,calc(100%-112px))]',
};

export function AgentSidebar({
  open,
  mobileSnap,
  origin,
  activeSpecialty,
  travelMode,
  sortMode,
  resolvedTheme,
  turns,
  specialists,
  selectedId,
  inspectedId,
  syncedIds,
  loadingDetailsId,
  isLoading,
  isLocatingGps,
  onToggleOpen,
  onChangeMobileSnap,
  onSubmitMessage,
  onUseGps,
  onSetLocationText,
  onSelectOrigin,
  onChangeSortMode,
  onSelectSpecialist,
  onOpenDetails,
  onCloseDetails,
  onHoverSpecialist,
  onToggleSyncId,
  onSelectTopThree,
  onClearSynced,
  onRequestPlaceDetails,
  onReset,
}: AgentSidebarProps) {
  const locationInputId = useId();
  const welcomeLocationId = useId();
  const [messageInput, setMessageInput] = useState('');
  const [editingLocation, setEditingLocation] = useState(false);
  const [locationDraft, setLocationDraft] = useState('');
  const [welcomeLocationDraft, setWelcomeLocationDraft] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [shortlistOpen, setShortlistOpen] = useState(true);

  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLInputElement | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const selectedSpecialist = useMemo(
    () => specialists.find((s) => s.id === selectedId) ?? null,
    [specialists, selectedId]
  );

  const inspectedSpecialist = useMemo(
    () => specialists.find((s) => s.id === inspectedId) ?? null,
    [specialists, inspectedId]
  );

  const inspectedRank = useMemo(() => {
    if (!inspectedSpecialist) return 1;
    const idx = specialists.findIndex((s) => s.id === inspectedSpecialist.id);
    return idx >= 0 ? idx + 1 : 1;
  }, [specialists, inspectedSpecialist]);

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

  const shortlistMapsUrl = useMemo(
    () => buildGoogleMapsShortlistUrl(syncedSpecialists, activeSpecialty, origin),
    [syncedSpecialists, activeSpecialty, origin]
  );

  const multiStopRouteUrl = useMemo(
    () => buildGoogleMapsSyncUrl(origin, syncedSpecialists, travelMode),
    [origin, syncedSpecialists, travelMode]
  );

  const singleShortlistPlaceUrl = useMemo(
    () =>
      syncedSpecialists.length === 1
        ? buildPlaceDetailsUrl(syncedSpecialists[0]) ?? null
        : null,
    [syncedSpecialists]
  );

  const singleShortlistRouteUrl = useMemo(
    () =>
      syncedSpecialists.length === 1
        ? buildPlaceDirectionsUrl(origin, syncedSpecialists[0], travelMode) ?? null
        : null,
    [origin, syncedSpecialists, travelMode]
  );

  const handleCopyShortlist = async () => {
    const text =
      syncedSpecialists.length === 1
        ? singleShortlistPlaceUrl || ''
        : buildShortlistShareText(origin, syncedSpecialists, travelMode);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
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
    onChangeMobileSnap('full');
    onSubmitMessage(trimmed);
  };

  const handleLocationSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = locationDraft.trim();
    if (!trimmed) return;
    setEditingLocation(false);
    onSetLocationText(trimmed);
  };

  const handleWelcomeLocationSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = welcomeLocationDraft.trim();
    if (!trimmed || isLoading) return;
    setWelcomeLocationDraft('');
    onChangeMobileSnap('full');
    onSetLocationText(trimmed);
  };

  const handleHeaderOriginSelect = (selected: OriginLocation) => {
    setEditingLocation(false);
    setLocationDraft(selected.label);
    onSelectOrigin(selected);
  };

  const handleWelcomeOriginSelect = (selected: OriginLocation) => {
    setWelcomeLocationDraft('');
    onChangeMobileSnap('full');
    onSelectOrigin(selected);
  };

  const handleAskAboutClinic = (clinic: Specialist) => {
    if (isLoading) return;
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      onCloseDetails();
      onChangeMobileSnap('full');
    }
    onSubmitMessage(`Hours and reviews for ${clinic.name}`);
  };

  const handleAskInspectorQuestion = (question: string) => {
    if (isLoading) return;
    if (typeof window !== 'undefined' && window.innerWidth < 1024) {
      onCloseDetails();
      onChangeMobileSnap('full');
    }
    onSubmitMessage(question);
  };

  const handleGrabTouchStart = (e: TouchEvent<HTMLElement>) => {
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
  };

  const handleGrabTouchEnd = (e: TouchEvent<HTMLElement>) => {
    const startY = touchStartYRef.current;
    touchStartYRef.current = null;
    const endY = e.changedTouches[0]?.clientY;
    if (startY == null || endY == null) return;
    const dy = endY - startY;
    if (dy < -28) {
      onChangeMobileSnap('full');
    } else if (dy > 28) {
      onChangeMobileSnap('peek');
    }
  };

  const openSearchFromPeek = () => {
    onChangeMobileSnap('full');
    window.setTimeout(() => composerRef.current?.focus(), 60);
  };

  const peekSpecialist = selectedSpecialist ?? specialists[0] ?? null;

  const peekDirectionsHref = buildPlaceDirectionsUrl(origin, peekSpecialist, travelMode);

  return (
    <>
      {/* Desktop collapsed floating pill (retains accessible H1 on desktop while <aside> is lg:hidden) */}
      {!open && (
        <div className="hidden lg:block absolute top-4 left-4 z-30">
          <h1 className="sr-only">{SHOWCASE_CONFIG.brandName}</h1>
          <button
            type="button"
            onClick={onToggleOpen}
            aria-label={`Open ${SHOWCASE_CONFIG.brandName} panel`}
            className="inline-flex items-center gap-2 h-10 px-3.5 bg-[var(--surface)]/95 border border-[var(--line)] rounded-xl shadow-sm text-sm font-semibold text-[var(--ink)] hover:border-[var(--accent)] active:scale-[0.98] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
          >
            <span className="font-display tracking-tight truncate max-w-[320px]">
              {SHOWCASE_CONFIG.brandName}
            </span>
            {specialists.length > 0 && (
              <span className="text-xs font-normal text-[var(--muted)] tabular-nums">
                · {specialists.length}
              </span>
            )}
            <ChevronRight className="w-4 h-4 text-[var(--muted)]" aria-hidden="true" />
          </button>
        </div>
      )}

      <aside
        aria-label={`${SHOWCASE_CONFIG.brandName} search and cards`}
        className={`
          order-2 relative z-30 flex flex-col shrink-0 w-full
          bg-[var(--surface)] border-t border-[var(--line)] rounded-t-2xl shadow-lg
          transition-[height] duration-200 ease-out
          ${MOBILE_SNAP_HEIGHT_CLASS[mobileSnap]}
          lg:order-1 lg:static lg:h-full lg:max-h-none lg:w-[428px]
          lg:rounded-none lg:border-t-0 lg:border-r lg:border-[var(--line)] lg:shadow-none
          ${!open ? 'lg:hidden' : ''}
          overflow-clip
        `}
      >
      {/* Minimal Mobile Header (merged drag handle + single row + clear Minimize/Maximize) & Full Desktop Header */}
      <header
        onTouchStart={handleGrabTouchStart}
        onTouchEnd={handleGrabTouchEnd}
        className={`relative z-20 px-3 lg:px-3.5 pt-1.5 pb-1.5 lg:py-2 border-b border-[var(--line)]/80 shrink-0 space-y-1.5 lg:space-y-2 touch-pan-x ${
          mobileSnap === 'peek' && !peekSpecialist
            ? 'pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:pb-2'
            : ''
        }`}
      >
        {/* Subtle Mobile Drag Indicator */}
        <div className="lg:hidden flex justify-center" aria-hidden="true">
          <span className="w-9 h-1 rounded-full bg-[var(--line)]" />
        </div>

        <div className="flex items-center lg:items-start justify-between gap-1.5 lg:gap-2">
          <div className="flex items-center lg:flex-col lg:items-start gap-2 lg:gap-0.5 min-w-0 flex-1">
            <h1 className="font-display text-[13px] font-bold tracking-tight text-[var(--ink)] leading-snug truncate lg:whitespace-normal">
              <span className="lg:hidden">{SHOWCASE_CONFIG.mobileBrandName}</span>
              <span className="hidden lg:inline">{SHOWCASE_CONFIG.brandName}</span>
            </h1>
            {!editingLocation && (
              <button
                type="button"
                onClick={() => {
                  setLocationDraft(origin?.label || '');
                  setEditingLocation(true);
                  if (mobileSnap === 'peek') onChangeMobileSnap('full');
                }}
                aria-label={origin ? `Change starting location (${origin.label})` : 'Set starting location'}
                className="inline-flex items-center gap-1 min-h-[44px] lg:min-h-[24px] px-1.5 -my-2 lg:my-0 lg:-mx-1.5 text-xs text-[var(--muted)] hover:text-[var(--ink)] max-w-[140px] lg:max-w-full cursor-pointer rounded-md focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
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
                className="inline-flex items-center justify-center gap-1 min-h-[44px] min-w-[44px] lg:min-h-[34px] lg:min-w-0 px-2 text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--surface-subtle)] active:scale-95 rounded-lg transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span className="hidden lg:inline">Reset</span>
              </button>
            )}

            {/* Mobile Minimize / Maximize Sheet Controls */}
            {mobileSnap === 'peek' ? (
              <button
                type="button"
                onClick={() => onChangeMobileSnap('full')}
                aria-label="Maximize agent card"
                data-testid="mobile-maximize-btn"
                className="lg:hidden inline-flex items-center gap-1.5 min-h-[44px] px-3 text-xs font-semibold text-[var(--accent-ink)] bg-[var(--accent)] hover:opacity-90 active:scale-95 rounded-lg transition-opacity cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
              >
                <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Expand</span>
              </button>
            ) : (
              <div className="lg:hidden flex items-center gap-1">
                {mobileSnap === 'half' && (
                  <button
                    type="button"
                    onClick={() => onChangeMobileSnap('full')}
                    aria-label="Maximize agent card"
                    data-testid="mobile-maximize-btn"
                    className="inline-flex items-center gap-1 min-h-[44px] px-2.5 text-xs font-semibold text-[var(--accent-text)] bg-[var(--accent-soft)] border border-[var(--accent)]/35 active:scale-95 rounded-lg transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                  >
                    <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Full</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onChangeMobileSnap('peek')}
                  aria-label="Minimize card to show top two-thirds map"
                  data-testid="mobile-minimize-btn"
                  className="inline-flex items-center gap-1 min-h-[44px] px-2.5 text-xs font-semibold text-[var(--ink)] bg-[var(--surface-subtle)] border border-[var(--control-line)] active:scale-95 rounded-lg transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                >
                  <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Map</span>
                </button>
              </div>
            )}

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
            <AddressAutocompleteInput
              id={locationInputId}
              name="location"
              autoFocus
              value={locationDraft}
              onChange={setLocationDraft}
              onSelectOrigin={handleHeaderOriginSelect}
              locationBiasCenter={origin ? { lat: origin.lat, lng: origin.lng } : null}
              placeholder="City, ZIP, or street..."
              className="min-h-[44px] sm:min-h-[36px] px-2.5 text-base sm:text-xs text-[var(--ink)] placeholder:text-[var(--muted)] bg-[var(--bg)] border border-[var(--control-line)] rounded-lg focus:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
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

      {/* Mobile Minimized Peek Strip: leaves top 2/3+ viewport for the interactive map */}
      {mobileSnap === 'peek' && peekSpecialist && (
        <div className="lg:hidden px-3 py-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex items-center justify-between gap-2 shrink-0">
          <button
            type="button"
            onClick={() => onChangeMobileSnap('full')}
            className="min-w-0 flex-1 min-h-[44px] text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded"
          >
            <p className="text-xs font-semibold text-[var(--ink)] truncate">
              {selectedSpecialist ? peekSpecialist.name : `#1 ${peekSpecialist.name}`}
              {!selectedSpecialist && specialists.length > 1 && (
                <span className="font-normal text-[var(--muted)]">
                  {' '}· +{specialists.length - 1} more
                </span>
              )}
            </p>
            <p className="text-[11px] text-[var(--muted)] tabular-nums truncate">
              <span className="font-semibold text-[var(--accent-text)]">
                {formatTravelTime(peekSpecialist.travelDurationSeconds)}
              </span>
              {peekSpecialist.rating != null && (
                <span> · {peekSpecialist.rating.toFixed(1)}★</span>
              )}
              {peekSpecialist.compositeScore != null && (
                <span> · Score {peekSpecialist.compositeScore}/100</span>
              )}
            </p>
          </button>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onOpenDetails(peekSpecialist.id)}
              className="inline-flex items-center justify-center gap-1 min-h-[44px] px-2.5 text-xs font-semibold rounded-lg bg-[var(--surface-subtle)] border border-[var(--control-line)] text-[var(--ink)] active:scale-[0.98] cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              <Info className="w-3.5 h-3.5 text-[var(--accent-text)]" aria-hidden="true" />
              <span>Details</span>
            </button>
            {peekDirectionsHref && (
              <a
                href={peekDirectionsHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-1 min-h-[44px] px-3 text-xs font-semibold rounded-lg bg-[var(--accent)] text-[var(--accent-ink)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
              >
                <Navigation className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Route</span>
                <span className="sr-only"> to {peekSpecialist.name}</span>
              </a>
            )}
          </div>
        </div>
      )}

      {/* Mobile Dedicated Place Inspector View (1-tap back to chat & options) */}
      {inspectedSpecialist && mobileSnap !== 'peek' && (
        <div className="lg:hidden flex-1 agent-scroll px-3 py-3">
          <PlaceDetailView
            specialist={inspectedSpecialist}
            rank={inspectedRank}
            origin={origin}
            travelMode={travelMode}
            isSynced={syncedSet.has(inspectedSpecialist.id)}
            isLoadingDetails={loadingDetailsId === inspectedSpecialist.id}
            backLabel="Back to agent & options"
            onBack={onCloseDetails}
            onToggleSync={onToggleSyncId}
            onAskAboutClinic={handleAskAboutClinic}
            onAskQuestion={handleAskInspectorQuestion}
            onRequestDetails={onRequestPlaceDetails}
          />
        </div>
      )}

      {/* Main Scrollable Thread & A2UI Cards (hidden on mobile peek or mobile detail view) */}
      <div
        role="log"
        aria-live="polite"
        aria-label={`Conversation with ${SHOWCASE_CONFIG.brandName}`}
        className={`flex-1 agent-scroll px-4 py-4 ${
          mobileSnap === 'peek' || inspectedSpecialist ? 'hidden lg:block' : 'block'
        }`}
      >
        <maui-providers additional-attribution-ids={SHOWCASE_CONFIG.attributionIds.join(',')}>
          <div className="flex flex-col">
            {turns.length === 0 && (
              <div className="space-y-4" data-testid="agent-welcome">
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-[var(--accent-text)]">
                    {SHOWCASE_CONFIG.agent.roleLabel}
                  </p>
                  <h2 className="font-display text-lg font-bold text-[var(--ink)] leading-snug">
                    {SHOWCASE_CONFIG.headline}
                  </h2>
                  <p className="text-xs text-[var(--muted)] leading-relaxed">
                    Start with your current location or address so nearby options, live travel times, and routes anchor to where you are.
                  </p>
                </div>

                {/* Primary First-Run Experience: Anchor Starting Location */}
                {!origin && (
                  <div
                    data-testid="welcome-location-anchor"
                    className="p-3.5 rounded-xl border border-[var(--line)] bg-[var(--surface-subtle)] space-y-3"
                  >
                    <button
                      type="button"
                      onClick={onUseGps}
                      disabled={isLocatingGps || isLoading}
                      className="w-full inline-flex items-center justify-center gap-2 min-h-[44px] px-3.5 text-xs font-semibold text-[var(--accent-ink)] bg-[var(--accent)] hover:opacity-90 active:scale-[0.99] rounded-lg transition-opacity cursor-pointer disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                    >
                      <LocateFixed className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>{isLocatingGps ? 'Locating you...' : 'Use my current location'}</span>
                    </button>

                    <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
                      <span className="h-px flex-1 bg-[var(--line)]" aria-hidden="true" />
                      <span>or enter an address</span>
                      <span className="h-px flex-1 bg-[var(--line)]" aria-hidden="true" />
                    </div>

                    <form onSubmit={handleWelcomeLocationSubmit} className="space-y-1.5">
                      <label
                        htmlFor={welcomeLocationId}
                        className="block text-xs font-semibold text-[var(--ink)]"
                      >
                        Starting address, city, or ZIP
                      </label>
                      <div className="flex items-center gap-1.5">
                        <AddressAutocompleteInput
                          id={welcomeLocationId}
                          name="street-address"
                          required
                          disabled={isLoading}
                          value={welcomeLocationDraft}
                          onChange={setWelcomeLocationDraft}
                          onSelectOrigin={handleWelcomeOriginSelect}
                          placeholder="Street address, city, or ZIP..."
                          className="min-h-[44px] sm:min-h-[38px] px-3 text-base sm:text-sm text-[var(--ink)] placeholder:text-[var(--muted)] bg-[var(--surface)] border border-[var(--control-line)] rounded-lg focus:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
                        />
                        <button
                          type="submit"
                          disabled={isLoading || !welcomeLocationDraft.trim()}
                          className="inline-flex items-center justify-center min-h-[44px] sm:min-h-[38px] px-3 text-xs font-semibold text-[var(--ink)] bg-[var(--surface)] hover:bg-[var(--accent-soft)] hover:border-[var(--accent)] border border-[var(--control-line)] active:scale-[0.98] disabled:opacity-45 rounded-lg whitespace-nowrap shrink-0 cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
                        >
                          Set location
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                <div className="pt-2 border-t border-[var(--line)]/80 space-y-2">
                  <p className="text-xs font-medium text-[var(--muted)]">
                    Or try an example search
                  </p>
                  <ul role="list" className="space-y-1.5">
                    {SHOWCASE_CONFIG.starters.map((starter) => (
                      <li key={starter.label}>
                        <button
                          type="button"
                          disabled={isLoading}
                          onClick={() => onSubmitMessage(starter.prompt)}
                          className="w-full flex items-center justify-between gap-3 min-h-[44px] px-3.5 py-2 text-left text-xs font-medium text-[var(--ink)] bg-[var(--surface-subtle)] hover:bg-[var(--accent-soft)] border border-[var(--line)] hover:border-[var(--accent)] active:scale-[0.99] rounded-xl transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
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
                </div>
              </div>
            )}

            {turns.map((turn, idx) => {
              const isLatestTurn = idx === turns.length - 1;
              const isNewConversationTurn = turn.role === 'user' && idx > 0;

              if (turn.role === 'user') {
                return (
                  <div
                    key={turn.id}
                    data-testid={`user-turn-${idx}`}
                    className={`flex justify-end ${
                      isNewConversationTurn
                        ? 'mt-7 pt-5 border-t border-[var(--line)]'
                        : ''
                    }`}
                  >
                    <div className="max-w-[85%] px-3.5 py-2 rounded-2xl rounded-br-sm bg-[var(--accent-soft)] text-[var(--ink)] border border-[var(--accent)]/30 text-xs sm:text-sm leading-snug">
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
                <div
                  key={turn.id}
                  data-testid={`agent-turn-${idx}`}
                  className={`${idx > 0 ? 'mt-3.5' : ''} space-y-3`}
                >
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

                {/* Compact Google Maps Grounding Sources + Review Snippet Links with required "Google Maps" attribution */}
                {turn.groundingSources && turn.groundingSources.length > 0 && (() => {
                  const safeSources = turn.groundingSources
                    .slice(0, 4)
                    .map((src) => ({
                      ...src,
                      safeHref: safeExternalUrl(src.uri),
                      safeSnippets: (src.reviewSnippets ?? [])
                        .map((snip) => ({
                          text: snip.text,
                          safeHref: safeExternalUrl(snip.uri) || safeExternalUrl(src.uri),
                        }))
                        .filter((snip): snip is { text: string; safeHref: string } =>
                          Boolean(snip.text && snip.safeHref)
                        ),
                    }))
                    .filter((src): src is typeof src & { safeHref: string } => Boolean(src.safeHref));
                  if (safeSources.length === 0) return null;

                  const reviewLinks = safeSources
                    .flatMap((src) =>
                      src.safeSnippets.map((snip) => ({
                        placeTitle: src.title,
                        text: snip.text,
                        href: snip.safeHref,
                      }))
                    )
                    .slice(0, 2);

                  return (
                    <div className="space-y-1.5 px-0.5" data-testid="maps-links">
                      <div className="flex flex-wrap items-center gap-1.5">
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
                      {reviewLinks.length > 0 && (
                        <ul role="list" className="space-y-1">
                          {reviewLinks.map((rev, rIdx) => (
                            <li key={`${rev.href}-${rIdx}`}>
                              <a
                                href={rev.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="group flex items-start gap-1.5 min-h-[44px] sm:min-h-0 px-2.5 py-2 sm:px-2 sm:py-1 rounded-md text-[11px] leading-snug text-[var(--muted)] hover:text-[var(--ink)] bg-[var(--surface-subtle)]/70 border border-[var(--line)]/70 transition-colors focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                              >
                                <span className="line-clamp-2 flex-1">
                                  “{rev.text}” — <span className="font-medium text-[var(--ink)]">{rev.placeTitle}</span>
                                  <span className="sr-only"> (Google Maps review)</span>
                                </span>
                                <ExternalLink className="w-2.5 h-2.5 mt-0.5 shrink-0 opacity-70 group-hover:opacity-100" aria-hidden="true" />
                              </a>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })()}

                {turn.genUiBlock && (
                  <GenUiBlockRenderer
                    block={turn.genUiBlock}
                    synthesis={turn.synthesis}
                    specialists={turnSpecialists}
                    origin={origin}
                    travelMode={turn.travelMode ?? travelMode}
                    sortMode={sortMode}
                    resolvedTheme={resolvedTheme}
                    isLatestTurn={isLatestTurn}
                    selectedId={selectedId}
                    syncedSet={syncedSet}
                    loadingDetailsId={loadingDetailsId}
                    isLocatingGps={isLocatingGps}
                    onFocusSpecialist={onSelectSpecialist}
                    onHoverSpecialist={onHoverSpecialist}
                    onToggleSyncId={onToggleSyncId}
                    onSelectTopThree={onSelectTopThree}
                    onChangeSortMode={onChangeSortMode}
                    onUseGps={onUseGps}
                    onSubmitLocationText={onSetLocationText}
                    onSelectOrigin={onSelectOrigin}
                    onAskAboutClinic={handleAskAboutClinic}
                    onAskQuestion={handleAskInspectorQuestion}
                    onOpenDetails={onOpenDetails}
                    onRequestPlaceDetails={onRequestPlaceDetails}
                  />
                )}

                {isLatestTurn &&
                  !isLoading &&
                  turn.suggestedFollowUps &&
                  turn.suggestedFollowUps.length > 0 && (
                    <ul
                      role="list"
                      aria-label="Follow-up prompts"
                      className="flex flex-wrap gap-1.5 pt-1"
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
              <div className="mt-4 space-y-2" aria-busy="true">
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
          </div>
        </maui-providers>
        <div ref={threadEndRef} />
      </div>

      {/* Mobile Quick Return Chip to Selected Place Details when asking questions */}
      {selectedSpecialist && !inspectedSpecialist && mobileSnap !== 'peek' && (
        <div className="lg:hidden px-3 py-1.5 border-t border-[var(--line)]/80 bg-[var(--surface-subtle)] flex items-center justify-between gap-2 shrink-0">
          <span className="text-[11px] text-[var(--muted)] truncate">
            Focused: <strong className="font-semibold text-[var(--ink)]">{selectedSpecialist.name}</strong>
          </span>
          <button
            type="button"
            onClick={() => onOpenDetails(selectedSpecialist.id)}
            className="inline-flex items-center gap-1 min-h-[36px] px-2.5 text-[11px] font-semibold text-[var(--accent-text)] bg-[var(--surface)] border border-[var(--accent)]/40 rounded-md whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Info className="w-3 h-3" aria-hidden="true" />
            <span>View details</span>
          </button>
        </div>
      )}

      {/* Interactive Shortlist Bar (opens individual Google Maps listings or browsable list — never forces multi-stop routing) */}
      {syncedSpecialists.length > 0 && mobileSnap !== 'peek' && (
        <div
          data-testid="maps-sync-bar"
          className="px-3.5 py-2.5 border-t border-[var(--accent)]/35 bg-[var(--accent-soft)] shrink-0 space-y-2"
        >
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setShortlistOpen((v) => !v)}
              aria-expanded={shortlistOpen}
              className="flex items-center gap-1.5 min-w-0 text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded"
            >
              <ListChecks className="w-4 h-4 text-[var(--accent-text)] shrink-0" aria-hidden="true" />
              <span className="text-xs font-semibold text-[var(--ink)] tabular-nums truncate">
                Shortlist ({syncedSpecialists.length})
              </span>
              {syncedSpecialists.length > 1 &&
                (shortlistOpen ? (
                  <ChevronDown className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" aria-hidden="true" />
                ) : (
                  <ChevronUp className="w-3.5 h-3.5 text-[var(--muted)] shrink-0" aria-hidden="true" />
                ))}
            </button>
            <button
              type="button"
              onClick={onClearSynced}
              aria-label="Clear shortlist"
              className="inline-flex items-center justify-center gap-1 min-w-[44px] min-h-[36px] sm:min-w-0 sm:min-h-[26px] px-1.5 text-[11px] font-medium rounded-md text-[var(--muted)] hover:text-[var(--ink)] shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              <span>Clear</span>
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>

          {/* Individual Shortlist Items: 1-tap open exact place on Google Maps or inspect details */}
          {shortlistOpen && syncedSpecialists.length > 1 && (
            <ul
              role="list"
              aria-label="Shortlisted places"
              className="max-h-[136px] agent-scroll rounded-lg border border-[var(--line)] bg-[var(--surface)] divide-y divide-[var(--line)]/70"
            >
              {syncedSpecialists.map((item, idx) => {
                const placeHref = buildPlaceDetailsUrl(item);
                return (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-1.5 px-2.5 py-1.5 text-xs"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenDetails(item.id)}
                      className="min-w-0 flex-1 text-left cursor-pointer hover:text-[var(--accent-text)] focus-visible:outline-2 focus-visible:outline-[var(--accent)] rounded"
                    >
                      <span className="font-mono text-[10px] font-semibold text-[var(--muted)] mr-1.5">
                        #{idx + 1}
                      </span>
                      <span className="font-medium text-[var(--ink)] truncate">
                        {item.name}
                      </span>
                      {item.rating != null && (
                        <span className="ml-1.5 text-[11px] text-[var(--muted)] tabular-nums">
                          {item.rating.toFixed(1)}★
                        </span>
                      )}
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      {placeHref && (
                        <a
                          href={placeHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 min-h-[32px] sm:min-h-[24px] px-2 text-[11px] font-semibold text-[var(--accent-text)] bg-[var(--accent-soft)] hover:bg-[var(--accent)] hover:text-[var(--accent-ink)] rounded transition-colors whitespace-nowrap"
                        >
                          <span>Maps</span>
                          <ExternalLink className="w-2.5 h-2.5" aria-hidden="true" />
                          <span className="sr-only"> listing for {item.name}</span>
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => onToggleSyncId(item.id)}
                        aria-label={`Remove ${item.name} from shortlist`}
                        className="inline-flex items-center justify-center min-w-[28px] min-h-[28px] sm:min-w-[22px] sm:min-h-[22px] text-[var(--muted)] hover:text-[var(--ink)] rounded cursor-pointer"
                      >
                        <X className="w-3 h-3" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Action Buttons */}
          {syncedSpecialists.length === 1 ? (
            <div className="flex items-center gap-1.5">
              {singleShortlistPlaceUrl && (
                <a
                  href={singleShortlistPlaceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="maps-sync-open-link"
                  className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[34px] px-3 text-xs font-semibold text-[var(--accent-ink)] bg-[var(--accent)] hover:opacity-90 active:scale-[0.98] rounded-lg transition-opacity whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
                >
                  <span>Open on Google Maps</span>
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
              )}
              {singleShortlistRouteUrl && (
                <a
                  href={singleShortlistRouteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-1 min-h-[44px] sm:min-h-[34px] px-2.5 text-xs font-semibold text-[var(--ink)] bg-[var(--surface)] border border-[var(--line)] hover:border-[var(--accent)] rounded-lg whitespace-nowrap shrink-0"
                >
                  <Navigation className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Route</span>
                </a>
              )}
              <button
                type="button"
                onClick={handleCopyShortlist}
                data-testid="maps-sync-copy-btn"
                className="inline-flex items-center justify-center gap-1 min-h-[44px] sm:min-h-[34px] px-2.5 text-xs font-semibold text-[var(--ink)] bg-[var(--surface)] border border-[var(--line)] hover:border-[var(--accent)] active:scale-[0.98] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
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
          ) : (
            <div className="flex flex-wrap items-center gap-1.5">
              {shortlistMapsUrl && (
                <a
                  href={shortlistMapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="maps-sync-open-link"
                  className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-[34px] px-3 text-xs font-semibold text-[var(--accent-ink)] bg-[var(--accent)] hover:opacity-90 active:scale-[0.98] rounded-lg transition-opacity whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
                >
                  <span>Open shortlist in Maps</span>
                  <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                </a>
              )}

              <button
                type="button"
                onClick={handleCopyShortlist}
                data-testid="maps-sync-copy-btn"
                className="inline-flex items-center justify-center gap-1 min-h-[44px] sm:min-h-[34px] px-2.5 text-xs font-semibold text-[var(--ink)] bg-[var(--surface)] border border-[var(--line)] hover:border-[var(--accent)] active:scale-[0.98] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
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

              {multiStopRouteUrl && (
                <a
                  href={multiStopRouteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Plot a multi-stop route visiting all shortlisted places"
                  className="inline-flex items-center justify-center gap-1 min-h-[44px] sm:min-h-[34px] px-2.5 text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)] bg-[var(--surface)] border border-[var(--line)] hover:border-[var(--accent)] rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                >
                  <Navigation className="w-3 h-3" aria-hidden="true" />
                  <span>Route all</span>
                </a>
              )}
            </div>
          )}
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
                specialists.length > 0
                  ? SHOWCASE_CONFIG.followUpPlaceholder
                  : origin
                    ? SHOWCASE_CONFIG.originReadyPlaceholder
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
    </>
  );
}
