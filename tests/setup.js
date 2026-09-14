const fs = require('fs');
const path = require('path');

// Mock Chrome API
global.chrome = {
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn()
    }
  },
  storage: {
    local: {
      get: jest.fn().mockResolvedValue({}),
      set: jest.fn().mockResolvedValue({}),
      remove: jest.fn().mockResolvedValue({})
    }
  }
};

// Add standard DOM globals needed by tests
global.NodeFilter = {
  SHOW_ELEMENT: 1,
  SHOW_TEXT: 4,
};

global.DataTransfer = class DataTransfer {
  constructor() {
    this.items = {
      add: jest.fn()
    };
    this.files = [];
  }
};

// Mock CSS.escape (not implemented in JSDOM)
global.CSS = {
  escape: jest.fn(str => str)
};

// Mock OriginFillDetector
global.OriginFillDetector = {
  getInputLabel: jest.fn((el) => {
    // Basic mock implementation for testing
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) return label.textContent;
    }
    return '';
  }),
  isVisible: jest.fn(() => true)
};

// Helper to load extension scripts into global scope for testing
global.loadExtensionScript = function(filePath) {
  const fs = require('fs');
  let code = fs.readFileSync(filePath, 'utf8');
  // Convert const OriginFillXXX = ... to global.OriginFillXXX = ...
  code = code.replace(/(?:const|let|var)\s+(OriginFill[a-zA-Z0-9_]+)\s*=/g, 'global.$1 =');
  eval(code);
};
