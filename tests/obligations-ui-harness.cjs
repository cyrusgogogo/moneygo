'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const modelDir = path.resolve(__dirname, '../dist');
const L = require(path.join(modelDir, 'ledger.js')), R = require(path.join(modelDir, 'relations.js')), O = require(path.join(modelDir, 'obligations.js'));
const uiPath = path.join(__dirname, '../dist/obligations-ui.js');
const money = n => `${n < 0 ? '−' : ''}¥${Math.floor(Math.abs(n) / 100)}.${String(Math.abs(n) % 100).padStart(2, '0')}`;
const amountText = n => `${n < 0 ? '-' : ''}${Math.floor(Math.abs(n) / 100)}.${String(Math.abs(n) % 100).padStart(2, '0')}`;
const tx = (id, type, amountCents, date, extra = {}) => ({ id, type, amountCents, date, accountId: 'account-cash', categoryId: type === 'income' ? 'income-other' : 'expense-food', note: id, ...extra });
function fixture(rows = []) { const s = L.createEmpty(); s.accounts.push({ id: 'credit', name: '信用卡', openingBalanceCents: 0 }, { id: 'bank', name: '银行', openingBalanceCents: 100000 }); s.transactions = rows; return s; }
const review = state => ({ confirmed: true, expectedRevision: state.obligations?.revision || 0, reason: '对照明确来源核对' });
function credit(state = fixture()) { return O.putProfile(state, { accountId: 'credit', role: 'credit', creditLimitCents: null, note: '' }, review(state)); }
function bill(state, overrides = {}) { return O.putStatement(state, { accountId: 'credit', provenance: 'official', periodStart: '2026-09-01', periodEnd: '2026-09-30', statementDate: '2026-10-01', dueDate: '2026-10-20', amountCents: 10000, source: '用户保存的机构账单', note: '', ...overrides }, review(state)); }
const decode = s => (s || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attr = (s, name) => { const m = s.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"')); return m ? decode(m[1]) : ''; };
// Deterministic VM/DOM substitute: exercises generated forms and delegated events.
// Not a browser: layout, native validation, screen-reader behavior and focus trap remain unverified.
function harness(initial = fixture(), options = {}) {
 let state = initial, writes = 0, html = '', modal = '', title = '', errors = [], form = null, failWrite = false, staleStorage = false, confirm = true;
 const nodes = new Map(), listeners = new Map();
 function node() { const children = new Map(); return { value: '', checked: false, disabled: false, textContent: '', innerHTML: '', dataset: {}, focus(){}, addEventListener(){}, querySelector(s){ if(!children.has(s))children.set(s,node());return children.get(s); } }; }
 function field(tag, attrs, body) { const n = node(); n.value = attr(attrs, 'value'); n.checked = /\schecked(?:\s|$)/.test(attrs); if(tag==='textarea')n.value=decode(body); if(tag==='select'){const opts=[...body.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)], chosen=opts.find(o=>/\sselected(?:\s|$)/.test(o[1]))||opts[0];n.value=chosen?attr(chosen[1],'value'):'';} return n; }
 function parse(body) { const f=node(), fields=new Map(); for(const x of body.matchAll(/<input\b([^>]*)>|<(select|textarea)\b([^>]*)>([\s\S]*?)<\/\2>/g)){const attrs=x[1]===undefined?x[3]:x[1], name=attr(attrs,'name');if(name)fields.set(name,field(x[2]||'input',attrs,x[4]||''));} f.elements={namedItem:name=>fields.get(name)};f.reportValidity=()=>true;return f; }
 const document={addEventListener(type,fn){const list=listeners.get(type)||[];list.push(fn);listeners.set(type,list);}}, window={document,confirm:()=>confirm};
 vm.runInNewContext(fs.readFileSync(uiPath,'utf8'),{window,console});const UI=window.MoneygoObligationsUI;
 // Model deliberately accepts only same-realm plain records; bridge serialized VM inputs like real same-realm calls.
 const bridged=Object.fromEntries(Object.entries(O).map(([k,v])=>[k,typeof v==='function'? (...args)=>v(...args.map(a=>a===undefined?undefined:JSON.parse(JSON.stringify(a)))) : v]));
 const ctx={getState:()=>state,engine:options.engine||bridged,relations:R,ledger:L,money,amountText,accountName:id=>state.accounts.find(a=>a.id===id)?.name||'未知账户',categoryName:id=>state.categories.find(c=>c.id===id)?.name||'',today:()=>options.asOf||'2026-10-14',cancel:'<button type="button" data-close>取消</button>',
  $(s){if(s==='#entry-form')return form;if(!nodes.has(s))nodes.set(s,node());return nodes.get(s);},
  modal(t,body,buttons,ready){title=t;modal=body+(buttons||'');form=body.includes('id="entry-form"')?parse(body):null;ready?.();}, closeModal(){form=null;modal='';},error(m){errors.push(m);},
  change(fn){try{const next=fn();if(failWrite)throw Error('存储写入失败，未保存。');if(staleStorage)throw Error('另一个页面已修改账本，请刷新。');state=L.validateState(next);writes++;ctx.closeModal();ctx.render();return true;}catch(e){errors.push(e.message);return false;}},
  render(){html=UI.render(ctx);UI.bind(ctx);}
 };ctx.render();
 return {ctx,UI,get state(){return state;},set state(s){state=s;},get html(){return html;},get modal(){return modal;},get title(){return title;},get form(){return form;},get writes(){return writes;},get errors(){return errors;},get listeners(){return listeners;},set failWrite(v){failWrite=v;},set staleStorage(v){staleStorage=v;},set confirm(v){confirm=v;},
 click(action,id,extra={}){for(const fn of listeners.get('click')||[])fn({target:{closest(){return {dataset:{obAction:action,obId:id,...extra},disabled:false};}}});},
 fields(values){for(const [key,value] of Object.entries(values)){const n=form?.elements.namedItem(key);assert.ok(n,'field exists: '+key);if(typeof value==='boolean')n.checked=value;else n.value=value;}},submit(){assert.ok(form,'form is open');form.onsubmit({preventDefault(){}});},approve(reason='用户逐项核对后确认'){this.fields({reason,confirmed:true});this.submit();},action(selector){ctx.$(selector).onclick();}
 };
}
module.exports={L,R,O,modelDir,uiPath,money,amountText,tx,fixture,review,credit,bill,harness};
