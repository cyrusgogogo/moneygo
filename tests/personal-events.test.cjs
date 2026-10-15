'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const modulePath = path.join(__dirname, '../dist/personal-events.js');
const P = require(modulePath);
const MAX = 999999999999;
const FACT_FIELDS = ['transactionId', 'kind', 'effectiveDate', 'categoryId', 'accountId', 'rawAmountCents', 'personalAmountCents', 'excluded', 'primaryId', 'transferPairId', 'compositeId', 'personalAuthority', 'fundingAuthority'];
const EVENT_FIELDS = ['key', 'effectiveDate', 'categoryId', 'amountCents', 'origin', 'attribution', 'route', 'excluded', 'suppression'];
const REDUCTION_FIELDS = ['expenseCents', 'incomeCents', 'netCents', 'expenseEventCount', 'incomeEventCount', 'positiveExpenseEventCount', 'positiveIncomeEventCount'];
const copy = value => JSON.parse(JSON.stringify(value));
function fact(transactionId = 'expense-1', overrides = {}) {
  return { transactionId, kind: 'expense', effectiveDate: '2026-01-02', categoryId: 'expense-food', accountId: 'account-cash', rawAmountCents: 1000, personalAmountCents: 1000, excluded: false, primaryId: null, transferPairId: null, compositeId: null, personalAuthority: true, fundingAuthority: true, ...overrides };
}
function event(transactionId = 'expense-1', overrides = {}) {
  return { key: { kind: 'transaction-expense', id: transactionId }, effectiveDate: '2026-01-02', categoryId: 'expense-food', amountCents: 1000, origin: { kind: 'transaction', transactionId }, attribution: { kind: 'transaction', transactionId, accountId: 'account-cash' }, route: { kind: 'transaction', transactionId }, excluded: false, suppression: null, ...overrides };
}
function rejects(code, action) {
  assert.throws(action, error => error instanceof P.PersonalEventError && error instanceof Error && error.name === 'PersonalEventError' && error.code === code);
}
function deepFrozen(value) {
  assert.ok(Object.isFrozen(value));
  for (const key of Object.keys(value)) if (value[key] && typeof value[key] === 'object') deepFrozen(value[key]);
}
function immutable(value) {
  for (const item of Object.values(value)) if (item && typeof item === 'object') immutable(item);
  return Object.freeze(value);
}
function accessor(value, field, onRead) { Object.defineProperty(value, field, { get: onRead, enumerable: true, configurable: true }); return value; }
function nullRecord(value) { return Object.assign(Object.create(null), value); }
function bothReject(code, value) { rejects(code, () => P.select(value)); rejects(code, () => P.reduce(value)); }

test('frozen public API, exact limits, CommonJS and isolated UMD have no upward dependencies', () => {
  assert.deepEqual(Object.keys(P), ['projectLegacy', 'projectHeld', 'select', 'reduce', 'keyOf', 'PersonalEventError', 'LIMITS']);
  assert.deepEqual(P.LIMITS, { facts: 10000, events: 10000, transactionIds: 10000, idLength: 100, heldEvents: 5000, mixedEvents: 15000, eventKeys: 15000 });
  assert.ok(Object.isFrozen(P)); assert.ok(Object.isFrozen(P.LIMITS)); assert.equal(P.VERSION, undefined);
  const source = fs.readFileSync(modulePath, 'utf8');
  assert.doesNotMatch(source, /\brequire\s*\(|\bDate\b|Math\.random|\bfetch\b|\blocalStorage\b|Moneygo(?:Ledger|Relations|Scenario|Organizer|Obligations)/);
  const window = {};
  const blocked = () => { throw new Error('Unexpected external dependency'); };
  const context = vm.createContext({ window, Date: blocked, fetch: blocked, setTimeout: blocked, localStorage: { getItem: blocked, setItem: blocked } });
  vm.runInContext(source, context);
  const U = window.MoneygoPersonalEvents;
  assert.equal(typeof U.projectLegacy, 'function'); assert.ok(Object.isFrozen(U));
  assert.equal(U.reduce(U.projectLegacy([fact()]).expenseEvents).expenseCents, 1000);
  const globalContext = vm.createContext({}); vm.runInContext(source, globalContext);
  assert.equal(typeof globalContext.MoneygoPersonalEvents.keyOf, 'function');
});

test('empty projection, selection and reduction return exact fresh frozen shapes', () => {
  const projected = P.projectLegacy([]), selected = P.select([]), reduced = P.reduce([]);
  assert.deepEqual(projected, { expenseEvents: [], incomeEvents: [] });
  assert.deepEqual(selected, []);
  assert.deepEqual(reduced, { expenseCents: 0, incomeCents: 0, netCents: 0, expenseEventCount: 0, incomeEventCount: 0, positiveExpenseEventCount: 0, positiveIncomeEventCount: 0 });
  assert.deepEqual(Object.keys(reduced), REDUCTION_FIELDS);
  deepFrozen(projected); deepFrozen(selected); deepFrozen(reduced);
  assert.notEqual(P.projectLegacy([]), projected); assert.notEqual(P.select([]), selected); assert.notEqual(P.reduce([]), reduced);
});

test('projectLegacy preserves exact raw identity, dates, own source accounts and source-relative order', () => {
  const facts = [fact('later', { effectiveDate: '9999-12-31' }), fact('receipt', { kind: 'income', effectiveDate: '2026-02-03', categoryId: 'income-refund', personalAmountCents: 600 }), fact('earlier', { effectiveDate: '0001-01-01', accountId: 'personal-source' }), fact('native', { kind: 'transfer', categoryId: null, personalAmountCents: 0 })];
  const before = copy(facts), projected = P.projectLegacy(facts);
  assert.deepEqual(Object.keys(projected), ['expenseEvents', 'incomeEvents']);
  assert.deepEqual(projected.expenseEvents.map(row => row.key.id), ['later', 'earlier']);
  assert.deepEqual(projected.incomeEvents.map(row => row.key.id), ['receipt']);
  const row = projected.expenseEvents[1];
  assert.deepEqual(Object.keys(row), EVENT_FIELDS);
  assert.deepEqual(row, event('earlier', { effectiveDate: '0001-01-01', attribution: { kind: 'transaction', transactionId: 'earlier', accountId: 'personal-source' } }));
  assert.deepEqual(Object.keys(facts[0]), FACT_FIELDS);
  assert.equal(projected.incomeEvents[0].effectiveDate, '2026-02-03');
  assert.equal(projected.incomeEvents[0].amountCents, 600);
  assert.deepEqual(facts, before); assert.equal(Object.isFrozen(facts), false);
  deepFrozen(projected);
  facts[0].personalAmountCents = 1; facts[0].effectiveDate = '2020-01-01';
  assert.equal(projected.expenseEvents[0].amountCents, 1000); assert.equal(projected.expenseEvents[0].effectiveDate, '9999-12-31');
});

test('zero trace rows retain exact suppression priority and all raw routes', () => {
  const facts = [
    fact('shadow', { personalAmountCents: 0, excluded: true, primaryId: 'primary', transferPairId: 'pair', personalAuthority: false, compositeId: 'composite', effectiveDate: '2026-03-01' }),
    fact('paired-expense', { personalAmountCents: 0, transferPairId: 'pair', personalAuthority: false }),
    fact('funding', { personalAmountCents: 0, personalAuthority: false, compositeId: 'composite' }),
    fact('allocated', { personalAmountCents: 0 }),
    fact('paired-income', { kind: 'income', personalAmountCents: 0, transferPairId: 'pair' }),
    fact('allocated-income', { kind: 'income', personalAmountCents: 0, personalAuthority: false }),
    fact('income-authority', { kind: 'income', personalAuthority: false, fundingAuthority: false }),
    fact('personal-only', { fundingAuthority: false, compositeId: 'composite', accountId: 'personal-account', effectiveDate: '2026-04-04' }),
    fact('transfer', { kind: 'transfer', categoryId: null, personalAmountCents: 0 })
  ];
  const result = P.projectLegacy(facts);
  assert.deepEqual(result.expenseEvents.map(row => row.suppression), ['duplicate-evidence', 'transfer-leg', 'composite-nonpersonal', 'fully-allocated', null]);
  assert.deepEqual(result.incomeEvents.map(row => row.suppression), ['transfer-leg', 'fully-allocated', null]);
  for (const row of [...result.expenseEvents, ...result.incomeEvents]) {
    assert.deepEqual(row.route, { kind: 'transaction', transactionId: row.key.id });
    assert.equal(row.origin.transactionId, row.key.id); assert.equal(row.attribution.transactionId, row.key.id);
    if (row.suppression !== null) assert.equal(row.amountCents, 0);
  }
  assert.equal(result.expenseEvents[0].effectiveDate, '2026-03-01');
  assert.equal(result.expenseEvents[4].attribution.accountId, 'personal-account');
  assert.deepEqual(P.reduce([...result.expenseEvents, ...result.incomeEvents]), { expenseCents: 1000, incomeCents: 1000, netCents: 0, expenseEventCount: 5, incomeEventCount: 3, positiveExpenseEventCount: 1, positiveIncomeEventCount: 1 });
});

test('nullable low-level classification remains explicit and contributes known money without an invented category', () => {
  const result = P.projectLegacy([fact('unclassified', { categoryId: null }), fact('valid-looking', { categoryId: 'not-in-category-table' }), fact('income', { kind: 'income', categoryId: null })]);
  assert.equal(result.expenseEvents[0].categoryId, null); assert.equal(result.expenseEvents[1].categoryId, 'not-in-category-table');
  assert.equal(P.reduce(result.expenseEvents).expenseCents, 2000);
  assert.equal(P.reduce(result.incomeEvents).incomeCents, 1000);
  assert.deepEqual(P.select(result.expenseEvents, { categoryId: 'not-in-category-table' }).map(row => row.key.id), ['valid-looking']);
  for (const categoryId of [null, undefined, '', 1, {}, []]) rejects('INVALID_EVENT_QUERY', () => P.select(result.expenseEvents, { categoryId }));
});

test('negative zero canonicalizes in projection, external select and reduction', () => {
  const result = P.projectLegacy([fact('zero', { personalAmountCents: -0 })]);
  assert.equal(Object.is(result.expenseEvents[0].amountCents, -0), false);
  const external = event('zero', { amountCents: -0, suppression: 'fully-allocated' });
  const selected = P.select([external]);
  assert.equal(Object.is(selected[0].amountCents, -0), false); assert.equal(Object.is(external.amountCents, -0), true);
  for (const amount of Object.values(P.reduce([external]))) assert.equal(Object.is(amount, -0), false);
});

test('structured keys preserve namespace-looking raw IDs and distinguish typed kinds', () => {
  for (const rawId of ['tx-1', 'transaction-expense-x', 'held-recognition-1', 'position-1', 'A_1-2', 'toString', 'hasOwnProperty', 'x'.repeat(100)]) {
    assert.equal(P.keyOf({ kind: 'transaction-expense', id: rawId }), JSON.stringify(['transaction-expense', rawId]));
    const result = P.projectLegacy([fact(rawId)]).expenseEvents[0];
    assert.equal(result.route.transactionId, rawId); assert.equal(result.origin.transactionId, rawId);
  }
  const expense = event('same-id'), income = event('same-id', { key: { kind: 'transaction-income', id: 'same-id' } });
  assert.notEqual(P.keyOf(expense.key), P.keyOf(income.key));
  assert.deepEqual(P.reduce([expense, income]), { expenseCents: 1000, incomeCents: 1000, netCents: 0, expenseEventCount: 1, incomeEventCount: 1, positiveExpenseEventCount: 1, positiveIncomeEventCount: 1 });
  assert.equal(P.select([expense, income], { transactionIds: ['same-id'] }).length, 2);
  for (const rawAlias of ['same-id', '["transaction-expense","same-id"]']) rejects('INVALID_PERSONAL_EVENT', () => P.keyOf(rawAlias));
});

test('select conjunction uses event date/category/raw-origin/source account and keeps order', () => {
  const inputs = [event('b'), event('a'), event('other-month', { effectiveDate: '2026-02-01' }), event('other-category', { categoryId: 'expense-other' }), event('other-account', { attribution: { kind: 'transaction', transactionId: 'other-account', accountId: 'bank' } }), event('zero', { amountCents: 0, suppression: 'fully-allocated' }), event('shadow', { amountCents: 0, excluded: true, suppression: 'duplicate-evidence' })];
  const query = { month: '2026-01', categoryId: 'expense-food', transactionIds: ['a', 'b', 'zero', 'shadow', 'other-account'], accountId: 'account-cash', positiveOnly: true };
  assert.deepEqual(P.select(inputs, query).map(row => row.key.id), ['b', 'a']);
  assert.deepEqual(P.select(inputs, { transactionIds: [] }), []);
  assert.equal(P.select(inputs, {}).length, inputs.length); assert.equal(P.select(inputs, undefined).length, inputs.length);
  assert.equal(P.select(inputs, { positiveOnly: false }).length, inputs.length);
  assert.deepEqual(P.select(inputs, { accountId: 'bank' }).map(row => row.key.id), ['other-account']);
  assert.deepEqual(P.select(inputs, { transactionIds: ['shadow'] }).map(row => row.key.id), ['shadow']);
  assert.deepEqual(P.select(inputs, { month: '0001-01' }), []);
  assert.deepEqual(P.select(inputs, { month: '9999-12' }), []);
  assert.deepEqual(query.transactionIds, ['a', 'b', 'zero', 'shadow', 'other-account']); assert.equal(Object.isFrozen(query), false);
});

test('select fully detaches external mutable and externally frozen event graphs without freezing callers', () => {
  for (const freezeOuter of [false, true]) {
    const external = event('external'), array = [external];
    if (freezeOuter) Object.freeze(external);
    const result = P.select(array), row = result[0];
    assert.notEqual(row, external); deepFrozen(result); assert.equal(Object.isFrozen(array), false);
    for (const nested of ['key', 'origin', 'attribution', 'route']) {
      assert.notEqual(row[nested], external[nested]); assert.equal(Object.isFrozen(external[nested]), false);
      external[nested][nested === 'key' ? 'id' : 'transactionId'] = 'changed';
    }
    external.attribution.accountId = 'changed-account';
    if (!freezeOuter) { external.amountCents = 1; external.effectiveDate = '2020-01-01'; external.categoryId = null; }
    assert.deepEqual(row, event('external'));
  }
  const entirelyFrozen = immutable(event('frozen')), result = P.select(Object.freeze([entirelyFrozen]));
  assert.notEqual(result[0], entirelyFrozen); assert.notEqual(result[0].key, entirelyFrozen.key); deepFrozen(result);
});

test('only closure-owned immutable event instances may be shared; JSON and other module results are external', () => {
  const projection = P.projectLegacy([fact()]), source = projection.expenseEvents[0];
  const selected = P.select(projection.expenseEvents); assert.notEqual(selected, projection.expenseEvents); assert.equal(selected[0], source);
  assert.equal(P.select(selected)[0], source);
  const external = event(), detached = P.select([external])[0]; assert.equal(P.select([detached])[0], detached); assert.notEqual(detached, external);
  const parsed = JSON.parse(JSON.stringify(source)), roundTrip = P.select([parsed])[0];
  assert.deepEqual(roundTrip, source); assert.notEqual(roundTrip, parsed); assert.notEqual(roundTrip, source);
  const context = vm.createContext({}); vm.runInContext(fs.readFileSync(modulePath, 'utf8'), context);
  const foreign = context.MoneygoPersonalEvents.projectLegacy([fact()]).expenseEvents[0];
  const copied = P.select([foreign])[0]; assert.notEqual(copied, foreign); assert.deepEqual(copied, source);
});

test('reduce does not freeze or mutate externally owned inputs and returns JSON-safe numbers', () => {
  const external = event(), events = [external], before = copy(events), result = P.reduce(events);
  assert.deepEqual(events, before); assert.equal(Object.isFrozen(events), false); assert.equal(Object.isFrozen(external), false); assert.equal(Object.isFrozen(external.key), false);
  deepFrozen(result); for (const value of Object.values(result)) assert.equal(typeof value, 'number');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
});

for (const value of [null, undefined, 1, '', {}, new Set(), new Uint8Array(1), Object.create(Array.prototype)]) {
  test('nonarray inputs reject consistently: ' + String(value), () => {
    rejects('INVALID_PERSONAL_EVENT', () => P.projectLegacy(value)); bothReject('INVALID_PERSONAL_EVENT', value);
  });
}

test('dense own-data arrays reject sparse, hidden, custom, symbol and subclass shapes without running accessors', () => {
  let called = 0;
  class CustomArray extends Array {}
  const malformed = [new Array(1), [fact(), , fact('x')], Object.assign([fact()], { extra: 1 }), Object.assign([fact()], { map() { called++; } }), Object.assign([fact()], { toJSON() { called++; } }), Object.assign([fact()], { [Symbol.iterator]() { called++; } }), new CustomArray(fact())];
  const hidden = [fact()]; Object.defineProperty(hidden, '0', { enumerable: false }); malformed.push(hidden);
  const getter = [fact()]; accessor(getter, '0', () => { called++; return fact(); }); malformed.push(getter);
  const inherited = [fact()]; Object.setPrototypeOf(inherited, { 0: fact(), length: 1 }); malformed.push(inherited);
  for (const rows of malformed) { rejects('INVALID_PERSONAL_EVENT', () => P.projectLegacy(rows)); bothReject('INVALID_PERSONAL_EVENT', rows); }
  assert.equal(called, 0);
  assert.deepEqual(P.projectLegacy(Object.freeze([])), { expenseEvents: [], incomeEvents: [] });
});

test('length limit rejects before touching an index and applies to every public array', () => {
  let called = 0;
  const excessive = new Array(10001); accessor(excessive, '0', () => { called++; throw new Error('read'); });
  rejects('EVENT_LIMIT', () => P.projectLegacy(excessive)); bothReject('EVENT_LIMIT', excessive);
  rejects('EVENT_LIMIT', () => P.select([], { transactionIds: excessive })); assert.equal(called, 0);
});

test('facts require exact ordinary records with every expected own enumerable field', () => {
  let called = 0;
  const cases = [null, undefined, [], 1, Object.create(fact()), new (class Fact { constructor() { Object.assign(this, fact()); } })(), { ...fact(), extra: 1 }, { ...fact(), [Symbol('x')]: 1 }];
  for (const field of FACT_FIELDS) {
    const missing = fact(); delete missing[field]; cases.push(missing);
    const hidden = fact(); Object.defineProperty(hidden, field, { enumerable: false }); cases.push(hidden);
    cases.push(accessor(fact(), field, () => { called++; return fact()[field]; }));
  }
  for (const value of cases) rejects('INVALID_PERSONAL_EVENT', () => P.projectLegacy([value]));
  assert.equal(called, 0);
  assert.equal(P.projectLegacy([nullRecord(fact())]).expenseEvents.length, 1);
  assert.equal(P.projectLegacy(Object.freeze([immutable(fact())])).expenseEvents.length, 1);
});

test('public event outer and nested shapes reject omissions/extras/symbols/accessors without execution', () => {
  let called = 0;
  const cases = [null, undefined, [], {}, Object.create(event()), { ...event(), trusted: true }, { ...event(), id: 'expense-1' }, { ...event(), transaction: fact() }, { ...event(), [Symbol('brand')]: true }];
  for (const field of EVENT_FIELDS) {
    const missing = event(); delete missing[field]; cases.push(missing);
    const hidden = event(); Object.defineProperty(hidden, field, { enumerable: false }); cases.push(hidden);
    cases.push(accessor(event(), field, () => { called++; return event()[field]; }));
  }
  for (const field of ['key', 'origin', 'attribution', 'route']) {
    const base = event()[field];
    for (const nested of Object.keys(base)) {
      const missing = event(); delete missing[field][nested]; cases.push(missing);
      const getter = event(); accessor(getter[field], nested, () => { called++; return base[nested]; }); cases.push(getter);
    }
    for (const value of [null, [], Object.create(base), { ...base, extra: 1 }, { ...base, [Symbol('x')]: 1 }]) cases.push(event('expense-1', { [field]: value }));
  }
  for (const value of cases) bothReject('INVALID_PERSONAL_EVENT', [value]);
  assert.equal(called, 0);
  const nulls = nullRecord(event()); for (const field of ['key', 'origin', 'attribution', 'route']) nulls[field] = nullRecord(nulls[field]);
  assert.equal(P.select([nulls]).length, 1);
});

test('cross-realm ordinary records and arrays remain supported without accepting custom prototypes', () => {
  const foreignFacts = vm.runInNewContext('(' + JSON.stringify([fact()]) + ')');
  const foreignEvents = vm.runInNewContext('(' + JSON.stringify([event()]) + ')');
  const foreignQuery = vm.runInNewContext('({month: "2026-01", transactionIds: ["expense-1"]})');
  assert.equal(P.projectLegacy(foreignFacts).expenseEvents.length, 1);
  assert.equal(P.select(foreignEvents, foreignQuery).length, 1); assert.equal(P.reduce(foreignEvents).expenseCents, 1000);
  const fakeObjectProto = Object.create(null); Object.defineProperties(fakeObjectProto, Object.getOwnPropertyDescriptors(Object.prototype));
  rejects('INVALID_PERSONAL_EVENT', () => P.projectLegacy([Object.assign(Object.create(fakeObjectProto), fact())]));
  const fakeArrayProto = []; Object.defineProperties(fakeArrayProto, Object.getOwnPropertyDescriptors(Array.prototype));
  const custom = [fact()]; Object.setPrototypeOf(custom, fakeArrayProto); rejects('INVALID_PERSONAL_EVENT', () => P.projectLegacy(custom));
});

test('revoked proxies fail with stable leaf errors instead of leaking reflection TypeErrors', () => {
  for (const target of [[], fact(), event()]) {
    const revocable = Proxy.revocable(target, {}); revocable.revoke();
    rejects('INVALID_PERSONAL_EVENT', () => P.projectLegacy(target instanceof Array ? revocable.proxy : [revocable.proxy]));
    bothReject('INVALID_PERSONAL_EVENT', target instanceof Array ? revocable.proxy : [revocable.proxy]);
  }
  const query = Proxy.revocable({}, {}); query.revoke(); rejects('INVALID_EVENT_QUERY', () => P.select([], query.proxy));
});

test('identifier grammar is exact for facts, typed keys and references, without coercion', () => {
  let coercions = 0;
  const evil = { toString() { coercions++; return 'x'; }, valueOf() { coercions++; return 1; }, [Symbol.toPrimitive]() { coercions++; return 'x'; } };
  const badIds = [undefined, null, '', '-x', '_x', '__proto__', 'constructor', 'prototype', 'x.y', 'x:y', 'x/y', 'x y', '["transaction-expense","x"]', 'x'.repeat(101), '中文', 1, 1n, true, evil];
  for (const invalidId of badIds) {
    rejects('INVALID_ID', () => P.projectLegacy([fact('x', { transactionId: invalidId })]));
    rejects('INVALID_ID', () => P.keyOf({ kind: 'transaction-expense', id: invalidId }));
    for (const field of ['accountId', 'categoryId', 'primaryId', 'transferPairId', 'compositeId']) {
      if (invalidId === null && field !== 'accountId') continue;
      rejects('INVALID_ID', () => P.projectLegacy([fact('x', { [field]: invalidId })]));
    }
    const invalidKey = event('x', { key: { kind: 'transaction-expense', id: invalidId } }); bothReject('INVALID_ID', [invalidKey]);
  }
  assert.equal(coercions, 0);
});

test('facts reject unknown kinds, non-booleans, primary conflicts and illegal positive suppressed rows', () => {
  for (const kind of ['held', 'transaction-expense', '', null, 1]) rejects('INVALID_PERSONAL_EVENT', () => P.projectLegacy([fact('x', { kind })]));
  for (const field of ['excluded', 'personalAuthority', 'fundingAuthority']) for (const value of [null, undefined, 0, 1, 'true', {}]) rejects('INVALID_PERSONAL_EVENT', () => P.projectLegacy([fact('x', { [field]: value })]));
  for (const patch of [{ excluded: true }, { primaryId: 'y' }, { excluded: true, primaryId: 'x', personalAmountCents: 0 }, { excluded: true, primaryId: 'y' }, { transferPairId: 'p' }, { personalAuthority: false }, { kind: 'transfer', categoryId: null }, { kind: 'transfer', personalAmountCents: 0 }]) rejects('INVALID_PERSONAL_EVENT', () => P.projectLegacy([fact('x', patch)]));
  assert.equal(P.projectLegacy([fact('income', { kind: 'income', personalAuthority: false })]).incomeEvents[0].amountCents, 1000);
});

test('typed key/reference kinds, identities and exact key shapes cannot become aliases', () => {
  assert.equal(P.keyOf({kind:'held-recognition',id:'x'}), '["held-recognition","x"]');
  bothReject('INVALID_PERSONAL_EVENT', [event('x', {key:{kind:'held-recognition',id:'x'}})]);
  for (const kind of ['expense', 'income', 'future-held-recognition', 'transaction', 'transaction-transfer', undefined, null]) {
    rejects('INVALID_PERSONAL_EVENT', () => P.keyOf({ kind, id: 'x' }));
    bothReject('INVALID_PERSONAL_EVENT', [event('x', { key: { kind, id: 'x' } })]);
  }
  for (const field of ['origin', 'attribution', 'route']) {
    for (const kind of ['held', 'recognition', '', null]) { const value = event(); value[field].kind = kind; bothReject('INVALID_PERSONAL_EVENT', [value]); }
    const mismatch = event(); mismatch[field].transactionId = 'other'; bothReject('INVALID_PERSONAL_EVENT', [mismatch]);
    const malformed = event(); malformed[field].transactionId = 'bad.id'; bothReject('INVALID_ID', [malformed]);
  }
  for (const value of [null, [], { kind: 'transaction-expense' }, { id: 'x' }, { kind: 'transaction-expense', id: 'x', trusted: true }]) rejects('INVALID_PERSONAL_EVENT', () => P.keyOf(value));
  let called = 0; rejects('INVALID_PERSONAL_EVENT', () => P.keyOf(accessor({ kind: 'transaction-expense', id: 'x' }, 'id', () => { called++; return 'x'; }))); assert.equal(called, 0);
});

test('public event suppression consistency is exhaustive for both directions and zero/positive amounts', () => {
  const suppressions = [null, 'duplicate-evidence', 'transfer-leg', 'composite-nonpersonal', 'fully-allocated'];
  for (const kind of ['transaction-expense', 'transaction-income']) for (const amountCents of [0, 1]) for (const excluded of [false, true]) for (const suppression of suppressions) {
    const value = event('x', { key: { kind, id: 'x' }, amountCents, excluded, suppression });
    const valid = (suppression === 'duplicate-evidence') === excluded && (suppression === null) === (amountCents > 0) && (suppression !== 'composite-nonpersonal' || kind === 'transaction-expense');
    if (valid) { assert.equal(P.select([value])[0].amountCents, amountCents); assert.equal(P.reduce([value]).expenseEventCount + P.reduce([value]).incomeEventCount, 1); }
    else bothReject('INVALID_PERSONAL_EVENT', [value]);
  }
  for (const suppression of [undefined, '', 'future-recognition', 0, false, {}]) bothReject('INVALID_PERSONAL_EVENT', [event('x', { suppression })]);
  for (const excluded of [undefined, null, 0, 'false']) bothReject('INVALID_PERSONAL_EVENT', [event('x', { excluded })]);
});

test('raw positive amount and residual/event checked amount ranges stay distinct', () => {
  const invalidRaw = [-0, 0, -1, 0.1, 1.5, MAX + 1, Number.MAX_SAFE_INTEGER, NaN, Infinity, -Infinity, '1000', null, undefined, 1n, {}];
  for (const rawAmountCents of invalidRaw) rejects('INVALID_AMOUNT', () => P.projectLegacy([fact('x', { rawAmountCents })]));
  const invalidPersonal = [-1, 0.1, 1.5, MAX + 1, Number.MAX_SAFE_INTEGER, NaN, Infinity, -Infinity, '1', null, undefined, 1n, {}];
  for (const personalAmountCents of invalidPersonal) rejects('INVALID_AMOUNT', () => P.projectLegacy([fact('x', { rawAmountCents: MAX, personalAmountCents })]));
  rejects('INVALID_AMOUNT', () => P.projectLegacy([fact('x', { rawAmountCents: 1, personalAmountCents: 2 })]));
  for (const amountCents of invalidPersonal) bothReject('INVALID_AMOUNT', [event('x', { amountCents })]);
  assert.equal(P.projectLegacy([fact('x', { rawAmountCents: MAX, personalAmountCents: MAX })]).expenseEvents[0].amountCents, MAX);
});

for (const valid of ['0001-01-01', '0004-02-29', '1600-02-29', '1900-02-28', '2000-02-29', '2024-02-29', '2026-04-30', '9999-12-31']) {
  test('pure Gregorian date accepts ' + valid, () => {
    assert.equal(P.projectLegacy([fact('x', { effectiveDate: valid })]).expenseEvents[0].effectiveDate, valid);
    assert.equal(P.select([event('x', { effectiveDate: valid })], { month: valid.slice(0, 7) }).length, 1);
  });
}

test('Gregorian dates reject rollover, malformed strings and out-of-range years even when filtered out', () => {
  for (const effectiveDate of ['0000-01-01', '10000-01-01', '1900-02-29', '2100-02-29', '2026-02-29', '2026-04-31', '2026-00-01', '2026-13-01', '2026-01-00', '2026-01-32', '2026-1-01', '2026-01-1', '2026-01-01T00:00:00Z', ' 2026-01-01', '2026-01-01\n', null, undefined, {}, 20260101]) {
    rejects('INVALID_DATE', () => P.projectLegacy([fact('x', { effectiveDate })]));
    const value = event('x', { effectiveDate }); bothReject('INVALID_DATE', [value]);
    rejects('INVALID_DATE', () => P.select([value], { month: '9999-12', transactionIds: [], positiveOnly: true }));
  }
});

test('query fields reject unknown keys, null/undefined constraints, invalid month and wrong filter types', () => {
  for (const query of [null, [], 1, '', Object.create({ month: '2026-01' }), { trusted: true }, { rawId: 'x' }, { transactionId: 'x' }, { kind: 'expense' }, { [Symbol('x')]: 1 }]) rejects('INVALID_EVENT_QUERY', () => P.select([], query));
  for (const month of [null, undefined, '', '0000-01', '10000-01', '2026-00', '2026-13', '2026-1', '2026-01-01', '2026-01\n', 202601, {}]) rejects('INVALID_MONTH', () => P.select([], { month }));
  for (const field of ['accountId', 'categoryId']) for (const value of [null, undefined, '', 1, {}, 'bad.id', 'constructor']) rejects('INVALID_EVENT_QUERY', () => P.select([], { [field]: value }));
  for (const positiveOnly of [null, undefined, 0, 1, 'true', {}]) rejects('INVALID_EVENT_QUERY', () => P.select([], { positiveOnly }));
  for (const transactionIds of [null, undefined, '', {}, new Set(), ['x', 'x'], ['bad.id'], [1], new Array(1), Object.assign(['x'], { extra: 1 })]) rejects('INVALID_EVENT_QUERY', () => P.select([], { transactionIds }));
  let called = 0;
  for (const field of ['month', 'categoryId', 'transactionIds', 'accountId', 'positiveOnly']) rejects('INVALID_EVENT_QUERY', () => P.select([], accessor({}, field, () => { called++; return 'x'; })));
  const ids = ['x']; accessor(ids, '0', () => { called++; return 'x'; }); rejects('INVALID_EVENT_QUERY', () => P.select([], { transactionIds: ids }));
  assert.equal(called, 0);
  assert.deepEqual(P.select([], nullRecord({ positiveOnly: true })), []);
});

test('duplicate raw transaction IDs reject including transfers and differing fact kinds', () => {
  rejects('DUPLICATE_ID', () => P.projectLegacy([fact('x'), fact('x')]));
  rejects('DUPLICATE_ID', () => P.projectLegacy([fact('x'), fact('x', { kind: 'income' })]));
  rejects('DUPLICATE_ID', () => P.projectLegacy([fact('x', { kind: 'transfer', categoryId: null, personalAmountCents: 0 }), fact('x')]));
});

test('duplicate typed keys and malformed hidden rows reject before filtering', () => {
  const first = event('x'), second = copy(first);
  bothReject('DUPLICATE_EVENT_KEY', [first, second]);
  for (const query of [{ transactionIds: [] }, { month: '9999-12' }, { categoryId: 'different' }, { accountId: 'different' }]) rejects('DUPLICATE_EVENT_KEY', () => P.select([first, second], query));
  const owned = P.projectLegacy([fact('x')]).expenseEvents[0]; bothReject('DUPLICATE_EVENT_KEY', [owned, owned]);
  const zero = event('zero', { amountCents: 0, suppression: 'fully-allocated' });
  rejects('DUPLICATE_EVENT_KEY', () => P.select([zero, copy(zero)], { positiveOnly: true }));
  const malformed = event('bad', { amountCents: 0, suppression: null });
  rejects('INVALID_PERSONAL_EVENT', () => P.select([first, malformed], { transactionIds: ['x'], positiveOnly: true }));
});

test('10,000-row projection/select/reduce remains bounded, ordered and numerically exact', () => {
  const facts = Array.from({ length: 10000 }, (_, index) => fact('t-' + index, { kind: index % 2 ? 'income' : 'expense', rawAmountCents: MAX, personalAmountCents: MAX }));
  const projection = P.projectLegacy(facts), all = [...projection.expenseEvents, ...projection.incomeEvents];
  assert.equal(projection.expenseEvents.length, 5000); assert.equal(projection.incomeEvents.length, 5000);
  assert.equal(projection.expenseEvents[4999].key.id, 't-9998'); assert.equal(projection.incomeEvents[4999].key.id, 't-9999');
  const selected = P.select(all, { transactionIds: facts.map(row => row.transactionId), positiveOnly: true });
  assert.equal(selected.length, 10000); assert.equal(selected[0], all[0]); assert.equal(selected[9999], all[9999]);
  assert.deepEqual(P.reduce(selected), { expenseCents: 4999999999995000, incomeCents: 4999999999995000, netCents: 0, expenseEventCount: 5000, incomeEventCount: 5000, positiveExpenseEventCount: 5000, positiveIncomeEventCount: 5000 });
  rejects('EVENT_LIMIT', () => P.projectLegacy([...facts, fact('overflow-row')]));
  bothReject('EVENT_LIMIT', [...all, event('overflow-row')]);
});

test('gross BigInt overflow cannot be hidden by a safe signed net in either direction', () => {
  for (const kind of ['expense', 'income']) {
    const opposite = kind === 'expense' ? 'income' : 'expense';
    const facts = Array.from({ length: 9008 }, (_, index) => fact('gross-' + index, { kind, rawAmountCents: MAX, personalAmountCents: MAX }));
    facts.push(fact('offset', { kind: opposite, rawAmountCents: MAX, personalAmountCents: MAX }));
    const projected = P.projectLegacy(facts), rows = [...projected.expenseEvents, ...projected.incomeEvents];
    const unsafeGross = 9008n * BigInt(MAX), safeNetMagnitude = unsafeGross - BigInt(MAX);
    assert.ok(unsafeGross > BigInt(Number.MAX_SAFE_INTEGER)); assert.ok(safeNetMagnitude < BigInt(Number.MAX_SAFE_INTEGER));
    rejects('AMOUNT_OVERFLOW', () => P.reduce(rows));
    const filtered = P.select(rows, { transactionIds: ['offset'] }); assert.equal(P.reduce(filtered)[opposite + 'Cents'], MAX);
  }
});

test('exact MAX_SAFE_INTEGER gross succeeds; one cent over fails; net signs remain exact', () => {
  const limit = BigInt(Number.MAX_SAFE_INTEGER), max = BigInt(MAX), quotient = Number(limit / max), remainder = Number(limit % max);
  for (const kind of ['expense', 'income']) {
    const rows = Array.from({ length: quotient }, (_, index) => event('max-' + index, { key: { kind: 'transaction-' + kind, id: 'max-' + index }, amountCents: MAX }));
    rows.push(event('remainder', { key: { kind: 'transaction-' + kind, id: 'remainder' }, amountCents: remainder }));
    const result = P.reduce(rows);
    assert.equal(result[kind + 'Cents'], Number.MAX_SAFE_INTEGER);
    assert.equal(result.netCents, kind === 'expense' ? -Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER);
    rows[rows.length - 1].amountCents++; rejects('AMOUNT_OVERFLOW', () => P.reduce(rows));
  }
});

test('projection/select/reduce/keyOf JSON round trips preserve known amounts and exact identity', () => {
  const projection = P.projectLegacy([fact('expense'), fact('income', { kind: 'income', personalAmountCents: 150 }), fact('zero', { personalAmountCents: 0 }), fact('shadow', { excluded: true, primaryId: 'expense', personalAmountCents: 0, categoryId: null })]);
  const source = [...projection.expenseEvents, ...projection.incomeEvents], parsed = copy(source), selected = P.select(parsed);
  assert.deepEqual(selected, source); assert.deepEqual(P.reduce(parsed), P.reduce(source));
  for (let index = 0; index < source.length; index++) {
    const tuple = JSON.parse(P.keyOf(selected[index].key));
    assert.deepEqual(tuple, [source[index].key.kind, source[index].key.id]);
    assert.equal(selected[index].route.transactionId, tuple[1]); assert.notEqual(selected[index], parsed[index]);
  }
});


test('hostile proxy metadata cannot coerce array lengths or leak non-leaf thrown values', () => {
  let coerced = 0;
  const evil = { [Symbol.toPrimitive]() { coerced++; throw new Error('coercion'); } };
  const fakeLength = new Proxy([], { getOwnPropertyDescriptor(target, key) { return key === 'length' ? { value: evil, writable: true, enumerable: false, configurable: false } : Reflect.getOwnPropertyDescriptor(target, key); } });
  rejects('INVALID_PERSONAL_EVENT', () => P.projectLegacy(fakeLength)); bothReject('INVALID_PERSONAL_EVENT', fakeLength);
  rejects('INVALID_EVENT_QUERY', () => P.select([], { transactionIds: fakeLength })); assert.equal(coerced, 0);
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  const throwingRecord = new Proxy(fact(), { getPrototypeOf() { throw revoked.proxy; } });
  rejects('INVALID_PERSONAL_EVENT', () => P.projectLegacy([throwingRecord]));
  const throwingArray = new Proxy([], { getOwnPropertyDescriptor() { throw revoked.proxy; } });
  rejects('INVALID_PERSONAL_EVENT', () => P.projectLegacy(throwingArray));
});

test('descriptor visits scale linearly on 1,000 and 10,000 detached facts', () => {
  const visits = [];
  for (const size of [1000, 10000]) {
    let count = 0;
    const facts = Array.from({ length: size }, (_, index) => new Proxy(fact('linear-' + index), { getOwnPropertyDescriptor(target, key) { count++; return Reflect.getOwnPropertyDescriptor(target, key); } }));
    const projection = P.projectLegacy(facts);
    assert.equal(projection.expenseEvents.length, size);
    assert.equal(P.reduce(projection.expenseEvents).expenseCents, size * 1000);
    visits.push(count);
  }
  assert.equal(visits[0], 13000); assert.equal(visits[1], visits[0] * 10);
});
