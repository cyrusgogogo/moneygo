'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const local = file => path.join(__dirname, '../dist', file);
const ledgerPath = path.join(__dirname, '../dist/ledger.js');
const L = require(ledgerPath), R = require(local('relations.js'));
const money = n => (n < 0 ? '−' : '') + '¥' + (Math.abs(n) / 100).toFixed(2);
const transaction = (id, type = 'expense', cents = 10000, date = '2026-10-01', extra = {}) => ({ id, type, amountCents: cents, date, accountId: 'account-cash', categoryId: type === 'income' ? 'income-other' : 'expense-food', note: id, ...extra });
function fixture(rows = []) { const s = L.createEmpty(); s.accounts.push({ id: 'bank', name: '银行', openingBalanceCents: 100000 }); s.transactions = rows; return s; }
const decode = s => (s || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attribute = (s, name) => { const m = s.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"')); return m ? decode(m[1]) : ''; };
// Minimal DOM substitute: verifies markup, selection pagination and action wiring.
// It does not simulate browser layout, native validation, focus traps or accessibility.
function harness(initial = fixture(), options = {}) {
  let state = initial, writes = 0, html = '', modal = '', title = '', errors = [], form = null, confirm = true;
  const nodes = new Map(), listeners = new Map();
  function node() { const children = new Map(); return { value: '', checked: false, disabled: false, textContent: '', innerHTML: '', dataset: {}, focus(){}, setSelectionRange(){}, addEventListener(){}, querySelector(selector){ if (!children.has(selector)) children.set(selector, node()); return children.get(selector); } }; }
  function fieldNode(tag, attributes, body) {
    const el = node(); el.value = attribute(attributes, 'value'); el.checked = /\schecked(?:\s|$)/.test(attributes);
    if (tag === 'textarea') el.value = decode(body);
    if (tag === 'select') {
      Object.defineProperty(el, 'innerHTML', { get(){ return el._html || ''; }, set(text){ el._html = text; const opts = [...text.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)]; const chosen = opts.find(o => /\sselected(?:\s|$)/.test(o[1])) || opts[0]; el.value = chosen ? attribute(chosen[1], 'value') || decode(chosen[2]) : ''; if (chosen && /value=""/.test(chosen[1])) el.value = ''; } }); el.innerHTML = body;
    }
    return el;
  }
  function parseForm(body) {
    const result = node(), fields = new Map();
    for (const match of body.matchAll(/<input\b([^>]*)>|<(select|textarea)\b([^>]*)>([\s\S]*?)<\/\2>/g)) {
      const tag = match[2] || 'input', attributes = match[1] === undefined ? match[3] : match[1], contents = match[4] || '';
      const name = attribute(attributes, 'name'); if (!name) continue;
      if (attribute(attributes, 'type') === 'radio') { if (!fields.has(name)) fields.set(name, { value: '' }); continue; }
      fields.set(name, fieldNode(tag, attributes, contents));
    }
    result.elements = { namedItem(name){ return fields.get(name); } }; result.reportValidity = () => true; return result;
  }
  const document = { addEventListener(type, callback){ listeners.set(type, callback); } }, window = { document, confirm(){ return confirm; } };
  const sandbox = { window, console }; window.MoneygoRefundReceipts = require(local('refund-receipts.js'));
  vm.runInNewContext(fs.readFileSync(local('refund-receipts-ui.js'), 'utf8'), sandbox);
  vm.runInNewContext(fs.readFileSync(local('relations-ui.js'), 'utf8'), sandbox);
  const UI = window.MoneygoBookkeepingUI;
  const ctx = { getState: () => state, engine: R, ledger: L, money, amountText: n => (n / 100).toFixed(2), accountName: id => state.accounts.find(a => a.id === id)?.name || '未知账户', categoryName: id => state.categories.find(c => c.id === id)?.name || '', today: () => '2026-10-14', now: () => '2026-10-14T12:00:00.000Z', cancel: '<button type="button" data-close>取消</button>',
    $(selector){ if (selector === '#entry-form') return form; if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); },
    modal(t, body, buttons, ready){ window.MoneygoRefundReceiptsUI.invalidate(); title = t; modal = body + (buttons || ''); form = body.includes('id="entry-form"') ? parseForm(body) : null; if (ready) ready(); },
    closeModal(){ window.MoneygoRefundReceiptsUI.invalidate(); form = null; modal = ''; }, error(message){ errors.push(message); },
    change(fn){ try { const next = fn(); if (options.failPersist) throw Error('模拟本地存储失败'); if (options.stale) throw Error('另一个页面已修改账本，请刷新'); state = next; writes++; ctx.closeModal(); ctx.render(); return true; } catch(error){ errors.push(error.message); return false; } },
    render(){ html = UI.render(ctx); UI.bind(ctx); }
  };
  ctx.render();
  return { ctx, UI, get state(){ return state; }, set state(s){ state = s; }, get html(){ return html; }, get modal(){ return modal; }, get title(){ return title; }, get form(){ return form; }, get writes(){ return writes; }, get errors(){ return errors; }, clearErrors(){ errors = []; }, setConfirm(v){ confirm = v; }, cancel(){ if (form?.dataset.dirty === 'true' && !confirm) return; ctx.closeModal(); },
    click(action, id, extra = {}){ listeners.get('click')({ target: { closest(){ return { dataset: { bkAction: action, bkId: id, ...extra }, disabled: false }; } } }); },
    fields(values){ for (const [key, val] of Object.entries(values)) { const el = form.elements.namedItem(key); assert.ok(el, 'field exists: ' + key); if (typeof val === 'boolean') el.checked = val; else el.value = val; } },
    submit(){ form.onsubmit({ preventDefault(){} }); },
    picker(name){ const host = form.querySelector(`[data-bk-picker="${name}"]`); return { list: host.querySelector('[data-bk-pick-list]'), picked: host.querySelector('[data-bk-picked]'), search(q){ const input = host.querySelector('[data-bk-search]'); input.value = q; input.oninput(); }, next(){ host.querySelector('[data-bk-pick-next]').onclick(); }, prev(){ host.querySelector('[data-bk-pick-prev]').onclick(); }, pick(id){ host.querySelector('[data-bk-pick-list]').onclick({target:{closest(){return {dataset:{bkPickId:id}};}}}); }, get count(){return host.querySelector('[data-bk-pick-count]').textContent;} }; }
  };
}


module.exports = {harness, fixture, transaction, L, R};
