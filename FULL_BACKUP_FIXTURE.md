# Independent all-extension backup fixture for #112

## Result and scope

This is a synthetic test-only deliverable for `Ledger.verifyBackup`. It changes no application source. It does not implement, mock, or claim coverage of the future backup-safety controller, browser file picker, download durability, localStorage replacement, restore undo, or concurrent-tab protection.

The working baseline is frozen moneygo v0.11.0 (857 existing tests). The fixture is built with the real public Ledger, Importer, Relations, Organizer, Obligations, and Scenario APIs. Accounts and transactions are created with Ledger mutators. Import evidence, batches, quarantine, coverage, and audit are produced by actual CSV preview/commit/update/rollback. Relationship and organizer previews are genuine one-use tickets. Obligation writes use explicit current-revision confirmation. No active state, journal, signature, balance basis, or frozen month is hand-forged. Scenario has no settings mutator; the fixture passes authored assumptions through `Scenario.validate` and `Ledger.validateState`.

Every current extension collection is populated. Separate compatible transaction sources prevent forbidden overlap between composites, duplicates, transfers, installment purchases, and fee evidence. Neither a synthetic stub method nor an implementation fallback is used. All module imports resolve directly to `../dist`.

## Files

- `tests/full-backup-fixture.cjs`: reusable public-API builder, returning `{ state, ids, sourceCsv, updatedCsv }`; also exports the real modules and a clone helper.
- `tests/full-backup-verification.test.cjs`: 86 focused tests, including 66 active/historical corruption cases, static-fixture verification, exact financial expectations, deep detachment, and genuine legacy migration checks.
- `tests/fixtures/all-extensions-v6.json`: actual `Ledger.backup` output from the synthetic builder. Outer v6; scenario v1, import v2, bookkeeping v3, organizer v3, obligations v1.
- `tests/fixtures/all-extensions-v6.ids.json`: matching readable semantic-name-to-ID map for the stored backup.
- `tests/generate-full-backup-fixture.cjs`: optional explicit regeneration of ONLY the new v6 fixture; it verifies the generated backup before writing. IDs/timestamps may change. It never downgrades version fields or rewrites historical fixtures.
- `tests/fixtures/all-extensions-v6.source-sha256.json`: SHA-256 hashes of the unchanged six application modules, backup specification, and five genuine historical fixture files used. Copied input bytes were compared to the frozen baseline.

The original fixture-only run passed 86 focused tests and all 943 aggregate tests (857 previous tests plus these 86). Current integrated release counts are documented in `IMPLEMENTATION_STATUS.md`; reproduce the checks with the commands below.

No personal financial data, real account exports, network access, browser automation, user-computer work, or publication was used.

## Exact fixture coverage

| Section | Nonempty collections |
| --- | --- |
| Core | 6 accounts, 10 categories, 19 active transactions, 1 trash record |
| Sandbox | 1 declared complete month, 1 excluded trash ID, 1 scenario, 1 percent adjustment, 1 future one-off |
| Imports | 3 templates, 1 current evidence, 3 batches including 1 rolled back, 2 quarantine rows, 2 confirmed coverage entries, 5 audit events |
| Bookkeeping | 1 duplicate link, 1 transfer pair, 1 composite, 1 refund, 1 claim, 1 settlement, 1 refund plan, 2 day-end snapshots, 12 audit events |
| Organizer | 1 rule, 1 alias, 1 merchant label, 3 batches including 1 rolled back, 1 scope, 1 deferred review, 2 frozen months, 10 audit events |
| Obligations | 5 profiles covering cash/credit/restricted/other with one account left unknown, 2 statements (official + null estimate), 1 full three-installment contract, 2 repayments (native + paired), 1 inclusion, 1 fee, 16 audit events |

There are 43 audit events across the four journal-bearing extensions. Historical entries include an import rollback, a removed refund allocation, an organizer batch rollback, a reversed statement correction, and a removed fee index. Every audit array is compared exactly after round-trip.

The source CSV has an actually parsed multiline preamble. Current import evidence records physical `sourceLine: 6`, with real historical before/after lines `5 -> 6`; the quarantined physical rows are 6 and 7. The rolled-back import history retains line 2. Unmapped preamble/text never enters the backup.

The 10,000-cent composite has 3,000/7,000-cent personal sources dated September 30/October 1 and a separate 10,000-cent bank funding source dated October 3. Gross 12,000 and discount 2,000 remain metadata. Both day-end snapshots carry full composite proofs. Both full-month closes carry complete cross-month proofs, and rows reference only the members whose original dates fall within that month. The October close also preserves the imported evidence reference, merchant/category result, and explicit incomplete-scope information.

## Independently calculated expected cents

| Period | External income | External expense | Personal income | Personal expense | Transfer principal |
| --- | ---: | ---: | ---: | ---: | ---: |
| All dates | 54,200 | 55,085 | 50,700 | 50,585 | 22,000 |
| September | 0 | 36,000 | 0 | 37,500 | 0 |
| October | 50,700 | 19,085 | 50,700 | 13,085 | 22,000 |
| November | 3,500 | 0 | 0 | 0 | 0 |

These are literal expectations, not values generated from the implementation under test. External expense is 30,000 installment purchase + 6,000 refundable purchase + 10,000 composite funding + 2,000 duplicate primary + 5,000 shared purchase + 51 fee + 1,334 CSV purchase + 500 restricted-account expense + 200 other-account expense. Personal expense subtracts the actual 1,500 refund and 3,000 third-party share. Income consists of 50,000 salary, 700 unknown-account income, 1,500 refund receipt, and 2,000 claim receipt; the last two are excluded from ordinary personal income.

Final account balances: cash 8,666; bank 208,449; credit -28,000; restricted 4,500; unknown 3,700; other -2,200. Their total is 195,115, equal to opening balances 196,000 plus external net -885.

At October 31 the paired outgoing leg has moved, but its November 1 incoming leg has not arrived. Known cash is 213,615 and credit debt is 38,000; repayments received are 12,000, with 10,000 still future-dated. November 1 gives known cash 215,115 and credit debt 28,000; recorded repayment allocations are 22,000 against a 25,000 statement. November 2 known cash is 217,115. The suite checks 13 date cutoffs, including purchase, funding, import, native-transfer, month-end, and receipt boundaries.

Unknown roles keep liquid-balance completeness unknown. Credit limit is informational, never cash. Statement/contract overlap leaves combined forecast and combined known minimum null. Deferred quarantine remains unresolved, and coverage does not falsely establish complete books.

## Corruption checks and limits

The selected backup is cloned and mutated before `Ledger.verifyBackup`; each corruption is rejected with a validator error while the separately held live fixture remains byte-for-byte unchanged. The original good backup is verified again after each rejection.

The 66 cases cover outer/version failures; core/trash amounts and references; scenario assumptions; active and historical import line fields, rollback history, coverage and audit; active and removed relationship allocations; transfer signatures; composite membership/arithmetic; day-end proofs and omitted funding sources; organizer rule/alias/merchant/scope/review/batch/audit; frozen-month totals, proof arithmetic, and complete membership; every obligation collection, repayment arrival proof, reversal target, and removed-fee history. Selected snapshot/month corruptions change both the stored record and its audit copy to test deeper proof validation, not merely after-image disagreement.

This is structural and internal-consistency validation, not cryptographic authenticity. A control case deliberately changes a structurally valid unrelated note and confirms it is accepted. The suite does not claim that arbitrary coordinated alterations are detectable, audit history is tamper-proof, economic meaning is correct, or source statements are complete.

## Historical compatibility

Historical files are copied unchanged and individually hashed:

- `legacy-outer-v1-v5.json`: five genuinely emitted synthetic outer v1–v5 backups from the frozen v0.7 modules.
- `legacy-relations-v4.json` / `legacy-relations-v5.json`: genuine prior bookkeeping/organizer-inner-v1 backups; old rows, audits and closes are retained exactly while absent transfer/composite history is not invented.
- `organizer-v1-close.json`: genuine old raw state; read migration preserves frozen closes and audit before a current backup is exported and independently verified.
- `imports-v1-frozen-v08.json`: genuine old raw state; migration preserves templates/evidence/batches/audit and leaves historically unknown physical lines absent.

No prior frozen outer-v6 fixture was present in the baseline fixture inventory. The new real v6 all-extension artifact covers the current format; it is explicitly not described as a historical v6 fixture. No old format was manufactured by lowering a current version field. Negative downgrade cases only test rejection.

## Run and reuse

From the repository root, with the six real modules in `dist` and the fixture files under `tests`:

```sh
node --test tests/full-backup-verification.test.cjs
npm run check
npm test
```

The focused suite contains no skipped tests, no absolute workspace paths, and no fallback module loading. It never automatically regenerates or overwrites fixture files. To deliberately refresh only the NEW v6 artifact:

```sh
node tests/generate-full-backup-fixture.cjs
node --test tests/full-backup-verification.test.cjs
```

For the backup-safety implementation reviewer, use the saved `all-extensions-v6.json` as actual selected-file contents, or call `buildFullBackupFixture()` and serialize its state with `Ledger.backup`. Use the ID map to locate real nested proofs, active entries, removed-history records, and date-boundary transactions. Feed that text through the actual controller/file-selection flow once it exists. Record current-ledger bytes and restore-undo bytes beforehand; on both successful independent verification and rejected selection, assert both remain unchanged. Exercise another selection while a previous read is pending and intentional bad JSON/unsupported versions using that controller's real supported entry points. The helper tests do not substitute a fake controller or certify any of those integration behaviors themselves.
