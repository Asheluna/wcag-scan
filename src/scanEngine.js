/**
 * Scan Engine — core scan orchestration, decoupled from CLI.
 * Used by both the CLI (index.js) and the dashboard server.
 */

import puppeteer from 'puppeteer';
import { crawl } from './crawler.js';
import { scanPages } from './scanner.js';
import { analyzeAllPages } from './imageAnalyzer.js';
import { LlamaClient } from './llamaClient.js';
import { runAllCustomChecks } from './customChecks.js';
import { generateHtmlReport, writeHtmlReport, writePdfReport, computeCriteriaSummary } from './reporter.js';
import path from 'path';
import fs from 'fs';

/**
 * Execute a full WCAG scan.
 *
 * @param {object} config
 * @param {string} config.mode - 'full' or 'custom'
 * @param {string[]} config.urls - URLs to scan
 * @param {number} [config.depth] - Max crawl depth (full mode)
 * @param {number} [config.maxPages] - Max pages (full mode)
 * @param {string} [config.level] - WCAG level (A/AA/AAA)
 * @param {string} [config.output] - Output file path
 * @param {string} [config.format] - Output format (html/pdf)
 * @param {string} [config.brandName]
 * @param {string} [config.brandLogo]
 * @param {boolean} [config.skipImages]
 * @param {string} [config.llamaUrl]
 * @param {string} [config.model]
 * @param {object} [callbacks]
 * @param {function} [callbacks.onPhase] - (phase, message) — phase change
 * @param {function} [callbacks.onProgress] - (phase, current, total, detail) — within-phase progress
 * @returns {Promise<{success: boolean, outputPath?: string, summary?: object, error?: string}>}
 */
export async function executeScan(config, callbacks = {}) {
    const {
        mode = 'full',
        urls = [],
        depth = 3,
        maxPages = 25,
        level = 'AA',
        output = 'reports/wcag-report.html',
        format = 'html',
        brandName,
        brandLogo,
        skipImages = false,
        llamaUrl = 'http://192.168.50.107:8080',
        model = 'qwen3vl-8b-instruct',
    } = config;

    const { onPhase, onProgress } = callbacks;
    const emit = (phase, msg) => onPhase?.(phase, msg);
    const progress = (phase, cur, total, detail) => onProgress?.(phase, cur, total, detail);

    let browser;

    try {
        // ── Launch browser ────────────────────────────────────────
        emit('browser', 'Launching browser...');
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        });
        emit('browser', 'Browser launched');

        // ── Step 1: Discover URLs ─────────────────────────────────
        let pagesToScan;

        if (mode === 'full') {
            emit('crawl', `Crawling ${urls[0]}...`);
            pagesToScan = await crawl(browser, urls[0], {
                maxDepth: depth,
                maxPages,
                onPageFound: (url, count, error) => {
                    if (error) {
                        progress('crawl', count, maxPages, `Error: ${url}`);
                    } else {
                        progress('crawl', count, maxPages, url);
                    }
                },
            });
            emit('crawl', `Discovered ${pagesToScan.length} page${pagesToScan.length > 1 ? 's' : ''}`);
        } else {
            pagesToScan = urls;
            emit('crawl', `${pagesToScan.length} URL${pagesToScan.length > 1 ? 's' : ''} to scan`);
        }

        if (pagesToScan.length === 0) {
            return { success: false, error: 'No pages found to scan.' };
        }

        // ── Step 2: WCAG Scan ─────────────────────────────────────
        emit('scan', 'Running WCAG analysis...');
        const scanResults = await scanPages(browser, pagesToScan, {
            level,
            onPageScanned: (url, idx, total, result) => {
                const violations = result.violations?.length || 0;
                progress('scan', idx, total, `${violations} violations — ${url}`);
            },
        });
        const totalViolations = scanResults.reduce((s, r) => s + (r.violations?.length || 0), 0);
        emit('scan', `WCAG analysis complete — ${totalViolations} violation${totalViolations !== 1 ? 's' : ''}`);

        // ── Step 3: Custom WCAG Checks ────────────────────────────
        emit('custom', 'Running custom WCAG checks...');
        const customResults = await runAllCustomChecks(browser, pagesToScan, (url, idx, total) => {
            progress('custom', idx, total, url);
        });
        const customViolations = customResults.perPage.reduce((s, r) =>
            s + (r.findings?.filter(f => f.status === 'violation').length || 0), 0);
        const customWarnings = customResults.perPage.reduce((s, r) =>
            s + (r.findings?.filter(f => f.status === 'warning').length || 0), 0);
        emit('custom', `Custom checks complete — ${customViolations} violation${customViolations !== 1 ? 's' : ''}, ${customWarnings} warning${customWarnings !== 1 ? 's' : ''}`);

        // ── Step 4: Image Analysis ────────────────────────────────
        let imageResults = null;
        let llamaAvailable = false;

        if (!skipImages) {
            emit('images', 'Connecting to llama-server...');
            try {
                const testClient = new LlamaClient({ baseUrl: llamaUrl });
                await testClient.checkConnection();
                llamaAvailable = true;
                emit('images', `Connected to llama-server at ${llamaUrl}`);
            } catch (err) {
                emit('images', `llama-server not available — image analysis limited. (${err.message})`);
            }

            emit('images', 'Analyzing images and media...');
            imageResults = await analyzeAllPages(browser, pagesToScan, {
                llamaUrl,
                model,
                onPageAnalyzed: (url, idx, total) => {
                    progress('images', idx, total, url);
                },
            });
            const totalFindings = imageResults.reduce((s, r) => s + (r.findings?.length || 0), 0);
            emit('images', `Media analysis complete — ${totalFindings} finding${totalFindings !== 1 ? 's' : ''}`);
        }

        // ── Step 5: Generate Report ──────────────────────────────
        emit('report', 'Generating report...');

        const htmlContent = generateHtmlReport(scanResults, imageResults, customResults, {
            targetUrl: urls[0],
            level,
            scanMode: mode,
            brandName,
            brandLogo,
        });

        let outputPath = path.resolve(output);
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });

        if (format === 'pdf') {
            if (!outputPath.endsWith('.pdf')) {
                outputPath = outputPath.replace(/\.html$/, '') + '.pdf';
            }
            await writePdfReport(browser, htmlContent, outputPath, { brandName, brandLogo });
        } else {
            await writeHtmlReport(htmlContent, outputPath);
        }

        emit('report', `Report saved to ${outputPath}`);

        // ── Build summary ─────────────────────────────────────────
        const criteria = computeCriteriaSummary(scanResults, imageResults, customResults);

        await browser.close().catch(() => { });

        return {
            success: true,
            outputPath,
            summary: {
                pagesScanned: scanResults.length,
                criteria,
            },
        };
    } catch (err) {
        if (browser) await browser.close().catch(() => { });
        return { success: false, error: err.message };
    }
}
