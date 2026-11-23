# Meridian — Google Maps Platform Showcase

Meridian is an AI Studio-ready Google Maps Platform showcase combining a Vector Map, a Photorealistic 3D Map with custom PBR `.glb` 3D beacons and multi-view camera controls, `@googlemaps/a2ui` place cards, and Gemini 4 Hydrogen (with automatic `gemini-3.8-flash` low-thinking fallback).

## Highlights

- **Vector Map camera**: Smooth `map.moveCamera` transitions tilt to `47.5°` for 3D buildings and align with route bearings.
- **Photorealistic 3D Map + custom 3D models**: `Map3DElement` drops custom self-hosted glTF 2.0 `.glb` beacons (`Model3DInteractiveElement`) onto rooftops (`RELATIVE_TO_MESH`), renders shared street routes (`Polyline3DElement`), and switches smoothly across **Route**, **Street**, **Aerial**, and **360° Orbit** camera views.
- **A2UI place cards**: `@googlemaps/a2ui` `<a2ui-surface>` (`PlaceDetailsCompact`) syncs natively with light/dark themes and adapts to narrow mobile screens.
- **Resilient Gemini orchestration**: Uses `gemini-4-hydrogen` (`ThinkingLevel.LOW`) with automatic fallback to `gemini-3.8-flash` (`ThinkingLevel.LOW`) across intent parsing, synthesis, chat, and Maps Grounding.
- **Mobile-first & accessible**: Full-bleed `100dvh` map with a 3-snap mobile bottom sheet (`peek`, `half`, `full`), `>= 44×44px` touch targets, `1rem` mobile inputs, high-contrast and Forced Colors support, and `prefers-reduced-motion` handling.

## Open in Google AI Studio

1. Import this repository into [Google AI Studio](https://aistudio.google.com/).
2. Configure these keys in **Settings > Secrets**:
   - `GEMINI_API_KEY`: Your Gemini API key.
   - `GOOGLE_MAPS_API_KEY` (and `VITE_GOOGLE_MAPS_API_KEY` if prompted): A free [Maps Demo Key](https://mapsplatform.google.com/maps-demo-key?utm_campaign=gmp_git_agentskills_v1) for prototyping, or a restricted [Google Cloud Console](https://console.cloud.google.com/google/maps-apis/credentials?utm_campaign=gmp_git_agentskills_v1) key with Maps JavaScript API, Places API (New), Places UI Kit, Routes API, and Geocoding API enabled.
3. Ask the AI Studio agent to customize the showcase — it reads root [AGENTS.md](./AGENTS.md) automatically.

## Run Locally

**Prerequisites**: Node.js 22.18+ (or Bun).

1. Install dependencies:
   ```bash
   npm install --legacy-peer-deps
   ```
   Or run `bun install` when you use Bun.

2. Copy `.env.example` to `.env.local` and add `GEMINI_API_KEY`, `GOOGLE_MAPS_API_KEY`, and `VITE_GOOGLE_MAPS_API_KEY`.

3. Start the dev server:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000`.

## Verification

- Typecheck: `npm run lint`
- Unit tests: `node --test src/utils/*.test.ts` (on Node 20, run `npx tsx --test src/utils/*.test.ts`)
- Production build: `npm run build`
- Regenerate custom 3D beacons: `node scripts/generate-3d-models.mjs`

## Extending to a New Domain

1. Edit `src/config/showcase.ts` (`brandName`, `headline`, `defaultCenter`, `starters`, `models`).
2. Customize 3D beacon colors or geometry in `scripts/generate-3d-models.mjs` and regenerate `public/models/*.glb` (or point `SHOWCASE_CONFIG.models` to your own extension-free `.glb` URLs).
3. Update domain prompts and keyword parsers in `server/geminiAgent.ts`, `src/utils/ranking.ts`, and `src/utils/agentLogic.ts`.
4. Read [AGENTS.md](./AGENTS.md) for the full Google Maps Platform, Modern Web, and AI Studio contract.
