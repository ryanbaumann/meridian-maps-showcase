export type TravelMode = 'DRIVE' | 'WALK' | 'BICYCLE';

export type SortMode = 'balanced' | 'fastest' | 'rating';

export type MapViewMode = 'vector' | '3d';

export type Camera3DView = 'corridor' | 'street' | 'overview' | 'orbit' | 'free';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface OriginLocation {
  label: string;
  formattedAddress: string;
  lat: number;
  lng: number;
}

export interface ReviewSnippet {
  text: string;
  uri?: string;
}

export interface GroundingSource {
  title: string;
  uri: string;
  placeId?: string;
  reviewSnippets?: ReviewSnippet[];
}

export interface PhotoAuthorAttribution {
  displayName: string;
  uri?: string;
}

export interface PlacePhotoInfo {
  /** Proxy URL (/api/place-photo?...) or SDK-resolved photo URI */
  photoUrl: string;
  widthPx?: number;
  heightPx?: number;
  /** Mandatory photographer attributions from Google Places API */
  authorAttributions: PhotoAuthorAttribution[];
}

export interface PlaceReview {
  authorName: string;
  authorUri?: string;
  rating: number;
  text: string;
  relativePublishTime?: string;
  googleMapsUri?: string;
}

export interface StarRatingBucket {
  stars: 5 | 4 | 3 | 2 | 1;
  count: number;
  percentage: number;
}

export interface RatingDistribution {
  buckets: StarRatingBucket[];
  /** True when derived statistically from overall rating + review sample */
  isEstimated: boolean;
  /** Number of Google reviews incorporated into this breakdown */
  sampleSize: number;
}

export interface PlaceDetailsInsightsResponse {
  placeId: string;
  rating: number | null;
  userRatingCount: number;
  reviews: PlaceReview[];
  topReviews: PlaceReview[];
  ratingDistribution: RatingDistribution | null;
  editorialSummary?: string;
  weekdayDescriptions?: string[];
  openNow?: boolean | null;
  phoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  needsClientDetailsFallback?: boolean;
  quotaExceeded?: boolean;
  error?: string;
}

export interface A2uiSurfaceMessage {
  version: 'v0.9';
  createSurface?: {
    surfaceId: string;
    catalogId: string;
    theme?: Record<string, unknown>;
  };
  updateComponents?: {
    surfaceId: string;
    components: Array<Record<string, unknown>>;
  };
}

export interface SpecialistScoreBreakdown {
  /** Weighted overall score on a 0–100 scale */
  overall: number;
  /** Bayesian Google rating + review-volume subscore (0–100) */
  ratingScore: number;
  /** Live travel-time convenience subscore (0–100) */
  travelTimeScore: number;
  /** Route/proximity distance subscore (0–100) */
  distanceScore: number;
  weights: {
    rating: number;
    travelTime: number;
    distance: number;
  };
}

export interface SynthesisPick {
  specialistId: string;
  rank: 1 | 2 | 3;
  badge: string;
  rationale: string;
  reviewSnippet?: string;
  todayHours?: string | null;
  scoreBreakdown: SpecialistScoreBreakdown;
}

export interface RankedSynthesisResult {
  headline: string;
  weights: {
    ratingPct: number;
    travelTimePct: number;
    distancePct: number;
  };
  sortMode: SortMode;
  travelMode: TravelMode;
  originLabel?: string | null;
  picks: SynthesisPick[];
}

export interface Specialist {
  id: string;
  name: string;
  specialty: string;
  address: string;
  location: LatLng;
  rating: number | null;
  userRatingCount: number;
  openNow: boolean | null;
  weekdayDescriptions?: string[];
  editorialSummary?: string;
  reviews?: PlaceReview[];
  /** Five-tier star ratings distribution (5★ down to 1★) */
  ratingDistribution?: RatingDistribution | null;
  /** Highest-signal patient review snippets for selected specialist display */
  topReviews?: PlaceReview[];
  /** True once full on-demand Place Details (reviews & distribution) have been fetched */
  detailsLoaded?: boolean;
  wheelchairAccessible?: boolean;
  phoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  directionsUri?: string;
  photo?: PlacePhotoInfo;
  travelDurationSeconds: number | null;
  distanceMeters: number | null;
  /** True when travel time came directly from Google Routes/Places routingSummaries */
  isRouteVerified: boolean;
  /** Composite score on 0–100 scale combining rating quality, travel time, and distance */
  compositeScore?: number;
  /** Explicit weighted factor breakdown (rating, travel time, distance) */
  scoreBreakdown?: SpecialistScoreBreakdown;
}

export interface ParsedIntent {
  action: 'set_location_only' | 'search';
  specialistQuery: string | null;
  locationText: string | null;
  travelMode?: TravelMode;
  preferences?: string | null;
}

export type AgentActionType =
  | 'set_location_only'
  | 'needs_location'
  | 'search'
  | 'compare'
  | 'qa'
  | 'filter_open'
  | 'sort_change'
  | 'sync_select';

export interface SuggestedPrompt {
  label: string;
  prompt: string;
}

export interface ChatHistoryItem {
  role: 'user' | 'assistant';
  text: string;
}

export type GenUiBlock =
  | {
      type: 'place_cards';
      specialistIds: string[];
      title?: string;
    }
  | {
      type: 'comparison';
      specialistIds: string[];
      title?: string;
    }
  | {
      type: 'provider_spotlight';
      specialistId: string;
    }
  | {
      type: 'location_prompt';
      pendingSpecialty?: string | null;
    };

export interface AgentTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  groundingSources?: GroundingSource[];
  genUiBlock?: GenUiBlock;
  synthesis?: RankedSynthesisResult;
  suggestedFollowUps?: SuggestedPrompt[];
  /** Snapshot of specialists referenced by this turn so earlier messages stay legible */
  specialistsSnapshot?: Specialist[];
  travelMode?: TravelMode;
  geminiNotice?: string;
  error?: string;
}

export interface AgentSearchResponse {
  action: AgentActionType;
  origin: OriginLocation | null;
  specialistQuery: string | null;
  travelMode: TravelMode;
  sortMode?: SortMode;
  agentSummary: string;
  specialists: Specialist[];
  groundingSources: GroundingSource[];
  a2uiMessages?: A2uiSurfaceMessage[];
  genUiBlock?: GenUiBlock;
  synthesis?: RankedSynthesisResult;
  suggestedFollowUps?: SuggestedPrompt[];
  focusSpecialistId?: string | null;
  selectForSyncIds?: string[];
  needsClientPlacesFallback?: boolean;
  needsClientGeocode?: string | null;
  geminiNotice?: string;
  error?: string;
}
