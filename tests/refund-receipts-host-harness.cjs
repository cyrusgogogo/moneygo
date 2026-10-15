'use strict';
// Literal personal/demo entry scripts, real public financial writers and coordinator.
// Synthetic records only. VM/markup host is not native-browser, layout or AT evidence.
// Supported today()/now() capabilities are injected into the host context. The global
// Date constructor and allocator timestamps are never replaced or patched.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto'),vm=require('node:vm');
const ROOT=path.resolve(__dirname,'..'),{host}=require('./actual-entry-host.cjs');
const L=require('../dist/ledger.js'),R=require('../dist/relations.js'),O=require('../dist/obligations.js'),N=require('../dist/backup-safety.js');
const KEY=L.STORAGE_KEY,NOTE=N.NOTE_KEY,DAY='2026-10-14',NOW='2026-10-14T12:00:00.000Z';
const copy=x=>JSON.parse(JSON.stringify(x));
function fixture({plan=true,status='waiting',count=0,future=false,preExpense=false,reason='Synthetic receipt <svg onload=hostAttack()> & exact evidence 😀'}={}){
 let s=L.putAccount(L.createEmpty(),{name:'Synthetic refund cash',openingBalanceCents:100000},'account-cash');
 const ids={};const tx=(id,type,amountCents,date,note)=>{s=L.putTransaction(s,{type,amountCents,date,accountId:'account-cash',categoryId:type==='income'?'income-other':'expense-other',note:id+' '+note});ids[id]=s.transactions.at(-1).id;};
 tx('host-expense','expense',10000,'2026-09-30','Synthetic original purchase');
 tx('host-income','income',5000,'2026-10-10',reason);
 tx('host-income-other','income',4000,'2026-10-11','Synthetic different receipt');
 if(future)tx('host-future','income',7000,'2026-10-15','Synthetic future record');
 if(preExpense)tx('host-early','income',8000,'2026-09-29','Synthetic cross-source early posting');
 for(let i=0;i<count;i++)tx('host-income-page-'+String(i).padStart(3,'0'),'income',101+i,'2026-10-09','Synthetic searchable row '+String(i).padStart(3,'0'));
 s=O.putProfile(s,{accountId:'account-cash',role:'cash',creditLimitCents:null,note:'Synthetic recorded account role'},{confirmed:true,expectedRevision:0,reason:'Synthetic role confirmation'});
 if(plan)s=R.addRefundPlan(s,{expenseId:ids['host-expense'],expectedAmountCents:6000,dueDate:'2026-10-12',status,note:'Synthetic pending receipt expectation'});
 return {state:L.validateState(s),expenseId:ids['host-expense'],incomeId:ids['host-income'],otherIncomeId:ids['host-income-other'],ids,planId:plan?s.bookkeeping.refundPlans[0].id:null};
}
function app(options={}){
 const f=options.fixture||fixture(options.fixtureOptions),state=options.state||f.state,clock=options.clock||{day:DAY,now:NOW},calls={},events=[],sessions=[],writerCalls=[],saves=[],financial={};let a;
 const readClock={today:()=>{calls.today=(calls.today||0)+1;return typeof clock.day==='function'?clock.day():clock.day;},now:()=>{calls.now=(calls.now||0)+1;return typeof clock.now==='function'?clock.now():clock.now;}};
 const h=host(ROOT,{entry:options.personal===false?'demo.html':'index.html',personal:options.raw===undefined?{[KEY]:JSON.stringify(state),...(options.note===undefined?{}:{[NOTE]:options.note})}:{[KEY]:options.raw},setupStore:options.setupStore,beforeLoad:options.beforeLoad,
  afterScript(file,context,window,doc){
   if(file==='relations.js'){
    const real=window.MoneygoRelations;
    window.MoneygoRelations=Object.freeze({...real,allocateRefund(...args){writerCalls.push({args});const out=real.allocateRefund(...args);writerCalls.at(-1).out=out;return out;},calculate(...args){financial.calculate=(financial.calculate||0)+1;return real.calculate(...args);}});
   }
   if(file==='ledger.js'){
    const real=window.MoneygoLedger;
    window.MoneygoLedger=Object.freeze({...real,save(...args){const record={args,stateAtSave:vm.runInContext('state',context)};saves.push(record);try{const out=real.save(...args);record.out=out;return out;}catch(error){record.error=error;throw error;}}});
   }
   if(file==='refund-receipts.js'&&window.MoneygoRefundReceipts){
    const realAPI=window.MoneygoRefundReceipts;
    window.MoneygoRefundReceipts=Object.freeze({...realAPI,createCoordinator(capabilities){calls.createCoordinator=(calls.createCoordinator||0)+1;const real=realAPI.createCoordinator(capabilities),wrapped={};sessions.push(real);for(const name of Object.keys(real))wrapped[name]=(...args)=>{calls[name]=(calls[name]||0)+1;const record={name,args,real};events.push(record);try{record.out=real[name](...args);return record.out;}catch(error){record.error=error;throw error;}};return Object.freeze(wrapped);}});
   }
   options.afterScript?.(file,context,window,doc);
  },beforeScript(file,context,window,doc){if(file==='app-runtime-v1.js')for(const key of options.missing||[])delete window[key];options.beforeScript?.(file,context,window,doc);}});
 a=Object.assign(h,{fixture:f,clock,calls,events,sessions,writerCalls,saves,financial});assert.deepEqual(a.errors.map(e=>[e.file,e.message]),[],'Literal production scripts boot without error');assert.equal(a.run('active()'),true);
 a.put('__refundHostClock',readClock);a.run('globalThis.refundOriginalContext=bookkeepingContext;bookkeepingContext=()=>({...refundOriginalContext(),today:__refundHostClock.today,now:__refundHostClock.now})');
 if(options.personal===false){a.put('refundSeed',JSON.stringify(state));a.run('state=L.validateState(JSON.parse(refundSeed));savedRaw=JSON.stringify(state);storage.setItem(L.STORAGE_KEY,savedRaw)');}
 a.run('globalThis.refundStorageIO=[];globalThis.refundStorageBase=storage;globalThis.refundStorageFault=null;storage=Object.freeze({getItem(k){refundStorageIO.push(["get",k]);const answer=refundStorageFault?.("get",k);return answer&&Object.hasOwn(answer,"value")?answer.value:refundStorageBase.getItem(k);},setItem(k,v){refundStorageIO.push(["set",k,String(v)]);if(!refundStorageFault?.("set",k,String(v))?.skip)return refundStorageBase.setItem(k,v);},removeItem(k){refundStorageIO.push(["remove",k]);if(!refundStorageFault?.("remove",k)?.skip)return refundStorageBase.removeItem(k);}})');
 a.storageAcquisitions={localStorage:a.counters.localStorage,sessionStorage:a.counters.sessionStorage};
 a.fault=fn=>{if(a.entry==='index.html'){a.store.onGet=k=>fn?.('get',k);a.store.onSet=(k,v)=>fn?.('set',k,v);a.store.onRemove=k=>fn?.('remove',k);}else a.put('refundStorageFault',fn);};a.clearIO=()=>{a.run('refundStorageIO.length=0');a.counters.personalIO.length=0;};a.clearIO();for(const key of options.missingAfterBoot||[])delete a.window[key];
 if(options.open!==false)open(a);return a;
}
function click(a,selector){const n=typeof selector==='string'?a.node(selector):selector;assert.ok(n,'Rendered '+selector);assert.equal(n.disabled,false,'Enabled '+selector);n.click();return n;}
function field(a,selector,value,event='change'){const n=typeof selector==='string'?a.node(selector):selector;assert.ok(n,'Field '+selector);if(typeof value==='boolean')n.checked=value;else n.value=value;n.dispatch(event);return n;}
function fill(form,values){assert.ok(form,'Draft form is mounted');for(const [name,value]of Object.entries(values)){const n=form.elements.namedItem(name);assert.ok(n,'Field '+name);if(typeof value==='boolean')n.checked=value;else n.value=value;}return form;}
function action(a,name,id=null,planId=undefined){return a.doc.querySelectorAll('[data-bk-action]').find(n=>n.dataset.bkAction===name&&(id===null||n.dataset.bkId===id)&&(planId===undefined||n.dataset.bkPlan===planId));}
function open(a){click(a,'[data-page="bookkeeping"]');click(a,action(a,'tab','refunds'));return a;}
function picker(a,name){const root=a.node('[data-bk-picker="'+name+'"]');assert.ok(root,'Picker '+name);return {root,search(q){field(a,root.querySelector('[data-bk-search]'),q,'input');},next(){click(a,root.querySelector('[data-bk-pick-next]'));},pick(id){const node=root.querySelectorAll('[data-bk-pick-id]').find(n=>n.dataset.bkPickId===id);click(a,node);},get count(){return root.querySelector('[data-bk-pick-count]')?.textContent;}};}
function draft(a,{route='manual',expenseId=a.fixture.expenseId,incomeId=a.fixture.incomeId,planId=null,amount='30.00',reason='Explicit synthetic exact refund review'}={}){
 if(route==='detail'){a.run('entry("'+expenseId+'")');click(a,a.node('#modal-root').querySelectorAll('[data-bk-action]').find(n=>n.dataset.bkAction==='refund'&&n.dataset.bkId===expenseId));}
 else if(route==='candidate')click(a,action(a,'refund-candidates',expenseId,planId||a.fixture.planId));
 else if(route==='plan')click(a,action(a,'refund',expenseId,planId||a.fixture.planId));
 else click(a,a.doc.querySelectorAll('[data-bk-action="refund"]').find(n=>!n.dataset.bkId));
 let form=a.node('#entry-form');assert.ok(form);if(form.elements.namedItem('expenseId').value!==expenseId){const p=picker(a,'expenseId');p.search(expenseId);p.pick(expenseId);}
 form=a.node('#entry-form');if(form.elements.namedItem('incomeId').value!==incomeId){const p=picker(a,'incomeId');p.search(incomeId);p.pick(incomeId);}
 form=a.node('#entry-form');fill(form,{amount,reason});if(planId!==null)fill(form,{planId});return a;
}
function preview(a){const form=a.node('#entry-form');assert.ok(form);form.dispatch('submit');assert.ok(a.node('#refund-confirm'),a.node('#form-error')?.textContent);return a;}
function consent(a,value=true){field(a,a.node('#entry-form')?.elements.namedItem('confirmed'),value);return a;}
function confirm(a){consent(a);assert.equal(a.node('#refund-confirm').disabled,false);submitReview(a);return a;}
function submitReview(a){const form=a.node('#entry-form');assert.ok(form);form.dispatch('submit');return a;}
const ready=(options={})=>preview(draft(app(options),{route:options.route||'manual'}));
const latest=(a,name)=>a.events.filter(e=>e.name===name).at(-1);
const current=(a,event=latest(a,'preview'))=>event?event.real.isCurrent(a.run('state'),event.out):false;
const io=(a,op,key)=>(a.entry==='index.html'?copy(a.counters.personalIO):a.value('refundStorageIO')).filter(row=>(!op||row[0]===op)&&(!key||row[1]===key));
function snapshot(a){return {state:a.run('JSON.stringify(state)'),savedRaw:a.run('savedRaw'),stored:a.run('refundStorageBase.getItem(L.STORAGE_KEY)'),balances:a.value('L.balances(state)'),finance:a.value('L.financialView(state)')};}
function quiet(a,before){assert.deepEqual(io(a,'set'),[],'No storage write before explicit save');assert.deepEqual(io(a,'remove'),[]);if(before)assert.deepEqual(snapshot(a),before);assert.deepEqual(a.counters.forbidden,[]);assert.deepEqual({localStorage:a.counters.localStorage,sessionStorage:a.counters.sessionStorage},a.storageAcquisitions);if(a.entry==='demo.html'){assert.equal(a.counters.localStorage,0);assert.equal(a.counters.sessionStorage,0);assert.deepEqual(a.counters.personalIO,[]);}}
function retained(a){const form=a.node('#entry-form'),button=a.node('#refund-confirm');assert.ok(form);assert.ok(button);return {form,button,submit:form.onsubmit,click:button.onclick,consent:form.elements.namedItem('confirmed'),ticket:latest(a,'preview')};}
function staleCallbacks(a,old){const before={commits:a.calls.commit||0,writes:io(a,'set',KEY).length};old.consent.checked=true;old.submit?.call(old.form,{preventDefault(){}});old.click?.call(old.button,{preventDefault(){}});old.form.dispatch('submit');old.button.dispatch('click');assert.equal(a.calls.commit||0,before.commits,'Detached callback cannot re-enter commit');assert.equal(io(a,'set',KEY).length,before.writes,'Detached callback cannot persist');}
const quota=()=>Object.assign(Error('Synthetic storage quota rejection'),{name:'QuotaExceededError'}),denied=()=>Object.assign(Error('Synthetic storage denied'),{name:'SecurityError'});
function hashes(a){return{entry:a.entry,htmlSha256:crypto.createHash('sha256').update(a.html).digest('hex'),scripts:a.hashes};}
module.exports={ROOT,L,R,O,N,KEY,NOTE,DAY,NOW,copy,fixture,app,open,click,field,fill,action,picker,draft,preview,consent,confirm,submitReview,ready,latest,current,io,snapshot,quiet,retained,staleCallbacks,quota,denied,hashes};
