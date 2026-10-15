# Independent refund receipt boundaries

Only public Moneygo APIs are exercised. No production module rewrite, reduced
limit, private export, mocked financial writer, network, browser or storage
capability is used. The two test entry points are:

- `tests/refund-receipts-boundary.test.cjs`: hostile descriptors and complete
  closed shapes; cross-realm data; one-use identities; raw-data staleness;
  clock rollback/midnight/full civil-year domain; output detachment/freezing;
  missing required modules; forbidden storage/network/timer acquisitions;
  exact reason/search/page/offset constraints.
- `tests/refund-receipts-boundary-resources.test.cjs`: genuine canonical ledger,
  complete review and inherited transaction-count boundaries.

Run both:

    MONEYGO_REFUND_BOUNDARY_EVIDENCE_DIR=/path/to/evidence node --test --test-reporter=tap --test-concurrency=1 tests/refund-receipts-boundary*.test.cjs

## Fixture provenance

`helpers.cjs` uses unchanged Ledger transaction/account writers and Relations
refund-plan writers. Resource import fixtures use complete, genuine
Importer.preview/commit results. The 10,000-transaction fixture assembles
unchanged independent public Ledger.putTransaction outputs, validates the full
state, and round-trips its ordinary backup. No relation/audit history is
fabricated to gain capacity.

The exact 8 MiB review retains all selected import evidence and complete import
batch snapshots in both phases. Padding is real source note text from CSV,
including multibyte, escaped and lone-surrogate characters, plus a public
expense-note edit. One unused zero-balance account is made through the public
Ledger account writer with a temporary synthetic UUID provider restored in a
finally block. Its account ID occurs five times across all-date/month before/after balance
proofs and the effects row. Replacing it through public removeAccount/putAccount
with an ID one character longer adds five bytes; a public expense-note edit
removes two characters appearing twice, yielding a genuine one-byte-over review.
The source module and all production dependencies are hash-pinned per resource
measurement. A model edit during a run invalidates the measurement.

## Honest limit distinctions

- Canonical raw ledger exactly 33,554,432 bytes is accepted for complete reads;
  33,554,433 bytes rejects before financial writes.
- A real complete review exactly 8,388,608 bytes is tested through preview and
  commit, and a genuine one-byte-over complete review must be refused. The
  ticket's JSON wrapper is 11 extra bytes; the approved limit is the complete
  review itself, not that wrapper.
- A genuine canonical candidate at exactly32MiB is refused before review
  authority when its ordinary backup envelope exceeds the independent limit.
  This is precisely RR_PROOF_UNAVAILABLE / BACKUP_TOO_LARGE; it is not accepted
  write capacity, even though the unchanged low-level allocator can build it.
- A separate genuine candidate whose actual ordinary backup is exactly
  33,554,432 bytes must pass preview, commit and actual backup/parse roundtrip.
  Its source backup is below the limit. An actual accepted one-byte-under
  backup establishes the observed one-byte increment; the corresponding
  one-byte-over public writer candidate is refused by real Ledger.backup and
  by the coordinator before authority. Its canonical bytes remain below32MiB.
- Pretty-printed backup and canonical ledger limits are independent. The prior
  canonical32MiB candidate acceptance measurement is retained only as a
  historical diagnostic of the now-retired missing-backup-guard behavior.
- A 10,000-transaction state has 9,999 income records and one expense. The
  candidate scan must reach the final income, with 100-row paging; the complete
  scan is never relabeled a 100-row pool.
- Schema-valid closed requests cannot reach 64 KiB because of their individual
  ID, reason and search caps. The exact/one-over request test is explicitly
  malformed-shape byte-preflight evidence, not successful request capacity.
- A genuine 50,000-entry relation-audit history is not constructed by this
  suite. Independent implementation review owns that separate evidence. Read
  acceptance at50,000, append at49,999, and full-audit append refusal are
  inherited count expectations, not executed write-capacity claims from this
  suite; an earlier ordinary-backup limit may refuse append authority. A sequential
  public update chain revalidates its growing history on every call and is
  quadratic; a200-update probe took3.64 seconds. No reduced fixture is
  substituted for successful maximum capacity.
- Separate maxima are not asserted to coexist. Node timing and cumulative
  process high-water RSS are recorded; browser, keyboard, mobile and
  screen-reader acceptance are not inferred from these tests.
