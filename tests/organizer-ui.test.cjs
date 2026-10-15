'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dist = path.join(__dirname, '../dist');
const local = file => path.join(dist, file);
const L = require(path.join(dist, 'ledger.js')), R = require(path.join(dist, 'relations.js'));
const sandbox = { window: { MoneygoRelations: R }, TextEncoder }; vm.runInNewContext(fs.readFileSync(local('personal-events.js'), 'utf8'), sandbox); vm.runInNewContext(fs.readFileSync(local('organizer.js'), 'utf8'), sandbox); const O = sandbox.window.MoneygoOrganizer;
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
  vm.runInNewContext(fs.readFileSync(local('organizer-ui.js'), 'utf8'), { window, console }); const UI = window.MoneygoOrganizerUI;
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

test('workspace is local-only and rendering does not change state',()=>{
 const h=harness(); assert.equal(h.writes,0); assert.equal(h.state.organizer,undefined); assert.match(h.html,/优先核对/); assert.match(h.html,/未知覆盖不等于零消费/); assert.ok(Object.isFrozen(h.UI));
 const source=fs.readFileSync(local('organizer-ui.js'),'utf8'); assert.doesNotMatch(source,/\bfetch\s*\(|XMLHttpRequest|localStorage|setInterval|setTimeout|Notification|https?:\/\/|\beval\s*\(|new Function/);
 for(const tab of ['rules','aliases','scope','closes','history','review']) { h.click('tab',tab); assert.doesNotMatch(h.html,/暂时无法读取/); } assert.equal(h.writes,0);
});
test('rule editor uses exact integer cents and preserves matching whitespace',()=>{
 const h=harness(fixture([transaction('a')])); h.click('edit-rule'); h.fields({name:'精确规则',operator:'equals',noteValue:' Coffee a ',caseSensitive:true,type:'expense',categoryId:'expense-other',minAmount:'0.01',maxAmount:'100.01',reason:'已核对'}); h.submit(); assert.equal(h.writes,1); const r=h.state.organizer.rules[0]; assert.equal(r.conditions.minAmountCents,1); assert.equal(r.conditions.maxAmountCents,10001); assert.equal(r.conditions.note.value,' Coffee a '); assert.equal(r.conditions.note.caseSensitive,true); assert.equal(h.state.transactions[0].categoryId,'expense-food');
});
test('invalid rule money and missing category fail without partial changes',()=>{
 const h=harness();h.click('edit-rule');h.fields({name:'规则',noteValue:'Coffee',categoryId:'expense-other',minAmount:'1.001',reason:'测试'});h.submit();assert.equal(h.writes,0);assert.match(h.errors.at(-1),/两位小数/);h.fields({minAmount:'',categoryId:''});h.submit();assert.match(h.errors.at(-1),/目标分类/);assert.equal(h.writes,0);
});
test('editing a rule updates its identity; removal needs confirmation and does not change transactions',()=>{
 const h=harness(addRule(fixture([transaction('a')]))), id=h.state.organizer.rules[0].id;h.click('edit-rule',id);h.fields({name:'新名称',reason:'更清楚'});h.submit();assert.equal(h.state.organizer.rules[0].id,id);assert.equal(h.state.organizer.rules[0].name,'新名称');h.click('remove-rule',id);h.fields({reason:'不再使用'});h.submit();assert.equal(h.writes,1);h.fields({confirmed:true});h.submit();assert.equal(h.state.organizer.rules.length,0);assert.equal(h.state.transactions[0].categoryId,'expense-food');
});
test('preview starts unselected and applies only explicit selected transaction',()=>{
 const h=harness(addRule(fixture([transaction('a'),transaction('b')])));h.click('preview-rules');assert.match(h.ctx.$('#org-preview-status').textContent,/已选 0 笔/);assert.doesNotMatch(h.ctx.$('#org-preview-rows').innerHTML,/data-org-pick="a"[^>]*checked/);h.fields({reason:'逐笔确认',confirmed:true});h.submit();assert.equal(h.writes,0);h.pick('a');h.submit();assert.equal(h.writes,1);assert.equal(h.state.transactions[0].categoryId,'expense-other');assert.equal(h.state.transactions[1].categoryId,'expense-food');assert.equal(h.state.transactions[0].amountCents,10001);assert.equal(h.state.transactions[0].note,'Coffee a');
});
test('conflicting matches are disabled until explicit complete precedence is submitted',()=>{
 let s=addRule(fixture([transaction('a')]),{name:'分类甲'});s=addRule(s,{name:'分类乙',actions:{categoryId:'expense-food',merchant:'Special'}});const h=harness(s);h.click('preview-rules');assert.match(h.ctx.$('#org-preview-rows').innerHTML,/冲突未解决/);h.pick('a');assert.match(h.ctx.$('#org-preview-status').textContent,/已选 0 笔/);h.fields({'order-0':'2','order-1':'1'});h.button('org-preview-refresh');assert.match(h.ctx.$('#org-preview-rows').innerHTML,/冲突已按明确顺序解决/);h.pick('a');h.fields({reason:'明确采用第二条',confirmed:true});h.submit();assert.equal(h.writes,1);assert.equal(O.rawView(h.state,'a').merchant,'Special');
});
test('priority changes require a new preview and duplicate priorities are rejected',()=>{
 let s=addRule(fixture([transaction('a')]));s=addRule(s,{name:'另一个规则'});const h=harness(s);h.click('preview-rules');h.pick('a');h.fields({'order-0':'2',reason:'改顺序',confirmed:true});h.submit();assert.match(h.errors.at(-1),/先重新预览/);h.button('org-preview-refresh');assert.match(h.errors.at(-1),/不重复/);assert.equal(h.writes,0);
});
test('preview paging and search preserve selections; page selection is explicit',()=>{
 const rows=Array.from({length:67},(_,i)=>transaction('row-'+String(i).padStart(3,'0'))),h=harness(addRule(fixture(rows)));h.click('preview-rules');assert.match(h.ctx.$('#org-preview-count').textContent,/1–25 \/ 67/);h.pick('row-000');h.button('org-preview-next');h.button('org-preview-next');assert.match(h.ctx.$('#org-preview-rows').innerHTML,/row-066/);h.pick('row-066');h.search('row-001');assert.match(h.ctx.$('#org-preview-status').textContent,/已选 2 笔/);h.button('org-preview-select-page');assert.match(h.ctx.$('#org-preview-status').textContent,/已选 3 笔/);h.search('');h.fields({reason:'分批核对',confirmed:true});h.submit();assert.equal(h.state.organizer.batches[0].changes.length,3);assert.equal(h.state.transactions[2].categoryId,'expense-food');
});
test('whole-state stale previews cannot apply; refresh clears prior selection and confirmation',()=>{
 const h=harness(addRule(fixture([transaction('a')])));h.click('preview-rules');h.pick('a');h.fields({reason:'确认',confirmed:true});h.state={...h.state,accounts:h.state.accounts.map(a=>({...a,name:a.name+'新'}))};h.submit();assert.equal(h.writes,0);assert.match(h.errors.at(-1),/账本已变化/);h.button('org-preview-refresh');assert.match(h.ctx.$('#org-preview-status').textContent,/已选 0 笔/);assert.equal(h.form.elements.namedItem('confirmed').checked,false);
});
test('exact merchant aliases preserve original note and evidence with raw drilldown',()=>{
 const h=harness(fixture([transaction('a',{note:' Coffee a '})]));h.click('edit-alias');h.fields({from:' Coffee a ',to:'统一店铺',reason:'核对全称'});h.submit();assert.equal(h.state.organizer.aliases[0].from,' Coffee a ');h.click('preview-aliases');h.pick('a');h.fields({reason:'确认别名',confirmed:true});h.submit();assert.equal(h.state.transactions[0].note,' Coffee a ');assert.equal(O.rawView(h.state,'a').merchant,'统一店铺');h.click('tab','aliases');assert.match(h.html,/商户分组与原始流水/);h.click('merchant-group',null,{orgMerchant:'统一店铺',orgType:'expense'});assert.match(h.ctx.$('#org-merchant-rows').innerHTML,/ Coffee a /);assert.match(h.ctx.$('#org-merchant-rows').innerHTML,/原始备注/);
});
test('rollback requires confirmation and restores full batch atomically',()=>{
 let s=addRule(fixture([transaction('a'),transaction('b')]));s=O.applyPreview(s,O.previewRules(s),{transactionIds:['a','b'],reason:'确认'});const h=harness(s),id=s.organizer.batches[0].id;h.click('rollback',id);h.fields({reason:'错误归类'});h.submit();assert.equal(h.writes,0);h.fields({confirmed:true});h.submit();assert.equal(h.writes,1);assert.ok(h.state.transactions.every(t=>t.categoryId==='expense-food'));assert.equal(h.state.organizer.batches[0].rolledBack,true);
});
test('rollback conflict preserves every newer and unaffected change',()=>{
 let s=addRule(fixture([transaction('a'),transaction('b')]));s=O.applyPreview(s,O.previewRules(s),{transactionIds:['a','b'],reason:'确认'});s.transactions[1].note='后来编辑';const h=harness(s),before=JSON.stringify(s);h.click('rollback',s.organizer.batches[0].id);h.fields({reason:'请求撤销',confirmed:true});h.submit();assert.equal(h.writes,0);assert.equal(JSON.stringify(h.state),before);assert.match(h.errors.at(-1),/后续操作/);
});
test('scope includes no implicit choice, requires confirmation, and unknown coverage stays unknown',()=>{
 const h=harness();h.click('tab','scope');assert.match(h.html,/尚未声明来源范围/);assert.match(h.html,/尚未核验/);h.click('set-scope');assert.equal(h.form.elements.namedItem('included').value,'');h.fields({sourceKey:'bank-export',accountId:'account-cash',reason:'这是我的资金账户'});h.submit();assert.equal(h.writes,0);h.fields({included:'true',confirmed:true});h.submit();assert.equal(h.state.organizer.scopes[0].included,true);assert.match(h.html,/覆盖未知/);assert.match(h.html,/2026-10-01 至 2026-10-31/);assert.doesNotMatch(h.html,/区间已覆盖/);
});
test('scope exclusion is explicit and does not silently remove ledger transactions',()=>{
 const h=harness(fixture([transaction('a')]));h.click('set-scope');h.fields({sourceKey:'other-source',accountId:'account-cash',included:'false',reason:'已明确不纳入观察范围',confirmed:true});h.submit();assert.equal(h.state.transactions.length,1);assert.equal(h.state.organizer.scopes[0].included,false);h.click('tab','scope');assert.match(h.html,/确认排除/);assert.match(h.html,/已排除范围/);
});
test('review queue shows upper-bound meaning and user can defer then restore',()=>{
 const h=harness(fixture([transaction('a'),transaction('b')]));assert.match(h.html,/可能重复计入的上限/);assert.match(h.html,/¥100.01/);h.click('set-review','duplicate:a');h.fields({rank:'0',deferUntil:'2026-10-20',reason:'周末核对'});h.submit();assert.equal(h.writes,1);assert.match(h.html,/显示已延后项目（1）/);assert.doesNotMatch(h.html,/data-org-id="duplicate:a"/);const node=h.ctx.$('#org-show-deferred');node.checked=true;node.onchange();assert.match(h.html,/已延后至 2026-10-20/);h.click('set-review','duplicate:a');h.fields({rank:'',deferUntil:'',reason:'现在核对'});h.submit();assert.equal(h.state.organizer.reviews[0].rank,null);assert.equal(h.state.organizer.reviews[0].deferUntil,null);
});
test('monthly close needs all checks, keeps immutable original, and compares exact deltas',()=>{
 const h=harness(fixture([transaction('a')]));h.click('tab','closes');h.click('close-month');h.fields({reason:'保留当时账目',confirmed:true});h.submit();assert.equal(h.writes,0);h.fields({transactionsChecked:true,coverageChecked:true});h.submit();assert.equal(h.writes,1);const id=h.state.organizer.closes[0].id, frozen=JSON.stringify(h.state.organizer.closes[0]);h.state.transactions.push(transaction('b',{amountCents:1,date:'2026-10-13'}));h.click('compare-close',id);assert.match(h.modal,/当前与封存存在差异/);assert.match(h.ctx.$('#org-compare-rows').innerHTML,/新增记录/);assert.match(h.modal,/¥0.01/);assert.equal(JSON.stringify(h.state.organizer.closes[0]),frozen);
});
test('monthly close detects changes made after confirmation view opened',()=>{
 const h=harness(fixture([transaction('a')]));h.click('close-month');h.fields({reason:'检查后保存',transactionsChecked:true,coverageChecked:true,confirmed:true});h.state.transactions.push(transaction('b'));h.submit();assert.equal(h.writes,0);assert.match(h.errors.at(-1),/封存检查后已变化/);
});
test('all user-controlled notes, names and rule fields are escaped',()=>{
 const attack='<img src=x onerror="boom()">';let s=addRule(fixture([transaction('a',{note:attack})]),{name:attack,conditions:{note:{operator:'equals',value:attack,caseSensitive:false}}});s.accounts[0].name=attack;const h=harness(s);h.click('tab','rules');assert.doesNotMatch(h.html,/<img src=x/);assert.match(h.html,/&lt;img/);h.click('preview-rules');assert.doesNotMatch(h.ctx.$('#org-preview-rows').innerHTML,/<img src=x/);assert.match(h.ctx.$('#org-preview-rows').innerHTML,/&quot;boom/);assert.doesNotMatch(h.UI.transactionDetails(h.ctx,'a'),/<img src=x/);
});
test('repeated binding has one document handler, cancellation discards no state',()=>{
 const h=harness();h.UI.bind(h.ctx);h.UI.bind(h.ctx);assert.equal(h.handlerCount(),1);h.click('edit-rule');h.fields({name:'尚未保存'});h.setConfirm(false);h.click('edit-alias');assert.equal(h.title,'新增分类规则');assert.equal(h.writes,0);h.ctx.closeModal();assert.equal(h.state.organizer,undefined);
});
test('failed persistence leaves original ledger and lets user re-preview',()=>{
 const h=harness(addRule(fixture([transaction('a')])),{failPersist:true});h.click('preview-rules');h.pick('a');h.fields({reason:'保存测试',confirmed:true});h.submit();assert.equal(h.writes,0);assert.equal(h.state.transactions[0].categoryId,'expense-food');assert.equal(h.form.dataset.submitted,'false');assert.match(h.errors.at(-1),/存储失败/);h.button('org-preview-refresh');assert.equal(h.form.elements.namedItem('confirmed').checked,false);
});

test('rule editor supports source/account/amount-only conditions without forcing a note',()=>{
 const h=harness();h.click('edit-rule');h.fields({name:'现金支出',operator:'',noteValue:'',accountId:'account-cash',type:'expense',minAmount:'0.29',categoryId:'expense-other',reason:'按账户范围整理'});h.submit();assert.equal(h.writes,1);assert.equal(h.state.organizer.rules[0].conditions.note,undefined);assert.equal(h.state.organizer.rules[0].conditions.minAmountCents,29);h.click('edit-rule',h.state.organizer.rules[0].id);assert.equal(h.form.elements.namedItem('operator').value,'');
});
test('inline scope component discloses bounded dates, unknowns and the organizer route',()=>{
 const h=harness();const html=h.UI.scopeSummaryFor(h.ctx,'2026-09-01','2026-10-14');assert.match(html,/2026-09-01 至 2026-10-14/);assert.match(html,/日期覆盖仍有缺口或未知/);assert.match(html,/data-page="organizer"/);assert.match(html,/不会因此自动通过审计/);assert.equal(h.writes,0);
});
test('confirmed calendar coverage with a quarantined row never claims all records complete',()=>{
 const I=require(path.join(dist,'importer.js'));const initial=fixture();
 const preview=I.preview(initial,'date,amount\n2026-10-01,0.29\n2026-10-02,bad',{sourceKey:'bank-export',accountId:'account-cash',delimiter:',',columns:{date:'date',amount:'amount'},defaultType:'expense',coverage:{start:'2026-10-01',end:'2026-10-31',confirmed:true}});
 let state=I.commit(initial,preview,preview.rows.filter(r=>r.action==='new').map(r=>r.key));state=O.setScope(state,{sourceKey:'bank-export',accountId:'account-cash',included:true,confirmed:true,reason:'完整导出区间'});const h=harness(state);h.click('tab','scope');assert.match(h.html,/日期覆盖已确认，仍有待处理行/);assert.match(h.html,/1 行待处理/);assert.doesNotMatch(h.html,/日期覆盖齐全，已无待处理行/);const compact=h.UI.scopeSummaryFor(h.ctx,'2026-10-01','2026-10-31');assert.match(compact,/日期覆盖已确认/);assert.match(compact,/1 行待处理/);assert.equal(O.scopeReport(state,{start:'2026-10-01',end:'2026-10-31'}).complete,false);
});
test('balance freshness distinguishes recorded snapshots from reconciled snapshots',()=>{
 let state=R.addSnapshot(fixture([transaction('a')]),{accountId:'account-cash',date:'2026-10-01',actualBalanceCents:-10000,note:'差一分'});const h=harness(state);h.click('tab','scope');assert.match(h.html,/最近快照日期：2026-10-01/);assert.match(h.html,/当前同日重算不一致/);assert.match(h.html,/核验一致日期：未知/);assert.match(h.html,/¥0.01/);
});
test('mismatched category directions stay unselectable and cannot be forced by a checkbox',()=>{
 const h=harness(addRule(fixture([transaction('a')]),{actions:{categoryId:'income-other'}}));h.click('preview-rules');assert.match(h.ctx.$('#org-preview-rows').innerHTML,/分类与交易方向不符/);h.pick('a');h.fields({reason:'不能强制',confirmed:true});h.submit();assert.equal(h.writes,0);assert.match(h.errors.at(-1),/至少选择一笔/);
});

test('preview resource limit keeps subset controls reachable and permits explicit retry',()=>{
 let s=addRule(fixture([transaction('a')]));s=addRule(s,{name:'Second rule'});const h=harness(s),original=h.ctx.engine;
 h.ctx.engine={...original,previewRules(state,options){if(!options||options.ruleIds.length>1){const e=new Error('预览超过资源上限');e.code='PREVIEW_LIMIT';throw e;}return original.previewRules(state,options);}};
 h.click('preview-rules');assert.match(h.modal,/org-detail" open/);assert.match(h.ctx.$('#org-preview-status').textContent,/预览超过资源上限/);assert.ok(h.form.elements.namedItem('use-1'));h.fields({reason:'Must narrow first',confirmed:true});h.submit();assert.equal(h.writes,0);
 h.fields({'use-1':false});h.button('org-preview-refresh');assert.doesNotMatch(h.ctx.$('#org-preview-status').textContent,/资源上限/);h.pick('a');h.fields({reason:'Explicit reduced subset',confirmed:true});h.submit();assert.equal(h.writes,1);assert.equal(h.state.organizer.batches[0].changes.length,1);
});
