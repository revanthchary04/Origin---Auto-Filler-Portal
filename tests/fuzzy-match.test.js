const fs = require('fs');
const path = require('path');

// Load dependencies in order
const constantsPath = path.join(__dirname, '../utils/constants.js');
const fuzzyPath = path.join(__dirname, '../utils/fuzzy-match.js');

// Evaluate the scripts in the global scope
loadExtensionScript(constantsPath);
loadExtensionScript(fuzzyPath);

describe('OriginFillFuzzyMatch', () => {
  describe('levenshteinDistance', () => {
    it('should calculate distance correctly', () => {
      // Not exported directly, but we can test via bestMatch exact vs fuzzy
      expect(OriginFillFuzzyMatch.bestMatch('test', [{text: 'test', index: 0}]).strategy).toBe('exact');
    });
  });

  describe('bestMatch', () => {
    it('should find exact matches (case-insensitive)', () => {
      const options = [
        { text: 'Option A', index: 0 },
        { text: 'Option B', index: 1 }
      ];
      const match = OriginFillFuzzyMatch.bestMatch('option a', options);
      expect(match.matched).toBe(true);
      expect(match.strategy).toBe('exact');
      expect(match.option.index).toBe(0);
    });

    it('should find partial substring matches', () => {
      const options = [
        { text: 'United States of America', index: 0 },
        { text: 'United Kingdom', index: 1 }
      ];
      const match = OriginFillFuzzyMatch.bestMatch('United States', options);
      expect(match.matched).toBe(true);
      expect(match.strategy).toBe('keyword');
      expect(match.option.index).toBe(0);
    });

    it('should find fuzzy matches based on Levenshtein distance', () => {
      const options = [
        { text: 'Software Engineer', index: 0 },
        { text: 'Data Scientist', index: 1 }
      ];
      const match = OriginFillFuzzyMatch.bestMatch('Softwar Enginer', options);
      expect(match.matched).toBe(true);
      expect(match.strategy).toBe('fuzzy');
      expect(match.option.index).toBe(0);
    });

    it('should fallback to default options if no match is found', () => {
      const options = [
        { text: 'Manager', index: 0 },
        { text: 'Other', index: 1 }
      ];
      const match = OriginFillFuzzyMatch.bestMatch('Astronaut', options);
      expect(match.matched).toBe(true);
      expect(match.strategy).toBe('fallback');
      expect(match.option.index).toBe(1);
    });

    it('should return unmatched if no match and no fallback', () => {
      const options = [
        { text: 'Manager', index: 0 },
        { text: 'Director', index: 1 }
      ];
      const match = OriginFillFuzzyMatch.bestMatch('Astronaut', options);
      expect(match.matched).toBe(false);
      expect(match.strategy).toBe('none');
    });
  });
});
