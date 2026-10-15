'use strict';
const {readEntryManifest,applyBodyAttributes,addListener,removeListener}=require('./entry-manifest.cjs');

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
    addEventListener(type, callback) { addListener(documentListeners, type, callback); },
    removeEventListener(type, callback) { removeListener(documentListeners, type, callback); }
  };
  function node(selector) {
    if (!nodes.has(selector)) {
      nodes.set(selector, {
        innerHTML: '', textContent: '', value: '', disabled: false,
        checked: false, hidden: false, isConnected: true, dataset: {}, style: {}, listeners: new Map(),
        classList: { add() {}, remove() {}, contains() { return false; } },
        focus() { document.activeElement = this; },
        addEventListener(type, callback) { addListener(this.listeners, type, callback); },
        removeEventListener(type, callback) { removeListener(this.listeners, type, callback); }, setSelectionRange() {},
        querySelectorAll() { return []; }, querySelector(child) { return node(selector + ' ' + child); }, closest() { return null; }, reportValidity() { return true; }
      });
    }
    const result = nodes.get(selector);
    if (selector === '#modal-root' && !result.parseInstalled) {
      result.parseInstalled = true;
      let html = '';
      Object.defineProperty(result, 'innerHTML', {get(){return html;},set(body){
        html = body;
        for (const key of [...nodes.keys()]) if (key === '#entry-form' || key.startsWith('#entry-form ')) nodes.delete(key);
        if (!body.includes('id="entry-form"')) return;
        const form = node('#entry-form'), fields = new Map();
        const decode = value => (value || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        const attr = (text, name) => decode(text.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"'))?.[1] || '');
        for (const match of body.matchAll(/<input\b([^>]*)>|<(select|textarea)\b([^>]*)>([\s\S]*?)<\/\2>/g)) {
          const attrs=match[1]===undefined?match[3]:match[1],name=attr(attrs,'name');if(!name)continue;
          const field={value:match[2]==='textarea'?decode(match[4]):attr(attrs,'value'),checked:/\schecked(?:\s|$)/.test(attrs)};
          fields.set(name,field);
        }
        form.elements = {namedItem(name){return fields.get(name);}};
      }});
    }
    return result;
  }
  document.querySelectorAll = () => [...nodes.values()];
  document.querySelector = selector => {
    if (selector === '.modal' && !node('#modal-root').innerHTML) return null;
    if (selector === '#entry-form' && !node('#modal-root').innerHTML.includes('id="entry-form"')) return null;
    return node(selector);
  };
  const window = {
    document, localStorage: storage, scrollTo() {}, confirm() { return true; },
    addEventListener(type, callback) { addListener(windowListeners, type, callback); },
    removeEventListener(type, callback) { removeListener(windowListeners, type, callback); }
  };
  const context = vm.createContext({
    document, window, console, TextEncoder, TextDecoder,
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
  const entry = readEntryManifest();
  applyBodyAttributes(document.body, entry);
  for (const filename of entry.scripts) {
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

