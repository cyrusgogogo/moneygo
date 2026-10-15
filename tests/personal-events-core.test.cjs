'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const D = process.env.MONEYGO_DIST || path.join(__dirname, '../dist');
const L = require(path.join(D, 'ledger.js'));
const R = require(path.join(D, 'relations.js'));
const E = require(path.join(D, 'personal-events.js'));
const oracleFile = path.join(__dirname, 'fixtures/personal-events-legacy-oracle.json');
const clone = value => JSON.parse(JSON.stringify(value));
const plain = value => clone(value);
const max = 999999999999;
const stamp = '2026-10-14T10:00:00.000Z';
const errorIs = (name, code) => error => error.name === name && error.code === code;
function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(freeze); }
  return value;
}
function expense(id, amountCents, date = '2026-09-01', accountId = 'account-cash') {
  return { id, type: 'expense', date, amountCents, accountId, categoryId: 'expense-food', note: '' };
}
function income(id, amountCents, date = '2026-10-01', accountId = 'account-cash') {
  return { ...expense(id, amountCents, date, accountId), type: 'income', categoryId: 'income-other' };
}
function state(rows = []) {
  const result = L.createEmpty();
  result.accounts.push({ id: 'bank', name: 'Synthetic bank', openingBalanceCents: 100000 });
  result.transactions = rows;
  return result;
}
function oldFields(result) {
  const { personalExpenseEvents, personalIncomeEvents, ...legacy } = result;
  return legacy;
}
function checkProjection(book, month) {
  const result = R.calculate(book, month), events = L.personalEvents(book, month);
  assert.deepEqual(events, { expenseEvents: result.personalExpenseEvents, incomeEvents: result.personalIncomeEvents });
  const total = E.reduce(events.expenseEvents.concat(events.incomeEvents));
  assert.equal(total.incomeCents, result.personal.incomeCents);
  assert.equal(total.expenseCents, result.personal.expenseCents);
  assert.equal(total.netCents, result.personal.netCents);
  assert.deepEqual(L.summary(book, month), {
    incomeCents: total.incomeCents, expenseCents: total.expenseCents,
    transferCents: result.personal.transferCents, netCents: total.netCents
  });
  for (const [kind, rows] of [['expense', events.expenseEvents], ['income', events.incomeEvents]]) {
    const raw = book.transactions.filter(row => row.type === kind && (month === undefined || row.date.slice(0, 7) === month));
    assert.deepEqual(rows.map(event => event.origin.transactionId), raw.map(row => row.id));
    rows.forEach((event, index) => {
      assert.deepEqual(event.key, { kind: 'transaction-' + kind, id: raw[index].id });
      assert.deepEqual(event.route, { kind: 'transaction', transactionId: raw[index].id });
      assert.equal(event.effectiveDate, raw[index].date);
      assert.equal(event.categoryId, raw[index].categoryId);
      assert.equal(event.attribution.accountId, raw[index].accountId);
      assert.ok(Object.isFrozen(event));
      assert.ok(Object.isFrozen(event.route));
    });
  }
  return result;
}

function loadVM(dir, modules = ['personal-events', 'ledger', 'relations', 'scenario', 'organizer', 'obligations', 'importer']) {
  const counts = { Ledger: 0, Relations: 0, RelationsCalculate: 0, Organizer: 0, Obligations: 0 };
  const leaf = { projectLegacy: 0, select: 0, reduce: 0, facts: 0, selected: 0, reduced: 0 };
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [stamp])); } static now() { return Date.parse(stamp); } }
  const context = vm.createContext({ window: {}, Date: FixedDate, TextEncoder, __counts: counts });
  const tokens = {
    ledger: ['function validateState(input) {', 'Ledger'],
    relations: ['function validate(input, state) {', 'Relations'],
    organizer: ['function validate(value, state) {', 'Organizer'],
    obligations: ['function validate(input, state) {', 'Obligations']
  };
  for (const module of modules) {
    const file = path.join(dir, module + '.js');
    let source = fs.readFileSync(file, 'utf8');
    if (tokens[module]) {
      const [token, name] = tokens[module];
      assert.equal(source.split(token).length, 2, 'Unambiguous validator instrumentation: ' + module);
      source = source.replace(token, token + ' __counts.' + name + '++;');
    }
    if (module === 'relations') source = source.replace('function calculate(state, month) {', 'function calculate(state, month) { __counts.RelationsCalculate++;');
    vm.runInContext(source, context, { filename: file });
  }
  if (context.window.MoneygoPersonalEvents) {
    const engine = context.window.MoneygoPersonalEvents;
    context.window.MoneygoPersonalEvents = Object.freeze({ ...engine,
      projectLegacy(facts) { leaf.projectLegacy++; leaf.facts += facts.length; return engine.projectLegacy(facts); },
      select(events, query) { leaf.select++; leaf.selected += events.length; return engine.select(events, query); },
      reduce(events) { leaf.reduce++; leaf.reduced += events.length; return engine.reduce(events); }
    });
  }
  function run(expression, input) {
    Object.keys(counts).forEach(key => { counts[key] = 0; });
    Object.keys(leaf).forEach(key => { leaf[key] = 0; });
    context.__json = JSON.stringify(input);
    const result = vm.runInContext('(function () { const input = JSON.parse(__json); const L = window.MoneygoLedger, R = window.MoneygoRelations, S = window.MoneygoScenario; return (' + expression + '); }())', context);
    return { result, counts: { ...counts }, leaf: { ...leaf } };
  }
  return { context, run };
}

test('plain projection preserves raw order, raw compatibility map, trash exclusion and summary shape', () => {
  const book = state([expense('transaction-expense-like', 1234), income('receipt', 8000),
    { id: 'native', type: 'transfer', date: '2026-10-02', amountCents: 500, accountId: 'account-cash', toAccountId: 'bank', note: '' }]);
  book.trash.push({ id: 'deleted', deletedAt: stamp, transaction: expense('deleted', 51) });
  const original = JSON.stringify(book);
  freeze(book);
  const result = checkProjection(book);
  assert.deepEqual(Object.keys(L.personalEvents(book)), ['expenseEvents', 'incomeEvents']);
  assert.deepEqual(L.expenseAmounts(book), { 'transaction-expense-like': 1234, receipt: 0, native: 0 });
  assert.equal(result.drilldown.personal.length, 3);
  assert.equal(result.personalExpenseEvents.length + result.personalIncomeEvents.length, 2);
  assert.deepEqual(result.cash, { incomeCents: 8000, expenseCents: 1234, transferCents: 500, netCents: 6766 });
  assert.equal(JSON.stringify(book), original);
  assert.equal(JSON.stringify(L.validateState(book)), original);
  assert.equal(Object.hasOwn(L.validateState(book), 'bookkeeping'), false);
  checkProjection(book, '2026-09'); checkProjection(book, '2026-10'); checkProjection(book, '2026-12');
});

test('cross-month allocations retain purchase and receipt dates and exact auxiliary fields', () => {
  let book = state([expense('purchase', 12001, '2026-01-12'), income('refund-receipt', 3333, '2026-02-03'), income('settlement', 2500, '2026-03-02')]);
  book = R.allocateRefund(book, { expenseId: 'purchase', incomeId: 'refund-receipt', amountCents: 2222, reason: 'Synthetic refund' });
  book = R.createClaim(book, { expenseId: 'purchase', amountCents: 3000, kind: 'advance', name: 'Synthetic claim' });
  book = R.settleClaim(book, { claimId: book.bookkeeping.claims[0].id, incomeId: 'settlement', amountCents: 2000, reason: 'Synthetic repayment' });
  const all = checkProjection(book);
  assert.deepEqual(all.personal, { incomeCents: 1611, expenseCents: 6779, transferCents: 0, netCents: -5168, refundCents: 2222, claimCents: 3000 });
  for (const [month, expenseCents, incomeCents] of [['2026-01', 6779, 0], ['2026-02', 0, 1111], ['2026-03', 0, 500]]) {
    const result = checkProjection(book, month);
    assert.equal(result.personal.expenseCents, expenseCents); assert.equal(result.personal.incomeCents, incomeCents);
    assert.deepEqual(result.impacts, all.impacts);
  }
  assert.equal(all.receivables.outstandingCents, 1000);
});

test('duplicate and paired zeros retain their own trace dates, while legacy drilldowns keep old population', () => {
  let book = state([expense('out', 10001, '2026-09-01', 'bank'), expense('shadow', 10001, '2026-10-02', 'bank'), income('in', 10001, '2026-10-03'), expense('fee', 27),
    { id: 'native', type: 'transfer', date: '2026-10-04', amountCents: 50, accountId: 'bank', toAccountId: 'account-cash', note: '' }]);
  book.transactions[1].categoryId = 'expense-shopping';
  book = R.linkEvidence(book, { primaryId: 'out', shadowId: 'shadow', reason: 'Synthetic duplicate' });
  book = R.pairTransfer(book, { expenseId: 'out', incomeId: 'in', reason: 'Synthetic pair' });
  const result = checkProjection(book);
  assert.deepEqual(result.personalExpenseEvents.map(event => [event.key.id, event.amountCents, event.suppression]), [['out', 0, 'transfer-leg'], ['shadow', 0, 'duplicate-evidence'], ['fee', 27, null]]);
  assert.equal(result.personalIncomeEvents[0].suppression, 'transfer-leg');
  assert.deepEqual(result.drilldown.personal.map(row => row.transactionId), ['out', 'in', 'fee', 'native']);
  assert.deepEqual(result.excludedEvidence.map(row => row.transactionId), ['shadow']);
  assert.deepEqual(L.expenseAmounts(book), { out: 0, shadow: 0, in: 0, fee: 27, native: 0 });
  const october = checkProjection(book, '2026-10');
  assert.deepEqual(october.personalExpenseEvents.map(event => [event.key.id, event.effectiveDate, event.categoryId]), [['shadow', '2026-10-02', 'expense-shopping']]);
  assert.equal(result.personal.transferCents, 10051);
});

test('composite personal-only attribution is its own source account and funding-only is a zero trace', () => {
  let book = state([expense('personal-a', 3000, '2026-09-02'), expense('personal-b', 7000, '2026-10-02'), expense('funding', 10000, '2026-10-03', 'bank'), income('refund', 1000, '2026-11-01', 'bank')]);
  const ticket = R.previewComposite(book, { name: 'Synthetic composite', personalIds: ['personal-a', 'personal-b'], fundingIds: ['funding'], paidCents: 10000, grossCents: null, discountCents: null });
  book = R.createComposite(book, ticket, { confirmed: true, reason: 'Synthetic confirmed source roles' });
  book = R.allocateRefund(book, { expenseId: 'personal-a', incomeId: 'refund', amountCents: 1000, reason: 'Synthetic refund' });
  book = R.createClaim(book, { expenseId: 'personal-b', amountCents: 2000, kind: 'advance', name: 'Synthetic claim' });
  const all = checkProjection(book);
  assert.deepEqual(all.personalExpenseEvents.map(event => [event.key.id, event.amountCents, event.attribution.accountId, event.suppression]), [['personal-a', 2000, 'account-cash', null], ['personal-b', 5000, 'account-cash', null], ['funding', 0, 'bank', 'composite-nonpersonal']]);
  assert.deepEqual(plain(all.accountBalances), { 'account-cash': 0, bank: 91000 });
  for (const month of ['2026-09', '2026-10', '2026-11']) checkProjection(book, month);
  assert.equal(E.reduce(E.select(all.personalExpenseEvents, { accountId: 'account-cash' })).expenseCents, 7000);
});

test('direct Relations preserves broad own-data category compatibility; full Ledger stays strict', () => {
  const invalid = [undefined, null, 14, 'bad/category', '', 'constructor', 'prototype', {}, Symbol('classification')];
  for (const category of invalid.concat(['missing-category', 'income-other'])) {
    const book = state([expense('e', 101), income('i', 51)]);
    if (category === undefined) delete book.transactions[0].categoryId; else book.transactions[0].categoryId = category;
    const result = R.calculate(book);
    assert.deepEqual(result.personal, { incomeCents: 51, expenseCents: 101, transferCents: 0, netCents: -50, refundCents: 0, claimCents: 0 });
    assert.equal(result.personalExpenseEvents[0].categoryId, category === 'missing-category' || category === 'income-other' ? category : null);
    assert.throws(() => L.validateState(book), error => error.name === 'LedgerError' && ['INVALID_ID', 'INVALID_REFERENCE'].includes(error.code));
  }
  const noTable = state([expense('e', 101), income('i', 51)]); delete noTable.categories;
  assert.equal(R.calculate(noTable).personalExpenseEvents[0].categoryId, 'expense-food');
  let reads = 0;
  const nested = { get ignored() { reads++; throw Error('must not inspect classification'); }, toString() { reads++; throw Error('must not coerce classification'); } };
  noTable.transactions[0].categoryId = nested;
  assert.equal(R.calculate(noTable).personalExpenseEvents[0].categoryId, null);
  assert.equal(reads, 0);
});

test('direct Relations rejects accessor and inherited records without reading classification getters', () => {
  let reads = 0;
  const book = state([expense('e', 101)]);
  Object.defineProperty(book.transactions[0], 'categoryId', { enumerable: true, get() { reads++; throw Error('getter invoked'); } });
  assert.throws(() => R.calculate(book), errorIs('RelationsError', 'INVALID_RELATIONS'));
  assert.equal(reads, 0);
  const inherited = state([expense('e', 101)]);
  Object.setPrototypeOf(inherited.transactions[0], { categoryId: 'expense-food' });
  assert.throws(() => R.calculate(inherited), errorIs('RelationsError', 'INVALID_RELATIONS'));
});

test('Gregorian boundary dates and empty selections retain recorded chronology', () => {
  const book = state([expense('first', 1, '0001-01-01'), expense('leap', 2, '2000-02-29'), expense('last', 3, '9999-12-31'), income('future', 4, '9999-12-31')]);
  assert.deepEqual(L.personalEvents(book).expenseEvents.map(event => event.effectiveDate), ['0001-01-01', '2000-02-29', '9999-12-31']);
  checkProjection(book, '0001-01'); checkProjection(book, '2000-02'); checkProjection(book, '9999-12');
  for (const date of ['0000-01-01', '1900-02-29', '2026-02-30', '2026-01-01x', ' 2026-01-01']) {
    const invalid = state([expense('visible', 1), expense('hidden', 1, date)]);
    assert.throws(() => L.personalEvents(invalid, '2026-09'), errorIs('LedgerError', 'INVALID_DATE'));
    assert.throws(() => R.calculate(invalid, '2026-09'), errorIs('RelationsError', 'INVALID_DATE'));
  }
});

test('9008-row transient-overflow counterexample preserves distinct plain and bookkeeping domains', () => {
  const book = state(Array.from({ length: 9007 }, (_, index) => expense('expense-' + index, max)));
  book.accounts = book.accounts.slice(0, 1); book.accounts[0].openingBalanceCents = -max;
  book.transactions.push(income('income', max, '2026-09-01'));
  for (const call of [() => L.summary(book), () => L.personalEvents(book), () => L.balances(book), () => L.summary(book, '2026-10')]) assert.throws(call, errorIs('LedgerError', 'AMOUNT_OVERFLOW'));
  const extended = { ...book, version: 4, bookkeeping: R.defaultState() };
  assert.deepEqual(L.summary(extended), { incomeCents: max, expenseCents: 9006999999990993, transferCents: 0, netCents: -9005999999990994 });
  assert.equal(L.balances(extended)['account-cash'], -9006999999990993);
  assert.equal(L.personalEvents(extended).expenseEvents.length, 9007);
  assert.deepEqual(L.summary(extended, '2026-10'), { incomeCents: 0, expenseCents: 0, transferCents: 0, netCents: 0 });
});

test('all-date gross overflow remains the original model error even for an empty selected month', () => {
  const book = state(Array.from({ length: 9008 }, (_, index) => expense('e-' + index, max, '2026-09-01', index % 2 ? 'bank' : 'account-cash')));
  book.transactions.push(...Array.from({ length: 992 }, (_, index) => income('i-' + index, max, '2026-09-01', index % 2 ? 'bank' : 'account-cash')));
  assert.throws(() => L.summary(book, '2026-10'), errorIs('LedgerError', 'AMOUNT_OVERFLOW'));
  assert.throws(() => L.personalEvents(book, '2026-10'), errorIs('LedgerError', 'AMOUNT_OVERFLOW'));
  assert.throws(() => R.calculate(book, '2026-10'), errorIs('RelationsError', 'AMOUNT_OVERFLOW'));
  const extended = { ...book, version: 4, bookkeeping: R.defaultState() };
  assert.throws(() => L.personalEvents(extended, '2026-10'), errorIs('RelationsError', 'AMOUNT_OVERFLOW'));
  const invalidOpening = state(); invalidOpening.accounts[0].openingBalanceCents = max + 1;
  assert.throws(() => L.summary(invalidOpening), errorIs('LedgerError', 'INVALID_AMOUNT'));
});

test('personalEvents checks month first while old entry points keep their original error order', () => {
  for (const month of [null, '', '0000-01', '2026-00', '2026-13', '2026-1', 202609, {}]) {
    assert.throws(() => L.personalEvents({ version: 999 }, month), errorIs('LedgerError', 'INVALID_MONTH'));
    assert.throws(() => L.summary({ version: 999 }, month), errorIs('LedgerError', 'INVALID_MONTH'));
    assert.throws(() => R.calculate({ version: 999 }, month), errorIs('RelationsError', 'INVALID_MONTH'));
    assert.throws(() => L.financialView({ version: 999 }, month), errorIs('LedgerError', 'INVALID_VERSION'));
  }
  assert.throws(() => L.personalEvents({ version: 999 }), errorIs('LedgerError', 'INVALID_VERSION'));
});

test('module loading is lazy and plain Ledger calculation requires only the leaf', () => {
  const bare = loadVM(D, ['ledger']);
  assert.equal(bare.context.window.MoneygoLedger.createEmpty().version, 1);
  assert.equal(bare.context.window.MoneygoLedger.parseAmount('1.23'), 123);
  const alone = loadVM(D, ['personal-events', 'ledger']);
  const book = state([expense('e', 101), income('i', 51)]);
  for (const expression of ['L.summary(input)', 'L.balances(input)', 'L.personalEvents(input)', 'L.validateState(input)']) {
    const run = alone.run(expression, book);
    assert.equal(run.counts.Ledger, 1);
    assert.equal(run.counts.Relations, 0);
    assert.equal(run.counts.RelationsCalculate, 0);
  }
});

test('all legacy guards finish before any leaf call on a rejected plain book', () => {
  const host = loadVM(D, ['personal-events', 'ledger']);
  const book = state(Array.from({ length: 9007 }, (_, index) => expense('e-' + index, max)));
  book.accounts = book.accounts.slice(0, 1); book.accounts[0].openingBalanceCents = -max;
  book.transactions.push(income('i', max, '2026-09-01'));
  const leaf = host.context.window.MoneygoPersonalEvents;
  host.context.window.MoneygoPersonalEvents = { ...leaf, projectLegacy() { throw Error('leaf ran before old guard'); } };
  assert.throws(() => host.run('L.summary(input)', book), errorIs('LedgerError', 'AMOUNT_OVERFLOW'));
});

test('bounded core projection work grows linearly and does not validate once per event', () => {
  const host = loadVM(D);
  const observed = [];
  for (const count of [1000, 10000]) {
    const book = state(Array.from({ length: count }, (_, index) => index % 2 ? income('i-' + index, 1, '2026-09-01') : expense('e-' + index, 1)));
    const run = host.run('L.summary(input, "2026-09")', book);
    assert.deepEqual(run.counts, { Ledger: 1, Relations: 0, RelationsCalculate: 0, Organizer: 0, Obligations: 0 });
    assert.equal(run.leaf.projectLegacy, 2); assert.equal(run.leaf.facts, count * 2);
    assert.equal(run.leaf.reduce, 2); assert.equal(run.leaf.reduced, count * 2);
    assert.equal(run.leaf.select, 2); assert.equal(run.leaf.selected, count);
    assert.equal(run.result.expenseCents, count / 2); assert.equal(run.result.incomeCents, count / 2);
    observed.push(run.leaf);
  }
  for (const field of ['facts', 'selected', 'reduced']) assert.equal(observed[1][field], observed[0][field] * 10);
});

test('frozen v0.13 validator-call ceilings and raw-map replacement counts are unchanged', () => {
  const current = loadVM(D);
  const base = state([expense('e', 101)]), extended = { ...base, version: 4, bookkeeping: R.defaultState() };
  const operations = ['L.summary(input)', 'L.financialView(input)', 'L.expenseAmounts(input)', 'L.balances(input)', 'L.validateState(input)', 'S.calculate(input, {...S.defaultSettings(), completeMonths:["2026-09"]}, "2026-10-14")'];
  // Captured independently from immutable v0.13, before the event adapters.
  // Tuple order: Ledger.validateState, Relations.validate, Relations.calculate.
  const baseline = [
    [[1, 0, 0], [1, 1, 1], [1, 0, 0], [1, 0, 0], [1, 0, 0], [2, 0, 0]],
    [[1, 3, 2], [1, 3, 2], [1, 3, 2], [1, 3, 2], [1, 2, 1], [2, 5, 3]]
  ];
  const counts = ([Ledger, Relations, RelationsCalculate]) => ({ Ledger, Relations, RelationsCalculate, Organizer: 0, Obligations: 0 });
  for (const [index, book] of [base, extended].entries()) {
    for (const [operationIndex, operation] of operations.entries()) {
      const after = current.run(operation, book);
      assert.deepEqual(after.counts, counts(baseline[index][operationIndex]), operation + ' bookkeeping=' + Boolean(book.bookkeeping));
    }
    const after = current.run('L.personalEvents(input)', book);
    assert.deepEqual(after.counts, counts(baseline[index][2]), 'one-for-one event retrieval replacement');
  }
});

test('portable locked v0.13 fixtures match every old core field, events, normalization and backup bytes', () => {
  const bytes = fs.readFileSync(oracleFile);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), 'b89e7f54077a9ee1e9f4b86d0109995913cd421f83399eb72c80a43bb1b92890');
  const oracle = JSON.parse(bytes), current = loadVM(D);
  const expected = (fixture, operation) => {
    const outcome = JSON.parse(fixture.expected[operation]);
    assert.equal(outcome.accepted, true, fixture.id + ' frozen ' + operation);
    return outcome.value;
  };
  assert.equal(oracle.fixtures.length, 22);
  for (const fixture of oracle.fixtures) {
    const input = freeze(clone(fixture.inputState)), before = JSON.stringify(input);
    for (const month of [undefined, ...fixture.months]) {
      const scope = month === undefined ? 'all' : month;
      const result = R.calculate(input, month);
      const expenseEvents = fixture.expectedEvents.personalExpenseEvents.filter(event => month === undefined || event.effectiveDate.slice(0, 7) === month);
      const incomeEvents = fixture.expectedEvents.personalIncomeEvents.filter(event => month === undefined || event.effectiveDate.slice(0, 7) === month);
      assert.deepEqual(plain(oldFields(result)), expected(fixture, 'relations:' + scope), fixture.id + ' ' + scope);
      assert.deepEqual(plain(oldFields(L.financialView(input, month))), expected(fixture, 'financialView:' + scope));
      assert.deepEqual(result.personalExpenseEvents, expenseEvents, fixture.id + ' expense ' + scope);
      assert.deepEqual(result.personalIncomeEvents, incomeEvents, fixture.id + ' income ' + scope);
      assert.deepEqual(L.summary(input, month), expected(fixture, 'summary:' + scope));
      assert.deepEqual(L.personalEvents(input, month), { expenseEvents, incomeEvents });
    }
    assert.deepEqual(L.expenseAmounts(input), expected(fixture, 'expenseAmounts'));
    assert.deepEqual(plain(L.balances(input)), expected(fixture, 'balances'));
    assert.equal(JSON.stringify(L.validateState(input)), JSON.stringify(expected(fixture, 'normalized')), fixture.id + ' normalized bytes');
    assert.equal(current.run('L.backup(input)', input).result, expected(fixture, 'backup'), fixture.id + ' backup bytes');
    const scenario = current.run('S.calculate(input, ' + JSON.stringify(fixture.settings) + ', "2026-10-14")', input).result;
    assert.deepEqual(plain(scenario), expected(fixture, 'scenario'), fixture.id + ' scenario compatibility');
    assert.equal(JSON.stringify(input), before, fixture.id + ' immutable input');
  }
});
