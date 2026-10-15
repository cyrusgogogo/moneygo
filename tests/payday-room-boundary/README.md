# Payday-room model boundary evidence

These are synthetic-only local Node tests of the partial, readonly, session-only #43 layer. They do not establish native-browser behavior, user-data behavior, publication, or full #43 completion.

## Authority and scope

Implementation gate: design manifest SHA-256 `740653e368331e80719c2afd2857d6227ce35837bb006f3d21961f4820d4e774`. The suite changes no financial module, old test, backup version, storage key, or authored sample. Model tests use the genuine coordinator and genuine private source/basis authority.

`../payday-room-boundary.test.cjs` maps each test name to B01–B20. Its cases cover exact owned identities and opaque tickets; one-use attempts; raw/source versus room-only retirement; daily ancestor invalidation; date/clock failures; Gregorian years; complete closed floors and explicit consent; hostile descriptors and thrown proxies; exact snapshots; full output bytes; counts; safe arithmetic; complete references; financial read-only invariants; immutable serialization; and missing-account aggregate disclosure without any room aggregate.

Every ordinary source fixture installs a before/after raw ledger, normalized backup, and original-source guard. The direct financial-view tripwire forbids even indirect `Relations.calculate` reads during every room operation. Snapshot tests permit only private basis freshness and assert zero ledger revalidation or dependent financial views.

## Commands

- `node --test tests/payday-room-boundary.test.cjs`
- To collect fresh observations: set `MONEYGO_PAYDAY_BOUNDARY_EVIDENCE_DIR` to a writable evidence directory and run that same command.
- `node tests/payday-room-boundary/verify-resources.cjs` validates the packaged observations against the exact current model/runner bytes and original public-writer fixture provenance.
- `node tests/payday-room-boundary/public-fixtures.cjs` reconstructs both large synthetic input fixtures through real public writer commands, then verifies complete validation and backup roundtrips. This is not required on every test run because the loader checks their original constructor and writer pins.

## Boundary interpretation

The two real 8 MiB tests use one included cash account, 1,900 public-importer completed one-cent records, and 100 explicitly reviewed residual events. Bounded event text occurs twice in the retained daily source; the daily confirmation reason contributes once, permitting exact-byte parity. Escaped text, supplementary Unicode, and multibyte UTF-8 remain in the complete source. The full room preview and confirmed result independently reach exactly 8,388,608 bytes; the corresponding one-byte-over path rejects atomically. Confirmation bytes and the preview ticket wrapper are included. These are ordinary public API observations, with no changed production limits or counterfeit report authority.

The compact successful count fixture jointly exercises 100 accounts/floors, 1,000 residual events, a 93-day daily source, and the 92-day pre-checkpoint window. It has 2,000 partition-reference occurrences. A separate valid 10,000-transfer fixture has exactly 20,000 canonical cash legs. Its complete inherited ancestor report exceeds its output budget and refuses before room authority is created. It is maximum-count refusal evidence, not a claim that all maximum cardinalities or 42,000 partition memberships can fit in one successful 8 MiB result.

The negative-safe-anchor fixture contains 9,008 unchanged public-writer historical departures after a genuine zero-cent snapshot, totaling exactly `Number.MIN_SAFE_INTEGER` in the supported anchor. A zero floor remains exact. A one-cent floor rejects with `PROJECTION_AMOUNT_OVERFLOW`, both with and without an inherited unknown incoming blocker. Unknown presentation cannot hide checked arithmetic failure.

Exact 32 MiB raw and 8 MiB room-query preflight tests intentionally carry a closed-schema-invalid padding field. They distinguish preflight acceptance followed by source/schema rejection from one-byte-over budget rejection. They do not claim successful schema-valid raw/query capacity at those sizes. A valid closed 100-floor query cannot reach 8 MiB: 100 bounded IDs plus at most 500 escaped code units per purpose provide a much smaller structural ceiling. Reduced-cap wrapper tests and inherited pure-arithmetic seams are supplementary unit checks and are labelled separately from the five genuine measured resources.

## Large fixture provenance

`public-fixtures.cjs` constructs the accounts, roles, and snapshots with existing public writers. Each independent transaction is obtained unchanged from `Ledger.putTransaction` against that same base. The unchanged raw transaction rows are assembled; the complete state is validated and backup-roundtripped. No audit, snapshot basis, allocation, or derived financial proof is fabricated. A temporary deterministic random-ID provider gives short distinct synthetic IDs and is restored in `finally`. The JSON and original provenance files pin the generator and all relevant unchanged writer bytes. Resource observations pin the exact tested daily model bytes and record actual Node timing and process peak RSS, without reusing historical timing claims. `processPeakRssBytes` is the cumulative high-water mark of the complete Node test process, including earlier cases; it is not an isolated per-fixture peak. Elapsed times are shared-host observations and imply no browser or general performance guarantee. The separate `verify-maximum-refusal.cjs` probe corroborates the inherited failure with genuine `CashBasisError/CASH_RESULT_LIMIT` on the same complete fixture/query.
