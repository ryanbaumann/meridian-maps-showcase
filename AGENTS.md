# AGENTS.md

Instructions for coding agents (including Google AI Studio) extending or maintaining this Google Maps Platform showcase.

## Verification Commands

Run these commands after every edit:

1. Typecheck: `npm run lint` (`tsc --noEmit`).
2. Unit tests on Node 22.18+: `node --test src/utils/*.test.ts`.
3. Unit tests on Node 20: `npx tsx --test src/utils/*.test.ts`.
4. Production build: `npm run build`.
5. Local dev server: `npm run dev` (starts `server.ts` on port `3000`).

If `npm install` hits an `esbuild` peer conflict with `vite@8`, run `npm install --legacy-peer-deps` or `bun install`.

Check UI edits across desktop and mobile viewports in light, dark, and high-contrast themes.

## Extending This Repo in AI Studio

Read these files first when adapting this showcase to a new local-discovery domain (dining, EV charging, retail, travel, healthcare):

- `src/config/showcase.ts`: Brand name, headline, starter queries, default center, 3D model URLs, and GMP attribution IDs.
- `scripts/generate-3d-models.mjs` & `public/models/`: Extension-free glTF 2.0 `.glb` beacons (`meridian-beacon.glb`, `origin-beacon.glb`). Run `node scripts/generate-3d-models.mjs` to regenerate after geometry or color edits.
- `server/geminiAgent.ts`: Gemini 4 Hydrogen prompts, `gemini-3.8-flash` fallback, and Maps Grounding calls.
- `src/utils/ranking.ts`: Fast deterministic query parser (`KNOWN_SPECIALISTS`).
- `src/utils/agentLogic.ts`: Follow-up intent patterns (`newSpecialtyPattern`) and short deterministic replies.

## Gemini Model Contract

- **Primary model**: Use `gemini-4-hydrogen` with `thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }`.
- **Automatic fallback**: Fall back to `gemini-3.8-flash` with `thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }` across intent classification, synthesis, open-ended chat, and Maps Grounding whenever `gemini-4-hydrogen` is unavailable (quota, 404, 5xx, or model-gated 403). Skip fallback only on invalid API key errors (`401` / `API_KEY_INVALID`).
- **Keep keys server-only**: Read `GEMINI_API_KEY` only inside `server/`. Never expose it from `/api/config` or client bundles.

## Google Maps Platform Contract

- **Modern SDKs only**: Use `@vis.gl/react-google-maps`, `AdvancedMarker`, `Place`, `Route.computeRoutes()`, `Map3DElement`, `Model3DInteractiveElement`, `Marker3DInteractiveElement`, and `Polyline3DElement`.
- **Server proxy boundary**: Call Maps REST endpoints only inside `server/mapsApi.ts`. Use `useMapsLibrary(...)` inside `src/`.
- **Vector map settings**: Keep `mapId="DEMO_MAP_ID"` and `renderingType={RenderingType.VECTOR}` on `<Map>` for markers, tilt, and heading.
- **Smooth Vector camera**: Call `map.moveCamera` (never `fitBounds`) so tilt and heading animate smoothly. Cancel tweens on drag, wheel, or touch.
- **Heading-aware framing**: Rotate screen inset offsets by camera heading inside `src/utils/camera.ts`.
- **3D camera presets**: Support `corridor` (`Route`), `street` (`Street`), `overview` (`Aerial`), `orbit` (`Orbit`), and `free` (manual user control). Set `defaultUIHidden: true` and pass `internalUsageAttributionIds` in the `Map3DElement` constructor. Pass `camera`, `durationMillis`, and `repeatCount` to `flyCameraAround()`. Stop animations and switch to `free` on pointer or wheel input.
- **Custom 3D models**: Load extension-free glTF 2.0 `.glb` files via `Model3DInteractiveElement` (`Model3DElement` fallback) with `altitudeMode: 'RELATIVE_TO_MESH'` and `orientation: { heading, tilt: 270, roll: 0 }` (maps glTF `+Y` up to Maps 3D `+Z` up).
- **Shared routes**: Keep route computation in `src/hooks/useActiveRoute.ts` so Vector and 3D maps share one street-following polyline.
- **A2UI cards**: Wrap `<a2ui-surface>` inside `<maui-providers>`. Set `--gmp-card-border: none`, `colorScheme`, and `--color-scheme` on the host. Switch to `vertical` orientation below `350px` width so photos remain visible.
- **Attribution and quota**: Keep both `SHOWCASE_CONFIG.attributionIds` values on `<Map>`, `Map3DElement`, and `<maui-providers>`. Keep explicit `Google Maps` text (`translate="no"`) beside grounding links. Keep the `gmp-quota-exceeded` banner in `src/App.tsx`.
- **ToS rules**: Fetch all place facts, coordinates, and reviews from live APIs. Set `Cache-Control: no-store` on `/api/place-photo` and `/api/place-details`.

## UI, Styling, and Modern Web Contract

- **Show, don't tell**: Keep agent replies to 1–2 sentences (under 40 words). Let the map, route, 3D scene, and A2UI cards show details.
- **Semantic tokens and themes**: Define colors in `src/index.css` using `:root` tokens and `@custom-variant dark`. Maintain `>= 4.5:1` text contrast, `>= 3:1` control border contrast (`--control-line`), `@media (prefers-contrast: more)`, and `@media (forced-colors: active)` pressed borders.
- **Browser baseline**: Gate Newly Available CSS (`light-dark()`, `scrollbar-color`, `scrollbar-width`, `background-clip: border-area`) behind `@supports` or media-query fallbacks. Keep vendor `<progress>` pseudo-elements in separate CSS rule blocks. Honor `prefers-reduced-motion` without jarring global `0.01ms` resets.
- **Accessibility and forms**: Keep one visible `<h1>`, semantic `<search>` and `<ul role="list">` landmarks, unique `sr-only` context on repeated links, `1rem` mobile input text (`text-base sm:text-sm`) to prevent iOS zoom, and `>= 44×44px` mobile touch targets.
- **Security hygiene**: Sanitize all external URLs via `src/utils/url.ts` (`safeExternalUrl`, `safeTelHref`). Avoid `innerHTML`; use `replaceChildren()` or React JSX. Keep security response headers in `server.ts`.
- **Mobile layout**: Size the root shell to `h-[100dvh] w-full`. Collapse the mobile sheet to `peek` when a user taps a map pin or switches to 3D.

## AI Studio Invariants

- Keep `server.ts` at the repo root listening on `process.env.PORT || 3000` (`0.0.0.0`).
- Keep `DISABLE_HMR` and `copy-unbundled-src-assets` in `vite.config.ts`.
- Keep `metadata.json` (`geolocation`, `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API`) and `.env.example` aligned.
- Never commit `.env`, `.env.local`, or real API keys. Users supply `GEMINI_API_KEY` and `GOOGLE_MAPS_API_KEY` through AI Studio Secrets or `.env.local`.
