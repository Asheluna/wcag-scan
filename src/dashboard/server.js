/**
 * Dashboard HTTP Server — API routes + static file serving.
 * No external dependencies — uses Node.js built-in http module.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { executeScan } from '../scanEngine.js';
import { loadHistory, addScan, updateScan, getScan, deleteScan, cleanStaleScans } from '../scanHistory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.join(__dirname, 'static');
const REPORTS_DIR = path.resolve(__dirname, '..', '..', 'reports');

/** Track the currently running scan (max 1 concurrent). */
let activeScanId = null;

const MIME_TYPES = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
};

/**
 * Start the dashboard server.
 * @param {object} opts
 * @param {number} opts.port
 */
export async function startDashboard({ port = 3000 } = {}) {
    // Clean up any scans left running from a previous crash
    cleanStaleScans();

    const server = http.createServer(async (req, res) => {
        try {
            await handleRequest(req, res);
        } catch (err) {
            console.error('Server error:', err);
            sendJson(res, 500, { error: 'Internal server error' });
        }
    });

    server.listen(port, () => {
        console.log('');
        console.log(`  WCAG Scanner Dashboard running at http://localhost:${port}`);
        console.log('  Press Ctrl+C to stop.');
        console.log('');
    });
}

async function handleRequest(req, res) {
    const { method } = req;
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // ── API Routes ────────────────────────────────────────────────

    if (pathname === '/api/scans' && method === 'GET') {
        return sendJson(res, 200, loadHistory());
    }

    if (pathname.startsWith('/api/scans/') && method === 'GET') {
        const id = pathname.split('/')[3];
        const scan = getScan(id);
        if (!scan) return sendJson(res, 404, { error: 'Scan not found' });
        return sendJson(res, 200, scan);
    }

    if (pathname === '/api/scans' && method === 'POST') {
        return await handleStartScan(req, res);
    }

    if (pathname.startsWith('/api/scans/') && method === 'DELETE') {
        const id = pathname.split('/')[3];
        if (activeScanId === id) {
            return sendJson(res, 409, { error: 'Cannot delete a running scan' });
        }
        const deleted = deleteScan(id);
        if (!deleted) return sendJson(res, 404, { error: 'Scan not found' });
        return sendJson(res, 200, { ok: true });
    }

    if (pathname === '/api/reports' && method === 'GET') {
        return handleListReports(res);
    }

    // ── Report Files ──────────────────────────────────────────────

    if (pathname.startsWith('/reports/')) {
        const fileName = path.basename(pathname);
        const filePath = path.join(REPORTS_DIR, fileName);
        return serveFile(res, filePath);
    }

    // ── Static Files / Dashboard ──────────────────────────────────

    if (pathname === '/' || pathname === '/index.html') {
        return serveFile(res, path.join(STATIC_DIR, 'index.html'));
    }

    if (pathname.startsWith('/static/')) {
        const filePath = path.join(STATIC_DIR, pathname.replace('/static/', ''));
        return serveFile(res, filePath);
    }

    sendJson(res, 404, { error: 'Not found' });
}

// ── Scan Management ───────────────────────────────────────────────────────

async function handleStartScan(req, res) {
    if (activeScanId) {
        return sendJson(res, 409, { error: 'A scan is already running', scanId: activeScanId });
    }

    const body = await readBody(req);
    let config;
    try {
        config = JSON.parse(body);
    } catch {
        return sendJson(res, 400, { error: 'Invalid JSON body' });
    }

    if (!config.url) {
        return sendJson(res, 400, { error: 'Missing required field: url' });
    }

    // Build scan config
    const scanConfig = {
        mode: config.mode || 'full',
        urls: config.mode === 'custom' && config.urls
            ? config.urls.split(',').map(u => u.trim()).filter(Boolean)
            : [config.url],
        depth: config.depth ?? 3,
        maxPages: config.maxPages ?? 25,
        level: config.level || 'AA',
        output: `reports/wcag-report-${Date.now()}.html`,
        format: 'html',
        skipImages: config.skipImages ?? false,
        llamaUrl: config.llamaUrl || 'http://192.168.50.107:8080',
        model: config.model || 'qwen3vl-8b-instruct',
    };

    // Create history entry
    const entry = addScan({
        url: config.url,
        mode: scanConfig.mode,
        config: scanConfig,
    });

    activeScanId = entry.id;
    sendJson(res, 201, entry);

    // Run scan in background (don't await — response already sent)
    runScanInBackground(entry.id, scanConfig);
}

async function runScanInBackground(scanId, config) {
    try {
        const result = await executeScan(config, {
            onPhase: (phase, message) => {
                updateScan(scanId, {
                    progress: { phase, current: 0, total: 0, message },
                });
            },
            onProgress: (phase, current, total, detail) => {
                updateScan(scanId, {
                    progress: { phase, current, total, message: detail },
                });
            },
        });

        if (result.success) {
            updateScan(scanId, {
                status: 'done',
                summary: result.summary,
                reportPath: result.outputPath,
                completedAt: new Date().toISOString(),
            });
        } else {
            updateScan(scanId, {
                status: 'failed',
                error: result.error,
                completedAt: new Date().toISOString(),
            });
        }
    } catch (err) {
        updateScan(scanId, {
            status: 'failed',
            error: err.message,
            completedAt: new Date().toISOString(),
        });
    } finally {
        activeScanId = null;
    }
}

// ── Reports ───────────────────────────────────────────────────────────────

function handleListReports(res) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    try {
        const files = fs.readdirSync(REPORTS_DIR)
            .filter(f => f.endsWith('.html') || f.endsWith('.pdf'))
            .map(f => {
                const stat = fs.statSync(path.join(REPORTS_DIR, f));
                return {
                    name: f,
                    size: stat.size,
                    modified: stat.mtime.toISOString(),
                };
            })
            .sort((a, b) => new Date(b.modified) - new Date(a.modified));
        sendJson(res, 200, files);
    } catch {
        sendJson(res, 200, []);
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function sendJson(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
}

function serveFile(res, filePath) {
    const ext = path.extname(filePath);
    const mime = MIME_TYPES[ext] || 'application/octet-stream';

    try {
        if (!fs.existsSync(filePath)) {
            sendJson(res, 404, { error: 'File not found' });
            return;
        }
        const content = fs.readFileSync(filePath);
        res.writeHead(200, {
            'Content-Type': mime,
            'Content-Length': content.length,
        });
        res.end(content);
    } catch {
        sendJson(res, 500, { error: 'Failed to read file' });
    }
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => data += chunk);
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}
