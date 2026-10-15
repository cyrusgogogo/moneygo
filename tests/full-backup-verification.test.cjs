'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildFullBackupFixture, modules: { L, I, R, O, C, S }, clone } = require('./full-backup-fixture.cjs');
const fixture = buildFullBackupFixture();
const { state, ids } = fixture;
const backupText = L.backup(state);
const fixtureDir = path.join(__dirname, 'fixtures');
const counts = { accounts: 6, categories: 10, transactions: 19, trash: 1, importBatches: 3, evidence: 1,
  composites: 1, links: 1, transferPairs: 1, refunds: 1, claims: 1, settlements: 1, snapshots: 2, refundPlans: 1,
  rules: 1, aliases: 1, organizerBatches: 3, closes: 2, scopes: 1, creditProfiles: 5, creditStatements: 2,
  installmentContracts: 1, creditRepayments: 2, billedInstallments: 1, feeEvidence: 1 };
const collectionCounts = {
  imports: { templates: 3, evidence: 1, batches: 3, quarantine: 2, coverage: 2, audit: 5 },
  bookkeeping: { links: 1, refunds: 1, claims: 1, settlements: 1, refundPlans: 1, snapshots: 2, transferPairs: 1, composites: 1, audit: 12 },
  organizer: { rules: 1, aliases: 1, merchants: 1, batches: 3, scopes: 1, reviews: 1, closes: 2, audit: 10 },
  obligations: { profiles: 5, statements: 2, contracts: 1, repayments: 2, inclusions: 1, fees: 1, audit: 16 }
};
const expectedMonths = {
  '2026-09': { cash: { incomeCents: 0, expenseCents: 36000, transferCents: 0, netCents: -36000 }, personal: { incomeCents: 0, expenseCents: 37500, transferCents: 0, netCents: -37500, refundCents: 1500, claimCents: 0 } },
  '2026-10': { cash: { incomeCents: 50700, expenseCents: 19085, transferCents: 22000, netCents: 31615 }, personal: { incomeCents: 50700, expenseCents: 13085, transferCents: 22000, netCents: 37615, refundCents: 0, claimCents: 3000 } },
  '2026-11': { cash: { incomeCents: 3500, expenseCents: 0, transferCents: 0, netCents: 3500 }, personal: { incomeCents: 0, expenseCents: 0, transferCents: 0, netCents: 0, refundCents: 0, claimCents: 0 } }
};
function deepFreeze(value) { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(deepFreeze); } return value; }
function assertDetached(a, b, location = 'state') {
  if (!a || typeof a !== 'object') return;
  assert.notEqual(a, b, location + ' must be a detached object');
  for (const key of Object.keys(a)) assertDetached(a[key], b[key], location + '.' + key);
}
function byId(rows, id) { const value = rows.find(row => row.id === id); assert.ok(value, 'required synthetic row ' + id); return value; }
function mutationEnvelope(mutate) { const envelope = JSON.parse(backupText); mutate(envelope.data, envelope); return envelope; }
function closeCopies(s, closeId, edit) {
  edit(byId(s.organizer.closes, closeId));
  const change = s.organizer.audit.flatMap(row => row.changes).find(row => row.collection === 'closes' && row.key === closeId);
  assert.ok(change); edit(change.after);
}
function snapshotCopies(s, snapshotId, edit) {
  edit(byId(s.bookkeeping.snapshots, snapshotId));
  edit(s.bookkeeping.audit.find(row => row.kind === 'snapshot' && row.recordId === snapshotId).after);
}

function assertCoverage(s) {
  assert.equal(s.version, 6);
  assert.deepEqual([s.simulation.version, s.imports.version, s.bookkeeping.version, s.organizer.version, s.obligations.version], [1, 2, 3, 3, 1]);
  for (const [section, collections] of Object.entries(collectionCounts)) {
    assert.deepEqual(Object.keys(s[section]).filter(key => Array.isArray(s[section][key])).sort(), Object.keys(collections).sort(), section + ' collection coverage');
    for (const [collection, expected] of Object.entries(collections)) assert.equal(s[section][collection].length, expected, section + '.' + collection);
  }
  assert.equal(s.simulation.completeMonths.length, 1);
  assert.equal(s.simulation.exclusions.length, 1);
  assert.equal(s.simulation.scenarios[0].adjustments.length, 1);
  assert.equal(s.simulation.scenarios[0].oneOffs.length, 1);
}

function assertMoney(s, keys) {
  const all = R.calculate(s);
  assert.deepEqual(all.cash, { incomeCents: 54200, expenseCents: 55085, transferCents: 22000, netCents: -885 });
  assert.deepEqual(all.personal, { incomeCents: 50700, expenseCents: 50585, transferCents: 22000, netCents: 115, refundCents: 1500, claimCents: 3000 });
  const expectedBalances = { cash: 8666, bank: 208449, credit: -28000, restricted: 4500, unknown: 3700, other: -2200 };
  assert.deepEqual({ ...L.balances(s) }, Object.fromEntries(Object.entries(expectedBalances).map(([name, value]) => [keys.accounts[name], value])));
  for (const [month, expected] of Object.entries(expectedMonths)) {
    const actual = R.calculate(s, month);
    assert.deepEqual(actual.cash, expected.cash, month + ' cash');
    assert.deepEqual(actual.personal, expected.personal, month + ' personal');
  }
  assert.equal(all.receivables.claimedCents, 3000);
  assert.equal(all.receivables.settledCents, 2000);
  assert.equal(all.receivables.outstandingCents, 1000);
}

test('full fixture is produced by public APIs with every current extension collection populated', () => {
  assertCoverage(state);
  assert.deepEqual(L.verifyBackup(backupText).counts, counts);
  assert.equal(state.imports.batches.filter(row => row.rolledBack).length, 1);
  assert.equal(state.organizer.batches.filter(row => row.rolledBack).length, 1);
  assert.ok(state.bookkeeping.audit.some(row => row.recordId === ids.relations.removedRefund && row.action === 'unlink'));
  assert.ok(state.obligations.audit.some(row => row.reverses === ids.obligations.reversedAudit));
  assert.ok(state.obligations.audit.some(row => row.recordId === ids.obligations.removedFee && row.action === 'remove'));
});

test('verifyBackup round-trips the complete normalized state and every audit with no shared object identity', () => {
  const frozen = deepFreeze(clone(state)), before = JSON.stringify(frozen), envelope = JSON.parse(backupText);
  const start = Date.now(), result = L.verifyBackup(L.backup(frozen)), end = Date.now();
  assert.deepEqual(result.state, L.validateState(envelope.data));
  assert.deepEqual(result.state, frozen);
  assert.deepEqual(L.parseBackup(L.backup(result.state)), frozen);
  assertDetached(frozen, result.state);
  assertDetached(envelope.data, result.state);
  assert.equal(JSON.stringify(frozen), before);
  assert.ok(Date.parse(result.verifiedAt) >= start && Date.parse(result.verifiedAt) <= end);
  for (const section of ['imports', 'bookkeeping', 'organizer', 'obligations']) assert.deepEqual(result.state[section].audit, frozen[section].audit, section + ' exact audit');
  result.state.imports.batches[0].changes[0].after.mapped.note = 'mutated returned copy';
  result.state.bookkeeping.snapshots[0].basis.composites[0].name = 'mutated returned proof';
  result.state.obligations.audit[0].after.note = 'mutated returned history';
  assert.equal(JSON.stringify(frozen), before);
  assert.deepEqual(L.verifyBackup(backupText).state, frozen);
});

test('saved synthetic v6 backup is a real persisted all-extension artifact with independent exact expectations', () => {
  const text = fs.readFileSync(path.join(fixtureDir, 'all-extensions-v6.json'), 'utf8');
  const savedIds = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'all-extensions-v6.ids.json'), 'utf8'));
  const result = L.verifyBackup(text);
  assertCoverage(result.state); assertMoney(result.state, savedIds);
  assert.deepEqual(result.counts, counts);
  assert.deepEqual(result.state, L.validateState(JSON.parse(text).data));
});

test('all-time and original-month personal/cash/account totals retain exact integer cents after restoration', () => {
  assertMoney(state, ids); assertMoney(L.verifyBackup(backupText).state, ids);
  const s = L.verifyBackup(backupText).state, impact = R.calculate(s).impacts;
  assert.equal(impact[ids.transactions.duplicateShadow].excluded, true);
  assert.equal(impact[ids.transactions.personalSeptember].cashExpenseCents, 0);
  assert.equal(impact[ids.transactions.personalSeptember].personalExpenseCents, 3000);
  assert.equal(impact[ids.transactions.funding].cashExpenseCents, 10000);
  assert.equal(impact[ids.transactions.funding].personalExpenseCents, 0);
  assert.equal(s.trash[0].transaction.amountCents, 444);
  assert.equal(s.trash[0].id, ids.transactions.trashed);
  assert.equal(R.calculate(s).cash.incomeCents, 54200, 'discount is never income');
});

test('role-aware actuals preserve exact date cutoffs and do not anticipate future paired arrivals', () => {
  const s = L.verifyBackup(backupText).state;
  // Date, known cash, credit debt, allocated repayment, pending arrival, statement outstanding.
  const rows = [
    ['2026-09-14', 210000, 20000, 0, 22000, 25000],
    ['2026-09-15', 210000, 50000, 0, 22000, 25000],
    ['2026-09-29', 210000, 50000, 0, 22000, 25000],
    ['2026-09-30', 204000, 50000, 0, 22000, 25000],
    ['2026-10-02', 254000, 50000, 0, 22000, 25000],
    ['2026-10-03', 244000, 50000, 0, 22000, 25000],
    ['2026-10-13', 236949, 50000, 0, 22000, 25000],
    ['2026-10-14', 235615, 50000, 0, 22000, 25000],
    ['2026-10-15', 223615, 38000, 12000, 10000, 13000],
    ['2026-10-30', 223615, 38000, 12000, 10000, 13000],
    ['2026-10-31', 213615, 38000, 12000, 10000, 13000],
    ['2026-11-01', 215115, 28000, 22000, 0, 3000],
    ['2026-11-02', 217115, 28000, 22000, 0, 3000]
  ];
  for (const [asOf, cash, debt, allocated, pending, outstanding] of rows) {
    const view = C.view(s, { asOf }), roles = view.roleAwareActuals, statement = byId(view.statements, ids.obligations.statement);
    assert.equal(roles.knownCashBalanceCents, cash, asOf + ' cash');
    assert.equal(roles.recordedCreditDebtCents, debt, asOf + ' credit debt');
    assert.equal(roles.recordedCreditPositiveBalanceCents, 0);
    assert.equal(roles.liquidBalanceCents, null);
    assert.equal(roles.rolesComplete, false); assert.equal(roles.coverageComplete, false);
    assert.equal(statement.allocatedCents, allocated, asOf + ' recorded arrival');
    assert.equal(statement.pendingArrivalAllocatedCents, pending);
    assert.equal(statement.outstandingCents, outstanding);
    assert.equal(statement.verifiedRepaid, false);
  }
  const last = C.view(s, { asOf: '2026-11-02' }).roleAwareActuals;
  assert.deepEqual(Object.fromEntries(Object.entries(last.groups).map(([role, group]) => [role, { balanceCents: group.balanceCents, inflowCents: group.inflowCents, outflowCents: group.outflowCents, netCents: group.netCents }])), {
    cash: { balanceCents: 217115, inflowCents: 53500, outflowCents: 46385, netCents: 7115 },
    credit: { balanceCents: -28000, inflowCents: 22000, outflowCents: 30000, netCents: -8000 },
    restricted: { balanceCents: 4500, inflowCents: 0, outflowCents: 500, netCents: -500 },
    other: { balanceCents: -2200, inflowCents: 0, outflowCents: 200, netCents: -200 },
    unknown: { balanceCents: 3700, inflowCents: 700, outflowCents: 0, netCents: 700 }
  });
});

test('repayment proofs, null estimate, installment inclusion, indexed fee and unresolved forecast survive', () => {
  const s = L.verifyBackup(backupText).state, view = C.view(s, { asOf: '2026-11-01' });
  const native = view.repayments.find(row => row.sourceKind === 'native'), pair = view.repayments.find(row => row.sourceKind === 'pair');
  assert.deepEqual([native.outgoingDate, native.incomingDate, native.amountCents], ['2026-10-15', '2026-10-15', 12000]);
  assert.deepEqual([pair.outgoingDate, pair.incomingDate, pair.amountCents], ['2026-10-31', '2026-11-01', 10000]);
  const estimate = byId(view.statements, ids.obligations.estimate);
  for (const field of ['periodStart', 'periodEnd', 'statementDate', 'dueDate', 'amountCents', 'source', 'outstandingCents']) assert.equal(estimate[field], null, field);
  assert.equal(estimate.excludedFromForecast, true);
  const contract = byId(view.contracts, ids.obligations.contract);
  assert.deepEqual(contract.schedule.map(row => [row.dueDate, row.principalCents, row.feeCents, row.forecastStatus]), [
    ['2026-10-31', 10000, 1, 'billed'], ['2026-11-30', 10000, 1, 'unbilled'], ['2026-12-31', 10000, 1, 'unbilled']
  ]);
  assert.equal(byId(view.statements, ids.obligations.statement).includedInstallmentCents, 10001);
  assert.equal(view.fees[0].recordedAmountCents, 51); assert.equal(view.fees[0].personalExpenseCents, 51);
  assert.equal(view.forecastAmountCents, null); assert.equal(view.forecastKnownMinimumCents, null); assert.equal(view.forecastComplete, false);
  assert.ok(view.forecastOverlapReasons.some(row => row.kind === 'installment-billing-inclusion-unknown'));
});

test('import physical source lines, before/after evidence, coverage and rollback history survive verbatim', () => {
  const s = L.verifyBackup(backupText).state, imported = s.imports;
  assert.deepEqual(imported, state.imports);
  assert.deepEqual(I.parseCSV(fixture.sourceCsv, { delimiter: ',', startLine: 4 }).rows.map(row => row.line), [5, 6]);
  assert.deepEqual(I.parseCSV(fixture.updatedCsv, { delimiter: ',', startLine: 5 }).rows.map(row => row.line), [6, 7]);
  assert.equal(byId(imported.evidence, ids.imports.evidence).sourceLine, 6);
  const old = byId(imported.batches, ids.imports.firstBatch).changes[0], update = byId(imported.batches, ids.imports.updateBatch).changes[0];
  assert.equal(old.after.sourceLine, 5); assert.equal(update.before.sourceLine, 5); assert.equal(update.after.sourceLine, 6);
  assert.equal(update.before.normalized.amountCents, 1234); assert.equal(update.after.normalized.amountCents, 1334);
  assert.deepEqual(imported.quarantine.map(row => row.line), [6, 7]);
  assert.deepEqual(imported.coverage.map(row => [row.start, row.end, row.confirmed]), [['2026-10-01', '2026-10-31', true], ['2026-10-01', '2026-10-31', true]]);
  const rolledBack = byId(imported.batches, ids.imports.rolledBackBatch);
  assert.equal(rolledBack.rolledBack, true); assert.equal(rolledBack.changes[0].after.sourceLine, 2);
  assert.ok(!s.transactions.some(row => row.id === rolledBack.changes[0].after.transactionId));
  assert.deepEqual(imported.audit.map(row => row.action), ['template', 'commit', 'commit', 'commit', 'rollback']);
  for (const token of ['UNMAPPED_PREAMBLE_DO_NOT_STORE', 'UNMAPPED_SECRET_DO_NOT_STORE', 'preambleConfirmed']) assert.ok(!backupText.includes(token));
});

test('both day-end proofs contain the actual composite and exclude personal-only/shadow cash movements', () => {
  const s = L.verifyBackup(backupText).state;
  const bank = byId(s.bookkeeping.snapshots, ids.relations.bankSnapshot), cash = byId(s.bookkeeping.snapshots, ids.relations.cashSnapshot);
  assert.deepEqual([bank.date, bank.actualBalanceCents, bank.ledgerBalanceCents], ['2026-10-31', 204949, 204949]);
  assert.deepEqual([cash.date, cash.actualBalanceCents, cash.ledgerBalanceCents], ['2026-10-31', 8666, 8666]);
  for (const snapshot of [bank, cash]) {
    assert.deepEqual(snapshot.basis.composites, s.bookkeeping.composites);
    assert.equal(snapshot.basis.composites[0].signatures.length, 3);
    assert.ok(!snapshot.basis.transactions.some(row => [ids.transactions.personalSeptember, ids.transactions.personalOctober, ids.transactions.duplicateShadow].includes(row.id)));
    assert.equal(R.reconciliation(s, snapshot.id).changed, false); assert.equal(R.reconciliation(s, snapshot.id).differenceCents, 0);
  }
  assert.ok(bank.basis.transactions.some(row => row.id === ids.transactions.funding));
  assert.deepEqual(cash.basis.transactions.map(row => row.id), [ids.transactions.imported]);
});

test('both frozen months retain complete cross-month composite proofs, exact totals and honest scope limits', () => {
  const s = L.verifyBackup(backupText).state;
  for (const close of s.organizer.closes) {
    assert.equal(close.selection, 'all-month');
    assert.deepEqual(close.compositeProofs, s.bookkeeping.composites);
    assert.deepEqual(close.totals.cash, expectedMonths[close.month].cash);
    assert.deepEqual(close.totals.personal, expectedMonths[close.month].personal);
    const expectedIds = s.bookkeeping.composites[0].signatures.filter(row => row.date.startsWith(close.month)).map(row => row.id).sort();
    assert.deepEqual(close.rows.filter(row => row.compositeId).map(row => row.transaction.id).sort(), expectedIds);
    assert.equal(O.compareMonth(s, close.id).changed, false);
    assert.equal(close.scope.complete, false);
  }
  const october = byId(s.organizer.closes, ids.organizer.octoberClose);
  assert.equal(october.rows.length, 12); assert.equal(october.scope.sources[0].coverageComplete, true);
  assert.equal(october.scope.unresolvedCount, 2); assert.equal(october.scope.unknownAccounts.length, 5);
  const raw = O.rawView(s, ids.transactions.imported);
  assert.equal(raw.transaction.note, 'Synthetic Coffee'); assert.equal(raw.transaction.categoryId, 'expense-food'); assert.equal(raw.merchant, 'Synthetic Cafe');
  assert.equal(raw.evidence[0].sourceLine, 6);
  const review = s.organizer.reviews[0]; assert.equal(review.key, ids.organizer.review); assert.equal(review.deferUntil, '2026-10-20');
  assert.equal(O.reviewQueue(s, { asOf: '2026-10-19' }).find(row => row.key === review.key).deferred, true);
  assert.equal(O.reviewQueue(s, { asOf: '2026-10-20' }).find(row => row.key === review.key).deferred, false);
});

test('sandbox assumptions and stale trash exclusion remain settings and never become actual transactions', () => {
  const s = L.verifyBackup(backupText).state;
  assert.deepEqual(s.simulation, state.simulation);
  assert.deepEqual(S.calculate(s, s.simulation, '2026-10-14'), S.calculate(state, state.simulation, '2026-10-14'));
  assert.equal(s.transactions.some(row => row.id === 'synthetic-one-off'), false);
  assertMoney(s, ids);
});

const corruptionCases = [
  ['envelope version mismatch', (s, e) => { e.version = 5; }],
  ['unsupported envelope version', (s, e) => { e.version = s.version = 7; }],
  ['missing v6 obligations', s => { delete s.obligations; }],
  ['outer downgrade with obligations', (s, e) => { e.version = s.version = 5; }],
  ['fractional opening balance', s => { s.accounts[0].openingBalanceCents = 1.5; }],
  ['active transaction broken account', s => { s.transactions[0].accountId = 'missing-account'; }],
  ['active transaction fractional amount', s => { s.transactions[0].amountCents = 1.5; }],
  ['trash impossible date', s => { s.trash[0].transaction.date = '2026-02-30'; }],
  ['trash broken category', s => { s.trash[0].transaction.categoryId = 'missing-category'; }],
  ['simulation noninteger assumption', s => { s.simulation.scenarios[0].adjustments[0].value = 1.5; }],
  ['simulation missing active scenario', s => { s.simulation.activeId = 'missing-scenario'; }],
  ['simulation oneoff invalid month', s => { s.simulation.scenarios[0].oneOffs[0].month = '2026-13'; }],
  ['import unsupported version', s => { s.imports.version = 99; }],
  ['import template invalid physical start', s => { s.imports.templates[0].config.startLine = 0; }],
  ['import active evidence invalid sourceLine', s => { s.imports.evidence[0].sourceLine = 0; }],
  ['import active evidence bad batch reference', s => { s.imports.evidence[0].lastBatchId = 'missing-batch'; }],
  ['import historical before invalid sourceLine', s => { s.imports.batches[1].changes[0].before.sourceLine = 0; }],
  ['import historical after invalid sourceLine', s => { s.imports.batches[0].changes[0].after.sourceLine = 0; }],
  ['rolled-back import historical invalid sourceLine', s => { s.imports.batches[2].changes[0].after.sourceLine = 0; }],
  ['rolled-back import historical fractional amount', s => { s.imports.batches[2].changes[0].transactionAfter.transaction.amountCents = 1.5; }],
  ['import quarantine invalid physical line', s => { s.imports.quarantine[0].line = 0; }],
  ['import coverage backwards dates', s => { s.imports.coverage[0].end = '2026-09-30'; }],
  ['import audit invalid timestamp', s => { s.imports.audit[0].at = 'not-a-timestamp'; }],
  ['import rollback audit unknown action', s => { s.imports.audit.at(-1).action = 'pretend-rollback'; }],
  ['bookkeeping version downgrade', s => { s.bookkeeping.version = 2; }],
  ['bookkeeping missing journal event', s => { s.bookkeeping.audit.splice(0, 1); }],
  ['duplicate evidence broken primary', s => { s.bookkeeping.links[0].primaryId = 'missing-transaction'; }],
  ['transfer pair wrong amount', s => { s.bookkeeping.transferPairs[0].amountCents++; }],
  ['transfer pair changed source date', s => { byId(s.transactions, ids.transactions.pairIncoming).date = '2026-10-31'; }],
  ['active refund changed allocation', s => { s.bookkeeping.refunds[0].amountCents++; }],
  ['active claim changed allocation', s => { s.bookkeeping.claims[0].amountCents++; }],
  ['settlement broken claim', s => { s.bookkeeping.settlements[0].claimId = 'missing-claim'; }],
  ['refund plan changed expected amount', s => { s.bookkeeping.refundPlans[0].expectedAmountCents++; }],
  ['removed refund historical allocation mismatch', s => { s.bookkeeping.audit.find(row => row.recordId === ids.relations.removedRefund && row.action === 'create').after.amountCents++; }],
  ['composite paid/signature mismatch', s => { s.bookkeeping.composites[0].paidCents++; }],
  ['composite missing funding member', s => { s.bookkeeping.composites[0].fundingIds = []; }],
  ['composite missing signature', s => { s.bookkeeping.composites[0].signatures.pop(); }],
  ['composite active source date changed', s => { byId(s.transactions, ids.transactions.personalSeptember).date = '2026-10-01'; }],
  ['snapshot ledger-balance mismatch', s => { s.bookkeeping.snapshots[0].ledgerBalanceCents++; }],
  ['snapshot coherent proof corruption still rejected', s => { snapshotCopies(s, ids.relations.bankSnapshot, row => { row.basis.composites[0].paidCents++; }); }],
  ['snapshot coherent omitted funding source rejected', s => { snapshotCopies(s, ids.relations.bankSnapshot, row => { row.basis.transactions = row.basis.transactions.filter(t => t.id !== ids.transactions.funding); row.ledgerBalanceCents += 10000; }); }],
  ['organizer unsupported version', s => { s.organizer.version = 99; }],
  ['organizer rule current/journal mismatch', s => { s.organizer.rules[0].name = 'changed outside audit'; }],
  ['organizer alias current/journal mismatch', s => { s.organizer.aliases[0].to = 'changed outside audit'; }],
  ['organizer merchant broken transaction', s => { s.organizer.merchants[0].transactionId = 'missing-transaction'; }],
  ['organizer scope unconfirmed', s => { s.organizer.scopes[0].confirmed = false; }],
  ['organizer review impossible defer date', s => { s.organizer.reviews[0].deferUntil = '2026-02-30'; }],
  ['organizer rolled-back batch changed original transaction', s => { s.organizer.batches[0].changes[0].before.amountCents++; }],
  ['organizer historical journal revision gap', s => { s.organizer.audit[0].revision = 2; }],
  ['frozen close wrong personal total', s => { s.organizer.closes[0].totals.personal.expenseCents++; }],
  ['frozen close coherent incomplete full-month composite rows', s => { closeCopies(s, ids.organizer.octoberClose, row => { row.rows = row.rows.filter(r => r.transaction.id !== ids.transactions.funding); }); }],
  ['frozen close coherent corrupt composite proof', s => { closeCopies(s, ids.organizer.septemberClose, row => { row.compositeProofs[0].signatures[0].amountCents++; }); }],
  ['frozen close historical-only proof corruption', s => { s.organizer.audit.flatMap(row => row.changes).find(row => row.collection === 'closes').after.compositeProofs[0].discountCents++; }],
  ['obligations unsupported version', s => { s.obligations.version = 99; }],
  ['obligation profile invalid role', s => { s.obligations.profiles[0].role = 'invented-role'; }],
  ['official statement missing source', s => { s.obligations.statements[0].source = null; }],
  ['statement current/audit amount mismatch', s => { s.obligations.statements[0].amountCents++; }],
  ['contract schedule principal mismatch', s => { s.obligations.contracts[0].schedule[0].principalCents++; }],
  ['contract purchase broken signature', s => { s.obligations.contracts[0].purchaseSignature.amountCents++; }],
  ['repayment source proof incoming date inconsistent', s => { s.obligations.repayments[1].sourceProof.incomingDate = '2026-10-31'; }],
  ['repayment allocation current/audit mismatch', s => { s.obligations.repayments[0].amountCents++; }],
  ['installment inclusion unknown schedule item', s => { s.obligations.inclusions[0].installmentId = 'missing-installment'; }],
  ['fee wrong transaction signature', s => { s.obligations.fees[0].transactionSignature.amountCents++; }],
  ['reversed obligation historical before-image changed', s => { byId(s.obligations.audit, ids.obligations.reversedAudit).before.amountCents++; }],
  ['removed fee historical snapshot fractional cents', s => { s.obligations.audit.find(row => row.recordId === ids.obligations.removedFee && row.action === 'create').after.transactionSignature.amountCents = 1.5; }],
  ['obligation reversal targets missing event', s => { s.obligations.audit.find(row => row.reverses).reverses = 'missing-audit-event'; }]
];
for (const [name, mutate] of corruptionCases) test('selected corrupt backup rejects: ' + name, () => {
  const liveBefore = JSON.stringify(state), envelope = mutationEnvelope(mutate), selectedText = JSON.stringify(envelope);
  assert.throws(() => L.verifyBackup(selectedText), error => {
    assert.equal(typeof error.code, 'string', 'validator error, not a test/setup TypeError');
    return true;
  });
  assert.equal(JSON.stringify(state), liveBefore);
  assert.deepEqual(L.verifyBackup(backupText).state, state, 'valid backup remains recoverable');
});

test('verification is structural validation, not cryptographic authenticity or complete financial evidence', () => {
  const altered = mutationEnvelope(s => { byId(s.transactions, ids.transactions.salary).note = 'A structurally valid changed note'; });
  const result = L.verifyBackup(JSON.stringify(altered));
  assert.equal(byId(result.state.transactions, ids.transactions.salary).note, 'A structurally valid changed note');
  assert.equal(C.view(result.state, { asOf: '2026-11-02' }).roleAwareActuals.coverageComplete, false);
});

for (const version of [1, 2, 3, 4, 5]) test('genuine frozen outer v' + version + ' backup remains readable without invented extensions', () => {
  const all = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'legacy-outer-v1-v5.json'), 'utf8'));
  const envelope = all.find(row => row.version === version); assert.ok(envelope);
  const before = JSON.stringify(envelope), result = L.verifyBackup(JSON.stringify(envelope)), old = envelope.data;
  assert.equal(result.state.version, version); assert.equal(result.state.obligations, undefined);
  for (const key of ['accounts', 'categories', 'transactions', 'trash', 'simulation']) assert.deepEqual(result.state[key], old[key], key);
  for (const key of ['imports', 'bookkeeping', 'organizer']) {
    if (!old[key]) assert.equal(result.state[key], undefined, 'no invented ' + key);
    else assert.deepEqual(result.state[key].audit, old[key].audit, key + ' historical audit');
  }
  assert.deepEqual(L.parseBackup(L.backup(result.state)), result.state);
  assert.equal(JSON.stringify(envelope), before);
});
for (const file of ['legacy-relations-v4.json', 'legacy-relations-v5.json']) test('genuine historical relation fixture retains all old records and journals: ' + file, () => {
  const text = fs.readFileSync(path.join(fixtureDir, file), 'utf8'), old = JSON.parse(text).data, result = L.verifyBackup(text).state;
  for (const key of ['accounts', 'categories', 'transactions', 'trash']) assert.deepEqual(result[key], old[key]);
  for (const collection of ['links', 'refunds', 'claims', 'settlements', 'refundPlans', 'snapshots', 'audit']) assert.deepEqual(result.bookkeeping[collection], old.bookkeeping[collection]);
  assert.deepEqual(result.bookkeeping.transferPairs, []); assert.equal(Object.hasOwn(result.bookkeeping, 'composites'), false);
  if (old.organizer) { assert.deepEqual(result.organizer.closes, old.organizer.closes); assert.deepEqual(result.organizer.audit, old.organizer.audit); }
});
for (const file of ['imports-v1-frozen-v08.json', 'organizer-v1-close.json']) test('genuine historical raw state migrates before a real current backup is verified: ' + file, () => {
  const old = JSON.parse(fs.readFileSync(path.join(fixtureDir, file), 'utf8'));
  const normalized = L.validateState(old), restored = L.verifyBackup(L.backup(normalized)).state;
  assert.deepEqual(restored, normalized);
  assert.deepEqual(restored.transactions, old.transactions);
  if (old.imports) {
    for (const collection of ['templates', 'evidence', 'batches', 'quarantine', 'coverage', 'audit']) assert.deepEqual(restored.imports[collection], old.imports[collection]);
    assert.ok(restored.imports.evidence.every(row => !Object.hasOwn(row, 'sourceLine')));
    assert.ok(restored.imports.batches.every(batch => batch.changes.every(change => !Object.hasOwn(change.after, 'sourceLine') && (!change.before || !Object.hasOwn(change.before, 'sourceLine')))));
  }
  if (old.organizer) { assert.deepEqual(restored.organizer.closes, old.organizer.closes); assert.deepEqual(restored.organizer.audit, old.organizer.audit); }
});
