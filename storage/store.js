/**
 * OriginFill — Storage Abstraction Layer
 * Provides encrypted CRUD for profiles, settings, stats, and session recovery.
 * Resumes stored in IndexedDB (separate from chrome.storage.local).
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

const OriginFillStore = (() => {
  'use strict';

  /** @type {IDBDatabase|null} */
  let _db = null;

  // ─── IndexedDB for Resumes ─────────────────────────────────────

  /**
   * Open (or create) the IndexedDB database for resume storage.
   * @returns {Promise<IDBDatabase>}
   */
  function openDB() {
    if (_db) return Promise.resolve(_db);

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(
        OriginFillIDB.DB_NAME,
        OriginFillIDB.DB_VERSION
      );

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(OriginFillIDB.STORE_RESUMES)) {
          const store = db.createObjectStore(OriginFillIDB.STORE_RESUMES, { keyPath: 'id' });
          store.createIndex('profileId', 'profileId', { unique: false });
          store.createIndex('label', 'label', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        _db = event.target.result;
        resolve(_db);
      };

      request.onerror = (event) => {
        OriginFillLogger.error('Failed to open IndexedDB', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Save a resume file to IndexedDB.
   * @param {string} profileId
   * @param {{ id: string, label: string, fileName: string, fileData: string, uploadedAt: string }} resumeData
   * @returns {Promise<void>}
   */
  async function saveResume(profileId, resumeData) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(OriginFillIDB.STORE_RESUMES, 'readwrite');
      const store = tx.objectStore(OriginFillIDB.STORE_RESUMES);

      store.put({ ...resumeData, profileId });

      tx.oncomplete = () => {
        OriginFillLogger.info(`Resume saved: ${resumeData.label}`);
        resolve();
      };
      tx.onerror = (event) => {
        OriginFillLogger.error('Failed to save resume', event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Get all resumes for a profile.
   * @param {string} profileId
   * @returns {Promise<Array>}
   */
  async function getResumes(profileId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(OriginFillIDB.STORE_RESUMES, 'readonly');
      const store = tx.objectStore(OriginFillIDB.STORE_RESUMES);
      const index = store.index('profileId');
      const request = index.getAll(profileId);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = (event) => reject(event.target.error);
    });
  }

  /**
   * Delete a specific resume.
   * @param {string} resumeId
   * @returns {Promise<void>}
   */
  async function deleteResume(resumeId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(OriginFillIDB.STORE_RESUMES, 'readwrite');
      const store = tx.objectStore(OriginFillIDB.STORE_RESUMES);
      store.delete(resumeId);

      tx.oncomplete = () => resolve();
      tx.onerror = (event) => reject(event.target.error);
    });
  }

  /**
   * Delete all resumes for a profile.
   * @param {string} profileId
   * @returns {Promise<void>}
   */
  async function deleteProfileResumes(profileId) {
    const resumes = await getResumes(profileId);
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(OriginFillIDB.STORE_RESUMES, 'readwrite');
      const store = tx.objectStore(OriginFillIDB.STORE_RESUMES);

      resumes.forEach(r => store.delete(r.id));

      tx.oncomplete = () => resolve();
      tx.onerror = (event) => reject(event.target.error);
    });
  }

  // ─── Chrome Storage Helpers ────────────────────────────────────

  /**
   * Read a key from chrome.storage.local (with decryption).
   * @param {string} key
   * @returns {Promise<any>} Decrypted data, or null if not found
   */
  async function readEncrypted(key) {
    const result = await chrome.storage.local.get(key);
    if (!result[key]) return null;

    try {
      return await OriginFillEncryption.decryptObject(result[key]);
    } catch (e) {
      OriginFillLogger.error(`Failed to decrypt ${key}`, e);
      return null;
    }
  }

  /**
   * Write data to chrome.storage.local (with encryption).
   * @param {string} key
   * @param {any} data
   * @returns {Promise<void>}
   */
  async function writeEncrypted(key, data) {
    const encrypted = await OriginFillEncryption.encryptObject(data);
    await chrome.storage.local.set({ [key]: encrypted });
  }

  /**
   * Read a key from chrome.storage.local (plaintext, for non-sensitive data).
   * @param {string} key
   * @returns {Promise<any>}
   */
  async function readPlain(key) {
    const result = await chrome.storage.local.get(key);
    return result[key] ?? null;
  }

  /**
   * Write plaintext data to chrome.storage.local.
   * @param {string} key
   * @param {any} data
   * @returns {Promise<void>}
   */
  async function writePlain(key, data) {
    await chrome.storage.local.set({ [key]: data });
  }

  // ─── Profile CRUD ─────────────────────────────────────────────

  /**
   * Generate a unique profile ID.
   * @returns {string}
   */
  function generateProfileId() {
    return 'profile_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  /**
   * Get all profiles.
   * @returns {Promise<Array>}
   */
  async function getProfiles() {
    await OriginFillEncryption.initializeKey();
    const profiles = await readEncrypted(OriginFillStorageKeys.PROFILES);
    return profiles || [];
  }

  /**
   * Save all profiles (replaces entire profiles array).
   * @param {Array} profiles
   * @returns {Promise<void>}
   */
  async function saveProfiles(profiles) {
    await OriginFillEncryption.initializeKey();
    await writeEncrypted(OriginFillStorageKeys.PROFILES, profiles);
  }

  /**
   * Get a single profile by ID.
   * @param {string} profileId
   * @returns {Promise<Object|null>}
   */
  async function getProfile(profileId) {
    const profiles = await getProfiles();
    return profiles.find(p => p.id === profileId) || null;
  }

  /**
   * Get the active (selected) profile.
   * @returns {Promise<Object|null>}
   */
  async function getActiveProfile() {
    const settings = await getSettings();
    if (!settings.activeProfileId) {
      // Return default profile if none set
      const profiles = await getProfiles();
      const defaultProfile = profiles.find(p => p.isDefault) || profiles[0];
      return defaultProfile || null;
    }
    return getProfile(settings.activeProfileId);
  }

  /**
   * Create a new profile from the default template.
   * @param {string} [label='New Profile']
   * @returns {Promise<Object>} The created profile
   */
  async function createProfile(label = 'New Profile') {
    const profiles = await getProfiles();
    const isFirst = profiles.length === 0;

    const newProfile = JSON.parse(JSON.stringify(OriginFillDefaultProfile));
    newProfile.id = generateProfileId();
    newProfile.label = label;
    newProfile.isDefault = isFirst;
    newProfile.colorTag = OriginFillUI.PROFILE_COLORS[
      profiles.length % OriginFillUI.PROFILE_COLORS.length
    ];

    profiles.push(newProfile);
    await saveProfiles(profiles);

    // If first profile, set as active
    if (isFirst) {
      const settings = await getSettings();
      settings.activeProfileId = newProfile.id;
      await saveSettings(settings);
    }

    OriginFillLogger.info(`Profile created: ${label} (${newProfile.id})`);
    return newProfile;
  }

  /**
   * Update a profile by ID (partial update — merges with existing).
   * @param {string} profileId
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated profile
   */
  async function updateProfile(profileId, updates) {
    const profiles = await getProfiles();
    const index = profiles.findIndex(p => p.id === profileId);

    if (index === -1) {
      throw new Error(`Profile not found: ${profileId}`);
    }

    // Deep merge updates
    profiles[index] = deepMerge(profiles[index], updates);
    await saveProfiles(profiles);

    OriginFillLogger.info(`Profile updated: ${profiles[index].label}`);
    return profiles[index];
  }

  /**
   * Delete a profile by ID.
   * @param {string} profileId
   * @returns {Promise<void>}
   */
  async function deleteProfile(profileId) {
    let profiles = await getProfiles();

    if (profiles.length <= 1) {
      throw new Error('Cannot delete the last profile');
    }

    profiles = profiles.filter(p => p.id !== profileId);

    // If deleted profile was default, make first remaining profile default
    if (!profiles.some(p => p.isDefault)) {
      profiles[0].isDefault = true;
    }

    await saveProfiles(profiles);
    await deleteProfileResumes(profileId);

    // Update active profile if it was the deleted one
    const settings = await getSettings();
    if (settings.activeProfileId === profileId) {
      settings.activeProfileId = profiles.find(p => p.isDefault)?.id || profiles[0].id;
      await saveSettings(settings);
    }

    OriginFillLogger.info(`Profile deleted: ${profileId}`);
  }

  /**
   * Duplicate a profile.
   * @param {string} profileId
   * @returns {Promise<Object>} The duplicated profile
   */
  async function duplicateProfile(profileId) {
    const source = await getProfile(profileId);
    if (!source) throw new Error(`Profile not found: ${profileId}`);

    const profiles = await getProfiles();
    const duplicate = JSON.parse(JSON.stringify(source));
    duplicate.id = generateProfileId();
    duplicate.label = `${source.label} (Copy)`;
    duplicate.isDefault = false;
    duplicate.colorTag = OriginFillUI.PROFILE_COLORS[
      profiles.length % OriginFillUI.PROFILE_COLORS.length
    ];

    profiles.push(duplicate);
    await saveProfiles(profiles);

    OriginFillLogger.info(`Profile duplicated: ${source.label} → ${duplicate.label}`);
    return duplicate;
  }

  /**
   * Set the active profile.
   * @param {string} profileId
   * @returns {Promise<void>}
   */
  async function setActiveProfile(profileId) {
    const settings = await getSettings();
    settings.activeProfileId = profileId;
    await saveSettings(settings);
    OriginFillLogger.info(`Active profile set: ${profileId}`);
  }

  // ─── Settings CRUD ─────────────────────────────────────────────

  /**
   * Get extension settings.
   * @returns {Promise<Object>}
   */
  async function getSettings() {
    const settings = await readPlain(OriginFillStorageKeys.SETTINGS);
    return settings
      ? { ...OriginFillDefaultSettings, ...settings }
      : { ...OriginFillDefaultSettings };
  }

  /**
   * Save extension settings.
   * @param {Object} settings
   * @returns {Promise<void>}
   */
  async function saveSettings(settings) {
    await writePlain(OriginFillStorageKeys.SETTINGS, settings);
  }

  /**
   * Update specific settings (partial merge).
   * @param {Object} updates
   * @returns {Promise<Object>}
   */
  async function updateSettings(updates) {
    const current = await getSettings();
    const updated = { ...current, ...updates };
    await saveSettings(updated);
    return updated;
  }

  // ─── Session Recovery ──────────────────────────────────────────

  /**
   * Save a session snapshot (triggered on field blur).
   * @param {Object} snapshot - { url, portal, fields, timestamp }
   * @returns {Promise<void>}
   */
  async function saveSessionSnapshot(snapshot) {
    const data = {
      lastUrl: snapshot.url || '',
      lastPortal: snapshot.portal || '',
      savedFields: snapshot.fields || {},
      savedAt: new Date().toISOString()
    };

    await writePlain(OriginFillStorageKeys.SESSION_RECOVERY, data);
    OriginFillLogger.debug('Session snapshot saved', Object.keys(data.savedFields).length, 'fields');
  }

  /**
   * Get the saved session snapshot.
   * @returns {Promise<Object|null>}
   */
  async function getSessionSnapshot() {
    return readPlain(OriginFillStorageKeys.SESSION_RECOVERY);
  }

  /**
   * Clear the session snapshot.
   * @returns {Promise<void>}
   */
  async function clearSessionSnapshot() {
    await chrome.storage.local.remove(OriginFillStorageKeys.SESSION_RECOVERY);
    OriginFillLogger.debug('Session snapshot cleared');
  }

  // ─── Stats ─────────────────────────────────────────────────────

  /**
   * Get usage stats.
   * @returns {Promise<Object>}
   */
  async function getStats() {
    const stats = await readPlain(OriginFillStorageKeys.STATS);
    return stats
      ? { ...OriginFillDefaultStats, ...stats }
      : { ...OriginFillDefaultStats };
  }

  /**
   * Update stats with delta values.
   * @param {Object} delta - Incremental values to add
   * @returns {Promise<Object>}
   */
  async function updateStats(delta) {
    const current = await getStats();

    if (delta.totalFills) current.totalFills += delta.totalFills;
    if (delta.totalFieldsFilled) current.totalFieldsFilled += delta.totalFieldsFilled;
    if (delta.totalRecoveries) current.totalRecoveries += delta.totalRecoveries;
    if (delta.totalTimeSavedMinutes) current.totalTimeSavedMinutes += delta.totalTimeSavedMinutes;
    if (delta.portal) {
      current.portalsUsed[delta.portal] = (current.portalsUsed[delta.portal] || 0) + 1;
    }
    if (delta.fillSuccessRate !== undefined) {
      // Running average
      const totalFills = current.totalFills || 1;
      current.fillSuccessRate = (
        (current.fillSuccessRate * (totalFills - 1) + delta.fillSuccessRate) / totalFills
      );
    }

    current.lastFillDate = new Date().toISOString();
    await writePlain(OriginFillStorageKeys.STATS, current);
    return current;
  }

  // ─── First Run ─────────────────────────────────────────────────

  /**
   * Check if this is the first time the extension is run.
   * @returns {Promise<boolean>}
   */
  async function isFirstRun() {
    const value = await readPlain(OriginFillStorageKeys.FIRST_RUN);
    return value !== false;
  }

  /**
   * Mark first run as complete.
   * @returns {Promise<void>}
   */
  async function completeFirstRun() {
    await writePlain(OriginFillStorageKeys.FIRST_RUN, false);
  }

  // ─── Data Export / Import ──────────────────────────────────────

  /**
   * Export all data as a plain JSON object.
   * @returns {Promise<Object>}
   */
  async function exportAllData() {
    const profiles = await getProfiles();
    const settings = await getSettings();
    const stats = await getStats();

    // Get resumes from IndexedDB for each profile
    const resumes = {};
    for (const profile of profiles) {
      resumes[profile.id] = await getResumes(profile.id);
    }

    return {
      exportVersion: 1,
      exportDate: new Date().toISOString(),
      profiles,
      settings,
      stats,
      resumes
    };
  }

  /**
   * Import data from a JSON export.
   * @param {Object} data - Exported data object
   * @param {boolean} [merge=false] - If true, merge with existing; if false, replace
   * @returns {Promise<void>}
   */
  async function importData(data, merge = false) {
    // Validate export format
    if (!data.exportVersion || !data.profiles) {
      throw new Error('Invalid export file format');
    }

    if (merge) {
      // Merge profiles (add new, skip existing IDs)
      const existing = await getProfiles();
      const existingIds = new Set(existing.map(p => p.id));
      const newProfiles = data.profiles.filter(p => !existingIds.has(p.id));
      await saveProfiles([...existing, ...newProfiles]);
    } else {
      // Replace everything
      await saveProfiles(data.profiles);
    }

    if (data.settings) {
      if (merge) {
        await updateSettings(data.settings);
      } else {
        await saveSettings(data.settings);
      }
    }

    if (data.stats && !merge) {
      await writePlain(OriginFillStorageKeys.STATS, data.stats);
    }

    // Import resumes
    if (data.resumes) {
      for (const [profileId, resumeList] of Object.entries(data.resumes)) {
        for (const resume of resumeList) {
          await saveResume(profileId, resume);
        }
      }
    }

    OriginFillLogger.success('Data imported successfully');
  }

  /**
   * Clear ALL extension data (profiles, settings, stats, resumes).
   * @returns {Promise<void>}
   */
  async function clearAllData() {
    // Clear chrome.storage.local (except encryption key)
    await chrome.storage.local.remove([
      OriginFillStorageKeys.PROFILES,
      OriginFillStorageKeys.SETTINGS,
      OriginFillStorageKeys.SESSION_RECOVERY,
      OriginFillStorageKeys.STATS,
      OriginFillStorageKeys.FIRST_RUN
    ]);

    // Clear IndexedDB
    const db = await openDB();
    const tx = db.transaction(OriginFillIDB.STORE_RESUMES, 'readwrite');
    tx.objectStore(OriginFillIDB.STORE_RESUMES).clear();

    OriginFillLogger.warn('All data cleared');
  }

  // ─── Initialize ────────────────────────────────────────────────

  /**
   * Initialize storage on extension install/startup.
   * Creates default profile if none exists.
   * @returns {Promise<void>}
   */
  async function initialize() {
    OriginFillLogger.time('Storage init');

    // Initialize encryption key
    await OriginFillEncryption.initializeKey();

    // Initialize IndexedDB
    await openDB();

    // Create default profile if none exists
    const profiles = await getProfiles();
    if (profiles.length === 0) {
      await createProfile('Default Profile');
    }

    // Ensure settings exist
    const settings = await getSettings();
    if (!settings.activeProfileId) {
      const profiles2 = await getProfiles();
      settings.activeProfileId = profiles2[0]?.id || '';
      await saveSettings(settings);
    }

    OriginFillLogger.timeEnd('Storage init');
    OriginFillLogger.success('Storage initialized');
  }

  // ─── Utility: Deep Merge ───────────────────────────────────────

  /**
   * Deep merge two objects. Source values overwrite target values.
   * Arrays are replaced, not merged.
   * @param {Object} target
   * @param {Object} source
   * @returns {Object}
   */
  function deepMerge(target, source) {
    const output = { ...target };

    for (const key of Object.keys(source)) {
      if (
        source[key] &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key]) &&
        target[key] &&
        typeof target[key] === 'object' &&
        !Array.isArray(target[key])
      ) {
        output[key] = deepMerge(target[key], source[key]);
      } else {
        output[key] = source[key];
      }
    }

    return output;
  }

  // ─── Public API ─────────────────────────────────────────────────
  return Object.freeze({
    // Initialize
    initialize,

    // Profiles
    getProfiles,
    getProfile,
    getActiveProfile,
    createProfile,
    updateProfile,
    deleteProfile,
    duplicateProfile,
    setActiveProfile,

    // Settings
    getSettings,
    saveSettings,
    updateSettings,

    // Session Recovery
    saveSessionSnapshot,
    getSessionSnapshot,
    clearSessionSnapshot,

    // Stats
    getStats,
    updateStats,

    // Resumes (IndexedDB)
    saveResume,
    getResumes,
    deleteResume,

    // First Run
    isFirstRun,
    completeFirstRun,

    // Data Management
    exportAllData,
    importData,
    clearAllData,

    // Utility
    generateProfileId
  });
})();
