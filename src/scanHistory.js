/**
 * Scan History — JSON file-based persistence for scan records.
 * Stores data in data/scan-history.json.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'scan-history.json');

function ensureDataDir() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Load all scan history entries.
 * @returns {Array} Scan entries, newest first.
 */
export function loadHistory() {
    ensureDataDir();
    if (!fs.existsSync(HISTORY_FILE)) return [];
    try {
        const raw = fs.readFileSync(HISTORY_FILE, 'utf-8');
        return JSON.parse(raw);
    } catch {
        return [];
    }
}

/**
 * Save the full history array to disk.
 */
function saveHistory(entries) {
    ensureDataDir();
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(entries, null, 2), 'utf-8');
}

/**
 * Add a new scan entry. Returns the entry with generated id/timestamp.
 * @param {object} entry - Scan config and initial data.
 * @returns {object} The saved entry.
 */
export function addScan(entry) {
    const history = loadHistory();
    const record = {
        id: generateId(),
        timestamp: new Date().toISOString(),
        url: entry.url,
        mode: entry.mode,
        config: entry.config || {},
        status: 'running',
        progress: { phase: 'starting', current: 0, total: 0, message: 'Starting scan...' },
        summary: null,
        reportPath: null,
        error: null,
        completedAt: null,
    };
    history.unshift(record);
    saveHistory(history);
    return record;
}

/**
 * Update a scan entry by id.
 * @param {string} id
 * @param {object} patch - Fields to merge into the entry.
 * @returns {object|null} Updated entry or null if not found.
 */
export function updateScan(id, patch) {
    const history = loadHistory();
    const idx = history.findIndex(e => e.id === id);
    if (idx === -1) return null;
    Object.assign(history[idx], patch);
    saveHistory(history);
    return history[idx];
}

/**
 * Get a single scan entry by id.
 * @param {string} id
 * @returns {object|null}
 */
export function getScan(id) {
    return loadHistory().find(e => e.id === id) || null;
}

/**
 * Delete a scan entry by id.
 * @param {string} id
 * @returns {boolean} Whether the entry was found and deleted.
 */
export function deleteScan(id) {
    const history = loadHistory();
    const idx = history.findIndex(e => e.id === id);
    if (idx === -1) return false;
    history.splice(idx, 1);
    saveHistory(history);
    return true;
}

/**
 * Mark any stale "running" entries as "failed".
 * Call on server startup to clean up interrupted scans.
 */
export function cleanStaleScans() {
    const history = loadHistory();
    let changed = false;
    for (const entry of history) {
        if (entry.status === 'running') {
            entry.status = 'failed';
            entry.error = 'Scan interrupted (server restarted)';
            entry.completedAt = new Date().toISOString();
            changed = true;
        }
    }
    if (changed) saveHistory(history);
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
