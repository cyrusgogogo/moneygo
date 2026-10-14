'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const local = file => fs.existsSync(path.join(__dirname, file)) ? path.join(__dirname, file) : path.join(__dirname, '../dist', file);
const ledgerPath = path.join(__dirname, '../dist/ledger.js');
const L = require(ledgerPath), R = require(local('relations.js'));
const money = n => (n < 0 ? '−' : '') + '¥' + (Math.abs(n) / 100).toFixed(2);
const transaction = (id, type = 'expense', cents = 10000, date = '2026-10-01', extra = {}) => ({ id, type, amountCents: cents, date, accountId: 'account-cash', categoryId: type === 'income' ? 'income-other' : 'expense-food', note: id, ...extra });
function fixture(rows = []) { const s = L.createEmpty(); s.accounts.push({ id: 'bank', name: '银行', openingBalanceCents: 100000 }); s.transactions = rows; return s; }
const decode = s => (s || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attribute = (s, name) => { const m = s.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"')); return m ? decode(m[1]) : ''; };
// Minimal DOM substitute: verifies markup, selection pagination and action wiring.
// It does not simulate browser layout, native validation, focus traps or accessibility.
function harness(initial = fixture()) {
  let state = initial, writes = 0, html = '', modal = '', title = '', errors = [], form = null;
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
  const document = { addEventListener(type, callback){ listeners.set(type, callback); } }, window = { document, confirm(){ return true; } };
  const sandbox = { window, console }; vm.runInNewContext(fs.readFileSync(local('relations-ui.js'), 'utf8'), sandbox);
  const UI = window.MoneygoBookkeepingUI;
  const ctx = { getState: () => state, engine: R, ledger: L, money, amountText: n => (n / 100).toFixed(2), accountName: id => state.accounts.find(a => a.id === id)?.name || '未知账户', categoryName: id => state.categories.find(c => c.id === id)?.name || '', today: () => '2026-10-14', cancel: '<button type="button" data-close>取消</button>',
    $(selector){ if (selector === '#entry-form') return form; if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); },
    modal(t, body, buttons, ready){ title = t; modal = body + (buttons || ''); form = body.includes('id="entry-form"') ? parseForm(body) : null; if (ready) ready(); },
    closeModal(){ form = null; modal = ''; }, error(message){ errors.push(message); },
    change(fn){ try { state = fn(); writes++; ctx.closeModal(); ctx.render(); return true; } catch(error){ errors.push(error.message); return false; } },
    render(){ html = UI.render(ctx); UI.bind(ctx); }
  };
  ctx.render();
  return { ctx, UI, get state(){ return state; }, set state(s){ state = s; }, get html(){ return html; }, get modal(){ return modal; }, get title(){ return title; }, get form(){ return form; }, get writes(){ return writes; }, get errors(){ return errors; }, clearErrors(){ errors = []; },
    click(action, id, extra = {}){ listeners.get('click')({ target: { closest(){ return { dataset: { bkAction: action, bkId: id, ...extra }, disabled: false }; } } }); },
    fields(values){ for (const [key, val] of Object.entries(values)) { const el = form.elements.namedItem(key); assert.ok(el, 'field exists: ' + key); if (typeof val === 'boolean') el.checked = val; else el.value = val; } },
    submit(){ form.onsubmit({ preventDefault(){} }); },
    picker(name){ const host = form.querySelector(`[data-bk-picker="${name}"]`); return { list: host.querySelector('[data-bk-pick-list]'), picked: host.querySelector('[data-bk-picked]'), search(q){ const input = host.querySelector('[data-bk-search]'); input.value = q; input.oninput(); }, next(){ host.querySelector('[data-bk-pick-next]').onclick(); }, prev(){ host.querySelector('[data-bk-pick-prev]').onclick(); }, pick(id){ host.querySelector('[data-bk-pick-list]').onclick({target:{closest(){return {dataset:{bkPickId:id}};}}}); }, get count(){return host.querySelector('[data-bk-pick-count]').textContent;} }; }
  };
}

test('UMD renders an empty ledger without writes, network, timers or storage', () => {
  const h = harness(); assert.equal(h.writes, 0); assert.match(h.html, /证据核对/); assert.match(h.html, /报销与垫付/); assert.match(h.html, /个人消费/); assert.match(h.html, /当前未收回款/); assert.match(h.html, /0 条/); assert.equal(h.state.bookkeeping, undefined); assert.ok(Object.isFrozen(h.UI));
  const source = fs.readFileSync(local('relations-ui.js'), 'utf8'); assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|localStorage|setInterval|setTimeout|Notification|https?:\/\//);
});

test('rendered notes, accounts, source fields and history are escaped', () => {
  const attack = '<img src=x onerror="bad()">'; const s = fixture([transaction('expense', 'expense', 10000, '2026-10-01', { note: attack })]); s.accounts[0].name = attack;
  s.imports = { evidence: [{ id:'source', transactionId:'expense', sourceKey:attack, status:attack, mapped:{channel:attack,note:attack}, accountId:'account-cash', stableId:attack, lastBatchId:attack }] };
  const h = harness(s); assert.ok(!h.html.includes(attack)); assert.match(h.html, /&lt;img/); const detail = h.UI.transactionDetails(h.ctx, 'expense'); assert.ok(!detail.includes(attack)); assert.match(detail, /&quot;bad\(\)&quot;/);
  h.state = R.createClaim(s, { expenseId:'expense', amountCents:1000, name:attack, kind:'advance', status:'submitted', note:attack }); h.click('tab','claims'); assert.ok(!h.html.includes(attack)); h.click('tab','audit'); assert.ok(!h.html.includes(attack)); assert.match(h.html, /&lt;img/);
});

test('all transaction list pages are reachable and no candidate is auto-linked', () => {
  const h = harness(fixture(Array.from({length:67},(_,i)=>transaction('row-'+String(i).padStart(3,'0')))));
  assert.match(h.html, /1–25 \/ 67/); assert.doesNotMatch(h.html, /data-bk-id="row-066"/); h.click('page',null,{bkKey:'transactions',bkDelta:'1'}); assert.match(h.html,/26–50 \/ 67/); h.click('page',null,{bkKey:'transactions',bkDelta:'1'}); assert.match(h.html,/data-bk-id="row-066"/); assert.equal(h.writes,0);
  h.click('candidates','row-000'); assert.match(h.ctx.$('#bk-candidate-list').innerHTML,/匹配依据/); assert.match(h.ctx.$('#bk-candidate-count').textContent,/1–25 \/ 66/); h.ctx.$('#bk-candidate-next').onclick(); h.ctx.$('#bk-candidate-next').onclick(); assert.match(h.ctx.$('#bk-candidate-list').innerHTML,/row-066/); assert.equal(h.writes,0);
});

test('mismatched funding accounts are disclosed and cannot enter confirmation',()=>{
 const h=harness(fixture([transaction('a'),transaction('b','expense',10000,'2026-10-01',{accountId:'bank'})]));h.click('candidates','a');assert.match(h.ctx.$('#bk-candidate-list').innerHTML,/资金账户不同/);assert.match(h.ctx.$('#bk-candidate-list').innerHTML,/data-bk-base="a" disabled/);h.click('pair','b',{bkBase:'a'});assert.match(h.errors.at(-1),/无法关联/);assert.equal(h.writes,0);
});

test('canonical choice and identity confirmation are explicit, then star evidence is supported',()=>{
 const h=harness(fixture([transaction('a'),transaction('b'),transaction('c')]));h.click('pair','b',{bkBase:'a'});assert.equal(h.form.elements.namedItem('primaryId').value,'');assert.doesNotMatch(h.modal,/name="primaryId"[^>]*checked/);h.fields({reason:'订单相同'});h.submit();assert.match(h.errors.at(-1),/选择主记录/);h.fields({primaryId:'a',confirmed:false});h.submit();assert.match(h.errors.at(-1),/先确认/);h.fields({confirmed:true});h.submit();assert.equal(h.state.bookkeeping.links.length,1);assert.equal(h.state.transactions.length,3);assert.equal(R.calculate(h.state).cash.expenseCents,20000);
 assert.doesNotMatch(h.html,/data-bk-action="candidates" data-bk-id="a" disabled/);h.click('pair','c',{bkBase:'a'});assert.match(h.modal,/已有其他证据/);assert.match(h.modal,/value="c" disabled/);h.fields({primaryId:'a',confirmed:true,reason:'银行与商户凭证同一支付'});h.submit();assert.equal(h.state.bookkeeping.links.length,2);assert.equal(R.calculate(h.state).cash.expenseCents,10000);
});

test('transaction picker reaches all rows and preserves selected transaction while searching or paging',()=>{
 const rows=Array.from({length:67},(_,i)=>transaction('expense-'+String(i).padStart(3,'0')));rows.push(transaction('income','income',10000,'2026-11-01'));const h=harness(fixture(rows));h.click('refund');const picker=h.picker('expenseId');assert.match(picker.count,/1–25 \/ 67/);picker.next();picker.next();assert.match(picker.list.innerHTML,/expense-066/);picker.pick('expense-066');assert.equal(h.form.elements.namedItem('expenseId').value,'expense-066');picker.search('expense-000');assert.doesNotMatch(picker.list.innerHTML,/expense-066/);assert.match(picker.picked.innerHTML,/expense-066/);assert.equal(h.form.elements.namedItem('expenseId').value,'expense-066');picker.search('');picker.prev();assert.equal(h.form.elements.namedItem('expenseId').value,'expense-066');assert.equal(h.writes,0);
});

test('partial cross-month refunds allocate only existing cash, reject overallocations atomically',()=>{
 const h=harness(fixture([transaction('expense'),transaction('r1','income',3000,'2026-11-01'),transaction('r2','income',2000,'2026-12-01')]));h.click('refund','expense');h.picker('incomeId').pick('r1');h.fields({amount:'30.00',reason:'核对退货到账'});h.submit();assert.equal(h.writes,1);assert.equal(R.calculate(h.state,'2026-10').personal.expenseCents,7000);assert.equal(R.calculate(h.state,'2026-11').cash.incomeCents,3000);assert.equal(R.calculate(h.state,'2026-11').personal.incomeCents,0);h.click('refund','expense');h.picker('incomeId').pick('r2');h.fields({amount:'30.00',reason:'超出测试'});const before=JSON.stringify(h.state);h.submit();assert.match(h.errors.at(-1),/超过这笔实际到账/);assert.equal(JSON.stringify(h.state),before);h.fields({amount:'20.00'});h.submit();assert.equal(R.calculate(h.state).personal.expenseCents,5000);assert.equal(h.state.transactions.length,3);
});

test('refund plan is nonfinancial, editable, and a received allocation can reference it',()=>{
 const h=harness(fixture([transaction('expense'),transaction('r','income',3000,'2026-11-01')]));h.click('plan','expense');h.fields({amount:'50.00',dueDate:'2026-11-10',status:'waiting',note:'退货中'});h.submit();const p=h.state.bookkeeping.refundPlans[0];assert.equal(R.calculate(h.state).personal.expenseCents,10000);assert.equal(R.calculate(h.state).receivables.outstandingCents,0);h.click('edit-plan',p.id);h.fields({amount:'40.00',reason:'商家确认实际退款额'});h.submit();assert.equal(h.state.bookkeeping.refundPlans[0].expectedAmountCents,4000);h.click('refund','expense',{bkPlan:p.id});assert.equal(h.form.elements.namedItem('planId').value,p.id);h.picker('incomeId').pick('r');h.fields({amount:'30.00',reason:'部分到账'});h.submit();assert.equal(h.state.bookkeeping.refunds[0].planId,p.id);assert.equal(R.calculate(h.state).refundPlans[0].receiptStatus,'partial');h.click('tab','refunds');assert.match(h.html,/部分到账/);
});

test('claim statuses, partial receipts and personal-versus-cash totals work end to end',()=>{
 const h=harness(fixture([transaction('expense'),transaction('r1','income',3000,'2026-10-10'),transaction('r2','income',5000,'2026-10-12')]));h.click('claim','expense');h.fields({name:'朋友晚餐份额',amount:'80.00',kind:'advance',status:'incomplete',dueDate:'2026-10-15',note:'待朋友确认'});h.submit();let claim=h.state.bookkeeping.claims[0];assert.equal(R.calculate(h.state).personal.expenseCents,2000);assert.equal(R.calculate(h.state).receivables.outstandingCents,8000);assert.equal(R.calculate(h.state).cash.expenseCents,10000);h.click('edit-claim',claim.id);h.fields({status:'submitted',reason:'已发出凭证'});h.submit();assert.equal(h.state.bookkeeping.claims[0].status,'submitted');
 for(const [income,cents] of [['r1','30.00'],['r2','50.00']]){h.click('settle',claim.id);h.picker('incomeId').pick(income);h.fields({amount:cents,reason:'已核实到账'});h.submit();}assert.equal(R.calculate(h.state).receivables.outstandingCents,0);assert.equal(R.calculate(h.state).personal.incomeCents,0);assert.equal(h.state.transactions.length,3);h.click('tab','claims');assert.match(h.html,/已提交/);assert.match(h.html,/尚未收回/);
});

test('snapshots disclose real date difference and detect changed historical basis',()=>{
 const h=harness(fixture([transaction('expense')]));h.click('snapshot');h.fields({accountId:'account-cash',date:'2026-10-01',amount:'-90.00',note:'核对日终余额',confirmed:true});h.submit();const snap=h.state.bookkeeping.snapshots[0];assert.equal(R.reconciliation(h.state,snap.id).differenceCents,1000);assert.match(h.html,/存在差异/);assert.match(h.html,/实际 − 账本/);h.state.transactions.push(transaction('future','income',4000,'2026-11-01'));assert.equal(R.reconciliation(h.state,snap.id).changed,false);h.state.transactions.push(transaction('old','income',500,'2026-10-01'));h.ctx.render();assert.match(h.html,/账本依据已变化/);h.click('snapshot-details',snap.id);assert.doesNotMatch(h.ctx.$('#bk-modal-rows').innerHTML,/future/);assert.match(h.ctx.$('#bk-modal-rows').innerHTML,/old/);
});

test('dependency-aware unlink blocks a paid claim, then explicit unlink preserves every transaction',()=>{
 let s=fixture([transaction('expense'),transaction('income','income',3000,'2026-10-02')]);s=R.createClaim(s,{expenseId:'expense',amountCents:8000,name:'报销',kind:'reimbursement',status:'submitted'});const claim=s.bookkeeping.claims[0];s=R.settleClaim(s,{claimId:claim.id,incomeId:'income',amountCents:3000,reason:'到账'});const settled=s.bookkeeping.settlements[0];const h=harness(s);h.click('unlink',claim.id,{bkKind:'claim'});assert.match(h.modal,/还有 1 条依赖/);assert.match(h.modal,/type="submit" disabled/);h.fields({reason:'先试直接撤销'});h.submit();assert.match(h.errors.at(-1),/先撤销关联的回款或退款/);assert.equal(h.writes,0);h.click('unlink',settled.id,{bkKind:'settlement'});h.fields({reason:'撤销错误回款分配'});h.submit();h.click('unlink',claim.id,{bkKind:'claim'});h.fields({reason:'恢复自有消费'});h.submit();assert.equal(h.state.transactions.length,2);assert.equal(h.state.bookkeeping.claims.length,0);assert.equal(h.state.bookkeeping.audit.filter(a=>a.action==='unlink').length,2);assert.equal(R.calculate(h.state).personal.expenseCents,10000);
});

test('report metrics drill down to reconciled rows and current receivables use all dates',()=>{
 let s=fixture([transaction('expense','expense',10000,'2026-09-01'),transaction('income','income',3000,'2026-10-02')]);s=R.createClaim(s,{expenseId:'expense',amountCents:8000,name:'九月应收',kind:'advance',status:'unsubmitted'});const h=harness(s);const html=h.UI.reportSummary(h.ctx,'2026-10');assert.match(html,/¥80.00/);h.click('drilldown','receivables',{bkMonth:'2026-10'});assert.match(h.ctx.$('#bk-modal-rows').innerHTML,/九月应收/);h.click('drilldown','cash-income',{bkMonth:'2026-10'});assert.match(h.ctx.$('#bk-modal-rows').innerHTML,/income/);assert.doesNotMatch(h.ctx.$('#bk-modal-rows').innerHTML,/data-bk-id="expense"/);
});

test('transaction details display incoming refund allocations and preserved linked sources',()=>{
 let s=fixture([transaction('expense'),transaction('copy'),transaction('income','income',3000,'2026-10-02')]);s=R.linkEvidence(s,{primaryId:'expense',shadowId:'copy',reason:'同一付款凭证'});s=R.allocateRefund(s,{expenseId:'expense',incomeId:'income',amountCents:3000,reason:'已到账'});const h=harness(s);assert.match(h.UI.transactionDetails(h.ctx,'income'),/已分配退款<\/dt><dd>¥30.00/);assert.match(h.UI.transactionDetails(h.ctx,'copy'),/重复证据，不再计入任何金额/);assert.match(h.UI.transactionDetails(h.ctx,'expense'),/关联的完整交易证据/);assert.match(h.UI.transactionDetails(h.ctx,'expense'),/data-bk-action="unlink"/);
});

test('binding repeatedly registers only one document click handler',()=>{
 const h=harness(fixture([transaction('expense')]));h.UI.bind(h.ctx);h.UI.bind(h.ctx);h.click('plan','expense');h.fields({amount:'20.00',dueDate:'',status:'waiting',note:''});h.submit();assert.equal(h.writes,1);assert.equal(h.state.bookkeeping.refundPlans.length,1);
});
