'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dist = path.join(__dirname, '../dist');
const L = require(path.join(dist, 'ledger.js')), R = require(path.join(dist, 'relations.js'));
const sandbox = { window: { MoneygoRelations: R }, TextEncoder }; vm.runInNewContext(fs.readFileSync(path.join(dist, 'personal-events.js'), 'utf8'), sandbox); vm.runInNewContext(fs.readFileSync(path.join(dist, 'organizer.js'), 'utf8'), sandbox); const O = sandbox.window.MoneygoOrganizer;
const money = n => (n < 0 ? '−' : '') + '¥' + (Math.abs(n) / 100).toFixed(2);
const transaction = (id, extra = {}) => ({ id, type: 'expense', amountCents: 10001, date: '2026-10-01', accountId: 'account-cash', categoryId: 'expense-food', note: 'Coffee ' + id, ...extra });
function fixture(rows = []) { const s = L.createEmpty(); s.transactions = rows; return s; }
const decode = s => (s || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attribute = (s, name) => { const m = s.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"')); return m ? decode(m[1]) : ''; };
// A minimal DOM substitute verifies flow wiring, escaped markup, pagination and mutation safety.
// It does not claim browser layout, native validation, focus trapping or assistive-tech coverage.
function harness(initial = fixture(), options = {}) {
  let state = initial, writes = 0, html = '', modal = '', title = '', errors = [], form = null, confirm = true;
  const nodes = new Map(), listeners = new Map();
  function node() { const events = new Map(); return { value: '', checked: false, disabled: false, textContent: '', innerHTML: '', dataset: {}, focus(){}, setSelectionRange(){}, addEventListener(type, fn){ const list = events.get(type) || []; list.push(fn); events.set(type, list); }, emit(type, target){ for (const fn of events.get(type) || []) fn({ target }); } }; }
  function parseForm(body) {
    const result = node(), fields = new Map();
    for (const match of body.matchAll(/<input\b([^>]*)>|<(select|textarea)\b([^>]*)>([\s\S]*?)<\/\2>/g)) {
      const tag = match[2] || 'input', attrs = match[1] === undefined ? match[3] : match[1], contents = match[4] || '', name = attribute(attrs, 'name'); if (!name) continue;
      const el = node(); el.name = name; el.value = attribute(attrs, 'value'); el.checked = /\schecked(?:\s|$)/.test(attrs); el.disabled = /\sdisabled(?:\s|$)/.test(attrs);
      if (tag === 'textarea') el.value = decode(contents);
      if (tag === 'select') { const opts = [...contents.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)], chosen = opts.find(o => /\sselected(?:\s|$)/.test(o[1])) || opts[0]; el.value = chosen ? attribute(chosen[1], 'value') : ''; }
      fields.set(name, el);
    }
    result.elements = { namedItem(name){ return fields.get(name); } }; result.reportValidity = () => true; return result;
  }
  const document = { addEventListener(type, callback){ const list = listeners.get(type) || []; list.push(callback); listeners.set(type, list); } }, window = { document, confirm(){ return confirm; } };
  vm.runInNewContext(fs.readFileSync(path.join(dist, 'organizer-ui.js'), 'utf8'), { window, console }); const UI = window.MoneygoOrganizerUI;
  const ctx = { getState: () => state, engine: O, ledger: L, money, amountText: n => (n / 100).toFixed(2), accountName: id => state.accounts.find(a => a.id === id)?.name || '未知账户', categoryName: id => state.categories.find(c => c.id === id)?.name || '', today: () => '2026-10-14', cancel: '<button type="button" data-close>取消</button>',
    $(selector){ if (selector === '#entry-form') return form; if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); },
    modal(t, body, buttons, ready){ title = t; modal = body + (buttons || ''); nodes.clear(); form = body.includes('id="entry-form"') ? parseForm(body) : null; if (ready) ready(); },
    closeModal(){ form = null; modal = ''; }, error(message){ errors.push(message); },
    change(fn){ try { const next = fn(); if (options.failPersist) throw Error('模拟本地存储失败'); state = next; writes++; ctx.closeModal(); ctx.render(); return true; } catch(error){ errors.push(error.message); return false; } },
    render(){ html = UI.render(ctx); UI.bind(ctx); }
  };
  ctx.render();
  return { ctx, UI, get state(){ return state; }, set state(s){ state = s; }, get html(){ return html; }, get modal(){ return modal; }, get title(){ return title; }, get form(){ return form; }, get writes(){ return writes; }, get errors(){ return errors; }, setConfirm(v){confirm=v;},
    click(action, id, extra = {}){ const target = { dataset: { orgAction: action, orgId: id, ...extra }, disabled: false }; for (const fn of listeners.get('click') || []) fn({ target: { closest(){ return target; } } }); },
    fields(values){ for (const [name, val] of Object.entries(values)) { const el = form.elements.namedItem(name); assert.ok(el, 'field exists: ' + name); if (typeof val === 'boolean') el.checked = val; else el.value = val; form.emit('input', el); form.emit('change', el); } },
    submit(){ form.onsubmit({ preventDefault(){} }); },
    pick(id, checked = true){ const el = { checked, dataset: {orgPick:id}, closest(){return this;} }; ctx.$('#org-preview-rows').onchange({target:el}); },
    search(q){ const node=ctx.$('#org-preview-search'); node.value=q; node.oninput({target:node}); },
    button(id){ ctx.$('#'+id).onclick(); },
    handlerCount(){return (listeners.get('click') || []).length;}
  };
}
function addRule(state, extra = {}) { return O.saveRule(state, { name: '咖啡分类', conditions: {note:{operator:'contains', value:'Coffee', caseSensitive:false}}, actions:{categoryId:'expense-other'}, reason:'测试规则', ...extra }); }
function addAlias(state, extra = {}) { return O.saveAlias(state, {from:'Coffee a',to:'Coffee Shop',caseSensitive:false,enabled:true,reason:'核对商户名称',...extra}); }


module.exports = {harness, fixture, transaction, L, R, O};
