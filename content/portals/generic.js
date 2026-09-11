/**
 * OriginFill — Generic Portal Field Mapper & Filler
 * Fallback for unknown job portals. Uses intelligent field detection
 * from labels, placeholders, names, and IDs.
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

const OriginFillGeneric = (() => {
  'use strict';

  // ─── Generic Field Discovery ───────────────────────────────────

  /**
   * Find all fillable fields on an unknown portal.
   * Uses the FieldMapper's detection rules against DOM elements.
   *
   * @param {number} [eduIndex=0] - Education array index
   * @param {number} [workIndex=0] - Work experience array index
   * @returns {Array<{ element: HTMLElement, fieldType: string, profilePath: string, inputType: string, confidence: string, label: string }>}
   */
  function getFields(eduIndex = 0, workIndex = 0) {
    const results = [];
    const processed = new WeakSet();

    // Query all potentially fillable elements
    const elements = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]):not([type="search"]), ' +
      'select, ' +
      'textarea, ' +
      '[contenteditable="true"]'
    );

    elements.forEach(element => {
      if (processed.has(element)) return;
      if (element.disabled || element.readOnly) return;
      if (!OriginFillDetector.isVisible(element)) return;

      processed.add(element);

      const detection = OriginFillFieldMapper.detectFieldType(element);

      if (detection.fieldType && detection.profilePath) {
        // Resolve array indices
        let profilePath = detection.profilePath;
        profilePath = profilePath.replace(/education\[0\]/g, `education[${eduIndex}]`);
        profilePath = profilePath.replace(/workExperience\[0\]/g, `workExperience[${workIndex}]`);

        results.push({
          element,
          fieldType: detection.fieldType,
          profilePath,
          inputType: detection.inputType,
          confidence: detection.confidence,
          label: OriginFillDetector.getInputLabel(element)
        });
      }
    });

    OriginFillLogger.info(`Generic: Found ${results.length} fillable fields`);
    return results;
  }

  // ─── Generic Fill Logic ────────────────────────────────────────

  /**
   * Fill a generic form field with value.
   * Re-uses Workday's fill methods since they handle React/Vue inputs well.
   *
   * @param {HTMLElement} element
   * @param {any} value
   * @param {string} inputType
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function fillField(element, value, inputType) {
    // Delegate to Workday's fill methods — they're universal
    return OriginFillWorkday.fillField(element, value, inputType);
  }

  /**
   * Try to fill a field that we couldn't match by type.
   * Uses the label text to make a best-effort guess.
   *
   * @param {HTMLElement} element
   * @param {Object} profile - Full profile
   * @returns {Promise<{ success: boolean, fieldType: string, note: string }>}
   */
  async function fillUnknownField(element, profile) {
    const label = OriginFillDetector.getInputLabel(element).toLowerCase();
    if (!label) return { success: false, fieldType: 'unknown', note: 'No label found' };

    // Try common patterns
    const patterns = [
      { test: /first\s*name/i,           path: 'personal.firstName' },
      { test: /last\s*name/i,            path: 'personal.lastName' },
      { test: /full\s*name|^name$/i,     path: 'personal.fullName' },
      { test: /e-?mail/i,                path: 'personal.email' },
      { test: /phone|mobile|cell/i,      path: 'personal.phone' },
      { test: /address|street/i,         path: 'personal.address' },
      { test: /city|town/i,              path: 'personal.city' },
      { test: /state|province/i,         path: 'personal.state' },
      { test: /country/i,                path: 'personal.country' },
      { test: /zip|postal/i,             path: 'personal.zipCode' },
      { test: /linkedin/i,              path: 'personal.linkedIn' },
      { test: /github/i,                path: 'personal.github' },
      { test: /portfolio|website/i,      path: 'personal.portfolio' }
    ];

    for (const { test, path } of patterns) {
      if (test.test(label)) {
        const value = OriginFillFieldMapper.resolveProfilePath(profile, path);
        if (value) {
          const inputType = OriginFillFieldMapper.getInputType(element);
          const result = await fillField(element, value, inputType);
          return { ...result, fieldType: path.split('.').pop() };
        }
      }
    }

    return { success: false, fieldType: 'unknown', note: `Unrecognized field: "${label}"` };
  }

  // ─── Form Structure Analysis ───────────────────────────────────

  /**
   * Analyze the form structure of a generic portal.
   * Identifies sections (personal, education, work) by grouping fields.
   *
   * @returns {{ sections: Array<{ name: string, fields: HTMLElement[] }>, totalFields: number }}
   */
  function analyzeFormStructure() {
    const forms = document.querySelectorAll('form');
    const sections = [];
    let totalFields = 0;

    forms.forEach(form => {
      // Look for fieldsets or section dividers
      const fieldsets = form.querySelectorAll('fieldset, [role="group"], .form-section, .form-group');

      if (fieldsets.length > 0) {
        fieldsets.forEach(fieldset => {
          const legend = fieldset.querySelector('legend, h2, h3, h4, .section-title');
          const name = legend ? legend.textContent.trim() : 'Form Section';
          const fields = fieldset.querySelectorAll('input, select, textarea');
          totalFields += fields.length;

          sections.push({
            name,
            fields: Array.from(fields)
          });
        });
      } else {
        // No fieldsets — treat entire form as one section
        const fields = form.querySelectorAll(
          'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), select, textarea'
        );
        totalFields += fields.length;

        sections.push({
          name: 'Application Form',
          fields: Array.from(fields)
        });
      }
    });

    return { sections, totalFields };
  }

  /**
   * Detect repeating field groups (multiple education entries, multiple work entries).
   * Looks for repeated patterns of field names/labels.
   *
   * @returns {{ educationCount: number, workCount: number }}
   */
  function detectRepeatingSections() {
    let educationCount = 0;
    let workCount = 0;

    // Look for numbered or indexed section containers
    const containers = document.querySelectorAll(
      '[class*="education"], [class*="school"], [id*="education"], [id*="school"]'
    );
    educationCount = Math.max(educationCount, containers.length);

    const workContainers = document.querySelectorAll(
      '[class*="experience"], [class*="employment"], [id*="experience"], [id*="employment"]'
    );
    workCount = Math.max(workCount, workContainers.length);

    // Fallback: count by repeated labels
    const labels = Array.from(document.querySelectorAll('label'));
    const companyLabels = labels.filter(l =>
      l.textContent.toLowerCase().includes('company') ||
      l.textContent.toLowerCase().includes('employer')
    );
    const schoolLabels = labels.filter(l =>
      l.textContent.toLowerCase().includes('school') ||
      l.textContent.toLowerCase().includes('university') ||
      l.textContent.toLowerCase().includes('institution')
    );

    educationCount = Math.max(educationCount, schoolLabels.length) || 1;
    workCount = Math.max(workCount, companyLabels.length) || 1;

    return { educationCount, workCount };
  }

  // ─── Public API ─────────────────────────────────────────────────
  return Object.freeze({
    getFields,
    fillField,
    fillUnknownField,
    analyzeFormStructure,
    detectRepeatingSections
  });
})();
