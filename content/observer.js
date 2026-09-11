/**
 * OriginFill — Multi-Page Form Observer
 * Watches for SPA navigation and new form sections appearing.
 * Detects page transitions in Workday's multi-step application flow.
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

const OriginFillObserver = (() => {
  'use strict';

  /** @type {MutationObserver|null} */
  let _observer = null;

  /** @type {number} Debounce timer ID */
  let _debounceTimer = null;

  /** @type {string} Last detected page/section name */
  let _lastPageName = '';

  /** @type {string} Last URL hash */
  let _lastHash = '';

  /** @type {number} Last known form field count */
  let _lastFieldCount = 0;

  /** @type {boolean} Observer is active */
  let _active = false;

  /** @type {Object} Track fill state per page */
  let _pageStates = {};

  // ─── Observer Setup ────────────────────────────────────────────

  /**
   * Start observing the page for multi-step form changes.
   *
   * @param {Object} [options]
   * @param {Function} [options.onPageChange] - Callback when page change detected
   * @param {boolean} [options.autoFillOnChange] - Auto-fill new fields on page change
   * @param {Object} [options.profile] - Active profile for auto-fill
   * @param {string} [options.portalType] - Detected portal type
   */
  function start(options = {}) {
    if (_active) {
      OriginFillLogger.debug('Observer already active');
      return;
    }

    const {
      onPageChange = () => {},
      autoFillOnChange = false,
      profile = null,
      portalType = OriginFillPortals.GENERIC
    } = options;

    // Record initial state
    _lastHash = window.location.hash;
    _lastPageName = detectCurrentPage(portalType);
    _lastFieldCount = countFormFields();

    // Listen for URL hash changes
    window.addEventListener('hashchange', handleHashChange);

    // Listen for popstate (SPA history navigation)
    window.addEventListener('popstate', () => {
      handlePageTransition(onPageChange, autoFillOnChange, profile, portalType);
    });

    // Set up MutationObserver
    _observer = new MutationObserver((mutations) => {
      // Debounce rapid DOM changes
      if (_debounceTimer) {
        clearTimeout(_debounceTimer);
      }

      _debounceTimer = setTimeout(() => {
        handleDOMMutation(mutations, onPageChange, autoFillOnChange, profile, portalType);
      }, OriginFillTiming.OBSERVER_DEBOUNCE);
    });

    _observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false
    });

    _active = true;
    OriginFillLogger.info('Multi-page observer started');

    // Send initial page info
    sendMessage(OriginFillMessages.PAGE_CHANGED, {
      pageName: _lastPageName,
      pageNumber: getPageNumber(portalType),
      totalPages: getTotalPages(portalType),
      fieldCount: _lastFieldCount
    });
  }

  /**
   * Stop the observer and clean up.
   */
  function stop() {
    if (_observer) {
      _observer.disconnect();
      _observer = null;
    }

    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }

    window.removeEventListener('hashchange', handleHashChange);

    _active = false;
    OriginFillLogger.info('Multi-page observer stopped');
  }

  // ─── Change Detection Handlers ─────────────────────────────────

  /**
   * Handle URL hash changes (Workday uses #step=N patterns).
   */
  function handleHashChange() {
    const newHash = window.location.hash;
    if (newHash !== _lastHash) {
      OriginFillLogger.debug(`Hash changed: ${_lastHash} → ${newHash}`);
      _lastHash = newHash;
      // Will be picked up by the mutation observer or directly
    }
  }

  /**
   * Handle DOM mutations that might indicate a page change.
   *
   * @param {MutationRecord[]} mutations
   * @param {Function} onPageChange
   * @param {boolean} autoFillOnChange
   * @param {Object} profile
   * @param {string} portalType
   */
  function handleDOMMutation(mutations, onPageChange, autoFillOnChange, profile, portalType) {
    // Check if significant DOM changes occurred
    let significantChange = false;

    for (const mutation of mutations) {
      if (mutation.addedNodes.length > 0) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if new form elements appeared
            if (node.tagName === 'FORM' ||
                node.querySelector?.('input, select, textarea, [data-automation-id]')) {
              significantChange = true;
              break;
            }

            // Check for new section containers
            if (node.querySelector?.('[role="group"], fieldset, [class*="section"]')) {
              significantChange = true;
              break;
            }
          }
        }
      }

      if (significantChange) break;
    }

    if (significantChange) {
      handlePageTransition(onPageChange, autoFillOnChange, profile, portalType);
    }
  }

  /**
   * Handle a detected page transition.
   *
   * @param {Function} onPageChange
   * @param {boolean} autoFillOnChange
   * @param {Object} profile
   * @param {string} portalType
   */
  function handlePageTransition(onPageChange, autoFillOnChange, profile, portalType) {
    const currentPage = detectCurrentPage(portalType);
    const currentFieldCount = countFormFields();

    // Only trigger if page actually changed
    if (currentPage === _lastPageName && currentFieldCount === _lastFieldCount) {
      return;
    }

    OriginFillLogger.info(`Page change detected: "${_lastPageName}" → "${currentPage}"`);

    _lastPageName = currentPage;
    _lastFieldCount = currentFieldCount;

    const pageInfo = {
      pageName: currentPage,
      pageNumber: getPageNumber(portalType),
      totalPages: getTotalPages(portalType),
      fieldCount: currentFieldCount
    };

    // Notify popup and background
    sendMessage(OriginFillMessages.PAGE_CHANGED, pageInfo);

    // Call user callback
    onPageChange(pageInfo);

    // Auto-fill if enabled
    if (autoFillOnChange && profile) {
      OriginFillLogger.info(`Auto-filling new page: ${currentPage}`);

      // Small delay to let fields fully render
      setTimeout(async () => {
        const report = await OriginFillFiller.fillAll(profile, portalType, {
          section: OriginFillSections.ALL,
          fillDelay: OriginFillTiming.FILL_DELAY_DEFAULT
        });

        // Track page state
        _pageStates[currentPage] = {
          filled: true,
          report,
          timestamp: Date.now()
        };
      }, 500);
    }
  }

  // ─── Page Detection ────────────────────────────────────────────

  /**
   * Detect the current page/section name.
   *
   * @param {string} portalType
   * @returns {string}
   */
  function detectCurrentPage(portalType) {
    if (portalType === OriginFillPortals.WORKDAY) {
      return OriginFillDetector.detectWorkdayPage();
    }

    // Generic: use heading text or URL
    const headings = document.querySelectorAll('h1, h2, h3');
    for (const h of headings) {
      if (OriginFillDetector.isVisible(h)) {
        const text = h.textContent.trim();
        if (text.length > 0 && text.length < 100) {
          return text;
        }
      }
    }

    // Use URL path as fallback
    const path = window.location.pathname;
    const lastSegment = path.split('/').filter(Boolean).pop() || '';
    return lastSegment.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Application Form';
  }

  /**
   * Get the current page number (for Workday step indicators).
   * @param {string} portalType
   * @returns {number}
   */
  function getPageNumber(portalType) {
    if (portalType === OriginFillPortals.WORKDAY) {
      // Check URL hash for step number
      const hash = window.location.hash;
      const match = hash.match(/step[=:]?(\d+)/i);
      if (match) return parseInt(match[1], 10);

      // Check progress indicators
      const activeStep = document.querySelector(
        '[data-automation-id="progressBar"] .active, ' +
        '.css-progress-active, ' +
        '[aria-current="step"]'
      );
      if (activeStep) {
        const siblings = activeStep.parentElement?.children;
        if (siblings) {
          return Array.from(siblings).indexOf(activeStep) + 1;
        }
      }
    }

    return 1;
  }

  /**
   * Get the total number of pages.
   * @param {string} portalType
   * @returns {number}
   */
  function getTotalPages(portalType) {
    if (portalType === OriginFillPortals.WORKDAY) {
      const progressSteps = document.querySelectorAll(
        '[data-automation-id="progressBar"] > *, ' +
        '.css-progress-step, ' +
        '[role="progressbar"] > *'
      );
      if (progressSteps.length > 0) return progressSteps.length;
    }

    return 1; // Unknown
  }

  /**
   * Count visible form fields on the page.
   * @returns {number}
   */
  function countFormFields() {
    const fields = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea'
    );

    return Array.from(fields).filter(f => OriginFillDetector.isVisible(f)).length;
  }

  // ─── Page State ────────────────────────────────────────────────

  /**
   * Get fill state for a specific page.
   * @param {string} pageName
   * @returns {Object|null}
   */
  function getPageState(pageName) {
    return _pageStates[pageName] || null;
  }

  /**
   * Get all page states.
   * @returns {Object}
   */
  function getAllPageStates() {
    return { ..._pageStates };
  }

  /**
   * Check if the observer is currently active.
   * @returns {boolean}
   */
  function isActive() {
    return _active;
  }

  // ─── Utility ───────────────────────────────────────────────────

  /**
   * Send message to popup/background.
   * @param {string} type
   * @param {Object} data
   */
  function sendMessage(type, data) {
    try {
      chrome.runtime.sendMessage({ type, data });
    } catch (err) {
      OriginFillLogger.debug('Observer message failed:', err.message);
    }
  }

  // ─── Public API ─────────────────────────────────────────────────
  return Object.freeze({
    start,
    stop,
    isActive,
    detectCurrentPage,
    getPageNumber,
    getTotalPages,
    countFormFields,
    getPageState,
    getAllPageStates
  });
})();
