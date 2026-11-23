import { createRoot } from 'react-dom/client';
import { registerA2UICustomElements, themeStyleSheet } from '@googlemaps/a2ui/lit';
import App from './App.tsx';
import { SHOWCASE_CONFIG } from './config/showcase.ts';
import './index.css';

// Provide AI Studio + Agent Skills attribution alongside MAUI's built-in attribution ID
(window as unknown as { A2UI_ATTRIBUTION_ID?: string }).A2UI_ATTRIBUTION_ID =
  SHOWCASE_CONFIG.attributionIds.join(',');

// Register @googlemaps/a2ui Lit custom elements (<a2ui-placedetailscompact>, <a2ui-googlemap>, <maui-providers>)
registerA2UICustomElements();

if (
  typeof document !== 'undefined' &&
  Array.isArray(document.adoptedStyleSheets) &&
  !document.adoptedStyleSheets.includes(themeStyleSheet)
) {
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, themeStyleSheet];
}

// Tier 1 Google Maps Platform Demo Key Quota Defense
(window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
};

const origConsoleError = console.error;
console.error = (...args: unknown[]) => {
  origConsoleError.apply(console, args);
  const msg = args.map((a) => String(a)).join(' ');
  if (msg.includes('OverQuotaMapError') || msg.includes('QuotaExceededError')) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
};

createRoot(document.getElementById('root')!).render(<App />);
