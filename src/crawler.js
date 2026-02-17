/**
 * BFS website crawler — discovers same-domain pages.
 */

import { normalizeUrl, isSameDomain, isLikelyHtmlUrl, resolveUrl } from './utils.js';

/**
 * Crawl a website starting from `startUrl`, discovering same-domain pages.
 *
 * @param {import('puppeteer').Browser} browser - Puppeteer browser instance
 * @param {string} startUrl - The root URL to start crawling from
 * @param {object} options
 * @param {number} options.maxDepth - Maximum link depth to crawl (default 3)
 * @param {number} options.maxPages - Maximum number of pages to visit (default 25)
 * @param {function} options.onPageFound - Callback when a new page is discovered
 * @returns {Promise<string[]>} Array of discovered URLs
 */
export async function crawl(browser, startUrl, options = {}) {
    const { maxDepth = 3, maxPages = 25, onPageFound } = options;

    const visited = new Set();
    const normalizedStart = normalizeUrl(startUrl);
    const queue = [{ url: normalizedStart, depth: 0 }];
    const results = [];
    // Track the effective base URL (may change after redirect on first page)
    let effectiveBaseUrl = startUrl;

    if (!queue[0].url) {
        throw new Error(`Invalid start URL: ${startUrl}`);
    }

    while (queue.length > 0 && results.length < maxPages) {
        const { url, depth } = queue.shift();

        if (!url || visited.has(url)) continue;
        visited.add(url);

        // Only crawl same-domain HTML pages
        if (!isSameDomain(effectiveBaseUrl, url) || !isLikelyHtmlUrl(url)) continue;

        try {
            const page = await browser.newPage();
            await page.setUserAgent(
                'Mozilla/5.0 (compatible; WCAGScanner/1.0; +https://github.com/wcag-scan)'
            );

            // Navigate with timeout
            const response = await page.goto(url, {
                waitUntil: 'networkidle2',
                timeout: 30000,
            });

            // Only process HTML responses
            const contentType = response?.headers()?.['content-type'] || '';
            if (!contentType.includes('text/html')) {
                await page.close();
                continue;
            }

            // After the first page, update the effective base URL to handle
            // redirects (e.g. forbrukerradet.no → www.forbrukerradet.no)
            const finalUrl = page.url();
            if (results.length === 0 && finalUrl) {
                effectiveBaseUrl = finalUrl;
            }

            results.push(finalUrl || url);
            if (onPageFound) onPageFound(finalUrl || url, results.length);

            // Extract links if we haven't hit max depth
            if (depth < maxDepth) {
                const links = await page.evaluate(() => {
                    return Array.from(document.querySelectorAll('a[href]'))
                        .map(a => a.href)
                        .filter(href => href && href.startsWith('http'));
                });

                for (const link of links) {
                    const normalized = normalizeUrl(link);
                    if (
                        normalized &&
                        !visited.has(normalized) &&
                        isSameDomain(effectiveBaseUrl, normalized) &&
                        isLikelyHtmlUrl(normalized)
                    ) {
                        queue.push({ url: normalized, depth: depth + 1 });
                    }
                }
            }

            await page.close();
        } catch (err) {
            // Skip pages that fail to load
            if (onPageFound) onPageFound(url, results.length, err.message);
        }
    }

    return results;
}
