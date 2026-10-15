'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=process.env.MONEYGO_EQUIVALENCE_ROOT||path.resolve(__dirname,'..');
function leafRealm(){
 const touched=[];const window={};for(const key of ['MoneygoLedger','MoneygoRelations','MoneygoOrganizer','MoneygoObligations','MoneygoScenario','document','localStorage','sessionStorage','fetch','XMLHttpRequest','WebSocket','indexedDB','Date','setTimeout'])Object.defineProperty(window,key,{get(){touched.push(key);throw Error('Forbidden '+key);}});
 const context=vm.createContext({window});for(const key of ['Date','document','localStorage','sessionStorage','fetch','XMLHttpRequest','WebSocket','indexedDB','setTimeout','require'])Object.defineProperty(context,key,{get(){touched.push(key);throw Error('Forbidden '+key);}});
 vm.runInContext(fs.readFileSync(path.join(root,'dist/personal-events.js'),'utf8'),context,{filename:'personal-events.js'});
 vm.runInContext(`const P=window.MoneygoPersonalEvents;function fact(id,kind='expense',amount=101,extra={}){return {transactionId:id,kind,effectiveDate:'2026-01-01',categoryId:kind==='transfer'?null:'category',accountId:'source-account',rawAmountCents:101,personalAmountCents:kind==='transfer'?0:amount,excluded:false,primaryId:null,transferPairId:null,compositeId:null,personalAuthority:true,fundingAuthority:true,...extra};}function outcome(f){try{return {accepted:true,value:f()};}catch(e){return {accepted:false,name:e.name,code:e.code};}}`,context);
 return {touched,run:s=>vm.runInContext(s,context),value:s=>JSON.parse(vm.runInContext('JSON.stringify('+s+')',context))};
}
const fail=(h,code,expr)=>assert.deepEqual(h.value('outcome(()=>('+expr+'))'),{accepted:false,name:'PersonalEventError',code},expr);
test('independent leaf is a pure capability-free module and exports the exact frozen API/limits',()=>{
 const h=leafRealm();assert.deepEqual(h.value('Object.keys(P).sort()'),['LIMITS','PersonalEventError','keyOf','projectHeld','projectLegacy','reduce','select']);assert.deepEqual(h.value('P.LIMITS'),{facts:10000,events:10000,transactionIds:10000,idLength:100,heldEvents:5000,mixedEvents:15000,eventKeys:15000});assert.equal(h.run('Object.isFrozen(P)&&Object.isFrozen(P.LIMITS)'),true);
 assert.equal(h.run('P.projectLegacy([fact("e")]).expenseEvents[0].amountCents'),101);assert.deepEqual(h.touched,[]);
});
test('independent leaf preserves suppression priority and trace order without native transfer events',()=>{
 const h=leafRealm();const events=h.value(`P.projectLegacy([fact('positive'),fact('shadow','expense',0,{excluded:true,primaryId:'positive',transferPairId:'pair',personalAuthority:false}),fact('pair','expense',0,{transferPairId:'pair',personalAuthority:false}),fact('funding','expense',0,{compositeId:'composite',personalAuthority:false}),fact('allocated','expense',0),fact('receipt','income',0,{personalAuthority:false}),fact('native','transfer')])`);
 assert.deepEqual(events.expenseEvents.map(e=>[e.key.id,e.suppression,e.amountCents]),[['positive',null,101],['shadow','duplicate-evidence',0],['pair','transfer-leg',0],['funding','composite-nonpersonal',0],['allocated','fully-allocated',0]]);
 assert.deepEqual(events.incomeEvents.map(e=>[e.key.id,e.suppression]),[['receipt','fully-allocated']]);
 assert.deepEqual(h.value('P.reduce([...P.projectLegacy([fact("e")]).expenseEvents,...P.projectLegacy([fact("i","income",51)]).incomeEvents])'),{expenseCents:101,incomeCents:51,netCents:-50,expenseEventCount:1,incomeEventCount:1,positiveExpenseEventCount:1,positiveIncomeEventCount:1});
 assert.deepEqual(h.touched,[]);
});
test('independent external event validation detaches without freezing or retaining caller objects',()=>{
 const h=leafRealm();h.run(`var external=JSON.parse(JSON.stringify(P.projectLegacy([fact('e')]).expenseEvents));var selected=P.select(external);`);
 assert.equal(h.run('selected[0]!==external[0]&&selected[0].key!==external[0].key&&selected[0].route!==external[0].route'),true);
 assert.equal(h.run('!Object.isFrozen(external)&&!Object.isFrozen(external[0])&&!Object.isFrozen(external[0].key)'),true);
 assert.equal(h.run('Object.isFrozen(selected)&&Object.isFrozen(selected[0])&&Object.isFrozen(selected[0].key)&&Object.isFrozen(selected[0].route)'),true);
 h.run('external[0].key.id="changed";');assert.equal(h.run('selected[0].key.id'),'e');
 h.run(`var frozenExternal=JSON.parse(JSON.stringify(P.projectLegacy([fact('f')]).expenseEvents));Object.freeze(frozenExternal[0]);Object.freeze(frozenExternal);var selectedFrozen=P.select(frozenExternal);`);
 assert.equal(h.run('selectedFrozen[0]!==frozenExternal[0]&&selectedFrozen[0].key!==frozenExternal[0].key'),true);assert.equal(h.run('Object.isFrozen(frozenExternal[0].key)'),false);
});
test('independent leaf validates hidden rows and duplicate keys before selection',()=>{
 const h=leafRealm();h.run(`var valid=JSON.parse(JSON.stringify(P.projectLegacy([fact('e')]).expenseEvents));var invalid={...valid[0],effectiveDate:'1900-02-29',key:{kind:'transaction-expense',id:'hidden'},origin:{kind:'transaction',transactionId:'hidden'},attribution:{kind:'transaction',transactionId:'hidden',accountId:'source-account'},route:{kind:'transaction',transactionId:'hidden'}};`);
 fail(h,'INVALID_DATE',"P.select([...valid,invalid],{transactionIds:['e']})");fail(h,'DUPLICATE_EVENT_KEY','P.select([...valid,...valid],{transactionIds:[]})');fail(h,'DUPLICATE_EVENT_KEY','P.reduce([...valid,...valid])');
 for(const mutation of ["row.route.transactionId='wrong'","row.attribution.transactionId='wrong'","row.origin.kind='held'","row.key.kind='recognition'","row.suppression='fully-allocated'","row.excluded=true","row.extra=1"]){h.run('var row=JSON.parse(JSON.stringify(valid[0]));'+mutation);fail(h,'INVALID_PERSONAL_EVENT','P.reduce([row])');}
});
test('independent leaf rejects accessors, sparse/custom arrays and prototypes without executing data access',()=>{
 const h=leafRealm();h.run('var reads=0;');
 for(const expression of ["(()=>{const x=fact('e');Object.defineProperty(x,'categoryId',{get(){reads++;throw Error('read');},enumerable:true});return [x];})()","(()=>{const x=[fact('e')];Object.defineProperty(x,'0',{get(){reads++;throw Error('read');},enumerable:true});return x;})()","new Array(1)","Object.assign([fact('e')],{map(){reads++;throw Error('map');}})","[Object.assign(Object.create({kind:'expense'}),fact('e'))]"]){fail(h,'INVALID_PERSONAL_EVENT','P.projectLegacy('+expression+')');}
 fail(h,'EVENT_LIMIT',"P.projectLegacy((()=>{const x=new Array(10001);Object.defineProperty(x,'0',{get(){reads++;throw Error('read');},enumerable:true});return x;})())");
 assert.equal(h.run('reads'),0);assert.deepEqual(h.touched,[]);
});
test('independent strict Gregorian dates, typed IDs and query errors cannot coerce values',()=>{
 const h=leafRealm();for(const date of ['0001-01-01','2000-02-29','9999-12-31'])assert.equal(h.run('P.projectLegacy([fact("e","expense",1,{effectiveDate:'+JSON.stringify(date)+'})]).expenseEvents[0].effectiveDate'),date);
 for(const date of ['0000-01-01','1900-02-29','2026-02-30','2026-1-01','2026-01-01T00:00:00Z',' 2026-01-01'])fail(h,'INVALID_DATE','P.projectLegacy([fact("e","expense",1,{effectiveDate:'+JSON.stringify(date)+'})])');
 assert.equal(h.run('P.keyOf({kind:"transaction-expense",id:"transaction-expense-e"})'),'["transaction-expense","transaction-expense-e"]');
 fail(h,'INVALID_PERSONAL_EVENT','P.keyOf("e")');fail(h,'INVALID_PERSONAL_EVENT','P.keyOf({kind:"recognition",id:"e"})');fail(h,'INVALID_ID','P.keyOf({kind:"transaction-expense",id:"constructor"})');
 for(const query of ['{month:null}','{month:""}','{month:"0000-01"}','{month:"2026-13"}'])fail(h,'INVALID_MONTH','P.select([],'+query+')');
 for(const query of ['{accountId:null}','{categoryId:""}','{transactionIds:["e","e"]}','{positiveOnly:1}','{cashAccountId:"a"}'])fail(h,'INVALID_EVENT_QUERY','P.select([],'+query+')');
});
test('independent leaf accepts limits, canonicalizes negative zero and rejects safe-net gross overflow',()=>{
 const h=leafRealm();assert.equal(h.run('P.reduce(P.projectLegacy(Array.from({length:10000},(_,i)=>fact("e-"+i,"expense",1))).expenseEvents).expenseCents'),10000);
 assert.equal(h.run('Object.is(P.projectLegacy([fact("zero","expense",-0)]).expenseEvents[0].amountCents,-0)'),false);
 fail(h,'DUPLICATE_ID','P.projectLegacy([fact("e"),fact("e","income")])');
 fail(h,'AMOUNT_OVERFLOW',`P.reduce(Array.from({length:10000},(_,i)=>{const kind=i<9008?'expense':'income';return P.projectLegacy([fact('e-'+i,kind,999999999999,{rawAmountCents:999999999999})])[kind==='expense'?'expenseEvents':'incomeEvents'][0];}))`);
 assert.deepEqual(h.touched,[]);
});
