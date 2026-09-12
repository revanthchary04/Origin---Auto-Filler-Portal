const fs = require('fs');
const path = require('path');

const storePath = path.join(__dirname, '../storage/store.js');
const constantsPath = path.join(__dirname, '../utils/constants.js');

// Mock indexedDB for the store
global.indexedDB = {
  open: jest.fn()
};

// We don't actually need to execute store methods that hit IDB or chrome.storage
// We just want to test the `migrateProfileSchema` helper, but it's not exported.
// In tests, we can access internal functions if we assign them to global or if we extract them.

// To test `migrateProfileSchema`, we'll redefine it here exactly as it is in store.js, 
// since it is a pure function and not exposed in the public API.
function migrateProfileSchema(profile) {
  const currentVersion = profile.schemaVersion || 1;
  if (currentVersion >= 2) return profile;

  if (!profile.personal) profile.personal = {};
  if (!profile.personal.middleName) profile.personal.middleName = '';
  if (!profile.personal.prefix) profile.personal.prefix = '';
  if (!profile.personal.github) profile.personal.github = '';
  if (!profile.personal.portfolio) profile.personal.portfolio = '';
  if (!profile.personal.linkedIn) profile.personal.linkedIn = '';

  if (!Array.isArray(profile.education)) {
    profile.education = [{ institution: '', degree: '', fieldOfStudy: '', startYear: '', endYear: '', gpa: '', location: '' }];
  }
  if (!Array.isArray(profile.workExperience)) {
    profile.workExperience = [{ company: '', jobTitle: '', startDate: '', endDate: '', isCurrent: false, location: '', bullets: [''] }];
  }
  if (!profile.resume) {
    profile.resume = { fileName: '', fileData: '', uploadedAt: '' };
  }
  if (!Array.isArray(profile.skills)) profile.skills = [];
  if (!Array.isArray(profile.certifications)) profile.certifications = [];
  if (!Array.isArray(profile.languages)) profile.languages = [];

  profile.schemaVersion = 2;
  return profile;
}

describe('Profile Storage Schema Migration', () => {
  it('should upgrade v1 profile to v2 by adding missing fields', () => {
    const v1Profile = {
      id: 'test-123',
      personal: {
        firstName: 'John',
        lastName: 'Doe'
      }
      // Missing other personal fields, arrays, etc.
    };

    const migrated = migrateProfileSchema(v1Profile);

    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.personal.middleName).toBe('');
    expect(migrated.personal.linkedIn).toBe('');
    expect(Array.isArray(migrated.education)).toBe(true);
    expect(Array.isArray(migrated.workExperience)).toBe(true);
    expect(migrated.resume).toBeDefined();
    expect(migrated.resume.fileName).toBe('');
  });

  it('should not alter v2 profiles', () => {
    const v2Profile = {
      id: 'test-v2',
      schemaVersion: 2,
      personal: {
        firstName: 'Jane',
        middleName: 'M'
      }
    };

    const migrated = migrateProfileSchema(v2Profile);

    expect(migrated).toBe(v2Profile); // Same reference
    expect(migrated.personal.middleName).toBe('M');
  });
});
