'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const L = require('../dist/ledger.js');

const ROLLBACK_KEY = 'moneygo.ledger.beforeRestore.v1';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  const writes = [];
  return {
    values, writes,
    failSet: null, failGet: null,
    getItem(key) {
      if (this.failGet?.(key)) throw new Error('Storage read denied');
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      if (this.failSet?.(key, value)) throw new Error('Quota exceeded');
      writes.push([key, String(value)]);
      values.set(key, String(value));
    },
    removeItem(key) { values.delete(key); }
  };
}

// A deliberately small DOM substitute for source-level UI logic and generated
// markup only. These tests do not emulate layout, native form validation, focus
// navigation, file pickers, actual storage durability, or a real browser.
function loadApp(storage = memoryStorage(), {today} = {}) {
  const nodes = new Map();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const document = {
    body: { style: {}, append() {} }, activeElement: null,
    addEventListener(type, callback) { documentListeners.set(type, callback); }
  };
  function node(selector) {
    if (!nodes.has(selector)) {
      nodes.set(selector, {
        innerHTML: '', textContent: '', value: '', disabled: false,
        checked: false, hidden: false, isConnected: true, dataset: {}, style: {}, listeners: new Map(),
        classList: { add() {}, remove() {}, contains() { return false; } },
        focus() { document.activeElement = this; },
        addEventListener(type, callback) { this.listeners.set(type, callback); }, setSelectionRange() {},
        querySelectorAll() { return []; }, closest() { return null; }
      });
    }
    return nodes.get(selector);
  }
  document.querySelector = selector => {
    if (selector === '.modal' && !node('#modal-root').innerHTML) return null;
    if (selector === '#entry-form' && !node('#modal-root').innerHTML.includes('id="entry-form"')) return null;
    return node(selector);
  };
  const window = {
    localStorage: storage, scrollTo() {}, confirm() { return true; },
    addEventListener(type, callback) { windowListeners.set(type, callback); }
  };
  const context = vm.createContext({
    document, window, console,
    ...(today ? {Date: class extends Date {
      constructor(...args) { super(...(args.length ? args : [today + 'T12:00:00Z'])); }
      static now() { return new Date(today + 'T12:00:00Z').getTime(); }
    }} : {}),
    FormData: class {
      constructor(form) { this.form = form; }
      getAll(name) { return this.form.formData?.[name] || []; }
    },
    setTimeout() { return 1; }, clearTimeout() {}
  });
  for (const filename of ['ledger.js', 'scenario.js', 'relations.js', 'importer.js', 'relations-ui.js', 'app.js']) {
    const source = fs.readFileSync(path.join(__dirname, '../dist/', filename), 'utf8');
    vm.runInContext(source, context, { filename: 'dist/' + filename });
  }
  return {
    storage, node, documentListeners, windowListeners,
    run(code) { return vm.runInContext(code, context); },
    value(code) { return JSON.parse(vm.runInContext(`JSON.stringify(${code})`, context)); },
    putGlobal(key, value) { context[key] = value; }
  };
}

function withExpense(state = L.createEmpty(), note = 'Test transaction') {
  return L.putTransaction(state, {
    type: 'expense', date: '2026-10-14', amountCents: 101,
    accountId: state.accounts[0].id, categoryId: 'expense-food', note
  });
}
function namedState(name) {
  return L.putAccount(L.createEmpty(), {name, openingBalanceCents: 0}, 'account-cash');
}
function prepareRestore(app, next) {
  app.run('showRestore()');
  app.putGlobal('testNext', next);
  app.run('restorePreview(testNext)');
}
function confirmRestore(app) {
  app.node('#restore-consent').checked = true;
  app.node('#restore-consent').onchange({target: app.node('#restore-consent')});
  app.node('#confirm-restore').onclick();
}

module.exports = { memoryStorage, loadApp, withExpense, namedState, prepareRestore, confirmRestore, ROLLBACK_KEY };

// Importing the harness does not register this file's tests a second time.
if (require.main === module) {
test('real app starts empty and does not persist sample data', () => {
  const app = loadApp();
  assert.equal(app.value('state.transactions.length'), 0);
  assert.equal(app.value('state.trash.length'), 0);
  assert.equal(app.storage.writes.length, 0);
  assert.match(app.node('#app').innerHTML, /还没有交易/);
  assert.match(app.node('#app').innerHTML, /当前浏览器/);
});

test('recent transactions all retain edit actions, never restore actions', () => {
  const state = withExpense(withExpense(withExpense()));
  const app = loadApp(memoryStorage({[L.STORAGE_KEY]: JSON.stringify(state)}));
  app.run("month='2026-10'; render()");
  const html = app.node('#app').innerHTML;
  assert.equal((html.match(/data-tx=/g) || []).length, 3);
  assert.equal((html.match(/data-undo=/g) || []).length, 0);
});

test('account names, category names, notes, filters and option values are escaped', () => {
  const attack = '\"><img src=x onerror=alert(1)>&\'';
  let state = L.createEmpty();
  state = L.putAccount(state, {name: attack, openingBalanceCents: 0}, 'account-cash');
  state = L.putCategory(state, {name: attack, type: 'expense'}, 'expense-food');
  state = withExpense(state, attack);
  const app = loadApp(memoryStorage({[L.STORAGE_KEY]: JSON.stringify(state)}));
  app.run("month='2026-10'");
  for (const page of ['report', 'ledger', 'manage', 'backup']) {
    app.run(`page=${JSON.stringify(page)};render()`);
    assert.ok(!app.node('#app').innerHTML.includes(attack), page);
    if (page !== 'backup') assert.match(app.node('#app').innerHTML, /&lt;img src=x onerror=alert\(1\)&gt;/, page);
  }
  app.putGlobal('attack', attack);
  app.run("page='ledger';filters.q=attack;render()");
  assert.ok(!app.node('#app').innerHTML.includes('value="' + attack));
  assert.match(app.run('options([{id:attack,name:attack}],null)'), /value="&quot;&gt;&lt;img/);
  assert.equal(app.run('esc(attack)'), '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;&amp;&#39;');
});

test('successful save survives a fresh app initialization with the same storage', () => {
  const storage = memoryStorage();
  const app = loadApp(storage);
  const next = withExpense();
  app.putGlobal('next', next);
  app.run('persist(next)');
  assert.deepEqual(app.value('state'), next);
  assert.equal(app.run('savedRaw'), storage.getItem(L.STORAGE_KEY));
  const reloaded = loadApp(storage);
  assert.deepEqual(reloaded.value('state'), next);
  assert.equal(reloaded.run('Boolean(blocked)'), false);
});

test('save failure does not commit in-memory state or overwrite stored state', () => {
  const original = namedState('Original');
  const originalRaw = JSON.stringify(original);
  const storage = memoryStorage({[L.STORAGE_KEY]: originalRaw});
  const app = loadApp(storage);
  storage.failSet = key => key === L.STORAGE_KEY;
  app.putGlobal('next', withExpense(original));
  assert.throws(() => app.run('persist(next)'), /保存失败/);
  assert.deepEqual(app.value('state'), original);
  assert.equal(app.run('savedRaw'), originalRaw);
  assert.equal(storage.getItem(L.STORAGE_KEY), originalRaw);
});

test('corrupt startup data is preserved and normal edits cannot overwrite it', () => {
  const corrupt = '{"version":1,"transactions":';
  const storage = memoryStorage({[L.STORAGE_KEY]: corrupt});
  const app = loadApp(storage);
  assert.equal(app.run('Boolean(blocked)'), true);
  assert.equal(app.value('state.transactions.length'), 0);
  app.putGlobal('next', withExpense());
  assert.throws(() => app.run('persist(next)'), /无法读取/);
  assert.equal(storage.getItem(L.STORAGE_KEY), corrupt);
  assert.equal(storage.writes.length, 0);
  app.run("page='backup';render()");
  assert.match(app.node('#app').innerHTML, /data-action="export-raw"/);
});

test('unavailable local storage blocks saving while still rendering recovery guidance', () => {
  const storage = memoryStorage();
  storage.failGet = () => true;
  const app = loadApp(storage);
  assert.equal(app.run('Boolean(blocked)'), true);
  app.putGlobal('next', withExpense());
  assert.throws(() => app.run('persist(next)'), /无法读取|不可用/);
  assert.match(app.node('#app').innerHTML, /不会被自动覆盖/);
  assert.equal(storage.writes.length, 0);
});

test('changed storage and storage events both prevent stale-tab writes', () => {
  const storage = memoryStorage();
  const app = loadApp(storage);
  const other = namedState('Another tab');
  storage.setItem(L.STORAGE_KEY, JSON.stringify(other));
  app.putGlobal('next', withExpense());
  assert.throws(() => app.run('persist(next)'), /另一个页面/);
  assert.equal(app.run('stale'), true);
  assert.deepEqual(JSON.parse(storage.getItem(L.STORAGE_KEY)), other);
  const second = loadApp(storage);
  second.windowListeners.get('storage')({key: L.STORAGE_KEY});
  second.putGlobal('next', withExpense(other));
  assert.throws(() => second.run('persist(next)'), /另一个页面/);
});

test('restore preview cannot write until explicit consent and preserves original for rollback', () => {
  const original = withExpense(namedState('Original'));
  const raw = JSON.stringify(original);
  const storage = memoryStorage({[L.STORAGE_KEY]: raw});
  const app = loadApp(storage);
  const replacement = namedState('Replacement');
  prepareRestore(app, replacement);
  assert.match(app.node('#restore-preview').innerHTML, /完整替换/);
  app.node('#confirm-restore').onclick();
  assert.equal(storage.writes.length, 0);
  confirmRestore(app);
  assert.deepEqual(app.value('state'), replacement);
  assert.equal(storage.getItem(ROLLBACK_KEY), raw);
  assert.deepEqual(JSON.parse(storage.getItem(L.STORAGE_KEY)), replacement);
  app.run('rollback()');
  assert.deepEqual(app.value('state'), replacement, 'opening rollback must not change data');
  app.node('#confirm-rollback').onclick();
  assert.deepEqual(app.value('state'), original);
  assert.deepEqual(JSON.parse(storage.getItem(L.STORAGE_KEY)), original);
});

test('failed restore preserves previous recovery copy as well as current ledger', () => {
  const original = namedState('Current');
  const originalRaw = JSON.stringify(original);
  const recoveryRaw = JSON.stringify(namedState('Previous recovery'));
  const storage = memoryStorage({[L.STORAGE_KEY]: originalRaw, [ROLLBACK_KEY]: recoveryRaw});
  const app = loadApp(storage);
  prepareRestore(app, namedState('New replacement'));
  storage.failSet = key => key === L.STORAGE_KEY;
  confirmRestore(app);
  assert.equal(storage.getItem(L.STORAGE_KEY), originalRaw);
  assert.deepEqual(app.value('state'), original);
  assert.equal(storage.getItem(ROLLBACK_KEY), recoveryRaw);
  assert.match(app.node('#form-error').textContent, /恢复未完成/);
});

test('failure to store recovery copy aborts restore before main ledger changes', () => {
  const original = namedState('Current');
  const originalRaw = JSON.stringify(original);
  const storage = memoryStorage({[L.STORAGE_KEY]: originalRaw});
  const app = loadApp(storage);
  prepareRestore(app, namedState('Replacement'));
  storage.failSet = key => key === ROLLBACK_KEY;
  confirmRestore(app);
  assert.equal(storage.getItem(L.STORAGE_KEY), originalRaw);
  assert.deepEqual(app.value('state'), original);
  assert.equal(storage.getItem(ROLLBACK_KEY), null);
  assert.match(app.node('#form-error').textContent, /恢复未完成/);
});

test('valid recovery copy can restore a ledger whose main stored data is corrupt', () => {
  const original = withExpense(namedState('Recoverable'));
  const storage = memoryStorage({[L.STORAGE_KEY]: '{broken', [ROLLBACK_KEY]: JSON.stringify(original)});
  const app = loadApp(storage);
  assert.equal(app.run('Boolean(blocked)'), true);
  app.run('rollback()');
  app.node('#confirm-rollback').onclick();
  assert.deepEqual(app.value('state'), original);
  assert.deepEqual(JSON.parse(storage.getItem(L.STORAGE_KEY)), original);
  assert.equal(app.run('Boolean(blocked)'), false);
});

test('explicit valid backup restore preserves corrupt original raw data for download', () => {
  const corrupt = '{broken original';
  const storage = memoryStorage({[L.STORAGE_KEY]: corrupt});
  const app = loadApp(storage);
  const replacement = namedState('Recovered');
  prepareRestore(app, replacement);
  confirmRestore(app);
  assert.deepEqual(app.value('state'), replacement);
  assert.equal(storage.getItem(ROLLBACK_KEY), corrupt);
  assert.equal(app.run('Boolean(blocked)'), false);
  app.run('rollback()');
  assert.match(app.node('#modal-root').innerHTML, /无法自动撤销/);
  assert.deepEqual(app.value('state'), replacement);
});

test('latest selected backup wins when an earlier file read resolves later', async () => {
  const app = loadApp();
  app.run('showRestore()');
  let finishFirst;
  const first = new Promise(resolve => { finishFirst = resolve; });
  const firstRead = app.node('#restore-file').onchange({target: {files: [{size: 1, text: () => first}]}});
  const latest = namedState('Latest selection');
  await app.node('#restore-file').onchange({target: {files: [{size: 1, text: async () => L.backup(latest)}]}});
  finishFirst(L.backup(namedState('Earlier selection')));
  await firstRead;
  confirmRestore(app);
  assert.deepEqual(app.value('state'), latest);
});

test('closing the restore dialog ignores an outstanding backup file read', async () => {
  const app = loadApp();
  app.run('showRestore()');
  let finish;
  const text = new Promise(resolve => { finish = resolve; });
  const read = app.node('#restore-file').onchange({target: {files: [{size: 1, text: () => text}]}});
  app.run('closeModal(true)');
  finish(L.backup(withExpense()));
  await read;
  assert.equal(app.node('#modal-root').innerHTML, '');
  assert.equal(app.storage.writes.length, 0);
});

test('save commits the normalized state without a failure-prone post-write read', () => {
  const storage = memoryStorage();
  const app = loadApp(storage);
  const next = withExpense();
  next.accounts[0].name = '  Cash  ';
  next.transactions[0].ignored = 'not persisted';
  app.putGlobal('next', next);
  const normalSet = storage.setItem;
  storage.setItem = function (key, value) {
    normalSet.call(this, key, value);
    this.failGet = () => true;
  };
  assert.doesNotThrow(() => app.run('persist(next)'));
  const expected = L.validateState(next);
  assert.deepEqual(app.value('state'), expected);
  assert.equal(app.run('savedRaw'), storage.values.get(L.STORAGE_KEY));
});

test('modal applies and releases background inertness and traps Tab from error focus', () => {
  const app = loadApp();
  app.run("modal('Test dialog','<p>Test content</p>')");
  assert.equal(app.node('#app').inert, true);
  const first = app.node('#first-button');
  const last = app.node('#last-button');
  app.node('.modal').querySelectorAll = () => [first, last];
  app.run("error('Validation failed')");
  let prevented = false;
  app.documentListeners.get('keydown')({key: 'Tab', shiftKey: false, preventDefault() { prevented = true; }});
  assert.equal(prevented, true);
  assert.equal(app.run("document.activeElement === document.querySelector('#first-button')"), true);
  app.run("error('Validation failed again')");
  app.documentListeners.get('keydown')({key: 'Tab', shiftKey: true, preventDefault() {}});
  assert.equal(app.run("document.activeElement === document.querySelector('#last-button')"), true);
  app.run('closeModal(true)');
  assert.equal(app.node('#app').inert, false);
});

test('first failed restore removes its newly written recovery copy', () => {
  const originalRaw = JSON.stringify(namedState('Current'));
  const storage = memoryStorage({[L.STORAGE_KEY]: originalRaw});
  const app = loadApp(storage);
  prepareRestore(app, namedState('Replacement'));
  storage.failSet = key => key === L.STORAGE_KEY;
  confirmRestore(app);
  assert.equal(storage.getItem(L.STORAGE_KEY), originalRaw);
  assert.equal(storage.getItem(ROLLBACK_KEY), null);
  assert.match(app.node('#form-error').textContent, /恢复未完成/);
});

test('deleted transfer recovery restores both balances but never income or expense', () => {
  let original = L.putAccount(L.createEmpty(), {name: 'Savings', openingBalanceCents: 3000});
  original = L.putTransaction(original, {
    type: 'transfer', date: '2026-10-14', amountCents: 250,
    accountId: original.accounts[0].id, toAccountId: original.accounts[1].id, note: 'Transfer'
  });
  const id = original.transactions[0].id;
  const deleted = L.deleteTransaction(original, id);
  const app = loadApp(memoryStorage({[L.STORAGE_KEY]: JSON.stringify(deleted)}));
  app.run("page='backup';render()");
  assert.match(app.node('#app').innerHTML, /data-undo=/);
  const target = {dataset: {undo: id}, hasAttribute() { return false; }};
  app.documentListeners.get('click')({target: {closest: () => target}});
  assert.equal(app.value('state.trash.length'), 1);
  app.node('#confirm-undo').onclick();
  assert.deepEqual(app.value('state'), original);
  assert.deepEqual(app.value('L.balances(state)'), JSON.parse(JSON.stringify(L.balances(original))));
  assert.equal(app.value('L.summary(state).incomeCents'), 0);
  assert.equal(app.value('L.summary(state).expenseCents'), 0);
});

test('money formatting preserves exact cents for safe-integer aggregate balances', () => {
  const app = loadApp();
  assert.equal(app.run('money(9000000000000001)'), '¥90,000,000,000,000.01');
  assert.equal(app.run('money(9007199254740991)'), '¥90,071,992,547,409.91');
  assert.equal(app.run('money(-9007199254740991)'), '−¥90,071,992,547,409.91');
  assert.equal(app.run('money(1)'), '¥0.01');
  assert.equal(app.run('money(0)'), '¥0.00');
});

test('transfer search matches the displayed destination account name', () => {
  let state = L.putAccount(L.createEmpty(), {name: 'Destination savings', openingBalanceCents: 0});
  state = L.putTransaction(state, {
    type: 'transfer', date: '2026-10-14', amountCents: 250,
    accountId: state.accounts[0].id, toAccountId: state.accounts[1].id, note: 'Move funds'
  });
  const app = loadApp(memoryStorage({[L.STORAGE_KEY]: JSON.stringify(state)}));
  app.run("page='ledger';month='2026-10';filters.q='Destination savings';render()");
  assert.match(app.node('#app').innerHTML, /data-tx=/);
  assert.match(app.node('#app').innerHTML, /Move funds/);
});

}
