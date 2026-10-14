'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../dist/ledger.js');
const S = require('../dist/scenario.js');
const { memoryStorage, loadApp, prepareRestore, confirmRestore, ROLLBACK_KEY } = require('./ui.test.cjs');

const TODAY = '2026-10-14';
const clone = value => JSON.parse(JSON.stringify(value));
const realLedger = ({simulation, version, ...rest}) => rest;
function fixture() {
  let state = L.putAccount(L.createEmpty(), {name: 'Bank', openingBalanceCents: 300000});
  const cash = state.accounts[0].id, bank = state.accounts[1].id;
  const add = (type, amountCents, categoryId, extra = {}) => {
    state = L.putTransaction(state, {type, date: '2026-09-03', amountCents, accountId: cash, categoryId, note: type, ...extra});
    return state.transactions.at(-1).id;
  };
  const food = add('expense', 12345, 'expense-food');
  const housing = add('expense', 60000, 'expense-housing');
  const income = add('income', 200000, 'income-salary');
  const transfer = add('transfer', 5000, undefined, {toAccountId: bank});
  const deleted = add('expense', 3333, 'expense-other', {date: '2026-08-09'});
  state = L.deleteTransaction(state, deleted);
  return {state, food, housing, income, transfer, deleted};
}
function richSettings(ids = {}) {
  return {
    version: 1, completeMonths: ['2026-08', '2026-09'], exclusions: ids.food ? [ids.food] : [],
    scenarios: [
      {id: 'scenario-main', name: 'Home plan', adjustments: [{categoryId: 'expense-housing', mode: 'fixed', value: 50000}], oneOffs: [{id: 'plan-trip', name: 'Trip', month: '2026-12', categoryId: 'expense-entertainment', amountCents: 30000}]},
      {id: 'scenario-second', name: 'Smaller plan', adjustments: [{categoryId: 'expense-food', mode: 'percent', value: -20}], oneOffs: []}
    ], activeId: 'scenario-main'
  };
}
function appWith(state = L.createEmpty()) {
  return loadApp(memoryStorage({[L.STORAGE_KEY]: JSON.stringify(state)}), {today: TODAY});
}
function click(app, dataset) {
  const target = {dataset, hasAttribute() { return false; }};
  app.documentListeners.get('click')({target: {closest: () => target}});
}
// These are field values supplied to the existing DOM stub, not native browser
// parsing or form validation. Tests separately verify generated field names.
function form(app, values = {}) {
  const node = app.node('#entry-form');
  node.dataset = {};
  node.listeners.clear();
  node.elements = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, {value, required: false}]));
  return node;
}
function submit(node) { node.onsubmit({preventDefault() {}}); }
async function selectBackup(app, text) {
  await app.node('#restore-file').onchange({target: {files: [{size: Buffer.byteLength(text), text: async () => text}]}});
}
function assertRealUnchanged(actual, original) {
  assert.deepEqual(realLedger(actual), realLedger(original));
  assert.deepEqual(L.balances(actual), L.balances(original));
  assert.deepEqual(L.summary(actual), L.summary(original));
}

// Persistence/backup boundaries are real ledger calls; only the UI boundary is stubbed.
test('sandbox viewing/calculation is read-only and empty history is visibly unknown', () => {
  const app = loadApp(memoryStorage(), {today: TODAY});
  const before = app.value('state');
  click(app, {page: 'sandbox'});
  const html = app.node('#app').innerHTML;
  assert.deepEqual(app.value('state'), before);
  assert.equal(app.storage.writes.length, 0);
  assert.equal(app.run("Object.hasOwn(state, 'simulation')"), false);
  assert.match(html, /未来三个月：2026-11、2026-12、2027-01/);
  assert.match(html, /历史基准 · 三个月<\/div><div class="big-number">待补全/);
  assert.match(html, /我的方案 · 三个月<\/div><div class="big-number secondary">待补全/);
  assert.match(html, /相对基准<\/div><div class="big-number secondary ">待补全/);
  assert.match(html, /已设置部分：¥0\.00；其余未知/);
  assert.equal((html.match(/<strong>待补全<\/strong><dl>/g) || []).length, 3);
  assert.match(html, /不是保证发生的预测/);
});

test('saving settings leaves accounts, transactions, trash, balances and actual totals unchanged', () => {
  const ids = fixture(), app = appWith(ids.state), settings = richSettings(ids);
  app.putGlobal('settings', settings);
  assert.equal(app.run('saveSimulation(s => Object.assign(s, settings))'), true);
  assertRealUnchanged(app.value('state'), ids.state);
  assert.deepEqual(app.value('state.simulation'), settings);
  assert.deepEqual(JSON.parse(app.storage.getItem(L.STORAGE_KEY)), app.value('state'));
  const reloaded = loadApp(app.storage, {today: TODAY});
  assert.deepEqual(reloaded.value('state'), app.value('state'));
  assert.deepEqual(reloaded.value('S.calculate(state, simulationSettings(), today())'), app.value('S.calculate(state, simulationSettings(), today())'));
});

test('full v2 backup round-trips all scenario settings, deleted rows and existing ledger data', () => {
  const ids = fixture(), state = {...ids.state, version: 2, simulation: richSettings(ids)};
  const backup = L.backup(state), envelope = JSON.parse(backup);
  assert.equal(envelope.version, 2);
  assert.equal(envelope.data.version, 2, 'old apps must reject new saved data instead of silently discarding scenarios');
  assert.deepEqual(L.parseBackup(backup), state);
  assert.deepEqual(envelope.data.simulation, state.simulation);
  assert.equal(envelope.data.trash.length, 1);
  const app = appWith(L.createEmpty());
  prepareRestore(app, L.parseBackup(backup));
  assert.match(app.node('#restore-preview').innerHTML, /2 个模拟方案/);
  assert.equal(app.storage.writes.length, 0);
  confirmRestore(app);
  assert.deepEqual(app.value('state'), state);
  assert.deepEqual(loadApp(app.storage, {today: TODAY}).value('state'), state);
});

test('legacy v1 backup is still readable and restoring it clears only absent extension data with rollback available', () => {
  const ids = fixture(), original = {...ids.state, version: 2, simulation: richSettings(ids)};
  const legacy = L.createEmpty(), backup = L.backup(legacy);
  assert.equal(JSON.parse(backup).version, 1);
  assert.equal(Object.hasOwn(L.parseBackup(backup), 'simulation'), false);
  const app = appWith(original);
  prepareRestore(app, L.parseBackup(backup));
  assert.match(app.node('#restore-preview').innerHTML, /旧版备份兼容/);
  confirmRestore(app);
  assert.deepEqual(app.value('state'), legacy);
  assert.deepEqual(JSON.parse(app.storage.getItem(ROLLBACK_KEY)), original);
  app.run('rollback()');
  app.node('#confirm-rollback').onclick();
  assert.deepEqual(app.value('state'), original);
});

test('backup version boundaries reject missing, downgraded and unsupported extension envelopes', () => {
  const state = {...L.createEmpty(), version: 2, simulation: richSettings()};
  const good = JSON.parse(L.backup(state));
  for (const envelope of [
    {...good, version: 1},
    {...good, version: 3},
    {...good, data: realLedger(good.data)},
    {...good, data: {...good.data, simulation: null}}
  ]) assert.throws(() => L.parseBackup(JSON.stringify(envelope)));
});

test('malformed simulation is rejected before persistence without overwriting current or recovery data', () => {
  const original = {...L.createEmpty(), version: 2, simulation: richSettings()};
  const mutations = [
    s => { s.activeId = 'missing'; },
    s => { s.completeMonths = ['2026-99']; },
    s => { s.completeMonths = ['2026-09', '2026-09']; },
    s => { s.scenarios[0].adjustments[0].value = 0.5; },
    s => { s.scenarios[0].adjustments[0].mode = 'baseline'; },
    s => { s.scenarios[0].oneOffs[0].amountCents = -1; },
    s => { s.scenarios[0].oneOffs[0].month = '2026-00'; },
    s => { s.scenarios[1].id = s.scenarios[0].id; },
    s => { s.scenarios[0].unrecognized = true; },
    s => { s.unrecognized = true; }
  ];
  for (const mutate of mutations) {
    const app = appWith(original), raw = app.storage.getItem(L.STORAGE_KEY);
    const next = clone(original); mutate(next.simulation); app.putGlobal('bad', next);
    assert.throws(() => app.run('persist(bad)'));
    assert.equal(app.storage.getItem(L.STORAGE_KEY), raw);
    assert.equal(app.storage.writes.length, 0);
    assert.deepEqual(app.value('state'), original);
  }
});

test('malformed backup extension cannot replace current ledger, restore copy or a previous valid preview', async () => {
  const original = {...L.createEmpty(), version: 2, simulation: richSettings()};
  const app = appWith(original), raw = app.storage.getItem(L.STORAGE_KEY);
  app.storage.values.set(ROLLBACK_KEY, 'previous rollback copy');
  app.run('showRestore()');
  await selectBackup(app, L.backup(original));
  assert.match(app.node('#restore-preview').innerHTML, /备份已通过校验/);
  const bad = JSON.parse(L.backup(original)); bad.data.simulation.scenarios[0].oneOffs[0].amountCents = 0;
  await selectBackup(app, JSON.stringify(bad));
  assert.equal(app.node('#restore-preview').innerHTML, '');
  assert.match(app.node('#form-error').textContent, /金额|一次性/);
  assert.equal(app.storage.getItem(L.STORAGE_KEY), raw);
  assert.equal(app.storage.getItem(ROLLBACK_KEY), 'previous rollback copy');
  assert.equal(app.storage.writes.length, 0);
  assert.deepEqual(app.value('state'), original);
});

test('invalid stored extension is preserved on startup and normal sandbox edits cannot erase it', () => {
  const corrupt = {...L.createEmpty(), version: 2, simulation: {...S.defaultSettings(), activeId: 'absent'}};
  const raw = JSON.stringify(corrupt), storage = memoryStorage({[L.STORAGE_KEY]: raw});
  const app = loadApp(storage, {today: TODAY});
  assert.equal(app.run('Boolean(blocked)'), true);
  assert.equal(app.run("saveSimulation(s => s.scenarios[0].name = 'Replacement')"), false);
  assert.equal(storage.getItem(L.STORAGE_KEY), raw);
  assert.equal(storage.writes.length, 0);
});

test('scenario mutations, switches and renames preserve independent scenarios and shared history', () => {
  const ids = fixture(), initial = {...ids.state, version: 2, simulation: richSettings(ids)}, app = appWith(initial);
  const first = clone(initial.simulation.scenarios[0]);
  click(app, {scenario: 'scenario-second'});
  assert.equal(app.value('state.simulation.activeId'), 'scenario-second');
  const f = form(app, {name: 'Changed second plan'});
  click(app, {action: 'rename-scenario'});
  assert.match(app.node('#modal-root').innerHTML, /name="name"/);
  f.listeners.get('input')(); assert.equal(f.dataset.dirty, 'true');
  submit(f);
  assert.equal(app.value('state.simulation.scenarios[1].name'), 'Changed second plan');
  assert.deepEqual(app.value('state.simulation.scenarios[0]'), first);
  assert.deepEqual(app.value('state.simulation.completeMonths'), initial.simulation.completeMonths);
  assert.deepEqual(app.value('state.simulation.exclusions'), initial.simulation.exclusions);
  assertRealUnchanged(app.value('state'), initial);
});

test('creating a scenario starts with independent baseline settings and enforces the three-scenario limit', () => {
  const initial = {...L.createEmpty(), version: 2, simulation: richSettings()}, app = appWith(initial);
  const f = form(app, {name: 'Third plan'});
  click(app, {action: 'add-scenario'}); submit(f);
  const settings = app.value('state.simulation'), third = settings.scenarios[2];
  assert.equal(settings.scenarios.length, 3);
  assert.equal(settings.activeId, third.id);
  assert.equal(third.name, 'Third plan');
  assert.deepEqual(third.adjustments, []); assert.deepEqual(third.oneOffs, []);
  assert.deepEqual(settings.scenarios.slice(0, 2), initial.simulation.scenarios);
  click(app, {page: 'sandbox'});
  assert.match(app.node('#app').innerHTML, /data-action="add-scenario" disabled/);
  const writes = app.storage.writes.length;
  click(app, {action: 'add-scenario'});
  assert.equal(app.node('#modal-root').innerHTML, '');
  assert.equal(app.storage.writes.length, writes);
});

test('budget event wiring handles mode hints, exact cents, percent, baseline and explicit zero', () => {
  const initial = {...L.createEmpty(), version: 2, simulation: richSettings()}, app = appWith(initial);
  const other = clone(initial.simulation.scenarios[1]);
  for (const [mode, text, expected] of [['amount', '123.45', 12345], ['fixed', '0', 0], ['percent', '-20', -20], ['baseline', '', undefined]]) {
    const f = form(app, {mode: 'baseline', value: 'stale field text'});
    click(app, {budget: 'expense-food'});
    assert.match(app.node('#modal-root').innerHTML, /select name="mode"/);
    assert.match(app.node('#modal-root').innerHTML, /input name="value"/);
    f.elements.mode.value = mode; f.elements.mode.onchange();
    assert.equal(f.elements.value.value, '');
    assert.equal(app.node('#budget-value-field').hidden, mode === 'baseline');
    assert.equal(f.elements.value.required, mode !== 'baseline');
    if (mode === 'percent') assert.match(app.node('#budget-value-label').textContent, /百分比/);
    f.elements.value.value = text; submit(f);
    const adj = app.value("state.simulation.scenarios[0].adjustments.filter(a => a.categoryId === 'expense-food')");
    assert.deepEqual(adj, mode === 'baseline' ? [] : [{categoryId: 'expense-food', mode, value: expected}]);
    assert.deepEqual(app.value('state.simulation.scenarios[1]'), other);
    assertRealUnchanged(app.value('state'), initial);
  }
});

test('invalid budget amount and percentage never save or overwrite a valid adjustment', () => {
  const initial = {...L.createEmpty(), version: 2, simulation: richSettings()}, app = appWith(initial);
  for (const [mode, text] of [['percent', '2.5'], ['percent', '-101'], ['percent', '1001'], ['amount', '-1'], ['amount', '0.001'], ['fixed', 'NaN']]) {
    const f = form(app, {mode, value: text});
    click(app, {budget: 'expense-housing'}); submit(f);
    assert.ok(app.node('#form-error').textContent);
    assert.deepEqual(app.value('state'), initial);
    assert.equal(app.storage.writes.length, 0);
  }
});

test('one-off create/edit/delete event handlers affect only the active plan and require delete confirmation', () => {
  const initial = {...L.createEmpty(), version: 2, simulation: richSettings()}, app = appWith(initial);
  click(app, {scenario: 'scenario-second'});
  let f = form(app, {name: 'Phone', month: '2026-11', categoryId: 'expense-shopping', amount: '1000.29'});
  click(app, {action: 'add-oneoff'});
  for (const name of ['name', 'month', 'categoryId', 'amount']) assert.match(app.node('#modal-root').innerHTML, new RegExp('name="' + name + '"'));
  submit(f);
  const item = app.value('state.simulation.scenarios[1].oneOffs[0]');
  assert.equal(item.amountCents, 100029);
  assert.equal(item.month, '2026-11');
  f = form(app, {name: 'Phone edited', month: '2026-12', categoryId: 'expense-shopping', amount: '900.01'});
  click(app, {oneoff: item.id}); submit(f);
  assert.deepEqual(app.value('state.simulation.scenarios[1].oneOffs'), [{...item, name: 'Phone edited', month: '2026-12', amountCents: 90001}]);
  assert.deepEqual(app.value('state.simulation.scenarios[0]'), initial.simulation.scenarios[0]);
  click(app, {removeOneoff: item.id});
  assert.equal(app.value('state.simulation.scenarios[1].oneOffs.length'), 1);
  app.node('#confirm-scenario-action').onclick();
  assert.deepEqual(app.value('state.simulation.scenarios[1].oneOffs'), []);
  assertRealUnchanged(app.value('state'), initial);
});

test('invalid one-off submission leaves the modal and ledger unchanged', () => {
  const initial = {...L.createEmpty(), version: 2, simulation: richSettings()}, app = appWith(initial);
  for (const amount of ['0', '-3', '2.001', 'oops']) {
    const f = form(app, {name: 'Nope', month: '2026-12', categoryId: 'expense-shopping', amount});
    click(app, {action: 'add-oneoff'}); submit(f);
    assert.ok(app.node('#modal-root').innerHTML);
    assert.ok(app.node('#form-error').textContent);
    assert.deepEqual(app.value('state'), initial);
    assert.equal(app.storage.writes.length, 0);
  }
});

test('complete-month form saves only explicitly checked month values without changing ledger history', () => {
  const ids = fixture(), app = appWith(ids.state), f = form(app);
  click(app, {action: 'history-months'});
  const html = app.node('#modal-root').innerHTML;
  assert.match(html, /name="completeMonths" value="2026-09"/);
  assert.doesNotMatch(html, /name="completeMonths" value="2026-10"/);
  assert.match(html, /确认后视为零支出月/);
  f.formData = {completeMonths: ['2026-07', '2026-09']};
  f.listeners.get('change')(); assert.equal(f.dataset.dirty, 'true');
  submit(f);
  assert.deepEqual(app.value('state.simulation.completeMonths'), ['2026-07', '2026-09']);
  assertRealUnchanged(app.value('state'), ids.state);
  assert.equal(app.value('S.calculate(state,simulationSettings(),today()).historyMonthCount'), 2);
});

test('history exclusion form filters transaction types, preserves hidden selections and never deletes transactions', () => {
  const ids = fixture(), settings = richSettings(ids);
  settings.exclusions.push(ids.deleted);
  const initial = {...ids.state, version: 2, simulation: settings}, app = appWith(initial), f = form(app);
  click(app, {historyExclusions: '2026-09'});
  const html = app.node('#exclusion-list').innerHTML;
  assert.match(html, new RegExp('data-exclusion-id="' + ids.food + '" checked'));
  assert.match(html, new RegExp('data-exclusion-id="' + ids.housing + '"'));
  assert.ok(!html.includes(ids.income)); assert.ok(!html.includes(ids.transfer)); assert.ok(!html.includes(ids.deleted));
  app.node('#exclusion-list').onchange({target: {dataset: {exclusionId: ids.food}, checked: false}});
  app.node('#exclusion-list').onchange({target: {dataset: {exclusionId: ids.housing}, checked: true}});
  assert.equal(f.dataset.dirty, 'true'); submit(f);
  assert.deepEqual(new Set(app.value('state.simulation.exclusions')), new Set([ids.deleted, ids.housing]));
  assertRealUnchanged(app.value('state'), initial);
});

test('history exclusion pagination keeps edits across pages before one atomic save', () => {
  let state = L.createEmpty();
  for (let i = 0; i < 55; i++) state = L.putTransaction(state, {type: 'expense', date: '2026-09-01', amountCents: i + 1, accountId: 'account-cash', categoryId: 'expense-food', note: 'Row ' + i});
  const app = appWith(state), f = form(app);
  click(app, {historyExclusions: '2026-09'});
  assert.equal(app.node('#exclude-page').textContent, '1–50 / 55');
  assert.equal(app.node('#exclude-prev').disabled, true);
  const first = state.transactions[54].id, last = state.transactions[0].id;
  app.node('#exclusion-list').onchange({target: {dataset: {exclusionId: first}, checked: true}});
  app.node('#exclude-next').onclick();
  assert.equal(app.node('#exclude-page').textContent, '51–55 / 55');
  assert.equal(app.node('#exclude-next').disabled, true);
  app.node('#exclusion-list').onchange({target: {dataset: {exclusionId: last}, checked: true}});
  app.node('#exclude-prev').onclick();
  assert.match(app.node('#exclusion-list').innerHTML, new RegExp('data-exclusion-id="' + first + '" checked'));
  assert.equal(app.storage.writes.length, 0); submit(f);
  assert.deepEqual(new Set(app.value('state.simulation.exclusions')), new Set([first, last]));
  assertRealUnchanged(app.value('state'), state);
});

test('reset current scenario clears only its assumptions after confirmation', () => {
  const ids = fixture(), initial = {...ids.state, version: 2, simulation: richSettings(ids)}, app = appWith(initial);
  click(app, {action: 'reset-scenario'});
  assert.deepEqual(app.value('state'), initial);
  assert.equal(app.storage.writes.length, 0);
  app.node('#confirm-scenario-action').onclick();
  const result = app.value('state');
  assert.deepEqual(result.simulation.scenarios[0], {...initial.simulation.scenarios[0], adjustments: [], oneOffs: []});
  assert.deepEqual(result.simulation.scenarios[1], initial.simulation.scenarios[1]);
  assert.deepEqual(result.simulation.completeMonths, initial.simulation.completeMonths);
  assert.deepEqual(result.simulation.exclusions, initial.simulation.exclusions);
  assertRealUnchanged(result, initial);
});

test('reset entire sandbox preserves real ledger and can be canceled without writes', () => {
  const ids = fixture(), initial = {...ids.state, version: 2, simulation: richSettings(ids)}, app = appWith(initial);
  click(app, {action: 'reset-sandbox'}); app.run('closeModal(true)');
  assert.deepEqual(app.value('state'), initial); assert.equal(app.storage.writes.length, 0);
  click(app, {action: 'reset-sandbox'}); app.node('#confirm-scenario-action').onclick();
  assert.deepEqual(app.value('state.simulation'), S.defaultSettings());
  assertRealUnchanged(app.value('state'), initial);
});

test('delete scenario switches to the surviving scenario and refuses to remove the last one', () => {
  const initial = {...L.createEmpty(), version: 2, simulation: richSettings()}, app = appWith(initial);
  click(app, {action: 'delete-scenario'});
  assert.equal(app.value('state.simulation.scenarios.length'), 2);
  app.node('#confirm-scenario-action').onclick();
  assert.deepEqual(app.value('state.simulation.scenarios'), [initial.simulation.scenarios[1]]);
  assert.equal(app.value('state.simulation.activeId'), 'scenario-second');
  const saved = app.value('state'), writes = app.storage.writes.length;
  click(app, {action: 'delete-scenario'}); app.node('#confirm-scenario-action').onclick();
  assert.deepEqual(app.value('state'), saved); assert.equal(app.storage.writes.length, writes);
  assert.match(app.node('#form-error').textContent, /至少保留一个方案/);
});

test('stale category references survive ledger edits/backups and are ignored with visible warnings', () => {
  const initial = {...L.createEmpty(), version: 2, simulation: richSettings()};
  let changed = L.removeCategory(initial, 'expense-housing');
  changed = L.removeCategory(changed, 'expense-entertainment');
  assert.deepEqual(changed.simulation, initial.simulation);
  assert.deepEqual(L.parseBackup(L.backup(changed)), changed);
  const result = S.calculate(changed, changed.simulation, TODAY);
  const codes = result.scenarios[0].warnings.map(w => w.code);
  assert.ok(codes.includes('STALE_ADJUSTMENT')); assert.ok(codes.includes('STALE_ONE_OFF_CATEGORY'));
  assert.equal(result.scenarios[0].months[1].oneOffCents, 0);
  const app = appWith(changed); click(app, {page: 'sandbox'});
  assert.match(app.node('#app').innerHTML, /分类已删除或类型已变更/);
  assert.match(app.node('#app').innerHTML, /一次性计划的分类已失效/);
  assert.match(app.node('#app').innerHTML, /分类已失效/);
  assert.equal(app.storage.writes.length, 0);
});

test('exclusion follows expense deletion/undo and reports an edited non-expense as stale', () => {
  const ids = fixture(), initial = {...ids.state, version: 2, simulation: richSettings(ids)};
  const deleted = L.deleteTransaction(initial, ids.food);
  assert.deepEqual(deleted.simulation, initial.simulation);
  const afterDelete = S.calculate(deleted, deleted.simulation, TODAY);
  assert.ok(!afterDelete.warnings.some(w => w.code === 'STALE_EXCLUSIONS'));
  const undone = L.undoDelete(deleted, ids.food);
  assert.deepEqual(undone.simulation, initial.simulation);
  assert.equal(S.calculate(undone, undone.simulation, TODAY).baseline.monthlyCents, afterDelete.baseline.monthlyCents);
  const edited = L.putTransaction(initial, {type: 'income', date: '2026-09-03', amountCents: 12345, accountId: 'account-cash', categoryId: 'income-other', note: 'Corrected type'}, ids.food);
  const stale = S.calculate(edited, edited.simulation, TODAY).warnings.find(w => w.code === 'STALE_EXCLUSIONS');
  assert.ok(stale, 'an exclusion that no longer points to an expense must be reported');
  assert.ok(stale.transactionIds.includes(ids.food));
  assert.deepEqual(edited.simulation, initial.simulation);
});

test('scenario names, category labels, one-off names and history notes are escaped in every sandbox surface', () => {
  const attack = '\"><img src=x onerror=alert(1)>&\'';
  const ids = fixture();
  let state = L.putCategory(ids.state, {name: attack, type: 'expense'}, 'expense-food');
  const tx = state.transactions.find(t => t.id === ids.food);
  state = L.putTransaction(state, {...tx, note: attack}, tx.id);
  state.simulation = richSettings(ids);
  state.simulation.scenarios[0].name = attack;
  state.simulation.scenarios[0].oneOffs[0].name = attack;
  const app = appWith(state); click(app, {page: 'sandbox'});
  let html = app.node('#app').innerHTML;
  assert.ok(!html.includes(attack)); assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /aria-label="删除计划 &quot;&gt;&lt;img/);
  form(app, {name: attack}); click(app, {action: 'rename-scenario'});
  html = app.node('#modal-root').innerHTML; assert.ok(!html.includes(attack)); assert.match(html, /value="&quot;&gt;&lt;img/);
  form(app, {mode: 'baseline', value: ''}); click(app, {budget: 'expense-food'});
  html = app.node('#modal-root').innerHTML; assert.ok(!html.includes(attack)); assert.match(html, /调整「&quot;&gt;&lt;img/);
  form(app, {name: attack, month: '2026-12', categoryId: 'expense-food', amount: '300'}); click(app, {oneoff: 'plan-trip'});
  html = app.node('#modal-root').innerHTML; assert.ok(!html.includes(attack)); assert.match(html, /&lt;img/);
  form(app); click(app, {historyExclusions: '2026-09'});
  html = app.node('#exclusion-list').innerHTML; assert.ok(!html.includes(attack)); assert.match(html, /&lt;img/);
  click(app, {action: 'reset-scenario'});
  html = app.node('#modal-root').innerHTML; assert.ok(!html.includes(attack)); assert.match(html, /&lt;img/);
  assert.equal(app.storage.writes.length, 0);
});

test('sandbox saves honor quota failure and cross-tab protection without partial in-memory edits', () => {
  const initial = {...L.createEmpty(), version: 2, simulation: richSettings()};
  const app = appWith(initial), raw = app.storage.getItem(L.STORAGE_KEY);
  app.storage.failSet = key => key === L.STORAGE_KEY;
  assert.equal(app.run("saveSimulation(s => s.scenarios[0].name = 'Unsaved')"), false);
  assert.deepEqual(app.value('state'), initial); assert.equal(app.storage.getItem(L.STORAGE_KEY), raw);
  app.storage.failSet = null;
  const external = clone(initial); external.simulation.scenarios[0].name = 'Another tab';
  app.storage.values.set(L.STORAGE_KEY, JSON.stringify(external));
  assert.equal(app.run("saveSimulation(s => s.scenarios[0].name = 'Stale overwrite')"), false);
  assert.deepEqual(app.value('state'), initial);
  assert.deepEqual(JSON.parse(app.storage.getItem(L.STORAGE_KEY)), external);
  assert.equal(app.run('stale'), true);
});

test('shipped entry point loads engine before app and sandbox remains local-only', () => {
  const html = fs.readFileSync(path.join(__dirname, '../dist/index.html'), 'utf8');
  assert.ok(html.indexOf('src="ledger.js"') < html.indexOf('src="scenario.js"'));
  assert.ok(html.indexOf('src="scenario.js"') < html.indexOf('src="app.js"'));
  for (const filename of ['scenario.js', 'app.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../dist', filename), 'utf8');
    assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|sendBeacon)\s*\(/);
  }
});

test('first sandbox save upgrades stored state to v2 while untouched legacy ledgers stay v1', () => {
  const legacy = fixture().state, app = appWith(legacy);
  assert.equal(L.VERSION, 1);
  assert.equal(L.SIMULATION_VERSION, 2);
  assert.equal(app.value('state.version'), 1);
  assert.equal(JSON.parse(app.storage.getItem(L.STORAGE_KEY)).version, 1);
  click(app, {page: 'sandbox'});
  assert.equal(JSON.parse(app.storage.getItem(L.STORAGE_KEY)).version, 1, 'viewing must not migrate storage');
  assert.equal(app.run("saveSimulation(s => s.scenarios[0].name = 'Upgrade')"), true);
  const persisted = JSON.parse(app.storage.getItem(L.STORAGE_KEY));
  assert.equal(persisted.version, 2, 'legacy v1-only validators now reject this state rather than drop its extension');
  assert.equal(persisted.simulation.scenarios[0].name, 'Upgrade');
  assert.throws(() => L.validateState({...persisted, simulation: undefined}), error => error.code === 'INVALID_VERSION');
  assertRealUnchanged(persisted, legacy);
  assert.equal(loadApp(app.storage, {today: TODAY}).value('state.version'), 2);
});

test('all ordinary ledger operations preserve detached v2 simulation data', () => {
  const ids = fixture(), initial = L.validateState({...ids.state, simulation: richSettings(ids)});
  const snapshots = [];
  snapshots.push(L.putAccount(initial, {name: 'Renamed cash', openingBalanceCents: 100}, 'account-cash'));
  snapshots.push(L.putCategory(initial, {name: 'Food renamed', type: 'expense'}, 'expense-food'));
  snapshots.push(L.putTransaction(initial, {type: 'expense', date: '2026-10-14', amountCents: 99, accountId: 'account-cash', categoryId: 'expense-food', note: 'New row'}));
  snapshots.push(L.deleteTransaction(initial, ids.food));
  snapshots.push(L.undoDelete(initial, ids.deleted));
  snapshots.push(L.removeCategory(initial, 'expense-transport'));
  const extraAccount = L.putAccount(initial, {name: 'Unused', openingBalanceCents: 0});
  snapshots.push(L.removeAccount(extraAccount, extraAccount.accounts.at(-1).id));
  for (const next of snapshots) {
    assert.equal(next.version, 2);
    assert.deepEqual(next.simulation, initial.simulation);
    assert.notEqual(next.simulation, initial.simulation);
    next.simulation.scenarios[0].name = 'Detached mutation';
    assert.equal(initial.simulation.scenarios[0].name, 'Home plan');
  }
});

test('UI export includes the complete v2 sandbox envelope without mutating saved state', () => {
  const ids = fixture(), initial = L.validateState({...ids.state, simulation: richSettings(ids)}), app = appWith(initial);
  app.run('download = (text, filename) => { window.capturedDownload = {text, filename}; }');
  click(app, {action: 'export'});
  const captured = app.value('window.capturedDownload');
  assert.equal(captured.filename, 'moneygo-2026-10-14.json');
  assert.equal(JSON.parse(captured.text).version, 2);
  assert.deepEqual(L.parseBackup(captured.text), initial);
  assert.deepEqual(app.value('state'), initial);
  assert.equal(app.storage.writes.length, 0);
});

test('sandbox dirty-form cancel guard preserves unsaved input until discard is confirmed', () => {
  const initial = L.validateState({...L.createEmpty(), simulation: richSettings()}), app = appWith(initial);
  const f = form(app, {name: 'Unsaved name'});
  click(app, {action: 'rename-scenario'});
  f.listeners.get('input')();
  app.run('window.confirm = () => false; closeModal()');
  assert.match(app.node('#modal-root').innerHTML, /方案改名/);
  assert.equal(f.elements.name.value, 'Unsaved name');
  assert.deepEqual(app.value('state'), initial);
  app.run('window.confirm = () => true; closeModal()');
  assert.equal(app.node('#modal-root').innerHTML, '');
  assert.deepEqual(app.value('state'), initial);
  assert.equal(app.storage.writes.length, 0);
});
