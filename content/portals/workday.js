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
    'formField-schoolName':           'education[0].institution',
    'educationSection_degree':        'education[0].degree',
    'formField-degree':               'education[0].degree',
    'educationSection_fieldOfStudy':  'education[0].fieldOfStudy',
    'formField-fieldOfStudy':         'education[0].fieldOfStudy',
    'educationSection_gpa':           'education[0].gpa',
    'formField-gpa':                  'education[0].gpa',
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
    'formField-skills':               'skills',

    // ─── Resume / CV ───────────────────
    'resumeSection_resume':           'resume',
    'file-upload-input-ref':          'resume',

    // ─── LinkedIn ──────────────────────
    'linkedInProfile':                'personal.linkedIn',
    'linkedIn':                       'personal.linkedIn',
    'website':                        'websites',

    // ─── Voluntary Self-Identification (skip — sensitive) ─────
    'veteranStatus':                  null,
    'disabilityStatus':               null,
    'ethnicityDropdown':              null,
    'genderDropdown':                 null,
    'raceDropdown':                   null
  });

  // ─── DOM Wait Helpers ──────────────────────────────────────────

  /**
   * Wait for an element matching a selector to appear in a container.
   * Uses MutationObserver for efficient waiting.
   *
   * @param {string} selector - CSS selector to match
   * @param {HTMLElement} [container=document.body] - Container to observe
   * @param {number} [timeout=3000] - Max wait time in ms
   * @returns {Promise<HTMLElement>}
   */
  function waitForElement(selector, container = document.body, timeout = 3000) {
    return new Promise((resolve, reject) => {
      const existing = container.querySelector(selector);
      if (existing) { resolve(existing); return; }

      const observer = new MutationObserver(() => {
        const el = container.querySelector(selector);
        if (el) {
          observer.disconnect();
          resolve(el);
        }
      });
      observer.observe(container, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`waitForElement timeout: ${selector}`));
      }, timeout);
    });
  }

  /**
   * Wait for dropdown options to appear after typing in a combobox.
   * Looks for [role="option"] elements inside a [role="listbox"].
   *
   * @param {number} [timeout=3000] - Max wait time in ms
   * @returns {Promise<HTMLElement>} The listbox element containing options
   */
  function waitForOptions(timeout = 3000) {
    return new Promise((resolve, reject) => {
      // Check if options already visible
      const existing = document.querySelector('[role="listbox"]')
        || document.querySelector('[data-automation-id="selectDropdown"]');
      if (existing && existing.querySelectorAll('[role="option"], li').length > 0) {
        resolve(existing);
        return;
      }

      const observer = new MutationObserver(() => {
        const listbox = document.querySelector('[role="listbox"]')
          || document.querySelector('[data-automation-id="selectDropdown"]');
        if (listbox && listbox.querySelectorAll('[role="option"], li').length > 0) {
          observer.disconnect();
          resolve(listbox);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        // Still try to return what we have
        const listbox = document.querySelector('[role="listbox"]')
          || document.querySelector('[data-automation-id="selectDropdown"]');
        if (listbox) {
          resolve(listbox);
        } else {
          reject(new Error('waitForOptions timeout: no listbox appeared'));
        }
      }, timeout);
    });
  }

  /**
   * Wait for a field's value to match expected, with polling.
   * @param {HTMLElement} element
   * @param {string} expected
   * @param {number} [timeout=1000]
   * @returns {Promise<boolean>}
   */
  function waitForValue(element, expected, timeout = 1000) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      function check() {
        const current = element.value || element.textContent || '';
        if (current === expected) { resolve(true); return; }
        if (Date.now() - startTime > timeout) { resolve(false); return; }
        requestAnimationFrame(check);
      }
      check();
    });
  }

  // ─── Workday-Specific Element Finders ──────────────────────────

  /**
   * Find all fillable elements on the current Workday page.
   * Uses a multi-layered pipeline:
   * 1. Collect all data-automation-id containers and resolve exact input
   * 2. Deduplicate by exact HTMLElement
   * 3. Fallback to OriginFillFieldMapper semantic detection for remaining inputs
   *
   * @returns {Array<{ element: HTMLElement, automationId: string, profilePath: string, inputType: string, label: string, confidence: string, source: string }>}
   */
  function getFields() {
    const results = [];
    const processedElements = new Set();
    const mappedAutomationIds = new Set();

    // Evaluate repeating section containers once
    const eduContainers = detectRepeatingSectionContainers('educationSection');
    const workContainers = detectRepeatingSectionContainers('workExperienceSection');
    const websiteContainers = detectRepeatingSectionContainers('websiteSection');

    // ─── Layer 1: Top-Down Exact Mapping ───
    const containers = document.querySelectorAll('[data-automation-id]');
    
    containers.forEach(container => {
      const automationId = container.getAttribute('data-automation-id');
      let exactMappedPath = undefined;
      
      // Handle repeating sections
      if (automationId.startsWith('educationSection_') || automationId.startsWith('workExperienceSection_') || automationId === 'website') {
        const sectionContainers = automationId.startsWith('educationSection_') ? eduContainers 
                                : automationId.startsWith('workExperienceSection_') ? workContainers
                                : websiteContainers;
                                
        let index = 0;
        for (let i = 0; i < sectionContainers.length; i++) {
          if (sectionContainers[i] === container || sectionContainers[i].contains(container)) {
            index = i;
            break;
          }
        }
        
        const baseMapping = FIELD_MAP[automationId];
        if (baseMapping !== undefined && baseMapping !== null) {
          exactMappedPath = baseMapping.replace(/\[0\]/g, `[${index}]`);
        } else if (baseMapping === null) {
          exactMappedPath = null;
        }
      } else {
        exactMappedPath = FIELD_MAP[automationId];
      }
      
      if (exactMappedPath !== undefined && exactMappedPath !== null) {
        // We have a mapping. Resolve the exact input inside this container.
        const input = resolveWorkdayInput(container, automationId);
        
        if (input && OriginFillDetector.isVisible(input) && !input.disabled && !input.readOnly) {
          if (processedElements.has(input)) {
             OriginFillLogger.warn(`[OriginFill][Workday][Warning] Multiple automation IDs resolved to the same DOM element. ID: ${automationId}`);
          } else {
             processedElements.add(input);
             mappedAutomationIds.add(automationId);
             
             const inputType = determineWorkdayControlType(input, automationId);
             const label = OriginFillDetector.getInputLabel(input) || automationId;
             
             // Diagnostic logging
             OriginFillLogger.debug(`[OriginFill][Workday][Field]
automationId: ${automationId}
label: ${label}
profilePath: ${exactMappedPath}
tag: ${input.tagName}
type: ${input.type || 'N/A'}
id: ${input.id || 'N/A'}
name: ${input.name || 'N/A'}`);

             results.push({
                element: input,
                automationId,
                profilePath: exactMappedPath,
                inputType,
                label,
                fieldType: exactMappedPath.split('.').pop().split('[')[0],
                confidence: 'high',
                source: 'workday-exact'
             });
          }
        }
      }
    });

    // ─── Layer 2: Generic Fallback ───
    const allInputs = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), ' +
      'select, ' +
      'textarea, ' +
      '[contenteditable="true"], ' +
      '[role="combobox"], ' +
      '[role="listbox"], ' +
      '[role="checkbox"], ' +
      '[role="radio"]'
    );
    
    const candidateInputs = [];
    allInputs.forEach(el => {
      if (!processedElements.has(el) && OriginFillDetector.isVisible(el) && !el.disabled && !el.readOnly) {
        candidateInputs.push(el);
      }
    });

    // Add shadow DOM inputs
    const shadowHosts = findShadowHosts();
    shadowHosts.forEach(host => {
      const shadowRoot = host.shadowRoot;
      if (!shadowRoot) return;
      const shadowInputs = shadowRoot.querySelectorAll('input:not([type="hidden"]), select, textarea');
      shadowInputs.forEach(el => {
        if (!processedElements.has(el) && OriginFillDetector.isVisible(el) && !el.disabled && !el.readOnly) {
          candidateInputs.push(el);
        }
      });
    });

    candidateInputs.forEach(input => {
      if (processedElements.has(input)) return;
      
      const genericDetection = OriginFillFieldMapper.detectFieldType(input);
      if (genericDetection && genericDetection.fieldType && genericDetection.profilePath) {
        if (genericDetection.confidence === 'high' || genericDetection.confidence === 'medium') {
          processedElements.add(input);
          
          let aid = input.getAttribute('data-automation-id') || '';
          
          results.push({
            element: input,
            automationId: aid,
            profilePath: genericDetection.profilePath,
            inputType: determineWorkdayControlType(input, aid) || genericDetection.inputType,
            label: OriginFillDetector.getInputLabel(input) || aid,
            fieldType: genericDetection.fieldType,
            confidence: genericDetection.confidence,
            source: 'generic-fallback'
          });
        }
      }
    });

    OriginFillLogger.info(`Workday: Found ${results.length} fields (${results.filter(f => f.source === 'workday-exact').length} exact, ${results.filter(f => f.source === 'generic-fallback').length} fallback)`);
    return results;
  }

  function detectRepeatingSectionContainers(sectionPrefix) {
    let sectionContainer;
    
    // For websites, Workday often just lists them next to each other
    if (sectionPrefix === 'websiteSection') {
      const websites = document.querySelectorAll('[data-automation-id="website"]');
      if (websites.length > 0) {
        // Return their wrappers
        return Array.from(websites).map(w => w.closest('[data-automation-id]') || w.parentElement);
      }
      return [];
    }

    // Strategy 1: Look for containers with data-automation-id matching the section
    sectionContainer = document.querySelector(`[data-automation-id="${sectionPrefix}"]`);
    if (!sectionContainer) return [];

    // Strategy 2: Look for repeated field groups within the section
    const firstFieldId = sectionPrefix === 'educationSection'
      ? 'educationSection_school'
      : 'workExperienceSection_company';

    const primaryFields = sectionContainer.querySelectorAll(
      `[data-automation-id="${firstFieldId}"]`
    );

    if (primaryFields.length <= 1) {
      return [sectionContainer];
    }

    const containers = [];
    primaryFields.forEach(field => {
      let parent = field.parentElement;
      for (let i = 0; i < 10 && parent && parent !== sectionContainer; i++) {
        const siblingFields = parent.querySelectorAll(`[data-automation-id*="${sectionPrefix}_"]`);
        if (siblingFields.length >= 2) {
          containers.push(parent);
          break;
        }
        parent = parent.parentElement;
      }
      if (containers.length < primaryFields.length && !containers.includes(parent)) {
        containers.push(field.closest('[data-automation-id]') || field.parentElement);
      }
    });

    return containers.length > 0 ? containers : [sectionContainer];
  }

  // scanContainerFields was removed in favor of unified processing in getFields

  /**
   * Find the exact target input element within a Workday container.
   * Uses 5-priority algorithm.
   *
   * @param {HTMLElement} container
   * @param {string} automationId
   * @returns {HTMLElement|null}
   */
  function resolveWorkdayInput(container, automationId) {
    // Priority 1: Direct match — container IS the input
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(container.tagName)) {
      return container;
    }

    // Priority 2: Input with the EXACT SAME automation-id
    const sameIdInput = container.querySelector(
      `input[data-automation-id="${automationId}"]:not([type="hidden"]), select[data-automation-id="${automationId}"], textarea[data-automation-id="${automationId}"]`
    );
    if (sameIdInput) return sameIdInput;

    // Priority 3: Combobox with the matching automation context
    const combobox = container.querySelector('[role="combobox"]');
    if (combobox) return combobox;

    // Priority 4: Associated label/ARIA relationship
    const label = container.querySelector('label[for]');
    if (label) {
      const targetId = label.getAttribute('for');
      if (targetId) {
        const input = document.getElementById(targetId);
        // Only return if it's inside this container
        if (input && container.contains(input)) return input;
      }
    }

    // Priority 5: Nearest relevant input inside the wrapper
    const nearest = container.querySelector('input:not([type="hidden"]), select, textarea, [contenteditable="true"]');
    return nearest;
  }

  /**
   * Determine the specific Workday control type.
   */
  function determineWorkdayControlType(element, automationId) {
    const role = element.getAttribute('role');
    const aid = (automationId || '').toLowerCase();

    if (aid === 'website' || aid === 'portfolio') {
      return 'WORKDAY_REPEATING_SECTION';
    }

    if (aid.includes('skillssection') || aid === 'formfield-skills') {
      return 'WORKDAY_MULTI_SELECT';
    }

    // Dropdowns (Degree, State, Country)
    if (role === 'listbox' || role === 'combobox' || 
        aid.includes('country') || aid.includes('degree') || aid.includes('state') || aid.includes('source') ||
        aid.includes('language')) {
      return 'WORKDAY_SINGLE_SELECT';
    }
    
    // Autocompletes (Field of Study, School)
    if (aid.includes('fieldofstudy') || aid.includes('schoolname')) {
      return 'WORKDAY_AUTOCOMPLETE';
    }
    
    // Checkboxes
    if (role === 'checkbox' || element.type === 'checkbox') {
      return OriginFillFieldTypes.CHECKBOX;
    }
    
    // Radio
    if (role === 'radio' || element.type === 'radio') {
      return OriginFillFieldTypes.RADIO;
    }

    // Default generic detection
    return OriginFillFieldMapper.getInputType(element);
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
      if (!element) return { success: false, note: 'Element not found' };

      // Ensure visibility
      if (!OriginFillDetector.isVisible(element)) {
        // Try scrolling to element
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        await delay(300);
      }

      switch (inputType) {
        case 'WORKDAY_SINGLE_SELECT':
        case OriginFillFieldTypes.COMBOBOX:
          return await fillSingleSelect(element, value);

        case 'WORKDAY_AUTOCOMPLETE':
          return await fillWorkdayAutocomplete(element, value);

        case 'WORKDAY_MULTI_SELECT':
          return await fillWorkdaySkills(element, value);

        case 'WORKDAY_REPEATING_SECTION':
          return await fillRepeatingSection(element, value, element.closest('[data-automation-id]')?.getAttribute('data-automation-id'));

        case OriginFillFieldTypes.CHECKBOX:
          return await fillCheckbox(element, value);

        case OriginFillFieldTypes.RADIO:
          return await fillRadio(element, value);
          
        case OriginFillFieldTypes.FILE:
          return { success: true, note: 'File handling deferred to filler' };

        default:
          return await fillTextInput(element, value);
      }
    } catch (err) {
      OriginFillLogger.error('Workday fillField error:', err);
      return { success: false, note: err.message };
    }
  }

  /**
   * Fill a text input using React-compatible value setting.
   * Uses the property descriptor hack to trigger React state updates.
   * IMPORTANT: Does NOT dispatch blur — caller controls blur timing.
   *
   * @param {HTMLElement} input
   * @param {string} value
   * @param {Object} [options]
   * @param {boolean} [options.dispatchBlur=true] - Whether to dispatch blur event
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function fillTextInput(input, value, options = {}) {
    const dispatchBlur = options.dispatchBlur !== false;

    input.focus();
    input.dispatchEvent(new Event('focus', { bubbles: true }));
    await delay(50);

    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    const setter = descriptor ? descriptor.set : null;
    
    // Clear existing value safely
    if (setter) setter.call(input, '');
    else input.value = '';
    
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await delay(30);

    if (setter) {
      setter.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    // Wait for React to process the state change before blurring
    await delay(150);

    if (dispatchBlur) {
      input.dispatchEvent(new Event('blur', { bubbles: true }));
      await delay(100);
    }

    return { success: true, note: '' };
  }

  /**
   * Workday Autocomplete Handler (For Field of Study, School, etc.)
   * Natively sets text, waits for dropdown options to appear, and selects the match.
   * Commits the free text if no match is found.
   */
  async function fillWorkdayAutocomplete(element, value) {
    if (!value) return { success: false, note: 'Empty value' };

    // 1. Focus and use native setter (do not blur yet)
    await fillTextInput(element, value, { dispatchBlur: false });

    // 2. Wait for Workday suggestions to appear
    const listbox = await waitForOptions(1500).catch(() => null);

    if (listbox) {
      // 3. Look for exact or normalized match
      const options = Array.from(listbox.querySelectorAll('[role="option"], li'));
      if (options.length > 0) {
        const searchStr = String(value).toLowerCase().trim();
        let match = options.find(o => o.textContent.toLowerCase().trim() === searchStr) || 
                    options.find(o => o.textContent.toLowerCase().includes(searchStr));

        if (match) {
          match.click();
          await delay(200);
          
          // Verify
          const currentValue = element.value || element.textContent;
          if (!currentValue || currentValue.trim() === '') {
             return { success: false, note: 'Verification failed: Element is empty after option click' };
          }
          return { success: true, note: 'Selected exact/fuzzy match' };
        }
      }
    }

    // 4. No matching option appeared. Commit the free text by dispatching blur
    element.dispatchEvent(new Event('blur', { bubbles: true }));
    await delay(200);

    // Verify Workday accepted the free text
    const finalValue = element.value || element.textContent;
    if (!finalValue || finalValue.trim() === '') {
      return { success: false, note: 'Verification failed: Workday rejected the free text input' };
    }

    return { success: true, note: 'Committed as free text' };
  }

  /**
   * Workday Single Select (Dropdown) Handler.
   * Requires physical click, waiting for pop-up listbox, and clicking the option.
   */
  async function fillSingleSelect(element, value) {
    if (!value) return { success: false, note: 'Empty value' };
    
    // Step 1: Open the dropdown
    element.focus();
    element.click();
    await delay(300); // Wait for animation

    // Workday dropdowns often render at the body level
    const listbox = await waitForOptions();
    if (!listbox) {
      // Fallback: maybe it's just a text input that looks like a dropdown
      if (element.tagName === 'INPUT') {
        return await fillTextInput(element, value);
      }
      return { success: false, note: 'Dropdown options did not appear' };
    }

    // Step 2: Find best option
    const options = Array.from(listbox.querySelectorAll('[role="option"], li'));
    if (options.length === 0) {
      return { success: false, note: 'No options available' };
    }

    const searchStr = String(value).toLowerCase();
    
    let bestMatch = options.find(opt => opt.textContent.toLowerCase() === searchStr);
    
    if (!bestMatch) {
      bestMatch = options.find(opt => opt.textContent.toLowerCase().includes(searchStr) || searchStr.includes(opt.textContent.toLowerCase()));
    }

    // Step 3: Select the option
    if (bestMatch) {
      bestMatch.click();
      await delay(300);
      
      // Optionally blur if needed
      if (element.tagName === 'INPUT') {
        element.dispatchEvent(new Event('blur', { bubbles: true }));
      }

      // Verify the element's state reflects the change
      const finalState = element.value || element.textContent || element.innerText || '';
      if (finalState.toLowerCase().includes('select one') && !searchStr.includes('select one')) {
        return { success: false, note: 'Verification failed: Control still says Select One' };
      }

      return { success: true, note: 'Selected exact/fuzzy match' };
    }

    // Close the dropdown if no match
    element.dispatchEvent(new Event('blur', { bubbles: true }));
    return { success: false, note: 'Option not found' };
  }

  /**
   * Dedicated Workday Skills Handler.
   * Uses aggressive character-by-character keyboard simulation to defeat strict React debouncers.
   */
  async function fillWorkdaySkills(element, valuesArray) {
    if (!Array.isArray(valuesArray)) valuesArray = [valuesArray];
    
    // BACKWARD COMPATIBILITY & SAFE NORMALIZATION
    // If old saved profiles contain newlines or colons inside array items, normalize them here.
    const normalizedRaw = valuesArray.join(',').replace(/[\n\r]+/g, ',').replace(/:\s*/g, ',');
    const normalizedArray = normalizedRaw.split(',')
      .map(s => s.trim().replace(/\.+$/, '').trim())
      .filter(Boolean);
      
    if (normalizedArray.length === 0) return { success: false, note: 'No values to fill' };

    OriginFillLogger.info(`[OriginFill][Skills] normalized count: ${normalizedArray.length}`);
    OriginFillLogger.info(`[OriginFill][Skills] normalized skills:\n${JSON.stringify(normalizedArray, null, 2)}`);

    let successCount = 0;
    const missingSkills = [];
    
    // Nearest formField container to scope chip searches
    const container = element.closest('div[data-automation-id^="formField"]') || document.body;

    for (let idx = 0; idx < normalizedArray.length; idx++) {
      const val = normalizedArray[idx];
      OriginFillLogger.info(`[OriginFill][Skills] Processing ${idx + 1}/${normalizedArray.length}: ${val}`);

      // 1. Focus input
      element.focus();
      element.click();
      await delay(100);

      const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
      const setter = descriptor ? descriptor.set : null;
      
      // Clear first
      if (setter) setter.call(element, '');
      else element.value = '';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      await delay(100);

      // 2. Character-by-character injection
      let currentVal = '';
      for (let i = 0; i < val.length; i++) {
        const char = val[i];
        currentVal += char;
        
        // Dispatch keydown
        element.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true }));
        element.dispatchEvent(new KeyboardEvent('keypress', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true }));
        
        // Set value natively
        if (setter) setter.call(element, currentVal);
        else element.value = currentVal;
        
        // Dispatch input and change
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        
        // Dispatch keyup
        element.dispatchEvent(new KeyboardEvent('keyup', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true }));
        
        await delay(50); // Small delay between keystrokes to mimic human typing
      }
      
      await delay(800); // Wait for potential suggestions to load

      // 3. Trigger KeyboardEvents (Enter to commit)
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));

      await delay(500); // Wait for Workday to create the token chip

      // 4. Verify Chip
      let chipFound = false;
      const chips = Array.from(container.querySelectorAll('li, [role="button"], [data-automation-id*="promptOption"]'));
      if (chips.some(c => c.textContent.toLowerCase().includes(val.toLowerCase()))) {
        chipFound = true;
      }

      if (chipFound) {
        successCount++;
      } else {
        // Fallback: search globally for active dropdown and click option
        const listbox = document.querySelector('[role="listbox"], [role="menu"], [data-automation-id="selectDropdown"], [class*="popup"]');
        if (listbox) {
          const options = Array.from(listbox.querySelectorAll('[role="option"], li, button, div[data-automation-id*="option"]'));
          const searchStr = String(val).toLowerCase();
          
          let match = options.find(o => o.textContent.toLowerCase().trim() === searchStr) || 
                      options.find(o => o.textContent.toLowerCase().includes(searchStr));
                      
          if (match) {
            match.click();
            await delay(500);
            
            // Re-verify
            const fallbackChips = Array.from(container.querySelectorAll('li, [role="button"], [data-automation-id*="promptOption"]'));
            if (fallbackChips.some(c => c.textContent.toLowerCase().includes(val.toLowerCase()))) {
              chipFound = true;
              successCount++;
            }
          }
        }
      }

      if (!chipFound) {
        OriginFillLogger.debug(`[OriginFill][Workday] Skill chip not created for: ${val}`);
        missingSkills.push(val);
      }
      
      // 5. Clear input for next skill
      if (setter) setter.call(element, '');
      else element.value = '';
      element.dispatchEvent(new Event('input', { bubbles: true }));
      await delay(150);
    }
    
    element.dispatchEvent(new Event('blur', { bubbles: true }));
    
    if (successCount === 0) return { success: false, note: 'No matching skills found' };
    if (missingSkills.length > 0) return { success: false, note: `Filled ${successCount}/${normalizedArray.length}. Missing: ${missingSkills.join(', ')}` };
    return { success: true, note: '' };
  }

  /**
   * Workday Multi Select Handler (e.g., Generic).
   */
  async function fillMultiSelect(element, valuesArray) {
    if (!Array.isArray(valuesArray)) valuesArray = [valuesArray];
    if (valuesArray.length === 0) return { success: false, note: 'No values to fill' };

    let successCount = 0;
    const missingSkills = [];
    
    for (const val of valuesArray) {
      if (!val) continue;

      // 1. Click to focus
      element.focus();
      element.click();
      await delay(100);

      // 2. Type the value to filter options
      await fillTextInput(element, val, { dispatchBlur: false });
      
      // 3. Wait for options list to render and filter
      const listbox = await waitForOptions(1000).catch(() => null);
      
      if (listbox) {
        // Look for exact/fuzzy match or "No Items" indicator
        const options = Array.from(listbox.querySelectorAll('[role="option"], li'));
        const noItems = listbox.textContent.toLowerCase().includes('no items');
        
        if (!noItems && options.length > 0) {
          const searchStr = String(val).toLowerCase();
          let match = options.find(o => o.textContent.toLowerCase() === searchStr) || 
                      options.find(o => o.textContent.toLowerCase().includes(searchStr));
                      
          if (match) {
            match.click();
            successCount++;
            
            // Wait for the token chip to render in the DOM
            await delay(300);
            continue;
          }
        }
      }
      
      // If we reach here, we didn't find the option or "No Items" was shown
      OriginFillLogger.debug(`[OriginFill][Workday] Multi-select option not found for: ${val}`);
      missingSkills.push(val);
      
      // Clear the input so it doesn't block the next iteration
      await fillTextInput(element, '', { dispatchBlur: false });
      await delay(100);
    }
    
    element.dispatchEvent(new Event('blur', { bubbles: true }));
    
    if (successCount === 0) return { success: false, note: 'No matching skills found' };
    if (missingSkills.length > 0) return { success: false, note: `Filled ${successCount}/${valuesArray.length}. Missing: ${missingSkills.join(', ')}` };
    return { success: true, note: '' };
  }

  /**
   * Workday Repeating Section Handler (e.g., Websites, Portfolios).
   */
  async function fillRepeatingSection(element, valuesArray, automationId) {
    if (!Array.isArray(valuesArray)) valuesArray = [valuesArray];
    if (valuesArray.length === 0) return { success: false, note: 'No URLs provided' };

    let successCount = 0;
    let currentElement = element;
    
    // Find the container section (e.g. Website section)
    const sectionContainer = element.closest('[data-automation-id="websiteSection"]') || 
                             element.closest('ul') || 
                             element.closest('div[role="group"]');

    for (let i = 0; i < valuesArray.length; i++) {
      const urlInfo = valuesArray[i];
      const url = typeof urlInfo === 'object' ? urlInfo.url : urlInfo;
      
      if (!url) continue;

      // Fill current input
      if (currentElement) {
        await fillTextInput(currentElement, url);
        successCount++;
      } else {
        break; // Nowhere to fill
      }
      
      if (i < valuesArray.length - 1) {
        // Need to add another row
        // 1. Find the "Add" button
        const addBtn = document.querySelector('[data-automation-id="Add"]') ||
                       document.querySelector('[aria-label*="Add Website"]') ||
                       document.querySelector('[aria-label*="Add Portfolio"]');
                       
        if (!addBtn) {
          OriginFillLogger.debug('[OriginFill][Workday] Could not find "Add Another" button for repeating section.');
          break;
        }
        
        // 2. Click Add
        addBtn.click();
        
        // 3. Wait for new DOM input to appear
        let foundNewInput = false;
        for (let tries = 0; tries < 15; tries++) {
          await delay(200);
          const allInputs = sectionContainer ? sectionContainer.querySelectorAll('input') : document.querySelectorAll('[data-automation-id="website"] input, [data-automation-id="portfolio"] input');
          if (allInputs.length > i + 1) {
            currentElement = allInputs[allInputs.length - 1]; // Grab the latest one
            foundNewInput = true;
            break;
          }
        }
        
        if (!foundNewInput) break;
      }
    }
    
    if (successCount === 0) return { success: false, note: 'Failed to fill repeating section' };
    return { success: true, note: `Filled ${successCount}/${valuesArray.length} items` };
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

    // Verify
    const hasContent = element.textContent.trim().length > 0;
    return { success: hasContent, note: hasContent ? 'Rich text' : 'Rich text content empty after fill' };
  }

  /**
   * Fill a checkbox — handles both native and Workday custom checkboxes.
   * @param {HTMLElement} checkbox
   * @param {boolean} value
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function fillCheckbox(checkbox, value) {
    const shouldBeChecked = value === true || value === 'true' || value === 'yes' || value === 'Yes';

    // Handle Workday custom checkbox (div with role="checkbox")
    if (checkbox.getAttribute('role') === 'checkbox') {
      const currentlyChecked = checkbox.getAttribute('aria-checked') === 'true';
      if (currentlyChecked !== shouldBeChecked) {
        checkbox.click();
        await delay(100);
      }
      // Verify
      const finalState = checkbox.getAttribute('aria-checked') === 'true';
      return {
        success: finalState === shouldBeChecked,
        note: finalState !== shouldBeChecked ? 'Custom checkbox state mismatch' : ''
      };
    }

    // Native checkbox
    if (checkbox.checked !== shouldBeChecked) {
      checkbox.click();
      await delay(50);
    }

    // Verify
    return {
      success: checkbox.checked === shouldBeChecked,
      note: checkbox.checked !== shouldBeChecked ? 'Checkbox state mismatch after click' : ''
    };
  }

  /**
   * Fill a radio button by matching label text.
   * Handles both native and Workday custom radio groups.
   *
   * @param {HTMLElement} radio
   * @param {string} value
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function fillRadio(radio, value) {
    // Handle Workday custom radio (div with role="radio" or role="radiogroup")
    const radioGroup = radio.closest('[role="radiogroup"]') || radio.parentElement;
    if (radioGroup) {
      const customRadios = radioGroup.querySelectorAll('[role="radio"]');
      if (customRadios.length > 0) {
        for (const r of customRadios) {
          const label = r.textContent.trim() || r.getAttribute('aria-label') || '';
          if (label.toLowerCase().includes(value.toLowerCase())) {
            r.click();
            await delay(100);
            // Verify
            const checked = r.getAttribute('aria-checked') === 'true';
            return { success: checked, note: checked ? '' : 'Custom radio selection not confirmed' };
          }
        }
        return { success: false, note: `No custom radio option matches "${value}"` };
      }
    }

    // Native radio buttons
    const name = radio.name;
    if (!name) return { success: false, note: 'Radio without name attribute' };

    const radios = document.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`);

    for (const r of radios) {
      const label = OriginFillDetector.getInputLabel(r);
      if (label.toLowerCase().includes(value.toLowerCase())) {
        r.click();
        r.dispatchEvent(new Event('change', { bubbles: true }));
        await delay(50);
        return { success: r.checked, note: r.checked ? '' : 'Radio not checked after click' };
      }
    }

    return { success: false, note: `No radio option matches "${value}"` };
  }

  /**
   * Fill a date field with robust normalization.
   * Handles multiple input/output date formats.
   *
   * @param {HTMLElement} input
   * @param {string} value - Date in various formats
   * @returns {Promise<{ success: boolean, note: string }>}
   */
  async function fillDate(input, value) {
    const formatted = normalizeDate(value, input);
    if (!formatted) {
      return { success: false, note: `Could not normalize date: "${value}"` };
    }
    return fillTextInput(input, formatted);
  }

  /**
   * Normalize a date value to the format expected by an input element.
   *
   * @param {string} value - Profile date (YYYY-MM-DD, MM/DD/YYYY, YYYY-MM, June 2024, etc.)
   * @param {HTMLElement} input - The target input element
   * @returns {string|null} Formatted date string, or null if parsing failed
   */
  function normalizeDate(value, input) {
    if (!value) return null;

    // Parse the input date into components
    let year, month, day;

    // Format: YYYY-MM-DD or YYYY/MM/DD
    let match = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
    if (match) {
      year = match[1]; month = match[2]; day = match[3];
    }

    // Format: MM/DD/YYYY or MM-DD-YYYY
    if (!year) {
      match = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
      if (match) {
        month = match[1]; day = match[2]; year = match[3];
      }
    }

    // Format: YYYY-MM (no day)
    if (!year) {
      match = value.match(/^(\d{4})[-/](\d{1,2})$/);
      if (match) {
        year = match[1]; month = match[2]; day = null;
      }
    }

    // Format: MM/YYYY (no day)
    if (!year) {
      match = value.match(/^(\d{1,2})[-/](\d{4})$/);
      if (match) {
        month = match[1]; year = match[2]; day = null;
      }
    }

    // Format: "June 2024" or "Jun 2024"
    if (!year) {
      const monthNames = {
        'january': '01', 'february': '02', 'march': '03', 'april': '04',
        'may': '05', 'june': '06', 'july': '07', 'august': '08',
        'september': '09', 'october': '10', 'november': '11', 'december': '12',
        'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
        'jun': '06', 'jul': '07', 'aug': '08', 'sep': '09',
        'oct': '10', 'nov': '11', 'dec': '12'
      };
      match = value.match(/^(\w+)\s+(\d{4})$/);
      if (match) {
        const monthStr = match[1].toLowerCase();
        if (monthNames[monthStr]) {
          month = monthNames[monthStr]; year = match[2]; day = null;
        }
      }
    }

    // Format: just a year "2024"
    if (!year) {
      match = value.match(/^(\d{4})$/);
      if (match) {
        year = match[1]; month = null; day = null;
      }
    }

    if (!year) return value; // Return original if we can't parse

    // Pad month and day
    if (month) month = month.padStart(2, '0');
    if (day) day = day.padStart(2, '0');

    // Determine expected output format from the input element
    const placeholder = (input.placeholder || '').toUpperCase();

    // For type="date" inputs, always use YYYY-MM-DD
    if (input.type === 'date') {
      if (!day) day = '01'; // Default day for month-only dates
      return `${year}-${month || '01'}-${day}`;
    }

    // For type="month" inputs, use YYYY-MM
    if (input.type === 'month') {
      return `${year}-${month || '01'}`;
    }

    // Detect from placeholder
    if (placeholder.includes('MM/DD/YYYY') || placeholder.includes('MM-DD-YYYY')) {
      if (!day) day = '01';
      return `${month || '01'}/${day}/${year}`;
    }
    if (placeholder.includes('DD/MM/YYYY')) {
      if (!day) day = '01';
      return `${day}/${month || '01'}/${year}`;
    }
    if (placeholder.includes('YYYY-MM-DD')) {
      if (!day) day = '01';
      return `${year}-${month || '01'}-${day}`;
    }
    if (placeholder.includes('MM/YYYY')) {
      return `${month || '01'}/${year}`;
    }
    if (placeholder.includes('YYYY')) {
      return year;
    }

    // Default: MM/DD/YYYY (US format, common in Workday)
    if (month && day) {
      return `${month}/${day}/${year}`;
    }
    if (month) {
      return `${month}/${year}`;
    }
    return year;
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
    findShadowHosts,
    normalizeDate,
    waitForElement,
    waitForOptions,
    waitForValue,

    // Individual fill methods (for direct use/testing)
    fillTextInput,
    fillTextarea,
    fillRichText,
    fillCheckbox,
    fillRadio,
    fillDate
  });
})();
