import type { LatLng, SuggestedPrompt } from '../types.ts';

/**
 * Single-file domain configuration for this showcase.
 * Edit these values in AI Studio to adapt the map, camera, and A2UI cards
 * to any local discovery domain (healthcare, dining, EV charging, retail, etc.).
 */
export const SHOWCASE_CONFIG = {
  brandName: 'Meridian',
  headline: 'Find a specialist nearby.',
  composerPlaceholder: 'Dentist in SF, dermatologist in NYC...',
  followUpPlaceholder: 'Compare, open now, hours, walking...',
  defaultCenter: { lat: 37.7749, lng: -122.4194 } satisfies LatLng,
  defaultZoom: 12.5,
  default3DRange: 2600,
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
   * Required Google Maps Platform usage attribution IDs.
   * Keep both IDs when extending from AI Studio or Agent Skills.
   */
  attributionIds: [
    'gmp_git_agentskills_v1',
    'gmp_mcp_codeassist_v1_aistudio',
  ] as const,
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
  ] satisfies SuggestedPrompt[],
} as const;
