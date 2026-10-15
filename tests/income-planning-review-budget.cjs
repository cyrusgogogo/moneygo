'use strict';
// Separate synthetic boundary benchmark: intentionally large, no real data or IO.
const assert = require('node:assert/strict');
const f = require('./income-planning-model-fixtures.cjs');
const C = require('../dist/income-core');
const { L, R, P, now, day, options, copy } = f;
const LIMIT = 8 * 1024 * 1024;
function fixed(prefix, number, length) { return (prefix + String(number).padStart(5, '0')).padEnd(length, 'x'); }
function rawState(linkLength = 100, count = 63) {
  const state = L.createEmpty(), account = fixed('account', 0, 100);
  state.accounts[0].id = account; state.version = 7;
  const plan = { id: 'budget-plan', createdAt: now, name: 'Budget synthetic', certainty: 'confirmed-plan', expectedAmountCents: 1000, expectedDate: '2026-10-20', expectedAccountId: account, status: 'open', basis: 'Synthetic', note: '' };
  const ext = { version: 1, revision: 1, plans: [plan], receipts: [], audit: [{ id: 'budget-plan-audit', revision: 1, at: now, kind: 'plan', recordId: plan.id, action: 'create', reason: 'Synthetic', before: null, after: copy(plan), reverses: null }] };
  const financial = R.defaultState();
  function tx(id) { return { id, type: 'income', date: '2026-10-01', amountCents: 100000, accountId: account, categoryId: 'income-other', note: '' }; }
  function sig(row, withId = false) { return { ...(withId ? { id: row.id } : {}), type: 'income', date: row.date, amountCents: row.amountCents, accountId: row.accountId, toAccountId: null }; }
  for (let i = 0; i < 100; i++) {
    const source = tx(fixed('source', i, 100)); state.transactions.push(source);
    const receipt = { id: 'budget-receipt-' + i, createdAt: now, reviewedAsOfDate: day, planId: plan.id, transactionId: source.id, amountCents: 1, proof: { version: 1, source: sig(source, true), role: 'ordinary-primary', duplicateEvidence: [], reductions: [], ordinaryIncomeCents: 100000 }, reference: '' };
    ext.receipts.push(receipt); ext.audit.push({ id: 'budget-receipt-audit-' + i, revision: ++ext.revision, at: now, kind: 'receipt', recordId: receipt.id, action: 'create', reason: 'Synthetic', before: null, after: copy(receipt), reverses: null });
    for (let j = 0; j < count; j++) {
      const n = i * count + j, shadow = tx(fixed('shadow', n, 100)); state.transactions.push(shadow);
      const row = { id: fixed('link', n, linkLength), createdAt: now, primaryId: source.id, shadowId: shadow.id, reason: 'Synthetic', primarySignature: sig(source), shadowSignature: sig(shadow) };
      financial.links.push(row); financial.audit.push({ id: 'budget-link-audit-' + n, revision: ++financial.revision, at: now, kind: 'link', recordId: row.id, action: 'create', reason: 'Synthetic', before: null, after: copy(row) });
    }
  }
  state.incomePlanning = ext; state.bookkeeping = financial; return state;
}
const command = { action: 'update-plan', planId: 'budget-plan', patch: { note: 'Synthetic budget boundary' } };
function addReferences(state, count, unicode = false) {
  let remaining = count;
  for (const receipt of state.incomePlanning.receipts) {
    let n = Math.min(remaining, 500); receipt.reference = 'a'.repeat(n); remaining -= n;
    state.incomePlanning.audit.find(e => e.kind === 'receipt' && e.recordId === receipt.id).after.reference = receipt.reference;
  }
  assert.equal(remaining, 0);
  if (unicode) {
    const row = state.incomePlanning.receipts.find(r => r.reference.length >= 4); row.reference = '汉\n' + row.reference.slice(5); // five UTF-8/escaped JSON bytes replace five ASCII bytes.
    state.incomePlanning.audit.find(e => e.recordId === row.id).after.reference = row.reference;
  }
}
async function main() {
  const started = performance.now();
  // Fixed-value fixture calibrated against the actual reviewed Ticket schema:
  // 8,754,575 baseline bytes - 30 * 12,600 ID bytes + 12,033 reference bytes.
  const state = rawState(70); addReferences(state, 12033, true);
  const before = JSON.stringify(state), c = P.createCoordinator({ now: () => now, today: () => day });
  const t = c.preview(state, command, options), actual = Buffer.byteLength(C.canonicalData(t, { maxBytes: LIMIT }));
  assert.equal(actual, LIMIT); assert.equal(JSON.stringify(state), before); c.cancel(t);
  const plus = copy(state), last = plus.incomePlanning.receipts.find(r => r.reference.length < 500); last.reference += 'b'; plus.incomePlanning.audit.find(e => e.recordId === last.id).after.reference = last.reference;
  let returned = false; assert.throws(() => { c.preview(plus, command, options); returned = true; }); assert.equal(returned, false);
  assert.deepEqual(P.view(plus, { asOfDate: day }), P.view(state, { asOfDate: day }));
  console.log(JSON.stringify({ exactTicketBytes: actual, rejectedTicketBytes: actual + 1, ledgerBytes: Buffer.byteLength(C.canonicalData(state, { maxBytes: 32 * 1024 * 1024 })), currentSources: state.transactions.length, linkedComponents: state.bookkeeping.links.length, elapsedMs: Math.round(performance.now() - started), heapMiB: Math.round(process.memoryUsage().heapUsed / 1048576) }));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { rawState };
