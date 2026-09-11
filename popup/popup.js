/**
 * OriginFill — Popup Logic
 * Handles all popup state transitions, profile switching, fill commands,
 * message handling, and stats display.
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

(async function PopupInit() {
  'use strict';

  // ─── DOM References ────────────────────────────────────────────

  const $ = (sel) => document.getElementById(sel);

  const els = {
    popup: $('popup'),
    // Header
    profileSelect: $('profileSelect'),
    settingsBtn: $('settingsBtn'),
    // Badge
    portalBadge: $('portalBadge'),
    badgeIcon: $('badgeIcon'),
    badgeText: $('badgeText'),
    // States
    stateWelcome: $('stateWelcome'),
    stateNoForm: $('stateNoForm'),
    stateDetected: $('stateDetected'),
    stateRecovery: $('stateRecovery'),
    stateFilling: $('stateFilling'),
    stateComplete: $('stateComplete'),
    // Welcome
    setupProfileBtn: $('setupProfileBtn'),
    // No Form
    goSettingsBtn: $('goSettingsBtn'),
    // Detected
    pageText: $('pageText'),
    pageIndicator: $('pageIndicator'),
    fillAllBtn: $('fillAllBtn'),
    fillPersonalBtn: $('fillPersonalBtn'),
    fillEducationBtn: $('fillEducationBtn'),
    fillWorkBtn: $('fillWorkBtn'),
    fillSummary: $('fillSummary'),
    fillSummaryText: $('fillSummaryText'),
    viewReportBtn: $('viewReportBtn'),
    // Recovery
    recoveryMeta: $('recoveryMeta'),
    restoreBtn: $('restoreBtn'),
    dismissRecoveryBtn: $('dismissRecoveryBtn'),
    // Filling
    progressFill: $('progressFill'),
    progressText: $('progressText'),
    fillingField: $('fillingField'),
    // Complete
    statSuccess: $('statSuccess'),
    statAttention: $('statAttention'),
    statFailed: $('statFailed'),
    completeTime: $('completeTime'),
    viewFullReportBtn: $('viewFullReportBtn'),
    fillAgainBtn: $('fillAgainBtn'),
    // Report
    fillReport: $('fillReport'),
    reportMeta: $('reportMeta'),
    reportBody: $('reportBody'),
    closeReportBtn: $('closeReportBtn'),
    // Footer stats
    timeSavedValue: $('timeSavedValue'),
    recoveriesValue: $('recoveriesValue'),
    fillCountValue: $('fillCountValue')
  };

  // ─── State ─────────────────────────────────────────────────────

  let currentPortalInfo = null;
  let currentReport = null;
  let profiles = [];
  let settings = {};
  let stats = {};

  // ─── Initialize ────────────────────────────────────────────────

  async function init() {
    try {
      // Apply theme
      await applyTheme();

      // Load profiles and settings
      await loadProfilesAndSettings();

      // If no profiles exist at all, show welcome/onboarding
      if (profiles.length === 0) {
        showState('welcome');
        updateBadge('none', '👋', 'Profile setup needed');
        return;
      }

      // Update fill button states
      updateFillButtonStates();

      // Get portal info from active tab
      currentPortalInfo = await getPortalInfo();

      if (currentPortalInfo && currentPortalInfo.portalType && currentPortalInfo.portalType !== 'none') {
        // Portal detected — check for session recovery first
        const recovery = await checkSessionRecovery();
        if (recovery) {
          showRecoveryState(recovery);
        } else {
          showDetectedState(currentPortalInfo);
        }

        // Show last fill report if available
        if (currentPortalInfo.lastFillReport) {
          showFillSummary(currentPortalInfo.lastFillReport);
        }
      } else {
        showState('noForm');
        updateBadge('none', '📋', 'No job form detected');
      }

      // Load and display stats
      await loadStats();

    } catch (err) {
      console.error('[OriginFill Popup] Init error:', err);
      showState('noForm');
      updateBadge('none', '❌', 'Error loading extension');
    }
  }

  // ─── State Management ──────────────────────────────────────────

  /**
   * Show a specific state section, hiding all others.
   * @param {'welcome'|'noForm'|'detected'|'recovery'|'filling'|'complete'} stateName
   */
  function showState(stateName) {
    const states = [
      'stateWelcome', 'stateNoForm', 'stateDetected',
      'stateRecovery', 'stateFilling', 'stateComplete'
    ];

    const stateMap = {
      'welcome': 'stateWelcome',
      'noForm': 'stateNoForm',
      'detected': 'stateDetected',
      'recovery': 'stateRecovery',
      'filling': 'stateFilling',
      'complete': 'stateComplete'
    };

    states.forEach(s => {
      els[s].hidden = (s !== stateMap[stateName]);
    });

    // Hide report when changing states
    if (stateName !== 'complete') {
      els.fillReport.hidden = true;
    }
  }

  // ─── Portal Detection ──────────────────────────────────────────

  /**
   * Get portal info from background service worker.
   * @returns {Promise<Object>}
   */
  async function getPortalInfo() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'GET_PORTAL_INFO' },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve(null);
            return;
          }
          resolve(response);
        }
      );
    });
  }

  /**
   * Show the detected state with portal info.
   * @param {Object} info
   */
  function showDetectedState(info) {
    const portalName = getPortalDisplayName(info.portalType);
    const isGeneric = info.portalType === 'generic';

    // Update badge
    if (isGeneric) {
      updateBadge('warning', '⚠️', `${portalName} — Field matching may vary`);
    } else {
      updateBadge('success', '✅', `${portalName} Detected`);
    }

    // Update page indicator
    if (info.pageName) {
      const pageNum = info.pageNumber || 1;
      const totalPages = info.totalPages || 1;
      if (totalPages > 1) {
        els.pageText.textContent = `Page ${pageNum} of ${totalPages} · ${info.pageName}`;
      } else {
        els.pageText.textContent = info.pageName;
      }
      els.pageIndicator.hidden = false;
    } else {
      els.pageIndicator.hidden = true;
    }

    // Enable/disable fill buttons based on profile data
    updateFillButtonStates();

    showState('detected');
  }

  // ─── Session Recovery ──────────────────────────────────────────

  /**
   * Check for available session recovery data.
   * @returns {Promise<Object|null>}
   */
  async function checkSessionRecovery() {
    const result = await chrome.storage.local.get('originfill_session_recovery');
    const recovery = result.originfill_session_recovery;

    if (!recovery || !recovery.savedFields) return null;

    // Check age — expire after 24 hours
    const age = Date.now() - new Date(recovery.savedAt).getTime();
    if (age > 24 * 60 * 60 * 1000) return null;

    const fieldCount = Object.keys(recovery.savedFields).length;
    if (fieldCount === 0) return null;

    return recovery;
  }

  /**
   * Show the session recovery state.
   * @param {Object} recovery
   */
  function showRecoveryState(recovery) {
    updateBadge('warning', '⚠️', 'Session Recovered');

    const fieldCount = Object.keys(recovery.savedFields).length;
    const savedDate = new Date(recovery.savedAt);
    const timeAgo = getTimeAgo(savedDate);

    els.recoveryMeta.textContent = `${fieldCount} fields saved ${timeAgo}`;

    showState('recovery');
  }

  // ─── Fill Commands ─────────────────────────────────────────────

  /**
   * Send a fill command to the content script.
   * @param {string} section - 'all', 'personal', 'education', 'workExperience'
   */
  async function sendFillCommand(section) {
    showState('filling');
    els.progressFill.style.width = '0%';
    els.progressText.textContent = '0%';
    els.fillingField.textContent = 'Preparing...';

    const messageType = section === 'all' ? 'FILL_ALL' : 'FILL_SECTION';

    // Get active tab and send fill command
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      showState('detected');
      return;
    }

    chrome.tabs.sendMessage(tab.id, {
      type: messageType,
      data: { section, fillDelay: settings.fillDelay || 300 }
    });
  }

  /**
   * Send a session restore command.
   */
  async function sendRestoreCommand() {
    showState('filling');
    els.fillingField.textContent = 'Restoring saved data...';

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;

    chrome.tabs.sendMessage(tab.id, {
      type: 'SESSION_RESTORE'
    });
  }

  // ─── Fill Progress & Complete ──────────────────────────────────

  /**
   * Update fill progress in the UI.
   * @param {Object} data - { current, total, fieldName, phase }
   */
  function updateFillProgress(data) {
    if (data.phase === 'started') {
      showState('filling');
      return;
    }

    const pct = data.total > 0 ? Math.round((data.current / data.total) * 100) : 0;
    els.progressFill.style.width = `${pct}%`;
    els.progressText.textContent = `${pct}%`;
    els.fillingField.textContent = `Filling: ${data.fieldName || '...'}`;
  }

  /**
   * Show fill complete state.
   * @param {Object} report
   */
  function showFillComplete(report) {
    currentReport = report;

    els.statSuccess.textContent = report.successCount;
    els.statAttention.textContent = report.attentionCount;
    els.statFailed.textContent = report.failedCount;
    els.completeTime.textContent = `⏱ ${report.elapsedFormatted}`;

    showState('complete');

    // Refresh stats
    loadStats();
  }

  /**
   * Show fill summary in the detected state.
   * @param {Object} report
   */
  function showFillSummary(report) {
    currentReport = report;

    const text = report.failedCount > 0
      ? `Last fill: ${report.failedCount} fields failed`
      : `Last fill: ${report.successCount} fields ✅`;

    els.fillSummaryText.textContent = text;
    els.fillSummary.hidden = false;
  }

  // ─── Fill Report ───────────────────────────────────────────────

  /**
   * Render the detailed fill report.
   * @param {Object} report
   */
  function renderReport(report) {
    if (!report) return;

    els.reportMeta.textContent = `${report.portalName} · ${new Date(report.timestamp).toLocaleString()} · ${report.elapsedFormatted}`;

    let html = '';

    // Success section
    if (report.successResults.length > 0) {
      html += renderReportSection('✅ Filled Successfully', 'success', report.successResults);
    }

    // Attention section
    if (report.attentionResults.length > 0) {
      html += renderReportSection('⚠️ Needs Attention', 'attention', report.attentionResults);
    }

    // Failed section
    if (report.failedResults.length > 0) {
      html += renderReportSection('❌ Failed', 'failed', report.failedResults);
    }

    // Skipped section
    if (report.skippedResults.length > 0) {
      html += renderReportSection('⏭ Skipped', 'skipped', report.skippedResults);
    }

    els.reportBody.innerHTML = html;
    els.fillReport.hidden = false;
  }

  /**
   * Render a single report section.
   */
  function renderReportSection(title, type, results) {
    const items = results.map(r => `
      <div class="popup__report-item">
        <span class="popup__report-field">${escapeHtml(r.field)}</span>
        <span class="popup__report-value">${escapeHtml(r.value || '—')}</span>
        ${r.note ? `<span class="popup__report-note">${escapeHtml(r.note)}</span>` : ''}
      </div>
    `).join('');

    return `
      <div class="popup__report-section">
        <div class="popup__report-section-title popup__report-section-title--${type}">
          ${title} (${results.length})
        </div>
        ${items}
      </div>
    `;
  }

  // ─── Profile & Settings ────────────────────────────────────────

  /**
   * Load profiles and settings from storage.
   */
  async function loadProfilesAndSettings() {
    try {
      // 1. Query chrome.storage.local for both namespaced and plain keys
      const data = await chrome.storage.local.get([
        'profiles',
        'settings',
        'originfill_profiles',
        'originfill_settings',
        'originfill_first_run'
      ]);

      settings = data.settings || data.originfill_settings || {};

      // 2. Try loading profiles through OriginFillStore
      profiles = [];
      if (typeof OriginFillStore !== 'undefined' && OriginFillStore.getProfiles) {
        try {
          profiles = await OriginFillStore.getProfiles();
        } catch (e) {
          console.warn('[OriginFill Popup] OriginFillStore.getProfiles warning:', e);
        }
      }

      // 3. Fallback to direct chrome.storage.local keys
      if (!profiles || profiles.length === 0) {
        if (Array.isArray(data.profiles) && data.profiles.length > 0) {
          profiles = data.profiles;
        } else if (Array.isArray(data.originfill_profiles) && data.originfill_profiles.length > 0) {
          profiles = data.originfill_profiles;
        } else if (data.originfill_profiles && typeof OriginFillEncryption !== 'undefined') {
          try {
            await OriginFillEncryption.initializeKey();
            const decrypted = await OriginFillEncryption.decryptObject(data.originfill_profiles);
            if (Array.isArray(decrypted)) {
              profiles = decrypted;
            }
          } catch (e) {
            console.warn('[OriginFill Popup] Decryption fallback warning:', e);
          }
        }
      }

      if (!profiles) profiles = [];

      // If profiles are found, mark first-run completed
      if (profiles.length > 0 && data.originfill_first_run) {
        await chrome.storage.local.set({ originfill_first_run: false });
      }

      console.log(`[OriginFill Popup] Profiles count: ${profiles.length}, Active profile ID: ${settings.activeProfileId || '(none)'}`);

      // Populate profile selector
      populateProfileSelector();

      return profiles;
    } catch (err) {
      console.error('[OriginFill Popup] Failed to load data:', err);
      profiles = [];
      settings = {};
      return [];
    }
  }

  /**
   * Populate the profile dropdown.
   */
  function populateProfileSelector() {
    els.profileSelect.innerHTML = '';

    if (profiles.length === 0) {
      els.profileSelect.innerHTML = '<option value="">No profiles</option>';
      return;
    }

    profiles.forEach(p => {
      const option = document.createElement('option');
      option.value = p.id;
      option.textContent = p.label;
      option.selected = (p.id === settings.activeProfileId) || p.isDefault;
      els.profileSelect.appendChild(option);
    });
  }

  /**
   * Check if the active profile is empty (needs setup).
   * @returns {Promise<boolean>}
   */
  async function isProfileEmpty() {
    if (profiles.length === 0) return true;

    const activeId = settings.activeProfileId;
    const active = profiles.find(p => p.id === activeId) || profiles[0];

    if (!active) return true;

    // Check if at least first name and email are filled
    return !active.personal?.firstName && !active.personal?.email;
  }

  /**
   * Check if this is the first run.
   * @returns {Promise<boolean>}
   */
  async function checkFirstRun() {
    const result = await chrome.storage.local.get('originfill_first_run');
    return result.originfill_first_run === true;
  }

  /**
   * Update fill button states based on profile data.
   */
  function updateFillButtonStates() {
    const isEmpty = profiles.length === 0;

    els.fillAllBtn.disabled = isEmpty;
    els.fillPersonalBtn.disabled = isEmpty;
    els.fillEducationBtn.disabled = isEmpty;
    els.fillWorkBtn.disabled = isEmpty;

    if (isEmpty) {
      els.fillAllBtn.title = 'Set up a profile first';
    }
  }

  // ─── Stats ─────────────────────────────────────────────────────

  async function loadStats() {
    try {
      const result = await chrome.storage.local.get('originfill_stats');
      stats = result.originfill_stats || {};

      // Format time saved
      const minutes = stats.totalTimeSavedMinutes || 0;
      if (minutes >= 60) {
        const hours = (minutes / 60).toFixed(1);
        els.timeSavedValue.textContent = `${hours}h`;
      } else {
        els.timeSavedValue.textContent = `${minutes} min`;
      }

      els.recoveriesValue.textContent = stats.totalRecoveries || 0;
      els.fillCountValue.textContent = stats.totalFills || 0;

    } catch (err) {
      console.error('[OriginFill Popup] Stats load error:', err);
    }
  }

  // ─── Theme ─────────────────────────────────────────────────────

  async function applyTheme() {
    const result = await chrome.storage.local.get('originfill_settings');
    const s = result.originfill_settings || {};

    if (s.theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else if (s.theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    }
    // 'system' = no data-theme attribute, CSS media query handles it
  }

  // ─── Badge ─────────────────────────────────────────────────────

  /**
   * Update the portal badge in the popup.
   * @param {'success'|'warning'|'none'} type
   * @param {string} icon
   * @param {string} text
   */
  function updateBadge(type, icon, text) {
    els.portalBadge.className = `popup__badge popup__badge--${type}`;
    els.badgeIcon.textContent = icon;
    els.badgeText.textContent = text;
  }

  // ─── Event Listeners ──────────────────────────────────────────

  // Settings button
  els.settingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Setup profile (welcome state)
  els.setupProfileBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Go to settings (no form state)
  els.goSettingsBtn.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  // Profile switcher
  els.profileSelect.addEventListener('change', async () => {
    const newId = els.profileSelect.value;
    if (newId) {
      settings.activeProfileId = newId;
      await chrome.storage.local.set({
        originfill_settings: settings,
        settings: settings
      });

      // Notify content scripts
      chrome.runtime.sendMessage({
        type: 'PROFILE_UPDATED',
        data: { activeProfileId: newId }
      });
    }
  });

  // Real-time synchronization when settings or profiles change in settings page
  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== 'local') return;
    if (
      changes.profiles ||
      changes.originfill_profiles ||
      changes.settings ||
      changes.originfill_settings
    ) {
      console.log('[OriginFill Popup] Storage update detected, refreshing popup...');
      await loadProfilesAndSettings();
      if (profiles.length === 0) {
        showState('welcome');
      } else if (currentPortalInfo && currentPortalInfo.portalType && currentPortalInfo.portalType !== 'none') {
        showDetectedState(currentPortalInfo);
      } else {
        showState('noForm');
      }
      updateFillButtonStates();
    }
  });

  // Fill all
  els.fillAllBtn.addEventListener('click', () => sendFillCommand('all'));

  // Section fills
  els.fillPersonalBtn.addEventListener('click', () => sendFillCommand('personal'));
  els.fillEducationBtn.addEventListener('click', () => sendFillCommand('education'));
  els.fillWorkBtn.addEventListener('click', () => sendFillCommand('workExperience'));

  // Session restore
  els.restoreBtn.addEventListener('click', () => sendRestoreCommand());

  // Dismiss recovery
  els.dismissRecoveryBtn.addEventListener('click', async () => {
    await chrome.storage.local.remove('originfill_session_recovery');
    if (currentPortalInfo && currentPortalInfo.portalType !== 'none') {
      showDetectedState(currentPortalInfo);
    } else {
      showState('noForm');
    }
  });

  // View report buttons
  els.viewReportBtn.addEventListener('click', () => renderReport(currentReport));
  els.viewFullReportBtn.addEventListener('click', () => renderReport(currentReport));

  // Close report
  els.closeReportBtn.addEventListener('click', () => {
    els.fillReport.hidden = true;
  });

  // Fill again
  els.fillAgainBtn.addEventListener('click', () => {
    if (currentPortalInfo && currentPortalInfo.portalType !== 'none') {
      showDetectedState(currentPortalInfo);
    }
  });

  // ─── Message Listener ─────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message) => {
    const { type, data } = message;

    switch (type) {
      case 'FILL_PROGRESS':
        updateFillProgress(data);
        break;

      case 'FILL_COMPLETE':
        showFillComplete(data);
        break;

      case 'FILL_ERROR':
        showFillComplete(data);
        break;

      case 'PAGE_CHANGED':
        if (data.pageName && currentPortalInfo) {
          currentPortalInfo.pageName = data.pageName;
          currentPortalInfo.pageNumber = data.pageNumber;
          currentPortalInfo.totalPages = data.totalPages;
          showDetectedState(currentPortalInfo);
        }
        break;

      case 'SESSION_RESTORED':
        showFillComplete(data);
        break;
    }
  });

  // ─── Utility Functions ─────────────────────────────────────────

  function getPortalDisplayName(type) {
    const names = {
      workday: 'Workday',
      greenhouse: 'Greenhouse',
      lever: 'Lever',
      icims: 'iCIMS',
      taleo: 'Taleo',
      generic: 'Generic Portal',
      none: 'No Portal'
    };
    return names[type] || 'Unknown';
  }

  function getTimeAgo(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
    return `${Math.floor(seconds / 86400)} days ago`;
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Initialize ────────────────────────────────────────────────
  await init();

})();
