/**
 * OriginFill — Session Timeout Detection & Recovery Guard
 * Detects session timeouts via URL redirects, DOM changes, and form disappearance.
 * Saves field snapshots on blur events for instant recovery.
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

const OriginFillSessionGuard = (() => {
  'use strict';

  /** @type {boolean} Guard is active */
  let _active = false;

  /** @type {string} URL of the active application page */
  let _applicationUrl = '';

  /** @type {string} Detected portal type */
  let _portalType = '';

  /** @type {MutationObserver|null} DOM watcher for login forms */
  let _domObserver = null;

  /** @type {number} URL check interval ID */
  let _urlCheckInterval = null;

  /** @type {number} Debounce timer for blur snapshots */
  let _blurDebounce = null;

  /** @type {boolean} Whether a timeout has already been detected */
  let _timeoutDetected = false;

  // ─── Session Timeout Keywords ──────────────────────────────────

  const TIMEOUT_URL_PATTERNS = [
    /\/login/i,
    /\/signin/i,
    /\/sign-in/i,
    /\/session[-_]?expired/i,
    /\/session[-_]?timeout/i,
    /\/authenticate/i,
    /\/sso\//i,
    /\/auth\//i,
    /\/logout/i,
    /returnurl=/i
  ];

  const TIMEOUT_DOM_TEXT = [
    'session has expired',
    'session expired',
    'session timed out',
    'session timeout',
    'your session has ended',
    'you have been logged out',
    'been signed out',
    'been logged out',
    'please log in again',
    'please sign in again',
    'login to continue',
    'sign in to continue',
    'for security reasons',
    'inactivity'
  ];

  // ─── Guard Lifecycle ───────────────────────────────────────────

  /**
   * Start the session guard.
   *
   * @param {Object} options
   * @param {string} options.portalType - Detected portal type
   * @param {string} [options.applicationUrl] - Current application URL
   */
  function start(options = {}) {
    if (_active) {
      OriginFillLogger.debug('Session guard already active');
      return;
    }

    _portalType = options.portalType || '';
    _applicationUrl = options.applicationUrl || window.location.href;
    _timeoutDetected = false;

    // 1. Watch for URL redirects to login pages
    startURLWatch();

    // 2. Watch DOM for login forms or timeout messages
    startDOMWatch();

    // 3. Attach blur event handlers for field snapshots
    attachBlurHandlers();

    _active = true;
    OriginFillLogger.info('Session guard started');
  }

  /**
   * Stop the session guard and clean up all watchers.
   */
  function stop() {
    if (_urlCheckInterval) {
      clearInterval(_urlCheckInterval);
      _urlCheckInterval = null;
    }

    if (_domObserver) {
      _domObserver.disconnect();
      _domObserver = null;
    }

    if (_blurDebounce) {
      clearTimeout(_blurDebounce);
      _blurDebounce = null;
    }

    detachBlurHandlers();

    _active = false;
    OriginFillLogger.info('Session guard stopped');
  }

  // ─── Method 1: URL Redirect Monitoring ─────────────────────────

  /**
   * Periodically check if the URL has changed to a login page.
   */
  function startURLWatch() {
    // Check immediately
    checkURLForTimeout();

    // Then check periodically (every 5 seconds — lightweight)
    _urlCheckInterval = setInterval(checkURLForTimeout, 5000);

    // Also listen for navigation events
    window.addEventListener('beforeunload', handleBeforeUnload);
  }

  /**
   * Check the current URL for timeout indicators.
   */
  function checkURLForTimeout() {
    const currentUrl = window.location.href;

    // Skip if we're still on the application page
    if (currentUrl === _applicationUrl) return;

    // Check for login/timeout URL patterns
    for (const pattern of TIMEOUT_URL_PATTERNS) {
      if (pattern.test(currentUrl)) {
        OriginFillLogger.warn(`Session timeout detected via URL redirect: ${currentUrl}`);
        onTimeoutDetected('url_redirect');
        return;
      }
    }
  }

  /**
   * Handle beforeunload — save snapshot before navigation.
   */
  function handleBeforeUnload() {
    // Save a final snapshot before the page unloads
    saveSnapshotNow();
  }

  // ─── Method 2: DOM Monitoring ──────────────────────────────────

  /**
   * Watch for login forms or "session expired" messages appearing in the DOM.
   */
  function startDOMWatch() {
    _domObserver = new MutationObserver((mutations) => {
      if (_timeoutDetected) return;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            checkNodeForTimeout(node);
          }
        }
      }
    });

    _domObserver.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Also check current DOM state
    checkNodeForTimeout(document.body);
  }

  /**
   * Check a DOM node (and its text content) for timeout indicators.
   *
   * @param {HTMLElement} node
   */
  function checkNodeForTimeout(node) {
    if (_timeoutDetected) return;

    // Check for login form appearing
    const loginForm = node.querySelector?.(
      'form[action*="login"], form[action*="signin"], ' +
      'input[type="password"], ' +
      '[data-automation-id="signInForm"], ' +
      '#loginForm, #signInForm, .login-form'
    );

    if (loginForm && !isPartOfApplication(loginForm)) {
      OriginFillLogger.warn('Session timeout detected via login form appearance');
      onTimeoutDetected('login_form');
      return;
    }

    // Check text content for timeout messages
    const textContent = (node.textContent || '').toLowerCase().slice(0, 2000);

    for (const phrase of TIMEOUT_DOM_TEXT) {
      if (textContent.includes(phrase)) {
        OriginFillLogger.warn(`Session timeout detected via DOM text: "${phrase}"`);
        onTimeoutDetected('dom_text');
        return;
      }
    }

    // Check if all form fields disappeared (form count dropped to 0)
    const formFields = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="password"]), select, textarea'
    );
    const visibleFields = Array.from(formFields).filter(f => OriginFillDetector.isVisible(f));

    // If we had fields before and now they're gone, likely timeout
    if (_applicationUrl && visibleFields.length === 0) {
      const passwordFields = document.querySelectorAll('input[type="password"]');
      if (passwordFields.length > 0) {
        OriginFillLogger.warn('Session timeout detected: form fields gone, login form present');
        onTimeoutDetected('fields_gone');
      }
    }
  }

  /**
   * Check if a login form element is part of the application (not a timeout redirect).
   * Some applications have inline authentication sections.
   *
   * @param {HTMLElement} element
   * @returns {boolean}
   */
  function isPartOfApplication(element) {
    // If we're still on the application URL, inline login might be legitimate
    return window.location.href === _applicationUrl;
  }

  // ─── Method 3: Field Blur Snapshot ─────────────────────────────

  /**
   * Attach blur event handlers to all form fields.
   * Saves a snapshot on each field blur (debounced).
   */
  function attachBlurHandlers() {
    document.addEventListener('focusout', handleFieldBlur, true);
  }

  /**
   * Detach blur event handlers.
   */
  function detachBlurHandlers() {
    document.removeEventListener('focusout', handleFieldBlur, true);
  }

  /**
   * Handle field blur — debounce and save snapshot.
   *
   * @param {FocusEvent} event
   */
  function handleFieldBlur(event) {
    const target = event.target;

    // Only snapshot if the target is a form field
    if (!target || !['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
    if (target.type === 'hidden' || target.type === 'submit' || target.type === 'button') return;

    // Debounce — save at most once per 500ms
    if (_blurDebounce) {
      clearTimeout(_blurDebounce);
    }

    _blurDebounce = setTimeout(() => {
      saveSnapshotAsync();
    }, 500);
  }

  // ─── Snapshot Functions ────────────────────────────────────────

  /**
   * Save a field snapshot asynchronously.
   */
  async function saveSnapshotAsync() {
    try {
      const snapshot = OriginFillFiller.captureFieldSnapshot();
      const fieldCount = Object.keys(snapshot).length;

      if (fieldCount === 0) return;

      await chrome.storage.local.set({
        [OriginFillStorageKeys.SESSION_RECOVERY]: {
          lastUrl: window.location.href,
          lastPortal: _portalType,
          savedFields: snapshot,
          savedAt: new Date().toISOString()
        }
      });

      OriginFillLogger.debug(`Snapshot saved: ${fieldCount} fields`);
    } catch (err) {
      OriginFillLogger.error('Snapshot save failed:', err);
    }
  }

  /**
   * Save a snapshot synchronously (for beforeunload).
   * Uses sendBeacon-style approach since async storage may not complete.
   */
  function saveSnapshotNow() {
    try {
      const snapshot = OriginFillFiller.captureFieldSnapshot();
      if (Object.keys(snapshot).length > 0) {
        // Use synchronous approach — store in localStorage as backup
        const data = {
          lastUrl: window.location.href,
          lastPortal: _portalType,
          savedFields: snapshot,
          savedAt: new Date().toISOString()
        };

        try {
          localStorage.setItem('originfill_emergency_snapshot', JSON.stringify(data));
        } catch (e) {
          // localStorage might not be available
        }

        // Also try async storage (may not complete before unload)
        chrome.storage.local.set({
          [OriginFillStorageKeys.SESSION_RECOVERY]: data
        });
      }
    } catch (err) {
      // Suppress errors during unload
    }
  }

  // ─── Timeout Handler ───────────────────────────────────────────

  /**
   * Handle detected session timeout.
   *
   * @param {string} method - Detection method used
   */
  function onTimeoutDetected(method) {
    if (_timeoutDetected) return;
    _timeoutDetected = true;

    OriginFillLogger.warn(`⚠️ Session timeout detected via: ${method}`);

    // Save final snapshot
    saveSnapshotNow();

    // Notify background service worker
    sendMessage(OriginFillMessages.SESSION_TIMEOUT, {
      url: _applicationUrl,
      portal: _portalType,
      method,
      timestamp: new Date().toISOString()
    });

    // Show browser notification via background
    sendMessage('SHOW_NOTIFICATION', {
      title: '⚠️ Session Expired',
      message: `Session expired on ${OriginFillDetector.getPortalDisplayName(_portalType)}. OriginFill saved your data.`,
      url: _applicationUrl
    });
  }

  // ─── Recovery Check ────────────────────────────────────────────

  /**
   * Check if there's a session recovery available for the current page.
   * Called when a page loads and form is detected as empty.
   *
   * @returns {Promise<Object|null>} Recovery data, or null if none
   */
  async function checkRecoveryAvailable() {
    try {
      // Check chrome.storage first
      const result = await chrome.storage.local.get(OriginFillStorageKeys.SESSION_RECOVERY);
      let recovery = result[OriginFillStorageKeys.SESSION_RECOVERY];

      // Check localStorage emergency backup
      if (!recovery) {
        const emergency = localStorage.getItem('originfill_emergency_snapshot');
        if (emergency) {
          recovery = JSON.parse(emergency);
          // Move to chrome.storage
          await chrome.storage.local.set({
            [OriginFillStorageKeys.SESSION_RECOVERY]: recovery
          });
          localStorage.removeItem('originfill_emergency_snapshot');
        }
      }

      if (!recovery || !recovery.savedFields) return null;

      // Check if recovery is relevant to current page
      const currentUrl = window.location.href;
      const recoveryUrl = recovery.lastUrl;

      // Same domain check
      const currentDomain = new URL(currentUrl).hostname;
      const recoveryDomain = new URL(recoveryUrl).hostname;

      if (currentDomain !== recoveryDomain) return null;

      // Check age — expire after 24 hours
      const savedAt = new Date(recovery.savedAt);
      const age = Date.now() - savedAt.getTime();
      const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

      if (age > MAX_AGE) {
        OriginFillLogger.debug('Recovery data expired (>24h)');
        await clearRecovery();
        return null;
      }

      // Check if form is currently empty (fresh session)
      const currentSnapshot = OriginFillFiller.captureFieldSnapshot();
      const filledFieldCount = Object.values(currentSnapshot).filter(
        f => f.value && f.value !== '' && f.value !== false
      ).length;

      if (filledFieldCount > 3) {
        OriginFillLogger.debug('Form already has data, skipping recovery');
        return null;
      }

      const fieldCount = Object.keys(recovery.savedFields).length;
      OriginFillLogger.info(`Recovery available: ${fieldCount} fields from ${recovery.savedAt}`);

      return recovery;

    } catch (err) {
      OriginFillLogger.error('Recovery check failed:', err);
      return null;
    }
  }

  /**
   * Clear saved recovery data.
   * @returns {Promise<void>}
   */
  async function clearRecovery() {
    await chrome.storage.local.remove(OriginFillStorageKeys.SESSION_RECOVERY);
    localStorage.removeItem('originfill_emergency_snapshot');
    OriginFillLogger.debug('Recovery data cleared');
  }

  // ─── Utility ───────────────────────────────────────────────────

  /**
   * Check if the guard is active.
   * @returns {boolean}
   */
  function isActive() {
    return _active;
  }

  /**
   * Check if a timeout was detected.
   * @returns {boolean}
   */
  function wasTimeoutDetected() {
    return _timeoutDetected;
  }

  /**
   * Send message to background/popup.
   */
  function sendMessage(type, data) {
    try {
      chrome.runtime.sendMessage({ type, data });
    } catch (err) {
      OriginFillLogger.debug('Session guard message failed:', err.message);
    }
  }

  // ─── Public API ─────────────────────────────────────────────────
  return Object.freeze({
    start,
    stop,
    isActive,
    wasTimeoutDetected,
    checkRecoveryAvailable,
    clearRecovery,
    saveSnapshotAsync,
    saveSnapshotNow
  });
})();
