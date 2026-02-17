/**
 * WCAG 2.1 structure — Principles → Guidelines → Success Criteria.
 *
 * Norwegian regulatory requirements (uutilsynet.no):
 *   - 48 criteria for public sector
 *   - 47 criteria for private sector (all except 1.2.5)
 *
 * Each criterion has a `required` field:
 *   'all'    — required for both public and private sector
 *   'public' — required for public sector only
 *   false    — not part of Norwegian requirements (AAA or WCAG 2.2 additions)
 */

export const WCAG_PRINCIPLES = [
  {
    id: '1',
    name: 'Perceivable',
    guidelines: [
      {
        id: '1.1',
        name: 'Text Alternatives',
        criteria: [
          { id: '1.1.1', name: 'Non-text Content', level: 'A', required: 'all',
            description: 'All non-text content (images, icons, charts, CAPTCHA) has a text alternative that serves the equivalent purpose, unless it is purely decorative.' },
        ],
      },
      {
        id: '1.2',
        name: 'Time-based Media',
        criteria: [
          { id: '1.2.1', name: 'Audio-only and Video-only (Prerecorded)', level: 'A', required: 'all',
            description: 'For prerecorded audio-only content, a text transcript is provided. For prerecorded video-only content, either a text alternative or an audio track is provided.' },
          { id: '1.2.2', name: 'Captions (Prerecorded)', level: 'A', required: 'all',
            description: 'Captions are provided for all prerecorded audio content in synchronized media (video with audio), except when the media is clearly labeled as a media alternative for text.' },
          { id: '1.2.3', name: 'Audio Description or Media Alternative (Prerecorded)', level: 'A', required: false,
            description: 'An audio description or a full text alternative is provided for prerecorded synchronized media (video with audio).' },
          { id: '1.2.4', name: 'Captions (Live)', level: 'AA', required: false,
            description: 'Captions are provided for all live audio content in synchronized media (live video streams with audio).' },
          { id: '1.2.5', name: 'Audio Description (Prerecorded)', level: 'AA', required: 'public',
            description: 'Audio description is provided for all prerecorded video content in synchronized media, describing important visual details not conveyed through dialogue alone.' },
        ],
      },
      {
        id: '1.3',
        name: 'Adaptable',
        criteria: [
          { id: '1.3.1', name: 'Info and Relationships', level: 'A', required: 'all',
            description: 'Information, structure, and relationships conveyed through presentation (e.g. headings, lists, tables, form labels) can be programmatically determined or are available in text.' },
          { id: '1.3.2', name: 'Meaningful Sequence', level: 'A', required: 'all',
            description: 'When the order of content affects its meaning, a correct reading sequence can be programmatically determined (e.g. DOM order matches visual order).' },
          { id: '1.3.3', name: 'Sensory Characteristics', level: 'A', required: 'all',
            description: 'Instructions for understanding and operating content do not rely solely on sensory characteristics such as shape, color, size, visual location, orientation, or sound.' },
          { id: '1.3.4', name: 'Orientation', level: 'AA', required: 'all',
            description: 'Content does not restrict its view and operation to a single display orientation (portrait or landscape), unless a specific orientation is essential.' },
          { id: '1.3.5', name: 'Identify Input Purpose', level: 'AA', required: 'all',
            description: 'The purpose of input fields collecting user information can be programmatically determined (e.g. using autocomplete attributes for name, email, address fields).' },
        ],
      },
      {
        id: '1.4',
        name: 'Distinguishable',
        criteria: [
          { id: '1.4.1', name: 'Use of Color', level: 'A', required: 'all',
            description: 'Color is not used as the only visual means of conveying information, indicating an action, prompting a response, or distinguishing a visual element (e.g. links, required fields, errors).' },
          { id: '1.4.2', name: 'Audio Control', level: 'A', required: 'all',
            description: 'If audio plays automatically for more than 3 seconds, a mechanism is available to pause/stop it or control its volume independently from the system volume.' },
          { id: '1.4.3', name: 'Contrast (Minimum)', level: 'AA', required: 'all',
            description: 'Text and images of text have a contrast ratio of at least 4.5:1 (3:1 for large text of 18pt+ or 14pt+ bold) against their background.' },
          { id: '1.4.4', name: 'Resize Text', level: 'AA', required: 'all',
            description: 'Text can be resized up to 200% without assistive technology and without loss of content or functionality.' },
          { id: '1.4.5', name: 'Images of Text', level: 'AA', required: 'all',
            description: 'If the visual presentation can be achieved with text alone, images are not used to present text — unless the image is customizable or the presentation is essential (e.g. logotypes).' },
          { id: '1.4.10', name: 'Reflow', level: 'AA', required: 'all',
            description: 'Content can be presented without loss of information or functionality and without scrolling in two dimensions, at 320 CSS pixels wide (for vertical scrolling) or 256 CSS pixels high (for horizontal).' },
          { id: '1.4.11', name: 'Non-text Contrast', level: 'AA', required: 'all',
            description: 'Visual information required to identify UI components and graphical objects (icons, borders, focus indicators) has a contrast ratio of at least 3:1 against adjacent colors.' },
          { id: '1.4.12', name: 'Text Spacing', level: 'AA', required: 'all',
            description: 'No loss of content or functionality occurs when users override text spacing: line height to 1.5×, paragraph spacing to 2×, letter spacing to 0.12×, and word spacing to 0.16× the font size.' },
          { id: '1.4.13', name: 'Content on Hover or Focus', level: 'AA', required: 'all',
            description: 'Additional content that appears on pointer hover or keyboard focus (tooltips, dropdowns) is dismissible, hoverable, and persistent until the user dismisses it or it is no longer relevant.' },
        ],
      },
    ],
  },
  {
    id: '2',
    name: 'Operable',
    guidelines: [
      {
        id: '2.1',
        name: 'Keyboard Accessible',
        criteria: [
          { id: '2.1.1', name: 'Keyboard', level: 'A', required: 'all',
            description: 'All functionality is operable through a keyboard interface without requiring specific timings for individual keystrokes, except where the underlying function requires path-dependent input.' },
          { id: '2.1.2', name: 'No Keyboard Trap', level: 'A', required: 'all',
            description: 'If keyboard focus can be moved to a component using a keyboard interface, focus can also be moved away using only a keyboard — and the user is informed of any non-standard method required.' },
          { id: '2.1.4', name: 'Character Key Shortcuts', level: 'A', required: 'all',
            description: 'If a keyboard shortcut uses only letter, number, punctuation, or symbol keys, the user can turn it off, remap it, or it is only active when the relevant component has focus.' },
        ],
      },
      {
        id: '2.2',
        name: 'Enough Time',
        criteria: [
          { id: '2.2.1', name: 'Timing Adjustable', level: 'A', required: 'all',
            description: 'For time limits set by the content, the user can turn off, adjust, or extend the time — unless the time limit is essential, longer than 20 hours, or a real-time event.' },
          { id: '2.2.2', name: 'Pause, Stop, Hide', level: 'A', required: 'all',
            description: 'For moving, blinking, scrolling, or auto-updating content that starts automatically and lasts more than 5 seconds, the user can pause, stop, or hide it.' },
        ],
      },
      {
        id: '2.3',
        name: 'Seizures and Physical Reactions',
        criteria: [
          { id: '2.3.1', name: 'Three Flashes or Below Threshold', level: 'A', required: 'all',
            description: 'Web pages do not contain anything that flashes more than three times in any one second period, or the flash is below the general flash and red flash thresholds.' },
        ],
      },
      {
        id: '2.4',
        name: 'Navigable',
        criteria: [
          { id: '2.4.1', name: 'Bypass Blocks', level: 'A', required: 'all',
            description: 'A mechanism is available to bypass blocks of content that are repeated on multiple pages (e.g. skip-to-content links, landmark regions, headings).' },
          { id: '2.4.2', name: 'Page Titled', level: 'A', required: 'all',
            description: 'Web pages have descriptive and informative titles that describe the topic or purpose of the page.' },
          { id: '2.4.3', name: 'Focus Order', level: 'A', required: 'all',
            description: 'If a page can be navigated sequentially and the navigation order affects meaning or operability, focusable components receive focus in a meaningful and operable order.' },
          { id: '2.4.4', name: 'Link Purpose (In Context)', level: 'A', required: 'all',
            description: 'The purpose of each link can be determined from the link text alone, or from the link text together with its programmatically determined context (e.g. surrounding sentence, list item, table cell).' },
          { id: '2.4.5', name: 'Multiple Ways', level: 'AA', required: 'all',
            description: 'More than one way is available to locate a page within a set of pages (e.g. site map, search, table of contents, navigation), except where the page is a step in a process.' },
          { id: '2.4.6', name: 'Headings and Labels', level: 'AA', required: 'all',
            description: 'Headings and labels describe the topic or purpose of the content they introduce. Form labels clearly indicate the expected input.' },
          { id: '2.4.7', name: 'Focus Visible', level: 'AA', required: 'all',
            description: 'Any keyboard-operable user interface has a visible indicator of the currently focused element (e.g. a focus outline or highlight).' },
        ],
      },
      {
        id: '2.5',
        name: 'Input Modalities',
        criteria: [
          { id: '2.5.1', name: 'Pointer Gestures', level: 'A', required: 'all',
            description: 'All functionality that uses multipoint or path-based gestures (pinch, swipe, drag) can also be operated with a single pointer without a path-based gesture, unless the gesture is essential.' },
          { id: '2.5.2', name: 'Pointer Cancellation', level: 'A', required: 'all',
            description: 'For single-pointer functionality, at least one of the following is true: the down-event is not used to execute, the action completes on the up-event with an ability to abort, or the action is reversible.' },
          { id: '2.5.3', name: 'Label in Name', level: 'A', required: 'all',
            description: 'For UI components with visible text labels, the accessible name contains the visible text — so speech-input users can activate controls by speaking the visible label.' },
          { id: '2.5.4', name: 'Motion Actuation', level: 'A', required: 'all',
            description: 'Functionality operated by device motion (shake, tilt) or user gesture can also be operated by conventional UI components, and motion actuation can be disabled to prevent accidental triggering.' },
        ],
      },
    ],
  },
  {
    id: '3',
    name: 'Understandable',
    guidelines: [
      {
        id: '3.1',
        name: 'Readable',
        criteria: [
          { id: '3.1.1', name: 'Language of Page', level: 'A', required: 'all',
            description: 'The default human language of each web page can be programmatically determined (e.g. via the lang attribute on the html element).' },
          { id: '3.1.2', name: 'Language of Parts', level: 'AA', required: 'all',
            description: 'The human language of each passage or phrase can be programmatically determined, except for proper names, technical terms, or words of indeterminate language.' },
        ],
      },
      {
        id: '3.2',
        name: 'Predictable',
        criteria: [
          { id: '3.2.1', name: 'On Focus', level: 'A', required: 'all',
            description: 'When any UI component receives focus, it does not initiate a change of context (e.g. navigating to a new page, moving focus elsewhere, or significantly altering content).' },
          { id: '3.2.2', name: 'On Input', level: 'A', required: 'all',
            description: 'Changing the setting of any UI component does not automatically cause a change of context unless the user has been advised of the behavior beforehand.' },
          { id: '3.2.3', name: 'Consistent Navigation', level: 'AA', required: 'all',
            description: 'Navigational mechanisms that are repeated on multiple pages appear in the same relative order each time, unless the user initiates a change.' },
          { id: '3.2.4', name: 'Consistent Identification', level: 'AA', required: 'all',
            description: 'Components that have the same functionality within a set of pages are identified consistently (e.g. a search field is always labeled "Search" across the site).' },
        ],
      },
      {
        id: '3.3',
        name: 'Input Assistance',
        criteria: [
          { id: '3.3.1', name: 'Error Identification', level: 'A', required: 'all',
            description: 'If an input error is automatically detected, the item in error is identified and the error is described to the user in text.' },
          { id: '3.3.2', name: 'Labels or Instructions', level: 'A', required: 'all',
            description: 'Labels or instructions are provided when content requires user input (e.g. form fields have visible labels, required fields are indicated, expected formats are described).' },
          { id: '3.3.3', name: 'Error Suggestion', level: 'AA', required: 'all',
            description: 'If an input error is automatically detected and suggestions for correction are known, the suggestions are provided to the user — unless it would jeopardize security or purpose.' },
          { id: '3.3.4', name: 'Error Prevention (Legal, Financial, Data)', level: 'AA', required: 'all',
            description: 'For pages with legal commitments, financial transactions, or user data modifications, submissions are reversible, data is checked for errors with a chance to correct, or a confirmation mechanism is provided.' },
        ],
      },
    ],
  },
  {
    id: '4',
    name: 'Robust',
    guidelines: [
      {
        id: '4.1',
        name: 'Compatible',
        criteria: [
          { id: '4.1.1', name: 'Parsing', level: 'A', required: 'all',
            description: 'Content implemented using markup languages has complete start/end tags, elements are nested according to spec, no duplicate attributes, and IDs are unique — ensuring reliable assistive technology parsing.' },
          { id: '4.1.2', name: 'Name, Role, Value', level: 'A', required: 'all',
            description: 'For all UI components, the name and role can be programmatically determined; states, properties, and values can be programmatically set; and changes are communicated to user agents and assistive technologies.' },
          { id: '4.1.3', name: 'Status Messages', level: 'AA', required: 'all',
            description: 'Status messages (success confirmations, error messages, progress updates) can be programmatically determined through role or properties so they are announced by assistive technologies without receiving focus.' },
        ],
      },
    ],
  },
];

/**
 * Parse an axe-core tag like 'wcag1412' into '1.4.12'.
 * Returns null for non-criterion tags (e.g. 'wcag2a', 'best-practice').
 */
export function parseWcagTag(tag) {
  const match = tag.match(/^wcag(\d)(\d)(\d+)$/);
  if (!match) return null;
  return `${match[1]}.${match[2]}.${match[3]}`;
}

/**
 * Build a flat lookup: criterionId → { name, level, required, guidelineId, guidelineName, principleId, principleName }
 */
export function buildCriteriaLookup() {
  const lookup = {};
  for (const principle of WCAG_PRINCIPLES) {
    for (const guideline of principle.guidelines) {
      for (const criterion of guideline.criteria) {
        lookup[criterion.id] = {
          ...criterion,
          guidelineId: guideline.id,
          guidelineName: guideline.name,
          principleId: principle.id,
          principleName: principle.name,
        };
      }
    }
  }
  return lookup;
}
