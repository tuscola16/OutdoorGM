// Post-game media link validation (ROADMAP #45). Pure, cross-client (mobile `@/common/...`,
// web `@shared/common/...`). The GM pastes a YouTube recap and/or a Google Photos album link
// on the results screen; we host-validate before writing so a typo/phishing link can't land.

const YOUTUBE_HOSTS = ['youtube.com', 'youtu.be', 'm.youtube.com', 'www.youtube.com'];
const PHOTOS_HOSTS = ['photos.google.com', 'photos.app.goo.gl'];

/** Parse a URL, tolerating a missing scheme (prepends https://). Returns null if unparseable. */
function parse(url: string): URL | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

function hostMatches(host: string, allowed: string[]): boolean {
  const h = host.toLowerCase();
  return allowed.some((a) => h === a || h.endsWith(`.${a}`));
}

/**
 * Validate + normalize a YouTube recap URL. Returns the normalized https URL when the host is
 * a YouTube host, else null. An empty string is treated as "cleared" → returns ''.
 */
export function normalizeYoutubeUrl(url: string): string | null {
  if (!url.trim()) return '';
  const u = parse(url);
  if (!u || !hostMatches(u.hostname, YOUTUBE_HOSTS)) return null;
  return u.toString();
}

/**
 * Validate + normalize a Google Photos album URL. Returns the normalized https URL when the
 * host is a Google Photos host, else null. An empty string is treated as "cleared" → ''.
 */
export function normalizePhotosUrl(url: string): string | null {
  if (!url.trim()) return '';
  const u = parse(url);
  if (!u || !hostMatches(u.hostname, PHOTOS_HOSTS)) return null;
  return u.toString();
}
