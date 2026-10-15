'use strict';
// Entirely synthetic, built only through the application's public APIs.
// No state rows, extension journals, IDs, or frozen proofs are fabricated.
const L = require('../dist/ledger.js');
const I = require('../dist/importer.js');
const R = require('../dist/relations.js');
const O = require('../dist/organizer.js');
const C = require('../dist/obligations.js');
const S = require('../dist/scenario.js');
const AT = '2026-10-14T10:00:00.000Z';
const clone = value => JSON.parse(JSON.stringify(value));
const modules = { L, I, R, O, C, S };

function buildFullBackupFixture() {
  let state = L.createEmpty();
  const ids = { accounts: { cash: 'account-cash' }, transactions: {}, relations: {}, imports: {}, organizer: {}, obligations: {} };
  state = L.putAccount(state, { name: 'Synthetic cash', openingBalanceCents: 10000 }, ids.accounts.cash);
  for (const [key, openingBalanceCents] of [['bank', 200000], ['credit', -20000], ['restricted', 5000], ['unknown', 3000], ['other', -2000]]) {
    state = L.putAccount(state, { name: 'Synthetic ' + key, openingBalanceCents });
    ids.accounts[key] = state.accounts.at(-1).id;
  }
  function add(key, type, amountCents, date, account, extra = {}) {
    state = L.putTransaction(state, { type, amountCents, date, accountId: ids.accounts[account],
      ...(type === 'transfer' ? { toAccountId: ids.accounts.credit } : { categoryId: type === 'expense' ? 'expense-other' : 'income-other' }),
      note: 'Synthetic ' + key, ...extra });
    ids.transactions[key] = state.transactions.at(-1).id;
  }
  add('salary', 'income', 50000, '2026-10-01', 'bank');
  add('personalSeptember', 'expense', 3000, '2026-09-30', 'cash');
  add('personalOctober', 'expense', 7000, '2026-10-01', 'cash');
  add('funding', 'expense', 10000, '2026-10-03', 'bank');
  add('duplicatePrimary', 'expense', 2000, '2026-10-04', 'bank');
  add('duplicateShadow', 'expense', 2000, '2026-10-05', 'bank');
  add('refundable', 'expense', 6000, '2026-09-30', 'bank');
  add('refundReceipt', 'income', 1500, '2026-11-01', 'bank');
  add('sharedPurchase', 'expense', 5000, '2026-10-10', 'bank');
  add('claimReceipt', 'income', 2000, '2026-11-02', 'bank');
  add('fee', 'expense', 51, '2026-10-06', 'bank');
  add('installmentPurchase', 'expense', 30000, '2026-09-15', 'credit');
  add('nativeRepayment', 'transfer', 12000, '2026-10-15', 'bank');
  add('pairOutgoing', 'expense', 10000, '2026-10-31', 'bank');
  add('pairIncoming', 'income', 10000, '2026-11-01', 'credit');
  add('restrictedExpense', 'expense', 500, '2026-10-08', 'restricted');
  add('unknownIncome', 'income', 700, '2026-10-09', 'unknown');
  add('otherExpense', 'expense', 200, '2026-10-09', 'other');
  add('trashed', 'expense', 444, '2026-10-20', 'cash');
  state = L.deleteTransaction(state, ids.transactions.trashed);

  // Scenario has no mutator. Its public validator is the supported settings API.
  const settings = S.defaultSettings();
  settings.completeMonths = ['2026-09'];
  settings.exclusions = [ids.transactions.trashed];
  settings.scenarios[0].name = 'Synthetic assumption, not actual money';
  settings.scenarios[0].adjustments = [{ categoryId: 'expense-other', mode: 'percent', value: -10 }];
  settings.scenarios[0].oneOffs = [{ id: 'synthetic-one-off', name: 'Synthetic future purchase', month: '2026-12', categoryId: 'expense-shopping', amountCents: 789 }];
  state = L.validateState({ ...state, simulation: S.validate(settings) });

  const headers = ['date', 'amount', 'direction', 'note', 'id', 'status', 'channel', 'unmapped'];
  const config = { sourceKey: 'synthetic-csv', accountId: ids.accounts.cash, delimiter: ',', header: true, startLine: 4,
    columns: { date: 0, amount: 1, direction: 2, note: 3, stableId: 4, status: 5, channel: 6 },
    coverage: { start: '2026-10-01', end: '2026-10-31', confirmed: true } };
  const preamble = 'UNMAPPED_PREAMBLE_DO_NOT_STORE\r\n"Synthetic two\r\nphysical lines"\r\n';
  const sourceCsv = preamble + headers.join(',') + '\r\n' +
    '2026-10-14,12.34,expense,Synthetic Coffee,stable-coffee,completed,Synthetic channel,UNMAPPED_SECRET_DO_NOT_STORE\r\n' +
    '2026-10-15,bad,expense,Synthetic invalid,bad-amount,completed,Synthetic channel,UNMAPPED_SECRET_DO_NOT_STORE';
  state = I.saveTemplate(state, { headers, config, name: 'Synthetic physical-line template' });
  let p = I.preview(state, sourceCsv, { ...config, preambleConfirmed: true });
  state = I.commit(state, p, p.rows.filter(row => row.action === 'new').map(row => row.key));
  ids.imports.firstBatch = state.imports.batches.at(-1).id;
  ids.imports.quarantine = state.imports.quarantine[0].id;
  ids.transactions.imported = state.imports.evidence.find(row => row.stableId === 'stable-coffee').transactionId;
  ids.imports.evidence = state.imports.evidence[0].id;
  // Update the stable source at its real new physical location; preserve before=5, after=6.
  const updatedCsv = 'Another unmapped line\r\n' + sourceCsv.replace('12.34', '13.34');
  p = I.preview(state, updatedCsv, { ...config, startLine: 5, preambleConfirmed: true });
  state = I.commit(state, p, p.rows.filter(row => row.action === 'update').map(row => row.key));
  ids.imports.updateBatch = state.imports.batches.at(-1).id;
  // A genuinely committed then rolled-back import preserves historical evidence snapshots.
  const rollbackConfig = { sourceKey: 'synthetic-rolled-back', accountId: ids.accounts.cash, delimiter: ',', defaultType: 'expense', columns: { date: 0, amount: 1, stableId: 2 } };
  p = I.preview(state, 'date,amount,id\n2026-10-16,1.11,temporary', rollbackConfig);
  state = I.commit(state, p, p.rows.map(row => row.key));
  ids.imports.rolledBackBatch = state.imports.batches.at(-1).id;
  const rollback = I.rollback(state, ids.imports.rolledBackBatch);
  if (!rollback.rolledBack || rollback.conflicts.length) throw new Error("Synthetic rollback must succeed");
  state = rollback.state;

  const t = ids.transactions;
  state = R.linkEvidence(state, { primaryId: t.duplicatePrimary, shadowId: t.duplicateShadow, reason: 'Synthetic duplicate explicitly reviewed' });
  ids.relations.link = state.bookkeeping.links[0].id;
  state = R.pairTransfer(state, { expenseId: t.pairOutgoing, incomeId: t.pairIncoming, reason: 'Synthetic cross-month own-account movement' });
  ids.relations.transferPair = state.bookkeeping.transferPairs[0].id;
  state = R.createComposite(state, R.previewComposite(state, { name: 'Synthetic combined order', personalIds: [t.personalSeptember, t.personalOctober], fundingIds: [t.funding], paidCents: 10000, grossCents: 12000, discountCents: 2000 }), { confirmed: true, reason: 'Synthetic personal and funding evidence explicitly reviewed' });
  ids.relations.composite = state.bookkeeping.composites[0].id;
  state = R.addRefundPlan(state, { expenseId: t.refundable, expectedAmountCents: 2000, dueDate: '2026-11-10', note: 'Synthetic pending refund' });
  ids.relations.refundPlan = state.bookkeeping.refundPlans[0].id;
  state = R.allocateRefund(state, { incomeId: t.refundReceipt, expenseId: t.refundable, amountCents: 1000, reason: 'Synthetic initial allocation', planId: ids.relations.refundPlan });
  ids.relations.removedRefund = state.bookkeeping.refunds[0].id;
  state = R.unlink(state, 'refund', ids.relations.removedRefund, 'Synthetic corrected allocation');
  state = R.allocateRefund(state, { incomeId: t.refundReceipt, expenseId: t.refundable, amountCents: 1500, reason: 'Synthetic final allocation', planId: ids.relations.refundPlan });
  ids.relations.refund = state.bookkeeping.refunds[0].id;
  state = R.createClaim(state, { expenseId: t.sharedPurchase, amountCents: 3000, kind: 'advance', name: 'Synthetic third-party share', dueDate: '2026-11-15', status: 'unsubmitted', note: 'Synthetic claim' });
  ids.relations.claim = state.bookkeeping.claims[0].id;
  state = R.updateClaim(state, ids.relations.claim, { status: 'submitted' }, 'Synthetic claim submitted');
  state = R.settleClaim(state, { incomeId: t.claimReceipt, claimId: ids.relations.claim, amountCents: 2000, reason: 'Synthetic partial receipt' });
  ids.relations.settlement = state.bookkeeping.settlements[0].id;
  // Both proofs really contain the active composite, including a zero-flow personal account.
  state = R.addSnapshot(state, { accountId: ids.accounts.bank, date: '2026-10-31', actualBalanceCents: 204949, note: 'Synthetic bank day end' });
  ids.relations.bankSnapshot = state.bookkeeping.snapshots.at(-1).id;
  state = R.addSnapshot(state, { accountId: ids.accounts.cash, date: '2026-10-31', actualBalanceCents: 8666, note: 'Synthetic cash day end' });
  ids.relations.cashSnapshot = state.bookkeeping.snapshots.at(-1).id;

  state = O.saveRule(state, { name: 'Synthetic coffee category', conditions: { note: { operator: 'equals', value: 'Synthetic Coffee', caseSensitive: true } }, actions: { categoryId: 'expense-food' }, at: AT });
  ids.organizer.rule = state.organizer.rules[0].id;
  function apply(preview) { state = O.applyPreview(state, preview, { transactionIds: [t.imported], reason: 'Synthetic chosen row', at: AT }); }
  apply(O.previewRules(state));
  ids.organizer.rolledBackBatch = state.organizer.batches.at(-1).id;
  state = O.rollbackBatch(state, ids.organizer.rolledBackBatch, { reason: 'Synthetic review reversal', at: AT });
  apply(O.previewRules(state));
  state = O.saveAlias(state, { from: 'Synthetic Coffee', to: 'Synthetic Cafe', caseSensitive: true, at: AT });
  ids.organizer.alias = state.organizer.aliases[0].id;
  apply(O.previewAliases(state));
  state = O.setScope(state, { sourceKey: 'synthetic-csv', accountId: ids.accounts.cash, included: true, reason: 'Synthetic declared export scope', confirmed: true, at: AT });
  const quarantineItem = O.reviewQueue(state, { asOf: '2026-10-14' }).find(row => row.kind === 'quarantine');
  if (!quarantineItem) throw new Error('Synthetic import quarantine must be reviewable');
  state = O.setReview(state, { key: quarantineItem.key, rank: 0, deferUntil: '2026-10-20', reason: 'Synthetic deliberate deferral', at: AT });
  ids.organizer.review = quarantineItem.key;
  state = O.closeMonth(state, { month: '2026-09', reason: 'Synthetic frozen September', at: AT });
  ids.organizer.septemberClose = state.organizer.closes.at(-1).id;
  state = O.closeMonth(state, { month: '2026-10', reason: 'Synthetic frozen October', at: AT });
  ids.organizer.octoberClose = state.organizer.closes.at(-1).id;

  const confirm = () => ({ confirmed: true, expectedRevision: state.obligations?.revision || 0, reason: 'Synthetic obligation explicitly reviewed' });
  for (const [account, role] of [['cash', 'cash'], ['bank', 'cash'], ['credit', 'credit'], ['restricted', 'restricted'], ['other', 'other']]) {
    state = C.putProfile(state, { accountId: ids.accounts[account], role, creditLimitCents: role === 'credit' ? 999999 : null, note: 'Synthetic role' }, confirm());
  }
  const statementInput = { accountId: ids.accounts.credit, provenance: 'official', periodStart: '2026-09-01', periodEnd: '2026-09-30', statementDate: '2026-10-01', dueDate: '2026-10-31', amountCents: 25000, source: 'Synthetic official statement', note: 'Synthetic, not a real bank statement' };
  state = C.putStatement(state, statementInput, confirm());
  ids.obligations.statement = state.obligations.statements[0].id;
  state = C.putStatement(state, { ...statementInput, amountCents: 26000 }, confirm(), ids.obligations.statement);
  ids.obligations.reversedAudit = state.obligations.audit.at(-1).id;
  state = C.revert(state, ids.obligations.reversedAudit, confirm());
  state = C.putStatement(state, { accountId: ids.accounts.credit, provenance: 'estimate', periodStart: null, periodEnd: null, statementDate: null, dueDate: null, amountCents: null, source: null, note: 'Synthetic unknown estimate' }, confirm());
  ids.obligations.estimate = state.obligations.statements.at(-1).id;
  state = C.putContract(state, { accountId: ids.accounts.credit, name: 'Synthetic three installments', principalCents: 30000, feeCents: 3, source: 'Synthetic agreement', purchaseTransactionId: t.installmentPurchase, status: 'active', schedule: C.splitSchedule({ principalCents: 30000, feeCents: 3, dates: ['2026-10-31', '2026-11-30', '2026-12-31'] }), note: 'Synthetic full schedule' }, confirm());
  ids.obligations.contract = state.obligations.contracts[0].id;
  ids.obligations.installment = state.obligations.contracts[0].schedule[0].id;
  state = C.allocateRepayment(state, { statementId: ids.obligations.statement, sourceKind: 'native', sourceId: t.nativeRepayment, amountCents: 12000 }, confirm());
  state = C.allocateRepayment(state, { statementId: ids.obligations.statement, sourceKind: 'pair', sourceId: ids.relations.transferPair, amountCents: 10000 }, confirm());
  state = C.includeInstallment(state, { statementId: ids.obligations.statement, contractId: ids.obligations.contract, installmentId: ids.obligations.installment }, confirm());
  const feeInput = { transactionId: t.fee, kind: 'handling', statementId: null, contractId: null, note: 'Synthetic fee index only' };
  state = C.markFee(state, feeInput, confirm());
  ids.obligations.removedFee = state.obligations.fees[0].id;
  state = C.remove(state, 'fee', ids.obligations.removedFee, confirm());
  state = C.markFee(state, feeInput, confirm());
  ids.obligations.fee = state.obligations.fees[0].id;
  return { state: L.validateState(state), ids, sourceCsv, updatedCsv };
}

module.exports = { buildFullBackupFixture, modules, clone, AT };
