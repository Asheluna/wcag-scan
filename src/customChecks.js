/**
 * Custom WCAG checks — Puppeteer-based tests for criteria not covered by axe-core.
 *
 * Each check function receives a Puppeteer page (already navigated) and returns
 * an array of findings: { criterionId, status, message, impact, element?, screenshot? }
 */


// ── Screenshot Helpers ───────────────────────────────────────────────────────

/** Max screenshots per criterion per page to limit report size. */
const MAX_SCREENSHOTS_PER_CRITERION = 3;

/**
 * Capture a screenshot of a single element by CSS selector.
 * Returns a data URI string or null.
 */
export async function screenshotElement(page, selector) {
    try {
        const el = await page.$(selector);
        if (!el) return null;
        const box = await el.boundingBox();
        if (!box || box.width === 0 || box.height === 0) return null;
        const buf = await el.screenshot({ encoding: 'base64' });
        return `data:image/png;base64,${buf}`;
    } catch {
        return null;
    }
}

/**
 * Capture a viewport-level screenshot (e.g. for reflow at narrow width).
 * Returns a data URI string or null.
 */
async function screenshotViewport(page) {
    try {
        const buf = await page.screenshot({ encoding: 'base64', fullPage: false });
        return `data:image/png;base64,${buf}`;
    } catch {
        return null;
    }
}

/**
 * Attach screenshots to findings that have a `selector` field.
 * Mutates findings in place, limited to MAX_SCREENSHOTS_PER_CRITERION.
 */
async function attachScreenshots(page, findings) {
    const countByCriterion = {};
    for (const f of findings) {
        if (!f.selector || f.status === 'pass') continue;
        const count = countByCriterion[f.criterionId] || 0;
        if (count >= MAX_SCREENSHOTS_PER_CRITERION) continue;
        f.screenshot = await screenshotElement(page, f.selector);
        if (f.screenshot) {
            countByCriterion[f.criterionId] = count + 1;
        }
    }
}


// ── Group A: DOM Analysis Checks ─────────────────────────────────────────────

/**
 * 4.1.1 Parsing — detect duplicate IDs and malformed nesting.
 */
async function checkParsing(page) {
    return page.evaluate(() => {
        const findings = [];
        const ids = {};

        document.querySelectorAll('[id]').forEach(el => {
            const id = el.id;
            if (!id) return;
            if (ids[id]) {
                ids[id]++;
                if (ids[id] === 2) {
                    findings.push({
                        criterionId: '4.1.1',
                        status: 'violation',
                        message: `Duplicate id="${id}" found on multiple elements.`,
                        impact: 'serious',
                        element: el.outerHTML.slice(0, 120),
                        selector: __getSelector(el),
                    });
                }
            } else {
                ids[id] = 1;
            }
        });

        // Check for interactive elements nested inside other interactive elements
        const interactiveSelectors = 'a, button, input, select, textarea';
        document.querySelectorAll('a, button').forEach(parent => {
            const nested = parent.querySelectorAll(interactiveSelectors);
            nested.forEach(child => {
                if (child !== parent) {
                    findings.push({
                        criterionId: '4.1.1',
                        status: 'violation',
                        message: `Interactive element <${child.tagName.toLowerCase()}> nested inside <${parent.tagName.toLowerCase()}>. This creates parsing issues for assistive technologies.`,
                        impact: 'serious',
                        element: parent.outerHTML.slice(0, 120),
                        selector: __getSelector(parent),
                    });
                }
            });
        });

        if (findings.length === 0) {
            findings.push({
                criterionId: '4.1.1',
                status: 'pass',
                message: 'No duplicate IDs or malformed nesting detected.',
                impact: null,
            });
        }

        return findings;
    });
}

/**
 * 1.3.2 Meaningful Sequence — check heading hierarchy.
 */
async function checkMeaningfulSequence(page) {
    return page.evaluate(() => {
        const findings = [];
        const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'));

        if (headings.length === 0) {
            findings.push({
                criterionId: '1.3.2',
                status: 'warning',
                message: 'No headings found on the page. Headings help establish meaningful sequence.',
                impact: 'moderate',
            });
            return findings;
        }

        let prevLevel = 0;
        for (const h of headings) {
            const level = parseInt(h.tagName[1]);
            if (prevLevel > 0 && level > prevLevel + 1) {
                findings.push({
                    criterionId: '1.3.2',
                    status: 'violation',
                    message: `Heading level skipped: <h${prevLevel}> followed by <h${level}> ("${h.textContent.trim().slice(0, 60)}"). Headings should not skip levels.`,
                    impact: 'moderate',
                    element: h.outerHTML.slice(0, 120),
                    selector: __getSelector(h),
                });
            }
            prevLevel = level;
        }

        if (findings.length === 0) {
            findings.push({
                criterionId: '1.3.2',
                status: 'pass',
                message: `Heading hierarchy is sequential (${headings.length} headings checked).`,
                impact: null,
            });
        }

        return findings;
    });
}

/**
 * 2.4.3 Focus Order — detect tabindex > 0.
 */
async function checkFocusOrder(page) {
    return page.evaluate(() => {
        const findings = [];
        const positiveTabindex = Array.from(document.querySelectorAll('[tabindex]'))
            .filter(el => parseInt(el.getAttribute('tabindex')) > 0);

        for (const el of positiveTabindex) {
            findings.push({
                criterionId: '2.4.3',
                status: 'violation',
                message: `Element has tabindex="${el.getAttribute('tabindex')}". Positive tabindex values disrupt natural focus order.`,
                impact: 'serious',
                element: el.outerHTML.slice(0, 120),
                selector: __getSelector(el),
            });
        }

        if (findings.length === 0) {
            findings.push({
                criterionId: '2.4.3',
                status: 'pass',
                message: 'No elements with positive tabindex found. Focus order follows DOM order.',
                impact: null,
            });
        }

        return findings;
    });
}

/**
 * 2.4.6 Headings and Labels — check heading coverage and form labels.
 */
async function checkHeadingsAndLabels(page) {
    return page.evaluate(() => {
        const findings = [];

        // Check for h1 presence
        const h1s = document.querySelectorAll('h1');
        if (h1s.length === 0) {
            findings.push({
                criterionId: '2.4.6',
                status: 'violation',
                message: 'Page has no <h1> heading. Every page should have a primary heading.',
                impact: 'moderate',
            });
        } else if (h1s.length > 1) {
            findings.push({
                criterionId: '2.4.6',
                status: 'warning',
                message: `Page has ${h1s.length} <h1> headings. Consider using a single <h1> per page.`,
                impact: 'minor',
            });
        }

        // Check empty headings
        document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(h => {
            if (!h.textContent.trim()) {
                findings.push({
                    criterionId: '2.4.6',
                    status: 'violation',
                    message: `Empty <${h.tagName.toLowerCase()}> heading found. Headings must have descriptive text.`,
                    impact: 'serious',
                    element: h.outerHTML.slice(0, 120),
                    selector: __getSelector(h),
                });
            }
        });

        // Check form fields have labels
        const formFields = document.querySelectorAll(
            'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), select, textarea'
        );
        for (const field of formFields) {
            const id = field.id;
            const hasLabel = id && document.querySelector(`label[for="${id}"]`);
            const hasAriaLabel = field.getAttribute('aria-label');
            const hasAriaLabelledBy = field.getAttribute('aria-labelledby');
            const isWrappedByLabel = field.closest('label');
            const hasTitle = field.getAttribute('title');
            const hasPlaceholder = field.getAttribute('placeholder');

            if (!hasLabel && !hasAriaLabel && !hasAriaLabelledBy && !isWrappedByLabel && !hasTitle) {
                findings.push({
                    criterionId: '2.4.6',
                    status: 'violation',
                    message: `Form field <${field.tagName.toLowerCase()}${field.type ? ' type="' + field.type + '"' : ''}> has no associated label.${hasPlaceholder ? ' Placeholder text alone is not a sufficient label.' : ''}`,
                    impact: 'serious',
                    element: field.outerHTML.slice(0, 120),
                    selector: __getSelector(field),
                });
            }
        }

        if (findings.length === 0) {
            findings.push({
                criterionId: '2.4.6',
                status: 'pass',
                message: 'Headings and labels are properly structured.',
                impact: null,
            });
        }

        return findings;
    });
}

/**
 * 2.5.3 Label in Name — verify visible text is contained in accessible name.
 */
async function checkLabelInName(page) {
    return page.evaluate(() => {
        const findings = [];

        const elements = document.querySelectorAll('button, [role="button"], a[href], input[type="submit"], input[type="button"]');

        for (const el of elements) {
            const visibleText = el.textContent?.trim().toLowerCase();
            if (!visibleText || visibleText.length < 2) continue;

            const ariaLabel = el.getAttribute('aria-label')?.toLowerCase();
            const ariaLabelledBy = el.getAttribute('aria-labelledby');

            let accessibleName = null;
            if (ariaLabel) {
                accessibleName = ariaLabel;
            } else if (ariaLabelledBy) {
                const refEl = document.getElementById(ariaLabelledBy);
                if (refEl) accessibleName = refEl.textContent?.trim().toLowerCase();
            }

            // Only check elements where aria-label/labelledby overrides visible text
            if (accessibleName && !accessibleName.includes(visibleText.slice(0, 20))) {
                findings.push({
                    criterionId: '2.5.3',
                    status: 'violation',
                    message: `Element's visible text "${visibleText.slice(0, 40)}" is not contained in its accessible name "${accessibleName.slice(0, 40)}". Users who speak commands based on visible text won't be able to activate this control.`,
                    impact: 'serious',
                    element: el.outerHTML.slice(0, 120),
                    selector: __getSelector(el),
                });
            }
        }

        if (findings.length === 0) {
            findings.push({
                criterionId: '2.5.3',
                status: 'pass',
                message: 'Visible labels match accessible names for interactive elements.',
                impact: null,
            });
        }

        return findings;
    });
}

/**
 * 4.1.3 Status Messages — check for aria-live regions.
 */
async function checkStatusMessages(page) {
    return page.evaluate(() => {
        const findings = [];

        const liveRegions = document.querySelectorAll(
            '[aria-live], [role="status"], [role="alert"], [role="log"], [role="progressbar"]'
        );

        // Check for forms that might produce status messages
        const forms = document.querySelectorAll('form');
        const searchEls = document.querySelectorAll('[role="search"], input[type="search"]');
        const cartEls = document.querySelectorAll('[class*="cart"], [id*="cart"], [class*="basket"]');

        if (liveRegions.length > 0) {
            // Describe what live regions were found
            const regionDetails = Array.from(liveRegions).slice(0, 5).map(el => {
                const role = el.getAttribute('role');
                const ariaLive = el.getAttribute('aria-live');
                const tag = el.tagName.toLowerCase();
                const id = el.id ? `#${el.id}` : '';
                const cls = el.className && typeof el.className === 'string'
                    ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
                    : '';
                const type = role ? `role="${role}"` : `aria-live="${ariaLive}"`;
                return `<${tag}${id || cls}> (${type})`;
            });
            findings.push({
                criterionId: '4.1.3',
                status: 'pass',
                message: `Found ${liveRegions.length} ARIA live region(s): ${regionDetails.join(', ')}${liveRegions.length > 5 ? ` and ${liveRegions.length - 5} more` : ''}.`,
                impact: null,
            });
        }

        if (forms.length > 0 || searchEls.length > 0 || cartEls.length > 0) {
            // Describe the specific interactive elements found
            const elementDescriptions = [];
            if (forms.length > 0) {
                const formDetails = Array.from(forms).slice(0, 3).map(f => {
                    const action = f.getAttribute('action');
                    const id = f.id ? `#${f.id}` : '';
                    const cls = f.className && typeof f.className === 'string'
                        ? `.${f.className.trim().split(/\s+/).slice(0, 2).join('.')}`
                        : '';
                    const label = id || cls || (action ? `action="${action}"` : '');
                    return `<form${label ? ' ' + label : ''}>`;
                });
                elementDescriptions.push(`${forms.length} form(s): ${formDetails.join(', ')}`);
            }
            if (searchEls.length > 0) {
                elementDescriptions.push(`search: ${Array.from(searchEls).slice(0, 2).map(el => `<${el.tagName.toLowerCase()}${el.getAttribute('role') === 'search' ? ' role="search"' : ' type="search"'}>`).join(', ')}`);
            }
            if (cartEls.length > 0) {
                elementDescriptions.push(`cart/basket element: <${cartEls[0].tagName.toLowerCase()}${cartEls[0].id ? '#' + cartEls[0].id : cartEls[0].className ? '.' + cartEls[0].className.trim().split(/\s+/)[0] : ''}>`);
            }

            if (liveRegions.length === 0) {
                const targetEl = forms[0] || searchEls[0] || cartEls[0];
                findings.push({
                    criterionId: '4.1.3',
                    status: 'warning',
                    message: `Page has interactive elements that may produce status messages but no ARIA live regions were found. Elements: ${elementDescriptions.join('; ')}. Ensure form submissions, search results, and cart updates are announced to assistive technologies using aria-live regions or appropriate roles.`,
                    impact: 'moderate',
                    selector: targetEl ? __getSelector(targetEl) : null,
                });
            }
        }

        if (findings.length === 0) {
            findings.push({
                criterionId: '4.1.3',
                status: 'pass',
                message: 'No interactive elements requiring status messages detected.',
                impact: null,
            });
        }

        return findings;
    });
}

/**
 * 3.3.1 Error Identification — check form error handling patterns.
 */
async function checkErrorIdentification(page) {
    return page.evaluate(() => {
        const findings = [];

        const forms = document.querySelectorAll('form');
        if (forms.length === 0) {
            findings.push({
                criterionId: '3.3.1',
                status: 'not-applicable',
                message: 'No forms found on this page.',
                impact: null,
            });
            return findings;
        }

        // Check for required fields without proper indicators
        const requiredFields = document.querySelectorAll('[required], [aria-required="true"]');
        const invalidFields = document.querySelectorAll('[aria-invalid="true"]');

        // Check for aria-describedby pointing to error messages
        for (const field of requiredFields) {
            const describedBy = field.getAttribute('aria-describedby');
            const errormessage = field.getAttribute('aria-errormessage');
            if (!describedBy && !errormessage) {
                findings.push({
                    criterionId: '3.3.1',
                    status: 'warning',
                    message: `Required field lacks aria-describedby or aria-errormessage for error identification.`,
                    impact: 'moderate',
                    element: field.outerHTML.slice(0, 120),
                    selector: __getSelector(field),
                });
            }
        }

        // Check that invalid fields have associated error text
        for (const field of invalidFields) {
            const describedBy = field.getAttribute('aria-describedby');
            const errormessage = field.getAttribute('aria-errormessage');
            let hasErrorText = false;
            if (describedBy) {
                const ref = document.getElementById(describedBy);
                hasErrorText = ref && ref.textContent.trim().length > 0;
            }
            if (errormessage) {
                const ref = document.getElementById(errormessage);
                hasErrorText = hasErrorText || (ref && ref.textContent.trim().length > 0);
            }
            if (!hasErrorText) {
                findings.push({
                    criterionId: '3.3.1',
                    status: 'violation',
                    message: `Field marked as aria-invalid="true" but has no associated error message text.`,
                    impact: 'serious',
                    element: field.outerHTML.slice(0, 120),
                    selector: __getSelector(field),
                });
            }
        }

        if (findings.length === 0) {
            findings.push({
                criterionId: '3.3.1',
                status: 'pass',
                message: `Forms have proper error identification patterns (${requiredFields.length} required fields checked).`,
                impact: null,
            });
        }

        return findings;
    });
}

/**
 * 3.3.3 Error Suggestion — check if error patterns include suggestions.
 */
async function checkErrorSuggestion(page) {
    return page.evaluate(() => {
        const findings = [];

        // Look for visible error messages on the page
        const errorPatterns = document.querySelectorAll(
            '[class*="error"]:not(script):not(style), [class*="invalid"]:not(script):not(style), [role="alert"]'
        );

        const visibleErrors = Array.from(errorPatterns).filter(el => {
            const text = el.textContent?.trim();
            return text && text.length > 0 && text.length < 500 && el.offsetParent !== null;
        });

        if (visibleErrors.length > 0) {
            findings.push({
                criterionId: '3.3.3',
                status: 'warning',
                message: `Found ${visibleErrors.length} error message element(s). Verify they provide suggestions for correction where possible.`,
                impact: 'moderate',
                selector: __getSelector(visibleErrors[0]),
            });
        }

        // Check forms with validation attributes
        const validatedFields = document.querySelectorAll('[pattern], [type="email"], [type="url"], [type="number"], [min], [max]');
        if (validatedFields.length > 0) {
            for (const field of validatedFields) {
                const hasTitle = field.getAttribute('title');
                const hasDescribedBy = field.getAttribute('aria-describedby');
                if (!hasTitle && !hasDescribedBy) {
                    findings.push({
                        criterionId: '3.3.3',
                        status: 'warning',
                        message: `Form field with validation constraints (${field.type || 'pattern'}) lacks descriptive text (title or aria-describedby) to suggest correct format.`,
                        impact: 'moderate',
                        element: field.outerHTML.slice(0, 120),
                        selector: __getSelector(field),
                    });
                }
            }
        }

        if (findings.length === 0) {
            findings.push({
                criterionId: '3.3.3',
                status: 'pass',
                message: 'No forms with error suggestion issues detected.',
                impact: null,
            });
        }

        return findings;
    });
}

/**
 * 3.3.4 Error Prevention (Legal, Financial, Data) — detect sensitive forms.
 */
async function checkErrorPrevention(page) {
    return page.evaluate(() => {
        const findings = [];

        // Look for forms that might handle financial/legal/personal data
        const sensitivePatterns = [
            'payment', 'checkout', 'purchase', 'buy', 'order', 'subscribe',
            'delete', 'remove', 'cancel', 'legal', 'agreement', 'contract',
            'betaling', 'kjøp', 'bestill', 'slett', 'avbestill', 'avtale', // Norwegian terms
        ];

        const forms = document.querySelectorAll('form');
        for (const form of forms) {
            const formText = (form.textContent + ' ' + form.action + ' ' + (form.className || '')).toLowerCase();
            const matchedPattern = sensitivePatterns.find(p => formText.includes(p));

            if (matchedPattern) {
                // Check for confirmation mechanisms
                const hasConfirmField = form.querySelector('[type="checkbox"][required], [name*="confirm"], [name*="accept"], [name*="agree"]');
                const hasReviewStep = formText.includes('review') || formText.includes('confirm') || formText.includes('bekreft');

                if (!hasConfirmField && !hasReviewStep) {
                    findings.push({
                        criterionId: '3.3.4',
                        status: 'warning',
                        message: `Form appears to handle sensitive data (matched: "${matchedPattern}") but lacks visible confirmation mechanism. Ensure users can review, confirm, or reverse submissions.`,
                        impact: 'serious',
                        element: form.outerHTML.slice(0, 150),
                        selector: __getSelector(form),
                    });
                }
            }
        }

        if (findings.length === 0) {
            findings.push({
                criterionId: '3.3.4',
                status: 'pass',
                message: 'No sensitive forms without error prevention detected.',
                impact: null,
            });
        }

        return findings;
    });
}

/**
 * 2.1.4 Character Key Shortcuts — detect single-key event listeners.
 * We instrument addEventListener before page load to catch this.
 */
async function checkCharacterKeyShortcuts(page) {
    // Check for accesskey attributes (single character shortcuts)
    return page.evaluate(() => {
        const findings = [];

        const accessKeyElements = document.querySelectorAll('[accesskey]');
        if (accessKeyElements.length > 0) {
            findings.push({
                criterionId: '2.1.4',
                status: 'warning',
                message: `Found ${accessKeyElements.length} element(s) with accesskey attributes. Ensure these shortcuts can be remapped or disabled.`,
                impact: 'moderate',
                element: accessKeyElements[0].outerHTML.slice(0, 120),
                selector: __getSelector(accessKeyElements[0]),
            });
        }

        if (findings.length === 0) {
            findings.push({
                criterionId: '2.1.4',
                status: 'pass',
                message: 'No character key shortcut issues detected.',
                impact: null,
            });
        }

        return findings;
    });
}

/**
 * 2.5.1 Pointer Gestures — detect multi-point/path-based gesture requirements.
 */
async function checkPointerGestures(page) {
    return page.evaluate(() => {
        const findings = [];

        // Look for common gesture library indicators
        const gestureIndicators = [
            '[class*="swipe"]', '[class*="pinch"]', '[class*="carousel"]',
            '[class*="slider"]:not(input[type="range"])', '[class*="drag"]',
            '[data-swipe]', '[data-gesture]',
        ];

        for (const selector of gestureIndicators) {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
                // Check if there's an alternative mechanism
                const hasButtons = el.querySelector('button, [role="button"], a[href]');
                if (!hasButtons) {
                    findings.push({
                        criterionId: '2.5.1',
                        status: 'warning',
                        message: `Element appears to use gesture-based interaction (matched: ${selector}) without visible single-pointer alternative controls.`,
                        impact: 'moderate',
                        element: el.outerHTML.slice(0, 120),
                        selector: __getSelector(el),
                    });
                }
            }
        }

        if (findings.length === 0) {
            findings.push({
                criterionId: '2.5.1',
                status: 'pass',
                message: 'No multi-point gesture issues detected.',
                impact: null,
            });
        }

        return findings;
    });
}

/**
 * 2.5.2 Pointer Cancellation — check for mousedown-activated actions.
 */
async function checkPointerCancellation(page) {
    return page.evaluate(() => {
        const findings = [];

        // Check for elements with onmousedown or onpointerdown attributes
        const mousedownElements = document.querySelectorAll('[onmousedown], [onpointerdown]');
        for (const el of mousedownElements) {
            // Check if there's also an onclick (which fires on mouseup)
            const hasOnClick = el.hasAttribute('onclick');
            if (!hasOnClick) {
                findings.push({
                    criterionId: '2.5.2',
                    status: 'warning',
                    message: `Element uses onmousedown/onpointerdown without onclick. Actions should activate on pointer up, not down, to allow cancellation.`,
                    impact: 'moderate',
                    element: el.outerHTML.slice(0, 120),
                    selector: __getSelector(el),
                });
            }
        }

        // Check for drag-and-drop without alternatives
        const draggables = document.querySelectorAll('[draggable="true"]');
        for (const el of draggables) {
            findings.push({
                criterionId: '2.5.2',
                status: 'warning',
                message: `Draggable element found. Ensure drag operations can be cancelled (e.g., by pressing Escape or releasing outside drop zone).`,
                impact: 'moderate',
                element: el.outerHTML.slice(0, 120),
                selector: __getSelector(el),
            });
        }

        if (findings.length === 0) {
            findings.push({
                criterionId: '2.5.2',
                status: 'pass',
                message: 'No pointer cancellation issues detected.',
                impact: null,
            });
        }

        return findings;
    });
}

/**
 * 2.5.4 Motion Actuation — detect device motion/orientation usage.
 */
async function checkMotionActuation(page) {
    return page.evaluate(() => {
        const findings = [];

        // Check for elements suggesting shake/tilt/motion interactions
        const motionIndicators = document.querySelectorAll(
            '[class*="shake"], [class*="tilt"], [class*="gyro"], [class*="accelero"]'
        );

        if (motionIndicators.length > 0) {
            findings.push({
                criterionId: '2.5.4',
                status: 'warning',
                message: `Found ${motionIndicators.length} element(s) suggesting motion-based interaction. Ensure all motion-triggered functions have UI alternatives.`,
                impact: 'moderate',
                element: motionIndicators[0].outerHTML.slice(0, 120),
                selector: __getSelector(motionIndicators[0]),
            });
        }

        if (findings.length === 0) {
            findings.push({
                criterionId: '2.5.4',
                status: 'pass',
                message: 'No motion actuation issues detected.',
                impact: null,
            });
        }

        return findings;
    });
}


// ── Group B: CSS/Style Analysis ──────────────────────────────────────────────

/**
 * 2.4.7 Focus Visible — check if focus indicators are suppressed.
 */
async function checkFocusVisible(page) {
    return page.evaluate(() => {
        const findings = [];

        // Check stylesheets for outline:none/outline:0 on focusable elements
        const suppressionPatterns = [];
        try {
            for (const sheet of document.styleSheets) {
                try {
                    for (const rule of sheet.cssRules || []) {
                        const text = rule.cssText || '';
                        if (text.includes('outline') && (text.includes(':focus') || text.includes(':active'))) {
                            if (text.match(/outline\s*:\s*(none|0)\b/) && !text.includes('outline-offset')) {
                                suppressionPatterns.push(rule.selectorText || 'unknown');
                            }
                        }
                    }
                } catch {
                    // Cross-origin stylesheet, skip
                }
            }
        } catch {
            // Error reading stylesheets
        }

        if (suppressionPatterns.length > 0) {
            const unique = [...new Set(suppressionPatterns)].slice(0, 5);
            // Find a sample focusable element affected by the suppression
            const sampleFocusable = document.querySelector('a[href], button, input:not([type="hidden"]), select, textarea');
            findings.push({
                criterionId: '2.4.7',
                status: 'violation',
                message: `CSS rules suppress focus outline on: ${unique.join(', ')}${suppressionPatterns.length > 5 ? ` (and ${suppressionPatterns.length - 5} more)` : ''}. Focus must be visible for keyboard users.`,
                impact: 'serious',
                selector: sampleFocusable ? __getSelector(sampleFocusable) : null,
            });
        }

        // Also check for elements with inline outline:none
        const inlineSuppressed = document.querySelectorAll('[style*="outline: none"], [style*="outline:none"], [style*="outline: 0"]');
        if (inlineSuppressed.length > 0) {
            findings.push({
                criterionId: '2.4.7',
                status: 'violation',
                message: `${inlineSuppressed.length} element(s) have inline styles suppressing focus outline.`,
                impact: 'serious',
                selector: __getSelector(inlineSuppressed[0]),
            });
        }

        if (findings.length === 0) {
            findings.push({
                criterionId: '2.4.7',
                status: 'pass',
                message: 'No focus outline suppression detected in CSS.',
                impact: null,
            });
        }

        return findings;
    });
}

/**
 * 1.4.11 Non-text Contrast — check UI component contrast.
 */
async function checkNonTextContrast(page) {
    return page.evaluate(() => {
        const findings = [];

        function luminance(r, g, b) {
            const [rs, gs, bs] = [r, g, b].map(c => {
                c = c / 255;
                return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
            });
            return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
        }

        function contrastRatio(l1, l2) {
            const lighter = Math.max(l1, l2);
            const darker = Math.min(l1, l2);
            return (lighter + 0.05) / (darker + 0.05);
        }

        function parseColor(colorStr) {
            const match = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (match) return { r: parseInt(match[1]), g: parseInt(match[2]), b: parseInt(match[3]) };
            return null;
        }

        // Check form inputs and buttons for sufficient border/outline contrast
        const uiComponents = document.querySelectorAll('input:not([type="hidden"]), select, textarea, button, [role="button"]');
        let checkedCount = 0;

        for (const el of Array.from(uiComponents).slice(0, 20)) {
            if (!el.offsetParent) continue; // not visible
            const style = window.getComputedStyle(el);
            const bgColor = parseColor(style.backgroundColor);
            const borderColor = parseColor(style.borderColor);

            if (!bgColor) continue;
            checkedCount++;

            // Check if the element has a visible border or is distinguishable
            const borderWidth = parseFloat(style.borderWidth);
            const hasVisibleBorder = borderWidth >= 1 && style.borderStyle !== 'none';
            const hasOutline = style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
            const hasBoxShadow = style.boxShadow && style.boxShadow !== 'none';

            if (!hasVisibleBorder && !hasOutline && !hasBoxShadow) {
                // Check if background contrast with parent is sufficient
                const parentBg = parseColor(window.getComputedStyle(el.parentElement || document.body).backgroundColor);
                if (parentBg) {
                    const elLum = luminance(bgColor.r, bgColor.g, bgColor.b);
                    const parentLum = luminance(parentBg.r, parentBg.g, parentBg.b);
                    const ratio = contrastRatio(elLum, parentLum);
                    if (ratio < 3) {
                        findings.push({
                            criterionId: '1.4.11',
                            status: 'violation',
                            message: `UI component has insufficient contrast (${ratio.toFixed(1)}:1, needs 3:1) against background and no visible border.`,
                            impact: 'serious',
                            element: el.outerHTML.slice(0, 120),
                            selector: __getSelector(el),
                        });
                    }
                }
            }
        }

        if (findings.length === 0) {
            findings.push({
                criterionId: '1.4.11',
                status: 'pass',
                message: `Non-text contrast is sufficient (${checkedCount} UI components checked).`,
                impact: null,
            });
        }

        return findings;
    });
}

/**
 * 1.4.13 Content on Hover or Focus — detect hover/focus-triggered content.
 */
async function checkContentOnHoverOrFocus(page) {
    return page.evaluate(() => {
        const findings = [];

        // Check for tooltip/popover patterns
        const tooltipPatterns = document.querySelectorAll(
            '[data-tooltip], [data-toggle="tooltip"], [data-toggle="popover"], ' +
            '[role="tooltip"], [class*="tooltip"], [class*="popover"]'
        );

        for (const el of tooltipPatterns) {
            // Check if there's a dismiss mechanism
            const hasDismiss = el.querySelector('[class*="close"]') ||
                el.querySelector('button') ||
                el.getAttribute('aria-haspopup');

            if (!hasDismiss) {
                findings.push({
                    criterionId: '1.4.13',
                    status: 'warning',
                    message: `Tooltip/popover element found. Ensure hover-triggered content is dismissible, hoverable, and persistent per WCAG 1.4.13.`,
                    impact: 'moderate',
                    element: el.outerHTML.slice(0, 120),
                    selector: __getSelector(el),
                });
            }
        }

        // Check for CSS-only hover menus without keyboard support
        const dropdowns = document.querySelectorAll('[class*="dropdown"], [class*="submenu"]');
        for (const dd of dropdowns) {
            const trigger = dd.querySelector('[aria-expanded], [aria-haspopup]');
            if (!trigger) {
                const parentLink = dd.closest('li')?.querySelector('a, button');
                if (parentLink && !parentLink.hasAttribute('aria-expanded')) {
                    findings.push({
                        criterionId: '1.4.13',
                        status: 'warning',
                        message: `Dropdown/submenu may be hover-only without keyboard support. Ensure it has aria-expanded and is operable via keyboard.`,
                        impact: 'moderate',
                        element: dd.outerHTML.slice(0, 120),
                        selector: __getSelector(dd),
                    });
                }
            }
        }

        if (findings.length === 0) {
            findings.push({
                criterionId: '1.4.13',
                status: 'pass',
                message: 'No hover/focus content issues detected.',
                impact: null,
            });
        }

        return findings;
    });
}


// ── Group C: Viewport Testing ────────────────────────────────────────────────

/**
 * 1.4.10 Reflow — check for horizontal scrolling at 320px viewport.
 */
async function checkReflow(page) {
    const findings = [];

    // Save original viewport
    const originalViewport = page.viewport();

    try {
        // Set viewport to 320px (equivalent to 1280px at 400% zoom)
        await page.setViewport({ width: 320, height: 256 });
        await new Promise(r => setTimeout(r, 500)); // wait for reflow

        const scrollData = await page.evaluate(() => {
            const scrollWidth = document.documentElement.scrollWidth || document.body.scrollWidth;
            const clientWidth = document.documentElement.clientWidth;
            // Find elements causing overflow
            const overflowing = [];
            const all = document.querySelectorAll('*');
            for (const el of all) {
                const rect = el.getBoundingClientRect();
                if (rect.right > clientWidth + 5 && el.offsetParent !== null) {
                    overflowing.push({
                        tag: el.tagName.toLowerCase(),
                        class: el.className?.toString().slice(0, 50) || '',
                        width: Math.round(rect.width),
                    });
                    if (overflowing.length >= 5) break;
                }
            }
            return { scrollWidth, clientWidth, overflowing };
        });

        if (scrollData.scrollWidth > 325) {
            const reflowScreenshot = await screenshotViewport(page);
            findings.push({
                criterionId: '1.4.10',
                status: 'violation',
                message: `Page requires horizontal scrolling at 320px width (content is ${scrollData.scrollWidth}px wide). Content must reflow without horizontal scrolling at 400% zoom.${scrollData.overflowing.length > 0 ? ' Overflowing: ' + scrollData.overflowing.map(e => `<${e.tag}${e.class ? '.' + e.class.split(' ')[0] : ''}> (${e.width}px)`).join(', ') : ''}`,
                impact: 'serious',
                screenshot: reflowScreenshot,
                screenshotCaption: 'Page at 320px viewport width showing horizontal overflow',
            });
        } else {
            findings.push({
                criterionId: '1.4.10',
                status: 'pass',
                message: 'Page reflows correctly at 320px viewport width (400% zoom equivalent).',
                impact: null,
            });
        }
    } catch (err) {
        findings.push({
            criterionId: '1.4.10',
            status: 'warning',
            message: `Could not verify reflow: ${err.message}`,
            impact: 'moderate',
        });
    }

    // Restore original viewport
    if (originalViewport) {
        await page.setViewport(originalViewport);
    }

    return findings;
}


// ── Group D: Keyboard Simulation ─────────────────────────────────────────────

/**
 * 2.1.2 No Keyboard Trap — tab through focusable elements.
 */
async function checkNoKeyboardTrap(page) {
    const findings = [];

    try {
        // Get all focusable elements
        const focusableCount = await page.evaluate(() => {
            return document.querySelectorAll(
                'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable]'
            ).length;
        });

        if (focusableCount === 0) {
            findings.push({
                criterionId: '2.1.2',
                status: 'pass',
                message: 'No focusable elements to test for keyboard traps.',
                impact: null,
            });
            return findings;
        }

        // Tab through elements and track focus
        const maxTabs = Math.min(focusableCount + 5, 50);
        const focusHistory = [];
        let consecutiveSame = 0;

        for (let i = 0; i < maxTabs; i++) {
            await page.keyboard.press('Tab');
            const activeTag = await page.evaluate(() => {
                const el = document.activeElement;
                return el ? `${el.tagName}#${el.id || ''}` : 'body';
            });
            focusHistory.push(activeTag);

            // Detect trap: same element focused 3+ times in a row
            if (focusHistory.length >= 2 && activeTag === focusHistory[focusHistory.length - 2]) {
                consecutiveSame++;
                if (consecutiveSame >= 3) {
                    findings.push({
                        criterionId: '2.1.2',
                        status: 'violation',
                        message: `Potential keyboard trap detected: focus stuck on ${activeTag} after ${consecutiveSame} Tab presses.`,
                        impact: 'critical',
                    });
                    break;
                }
            } else {
                consecutiveSame = 0;
            }
        }

        if (findings.length === 0) {
            findings.push({
                criterionId: '2.1.2',
                status: 'pass',
                message: `No keyboard trap detected (tabbed through ${focusHistory.length} elements).`,
                impact: null,
            });
        }
    } catch (err) {
        findings.push({
            criterionId: '2.1.2',
            status: 'warning',
            message: `Could not complete keyboard trap test: ${err.message}`,
            impact: 'moderate',
        });
    }

    return findings;
}


// ── Group F: Multi-Page Content Check ────────────────────────────────────────

/**
 * 2.4.5 Multiple Ways — detect navigation mechanisms.
 */
async function checkMultipleWays(page) {
    return page.evaluate(() => {
        const findings = [];
        let wayCount = 0;
        const ways = [];

        // Check for navigation menu
        if (document.querySelector('nav, [role="navigation"]')) {
            wayCount++;
            ways.push('navigation menu');
        }

        // Check for search
        if (document.querySelector('[role="search"], input[type="search"], form[action*="search"], [class*="search"] input, [id*="search"] input')) {
            wayCount++;
            ways.push('search');
        }

        // Check for sitemap link
        const allLinks = Array.from(document.querySelectorAll('a[href]'));
        if (allLinks.some(a => /sitemap|nettstedskart/i.test(a.textContent + ' ' + a.href))) {
            wayCount++;
            ways.push('sitemap link');
        }

        // Check for breadcrumbs
        if (document.querySelector('[aria-label*="breadcrumb" i], [class*="breadcrumb"], nav ol')) {
            wayCount++;
            ways.push('breadcrumbs');
        }

        // Check for table of contents / page index
        if (document.querySelector('[class*="toc"], [id*="toc"], [class*="table-of-contents"]')) {
            wayCount++;
            ways.push('table of contents');
        }

        if (wayCount >= 2) {
            findings.push({
                criterionId: '2.4.5',
                status: 'pass',
                message: `Found ${wayCount} navigation mechanisms: ${ways.join(', ')}.`,
                impact: null,
            });
        } else {
            findings.push({
                criterionId: '2.4.5',
                status: 'warning',
                message: `Only ${wayCount} navigation mechanism(s) detected${ways.length > 0 ? ': ' + ways.join(', ') : ''}. WCAG 2.4.5 requires at least two ways to locate a page (e.g., navigation, search, sitemap).`,
                impact: 'moderate',
            });
        }

        return findings;
    });
}


// ── Gap Fillers — criteria covered by axe/imageAnalyzer but only when content exists ──

/**
 * 1.2.1 / 1.2.5 Audio/Video content — not applicable when no media elements exist.
 */
async function checkMediaPresence(page) {
    return page.evaluate(() => {
        const findings = [];
        const videos = document.querySelectorAll('video');
        const audios = document.querySelectorAll('audio');

        if (videos.length === 0 && audios.length === 0) {
            findings.push({
                criterionId: '1.2.1',
                status: 'not-applicable',
                message: 'No audio or video content found on this page.',
                impact: null,
            });
            findings.push({
                criterionId: '1.2.5',
                status: 'not-applicable',
                message: 'No prerecorded video content found on this page.',
                impact: null,
            });
        }

        return findings;
    });
}

/**
 * 1.3.4 Orientation — pass when no orientation lock detected.
 */
async function checkOrientation(page) {
    return page.evaluate(() => {
        const findings = [];
        let hasOrientationLock = false;

        try {
            for (const sheet of document.styleSheets) {
                try {
                    for (const rule of sheet.cssRules || []) {
                        if (rule.conditionText && /orientation/.test(rule.conditionText)) {
                            // Check if the media query restricts to a single orientation
                            const text = rule.cssText || '';
                            if (text.includes('display: none') || text.includes('display:none') ||
                                text.includes('transform: rotate')) {
                                hasOrientationLock = true;
                            }
                        }
                    }
                } catch { /* cross-origin */ }
            }
        } catch { /* error */ }

        if (hasOrientationLock) {
            findings.push({
                criterionId: '1.3.4',
                status: 'violation',
                message: 'CSS orientation media query may lock content to a single orientation. Content must not restrict viewing to a single display orientation.',
                impact: 'serious',
            });
        } else {
            findings.push({
                criterionId: '1.3.4',
                status: 'pass',
                message: 'No CSS orientation lock detected.',
                impact: null,
            });
        }

        return findings;
    });
}


// ── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Run all custom WCAG checks on a single page.
 *
 * @param {import('puppeteer').Browser} browser
 * @param {string} url
 * @returns {Promise<{ url: string, findings: object[], error: string|null }>}
 */
export async function runCustomChecks(browser, url) {
    const page = await browser.newPage();
    const allFindings = [];

    try {
        await page.setViewport({ width: 1280, height: 900 });
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, 500));

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

        // Run all check groups, collecting findings
        const checks = [
            // Group A: DOM Analysis
            checkParsing(page),
            checkMeaningfulSequence(page),
            checkFocusOrder(page),
            checkHeadingsAndLabels(page),
            checkLabelInName(page),
            checkStatusMessages(page),
            checkErrorIdentification(page),
            checkErrorSuggestion(page),
            checkErrorPrevention(page),
            checkCharacterKeyShortcuts(page),
            checkPointerGestures(page),
            checkPointerCancellation(page),
            checkMotionActuation(page),
            // Group B: CSS/Style Analysis
            checkFocusVisible(page),
            checkNonTextContrast(page),
            checkContentOnHoverOrFocus(page),
            // Group F: Multi-Page Content
            checkMultipleWays(page),
            // Gap fillers — criteria only tested by axe/imageAnalyzer when content exists
            checkMediaPresence(page),
            checkOrientation(page),
        ];

        const results = await Promise.all(checks);
        for (const findings of results) {
            allFindings.push(...findings);
        }

        // Group C: Viewport Testing (must be sequential — modifies viewport)
        const reflowFindings = await checkReflow(page);
        allFindings.push(...reflowFindings);

        // Group D: Keyboard Simulation (must be sequential — interacts with page)
        const trapFindings = await checkNoKeyboardTrap(page);
        allFindings.push(...trapFindings);

        // Attach screenshots to findings that have selectors
        await attachScreenshots(page, allFindings);

    } catch (err) {
        return { url, findings: allFindings, error: err.message };
    } finally {
        await page.close();
    }

    return { url, findings: allFindings, error: null };
}

/**
 * Run cross-page checks that compare data across multiple pages.
 * Called once after all per-page checks complete.
 *
 * @param {import('puppeteer').Browser} browser
 * @param {string[]} urls
 * @returns {Promise<object[]>} Findings for criteria 3.2.3 and 3.2.4
 */
export async function runCrossPageChecks(browser, urls) {
    if (urls.length < 2) {
        return [
            { criterionId: '3.2.3', status: 'pass', message: 'Only one page scanned; cross-page navigation consistency not applicable.', impact: null },
            { criterionId: '3.2.4', status: 'pass', message: 'Only one page scanned; cross-page identification consistency not applicable.', impact: null },
        ];
    }

    const navStructures = [];
    const findings = [];

    for (const url of urls.slice(0, 5)) { // Limit to first 5 pages
        const page = await browser.newPage();
        try {
            await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

            const pageData = await page.evaluate(() => {
                // Extract navigation structure
                const navEls = document.querySelectorAll('nav, [role="navigation"]');
                const navLinks = [];
                navEls.forEach(nav => {
                    const links = Array.from(nav.querySelectorAll('a[href]'))
                        .map(a => a.textContent.trim())
                        .filter(t => t.length > 0);
                    navLinks.push(...links);
                });

                // Extract functional component labels
                const searchLabel = document.querySelector('[role="search"], input[type="search"]')
                    ?.getAttribute('aria-label') || document.querySelector('[role="search"], input[type="search"]')
                    ?.getAttribute('placeholder') || null;

                return { navLinks, searchLabel };
            });

            navStructures.push({ url, ...pageData });
        } catch {
            // Skip pages that fail to load
        } finally {
            await page.close();
        }
    }

    // 3.2.3 Consistent Navigation — compare nav link order across pages
    if (navStructures.length >= 2) {
        const firstNav = navStructures[0].navLinks;
        let inconsistent = false;

        for (let i = 1; i < navStructures.length; i++) {
            const otherNav = navStructures[i].navLinks;
            // Check if the common links appear in the same order
            const commonLinks = firstNav.filter(link => otherNav.includes(link));
            const otherOrder = commonLinks.map(link => otherNav.indexOf(link));
            const isSorted = otherOrder.every((val, idx) => idx === 0 || val >= otherOrder[idx - 1]);

            if (!isSorted) {
                inconsistent = true;
                findings.push({
                    criterionId: '3.2.3',
                    status: 'violation',
                    message: `Navigation order differs between ${navStructures[0].url} and ${navStructures[i].url}. Navigation elements should appear in consistent order across pages.`,
                    impact: 'moderate',
                });
                break;
            }
        }

        if (!inconsistent) {
            findings.push({
                criterionId: '3.2.3',
                status: 'pass',
                message: `Navigation is consistent across ${navStructures.length} pages.`,
                impact: null,
            });
        }
    }

    // 3.2.4 Consistent Identification — compare functional component labels
    if (navStructures.length >= 2) {
        const searchLabels = navStructures.map(p => p.searchLabel).filter(Boolean);
        const uniqueLabels = [...new Set(searchLabels)];

        if (uniqueLabels.length > 1) {
            findings.push({
                criterionId: '3.2.4',
                status: 'violation',
                message: `Search component has inconsistent labels across pages: ${uniqueLabels.map(l => `"${l}"`).join(', ')}. Components with same function should have consistent identification.`,
                impact: 'moderate',
            });
        } else {
            findings.push({
                criterionId: '3.2.4',
                status: 'pass',
                message: `Functional components are consistently identified across ${navStructures.length} pages.`,
                impact: null,
            });
        }
    }

    return findings;
}

/**
 * Run custom checks on all pages + cross-page checks.
 *
 * @param {import('puppeteer').Browser} browser
 * @param {string[]} urls
 * @param {function} onPageChecked - (url, index, total) callback
 * @returns {Promise<{ perPage: object[], crossPage: object[] }>}
 */
export async function runAllCustomChecks(browser, urls, onPageChecked) {
    const perPage = [];

    for (let i = 0; i < urls.length; i++) {
        const result = await runCustomChecks(browser, urls[i]);
        perPage.push(result);
        if (onPageChecked) onPageChecked(urls[i], i + 1, urls.length, result);
    }

    const crossPage = await runCrossPageChecks(browser, urls);

    return { perPage, crossPage };
}
