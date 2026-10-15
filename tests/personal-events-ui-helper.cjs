'use strict';
const path=require('node:path');
const assert=require('node:assert/strict');
const {host}=require('./actual-entry-host.cjs');
const L=require('../dist/ledger.js'),R=require('../dist/relations.js'),S=require('../dist/scenario.js');
const root=path.resolve(__dirname,'..'),KEY=L.STORAGE_KEY;
const LONG_ID='transaction-expense-'+ 'x'.repeat(80);
const ATTACK='<img src=x onerror="routeAttack()"> & \'quoted\'';
const clone=value=>JSON.parse(JSON.stringify(value));
function transaction(id,type,amountCents,date,accountId='account-cash',categoryId=type==='expense'?'expense-food':'income-other',note=id){return {id,type,amountCents,date,accountId,categoryId,note};}
function fixture(){
 let s=L.createEmpty();s.accounts.push({id:'bank',name:'Bank <safe>',openingBalanceCents:100000});s.categories.push({id:'expense-zero',type:'expense',name:'Zero <safe>'});
 s.transactions=[
 transaction('z-tie','expense',100,'2026-10-20','account-cash','expense-food',ATTACK),
 transaction('a-tie','expense',200,'2026-10-20','bank'),
 transaction(LONG_ID,'expense',300,'2026-10-20','account-cash','expense-other'),
 transaction('transaction-expense-x','expense',400,'2026-10-20'),
 transaction('recognition-future','expense',500,'2026-10-20'),
 transaction('sixth','expense',600,'2026-10-20'),
 transaction('zero-buy','expense',700,'2026-10-10','account-cash','expense-zero'),
 transaction('zero-refund','income',700,'2026-11-01','bank'),
 transaction('out','expense',1000,'2026-10-09','bank','expense-other'),
 transaction('in','income',1000,'2026-10-11'),
 transaction('funding','expense',3000,'2026-10-07','bank','expense-zero'),
 transaction('part-oct','expense',2000,'2026-10-08'),
 transaction('part-sep','expense',1000,'2026-09-30'),
 transaction('shadow','expense',100,'2026-10-21','account-cash','expense-zero'),
 transaction('salary','income',5000,'2026-10-13','bank','income-salary'),
 transaction('salary-shadow','income',5000,'2026-10-15','bank'),
 {...transaction('native','transfer',900,'2026-10-16','bank',null),toAccountId:'account-cash'},
 transaction('sept-buy','expense',1200,'2026-09-15','bank'),
 transaction('refund','income',200,'2026-10-02','bank'),
 transaction('claim-buy','expense',1200,'2026-10-05','account-cash','expense-other'),
 transaction('settle','income',400,'2026-10-14','bank')
 ];
 s=L.validateState(s);
 s=R.linkEvidence(s,{primaryId:'z-tie',shadowId:'shadow',reason:'Synthetic duplicate expense'});
 s=R.linkEvidence(s,{primaryId:'salary',shadowId:'salary-shadow',reason:'Synthetic duplicate income'});
 s=R.pairTransfer(s,{expenseId:'out',incomeId:'in',reason:'Synthetic own transfer'});
 const input={name:'Synthetic cross-month purchase',personalIds:['part-sep','part-oct'],fundingIds:['funding'],paidCents:3000,grossCents:null,discountCents:null};
 s=R.createComposite(s,R.previewComposite(s,input),{confirmed:true,reason:'Synthetic explicit roles'});
 s=R.allocateRefund(s,{expenseId:'zero-buy',incomeId:'zero-refund',amountCents:700,reason:'Synthetic complete refund'});
 s=R.allocateRefund(s,{expenseId:'sept-buy',incomeId:'refund',amountCents:200,reason:'Synthetic late refund'});
 s=R.createClaim(s,{expenseId:'claim-buy',amountCents:300,name:'Synthetic share',kind:'advance'});
 s=R.settleClaim(s,{claimId:s.bookkeeping.claims[0].id,incomeId:'settle',amountCents:200,reason:'Synthetic partial receipt'});
 s.simulation=S.defaultSettings();s.simulation.completeMonths=['2026-08','2026-09','2026-10'];
 s.simulation.exclusions=['shadow','part-sep','missing-retained'];
 return L.validateState(s);
}
class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-11-02T12:00:00.000Z']));}static now(){return new Date('2026-11-02T12:00:00.000Z').getTime();}}
function app(mode='personal',state=fixture(),options={}){
 const personal=mode==='personal'?{[KEY]:JSON.stringify(state)}:undefined;
 const a=host(root,{entry:mode==='personal'?'index.html':'demo.html',personal,globals:{Date:FixedDate},...options});
 if(options.noReady)return a;
 assert.deepEqual(a.errors.map(e=>[e.file,e.message]),[]);
 assert.equal(a.run('active()'),true);
 if(mode==='synthetic'){
  a.put('fixtureText',JSON.stringify(state));
  a.run('state=L.validateState(JSON.parse(fixtureText));savedRaw=JSON.stringify(state);storage.setItem(L.STORAGE_KEY,savedRaw)');
 }
 a.run("month='2026-10';page='report';render();globalThis.eventUIWrites=[];globalThis.eventUIStorage=storage;storage=Object.freeze({getItem:key=>eventUIStorage.getItem(key),setItem(key,value){eventUIWrites.push(['set',key,String(value)]);return eventUIStorage.setItem(key,value);},removeItem(key){eventUIWrites.push(['remove',key]);return eventUIStorage.removeItem(key);}})");
 return a;
}
function click(a,selector){const n=a.node(selector);assert.ok(n,'Actual rendered control '+selector);assert.equal(n.disabled,false);n.click();return n;}
function close(a){if(a.node('.modal'))a.run('closeModal(true)');}
function filter(a,patch){a.put('filterPatch',patch);a.run("filters={q:'',type:'all',account:'all',category:'all',...filterPatch};page='ledger';render()");}
function ids(a,selector='[data-tx]',key='tx'){return a.doc.querySelectorAll(selector).map(n=>n.dataset[key]);}
function readonly(a,before){assert.deepEqual(a.value('eventUIWrites'),[]);assert.equal(a.run('JSON.stringify(state)'),before);if(a.entry==='demo.html'){assert.equal(a.counters.localStorage,0);assert.equal(a.counters.sessionStorage,0);assert.deepEqual(a.counters.personalIO,[]);}assert.deepEqual(a.counters.forbidden,[]);}
module.exports={root,KEY,L,R,S,LONG_ID,ATTACK,clone,transaction,fixture,app,click,close,filter,ids,readonly};
