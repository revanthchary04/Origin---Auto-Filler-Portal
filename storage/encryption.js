/**
 * OriginFill — AES-256-GCM Encryption Module
 * Uses Web Crypto API for all cryptographic operations.
 * Default: auto-generated key stored in chrome.storage.session.
 * Optional: user-defined passphrase via PBKDF2 key derivation.
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

const OriginFillEncryption = (() => {
  'use strict';

  /** @type {CryptoKey|null} Cached encryption key for this session */
  let _cachedKey = null;

  // ─── Utility: Convert between ArrayBuffer and Base64 ──────────

  /**
   * ArrayBuffer → Base64 string
   * @param {ArrayBuffer} buffer
   * @returns {string}
   */
  function bufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Base64 string → ArrayBuffer
   * @param {string} base64
   * @returns {ArrayBuffer}
   */
  function base64ToBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Generate cryptographically random bytes.
   * @param {number} length - Number of bytes
   * @returns {Uint8Array}
   */
  function getRandomBytes(length) {
    return crypto.getRandomValues(new Uint8Array(length));
  }

  // ─── Key Management ────────────────────────────────────────────

  /**
   * Generate a new random AES-256-GCM key.
   * @returns {Promise<CryptoKey>}
   */
  async function generateKey() {
    return crypto.subtle.generateKey(
      { name: OriginFillCrypto.ALGORITHM, length: OriginFillCrypto.KEY_LENGTH },
      true,  // extractable — needed to store in chrome.storage.session
      OriginFillCrypto.KEY_USAGE
    );
  }

  /**
   * Derive an AES-256-GCM key from a user passphrase using PBKDF2.
   * @param {string} passphrase - User-provided passphrase
   * @param {Uint8Array} salt - 16-byte salt
   * @returns {Promise<CryptoKey>}
   */
  async function deriveKeyFromPassphrase(passphrase, salt) {
    // Import passphrase as raw key material
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(passphrase),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    // Derive AES key via PBKDF2
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: OriginFillCrypto.PBKDF2_ITERATIONS,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: OriginFillCrypto.ALGORITHM, length: OriginFillCrypto.KEY_LENGTH },
      false, // not extractable — passphrase can re-derive it
      OriginFillCrypto.KEY_USAGE
    );
  }

  /**
   * Export a CryptoKey to JWK format for storage.
   * @param {CryptoKey} key
   * @returns {Promise<JsonWebKey>}
   */
  async function exportKey(key) {
    return crypto.subtle.exportKey('jwk', key);
  }

  /**
   * Import a CryptoKey from JWK format.
   * @param {JsonWebKey} jwk
   * @returns {Promise<CryptoKey>}
   */
  async function importKey(jwk) {
    return crypto.subtle.importKey(
      'jwk',
      jwk,
      { name: OriginFillCrypto.ALGORITHM, length: OriginFillCrypto.KEY_LENGTH },
      true,
      OriginFillCrypto.KEY_USAGE
    );
  }

  /**
   * Initialize the encryption key for this session.
   * Strategy:
   *   1. Check in-memory cache
   *   2. Check chrome.storage.session (persists across popup opens, cleared on browser close)
   *   3. Check chrome.storage.local for exported key (auto-generated mode)
   *   4. Generate new key if none found (first install)
   *
   * @param {string} [passphrase] - Optional user passphrase (advanced mode)
   * @returns {Promise<CryptoKey>}
   */
  async function initializeKey(passphrase) {
    // 1. Return cached key if available
    if (_cachedKey) {
      return _cachedKey;
    }

    try {
      // 2. Check chrome.storage.session for session-cached key
      const sessionData = await chrome.storage.session.get(OriginFillStorageKeys.ENCRYPTION_KEY);
      if (sessionData[OriginFillStorageKeys.ENCRYPTION_KEY]) {
        const jwk = sessionData[OriginFillStorageKeys.ENCRYPTION_KEY];
        _cachedKey = await importKey(jwk);
        OriginFillLogger.info('Encryption key loaded from session storage');
        return _cachedKey;
      }
    } catch (e) {
      // chrome.storage.session might not be available in all contexts
      OriginFillLogger.debug('Session storage not available, trying local storage');
    }

    // 3. If passphrase mode, derive from passphrase
    if (passphrase) {
      const localData = await chrome.storage.local.get('originfill_enc_salt');
      let salt;

      if (localData.originfill_enc_salt) {
        salt = new Uint8Array(base64ToBuffer(localData.originfill_enc_salt));
      } else {
        // Generate and store new salt
        salt = getRandomBytes(OriginFillCrypto.SALT_LENGTH);
        await chrome.storage.local.set({
          originfill_enc_salt: bufferToBase64(salt.buffer)
        });
      }

      _cachedKey = await deriveKeyFromPassphrase(passphrase, salt);
      OriginFillLogger.info('Encryption key derived from passphrase');
      // Don't store derived keys — passphrase re-derives them
      return _cachedKey;
    }

    // 4. Check chrome.storage.local for auto-generated key
    const localData = await chrome.storage.local.get(OriginFillStorageKeys.ENCRYPTION_KEY);
    if (localData[OriginFillStorageKeys.ENCRYPTION_KEY]) {
      const jwk = localData[OriginFillStorageKeys.ENCRYPTION_KEY];
      _cachedKey = await importKey(jwk);

      // Cache in session storage for faster access
      try {
        await chrome.storage.session.set({
          [OriginFillStorageKeys.ENCRYPTION_KEY]: jwk
        });
      } catch (e) {
        // Session storage not available in all contexts
      }

      OriginFillLogger.info('Encryption key loaded from local storage');
      return _cachedKey;
    }

    // 5. First install — generate new key
    _cachedKey = await generateKey();
    const jwk = await exportKey(_cachedKey);

    // Store in both local (persistent) and session (fast access)
    await chrome.storage.local.set({
      [OriginFillStorageKeys.ENCRYPTION_KEY]: jwk
    });

    try {
      await chrome.storage.session.set({
        [OriginFillStorageKeys.ENCRYPTION_KEY]: jwk
      });
    } catch (e) {
      // Session storage not available in all contexts
    }

    OriginFillLogger.success('New encryption key generated and stored');
    return _cachedKey;
  }

  // ─── Encrypt / Decrypt ─────────────────────────────────────────

  /**
   * Encrypt a plaintext string using AES-256-GCM.
   * @param {string} plaintext - Data to encrypt
   * @returns {Promise<string>} Base64-encoded JSON string: { iv, ciphertext }
   */
  async function encrypt(plaintext) {
    const key = await initializeKey();
    const iv = getRandomBytes(OriginFillCrypto.IV_LENGTH);
    const encoded = new TextEncoder().encode(plaintext);

    const cipherBuffer = await crypto.subtle.encrypt(
      { name: OriginFillCrypto.ALGORITHM, iv },
      key,
      encoded
    );

    const result = {
      iv: bufferToBase64(iv.buffer),
      ct: bufferToBase64(cipherBuffer)
    };

    return btoa(JSON.stringify(result));
  }

  /**
   * Decrypt AES-256-GCM encrypted data.
   * @param {string} encryptedBase64 - Base64-encoded JSON string from encrypt()
   * @returns {Promise<string>} Decrypted plaintext
   */
  async function decrypt(encryptedBase64) {
    const key = await initializeKey();

    const { iv, ct } = JSON.parse(atob(encryptedBase64));
    const ivBuffer = new Uint8Array(base64ToBuffer(iv));
    const ctBuffer = base64ToBuffer(ct);

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: OriginFillCrypto.ALGORITHM, iv: ivBuffer },
      key,
      ctBuffer
    );

    return new TextDecoder().decode(decryptedBuffer);
  }

  /**
   * Encrypt a JavaScript object (serializes to JSON first).
   * @param {Object} data
   * @returns {Promise<string>} Encrypted base64 string
   */
  async function encryptObject(data) {
    return encrypt(JSON.stringify(data));
  }

  /**
   * Decrypt to a JavaScript object.
   * @param {string} encryptedBase64
   * @returns {Promise<Object>} Decrypted object
   */
  async function decryptObject(encryptedBase64) {
    const json = await decrypt(encryptedBase64);
    return JSON.parse(json);
  }

  // ─── Key Rotation ──────────────────────────────────────────────

  /**
   * Rotate the encryption key. Re-encrypts all stored data with a new key.
   * @param {Function} getAllData - Async function that returns all decrypted data
   * @param {Function} saveAllData - Async function that saves re-encrypted data
   * @returns {Promise<void>}
   */
  async function rotateKey(getAllData, saveAllData) {
    OriginFillLogger.info('Starting key rotation...');

    // 1. Decrypt all data with current key
    const allData = await getAllData();

    // 2. Generate new key
    _cachedKey = await generateKey();
    const jwk = await exportKey(_cachedKey);

    // 3. Store new key
    await chrome.storage.local.set({
      [OriginFillStorageKeys.ENCRYPTION_KEY]: jwk
    });

    try {
      await chrome.storage.session.set({
        [OriginFillStorageKeys.ENCRYPTION_KEY]: jwk
      });
    } catch (e) { /* session storage not available */ }

    // 4. Re-encrypt and save all data with new key
    await saveAllData(allData);

    OriginFillLogger.success('Key rotation complete');
  }

  /**
   * Clear the cached key (for logout / lock scenarios).
   */
  function clearCachedKey() {
    _cachedKey = null;
  }

  /**
   * Check if encryption is initialized and ready.
   * @returns {boolean}
   */
  function isReady() {
    return _cachedKey !== null;
  }

  // ─── Public API ─────────────────────────────────────────────────
  return Object.freeze({
    initializeKey,
    encrypt,
    decrypt,
    encryptObject,
    decryptObject,
    rotateKey,
    clearCachedKey,
    isReady,
    // Exposed for testing
    _test: {
      bufferToBase64,
      base64ToBuffer,
      generateKey,
      exportKey,
      importKey,
      deriveKeyFromPassphrase
    }
  });
})();
