# WCAG Scanner

WCAG 2.2 compliance scanner for websites. Crawls pages, runs automated accessibility checks, analyzes images with a vision language model, and generates detailed HTML/PDF reports.

Built for Norwegian regulatory requirements (48 criteria for public sector, 47 for private sector).

## Features

- **Automated WCAG scanning** via axe-core — covers rules for levels A, AA, and AAA
- **Custom checks** — Puppeteer-based tests for criteria not covered by axe-core, with screenshot evidence
- **VLM image analysis** — uses a remote llama-server with a vision model to detect text in images, classify decorative images, and check alt text quality (WCAG 1.1.1, 1.4.5)
- **Website crawler** — BFS crawl that discovers same-domain pages up to a configurable depth
- **HTML & PDF reports** — dark-themed reports with score rings, violation details, affected elements, and evidence screenshots
- **Web dashboard** — browser-based UI for starting scans, viewing history, and browsing reports
- **CLI** — full-featured command-line interface for scripting and CI/CD

## Requirements

- Node.js 18+
- For image analysis: a [llama-server](https://github.com/ggml-org/llama.cpp/tree/master/tools/server) instance running a vision model (e.g. Qwen3-VL-8B)

## Installation

```bash
npm install
```

## Usage

### Web Dashboard

Start the dashboard and manage scans from your browser:

```bash
npm run dashboard
```

Opens at `http://localhost:3000`. From here you can:
- Configure and start scans
- Watch scan progress in real time
- Browse scan history
- View and open generated reports

To use a custom port:

```bash
node src/index.js dashboard --port 8080
```

### CLI — Full Site Scan

Crawl a website and scan all discovered pages:

```bash
node src/index.js scan --url https://example.com
```

Options:

| Flag | Default | Description |
|------|---------|-------------|
| `--url <url>` | *required* | Website URL to scan |
| `--depth <n>` | `3` | Maximum crawl depth |
| `--max-pages <n>` | `25` | Maximum pages to scan |
| `--level <level>` | `AA` | WCAG conformance level (A, AA, AAA) |
| `--output <file>` | `reports/wcag-report.html` | Output file path |
| `--format <fmt>` | `html` | Output format (html, pdf) |
| `--skip-images` | `false` | Skip VLM image analysis |
| `--llama-url <url>` | `http://192.168.50.107:8080` | llama-server base URL |
| `--model <name>` | `qwen3vl-8b-instruct` | Vision model name |
| `--brand-name <name>` | — | Brand name for PDF header |
| `--brand-logo <path>` | — | Path to logo image for PDF header |

Examples:

```bash
# Quick scan, 5 pages, skip image analysis
node src/index.js scan --url https://example.com --max-pages 5 --skip-images

# Full scan with PDF output
node src/index.js scan --url https://example.com --format pdf --brand-name "Acme Corp"

# Level AAA scan
node src/index.js scan --url https://example.com --level AAA --depth 2
```

### CLI — Custom URL Scan

Scan up to 10 specific URLs (no crawling):

```bash
node src/index.js scan-urls --urls "https://example.com,https://example.com/about,https://example.com/contact"
```

Same options as `scan` except `--depth` and `--max-pages`.

## Image Analysis

When a llama-server with a vision model is available, the scanner captures screenshots of each `<img>` element and sends them to the VLM for analysis. The model returns:

- Image description
- Whether the image contains text and what it says
- Whether the image is decorative
- Content type (photo, illustration, icon, chart, logo, etc.)

This powers checks for WCAG 1.1.1 (Non-text Content) and 1.4.5 (Images of Text).

If the llama-server is not reachable, the scanner falls back to basic media element checks and prints a warning.

## Project Structure

```
src/
  index.js            CLI entry point (commander)
  scanEngine.js       Core scan orchestration (used by CLI and dashboard)
  crawler.js          BFS website crawler
  scanner.js          axe-core WCAG scanning
  customChecks.js     Puppeteer-based custom WCAG checks
  imageAnalyzer.js    VLM-based image analysis
  llamaClient.js      llama-server HTTP client
  reporter.js         HTML/PDF report generation
  wcagCriteria.js     WCAG 2.2 criteria definitions (Norwegian requirements)
  scanHistory.js      JSON-based scan history persistence
  utils.js            URL normalization utilities
  dashboard/
    server.js         HTTP server with REST API
    static/
      index.html      Dashboard SPA
      style.css       Dark theme styles
      app.js          Client-side logic
```

## License

MIT
