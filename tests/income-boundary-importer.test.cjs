'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const L = require('../dist/ledger.js');
const I = require('../dist/importer.js');
const clone = value => JSON.parse(JSON.stringify(value));
const AT = '2026-10-14T12:00:00.000Z';
const SOURCE = 'income-boundary-import';
const source = fs.readFileSync(require.resolve('../dist/importer.js'), 'utf8');
const errorCode = code => error => error && error.code === code;
function config(extra = {}) { return { sourceKey: SOURCE, accountId: 'account-cash', delimiter: ',', columns: { date: 'date', amount: 'amount', direction: 'direction', stableId: 'id', status: 'status' }, ...extra }; }
function csv(rows = [['2026-10-14', '10', 'income', 'source-1', 'completed']]) { return 'date,amount,direction,id,status\n' + rows.map(row => row.join(',')).join('\n'); }
function apply(state, rows, cfg = config(), importer = I) { const p = importer.preview(state, csv(rows), cfg); return importer.commit(state, p, p.rows.filter(row => ['new', 'candidate', 'update', 'status'].includes(row.action)).map(row => row.key)); }
function planningState(variant = 'current', identity = 'boundary-plan', input = L.createEmpty()) {
  const state = clone(input), plan = { id: variant === 'current' || variant === 'retired' ? identity : 'boundary-plan', createdAt: AT, name: 'Synthetic income plan', certainty: 'expectation', expectedAmountCents: null, expectedDate: null, expectedAccountId: variant === 'borrowed' ? identity : null, status: 'open', basis: '', note: '' };
  const audit = [{ id: variant === 'audit' ? identity : 'boundary-create', revision: 1, at: AT, kind: 'plan', recordId: plan.id, action: 'create', reason: 'Synthetic setup', before: null, after: clone(plan), reverses: null }];
  if (variant === 'retired') audit.push({ id: 'boundary-retire', revision: 2, at: AT, kind: 'plan', recordId: plan.id, action: 'retire', reason: 'Synthetic retirement', before: clone(plan), after: null, reverses: null });
  state.version = 7; state.incomePlanning = { version: 1, revision: audit.length, plans: variant === 'retired' ? [] : [plan], receipts: [], audit };
  return L.validateState(state);
}
function withReceipt(input, transaction) {
  const state = clone(planningState('current', 'boundary-plan', input));
  const receipt = { id: 'boundary-receipt', createdAt: AT, reviewedAsOfDate: '2026-10-14', planId: 'boundary-plan', transactionId: transaction.id, amountCents: 500, proof: { version: 1, source: { id: transaction.id, type: 'income', date: transaction.date, amountCents: transaction.amountCents, accountId: transaction.accountId, toAccountId: null }, role: 'ordinary-primary', duplicateEvidence: [], reductions: [], ordinaryIncomeCents: transaction.amountCents }, reference: 'Synthetic attribution' };
  state.incomePlanning.receipts = [receipt]; state.incomePlanning.revision = 2;
  state.incomePlanning.audit.push({ id: 'boundary-receipt-create', revision: 2, at: AT, kind: 'receipt', recordId: receipt.id, action: 'create', reason: 'Synthetic allocation', before: null, after: clone(receipt), reverses: null });
  return L.validateState(state);
}
// Private hash instrumentation is test-only. It forces a deterministic candidate
// without changing the real Ledger collector or introducing production hooks.
function importerHarness({ hash, engine = L, script = source, fixedTime = false } = {}) {
  const calls = { collect: [], validate: 0 };
  const facade = { ...engine, validateState(value) { calls.validate++; return engine.validateState(value); }, collectRetainedIdentities(value) { calls.collect.push(value); return engine.collectRetainedIdentities(value); } };
  const marker = 'function hash(value) {';
  assert.equal(script.split(marker).length, 2);
  const instrumented = script.replace(marker, marker + '\n    if (root.testHash) { const forced = root.testHash(value); if (forced !== undefined) return forced; }');
  const wrapper = vm.runInThisContext('(function (module, require, window, Date) { ' + instrumented + '; return module.exports; })');
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [AT])); } static now() { return Date.parse(AT); } }
  const importer = wrapper({ exports: {} }, name => { assert.equal(name, './ledger.js'); return facade; }, { testHash: hash }, fixedTime ? FixedDate : Date);
  return { importer, calls };
}
function forcedHash(kind) {
  return value => {
    if (!Array.isArray(value)) return undefined;
    if (kind === 'template' && value.length === 4 && value[0] === SOURCE) return 'blocked';
    if (kind === 'evidence' && value.length === 3 && value[0] === SOURCE) return 'blocked';
    if (kind === 'batch' && value.length === 3 && typeof value[0] === 'string' && value[0].startsWith('preview-')) return 'blocked';
    if (['transaction', 'quarantine'].includes(kind) && value.length === 2 && typeof value[0] === 'string' && value[0].startsWith('batch-') && typeof value[1] === 'string' && value[1].startsWith('row-')) return 'blocked';
    if (kind === 'coverage' && value.length === 2 && typeof value[0] === 'string' && value[0].startsWith('batch-') && value[1] && typeof value[1] === 'object') return 'blocked';
    if (kind === 'template-audit' && value.length === 3 && value[0] === 'template') return 'blocked';
    if (kind === 'commit-audit' && value.length === 2 && value[1] === 'commit') return 'blocked';
    if (kind === 'rollback-audit' && value.length === 2 && value[1] === 'rollback') return 'blocked';
    return undefined;
  };
}
const prefixes = { template: 'template-', evidence: 'evidence-', batch: 'batch-', transaction: 'transaction-import-', quarantine: 'quarantine-', coverage: 'coverage-', 'template-audit': 'audit-', 'commit-audit': 'audit-', 'rollback-audit': 'audit-' };
for (const kind of Object.keys(prefixes)) for (const variant of ['current', 'retired', 'audit', 'borrowed']) {
  test('v7 ' + kind + ' rejects a retained ' + variant + ' planning identity atomically', () => {
    const base = kind === 'rollback-audit' ? apply(L.createEmpty()) : L.createEmpty();
    const state = planningState(variant, prefixes[kind] + 'blocked', base), before = JSON.stringify(state);
    const { importer, calls } = importerHarness({ hash: forcedHash(kind) });
    let action;
    if (kind === 'template-audit') {
      const p = importer.preview(state, csv(), config());
      action = () => importer.saveTemplate(state, { headers: p.headers, config: p.config });
    } else if (kind === 'rollback-audit') action = () => importer.rollback(state, state.imports.batches[0].id);
    else {
      const cfg = kind === 'coverage' ? config({ coverage: { start: '2026-10-01', end: '2026-10-31', confirmed: true } }) : config();
      const p = importer.preview(state, kind === 'quarantine' ? csv([['bad', '10', 'income', 'bad-row', 'completed']]) : csv(), cfg);
      action = () => importer.commit(state, p, kind === 'quarantine' ? [] : [p.rows[0].key]);
    }
    assert.throws(action, errorCode('IDENTITY_COLLISION'));
    assert.equal(JSON.stringify(state), before);
    assert.equal(calls.collect.length, 1);
    assert.equal(calls.collect[0], state, 'reserve from the original complete command-start input');
    assert.deepEqual(L.validateState(state), state);
  });
}

test('v7 saveTemplate reserves a new template and its event together, then permits exact reuse and rename', () => {
  let state = planningState(), p = I.preview(state, csv(), config());
  const { importer, calls } = importerHarness();
  const before = JSON.stringify(state.incomePlanning);
  state = importer.saveTemplate(state, { headers: p.headers, config: p.config, name: 'Original' });
  assert.equal(calls.collect.length, 1); assert.equal(state.version, 7); assert.equal(JSON.stringify(state.incomePlanning), before);
  const noOp = importer.saveTemplate(state, { headers: p.headers, config: p.config, name: 'Original' });
  assert.deepEqual(noOp, state);
  const renamed = importer.saveTemplate(state, { headers: p.headers, config: p.config, name: 'Renamed' });
  assert.equal(renamed.imports.templates.length, 1); assert.equal(renamed.imports.templates[0].id, state.imports.templates[0].id);
  assert.equal(renamed.imports.templates[0].name, 'Renamed'); assert.equal(JSON.stringify(renamed.incomePlanning), before);
});

test('v7 same-source completed, cancelled and restored identities continue without planning locks', () => {
  let state = apply(L.createEmpty()); const transaction = clone(state.transactions[0]);
  state = withReceipt(state, transaction); const planning = JSON.stringify(state.incomePlanning);
  const evidenceId = state.imports.evidence[0].id, templateId = state.imports.templates[0].id;
  state = apply(state, [['2026-10-14', '9', 'income', 'source-1', 'completed']]);
  assert.equal(state.transactions[0].id, transaction.id); assert.equal(state.transactions[0].amountCents, 900);
  assert.equal(state.imports.evidence[0].id, evidenceId); assert.equal(state.imports.templates[0].id, templateId);
  assert.equal(JSON.stringify(state.incomePlanning), planning);
  state = apply(state, [['2026-10-14', '9', 'income', 'source-1', 'cancelled']]);
  const cancelBatch = state.imports.batches.at(-1).id;
  assert.equal(state.transactions.length, 0); assert.equal(state.trash[0].id, transaction.id); assert.equal(JSON.stringify(state.incomePlanning), planning);
  state = apply(state, [['2026-10-14', '9', 'income', 'source-1', 'completed']]);
  assert.equal(state.transactions[0].id, transaction.id); assert.equal(state.trash.length, 0);
  state = I.rollback(state, state.imports.batches.at(-1).id).state;
  assert.equal(state.trash[0].id, transaction.id);
  state = I.rollback(state, cancelBatch).state;
  assert.equal(state.transactions[0].id, transaction.id); assert.equal(state.transactions[0].amountCents, 900);
  assert.equal(JSON.stringify(state.incomePlanning), planning); assert.equal(state.version, 7);
});

test('v7 pending evidence becomes completed under the same evidence owner and reserves its new transaction', () => {
  let state = apply(planningState(), [['2026-10-14', '10', 'income', 'source-1', 'pending']]);
  const evidenceId = state.imports.evidence[0].id, planning = JSON.stringify(state.incomePlanning);
  assert.equal(state.transactions.length, 0);
  state = apply(state);
  assert.equal(state.imports.evidence[0].id, evidenceId); assert.equal(state.transactions.length, 1);
  assert.equal(JSON.stringify(state.incomePlanning), planning);
});

test('production hashes reject known template, evidence and template/rollback event collisions', () => {
  const empty = L.createEmpty(), p = I.preview(empty, csv(), config());
  const templateState = I.saveTemplate(empty, { headers: p.headers, config: p.config });
  for (const identity of [templateState.imports.templates[0].id, templateState.imports.audit[0].id]) {
    const state = planningState('borrowed', identity), before = JSON.stringify(state);
    assert.throws(() => I.saveTemplate(state, { headers: p.headers, config: p.config }), errorCode('IDENTITY_COLLISION'));
    assert.equal(JSON.stringify(state), before);
  }
  const original = apply(empty), evidenceState = planningState('retired', original.imports.evidence[0].id);
  assert.throws(() => apply(evidenceState), errorCode('IDENTITY_COLLISION'));
  const rollback = I.rollback(original, original.imports.batches[0].id);
  const state = planningState('audit', rollback.state.imports.audit.at(-1).id, original);
  assert.throws(() => I.rollback(state, state.imports.batches[0].id), errorCode('IDENTITY_COLLISION'));
});

for (const stableId of ['source-1', '']) test('v7 rollback and reimport preserve the exact old evidence owner for ' + (stableId ? 'a stable source' : 'an identical ID-less occurrence'), () => {
  const rows = [['2026-10-14', '10', 'income', stableId, 'completed']];
  const original = apply(L.createEmpty(), rows), oldEvidenceId = original.imports.evidence[0].id, oldTransactionId = original.transactions[0].id;
  const state = withReceipt(original, original.transactions[0]), planning = JSON.stringify(state.incomePlanning);
  const rolledBack = I.rollback(state, state.imports.batches[0].id).state;
  const reimported = apply(rolledBack, rows);
  assert.equal(reimported.imports.evidence[0].id, oldEvidenceId);
  assert.notEqual(reimported.transactions[0].id, oldTransactionId, 'new posting keeps the legacy new-transaction identity rule');
  assert.equal(JSON.stringify(reimported.incomePlanning), planning);
  const oldI = require('./fixtures/income-readers-v015/importer.js');
  const oldRollback = oldI.rollback(original, original.imports.batches[0].id).state;
  const legacyReimported = apply(oldRollback, rows, config(), oldI);
  assert.equal(legacyReimported.imports.evidence[0].id, reimported.imports.evidence[0].id);
  assert.equal(legacyReimported.transactions[0].amountCents, reimported.transactions[0].amountCents);
  assert.equal(I.preview(reimported, csv(rows), config()).rows[0].action, 'duplicate');
});

for (const stableId of ['source-1', '']) test('v7 historical evidence continuation requires its original ' + (stableId ? 'source tuple' : 'ID-less row identity'), () => {
  const rows = [['2026-10-14', '10', 'income', stableId, 'completed']];
  const { importer } = importerHarness({ hash: forcedHash('evidence') });
  const original = apply(L.createEmpty(), rows, config(), importer);
  const state = planningState('current', 'boundary-plan', original);
  const rolledBack = importer.rollback(state, state.imports.batches[0].id).state, before = JSON.stringify(rolledBack);
  assert.equal(apply(rolledBack, rows, config(), importer).imports.evidence[0].id, 'evidence-blocked');
  const differentRows = [['2026-10-14', '11', 'income', stableId ? 'other-source' : '', 'completed']];
  assert.throws(() => apply(rolledBack, differentRows, config(), importer), errorCode('IDENTITY_COLLISION'));
  assert.equal(JSON.stringify(rolledBack), before);
});

test('v7 historical evidence continuation does not waive new transaction reservation', () => {
  const original = apply(L.createEmpty()), transactionId = original.transactions[0].id;
  const state = planningState('current', 'boundary-plan', original), rolledBack = I.rollback(state, state.imports.batches[0].id).state;
  const { importer } = importerHarness({ hash(value) { return forcedHash('transaction')(value) === undefined ? undefined : transactionId.slice('transaction-import-'.length); } });
  assert.throws(() => apply(rolledBack, undefined, config(), importer), errorCode('IDENTITY_COLLISION'));
  assert.equal(rolledBack.transactions.length, 0);
});

test('v7 rollback removes imported source despite live attribution and retains all historical identity strings', () => {
  const original = apply(L.createEmpty()), transaction = clone(original.transactions[0]);
  const state = withReceipt(original, transaction), planning = JSON.stringify(state.incomePlanning);
  const { importer, calls } = importerHarness();
  const result = importer.rollback(state, state.imports.batches[0].id);
  assert.equal(result.rolledBack, true); assert.equal(result.state.transactions.length, 0); assert.equal(result.state.imports.evidence.length, 0);
  assert.equal(JSON.stringify(result.state.incomePlanning), planning); assert.equal(calls.collect.length, 1); assert.equal(calls.collect[0], state);
  const retained = new Set(L.collectRetainedIdentities(result.state).map(row => row.id));
  assert.ok(retained.has(transaction.id)); assert.ok(retained.has(original.imports.evidence[0].id));
  assert.deepEqual(L.parseBackup(L.backup(result.state)), result.state);
});

test('v7 previews bind planning bytes and preserve repeated-commit and same-source idempotency', () => {
  const state = planningState(), p = I.preview(state, csv(), config());
  const changed = clone(state), plan = clone(changed.incomePlanning.plans[0]);
  changed.incomePlanning.plans[0].note = 'Changed planning annotation';
  changed.incomePlanning.audit.push({ id: 'boundary-update', revision: 2, at: AT, kind: 'plan', recordId: plan.id, action: 'update', reason: 'Synthetic metadata change', before: plan, after: clone(changed.incomePlanning.plans[0]), reverses: null }); changed.incomePlanning.revision = 2;
  const validChanged = L.validateState(changed);
  assert.throws(() => I.commit(validChanged, p, [p.rows[0].key]), errorCode('STALE_PREVIEW'));
  const saved = I.commit(state, p, [p.rows[0].key]);
  assert.deepEqual(I.commit(saved, p, [p.rows[0].key]), saved);
  assert.equal(I.preview(saved, csv(), config()).rows[0].action, 'duplicate');
  assert.throws(() => I.commit(state, clone(p), [p.rows[0].key]), errorCode('INVALID_PREVIEW'));
});

test('v7 repair and coverage lifecycle preserves planning and reserves only at valid command boundaries', () => {
  const initial = planningState('retired', 'boundary-retired'); const planning = JSON.stringify(initial.incomePlanning);
  const { importer, calls } = importerHarness();
  let state = apply(initial, [['bad', '10', 'income', 'repair-source', 'completed']], config({ coverage: { start: '2026-10-01', end: '2026-10-31', confirmed: true } }), importer);
  assert.equal(calls.collect.length, 1); assert.equal(calls.collect[0], initial);
  const q = state.imports.quarantine[0], preview = importer.previewRepair(state, q.id, { date: '2026-10-14' });
  const beforeRepair = state; state = importer.commit(state, preview, [preview.rows[0].key]);
  assert.equal(calls.collect.length, 2); assert.equal(calls.collect[1], beforeRepair); assert.equal(state.transactions.length, 1);
  assert.equal(JSON.stringify(state.incomePlanning), planning);
  const beforeRollback = state; state = importer.rollback(state, state.imports.batches.at(-1).id).state;
  assert.equal(calls.collect.length, 3); assert.equal(calls.collect[2], beforeRollback); assert.equal(state.transactions.length, 0);
  assert.equal(state.imports.quarantine[0].resolvedByBatchId, null); assert.equal(state.imports.coverage.length, 1);
  assert.equal(JSON.stringify(state.incomePlanning), planning);
});

test('v7 collector/full-model calls are bounded per command, not per import row', () => {
  for (const count of [1, 30, 120]) {
    const state = planningState(), { importer, calls } = importerHarness();
    const rows = Array.from({ length: count }, (_, i) => ['2026-10-14', '1', 'income', 'source-' + i, 'completed']);
    const p = importer.preview(state, csv(rows), config()); const beforeCalls = calls.validate;
    const saved = importer.commit(state, p, p.rows.map(row => row.key));
    assert.equal(saved.transactions.length, count); assert.equal(calls.collect.length, 1); assert.equal(calls.validate - beforeCalls, 2);
    assert.equal(calls.collect[0], state);
  }
});

test('v7 allocations add fresh identities to the same command-local reservation set', () => {
  const state = planningState(), before = JSON.stringify(state);
  const { importer, calls } = importerHarness({ hash: forcedHash('quarantine') });
  const p = importer.preview(state, csv([['bad', '1', 'income', 'bad-1', 'completed'], ['bad', '2', 'income', 'bad-2', 'completed']]), config());
  assert.throws(() => importer.commit(state, p, []), errorCode('IDENTITY_COLLISION'));
  assert.equal(calls.collect.length, 1); assert.equal(JSON.stringify(state), before);
});

test('v7 malformed history/accessors fail before any importer allocation or state mutation', () => {
  const state = planningState(), p = I.preview(state, csv(), config()), before = JSON.stringify(state);
  const bad = clone(state); bad.incomePlanning.audit[0].after.name = 'Different unjournaled name';
  for (const action of [() => I.preview(bad, csv(), config()), () => I.saveTemplate(bad, { headers: p.headers, config: p.config }), () => I.commit(bad, p, [p.rows[0].key]), () => I.rollback(bad, 'missing')]) assert.throws(action);
  let touched = 0; const getter = clone(state); Object.defineProperty(getter.incomePlanning.plans[0], 'note', { enumerable: true, get() { touched++; return ''; } });
  assert.throws(() => I.saveTemplate(getter, { headers: p.headers, config: p.config })); assert.equal(touched, 0); assert.equal(JSON.stringify(state), before);
});

test('outer1–6 importer output stays identical to the frozen v0.15 dependency closure', () => {
  const oldL = require('./fixtures/income-readers-v015/ledger.js');
  const oldSource = fs.readFileSync(require.resolve('./fixtures/income-readers-v015/importer.js'), 'utf8');
  const all = JSON.parse(fs.readFileSync(require.resolve('./fixtures/all-extensions-v6.json'), 'utf8')).data;
  const extensions = ['simulation', 'imports', 'bookkeeping', 'organizer', 'obligations'];
  for (let version = 1; version <= 6; version++) {
    const input = clone(all); input.version = version;
    for (let i = version - 1; i < extensions.length; i++) delete input[extensions[i]];
    const state = oldL.validateState(input);
    const current = importerHarness({ fixedTime: true });
    const old = importerHarness({ engine: oldL, script: oldSource, fixedTime: true });
    const nowSaved = apply(state, undefined, config(), current.importer), oldSaved = apply(state, undefined, config(), old.importer);
    assert.deepEqual(nowSaved, oldSaved, 'legacy outer ' + version);
    assert.deepEqual(current.importer.rollback(nowSaved, nowSaved.imports.batches.at(-1).id), old.importer.rollback(oldSaved, oldSaved.imports.batches.at(-1).id));
    assert.equal(current.calls.collect.length, 0, 'legacy writers never invoke the v7 descriptor/collector path');
  }
});
