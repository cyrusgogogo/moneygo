'use strict';
// Explicit opt-in capacity measurement, not a timing assertion or an alternative oracle.
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const L = require('../dist/ledger.js'), O = require('../dist/organizer.js');
const { historyFixture } = require('./held-a-history-fixture.cjs');
const measurements = [];
function measured(label, fn) { const start = performance.now(), memory = process.memoryUsage().heapUsed; const result = fn(); measurements.push({ label, elapsedMs: Math.round(performance.now() - start), heapDeltaBytes: process.memoryUsage().heapUsed - memory, rssBytes: process.memoryUsage().rss }); process.stderr.write(label + ': ' + measurements.at(-1).elapsedMs + 'ms\n'); return result; }
const at = '2026-04-15T12:00:00.000Z';
let state = measured('validate maximum active graph restore-style fixture', () => L.validateState(historyFixture()));
state = measured('capture full 500-position 5000-recognition event-only month', () => O.closeMonth(state, { month: '2026-02', at, reason: 'Synthetic capacity measurement' }));
const close = state.organizer.closes[0];
assert.equal(close.heldProof.positions.length, 500); assert.equal(close.heldProof.recognitions.length, 5000); assert.equal(close.personalRows.length, 5000); assert.equal(close.actualRows.length, 0); assert.equal(close.rawProofs.length, 500); assert.equal(close.totals.cash.expenseCents, 0); assert.equal(close.totals.personal.expenseCents, 5000);
const original = JSON.stringify(state);
let capacityError = null, second = null;
measured('attempt second full retained close within independent aggregate limits', () => { try { second = O.closeMonth(state, { month: '2026-03', at, reason: 'Synthetic second capacity measurement' }); } catch (error) { capacityError = { code: error.code, message: error.message }; assert.equal(error.code, 'ORGANIZER_LIMIT'); } });
assert.equal(JSON.stringify(state), original);
console.log(JSON.stringify({ activePositions: 500, activeRecognitions: 5000, capturedPersonalRows: close.personalRows.length, capturedRawProofs: close.rawProofs.length, organizerBytes: Buffer.byteLength(JSON.stringify(state.organizer)), ledgerBytes: Buffer.byteLength(original), secondCloseCapacityError: capacityError, secondOrganizerBytes: second ? Buffer.byteLength(JSON.stringify(second.organizer)) : null, secondLedgerBytes: second ? Buffer.byteLength(JSON.stringify(second)) : null, measurements, maxRssKiB: process.resourceUsage().maxRSS, caveat: 'Synthetic restore-style valid history is tested through production Ledger validation and Organizer capture. Measurements are environment-dependent observations, not latency promises or browser acceptance.' }, null, 2));
