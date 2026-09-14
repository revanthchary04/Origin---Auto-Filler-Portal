/**
 * OriginFill — Intelligent Field Type Detection
 * Analyzes input elements to determine what profile data they expect.
 * Uses label, placeholder, name, id, type, and surrounding context.
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

const OriginFillFieldMapper = (() => {
  'use strict';

  // ─── Field Type → Profile Path Mapping ─────────────────────────

  /**
   * Maps detected field types to profile data paths.
   * Array notation (e.g., education[0].institution) resolved at fill time.
   */
  const FIELD_TO_PROFILE = Object.freeze({
    // Personal
    'firstName':     'personal.firstName',
    'lastName':      'personal.lastName',
    'fullName':      'personal.fullName',
    'email':         'personal.email',
    'phone':         'personal.phone',
    'address':       'personal.address',
    'city':          'personal.city',
    'state':         'personal.state',
    'country':       'personal.country',
    'zipCode':       'personal.zipCode',
    'linkedIn':      'personal.linkedIn',
    'github':        'personal.github',
    'portfolio':     'personal.portfolio', // Legacy/fallback single URL
    'websites':      'websites',           // Repeating URL section

    // Education
    'institution':   'education[0].institution',
    'degree':        'education[0].degree',
    'fieldOfStudy':  'education[0].fieldOfStudy',
    'gpa':           'education[0].gpa',
    'eduStartYear':  'education[0].startYear',
    'eduEndYear':    'education[0].endYear',
    'eduLocation':   'education[0].location',

    // Work Experience
    'company':       'workExperience[0].company',
    'jobTitle':      'workExperience[0].jobTitle',
    'workStartDate': 'workExperience[0].startDate',
    'workEndDate':   'workExperience[0].endDate',
    'workLocation':  'workExperience[0].location',
    'workBullets':   'workExperience[0].bullets',
    'isCurrent':     'workExperience[0].isCurrent'
  });

  // ─── Keyword → Field Type Detection Rules ─────────────────────

  /**
   * Rules for detecting field type from labels, names, and placeholders.
   * Each rule has keywords (any must match) and negativeKeywords (none must match).
   * Order matters — first match wins.
   */
  const DETECTION_RULES = [
    // ─── Personal Fields ─────────────
    {
      fieldType: 'firstName',
      keywords: ['first name', 'first_name', 'firstname', 'given name', 'givenname', 'fname'],
      negativeKeywords: ['last', 'middle', 'preferred']
    },
    {
      fieldType: 'lastName',
      keywords: ['last name', 'last_name', 'lastname', 'family name', 'familyname', 'surname', 'lname'],
      negativeKeywords: ['first', 'middle']
    },
    {
      fieldType: 'fullName',
      keywords: ['full name', 'full_name', 'fullname', 'your name', 'name'],
      negativeKeywords: ['first', 'last', 'middle', 'company', 'school', 'institution', 'user', 'file']
    },
    {
      fieldType: 'email',
      keywords: ['email', 'e-mail', 'email address', 'e_mail'],
      negativeKeywords: ['confirm', 'verify', 'alternate', 'other']
    },
    {
      fieldType: 'phone',
      keywords: ['phone', 'telephone', 'mobile', 'cell', 'phone number', 'contact number', 'tel'],
      negativeKeywords: ['type', 'country code', 'extension']
    },
    {
      fieldType: 'address',
      keywords: ['address', 'street', 'address line', 'street address', 'mailing address'],
      negativeKeywords: ['email', 'e-mail', 'city', 'state', 'zip', 'country', 'web', 'url', 'ip']
    },
    {
      fieldType: 'city',
      keywords: ['city', 'town', 'municipality'],
      negativeKeywords: ['state', 'country']
    },
    {
      fieldType: 'state',
      keywords: ['state', 'province', 'region', 'prefecture'],
      negativeKeywords: ['country', 'city', 'united states']
    },
    {
      fieldType: 'country',
      keywords: ['country', 'nation', 'country/region', 'country of residence'],
      negativeKeywords: ['code', 'calling']
    },
    {
      fieldType: 'zipCode',
      keywords: ['zip', 'postal', 'zip code', 'postal code', 'zipcode', 'postcode'],
      negativeKeywords: []
    },
    {
      fieldType: 'linkedIn',
      keywords: ['linkedin', 'linked in', 'linkedin url', 'linkedin profile'],
      negativeKeywords: []
    },
    {
      fieldType: 'github',
      keywords: ['github', 'git hub', 'github url', 'github profile'],
      negativeKeywords: []
    },
    {
      fieldType: 'websites', // Use repeating websites by default for portfolios
      keywords: ['portfolio', 'website', 'personal site', 'personal website', 'portfolio url'],
      negativeKeywords: ['company']
    },

    // ─── Education Fields ─────────────
    {
      fieldType: 'institution',
      keywords: ['school', 'university', 'college', 'institution', 'school name', 'university name'],
      negativeKeywords: ['high school']
    },
    {
      fieldType: 'degree',
      keywords: ['degree', 'degree type', 'level of education', 'education level', 'qualification'],
      negativeKeywords: []
    },
    {
      fieldType: 'fieldOfStudy',
      keywords: ['major', 'field of study', 'field_of_study', 'concentration', 'discipline', 'area of study', 'specialization'],
      negativeKeywords: []
    },
    {
      fieldType: 'gpa',
      keywords: ['gpa', 'grade', 'grade point', 'cgpa', 'grade point average'],
      negativeKeywords: []
    },
    {
      fieldType: 'eduStartYear',
      keywords: ['start year', 'from year', 'enrollment year'],
      negativeKeywords: ['work', 'job', 'employment'],
      context: 'education'
    },
    {
      fieldType: 'eduEndYear',
      keywords: ['end year', 'graduation year', 'completion year', 'to year'],
      negativeKeywords: ['work', 'job', 'employment'],
      context: 'education'
    },

    // ─── Work Experience Fields ─────────────
    {
      fieldType: 'company',
      keywords: ['company', 'employer', 'organization', 'company name', 'employer name'],
      negativeKeywords: ['size', 'type', 'industry']
    },
    {
      fieldType: 'jobTitle',
      keywords: ['job title', 'title', 'position', 'role', 'designation', 'position title'],
      negativeKeywords: ['mr', 'mrs', 'dr', 'salutation', 'prefix']
    },
    {
      fieldType: 'workStartDate',
      keywords: ['start date', 'from date', 'date started', 'beginning date'],
      negativeKeywords: ['education', 'school'],
      context: 'work'
    },
    {
      fieldType: 'workEndDate',
      keywords: ['end date', 'to date', 'date ended', 'last date', 'leaving date'],
      negativeKeywords: ['education', 'school'],
      context: 'work'
    },
    {
      fieldType: 'workLocation',
      keywords: ['location', 'job location', 'work location', 'office location'],
      negativeKeywords: ['preference', 'desired'],
      context: 'work'
    },
    {
      fieldType: 'workBullets',
      keywords: ['description', 'responsibilities', 'duties', 'job description', 'role description', 'summary of role', 'key responsibilities'],
      negativeKeywords: [],
      context: 'work'
    },
    {
      fieldType: 'isCurrent',
      keywords: ['currently', 'current', 'present', 'i currently work', 'currently working'],
      negativeKeywords: []
    }
  ];

  // ─── Field Type Detection ──────────────────────────────────────

  /**
   * Detect the field type of an input element.
   * Uses label, placeholder, name, id, and input type.
   *
   * @param {HTMLElement} element - Input, select, or textarea element
   * @returns {{ fieldType: string|null, profilePath: string|null, confidence: string, inputType: string }}
   */
  function detectFieldType(element) {
    if (!element) {
      return { fieldType: null, profilePath: null, confidence: 'none', inputType: 'unknown' };
    }

    const inputType = getInputType(element);

    // Gather all text clues
    const label = OriginFillDetector.getInputLabel(element).toLowerCase();
    const placeholder = (element.placeholder || '').toLowerCase();
    const name = (element.name || '').toLowerCase();
    const id = (element.id || '').toLowerCase();
    const ariaLabel = (element.getAttribute('aria-label') || '').toLowerCase();
    const automationId = (element.getAttribute('data-automation-id') || '').toLowerCase();

    // Combine all clues
    const combined = `${label} ${placeholder} ${name} ${id} ${ariaLabel} ${automationId}`;

    // Check input type shortcut
    if (element.type === 'email') {
      return createResult('email', 'high', inputType);
    }
    if (element.type === 'tel') {
      return createResult('phone', 'high', inputType);
    }
    if (element.type === 'url') {
      // Determine which URL field
      if (combined.includes('linkedin')) return createResult('linkedIn', 'high', inputType);
      if (combined.includes('github')) return createResult('github', 'high', inputType);
      return createResult('portfolio', 'medium', inputType);
    }

    // Try detection rules
    for (const rule of DETECTION_RULES) {
      const hasPositive = rule.keywords.some(kw => combined.includes(kw));
      const hasNegative = rule.negativeKeywords.length > 0 &&
                          rule.negativeKeywords.some(nk => combined.includes(nk));

      if (hasPositive && !hasNegative) {
        // Determine confidence
        let confidence = 'medium';

        // Higher confidence if label or automation-id matches directly
        if (rule.keywords.some(kw => label.includes(kw) || automationId.includes(kw))) {
          confidence = 'high';
        }

        // Check context (education vs work) if applicable
        if (rule.context) {
          const sectionContext = detectSectionContext(element);
          if (sectionContext && sectionContext !== rule.context) {
            continue; // Skip — wrong section context
          }
        }

        return createResult(rule.fieldType, confidence, inputType);
      }
    }

    // Special case: file input (likely resume)
    if (element.type === 'file') {
      const acceptsDoc = (element.accept || '').match(/pdf|doc|docx|rtf/i);
      if (acceptsDoc || combined.includes('resume') || combined.includes('cv')) {
        return {
          fieldType: 'resume',
          profilePath: 'resume',
          confidence: 'high',
          inputType: 'file'
        };
      }
    }

    return { fieldType: null, profilePath: null, confidence: 'none', inputType };
  }

  /**
   * Create a detection result object.
   * @param {string} fieldType
   * @param {string} confidence
   * @param {string} inputType
   * @returns {{ fieldType: string, profilePath: string, confidence: string, inputType: string }}
   */
  function createResult(fieldType, confidence, inputType) {
    return {
      fieldType,
      profilePath: FIELD_TO_PROFILE[fieldType] || null,
      confidence,
      inputType
    };
  }

  /**
   * Determine the input type (text, select, checkbox, radio, etc.)
   * @param {HTMLElement} element
   * @returns {string}
   */
  function getInputType(element) {
    const tag = element.tagName.toLowerCase();

    if (tag === 'select') return OriginFillFieldTypes.SELECT;
    if (tag === 'textarea') return OriginFillFieldTypes.TEXTAREA;

    if (tag === 'input') {
      const type = (element.type || 'text').toLowerCase();
      switch (type) {
        case 'checkbox': return OriginFillFieldTypes.CHECKBOX;
        case 'radio':    return OriginFillFieldTypes.RADIO;
        case 'file':     return OriginFillFieldTypes.FILE;
        case 'date':     return OriginFillFieldTypes.DATE;
        case 'number':   return OriginFillFieldTypes.NUMBER;
        case 'email':    return OriginFillFieldTypes.EMAIL;
        case 'tel':      return OriginFillFieldTypes.PHONE;
        case 'url':      return OriginFillFieldTypes.URL;
        default:         return OriginFillFieldTypes.TEXT;
      }
    }

    // contenteditable div
    if (element.getAttribute('contenteditable') === 'true') {
      return OriginFillFieldTypes.RICHTEXT;
    }

    // ARIA combobox
    if (element.getAttribute('role') === 'combobox' || element.getAttribute('role') === 'listbox') {
      return OriginFillFieldTypes.COMBOBOX;
    }

    return OriginFillFieldTypes.TEXT;
  }

  /**
   * Detect whether an element is within an education or work experience section.
   * Uses ancestor elements and nearby headings.
   *
   * @param {HTMLElement} element
   * @returns {'education'|'work'|null}
   */
  function detectSectionContext(element) {
    // Walk up ancestors looking for section indicators
    let current = element;
    for (let i = 0; i < 10 && current; i++) {
      const text = (current.textContent || '').toLowerCase().slice(0, 200);
      const id = (current.id || '').toLowerCase();
      const automationId = (current.getAttribute('data-automation-id') || '').toLowerCase();
      const className = (current.className || '').toLowerCase();

      const combined = `${id} ${automationId} ${className}`;

      if (combined.includes('education') || combined.includes('school') || combined.includes('academic')) {
        return 'education';
      }
      if (combined.includes('work') || combined.includes('experience') || combined.includes('employment')) {
        return 'work';
      }

      current = current.parentElement;
    }

    return null;
  }

  // ─── Profile Value Resolution ──────────────────────────────────

  /**
   * Resolve a profile data path to an actual value.
   * Supports dot notation and array indices: "education[0].institution"
   *
   * @param {Object} profile - Full profile object
   * @param {string} path - Data path (e.g., "personal.email", "education[0].degree")
   * @returns {any} The resolved value, or undefined if not found
   */
  function resolveProfilePath(profile, path) {
    if (!profile || !path) return undefined;

    const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
    let current = profile;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;

      // Numeric index for arrays
      if (/^\d+$/.test(part)) {
        current = current[parseInt(part, 10)];
      } else {
        current = current[part];
      }
    }

    return current;
  }

  /**
   * Get the profile value for a detected field.
   * @param {Object} profile - Full profile object
   * @param {string} fieldType - Detected field type
   * @param {number} [arrayIndex=0] - Index for array fields (education, work experience)
   * @returns {any}
   */
  function getFieldValue(profile, fieldType, arrayIndex = 0) {
    let path = FIELD_TO_PROFILE[fieldType];
    if (!path) return undefined;

    // Replace [0] with actual array index
    path = path.replace(/\[0\]/g, `[${arrayIndex}]`);

    return resolveProfilePath(profile, path);
  }

  /**
   * Get all fillable fields on the current page.
   * @returns {Array<{ element: HTMLElement, fieldType: string, profilePath: string, inputType: string, confidence: string }>}
   */
  function scanPageFields() {
    const allInputs = document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), ' +
      'select, ' +
      'textarea, ' +
      '[contenteditable="true"], ' +
      '[role="combobox"], ' +
      '[role="listbox"]'
    );

    const results = [];

    allInputs.forEach(element => {
      // Skip hidden or disabled elements
      if (element.disabled || element.readOnly) return;
      if (!OriginFillDetector.isVisible(element)) return;

      const detection = detectFieldType(element);

      if (detection.fieldType) {
        results.push({
          element,
          fieldType: detection.fieldType,
          profilePath: detection.profilePath,
          inputType: detection.inputType,
          confidence: detection.confidence
        });
      }
    });

    OriginFillLogger.info(`Page scan: ${results.length} fillable fields detected`);
    return results;
  }

  // ─── Sensitive Question Detection ────────────────────────────

  /**
   * Check if a field is a sensitive application question that should NOT be auto-filled.
   * Examples: work authorization, disability, veteran status, salary, criminal history.
   *
   * @param {HTMLElement} element
   * @returns {{ isSensitive: boolean, reason: string }}
   */
  function isSensitiveField(element) {
    if (!element) return { isSensitive: false, reason: '' };

    const label = OriginFillDetector.getInputLabel(element).toLowerCase();
    const placeholder = (element.placeholder || '').toLowerCase();
    const name = (element.name || '').toLowerCase();
    const id = (element.id || '').toLowerCase();
    const ariaLabel = (element.getAttribute('aria-label') || '').toLowerCase();
    const automationId = (element.getAttribute('data-automation-id') || '').toLowerCase();

    const combined = `${label} ${placeholder} ${name} ${id} ${ariaLabel} ${automationId}`;

    // Check Workday explicitly-skipped sensitive fields
    const sensitiveAutomationIds = [
      'veteranstatus', 'disabilitystatus', 'ethnicitydropdown',
      'genderdropdown', 'racedropdown'
    ];
    if (sensitiveAutomationIds.some(sid => automationId.includes(sid))) {
      return { isSensitive: true, reason: 'Voluntary self-identification — requires your review' };
    }

    for (const keyword of OriginFillSensitiveKeywords) {
      if (combined.includes(keyword)) {
        return { isSensitive: true, reason: `Sensitive field ("${keyword}") — requires your review` };
      }
    }

    // Check for free-text textarea questions that could be application questions
    if (element.tagName === 'TEXTAREA') {
      const questionWords = ['why', 'describe', 'explain', 'tell us', 'what makes'];
      if (questionWords.some(w => combined.includes(w))) {
        return { isSensitive: true, reason: 'Open-ended question — requires your review' };
      }
    }

    return { isSensitive: false, reason: '' };
  }

  // ─── Confidence Score Utilities ───────────────────────────────

  /**
   * Convert a string confidence level to a numeric score.
   * @param {string} confidenceString - 'exact', 'high', 'medium', 'low', 'none'
   * @returns {number} Score between 0.0 and 1.0
   */
  function getConfidenceScore(confidenceString) {
    return OriginFillConfidenceScores[confidenceString] || 0.0;
  }

  // ─── Public API ─────────────────────────────────────────────────
  return Object.freeze({
    detectFieldType,
    getInputType,
    detectSectionContext,
    resolveProfilePath,
    getFieldValue,
    scanPageFields,
    isSensitiveField,
    getConfidenceScore,
    FIELD_TO_PROFILE,
    DETECTION_RULES
  });
})();
