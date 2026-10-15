'use strict';
// Actual entry scripts in a DOM host, not native browser acceptance.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {host}=require('./actual-entry-host.cjs');
const root=path.resolve(__dirname,'..');
for(const mode of ['personal','synthetic'])for(const [name,method] of [['MoneygoIncomeCore','validateExtension'],['MoneygoRetainedIdentities','collectNormalized'],['MoneygoIncomePlanning','createCoordinator'],['MoneygoIncomePlanningUI','invalidate'],['MoneygoLedger','collectRetainedIdentities']])for(const fault of ['missing-module','missing-method','module-accessor','method-accessor']){
 test(mode+': '+name+' '+fault+' stops before acquiring any ledger storage',()=>{
  let intercepted=0,reads=0;
  const a=host(root,{entry:mode==='personal'?'index.html':'demo.html',personal:{'moneygo.ledger.v1':'UNREAD_SENTINEL'},beforeScript(file,context,window){
   if(file!==(mode==='personal'?'personal-bootstrap-v1.js':'synthetic-bootstrap-v1.js'))return;intercepted++;
   if(fault==='missing-module')delete window[name];
   else if(fault==='module-accessor')Object.defineProperty(window,name,{get(){reads++;throw Error('Unexpected module getter');},configurable:true});
   else{const api={...window[name]};if(fault==='missing-method')api[method]=undefined;else Object.defineProperty(api,method,{get(){reads++;throw Error('Unexpected method getter');}});window[name]=api;}
  }});
  assert.equal(intercepted,1);assert.equal(reads,0);assert.equal(a.node('#app').hidden,true);assert.equal(a.node('#app').innerHTML,'');assert.equal(a.node('#boot-blocker').hidden,false);assert.equal(a.counters.localStorage,0);assert.equal(a.counters.sessionStorage,0);assert.deepEqual(a.counters.personalIO,[]);assert.equal(a.run('Object.hasOwn(window,"MoneygoRuntimeCapability")'),false);
 });
}
