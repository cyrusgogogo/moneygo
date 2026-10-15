/* Advisory selected-file verification history. No financial state is retained. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoneygoBackupSafety = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const NOTE_KEY = 'moneygo.backupVerification.note.v1';
  const NOTE_KIND = 'moneygo-backup-verification-note';
  const NOTE_LIMIT = 512;
  const DAY_MS = 86400000;
  const OLD_MS = 30 * DAY_MS;
  const MAX_BACKUP_VERSION = 65535;
  const NOTE_FIELDS = ['kind', 'version', 'completedAt', 'backupVersion', 'verifierRevision'];

  function validTime(value) {
    try {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
      const milliseconds = Date.parse(value);
      return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
    } catch (_) { return false; }
  }
  function validVersion(value) {
    return Number.isSafeInteger(value) && value > 0 && value <= MAX_BACKUP_VERSION;
  }
  function emptyNote(status) { return { status, completedAt: null, backupVersion: null }; }
  function decodeNote(text) {
    if (text === null) return emptyNote('missing');
    if (typeof text !== 'string' || text.length > NOTE_LIMIT) return emptyNote('invalid');
    try {
      const note = JSON.parse(text);
      if (!note || typeof note !== 'object' || Array.isArray(note) || Object.getPrototypeOf(note) !== Object.prototype ||
          Object.keys(note).length !== NOTE_FIELDS.length ||
          !NOTE_FIELDS.every(key => Object.prototype.hasOwnProperty.call(note, key)) ||
          note.kind !== NOTE_KIND || note.version !== 1 || note.verifierRevision !== 1 ||
          !validTime(note.completedAt) || !validVersion(note.backupVersion)) return emptyNote('invalid');
      return { status: 'recorded-only', completedAt: note.completedAt, backupVersion: note.backupVersion };
    } catch (_) { return emptyNote('invalid'); }
  }
  function ageOf(completedAt, currentTime) {
    const unknown = { status: 'unknown', elapsedDays: null };
    try {
      if (!validTime(completedAt) || !Number.isFinite(currentTime) || !Number.isFinite(new Date(currentTime).getTime())) return unknown;
      const elapsed = currentTime - Date.parse(completedAt);
      if (elapsed < 0) return { status: 'clock-anomaly', elapsedDays: null };
      return { status: elapsed >= OLD_MS ? 'old' : 'recent', elapsedDays: Math.floor(elapsed / DAY_MS) };
    } catch (_) { return unknown; }
  }
  function frozenDescriptor(value, currentTime) {
    return Object.freeze({ ...value, age: Object.freeze(ageOf(value.completedAt, currentTime)) });
  }
  function readOption(options, key, failedValue) {
    try { return options == null ? undefined : options[key]; } catch (_) { return failedValue; }
  }
  function acceptedEvent(input) {
    // The closed event language deliberately has no raw error or arbitrary text.
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
      const target = input.target, operation = input.operation, outcome = input.outcome;
      if (!['ledger', 'recovery-copy'].includes(target) || !['read', 'write'].includes(operation) || !['accepted', 'failed'].includes(outcome)) return null;
      const keys = ['target', 'operation', 'outcome'];
      const event = { target, operation, outcome };
      if (target === 'recovery-copy') {
        const phase = input.phase;
        if (!['staging', 'readback', 'compensation'].includes(phase) || (phase === 'readback' ? operation !== 'read' : operation !== 'write')) return null;
        keys.push('phase'); event.phase = phase;
      }
      if (outcome === 'failed') {
        const cause = input.cause;
        const allowed = operation === 'write' ? ['quota-reported', 'unavailable', 'write-failed'] : ['unavailable', 'read-failed'];
        if (target === 'recovery-copy' && event.phase === 'readback') allowed.push('copy-mismatch');
        if (!allowed.includes(cause)) return null;
        keys.push('cause'); event.cause = cause;
      }
      const actualKeys = Reflect.ownKeys(input);
      if (actualKeys.length !== keys.length || !keys.every(key => Object.prototype.hasOwnProperty.call(input, key))) return null;
      return Object.freeze(event);
    } catch (_) { return null; }
  }

  function create(options) {
    const verifyBackup = readOption(options, 'verifyBackup');
    const metadataStorage = readOption(options, 'metadataStorage');
    const suppliedClock = readOption(options, 'now', null);
    const now = suppliedClock === undefined ? () => Date.now() : suppliedClock;
    // Do not retain an options object that might carry unrelated application data.
    options = null;
    let sessionVerification = { status: 'absent', completedAt: null, backupVersion: null };
    let storedNote = emptyNote('missing');
    let notePersistence = 'not-attempted';
    let confirmedNote = null;
    let lastLedgerRead = null, lastLedgerWrite = null, ledgerWriteFailure = null;
    let lastRecoveryCopy = null, recoveryCopyFailure = null;

    function currentTime() {
      try { return typeof now === 'function' ? now() : NaN; } catch (_) { return NaN; }
    }
    function readNote() { return metadataStorage.getItem(NOTE_KEY); }
    function invalidateConfirmation() {
      confirmedNote = null;
      if (notePersistence === 'recorded') notePersistence = 'not-confirmed';
    }
    function refreshHistory() {
      try {
        const raw = readNote();
        storedNote = decodeNote(raw);
        if (confirmedNote !== null && raw !== confirmedNote) invalidateConfirmation();
      } catch (_) {
        storedNote = emptyNote('unreadable');
        invalidateConfirmation();
      }
      return frozenDescriptor(storedNote, currentTime());
    }
    function verifySelectedBackup(text) {
      // Deliberately outside diagnostics' catch: real verifier failures propagate.
      const verification = verifyBackup(text);
      let completedAt = null, backupVersion = null;
      try { const value = verification.verifiedAt; if (validTime(value)) completedAt = value; } catch (_) {}
      try { const value = verification.state.version; if (validVersion(value)) backupVersion = value; } catch (_) {}
      sessionVerification = { status: 'session-passed', completedAt, backupVersion };
      confirmedNote = null;
      if (completedAt === null) notePersistence = 'skipped-invalid-time';
      else if (backupVersion === null) notePersistence = 'skipped-invalid-version';
      else {
        try {
          const raw = JSON.stringify({ kind: NOTE_KIND, version: 1, completedAt, backupVersion, verifierRevision: 1 });
          metadataStorage.setItem(NOTE_KEY, raw);
          notePersistence = 'not-confirmed';
          try {
            const recorded = readNote();
            storedNote = decodeNote(recorded);
            if (recorded === raw) { confirmedNote = raw; notePersistence = 'recorded'; }
          } catch (_) { storedNote = emptyNote('unreadable'); }
        } catch (_) { notePersistence = 'failed'; }
      }
      return Object.freeze({ verification, notePersistence });
    }
    function releaseHistoryForWrite() {
      try {
        const raw = readNote();
        if (raw === null) {
          storedNote = emptyNote('missing'); invalidateConfirmation();
          return Object.freeze({ status: 'absent' });
        }
        if (typeof raw !== 'string') {
          storedNote = emptyNote('invalid'); invalidateConfirmation();
          return Object.freeze({ status: 'failed' });
        }
        // Invalidate before even acquiring removeItem: its getter may throw.
        invalidateConfirmation();
        notePersistence = 'not-confirmed';
        storedNote = emptyNote('unreadable');
        metadataStorage.removeItem(NOTE_KEY);
        const after = readNote();
        storedNote = decodeNote(after);
        if (after !== null) return Object.freeze({ status: 'failed' });
        notePersistence = 'released';
        return Object.freeze({ status: 'removed' });
      } catch (_) {
        storedNote = emptyNote('unreadable'); invalidateConfirmation();
        return Object.freeze({ status: 'failed' });
      }
    }
    function observeStorage(input) {
      const event = acceptedEvent(input);
      if (event === null) return;
      if (event.target === 'ledger') {
        if (event.operation === 'read') lastLedgerRead = event;
        else {
          lastLedgerWrite = event;
          ledgerWriteFailure = event.outcome === 'failed' ? event : null;
        }
      } else {
        lastRecoveryCopy = event;
        if (event.outcome === 'failed') recoveryCopyFailure = event;
        // A new successful staging begins a new copy attempt. Compensation does
        // not erase the readback/write failure that made compensation necessary.
        else if (event.phase === 'staging') recoveryCopyFailure = null;
      }
    }
    function view(context) {
      const requestedRead = readOption(context, 'ledgerRead');
      const ledgerRead = ['absent', 'present', 'failed', 'unknown'].includes(requestedRead) ? requestedRead : 'unknown';
      const clock = currentTime();
      return Object.freeze({
        scope: 'selected-file-only', currentLedgerCoverage: 'not-assessed', fileRetention: 'not-assessed', capacity: 'unknown',
        sessionVerification: frozenDescriptor(sessionVerification, clock), storedNote: frozenDescriptor(storedNote, clock), notePersistence,
        ledgerRead, blocked: readOption(context, 'blocked') === true, stale: readOption(context, 'stale') === true,
        lastLedgerRead, lastLedgerWrite, ledgerWriteFailure, lastRecoveryCopy, recoveryCopyFailure
      });
    }
    // Startup reads only the expendable key; invalid data is never repaired here.
    refreshHistory();
    return Object.freeze({ verifySelectedBackup, refreshHistory, releaseHistoryForWrite, observeStorage, view });
  }

  return Object.freeze({ NOTE_KEY, create });
}));
