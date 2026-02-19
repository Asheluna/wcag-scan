/**
 * WCAG Scanner Dashboard — client-side application.
 */

// ── Tab Navigation ────────────────────────────────────────────────────────

const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        tabs.forEach(t => t.classList.toggle('active', t === tab));
        tabContents.forEach(tc => tc.classList.toggle('active', tc.id === `tab-${target}`));

        if (target === 'history') loadHistory();
        if (target === 'reports') loadReports();
    });
});

// ── Scan Form ─────────────────────────────────────────────────────────────

const scanForm = document.getElementById('scan-form');
const modeSelect = document.getElementById('mode');
const crawlOptions = document.getElementById('crawl-options');
const startBtn = document.getElementById('start-btn');

modeSelect.addEventListener('change', () => {
    crawlOptions.style.display = modeSelect.value === 'custom' ? 'none' : '';
});

scanForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    startBtn.disabled = true;
    startBtn.textContent = 'Starting...';

    const formData = new FormData(scanForm);
    const body = {
        url: formData.get('url'),
        mode: formData.get('mode'),
        level: formData.get('level'),
        depth: parseInt(formData.get('depth')) || 3,
        maxPages: parseInt(formData.get('maxPages')) || 25,
        skipImages: formData.get('skipImages') === 'on',
        llamaUrl: formData.get('llamaUrl'),
        model: formData.get('model'),
    };

    try {
        const res = await fetch('/api/scans', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        const data = await res.json();

        if (!res.ok) {
            alert(data.error || 'Failed to start scan');
            return;
        }

        // Switch to history tab
        tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === 'history'));
        tabContents.forEach(tc => tc.classList.toggle('active', tc.id === 'tab-history'));
        loadHistory();
        startPolling();
    } catch (err) {
        alert('Network error: ' + err.message);
    } finally {
        startBtn.disabled = false;
        startBtn.textContent = 'Start Scan';
    }
});

// ── History ───────────────────────────────────────────────────────────────

let pollTimer = null;

document.getElementById('refresh-history').addEventListener('click', loadHistory);

async function loadHistory() {
    const container = document.getElementById('history-list');
    try {
        const res = await fetch('/api/scans');
        const scans = await res.json();

        if (scans.length === 0) {
            container.innerHTML = '<p class="empty-state">No scans yet. Start a new scan to see results here.</p>';
            stopPolling();
            return;
        }

        const hasRunning = scans.some(s => s.status === 'running');

        container.innerHTML = scans.map(scan => renderHistoryItem(scan)).join('');

        // Attach delete handlers
        container.querySelectorAll('[data-delete]').forEach(btn => {
            btn.addEventListener('click', async () => {
                if (!confirm('Delete this scan from history?')) return;
                await fetch(`/api/scans/${btn.dataset.delete}`, { method: 'DELETE' });
                loadHistory();
            });
        });

        if (hasRunning) {
            startPolling();
        } else {
            stopPolling();
        }
    } catch {
        container.innerHTML = '<p class="empty-state">Failed to load history.</p>';
    }
}

function renderHistoryItem(scan) {
    const date = new Date(scan.timestamp);
    const timeStr = date.toLocaleString();

    let duration = '';
    if (scan.completedAt) {
        const ms = new Date(scan.completedAt) - date;
        const sec = Math.round(ms / 1000);
        duration = sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${sec % 60}s`;
    }

    let summaryHtml = '';
    if (scan.summary?.criteria) {
        const s = scan.summary;
        const c = s.criteria;
        summaryHtml = `
            <div class="history-summary">
                <span>${s.pagesScanned} page${s.pagesScanned !== 1 ? 's' : ''}</span>
                <span class="passes">${c.passed}/${c.total} criteria passed</span>
                ${c.failed > 0 ? `<span class="violations">${c.failed} failed</span>` : ''}
                <span class="score">${c.score}%</span>
            </div>
        `;
    }

    let progressHtml = '';
    if (scan.status === 'running' && scan.progress) {
        const p = scan.progress;
        const progressText = p.total > 0
            ? `${p.phase}: ${p.current}/${p.total}`
            : p.message || p.phase;
        progressHtml = `<div class="history-progress">${escapeHtml(progressText)}</div>`;
    }

    let errorHtml = '';
    if (scan.status === 'failed' && scan.error) {
        errorHtml = `<div class="history-progress" style="color: var(--danger)">${escapeHtml(scan.error)}</div>`;
    }

    const reportBtn = scan.reportPath
        ? `<a href="/reports/${encodeURIComponent(scan.reportPath.split('/').pop())}" target="_blank" class="btn btn-small">View Report</a>`
        : '';

    const deleteBtn = scan.status !== 'running'
        ? `<button class="btn btn-small btn-danger" data-delete="${scan.id}">Delete</button>`
        : '';

    return `
        <div class="history-item">
            <span class="status-badge ${scan.status}">${scan.status}</span>
            <div class="history-info">
                <div class="history-url">${escapeHtml(scan.url)}</div>
                <div class="history-meta">
                    <span>${timeStr}</span>
                    ${duration ? `<span>${duration}</span>` : ''}
                    <span>Level ${scan.config?.level || 'AA'}</span>
                </div>
                ${summaryHtml}
                ${progressHtml}
                ${errorHtml}
            </div>
            <div class="history-actions">
                ${reportBtn}
                ${deleteBtn}
            </div>
        </div>
    `;
}

function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(loadHistory, 2500);
}

function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

// ── Reports ───────────────────────────────────────────────────────────────

document.getElementById('refresh-reports').addEventListener('click', loadReports);

async function loadReports() {
    const container = document.getElementById('reports-list');
    try {
        const res = await fetch('/api/reports');
        const reports = await res.json();

        if (reports.length === 0) {
            container.innerHTML = '<p class="empty-state">No reports found. Run a scan to generate reports.</p>';
            return;
        }

        container.innerHTML = reports.map(report => {
            const date = new Date(report.modified).toLocaleString();
            const size = formatFileSize(report.size);
            return `
                <div class="report-item">
                    <div class="report-info">
                        <div class="report-name">${escapeHtml(report.name)}</div>
                        <div class="report-meta">
                            <span>${date}</span>
                            <span>${size}</span>
                        </div>
                    </div>
                    <div class="report-actions">
                        <a href="/reports/${encodeURIComponent(report.name)}" target="_blank">Open</a>
                    </div>
                </div>
            `;
        }).join('');
    } catch {
        container.innerHTML = '<p class="empty-state">Failed to load reports.</p>';
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── Initial Load ──────────────────────────────────────────────────────────

loadHistory();
