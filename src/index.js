#!/usr/bin/env node

/**
 * WCAG Scanner — CLI entry point.
 * Scan websites for WCAG 2.2 compliance and generate reports.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { executeScan } from './scanEngine.js';

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
    .option('--output <file>', 'Output file path', 'reports/wcag-report.html')
    .option('--format <format>', 'Output format (html, pdf)', 'html')
    .option('--brand-name <name>', 'Brand name for PDF header')
    .option('--brand-logo <path>', 'Path to logo image for PDF header')
    .option('--skip-images', 'Skip image text analysis', false)
    .option('--llama-url <url>', 'llama-server base URL', 'http://192.168.50.107:8080')
    .option('--model <name>', 'VLM model name for image analysis', 'qwen3vl-8b-instruct')
    .action(async (opts) => {
        await runCliScan({
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
            llamaUrl: opts.llamaUrl,
            model: opts.model,
        });
    });

// ── Custom URL Scan ─────────────────────────────────────────────────────────

program
    .command('scan-urls')
    .description('Custom scan — scan up to 10 specific URLs')
    .requiredOption('--urls <urls>', 'Comma-separated list of URLs to scan (max 10)')
    .option('--level <level>', 'WCAG conformance level (A, AA, AAA)', 'AA')
    .option('--output <file>', 'Output file path', 'reports/wcag-report.html')
    .option('--format <format>', 'Output format (html, pdf)', 'html')
    .option('--brand-name <name>', 'Brand name for PDF header')
    .option('--brand-logo <path>', 'Path to logo image for PDF header')
    .option('--skip-images', 'Skip image text analysis', false)
    .option('--llama-url <url>', 'llama-server base URL', 'http://192.168.50.107:8080')
    .option('--model <name>', 'VLM model name for image analysis', 'qwen3vl-8b-instruct')
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
        await runCliScan({
            mode: 'custom',
            urls,
            level: opts.level,
            output: opts.output,
            format: opts.format,
            brandName: opts.brandName,
            brandLogo: opts.brandLogo,
            skipImages: opts.skipImages,
            llamaUrl: opts.llamaUrl,
            model: opts.model,
        });
    });

// ── Dashboard ───────────────────────────────────────────────────────────────

program
    .command('dashboard')
    .description('Start the web dashboard for managing scans')
    .option('--port <number>', 'Port to listen on', (v) => parseInt(v, 10), 3000)
    .action(async (opts) => {
        const { startDashboard } = await import('./dashboard/server.js');
        await startDashboard({ port: opts.port });
    });

// ── CLI Scan Wrapper ────────────────────────────────────────────────────────

async function runCliScan(config) {
    console.log('');
    console.log(chalk.bold.hex('#818cf8')('  ╔══════════════════════════════════════╗'));
    console.log(chalk.bold.hex('#818cf8')('  ║      WCAG 2.2 Compliance Scanner     ║'));
    console.log(chalk.bold.hex('#818cf8')('  ╚══════════════════════════════════════╝'));
    console.log('');
    console.log(chalk.gray(`  Mode:     ${config.mode === 'full' ? 'Full Site Scan' : 'Custom URL Scan'}`));
    console.log(chalk.gray(`  Level:    WCAG 2.2 Level ${config.level}`));
    console.log(chalk.gray(`  Output:   ${config.output} (${config.format.toUpperCase()})`));
    if (config.mode === 'full') {
        console.log(chalk.gray(`  Depth:    ${config.depth} | Max Pages: ${config.maxPages}`));
    } else {
        console.log(chalk.gray(`  URLs:     ${config.urls.length}`));
    }
    console.log('');

    let spinner = ora({ text: 'Starting...', color: 'cyan' }).start();

    const result = await executeScan(config, {
        onPhase: (phase, message) => {
            // Update spinner for each phase
            if (phase === 'report' && message.startsWith('Report saved')) {
                spinner.succeed(message);
            } else if (phase === 'images' && message.includes('not available')) {
                spinner.warn(chalk.yellow(message));
                spinner = ora({ text: '', color: 'cyan' }).start();
            } else {
                spinner.succeed(message);
                spinner = ora({ text: '', color: 'cyan' }).start();
            }
        },
        onProgress: (phase, current, total, detail) => {
            spinner.text = `  [${current}/${total}] ${detail}`;
        },
    });

    if (spinner.isSpinning) spinner.stop();

    if (!result.success) {
        console.error(chalk.red(`  Error: ${result.error}`));
        process.exit(1);
    }

    // Print summary
    const s = result.summary;
    const c = s.criteria;
    console.log('');
    console.log(chalk.bold('  Summary:'));
    console.log(`    Pages scanned:  ${chalk.bold(s.pagesScanned)}`);
    console.log(`    Criteria:       ${chalk.green.bold(c.passed)}/${chalk.bold(c.total)} passed  ${c.failed > 0 ? chalk.red.bold(c.failed + ' failed') : ''}  ${c.review > 0 ? chalk.yellow.bold(c.review + ' needs review') : ''}`);
    console.log(`    Score:          ${c.score >= 80 ? chalk.green.bold(c.score + '%') : c.score >= 50 ? chalk.yellow.bold(c.score + '%') : chalk.red.bold(c.score + '%')}`);
    console.log('');
}

program.parse();
