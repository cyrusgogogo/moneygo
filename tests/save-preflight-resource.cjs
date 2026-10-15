'use strict';
// Explicit serial runner, deliberately outside the default *.test.cjs glob.
// Run only in the coordinator's exclusive resource slot with an external
// 8-minute / 2.5-GiB supervisor. All data is synthetic and public-writer-built.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { performance } = require('node:perf_hooks');
const F = require('./save-preflight-fixtures.cjs'), { L, P } = F;
const ROOT = path.resolve(__dirname, '..'), LIMIT = L.LIMITS.backupBytes;
const OUTPUT = process.env.MONEYGO_SAVE_PREFLIGHT_EVIDENCE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'moneygo-save-preflight-'));
const KEY = L.STORAGE_KEY, RECOVERY = 'moneygo.ledger.beforeRestore.v1', NOTE = 'moneygo.backupVerification.note.v1';
const smallOnly = process.argv.includes('--representative-only');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const bytes = value => Buffer.byteLength(value, 'utf8');
const paths = ['dist/save-preflight.js', 'dist/app-runtime-v1.js', 'dist/ledger.js', 'dist/relations.js', 'dist/importer.js', 'dist/scenario.js', 'dist/organizer.js', 'dist/obligations.js', 'dist/income-planning.js', 'dist/spending-planning.js', 'dist/refund-receipts.js', 'dist/index.html', 'tests/save-preflight-resource.cjs', 'tests/save-preflight-fixtures.cjs', 'tests/actual-entry-host.cjs', 'tests/refund-receipts-boundary/resources.cjs', 'tests/refund-receipts-boundary/helpers.cjs', 'tests/spending-boundary-combined-fixture.cjs'];
const pins = () => Object.fromEntries(paths.map(file => [file, { sha256: sha(fs.readFileSync(path.join(ROOT, file))), bytes: fs.statSync(path.join(ROOT, file)).size }]));
const sourcePins = pins(), report = { status: 'running', startedAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch, mode: smallOnly ? 'representative-only-not-resource-acceptance' : 'exclusive-serial-resource', backupLimitBytes: LIMIT, sourcePins, globalDatePatched: false, alternateCap: false, cases: [], measurements: [] };
fs.mkdirSync(OUTPUT, { recursive: true });
function write() { fs.writeFileSync(path.join(OUTPUT, 'resource-report.json'), JSON.stringify(report, null, 2) + '\n'); }
function measure(name, fn) {
  const start = performance.now(), out = fn();
  report.measurements.push({ name, elapsedMs: performance.now() - start, processPeakRssBytes: process.resourceUsage().maxRSS * 1024 });
  write(); return out;
}
function actualEnvelope(state) {
  let raw = L.backup(state);
  const result = { bytes: bytes(raw), exportedAt: JSON.parse(/"exportedAt"\s*:\s*("[^"]*")/.exec(raw.slice(0, 256))[1]) };
  raw = null; return result;
}
function observeHost(raw) {
  const { host } = require('./actual-entry-host.cjs'), observation = { prepares: 0, prepareMs: 0, backupCalls: 0, parseCalls: 0, preparedRaw: null, attemptedBytes: [], saveInputs: [] };
  const app = host(ROOT, { entry: 'index.html', personal: { [KEY]: raw, [RECOVERY]: 'Synthetic retained recovery sentinel', [NOTE]: 'Synthetic optional note sentinel' }, afterScript(file, context, window) {
    if (file === 'ledger.js') {
      const real = window.MoneygoLedger;
      window.MoneygoLedger = Object.freeze({ ...real, backup(...args) { observation.backupCalls++; return real.backup(...args); }, parseBackup(...args) { observation.parseCalls++; return real.parseBackup(...args); }, save(...args) { observation.saveInputs.push(args[1]); return real.save(...args); } });
    }
    if (file === 'save-preflight.js') {
      const real = window.MoneygoSavePreflight;
      window.MoneygoSavePreflight = Object.freeze({ prepare(...args) {
        observation.prepares++; const start = performance.now();
        try { const result = real.prepare(...args); observation.preparedRaw = result.compactRaw; return result; }
        finally { observation.prepareMs += performance.now() - start; }
      } });
    }
  } });
  assert.deepEqual(app.errors, []);
  app.store.onSet = (key, raw) => { if (key === KEY) { assert.ok(raw === observation.preparedRaw, 'every actual attempted string equals prepared compact bytes'); observation.attemptedBytes.push(bytes(raw)); } };
  app.counters.personalIO.length = 0;
  return { app, observation };
}
function fullHostSave(state, name) {
  const { app, observation } = observeHost(JSON.stringify(L.createEmpty()));
  app.put('__preparedResourceCandidate', state);
  measure(name + ': full ordinary host save', () => app.run('persist(__preparedResourceCandidate)'));
  assert.equal(observation.prepares, 1); assert.equal(observation.backupCalls, 1); assert.equal(observation.parseCalls, 1);
  assert.equal(observation.attemptedBytes.length, 1);
  assert.ok(app.personal.get(KEY) === observation.preparedRaw, 'stored accepted string equals prepared compact bytes');
  F.assertDetachedFrozen(observation.saveInputs[0], state);
  assert.deepEqual(app.counters.personalIO.map(row => row.slice(0, 2)), [['get', KEY], ['get', KEY], ['set', KEY]]);
  const result = { helperWithinHostMs: observation.prepareMs, actualAttemptedRawBytes: observation.attemptedBytes[0], actualAttemptedRawSha256: sha(app.personal.get(KEY)), onePreparation: true, helperPublicBackupCalls: 1, helperPublicParseCalls: 1, ledgerSets: 1, noNoteOrRecoveryIO: true };
  observation.preparedRaw = null; observation.saveInputs.length = 0; app.put('__preparedResourceCandidate', null); app.run('disposeRuntime("resource-complete")');
  return result;
}
function representative(name, factory) {
  let state = measure(name + ': fixture construction', factory);
  let prepared = measure(name + ': pure helper', () => P.prepare(state, L));
  const compactBytes = bytes(prepared.compactRaw); F.assertDetachedFrozen(prepared.state, state); prepared = null;
  const host = fullHostSave(state, name); state = null;
  report.cases.push({ name, status: 'passed', compactBytes, ...host }); write();
}
function exactBoundary() {
  const B = require('./refund-receipts-boundary/resources.cjs');
  let fixture = measure('exact boundary: public-writer fixture construction', () => B.backupExact());
  let state = fixture.candidate; const expenseId = fixture.expenseId, construction = fixture.construction;
  fixture = null;
  // Keep genuine imported nested history and add multibyte, emoji, quotes,
  // backslash and escaped controls to the current allowed transaction note.
  const imported = state.transactions.find(row => row.id !== expenseId && row.note.length > 100);
  assert.ok(imported); state = L.putTransaction(state, { ...imported, note: imported.note.slice(0, -100) }, imported.id);
  let expense = state.transactions.find(row => row.id === expenseId);
  state = L.putTransaction(state, { ...expense, note: '中😀"\\\t\n' }, expenseId);
  let under = actualEnvelope(state); assert.ok(under.bytes < LIMIT);
  expense = state.transactions.find(row => row.id === expenseId);
  state = L.putTransaction(state, { ...expense, note: expense.note + 'x'.repeat(LIMIT - under.bytes) }, expenseId);
  const envelope = actualEnvelope(state); assert.equal(envelope.bytes, LIMIT);
  let prepared = measure('exact boundary: pure helper', () => P.prepare(state, L));
  assert.equal(bytes(prepared.compactRaw), bytes(JSON.stringify(state))); prepared = null;
  const host = fullHostSave(state, 'exact boundary');
  const over = L.putTransaction(state, { ...state.transactions.find(row => row.id === expenseId), note: state.transactions.find(row => row.id === expenseId).note + 'x' }, expenseId);
  assert.equal(B.backupEnvelopeBytes(over, { format: 'moneygo-backup', version: state.version, exportedAt: envelope.exportedAt }), LIMIT + 1);
  assert.throws(() => L.backup(over), e => e.code === 'BACKUP_TOO_LARGE');
  const { app, observation } = observeHost(JSON.stringify(L.createEmpty())), originalRaw = app.personal.get(KEY), originalRecovery = app.personal.get(RECOVERY), originalNote = app.personal.get(NOTE);
  app.put('__overCapacity', over); app.run('globalThis.__originalState = state; globalThis.__originalSavedRaw = savedRaw');
  measure('exact boundary plus one: host refusal', () => assert.throws(() => app.run('persist(__overCapacity)'), e => e.code === 'SAVE_BACKUP_CAPACITY' && e.phase === 'backup'));
  assert.ok(app.personal.get(KEY) === originalRaw, 'original raw retained'); assert.equal(app.personal.get(RECOVERY), originalRecovery); assert.equal(app.personal.get(NOTE), originalNote);
  assert.equal(app.run('state === __originalState && savedRaw === __originalSavedRaw'), true);
  assert.equal(app.counters.personalIO.filter(row => row[0] !== 'get').length, 0); assert.equal(observation.prepares, 1); assert.equal(observation.backupCalls, 1); assert.equal(observation.parseCalls, 0);
  app.run('disposeRuntime("resource-complete")');
  report.cases.push({ name: 'real envelope exactly cap and plus one', status: 'passed', actualEnvelopeBytes: envelope.bytes, actualExportedAt: envelope.exportedAt, oneOverEnvelopeBytes: LIMIT + 1, oneOverMeasurement: 'Approved existing envelope byte oracle with the real accepted writer header; unchanged public backup actually refuses the plus-one state.', noWritesOnRefusal: true, construction, containsChinesePairedEmojiQuotesEscapedControlsAndNestedHistory: true, ...host }); write();
}
async function crossingAndRecovery() {
  const B = require('./refund-receipts-boundary/resources.cjs'), H = require('./refund-receipts-boundary/helpers.cjs');
  let initial = measure('refund crossing: initial public imported fixture', () => B.imported(2400, []));
  const overhead = actualEnvelope(initial.s).bytes - bytes(JSON.stringify(initial.s)); initial = null;
  let fixture = measure('refund crossing: public-writer near-limit fixture', () => B.rawExact(LIMIT - overhead - 500));
  const before = actualEnvelope(fixture.s); assert.equal(before.bytes, LIMIT - 500);
  let candidate = measure('refund crossing: actual public allocator', () => H.R.allocateRefund(fixture.s, H.command(fixture)));
  const candidateBytes = B.backupEnvelopeBytes(candidate, { format: 'moneygo-backup', version: candidate.version, exportedAt: before.exportedAt });
  assert.ok(candidateBytes > LIMIT); assert.ok(bytes(JSON.stringify(candidate)) < LIMIT);
  assert.throws(() => L.backup(candidate), e => e.code === 'BACKUP_TOO_LARGE');
  const sourceRaw = JSON.stringify(fixture.s), { app, observation } = observeHost(sourceRaw);
  app.put('__crossingCandidate', candidate); app.run('globalThis.__originalState = state; globalThis.__originalSavedRaw = savedRaw');
  measure('refund crossing: full host refusal', () => assert.throws(() => app.run('persist(__crossingCandidate)'), e => e.code === 'SAVE_BACKUP_CAPACITY' && e.phase === 'backup'));
  assert.ok(app.personal.get(KEY) === sourceRaw, 'source raw retained'); assert.equal(app.personal.get(RECOVERY), 'Synthetic retained recovery sentinel'); assert.equal(app.personal.get(NOTE), 'Synthetic optional note sentinel');
  assert.equal(app.run('state === __originalState && savedRaw === __originalSavedRaw'), true);
  assert.equal(app.counters.personalIO.filter(row => row[0] !== 'get').length, 0); assert.equal(observation.prepares, 1);
  app.run('disposeRuntime("resource-complete")');
  report.cases.push({ name: 'recorded real refund crossing', status: 'passed', sourceEnvelopeBytes: before.bytes, sourceUnderLimitBytes: LIMIT - before.bytes, finalCandidateEnvelopeBytes: candidateBytes, finalCandidateOverLimitBytes: candidateBytes - LIMIT, actualExportedAt: before.exportedAt, realAllocatorFinalCandidateChecked: true, noWrites: true, priorStateAndRawPreserved: true, construction: fixture.construction }); write();
  fixture = null;
  await recovery(candidate); sandboxReset(candidate); candidate = null;
}
async function recovery(oversized) {
  const raw = JSON.stringify(oversized), { app, observation } = observeHost(raw);
  // Recovery intentionally has no prepare requirement and accepts compact-valid
  // source/retained data even when the standard pretty envelope cannot fit.
  app.store.onSet = null;
  app.node('[data-page="backup"]').click();
  assert.ok(app.node('[data-action="export-raw"]')); assert.ok(app.node('[data-action="export-recovery-raw"]'));
  assert.throws(() => app.run('L.backup(state)'), e => e.code === 'BACKUP_TOO_LARGE');
  let file = L.backup(L.createEmpty()); app.run('showRestore()');
  const input = app.node('#restore-file'); await input.onchange({ target: { files: [{ size: bytes(file), text: async () => file }] } });
  assert.ok(app.node('#confirm-restore')); app.node('#restore-consent').checked = true; app.node('#restore-consent').dispatch('change');
  app.counters.personalIO.length = 0;
  measure('oversized-source recovery: selected smaller backup save', () => app.node('#confirm-restore').click());
  assert.ok(app.personal.get(RECOVERY) === raw, 'original source staged verbatim'); assert.equal(app.personal.get(KEY), JSON.stringify(L.createEmpty()));
  assert.equal(observation.prepares, 0);
  assert.deepEqual(app.counters.personalIO.slice(0, 6).map(row => row.slice(0, 2)), [['get', KEY], ['get', RECOVERY], ['set', RECOVERY], ['get', RECOVERY], ['get', KEY], ['set', KEY]]);
  app.run('rollback()'); assert.ok(app.node('#confirm-rollback'));
  measure('oversized-source recovery: undo compact-valid non-exportable copy', () => app.node('#confirm-rollback').click());
  assert.ok(app.personal.get(KEY) === raw, 'undo restores original compact bytes'); assert.equal(observation.prepares, 0);
  assert.throws(() => app.run('L.backup(state)'), e => e.code === 'BACKUP_TOO_LARGE');
  app.node('[data-page="backup"]').click(); assert.ok(app.node('[data-action="export-raw"]')); assert.ok(app.node('[data-action="export-recovery-raw"]'));
  report.cases.push({ name: 'oversized source selected restore and undo', status: 'passed', sourceCompactBytes: bytes(raw), sourceCompactSha256: sha(raw), sourceExportRefused: true, realSelectedFileParsed: true, sourceStagedVerbatim: true, restoreOrderUnchanged: true, undoRestoredNonExportableCopy: true, prepareCalls: 0, rawControlsReachableBeforeAndAfter: true }); write();
  // A13: ordinary edits may replace this whole oversized source with a smaller
  // final candidate. Only the final candidate needs to pass preparation.
  observation.prepares = 0; observation.backupCalls = 0; observation.parseCalls = 0; observation.preparedRaw = null;
  app.store.onSet = (key, value) => { if (key === KEY) assert.ok(value === observation.preparedRaw, 'smaller ordinary candidate attempted exact prepared bytes'); };
  const smaller = L.createEmpty(); app.put('__smallerCandidate', smaller); app.counters.personalIO.length = 0;
  measure('oversized source: ordinary smaller final candidate save', () => app.run('persist(__smallerCandidate)'));
  assert.ok(app.personal.get(KEY) === JSON.stringify(smaller)); assert.equal(observation.prepares, 1); assert.equal(observation.backupCalls, 1); assert.equal(observation.parseCalls, 1);
  assert.deepEqual(app.counters.personalIO.map(row => row.slice(0, 2)), [['get', KEY], ['get', KEY], ['set', KEY]]);
  report.cases.push({ name: 'ordinary smaller candidate from non-exportable source', status: 'passed', prepareCalls: 1, sourceNeedNotExport: true, actualAttemptedRawBytes: bytes(app.personal.get(KEY)) }); write();
  // A15: the source is small now. The supported compact v4 selected file fits
  // the input cap although its standard pretty re-export is too large. Its
  // bookkeeping v2 means this is the established parse-only restore branch.
  assert.equal(oversized.version, 4); assert.equal(oversized.bookkeeping.version, 2);
  let selected = JSON.parse(L.backup(smaller)); selected.version = oversized.version; selected.data = oversized;
  const compactFile = JSON.stringify(selected); selected = null;
  assert.ok(bytes(compactFile) < LIMIT); F.assertDataEqual(L.parseBackup(compactFile), oversized);
  app.store.onSet = null; observation.prepares = 0; app.run('showRestore()');
  await app.node('#restore-file').onchange({ target: { files: [{ size: bytes(compactFile), text: async () => compactFile }] } });
  app.node('#restore-consent').checked = true; app.node('#restore-consent').dispatch('change');
  measure('compact oversized selected target: parse-only restore', () => app.node('#confirm-restore').click());
  assert.ok(app.personal.get(KEY) === raw, 'compact selected target restored without preflight'); assert.equal(observation.prepares, 0);
  assert.throws(() => app.run('L.backup(state)'), e => e.code === 'BACKUP_TOO_LARGE');
  app.run('rollback()'); measure('compact oversized selected target: undo', () => app.node('#confirm-rollback').click());
  assert.ok(app.personal.get(KEY) === JSON.stringify(smaller)); assert.equal(observation.prepares, 0);
  report.cases.push({ name: 'compact selected v4 parse-only oversized target retains recovery exemption', status: 'passed', selectedCompactEnvelopeBytes: bytes(compactFile), actualTargetCompactBytes: bytes(raw), prettyExportRefused: true, selectedRestoreAccepted: true, undoAccepted: true, prepareCalls: 0 }); write();
  observation.preparedRaw = null; observation.saveInputs.length = 0; app.run('disposeRuntime("resource-complete")');
}
function sandboxReset(oversized) {
  const S = require('../dist/scenario.js');
  const settings = S.defaultSettings();
  settings.scenarios[0].oneOffs = Array.from({ length: 20 }, (_, i) => ({ id: 'synthetic-reset-once-' + i, name: 'Synthetic future planning item ' + i, month: '2026-12', categoryId: 'expense-other', amountCents: 1 }));
  const approvedSettings = S.validate(settings);
  function run(state, success, expected) {
    const sourceRaw = JSON.stringify(state), { app, observation } = observeHost(sourceRaw);
    assert.throws(() => L.backup(state), e => e.code === 'BACKUP_TOO_LARGE');
    app.run('confirmScenarioAction("reset-sandbox")'); app.counters.personalIO.length = 0;
    measure('real oversized sandbox reset: ' + (success ? 'full-relief success' : 'partial-relief refusal'), () => app.node('#confirm-scenario-action').click());
    assert.equal(observation.prepares, 1); assert.equal(observation.backupCalls, 1);
    if (success) {
      assert.ok(app.personal.get(KEY) === JSON.stringify(expected), 'reset saved the complete expected final ledger');
      assert.equal(observation.parseCalls, 1); assert.equal(observation.attemptedBytes.length, 1);
      assert.equal(app.node('#modal-root').innerHTML, '');
    } else {
      assert.ok(app.personal.get(KEY) === sourceRaw, 'refused reset preserves source');
      assert.equal(app.counters.personalIO.filter(row => row[0] !== 'get').length, 0);
      assert.equal(app.node('#form-error').textContent, '沙盘重置后的完整账本仍超过备份容量，重置未保存。请先到「数据备份」下载原始恢复数据，或恢复较小的有效备份。');
      assert.ok(app.node('#confirm-scenario-action'), 'refused reset keeps modal usable');
    }
    assert.equal(app.personal.get(RECOVERY), 'Synthetic retained recovery sentinel'); assert.equal(app.personal.get(NOTE), 'Synthetic optional note sentinel');
    observation.preparedRaw = null; observation.saveInputs.length = 0; app.run('disposeRuntime("resource-complete")');
  }
  let partial = L.validateState({ ...oversized, simulation: approvedSettings });
  const partialFinal = L.validateState({ ...oversized, simulation: S.defaultSettings() });
  assert.throws(() => L.backup(partialFinal), e => e.code === 'BACKUP_TOO_LARGE');
  assert.ok(bytes(JSON.stringify(partialFinal)) < bytes(JSON.stringify(partial)), 'reset removes assumptions but insufficiently');
  run(partial, false); partial = null;
  // Remove only two current transaction notes through unchanged public writers;
  // all retained import/history snapshots remain intact. This reuses the giant
  // fixture rather than constructing or sweeping another near-limit population.
  let reduced = oversized;
  for (const row of oversized.transactions.filter(row => bytes(row.note) >= 1500).slice(0, 2)) reduced = L.putTransaction(reduced, { ...row, note: '' }, row.id);
  let expected = L.validateState({ ...reduced, simulation: S.defaultSettings() });
  const acceptedEnvelope = actualEnvelope(expected); assert.ok(acceptedEnvelope.bytes < LIMIT);
  let fullRelief = L.validateState({ ...reduced, simulation: approvedSettings }); reduced = null;
  assert.throws(() => L.backup(fullRelief), e => e.code === 'BACKUP_TOO_LARGE');
  run(fullRelief, true, expected); fullRelief = null; expected = null;
  report.cases.push({ name: 'genuine oversized sandbox reset partial and full relief', status: 'passed', partialReliefRefusedWithoutMutation: true, fullReliefAccepted: true, fullReliefRealFinalEnvelopeBytes: acceptedEnvelope.bytes, realConfirmationControlsUsed: true, noteAndRecoveryPreserved: true, financialAndRetainedHistoryUntouchedByReset: true }); write();
}
(async () => {
  try {
    write(); representative('normal small ledger', () => L.createEmpty()); representative('nontrivial combined v8 ledger', F.combined);
    if (!smallOnly) { exactBoundary(); await crossingAndRecovery(); }
    assert.deepEqual(pins(), sourcePins, 'source and tests remain pinned throughout resource measurement');
    report.status = 'passed'; report.finishedAt = new Date().toISOString(); report.caseCount = report.cases.length; report.processPeakRssBytes = process.resourceUsage().maxRSS * 1024;
    report.measurementCaveat = 'Serial synthetic Node/VM host measurements; peak RSS is cumulative process high-water mark, not native browser quota or a universal latency promise. No expanded boundary sweep.';
    write(); console.log(JSON.stringify({ status: report.status, mode: report.mode, caseCount: report.caseCount, processPeakRssBytes: report.processPeakRssBytes, evidenceDirectory: OUTPUT }));
  } catch (error) {
    report.status = 'failed'; report.failure = { name: error.name, code: error.code, message: error.message, stack: error.stack }; report.finishedAt = new Date().toISOString(); report.processPeakRssBytes = process.resourceUsage().maxRSS * 1024; write(); console.error(error); process.exitCode = 1;
  }
})();
