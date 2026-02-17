#!/usr/bin/env node

/**
 * WCAG Scanner — CLI entry point.
 * Scan websites for WCAG 2.2 compliance and generate reports.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import puppeteer from 'puppeteer';
import { crawl } from './crawler.js';
import { scanPages } from './scanner.js';
import { analyzeAllPages } from './imageAnalyzer.js';
import { runAllCustomChecks } from './customChecks.js';
import { generateHtmlReport, writeHtmlReport, writePdfReport } from './reporter.js';
import path from 'path';

// Suppress unhandled rejections from Puppeteer cleanup
process.on('unhandledRejection', (reason) => {
    // Silently ignore cleanup-related rejections
    if (reason !== undefined) {
        // Only log real errors, not browser close race conditions
    }
});

const program = new Command();

program
    .name('wcag-scan')
    .description('WCAG 2.2 compliance scanner — crawl websites and generate accessibility reports')
    .version('1.0.0');

// ── Full Site Scan ──────────────────────────────────────────────────────────

program
    .command('scan')
    .description('Full site scan — crawl a website and scan discovered pages')
    .requiredOption('--url <url>', 'Website URL to scan')
    .option('--depth <number>', 'Maximum crawl depth', (v) => parseInt(v, 10), 3)
    .option('--max-pages <number>', 'Maximum pages to scan', (v) => parseInt(v, 10), 25)
    .option('--level <level>', 'WCAG conformance level (A, AA, AAA)', 'AA')
    .option('--output <file>', 'Output file path', 'wcag-report.html')
    .option('--format <format>', 'Output format (html, pdf)', 'html')
    .option('--brand-name <name>', 'Brand name for PDF header')
    .option('--brand-logo <path>', 'Path to logo image for PDF header')
    .option('--skip-images', 'Skip image text analysis', false)
    .action(async (opts) => {
        await runScan({
            mode: 'full',
            urls: [opts.url],
            depth: opts.depth,
            maxPages: opts.maxPages,
            level: opts.level,
            output: opts.output,
            format: opts.format,
            brandName: opts.brandName,
            brandLogo: opts.brandLogo,
            skipImages: opts.skipImages,
        });
    });

// ── Custom URL Scan ─────────────────────────────────────────────────────────

program
    .command('scan-urls')
    .description('Custom scan — scan up to 10 specific URLs')
    .requiredOption('--urls <urls>', 'Comma-separated list of URLs to scan (max 10)')
    .option('--level <level>', 'WCAG conformance level (A, AA, AAA)', 'AA')
    .option('--output <file>', 'Output file path', 'wcag-report.html')
    .option('--format <format>', 'Output format (html, pdf)', 'html')
    .option('--brand-name <name>', 'Brand name for PDF header')
    .option('--brand-logo <path>', 'Path to logo image for PDF header')
    .option('--skip-images', 'Skip image text analysis', false)
    .action(async (opts) => {
        const urls = opts.urls.split(',').map(u => u.trim()).filter(Boolean);
        if (urls.length === 0) {
            console.error(chalk.red('Error: No valid URLs provided.'));
            process.exit(1);
        }
        if (urls.length > 10) {
            console.error(chalk.red('Error: Maximum 10 URLs allowed in custom scan mode.'));
            process.exit(1);
        }
        await runScan({
            mode: 'custom',
            urls,
            level: opts.level,
            output: opts.output,
            format: opts.format,
            brandName: opts.brandName,
            brandLogo: opts.brandLogo,
            skipImages: opts.skipImages,
        });
    });

// ── Main Scan Orchestrator ──────────────────────────────────────────────────

async function runScan(config) {
    const {
        mode, urls, depth, maxPages, level, output, format,
        brandName, brandLogo, skipImages,
    } = config;

    console.log('');
    console.log(chalk.bold.hex('#818cf8')('  ╔══════════════════════════════════════╗'));
    console.log(chalk.bold.hex('#818cf8')('  ║      WCAG 2.2 Compliance Scanner     ║'));
    console.log(chalk.bold.hex('#818cf8')('  ╚══════════════════════════════════════╝'));
    console.log('');
    console.log(chalk.gray(`  Mode:     ${mode === 'full' ? 'Full Site Scan' : 'Custom URL Scan'}`));
    console.log(chalk.gray(`  Level:    WCAG 2.2 Level ${level}`));
    console.log(chalk.gray(`  Output:   ${output} (${format.toUpperCase()})`));
    if (mode === 'full') {
        console.log(chalk.gray(`  Depth:    ${depth} | Max Pages: ${maxPages}`));
    } else {
        console.log(chalk.gray(`  URLs:     ${urls.length}`));
    }
    console.log('');

    // Launch browser
    const spinner = ora({ text: 'Launching browser...', color: 'cyan' }).start();
    let browser;

    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        });
        spinner.succeed('Browser launched');

        // ── Step 1: Discover URLs ──────────────────────────────────
        let pagesToScan;

        if (mode === 'full') {
            const crawlSpinner = ora({ text: `Crawling ${urls[0]}...`, color: 'cyan' }).start();
            pagesToScan = await crawl(browser, urls[0], {
                maxDepth: depth,
                maxPages: maxPages,
                onPageFound: (url, count, error) => {
                    if (error) {
                        crawlSpinner.text = chalk.yellow(`  [${count}] Error: ${url}`);
                    } else {
                        crawlSpinner.text = `  Discovered ${count} page${count > 1 ? 's' : ''}... ${chalk.gray(url)}`;
                    }
                },
            });
            crawlSpinner.succeed(`Discovered ${pagesToScan.length} page${pagesToScan.length > 1 ? 's' : ''}`);
        } else {
            pagesToScan = urls;
            console.log(chalk.green(`  ✓ ${pagesToScan.length} URL${pagesToScan.length > 1 ? 's' : ''} to scan`));
        }

        if (pagesToScan.length === 0) {
            spinner.fail('No pages found to scan.');
            await browser.close().catch(() => { });
            return;
        }

        // ── Step 2: WCAG Scan ──────────────────────────────────────
        const scanSpinner = ora({ text: 'Running WCAG analysis...', color: 'cyan' }).start();
        const scanResults = await scanPages(browser, pagesToScan, {
            level,
            onPageScanned: (url, idx, total, result) => {
                const violations = result.violations?.length || 0;
                const status = violations > 0
                    ? chalk.red(`${violations} violations`)
                    : chalk.green('✓ passed');
                scanSpinner.text = `  [${idx}/${total}] ${status} ${chalk.gray(url)}`;
            },
        });
        const totalViolations = scanResults.reduce((s, r) => s + (r.violations?.length || 0), 0);
        scanSpinner.succeed(`WCAG analysis complete — ${totalViolations} violation${totalViolations !== 1 ? 's' : ''} found`);

        // ── Step 3: Custom WCAG Checks ──────────────────────────────
        const customSpinner = ora({ text: 'Running custom WCAG checks...', color: 'cyan' }).start();
        const customResults = await runAllCustomChecks(browser, pagesToScan, (url, idx, total) => {
            customSpinner.text = `  [${idx}/${total}] Custom checks... ${chalk.gray(url)}`;
        });
        const customViolations = customResults.perPage.reduce((s, r) =>
            s + (r.findings?.filter(f => f.status === 'violation').length || 0), 0);
        const customWarnings = customResults.perPage.reduce((s, r) =>
            s + (r.findings?.filter(f => f.status === 'warning').length || 0), 0);
        customSpinner.succeed(`Custom checks complete — ${customViolations} violation${customViolations !== 1 ? 's' : ''}, ${customWarnings} warning${customWarnings !== 1 ? 's' : ''}`);

        // ── Step 4: Image Analysis ─────────────────────────────────
        let imageResults = null;
        if (!skipImages) {
            const imgSpinner = ora({ text: 'Analyzing images and media...', color: 'cyan' }).start();
            imageResults = await analyzeAllPages(browser, pagesToScan, (url, idx, total) => {
                imgSpinner.text = `  [${idx}/${total}] Analyzing media... ${chalk.gray(url)}`;
            });
            const totalFindings = imageResults.reduce((s, r) => s + (r.findings?.length || 0), 0);
            imgSpinner.succeed(`Media analysis complete — ${totalFindings} finding${totalFindings !== 1 ? 's' : ''}`);
        }

        // ── Step 5: Generate Report ────────────────────────────────
        const reportSpinner = ora({ text: 'Generating report...', color: 'cyan' }).start();

        const htmlContent = generateHtmlReport(scanResults, imageResults, customResults, {
            targetUrl: urls[0],
            level,
            scanMode: mode,
            brandName,
            brandLogo,
        });

        let outputPath = path.resolve(output);

        if (format === 'pdf') {
            if (!outputPath.endsWith('.pdf')) {
                outputPath = outputPath.replace(/\.html$/, '') + '.pdf';
            }
            await writePdfReport(browser, htmlContent, outputPath, { brandName, brandLogo });
        } else {
            await writeHtmlReport(htmlContent, outputPath);
        }

        reportSpinner.succeed(`Report saved to ${chalk.bold(outputPath)}`);

        // ── Summary ────────────────────────────────────────────────
        console.log('');
        const totalPasses = scanResults.reduce((s, r) => s + (r.passes?.length || 0), 0);
        console.log(chalk.bold('  Summary:'));
        console.log(`    Pages scanned:  ${chalk.bold(scanResults.length)}`);
        console.log(`    Violations:     ${totalViolations > 0 ? chalk.red.bold(totalViolations) : chalk.green.bold(0)}`);
        console.log(`    Passed rules:   ${chalk.green.bold(totalPasses)}`);
        console.log(`    Custom checks:  ${customViolations > 0 ? chalk.red.bold(customViolations + ' violations') : chalk.green.bold('0 violations')}, ${customWarnings > 0 ? chalk.yellow.bold(customWarnings + ' warnings') : chalk.green.bold('0 warnings')}`);
        if (imageResults) {
            const imgViolations = imageResults.reduce((s, r) => s + (r.findings?.filter(f => f.status === 'violation').length || 0), 0);
            console.log(`    Media issues:   ${imgViolations > 0 ? chalk.yellow.bold(imgViolations) : chalk.green.bold(0)}`);
        }
        console.log('');

        await browser.close().catch(() => { });
    } catch (err) {
        spinner.fail(chalk.red(`Error: ${err.message}`));
        if (browser) await browser.close().catch(() => { });
        process.exit(1);
    }
}

program.parse();
