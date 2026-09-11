/**
 * OriginFill — Debug Logger
 * Provides structured logging with [OriginFill] prefix.
 * Only outputs when ORIGINFILL_DEV_MODE is true.
 *
 * @license AGPL-3.0
 * @author CharyWorld
 */

const OriginFillLogger = (() => {
  'use strict';

  const PREFIX = '%c[OriginFill]';
  const STYLES = {
    debug: 'color: #6B7280; font-weight: bold;',
    info:  'color: #2563EB; font-weight: bold;',
    warn:  'color: #D97706; font-weight: bold;',
    error: 'color: #DC2626; font-weight: bold;',
    success: 'color: #16A34A; font-weight: bold;',
    fill:  'color: #7C3AED; font-weight: bold;'
  };

  /**
   * Check if logging is enabled.
   * Uses typeof check so it works even if constants.js hasn't loaded yet.
   */
  function isEnabled() {
    return typeof ORIGINFILL_DEV_MODE !== 'undefined' && ORIGINFILL_DEV_MODE === true;
  }

  /**
   * Core log function.
   * @param {'debug'|'info'|'warn'|'error'|'success'|'fill'} level
   * @param {string} message
   * @param  {...any} args
   */
  function log(level, message, ...args) {
    if (!isEnabled()) return;

    const style = STYLES[level] || STYLES.info;
    const consoleFn = level === 'error' ? console.error
                    : level === 'warn' ? console.warn
                    : level === 'debug' ? console.debug
                    : console.log;

    if (args.length > 0) {
      consoleFn(PREFIX, style, message, ...args);
    } else {
      consoleFn(PREFIX, style, message);
    }
  }

  /**
   * Start a collapsed console group for related log entries.
   * @param {string} label - Group label
   */
  function group(label) {
    if (!isEnabled()) return;
    console.groupCollapsed(`${PREFIX.replace('%c', '')} ${label}`);
  }

  /**
   * End a console group.
   */
  function groupEnd() {
    if (!isEnabled()) return;
    console.groupEnd();
  }

  /**
   * Log a fill operation result table.
   * @param {Array<{field: string, status: string, value: string, note?: string}>} results
   */
  function fillReport(results) {
    if (!isEnabled()) return;

    group('Fill Report');
    console.table(results.map(r => ({
      Field: r.field,
      Status: r.status,
      Value: r.value ? (r.value.length > 40 ? r.value.slice(0, 40) + '…' : r.value) : '—',
      Note: r.note || ''
    })));

    const success = results.filter(r => r.status === 'success').length;
    const attention = results.filter(r => r.status === 'attention').length;
    const failed = results.filter(r => r.status === 'failed').length;

    log('info', `Summary: ✅ ${success}  ⚠️ ${attention}  ❌ ${failed}`);
    groupEnd();
  }

  /**
   * Log with timing — start a timer.
   * @param {string} label
   */
  function time(label) {
    if (!isEnabled()) return;
    console.time(`[OriginFill] ${label}`);
  }

  /**
   * Log with timing — end a timer.
   * @param {string} label
   */
  function timeEnd(label) {
    if (!isEnabled()) return;
    console.timeEnd(`[OriginFill] ${label}`);
  }

  // ─── Public API ─────────────────────────────────────────────────
  return Object.freeze({
    debug:      (msg, ...args) => log('debug', msg, ...args),
    info:       (msg, ...args) => log('info', msg, ...args),
    warn:       (msg, ...args) => log('warn', msg, ...args),
    error:      (msg, ...args) => log('error', msg, ...args),
    success:    (msg, ...args) => log('success', msg, ...args),
    fill:       (msg, ...args) => log('fill', msg, ...args),
    group,
    groupEnd,
    fillReport,
    time,
    timeEnd
  });
})();
