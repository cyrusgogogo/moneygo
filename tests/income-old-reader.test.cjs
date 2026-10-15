'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const folder = path.join(__dirname, 'fixtures/income-readers-v015');
const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'SHA256.json'), 'utf8'));

test('the actual final v0.15 reader dependency closure is immutable and complete', () => {
  assert.equal(manifest.sourceRelease, '0.15.0');
  const names = new Set(manifest.files.map(row => row.file));
  assert.equal(names.size, 8);
  for (const row of manifest.files) {
    const bytes = fs.readFileSync(path.join(folder, row.file));
    assert.equal(bytes.length, row.bytes, row.file);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), row.sha256, row.file);
    const source = bytes.toString('utf8');
    for (const match of source.matchAll(/require\(['"]\.\/([^'"]+)['"]\)/g)) {
      assert.ok(names.has(match[1]), 'Frozen reader dependency remains frozen: ' + row.file + ' -> ' + match[1]);
    }
    assert.doesNotMatch(source, /income-planning|income-core|retained-identities/);
  }
});

test('the frozen final v0.15 reader parses and loads real old-format fixtures without writes', () => {
  const old = require(path.join(folder, 'ledger.js'));
  const raw = fs.readFileSync(path.join(__dirname, 'fixtures/all-extensions-v6.json'), 'utf8');
  const state = old.parseBackup(raw);
  assert.equal(state.version, 6);
  const writes = [];
  const loaded = old.load({ getItem: () => JSON.stringify(state), setItem: (...args) => writes.push(args) });
  assert.equal(loaded.error, null);
  assert.deepEqual(loaded.state, state);
  assert.deepEqual(writes, []);
  for (const filename of Object.keys(require.cache).filter(name => name.startsWith(folder + path.sep))) {
    const cached = require.cache[filename];
    for (const child of cached.children) assert.ok(child.filename.startsWith(folder + path.sep), 'No candidate module dependency');
  }
});

test('genuine active, cancelled and retired v7 exports are rejected by the actual v0.15 reader', () => {
  const L = require('../dist/ledger.js'), P = require('../dist/income-planning.js');
  const old = require(path.join(folder, 'ledger.js'));
  const api = P.createCoordinator({ now: () => '2026-10-14T12:00:00.000Z', today: () => '2026-10-14' });
  const options = { asOfDate: '2026-10-14', horizonEnd: '2027-01-31', mode: 'planned' };
  const run = (state, command) => api.commit(state, api.preview(state, command, options), { confirmed: true, reason: 'SYNTHETIC root reader acceptance' });
  const legacy = L.parseBackup(fs.readFileSync(path.join(__dirname, 'fixtures/all-extensions-v6.json'), 'utf8'));
  const unchanged = JSON.stringify(legacy);
  P.view(legacy, { asOfDate: options.asOfDate });
  assert.equal(JSON.stringify(legacy), unchanged);
  assert.deepEqual(old.parseBackup(L.backup(legacy)), legacy);
  const active = run(legacy, { action: 'create-plan', plan: {
    name: 'SYNTHETIC genuine income plan', certainty: 'expectation',
    expectedAmountCents: 100000, expectedDate: '2026-11-01', expectedAccountId: 'account-cash', basis: '', note: ''
  } });
  const id = active.incomePlanning.plans[0].id;
  const cancelled = run(active, { action: 'update-plan', planId: id, patch: { status: 'cancelled' } });
  const retired = run(cancelled, { action: 'retire-plan', planId: id });
  assert.equal(retired.incomePlanning.plans.length, 0);
  assert.equal(retired.incomePlanning.audit.length, 3);
  for (const state of [active, cancelled, retired]) {
    assert.equal(state.version, 7);
    const backup = L.backup(state);
    assert.deepEqual(L.parseBackup(backup), state);
    assert.throws(() => old.validateState(state), error => error.code === 'INVALID_VERSION');
    assert.throws(() => old.parseBackup(backup), error => error.code === 'INVALID_VERSION');
    const writes = [];
    const loaded = old.load({ getItem: () => JSON.stringify(state), setItem: (...args) => writes.push(args) });
    assert.equal(loaded.error?.code, 'INVALID_VERSION');
    assert.deepEqual(writes, []);
    assert.deepEqual(loaded.state, old.createEmpty(), 'Fallback is accompanied by error and is never saved');
  }
});
