'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { H, L, day, clock, copy, engine, fund, position, recognition, base } = require('./held-b-fixture.cjs');
const { nearLimitHeld } = require('./held-b-performance-fixture.cjs');

test('B: 500-position/5000-child near-limit graph validates and metadata review stays bounded', t => {
  const start = performance.now(), input = nearLimitHeld(), state = L.validateState(input), validationMs = performance.now() - start, row = state.bookkeeping.heldPositions[0], before = JSON.stringify(state), h = engine(), command = { action: 'update-position', asOfDate: day, positionId: row.id, name: 'Synthetic benchmark reviewed label', purpose: row.purpose, reference: row.reference, expiry: row.expiry, refundability: row.refundability, terms: row.terms, termsSource: row.termsSource };
  const previewStart = performance.now(), ticket = h.preview(state, command), previewMs = performance.now() - previewStart;
  assert.equal(ticket.review.after.positions.length, 500); assert.equal(ticket.review.after.totals.usedCents, 5000); assert.deepEqual(ticket.review.changedMonths, []);
  const commitStart = performance.now(), next = h.commit(state, ticket, { confirmed: true, reason: 'Synthetic benchmark confirmed' }), commitMs = performance.now() - commitStart;
  assert.equal(next.bookkeeping.revision, 5501); assert.equal(next.bookkeeping.heldRecognitions.length, 5000); assert.equal(JSON.stringify(state), before);
  t.diagnostic(JSON.stringify({ nearLimit: { positions: 500, children: 5000, auditEntries: state.bookkeeping.audit.length, inputBytes: Buffer.byteLength(before), reviewBytes: Buffer.byteLength(JSON.stringify(ticket)), validationMs: Math.round(validationMs), previewMs: Math.round(previewMs), commitMs: Math.round(commitMs), memory: process.memoryUsage() }, scope: 'local Node model measurements only; not a maximum-size latency guarantee' }));
});
test('B: over-budget input rejects after one preview clock read without altering input or activating held state', () => { const s = base(), oversized = copy(s); oversized.transactions = Array(10001).fill(s.transactions[0]); let calls = 0; const h = H.createCoordinator({ now() { calls++; return clock; } }); const before = JSON.stringify(oversized); assert.throws(() => h.preview(oversized, position())); assert.equal(JSON.stringify(oversized), before); assert.equal(oversized.bookkeeping, undefined); assert.equal(calls, 1); });
