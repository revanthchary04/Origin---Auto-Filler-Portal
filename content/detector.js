/**
 * OriginFill — Portal Detection Engine
 * Automatically detect which job portal the user is on.
 * Uses URL patterns + DOM confirmation for confidence scoring.
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

const OriginFillDetector = (() => {
  'use strict';

  /** @type {{ type: string, confidence: string, pageName: string, url: string } | null} */
  let _lastDetection = null;

  // ─── URL-Based Detection ───────────────────────────────────────

  /**
   * Detect portal type from URL.
   * @param {string} url
   * @returns {{ type: string, confidence: string } | null}
   */
  function detectFromURL(url) {
    if (!url) return null;

    try {
      const hostname = window.location.hostname || new URL(url).hostname;
      if (
        hostname.endsWith('myworkdayjobs.com') ||
        hostname.endsWith('myworkday.com') ||
        hostname.includes('workday')
      ) {
        return { type: OriginFillPortals.WORKDAY, confidence: OriginFillConfidence.MEDIUM };
      }
      if (hostname.endsWith('greenhouse.io') || hostname.includes('greenhouse')) {
        return { type: OriginFillPortals.GREENHOUSE, confidence: OriginFillConfidence.MEDIUM };
      }
      if (hostname.endsWith('lever.co') || hostname.includes('lever')) {
        return { type: OriginFillPortals.LEVER, confidence: OriginFillConfidence.MEDIUM };
      }
      if (hostname.endsWith('icims.com') || hostname.includes('icims')) {
        return { type: OriginFillPortals.ICIMS, confidence: OriginFillConfidence.MEDIUM };
      }
      if (hostname.endsWith('taleo.net') || hostname.includes('taleo')) {
        return { type: OriginFillPortals.TALEO, confidence: OriginFillConfidence.MEDIUM };
      }
    } catch (e) {
      // Fall through to regex patterns
    }

    for (const { type, pattern } of OriginFillPortalPatterns) {
      if (pattern.test(url)) {
        return { type, confidence: OriginFillConfidence.MEDIUM };
      }
    }

    return null;
  }

  // ─── DOM-Based Confirmation ────────────────────────────────────

  /**
   * Confirm portal type by inspecting DOM structure.
   * Each portal has unique DOM fingerprints.
   *
   * @param {string} portalType - Suspected portal type from URL detection
   * @returns {{ confirmed: boolean, pageName: string, confidence: string }}
   */
  function confirmFromDOM(portalType) {
    switch (portalType) {
      case OriginFillPortals.WORKDAY:
        return confirmWorkday();
      case OriginFillPortals.GREENHOUSE:
        return confirmGreenhouse();
      case OriginFillPortals.LEVER:
        return confirmLever();
      case OriginFillPortals.ICIMS:
        return confirmICIMS();
      case OriginFillPortals.TALEO:
        return confirmTaleo();
      default:
        return { confirmed: false, pageName: '', confidence: OriginFillConfidence.NONE };
    }
  }

  /**
   * Confirm Workday portal.
   * Workday uses `data-automation-id` attributes extensively.
   */
  function confirmWorkday() {
    // Look for Workday's signature attributes
    const automationElements = document.querySelectorAll('[data-automation-id]');
    const hasAutomationIds = automationElements.length > 0;

    // Workday-specific class patterns
    const hasWorkdayClasses = document.querySelector(
      '.css-1jq6fqx, .WJLK, [data-automation-id="applicationForm"], [data-automation-id="jobPostingPage"]'
    ) !== null;

    // Detect which page of the application form we're on
    let pageName = detectWorkdayPage();

    const hostname = window.location.hostname || '';
    const isWorkdayDomain = hostname.endsWith('myworkdayjobs.com') || hostname.endsWith('myworkday.com') || hostname.includes('workday');

    const confirmed = hasAutomationIds || hasWorkdayClasses || isWorkdayDomain;
    return {
      confirmed,
      pageName,
      confidence: (hasAutomationIds || hasWorkdayClasses)
        ? OriginFillConfidence.HIGH
        : (isWorkdayDomain ? OriginFillConfidence.MEDIUM : OriginFillConfidence.NONE)
    };
  }

  /**
   * Detect which page of a Workday multi-step form is active.
   * @returns {string}
   */
  function detectWorkdayPage() {
    // Check URL hash for step indicators
    const hash = window.location.hash;
    const stepMatch = hash.match(/step[=:]?(\d+)/i);
    if (stepMatch) {
      const stepNum = parseInt(stepMatch[1], 10);
      const stepNames = ['My Information', 'My Experience', 'Application Questions', 'Review', 'Submit'];
      return stepNames[stepNum - 1] || `Step ${stepNum}`;
    }

    // Check for section headers in DOM
    const sectionHeaders = [
      { selector: '[data-automation-id="legalNameSection"]', name: 'Personal Information' },
      { selector: '[data-automation-id="educationSection"]', name: 'Education' },
      { selector: '[data-automation-id="workExperienceSection"]', name: 'Work Experience' },
      { selector: '[data-automation-id="resumeSection"]', name: 'Resume' },
      { selector: '[data-automation-id="questionSection"]', name: 'Application Questions' },
      { selector: '[data-automation-id="reviewSection"]', name: 'Review & Submit' }
    ];

    const visibleSections = [];
    for (const { selector, name } of sectionHeaders) {
      const el = document.querySelector(selector);
      if (el && isVisible(el)) {
        visibleSections.push(name);
      }
    }

    if (visibleSections.length > 0) {
      return visibleSections.join(', ');
    }

    // Fallback: check h2/h3 text content
    const headings = document.querySelectorAll('h2, h3');
    for (const h of headings) {
      const text = h.textContent.trim().toLowerCase();
      if (text.includes('my information') || text.includes('personal')) return 'Personal Information';
      if (text.includes('experience')) return 'Work Experience';
      if (text.includes('education')) return 'Education';
      if (text.includes('question')) return 'Application Questions';
      if (text.includes('review') || text.includes('submit')) return 'Review & Submit';
    }

    return 'Application Form';
  }

  /**
   * Confirm Greenhouse portal.
   */
  function confirmGreenhouse() {
    const hasAppForm = document.querySelector('#application') !== null
      || document.querySelector('#application_form') !== null
      || document.querySelector('.application--form') !== null;

    return {
      confirmed: hasAppForm,
      pageName: hasAppForm ? 'Application Form' : '',
      confidence: hasAppForm ? OriginFillConfidence.HIGH : OriginFillConfidence.NONE
    };
  }

  /**
   * Confirm Lever portal.
   */
  function confirmLever() {
    const hasLeverForm = document.querySelector('.application-form') !== null
      || document.querySelector('.application-page') !== null
      || document.querySelector('[class*="lever"]') !== null;

    return {
      confirmed: hasLeverForm,
      pageName: hasLeverForm ? 'Application Form' : '',
      confidence: hasLeverForm ? OriginFillConfidence.HIGH : OriginFillConfidence.NONE
    };
  }

  /**
   * Confirm iCIMS portal.
   */
  function confirmICIMS() {
    const hasICIMS = document.querySelector('.iCIMS_MainWrapper') !== null
      || document.querySelector('[id*="icims"]') !== null;

    return {
      confirmed: hasICIMS,
      pageName: hasICIMS ? 'Application Form' : '',
      confidence: hasICIMS ? OriginFillConfidence.HIGH : OriginFillConfidence.NONE
    };
  }

  /**
   * Confirm Taleo portal.
   */
  function confirmTaleo() {
    const hasTaleo = document.querySelector('.taleo-form') !== null
      || document.querySelector('[id*="taleo"]') !== null
      || document.querySelector('form[action*="taleo"]') !== null;

    return {
      confirmed: hasTaleo,
      pageName: hasTaleo ? 'Application Form' : '',
      confidence: hasTaleo ? OriginFillConfidence.HIGH : OriginFillConfidence.NONE
    };
  }

  // ─── Generic Portal Detection ─────────────────────────────────

  /**
   * Attempt generic detection on unknown sites.
   * Looks for forms with job-related input fields.
   *
   * @returns {{ type: string, confidence: string, pageName: string }}
   */
  function detectGeneric() {
    const forms = document.querySelectorAll('form');
    if (forms.length === 0) {
      return {
        type: OriginFillPortals.NONE,
        confidence: OriginFillConfidence.NONE,
        pageName: ''
      };
    }

    // Job-related keywords in labels, placeholders, names
    const jobKeywords = [
      'first name', 'last name', 'email', 'phone', 'resume', 'cv',
      'cover letter', 'linkedin', 'experience', 'education', 'university',
      'college', 'degree', 'company', 'job title', 'position', 'salary',
      'work authorization', 'visa', 'sponsor', 'start date'
    ];

    let matchCount = 0;
    let totalFields = 0;

    forms.forEach(form => {
      const inputs = form.querySelectorAll('input, select, textarea');
      inputs.forEach(input => {
        totalFields++;

        const label = getInputLabel(input).toLowerCase();
        const placeholder = (input.placeholder || '').toLowerCase();
        const name = (input.name || '').toLowerCase();
        const id = (input.id || '').toLowerCase();

        const combined = `${label} ${placeholder} ${name} ${id}`;

        for (const keyword of jobKeywords) {
          if (combined.includes(keyword)) {
            matchCount++;
            break;
          }
        }
      });
    });

    if (totalFields === 0) {
      return {
        type: OriginFillPortals.NONE,
        confidence: OriginFillConfidence.NONE,
        pageName: ''
      };
    }

    const matchRatio = matchCount / totalFields;

    if (matchRatio >= 0.3) {
      return {
        type: OriginFillPortals.GENERIC,
        confidence: matchRatio >= 0.5 ? OriginFillConfidence.MEDIUM : OriginFillConfidence.LOW,
        pageName: 'Application Form'
      };
    }

    return {
      type: OriginFillPortals.NONE,
      confidence: OriginFillConfidence.NONE,
      pageName: ''
    };
  }

  // ─── Utility ───────────────────────────────────────────────────

  /**
   * Get the visible label text for an input element.
   * @param {HTMLElement} input
   * @returns {string}
   */
  function getInputLabel(input) {
    // 1. Explicit <label for="...">
    if (input.id) {
      const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      if (label) return label.textContent.trim();
    }

    // 2. Parent <label>
    const parentLabel = input.closest('label');
    if (parentLabel) {
      // Clone and remove the input to get just the label text
      const clone = parentLabel.cloneNode(true);
      const childInputs = clone.querySelectorAll('input, select, textarea');
      childInputs.forEach(el => el.remove());
      return clone.textContent.trim();
    }

    // 3. aria-label
    const ariaLabel = input.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim();

    // 4. aria-labelledby
    const ariaLabelledBy = input.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      const labelEl = document.getElementById(ariaLabelledBy);
      if (labelEl) return labelEl.textContent.trim();
    }

    // 5. Previous sibling text
    const prevSibling = input.previousElementSibling;
    if (prevSibling && (prevSibling.tagName === 'LABEL' || prevSibling.tagName === 'SPAN')) {
      return prevSibling.textContent.trim();
    }

    // 6. Placeholder
    return input.placeholder || '';
  }

  /**
   * Check if an element is visible in the DOM.
   * @param {HTMLElement} el
   * @returns {boolean}
   */
  function isVisible(el) {
    if (!el) return false;

    const style = window.getComputedStyle(el);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0' &&
      el.offsetParent !== null
    );
  }

  // ─── Master Detection Function ────────────────────────────────

  /**
   * Run full portal detection on the current page.
   * @returns {{ type: string, confidence: string, pageName: string, url: string }}
   */
  function detect() {
    const url = window.location.href;

    // 1. URL-based detection
    const urlResult = detectFromURL(url);

    if (urlResult) {
      // 2. DOM confirmation for known portals
      const domResult = confirmFromDOM(urlResult.type);

      const detection = {
        type: urlResult.type,
        confidence: domResult.confirmed
          ? OriginFillConfidence.HIGH
          : urlResult.confidence,
        pageName: domResult.pageName || 'Application Form',
        url
      };

      _lastDetection = detection;
      OriginFillLogger.info(
        `Portal detected: ${detection.type} (${detection.confidence})`,
        detection.pageName
      );

      return detection;
    }

    // 3. Generic detection for unknown portals
    const genericResult = detectGeneric();
    const detection = {
      type: genericResult.type,
      confidence: genericResult.confidence,
      pageName: genericResult.pageName,
      url
    };

    _lastDetection = detection;

    if (detection.type !== OriginFillPortals.NONE) {
      OriginFillLogger.info(
        `Generic portal detected (${detection.confidence})`,
        detection.pageName
      );
    }

    return detection;
  }

  /**
   * Get the last detection result (cached).
   * @returns {{ type: string, confidence: string, pageName: string, url: string } | null}
   */
  function getLastDetection() {
    return _lastDetection;
  }

  /**
   * Get a display name for a portal type.
   * @param {string} type
   * @returns {string}
   */
  function getPortalDisplayName(type) {
    const names = {
      [OriginFillPortals.WORKDAY]: 'Workday',
      [OriginFillPortals.GREENHOUSE]: 'Greenhouse',
      [OriginFillPortals.LEVER]: 'Lever',
      [OriginFillPortals.ICIMS]: 'iCIMS',
      [OriginFillPortals.TALEO]: 'Taleo',
      [OriginFillPortals.GENERIC]: 'Generic Portal',
      [OriginFillPortals.NONE]: 'No Portal'
    };
    return names[type] || 'Unknown';
  }

  // ─── Public API ─────────────────────────────────────────────────
  return Object.freeze({
    detect,
    getLastDetection,
    getPortalDisplayName,
    getInputLabel,
    isVisible,

    // Exposed for on-demand generic detection via chrome.scripting
    detectGeneric,
    detectFromURL,
    confirmFromDOM,
    detectWorkdayPage
  });
})();
