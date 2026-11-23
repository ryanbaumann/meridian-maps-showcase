import type { LatLng, SuggestedPrompt } from '../types.ts';

/**
 * Single-file Agent Blueprint for Meridian — Specialist Finder Agent.
 *
 * Fork / Remix Guide:
 * Edit this file to adapt the entire agent (persona, Gemini Maps Grounding instructions,
 * recognized categories, ranking weights, starter prompts, default map center, and 3D beacons)
 * to any local-discovery domain (healthcare specialists, dining, EV charging, retail, travel, etc.).
 */
export const SHOWCASE_CONFIG = {
  brandName: 'Meridian',
  headline: 'Find the right specialist nearby.',
  composerPlaceholder: 'Dentist in SF, dermatologist in NYC...',
  followUpPlaceholder: 'Compare, open now, hours, walking...',
  defaultCenter: { lat: 37.7749, lng: -122.4194 } satisfies LatLng,
  defaultZoom: 12.5,
  default3DRange: 2600,
  /**
   * Declarative Agent Blueprint consumed by Gemini Maps Grounding, intent routing,
   * ranking, and follow-up generation. Customize this object when forking to a new domain.
   */
  agent: {
    roleLabel: 'Specialist Finder Agent',
    tagline: 'Grounded in live Google Maps data, travel times, and reviews.',
    entitySingular: 'specialist',
    entityPlural: 'specialists',
    defaultCategory: 'Dentist',
    reviewerFallbackName: 'Reviewer',
    persona: 'Meridian, a real-world Specialist Finder Agent grounded in Google Maps',
    intentGuidance:
      'Translate symptoms, needs, or preferences into a concrete local specialist query, and extract any location or travel mode.',
    rankingWeights: {
      rating: 0.55,
      travelTime: 0.45,
    },
    knownCategories: [
      'dentist',
      'dental',
      'orthodontist',
      'endodontist',
      'periodontist',
      'prosthodontist',
      'pediatric dentist',
      'cosmetic dentist',
      'oral surgeon',
      'dermatologist',
      'optometrist',
      'ophthalmologist',
      'physical therapist',
      'physical therapy',
      'chiropractor',
      'cardiologist',
      'pediatrician',
      'primary care',
      'urgent care',
      'ent',
      'allergist',
      'podiatrist',
      'therapist',
      'psychiatrist',
      'psychologist',
      'obgyn',
      'gynecologist',
      'neurologist',
      'orthopedist',
      'orthopedic',
      'urologist',
      'gastroenterologist',
      'doctor',
      'clinic',
      'specialist',
      'veterinarian',
      'vet',
    ] as const,
    exampleCities: ['San Francisco, CA', 'Brooklyn, NY', 'Austin, TX'] as const,
    noOriginFollowUps: [
      {
        label: 'Dentist in San Francisco',
        prompt: 'Find a top-rated dentist near San Francisco, CA with a quick drive',
      },
      {
        label: 'Dermatologist in Brooklyn',
        prompt: 'Who is the best dermatologist near Brooklyn, NY?',
      },
      {
        label: 'Optometrist in Austin',
        prompt: 'Find a highly rated optometrist near Austin, TX',
      },
    ] satisfies SuggestedPrompt[],
    originFollowUpTemplates: [
      {
        label: 'Top-rated dentist nearby',
        promptTemplate: 'Find a top-rated dentist near {location}',
      },
      {
        label: 'Dermatologist open today',
        promptTemplate: 'Find a dermatologist near {location} open today',
      },
      {
        label: 'Optometrist with short travel',
        promptTemplate: 'Find the fastest high-rated optometrist near {location}',
      },
    ] as const,
  },
  /**
   * Custom self-hosted glTF 2.0 (.glb) 3D models rendered in Photorealistic 3D mode.
   * Swap these URLs (or regenerate via scripts/generate-3d-models.mjs) to restyle
   * the 3D destination beacon and origin marker for any local-discovery domain.
   */
  models: {
    destinationBeaconUrl: '/models/meridian-beacon.glb',
    originBeaconUrl: '/models/origin-beacon.glb',
  },
  searchRadiusMeters: 14_000,
  maxResults: 10,
  /**
   * Required Google Maps Platform usage attribution ID.
   */
  attributionIds: ['gmp_mcp_codeassist_v1_aistudio'] as const,
  primarySolutionId: 'gmp_mcp_codeassist_v1_aistudio',
  /**
   * Short, high-signal starter queries (show, don't tell).
   */
  starters: [
    {
      label: 'Dentist · San Francisco',
      prompt: 'Top-rated dentist near San Francisco, CA',
    },
    {
      label: 'Dermatologist · Brooklyn',
      prompt: 'Best dermatologist near Brooklyn, NY open today',
    },
    {
      label: 'Optometrist · Austin',
      prompt: 'Highly rated optometrist near Austin, TX',
    },
  ] satisfies SuggestedPrompt[],
} as const;
