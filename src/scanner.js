/**
 * WCAG scanner — runs axe-core against pages via Puppeteer.
 */

import AxeBuilder from '@axe-core/puppeteer';
import { screenshotElement } from './customChecks.js';

/**
 * Get the axe-core tag set for a given WCAG conformance level.
 */
function getWcagTags(level) {
    const tagSets = {
        A: ['wcag2a', 'wcag21a', 'wcag22a', 'best-practice'],
        AA: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
        AAA: ['wcag2a', 'wcag2aa', 'wcag2aaa', 'wcag21a', 'wcag21aa', 'wcag21aaa', 'wcag22aa', 'wcag22aaa', 'best-practice'],
    };
    return tagSets[level.toUpperCase()] || tagSets.AA;
}

/**
 * Scan a single page for WCAG violations using axe-core.
 *
 * @param {import('puppeteer').Browser} browser
 * @param {string} url
 * @param {object} options
 * @param {string} options.level - WCAG conformance level (A/AA/AAA)
 * @returns {Promise<object>} Scan result
 */
export async function scanPage(browser, url, options = {}) {
    const { level = 'AA' } = options;
    const page = await browser.newPage();

    try {
        await page.setViewport({ width: 1280, height: 900 });
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // Wait a bit for any remaining dynamic content
        await new Promise(resolve => setTimeout(resolve, 1000));

        const tags = getWcagTags(level);

        const results = await new AxeBuilder(page)
            .withTags(tags)
            .analyze();

        // Tag nodes that are inside shared regions (site-wide header/footer)
        // so the reporter can deduplicate them across pages
        const allSelectors = new Set();
        for (const cat of ['violations', 'passes', 'incomplete', 'inapplicable']) {
            for (const rule of results[cat] || []) {
                for (const node of rule.nodes || []) {
                    if (node.target?.[0]) allSelectors.add(node.target[0]);
                }
            }
        }
        if (allSelectors.size > 0) {
            const sharedMap = await page.evaluate((sels) => {
                const map = {};
                for (const sel of sels) {
                    try {
                        const el = document.querySelector(sel);
                        if (!el) { map[sel] = false; continue; }
                        if (el.closest('[role="banner"], [role="contentinfo"]')) { map[sel] = true; continue; }
                        const shared = el.closest('header, footer, nav');
                        map[sel] = shared ? !shared.closest('article, section, aside, main') : false;
                    } catch { map[sel] = false; }
                }
                return map;
            }, [...allSelectors]);
            for (const cat of ['violations', 'passes', 'incomplete', 'inapplicable']) {
                for (const rule of results[cat] || []) {
                    for (const node of rule.nodes || []) {
                        node.inSharedRegion = sharedMap[node.target?.[0]] || false;
                    }
                }
            }
        }

        // Capture screenshots for violation nodes (max 2 per rule)
        for (const violation of results.violations || []) {
            for (const node of violation.nodes.slice(0, 2)) {
                const selector = node.target?.[0];
                if (selector) {
                    try {
                        node.screenshot = await screenshotElement(page, selector);
                    } catch {
                        // Skip if screenshot fails
                    }
                }
            }
        }

        return {
            url,
            timestamp: new Date().toISOString(),
            violations: results.violations || [],
            passes: results.passes || [],
            incomplete: results.incomplete || [],
            inapplicable: results.inapplicable || [],
            error: null,
        };
    } catch (err) {
        return {
            url,
            timestamp: new Date().toISOString(),
            violations: [],
            passes: [],
            incomplete: [],
            inapplicable: [],
            error: err.message,
        };
    } finally {
        await page.close();
    }
}

/**
 * Scan multiple pages.
 *
 * @param {import('puppeteer').Browser} browser
 * @param {string[]} urls
 * @param {object} options
 * @param {string} options.level
 * @param {function} options.onPageScanned - (url, index, total) callback
 * @returns {Promise<object[]>}
 */
export async function scanPages(browser, urls, options = {}) {
    const { level = 'AA', onPageScanned } = options;
    const results = [];

    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const result = await scanPage(browser, url, { level });
        results.push(result);
        if (onPageScanned) onPageScanned(url, i + 1, urls.length, result);
    }

    return results;
}
