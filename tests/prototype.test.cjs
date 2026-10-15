'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, './fixtures/historical-prototype/demo-v0.js'), 'utf8');

// Keep the retired, nonshipped historical source unchanged. This harness tests domain logic only;
// it deliberately does not pretend to implement a browser or layout engine.
function loadPrototype() {
  const nodes = new Map();
  const timers = [];
  function node(selector) {
    if (!nodes.has(selector)) {
      nodes.set(selector, {
        innerHTML: '', textContent: '', value: '', disabled: false,
        isConnected: true, style: {}, dataset: {},
        classList: { add() {}, remove() {}, contains() { return false; } },
        addEventListener() {}, focus() {}, setSelectionRange() {},
        scrollIntoView() {}, querySelectorAll() { return []; }
      });
    }
    return nodes.get(selector);
  }
  const context = vm.createContext({
    document: {
      querySelector: node, querySelectorAll: () => [],
      body: { style: {} }, activeElement: null, addEventListener() {}
    },
    window: { scrollTo() {} },
    setTimeout(fn, delay) { timers.push({ fn, delay }); return timers.length; },
    clearTimeout() {}
  });
  vm.runInContext(source, context, { filename: 'historical-prototype/demo-v0.js' });
  return {
    debug: context.window.moneygoDebug,
    run(code) { return vm.runInContext(code, context); },
    node,
    importSource(sourceName) {
      vm.runInContext(`showImport(${JSON.stringify(sourceName)})`, context);
      node('#confirm-import').onclick();
      const pending = timers.splice(0);
      for (const timer of pending) if (timer.delay === 650) timer.fn();
    }
  };
}

test('initial September totals reconcile and exclude transfers/repayments', () => {
  const app = loadPrototype();
  const totals = app.debug.monthInfo();
  assert.equal(totals.net, 9662.3);
  assert.equal(totals.refund, 99);
  assert.equal(totals.gross, 9761.3);
  assert.equal(totals.excluded, 5800);
  assert.equal(totals.count, 28);
  const categorySum = app.debug.categoryTotals(totals.ts)
    .reduce((sum, category) => sum + Math.round(category.total * 100), 0);
  assert.equal(categorySum, 966230);
});

test('month switch uses only records in the selected month', () => {
  const app = loadPrototype();
  app.run("month = '08'");
  const totals = app.debug.monthInfo();
  assert.equal(totals.net, 10289);
  assert.equal(Math.abs(totals.refund), 0);
  assert.equal(totals.excluded, 0);
  assert.ok(totals.ts.every(transaction => transaction.date.startsWith('2026-08-')));
});

test('linking a duplicate preserves spending and is idempotent', () => {
  const app = loadPrototype();
  app.run("resolve('duplicate'); resolve('duplicate')");
  assert.equal(app.debug.monthInfo().net, 9662.3);
  assert.equal(app.debug.transactions.find(t => t.id === 's15').raw.length, 2);
  assert.equal(app.debug.reviews.duplicate, true);
});

test('choosing a separate transaction requires confirmation and adds 128', () => {
  const app = loadPrototype();
  app.run("resolve('separate')");
  assert.equal(app.debug.monthInfo().net, 9662.3);
  app.node('#confirm-separate').onclick();
  assert.equal(app.debug.monthInfo().net, 9790.3);
  assert.equal(app.debug.reviews.duplicate, true);
});

test('matching a partial refund deducts it only once', () => {
  const app = loadPrototype();
  app.run("resolve('refund'); resolve('refund')");
  assert.equal(app.debug.monthInfo().net, 9533.3);
  assert.equal(app.debug.monthInfo().refund, 228);
  assert.equal(app.debug.transactions.filter(t => t.id === 'refund-new').length, 1);
});

test('classification changes category totals without changing spending', () => {
  const app = loadPrototype();
  app.node('#review-cat').value = '购物消费';
  app.run("resolve('category')");
  assert.equal(app.debug.transactions.find(t => t.id === 's19').cat, '购物消费');
  assert.equal(app.debug.monthInfo().net, 9662.3);
  assert.equal(app.debug.reviews.category, true);
});

test('all import orders deduplicate fixed demo transaction IDs', () => {
  const orders = [
    ['wx', 'ali', 'cmb'], ['wx', 'cmb', 'ali'], ['ali', 'wx', 'cmb'],
    ['ali', 'cmb', 'wx'], ['cmb', 'wx', 'ali'], ['cmb', 'ali', 'wx']
  ];
  for (const order of orders) {
    const app = loadPrototype();
    for (const sourceName of order) app.importSource(sourceName);
    assert.equal(app.debug.monthInfo().net, 9858.3, order.join(','));
    const imported = app.debug.transactions.filter(t => t.id.startsWith('import-'));
    assert.equal(imported.length, 2);
    assert.ok(imported.every(t => t.sources.length === 2 && t.raw.length === 2));
    assert.equal(app.debug.imports.length, 3);
  }
});

test('canceling an import before confirmation leaves state unchanged', () => {
  const app = loadPrototype();
  app.run("showImport('wx'); closeModal()");
  assert.equal(app.debug.monthInfo().net, 9662.3);
  assert.equal(app.debug.imports.length, 0);
});

test('transaction filters match merchant, source and type', () => {
  const app = loadPrototype();
  app.run("filters.q = 'MUJI'");
  assert.equal(app.run('filtered().length'), 1);
  app.run("filters.q = ''; filters.source = 'cmb'; filters.type = 'repayment'");
  assert.equal(app.run('filtered().length'), 1);
  assert.equal(app.run('spent(filtered())'), 0);
  app.run("filters.q = '不存在的商户'");
  assert.equal(app.run('filtered().length'), 0);
});

test('reset clears reviews, imports, filters and selected month', () => {
  const app = loadPrototype();
  app.run("resolve('refund'); resolve('duplicate')");
  app.importSource('wx');
  app.run("month = '08'; filters.q = '房屋'");
  app.debug.reset();
  assert.equal(app.debug.monthInfo().net, 9662.3);
  assert.equal(app.debug.imports.length, 0);
  assert.ok(Object.values(app.debug.reviews).every(value => value === false));
  assert.equal(app.run('filters.q'), '');
  assert.equal(app.run('month'), '09');
});

test('historical prototype HTML pointed to local assets and labelled demo data', () => {
  const html = fs.readFileSync(path.join(__dirname, './fixtures/historical-prototype/demo-v0.html'), 'utf8');
  assert.match(html, /lang="zh-CN"/);
  assert.match(html, /href="styles\.css"/);
  assert.match(html, /src="demo\.js"/);
  assert.match(html, /虚构示例数据/);
  assert.doesNotMatch(html, /(?:src|href)="https?:\/\//);
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/);
});
