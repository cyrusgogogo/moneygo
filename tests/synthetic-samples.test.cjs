'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const P = require('./synthetic-practice-fixture.cjs');
const { L, I, R, C } = P;
const W = require('../dist/import-workflow.js');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const sha256 = text => crypto.createHash('sha256').update(text).digest('hex');
function loadBundle() { const window = {}; vm.runInNewContext(read('dist/synthetic-samples.js'), { window }); return window.MoneygoSyntheticSamples; }
function assertFrozenData(value) {
  assert.notEqual(typeof value, 'function');
  if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); for (const v of Object.values(value)) assertFrozenData(v); }
}
const completed = P.buildCompletedPractice();

test('production sample asset is frozen literal data, independent of tests, models, browser storage and I/O', () => {
  const window = {}, deny = () => { throw Error('Sample data must not acquire I/O or models'); };
  for (const name of ['localStorage', 'sessionStorage', 'MoneygoLedger', 'MoneygoImporter', 'MoneygoRelations', 'fetch', 'XMLHttpRequest', 'document', 'require']) Object.defineProperty(window, name, { get: deny });
  vm.runInNewContext(read('dist/synthetic-samples.js'), { window, require: deny, fetch: deny, XMLHttpRequest: deny, eval: deny });
  const bundle = window.MoneygoSyntheticSamples;
  assert.equal(bundle.protocol, 'moneygo-synthetic-samples-v1'); assert.equal(bundle.version, 1);
  assert.equal(bundle.testedEngineRelease, '0.23.0'); assert.equal(bundle.fixedReferenceDate, '2026-11-02');
  assert.equal(bundle.defaultSeed, 'complex'); assertFrozenData(bundle);
  assert.equal(Object.getOwnPropertyDescriptor(window, 'MoneygoSyntheticSamples').writable, false);
  assert.equal(Object.getOwnPropertyDescriptor(window, 'MoneygoSyntheticSamples').configurable, false);
  assert.throws(() => { bundle.seeds.complex.backupText = '{}'; }, TypeError);
  assert.doesNotMatch(read('dist/synthetic-samples.js'), /\brequire\s*\(|\beval\s*\(|\bfetch\s*\(|new XMLHttpRequest|tests\//);
});

test('complex backup bytes are unchanged and the actual parser accepts both seed schemas', () => {
  const b = loadBundle();
  assert.equal(b.seeds.complex.backupText, read('tests/fixtures/all-extensions-v6.json'));
  assert.equal(b.seeds.complex.backupText, read('dist/samples/SYNTHETIC-complex-v6.json'));
  assert.equal(b.seeds.starter.backupText, read('dist/samples/SYNTHETIC-starter.json'));
  for (const seed of Object.values(b.seeds)) {
    assert.equal(L.parseBackup(seed.backupText).version, seed.schemaVersion);
    assert.deepEqual(L.verifyBackup(seed.backupText).state, L.parseBackup(seed.backupText));
  }
  assert.equal(b.seeds.complex.initialMonth, '2026-10'); assert.equal(b.seeds.starter.initialMonth, '2026-09');
});

test('starter is independently authored with supported APIs, two real accounts and no invented history', () => {
  const saved = P.readStarter(), fresh = P.buildStarterState();
  const semantic = s => ({ version: s.version, currency: s.currency, accounts: s.accounts.map(a => [a.name, a.openingBalanceCents]), categories: s.categories, transactions: s.transactions, trash: s.trash });
  assert.deepEqual(semantic(saved), semantic(fresh));
  assert.deepEqual(saved.accounts.map(a => [a.name, a.openingBalanceCents]), [[P.BANK, 200000], [P.CREDIT, 0]]);
  assert.deepEqual(Object.keys(saved).sort(), ['accounts', 'categories', 'currency', 'transactions', 'trash', 'version']);
  assert.equal(saved.version, 1); assert.equal(saved.transactions.length, 0); assert.equal(saved.trash.length, 0);
  assert.doesNotMatch(read('scripts/build-synthetic-samples.cjs'), /delete\s+.*(?:audit|bookkeeping|obligations)|\.version\s*=|Date\s*=/);
});

test('every download is a local allowlisted synthetic JSON/CSV/TSV and exact asset bytes match', () => {
  const files = loadBundle().files;
  const expected = ['SYNTHETIC-complex-v6.json', 'SYNTHETIC-starter.json', 'SYNTHETIC-practice-bank.csv', 'SYNTHETIC-practice-credit.tsv', 'SYNTHETIC-practice-coffee-correction.csv', 'SYNTHETIC-practice-coffee-cancellation.csv'];
  assert.deepEqual(Array.from(files, f => f.fileName), expected);
  assert.deepEqual(fs.readdirSync(path.join(root, 'dist/samples')).sort(), expected.slice().sort());
  for (const file of files) {
    assert.equal(file.path, 'samples/' + file.fileName);
    assert.match(file.fileName, /^SYNTHETIC-[a-z0-9-]+\.(json|csv|tsv)$/);
    assert.equal(file.text, read('dist/' + file.path));
    assert.match(file.label, /^SYNTHETIC /);
    assert.ok(file.purpose.length > 20);
  }
});

test('manifest hashes source provenance and every generated asset; ordinary generation is reproducible', () => {
  const manifest = JSON.parse(read('SYNTHETIC_SAMPLE_MANIFEST.json'));
  for (const group of ['sources', 'artifacts']) for (const [name, record] of Object.entries(manifest[group])) {
    assert.equal(sha256(read(name)), record.sha256, name); assert.equal(Buffer.byteLength(read(name)), record.bytes, name);
  }
  assert.match(manifest.disclosure, /never bank authenticity/);
  const before = read('dist/synthetic-samples.js');
  assert.match(execFileSync(process.execPath, ['scripts/build-synthetic-samples.cjs', '--check'], { cwd: root, encoding: 'utf8' }), /Verified 9 synthetic artifacts/);
  assert.equal(read('dist/synthetic-samples.js'), before);
});

test('complex seed cross-checks all collections against the existing complete-fixture oracle', () => {
  const state = L.parseBackup(loadBundle().seeds.complex.backupText);
  const expected = {
    imports: { templates: 3, evidence: 1, batches: 3, quarantine: 2, coverage: 2, audit: 5 },
    bookkeeping: { links: 1, refunds: 1, claims: 1, settlements: 1, refundPlans: 1, snapshots: 2, transferPairs: 1, composites: 1, audit: 12 },
    organizer: { rules: 1, aliases: 1, merchants: 1, batches: 3, scopes: 1, reviews: 1, closes: 2, audit: 10 },
    obligations: { profiles: 5, statements: 2, contracts: 1, repayments: 2, inclusions: 1, fees: 1, audit: 16 }
  };
  assert.equal(state.accounts.length, 6); assert.equal(state.transactions.length, 19); assert.equal(state.trash.length, 1);
  assert.deepEqual([state.simulation.version, state.imports.version, state.bookkeeping.version, state.organizer.version, state.obligations.version], [1, 2, 3, 3, 1]);
  for (const [section, collections] of Object.entries(expected)) {
    assert.deepEqual(Object.keys(state[section]).filter(k => Array.isArray(state[section][k])).sort(), Object.keys(collections).sort());
    for (const [collection, count] of Object.entries(collections)) assert.equal(state[section][collection].length, count, section + '.' + collection);
  }
  assert.equal(state.imports.batches.filter(b => b.rolledBack).length, 1);
  assert.equal(state.organizer.batches.filter(b => b.rolledBack).length, 1);
  assert.ok(state.obligations.audit.some(a => a.reverses));
});

test('complex seed retains independent all-time and monthly exact-cent totals, balances and receivables', () => {
  const state = L.parseBackup(loadBundle().seeds.complex.backupText), all = R.calculate(state);
  assert.deepEqual(all.cash, { incomeCents: 54200, expenseCents: 55085, transferCents: 22000, netCents: -885 });
  assert.deepEqual(all.personal, { incomeCents: 50700, expenseCents: 50585, transferCents: 22000, netCents: 115, refundCents: 1500, claimCents: 3000 });
  const ids = JSON.parse(read('tests/fixtures/all-extensions-v6.ids.json'));
  assert.deepEqual({ ...L.balances(state) }, Object.fromEntries(Object.entries({ cash: 8666, bank: 208449, credit: -28000, restricted: 4500, unknown: 3700, other: -2200 }).map(([name, value]) => [ids.accounts[name], value])));
  const months = [
    ['2026-09', [0, 36000, 0, -36000], [0, 37500, 0, -37500, 1500, 0]],
    ['2026-10', [50700, 19085, 22000, 31615], [50700, 13085, 22000, 37615, 0, 3000]],
    ['2026-11', [3500, 0, 0, 3500], [0, 0, 0, 0, 0, 0]]
  ];
  for (const [month, cash, personal] of months) { const view = R.calculate(state, month); assert.deepEqual(Object.values(view.cash), cash); assert.deepEqual(Object.values(view.personal), personal); }
  assert.equal(all.receivables.outstandingCents, 1000);
});

test('downloaded CSV bytes take the actual importer path, with invalid and cancelled rows unable to create spend', () => {
  const starter = P.readStarter(), before = JSON.stringify(starter), preview = P.previewFile(starter, 'bank-csv');
  assert.deepEqual(preview.rows.map(r => r.action), ['new', 'new', 'new', 'new', 'new', 'new', 'invalid', 'new']);
  assert.equal(JSON.stringify(starter), before, 'preview is not a commit');
  const state = P.importFile(starter, 'bank-csv');
  assert.equal(state.transactions.length, 6); assert.equal(state.imports.evidence.length, 7); assert.equal(state.imports.quarantine.length, 1);
  assert.equal(state.imports.quarantine[0].mapped.amount, 'INVALID');
  assert.equal(state.imports.evidence.find(e => e.stableId === 'practice-cancelled').status, 'cancelled');
  assert.ok(!state.transactions.some(t => t.amountCents === 777));
  assert.deepEqual(L.summary(state), { incomeCents: 3500, expenseCents: 22234, transferCents: 0, netCents: -18734 });
});

test('rerunning the same source/account preserves transaction IDs and counts; changed namespaces are not dedup promises', () => {
  let state = P.importFile(P.readStarter(), 'bank-csv');
  const before = plain(state.transactions), preview = P.previewFile(state, 'bank-csv');
  assert.deepEqual(preview.rows.map(r => r.action), ['duplicate', 'duplicate', 'duplicate', 'duplicate', 'duplicate', 'duplicate', 'invalid', 'duplicate']);
  state = I.commit(state, preview, []);
  assert.deepEqual(state.transactions, before); assert.equal(state.imports.evidence.length, 7);
  // Identical invalid evidence is retained once; a rerun is not a new transaction.
  assert.equal(state.imports.quarantine.length, 1);
  const csv = read('dist/samples/SYNTHETIC-practice-bank.csv');
  const different = I.preview(state, csv, { ...P.config(state, 'bank-csv'), sourceKey: 'different-source' });
  assert.ok(different.rows.some(row => row.action === 'new' || row.action === 'candidate'));
});

test('same-source correction changes one original ID by exactly 100 cents with before/after evidence', () => {
  let state = P.importFile(P.readStarter(), 'bank-csv');
  const id = P.transactionId(state, 'practice-coffee'), preview = P.previewFile(state, 'coffee-correction');
  assert.equal(preview.rows[0].action, 'update'); assert.equal(preview.totals.expenseCents, 100);
  state = I.commit(state, preview, [preview.rows[0].key]);
  assert.equal(state.transactions.length, 6); assert.equal(P.transactionId(state, 'practice-coffee'), id);
  assert.equal(state.transactions.find(t => t.id === id).amountCents, 1334);
  const change = state.imports.batches.at(-1).changes[0];
  assert.equal(change.before.normalized.amountCents, 1234); assert.equal(change.after.normalized.amountCents, 1334);
  assert.equal(P.previewFile(state, 'coffee-correction').rows[0].action, 'duplicate');
});

test('cancelling a correction preview is read-only; actual cancelled status and reinstatement retain identity', () => {
  let state = P.buildImportedPractice();
  const before = JSON.stringify(state), id = P.transactionId(state, 'practice-coffee');
  const preview = P.previewFile(state, 'coffee-cancellation');
  assert.equal(preview.rows[0].action, 'status'); assert.equal(preview.totals.expenseCents, -1334);
  assert.equal(JSON.stringify(state), before, 'dropping preview does not modify state');
  state = I.commit(state, preview, [preview.rows[0].key]);
  assert.equal(state.transactions.length, 7); assert.equal(state.trash[0].id, id);
  state = P.importFile(state, 'coffee-correction');
  assert.equal(state.transactions.length, 8); assert.equal(state.trash.length, 0);
  assert.equal(P.transactionId(state, 'practice-coffee'), id);
});

test('quarantine repair validates a real changed field, retains original invalid evidence and rolls back atomically', () => {
  let state = P.importFile(P.readStarter(), 'bank-csv');
  const id = state.imports.quarantine[0].id;
  assert.equal(I.previewRepair(state, id, { amount: 'still-invalid' }).rows[0].action, 'invalid');
  const preview = I.previewRepair(state, id, { amount: '1.11' });
  state = I.commit(state, preview, [preview.rows[0].key]);
  assert.equal(state.transactions.length, 7); assert.equal(state.imports.quarantine[0].mapped.amount, 'INVALID');
  assert.equal(state.transactions.find(t => t.note === 'SYNTHETIC bad amount for review').amountCents, 111);
  const result = I.rollback(state, state.imports.batches.at(-1).id);
  assert.equal(result.rolledBack, true); assert.equal(result.conflicts.length, 0);
  assert.equal(result.state.transactions.length, 6); assert.equal(result.state.imports.quarantine[0].resolvedByBatchId, null);
});

test('actual local intake queue ignores a cancelled in-flight synthetic file read', async () => {
  const bytes = new TextEncoder().encode(read('dist/samples/SYNTHETIC-practice-bank.csv'));
  let finish;
  const queue = W.createQueue(() => ({ config: {} }));
  const entry = queue.add([{ name: 'SYNTHETIC-practice-bank.csv', size: bytes.byteLength, arrayBuffer: () => new Promise(resolve => { finish = resolve; }) }]).added[0];
  let loaderCalls = 0;
  const task = queue.read(entry.id, async data => { loaderCalls++; return { parsed: I.parseCSV(new TextDecoder().decode(data)) }; });
  await Promise.resolve(); queue.cancel(entry.id); finish(bytes.buffer);
  assert.equal(await task, false); assert.equal(loaderCalls, 0); assert.equal(entry.draft.parsed, undefined);
  assert.equal(entry.status, 'queued'); assert.equal(queue.list().length, 1);
});

test('credit TSV is real tab-separated import with separate source/account and no guessed transfer pairing', () => {
  let state = P.importFile(P.readStarter(), 'bank-csv');
  const preview = P.previewFile(state, 'credit-tsv'); assert.equal(preview.rows.length, 2);
  state = P.importFile(state, 'credit-tsv');
  assert.equal(state.transactions.length, 8); assert.equal(state.bookkeeping, undefined);
  assert.equal(state.imports.evidence.filter(e => e.sourceKey === P.CREDIT_SOURCE).length, 2);
  assert.equal(P.previewFile(state, 'credit-tsv').rows[0].action, 'duplicate');
});

test('6000-cent September purchase and 1500-cent November refund restate purchase month without moving cash date', () => {
  const state = completed, september = R.calculate(state, '2026-09'), november = R.calculate(state, '2026-11');
  const id = P.transactionId(state, 'practice-refundable'), impact = R.calculate(state).impacts[id];
  assert.equal(impact.personalExpenseCents, 4500);
  assert.equal(september.personal.expenseCents, 34500); assert.equal(september.personal.refundCents, 1500); assert.equal(september.cash.expenseCents, 36000);
  assert.equal(november.cash.incomeCents, 3500); assert.equal(november.personal.incomeCents, 0); assert.equal(november.personal.refundCents, 0);
  assert.equal(state.transactions.find(t => t.id === P.transactionId(state, 'practice-refund-in')).date, '2026-11-01');
});

test('5000-cent shared purchase leaves 2000 personal expense; 3000 claim minus 2000 actual receipt leaves 1000', () => {
  const result = R.calculate(completed), id = P.transactionId(completed, 'practice-shared');
  assert.equal(result.impacts[id].personalExpenseCents, 2000);
  assert.equal(result.receivables.claimedCents, 3000); assert.equal(result.receivables.settledCents, 2000); assert.equal(result.receivables.outstandingCents, 1000);
  assert.equal(R.calculate(completed, '2026-10').personal.expenseCents, 3334);
  assert.equal(R.calculate(completed, '2026-10').cash.expenseCents, 6334);
});

test('real paired repayment preserves both original dates and excludes the two legs from personal consumption/income', () => {
  const state = completed, pair = state.bookkeeping.transferPairs[0], result = R.calculate(state);
  assert.equal(state.transactions.find(t => t.id === pair.expenseId).date, '2026-10-31');
  assert.equal(state.transactions.find(t => t.id === pair.incomeId).date, '2026-11-01');
  assert.equal(pair.amountCents, 10000); assert.equal(result.impacts[pair.expenseId].personalExpenseCents, 0); assert.equal(result.impacts[pair.incomeId].ordinaryIncomeCents, 0);
  assert.equal(R.calculate(state, '2026-10').cash.transferCents, 10000); assert.equal(R.calculate(state, '2026-11').cash.transferCents, 0);
  assert.equal(state.transactions.length, 8, 'relations and obligations never inject a second transaction');
});

test('all three principal installments are 10000 cents plus a known 1-cent fee, with purchase counted exactly once', () => {
  const contract = completed.obligations.contracts[0];
  assert.deepEqual(contract.schedule.map(s => [s.dueDate, s.principalCents, s.feeCents]), [['2026-10-31', 10000, 1], ['2026-11-30', 10000, 1], ['2026-12-31', 10000, 1]]);
  assert.equal(contract.principalCents, 30000); assert.equal(contract.feeCents, 3);
  assert.equal(R.calculate(completed).impacts[contract.purchaseTransactionId].personalExpenseCents, 30000);
  const view = C.view(completed, { asOf: '2026-11-02' });
  assert.deepEqual(view.contracts[0].schedule.map(s => s.forecastStatus), ['billed', 'unbilled', 'unbilled']);
  assert.equal(view.statements[0].includedInstallmentCents, 10001); assert.equal(completed.obligations.fees.length, 0, 'planned fees are not invented expense evidence');
});

test('fixed as-of expectations preserve future arrival and 1-cent remaining statement without changing the real clock', () => {
  const originalDate = Date;
  for (const [asOf, allocated, pending, remaining, debt] of [['2026-10-30', 0, 10000, 10001, 30000], ['2026-10-31', 0, 10000, 10001, 30000], ['2026-11-01', 10000, 0, 1, 20000], ['2026-11-02', 10000, 0, 1, 20000]]) {
    const view = C.view(completed, { asOf }), statement = view.statements[0];
    assert.deepEqual([statement.allocatedCents, statement.pendingArrivalAllocatedCents, statement.outstandingCents], [allocated, pending, remaining], asOf);
    assert.equal(view.roleAwareActuals.recordedCreditDebtCents, debt); assert.equal(statement.verifiedRepaid, false);
  }
  assert.equal(Date, originalDate); assert.doesNotMatch(read('tests/synthetic-practice-fixture.cjs'), /global(?:This)?\.Date\s*=|Date\.now\s*=|Date\s*=\s*class/);
});

test('completed real-import practice exact totals are independently fixed, and backup verification/restore is detached', () => {
  assert.deepEqual(R.calculate(completed).cash, { incomeCents: 3500, expenseCents: 42334, transferCents: 10000, netCents: -38834 });
  assert.deepEqual(R.calculate(completed).personal, { incomeCents: 0, expenseCents: 37834, transferCents: 10000, netCents: -37834, refundCents: 1500, claimCents: 3000 });
  assert.deepEqual(Object.fromEntries(completed.accounts.map(a => [a.name, L.balances(completed)[a.id]])), { [P.BANK]: 181166, [P.CREDIT]: -20000 });
  const before = JSON.stringify(completed), backup = L.backup(completed), verified = L.verifyBackup(backup), restored = L.parseBackup(backup);
  assert.deepEqual(verified.state, completed); assert.deepEqual(restored, completed); assert.notEqual(restored, completed); assert.notEqual(restored.imports, completed.imports);
  verified.state.accounts[0].name = 'Changed returned clone';
  assert.equal(JSON.stringify(completed), before); assert.deepEqual(L.parseBackup(L.backup(restored)), completed);
  const memory = new Map(), storage = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k) };
  L.save(storage, restored); assert.deepEqual(L.load(storage).state, completed);
});


test('deployable static guide is script-free, includes real control names, and all fixed local links resolve', () => {
  const html = read('dist/synthetic-practice.html');
  assert.doesNotMatch(html, /<script\b|<form\b|\bon[a-z]+\s*=|<iframe\b|javascript:|https?:\/\//i);
  assert.match(html, /临时账本留在原标签页/);
  assert.match(html, /未完成真实浏览器/);
  assert.match(html, /关联已入账分期/);
  assert.match(html, /生成逐笔预览/);
  assert.match(html, /SYNTHETIC-practice-credit.tsv/);
  const links = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(links, ['#guide', ...loadBundle().files.map(f => f.path)]);
  for (const link of links.filter(l => !l.startsWith('#'))) assert.ok(fs.existsSync(path.join(root, 'dist', link)));
  for (const file of loadBundle().files) assert.ok(html.includes('download="' + file.fileName + '"'));
});
