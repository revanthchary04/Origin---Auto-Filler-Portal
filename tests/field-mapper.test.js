const fs = require('fs');
const path = require('path');

// Load dependencies in order
const constantsPath = path.join(__dirname, '../utils/constants.js');
const mapperPath = path.join(__dirname, '../utils/field-mapper.js');
const detectorPath = path.join(__dirname, '../content/detector.js');

// Evaluate the scripts in the global scope
loadExtensionScript(constantsPath);
loadExtensionScript(detectorPath);
loadExtensionScript(mapperPath);

describe('OriginFillFieldMapper', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('isSensitiveField', () => {
    it('should detect standard sensitive fields via label', () => {
      const input = document.createElement('input');
      const label = document.createElement('label');
      label.textContent = 'Are you a protected veteran?';
      label.htmlFor = 'vet';
      input.id = 'vet';
      
      document.body.appendChild(label);
      document.body.appendChild(input);

      const result = OriginFillFieldMapper.isSensitiveField(input);
      expect(result.isSensitive).toBe(true);
      expect(result.reason).toContain('requires your review');
    });

    it('should detect Workday specific sensitive automation ids', () => {
      const input = document.createElement('input');
      input.setAttribute('data-automation-id', 'disabilityStatusDropdown');
      document.body.appendChild(input);

      const result = OriginFillFieldMapper.isSensitiveField(input);
      expect(result.isSensitive).toBe(true);
      expect(result.reason).toContain('Voluntary self-identification');
    });

    it('should allow normal fields', () => {
      const input = document.createElement('input');
      const label = document.createElement('label');
      label.textContent = 'First Name';
      label.htmlFor = 'fname';
      input.id = 'fname';
      
      document.body.appendChild(label);
      document.body.appendChild(input);

      const result = OriginFillFieldMapper.isSensitiveField(input);
      expect(result.isSensitive).toBe(false);
    });

    it('should flag open-ended textarea questions', () => {
      const textarea = document.createElement('textarea');
      const label = document.createElement('label');
      label.textContent = 'Please describe your background';
      label.htmlFor = 'desc';
      textarea.id = 'desc';
      
      document.body.appendChild(label);
      document.body.appendChild(textarea);

      const result = OriginFillFieldMapper.isSensitiveField(textarea);
      expect(result.isSensitive).toBe(true);
      expect(result.reason).toContain('Open-ended question');
    });
  });

  describe('getConfidenceScore', () => {
    it('should convert confidence strings to numeric scores', () => {
      expect(OriginFillFieldMapper.getConfidenceScore('exact')).toBe(1.0);
      expect(OriginFillFieldMapper.getConfidenceScore('high')).toBe(0.95);
      expect(OriginFillFieldMapper.getConfidenceScore('medium')).toBe(0.80);
      expect(OriginFillFieldMapper.getConfidenceScore('low')).toBe(0.65);
      expect(OriginFillFieldMapper.getConfidenceScore('none')).toBe(0.0);
    });

    it('should return 0 for unknown strings', () => {
      expect(OriginFillFieldMapper.getConfidenceScore('unknown')).toBe(0.0);
    });
  });

  describe('resolveProfilePath', () => {
    const profile = {
      personal: {
        firstName: 'John',
        lastName: 'Doe'
      },
      education: [
        { institution: 'MIT', startYear: '2015' },
        { institution: 'Harvard', startYear: '2019' }
      ]
    };

    it('should resolve top level paths', () => {
      expect(OriginFillFieldMapper.resolveProfilePath(profile, 'personal')).toEqual(profile.personal);
    });

    it('should resolve nested object paths', () => {
      expect(OriginFillFieldMapper.resolveProfilePath(profile, 'personal.firstName')).toBe('John');
    });

    it('should resolve array indexing', () => {
      expect(OriginFillFieldMapper.resolveProfilePath(profile, 'education[0].institution')).toBe('MIT');
      expect(OriginFillFieldMapper.resolveProfilePath(profile, 'education[1].institution')).toBe('Harvard');
    });

    it('should return undefined for undefined paths', () => {
      expect(OriginFillFieldMapper.resolveProfilePath(profile, 'personal.middleName')).toBeUndefined();
      expect(OriginFillFieldMapper.resolveProfilePath(profile, 'education[2].institution')).toBeUndefined();
    });
  });
});
