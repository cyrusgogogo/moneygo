'use strict';
// Test/build only. The browser consumes generated, immutable literal data.
// Every financial change here uses the actual importer or public model API.
const fs = require('node:fs');
const path = require('node:path');
const L = require('../dist/ledger.js');
const I = require('../dist/importer.js');
const R = require('../dist/relations.js');
const C = require('../dist/obligations.js');
const FIXED_REFERENCE_DATE = '2026-11-02';
const BANK = 'SYNTHETIC practice bank', CREDIT = 'SYNTHETIC practice credit';
const BANK_SOURCE = 'synthetic-practice-bank', CREDIT_SOURCE = 'synthetic-practice-credit';
const HEADERS = ['date', 'amount', 'direction', 'note', 'id', 'status', 'channel'];
const csv = (rows, delimiter = ',') => HEADERS.join(delimiter) + '\r\n' + rows.map(row => row.join(delimiter)).join('\r\n') + '\r\n';
const row = (date, amount, direction, note, id, status = 'completed') => [date, amount, direction, 'SYNTHETIC ' + note, id, status, 'SYNTHETIC local practice'];
const bankRows = [
  row('2026-09-30', '60.00', 'expense', 'refundable purchase', 'practice-refundable'),
  row('2026-10-10', '50.00', 'expense', 'shared purchase', 'practice-shared'),
  row('2026-10-14', '12.34', 'expense', 'coffee', 'practice-coffee'),
  row('2026-10-31', '100.00', 'expense', 'repayment outgoing', 'practice-repayment-out'),
  row('2026-11-01', '15.00', 'income', 'refund receipt', 'practice-refund-in'),
  row('2026-11-02', '20.00', 'income', 'third-party receipt', 'practice-claim-in'),
  row('2026-10-16', 'INVALID', 'expense', 'bad amount for review', 'practice-bad-amount'),
  row('2026-10-17', '7.77', 'expense', 'cancelled order', 'practice-cancelled', 'cancelled')
];
const descriptors = [
  { id: 'bank-csv', fileName: 'SYNTHETIC-practice-bank.csv', label: 'SYNTHETIC 银行练习 CSV', mimeType: 'text/csv;charset=utf-8', sourceKey: BANK_SOURCE, accountName: BANK, purpose: 'Six completed rows, one invalid amount, one cancelled order.', text: csv(bankRows) },
  { id: 'credit-tsv', fileName: 'SYNTHETIC-practice-credit.tsv', label: 'SYNTHETIC 信用练习 TSV', mimeType: 'text/tab-separated-values;charset=utf-8', sourceKey: CREDIT_SOURCE, accountName: CREDIT, purpose: 'Credit purchase and the real second leg of the cross-month repayment.', text: csv([
    row('2026-09-15', '300.00', 'expense', 'credit purchase', 'practice-credit-purchase'),
    row('2026-11-01', '100.00', 'income', 'repayment incoming', 'practice-repayment-in')
  ], '\t') },
  { id: 'coffee-correction', fileName: 'SYNTHETIC-practice-coffee-correction.csv', label: 'SYNTHETIC 同源金额修正 CSV', mimeType: 'text/csv;charset=utf-8', sourceKey: BANK_SOURCE, accountName: BANK, purpose: 'Change the same coffee ID from 12.34 to 13.34 yuan.', text: csv([row('2026-10-14', '13.34', 'expense', 'coffee', 'practice-coffee')]) },
  { id: 'coffee-cancellation', fileName: 'SYNTHETIC-practice-coffee-cancellation.csv', label: 'SYNTHETIC 同源取消 CSV', mimeType: 'text/csv;charset=utf-8', sourceKey: BANK_SOURCE, accountName: BANK, purpose: 'Optional status exercise after correction; removes its 13.34 yuan spend while preserving evidence.', text: csv([row('2026-10-14', '13.34', 'expense', 'coffee', 'practice-coffee', 'cancelled')]) }
];
function buildStarterState() {
  let state = L.putAccount(L.createEmpty(), { name: BANK, openingBalanceCents: 200000 }, 'account-cash');
  state = L.putAccount(state, { name: CREDIT, openingBalanceCents: 0 });
  return L.validateState(state);
}
function readStarter() { return L.parseBackup(fs.readFileSync(path.join(__dirname, '../dist/samples/SYNTHETIC-starter.json'), 'utf8')); }
function config(state, fileId) {
  const file = descriptors.find(row => row.id === fileId);
  if (!file) throw Error('Unknown synthetic practice file');
  const account = state.accounts.find(row => row.name === file.accountName);
  if (!account) throw Error('Use the independent SYNTHETIC starter first');
  return { sourceKey: file.sourceKey, accountId: account.id, delimiter: fileId === 'credit-tsv' ? '\t' : ',', header: true, startLine: 1,
    dateFormat: 'YYYY-MM-DD', amountMode: 'absolute', defaultType: 'expense',
    categoryIds: { expense: 'expense-other', income: 'income-other' },
    columns: { date: 0, amount: 1, direction: 2, note: 3, stableId: 4, status: 5, channel: 6 } };
}
function previewFile(state, fileId) {
  const file = descriptors.find(row => row.id === fileId);
  // Read the real delivered file bytes, rather than substituting constructed rows.
  return I.preview(state, fs.readFileSync(path.join(__dirname, '../dist/samples', file.fileName), 'utf8'), config(state, fileId));
}
function importFile(state, fileId) {
  const preview = previewFile(state, fileId);
  return I.commit(state, preview, preview.rows.filter(row => ['new', 'update', 'status'].includes(row.action)).map(row => row.key));
}
function transactionId(state, stableId) {
  const evidence = state.imports.evidence.find(row => row.stableId === stableId);
  if (!evidence?.transactionId) throw Error('Missing synthetic transaction ' + stableId);
  return evidence.transactionId;
}
function buildImportedPractice() {
  let state = readStarter();
  for (const id of ['bank-csv', 'credit-tsv', 'coffee-correction']) state = importFile(state, id);
  return state;
}
function buildCompletedPractice() {
  let state = buildImportedPractice();
  const tx = key => transactionId(state, 'practice-' + key);
  state = R.allocateRefund(state, { incomeId: tx('refund-in'), expenseId: tx('refundable'), amountCents: 1500, reason: 'SYNTHETIC practice: confirmed original purchase and actual receipt' });
  state = R.createClaim(state, { expenseId: tx('shared'), amountCents: 3000, kind: 'advance', name: 'SYNTHETIC third-party share', dueDate: '2026-11-15', status: 'submitted', note: 'SYNTHETIC practice' });
  const claimId = state.bookkeeping.claims[0].id;
  state = R.settleClaim(state, { incomeId: tx('claim-in'), claimId, amountCents: 2000, reason: 'SYNTHETIC actual partial receipt' });
  state = R.pairTransfer(state, { expenseId: tx('repayment-out'), incomeId: tx('repayment-in'), reason: 'SYNTHETIC same own-account transfer: October departure and November arrival' });
  const approve = () => ({ confirmed: true, expectedRevision: state.obligations?.revision || 0, reason: 'SYNTHETIC practice reviewed only' });
  for (const [name, role] of [[BANK, 'cash'], [CREDIT, 'credit']]) state = C.putProfile(state, { accountId: state.accounts.find(a => a.name === name).id, role, creditLimitCents: null, note: 'SYNTHETIC role' }, approve());
  const creditId = state.accounts.find(a => a.name === CREDIT).id;
  state = C.putContract(state, { accountId: creditId, name: 'SYNTHETIC three installments', principalCents: 30000, feeCents: 3, source: 'SYNTHETIC practice agreement; not an institution document', purchaseTransactionId: tx('credit-purchase'), status: 'active', schedule: C.splitSchedule({ principalCents: 30000, feeCents: 3, dates: ['2026-10-31', '2026-11-30', '2026-12-31'] }), note: 'SYNTHETIC full schedule' }, approve());
  state = C.putStatement(state, { accountId: creditId, provenance: 'official', periodStart: '2026-09-01', periodEnd: '2026-09-30', statementDate: '2026-10-01', dueDate: '2026-10-31', amountCents: 10001, source: 'SYNTHETIC practice statement; not a real bank statement', note: 'SYNTHETIC first principal installment plus 0.01 yuan fee' }, approve());
  const statementId = state.obligations.statements[0].id, contract = state.obligations.contracts[0];
  state = C.includeInstallment(state, { statementId, contractId: contract.id, installmentId: contract.schedule[0].id }, approve());
  state = C.allocateRepayment(state, { statementId, sourceKind: 'pair', sourceId: state.bookkeeping.transferPairs[0].id, amountCents: 10000 }, approve());
  return L.validateState(state);
}
module.exports = { L, I, R, C, FIXED_REFERENCE_DATE, BANK, CREDIT, BANK_SOURCE, CREDIT_SOURCE, HEADERS, descriptors, buildStarterState, readStarter, config, previewFile, importFile, transactionId, buildImportedPractice, buildCompletedPractice };
