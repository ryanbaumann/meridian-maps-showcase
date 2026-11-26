import { useCallback, useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';

export interface UseAutocompleteSuggestionsOptions {
  /** Minimum trimmed characters before querying Places Autocomplete (New). */
  minLength?: number;
  /** Debounce delay in milliseconds to conserve API quota while typing. */
  debounceMs?: number;
  /** Optional location bias center for more relevant local suggestions. */
  locationBiasCenter?: { lat: number; lng: number } | null;
  /** Whether suggestions are currently active (e.g., input focused). */
  enabled?: boolean;
}

export interface UseAutocompleteSuggestionsReturn {
  suggestions: google.maps.places.AutocompleteSuggestion[];
  isLoading: boolean;
  resetSession: () => void;
}

/**
 * Retrieves live place predictions using the modern Google Places API (New)
 * `AutocompleteSuggestion.fetchAutocompleteSuggestions` with automatic
 * `AutocompleteSessionToken` lifecycle management for session-based billing.
 *
 * Docs: https://developers.google.com/maps/documentation/javascript/place-autocomplete-data?utm_campaign=gmp_mcp_codeassist_v1_aistudio
 */
export function useAutocompleteSuggestions(
  inputString: string,
  options: UseAutocompleteSuggestionsOptions = {}
): UseAutocompleteSuggestionsReturn {
  const {
    minLength = 2,
    debounceMs = 180,
    locationBiasCenter = null,
    enabled = true,
  } = options;

  const placesLib = useMapsLibrary('places');
  const sessionTokenRef =
    useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const requestSeqRef = useRef(0);

  const [suggestions, setSuggestions] = useState<
    google.maps.places.AutocompleteSuggestion[]
  >([]);
  const [isLoading, setIsLoading] = useState(false);

  const biasLat = locationBiasCenter?.lat ?? null;
  const biasLng = locationBiasCenter?.lng ?? null;

  useEffect(() => {
    const trimmed = inputString.trim();
    if (!enabled || !placesLib || trimmed.length < minLength) {
      requestSeqRef.current += 1;
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    const AutocompleteSuggestionCtor = placesLib.AutocompleteSuggestion;
    const AutocompleteSessionTokenCtor = placesLib.AutocompleteSessionToken;
    if (
      !AutocompleteSuggestionCtor ||
      typeof AutocompleteSuggestionCtor.fetchAutocompleteSuggestions !== 'function'
    ) {
      return;
    }

    if (!sessionTokenRef.current && AutocompleteSessionTokenCtor) {
      sessionTokenRef.current = new AutocompleteSessionTokenCtor();
    }

    const seq = ++requestSeqRef.current;
    setIsLoading(true);

    const timer = window.setTimeout(async () => {
      try {
        const request: google.maps.places.AutocompleteRequest = {
          input: trimmed,
          sessionToken: sessionTokenRef.current ?? undefined,
          ...(biasLat != null && biasLng != null
            ? {
                locationBias: {
                  north: Math.min(85, biasLat + 0.35),
                  south: Math.max(-85, biasLat - 0.35),
                  east: Math.min(180, biasLng + 0.35),
                  west: Math.max(-180, biasLng - 0.35),
                },
              }
            : {}),
        };

        const response =
          await AutocompleteSuggestionCtor.fetchAutocompleteSuggestions(request);
        if (seq !== requestSeqRef.current) return;
        setSuggestions(response?.suggestions ?? []);
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes('RESOURCE_EXHAUSTED') ||
          msg.includes('OVER_QUERY_LIMIT') ||
          msg.includes('QuotaExceeded')
        ) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        setSuggestions([]);
      } finally {
        if (seq === requestSeqRef.current) {
          setIsLoading(false);
        }
      }
    }, debounceMs);

    return () => {
      window.clearTimeout(timer);
    };
  }, [placesLib, inputString, minLength, debounceMs, biasLat, biasLng, enabled]);

  const resetSession = useCallback(() => {
    requestSeqRef.current += 1;
    sessionTokenRef.current = null;
    setSuggestions([]);
    setIsLoading(false);
  }, []);

  return {
    suggestions,
    isLoading,
    resetSession,
  };
}
