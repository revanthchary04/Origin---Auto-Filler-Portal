/**
 * OriginFill — Workday-Specific Field Mapper & Filler
 * Maps Workday's data-automation-id attributes to profile fields.
 * Handles Workday's custom UI components (dropdowns, comboboxes, shadow DOM).
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

const OriginFillWorkday = (() => {
  'use strict';

  // ─── Workday Field Map ─────────────────────────────────────────
  // Maps data-automation-id values → profile data paths

  const FIELD_MAP = Object.freeze({
    // ─── Personal Information ──────────
    'legalNameSection_firstName':     'personal.firstName',
    'legalNameSection_lastName':      'personal.lastName',
    'legalNameSection_middleName':    'personal.middleName',
    'legalNameSection_prefix':        'personal.prefix',
    'email':                          'personal.email',
    'emailAddress':                   'personal.email',
    'phone-number':                   'personal.phone',
    'phoneNumber':                    'personal.phone',
    'phone-device-type':              null, // Skip — not in profile
    'phone-extension':                null,
    'addressSection_addressLine1':    'personal.address',
    'addressSection_addressLine2':    null,
    'addressSection_city':            'personal.city',
    'addressSection_countryRegion':   'personal.state',
    'addressSection_postalCode':      'personal.zipCode',
    'addressSection_country':         'personal.country',

    // ─── Source / How Did You Hear ──────
    'source':                         null, // Manual selection
    'sourcePrompt':                   null,

    // ─── Education ─────────────────────
    'educationSection_school':        'education[0].institution',
    'educationSection_degree':        'education[0].degree',
    'educationSection_fieldOfStudy':  'education[0].fieldOfStudy',
    'educationSection_gpa':           'education[0].gpa',
    'educationSection_startDate':     'education[0].startYear',
    'educationSection_endDate':       'education[0].endYear',
    'educationSection_startYear':     'education[0].startYear',
    'educationSection_endYear':       'education[0].endYear',

    // ─── Work Experience ───────────────
    'workExperienceSection_company':       'workExperience[0].company',
    'workExperienceSection_jobTitle':      'workExperience[0].jobTitle',
    'workExperienceSection_title':         'workExperience[0].jobTitle',
    'workExperienceSection_startDate':     'workExperience[0].startDate',
    'workExperienceSection_endDate':       'workExperience[0].endDate',
    'workExperienceSection_location':      'workExperience[0].location',
    'workExperienceSection_description':   'workExperience[0].bullets',
    'workExperienceSection_currentlyWork': 'workExperience[0].isCurrent',

    // ─── Skills ────────────────────────
    'skillsSection_skill':            'skills',

    // ─── Resume / CV ───────────────────
    'resumeSection_resume':           'resume',
    'file-upload-input-ref':          'resume',

    // ─── LinkedIn ──────────────────────
    'linkedInProfile':                'personal.linkedIn',
    'linkedIn':                       'personal.linkedIn',
    'website':                        'personal.portfolio',

    // ─── Voluntary Self-Identification (skip — sensitive) ─────
    'veteranStatus':                  null,
    'disabilityStatus':               null,
    'ethnicityDropdown':              null,
    'genderDropdown':                 null,
    'raceDropdown':                   null
  });

  // ─── Workday-Specific Element Finders ──────────────────────────

  /**
   * Find all fillable elements on the current Workday page.
   * Uses data-automation-id as primary selector.
   *
   * @param {number} [arrayIndex=0] - Index for repeating sections (education, work exp)
   * @returns {Array<{ element: HTMLElement, automationId: string, profilePath: string, inputType: string }>}
   */
  function getFields(arrayIndex = 0) {
    const results = [];
    const processed = new Set();

    // 1. Find elements with data-automation-id
    const automationElements = document.querySelectorAll('[data-automation-id]');

    automationElements.forEach(container => {
      const automationId = container.getAttribute('data-automation-id');
      if (!automationId || processed.has(automationId)) return;

      // Get profile path from field map
      let profilePath = FIELD_MAP[automationId];
      if (profilePath === null) return; // Explicitly skipped
      if (profilePath === undefined) return; // Not mapped

      // Replace array index
      profilePath = profilePath.replace(/\[0\]/g, `[${arrayIndex}]`);

      // Find the actual input within this container
      const input = findInputInContainer(container);
      if (!input) return;

      processed.add(automationId);

      results.push({
        element: input,
        automationId,
        profilePath,
        inputType: OriginFillFieldMapper.getInputType(input)
      });
    });

    // 2. Pierce shadow roots (Workday uses shadow DOM in some components)
    const shadowHosts = findShadowHosts();
    shadowHosts.forEach(host => {
      const shadowRoot = host.shadowRoot;
      if (!shadowRoot) return;

      const inputs = shadowRoot.querySelectorAll('input, select, textarea');
      inputs.forEach(input => {
        const automationId = input.getAttribute('data-automation-id')
          || host.getAttribute('data-automation-id');

        if (!automationId || processed.has(automationId)) return;

        let profilePath = FIELD_MAP[automationId];
        if (!profilePath) return;

        profilePath = profilePath.replace(/\[0\]/g, `[${arrayIndex}]`);
        processed.add(automationId);

        results.push({
          element: input,
          automationId,
          profilePath,
          inputType: OriginFillFieldMapper.getInputType(input)
        });
      });
    });

    OriginFillLogger.info(`Workday: Found ${results.length} mapped fields`);
    return results;
  }

  /**
   * Find the actual input element within a Workday container.
   * Workday wraps inputs in nested divs.
   *
   * @param {HTMLElement} container
   * @returns {HTMLElement|null}
   */
  function findInputInContainer(container) {
    // Direct match — container IS the input
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(container.tagName)) {
      return container;
    }

    // Look for input descendants
    const input = container.querySelector('input:not([type="hidden"]), select, textarea');
    if (input) return input;

    // Contenteditable div
    const editable = container.querySelector('[contenteditable="true"]');
    if (editable) return editable;

    // Workday custom dropdown (role="combobox")
    const combobox = container.querySelector('[role="combobox"]');
    if (combobox) return combobox;

    // Workday custom listbox
    const listbox = container.querySelector('[role="listbox"]');
    if (listbox) return listbox;

    // The container itself might be a combobox
    if (container.getAttribute('role') === 'combobox') return container;

    return null;
  }

  /**
   * Find all shadow DOM hosts on the page.
   * @returns {HTMLElement[]}
   */
  function findShadowHosts() {
    const hosts = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT,
      null,
      false
    );

    let node;
    while ((node = walker.nextNode())) {
      if (node.shadowRoot) {
        hosts.push(node);
      }
    }

    return hosts;
  }

  // ─── Workday-Specific Fill Logic ───────────────────────────────

  /**
   * Fill a Workday field with value.
   * Handles Workday's React-based inputs and custom components.
   *
   * @param {HTMLElement} element
   * @param {any} value
   * @param {string} inputType
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function fillField(element, value, inputType) {
    if (value === undefined || value === null || value === '') {
      return { success: false, note: 'Empty value' };
    }

    try {
      switch (inputType) {
        case OriginFillFieldTypes.TEXT:
        case OriginFillFieldTypes.EMAIL:
        case OriginFillFieldTypes.PHONE:
        case OriginFillFieldTypes.URL:
        case OriginFillFieldTypes.NUMBER:
          return await fillTextInput(element, String(value));

        case OriginFillFieldTypes.SELECT:
          return await fillSelect(element, String(value));

        case OriginFillFieldTypes.COMBOBOX:
          return await fillCombobox(element, String(value));

        case OriginFillFieldTypes.TEXTAREA:
          return await fillTextarea(element, value);

        case OriginFillFieldTypes.RICHTEXT:
          return await fillRichText(element, value);

        case OriginFillFieldTypes.CHECKBOX:
          return await fillCheckbox(element, value);

        case OriginFillFieldTypes.RADIO:
          return await fillRadio(element, String(value));

        case OriginFillFieldTypes.DATE:
          return await fillDate(element, String(value));

        case OriginFillFieldTypes.FILE:
          return { success: false, note: 'File upload handled separately' };

        default:
          return await fillTextInput(element, String(value));
      }
    } catch (err) {
      OriginFillLogger.error(`Fill error for ${inputType}:`, err);
      return { success: false, note: err.message };
    }
  }

  /**
   * Fill a text input using React-compatible value setting.
   * Uses the property descriptor hack to trigger React state updates.
   *
   * @param {HTMLElement} input
   * @param {string} value
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function fillTextInput(input, value) {
    // Focus the element
    input.focus();
    await delay(50);

    // Clear existing value
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;

    const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, 'value'
    )?.set;

    const setter = input.tagName === 'TEXTAREA' ? nativeTextareaValueSetter : nativeInputValueSetter;

    if (setter) {
      setter.call(input, value);
    } else {
      input.value = value;
    }

    // Dispatch events in correct order for React
    input.dispatchEvent(new Event('focus', { bubbles: true }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));

    // Also dispatch React-specific events
    const reactEvent = new Event('input', { bubbles: true });
    Object.defineProperty(reactEvent, 'target', { writable: false, value: input });
    input.dispatchEvent(reactEvent);

    return { success: true, note: '' };
  }

  /**
   * Fill a native <select> dropdown using fuzzy matching.
   *
   * @param {HTMLSelectElement} select
   * @param {string} value
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function fillSelect(select, value) {
    const result = OriginFillFuzzyMatch.matchSelectOptions(value, select);

    if (result.matched) {
      select.selectedIndex = result.option.index;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      select.dispatchEvent(new Event('input', { bubbles: true }));

      const note = result.strategy !== 'exact'
        ? `Matched via ${result.strategy}: "${result.option.text}"`
        : '';

      return {
        success: true,
        note
      };
    }

    return {
      success: false,
      note: `No match found for "${value}" in ${select.options.length} options`
    };
  }

  /**
   * Fill a Workday combobox (custom dropdown component).
   * Workday comboboxes require clicking, typing, and selecting from a dropdown list.
   *
   * @param {HTMLElement} combobox
   * @param {string} value
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function fillCombobox(combobox, value) {
    // Step 1: Click to open the dropdown
    combobox.click();
    await delay(200);

    // Step 2: Find the text input within the combobox
    const input = combobox.querySelector('input') || combobox;

    // Step 3: Type the value to filter options
    if (input.tagName === 'INPUT') {
      await fillTextInput(input, value);
      await delay(300); // Wait for dropdown options to filter
    }

    // Step 4: Look for matching options in the dropdown list
    const listbox = document.querySelector('[role="listbox"]')
      || document.querySelector('[data-automation-id="selectDropdown"]')
      || document.querySelector('.css-pqf0yl'); // Workday dropdown class

    if (listbox) {
      const options = listbox.querySelectorAll('[role="option"], li');
      const optionTexts = Array.from(options).map((opt, i) => ({
        text: opt.textContent.trim(),
        index: i,
        element: opt
      }));

      const match = OriginFillFuzzyMatch.bestMatch(value, optionTexts);

      if (match.matched) {
        // Click the matched option
        const optionEl = optionTexts[match.option.index].element;
        optionEl.click();
        await delay(100);

        return {
          success: true,
          note: match.strategy !== 'exact'
            ? `Matched via ${match.strategy}: "${match.option.text}"`
            : ''
        };
      }
    }

    // Step 5: Close the dropdown if no match
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    document.body.click(); // Close any open dropdowns

    return {
      success: false,
      note: `Combobox: no match for "${value}"`
    };
  }

  /**
   * Fill a textarea element.
   * Handles bullet points by joining with newlines.
   *
   * @param {HTMLElement} textarea
   * @param {any} value - String or array of strings (bullet points)
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function fillTextarea(textarea, value) {
    const text = Array.isArray(value)
      ? value.filter(v => v).join('\n• ')
      : String(value);

    const formatted = Array.isArray(value) && value.length > 0
      ? '• ' + text
      : text;

    return fillTextInput(textarea, formatted);
  }

  /**
   * Fill a contenteditable rich text field.
   *
   * @param {HTMLElement} element
   * @param {any} value
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function fillRichText(element, value) {
    const text = Array.isArray(value)
      ? value.filter(v => v).map(v => `<li>${v}</li>`).join('')
      : String(value);

    const html = Array.isArray(value)
      ? `<ul>${text}</ul>`
      : `<p>${text}</p>`;

    element.focus();
    element.innerHTML = html;

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));

    return { success: true, note: 'Rich text' };
  }

  /**
   * Fill a checkbox.
   * @param {HTMLElement} checkbox
   * @param {boolean} value
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function fillCheckbox(checkbox, value) {
    const shouldBeChecked = value === true || value === 'true' || value === 'yes';
    if (checkbox.checked !== shouldBeChecked) {
      checkbox.click();
      await delay(50);
    }
    return { success: true, note: '' };
  }

  /**
   * Fill a radio button by matching label text.
   * @param {HTMLElement} radio
   * @param {string} value
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function fillRadio(radio, value) {
    // Find all radios in same group
    const name = radio.name;
    if (!name) return { success: false, note: 'Radio without name attribute' };

    const radios = document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`);

    for (const r of radios) {
      const label = OriginFillDetector.getInputLabel(r);
      if (label.toLowerCase().includes(value.toLowerCase())) {
        r.click();
        r.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, note: '' };
      }
    }

    return { success: false, note: `No radio option matches "${value}"` };
  }

  /**
   * Fill a date field. Detects format and adapts.
   * @param {HTMLElement} input
   * @param {string} value - Date in YYYY-MM-DD or similar format
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function fillDate(input, value) {
    // Detect expected format from placeholder or existing value
    const placeholder = (input.placeholder || '').toUpperCase();
    let formatted = value;

    if (placeholder.includes('MM/DD/YYYY') || placeholder.includes('MM-DD-YYYY')) {
      // Convert YYYY-MM-DD to MM/DD/YYYY
      const parts = value.split(/[-/]/);
      if (parts.length === 3 && parts[0].length === 4) {
        formatted = `${parts[1]}/${parts[2]}/${parts[0]}`;
      }
    } else if (placeholder.includes('DD/MM/YYYY')) {
      const parts = value.split(/[-/]/);
      if (parts.length === 3 && parts[0].length === 4) {
        formatted = `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
    }

    // For type="date" inputs, always use YYYY-MM-DD
    if (input.type === 'date') {
      const parts = value.split(/[-/]/);
      if (parts.length === 3) {
        if (parts[0].length === 4) {
          formatted = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
        } else if (parts[2].length === 4) {
          formatted = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
        }
      }
    }

    return fillTextInput(input, formatted);
  }

  /**
   * Simple delay helper.
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ─── Public API ─────────────────────────────────────────────────
  return Object.freeze({
    FIELD_MAP,
    getFields,
    fillField,
    findInputInContainer,
    findShadowHosts,

    // Individual fill methods (for direct use/testing)
    fillTextInput,
    fillSelect,
    fillCombobox,
    fillTextarea,
    fillRichText,
    fillCheckbox,
    fillRadio,
    fillDate
  });
})();
