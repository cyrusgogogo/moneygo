'use strict';
const L = require('../dist/ledger'), R = require('../dist/relations'), P = require('../dist/income-planning');
const now = '2026-10-14T12:00:00.000Z', day = '2026-10-14';
const options = { asOfDate: day, horizonEnd: '2027-01-31', mode: 'planned' };
const copy = value => JSON.parse(JSON.stringify(value));
const tx = (id, type = 'income', amountCents = 100000, date = '2026-10-01', accountId = 'account-cash') => ({ id, type, amountCents, date, accountId, ...(type === 'transfer' ? { toAccountId: 'bank' } : { categoryId: type === 'expense' ? 'expense-other' : 'income-other' }), note: '' });
function base(rows = [tx('source')]) { const s = L.createEmpty(); s.accounts.push({ id: 'bank', name: 'Synthetic bank', openingBalanceCents: 0 }); s.transactions = rows; return L.validateState(s); }
const coordinator = () => P.createCoordinator({ now: () => now, today: () => day });
const plan = (patch = {}) => ({ action: 'create-plan', plan: { name: 'Synthetic plan', certainty: 'confirmed-plan', expectedAmountCents: 100000, expectedDate: '2026-10-20', expectedAccountId: 'account-cash', basis: 'Synthetic confirmation', note: '', ...patch } });
function apply(state, command, opt = options, c = coordinator()) { return c.commit(state, c.preview(state, command, opt), { confirmed: true, reason: 'Synthetic user confirmation' }); }
const pid = state => state.incomePlanning.plans[0].id;
const rid = state => state.incomePlanning.receipts[0].id;
const allocate = (state, amountCents, transactionId = 'source', planId = pid(state)) => apply(state, { action: 'allocate-receipt', planId, transactionId, amountCents, reference: 'Synthetic receipt' });
function change(state, key, patch) { const s = copy(state); Object.assign(s.transactions.find(row => row.id === key), patch); return L.validateState(s); }
function seeded({ expectedAmountCents = 100000, expectedDate = '2026-10-20', certainty = 'confirmed-plan', status = 'open', receipt = 'none', count = 1 } = {}) {
  const s = base(), p = { id: 'plan-fixture', createdAt: now, ...plan({ expectedAmountCents, expectedDate, certainty }).plan, status };
  const extension = { version: 1, revision: 1, plans: [p], receipts: [], audit: [{ id: 'audit-plan', revision: 1, at: now, kind: 'plan', recordId: p.id, action: 'create', reason: 'Synthetic', before: null, after: copy(p), reverses: null }] };
  if (receipt !== 'none') for (let i = 0; i < count; i++) {
    const source = { id: 'source', type: 'income', date: receipt === 'future' ? '2026-10-15' : '2026-10-01', amountCents: 100000, accountId: 'account-cash', toAccountId: null };
    const r = { id: 'receipt-' + i, createdAt: now, reviewedAsOfDate: '2026-10-20', planId: p.id, transactionId: 'source', amountCents: receipt === 'complete' ? expectedAmountCents : Math.floor(50000 / count), proof: { version: 1, source, role: 'ordinary-primary', duplicateEvidence: [], reductions: [], ordinaryIncomeCents: 100000 }, reference: '' };
    extension.receipts.push(r); extension.audit.push({ id: 'audit-receipt-' + i, revision: ++extension.revision, at: now, kind: 'receipt', recordId: r.id, action: 'create', reason: 'Synthetic', before: null, after: copy(r), reverses: null });
  }
  if (receipt === 'stale') s.transactions[0].amountCents = 120000;
  if (receipt === 'future') s.transactions[0].date = '2026-10-15';
  return L.validateState({ ...s, version: 7, incomePlanning: extension });
}
function linked(count, inherited) {
  const s = inherited ? copy(inherited) : base(); s.version = s.incomePlanning ? 7 : 4;
  const data = R.defaultState();
  for (let i = 0; i < count; i++) {
    const key = 'shadow-' + i; if (!s.transactions.some(row => row.id === key)) s.transactions.push(tx(key, 'income', 100000, '2026-10-20'));
    const financial = row => ({ type: row.type, date: row.date, amountCents: row.amountCents, accountId: row.accountId, toAccountId: null });
    const row = { id: 'link-' + i, createdAt: now, primaryId: 'source', shadowId: key, reason: 'Synthetic', primarySignature: financial(s.transactions.find(v => v.id === 'source')), shadowSignature: financial(s.transactions.find(v => v.id === key)) };
    data.links.push(row); data.audit.push({ id: 'link-audit-' + i, revision: i + 1, at: now, kind: 'link', recordId: row.id, action: 'create', reason: 'Synthetic', before: null, after: copy(row) });
  }
  data.revision = count; s.bookkeeping = data; return L.validateState(s);
}
module.exports = { L, R, P, now, day, options, copy, tx, base, coordinator, plan, apply, pid, rid, allocate, change, seeded, linked };
