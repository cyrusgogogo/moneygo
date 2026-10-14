'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ledger = require('../dist/ledger.js');

function copy(value) { return JSON.parse(JSON.stringify(value)); }
function errorCode(code) { return error => error instanceof ledger.LedgerError && error.code === code; }
function expense(overrides = {}) {
  return { type: 'expense', date: '2026-10-14', amountCents: 1234, accountId: 'account-cash', categoryId: 'expense-food', note: '', ...overrides };
}
function income(overrides = {}) {
  return { type: 'income', date: '2026-10-14', amountCents: 100000, accountId: 'account-cash', categoryId: 'income-salary', note: '', ...overrides };
}
function transfer(accountId, toAccountId, overrides = {}) {
  return { type: 'transfer', date: '2026-10-14', amountCents: 5000, accountId, toAccountId, note: '', ...overrides };
}
function twoAccounts() {
  const state = ledger.putAccount(ledger.createEmpty(), { name: '银行卡', openingBalanceCents: 50000 });
  return { state, bank: state.accounts[1].id };
}
function storage(initial = null) {
  let value = initial;
  const calls = [];
  return {
    calls,
    get value() { return value; },
    getItem(key) { calls.push(['get', key]); return value; },
    setItem(key, next) { calls.push(['set', key]); value = next; }
  };
}
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

test('UMD exports both CommonJS and a standalone browser API without a DOM', () => {
  assert.equal(ledger.VERSION, 1);
  assert.equal(ledger.STORAGE_KEY, 'moneygo.ledger.v1');
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/ledger.js'), 'utf8'), { window });
  assert.equal(window.MoneygoLedger.VERSION, 1);
  assert.equal(window.MoneygoLedger.parseAmount('0.29'), 29);
  assert.equal(window.MoneygoLedger.createEmpty().accounts[0].name, '现金');
  assert.ok(Object.isFrozen(ledger));
  assert.ok(Object.isFrozen(ledger.LIMITS));
});

test('empty ledgers have stable defaults, no transactions and independent nested data', () => {
  const first = ledger.createEmpty();
  const second = ledger.createEmpty();
  assert.deepEqual(first, ledger.validateState(first));
  assert.equal(first.currency, 'CNY');
  assert.deepEqual(first.transactions, []);
  assert.deepEqual(first.trash, []);
  assert.ok(first.categories.some(value => value.type === 'expense'));
  assert.ok(first.categories.some(value => value.type === 'income'));
  first.accounts[0].name = 'Changed';
  first.categories[0].name = 'Changed';
  assert.equal(second.accounts[0].name, '现金');
  assert.equal(second.categories[0].name, '餐饮');
});

test('decimal parser returns exact integer cents, including classic floating-point cases', () => {
  const pairs = [['0.01', 1], ['0.1', 10], ['0.29', 29], ['1.15', 115], ['10', 1000], [' 12.30 ', 1230], ['00012.03', 1203], ['9999999999.99', ledger.MAX_AMOUNT_CENTS]];
  for (const [input, expected] of pairs) assert.equal(ledger.parseAmount(input), expected, input);
  assert.equal(ledger.parseAmount('-12.30', { allowNegative: true }), -1230);
  assert.equal(ledger.parseAmount('0', { allowZero: true }), 0);
  assert.equal(ledger.parseAmount('-0.00', { allowNegative: true, allowZero: true }), 0);
  assert.equal(Object.is(ledger.parseAmount('-0.00', { allowNegative: true, allowZero: true }), -0), false);
});

test('decimal parser rejects rounding, exponent, separators, coercion and oversized amounts', () => {
  for (const value of ['', ' ', '.', '.01', '1.', '+1', '-1', '-0', '0', '0.00', '1.001', '1,000', '1e3', '0x10', 'NaN', 'Infinity', '￥1', '１２', '1 2', '10000000000', '9007199254740993', null, 12, {}, true]) {
    assert.throws(() => ledger.parseAmount(value), errorCode('INVALID_AMOUNT'), String(value));
  }
  assert.throws(() => ledger.parseAmount('-10000000000', { allowNegative: true }), errorCode('INVALID_AMOUNT'));
  assert.throws(() => ledger.parseAmount('1', null), errorCode('INVALID_DATA'));
});

test('dates use strict Gregorian validation without timezone or rollover surprises', () => {
  for (const date of ['0001-01-01', '2000-02-29', '2024-02-29', '2026-12-31', '9999-12-31']) assert.equal(ledger.validDate(date), true, date);
  for (const date of ['0000-01-01', '1900-02-29', '2026-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '2026-01-00', '2026-01-32', '2026-1-01', '2026-01-1', '2026-01-01T00:00:00Z', ' 2026-01-01', null, 20260101]) assert.equal(ledger.validDate(date), false, String(date));
});

test('all transaction mutations are immutable and editing preserves the identifier', () => {
  const initial = deepFreeze(ledger.createEmpty());
  const input = deepFreeze(expense());
  const added = ledger.putTransaction(initial, input);
  assert.equal(initial.transactions.length, 0);
  assert.equal(added.transactions.length, 1);
  const id = added.transactions[0].id;
  assert.ok(id.startsWith('transaction-'));
  const updated = ledger.putTransaction(deepFreeze(added), expense({ amountCents: 2500, note: '午餐', id: 'ignored-id' }), id);
  assert.equal(updated.transactions.length, 1);
  assert.equal(updated.transactions[0].id, id);
  assert.equal(updated.transactions[0].amountCents, 2500);
  assert.equal(added.transactions[0].amountCents, 1234);
  assert.notEqual(updated.accounts[0], added.accounts[0]);
  assert.throws(() => ledger.putTransaction(added, expense(), 'missing'), errorCode('NOT_FOUND'));
});

test('income, expense and transfer update exact balances; transfers never count as income or expense', () => {
  let { state, bank } = twoAccounts();
  state = ledger.putTransaction(state, income());
  state = ledger.putTransaction(state, expense({ amountCents: 10001 }));
  state = ledger.putTransaction(state, transfer('account-cash', bank, { amountCents: 25000 }));
  assert.deepEqual({ ...ledger.balances(state) }, { 'account-cash': 64999, [bank]: 75000 });
  assert.deepEqual(ledger.summary(state, '2026-10'), { incomeCents: 100000, expenseCents: 10001, transferCents: 25000, netCents: 89999 });
  assert.equal(Object.values(ledger.balances(state)).reduce((a, b) => a + b, 0), 50000 + 89999);
});

test('summary filters by full month and year; opening balances and trash never affect income', () => {
  let state = ledger.putAccount(ledger.createEmpty(), { name: '余额', openingBalanceCents: -300 });
  state = ledger.putTransaction(state, income({ date: '2025-10-31', amountCents: 100 }));
  state = ledger.putTransaction(state, income({ date: '2026-09-30', amountCents: 200 }));
  state = ledger.putTransaction(state, income({ date: '2026-10-01', amountCents: 300 }));
  state = ledger.putTransaction(state, expense({ date: '2026-10-31', amountCents: 50 }));
  state = ledger.putTransaction(state, income({ date: '2026-11-01', amountCents: 400 }));
  assert.deepEqual(ledger.summary(state, '2026-10'), { incomeCents: 300, expenseCents: 50, transferCents: 0, netCents: 250 });
  assert.equal(ledger.summary(state, '2025-10').incomeCents, 100);
  assert.equal(ledger.summary(state).incomeCents, 1000);
  assert.deepEqual(ledger.summary(state, '2027-10'), { incomeCents: 0, expenseCents: 0, transferCents: 0, netCents: 0 });
  state = ledger.deleteTransaction(state, state.transactions[2].id);
  assert.deepEqual(ledger.summary(state, '2026-10'), { incomeCents: 0, expenseCents: 50, transferCents: 0, netCents: -50 });
  for (const month of ['10', '2026-1', '2026-13', '0000-01', '2026-10-01', null, 202610]) {
    assert.throws(() => ledger.summary(state, month), errorCode('INVALID_MONTH'));
  }
});

test('transfers can be edited or converted while accounting remains balanced', () => {
  let { state, bank } = twoAccounts();
  state = ledger.putTransaction(state, transfer('account-cash', bank));
  const id = state.transactions[0].id;
  state = ledger.putTransaction(state, transfer(bank, 'account-cash', { amountCents: 999 }), id);
  assert.deepEqual({ ...ledger.balances(state) }, { 'account-cash': 999, [bank]: 49001 });
  state = ledger.putTransaction(state, expense({ amountCents: 25 }), id);
  assert.equal(Object.hasOwn(state.transactions[0], 'toAccountId'), false);
  assert.deepEqual({ ...ledger.balances(state) }, { 'account-cash': -25, [bank]: 50000 });
});

test('transaction validation rejects bad refs, type mismatches, self-transfers and invalid amounts', () => {
  const { state, bank } = twoAccounts();
  for (const input of [
    expense({ accountId: 'missing' }), expense({ categoryId: 'missing' }),
    expense({ categoryId: 'income-salary' }), income({ categoryId: 'expense-food' }),
    expense({ toAccountId: bank }), transfer('account-cash', bank, { categoryId: 'expense-food' }),
    transfer('account-cash', 'missing')
  ]) assert.throws(() => ledger.putTransaction(state, input), errorCode('INVALID_REFERENCE'));
  assert.throws(() => ledger.putTransaction(state, transfer(bank, bank)), errorCode('SAME_ACCOUNT'));
  assert.throws(() => ledger.putTransaction(state, expense({ type: 'refund' })), errorCode('INVALID_TYPE'));
  assert.throws(() => ledger.putTransaction(state, expense({ date: '2026-02-30' })), errorCode('INVALID_DATE'));
  for (const amountCents of [0, -1, 1.2, '100', null, NaN, Infinity, Number.MAX_SAFE_INTEGER, ledger.MAX_AMOUNT_CENTS + 1]) {
    assert.throws(() => ledger.putTransaction(state, expense({ amountCents })), errorCode('INVALID_AMOUNT'));
  }
});

test('empty irrelevant form fields are stripped and optional notes normalize to text', () => {
  const { state, bank } = twoAccounts();
  const result = ledger.putTransaction(state, transfer('account-cash', bank, { categoryId: '', note: undefined }));
  assert.equal(Object.hasOwn(result.transactions[0], 'categoryId'), false);
  assert.equal(result.transactions[0].note, '');
  const result2 = ledger.putTransaction(state, expense({ toAccountId: null }));
  assert.equal(Object.hasOwn(result2.transactions[0], 'toAccountId'), false);
});

test('delete and undo preserve full transaction data and cannot be repeated accidentally', () => {
  let { state, bank } = twoAccounts();
  state = ledger.putTransaction(state, transfer('account-cash', bank, { note: '账户间调拨', amountCents: 123 }));
  const transaction = copy(state.transactions[0]);
  const deleted = ledger.deleteTransaction(deepFreeze(state), transaction.id);
  assert.equal(deleted.transactions.length, 0);
  assert.equal(deleted.trash.length, 1);
  assert.deepEqual(deleted.trash[0].transaction, transaction);
  assert.equal(deleted.trash[0].id, transaction.id);
  assert.ok(Number.isFinite(Date.parse(deleted.trash[0].deletedAt)));
  assert.deepEqual({ ...ledger.balances(deleted) }, { 'account-cash': 0, [bank]: 50000 });
  assert.throws(() => ledger.deleteTransaction(deleted, transaction.id), errorCode('NOT_FOUND'));
  const restored = ledger.undoDelete(deepFreeze(deleted), transaction.id);
  assert.deepEqual(restored.transactions, [transaction]);
  assert.deepEqual(restored.trash, []);
  assert.deepEqual(ledger.balances(restored), ledger.balances(state));
  assert.throws(() => ledger.undoDelete(restored, transaction.id), errorCode('NOT_FOUND'));
});

test('accounts support signed opening balances, stable edits and safe removals', () => {
  const initial = ledger.createEmpty();
  let state = ledger.putAccount(deepFreeze(initial), { name: ' 信用卡 ', openingBalanceCents: -12345 });
  const id = state.accounts[1].id;
  assert.equal(state.accounts[1].name, '信用卡');
  assert.equal(ledger.balances(state)[id], -12345);
  state = ledger.putAccount(deepFreeze(state), { name: '新名称', openingBalanceCents: 300 }, id);
  assert.equal(state.accounts[1].id, id);
  assert.equal(ledger.balances(state)[id], 300);
  const removed = ledger.removeAccount(state, id);
  assert.equal(removed.accounts.length, 1);
  assert.throws(() => ledger.removeAccount(removed, 'account-cash'), errorCode('LAST_ACCOUNT'));
  assert.throws(() => ledger.removeAccount(state, 'missing'), errorCode('NOT_FOUND'));
  assert.throws(() => ledger.putAccount(state, { name: 'Missing', openingBalanceCents: 0 }, 'missing'), errorCode('NOT_FOUND'));
  assert.throws(() => ledger.putAccount(state, { name: 'Too much', openingBalanceCents: -ledger.MAX_AMOUNT_CENTS - 1 }), errorCode('INVALID_AMOUNT'));
});

test('accounts referenced by active or deleted transactions cannot be removed', () => {
  let { state, bank } = twoAccounts();
  state = ledger.putTransaction(state, transfer('account-cash', bank));
  for (const id of ['account-cash', bank]) assert.throws(() => ledger.removeAccount(state, id), errorCode('ACCOUNT_REFERENCED'));
  state = ledger.deleteTransaction(state, state.transactions[0].id);
  for (const id of ['account-cash', bank]) assert.throws(() => ledger.removeAccount(state, id), errorCode('ACCOUNT_REFERENCED'));
  state = ledger.putAccount(state, { name: '银行卡重命名', openingBalanceCents: 50000 }, bank);
  assert.equal(ledger.undoDelete(state, state.trash[0].id).transactions.length, 1);
});

test('categories support additions and renames but references prevent delete or incompatible type changes', () => {
  let state = ledger.putCategory(ledger.createEmpty(), { name: ' 学习 ', type: 'expense' });
  const id = state.categories.at(-1).id;
  assert.equal(state.categories.at(-1).name, '学习');
  state = ledger.putCategory(state, { name: '教育', type: 'expense' }, id);
  assert.equal(state.categories.at(-1).id, id);
  state = ledger.putTransaction(state, expense({ categoryId: id }));
  assert.throws(() => ledger.removeCategory(state, id), errorCode('CATEGORY_REFERENCED'));
  assert.throws(() => ledger.putCategory(state, { name: '教育', type: 'income' }, id), errorCode('INVALID_REFERENCE'));
  state = ledger.deleteTransaction(state, state.transactions[0].id);
  assert.throws(() => ledger.removeCategory(state, id), errorCode('CATEGORY_REFERENCED'));
  assert.throws(() => ledger.putCategory(state, { name: '教育', type: 'income' }, id), errorCode('INVALID_REFERENCE'));
  const unreferenced = ledger.removeCategory(state, 'expense-food');
  assert.equal(unreferenced.categories.some(value => value.id === 'expense-food'), false);
  assert.throws(() => ledger.removeCategory(state, 'missing'), errorCode('NOT_FOUND'));
  assert.throws(() => ledger.putCategory(state, { name: 'Missing', type: 'expense' }, 'missing'), errorCode('NOT_FOUND'));
  assert.throws(() => ledger.putCategory(state, { name: '转账', type: 'transfer' }), errorCode('INVALID_TYPE'));
});

test('names and notes have strict bounds without silently truncating user data', () => {
  for (const name of ['', '  ', 1, null, 'A'.repeat(81), 'name\u0000', 'line\nbreak']) {
    assert.throws(() => ledger.putAccount(ledger.createEmpty(), { name, openingBalanceCents: 0 }), errorCode('INVALID_NAME'));
  }
  const state = ledger.putAccount(ledger.createEmpty(), { name: 'A'.repeat(80), openingBalanceCents: 0 });
  assert.equal(state.accounts[1].name.length, 80);
  assert.equal(ledger.putTransaction(state, expense({ note: 'x'.repeat(500) })).transactions[0].note.length, 500);
  for (const note of ['x'.repeat(501), null, {}, 'abc\u0000', 'abc\u0007']) assert.throws(() => ledger.putTransaction(state, expense({ note })), errorCode('INVALID_NOTE'));
  assert.equal(ledger.putTransaction(state, expense({ note: '多行\n备注\t保留' })).transactions[0].note, '多行\n备注\t保留');
});

test('validation creates a deep sanitized copy and keeps HTML-looking content as inert text', () => {
  let state = ledger.putTransaction(ledger.createEmpty(), expense({ note: '<img src=x onerror=alert(1)> & "quoted"' }));
  state.accounts[0].name = '<script>alert(1)</script>';
  state.extra = { shouldNotPersist: true };
  state.accounts[0].secret = 'drop';
  state.categories[0].extra = 'drop';
  state.transactions[0].html = 'drop';
  const clean = ledger.validateState(deepFreeze(state));
  assert.deepEqual(Object.keys(clean), ['version', 'currency', 'accounts', 'categories', 'transactions', 'trash']);
  assert.equal(Object.hasOwn(clean.accounts[0], 'secret'), false);
  assert.equal(Object.hasOwn(clean.categories[0], 'extra'), false);
  assert.equal(Object.hasOwn(clean.transactions[0], 'html'), false);
  assert.equal(clean.accounts[0].name, '<script>alert(1)</script>');
  assert.equal(clean.transactions[0].note, '<img src=x onerror=alert(1)> & "quoted"');
  assert.notEqual(clean.accounts, state.accounts);
  assert.notEqual(clean.transactions[0], state.transactions[0]);
  const parsed = JSON.parse(ledger.backup(clean));
  parsed.data.__proto__ = { injected: true };
  parsed.data.accounts[0].__proto__ = { injected: true };
  assert.equal(Object.hasOwn(ledger.parseBackup(JSON.stringify(parsed)), '__proto__'), false);
  assert.equal({}.injected, undefined);
});

test('invalid state versions, currencies, array shape and sparse records are rejected', () => {
  for (const version of [undefined, '1', 0, 2]) assert.throws(() => ledger.validateState({ ...ledger.createEmpty(), version }), errorCode('INVALID_VERSION'));
  for (const currency of ['USD', undefined, null]) assert.throws(() => ledger.validateState({ ...ledger.createEmpty(), currency }), errorCode('INVALID_CURRENCY'));
  for (const field of ['accounts', 'categories', 'transactions', 'trash']) {
    assert.throws(() => ledger.validateState({ ...ledger.createEmpty(), [field]: {} }), errorCode('INVALID_DATA'));
    assert.throws(() => ledger.validateState({ ...ledger.createEmpty(), [field]: new Array(1) }), errorCode('INVALID_DATA'));
  }
  assert.throws(() => ledger.validateState({ ...ledger.createEmpty(), accounts: [] }), errorCode('LAST_ACCOUNT'));
  for (const value of [null, [], 3, 'data']) assert.throws(() => ledger.validateState(value), errorCode('INVALID_DATA'));
});

test('all identifiers are bounded and duplicate active, deleted or cross-entity ids are rejected', () => {
  for (const id of ['', '__proto__', 'constructor', 'prototype', 'contains space', '<script>', 'x'.repeat(101), 1]) {
    const state = ledger.createEmpty();
    state.accounts[0].id = id;
    assert.throws(() => ledger.validateState(state), errorCode('INVALID_ID'));
  }
  const state = ledger.createEmpty();
  state.accounts.push({ ...state.accounts[0] });
  assert.throws(() => ledger.validateState(state), errorCode('DUPLICATE_ID'));
  const categories = ledger.createEmpty();
  categories.categories.push({ ...categories.categories[0] });
  assert.throws(() => ledger.validateState(categories), errorCode('DUPLICATE_ID'));
  const cross = ledger.createEmpty();
  cross.categories[0].id = 'account-cash';
  assert.throws(() => ledger.validateState(cross), errorCode('DUPLICATE_ID'));
  const transactions = ledger.putTransaction(ledger.createEmpty(), expense());
  transactions.transactions.push({ ...transactions.transactions[0] });
  assert.throws(() => ledger.validateState(transactions), errorCode('DUPLICATE_ID'));
});

test('trash is deeply validated and cannot disguise an active duplicate', () => {
  const active = ledger.putTransaction(ledger.createEmpty(), expense());
  const state = ledger.deleteTransaction(active, active.transactions[0].id);
  const badId = copy(state);
  badId.trash[0].id = 'different';
  assert.throws(() => ledger.validateState(badId), errorCode('INVALID_ID'));
  const badTime = copy(state);
  for (const timestamp of ['2026-02-30T00:00:00.000Z', '2026-10-14', '2026-10-14T25:00:00.000Z', '0000-01-01T00:00:00.000Z', null]) {
    badTime.trash[0].deletedAt = timestamp;
    assert.throws(() => ledger.validateState(badTime), errorCode('INVALID_DATE'));
  }
  const duplicate = copy(state);
  duplicate.transactions.push(copy(duplicate.trash[0].transaction));
  assert.throws(() => ledger.validateState(duplicate), errorCode('DUPLICATE_ID'));
  const badReference = copy(state);
  badReference.trash[0].transaction.accountId = 'missing';
  assert.throws(() => ledger.validateState(badReference), errorCode('INVALID_REFERENCE'));
  const duplicateTrash = copy(state);
  duplicateTrash.trash.push(copy(duplicateTrash.trash[0]));
  assert.throws(() => ledger.validateState(duplicateTrash), errorCode('DUPLICATE_ID'));
});

test('resource limits apply to accounts, categories and active plus deleted rows', () => {
  for (const [field, limit] of [['accounts', ledger.LIMITS.accounts], ['categories', ledger.LIMITS.categories], ['transactions', ledger.LIMITS.rows], ['trash', ledger.LIMITS.rows]]) {
    const state = ledger.createEmpty();
    state[field] = Array(limit + 1).fill({});
    assert.throws(() => ledger.validateState(state), errorCode('ROW_LIMIT'));
  }
  const state = ledger.createEmpty();
  state.transactions = Array(ledger.LIMITS.rows).fill({});
  state.trash = [{}];
  assert.throws(() => ledger.validateState(state), errorCode('ROW_LIMIT'));
});

test('safe integer overflow is rejected even when individual amounts are valid', () => {
  const state = ledger.createEmpty();
  const count = Math.floor(Number.MAX_SAFE_INTEGER / ledger.MAX_AMOUNT_CENTS) + 1;
  assert.ok(count < ledger.LIMITS.rows);
  state.transactions = Array.from({ length: count }, (_, index) => ({ ...income({ amountCents: ledger.MAX_AMOUNT_CENTS }), id: 'income-' + index }));
  assert.throws(() => ledger.validateState(state), errorCode('AMOUNT_OVERFLOW'));
  const transfers = twoAccounts();
  transfers.state.accounts[0].openingBalanceCents = 0;
  transfers.state.accounts[1].openingBalanceCents = 0;
  transfers.state.transactions = Array.from({ length: count }, (_, index) => ({ ...transfer(index % 2 ? transfers.bank : 'account-cash', index % 2 ? 'account-cash' : transfers.bank, { amountCents: ledger.MAX_AMOUNT_CENTS }), id: 'transfer-' + index }));
  assert.throws(() => ledger.validateState(transfers.state), errorCode('AMOUNT_OVERFLOW'));
});

test('an undo that would overflow is rejected atomically and remains recoverable', () => {
  const state = ledger.createEmpty();
  const count = Math.floor(Number.MAX_SAFE_INTEGER / ledger.MAX_AMOUNT_CENTS);
  state.transactions = Array.from({ length: count }, (_, index) => ({ ...income({ amountCents: ledger.MAX_AMOUNT_CENTS }), id: 'income-' + index }));
  const transaction = { ...income({ amountCents: ledger.MAX_AMOUNT_CENTS }), id: 'deleted-income' };
  state.trash.push({ id: transaction.id, deletedAt: '2026-10-14T00:00:00.000Z', transaction });
  const clean = deepFreeze(ledger.validateState(state));
  assert.throws(() => ledger.undoDelete(clean, transaction.id), errorCode('AMOUNT_OVERFLOW'));
  assert.equal(clean.trash.length, 1);
  assert.equal(clean.transactions.length, count);
});

test('backup uses a versioned envelope and round-trips active and deleted transactions', () => {
  let { state, bank } = twoAccounts();
  state = ledger.putTransaction(state, transfer('account-cash', bank));
  state = ledger.putTransaction(state, income({ note: '工资🙂' }));
  state = ledger.deleteTransaction(state, state.transactions[0].id);
  const text = ledger.backup(deepFreeze(state));
  const envelope = JSON.parse(text);
  assert.equal(envelope.format, 'moneygo-backup');
  assert.equal(envelope.version, 1);
  assert.ok(Number.isFinite(Date.parse(envelope.exportedAt)));
  assert.deepEqual(envelope.data, state);
  assert.deepEqual(ledger.parseBackup(text), state);
  assert.notEqual(ledger.parseBackup(text), state);
  const restored = ledger.parseBackup(text);
  assert.equal(ledger.undoDelete(restored, restored.trash[0].id).transactions.length, 2);
});

test('backup import rejects malformed JSON, raw state, wrong versions and invalid nested data', () => {
  const valid = JSON.parse(ledger.backup(ledger.createEmpty()));
  assert.throws(() => ledger.parseBackup('{broken'), errorCode('INVALID_JSON'));
  assert.throws(() => ledger.parseBackup(JSON.stringify(ledger.createEmpty())), errorCode('INVALID_BACKUP'));
  assert.throws(() => ledger.parseBackup('null'), errorCode('INVALID_DATA'));
  for (const update of [{ format: 'other' }, { version: 2 }, { version: '1' }, { exportedAt: 'today' }, { data: {} }]) {
    assert.throws(() => ledger.parseBackup(JSON.stringify({ ...valid, ...update })), ledger.LedgerError);
  }
  const corrupt = copy(valid);
  corrupt.data.transactions = [{ ...expense({ categoryId: 'missing' }), id: 'tx-1' }];
  assert.throws(() => ledger.parseBackup(JSON.stringify(corrupt)), errorCode('INVALID_REFERENCE'));
  assert.throws(() => ledger.parseBackup({}), errorCode('INVALID_BACKUP'));
});

test('backup size limit counts UTF-8 bytes, not only JavaScript characters', () => {
  assert.throws(() => ledger.parseBackup(' '.repeat(ledger.LIMITS.backupBytes + 1)), errorCode('BACKUP_TOO_LARGE'));
  assert.throws(() => ledger.parseBackup('中'.repeat(Math.floor(ledger.LIMITS.backupBytes / 3) + 1)), errorCode('BACKUP_TOO_LARGE'));
  assert.throws(() => ledger.parseBackup('🙂'.repeat(Math.floor(ledger.LIMITS.backupBytes / 4) + 1)), errorCode('BACKUP_TOO_LARGE'));
});

test('load starts empty only when absent and save/load round-trip the validated state', () => {
  const store = storage();
  const first = ledger.load(store);
  assert.deepEqual(first, { state: ledger.createEmpty(), error: null });
  assert.equal(store.calls.some(value => value[0] === 'set'), false);
  const state = ledger.putTransaction(ledger.createEmpty(), expense());
  const saved = ledger.save(store, deepFreeze(state));
  assert.deepEqual(saved, state);
  assert.notEqual(saved, state);
  assert.deepEqual(ledger.load(store), { state, error: null });
  assert.deepEqual(store.calls, [['get', ledger.STORAGE_KEY], ['set', ledger.STORAGE_KEY], ['get', ledger.STORAGE_KEY]]);
});

test('corrupt storage is reported and preserved without any automatic write or reset', () => {
  const invalidState = ledger.createEmpty();
  invalidState.version = 99;
  for (const raw of ['{bad', '', 'null', JSON.stringify(invalidState)]) {
    const store = storage(raw);
    const result = ledger.load(store);
    assert.ok(result.error instanceof ledger.LedgerError);
    assert.deepEqual(result.state, ledger.createEmpty());
    assert.equal(store.value, raw);
    assert.deepEqual(store.calls, [['get', ledger.STORAGE_KEY]]);
  }
});

test('unavailable storage, read errors and quota failures are explicit', () => {
  assert.equal(ledger.load(undefined).error.code, 'STORAGE_UNAVAILABLE');
  const failure = new Error('Access denied');
  const result = ledger.load({ getItem() { throw failure; } });
  assert.equal(result.error.code, 'STORAGE_READ_FAILED');
  assert.equal(result.error.cause, failure);
  assert.throws(() => ledger.save(null, ledger.createEmpty()), errorCode('STORAGE_UNAVAILABLE'));
  const quota = new Error('QuotaExceededError');
  assert.throws(() => ledger.save({ setItem() { throw quota; } }, ledger.createEmpty()), error => error.code === 'STORAGE_WRITE_FAILED' && error.cause === quota);
});

test('invalid changes are validated before persistence and do not mutate prior data', () => {
  const state = ledger.createEmpty();
  const store = storage(JSON.stringify(state));
  const invalid = copy(state);
  invalid.transactions.push({ ...expense({ amountCents: 0 }), id: 'bad' });
  assert.throws(() => ledger.save(store, invalid), errorCode('INVALID_AMOUNT'));
  assert.equal(store.calls.length, 0);
  assert.deepEqual(JSON.parse(store.value), state);
  const extra = { ...state, password: 'should-not-be-saved' };
  ledger.save(store, extra);
  assert.equal(Object.hasOwn(JSON.parse(store.value), 'password'), false);
});

test('generated identifiers are unique across many rapid writes and fallback environments', () => {
  const source = fs.readFileSync(path.join(__dirname, '../dist/ledger.js'), 'utf8');
  const window = {};
  vm.runInNewContext(source, { window });
  const browser = window.MoneygoLedger;
  let state = browser.createEmpty();
  for (let i = 0; i < 100; i++) state = browser.putTransaction(state, expense());
  assert.equal(new Set(state.transactions.map(value => value.id)).size, 100);
  assert.equal(state.transactions.length, 100);
});

test('cryptographic identifier collisions fail safely instead of overwriting a record', () => {
  const source = fs.readFileSync(path.join(__dirname, '../dist/ledger.js'), 'utf8');
  const window = { crypto: { randomUUID: () => 'stable-test-id' } };
  vm.runInNewContext(source, { window });
  const browser = window.MoneygoLedger;
  const state = browser.putTransaction(browser.createEmpty(), expense());
  assert.throws(() => browser.putTransaction(state, expense()), error => error.code === 'ID_FAILURE');
  assert.equal(state.transactions.length, 1);
});
