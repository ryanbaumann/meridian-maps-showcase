export type GeminiErrorKind = 'quota' | 'auth' | 'transient' | 'other';

function extractErrorText(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) {
    const anyErr = err as Error & { status?: number | string; code?: number | string };
    return [anyErr.status, anyErr.code, anyErr.message].filter(Boolean).join(' ');
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function extractStatusCode(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const anyErr = err as { status?: unknown; code?: unknown; error?: { code?: unknown } };
  const raw = anyErr.status ?? anyErr.code ?? anyErr.error?.code;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string' && /^\d{3}$/.test(raw)) return Number(raw);
  const text = extractErrorText(err);
  const match = text.match(/"code"\s*:\s*(\d{3})/);
  return match ? Number(match[1]) : null;
}

export function classifyGeminiError(err: unknown): GeminiErrorKind {
  const status = extractStatusCode(err);
  const text = extractErrorText(err);

  if (
    status === 429 ||
    /RESOURCE_EXHAUSTED|exceeded your current quota|rate[\s-]?limit/i.test(text)
  ) {
    return 'quota';
  }

  if (
    status === 401 ||
    status === 403 ||
    /PERMISSION_DENIED|API_KEY_INVALID|API key not valid|invalid api key/i.test(text)
  ) {
    return 'auth';
  }

  if (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /UNAVAILABLE|DEADLINE_EXCEEDED|overloaded|ETIMEDOUT|ECONNRESET|fetch failed/i.test(text)
  ) {
    return 'transient';
  }

  return 'other';
}

export function isInvalidApiKeyError(err: unknown): boolean {
  const status = extractStatusCode(err);
  const text = extractErrorText(err);
  return (
    status === 401 ||
    /API_KEY_INVALID|API key not valid|invalid api key/i.test(text)
  );
}

/**
 * Returns true when an error from the primary model (`gemini-4-hydrogen`) warrants
 * falling back to `gemini-3.8-flash` (e.g. quota, rate limit, 404/unavailable, 5xx,
 * or model-gated 403). Only skips fallback when the API key itself is invalid.
 */
export function shouldFallbackFromPrimaryModel(err: unknown): boolean {
  return !isInvalidApiKeyError(err);
}

export function isHardQuotaExhausted(err: unknown): boolean {
  if (classifyGeminiError(err) !== 'quota') return false;
  const text = extractErrorText(err);
  return /check your plan and billing|exceeded your current quota|limit:\s*0/i.test(text);
}

export function extractRetryDelayMs(err: unknown, maxMs = 2500): number | null {
  const text = extractErrorText(err);
  const match = text.match(/retryDelay["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)s/i);
  if (!match) return null;
  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(Math.round(seconds * 1000), maxMs);
}

export function formatGeminiUserNotice(err: unknown): string {
  const kind = classifyGeminiError(err);
  if (kind === 'quota') {
    return 'Gemini API quota reached for the current key — showing live Google Places results and travel times. Upgrading to a billing-enabled API key in Settings > Secrets restores AI summaries and Maps Grounding.';
  }
  if (kind === 'auth') {
    return 'Gemini API key could not be authenticated — check your key in Settings > Secrets. Showing live Google Places results below.';
  }
  return 'Gemini AI summary is temporarily unavailable — showing live Google Places rankings and details below.';
}
