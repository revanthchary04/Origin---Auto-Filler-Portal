/**
 * OriginFill — Core Auto-Fill Engine
 * Orchestrates form filling using portal-specific mappers.
 * Reports progress, handles retries, and generates fill reports.
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

const OriginFillFiller = (() => {
  'use strict';

  /** @type {boolean} Fill operation in progress */
  let _filling = false;

  /** @type {boolean} Cancel requested */
  let _cancelRequested = false;

  /** @type {Array} Fill results for current operation */
  let _currentResults = [];

  /** @type {number} Fill start timestamp */
  let _fillStartTime = 0;

  // ─── Master Fill Function ──────────────────────────────────────

  /**
   * Fill all detected fields on the current page.
   *
   * @param {Object} profile - Active profile data
   * @param {string} portalType - Detected portal type
   * @param {Object} [options]
   * @param {string} [options.section='all'] - Section to fill (personal, education, workExperience, all)
   * @param {number} [options.fillDelay=300] - Delay between fields in ms
   * @param {Function} [options.onProgress] - Progress callback(current, total, fieldName)
   * @param {Function} [options.onComplete] - Completion callback(report)
   * @returns {Promise<Object>} Fill report
   */
  async function fillAll(profile, portalType, options = {}) {
    if (_filling) {
      OriginFillLogger.warn('Fill already in progress');
      return { error: 'Fill already in progress' };
    }

    _filling = true;
    _cancelRequested = false;
    _currentResults = [];
    _fillStartTime = performance.now();

    const section = options.section || OriginFillSections.ALL;
    const fillDelay = options.fillDelay || OriginFillTiming.FILL_DELAY_DEFAULT;
    const onProgress = options.onProgress || (() => {});
    const onComplete = options.onComplete || (() => {});

    OriginFillLogger.time('Fill operation');
    OriginFillLogger.info(`Starting fill: portal=${portalType}, section=${section}`);

    // Notify popup that fill has started
    sendMessage(OriginFillMessages.FILL_PROGRESS, {
      phase: 'started',
      current: 0,
      total: 0,
      section
    });

    try {
      // Get fields based on portal type
      const fields = getFieldsForPortal(portalType, section);

      if (fields.length === 0) {
        const report = generateReport([], portalType);
        OriginFillLogger.warn('No fillable fields found');
        _filling = false;
        onComplete(report);
        sendMessage(OriginFillMessages.FILL_COMPLETE, report);
        return report;
      }

      OriginFillLogger.info(`Found ${fields.length} fields to fill`);

      // Fill each field with delay
      for (let i = 0; i < fields.length; i++) {
        if (_cancelRequested) {
          OriginFillLogger.warn('Fill cancelled by user');
          break;
        }

        const field = fields[i];
        const value = OriginFillFieldMapper.resolveProfilePath(profile, field.profilePath);
        const label = field.label || field.automationId || field.fieldType;

        // Report progress
        onProgress(i + 1, fields.length, label);
        sendMessage(OriginFillMessages.FILL_PROGRESS, {
          phase: 'filling',
          current: i + 1,
          total: fields.length,
          fieldName: label,
          section
        });

        // Fill the field
        const result = await fillSingleField(field, value, portalType);

        _currentResults.push({
          field: label,
          fieldType: field.fieldType,
          status: result.status,
          value: maskSensitiveValue(value, field.fieldType),
          note: result.note
        });

        // Delay between fields
        if (i < fields.length - 1 && fillDelay > 0) {
          await delay(fillDelay);
        }
      }

      // Generate report
      const report = generateReport(_currentResults, portalType);

      OriginFillLogger.timeEnd('Fill operation');
      OriginFillLogger.fillReport(_currentResults);

      // Notify completion
      _filling = false;
      onComplete(report);
      sendMessage(OriginFillMessages.FILL_COMPLETE, report);

      // Update stats
      sendMessage(OriginFillMessages.STATS_UPDATED, {
        totalFills: 1,
        totalFieldsFilled: report.successCount,
        totalTimeSavedMinutes: ORIGINFILL_AVG_MANUAL_FILL_MINUTES,
        portal: portalType,
        fillSuccessRate: report.successRate
      });

      return report;

    } catch (err) {
      OriginFillLogger.error('Fill operation failed:', err);
      _filling = false;

      const errorReport = {
        success: false,
        error: err.message,
        results: _currentResults,
        ...generateReport(_currentResults, portalType)
      };

      sendMessage(OriginFillMessages.FILL_ERROR, errorReport);
      onComplete(errorReport);

      return errorReport;

    } finally {
      _filling = false;
    }
  }

  // ─── Field Discovery by Portal ─────────────────────────────────

  /**
   * Get fillable fields based on portal type and section filter.
   *
   * @param {string} portalType
   * @param {string} section
   * @returns {Array<{ element: HTMLElement, fieldType: string, profilePath: string, inputType: string, label?: string, automationId?: string }>}
   */
  function getFieldsForPortal(portalType, section) {
    let allFields;

    switch (portalType) {
      case OriginFillPortals.WORKDAY:
        allFields = OriginFillWorkday.getFields();
        break;

      case OriginFillPortals.GENERIC:
      default:
        allFields = OriginFillGeneric.getFields();
        break;
    }

    // Filter by section if not 'all'
    if (section !== OriginFillSections.ALL) {
      allFields = allFields.filter(f => {
        const path = f.profilePath || '';
        switch (section) {
          case OriginFillSections.PERSONAL:
            return path.startsWith('personal.');
          case OriginFillSections.EDUCATION:
            return path.startsWith('education');
          case OriginFillSections.WORK_EXPERIENCE:
            return path.startsWith('workExperience');
          case OriginFillSections.RESUME:
            return path === 'resume';
          default:
            return true;
        }
      });
    }

    return allFields;
  }

  // ─── Single Field Fill ─────────────────────────────────────────

  /**
   * Fill a single field with retry logic.
   *
   * @param {Object} field - Field descriptor
   * @param {any} value - Value to fill
   * @param {string} portalType - Portal type
   * @returns {Promise<{ status: string, note: string }>}
   */
  async function fillSingleField(field, value, portalType) {
    // Skip if no value
    if (value === undefined || value === null || value === '') {
      return {
        status: OriginFillStatus.SKIPPED,
        note: 'No value in profile'
      };
    }

    // Skip if field is not visible
    if (!OriginFillDetector.isVisible(field.element)) {
      return {
        status: OriginFillStatus.SKIPPED,
        note: 'Field not visible'
      };
    }

    // Attempt fill with retries
    let lastResult;

    for (let attempt = 0; attempt < OriginFillTiming.FIELD_RETRY_MAX; attempt++) {
      try {
        let result;

        if (portalType === OriginFillPortals.WORKDAY) {
          result = await OriginFillWorkday.fillField(
            field.element, value, field.inputType
          );
        } else {
          result = await OriginFillGeneric.fillField(
            field.element, value, field.inputType
          );
        }

        if (result.success) {
          // Check if there are validation errors after fill
          const hasError = await checkFieldValidation(field.element);

          if (hasError && attempt < OriginFillTiming.FIELD_RETRY_MAX - 1) {
            OriginFillLogger.debug(`Retry ${attempt + 1}: validation error on ${field.fieldType}`);
            await delay(OriginFillTiming.VALIDATION_WAIT);
            continue;
          }

          return {
            status: result.note ? OriginFillStatus.ATTENTION : OriginFillStatus.SUCCESS,
            note: result.note + (hasError ? ' (validation warning)' : '')
          };
        }

        lastResult = result;

      } catch (err) {
        lastResult = { success: false, note: err.message };
        OriginFillLogger.debug(`Retry ${attempt + 1}: error on ${field.fieldType}:`, err.message);
      }

      // Wait before retry
      if (attempt < OriginFillTiming.FIELD_RETRY_MAX - 1) {
        await delay(OriginFillTiming.FIELD_RETRY_DELAY);
      }
    }

    return {
      status: OriginFillStatus.FAILED,
      note: lastResult?.note || 'Unknown error'
    };
  }

  // ─── Validation Check ─────────────────────────────────────────

  /**
   * Check if a field has a validation error after being filled.
   *
   * @param {HTMLElement} element
   * @returns {Promise<boolean>}
   */
  async function checkFieldValidation(element) {
    await delay(100); // Brief wait for validation to trigger

    // Check HTML5 validity
    if (element.validity && !element.validity.valid) {
      return true;
    }

    // Check for common error classes
    const errorClasses = ['error', 'invalid', 'has-error', 'is-invalid', 'field-error'];
    const classList = element.className.toLowerCase();
    for (const cls of errorClasses) {
      if (classList.includes(cls)) return true;
    }

    // Check for error ARIA state
    if (element.getAttribute('aria-invalid') === 'true') {
      return true;
    }

    // Check adjacent error messages
    const parent = element.parentElement;
    if (parent) {
      const errorEl = parent.querySelector('.error, .error-message, [role="alert"]');
      if (errorEl && OriginFillDetector.isVisible(errorEl)) {
        return true;
      }
    }

    return false;
  }

  // ─── Fill Report ───────────────────────────────────────────────

  /**
   * Generate a fill report from results.
   *
   * @param {Array<{ field: string, status: string, value: string, note: string }>} results
   * @param {string} portalType
   * @returns {Object}
   */
  function generateReport(results, portalType) {
    const elapsed = performance.now() - _fillStartTime;

    const successCount = results.filter(r => r.status === OriginFillStatus.SUCCESS).length;
    const attentionCount = results.filter(r => r.status === OriginFillStatus.ATTENTION).length;
    const failedCount = results.filter(r => r.status === OriginFillStatus.FAILED).length;
    const skippedCount = results.filter(r => r.status === OriginFillStatus.SKIPPED).length;

    const totalAttempted = results.length - skippedCount;
    const successRate = totalAttempted > 0
      ? Math.round(((successCount + attentionCount) / totalAttempted) * 100)
      : 0;

    return {
      success: failedCount === 0,
      portalType,
      portalName: OriginFillDetector.getPortalDisplayName(portalType),
      url: window.location.href,
      timestamp: new Date().toISOString(),
      elapsed: Math.round(elapsed),
      elapsedFormatted: formatDuration(elapsed),
      totalFields: results.length,
      successCount,
      attentionCount,
      failedCount,
      skippedCount,
      successRate,
      results,
      successResults: results.filter(r => r.status === OriginFillStatus.SUCCESS),
      attentionResults: results.filter(r => r.status === OriginFillStatus.ATTENTION),
      failedResults: results.filter(r => r.status === OriginFillStatus.FAILED),
      skippedResults: results.filter(r => r.status === OriginFillStatus.SKIPPED)
    };
  }

  // ─── Session Snapshot ──────────────────────────────────────────

  /**
   * Capture a snapshot of all currently filled fields on the page.
   * Used for session recovery on field blur.
   *
   * @returns {Object} Snapshot of field values
   */
  function captureFieldSnapshot() {
    const snapshot = {};

    const inputs = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea'
    );

    inputs.forEach((input, index) => {
      const value = input.type === 'checkbox' || input.type === 'radio'
        ? input.checked
        : input.value;

      if (value && value !== '') {
        // Create a stable key from the field's identity
        const key = input.id
          || input.name
          || input.getAttribute('data-automation-id')
          || `field_${index}`;

        snapshot[key] = {
          value,
          type: input.type || input.tagName.toLowerCase(),
          label: OriginFillDetector.getInputLabel(input),
          index
        };
      }
    });

    return snapshot;
  }

  /**
   * Restore fields from a session snapshot.
   *
   * @param {Object} snapshot - Field snapshot from captureFieldSnapshot()
   * @returns {Promise<{ restored: number, failed: number }>}
   */
  async function restoreFromSnapshot(snapshot) {
    if (!snapshot || Object.keys(snapshot).length === 0) {
      return { restored: 0, failed: 0 };
    }

    let restored = 0;
    let failed = 0;

    for (const [key, fieldData] of Object.entries(snapshot)) {
      try {
        // Find the field by key
        let element = document.getElementById(key)
          || document.querySelector(`[name="${CSS.escape(key)}"]`)
          || document.querySelector(`[data-automation-id="${CSS.escape(key)}"]`);

        // Fallback: find by index
        if (!element && fieldData.index !== undefined) {
          const allInputs = document.querySelectorAll(
            'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea'
          );
          element = allInputs[fieldData.index];
        }

        if (element && OriginFillDetector.isVisible(element)) {
          const inputType = OriginFillFieldMapper.getInputType(element);
          const result = await OriginFillWorkday.fillField(
            element, fieldData.value, inputType
          );

          if (result.success) {
            restored++;
          } else {
            failed++;
          }
        } else {
          failed++;
        }
      } catch (err) {
        failed++;
        OriginFillLogger.debug(`Restore failed for ${key}:`, err.message);
      }

      await delay(50); // Small delay between restores
    }

    OriginFillLogger.info(`Snapshot restored: ${restored} success, ${failed} failed`);
    return { restored, failed };
  }

  // ─── Resume Upload ─────────────────────────────────────────────

  /**
   * Upload a resume file from stored base64 data.
   *
   * @param {HTMLInputElement} fileInput - File input element
   * @param {{ fileName: string, fileData: string }} resumeData - Resume from IndexedDB
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function uploadResume(fileInput, resumeData) {
    if (!resumeData || !resumeData.fileData) {
      return { success: false, note: 'No resume data' };
    }

    try {
      // Decode base64 to binary
      const binaryStr = atob(resumeData.fileData);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      // Determine MIME type
      const mimeType = resumeData.fileName.endsWith('.pdf')
        ? 'application/pdf'
        : resumeData.fileName.endsWith('.docx')
          ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
          : resumeData.fileName.endsWith('.doc')
            ? 'application/msword'
            : 'application/octet-stream';

      // Create File object
      const file = new File([bytes], resumeData.fileName, { type: mimeType });

      // Create DataTransfer and assign to input
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;

      // Dispatch change event
      fileInput.dispatchEvent(new Event('change', { bubbles: true }));
      fileInput.dispatchEvent(new Event('input', { bubbles: true }));

      OriginFillLogger.success(`Resume uploaded: ${resumeData.fileName}`);
      return { success: true, note: '' };

    } catch (err) {
      OriginFillLogger.error('Resume upload failed:', err);
      return { success: false, note: err.message };
    }
  }

  // ─── Control ───────────────────────────────────────────────────

  /**
   * Cancel the current fill operation.
   */
  function cancel() {
    if (_filling) {
      _cancelRequested = true;
      OriginFillLogger.warn('Fill cancel requested');
    }
  }

  /**
   * Check if a fill operation is currently in progress.
   * @returns {boolean}
   */
  function isFilling() {
    return _filling;
  }

  /**
   * Get the current fill results (live during fill).
   * @returns {Array}
   */
  function getCurrentResults() {
    return [..._currentResults];
  }

  // ─── Utilities ─────────────────────────────────────────────────

  /**
   * Mask sensitive values for display in reports.
   * @param {any} value
   * @param {string} fieldType
   * @returns {string}
   */
  function maskSensitiveValue(value, fieldType) {
    if (!value) return '—';
    const str = String(value);

    // Mask email: show first 2 chars + domain
    if (fieldType === 'email' && str.includes('@')) {
      const [local, domain] = str.split('@');
      return local.slice(0, 2) + '***@' + domain;
    }

    // Mask phone: show last 4 digits
    if (fieldType === 'phone') {
      return '***' + str.slice(-4);
    }

    // Truncate long values
    if (str.length > 40) {
      return str.slice(0, 37) + '...';
    }

    return str;
  }

  /**
   * Format duration in ms to human-readable string.
   * @param {number} ms
   * @returns {string}
   */
  function formatDuration(ms) {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  /**
   * Simple delay helper.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Send a message to the background/popup.
   * @param {string} type - Message type
   * @param {Object} data - Message data
   */
  function sendMessage(type, data) {
    try {
      chrome.runtime.sendMessage({ type, data });
    } catch (err) {
      // Extension context may be invalidated
      OriginFillLogger.debug('Message send failed:', err.message);
    }
  }

  // ─── Public API ─────────────────────────────────────────────────
  return Object.freeze({
    fillAll,
    cancel,
    isFilling,
    getCurrentResults,
    captureFieldSnapshot,
    restoreFromSnapshot,
    uploadResume,
    generateReport,
    getFieldsForPortal,
    maskSensitiveValue,
    formatDuration
  });
})();
