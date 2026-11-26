import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { MapPin } from 'lucide-react';
import { useAutocompleteSuggestions } from '../hooks/useAutocompleteSuggestions.ts';
import type { OriginLocation } from '../types.ts';

interface AddressAutocompleteInputProps {
  id: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  onSelectOrigin: (origin: OriginLocation) => void;
  placeholder?: string;
  autoFocus?: boolean;
  required?: boolean;
  disabled?: boolean;
  locationBiasCenter?: { lat: number; lng: number } | null;
  className?: string;
  /** Optional placement for dropdown menu relative to input. */
  dropdownPlacement?: 'bottom' | 'top';
}

/**
 * Accessible address entry field enhanced with Google Places Autocomplete (New).
 * Uses `AutocompleteSuggestion.fetchAutocompleteSuggestions` + `placePrediction.toPlace().fetchFields()`
 * sharing a single `AutocompleteSessionToken` per selection session.
 */
export function AddressAutocompleteInput({
  id,
  name = 'street-address',
  value,
  onChange,
  onSelectOrigin,
  placeholder = 'Street address, city, or ZIP...',
  autoFocus = false,
  required = false,
  disabled = false,
  locationBiasCenter = null,
  className = '',
  dropdownPlacement = 'bottom',
}: AddressAutocompleteInputProps) {
  const listboxId = useId();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [isSelecting, setIsSelecting] = useState(false);

  const { suggestions, isLoading, resetSession } = useAutocompleteSuggestions(
    value,
    {
      enabled: isFocused && !disabled && !isSelecting,
      locationBiasCenter,
    }
  );

  const predictions = suggestions.filter(
    (s): s is google.maps.places.AutocompleteSuggestion & {
      placePrediction: google.maps.places.PlacePrediction;
    } => Boolean(s.placePrediction)
  );

  const isOpen = isFocused && predictions.length > 0 && !isSelecting;

  useEffect(() => {
    setActiveIndex(-1);
  }, [value, predictions.length]);

  useEffect(() => {
    const handlePointerDownOutside = (event: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setIsFocused(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDownOutside);
    return () => {
      document.removeEventListener('mousedown', handlePointerDownOutside);
    };
  }, []);

  const handleSelectPrediction = useCallback(
    async (prediction: google.maps.places.PlacePrediction) => {
      const fullText = prediction.text?.text?.trim() || '';
      const mainText = prediction.mainText?.text?.trim() || fullText;
      if (fullText) {
        onChange(fullText);
      }
      setIsFocused(false);
      setActiveIndex(-1);
      setIsSelecting(true);

      try {
        const place = prediction.toPlace();
        await place.fetchFields({
          fields: ['displayName', 'formattedAddress', 'location'],
        });

        const loc = place.location;
        if (loc) {
          const lat = typeof loc.lat === 'function' ? loc.lat() : Number(loc.lat);
          const lng = typeof loc.lng === 'function' ? loc.lng() : Number(loc.lng);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            const formatted =
              place.formattedAddress?.trim() || fullText || mainText;
            const label =
              mainText || place.displayName?.trim() || formatted;
            resetSession();
            onSelectOrigin({
              label,
              formattedAddress: formatted,
              lat,
              lng,
            });
            return;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('OVER_QUERY_LIMIT') ||
          msg.includes('QuotaExceeded')
        ) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
      } finally {
        setIsSelecting(false);
        resetSession();
      }
    },
    [onChange, onSelectOrigin, resetSession]
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) =>
        prev < predictions.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) =>
        prev > 0 ? prev - 1 : predictions.length - 1
      );
    } else if (e.key === 'Enter' && activeIndex >= 0 && predictions[activeIndex]) {
      e.preventDefault();
      void handleSelectPrediction(predictions[activeIndex].placePrediction);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsFocused(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div ref={wrapperRef} className="relative flex-1 min-w-0">
      <input
        id={id}
        name={name}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={
          isOpen && activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined
        }
        autoComplete="off"
        enterKeyHint="go"
        autoFocus={autoFocus}
        required={required}
        disabled={disabled || isSelecting}
        value={value}
        onFocus={() => setIsFocused(true)}
        onChange={(e) => {
          onChange(e.target.value);
          if (!isFocused) setIsFocused(true);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={`w-full ${className}`}
      />

      {isOpen && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Address suggestions"
          data-testid="address-autocomplete-list"
          className={`absolute left-0 right-0 z-50 max-h-60 overflow-y-auto agent-scroll rounded-xl border border-[var(--line)] bg-[var(--surface)] shadow-xl divide-y divide-[var(--line)]/60 ${
            dropdownPlacement === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          }`}
        >
          {predictions.map((item, idx) => {
            const pred = item.placePrediction;
            const mainText = pred.mainText?.text || pred.text?.text || '';
            const secondaryText = pred.secondaryText?.text || '';
            const isActive = idx === activeIndex;

            return (
              <li
                key={pred.placeId || `${mainText}-${idx}`}
                id={`${listboxId}-opt-${idx}`}
                role="option"
                aria-selected={isActive}
                onMouseDown={(e) => {
                  // Prevent input blur before selection fires
                  e.preventDefault();
                  void handleSelectPrediction(pred);
                }}
                onMouseEnter={() => setActiveIndex(idx)}
                className={`flex items-start gap-2 px-3 py-2.5 min-h-[44px] sm:min-h-[38px] text-left cursor-pointer transition-colors ${
                  isActive
                    ? 'bg-[var(--accent-soft)] text-[var(--ink)]'
                    : 'text-[var(--ink)] hover:bg-[var(--surface-subtle)]'
                }`}
              >
                <MapPin
                  className="w-3.5 h-3.5 mt-0.5 text-[var(--accent-text)] shrink-0"
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-[var(--ink)] truncate leading-snug">
                    {mainText}
                  </p>
                  {secondaryText && (
                    <p className="text-[11px] text-[var(--muted)] truncate leading-snug">
                      {secondaryText}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
          {isLoading && (
            <li
              aria-hidden="true"
              className="px-3 py-1.5 text-[11px] text-[var(--muted)]"
            >
              Updating suggestions...
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
