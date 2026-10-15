# Bounded backup safety controller

`dist/backup-safety.js` exports a frozen CommonJS API or `MoneygoBackupSafety` in a browser. It has no runtime dependency, DOM, network, crypto, browser-storage global, or financial-write capability. This document describes a bounded portion of roadmap #112/#117; it is not real-browser acceptance or completion of those entire items.

## Construction

```js
const controller = MoneygoBackupSafety.create({
  verifyBackup: MoneygoLedger.verifyBackup.bind(MoneygoLedger),
  metadataStorage: acquiredStorage,
  now: Date.now // optional, used only to derive ages
});
```

Pass the real bound verifier, never the live ledger or captured storage bytes. The controller reads only `MoneygoBackupSafety.NOTE_KEY`, exactly `moneygo.backupVerification.note.v1`. Construction performs one best-effort note read and no writes. Methods are synchronous. All diagnostics are nonthrowing for unavailable/throwing/malformed adapters; the real verifier's own exception intentionally propagates. The host must separately contain module, observer and rendering faults so diagnostics never alter financial commit or restore compensation.

## Selected-file verification

`verifySelectedBackup(text)` calls the supplied real verifier exactly once and returns a frozen wrapper `{ verification, notePersistence }`. It neither modifies nor retains the verifier's returned state, counts, balances, or input text. The host owns selected-file size checks, modal/read tokens and clearing a previous file's success display before a new selection. Only call this method for the current explicit selected-file verification, never exports, startup, restore previews, restores or undo.

After a real return, private session provenance becomes `session-passed`. Only the valid canonical `verification.verifiedAt` and bounded positive `verification.state.version` are kept. Missing/invalid/throwing time access leaves a real session pass with unknown time and no note write. The injected `now` is never substituted for completion time. A failed verifier leaves earlier session/history facts unchanged and propagates its original exception.

Exact persisted schema, compact JSON, at most 512 characters:

```json
{"kind":"moneygo-backup-verification-note","version":1,"completedAt":"2026-10-14T12:00:00.000Z","backupVersion":6,"verifierRevision":1}
```

There must be exactly these five own fields. `completedAt` is exactly a 24-character UTC ISO string, parsed and round-tripped to reject impossible dates. `backupVersion` is an integer in `[1, 65535]`; it is informational, not a ledger loader. Note and verifier revisions must each equal `1`. Unknown keys, coercion, arrays, malformed/oversized strings and unknown revisions are rejected before use. No name, path, raw bytes, account fields, counts, amounts, balances, hashes or errors enter this schema.

After successful note `setItem`, one read of only this note key confirms exact matching bytes. Write/readback/mismatch failures never reverse the real verifier result. No compensation write follows a failed note operation. A failed write leaves the prior cached history intact. A mismatching readable note is decoded as the latest advisory stored history.

`notePersistence` is one of:

- `not-attempted`: this instance has not attempted to record a selected-file pass
- `recorded`: this instance's last note write had an exact readback; no future retention guarantee
- `not-confirmed`: write readback differed/failed or a prior confirmation was invalidated
- `failed`: note serialization/write failed
- `skipped-invalid-time` or `skipped-invalid-version`: real pass without persistable diagnostic fields
- `released`: the optional key was removed and absence read back

An externally refreshed note never promotes this field to `recorded` or creates live provenance. Matching timestamps never promote stored history to live verification.

## Advisory history and release

`refreshHistory()` reads only the fixed key and returns a frozen stored-note descriptor. Stored history status is `missing`, `invalid`, `unreadable` or `recorded-only`. Even a well-formed forged note remains unauthenticated `recorded-only`. Startup/refresh never repair, clear or rewrite history. Refresh invalidates a prior local persistence confirmation if bytes changed or reading failed.

`releaseHistoryForWrite()` returns frozen `{status: 'removed' | 'absent' | 'failed'}`. It does not decide whether a host write is retryable.

1. Read only the note key. Exact `null` means `absent`; do not remove or retry.
2. Any present string, including empty/malformed history, is expendable. Invalidate the cached persistence claim before accessing/calling `removeItem`.
3. Remove the key once, then read only that key once. Return `removed` only for exact `null` readback. Missing/throwing methods, silent removal or recreation yield `failed`.

A live session pass survives note release. The host may call this method only after an eligible quota-reported actual forward write failed. It must share one consumed-before-release retry budget across restore staging and ledger save, recheck its unchanged raw/stale guard before retry, never retry compensation, never perform a post-success ledger read and never reinsert the note on a financial path. The host owns that policy and its tests.

## Closed storage observations

`observeStorage(event)` does no I/O and retains a copied frozen event. Unknown keys (including symbols), missing fields, throwing getters or incoherent values are ignored. Exact accepted shape:

```js
{target: 'ledger', operation: 'write', outcome: 'accepted'}
{target: 'ledger', operation: 'write', outcome: 'failed', cause: 'quota-reported'}
{target: 'recovery-copy', operation: 'read', outcome: 'failed', phase: 'readback', cause: 'copy-mismatch'}
```

- Target: `ledger` or `recovery-copy`
- Operation: `read` or `write`; outcome: `accepted` or `failed`
- Only failures have `cause`. Read failures allow `unavailable`/`read-failed`. Write failures allow `quota-reported`/`unavailable`/`write-failed`.
- Only recovery-copy events have `phase`: `staging`/`compensation` require `write`; `readback` requires `read`. Recovery readback also permits `copy-mismatch`.
- No raw exceptions, strings outside these enums or financial data are accepted. Validation errors are not storage events.

Only accepted ledger writes clear `ledgerWriteFailure`. File verification, reads, note I/O, exports, staging and compensation cannot clear it. `recoveryCopyFailure` keeps the most recent failure; successful new staging starts a new copy attempt and clears the previous failure. Successful compensation does not erase the failure that caused it.

## Pure view

`view({ledgerRead, blocked, stale})` performs no storage or browser I/O. It returns a frozen snapshot; nested descriptors/events are frozen. Unrecognized/malformed context becomes `ledgerRead: 'unknown'` and false flags. `ledgerRead` accepts `absent`, `present`, `failed`, `unknown`; the host supplies the actual current read/blocked/stale facts, with blocking and stale messages taking precedence.

```js
{
  scope: 'selected-file-only',
  currentLedgerCoverage: 'not-assessed', fileRetention: 'not-assessed', capacity: 'unknown',
  sessionVerification: {status: 'absent' /* or 'session-passed' */, completedAt: null, backupVersion: null, age: {status: 'unknown', elapsedDays: null}},
  storedNote: {status: 'missing' /* or invalid/unreadable/recorded-only */, completedAt: null, backupVersion: null, age: {status: 'unknown', elapsedDays: null}},
  notePersistence: 'not-attempted',
  ledgerRead: 'unknown', blocked: false, stale: false,
  lastLedgerRead: null, lastLedgerWrite: null, ledgerWriteFailure: null,
  lastRecoveryCopy: null, recoveryCopyFailure: null
}
```

Both age descriptors have status `unknown`, `clock-anomaly`, `recent`, or `old`. Missing/throwing/non-numeric/non-finite/out-of-Date-range clocks mean unknown. A future completion time means clock anomaly, not zero age. `old` begins at exactly 30 elapsed 24-hour days; `elapsedDays` is the floor of nonnegative elapsed days, otherwise `null`. This is a product reminder heuristic, never a coverage/expiration guarantee. One age-clock sample is used for each view.

Display the two provenance sources separately. A successful file verification does not prove saved-file durability, later file existence, current-ledger identity/coverage, source completeness or economic truth. Stored history is unauthenticated advisory metadata. Capacity and future retention remain unknown. Native chooser, real quota/denial behavior, browser layout/keyboard/screen-reader behavior and downloads remain separate unrun browser gates until explicitly exercised.

## Separate ordinary-save preflight (v0.23 implementation in progress)

The implemented host-only `MoneygoSavePreflight.prepare` uses actual `Ledger.backup` and `Ledger.parseBackup`; it is not part of this selected-file controller and must never call `verifySelectedBackup`, write verification metadata, or report a format-capacity refusal as a browser-write observation. Existing diagnostic state and note-release rules are retained. The private restore/undo paths keep their accepted legacy semantics. The fixed-source aggregate passed all 6,164 executions with no failures, skips or cancellations, retaining all 5,774 inherited executions and their name multiplicities. Eight real-capacity/recovery cases also passed. Native-browser acceptance and publication remain pending. Measured near-cap synchronous edits/resets take 7–12 seconds and the serial Node process reached ~1.35 GiB high-water RSS. These are unresolved browser responsiveness/mobile memory limitations, not a general performance pass. See [SAVE_PREFLIGHT_API.md](SAVE_PREFLIGHT_API.md).
