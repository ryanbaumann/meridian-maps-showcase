/**
 * Validates and normalizes an external HTTP(S) URL before rendering in `href`.
 * Rejects dangerous protocols (`javascript:`, `data:`, `vbscript:`) and malformed strings.
 */
export function safeExternalUrl(uri?: string | null): string | undefined {
  if (!uri) return undefined;
  const trimmed = uri.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Validates that a Places photo redirect target points only to an official Google photo host
 * over HTTPS, preventing open redirects from unexpected upstream responses.
 */
export function isAllowedGooglePhotoRedirectUrl(uri?: string | null): boolean {
  if (!uri) return false;
  const trimmed = uri.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'places.googleapis.com' ||
      host === 'googleusercontent.com' ||
      host.endsWith('.googleusercontent.com') ||
      host === 'ggpht.com' ||
      host.endsWith('.ggpht.com')
    );
  } catch {
    return false;
  }
}

/**
 * Validates a photo URL for safe server/client round-tripping: permits either the
 * local `/api/place-photo?name=places/...` proxy path or an allowlisted Google photo host.
 */
export function safePhotoUrl(uri?: string | null): string | undefined {
  if (!uri) return undefined;
  const trimmed = uri.trim();
  if (!trimmed || trimmed.length > 1024) return undefined;
  if (trimmed.startsWith('/api/place-photo?')) {
    return /^\/api\/place-photo\?name=places(?:%2F|\/)[A-Za-z0-9_-]+(?:%2F|\/)photos(?:%2F|\/)[A-Za-z0-9_-]+(?:&[A-Za-z0-9_=%-]+)*$/.test(
      trimmed
    )
      ? trimmed
      : undefined;
  }
  return isAllowedGooglePhotoRedirectUrl(trimmed) ? trimmed : undefined;
}

/**
 * Normalizes a phone string into a safe `tel:` URI.
 */
export function safeTelHref(phone?: string | null): string | undefined {
  if (!phone) return undefined;
  const cleaned = phone.replace(/[^0-9+().\-\s]/g, '').trim();
  const digitCount = (cleaned.match(/\d/g) ?? []).length;
  if (digitCount < 7) return undefined;
  return `tel:${cleaned}`;
}
