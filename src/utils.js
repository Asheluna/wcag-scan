/**
 * URL and utility helpers for the WCAG scanner.
 */

/**
 * Normalize a URL by removing fragments, trailing slashes, and sorting query params.
 */
export function normalizeUrl(urlString) {
  try {
    const url = new URL(urlString);
    url.hash = '';
    // Remove trailing slash except for root
    if (url.pathname !== '/' && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }
    url.searchParams.sort();
    return url.href;
  } catch {
    return null;
  }
}

/**
 * Check if a URL belongs to the same domain as the base URL.
 */
export function isSameDomain(baseUrl, candidateUrl) {
  try {
    const base = new URL(baseUrl);
    const candidate = new URL(candidateUrl);
    // Strip leading "www." for comparison so that
    // forbrukerradet.no and www.forbrukerradet.no are treated as same domain
    const stripWww = (h) => h.replace(/^www\./, '');
    return stripWww(base.hostname) === stripWww(candidate.hostname);
  } catch {
    return false;
  }
}

/**
 * Check if a URL likely points to an HTML page (not a file download).
 */
export function isLikelyHtmlUrl(urlString) {
  try {
    const url = new URL(urlString);
    const path = url.pathname.toLowerCase();
    const skipExtensions = [
      '.pdf', '.zip', '.tar', '.gz', '.rar',
      '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico', '.bmp',
      '.mp3', '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm',
      '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.css', '.js', '.json', '.xml', '.rss',
      '.woff', '.woff2', '.ttf', '.eot',
    ];
    return !skipExtensions.some(ext => path.endsWith(ext));
  } catch {
    return false;
  }
}

/**
 * Resolve a potentially relative URL against a base.
 */
export function resolveUrl(base, relative) {
  try {
    return new URL(relative, base).href;
  } catch {
    return null;
  }
}

/**
 * Map axe-core impact levels to display colors.
 */
export function getSeverityColor(impact) {
  const colors = {
    critical: '#e53e3e',
    serious: '#dd6b20',
    moderate: '#d69e2e',
    minor: '#38a169',
  };
  return colors[impact] || '#718096';
}

/**
 * Map axe-core impact to a numeric score for sorting.
 */
export function getSeverityWeight(impact) {
  const weights = { critical: 4, serious: 3, moderate: 2, minor: 1 };
  return weights[impact] || 0;
}

/**
 * Format a timestamp to a readable string.
 */
export function formatTimestamp(date) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeStyle: 'medium',
  }).format(date);
}

/**
 * Truncate a string to maxLen, appending '…' if truncated.
 */
export function truncate(str, maxLen = 120) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

/**
 * Calculate a compliance score (0-100) from scan results.
 */
export function calculateScore(results) {
  if (!results || results.length === 0) return 0;
  let totalPasses = 0;
  let totalViolations = 0;
  for (const r of results) {
    totalPasses += r.passes?.length || 0;
    totalViolations += r.violations?.length || 0;
  }
  const total = totalPasses + totalViolations;
  if (total === 0) return 100;
  return Math.round((totalPasses / total) * 100);
}
