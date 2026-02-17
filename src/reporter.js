/**
 * Report generator — HTML and PDF output for WCAG scan results.
 */

import { readFileSync } from 'fs';
import { writeFile } from 'fs/promises';
import path from 'path';
import { getSeverityColor, getSeverityWeight, formatTimestamp, truncate, calculateScore } from './utils.js';
import { WCAG_PRINCIPLES, parseWcagTag, buildCriteriaLookup } from './wcagCriteria.js';

// Criteria that require manual human review — no automated test is reliable enough
const MANUAL_ONLY_CRITERIA = new Set(['1.3.3', '2.3.1', '3.2.1', '3.2.2']);

// Guidance for manual-review criteria
const MANUAL_REVIEW_GUIDANCE = {
    '1.3.3': {
        description: 'Instructions provided for understanding and operating content do not rely solely on sensory characteristics such as shape, color, size, visual location, orientation, or sound.',
        tips: [
            'Check that instructions don\'t use only visual references like "click the round button" or "see the text in red"',
            'Verify that references to content include more than just color, e.g. "the required fields (marked with *)" instead of "the red fields"',
            'Ensure audio or visual cues are supplemented with text-based alternatives',
            'Look for directional references ("in the left sidebar") that may not apply to all screen sizes or assistive technologies',
        ],
    },
    '2.3.1': {
        description: 'Web pages do not contain anything that flashes more than three times in any one second period, or the flash is below the general flash and red flash thresholds.',
        tips: [
            'Check for animations, auto-playing videos, or GIFs that contain rapid flashing',
            'Look for blinking or strobing UI elements such as notifications, loading indicators, or banners',
            'Verify that any video content does not contain sequences with more than 3 flashes per second',
            'Test animated transitions to ensure they don\'t produce flashing effects',
        ],
    },
    '3.2.1': {
        description: 'When any user interface component receives focus, it does not initiate a change of context (e.g. navigating to a new page, moving focus elsewhere, or significantly altering page content).',
        tips: [
            'Tab through all interactive elements and verify no unexpected navigation or form submission occurs on focus',
            'Check that focus doesn\'t trigger a new window, tab, or popup opening',
            'Verify that moving focus to a form field doesn\'t change other fields or content unexpectedly',
            'Test custom components (modals, menus) to ensure focus behavior is predictable',
        ],
    },
    '3.2.2': {
        description: 'Changing the setting of any user interface component does not automatically cause a change of context unless the user has been advised beforehand.',
        tips: [
            'Test all form controls (checkboxes, radio buttons, selects) — changing them should not submit the form or navigate away',
            'Verify that selecting an option in a dropdown doesn\'t cause automatic page navigation without a submit button',
            'Check that toggling a setting doesn\'t unexpectedly reload the page or alter unrelated content',
            'If a context change does occur on input, check that the user was informed in advance (e.g. instructions before the control)',
        ],
    },
};

/**
 * Aggregate scan results, image findings, and custom check findings into the WCAG 2.2 hierarchy.
 */
function aggregateByWcag(scanResults, imageResults, customResults) {
    const lookup = buildCriteriaLookup();

    // Initialize per-criterion result buckets
    const criteriaResults = {};
    for (const key of Object.keys(lookup)) {
        criteriaResults[key] = {
            violations: new Map(),
            passes: new Map(),
            incomplete: new Map(),
            inapplicable: new Map(),
            imageFindings: [],
            customFindings: [],
        };
    }

    const bestPracticeViolations = new Map();
    const bestPracticePasses = new Map();

    // Map axe-core results to WCAG criteria
    // Track 'inapplicable' separately — no relevant content means criterion is not applicable, not passed
    for (const pageResult of scanResults) {
        for (const category of ['violations', 'passes', 'incomplete', 'inapplicable']) {
            for (const rule of pageResult[category] || []) {
                const wcagTags = rule.tags?.filter(t => /^wcag\d{3,}$/.test(t)) || [];
                const criterionIds = wcagTags.map(parseWcagTag).filter(Boolean);

                if (criterionIds.length === 0) {
                    // Best-practice-only rule
                    const targetMap = category === 'violations' ? bestPracticeViolations : bestPracticePasses;
                    if (!targetMap.has(rule.id)) {
                        targetMap.set(rule.id, { ...rule, pageCount: 1, pages: [pageResult.url] });
                    } else {
                        const existing = targetMap.get(rule.id);
                        existing.pageCount++;
                        existing.pages.push(pageResult.url);
                    }
                } else {
                    for (const criterionId of criterionIds) {
                        if (!criteriaResults[criterionId]) continue;
                        const map = criteriaResults[criterionId][category];
                        if (!map.has(rule.id)) {
                            map.set(rule.id, { ...rule, pageCount: 1, pages: [pageResult.url] });
                        } else {
                            const existing = map.get(rule.id);
                            existing.pageCount++;
                            existing.pages.push(pageResult.url);
                        }
                    }
                }
            }
        }
    }

    // Slot image findings under their WCAG criteria
    if (imageResults) {
        for (const pageResult of imageResults) {
            for (const finding of pageResult.findings || []) {
                const criterionId = finding.wcagCriteria;
                if (criteriaResults[criterionId]) {
                    criteriaResults[criterionId].imageFindings.push({
                        ...finding,
                        pageUrl: pageResult.url,
                    });
                }
            }
        }
    }

    // Slot custom check findings under their WCAG criteria
    if (customResults) {
        const { perPage, crossPage } = customResults;
        // Per-page findings
        for (const pageResult of perPage || []) {
            for (const finding of pageResult.findings || []) {
                const criterionId = finding.criterionId;
                if (criteriaResults[criterionId]) {
                    criteriaResults[criterionId].customFindings.push({
                        ...finding,
                        pageUrl: pageResult.url,
                    });
                }
            }
        }
        // Cross-page findings (not page-specific)
        for (const finding of crossPage || []) {
            const criterionId = finding.criterionId;
            if (criteriaResults[criterionId]) {
                criteriaResults[criterionId].customFindings.push(finding);
            }
        }
    }

    // Build hierarchical output — include ALL required criteria, even without results
    const structuredPrinciples = WCAG_PRINCIPLES.map(principle => {
        const guidelines = principle.guidelines.map(guideline => {
            const criteria = guideline.criteria.filter(c => c.required !== false).map(criterion => {
                const data = criteriaResults[criterion.id];
                const violationList = Array.from(data.violations.values());
                const passList = Array.from(data.passes.values());
                const incompleteList = Array.from(data.incomplete.values());
                const inapplicableList = Array.from(data.inapplicable.values());
                const imgFindings = data.imageFindings;
                const customFindings = data.customFindings;

                // Separate "not-applicable" custom findings from actual test results
                const hasNotApplicable = inapplicableList.length > 0
                    || customFindings.some(f => f.status === 'not-applicable');
                const activeCustomFindings = customFindings.filter(f => f.status !== 'not-applicable');

                const hasResults = violationList.length > 0
                    || passList.length > 0
                    || incompleteList.length > 0
                    || imgFindings.length > 0
                    || activeCustomFindings.length > 0;

                const hasViolations = violationList.length > 0
                    || imgFindings.some(f => f.status === 'violation')
                    || activeCustomFindings.some(f => f.status === 'violation');
                const hasWarnings = activeCustomFindings.some(f => f.status === 'warning');
                const hasPasses = passList.length > 0
                    || imgFindings.some(f => f.status === 'pass')
                    || activeCustomFindings.some(f => f.status === 'pass');

                let status;
                if (!hasResults && !hasNotApplicable && MANUAL_ONLY_CRITERIA.has(criterion.id)) {
                    status = 'manual-review';
                } else if (!hasResults && !hasNotApplicable) {
                    status = 'not-tested';
                } else if (!hasResults && hasNotApplicable) {
                    status = 'not-applicable';
                } else if (hasViolations) {
                    status = 'fail';
                } else if (hasWarnings) {
                    status = 'needs-review';
                } else if (hasPasses) {
                    status = 'pass';
                } else {
                    status = 'needs-review';
                }

                return {
                    ...criterion,
                    status,
                    violations: violationList,
                    passes: passList,
                    incomplete: incompleteList,
                    inapplicable: inapplicableList,
                    imageFindings: imgFindings,
                    customFindings,
                };
            });

            return { ...guideline, criteria };
        });

        return { ...principle, guidelines };
    });

    return {
        principles: structuredPrinciples,
        bestPractices: {
            violations: Array.from(bestPracticeViolations.values())
                .sort((a, b) => getSeverityWeight(b.impact) - getSeverityWeight(a.impact)),
            passes: Array.from(bestPracticePasses.values()),
        },
    };
}

/**
 * Generate the WCAG-structured HTML section.
 */
function generateWcagSection(wcagData) {
    // Count criteria by status
    let totalCriteria = 0, passCount = 0, failCount = 0, reviewCount = 0, manualCount = 0, notTestedCount = 0, notApplicableCount = 0;
    for (const p of wcagData.principles) {
        for (const g of p.guidelines) {
            for (const c of g.criteria) {
                totalCriteria++;
                if (c.status === 'pass') passCount++;
                else if (c.status === 'fail') failCount++;
                else if (c.status === 'needs-review') reviewCount++;
                else if (c.status === 'manual-review') manualCount++;
                else if (c.status === 'not-applicable') notApplicableCount++;
                else notTestedCount++;
            }
        }
    }

    let html = `
    <section class="section wcag-structure">
      <h2>WCAG 2.2 Compliance Overview</h2>
      <p class="section-desc">
        ${totalCriteria} required criteria (Norwegian regulations) ·
        <span style="color:var(--success)">${passCount} passed</span> ·
        <span style="color:var(--danger)">${failCount} failed</span> ·
        <span style="color:var(--warning)">${reviewCount} needs review</span>
        ${notApplicableCount > 0 ? `· <span style="color:var(--text-muted)">${notApplicableCount} not applicable</span>` : ''}
        ${manualCount > 0 ? `· <span style="color:var(--info)">${manualCount} manual review</span>` : ''}
        ${notTestedCount > 0 ? `· <span style="color:var(--text-muted)">${notTestedCount} not tested</span>` : ''}
      </p>
    `;

    for (const principle of wcagData.principles) {
        html += `
      <div class="principle-block">
        <h3 class="principle-heading">
          <span class="principle-number">Principle ${principle.id}</span>
          ${escapeHtml(principle.name)}
        </h3>`;

        for (const guideline of principle.guidelines) {
            html += `
        <div class="guideline-block">
          <h4 class="guideline-heading">
            <span class="guideline-number">${guideline.id}</span>
            ${escapeHtml(guideline.name)}
          </h4>`;

            for (const criterion of guideline.criteria) {
                const statusIcons = { fail: '✗', pass: '✓', 'needs-review': '?', 'not-tested': '—', 'manual-review': '✎', 'not-applicable': '∅' };
                const statusIcon = statusIcons[criterion.status] || '—';
                const violationCount = criterion.violations.length
                    + criterion.imageFindings.filter(f => f.status === 'violation').length
                    + (criterion.customFindings || []).filter(f => f.status === 'violation').length;
                const warningCount = (criterion.customFindings || []).filter(f => f.status === 'warning').length;
                const passCount = criterion.passes.length;
                const isStatic = criterion.status === 'not-tested';
                const isCollapsible = !isStatic; // manual-review and not-applicable are now collapsible
                const guidance = MANUAL_REVIEW_GUIDANCE[criterion.id];

                // Not-applicable messages from custom checks
                const notApplicableFindings = (criterion.customFindings || []).filter(f => f.status === 'not-applicable');

                const statusLabels = {
                    'not-tested': 'Not tested',
                    'manual-review': 'Manual review',
                    'not-applicable': 'Not applicable',
                };

                html += `
          <div class="${isCollapsible ? 'collapsible ' : ''}criterion-card ${criterion.status}">
            <${isStatic ? 'div' : 'button'} class="${isStatic ? 'not-tested-row' : 'collapsible-toggle'}"${isStatic ? '' : ' onclick="this.parentElement.classList.toggle(\'open\')"'}>
              ${isStatic ? '' : '<span class="toggle-icon">▶</span>'}
              <span class="criterion-status-icon ${criterion.status}">${statusIcon}</span>
              <span class="criterion-id">${criterion.id}</span>
              <span class="criterion-name">${escapeHtml(criterion.name)}</span>
              <span class="criterion-level level-${criterion.level.toLowerCase()}">${criterion.level}</span>
              <span class="finding-counts">
                ${isStatic ? `<span class="count-badge not-tested">Not tested</span>` : ''}
                ${!isStatic && statusLabels[criterion.status] ? `<span class="count-badge ${criterion.status}">${statusLabels[criterion.status]}</span>` : ''}
                ${violationCount > 0 ? `<span class="count-badge violation">${violationCount} violation${violationCount > 1 ? 's' : ''}</span>` : ''}
                ${warningCount > 0 ? `<span class="count-badge warning">${warningCount} warning${warningCount > 1 ? 's' : ''}</span>` : ''}
                ${passCount > 0 ? `<span class="count-badge pass">${passCount} pass${passCount > 1 ? 'es' : ''}</span>` : ''}
                ${criterion.incomplete.length > 0 ? `<span class="count-badge warning">${criterion.incomplete.length} review</span>` : ''}
              </span>
            </${isStatic ? 'div' : 'button'}>`;

                if (isCollapsible) {
                    html += `
            <div class="collapsible-content">`;

                    // Manual review guidance
                    if (criterion.status === 'manual-review' && guidance) {
                        html += `
              <div class="manual-guidance">
                <p class="guidance-description">${escapeHtml(guidance.description)}</p>
                <h5 class="guidance-heading">What to check:</h5>
                <ul class="guidance-tips">
                  ${guidance.tips.map(tip => `<li>${escapeHtml(tip)}</li>`).join('')}
                </ul>
              </div>`;
                    }

                    // Not-applicable: show criterion description + context
                    if (criterion.status === 'not-applicable') {
                        const naMessages = notApplicableFindings.length > 0
                            ? [...new Set(notApplicableFindings.map(f => f.message))]
                            : ['No relevant content found on the scanned pages for this criterion.'];
                        html += `
              <div class="not-applicable-context">
                ${criterion.description ? `
                <h5 class="na-wcag-heading">WCAG ${criterion.id} requirement:</h5>
                <p class="na-criterion-description">${escapeHtml(criterion.description)}</p>` : ''}
                ${naMessages.map(msg => `<p class="na-message">${escapeHtml(msg)}</p>`).join('')}
              </div>`;
                    }

                // Violations
                if (criterion.violations.length > 0) {
                    html += `<h5 class="criterion-subheading violations-subheading">Violations</h5>`;
                    for (const v of criterion.violations) {
                        html += `
              <div class="detail-card violation">
                <div class="detail-header">
                  <span class="severity-badge ${v.impact}">${v.impact}</span>
                  <strong>${escapeHtml(v.id)}</strong>
                  <span class="page-count">${v.pageCount} page${v.pageCount > 1 ? 's' : ''}</span>
                </div>
                <p>${escapeHtml(v.description)}</p>
                ${v.helpUrl ? `<a href="${v.helpUrl}" target="_blank" class="help-link">Learn more ↗</a>` : ''}
              </div>`;
                    }
                }

                // Image/media findings
                const imgIssues = criterion.imageFindings.filter(f => f.status !== 'pass');
                if (imgIssues.length > 0) {
                    html += `<h5 class="criterion-subheading media-subheading">Media Analysis Findings</h5>`;
                    for (const f of imgIssues) {
                        html += `
              <div class="finding-item ${f.status}">
                <div class="finding-header">
                  <span class="severity-badge ${f.status}">${f.status}</span>
                  <span class="finding-type">${f.type}</span>
                </div>
                <p class="finding-message">${escapeHtml(f.message)}</p>
                ${f.detectedText ? `<div class="code-snippet"><strong>Detected text:</strong> "${escapeHtml(truncate(f.detectedText, 200))}" <span class="confidence">(${f.confidence}% confidence)</span></div>` : ''}
                ${f.src ? `<div class="code-snippet"><strong>Source:</strong> ${escapeHtml(truncate(f.src, 100))}</div>` : ''}
                <div class="code-snippet"><strong>Page:</strong> ${escapeHtml(f.pageUrl)}</div>
                ${f.screenshot ? `<div class="finding-screenshot">
                  <img src="${f.screenshot}" alt="Screenshot of the ${escapeHtml(f.type)} element" loading="lazy" />
                </div>` : ''}
              </div>`;
                    }
                }

                // Incomplete / needs review
                if (criterion.incomplete.length > 0) {
                    html += `<h5 class="criterion-subheading review-subheading">Needs Review</h5>`;
                    for (const inc of criterion.incomplete) {
                        html += `
              <div class="detail-card incomplete">
                <div class="detail-header">
                  <span class="severity-badge warning">${inc.impact || 'review'}</span>
                  <strong>${escapeHtml(inc.id)}</strong>
                </div>
                <p>${escapeHtml(inc.description)}</p>
              </div>`;
                    }
                }

                // Custom check findings
                const customViolations = (criterion.customFindings || []).filter(f => f.status === 'violation');
                const customWarnings = (criterion.customFindings || []).filter(f => f.status === 'warning');
                const customPasses = (criterion.customFindings || []).filter(f => f.status === 'pass');

                if (customViolations.length > 0) {
                    html += `<h5 class="criterion-subheading violations-subheading">Custom Check Violations</h5>`;
                    for (const f of customViolations) {
                        html += `
              <div class="detail-card violation">
                <div class="detail-header">
                  <span class="severity-badge ${f.impact || 'serious'}">${f.impact || 'serious'}</span>
                  <strong>Custom check</strong>
                  ${f.pageUrl ? `<span class="page-count">${escapeHtml(truncate(f.pageUrl, 60))}</span>` : ''}
                </div>
                <p>${escapeHtml(f.message)}</p>
                ${f.element ? `<div class="code-snippet">${escapeHtml(truncate(f.element, 150))}</div>` : ''}
                ${f.screenshot ? `<div class="finding-screenshot">
                  <img src="${f.screenshot}" alt="${escapeHtml(f.screenshotCaption || 'Screenshot of the affected element')}" loading="lazy" />
                  ${f.screenshotCaption ? `<span class="screenshot-caption">${escapeHtml(f.screenshotCaption)}</span>` : ''}
                </div>` : ''}
              </div>`;
                    }
                }

                if (customWarnings.length > 0) {
                    html += `<h5 class="criterion-subheading review-subheading">Custom Check Warnings</h5>`;
                    for (const f of customWarnings) {
                        html += `
              <div class="detail-card incomplete">
                <div class="detail-header">
                  <span class="severity-badge warning">${f.impact || 'moderate'}</span>
                  <strong>Custom check</strong>
                  ${f.pageUrl ? `<span class="page-count">${escapeHtml(truncate(f.pageUrl, 60))}</span>` : ''}
                </div>
                <p>${escapeHtml(f.message)}</p>
                ${f.element ? `<div class="code-snippet">${escapeHtml(truncate(f.element, 150))}</div>` : ''}
                ${f.screenshot ? `<div class="finding-screenshot">
                  <img src="${f.screenshot}" alt="${escapeHtml(f.screenshotCaption || 'Screenshot of the affected element')}" loading="lazy" />
                  ${f.screenshotCaption ? `<span class="screenshot-caption">${escapeHtml(f.screenshotCaption)}</span>` : ''}
                </div>` : ''}
              </div>`;
                    }
                }

                if (customPasses.length > 0 && criterion.passes.length === 0) {
                    // Show custom pass info only if no axe-core passes (avoid duplication)
                    html += `
            <details class="passes-section">
              <summary><h5 style="display:inline" class="criterion-subheading">${customPasses.length} Passed Custom Check${customPasses.length > 1 ? 's' : ''}</h5></summary>
              <div class="passes-list">
                ${customPasses.map(f => `
                <div class="pass-item">
                  <span class="check">✓</span>
                  <span>${escapeHtml(f.message)}</span>
                </div>`).join('')}
              </div>
            </details>`;
                }

                // Passes (collapsed)
                if (criterion.passes.length > 0) {
                    html += `
            <details class="passes-section">
              <summary><h5 style="display:inline" class="criterion-subheading">${criterion.passes.length} Passed Rule${criterion.passes.length > 1 ? 's' : ''}</h5></summary>
              <div class="passes-list">
                ${criterion.passes.map(p => `
                <div class="pass-item">
                  <span class="check">✓</span>
                  <span><strong>${escapeHtml(p.id)}</strong>: ${escapeHtml(p.description)}</span>
                </div>`).join('')}
              </div>
            </details>`;
                }

                    html += `
            </div>`;
                } // end if (isCollapsible)

                html += `
          </div>`;
            }

            html += `</div>`;
        }

        html += `</div>`;
    }

    // Best Practices section
    if (wcagData.bestPractices.violations.length > 0 || wcagData.bestPractices.passes.length > 0) {
        html += `
      <div class="principle-block best-practices-block">
        <h3 class="principle-heading">
          <span class="principle-number">BP</span>
          Best Practices
        </h3>
        <div class="guideline-block">`;

        if (wcagData.bestPractices.violations.length > 0) {
            html += `<h5 class="criterion-subheading violations-subheading">Violations</h5>`;
            for (const v of wcagData.bestPractices.violations) {
                html += `
          <div class="detail-card violation">
            <div class="detail-header">
              <span class="severity-badge ${v.impact}">${v.impact}</span>
              <strong>${escapeHtml(v.id)}</strong>
              <span class="page-count">${v.pageCount} page${v.pageCount > 1 ? 's' : ''}</span>
            </div>
            <p>${escapeHtml(v.description)}</p>
          </div>`;
            }
        }

        if (wcagData.bestPractices.passes.length > 0) {
            html += `
          <details class="passes-section">
            <summary><h5 style="display:inline">${wcagData.bestPractices.passes.length} Passed Best-Practice Rules</h5></summary>
            <div class="passes-list">
              ${wcagData.bestPractices.passes.map(p => `
              <div class="pass-item">
                <span class="check">✓</span>
                <span><strong>${escapeHtml(p.id)}</strong>: ${escapeHtml(p.description)}</span>
              </div>`).join('')}
            </div>
          </details>`;
        }

        html += `</div></div>`;
    }

    html += `</section>`;
    return html;
}

/**
 * Generate an HTML report string from scan results.
 */
export function generateHtmlReport(scanResults, imageResults, customResults, options = {}) {
    const {
        targetUrl = '',
        level = 'AA',
        scanMode = 'full',
        brandName = '',
        brandLogo = '',
    } = options;

    const score = calculateScore(scanResults);
    const totalViolations = scanResults.reduce((sum, r) => sum + (r.violations?.length || 0), 0);
    const totalPasses = scanResults.reduce((sum, r) => sum + (r.passes?.length || 0), 0);
    const totalIncomplete = scanResults.reduce((sum, r) => sum + (r.incomplete?.length || 0), 0);
    const pagesWithErrors = scanResults.filter(r => r.error).length;

    // Aggregate image findings
    const imageViolations = imageResults
        ? imageResults.reduce((sum, r) => sum + (r.findings?.filter(f => f.status === 'violation').length || 0), 0)
        : 0;
    const imageWarnings = imageResults
        ? imageResults.reduce((sum, r) => sum + (r.findings?.filter(f => f.status === 'warning').length || 0), 0)
        : 0;

    // Aggregate results by WCAG structure
    const wcagData = aggregateByWcag(scanResults, imageResults, customResults);

    const timestamp = formatTimestamp(new Date());

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WCAG ${level} Compliance Report${targetUrl ? ` — ${new URL(targetUrl).hostname}` : ''}</title>
  <style>
    ${getReportCSS()}
  </style>
</head>
<body>
  <div class="report">
    ${brandName || brandLogo ? generateBrandHeader(brandName, brandLogo) : ''}

    <header class="report-header">
      <div class="header-content">
        <h1>WCAG ${level} Compliance Report</h1>
        <p class="subtitle">
          ${targetUrl ? `<a href="${targetUrl}" target="_blank">${new URL(targetUrl).hostname}</a> · ` : ''}
          ${scanMode === 'custom' ? 'Custom URL Scan' : 'Full Site Scan'} · 
          Generated ${timestamp}
        </p>
      </div>
    </header>

    <!-- Score Dashboard -->
    <section class="dashboard">
      <div class="score-card main-score">
        <div class="score-ring ${score >= 80 ? 'good' : score >= 50 ? 'moderate' : 'poor'}">
          <span class="score-value">${score}</span>
        </div>
        <div class="score-label">Compliance Score</div>
      </div>
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${scanResults.length}</div>
          <div class="stat-label">Pages Scanned</div>
        </div>
        <div class="stat-card violations">
          <div class="stat-value">${totalViolations}</div>
          <div class="stat-label">Violations</div>
        </div>
        <div class="stat-card passes">
          <div class="stat-value">${totalPasses}</div>
          <div class="stat-label">Passes</div>
        </div>
        <div class="stat-card incomplete">
          <div class="stat-value">${totalIncomplete}</div>
          <div class="stat-label">Needs Review</div>
        </div>
        ${imageResults ? `
        <div class="stat-card image-issues">
          <div class="stat-value">${imageViolations + imageWarnings}</div>
          <div class="stat-label">Media Issues</div>
        </div>` : ''}
      </div>
    </section>

    <!-- WCAG 2.2 Compliance Overview -->
    ${generateWcagSection(wcagData)}

    <!-- Per-Page Details -->
    <section class="section">
      <h2>Page-by-Page Results</h2>
      ${scanResults.map((result, idx) => `
      <div class="collapsible${idx === 0 ? ' open' : ''}">
        <button class="collapsible-toggle" onclick="this.parentElement.classList.toggle('open')">
          <span class="toggle-icon">▶</span>
          <span class="page-url">${escapeHtml(result.url)}</span>
          <span class="finding-counts">
            ${result.violations?.length > 0 ? `<span class="count-badge violation">${result.violations.length} violations</span>` : ''}
            ${result.passes?.length > 0 ? `<span class="count-badge pass">${result.passes.length} passes</span>` : ''}
            ${result.error ? `<span class="count-badge error">Error</span>` : ''}
          </span>
        </button>
        <div class="collapsible-content">
          ${result.error ? `<div class="error-note">⚠ Error scanning this page: ${escapeHtml(result.error)}</div>` : ''}

          ${(result.violations || []).length > 0 ? `
          <h4>Violations</h4>
          ${(result.violations || []).map(v => `
          <div class="detail-card violation">
            <div class="detail-header">
              <span class="severity-badge ${v.impact}">${v.impact}</span>
              <strong>${escapeHtml(v.id)}</strong>
            </div>
            <p>${escapeHtml(v.description)}</p>
            <div class="detail-meta">
              <span class="tag">${escapeHtml(v.tags?.filter(t => t.startsWith('wcag')).join(', ') || 'best-practice')}</span>
              ${v.helpUrl ? `<a href="${v.helpUrl}" target="_blank" class="help-link">Learn more ↗</a>` : ''}
            </div>
            ${v.nodes?.length > 0 ? `
            <details class="affected-elements">
              <summary>${v.nodes.length} affected element${v.nodes.length > 1 ? 's' : ''}</summary>
              ${v.nodes.slice(0, 5).map(n => `
              <div class="element-item">
                <code>${escapeHtml(truncate(n.html, 150))}</code>
                ${n.failureSummary ? `<p class="fix-suggestion">${escapeHtml(n.failureSummary)}</p>` : ''}
                ${n.target?.length > 0 ? `<p class="selector">Selector: <code>${escapeHtml(n.target.join(' > '))}</code></p>` : ''}
                ${n.screenshot ? `<div class="finding-screenshot">
                  <img src="${n.screenshot}" alt="Screenshot of affected element" loading="lazy" />
                </div>` : ''}
              </div>`).join('')}
              ${v.nodes.length > 5 ? `<p class="more-items">...and ${v.nodes.length - 5} more</p>` : ''}
            </details>` : ''}
          </div>`).join('')}` : ''}

          ${(result.passes || []).length > 0 ? `
          <details class="passes-section">
            <summary><h4 style="display:inline">✓ ${result.passes.length} Passed Rules</h4></summary>
            <div class="passes-list">
              ${(result.passes || []).map(p => `
              <div class="pass-item">
                <span class="check">✓</span>
                <span><strong>${escapeHtml(p.id)}</strong>: ${escapeHtml(p.description)}</span>
              </div>`).join('')}
            </div>
          </details>` : ''}
        </div>
      </div>`).join('')}
    </section>

    <footer class="report-footer">
      <p>Generated by <strong>WCAG Scanner</strong> · WCAG 2.2 Level ${level} · ${timestamp}</p>
      <p class="disclaimer">Automated scanning covers approximately 30-50% of WCAG criteria. Manual review is recommended for full compliance.</p>
    </footer>
  </div>

  <script>
    // Collapsible toggle functionality (already handled via onclick, this adds keyboard support)
    document.querySelectorAll('.collapsible-toggle').forEach(btn => {
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          btn.click();
        }
      });
    });
  </script>
</body>
</html>`;
}

/**
 * Write the HTML report to a file.
 */
export async function writeHtmlReport(htmlContent, outputPath) {
    await writeFile(outputPath, htmlContent, 'utf-8');
}

/**
 * Generate a branded PDF from the HTML report using Puppeteer.
 */
export async function writePdfReport(browser, htmlContent, outputPath, options = {}) {
    const { brandName = '', brandLogo = '' } = options;

    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    // Build brand logo as base64 for the header
    let logoBase64 = '';
    if (brandLogo) {
        try {
            const logoBuffer = readFileSync(brandLogo);
            const ext = path.extname(brandLogo).slice(1).toLowerCase();
            const mimeType = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
            logoBase64 = `data:${mimeType};base64,${logoBuffer.toString('base64')}`;
        } catch {
            // Logo file not found, skip
        }
    }

    const headerHtml = `
    <div style="width: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 9px; color: #666; display: flex; align-items: center; justify-content: space-between; padding: 5px 20px; border-bottom: 2px solid #6366f1;">
      <div style="display: flex; align-items: center; gap: 8px;">
        ${logoBase64 ? `<img src="${logoBase64}" style="height: 20px;" />` : ''}
        ${brandName ? `<strong style="color: #1a202c; font-size: 11px;">${brandName}</strong>` : ''}
      </div>
      <div>WCAG Compliance Report</div>
    </div>`;

    const footerHtml = `
    <div style="width: 100%; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 8px; color: #999; display: flex; justify-content: space-between; padding: 5px 20px; border-top: 1px solid #e2e8f0;">
      <span>Generated by WCAG Scanner</span>
      <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
    </div>`;

    await page.pdf({
        path: outputPath,
        format: 'A4',
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: headerHtml,
        footerTemplate: footerHtml,
        margin: { top: '80px', bottom: '60px', left: '20px', right: '20px' },
    });

    await page.close();
}


// ── Helpers ──────────────────────────────────────────────────────────────────

function generateBrandHeader(name, logoPath) {
    let logoHtml = '';
    if (logoPath) {
        try {
            const logoBuffer = readFileSync(logoPath);
            const ext = path.extname(logoPath).slice(1).toLowerCase();
            const mimeType = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
            const b64 = logoBuffer.toString('base64');
            logoHtml = `<img src="data:${mimeType};base64,${b64}" alt="${escapeHtml(name)} logo" class="brand-logo" />`;
        } catch {
            // Skip logo if file not found
        }
    }
    return `
    <div class="brand-header">
      ${logoHtml}
      ${name ? `<span class="brand-name">${escapeHtml(name)}</span>` : ''}
    </div>`;
}

function countByStatus(findings, status) {
    return findings?.filter(f => f.status === status).length || 0;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function getReportCSS() {
    return `
    :root {
      --bg: #0f1117;
      --surface: #1a1d27;
      --surface-raised: #232733;
      --border: #2d3348;
      --text: #e2e8f0;
      --text-muted: #94a3b8;
      --primary: #6366f1;
      --primary-light: #818cf8;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --danger-light: #fca5a5;
      --info: #3b82f6;
      --radius: 12px;
      --radius-sm: 8px;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
    }

    .report {
      max-width: 1100px;
      margin: 0 auto;
      padding: 32px 24px;
    }

    /* Brand Header */
    .brand-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 0;
      margin-bottom: 8px;
    }
    .brand-logo { height: 40px; }
    .brand-name {
      font-size: 18px;
      font-weight: 700;
      color: var(--text);
    }

    /* Report Header */
    .report-header {
      margin-bottom: 32px;
    }
    .report-header h1 {
      font-size: 28px;
      font-weight: 800;
      background: linear-gradient(135deg, var(--primary-light), #a78bfa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }
    .subtitle {
      color: var(--text-muted);
      margin-top: 4px;
    }
    .subtitle a {
      color: var(--primary-light);
      text-decoration: none;
    }
    .subtitle a:hover { text-decoration: underline; }

    /* Dashboard */
    .dashboard {
      display: grid;
      grid-template-columns: 180px 1fr;
      gap: 24px;
      margin-bottom: 40px;
    }
    .main-score {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: var(--surface);
      border-radius: var(--radius);
      padding: 24px;
      border: 1px solid var(--border);
    }
    .score-ring {
      width: 100px;
      height: 100px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 36px;
      font-weight: 800;
      border: 4px solid;
      margin-bottom: 8px;
    }
    .score-ring.good { border-color: var(--success); color: var(--success); }
    .score-ring.moderate { border-color: var(--warning); color: var(--warning); }
    .score-ring.poor { border-color: var(--danger); color: var(--danger); }
    .score-label { color: var(--text-muted); font-size: 13px; font-weight: 600; }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 12px;
    }
    .stat-card {
      background: var(--surface);
      border-radius: var(--radius-sm);
      padding: 20px;
      border: 1px solid var(--border);
      text-align: center;
    }
    .stat-value { font-size: 32px; font-weight: 800; }
    .stat-label { color: var(--text-muted); font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px; }
    .stat-card.violations .stat-value { color: var(--danger); }
    .stat-card.passes .stat-value { color: var(--success); }
    .stat-card.incomplete .stat-value { color: var(--warning); }
    .stat-card.image-issues .stat-value { color: var(--info); }

    /* Sections */
    .section {
      margin-bottom: 36px;
    }
    .section h2 {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 8px;
      color: var(--text);
    }
    .section-desc {
      color: var(--text-muted);
      font-size: 14px;
      margin-bottom: 16px;
    }

    /* Violation Summary */
    .violations-summary {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .violation-row {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      background: var(--surface);
      padding: 14px 16px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
    }
    .violation-info { flex: 1; }
    .violation-meta {
      margin-top: 6px;
      display: flex;
      gap: 12px;
      align-items: center;
      font-size: 12px;
      color: var(--text-muted);
    }

    /* Severity Badges */
    .severity-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      white-space: nowrap;
    }
    .severity-badge.critical { background: rgba(239,68,68,0.15); color: #fca5a5; border: 1px solid rgba(239,68,68,0.3); }
    .severity-badge.serious  { background: rgba(245,158,11,0.15); color: #fcd34d; border: 1px solid rgba(245,158,11,0.3); }
    .severity-badge.moderate { background: rgba(234,179,8,0.12); color: #fde68a; border: 1px solid rgba(234,179,8,0.25); }
    .severity-badge.minor    { background: rgba(16,185,129,0.12); color: #6ee7b7; border: 1px solid rgba(16,185,129,0.25); }
    .severity-badge.violation { background: rgba(239,68,68,0.15); color: #fca5a5; border: 1px solid rgba(239,68,68,0.3); }
    .severity-badge.warning  { background: rgba(245,158,11,0.15); color: #fcd34d; border: 1px solid rgba(245,158,11,0.3); }
    .severity-badge.pass     { background: rgba(16,185,129,0.12); color: #6ee7b7; border: 1px solid rgba(16,185,129,0.25); }

    .tag {
      background: rgba(99,102,241,0.12);
      color: var(--primary-light);
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-family: 'SF Mono', SFMono-Regular, Consolas, monospace;
    }
    .page-count { color: var(--text-muted); }

    /* Collapsible sections */
    .collapsible {
      background: var(--surface);
      border-radius: var(--radius-sm);
      border: 1px solid var(--border);
      margin-bottom: 8px;
      overflow: hidden;
    }
    .collapsible-toggle {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 16px;
      background: none;
      border: none;
      color: var(--text);
      font-size: 14px;
      cursor: pointer;
      text-align: left;
    }
    .collapsible-toggle:hover { background: var(--surface-raised); }
    .toggle-icon {
      font-size: 10px;
      transition: transform 0.2s;
      color: var(--text-muted);
    }
    .collapsible.open .toggle-icon { transform: rotate(90deg); }
    .collapsible-content {
      display: none;
      padding: 16px;
      border-top: 1px solid var(--border);
    }
    .collapsible.open .collapsible-content { display: block; }
    .page-url {
      flex: 1;
      font-family: 'SF Mono', SFMono-Regular, Consolas, monospace;
      font-size: 13px;
      word-break: break-all;
    }
    .finding-counts { display: flex; gap: 6px; }
    .count-badge {
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
      font-weight: 600;
    }
    .count-badge.violation { background: rgba(239,68,68,0.15); color: #fca5a5; }
    .count-badge.pass { background: rgba(16,185,129,0.12); color: #6ee7b7; }
    .count-badge.warning { background: rgba(245,158,11,0.12); color: #fcd34d; }
    .count-badge.error { background: rgba(239,68,68,0.15); color: #fca5a5; }
    .count-badge.not-tested { background: rgba(148,163,184,0.12); color: var(--text-muted); }
    .count-badge.manual-review { background: rgba(59,130,246,0.12); color: var(--info); }
    .count-badge.not-applicable { background: rgba(148,163,184,0.12); color: var(--text-muted); }

    /* Detail cards */
    .detail-card {
      background: var(--surface-raised);
      border-radius: var(--radius-sm);
      padding: 16px;
      margin-bottom: 10px;
      border-left: 3px solid;
    }
    .detail-card.violation { border-left-color: var(--danger); }
    .detail-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .detail-meta {
      display: flex;
      gap: 12px;
      align-items: center;
      margin-top: 10px;
    }
    .help-link {
      color: var(--primary-light);
      font-size: 12px;
      text-decoration: none;
    }
    .help-link:hover { text-decoration: underline; }

    /* Affected elements */
    .affected-elements {
      margin-top: 12px;
    }
    .affected-elements summary {
      color: var(--text-muted);
      font-size: 13px;
      cursor: pointer;
    }
    .element-item {
      background: var(--bg);
      border-radius: 6px;
      padding: 10px;
      margin-top: 8px;
    }
    .element-item code {
      display: block;
      font-size: 12px;
      color: var(--primary-light);
      font-family: 'SF Mono', SFMono-Regular, Consolas, monospace;
      word-break: break-all;
    }
    .fix-suggestion {
      margin-top: 6px;
      font-size: 12px;
      color: var(--text-muted);
      white-space: pre-line;
    }
    .selector {
      margin-top: 4px;
      font-size: 11px;
      color: var(--text-muted);
    }
    .selector code { display: inline; font-size: 11px; color: var(--info); }
    .more-items { color: var(--text-muted); font-size: 12px; margin-top: 6px; }

    /* Passes section */
    .passes-section { margin-top: 16px; }
    .passes-section summary { cursor: pointer; color: var(--success); }
    .passes-list { margin-top: 8px; }
    .pass-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      padding: 6px 0;
      font-size: 13px;
      border-bottom: 1px solid var(--border);
    }
    .pass-item:last-child { border-bottom: none; }
    .check { color: var(--success); font-weight: bold; }

    /* Finding items (image/media) */
    .finding-item {
      background: var(--surface-raised);
      border-radius: var(--radius-sm);
      padding: 14px;
      margin-bottom: 8px;
      border-left: 3px solid;
    }
    .finding-item.violation { border-left-color: var(--danger); }
    .finding-item.warning { border-left-color: var(--warning); }
    .finding-item.pass { border-left-color: var(--success); }
    .finding-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 6px;
    }
    .finding-type { 
      font-weight: 600; text-transform: uppercase; font-size: 11px; 
      color: var(--text-muted); letter-spacing: 0.05em;
    }
    .wcag-ref { font-size: 12px; color: var(--primary-light); }
    .finding-message { font-size: 13px; }
    .code-snippet {
      background: var(--bg);
      padding: 8px 10px;
      border-radius: 6px;
      margin-top: 8px;
      font-size: 12px;
      font-family: 'SF Mono', SFMono-Regular, Consolas, monospace;
    }
    .confidence { color: var(--text-muted); }

    /* Screenshot evidence */
    .finding-screenshot {
      margin: 8px 0;
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      overflow: hidden;
      max-width: 100%;
    }
    .finding-screenshot img {
      max-width: 100%;
      height: auto;
      display: block;
    }
    .screenshot-caption {
      display: block;
      padding: 4px 8px;
      font-size: 11px;
      color: var(--text-muted);
      background: var(--bg);
    }

    /* Manual review guidance */
    .manual-guidance {
      background: rgba(59,130,246,0.06);
      border: 1px solid rgba(59,130,246,0.2);
      border-radius: var(--radius-sm);
      padding: 16px;
    }
    .guidance-description {
      font-size: 14px;
      color: var(--text);
      line-height: 1.6;
      margin-bottom: 12px;
    }
    .guidance-heading {
      font-size: 12px;
      font-weight: 700;
      color: var(--info);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
    }
    .guidance-tips {
      list-style: none;
      padding: 0;
    }
    .guidance-tips li {
      position: relative;
      padding-left: 20px;
      font-size: 13px;
      color: var(--text-muted);
      margin-bottom: 6px;
      line-height: 1.5;
    }
    .guidance-tips li::before {
      content: '→';
      position: absolute;
      left: 0;
      color: var(--info);
    }

    /* Not applicable context */
    .not-applicable-context {
      padding: 8px 0;
    }
    .na-wcag-heading {
      font-size: 11px;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 4px;
    }
    .na-criterion-description {
      font-size: 14px;
      color: var(--text);
      line-height: 1.6;
      margin-bottom: 8px;
    }
    .na-message {
      font-size: 13px;
      color: var(--text-muted);
      font-style: italic;
    }

    /* Error note */
    .error-note {
      background: rgba(239,68,68,0.1);
      border: 1px solid rgba(239,68,68,0.2);
      border-radius: var(--radius-sm);
      padding: 12px;
      color: var(--danger-light);
      font-size: 14px;
      margin-bottom: 12px;
    }

    /* Footer */
    .report-footer {
      margin-top: 48px;
      padding-top: 24px;
      border-top: 1px solid var(--border);
      text-align: center;
      font-size: 13px;
      color: var(--text-muted);
    }
    .disclaimer {
      margin-top: 4px;
      font-size: 11px;
      font-style: italic;
    }

    /* WCAG Structure */
    .wcag-structure { margin-bottom: 40px; }

    .principle-block {
      margin-bottom: 24px;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
    }

    .principle-heading {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 20px;
      margin: 0;
      background: var(--surface);
      font-size: 18px;
      font-weight: 700;
      border-bottom: 1px solid var(--border);
    }

    .principle-number {
      background: var(--primary);
      color: white;
      padding: 2px 10px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 800;
    }

    .guideline-block {
      padding: 0 16px 8px;
    }

    .guideline-heading {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 4px 8px;
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: var(--text);
      border-bottom: 1px solid var(--border);
      margin-bottom: 8px;
    }

    .guideline-number {
      color: var(--primary-light);
      font-family: 'SF Mono', SFMono-Regular, Consolas, monospace;
      font-size: 13px;
      font-weight: 700;
    }

    .criterion-card {
      margin-bottom: 6px;
      border-left: 3px solid var(--border);
    }
    .criterion-card.fail { border-left-color: var(--danger); }
    .criterion-card.pass { border-left-color: var(--success); }
    .criterion-card.needs-review { border-left-color: var(--warning); }
    .criterion-card.not-tested { border-left-color: var(--border); opacity: 0.65; }
    .criterion-card.manual-review { border-left-color: var(--info); }
    .criterion-card.not-applicable { border-left-color: var(--border); opacity: 0.75; }

    .criterion-status-icon {
      font-weight: 800;
      font-size: 14px;
      width: 20px;
      text-align: center;
    }
    .criterion-status-icon.fail { color: var(--danger); }
    .criterion-status-icon.pass { color: var(--success); }
    .criterion-status-icon.needs-review { color: var(--warning); }
    .criterion-status-icon.not-tested { color: var(--text-muted); }
    .criterion-status-icon.manual-review { color: var(--info); }
    .criterion-status-icon.not-applicable { color: var(--text-muted); }

    .not-tested-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 14px 16px;
      font-size: 14px;
    }

    .criterion-id {
      font-family: 'SF Mono', SFMono-Regular, Consolas, monospace;
      font-weight: 700;
      font-size: 13px;
      color: var(--primary-light);
      min-width: 48px;
    }

    .criterion-name {
      flex: 1;
      font-weight: 500;
    }

    .criterion-level {
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.05em;
    }
    .criterion-level.level-a { background: rgba(16,185,129,0.12); color: #6ee7b7; }
    .criterion-level.level-aa { background: rgba(99,102,241,0.12); color: var(--primary-light); }
    .criterion-level.level-aaa { background: rgba(245,158,11,0.12); color: #fcd34d; }

    .criterion-subheading {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-muted);
      margin: 12px 0 8px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .violations-subheading { color: var(--danger-light); }
    .media-subheading { color: var(--info); }
    .review-subheading { color: var(--warning); }

    .detail-card.incomplete {
      border-left-color: var(--warning);
    }

    .best-practices-block .principle-number {
      background: var(--text-muted);
    }

    /* Responsive */
    @media (max-width: 768px) {
      .dashboard { grid-template-columns: 1fr; }
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
    }

    /* Print styles */
    @media print {
      body { background: white; color: #1a202c; }
      .report { max-width: 100%; padding: 0; }
      .collapsible-content { display: block !important; }
      .collapsible-toggle { pointer-events: none; }
      .toggle-icon { display: none; }
      :root {
        --bg: #f7fafc;
        --surface: #ffffff;
        --surface-raised: #f8f9fa;
        --border: #e2e8f0;
        --text: #1a202c;
        --text-muted: #64748b;
      }
    }
  `;
}
