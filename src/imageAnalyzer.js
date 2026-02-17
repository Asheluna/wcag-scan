/**
 * Image Analyzer — OCR-based text detection for WCAG 1.4.5 compliance.
 * Also checks video/audio elements for text alternatives.
 */

import Tesseract from 'tesseract.js';
import { screenshotElement } from './customChecks.js';

/**
 * Extract image elements from a page and analyze them for text content.
 *
 * @param {import('puppeteer').Browser} browser
 * @param {string} url
 * @returns {Promise<object>} Image analysis results
 */
export async function analyzePageImages(browser, url) {
    const page = await browser.newPage();
    const findings = [];

    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // Inject selector helper for screenshot targeting
        await page.evaluate(() => {
            window.__getSelector = function(el) {
                if (!el || el === document.body) return 'body';
                const path = [];
                while (el && el !== document.body && el.parentNode) {
                    const idx = Array.from(el.parentNode.children).indexOf(el) + 1;
                    path.unshift(`${el.tagName.toLowerCase()}:nth-child(${idx})`);
                    el = el.parentNode;
                }
                return 'body > ' + path.join(' > ');
            };
        });

        // Extract all images with their attributes
        const images = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('img')).map(img => ({
                src: img.src,
                alt: img.alt || null,
                ariaLabel: img.getAttribute('aria-label') || null,
                ariaLabelledBy: img.getAttribute('aria-labelledby') || null,
                role: img.getAttribute('role') || null,
                width: img.naturalWidth || img.width,
                height: img.naturalHeight || img.height,
                isVisible: img.offsetParent !== null,
                selector: __getSelector(img),
            }));
        });

        // Filter to visible images of meaningful size (skip tiny icons/spacers)
        // Also skip SVGs and data URIs that Tesseract can't process
        const meaningfulImages = images.filter(
            img => img.isVisible && img.src && img.width > 50 && img.height > 20
                && !img.src.endsWith('.svg')
                && !img.src.startsWith('data:image/svg')
        ).slice(0, 10); // Limit to 10 images per page for performance

        // Create a Tesseract worker for this page
        let worker = null;
        try {
            worker = await Tesseract.createWorker('eng', 1, {
                logger: () => { },
            });
        } catch {
            // If we can't create a worker, skip OCR entirely
            worker = null;
        }

        // OCR each image to detect text
        if (worker) {
            for (const img of meaningfulImages) {
                try {
                    const { data } = await worker.recognize(img.src);

                    const detectedText = data.text?.trim() || '';
                    const confidence = data.confidence || 0;

                    // Only flag if we detect text with reasonable confidence
                    if (detectedText.length > 2 && confidence > 50) {
                        const altText = img.alt?.trim() || '';
                        const hasAlt = Boolean(altText);
                        const hasAriaLabel = Boolean(img.ariaLabel?.trim());
                        const isDecorative = img.role === 'presentation' || img.role === 'none';

                        let status = 'pass';
                        let message = '';

                        if (isDecorative) {
                            status = 'warning';
                            message = `Image marked as decorative (role="${img.role}") but contains text: "${detectedText}". Verify this is intentional.`;
                        } else if (!hasAlt && !hasAriaLabel) {
                            status = 'violation';
                            message = `Image contains text "${detectedText}" but has no alt text or aria-label. WCAG 1.4.5 requires text alternatives for images of text.`;
                        } else if (hasAlt) {
                            const altLower = altText.toLowerCase();
                            const detectedLower = detectedText.toLowerCase().replace(/\s+/g, ' ');
                            const similarity = calculateTextSimilarity(altLower, detectedLower);

                            if (similarity < 0.3) {
                                status = 'warning';
                                message = `Image contains text "${detectedText}" but alt text "${altText}" may not adequately describe it (${Math.round(similarity * 100)}% similarity).`;
                            } else {
                                status = 'pass';
                                message = `Image text "${detectedText}" is represented in alt text "${altText}".`;
                            }
                        } else {
                            status = 'pass';
                            message = `Image has an aria-label as text alternative.`;
                        }

                        findings.push({
                            type: 'image',
                            src: img.src,
                            detectedText,
                            altText: img.alt,
                            confidence: Math.round(confidence),
                            status,
                            message,
                            wcagCriteria: '1.4.5',
                            wcagName: 'Images of Text',
                            selector: img.selector,
                        });
                    }
                } catch {
                    // Skip images we can't OCR (CORS, broken, unsupported format, etc.)
                }
            }

            try { await worker.terminate(); } catch { /* ignore */ }
        }

        // Check video elements for text alternatives
        const videoFindings = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('video')).map(video => ({
                src: video.src || video.querySelector('source')?.src || 'unknown',
                hasTrack: video.querySelectorAll('track').length > 0,
                hasCaptions: Array.from(video.querySelectorAll('track')).some(
                    t => t.kind === 'captions' || t.kind === 'subtitles'
                ),
                ariaLabel: video.getAttribute('aria-label') || null,
                title: video.getAttribute('title') || null,
                selector: __getSelector(video),
            }));
        });

        for (const video of videoFindings) {
            if (!video.hasCaptions) {
                findings.push({
                    type: 'video',
                    src: video.src,
                    detectedText: null,
                    altText: null,
                    confidence: null,
                    status: 'violation',
                    message: `Video element lacks captions/subtitles track. WCAG 1.2.2 requires captions for prerecorded audio content.`,
                    wcagCriteria: '1.2.2',
                    wcagName: 'Captions (Prerecorded)',
                    selector: video.selector,
                });
            }
        }

        // Check audio elements for text alternatives
        const audioFindings = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('audio')).map(audio => ({
                src: audio.src || audio.querySelector('source')?.src || 'unknown',
                ariaLabel: audio.getAttribute('aria-label') || null,
                title: audio.getAttribute('title') || null,
                selector: __getSelector(audio),
            }));
        });

        for (const audio of audioFindings) {
            if (!audio.ariaLabel && !audio.title) {
                findings.push({
                    type: 'audio',
                    src: audio.src,
                    detectedText: null,
                    altText: null,
                    confidence: null,
                    status: 'warning',
                    message: `Audio element lacks text alternative (aria-label or title). Consider providing a transcript for WCAG 1.2.1.`,
                    wcagCriteria: '1.2.1',
                    wcagName: 'Audio-only and Video-only (Prerecorded)',
                    selector: audio.selector,
                });
            }
        }

        // Capture screenshots for non-pass findings (max 3)
        let screenshotCount = 0;
        for (const f of findings) {
            if (screenshotCount >= 3) break;
            if (f.status !== 'pass' && f.selector) {
                try {
                    f.screenshot = await screenshotElement(page, f.selector);
                    if (f.screenshot) screenshotCount++;
                } catch {
                    // Skip if screenshot fails
                }
            }
        }

        return { url, findings, error: null };
    } catch (err) {
        return { url, findings: [], error: err.message };
    } finally {
        await page.close();
    }
}

/**
 * Calculate a rough text similarity score (0–1) using word overlap.
 */
function calculateTextSimilarity(a, b) {
    if (!a || !b) return 0;
    const wordsA = new Set(a.split(/\s+/).filter(w => w.length > 1));
    const wordsB = new Set(b.split(/\s+/).filter(w => w.length > 1));
    if (wordsA.size === 0 && wordsB.size === 0) return 1;
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let overlap = 0;
    for (const word of wordsA) {
        if (wordsB.has(word)) overlap++;
    }
    return overlap / Math.max(wordsA.size, wordsB.size);
}

/**
 * Analyze images on multiple pages.
 *
 * @param {import('puppeteer').Browser} browser
 * @param {string[]} urls
 * @param {function} onPageAnalyzed - (url, index, total) callback
 * @returns {Promise<object[]>}
 */
export async function analyzeAllPages(browser, urls, onPageAnalyzed) {
    const results = [];
    for (let i = 0; i < urls.length; i++) {
        const result = await analyzePageImages(browser, urls[i]);
        results.push(result);
        if (onPageAnalyzed) onPageAnalyzed(urls[i], i + 1, urls.length, result);
    }
    return results;
}
