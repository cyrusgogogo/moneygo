# Synthetic migration fixtures

All files here are synthetic test data, never personal statements.

- `organizer-v1-close.json`: produced by organizer inner version 1 before the transfer-pair migration. It preserves a September outgoing row and October incoming row, deliberately unpaired in the old frozen month.
- `legacy-relations-v4.json` and `legacy-relations-v5.json`: produced by the previous relation/organizer inner version 1 modules. They include synthetic duplicate evidence, a partial refund, a claim and settlement, a balance snapshot, and (v5) a frozen month. Tests ensure migrations retain historical records and audit snapshots exactly.

Do not regenerate these with the newest modules: they are fixed historical-format inputs. All labels, IDs, amounts and dates are test-only.
- `legacy-outer-v1-v5.json`: five synthetic backups produced by the frozen v0.7 modules, covering each outer version before credit obligations existed. The fixtures include optional sandbox, one synthetic mapped CSV entry, a balance snapshot and a month close. Credit migration tests preserve all prior sections while adding the new extension.

- `imports-v1-frozen-v08.json`: genuine synthetic importer-inner-v1 state produced by frozen v0.8. Header-position and physical-line changes must preserve its old templates, evidence, batch history, audit and unknown source-line state.
- `header-review/*.csv`: entirely synthetic source-layout fixtures. Their mapped transactions match while unselected fictional text has different physical line counts. Tests ensure receipt identity stays stable, saved physical rows stay accurate, and unselected text is absent from persisted data.

- `composite-legacy-readers/`: exact unchanged reader modules from the frozen local v0.9 development version, with SHA-256 manifest. They prove older readers reject new inner-version composite data; they are not production assets or newly generated mock validators.
- `roadmap-original-titles.json`: all 120 original numbered titles, used to detect accidental renumbering or semantic substitution in the implementation traceability.
