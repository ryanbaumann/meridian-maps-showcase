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
 * Normalizes a phone string into a safe `tel:` URI.
 */
export function safeTelHref(phone?: string | null): string | undefined {
  if (!phone) return undefined;
  const cleaned = phone.replace(/[^0-9+().\-\s]/g, '').trim();
  const digitCount = (cleaned.match(/\d/g) ?? []).length;
  if (digitCount < 7) return undefined;
  return `tel:${cleaned}`;
}
