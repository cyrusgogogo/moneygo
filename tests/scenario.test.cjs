'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Ledger = require('../dist/ledger.js');
const Scenario = require('../dist/scenario.js');

const TODAY = '2026-10-14';
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
function code(expected) { return error => error instanceof Scenario.ScenarioError && error.code === expected; }
function settings(overrides = {}) { return { ...Scenario.defaultSettings(), ...overrides }; }
function plan(overrides = {}) { return { id: 'scenario-main', name: '我的方案', adjustments: [], oneOffs: [], ...overrides }; }
function adjustment(categoryId, mode, value) { return { categoryId, mode, value }; }
function oneOff(overrides = {}) {
  return { id: 'oneoff-trip', name: '旅行', month: '2026-12', categoryId: 'expense-food', amountCents: 10000, ...overrides };
}
function row(id, amountCents, date = '2026-09-15', categoryId = 'expense-food', type = 'expense') {
  return { id, type, date, amountCents, categoryId, accountId: 'account-cash', note: '' };
}
function state(rows = [], categories) {
  const result = Ledger.createEmpty();
  result.transactions = rows;
  if (categories) result.categories = categories;
  return Ledger.validateState(result);
}
function singleCategory(rows = []) {
  return state(rows, [{ id: 'expense-food', name: '餐饮', type: 'expense' }]);
}
function calculate(ledger = state(), input = settings()) { return Scenario.calculate(ledger, input, TODAY); }
function category(result, id = 'expense-food', scenarioIndex = 0) {
  return result.scenarios[scenarioIndex].categories.find(value => value.categoryId === id);
}
function warning(result, expected) { return result.warnings.find(value => value.code === expected); }

test('UMD exports immutable CommonJS and browser APIs without DOM, storage, time or network', () => {
  assert.equal(Scenario.VERSION, 1);
  assert.ok(Object.isFrozen(Scenario));
  assert.ok(Object.isFrozen(Scenario.LIMITS));
  const window = {};
  const context = { window, Date: class { constructor() { throw Error('Clock forbidden'); } } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/personal-events.js'), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/ledger.js'), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../dist/scenario.js'), 'utf8'), context);
  const browser = window.MoneygoScenario;
  assert.equal(browser.VERSION, 1);
  assert.equal(browser.defaultSettings().scenarios[0].name, '我的方案');
  assert.equal(browser.calculate(window.MoneygoLedger.createEmpty(), browser.defaultSettings(), TODAY).baseline.totalCents, null);
});

test('defaults are fresh, deterministic, valid and do not imply any confirmed history', () => {
  const first = Scenario.defaultSettings();
  const second = Scenario.defaultSettings();
  assert.deepEqual(first, Scenario.validate(first));
  assert.deepEqual(first.completeMonths, []);
  assert.deepEqual(first.exclusions, []);
  assert.equal(first.activeId, 'scenario-main');
  first.scenarios[0].name = 'Changed';
  first.scenarios[0].adjustments.push(adjustment('expense-food', 'amount', 1));
  first.completeMonths.push('2026-09');
  assert.equal(second.scenarios[0].name, '我的方案');
  assert.equal(second.scenarios[0].adjustments.length, 0);
  assert.equal(second.completeMonths.length, 0);
});

test('validation and calculation are immutable, detached and repeatable on deeply frozen inputs', () => {
  const ledger = freeze(state([row('transaction-lunch', 501)]));
  const input = freeze(settings({ completeMonths: ['2026-08', '2026-09'], scenarios: [plan({
    adjustments: [adjustment('expense-food', 'percent', 25)], oneOffs: [oneOff()]
  })] }));
  const originalLedger = copy(ledger);
  const originalSettings = copy(input);
  const normalized = Scenario.validate(input, ledger);
  const first = calculate(ledger, input);
  const second = calculate(ledger, input);
  assert.deepEqual(first, second);
  normalized.scenarios[0].adjustments[0].value = 99;
  first.baseline.categories[0].name = 'Changed';
  first.baseline.months[0].categoryTotals['expense-food'] = 123;
  first.scenarios[0].categories[0].name = 'Changed';
  assert.deepEqual(ledger, originalLedger);
  assert.deepEqual(input, originalSettings);
  assert.notEqual(second.baseline.categories[0].name, 'Changed');
  assert.equal(second.baseline.months[0].categoryTotals['expense-food'], 0);
});

test('strict root and nested schemas reject unknown, missing, inherited, symbol and accessor fields', () => {
  const mutations = [
    value => { value.extra = 1; }, value => { delete value.activeId; },
    value => { value.scenarios[0].extra = true; }, value => { delete value.scenarios[0].name; },
    value => { value.scenarios[0].adjustments = [{ ...adjustment('expense-food', 'amount', 0), extra: 1 }]; },
    value => { value.scenarios[0].oneOffs = [{ ...oneOff(), extra: 1 }]; },
    value => { value[Symbol('hidden')] = 'invalid'; },
    value => { Object.defineProperty(value, 'version', { get() { throw Error('Do not run'); }, enumerable: true }); },
    value => { delete value.version; Object.setPrototypeOf(value, { version: 1 }); }
  ];
  for (const mutate of mutations) {
    const value = settings(); mutate(value);
    assert.throws(() => Scenario.validate(value), code('INVALID_SCHEMA'));
  }
  for (const value of [null, undefined, [], '', 1, true, new Date()]) assert.throws(() => Scenario.validate(value), code('INVALID_DATA'));
});

test('arrays reject sparse elements, custom fields and accessors rather than skipping records', () => {
  for (const field of ['completeMonths', 'exclusions', 'scenarios']) {
    const value = settings(); value[field] = new Array(1);
    assert.throws(() => Scenario.validate(value), code('INVALID_DATA'));
  }
  for (const field of ['adjustments', 'oneOffs']) {
    const value = settings(); value.scenarios[0][field] = new Array(1);
    assert.throws(() => Scenario.validate(value), code('INVALID_DATA'));
  }
  const custom = settings(); custom.exclusions.extra = true;
  assert.throws(() => Scenario.validate(custom), code('INVALID_SCHEMA'));
  const accessor = settings();
  Object.defineProperty(accessor.completeMonths, '0', { get() { throw Error('Do not run'); }, enumerable: true });
  assert.throws(() => Scenario.validate(accessor), code('INVALID_SCHEMA'));
});

test('schema rejects wrong versions, absent active scenario, and zero or excessive scenarios', () => {
  for (const version of [0, 3, '1', null]) assert.throws(() => Scenario.validate(settings({ version })), code('INVALID_VERSION'));
  assert.throws(() => Scenario.validate(settings({ scenarios: [] })), code('LAST_SCENARIO'));
  assert.throws(() => Scenario.validate(settings({ activeId: 'missing' })), code('INVALID_REFERENCE'));
  const three = [plan(), plan({ id: 'scenario-two' }), plan({ id: 'scenario-three' })];
  assert.equal(Scenario.validate(settings({ scenarios: three, activeId: 'scenario-three' })).scenarios.length, 3);
  assert.throws(() => Scenario.validate(settings({ scenarios: [...three, plan({ id: 'scenario-four' })] })), code('ROW_LIMIT'));
});

test('schema rejects duplicate months, exclusions, scenario IDs, one-off IDs and category adjustments', () => {
  const cases = [
    settings({ completeMonths: ['2026-09', '2026-09'] }),
    settings({ exclusions: ['transaction-a', 'transaction-a'] }),
    settings({ scenarios: [plan(), plan()] }),
    settings({ scenarios: [plan({ adjustments: [adjustment('expense-food', 'fixed', 1), adjustment('expense-food', 'amount', 2)] })] }),
    settings({ scenarios: [plan({ oneOffs: [oneOff(), oneOff()] })] }),
    settings({ scenarios: [plan({ oneOffs: [oneOff()] }), plan({ id: 'scenario-two', oneOffs: [oneOff()] })] }),
    settings({ scenarios: [plan({ oneOffs: [oneOff({ id: 'scenario-main' })] })] }),
    settings({ scenarios: [plan({ oneOffs: [oneOff({ id: 'scenario-two' })] }), plan({ id: 'scenario-two' })] })
  ];
  for (const value of cases) assert.throws(() => Scenario.validate(value), code('DUPLICATE_ID'));
  assert.equal(Scenario.validate(settings({ scenarios: [plan({ oneOffs: [oneOff(), oneOff({ id: 'oneoff-second' })] })] })).scenarios[0].oneOffs.length, 2);
});

test('every bounded collection accepts its cap and rejects the next row', () => {
  const cases = [
    ['completeMonths', 120, i => String(2000 + Math.floor(i / 12)) + '-' + String(i % 12 + 1).padStart(2, '0'), false],
    ['exclusions', 10000, i => 'transaction-' + i, false],
    ['adjustments', 200, i => adjustment('category-' + i, 'amount', 0), true],
    ['oneOffs', 100, i => oneOff({ id: 'oneoff-' + i }), true]
  ];
  for (const [field, cap, make, nested] of cases) {
    const input = settings();
    const target = nested ? input.scenarios[0] : input;
    target[field] = Array.from({ length: cap }, (_, i) => make(i));
    Scenario.validate(input);
    target[field].push(make(cap));
    assert.throws(() => Scenario.validate(input), code('ROW_LIMIT'), field);
  }
});

test('identifiers and names are bounded; names are trimmed without interpreting markup', () => {
  for (const id of ['', '__proto__', 'constructor', 'prototype', 'has spaces', '-id', 'x'.repeat(101), 1, null]) {
    assert.throws(() => Scenario.validate(settings({ activeId: id })), code('INVALID_ID'));
  }
  for (const name of ['', ' ', '\nname', 'x'.repeat(81), null, 12]) {
    assert.throws(() => Scenario.validate(settings({ scenarios: [plan({ name })] })), code('INVALID_NAME'));
    assert.throws(() => Scenario.validate(settings({ scenarios: [plan({ oneOffs: [oneOff({ name })] })] })), code('INVALID_NAME'));
  }
  assert.equal(Scenario.validate(settings({ scenarios: [plan({ name: ' <img onerror=x> ' })] })).scenarios[0].name, '<img onerror=x>');
});

test('strict calendar months and today reject rollover, coercion, timestamps and invalid leap dates', () => {
  for (const value of ['2026-1', '2026-00', '2026-13', '0000-01', '10000-01', '2026-01-01', null, 202609]) {
    assert.throws(() => Scenario.validate(settings({ completeMonths: [value] })), code('INVALID_MONTH'));
    assert.throws(() => Scenario.validate(settings({ scenarios: [plan({ oneOffs: [oneOff({ month: value })] })] })), code('INVALID_MONTH'));
  }
  for (const date of ['2026-02-29', '1900-02-29', '2026-11-31', '2026-10', '2026-1-01', '2026-10-01T00:00:00Z', null, 20261014]) {
    assert.throws(() => Scenario.calculate(state(), settings(), date), code('INVALID_DATE'));
  }
  assert.deepEqual(Scenario.calculate(state(), settings(), '2000-02-29').months, ['2000-03', '2000-04', '2000-05']);
  assert.deepEqual(Scenario.calculate(state(), settings(), '0001-01-01').months, ['0001-02', '0001-03', '0001-04']);
  assert.deepEqual(Scenario.calculate(state(), settings(), '9999-09-30').months, ['9999-10', '9999-11', '9999-12']);
  for (const date of ['9999-10-01', '9999-11-01', '9999-12-31']) assert.throws(() => Scenario.calculate(state(), settings(), date), code('INVALID_DATE_RANGE'));
});

test('amounts are exact bounded nonnegative integers and one-offs cannot be zero', () => {
  for (const mode of ['amount', 'fixed']) {
    for (const value of [0, 1, Ledger.MAX_AMOUNT_CENTS]) Scenario.validate(settings({ scenarios: [plan({ adjustments: [adjustment('expense-food', mode, value)] })] }));
    for (const value of [-1, 1.1, '1', null, NaN, Infinity, Ledger.MAX_AMOUNT_CENTS + 1, Number.MAX_SAFE_INTEGER]) {
      assert.throws(() => Scenario.validate(settings({ scenarios: [plan({ adjustments: [adjustment('expense-food', mode, value)] })] })), code('INVALID_AMOUNT'));
    }
  }
  for (const value of [0, -1, 1.2, '100', null, NaN, Infinity, Ledger.MAX_AMOUNT_CENTS + 1]) {
    assert.throws(() => Scenario.validate(settings({ scenarios: [plan({ oneOffs: [oneOff({ amountCents: value })] })] })), code('INVALID_AMOUNT'));
  }
  const negativeZero = Scenario.validate(settings({ scenarios: [plan({ adjustments: [adjustment('expense-food', 'amount', -0)] })] }));
  assert.equal(Object.is(negativeZero.scenarios[0].adjustments[0].value, -0), false);
});

test('percent limits are inclusive integer changes and unknown adjustment modes are rejected', () => {
  for (const value of [-100, 0, 1000]) Scenario.validate(settings({ scenarios: [plan({ adjustments: [adjustment('expense-food', 'percent', value)] })] }));
  for (const value of [-101, 1001, 0.5, '5', NaN, Infinity, null]) {
    assert.throws(() => Scenario.validate(settings({ scenarios: [plan({ adjustments: [adjustment('expense-food', 'percent', value)] })] })), code('INVALID_PERCENT'));
  }
  for (const mode of ['monthly', 'delta', null, 1]) {
    assert.throws(() => Scenario.validate(settings({ scenarios: [plan({ adjustments: [adjustment('expense-food', mode, 1)] })] })), code('INVALID_MODE'));
  }
});

test('unconfirmed ledger data never creates history or a misleading zero estimate', () => {
  const result = calculate(state([row('transaction-lunch', 1200)]));
  assert.equal(result.historyMonthCount, 0);
  assert.deepEqual(result.historyMonths, []);
  assert.equal(result.baseline.monthlyCents, null);
  assert.equal(result.baseline.totalCents, null);
  assert.ok(result.baseline.categories.every(value => value.baselineCents === null && value.historyTotalCents === null));
  assert.ok(warning(result, 'NO_CONFIRMED_HISTORY'));
  const forecast = result.scenarios[0];
  assert.equal(forecast.incomplete, true);
  assert.equal(forecast.monthlyRecurringCents, null);
  assert.equal(forecast.totalCents, null);
  assert.equal(forecast.knownTotalCents, 0);
  assert.equal(forecast.deltaCents, null);
  assert.ok(forecast.months.every(value => value.totalCents === null));
});

test('explicitly confirmed empty months contribute real zeros; unconfirmed gaps do not', () => {
  const ledger = singleCategory([row('transaction-food', 900, '2026-09-01'), row('transaction-unconfirmed', 60000, '2026-08-01')]);
  const result = calculate(ledger, settings({ completeMonths: ['2026-07', '2026-09'] }));
  assert.deepEqual(result.historyMonths, ['2026-07', '2026-09']);
  assert.deepEqual(result.baseline.months.map(value => value.totalCents), [0, 900]);
  assert.equal(result.baseline.monthlyCents, 450);
  assert.equal(result.baseline.totalCents, 1350);
  assert.equal(result.scenarios[0].totalCents, 1350);
  assert.equal(result.scenarios[0].deltaCents, 0);
  const empty = calculate(state(), settings({ completeMonths: ['2026-09'] }));
  assert.equal(empty.baseline.totalCents, 0);
  assert.equal(empty.scenarios[0].totalCents, 0);
  assert.equal(empty.scenarios[0].incomplete, false);
});

test('latest six confirmed past months are sorted and used; current/future months are ignored with metadata', () => {
  const ledger = singleCategory([
    row('transaction-old', 99999, '2026-01-01'), row('transaction-latest', 600, '2026-09-30'),
    row('transaction-current', 77777, '2026-10-01'), row('transaction-future', 88888, '2026-11-01')
  ]);
  const input = settings({ completeMonths: ['2027-01', '2026-09', '2026-01', '2026-08', '2026-03', '2026-07', '2026-04', '2026-10', '2026-06', '2026-05'] });
  const result = calculate(ledger, input);
  assert.deepEqual(result.historyMonths, ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
  assert.equal(result.historyMonthCount, 6);
  assert.equal(result.baseline.monthlyCents, 100);
  assert.equal(result.scenarios[0].totalCents, 300);
  assert.deepEqual(warning(result, 'IGNORED_COMPLETE_MONTHS'), { code: 'IGNORED_COMPLETE_MONTHS', months: ['2026-01', '2026-03', '2026-10', '2027-01'], count: 4 });
  assert.equal(warning(result, 'SHORT_HISTORY'), undefined);
});

test('short and old confirmed history are disclosed without silently replacing selected months', () => {
  const result = calculate(singleCategory(), settings({ completeMonths: ['2025-12', '2026-06'] }));
  assert.deepEqual(result.historyMonths, ['2025-12', '2026-06']);
  assert.deepEqual(warning(result, 'SHORT_HISTORY'), { code: 'SHORT_HISTORY', count: 2 });
  assert.deepEqual(warning(result, 'OLD_HISTORY'), { code: 'OLD_HISTORY', latestMonth: '2026-06', monthsSinceLatest: 4 });
  assert.equal(warning(calculate(singleCategory(), settings({ completeMonths: ['2026-09'] })), 'OLD_HISTORY'), undefined);
});

test('only live, non-excluded expenses in selected history count, never income/transfers/trash/opening balances', () => {
  const ledger = state([
    row('transaction-included', 100), row('transaction-excluded', 200), row('transaction-deleted', 300),
    row('transaction-income', 10000, '2026-09-02', 'income-salary', 'income')
  ]);
  ledger.accounts.push({ id: 'account-bank', name: '银行', openingBalanceCents: 900000 });
  ledger.transactions.push({ id: 'transaction-transfer', type: 'transfer', date: '2026-09-15', amountCents: 4000, accountId: 'account-cash', toAccountId: 'account-bank', note: '' });
  const deleted = Ledger.deleteTransaction(ledger, 'transaction-deleted');
  const result = calculate(deleted, settings({ completeMonths: ['2026-09'], exclusions: ['transaction-excluded'] }));
  assert.equal(result.baseline.monthlyCents, 100);
  assert.equal(result.baseline.totalCents, 300);
  assert.ok(result.baseline.categories.every(value => value.categoryId.startsWith('expense-')));
});

test('excluded transactions retain IDs across trash and undo; stale exclusions are harmless and disclosed', () => {
  const ledger = singleCategory([row('transaction-food', 500)]);
  const input = settings({ completeMonths: ['2026-09'], exclusions: ['transaction-food', 'transaction-gone'] });
  const deleted = Ledger.deleteTransaction(ledger, 'transaction-food');
  const validated = Scenario.validate(input, deleted);
  assert.deepEqual(validated.exclusions, input.exclusions);
  const result = calculate(deleted, input);
  assert.equal(result.baseline.monthlyCents, 0);
  assert.deepEqual(warning(result, 'STALE_EXCLUSIONS'), { code: 'STALE_EXCLUSIONS', transactionIds: ['transaction-gone'], count: 1 });
  const restored = calculate(Ledger.undoDelete(deleted, 'transaction-food'), input);
  assert.equal(restored.baseline.monthlyCents, 0);
  assert.deepEqual(warning(restored, 'STALE_EXCLUSIONS'), warning(result, 'STALE_EXCLUSIONS'));
});

test('exclusions for income, transfers and their trash rows are stale rather than silently treated as applicable', () => {
  const ledger = state([row('transaction-income', 100, '2026-09-01', 'income-salary', 'income')]);
  ledger.accounts.push({ id: 'account-bank', name: '银行', openingBalanceCents: 0 });
  ledger.transactions.push({ id: 'transaction-transfer', type: 'transfer', date: '2026-09-15', amountCents: 100,
    accountId: 'account-cash', toAccountId: 'account-bank', note: '' });
  const input = settings({ completeMonths: ['2026-09'], exclusions: ['transaction-income', 'transaction-transfer'] });
  for (const candidate of [ledger, Ledger.deleteTransaction(ledger, 'transaction-income')]) {
    assert.deepEqual(warning(calculate(candidate, input), 'STALE_EXCLUSIONS'), {
      code: 'STALE_EXCLUSIONS', transactionIds: ['transaction-income', 'transaction-transfer'], count: 2
    });
  }
});

test('category means use exact half-up integer rounding and total is the sum of category means', () => {
  const ledger = state([row('transaction-food', 1), row('transaction-bus', 1, '2026-09-15', 'expense-transport')]);
  const result = calculate(ledger, settings({ completeMonths: ['2026-08', '2026-09'] }));
  assert.equal(category(result).baselineCents, 1);
  assert.equal(category(result, 'expense-transport').baselineCents, 1);
  assert.equal(result.baseline.monthlyCents, 2);
  assert.equal(result.baseline.totalCents, 6);
  const thirds = calculate(singleCategory([row('transaction-food', 1)]), settings({ completeMonths: ['2026-07', '2026-08', '2026-09'] }));
  assert.equal(thirds.baseline.monthlyCents, 0);
  const twoThirds = calculate(singleCategory([row('transaction-food', 2)]), settings({ completeMonths: ['2026-07', '2026-08', '2026-09'] }));
  assert.equal(twoThirds.baseline.monthlyCents, 1);
});

test('amount and fixed are category total replacements, not additions or separate recurring bills', () => {
  const ledger = state([row('transaction-food', 1000), row('transaction-rent', 2000, '2026-09-01', 'expense-housing')]);
  const result = calculate(ledger, settings({ completeMonths: ['2026-09'], scenarios: [plan({ adjustments: [
    adjustment('expense-food', 'amount', 700), adjustment('expense-housing', 'fixed', 1500)
  ] })] }));
  assert.equal(category(result).monthlyCents, 700);
  assert.equal(category(result, 'expense-housing').monthlyCents, 1500);
  assert.equal(result.scenarios[0].monthlyRecurringCents, 2200);
  assert.equal(result.scenarios[0].totalCents, 6600);
  assert.equal(result.scenarios[0].deltaCents, -2400);
});

test('percent changes replace baseline with rounded adjusted amount, including -100% and +1000%', () => {
  const ledger = singleCategory([row('transaction-food', 101)]);
  for (const [percent, expected] of [[-100, 0], [-50, 51], [0, 101], [50, 152], [100, 202], [1000, 1111]]) {
    const result = calculate(ledger, settings({ completeMonths: ['2026-09'], scenarios: [plan({ adjustments: [adjustment('expense-food', 'percent', percent)] })] }));
    assert.equal(category(result).monthlyCents, expected);
    assert.equal(result.scenarios[0].totalCents, expected * 3);
  }
});

test('manual amount/fixed entries work without baseline while unconfigured/percent categories stay unknown', () => {
  const input = settings({ scenarios: [plan({ adjustments: [
    adjustment('expense-food', 'amount', 1500), adjustment('expense-housing', 'fixed', 2000), adjustment('expense-shopping', 'percent', -100)
  ], oneOffs: [oneOff({ amountCents: 500 })] })] });
  const result = calculate(state(), input);
  const forecast = result.scenarios[0];
  assert.equal(category(result).monthlyCents, 1500);
  assert.equal(category(result, 'expense-housing').monthlyCents, 2000);
  assert.equal(category(result, 'expense-shopping').monthlyCents, null);
  assert.equal(category(result, 'expense-transport').monthlyCents, null);
  assert.equal(forecast.incomplete, true);
  assert.equal(forecast.monthlyRecurringCents, null);
  assert.equal(forecast.knownMonthlyRecurringCents, 3500);
  assert.equal(forecast.totalCents, null);
  assert.equal(forecast.knownTotalCents, 11000);
  assert.equal(forecast.deltaCents, null);
  assert.equal(forecast.months[1].totalCents, null);
  assert.equal(forecast.months[1].knownTotalCents, 4000);
});

test('fully specified manual categories produce a forecast without inventing a baseline or savings comparison', () => {
  for (const amount of [0, 500]) {
    const result = calculate(singleCategory(), settings({ scenarios: [plan({ adjustments: [adjustment('expense-food', 'fixed', amount)] })] }));
    assert.equal(result.baseline.totalCents, null);
    assert.equal(result.scenarios[0].incomplete, false);
    assert.equal(result.scenarios[0].totalCents, amount * 3);
    assert.equal(result.scenarios[0].deltaCents, null);
  }
});

test('a ledger without expense categories cannot turn missing history into a false zero', () => {
  const ledger = state([], []);
  const result = calculate(ledger);
  assert.deepEqual(result.scenarios[0].categories, []);
  assert.equal(result.baseline.totalCents, null);
  assert.equal(result.scenarios[0].incomplete, true);
  assert.equal(result.scenarios[0].totalCents, null);
  const confirmed = calculate(ledger, settings({ completeMonths: ['2026-09'] }));
  assert.equal(confirmed.baseline.totalCents, 0);
  assert.equal(confirmed.scenarios[0].totalCents, 0);
});

test('one-offs add exactly once in matching future months alongside monthly replacements', () => {
  const result = calculate(singleCategory([row('transaction-food', 1000)]), settings({ completeMonths: ['2026-09'], scenarios: [plan({
    adjustments: [adjustment('expense-food', 'fixed', 500)],
    oneOffs: [oneOff({ id: 'oneoff-first', month: '2026-11', amountCents: 100 }), oneOff({ id: 'oneoff-second', month: '2026-12', amountCents: 200 }), oneOff({ id: 'oneoff-third', month: '2026-12', amountCents: 300 })]
  })] }));
  assert.deepEqual(result.months, ['2026-11', '2026-12', '2027-01']);
  assert.deepEqual(result.scenarios[0].months.map(value => value.oneOffCents), [100, 500, 0]);
  assert.deepEqual(result.scenarios[0].months.map(value => value.totalCents), [600, 1000, 500]);
  assert.equal(result.scenarios[0].totalCents, 2100);
  assert.equal(result.scenarios[0].deltaCents, -900);
});

test('past, current and outside-window one-offs are ignored with reason metadata and are not deleted', () => {
  const oneOffs = [oneOff({ id: 'oneoff-past', month: '2026-09' }), oneOff({ id: 'oneoff-current', month: '2026-10' }), oneOff({ id: 'oneoff-later', month: '2027-02' })];
  const input = settings({ completeMonths: ['2026-09'], scenarios: [plan({ oneOffs })] });
  const result = calculate(singleCategory(), input);
  assert.equal(result.scenarios[0].totalCents, 0);
  assert.deepEqual(result.scenarios[0].warnings.map(value => [value.code, value.oneOffId, value.month, value.reason]), [
    ['ONE_OFF_OUTSIDE_FORECAST', 'oneoff-past', '2026-09', 'past'],
    ['ONE_OFF_OUTSIDE_FORECAST', 'oneoff-current', '2026-10', 'current'],
    ['ONE_OFF_OUTSIDE_FORECAST', 'oneoff-later', '2027-02', 'future']
  ]);
  assert.equal(input.scenarios[0].oneOffs.length, 3);
});

test('stale and income category references survive validation but are ignored in calculation with warnings', () => {
  const input = settings({ completeMonths: ['2026-09'], scenarios: [plan({
    adjustments: [adjustment('category-deleted', 'fixed', 999), adjustment('income-salary', 'amount', 888)],
    oneOffs: [oneOff({ categoryId: 'category-deleted' }), oneOff({ id: 'oneoff-income', categoryId: 'income-salary' })]
  })] });
  assert.deepEqual(Scenario.validate(input, state()), input);
  const result = calculate(state([row('transaction-food', 100)]), input);
  assert.equal(result.scenarios[0].totalCents, 300);
  assert.deepEqual(result.scenarios[0].warnings.map(value => value.code), ['STALE_ADJUSTMENT', 'STALE_ADJUSTMENT', 'STALE_ONE_OFF_CATEGORY', 'STALE_ONE_OFF_CATEGORY']);
  assert.deepEqual(result.scenarios[0].warnings[0], { code: 'STALE_ADJUSTMENT', scenarioId: 'scenario-main', categoryId: 'category-deleted' });
  assert.deepEqual(result.scenarios[0].warnings[2], { code: 'STALE_ONE_OFF_CATEGORY', scenarioId: 'scenario-main', oneOffId: 'oneoff-trip', categoryId: 'category-deleted' });
});

test('future ledger expenses never automatically enter the forecast or baseline', () => {
  const ledger = singleCategory([
    row('transaction-history', 100, '2026-09-30'), row('transaction-current', 200, '2026-10-31'),
    row('transaction-future', 50000, '2026-11-01'), row('transaction-future-two', 60000, '2027-01-01')
  ]);
  const result = calculate(ledger, settings({ completeMonths: ['2026-09'] }));
  assert.equal(result.baseline.monthlyCents, 100);
  assert.equal(result.scenarios[0].totalCents, 300);
  assert.deepEqual(result.scenarios[0].months.map(value => value.oneOffCents), [0, 0, 0]);
});

test('next three full months cross December and ignore timezones and the day within the month', () => {
  const ledger = state();
  for (const today of ['2026-12-01', '2026-12-31']) {
    assert.deepEqual(Scenario.calculate(ledger, settings(), today).months, ['2027-01', '2027-02', '2027-03']);
  }
  assert.deepEqual(Scenario.calculate(ledger, settings(), '2024-02-29').months, ['2024-03', '2024-04', '2024-05']);
});

test('multiple scenarios are independently compared against one common 3-month baseline', () => {
  const result = calculate(singleCategory([row('transaction-food', 1000)]), settings({ completeMonths: ['2026-09'], activeId: 'scenario-high', scenarios: [
    plan(), plan({ id: 'scenario-low', name: '节约', adjustments: [adjustment('expense-food', 'percent', -50)] }),
    plan({ id: 'scenario-high', name: '宽裕', adjustments: [adjustment('expense-food', 'amount', 2000)] })
  ] }));
  assert.equal(result.activeId, 'scenario-high');
  assert.equal(result.baseline.totalCents, 3000);
  assert.deepEqual(result.scenarios.map(value => value.totalCents), [3000, 1500, 6000]);
  assert.deepEqual(result.scenarios.map(value => value.deltaCents), [0, -1500, 3000]);
});

test('large percent products use exact BigInt arithmetic before rounding to safe outputs', () => {
  const rows = Array.from({ length: 100 }, (_, index) => row('transaction-' + index, Ledger.MAX_AMOUNT_CENTS));
  const ledger = singleCategory(rows);
  const input = settings({ completeMonths: ['2026-09'], scenarios: [plan({ adjustments: [adjustment('expense-food', 'percent', 999)] })] });
  const result = calculate(ledger, input);
  const baseline = BigInt(Ledger.MAX_AMOUNT_CENTS) * 100n;
  const expected = Number((baseline * 1099n + 50n) / 100n);
  assert.equal(result.baseline.monthlyCents, Number(baseline));
  assert.equal(category(result).monthlyCents, expected);
  assert.equal(result.scenarios[0].totalCents, expected * 3);
  assert.ok(Number.isSafeInteger(result.scenarios[0].totalCents));
});

test('unsafe baseline forecast and percentage forecast aggregates throw instead of rounding or overflowing', () => {
  const rows = Array.from({ length: 4000 }, (_, index) => row('transaction-' + index, Ledger.MAX_AMOUNT_CENTS));
  assert.throws(() => calculate(singleCategory(rows), settings({ completeMonths: ['2026-09'] })), code('AMOUNT_OVERFLOW'));
  const smaller = singleCategory(rows.slice(0, 1000));
  assert.throws(() => calculate(smaller, settings({ completeMonths: ['2026-09'], scenarios: [plan({ adjustments: [adjustment('expense-food', 'percent', 1000)] })] })), code('AMOUNT_OVERFLOW'));
  const validMonthlyButUnsafeQuarter = singleCategory(rows.slice(0, 300));
  assert.throws(() => calculate(validMonthlyButUnsafeQuarter, settings({ completeMonths: ['2026-09'], scenarios: [plan({ adjustments: [adjustment('expense-food', 'percent', 1000)] })] })), code('AMOUNT_OVERFLOW'));
});

test('ledger validation errors propagate; malformed states cannot enter calculation', () => {
  const ledger = state(); ledger.transactions.push(row('transaction-invalid', -1));
  assert.throws(() => calculate(ledger), error => error instanceof Ledger.LedgerError && error.code === 'INVALID_AMOUNT');
  assert.throws(() => Scenario.calculate(null, settings(), TODAY), error => error instanceof Ledger.LedgerError);
});

test('dangerous inherited object property names cannot pollute totals or prototypes', () => {
  const ledger = state([row('transaction-toString', 100, '2026-09-01', 'toString')], [{ id: 'toString', name: '自定义', type: 'expense' }]);
  const result = calculate(ledger, settings({ completeMonths: ['2026-09'] }));
  assert.equal(result.baseline.months[0].categoryTotals.toString, 100);
  assert.equal(result.baseline.monthlyCents, 100);
  assert.equal(Object.prototype.amountCents, undefined);
});

test('deterministic integer model reconciles category, month and scenario totals over many small values', () => {
  for (let cents = 1; cents <= 30; cents++) {
    for (let count = 1; count <= 6; count++) {
      const completeMonths = Array.from({ length: count }, (_, index) => '2026-' + String(9 - index).padStart(2, '0'));
      const input = settings({ completeMonths, scenarios: [plan({ adjustments: [adjustment('expense-food', 'percent', -37)], oneOffs: [oneOff({ amountCents: cents, month: '2027-01' })] })] });
      const result = calculate(singleCategory([row('transaction-food', cents)]), input);
      const mean = Number((BigInt(cents) + BigInt(Math.floor(count / 2))) / BigInt(count));
      const recurring = Number((BigInt(mean) * 63n + 50n) / 100n);
      assert.equal(result.baseline.monthlyCents, mean);
      assert.equal(result.scenarios[0].totalCents, recurring * 3 + cents);
      assert.equal(result.scenarios[0].months.reduce((sum, value) => sum + value.totalCents, 0), result.scenarios[0].totalCents);
      assert.equal(result.scenarios[0].deltaCents, recurring * 3 + cents - mean * 3);
    }
  }
});
