const fs = require('fs');
const path = require('path');

// Load dependencies in order
const constantsPath = path.join(__dirname, '../utils/constants.js');
const mapperPath = path.join(__dirname, '../utils/field-mapper.js');
const workdayPath = path.join(__dirname, '../content/portals/workday.js');

// Evaluate the scripts in the global scope
loadExtensionScript(constantsPath);
loadExtensionScript(mapperPath);
loadExtensionScript(workdayPath);

describe('OriginFillWorkday', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('normalizeDate', () => {
    it('should format YYYY-MM-DD to MM/DD/YYYY for generic inputs', () => {
      const input = document.createElement('input');
      expect(OriginFillWorkday.normalizeDate('2024-06-15', input)).toBe('06/15/2024');
    });

    it('should format correctly for type="date" inputs', () => {
      const input = document.createElement('input');
      input.type = 'date';
      expect(OriginFillWorkday.normalizeDate('06/15/2024', input)).toBe('2024-06-15');
    });

    it('should handle month-only dates (YYYY-MM)', () => {
      const input = document.createElement('input');
      expect(OriginFillWorkday.normalizeDate('2024-06', input)).toBe('06/2024');
    });

    it('should format correctly for type="month" inputs', () => {
      const input = document.createElement('input');
      input.type = 'month';
      expect(OriginFillWorkday.normalizeDate('06/15/2024', input)).toBe('2024-06');
    });

    it('should handle text-based dates', () => {
      const input = document.createElement('input');
      expect(OriginFillWorkday.normalizeDate('June 2024', input)).toBe('06/2024');
      expect(OriginFillWorkday.normalizeDate('Jun 2024', input)).toBe('06/2024');
    });

    it('should return original if unparseable', () => {
      const input = document.createElement('input');
      expect(OriginFillWorkday.normalizeDate('unknown', input)).toBe('unknown');
    });
  });

  describe('findInputInContainer', () => {
    it('should find nested inputs', () => {
      const container = document.createElement('div');
      const input = document.createElement('input');
      input.type = 'text';
      container.appendChild(input);

      expect(OriginFillWorkday.findInputInContainer(container)).toBe(input);
    });

    it('should ignore hidden inputs', () => {
      const container = document.createElement('div');
      const hiddenInput = document.createElement('input');
      hiddenInput.type = 'hidden';
      const visibleInput = document.createElement('input');
      visibleInput.type = 'text';
      container.appendChild(hiddenInput);
      container.appendChild(visibleInput);

      expect(OriginFillWorkday.findInputInContainer(container)).toBe(visibleInput);
    });
    
    it('should find combobox elements', () => {
      const container = document.createElement('div');
      const combobox = document.createElement('div');
      combobox.setAttribute('role', 'combobox');
      container.appendChild(combobox);

      expect(OriginFillWorkday.findInputInContainer(container)).toBe(combobox);
    });
  });
});
