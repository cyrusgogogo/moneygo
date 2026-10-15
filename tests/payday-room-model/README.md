# Anchored-funds room model tests

`node --test tests/payday-room-model.test.cjs` exercises the thirty E01–E30 economic requirements using genuine public financial writers, immutable source reports, literal independent cent expectations, full proof references, raw ledger and normalized-backup preservation, and unchanged previous financial outputs.

`node --test tests/payday-room-boundary.test.cjs` is the separate authority, hostile-input, exact-byte, cardinality and resource suite.

The inherited DailyCash resource runner and verifier remain unchanged. `node tests/daily-cash-model/boundary-resource-verify.cjs` verifies the fresh portable observations in its original location. `source-continuity.json` records unchanged financial-module pins. `original-fixture-provenance.json` records the original synthetic public-writer cache provenance and current complete validation/backup roundtrip without treating historical setup timing as a new measurement.

To reproduce fresh original resource observations with newly constructed public fixtures:

`node --expose-gc tests/payday-room-model/refresh-daily-resources.cjs OUTPUT_DIRECTORY`

An optional second directory argument may reuse original synthetic caches only after the wrapper checks their original runner provenance, unchanged writer pins, complete current ledger validation and backup roundtrip. The wrapper measures every original runner phase afresh and refuses a source hash change during the run. A retained source cache includes original fixture JSON files and its original resource summary. Raw caches are not packaged as feature data.

This is a session-only partial #43 calculation. It omits all future incoming cash, never pools accounts, retains unknowns and complete source scope, and adds no persistent financial model. Node evidence does not establish native-browser layout, accessibility, real-storage/file-dialog or network behavior. Publication remains paused; complete release acceptance belongs to the independently pinned full regression.
