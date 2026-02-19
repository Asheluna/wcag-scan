/**
 * Image Analyzer — VLM-based image analysis for WCAG compliance.
 * Uses a local llama-server with a vision model to analyze images on web pages.
 * Also checks video/audio elements for text alternatives.
 */

import { LlamaClient } from './llamaClient.js';

const VLM_PROMPT = `Analyze this web page image for accessibility compliance. Return ONLY valid JSON matching this exact schema:
{
  "description": "Brief objective description of what the image shows",
  "containsText": true or false,
  "detectedText": "Any text visible in the image, or null if none",
  "isDecorative": true or false,
  "decorativeReason": "Why it might be decorative (pattern, spacer, border), or null",
  "contentType": "photo|illustration|icon|chart|logo|screenshot|other"
}
Rules:
- Be factual and concise. Do not hallucinate.
- If uncertain about text, set containsText to false.
- description should be 1-2 sentences max.
- Output ONLY the JSON object, no other text.`;

/**
 * Parse the VLM JSON response, handling common quirks.
 */
function parseVlmResponse(raw) {
    try {
        return JSON.parse(raw);
    } catch {
        // Try extracting first { ... } block
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
            try {
                return JSON.parse(match[0]);
            } catch { /* fall through */ }
        }
        return null;
    }
}

/**
 * Extract image elements from a page and analyze them with VLM.
 *
 * @param {import('puppeteer').Browser} browser
 * @param {string} url
 * @param {object} [options]
 * @param {LlamaClient} [options.llamaClient]
 * @returns {Promise<object>} Image analysis results
 */
export async function analyzePageImages(browser, url, options = {}) {
    const { llamaClient } = options;
    const page = await browser.newPage();
    const findings = [];

    try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

        // Inject selector helper and shared-region detection
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
            window.__isInSharedRegion = function(el) {
                if (el.closest('[role="banner"], [role="contentinfo"]')) return true;
                const shared = el.closest('header, footer, nav');
                return shared ? !shared.closest('article, section, aside, main') : false;
            };
        });

        // Extract only <img> elements (and check for <figure>/<figcaption> context)
        const images = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('img')).map(img => {
                // Check if img is inside a <figure> with a <figcaption>
                const figure = img.closest('figure');
                const figcaption = figure?.querySelector('figcaption');
                const figcaptionText = figcaption?.textContent?.trim() || null;

                return {
                    src: img.src,
                    alt: img.getAttribute('alt'),  // null if missing, "" if empty — important distinction
                    ariaLabel: img.getAttribute('aria-label') || null,
                    ariaLabelledBy: img.getAttribute('aria-labelledby') || null,
                    role: img.getAttribute('role') || null,
                    figcaptionText,                // text from parent <figure>'s <figcaption>
                    width: img.naturalWidth || img.width,
                    height: img.naturalHeight || img.height,
                    isVisible: img.offsetParent !== null,
                    selector: __getSelector(img),
                    inSharedRegion: __isInSharedRegion(img),
                };
            });
        });

        // Filter to visible images of meaningful size (skip tiny icons/spacers)
        // Also skip SVGs and data URIs that VLM can't meaningfully analyze
        const meaningfulImages = images.filter(
            img => img.isVisible && img.src && img.width > 50 && img.height > 20
                && !img.src.endsWith('.svg')
                && !img.src.startsWith('data:image/svg')
        ).slice(0, 10); // Limit to 10 images per page

        // Analyze each image with VLM
        if (llamaClient) {
            for (const img of meaningfulImages) {
                const altText = (img.alt ?? '').trim();
                const hasAlt = altText.length > 0;
                const hasAriaLabel = Boolean(img.ariaLabel?.trim());
                const hasFigcaption = Boolean(img.figcaptionText);
                const hasTextAlternative = hasAlt || hasAriaLabel || hasFigcaption;
                const hasExplicitEmptyAlt = img.alt !== null && img.alt.trim() === '';
                const isMarkedDecorative = img.role === 'presentation' || img.role === 'none' || hasExplicitEmptyAlt;

                // Skip VLM analysis for images explicitly marked as decorative
                if (isMarkedDecorative) continue;

                try {
                    // Fetch the actual image source instead of screenshotting the
                    // rendered element — avoids capturing adjacent text/elements
                    // that may overlap due to CSS layout.
                    let imgBase64;
                    try {
                        imgBase64 = await page.evaluate(async (src) => {
                            const res = await fetch(src);
                            if (!res.ok) return null;
                            const blob = await res.blob();
                            return new Promise((resolve) => {
                                const reader = new FileReader();
                                reader.onloadend = () => resolve(reader.result.split(',')[1]);
                                reader.readAsDataURL(blob);
                            });
                        }, img.src);
                    } catch {
                        // Fallback to element screenshot if fetch fails (e.g. CORS)
                        const elementHandle = await page.$(img.selector);
                        if (!elementHandle) continue;
                        try {
                            imgBase64 = await elementHandle.screenshot({ encoding: 'base64' });
                        } catch {
                            continue;
                        }
                    }

                    if (!imgBase64) continue;

                    // Use the fetched image as the evidence screenshot (not the
                    // rendered element which can include adjacent page content)
                    const imgScreenshot = `data:image/png;base64,${imgBase64}`;

                    // Call VLM
                    const rawResponse = await llamaClient.complete(VLM_PROMPT, {
                        imageBase64: imgBase64,
                    });

                    const vlm = parseVlmResponse(rawResponse);
                    if (!vlm) continue;

                    const vlmDescription = vlm.description || '';
                    const containsText = vlm.containsText === true;
                    const detectedText = vlm.detectedText || null;
                    const vlmIsDecorative = vlm.isDecorative === true;
                    const contentType = vlm.contentType || 'other';

                    // ── WCAG 1.4.5: Images of Text ──
                    if (containsText && detectedText) {
                        let status = 'pass';
                        let message = '';

                        if (!hasTextAlternative) {
                            status = 'violation';
                            message = `Image contains text "${detectedText}" but has no alt text, aria-label, or figcaption. WCAG 1.4.5 requires text alternatives for images of text.`;
                        } else if (hasAlt) {
                            const similarity = calculateTextSimilarity(
                                altText.toLowerCase(),
                                detectedText.toLowerCase().replace(/\s+/g, ' ')
                            );
                            if (similarity < 0.3) {
                                status = 'warning';
                                message = `Image contains text "${detectedText}" but alt text "${altText}" may not adequately describe it (${Math.round(similarity * 100)}% similarity).`;
                            } else {
                                status = 'pass';
                                message = `Image text "${detectedText}" is represented in alt text.`;
                            }
                        } else {
                            // Has aria-label or figcaption
                            status = 'pass';
                            message = hasFigcaption
                                ? `Image has a figcaption as text alternative.`
                                : `Image has an aria-label as text alternative.`;
                        }

                        findings.push({
                            type: 'image',
                            src: img.src,
                            detectedText,
                            altText: img.alt,
                            confidence: 100,
                            status,
                            message,
                            wcagCriteria: '1.4.5',
                            wcagName: 'Images of Text',
                            selector: img.selector,
                            inSharedRegion: img.inSharedRegion,
                            screenshot: status !== 'pass' ? imgScreenshot : undefined,
                            vlmDescription,
                            contentType,
                        });
                    }

                    // ── WCAG 1.1.1: Non-text Content ──
                    if (!hasTextAlternative) {
                        // No text alternative at all
                        if (vlmIsDecorative) {
                            findings.push({
                                type: 'image',
                                src: img.src,
                                detectedText: null,
                                altText: img.alt,
                                confidence: 100,
                                status: 'warning',
                                message: `Image appears decorative (${vlm.decorativeReason || 'visual pattern'}) but is not marked with role="presentation", role="none", or alt="". Consider adding an empty alt="" or a role attribute.`,
                                wcagCriteria: '1.1.1',
                                wcagName: 'Non-text Content',
                                selector: img.selector,
                                inSharedRegion: img.inSharedRegion,
                                screenshot: imgScreenshot,
                                vlmDescription,
                                contentType,
                            });
                        } else {
                            findings.push({
                                type: 'image',
                                src: img.src,
                                detectedText: null,
                                altText: img.alt,
                                confidence: 100,
                                status: 'violation',
                                message: `Image has no alt text, aria-label, or figcaption. The image shows: ${vlmDescription || 'content that should be described'}.`,
                                wcagCriteria: '1.1.1',
                                wcagName: 'Non-text Content',
                                selector: img.selector,
                                inSharedRegion: img.inSharedRegion,
                                screenshot: imgScreenshot,
                                vlmDescription,
                                contentType,
                            });
                        }
                    } else if (hasAlt && vlmDescription) {
                        // Has alt text — check quality against VLM description
                        const similarity = calculateTextSimilarity(
                            altText.toLowerCase(),
                            vlmDescription.toLowerCase()
                        );
                        if (similarity < 0.15 && altText.length < 10) {
                            findings.push({
                                type: 'image',
                                src: img.src,
                                detectedText: null,
                                altText: img.alt,
                                confidence: 100,
                                status: 'warning',
                                message: `Alt text "${altText}" may not adequately describe the image. The image shows: ${vlmDescription}.`,
                                wcagCriteria: '1.1.1',
                                wcagName: 'Non-text Content',
                                selector: img.selector,
                                inSharedRegion: img.inSharedRegion,
                                screenshot: imgScreenshot,
                                vlmDescription,
                                contentType,
                            });
                        }
                    }
                } catch {
                    // Skip images that fail VLM analysis (timeout, encoding issue, etc.)
                }
            }
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
                inSharedRegion: __isInSharedRegion(video),
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
                    inSharedRegion: video.inSharedRegion,
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
                inSharedRegion: __isInSharedRegion(audio),
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
                    inSharedRegion: audio.inSharedRegion,
                });
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
 * @param {object} [options]
 * @param {string} [options.llamaUrl] - llama-server base URL
 * @param {string} [options.model] - VLM model name
 * @param {function} [options.onPageAnalyzed] - (url, index, total, result) callback
 * @returns {Promise<object[]>}
 */
export async function analyzeAllPages(browser, urls, options = {}) {
    const { llamaUrl, model, onPageAnalyzed } = options;

    // Create llama client if URL is provided
    let llamaClient = null;
    if (llamaUrl) {
        llamaClient = new LlamaClient({ baseUrl: llamaUrl, model: model || '' });
    }

    const results = [];
    for (let i = 0; i < urls.length; i++) {
        const result = await analyzePageImages(browser, urls[i], { llamaClient });
        results.push(result);
        if (onPageAnalyzed) onPageAnalyzed(urls[i], i + 1, urls.length, result);
    }
    return results;
}
