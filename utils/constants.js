/**
 * OriginFill — Shared Constants
 * @license AGPL-3.0
 * @author CharyWorld
 */

// ─── Portal Types ────────────────────────────────────────────────
const OriginFillPortals = Object.freeze({
  WORKDAY: 'workday',
  GREENHOUSE: 'greenhouse',
  LEVER: 'lever',
  ICIMS: 'icims',
  TALEO: 'taleo',
  GENERIC: 'generic',
  NONE: 'none'
});

// ─── Portal URL Patterns ─────────────────────────────────────────
const OriginFillPortalPatterns = Object.freeze([
  { type: OriginFillPortals.WORKDAY,    pattern: /myworkday(jobs)?\.com/i },
  { type: OriginFillPortals.GREENHOUSE, pattern: /greenhouse\.io/i },
  { type: OriginFillPortals.LEVER,      pattern: /lever\.co/i },
  { type: OriginFillPortals.ICIMS,      pattern: /icims\.com/i },
  { type: OriginFillPortals.TALEO,      pattern: /taleo\.net/i }
]);

// ─── Detection Confidence Levels ─────────────────────────────────
const OriginFillConfidence = Object.freeze({
  HIGH: 'high',       // URL + DOM confirmation
  MEDIUM: 'medium',   // URL match only
  LOW: 'low',         // DOM heuristics only
  NONE: 'none'        // Nothing detected
});

// ─── Fill Status ─────────────────────────────────────────────────
const OriginFillStatus = Object.freeze({
  SUCCESS: 'success',
  ATTENTION: 'attention',   // Filled but may need review (fuzzy match, fallback)
  FAILED: 'failed',
  SKIPPED: 'skipped',
  PENDING: 'pending'
});

// ─── Field Types ─────────────────────────────────────────────────
const OriginFillFieldTypes = Object.freeze({
  TEXT: 'text',
  EMAIL: 'email',
  PHONE: 'phone',
  URL: 'url',
  TEXTAREA: 'textarea',
  SELECT: 'select',
  RADIO: 'radio',
  CHECKBOX: 'checkbox',
  DATE: 'date',
  FILE: 'file',
  RICHTEXT: 'richtext',      // contenteditable divs
  COMBOBOX: 'combobox',       // Workday custom dropdowns
  NUMBER: 'number'
});

// ─── Message Types (content ↔ popup ↔ background) ────────────────
const OriginFillMessages = Object.freeze({
  // Detection
  GET_PORTAL_INFO: 'GET_PORTAL_INFO',
  PORTAL_DETECTED: 'PORTAL_DETECTED',

  // Filling
  FILL_ALL: 'FILL_ALL',
  FILL_SECTION: 'FILL_SECTION',
  FILL_PROGRESS: 'FILL_PROGRESS',
  FILL_COMPLETE: 'FILL_COMPLETE',
  FILL_ERROR: 'FILL_ERROR',

  // Session
  SESSION_TIMEOUT: 'SESSION_TIMEOUT',
  SESSION_SNAPSHOT_SAVED: 'SESSION_SNAPSHOT_SAVED',
  SESSION_RESTORE: 'SESSION_RESTORE',
  SESSION_RESTORED: 'SESSION_RESTORED',

  // Observer
  PAGE_CHANGED: 'PAGE_CHANGED',

  // Storage
  PROFILE_UPDATED: 'PROFILE_UPDATED',
  SETTINGS_UPDATED: 'SETTINGS_UPDATED',

  // Stats
  STATS_UPDATED: 'STATS_UPDATED',

  // Generic
  PING: 'PING',
  PONG: 'PONG',
  GET_STATE: 'GET_STATE'
});

// ─── Fill Sections ───────────────────────────────────────────────
const OriginFillSections = Object.freeze({
  PERSONAL: 'personal',
  EDUCATION: 'education',
  WORK_EXPERIENCE: 'workExperience',
  SKILLS: 'skills',
  RESUME: 'resume',
  ALL: 'all'
});

// ─── Storage Keys ────────────────────────────────────────────────
const OriginFillStorageKeys = Object.freeze({
  PROFILES: 'originfill_profiles',
  SETTINGS: 'originfill_settings',
  SESSION_RECOVERY: 'originfill_session_recovery',
  STATS: 'originfill_stats',
  ENCRYPTION_KEY: 'originfill_enc_key',
  FIRST_RUN: 'originfill_first_run'
});

// ─── Default Profile Template ────────────────────────────────────
const OriginFillDefaultProfile = Object.freeze({
  id: '',
  label: 'Default Profile',
  isDefault: true,
  colorTag: '#2563EB',
  personal: {
    firstName: '',
    lastName: '',
    fullName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    country: '',
    zipCode: '',
    linkedIn: '',
    github: '',
    portfolio: ''
  },
  education: [
    {
      institution: '',
      degree: '',
      fieldOfStudy: '',
      startYear: '',
      endYear: '',
      gpa: '',
      location: ''
    }
  ],
  workExperience: [
    {
      company: '',
      jobTitle: '',
      startDate: '',
      endDate: '',
      isCurrent: false,
      location: '',
      bullets: ['']
    }
  ],
  skills: [],
  certifications: [],
  languages: [],
  resume: {
    fileName: '',
    fileData: '',    // Stored in IndexedDB, not here
    uploadedAt: ''
  }
});

// ─── Default Settings ────────────────────────────────────────────
const OriginFillDefaultSettings = Object.freeze({
  activeProfileId: '',
  autoDetect: true,
  autoFillOnDetect: false,
  showNotifications: true,
  recoveryEnabled: true,
  fillDelay: 300,            // ms between field fills
  theme: 'system',           // 'light' | 'dark' | 'system'
  useEncryption: true,
  usePassphrase: false       // Advanced: user-defined passphrase
});

// ─── Default Stats ───────────────────────────────────────────────
const OriginFillDefaultStats = Object.freeze({
  totalFills: 0,
  totalFieldsFilled: 0,
  totalRecoveries: 0,
  totalTimeSavedMinutes: 0,
  portalsUsed: {},
  fillSuccessRate: 0,
  lastFillDate: ''
});

// ─── Timing Constants ────────────────────────────────────────────
const OriginFillTiming = Object.freeze({
  FILL_DELAY_DEFAULT: 300,       // ms between each field fill
  FILL_DELAY_MIN: 100,
  FILL_DELAY_MAX: 1000,
  OBSERVER_DEBOUNCE: 100,        // ms debounce for MutationObserver
  FIELD_RETRY_DELAY: 500,        // ms before retrying failed field
  FIELD_RETRY_MAX: 3,            // max retries per field
  SESSION_PING_INTERVAL: 60000,  // 60s background ping
  VALIDATION_WAIT: 500,          // ms to wait for validation to clear
  POPUP_RENDER_TARGET: 100       // ms target for popup render
});

// ─── Fuzzy Match Thresholds ──────────────────────────────────────
const OriginFillFuzzyConfig = Object.freeze({
  MAX_DISTANCE_RATIO: 0.30,     // Max Levenshtein distance as % of string length
  MIN_KEYWORD_MATCH_RATIO: 0.5, // Min keywords that must match
  FALLBACK_OPTIONS: [
    'other', 'not listed', 'not found', 'unlisted',
    'other institution', 'not applicable', 'n/a',
    'prefer not to say', 'not specified', 'please select'
  ]
});

// ─── UI Constants ────────────────────────────────────────────────
const OriginFillUI = Object.freeze({
  POPUP_WIDTH: 340,
  POPUP_MAX_HEIGHT: 480,
  MAX_RESUME_SIZE_MB: 5,
  MAX_RESUME_COUNT: 3,
  MAX_BULLET_POINTS: 6,
  BULLET_CHAR_LIMIT: 500,
  PROFILE_COLORS: [
    '#2563EB', '#7C3AED', '#059669', '#D97706',
    '#DC2626', '#0891B2', '#4F46E5', '#BE185D'
  ]
});

// ─── Encryption Constants ────────────────────────────────────────
const OriginFillCrypto = Object.freeze({
  ALGORITHM: 'AES-GCM',
  KEY_LENGTH: 256,
  IV_LENGTH: 12,                  // bytes
  SALT_LENGTH: 16,                // bytes
  PBKDF2_ITERATIONS: 100000,
  KEY_USAGE: ['encrypt', 'decrypt']
});

// ─── IndexedDB Constants ─────────────────────────────────────────
const OriginFillIDB = Object.freeze({
  DB_NAME: 'OriginFillDB',
  DB_VERSION: 1,
  STORE_RESUMES: 'resumes'
});

// ─── Dev Mode ────────────────────────────────────────────────────
const ORIGINFILL_DEV_MODE = true; // Set to false for production builds

// ─── Average manual fill time (for stats calculation) ────────────
const ORIGINFILL_AVG_MANUAL_FILL_MINUTES = 25;
