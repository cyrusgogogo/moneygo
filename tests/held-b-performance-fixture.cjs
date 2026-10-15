'use strict';
const { base, tx, clock, day, position, recognition } = require('./held-b-fixture.cjs');
function nearLimitHeld() {
  const state = base([tx('pay', 'expense', 5000000, '2025-01-01')]), p = state.transactions[0];
  state.version = 4;
  state.bookkeeping = { version: 4, revision: 0, links: [], refunds: [], claims: [], settlements: [], snapshots: [], refundPlans: [], transferPairs: [], composites: [], heldPositions: [], heldRecognitions: [], heldReturns: [], audit: [] };
  const data = state.bookkeeping;
  function append(kind, row) { data.audit.push({ id: 'benchmark-audit-' + (data.audit.length + 1), revision: data.audit.length + 1, at: clock, kind, recordId: row.id, action: 'create', reason: row.reason, before: null, after: structuredClone(row), asOfDate: day, reverses: null }); }
  for (let index = 0; index < 500; index++) {
    const input = position({ expenseId: 'pay', name: 'Synthetic benchmark principal', amountCents: 10000 }), { action, ...fields } = input;
    const row = { id: 'benchmark-position-' + index, createdAt: clock, ...fields, expenseSignature: { type: p.type, date: p.date, amountCents: p.amountCents, accountId: p.accountId, toAccountId: null }, reason: 'Synthetic benchmark record' };
    data.heldPositions.push(row); append('heldPosition', row);
    for (let child = 0; child < 10; child++) {
      const input = recognition(row.id, { amountCents: 1, effectiveDate: '2025-' + String(child + 2).padStart(2, '0') + '-01', merchant: null }), { action, ...fields } = input;
      const r = { id: 'benchmark-recognition-' + index + '-' + child, createdAt: clock, ...fields, categoryProof: { id: 'recognition-category', type: 'expense', name: 'Synthetic recognition only' }, reason: 'Synthetic benchmark record' };
      data.heldRecognitions.push(r); append('heldRecognition', r);
    }
  }
  data.revision = data.audit.length;
  return state;
}
module.exports = { nearLimitHeld };
