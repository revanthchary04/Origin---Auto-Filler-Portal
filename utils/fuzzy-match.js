/**
 * OriginFill — Fuzzy String Matching
 * Multi-strategy matching for dropdown fields (colleges, countries, states, etc.)
 * Priority: Exact → Normalized → Fuzzy (Levenshtein) → Keyword → Fallback
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

const OriginFillFuzzyMatch = (() => {
  'use strict';

  // ─── Levenshtein Distance (Optimized Single-Row DP) ───────────

  /**
   * Calculate the Levenshtein edit distance between two strings.
   * Uses single-row optimization for O(min(m,n)) space complexity.
   *
   * @param {string} a
   * @param {string} b
   * @returns {number} Edit distance
   */
  function levenshteinDistance(a, b) {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    // Ensure a is the shorter string (for space optimization)
    if (a.length > b.length) {
      [a, b] = [b, a];
    }

    const aLen = a.length;
    const bLen = b.length;

    // Previous row of distances
    let prevRow = new Array(aLen + 1);
    for (let i = 0; i <= aLen; i++) {
      prevRow[i] = i;
    }

    for (let j = 1; j <= bLen; j++) {
      let prev = j; // prevRow[0] for current row

      for (let i = 1; i <= aLen; i++) {
        let current;

        if (a[i - 1] === b[j - 1]) {
          current = prevRow[i - 1];
        } else {
          current = 1 + Math.min(
            prevRow[i - 1],  // substitution
            prevRow[i],      // deletion
            prev             // insertion
          );
        }

        prevRow[i - 1] = prev;
        prev = current;
      }

      prevRow[aLen] = prev;
    }

    return prevRow[aLen];
  }

  // ─── String Normalization ──────────────────────────────────────

  /**
   * Normalize a string for comparison:
   * - Lowercase
   * - Remove articles (the, of, a, an)
   * - Remove punctuation
   * - Collapse whitespace
   * - Trim
   *
   * @param {string} str
   * @returns {string}
   */
  function normalize(str) {
    if (!str) return '';

    return str
      .toLowerCase()
      .replace(/[''`]/g, '')                            // Remove apostrophes
      .replace(/[^\w\s]/g, ' ')                          // Replace punctuation with space
      .replace(/\b(the|of|a|an|and|at|in|for)\b/gi, '') // Remove articles/prepositions
      .replace(/\s+/g, ' ')                              // Collapse whitespace
      .trim();
  }

  /**
   * Extract meaningful keywords from a string.
   * @param {string} str
   * @returns {string[]}
   */
  function extractKeywords(str) {
    if (!str) return [];

    return normalize(str)
      .split(' ')
      .filter(word => word.length > 1); // Skip single-char words
  }

  // ─── Match Strategies ─────────────────────────────────────────

  /**
   * STRATEGY 1: Exact match (case-insensitive).
   *
   * @param {string} value - Target value to match
   * @param {Array<{text: string, index: number}>} options - Available options
   * @returns {{ match: Object|null, confidence: string }}
   */
  function exactMatch(value, options) {
    const target = value.toLowerCase().trim();

    for (const option of options) {
      if (option.text.toLowerCase().trim() === target) {
        return {
          match: option,
          confidence: 'exact',
          strategy: 'exact'
        };
      }
    }

    return { match: null, confidence: 'none', strategy: 'exact' };
  }

  /**
   * STRATEGY 2: Normalized match (remove articles, punctuation, etc.)
   *
   * @param {string} value
   * @param {Array<{text: string, index: number}>} options
   * @returns {{ match: Object|null, confidence: string }}
   */
  function normalizedMatch(value, options) {
    const target = normalize(value);
    if (!target) return { match: null, confidence: 'none', strategy: 'normalized' };

    for (const option of options) {
      const normalized = normalize(option.text);
      if (normalized === target) {
        return {
          match: option,
          confidence: 'high',
          strategy: 'normalized'
        };
      }
    }

    return { match: null, confidence: 'none', strategy: 'normalized' };
  }

  /**
   * STRATEGY 3: Fuzzy match via Levenshtein distance.
   * Accepts match if distance < threshold% of the longer string's length.
   *
   * @param {string} value
   * @param {Array<{text: string, index: number}>} options
   * @param {number} [threshold] - Max distance ratio (default: 0.30)
   * @returns {{ match: Object|null, confidence: string, distance: number }}
   */
  function fuzzyMatch(value, options, threshold) {
    const maxRatio = threshold || OriginFillFuzzyConfig.MAX_DISTANCE_RATIO;
    const target = normalize(value);
    if (!target) return { match: null, confidence: 'none', strategy: 'fuzzy', distance: Infinity };

    let bestMatch = null;
    let bestDistance = Infinity;

    for (const option of options) {
      const normalized = normalize(option.text);
      if (!normalized) continue;

      const distance = levenshteinDistance(target, normalized);
      const maxLen = Math.max(target.length, normalized.length);
      const ratio = distance / maxLen;

      if (ratio < maxRatio && distance < bestDistance) {
        bestDistance = distance;
        bestMatch = option;
      }
    }

    if (bestMatch) {
      return {
        match: bestMatch,
        confidence: bestDistance <= 2 ? 'high' : 'medium',
        strategy: 'fuzzy',
        distance: bestDistance
      };
    }

    return { match: null, confidence: 'none', strategy: 'fuzzy', distance: Infinity };
  }

  /**
   * STRATEGY 4: Keyword match.
   * Split value into keywords, check if majority appear in any option.
   *
   * @param {string} value
   * @param {Array<{text: string, index: number}>} options
   * @returns {{ match: Object|null, confidence: string, matchRatio: number }}
   */
  function keywordMatch(value, options) {
    const keywords = extractKeywords(value);
    if (keywords.length === 0) {
      return { match: null, confidence: 'none', strategy: 'keyword', matchRatio: 0 };
    }

    const minRatio = OriginFillFuzzyConfig.MIN_KEYWORD_MATCH_RATIO;
    let bestMatch = null;
    let bestRatio = 0;

    for (const option of options) {
      const optionLower = option.text.toLowerCase();
      let matched = 0;

      for (const kw of keywords) {
        if (optionLower.includes(kw)) {
          matched++;
        }
      }

      const ratio = matched / keywords.length;

      if (ratio >= minRatio && ratio > bestRatio) {
        bestRatio = ratio;
        bestMatch = option;
      }
    }

    if (bestMatch) {
      return {
        match: bestMatch,
        confidence: bestRatio >= 0.8 ? 'high' : 'medium',
        strategy: 'keyword',
        matchRatio: bestRatio
      };
    }

    return { match: null, confidence: 'none', strategy: 'keyword', matchRatio: 0 };
  }

  /**
   * STRATEGY 5: Fallback — look for "Other", "Not Listed", etc.
   *
   * @param {Array<{text: string, index: number}>} options
   * @returns {{ match: Object|null, confidence: string }}
   */
  function fallbackMatch(options) {
    const fallbackTerms = OriginFillFuzzyConfig.FALLBACK_OPTIONS;

    for (const term of fallbackTerms) {
      for (const option of options) {
        if (option.text.toLowerCase().trim() === term) {
          return {
            match: option,
            confidence: 'low',
            strategy: 'fallback',
            fallbackTerm: term
          };
        }
      }
    }

    // Partial match on fallback terms
    for (const term of fallbackTerms) {
      for (const option of options) {
        if (option.text.toLowerCase().includes(term)) {
          return {
            match: option,
            confidence: 'low',
            strategy: 'fallback',
            fallbackTerm: term
          };
        }
      }
    }

    return { match: null, confidence: 'none', strategy: 'fallback' };
  }

  // ─── Master Match Function ─────────────────────────────────────

  /**
   * Find the best match for a value among a list of options.
   * Tries all strategies in priority order.
   *
   * @param {string} value - The target value to match
   * @param {string[]|Array<{text: string}>} rawOptions - Available options (strings or objects with .text)
   * @param {Object} [config] - Override configuration
   * @param {number} [config.threshold] - Fuzzy match threshold
   * @param {boolean} [config.skipFallback] - Don't use fallback strategy
   * @returns {{
   *   matched: boolean,
   *   option: Object|null,
   *   confidence: string,
   *   strategy: string,
   *   details: Object
   * }}
   */
  function bestMatch(value, rawOptions, config = {}) {
    if (!value || !rawOptions || rawOptions.length === 0) {
      return {
        matched: false,
        option: null,
        confidence: 'none',
        strategy: 'none',
        details: { reason: !value ? 'empty value' : 'no options' }
      };
    }

    // Normalize options to { text, index, originalValue } format
    const options = rawOptions.map((opt, i) => {
      if (typeof opt === 'string') {
        return { text: opt, index: i, originalValue: opt };
      }
      return { text: opt.text || opt.textContent || opt.label || String(opt), index: i, originalValue: opt };
    });

    // Strategy 1: Exact match
    const exact = exactMatch(value, options);
    if (exact.match) {
      return {
        matched: true,
        option: exact.match,
        confidence: 'exact',
        strategy: 'exact',
        details: exact
      };
    }

    // Strategy 2: Normalized match
    const normalized = normalizedMatch(value, options);
    if (normalized.match) {
      return {
        matched: true,
        option: normalized.match,
        confidence: 'high',
        strategy: 'normalized',
        details: normalized
      };
    }

    // Strategy 3: Fuzzy match
    const fuzzy = fuzzyMatch(value, options, config.threshold);
    if (fuzzy.match) {
      return {
        matched: true,
        option: fuzzy.match,
        confidence: fuzzy.confidence,
        strategy: 'fuzzy',
        details: fuzzy
      };
    }

    // Strategy 4: Keyword match
    const keyword = keywordMatch(value, options);
    if (keyword.match) {
      return {
        matched: true,
        option: keyword.match,
        confidence: keyword.confidence,
        strategy: 'keyword',
        details: keyword
      };
    }

    // Strategy 5: Fallback
    if (!config.skipFallback) {
      const fallback = fallbackMatch(options);
      if (fallback.match) {
        return {
          matched: true,
          option: fallback.match,
          confidence: 'low',
          strategy: 'fallback',
          details: { ...fallback, originalValue: value }
        };
      }
    }

    // No match found
    return {
      matched: false,
      option: null,
      confidence: 'none',
      strategy: 'none',
      details: { value, optionCount: options.length, reason: 'no match found' }
    };
  }

  // ─── Convenience: Match Options from <select> Element ──────────

  /**
   * Match a value against options in a <select> element.
   *
   * @param {string} value - Value to match
   * @param {HTMLSelectElement} selectElement - The select element
   * @param {Object} [config] - Override configuration
   * @returns {Object} Match result from bestMatch()
   */
  function matchSelectOptions(value, selectElement, config = {}) {
    const options = Array.from(selectElement.options)
      .filter(opt => opt.value !== '' && !opt.disabled) // Skip placeholder options
      .map((opt, i) => ({
        text: opt.textContent.trim(),
        index: opt.index,
        value: opt.value,
        originalValue: opt
      }));

    return bestMatch(value, options, config);
  }

  // ─── Public API ─────────────────────────────────────────────────
  return Object.freeze({
    bestMatch,
    matchSelectOptions,
    levenshteinDistance,
    normalize,
    extractKeywords,

    // Individual strategies (for direct use)
    exactMatch,
    normalizedMatch,
    fuzzyMatch,
    keywordMatch,
    fallbackMatch
  });
})();
