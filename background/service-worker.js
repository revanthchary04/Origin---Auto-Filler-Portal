/**
 * OriginFill — Background Service Worker
 * Handles tab monitoring, message routing, notifications, and extension lifecycle.
 * Runs as a Manifest V3 service worker (no persistent background page).
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

// ─── Constants (duplicated since SW can't access content script globals) ──
const SW_StorageKeys = Object.freeze({
  PROFILES: 'originfill_profiles',
  SETTINGS: 'originfill_settings',
  SESSION_RECOVERY: 'originfill_session_recovery',
  STATS: 'originfill_stats',
  ENCRYPTION_KEY: 'originfill_enc_key',
  FIRST_RUN: 'originfill_first_run'
});

const SW_Messages = Object.freeze({
  GET_PORTAL_INFO: 'GET_PORTAL_INFO',
  PORTAL_DETECTED: 'PORTAL_DETECTED',
  FILL_ALL: 'FILL_ALL',
  FILL_SECTION: 'FILL_SECTION',
  FILL_PROGRESS: 'FILL_PROGRESS',
  FILL_COMPLETE: 'FILL_COMPLETE',
  FILL_ERROR: 'FILL_ERROR',
  SESSION_TIMEOUT: 'SESSION_TIMEOUT',
  SESSION_SNAPSHOT_SAVED: 'SESSION_SNAPSHOT_SAVED',
  SESSION_RESTORE: 'SESSION_RESTORE',
  SESSION_RESTORED: 'SESSION_RESTORED',
  PAGE_CHANGED: 'PAGE_CHANGED',
  PROFILE_UPDATED: 'PROFILE_UPDATED',
  SETTINGS_UPDATED: 'SETTINGS_UPDATED',
  STATS_UPDATED: 'STATS_UPDATED',
  PING: 'PING',
  PONG: 'PONG',
  GET_STATE: 'GET_STATE',
  SHOW_NOTIFICATION: 'SHOW_NOTIFICATION'
});

const SW_Portals = Object.freeze({
  WORKDAY: 'workday',
  GREENHOUSE: 'greenhouse',
  LEVER: 'lever',
  ICIMS: 'icims',
  TALEO: 'taleo',
  GENERIC: 'generic',
  NONE: 'none'
});

const SW_DefaultSettings = Object.freeze({
  activeProfileId: '',
  autoDetect: true,
  autoFillOnDetect: false,
  showNotifications: true,
  recoveryEnabled: true,
  fillDelay: 300,
  theme: 'system',
  useEncryption: true,
  usePassphrase: false
});

const SW_DefaultStats = Object.freeze({
  totalFills: 0,
  totalFieldsFilled: 0,
  totalRecoveries: 0,
  totalTimeSavedMinutes: 0,
  portalsUsed: {},
  fillSuccessRate: 0,
  lastFillDate: ''
});

// ─── State ───────────────────────────────────────────────────────

/** @type {Map<number, Object>} Track active job form tabs: tabId → { portalType, url, detection } */
const activeTabs = new Map();

/** @type {Object|null} Last fill report */
let lastFillReport = null;

/** @type {Object|null} Last page info from observer */
let lastPageInfo = null;

// ─── Extension Lifecycle ─────────────────────────────────────────

/**
 * Handle extension install or update.
 */
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log(`[OriginFill] Extension ${details.reason}: v${chrome.runtime.getManifest().version}`);

  if (details.reason === 'install') {
    // First install — mark for onboarding
    await chrome.storage.local.set({ [SW_StorageKeys.FIRST_RUN]: true });

    // Initialize default settings
    const existingSettings = await getStorageValue(SW_StorageKeys.SETTINGS);
    if (!existingSettings) {
      await chrome.storage.local.set({
        [SW_StorageKeys.SETTINGS]: { ...SW_DefaultSettings }
      });
    }

    // Initialize stats
    const existingStats = await getStorageValue(SW_StorageKeys.STATS);
    if (!existingStats) {
      await chrome.storage.local.set({
        [SW_StorageKeys.STATS]: { ...SW_DefaultStats }
      });
    }

    console.log('[OriginFill] First install complete — ready for onboarding');
  }

  if (details.reason === 'update') {
    console.log(`[OriginFill] Updated from v${details.previousVersion}`);
  }
});

/**
 * Handle extension startup (browser restart).
 */
chrome.runtime.onStartup.addListener(() => {
  console.log('[OriginFill] Extension started');
  // Clear active tabs state (browser restarted)
  activeTabs.clear();
});

// ─── Message Router ──────────────────────────────────────────────

/**
 * Handle messages from content scripts and popup.
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, data } = message;
  const tabId = sender.tab?.id;

  switch (type) {
    // ─── Portal Detection ────────────────
    case SW_Messages.PORTAL_DETECTED:
      if (tabId && data) {
        activeTabs.set(tabId, {
          portalType: data.type,
          url: data.url,
          confidence: data.confidence,
          pageName: data.pageName,
          detectedAt: Date.now()
        });
        updateBadge(tabId, data.type);
      }
      break;

    case SW_Messages.GET_PORTAL_INFO:
      // Popup requesting current tab's portal info
      getActiveTabInfo().then(info => {
        sendResponse(info);
      });
      return true; // Async response

    // ─── Fill Events ─────────────────────
    case SW_Messages.FILL_PROGRESS:
      lastFillReport = null; // Clear previous
      break;

    case SW_Messages.FILL_COMPLETE:
      lastFillReport = data;
      if (tabId) {
        const tab = activeTabs.get(tabId);
        if (tab) {
          tab.lastFill = data;
        }
      }
      break;

    case SW_Messages.FILL_ERROR:
      lastFillReport = data;
      break;

    // ─── Page Change ─────────────────────
    case SW_Messages.PAGE_CHANGED:
      lastPageInfo = data;
      if (tabId) {
        const tab = activeTabs.get(tabId);
        if (tab) {
          tab.pageName = data.pageName;
          tab.pageNumber = data.pageNumber;
          tab.totalPages = data.totalPages;
        }
      }
      break;

    // ─── Session Timeout ─────────────────
    case SW_Messages.SESSION_TIMEOUT:
      handleSessionTimeout(data, tabId);
      break;

    case SW_Messages.SESSION_RESTORE:
      // Forward restore request to content script
      forwardToTab(tabId || data.tabId, {
        type: SW_Messages.SESSION_RESTORE,
        data
      });
      break;

    // ─── Stats Update ────────────────────
    case SW_Messages.STATS_UPDATED:
      updateStats(data);
      break;

    // ─── Notifications ───────────────────
    case 'SHOW_NOTIFICATION':
      showNotification(data);
      break;

    // ─── State Query ─────────────────────
    case SW_Messages.GET_STATE:
      sendResponse({
        activeTabs: Object.fromEntries(activeTabs),
        lastFillReport,
        lastPageInfo
      });
      return true;

    // ─── Ping (health check) ─────────────
    case SW_Messages.PING:
      sendResponse({ type: SW_Messages.PONG, timestamp: Date.now() });
      return true;

    // ─── Fill Command from Popup ─────────
    case SW_Messages.FILL_ALL:
    case SW_Messages.FILL_SECTION:
      // Forward to the active tab's content script
      getActiveTabId().then(activeTabId => {
        if (activeTabId) {
          forwardToTab(activeTabId, message);
        }
      });
      break;

    // ─── Settings/Profile Updates ────────
    case SW_Messages.SETTINGS_UPDATED:
    case SW_Messages.PROFILE_UPDATED:
      // Broadcast to all active tabs
      activeTabs.forEach((_, tid) => {
        forwardToTab(tid, message);
      });
      break;
  }

  return false; // Synchronous (no sendResponse needed)
});

// ─── Tab Monitoring ──────────────────────────────────────────────

/**
 * Watch for tab closures — clean up state.
 */
chrome.tabs.onRemoved.addListener((tabId) => {
  activeTabs.delete(tabId);
});

/**
 * Watch for tab URL changes — detect navigating away from job forms.
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && activeTabs.has(tabId)) {
    // Tab is navigating — check if leaving job form
    const tracked = activeTabs.get(tabId);
    const newUrl = changeInfo.url || tab.url;

    if (newUrl && tracked.url) {
      try {
        const oldDomain = new URL(tracked.url).hostname;
        const newDomain = new URL(newUrl).hostname;

        if (oldDomain !== newDomain) {
          // Left the portal domain — clear tracking
          activeTabs.delete(tabId);
          updateBadge(tabId, null);
        }
      } catch (e) {
        // URL parsing failed
      }
    }
  }
});

// ─── Badge Management ────────────────────────────────────────────

/**
 * Update the extension badge for a tab.
 *
 * @param {number} tabId
 * @param {string|null} portalType
 */
function updateBadge(tabId, portalType) {
  if (!portalType || portalType === SW_Portals.NONE) {
    chrome.action.setBadgeText({ text: '', tabId });
    return;
  }

  const badgeConfig = {
    [SW_Portals.WORKDAY]:    { text: 'W', color: '#2563EB' },
    [SW_Portals.GREENHOUSE]: { text: 'G', color: '#16A34A' },
    [SW_Portals.LEVER]:      { text: 'L', color: '#7C3AED' },
    [SW_Portals.ICIMS]:      { text: 'I', color: '#D97706' },
    [SW_Portals.TALEO]:      { text: 'T', color: '#0891B2' },
    [SW_Portals.GENERIC]:    { text: '?', color: '#6B7280' }
  };

  const config = badgeConfig[portalType] || badgeConfig[SW_Portals.GENERIC];

  chrome.action.setBadgeText({ text: config.text, tabId });
  chrome.action.setBadgeBackgroundColor({ color: config.color, tabId });
}

// ─── Notifications ───────────────────────────────────────────────

/**
 * Show a Chrome notification.
 *
 * @param {{ title: string, message: string, url?: string }} data
 */
async function showNotification(data) {
  const settings = await getStorageValue(SW_StorageKeys.SETTINGS) || SW_DefaultSettings;

  if (!settings.showNotifications) return;

  const notificationId = 'originfill_' + Date.now();

  chrome.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: 'assets/icons/icon128.png',
    title: data.title || 'OriginFill',
    message: data.message || '',
    priority: 2,
    requireInteraction: true // Keep notification visible until dismissed
  });

  // Handle notification click — open the application URL
  if (data.url) {
    chrome.notifications.onClicked.addListener(function handler(clickedId) {
      if (clickedId === notificationId) {
        chrome.tabs.create({ url: data.url });
        chrome.notifications.clear(notificationId);
        chrome.notifications.onClicked.removeListener(handler);
      }
    });
  }
}

// ─── Session Timeout Handling ────────────────────────────────────

/**
 * Handle a session timeout event from content script.
 *
 * @param {Object} data - Timeout details
 * @param {number} tabId
 */
async function handleSessionTimeout(data, tabId) {
  console.log('[OriginFill] Session timeout:', data);

  // Update stats
  const stats = await getStorageValue(SW_StorageKeys.STATS) || { ...SW_DefaultStats };
  stats.totalRecoveries = (stats.totalRecoveries || 0) + 1;
  await chrome.storage.local.set({ [SW_StorageKeys.STATS]: stats });

  // Show notification
  const settings = await getStorageValue(SW_StorageKeys.SETTINGS) || SW_DefaultSettings;

  if (settings.showNotifications) {
    showNotification({
      title: '⚠️ Session Expired',
      message: `Session expired on ${getPortalName(data.portal)}. Your form data has been saved.`,
      url: data.url
    });
  }
}

// ─── On-Demand Generic Detection ─────────────────────────────────

/**
 * Execute generic portal detection on a tab that's not in our known domains.
 * Uses chrome.scripting.executeScript for on-demand injection.
 *
 * @param {number} tabId
 * @returns {Promise<Object>} Detection result
 */
async function executeOnDemandDetection(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      files: [
        'utils/constants.js',
        'utils/logger.js',
        'utils/fuzzy-match.js',
        'utils/field-mapper.js',
        'content/portals/workday.js',
        'content/portals/generic.js',
        'content/detector.js'
      ]
    });

    // Now run detection
    const detectionResults = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (typeof OriginFillDetector !== 'undefined') {
          return OriginFillDetector.detect();
        }
        return { type: 'none', confidence: 'none', pageName: '', url: window.location.href };
      }
    });

    return detectionResults[0]?.result || { type: 'none', confidence: 'none' };

  } catch (err) {
    console.error('[OriginFill] On-demand detection failed:', err);
    return { type: 'none', confidence: 'none', error: err.message };
  }
}

// ─── Helper Functions ────────────────────────────────────────────

/**
 * Get storage value by key.
 * @param {string} key
 * @returns {Promise<any>}
 */
async function getStorageValue(key) {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? null;
}

/**
 * Get the currently active tab's ID.
 * @returns {Promise<number|null>}
 */
async function getActiveTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id || null;
}

/**
 * Get portal info for the currently active tab.
 * @returns {Promise<Object>}
 */
async function getActiveTabInfo() {
  const tabId = await getActiveTabId();
  if (!tabId) return { portalType: SW_Portals.NONE };

  // Check tracked tabs first
  if (activeTabs.has(tabId)) {
    return {
      ...activeTabs.get(tabId),
      lastFillReport: lastFillReport,
      lastPageInfo: lastPageInfo
    };
  }

  // Not tracked — might need on-demand detection
  return {
    portalType: SW_Portals.NONE,
    tabId,
    lastFillReport: null,
    lastPageInfo: null
  };
}

/**
 * Forward a message to a specific tab's content script.
 * @param {number} tabId
 * @param {Object} message
 */
function forwardToTab(tabId, message) {
  if (!tabId) return;
  try {
    chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    console.debug('[OriginFill] Forward to tab failed:', err.message);
  }
}

/**
 * Get display name for a portal type.
 * @param {string} type
 * @returns {string}
 */
function getPortalName(type) {
  const names = {
    workday: 'Workday',
    greenhouse: 'Greenhouse',
    lever: 'Lever',
    icims: 'iCIMS',
    taleo: 'Taleo',
    generic: 'Generic Portal',
    none: 'Unknown'
  };
  return names[type] || 'Unknown';
}

/**
 * Update usage stats.
 * @param {Object} delta
 */
async function updateStats(delta) {
  const stats = await getStorageValue(SW_StorageKeys.STATS) || { ...SW_DefaultStats };

  if (delta.totalFills) stats.totalFills += delta.totalFills;
  if (delta.totalFieldsFilled) stats.totalFieldsFilled += delta.totalFieldsFilled;
  if (delta.totalRecoveries) stats.totalRecoveries += delta.totalRecoveries;
  if (delta.totalTimeSavedMinutes) stats.totalTimeSavedMinutes += delta.totalTimeSavedMinutes;
  if (delta.portal) {
    stats.portalsUsed = stats.portalsUsed || {};
    stats.portalsUsed[delta.portal] = (stats.portalsUsed[delta.portal] || 0) + 1;
  }
  if (delta.fillSuccessRate !== undefined) {
    const total = stats.totalFills || 1;
    stats.fillSuccessRate = (
      (stats.fillSuccessRate * (total - 1) + delta.fillSuccessRate) / total
    );
  }

  stats.lastFillDate = new Date().toISOString();
  await chrome.storage.local.set({ [SW_StorageKeys.STATS]: stats });
}

// ─── Session Ping (Background Heartbeat) ─────────────────────────

/**
 * Periodically check active tabs for session status.
 * Uses chrome.alarms since setInterval isn't reliable in service workers.
 */
chrome.alarms.create('sessionPing', { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'sessionPing') return;

  for (const [tabId, info] of activeTabs) {
    try {
      // Check if tab still exists
      const tab = await chrome.tabs.get(tabId);

      if (!tab) {
        activeTabs.delete(tabId);
        continue;
      }

      // Ping content script
      try {
        await chrome.tabs.sendMessage(tabId, { type: SW_Messages.PING });
      } catch (e) {
        // Content script not responding — may have been unloaded
        activeTabs.delete(tabId);
        updateBadge(tabId, null);
      }
    } catch (e) {
      // Tab doesn't exist
      activeTabs.delete(tabId);
    }
  }
});

console.log('[OriginFill] Service worker initialized');
