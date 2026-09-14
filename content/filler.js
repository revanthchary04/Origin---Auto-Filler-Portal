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
      // Get fields with bounded retry logic
      const fields = await waitForFillableFields(portalType, section);

      if (fields.length === 0) {
        OriginFillLogger.warn('No fillable fields found after wait');
        _filling = false;
        
        // Log "Detected Fields" diagnostic snapshot in dev mode
        if (typeof ORIGINFILL_DEV_MODE !== 'undefined' && ORIGINFILL_DEV_MODE) {
          logDiagnosticSnapshot();
        }

        const errorReport = {
          success: false,
          status: 'no_fields',
          portalType,
          totalFields: 0,
          successCount: 0,
          attentionCount: 0,
          failedCount: 0,
          skippedCount: 0,
          error: 'No fillable fields were detected on the current application page.'
        };
        
        onComplete(errorReport);
        sendMessage(OriginFillMessages.FILL_ERROR, errorReport);
        return errorReport;
      }

      // ─── Diagnostic Logging ───
      const domInputs = document.querySelectorAll('input:not([type="hidden"]), select, textarea, [contenteditable="true"], [role="combobox"]').length;
      const exactMatches = fields.filter(f => f.source === 'workday-exact' || f.source === 'exact').length;
      const genericMatches = fields.filter(f => f.source === 'generic-fallback' || f.source === 'generic').length;
      
      const detectionInfo = OriginFillDetector.getLastDetection();
      
      OriginFillLogger.info(`[OriginFill][Filler]
Portal: ${portalType}
Page: ${detectionInfo ? detectionInfo.pageName : 'Unknown'}
URL: ${window.location.href}
DOM input count: ${domInputs}
Exact mapped field count: ${exactMatches}
Generic fallback field count: ${genericMatches}
Final fillable field count: ${fields.length}`);

      OriginFillLogger.info(`Found ${fields.length} fields to fill`);

      // Fill each field with delay
      for (let i = 0; i < fields.length; i++) {
        if (_cancelRequested) {
          OriginFillLogger.warn('Fill cancelled by user');
          break;
        }

        const field = fields[i];
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

        // ─── Sensitive field check ───
        const sensitiveCheck = OriginFillFieldMapper.isSensitiveField(field.element);
        if (sensitiveCheck.isSensitive) {
          _currentResults.push({
            field: label,
            fieldType: field.fieldType,
            status: OriginFillStatus.SKIPPED,
            value: '—',
            note: sensitiveCheck.reason
          });
          continue;
        }

        // ─── Confidence gating ───
        const confidenceScore = OriginFillFieldMapper.getConfidenceScore(field.confidence || 'high');
        if (confidenceScore < OriginFillConfidenceThresholds.SKIP) {
          _currentResults.push({
            field: label,
            fieldType: field.fieldType,
            status: OriginFillStatus.SKIPPED,
            value: '—',
            note: `Confidence too low (${Math.round(confidenceScore * 100)}%) — skipped`
          });
          continue;
        }

        // ─── Resume upload (special handling) ───
        if (field.inputType === OriginFillFieldTypes.FILE ||
            field.profilePath === 'resume') {
          const resumeResult = await handleResumeUpload(field, profile);
          _currentResults.push({
            field: label,
            fieldType: 'resume',
            status: resumeResult.success ? OriginFillStatus.SUCCESS : OriginFillStatus.ATTENTION,
            value: resumeResult.fileName || '—',
            note: resumeResult.note
          });
          continue;
        }

        // ─── Resolve profile value ───
        const value = OriginFillFieldMapper.resolveProfilePath(profile, field.profilePath);
        
        // Handle no value gracefully instead of failing
        if (value === undefined || value === null || value === '') {
          _currentResults.push({
            field: label,
            fieldType: field.fieldType,
            status: OriginFillStatus.SKIPPED,
            value: '—',
            note: 'No value in profile'
          });
          continue;
        }

        // Fill the field
        const result = await fillSingleField(field, value, portalType);

        // Determine final status based on confidence
        let finalStatus = result.status;
        if (result.status === OriginFillStatus.SUCCESS &&
            confidenceScore < OriginFillConfidenceThresholds.AUTO_FILL &&
            confidenceScore >= OriginFillConfidenceThresholds.FLAG_REVIEW) {
          finalStatus = OriginFillStatus.ATTENTION;
          result.note = (result.note ? result.note + '; ' : '') +
            `Medium confidence (${Math.round(confidenceScore * 100)}%) — please verify`;
        }

        _currentResults.push({
          field: label,
          fieldType: field.fieldType,
          status: finalStatus,
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

  /**
   * Wait for fillable fields to appear, with bounded retries.
   * Helps with SPAs and asynchronous form loading.
   * 
   * @param {string} portalType
   * @param {string} section
   * @returns {Promise<Array>}
   */
  async function waitForFillableFields(portalType, section) {
    const retryDelays = [0, 300, 700, 1500];
    
    for (const waitTime of retryDelays) {
      if (waitTime > 0) await delay(waitTime);
      
      const fields = getFieldsForPortal(portalType, section);
      if (fields && fields.length > 0) {
        return fields;
      }
    }
    
    return [];
  }

  /**
   * Log a diagnostic snapshot of inputs when no fields are found.
   */
  function logDiagnosticSnapshot() {
    const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea');
    OriginFillLogger.debug(`\n--- DIAGNOSTIC SNAPSHOT ---`);
    OriginFillLogger.debug(`Inputs found: ${inputs.length}`);
    OriginFillLogger.debug(`Examples:`);
    
    Array.from(inputs).slice(0, 10).forEach((input, idx) => {
      OriginFillLogger.debug(`
${idx + 1}. tag=${input.tagName}
   type=${input.type || 'N/A'}
   name=${input.name || 'N/A'}
   id=${input.id || 'N/A'}
   automationId=${input.getAttribute('data-automation-id') || 'N/A'}
   label=${OriginFillDetector.getInputLabel(input) || 'N/A'}`);
    });
    OriginFillLogger.debug(`---------------------------\n`);
  }

  // ─── Single Field Fill ─────────────────────────────────────────

  /**
   * Fill a single field with retry logic and post-fill verification.
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
          // Post-fill verification
          const verified = await verifyFieldValue(field.element, value, field.inputType);

          if (!verified && attempt < OriginFillTiming.FIELD_RETRY_MAX - 1) {
            OriginFillLogger.debug(`Retry ${attempt + 1}: verification failed on ${field.fieldType}`);
            await delay(OriginFillTiming.FIELD_RETRY_DELAY);
            continue;
          }

          // Check if there are validation errors after fill
          const hasError = await checkFieldValidation(field.element);

          return {
            status: (result.note || hasError || !verified)
              ? OriginFillStatus.ATTENTION
              : OriginFillStatus.SUCCESS,
            note: [
              result.note,
              hasError ? 'validation warning' : '',
              !verified ? 'value may not have persisted' : ''
            ].filter(Boolean).join('; ')
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

  // ─── Post-Fill Verification ────────────────────────────────────

  async function verifyFieldValue(element, expectedValue, inputType) {
    await delay(50); // Brief wait for value to settle

    switch (inputType) {
      case OriginFillFieldTypes.CHECKBOX: {
        const expected = expectedValue === true || expectedValue === 'true' || expectedValue === 'yes' || expectedValue === 'Yes';
        if (element.getAttribute('role') === 'checkbox') {
          return (element.getAttribute('aria-checked') === 'true') === expected;
        }
        return element.checked === expected;
      }

      case OriginFillFieldTypes.RADIO: {
        // Check if any radio in the group is now selected
        if (element.getAttribute('role') === 'radio') {
          return element.getAttribute('aria-checked') === 'true';
        }
        return element.checked === true;
      }

      case OriginFillFieldTypes.SELECT: {
        const selectedText = element.options?.[element.selectedIndex]?.textContent?.trim() || '';
        const selectedValue = element.value || '';
        const expected = String(expectedValue).toLowerCase();
        return selectedText.toLowerCase().includes(expected) ||
               selectedValue.toLowerCase().includes(expected) ||
               expected.includes(selectedText.toLowerCase());
      }

      case OriginFillFieldTypes.FILE: {
        return element.files && element.files.length > 0;
      }

      case OriginFillFieldTypes.RICHTEXT: {
        return element.textContent.trim().length > 0;
      }

      case OriginFillFieldTypes.COMBOBOX:
      case 'WORKDAY_SINGLE_SELECT':
      case 'WORKDAY_MULTI_SELECT':
      case 'WORKDAY_REPEATING_SECTION': {
        // Complex interactions verify internally during the fill process
        return true;
      }

      default: {
        // Text-based inputs
        const current = element.value || '';
        const expected = String(expectedValue);
        // Exact match or reasonable substring (controlled inputs may transform)
        return current === expected || current.length > 0;
      }
    }
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

  // ─── Resume Upload ─────────────────────────────────────────────

  /**
   * Handle resume upload within the fill flow.
   * Retrieves resume from IndexedDB and uploads to the file input.
   *
   * @param {Object} field - Field descriptor with element
   * @param {Object} profile - Active profile
   * @returns {Promise<{ success: boolean, note: string, fileName: string }>}
   */
  async function handleResumeUpload(field, profile) {
    try {
      // Find the file input element
      let fileInput = field.element;
      if (fileInput.tagName !== 'INPUT' || fileInput.type !== 'file') {
        // Try to find a file input within or near the element
        fileInput = field.element.querySelector('input[type="file"]')
          || field.element.closest('[data-automation-id]')?.querySelector('input[type="file"]');
      }

      if (!fileInput || fileInput.type !== 'file') {
        return { success: false, note: 'No file input found', fileName: '' };
      }

      // Retrieve resumes from IndexedDB
      if (typeof OriginFillStore === 'undefined' || !OriginFillStore.getResumes) {
        return { success: false, note: 'Resume storage not available', fileName: '' };
      }

      const resumes = await OriginFillStore.getResumes(profile.id);

      if (!resumes || resumes.length === 0) {
        return {
          success: false,
          note: 'No resume uploaded — please upload manually',
          fileName: ''
        };
      }

      // Use the first resume (future: allow user to select via settings)
      const resume = resumes[0];

      // Perform the upload
      const result = await uploadResume(fileInput, resume);

      return {
        success: result.success,
        note: result.note,
        fileName: resume.fileName || resume.label || ''
      };

    } catch (err) {
      OriginFillLogger.error('Resume upload failed:', err);
      return { success: false, note: err.message, fileName: '' };
    }
  }

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

      // Wait for upload processing
      await delay(500);

      // Verify the file was assigned
      if (fileInput.files && fileInput.files.length > 0) {
        OriginFillLogger.success(`Resume uploaded: ${resumeData.fileName}`);
        return { success: true, note: '' };
      }

      return { success: false, note: 'File not attached after upload attempt' };

    } catch (err) {
      OriginFillLogger.error('Resume upload failed:', err);
      return { success: false, note: err.message };
    }
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

    const totalAttempted = results.length; // all processed fields in the report
    const successRate = (successCount + failedCount) > 0
      ? Math.round((successCount / (successCount + failedCount)) * 100)
      : 0;

    return {
      success: failedCount === 0 && successCount > 0,
      portalType,
      portalName: OriginFillDetector.getPortalDisplayName(portalType),
      url: window.location.href,
      timestamp: new Date().toISOString(),
      elapsed: Math.round(elapsed),
      elapsedFormatted: formatDuration(elapsed),
      detectedFields: results.length, // total fields discovered
      attemptedFields: successCount + attentionCount + failedCount,
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
   * @param {string} portalType - Detected portal type to select adapter
   * @returns {Promise<Object>} Detailed restore report
   */
  async function restoreFromSnapshot(snapshot, portalType) {
    if (!snapshot || Object.keys(snapshot).length === 0) {
      return { success: false, restored: 0, failed: 0, skipped: 0, total: 0, results: [] };
    }

    const adapter = (portalType === OriginFillPortals.WORKDAY && typeof OriginFillWorkday !== 'undefined')
      ? OriginFillWorkday
      : OriginFillGeneric;

    const fields = Object.entries(snapshot);
    const total = fields.length;
    let restored = 0;
    let failed = 0;
    const results = [];

    OriginFillLogger.info(`Starting restore of ${total} fields using ${portalType} adapter`);

    for (let i = 0; i < total; i++) {
      const [key, fieldData] = fields[i];
      let success = false;
      let note = '';
      const label = fieldData.label || key;
      let fieldStatus = OriginFillStatus.FAILED;

      // Report progress
      sendMessage(OriginFillMessages.FILL_PROGRESS, {
        phase: 'restore',
        current: i + 1,
        total: total,
        fieldName: label,
        section: 'recovery'
      });

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
          
          const result = await adapter.fillField(
            element, fieldData.value, inputType
          );

          if (result.success) {
            const verified = await verifyFieldValue(element, fieldData.value, inputType);
            if (verified) {
              success = true;
              fieldStatus = OriginFillStatus.SUCCESS;
            } else {
              note = 'Verification failed after fill';
            }
          } else {
            note = result.note || 'Fill failed';
          }
        } else {
          note = 'Field not found or not visible';
        }
      } catch (err) {
        note = err.message;
        OriginFillLogger.debug(`Restore failed for ${key}:`, err.message);
      }

      if (success) restored++;
      else failed++;

      results.push({
        field: label,
        fieldType: fieldData.type,
        status: fieldStatus,
        value: maskSensitiveValue(fieldData.value, fieldData.type),
        note: note
      });

      await delay(50); // Small delay between restores
    }

    OriginFillLogger.info(`Snapshot restored: ${restored} success, ${failed} failed`);
    return {
      success: restored > 0,
      partial: failed > 0,
      restored,
      failed,
      skipped: 0,
      total,
      results
    };
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
    formatDuration,
    verifyFieldValue
  });
})();
