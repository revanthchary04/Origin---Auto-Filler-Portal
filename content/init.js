/**
 * OriginFill — Content Script Entry Point
 * Initializes portal detection, observer, session guard, and message handlers.
 * This file runs after all other content scripts are loaded (document_idle).
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

(function OriginFillContentInit() {
  'use strict';

  // Prevent double initialization
  if (window.__originfill_initialized) return;
  window.__originfill_initialized = true;
  window.__originFillLoaded = true;

  OriginFillLogger.info('Content script initializing...');
  OriginFillLogger.time('Content init');

  // ─── 1. Detect Portal ──────────────────────────────────────────
  const detection = OriginFillDetector.detect();

  if (detection.type === OriginFillPortals.NONE) {
    OriginFillLogger.info('No job portal detected on this page');
    return; // Don't start observer or session guard on non-portal pages
  }

  // Notify background service worker
  try {
    chrome.runtime.sendMessage({
      type: OriginFillMessages.PORTAL_DETECTED,
      data: detection
    });
  } catch (e) {
    OriginFillLogger.debug('Could not notify background:', e.message);
  }

  // ─── 2. Load Settings ──────────────────────────────────────────
  let settings = {};
  let activeProfile = null;

  async function loadSettings() {
    try {
      const result = await chrome.storage.local.get('originfill_settings');
      settings = result.originfill_settings || {};
    } catch (e) {
      settings = {};
    }
  }

  // ─── 3. Start Observer ─────────────────────────────────────────
  function startObserver() {
    OriginFillObserver.start({
      portalType: detection.type,
      autoFillOnChange: settings.autoFillOnDetect || false,
      profile: activeProfile,
      onPageChange: (pageInfo) => {
        OriginFillLogger.info('Page changed:', pageInfo.pageName);
      }
    });
  }

  // ─── 4. Start Session Guard ────────────────────────────────────
  function startSessionGuard() {
    if (settings.recoveryEnabled !== false) {
      OriginFillSessionGuard.start({
        portalType: detection.type,
        applicationUrl: window.location.href
      });
    }
  }

  // ─── 5. Check for Session Recovery ─────────────────────────────
  async function checkRecovery() {
    const recovery = await OriginFillSessionGuard.checkRecoveryAvailable();
    if (recovery) {
      OriginFillLogger.info('Session recovery available:', Object.keys(recovery.savedFields).length, 'fields');

      // Notify popup/background
      try {
        chrome.runtime.sendMessage({
          type: OriginFillMessages.SESSION_SNAPSHOT_SAVED,
          data: recovery
        });
      } catch (e) { /* popup may not be open */ }
    }
  }

  // ─── 6. Message Handler ────────────────────────────────────────
  chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    const { type, data } = message;

    switch (type) {
      case OriginFillMessages.FILL_ALL:
      case OriginFillMessages.FILL_SECTION: {
        const section = data?.section || 'all';
        const fillDelay = data?.fillDelay || settings.fillDelay || 300;

        // Get active profile
        try {
          await OriginFillEncryption.initializeKey();
          const profiles = await OriginFillStore.getProfiles();
          const s = await chrome.storage.local.get('originfill_settings');
          const activeId = (s.originfill_settings || {}).activeProfileId;
          activeProfile = profiles.find(p => p.id === activeId) || profiles[0];
        } catch (e) {
          OriginFillLogger.error('Could not load profile:', e);
          chrome.runtime.sendMessage({
            type: OriginFillMessages.FILL_ERROR,
            data: { error: 'Could not load profile. Please check settings.' }
          });
          return;
        }

        if (!activeProfile) {
          chrome.runtime.sendMessage({
            type: OriginFillMessages.FILL_ERROR,
            data: { error: 'No profile found. Please set up a profile in Settings.' }
          });
          return;
        }

        // Execute fill
        await OriginFillFiller.fillAll(activeProfile, detection.type, {
          section,
          fillDelay
        });

        break;
      }

      case OriginFillMessages.SESSION_RESTORE: {
        const recovery = await OriginFillSessionGuard.checkRecoveryAvailable();
        if (recovery && recovery.savedFields) {
          const result = await OriginFillFiller.restoreFromSnapshot(recovery.savedFields);

          // Clear recovery data after successful restore
          if (result.restored > 0) {
            await OriginFillSessionGuard.clearRecovery();
          }

          // Send result as a fill complete
          chrome.runtime.sendMessage({
            type: 'SESSION_RESTORED',
            data: {
              success: true,
              successCount: result.restored,
              failedCount: result.failed,
              attentionCount: 0,
              skippedCount: 0,
              totalFields: result.restored + result.failed,
              successRate: result.restored > 0 ? Math.round((result.restored / (result.restored + result.failed)) * 100) : 0,
              elapsedFormatted: 'instant',
              portalName: OriginFillDetector.getPortalDisplayName(detection.type),
              timestamp: new Date().toISOString(),
              results: [],
              successResults: [],
              attentionResults: [],
              failedResults: [],
              skippedResults: []
            }
          });
        }
        break;
      }

      case OriginFillMessages.PING:
        sendResponse({ type: OriginFillMessages.PONG, timestamp: Date.now() });
        return true;

      case OriginFillMessages.GET_PORTAL_INFO:
        sendResponse(detection);
        return true;
    }
  });

  // ─── 7. Run Initialization ─────────────────────────────────────
  loadSettings().then(() => {
    startObserver();
    startSessionGuard();
    checkRecovery();

    OriginFillLogger.timeEnd('Content init');
    OriginFillLogger.success(
      `Initialized on ${OriginFillDetector.getPortalDisplayName(detection.type)} ` +
      `(${detection.confidence} confidence)`
    );
  });

})();
