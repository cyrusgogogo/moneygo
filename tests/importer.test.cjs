'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const L = require('../dist/ledger.js');
const I = require('../dist/importer.js');
const clone = value => JSON.parse(JSON.stringify(value));
const errorCode = code => error => error instanceof L.LedgerError && error.code === code;
function config(extra = {}) { return { sourceKey: 'my-export', accountId: 'account-cash', delimiter: ',', columns: { date: 'date', amount: 'amount', direction: 'direction', note: 'note', stableId: 'id', status: 'status', channel: 'channel' }, ...extra }; }
function csv(rows) { return 'date,amount,direction,note,id,status,channel,unmapped-secret\r\n' + rows.map(row => row.map(value => '"' + String(value).replaceAll('"', '""') + '"').join(',')).join('\r\n'); }
function row(extra = {}) { const r = { date: '2026-10-14', amount: '0.29', direction: 'expense', note: 'Coffee', id: 'order-1', status: 'completed', channel: 'User-labelled channel', secret: 'DO_NOT_KEEP_FULL_ACCOUNT_NUMBER', ...extra }; return [r.date, r.amount, r.direction, r.note, r.id, r.status, r.channel, r.secret]; }
function preview(state, rows, cfg) { return I.preview(state, csv(rows), cfg || config()); }
function apply(state, rows, cfg) { const p = preview(state, rows, cfg); return I.commit(state, p, p.rows.filter(r => ['new', 'update', 'status', 'candidate'].includes(r.action)).map(r => r.key)); }
function freeze(value) { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }

test('UMD importer works in browser without require or a DOM', () => {
  const window = {}; const context = { window };
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/ledger.js'), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/importer.js'), 'utf8'), context);
  const importer = window.MoneygoImporter, state = window.MoneygoLedger.createEmpty();
  const p = importer.preview(state, 'd,a\n2026-10-14,0.29', { sourceKey: 'x', accountId: 'account-cash', delimiter: ',', defaultType: 'expense', columns: { date: 0, amount: 1 } });
  assert.equal(importer.commit(state, p, [p.rows[0].key]).transactions[0].amountCents, 29);
  assert.ok(Object.isFrozen(importer));
});

test('strict parser handles BOM, CRLF, multiline quoted cells, escaped quotes and empty cells', () => {
  const parsed = I.parseCSV('\ufeffdate,note,amount\r\n2026-10-14,"a, b\r\n""quoted""",1.15\r\n\r\n2026-10-15,,2\r\n');
  assert.deepEqual(parsed.headers, ['date', 'note', 'amount']);
  assert.equal(parsed.bom, true); assert.equal(parsed.blankLines, 1);
  assert.deepEqual(parsed.rows, [{ line: 2, fields: ['2026-10-14', 'a, b\r\n"quoted"', '1.15'] }, { line: 5, fields: ['2026-10-15', '', '2'] }]);
  assert.deepEqual(I.parseCSV('a;b\r1;2', { delimiter: ';' }).rows[0].fields, ['1', '2']);
  assert.deepEqual(I.parseCSV('a\tb\n1\t2', { delimiter: '\t' }).headers, ['a', 'b']);
  assert.deepEqual(I.parseCSV('a|b\n1|2', { delimiter: '|' }).headers, ['a', 'b']);
});

test('strict parser rejects malformed quoting, invalid encoding markers, unsupported delimiter and oversized input', () => {
  for (const value of ['h\n"unfinished', 'h\na"b', 'h\n"a"x', 'h\n"a" "b"']) assert.throws(() => I.parseCSV(value), errorCode('CSV_QUOTE'));
  assert.throws(() => I.parseCSV('a\u0000b'), errorCode('INVALID_ENCODING'));
  assert.throws(() => I.parseCSV('a\ufffdb'), errorCode('INVALID_ENCODING'));
  assert.throws(() => I.parseCSV('a,b', { delimiter: ':' }), errorCode('INVALID_DELIMITER'));
  assert.throws(() => I.parseCSV('中'.repeat(Math.ceil(I.LIMITS.bytes / 3))), errorCode('CSV_TOO_LARGE'));
  assert.throws(() => I.parseCSV('a'.repeat(I.LIMITS.bytes + 1)), errorCode('CSV_TOO_LARGE'));
  assert.throws(() => I.parseCSV(Array(202).fill('a').join(',')), errorCode('CSV_COLUMNS'));
});

test('inspection suggests only a delimiter and never claims verified provider or original encoding', () => {
  const inspected = I.inspectCSV('\ufeffdate;amount\r\n2026-10-14;1\r\n');
  assert.equal(inspected.suggestedDelimiter, ';'); assert.equal(inspected.newline, 'CRLF'); assert.equal(inspected.rowCount, 1);
  assert.doesNotMatch(inspected.encoding, /UTF-8/);
  const ambiguous = I.inspectCSV('a,b;c\n1,2;3'); assert.equal(ambiguous.suggestedDelimiter, null); assert.equal(ambiguous.ambiguous, true);
  assert.equal(I.inspectCSV('one\nvalue').suggestedDelimiter, null);
});

test('headerless CSV imports every row using explicit indexes and synthetic template headers', () => {
  const cfg = { sourceKey: 'headerless', accountId: 'account-cash', delimiter: ',', header: false, columns: { date: 0, amount: 1 }, defaultType: 'expense' };
  const raw = '2026-10-14,1.15\n2026-10-15,0.29';
  assert.equal(I.parseCSV(raw, { header: false }).rows.length, 2);
  const p = I.preview(L.createEmpty(), raw, cfg); assert.deepEqual(p.headers, ['第1列', '第2列']); assert.equal(p.rows.length, 2);
  const state = I.commit(L.createEmpty(), p, p.rows.map(r => r.key)); assert.equal(state.transactions.length, 2); assert.equal(state.imports.templates[0].config.header, false);
});

test('preview is deeply immutable, deterministic, pure and keeps only mapped raw fields', () => {
  const state = freeze(L.createEmpty()), cfg = freeze(config()), raw = csv([row({ note: 'two\nlines' })]);
  const p = preview(state, [row({ note: 'two\nlines' })], cfg), second = I.preview(state, raw, cfg);
  assert.deepEqual(p, second); assert.ok(Object.isFrozen(p.rows[0].mapped)); assert.equal(state.imports, undefined); assert.equal(state.transactions.length, 0);
  assert.equal(p.rows[0].transaction.amountCents, 29); assert.equal(p.totals.expenseCents, 29); assert.equal(p.totals.netCents, -29);
  assert.equal(JSON.stringify(p).includes('DO_NOT_KEEP_FULL_ACCOUNT_NUMBER'), false);
  const committed = I.commit(state, p, [p.rows[0].key]); assert.equal(JSON.stringify(committed).includes('DO_NOT_KEEP_FULL_ACCOUNT_NUMBER'), false); assert.equal(JSON.stringify(committed).includes(raw), false);
});

test('exact decimal conversion rejects rounding, scientific notation, zero, separators and mismatched signs', () => {
  for (const amount of ['1.001', '1e3', '1,000', '0', 'NaN', '￥1', '+1', '-1', '10000000000']) {
    const p = preview(L.createEmpty(), [row({ amount })]); assert.equal(p.rows[0].action, 'invalid', amount); assert.equal(p.totals.expenseCents, 0);
  }
  const cfg = config({ amountMode: 'signed', defaultType: 'expense', columns: { date: 'date', amount: 'amount' } });
  const p = preview(L.createEmpty(), [row({ amount: '1.15' }), row({ amount: '-0.29' })], cfg);
  assert.equal(p.rows[0].transaction.type, 'income'); assert.equal(p.rows[1].transaction.type, 'expense');
  assert.equal(p.totals.incomeCents, 115); assert.equal(p.totals.expenseCents, 29);
  assert.equal(preview(L.createEmpty(), [row({ amount: '-1', direction: 'income' })], config({ amountMode: 'signed' })).rows[0].errors[0].code, 'DIRECTION_CONFLICT');
});

test('strict dates use selected format without date rollover, ambiguity or timezone guessing', () => {
  for (const date of ['2026-02-29', '2026-04-31', '2026-1-02', '1900-02-29', '2026-10-14T12:00:00Z']) assert.equal(preview(L.createEmpty(), [row({ date })]).rows[0].action, 'invalid', date);
  assert.equal(preview(L.createEmpty(), [row({ date: '2000-02-29' })]).rows[0].action, 'new');
  for (const [date, dateFormat, expected] of [['14/10/2026', 'DD/MM/YYYY', '2026-10-14'], ['10/14/2026', 'MM/DD/YYYY', '2026-10-14'], ['2026/10/14', 'YYYY/MM/DD', '2026-10-14'], ['2026-10-14 23:59:59', 'YYYY-MM-DD HH:mm:ss', '2026-10-14']]) assert.equal(preview(L.createEmpty(), [row({ date })], config({ dateFormat })).rows[0].transaction.date, expected);
  assert.equal(preview(L.createEmpty(), [row({ date: '2026-10-14 24:00:00' })], config({ dateFormat: 'YYYY-MM-DD HH:mm:ss' })).rows[0].action, 'invalid');
});

test('explicit mapping rejects duplicate header names, reused columns, missing direction and unknown fields', () => {
  const cfg = { sourceKey: 'x', accountId: 'account-cash', delimiter: ',', defaultType: 'expense', columns: { date: 'd', amount: 'a' } };
  assert.throws(() => I.preview(L.createEmpty(), 'd,a,a\n2026-10-14,1,2', cfg), errorCode('COLUMN_MAPPING'));
  assert.throws(() => I.preview(L.createEmpty(), 'd,a\n2026-10-14,1', { ...cfg, columns: { date: 0, amount: 0 } }), errorCode('COLUMN_MAPPING'));
  assert.throws(() => I.preview(L.createEmpty(), 'd,a\n2026-10-14,1', { ...cfg, defaultType: null }), errorCode('COLUMN_MAPPING'));
  assert.throws(() => I.preview(L.createEmpty(), 'd,a\n2026-10-14,1', { ...cfg, columns: { ...cfg.columns, extra: 1 } }), errorCode('COLUMN_MAPPING'));
  assert.throws(() => I.preview(L.createEmpty(), 'd,a\n2026-10-14,1', { ...cfg, delimiter: undefined }), errorCode('INVALID_DELIMITER'));
});

test('unknown direction/status, malformed width and missing required values are quarantined without spend', () => {
  const p = preview(L.createEmpty(), [row({ status: 'mysteriously paid' }), row({ id: 'two', direction: '???' }), row({ id: 'three', amount: '' }), row({ id: 'four', date: '' })]);
  assert.deepEqual(p.rows.map(r => r.action), ['invalid', 'invalid', 'invalid', 'invalid']);
  const saved = I.commit(L.createEmpty(), p, []); assert.equal(saved.transactions.length, 0); assert.equal(saved.imports.quarantine.length, 4);
  const malformed = I.preview(L.createEmpty(), 'd,a\n2026-10-14,1,extra\n2026-10-15', { sourceKey: 'x', accountId: 'account-cash', delimiter: ',', columns: { date: 0, amount: 1 }, defaultType: 'expense' });
  assert.ok(malformed.rows.every(r => r.errors[0].code === 'ROW_WIDTH'));
});

test('custom status/direction maps are explicit and prototype-shaped keys cannot alter objects', () => {
  const p = preview(L.createEmpty(), [row({ direction: 'OUT', status: 'SETTLED' })], config({ directionMap: { OUT: 'expense' }, statusMap: { SETTLED: 'completed' } }));
  assert.equal(p.rows[0].action, 'new');
  assert.throws(() => preview(L.createEmpty(), [row()], config({ statusMap: JSON.parse('{"__proto__":"completed"}') })), errorCode('INVALID_CONFIG'));
  assert.equal(preview(L.createEmpty(), [row({ status: 'constructor' })]).rows[0].action, 'invalid');
});

test('selection is mandatory, invalid selections reject atomically, and preview provenance cannot be forged', () => {
  const state = L.createEmpty(), p = preview(state, [row(), row({ id: 'two', date: 'bad' })]);
  assert.throws(() => I.commit(state, p), errorCode('SELECTION_REQUIRED'));
  for (const keys of [['missing'], [p.rows[1].key], [p.rows[0].key, p.rows[0].key]]) assert.throws(() => I.commit(state, p, keys));
  assert.throws(() => I.commit(state, clone(p), [p.rows[0].key]), errorCode('INVALID_PREVIEW'));
  assert.equal(state.transactions.length, 0); assert.equal(state.imports, undefined);
});

test('same-file reimport and repeated commit are idempotent even after unrelated edits', () => {
  let state = L.createEmpty(); const p = preview(state, [row()]); const saved = I.commit(state, p, [p.rows[0].key]);
  assert.deepEqual(I.commit(saved, p, [p.rows[0].key]), saved);
  const reimport = preview(saved, [row()]); assert.equal(reimport.rows[0].action, 'duplicate');
  const edited = L.putAccount(saved, { name: 'Other account', openingBalanceCents: 0 });
  assert.deepEqual(I.commit(edited, p, [p.rows[0].key]), edited);
  assert.equal(saved.transactions.length, 1);
});

test('stale previews reject any intervening ledger or template change', () => {
  const state = L.createEmpty(), p = preview(state, [row()]);
  const edited = L.putAccount(state, { name: 'New', openingBalanceCents: 0 });
  assert.throws(() => I.commit(edited, p, [p.rows[0].key]), errorCode('STALE_PREVIEW'));
  const saved = I.saveTemplate(state, { headers: p.headers, config: p.config });
  assert.throws(() => I.commit(saved, p, [p.rows[0].key]), errorCode('STALE_PREVIEW'));
});

test('same stable ID updates one transaction, source and account namespaces remain separate', () => {
  let state = apply(L.createEmpty(), [row()]); const txId = state.transactions[0].id;
  let p = preview(state, [row({ amount: '10.00', note: 'Corrected' })]); assert.equal(p.rows[0].action, 'update'); assert.equal(p.totals.expenseCents, 971);
  state = I.commit(state, p, [p.rows[0].key]); assert.equal(state.transactions.length, 1); assert.equal(state.transactions[0].id, txId); assert.equal(state.transactions[0].amountCents, 1000);
  state = apply(state, [row()], config({ sourceKey: 'second-source' })); assert.equal(state.transactions.length, 2);
  state = L.putAccount(state, { name: 'Bank', openingBalanceCents: 0 }); const bank = state.accounts[1].id;
  state = apply(state, [row()], config({ accountId: bank })); assert.equal(state.transactions.length, 3); assert.equal(state.imports.evidence.length, 3);
});

test('conflicting versions of a stable ID in one file all conflict, identical repetitions do not double post', () => {
  let p = preview(L.createEmpty(), [row(), row({ amount: '10' })]); assert.deepEqual(p.rows.map(r => r.action), ['conflict', 'conflict']);
  const staged = I.commit(L.createEmpty(), p, []); assert.equal(staged.imports.quarantine.length, 2); assert.equal(staged.transactions.length, 0);
  p = preview(L.createEmpty(), [row(), row()]); assert.deepEqual(p.rows.map(r => r.action), ['new', 'duplicate']);
  assert.equal(I.commit(L.createEmpty(), p, [p.rows[0].key]).transactions.length, 1);
});

test('ID-less identical occurrences remain separate; overlap is only a candidate, never auto-deleted', () => {
  let state = L.createEmpty(); let p = preview(state, [row({ id: '' }), row({ id: '' })]);
  assert.deepEqual(p.rows.map(r => r.action), ['new', 'candidate']); assert.equal(p.rows[1].candidateRowKeys.length, 1);
  state = I.commit(state, p, p.rows.map(r => r.key)); assert.equal(state.transactions.length, 2); assert.equal(state.imports.evidence.length, 2);
  p = preview(state, [row({ id: '' }), row({ id: '' })]); assert.ok(p.rows.every(r => r.action === 'duplicate'));
  p = preview(state, [row({ id: '' }), row({ id: '', note: 'Other merchant' })]); assert.ok(p.rows.every(r => r.action === 'candidate'));
  assert.equal(p.rows[0].candidateTransactionIds.length, 2);
  state = I.commit(state, p, [p.rows[1].key]); assert.equal(state.transactions.length, 3); assert.equal(state.imports.quarantine.filter(q => !q.resolvedByBatchId).length, 1);
});

test('pending and cancelled retain evidence without spend; completing/cancelling/reinstating use one ID', () => {
  let state = apply(L.createEmpty(), [row({ status: 'pending' })]); assert.equal(state.transactions.length, 0); assert.equal(state.imports.evidence[0].status, 'pending');
  let p = preview(state, [row()]); assert.equal(p.rows[0].action, 'status'); assert.equal(p.totals.expenseCents, 29);
  state = I.commit(state, p, [p.rows[0].key]); const txId = state.transactions[0].id;
  p = preview(state, [row({ status: 'cancelled' })]); assert.equal(p.rows[0].action, 'status'); assert.equal(p.totals.expenseCents, -29);
  state = I.commit(state, p, [p.rows[0].key]); assert.equal(state.transactions.length, 0); assert.equal(state.trash[0].id, txId); assert.equal(L.summary(state).expenseCents, 0);
  p = preview(state, [row({ status: 'completed', note: 'Reinstated after explicit confirmation' })]); assert.equal(p.rows[0].action, 'status');
  state = I.commit(state, p, [p.rows[0].key]); assert.equal(state.transactions[0].id, txId); assert.equal(state.trash.length, 0);
  const cancelledOnly = apply(L.createEmpty(), [row({ status: 'cancelled' })]); assert.equal(cancelledOnly.transactions.length, 0); assert.equal(cancelledOnly.trash.length, 0);
});

test('ID-less status changes surface a candidate instead of silently linking or discarding evidence', () => {
  const state = apply(L.createEmpty(), [row({ id: '', status: 'pending' })]);
  const p = preview(state, [row({ id: '', status: 'completed' })]); assert.equal(p.rows[0].action, 'candidate'); assert.equal(p.rows[0].candidateEvidenceIds.length, 1);
});

test('manual edits or deletions block later stable-ID updates and rollback without touching anything', () => {
  let state = apply(L.createEmpty(), [row()]); const batchId = state.imports.batches[0].id, tx = state.transactions[0];
  state = L.putTransaction(state, { ...tx, note: 'User edit' }, tx.id);
  assert.equal(preview(state, [row({ status: 'cancelled' })]).rows[0].action, 'conflict');
  let rollback = I.rollback(state, batchId); assert.equal(rollback.rolledBack, false); assert.equal(rollback.conflicts.length, 1); assert.deepEqual(rollback.state, state);
  const deleted = L.deleteTransaction(state, tx.id); assert.equal(preview(deleted, [row({ amount: '3' })]).rows[0].action, 'conflict');
  rollback = I.rollback(deleted, batchId); assert.equal(rollback.rolledBack, false); assert.deepEqual(rollback.state, deleted);
});

test('rollback is atomic, allows unrelated changes, and restores old amount/status and cancelled trash snapshots', () => {
  let state = apply(L.createEmpty(), [row()]); const original = clone(state.transactions[0]), firstBatch = state.imports.batches[0].id;
  state = apply(state, [row({ status: 'cancelled' })]); const cancelBatch = state.imports.batches.at(-1).id;
  assert.equal(I.rollback(state, firstBatch).rolledBack, false);
  state = I.rollback(state, cancelBatch).state; assert.deepEqual(state.transactions[0], original); assert.equal(state.trash.length, 0);
  state = L.putTransaction(state, { type: 'income', date: '2026-10-15', amountCents: 50, accountId: 'account-cash', categoryId: 'income-other', note: 'Unrelated' });
  const result = I.rollback(state, firstBatch); assert.equal(result.rolledBack, true); assert.equal(result.state.transactions.length, 1); assert.equal(result.state.transactions[0].note, 'Unrelated');
  assert.equal(I.rollback(result.state, firstBatch).rolledBack, false);
  state = apply(L.createEmpty(), [row()]); state = apply(state, [row({ status: 'cancelled' })]); const trash = clone(state.trash[0]);
  state = apply(state, [row({ status: 'completed', amount: '1.15' })]); const last = state.imports.batches.at(-1).id;
  state = I.rollback(state, last).state; assert.deepEqual(state.trash[0], trash); assert.equal(state.transactions.length, 0);
});

test('coverage is explicit, account/source-scoped, and rollback removes only its own confirmed range', () => {
  assert.throws(() => preview(L.createEmpty(), [row()], config({ coverage: { start: '2026-10-01', end: '2026-10-31' } })), errorCode('INVALID_COVERAGE'));
  let state = apply(L.createEmpty(), [row()]); assert.deepEqual(state.imports.coverage, []);
  state = apply(state, [row({ id: 'two' })], config({ coverage: { start: '2026-09-01', end: '2026-10-31', confirmed: true } }));
  const batchId = state.imports.batches.at(-1).id; assert.equal(state.imports.coverage[0].start, '2026-09-01');
  state = apply(state, [row({ id: 'three' })], config({ coverage: { start: '2026-10-01', end: '2026-10-31', confirmed: true } }));
  state = I.rollback(state, batchId).state; assert.equal(state.imports.coverage.length, 1); assert.equal(state.imports.coverage[0].start, '2026-10-01');
});

test('all unselected nonduplicate rows survive refresh and resolve when selected later; rollback reopens staging', () => {
  let state = L.createEmpty(); const rows = [row(), row({ id: '', note: 'Unconfirmed same-value transaction' }), row({ id: 'transfer', direction: 'transfer' }), row({ id: 'bad', date: 'bad' })];
  let p = preview(state, rows); state = I.commit(state, p, [p.rows[0].key]);
  assert.equal(state.imports.quarantine.length, 3); assert.equal(state.imports.quarantine.filter(q => !q.resolvedByBatchId).length, 3);
  state = L.parseBackup(L.backup(state)); p = preview(state, rows); state = I.commit(state, p, [p.rows[1].key]);
  assert.equal(state.imports.quarantine.filter(q => !q.resolvedByBatchId).length, 2);
  state = I.rollback(state, state.imports.batches.at(-1).id).state;
  assert.equal(state.imports.quarantine.filter(q => !q.resolvedByBatchId).length, 3);
});

test('quarantine repairs revalidate mapped fields, preserve original evidence and can be rolled back', () => {
  let state = apply(L.createEmpty(), [row({ date: '2026-02-30' })]); const q = clone(state.imports.quarantine[0]);
  let p = I.previewRepair(state, q.id, { date: '2026-02-28' }); assert.equal(p.rows[0].action, 'new');
  state = I.commit(state, p, [p.rows[0].key]); assert.equal(state.transactions[0].date, '2026-02-28'); assert.equal(state.imports.quarantine[0].mapped.date, '2026-02-30');
  assert.ok(state.imports.quarantine[0].resolvedByBatchId);
  assert.throws(() => I.previewRepair(state, q.id, { date: '2026-02-28' }), errorCode('ALREADY_REPAIRED'));
  state = I.rollback(state, state.imports.batches.at(-1).id).state; assert.equal(state.transactions.length, 0); assert.equal(state.imports.quarantine[0].resolvedByBatchId, null);
  p = I.previewRepair(state, q.id, { date: 'still-bad' }); assert.equal(p.rows[0].action, 'invalid');
});

test('oversized and control-character mapped fields quarantine safely without persisting unnecessary original text', () => {
  const rows = [row({ note: 'x'.repeat(1001) }), row({ id: 'two', note: 'bad\u0001control' })];
  const p = preview(L.createEmpty(), rows); assert.ok(p.rows.every(r => r.action === 'invalid'));
  const saved = I.commit(L.createEmpty(), p, []); assert.equal(saved.imports.quarantine[0].mapped.note.length, 1000);
  assert.deepEqual(saved.imports.quarantine[0].rawTruncated, ['note']); assert.equal(saved.imports.quarantine[1].mapped.note, 'bad\ufffdcontrol');
  assert.equal(JSON.stringify(saved).includes('DO_NOT_KEEP_FULL_ACCOUNT_NUMBER'), false);
});

test('templates are versioned, immutable by config, header changes require reconfirmation', () => {
  const p = preview(L.createEmpty(), [row()]); let state = I.saveTemplate(L.createEmpty(), { name: 'My format', headers: p.headers, config: p.config });
  assert.equal(state.transactions.length, 0); assert.equal(state.imports.templates[0].name, 'My format');
  state = I.saveTemplate(state, { headers: p.headers, config: p.config }); assert.equal(state.imports.templates.length, 1);
  state = I.saveTemplate(state, { headers: p.headers, config: { ...p.config, dateFormat: 'YYYY/MM/DD' } });
  assert.deepEqual(state.imports.templates.map(t => t.version), [1, 2]);
  assert.throws(() => preview(state, [row()], config({ expectedHeaders: ['wrong', 'headers'] })), errorCode('TEMPLATE_HEADERS_CHANGED'));
});

test('import state and backups round-trip, retain audit evidence and protect referenced categories/accounts', () => {
  let state = apply(L.createEmpty(), [row()]);
  assert.equal(state.version, 3); assert.deepEqual(L.parseBackup(L.backup(state)), state); assert.deepEqual(I.validateImportState(state.imports, state), state.imports);
  assert.throws(() => L.removeCategory(state, 'expense-other'));
  state = apply(L.createEmpty(), [row({ status: 'pending' })]); assert.throws(() => L.removeCategory(state, 'expense-other'));
  state = L.putAccount(state, { name: 'Bank', openingBalanceCents: 0 }); assert.throws(() => L.removeAccount(state, 'account-cash'));
});

test('backup validation rejects malformed references, inconsistent rollback payloads and unsafe counters', () => {
  const original = apply(L.createEmpty(), [row()]);
  const mutations = [
    state => { state.imports.version = 2; },
    state => { state.imports.revision = -1; },
    state => { state.imports.evidence[0].lastBatchId = 'missing'; },
    state => { state.imports.evidence[0].transactionId = 'missing'; },
    state => { state.imports.evidence[0].mapped.secret = 'must-not-persist'; },
    state => { state.imports.batches[0].changes[0].transactionAfter.transaction.amountCents++; },
    state => { state.imports.batches[0].changes[0].transactionAfter.location = 'trash'; },
    state => { state.imports.batches[0].changes[0].rowKey = 'wrong-row'; },
    state => { state.imports.evidence.push(clone(state.imports.evidence[0])); },
    state => { state.imports.templates[0].config.accountId = 'missing'; },
    state => { state.imports.batches[0].sourceKey = 'different-source'; },
    state => { state.imports.batches[0].selectedRowKeys = []; },
    state => { state.imports.batches[0].rolledBack = true; }
  ];
  for (const mutate of mutations) { const state = clone(original); mutate(state); assert.throws(() => L.validateState(state), String(mutate)); }
  let state = apply(original, [row({ amount: '2' })]); state = clone(state); state.imports.batches[1].changes[0].transactionBefore.transaction.amountCents = 999; assert.throws(() => L.validateState(state));
});

test('large prospective totals fail exactly rather than display rounded unsafe integers', () => {
  const raw = 'date,amount\n' + Array(9010).fill('2026-10-14,9999999999.99').join('\n');
  assert.throws(() => I.preview(L.createEmpty(), raw, { sourceKey: 'x', accountId: 'account-cash', delimiter: ',', defaultType: 'expense', columns: { date: 0, amount: 1 } }), errorCode('AMOUNT_OVERFLOW'));
});

test('CSV max row guard counts all data rows when there is no header', () => {
  const raw = Array(10001).fill('2026-10-14,1').join('\n');
  assert.throws(() => I.parseCSV(raw, { header: false }), errorCode('ROW_LIMIT'));
});

test('stable-ID completed to cancelled to exact original completed uses latest evidence, not old file receipts', () => {
  let state = apply(L.createEmpty(), [row()]); const txId = state.transactions[0].id;
  state = apply(state, [row({ status: 'cancelled' })]); assert.equal(L.summary(state).expenseCents, 0);
  const p = preview(state, [row()]); assert.equal(p.rows[0].action, 'status');
  state = I.commit(state, p, [p.rows[0].key]); assert.equal(L.summary(state).expenseCents, 29); assert.equal(state.transactions[0].id, txId);
  state = L.putTransaction(state, { ...state.transactions[0], note: 'Manual' }, txId);
  assert.equal(preview(state, [row()]).rows[0].action, 'conflict');
});

test('two identical ID-less quarantined occurrences can be repaired as distinct transactions', () => {
  let state = apply(L.createEmpty(), [row({ amount: 'bad', id: '' }), row({ amount: 'bad', id: '' })]); const ids = state.imports.quarantine.map(q => q.id);
  let p = I.previewRepair(state, ids[0], { amount: '10' }); state = I.commit(state, p, [p.rows[0].key]);
  p = I.previewRepair(state, ids[1], { amount: '10' }); assert.equal(p.rows[0].action, 'candidate');
  state = I.commit(state, p, [p.rows[0].key]); assert.equal(state.transactions.length, 2); assert.equal(L.summary(state).expenseCents, 2000);
  assert.ok(state.imports.quarantine.every(q => q.resolvedByBatchId));
});

test('reimporting quarantine after rollback creates an active repairable owner and protects later repairs', () => {
  let state = apply(L.createEmpty(), [row({ amount: 'bad', id: '' })]); const firstId = state.imports.quarantine[0].id, batchId = state.imports.batches[0].id;
  state = I.rollback(state, batchId).state;
  assert.throws(() => I.previewRepair(state, firstId, { amount: '10' }), errorCode('BATCH_ROLLED_BACK'));
  state = apply(state, [row({ amount: 'bad', id: '' })]); const second = state.imports.quarantine.at(-1), secondBatch = state.imports.batches.at(-1);
  assert.notEqual(second.id, firstId); assert.deepEqual(secondBatch.quarantineIds, [second.id]);
  const p = I.previewRepair(state, second.id, { amount: '10' }); state = I.commit(state, p, [p.rows[0].key]);
  assert.equal(I.rollback(state, secondBatch.id).rolledBack, false);
});

test('quarantine, resolution and coverage references must be bidirectional and owned by the correct batch', () => {
  let state = apply(L.createEmpty(), [row({ amount: 'bad' })]);
  state = apply(state, [row({ id: 'unrelated' })], config({ coverage: { start: '2026-10-01', end: '2026-10-31', confirmed: true } }));
  for (const mutate of [
    s => { s.imports.quarantine[0].resolvedByBatchId = s.imports.batches[1].id; },
    s => { s.imports.batches[0].quarantineIds = []; },
    s => { s.imports.batches[1].coverageIds = []; },
    s => { s.imports.quarantine[0].sourceKey = 'wrong-source'; },
    s => { s.imports.coverage[0].accountId = 'wrong-account'; }
  ]) { const changed = clone(state); mutate(changed); assert.throws(() => L.validateState(changed)); }
});

test('large duplicate groups retain bounded candidate examples and exact separate counts', () => {
  const raw = 'date,amount\n' + Array(1000).fill('2026-10-14,1').join('\n');
  const p = I.preview(L.createEmpty(), raw, { sourceKey: 'x', accountId: 'account-cash', delimiter: ',', defaultType: 'expense', columns: { date: 0, amount: 1 } });
  assert.equal(p.rows.at(-1).candidateRowKeys.length, 20); assert.equal(p.rows.at(-1).candidateRowCount, 999); assert.equal(p.rows.at(-1).candidateTransactionCount, 0);
  assert.ok(JSON.stringify(p).length < 2500000);
});

test('coherently altered rollback before-snapshots must still match the exact prior historical version', () => {
  let state = apply(L.createEmpty(), [row()]); state = apply(state, [row({ amount: '2' })]);
  const changed = clone(state), change = changed.imports.batches[1].changes[0];
  change.before.expectedTransaction.amountCents = 999; change.before.normalized.amountCents = 999; change.transactionBefore.transaction.amountCents = 999;
  assert.throws(() => L.validateState(changed), errorCode('INVALID_IMPORT'));
  const restored = I.rollback(state, state.imports.batches[1].id); assert.equal(restored.rolledBack, true); assert.equal(restored.state.transactions[0].amountCents, 29);
});

test('selecting a previously unselected row after its original batch rollback never resolves obsolete quarantine', () => {
  const rows = [row({ id: '' })]; let state = L.createEmpty(), p = preview(state, rows); state = I.commit(state, p, []);
  const oldId = state.imports.quarantine[0].id; state = I.rollback(state, state.imports.batches[0].id).state;
  p = preview(state, rows); state = I.commit(state, p, [p.rows[0].key]); assert.equal(state.transactions.length, 1);
  assert.equal(state.imports.quarantine.find(q => q.id === oldId).resolvedByBatchId, null);
});
