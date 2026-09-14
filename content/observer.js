/**
 * OriginFill — Multi-Page Form Observer
 * Watches for SPA navigation and new form sections appearing.
 * Detects page transitions in Workday's multi-step application flow.
 * Intercepts pushState/replaceState/popstate/hashchange for reliable SPA tracking.
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

  /** @type {string} Last full URL */
  let _lastUrl = '';

  /** @type {number} Last known form field count */
  let _lastFieldCount = 0;

  /** @type {boolean} Observer is active */
  let _active = false;

  /** @type {Object} Track fill state per page */
  let _pageStates = {};

  /** @type {Object} Stored options reference for dynamic updates */
  let _options = {
    onPageChange: () => {},
    autoFillOnChange: false,
    profile: null,
    portalType: OriginFillPortals.GENERIC
  };

  /** @type {boolean} Whether history interceptors are installed */
  let _historyIntercepted = false;

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

    _options = {
      onPageChange: options.onPageChange || (() => {}),
      autoFillOnChange: options.autoFillOnChange || false,
      profile: options.profile || null,
      portalType: options.portalType || OriginFillPortals.GENERIC
    };

    // Record initial state
    _lastHash = window.location.hash;
    _lastUrl = window.location.href;
    _lastPageName = detectCurrentPage(_options.portalType);
    _lastFieldCount = countFormFields();

    // Listen for URL hash changes
    window.addEventListener('hashchange', handleHashChange);

    // Listen for popstate (SPA back/forward navigation)
    window.addEventListener('popstate', handlePopState);

    // Intercept pushState and replaceState for SPA navigation
    interceptHistoryMethods();

    // Set up MutationObserver
    _observer = new MutationObserver((mutations) => {
      // Debounce rapid DOM changes
      if (_debounceTimer) {
        clearTimeout(_debounceTimer);
      }

      _debounceTimer = setTimeout(() => {
        handleDOMMutation(mutations);
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
      pageNumber: getPageNumber(_options.portalType),
      totalPages: getTotalPages(_options.portalType),
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
    window.removeEventListener('popstate', handlePopState);

    // Restore original history methods
    restoreHistoryMethods();

    _active = false;
    OriginFillLogger.info('Multi-page observer stopped');
  }

  // ─── History Interception ──────────────────────────────────────

  /** @type {Function|null} Original pushState */
  let _origPushState = null;

  /** @type {Function|null} Original replaceState */
  let _origReplaceState = null;

  /**
   * Intercept history.pushState and history.replaceState to detect SPA navigation.
   * This is necessary because popstate only fires on back/forward, not on programmatic pushState.
   */
  function interceptHistoryMethods() {
    if (_historyIntercepted) return;

    _origPushState = history.pushState;
    _origReplaceState = history.replaceState;

    history.pushState = function(...args) {
      _origPushState.apply(this, args);
      onHistoryChange('pushState');
    };

    history.replaceState = function(...args) {
      _origReplaceState.apply(this, args);
      onHistoryChange('replaceState');
    };

    _historyIntercepted = true;
    OriginFillLogger.debug('History methods intercepted');
  }

  /**
   * Restore original history methods on stop.
   */
  function restoreHistoryMethods() {
    if (!_historyIntercepted) return;

    if (_origPushState) {
      history.pushState = _origPushState;
      _origPushState = null;
    }
    if (_origReplaceState) {
      history.replaceState = _origReplaceState;
      _origReplaceState = null;
    }

    _historyIntercepted = false;
    OriginFillLogger.debug('History methods restored');
  }

  /**
   * Called when pushState or replaceState is invoked.
   * @param {string} source - 'pushState' or 'replaceState'
   */
  function onHistoryChange(source) {
    const newUrl = window.location.href;
    if (newUrl !== _lastUrl) {
      OriginFillLogger.debug(`${source} detected: ${_lastUrl} → ${newUrl}`);
      _lastUrl = newUrl;
      _lastHash = window.location.hash;

      // Delay slightly to let DOM update after history change
      setTimeout(() => {
        triggerPageTransition();
      }, 200);
    }
  }

  // ─── Change Detection Handlers ─────────────────────────────────

  /**
   * Handle URL hash changes (Workday uses #step=N patterns).
   * Fixed: Now calls handlePageTransition directly instead of being a no-op.
   */
  function handleHashChange() {
    const newHash = window.location.hash;
    if (newHash !== _lastHash) {
      OriginFillLogger.debug(`Hash changed: ${_lastHash} → ${newHash}`);
      _lastHash = newHash;
      _lastUrl = window.location.href;
      triggerPageTransition();
    }
  }

  /**
   * Handle popstate events (browser back/forward).
   */
  function handlePopState() {
    _lastUrl = window.location.href;
    _lastHash = window.location.hash;
    triggerPageTransition();
  }

  /**
   * Handle DOM mutations that might indicate a page change.
   * @param {MutationRecord[]} mutations
   */
  function handleDOMMutation(mutations) {
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
      triggerPageTransition();
    }
  }

  /**
   * Trigger a page transition check using current options.
   * Centralized handler that all navigation events funnel through.
   */
  function triggerPageTransition() {
    handlePageTransition(
      _options.onPageChange,
      _options.autoFillOnChange,
      _options.profile,
      _options.portalType
    );
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

  // ─── Profile Update Propagation ────────────────────────────────

  /**
   * Update the profile used by the observer.
   * Called when the user switches active profile from the popup.
   *
   * @param {Object} newProfile - New active profile
   */
  function updateProfile(newProfile) {
    _options.profile = newProfile;
    OriginFillLogger.debug('Observer profile updated');
  }

  /**
   * Update the portal type (e.g., after re-detection).
   * @param {string} newPortalType
   */
  function updatePortalType(newPortalType) {
    _options.portalType = newPortalType;
    OriginFillLogger.debug(`Observer portal type updated: ${newPortalType}`);
  }

  /**
   * Update auto-fill settings.
   * @param {boolean} autoFill
   */
  function setAutoFillOnChange(autoFill) {
    _options.autoFillOnChange = autoFill;
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
    getAllPageStates,

    // Dynamic update methods
    updateProfile,
    updatePortalType,
    setAutoFillOnChange
  });
})();
