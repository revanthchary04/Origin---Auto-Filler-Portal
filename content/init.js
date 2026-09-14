/**
 * OriginFill — Content Script Entry Point
 * Initializes portal detection, observer, session guard, and message handlers.
 * This file runs after all other content scripts are loaded (document_idle).
 *
 * Initialization order:
 *   1. Detect portal
 *   2. Load settings
 *   3. Load active profile    ← loads profile BEFORE observer starts
 *   4. Start observer (with loaded profile)
 *   5. Start session guard
 *   6. Check for session recovery
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

(function OriginFillContentInit() {
  'use strict';

  // Prevent double initialization
  if (window.__originfill_initialized) {
    console.warn('[OriginFill] Already initialized; skipping duplicate initialization.');
    return;
  }
  window.__originfill_initialized = true;
  window.__originfill_initialized = true;
  window.__originFillLoaded = true;

  // ─── 1. Message Handler ────────────────────────────────────────
  // Attach unconditionally and early so we can respond to PINGs even if dependencies fail
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { type, data } = message;

    switch (type) {
      case OriginFillMessages.PING:
        sendResponse({ type: OriginFillMessages.PONG, timestamp: Date.now() });
        return true;

      case OriginFillMessages.GET_PORTAL_INFO:
        // Re-detect just in case
        if (typeof OriginFillDetector !== 'undefined') {
          sendResponse(OriginFillDetector.detect());
        } else {
          sendResponse({ type: 'none', confidence: 'none', error: 'Detector missing' });
        }
        return true;

      case OriginFillMessages.FILL_ALL:
      case OriginFillMessages.FILL_SECTION: {
        const section = data?.section || 'all';
        const fillDelay = data?.fillDelay || settings?.fillDelay || 300;

        Promise.resolve().then(async () => {
          try {
            await OriginFillEncryption.initializeKey();
            const profiles = await OriginFillStore.getProfiles();
            const s = await chrome.storage.local.get('originfill_settings');
            const activeId = (s.originfill_settings || {}).activeProfileId;
            activeProfile = profiles.find(p => p.id === activeId) || profiles[0];
            
            if (!activeProfile) {
              chrome.runtime.sendMessage({
                type: OriginFillMessages.FILL_ERROR,
                data: { error: 'No profile found. Please set up a profile in Settings.' }
              });
              return;
            }

            const detection = OriginFillDetector.detect();
            await OriginFillFiller.fillAll(activeProfile, detection.type, {
              section,
              fillDelay
            });
          } catch (e) {
            OriginFillLogger.error('Could not load profile:', e);
            chrome.runtime.sendMessage({
              type: OriginFillMessages.FILL_ERROR,
              data: { error: 'Could not load profile. Please check settings.' }
            });
          }
        });
        break;
      }

      case OriginFillMessages.SESSION_RESTORE: {
        Promise.resolve().then(async () => {
          const detection = OriginFillDetector.detect();
          const recovery = await OriginFillSessionGuard.checkRecoveryAvailable();
          if (recovery && recovery.savedFields) {
            const result = await OriginFillFiller.restoreFromSnapshot(recovery.savedFields, detection.type);

            if (result.success && result.failed === 0) {
              await OriginFillSessionGuard.clearRecovery();
            }

            chrome.runtime.sendMessage({
              type: 'SESSION_RESTORED',
              data: {
                success: true,
                successCount: result.restored,
                failedCount: result.failed,
                attentionCount: 0,
                skippedCount: result.skipped || 0,
                totalFields: result.total || (result.restored + result.failed),
                successRate: result.restored > 0 ? Math.round((result.restored / (result.restored + result.failed)) * 100) : 0,
                elapsedFormatted: 'instant',
                portalName: OriginFillDetector.getPortalDisplayName(detection.type),
                timestamp: new Date().toISOString(),
                results: result.results || [],
                successResults: result.results?.filter(r => r.status === OriginFillStatus.SUCCESS) || [],
                attentionResults: result.results?.filter(r => r.status === OriginFillStatus.ATTENTION) || [],
                failedResults: result.results?.filter(r => r.status === OriginFillStatus.FAILED) || [],
                skippedResults: result.results?.filter(r => r.status === OriginFillStatus.SKIPPED) || []
              }
            });
          } else {
             chrome.runtime.sendMessage({
              type: 'SESSION_RESTORED',
              data: {
                success: false,
                successCount: 0,
                failedCount: 0,
                attentionCount: 0,
                skippedCount: 0,
                totalFields: 0,
                successRate: 0,
                elapsedFormatted: '0s',
                portalName: OriginFillDetector.getPortalDisplayName(detection?.type || 'none'),
                timestamp: new Date().toISOString(),
                results: [],
                successResults: [],
                attentionResults: [],
                failedResults: [],
                skippedResults: []
              }
            });
          }
        });
        break;
      }

      case OriginFillMessages.PROFILE_UPDATED: {
        OriginFillLogger.info('Profile updated notification received');
        loadActiveProfile().then(() => {
          if (typeof OriginFillObserver !== 'undefined' && OriginFillObserver.isActive()) {
            OriginFillObserver.updateProfile(activeProfile);
          }
        });
        break;
      }

      case OriginFillMessages.SETTINGS_UPDATED: {
        OriginFillLogger.info('Settings updated notification received');
        loadSettings().then(() => {
          if (typeof OriginFillObserver !== 'undefined' && OriginFillObserver.isActive()) {
            OriginFillObserver.setAutoFillOnChange(settings.autoFillOnDetect || false);
          }
        });
        break;
      }
    }
  });

  // ─── Startup Health Check ──────────────────────────────────────
  const missing = [];
  if (typeof OriginFillDetector === 'undefined') missing.push('OriginFillDetector');
  if (typeof OriginFillFiller === 'undefined') missing.push('OriginFillFiller');
  if (typeof OriginFillWorkday === 'undefined') missing.push('OriginFillWorkday');
  if (typeof OriginFillGeneric === 'undefined') missing.push('OriginFillGeneric');

  if (missing.length > 0) {
    console.error(`[OriginFill][Init] Missing dependenc${missing.length > 1 ? 'ies' : 'y'}: ${missing.join(', ')}`);
    return;
  }

  OriginFillLogger.info('[OriginFill][Init] Initialized successfully');
  OriginFillLogger.info(`[OriginFill][Init] Detector available: true`);
  OriginFillLogger.info(`[OriginFill][Init] Filler available: true`);
  OriginFillLogger.info(`[OriginFill][Init] Workday adapter available: true`);
  OriginFillLogger.info(`[OriginFill][Init] Generic adapter available: true`);

  OriginFillLogger.time('Content init');

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

  // ─── 2b. Load Active Profile ───────────────────────────────────
  async function loadActiveProfile() {
    try {
      await OriginFillEncryption.initializeKey();
      const profiles = await OriginFillStore.getProfiles();
      const activeId = settings.activeProfileId;
      activeProfile = profiles.find(p => p.id === activeId) || profiles.find(p => p.isDefault) || profiles[0];

      if (activeProfile) {
        OriginFillLogger.info(`Active profile loaded: ${activeProfile.label} (${activeProfile.id})`);
      } else {
        OriginFillLogger.warn('No profile available');
      }
    } catch (e) {
      OriginFillLogger.warn('Could not load profile during init:', e.message);
      activeProfile = null;
    }
  }

  // ─── 3. Start Observer ─────────────────────────────────────────
  function startObserver(detection) {
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
  function startSessionGuard(detection) {
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

  // ─── 2. Run Initialization ─────────────────────────────────────
  
  const detection = OriginFillDetector.detect();
  
  if (detection.type === OriginFillPortals.NONE) {
    OriginFillLogger.info('No job portal detected on this page. Listening for on-demand requests.');
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

  loadSettings()
    .then(() => loadActiveProfile())
    .then(() => {
      startObserver(detection);
      startSessionGuard(detection);
      checkRecovery();

      OriginFillLogger.timeEnd('Content init');
      OriginFillLogger.success(
        `Initialized on ${OriginFillDetector.getPortalDisplayName(detection.type)} ` +
        `(${detection.confidence} confidence)`
      );
    });

})();
