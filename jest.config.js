module.exports = {
  testEnvironment: 'jsdom',
  setupFiles: ['<rootDir>/tests/setup.js'],
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  clearMocks: true,
  moduleDirectories: ['node_modules', '<rootDir>'],
};
