import { useEffect } from 'react';
import {
  APILoadingStatus,
  useApiLoadingStatus,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import type {
  OriginLocation,
  PlacePhotoInfo,
  Specialist,
  TravelMode,
} from '../types.ts';
import {
  estimateTravelSeconds,
  haversineMeters,
  rankSpecialists,
} from '../utils/ranking.ts';
import {
  computeStarRatingDistribution,
  selectTopReviews,
} from '../utils/reviews.ts';

export interface PendingClientFallback {
  specialistQuery: string;
  origin: OriginLocation | null;
  geocodeQuery: string | null;
  travelMode: TravelMode;
}

function normalizeExternalUri(uri?: string | null): string | undefined {
  if (!uri) return undefined;
  const trimmed = uri.trim();
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) return trimmed;
  return undefined;
}

/**
 * Invisible bridge inside `<APIProvider>` that provides a Places API (New) SDK fallback
 * (`placesLib.Place.searchByText`) if the server-side Maps key is HTTP-referrer-restricted.
 * Never uses legacy `PlacesService` or direct client-side REST `fetch`.
 */
export function ClientPlacesBridge({
  pendingFallback,
  onResolved,
}: {
  pendingFallback: PendingClientFallback | null;
  onResolved: (result: {
    origin?: OriginLocation;
    specialists?: Specialist[];
    error?: string;
  }) => void;
}) {
  const placesLib = useMapsLibrary('places');
  const loadingStatus = useApiLoadingStatus();

  useEffect(() => {
    if (!pendingFallback) return;

    if (
      loadingStatus === APILoadingStatus.FAILED ||
      loadingStatus === APILoadingStatus.AUTH_FAILURE
    ) {
      onResolved({ error: 'Google Maps SDK could not load.' });
      return;
    }

    if (!placesLib) return;
    let cancelled = false;

    const run = async () => {
      try {
        let activeOrigin = pendingFallback.origin;

        if (!activeOrigin && pendingFallback.geocodeQuery) {
          const geoRes = await placesLib.Place.searchByText({
            textQuery: pendingFallback.geocodeQuery,
            fields: ['displayName', 'formattedAddress', 'location'],
            maxResultCount: 1,
          });
          const first = geoRes.places?.[0];
          if (first?.location) {
            activeOrigin = {
              label: first.displayName || pendingFallback.geocodeQuery,
              formattedAddress: first.formattedAddress || pendingFallback.geocodeQuery,
              lat: first.location.lat(),
              lng: first.location.lng(),
            };
          } else {
            if (!cancelled) {
              onResolved({
                error: `Could not locate "${pendingFallback.geocodeQuery}". Try a city or ZIP.`,
              });
            }
            return;
          }
        }

        if (!activeOrigin) {
          if (!cancelled) onResolved({});
          return;
        }

        if (!pendingFallback.specialistQuery) {
          if (!cancelled) onResolved({ origin: activeOrigin });
          return;
        }

        const searchRes = await placesLib.Place.searchByText({
          textQuery: `${pendingFallback.specialistQuery} near ${activeOrigin.formattedAddress}`,
          fields: [
            'id',
            'displayName',
            'formattedAddress',
            'location',
            'rating',
            'userRatingCount',
            'googleMapsURI',
            'websiteURI',
            'nationalPhoneNumber',
            'primaryTypeDisplayName',
            'photos',
            'reviews',
          ],
          locationBias: {
            center: { lat: activeOrigin.lat, lng: activeOrigin.lng },
            radius: 14_000,
          },
          maxResultCount: 10,
        });

        const mapped: Specialist[] = (searchRes.places ?? [])
          .filter((p: google.maps.places.Place) => Boolean(p.displayName && p.location))
          .map((p: google.maps.places.Place, idx: number) => {
            const lat = p.location!.lat();
            const lng = p.location!.lng();
            const dist = Math.round(
              haversineMeters({ lat: activeOrigin!.lat, lng: activeOrigin!.lng }, { lat, lng })
            );

            let photo: PlacePhotoInfo | undefined;
            const firstPhoto = p.photos?.[0];
            if (firstPhoto && typeof firstPhoto.getURI === 'function') {
              try {
                const uri = firstPhoto.getURI({ maxWidth: 480, maxHeight: 320 });
                if (uri) {
                  photo = {
                    photoUrl: uri,
                    widthPx: firstPhoto.widthPx,
                    heightPx: firstPhoto.heightPx,
                    authorAttributions: (firstPhoto.authorAttributions ?? [])
                      .filter((a) => Boolean(a.displayName))
                      .map((a) => ({
                        displayName: a.displayName,
                        uri: normalizeExternalUri(a.uri),
                      })),
                  };
                }
              } catch {
                // Ignore individual photo URI failures
              }
            }

            const sdkReviews = ((p as unknown as {
              reviews?: Array<{
                rating?: number | null;
                text?: string | null;
                relativePublishTimeDescription?: string | null;
                authorAttribution?: { displayName?: string | null; uri?: string | null } | null;
              }>;
            }).reviews ?? [])
              .filter((r) => Boolean(r.text?.trim()))
              .slice(0, 5)
              .map((r) => ({
                authorName: r.authorAttribution?.displayName?.trim() || 'Patient',
                authorUri: normalizeExternalUri(r.authorAttribution?.uri),
                rating: typeof r.rating === 'number' ? r.rating : 5,
                text: r.text!.trim(),
                relativePublishTime: r.relativePublishTimeDescription || undefined,
              }));

            const ratingVal = typeof p.rating === 'number' ? p.rating : null;
            const ratingCountVal =
              typeof p.userRatingCount === 'number' ? p.userRatingCount : 0;

            return {
              id: p.id || `sdk-place-${idx}`,
              name: p.displayName || 'Specialist',
              specialty: p.primaryTypeDisplayName || pendingFallback.specialistQuery,
              address: p.formattedAddress || '',
              location: { lat, lng },
              rating: ratingVal,
              userRatingCount: ratingCountVal,
              openNow: null,
              reviews: sdkReviews.length > 0 ? sdkReviews : undefined,
              ratingDistribution: computeStarRatingDistribution(
                ratingVal,
                ratingCountVal,
                sdkReviews
              ),
              topReviews: selectTopReviews(sdkReviews, 2),
              detailsLoaded: sdkReviews.length > 0,
              phoneNumber: p.nationalPhoneNumber || undefined,
              websiteUri: normalizeExternalUri(p.websiteURI),
              googleMapsUri: normalizeExternalUri(p.googleMapsURI),
              photo,
              travelDurationSeconds: estimateTravelSeconds(dist, pendingFallback.travelMode),
              distanceMeters: dist,
              isRouteVerified: false,
            };
          });

        if (!cancelled) {
          onResolved({
            origin: activeOrigin,
            specialists: rankSpecialists(mapped, 'balanced'),
          });
        }
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('OVER_QUERY_LIMIT')) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        onResolved({ error: 'Unable to load nearby places right now.' });
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [pendingFallback, placesLib, loadingStatus, onResolved]);

  return null;
}
