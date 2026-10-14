'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const L=require('../dist/ledger.js');
const I=require('../dist/importer.js');
const S=require('../dist/scenario.js');
const config={sourceKey:'synthetic-test-source',accountId:'account-cash',delimiter:',',columns:{date:'Date',amount:'Amount',direction:'Type',stableId:'Id',status:'Status',note:'Note'},dateFormat:'YYYY-MM-DD'};
const csv='Date,Amount,Type,Id,Status,Note\n2026-09-01,12.34,expense,SYN-A,completed,Synthetic purchase\n2026-09-02,100.00,income,SYN-B,completed,Synthetic receipt';
function imported(state=L.createEmpty()){const p=I.preview(state,csv,config);return I.commit(state,p,p.rows.filter(r=>r.action==='new').map(r=>r.key));}
test('v3 whole backup round trip includes evidence, changes, quarantine, coverage, and existing simulation',()=>{
 const old=L.createEmpty();old.simulation=S.defaultSettings();old.simulation.completeMonths=['2026-09'];
 const p=I.preview(old,csv+'\ninvalid,2.00,expense,SYN-C,completed,Synthetic bad row',{...config,coverage:{start:'2026-09-01',end:'2026-09-30',confirmed:true}});
 const state=I.commit(old,p,[p.rows[0].key]);
 assert.equal(state.version,3);assert.equal(state.transactions.length,1);assert.equal(state.imports.quarantine.length,2);
 const restored=L.parseBackup(L.backup(state));assert.deepEqual(restored,state);
 assert.deepEqual(L.verifyBackup(L.backup(state)).state,state);assert.equal(restored.imports.coverage.length,1);
 assert.equal(S.calculate(restored,restored.simulation,'2026-10-14').baseline.monthlyCents,1234);
});
test('ordinary edits preserve imports and original evidence without silently editing provenance',()=>{
 const state=imported(),evidence=JSON.stringify(state.imports);
 const id=state.transactions[0].id,next=L.putTransaction(state,{...state.transactions[0],note:'manual correction'},id);
 assert.equal(JSON.stringify(next.imports),evidence);assert.equal(next.version,3);
 assert.equal(next.imports.evidence[0].mapped.note,'Synthetic purchase');
 const result=I.rollback(next,next.imports.batches[0].id);assert.equal(result.rolledBack,false);assert.ok(result.conflicts.length);assert.deepEqual(result.state,next);
});
test('v3 load and save preserve every extension and fail closed on unavailable capacity',()=>{
 const state=imported(),values=new Map();const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};
 L.save(storage,state);assert.deepEqual(L.load(storage).state,state);
 const before=values.get(L.STORAGE_KEY);storage.setItem=()=>{throw Error('Quota');};
 assert.throws(()=>L.save(storage,L.putTransaction(state,{type:'expense',date:'2026-10-14',amountCents:1,accountId:'account-cash',categoryId:'expense-other'})),e=>e.code==='STORAGE_WRITE_FAILED');
 assert.equal(values.get(L.STORAGE_KEY),before);assert.deepEqual(L.load(storage).state,state);
});
test('legacy backups remain legacy and do not gain synthetic import records',()=>{
 for(const state of [L.createEmpty(),{...L.createEmpty(),simulation:S.defaultSettings()}]){
  const valid=L.validateState(state),restored=L.parseBackup(L.backup(valid));assert.deepEqual(restored,valid);assert.equal(restored.imports,undefined);
 }
 const b=JSON.parse(L.backup(imported()));b.version=2;assert.throws(()=>L.parseBackup(JSON.stringify(b)));
});
test('import rollback preserves unrelated later manual transaction and scenario changes',()=>{
 let state=imported();const batchId=state.imports.batches[0].id;
 state=L.putTransaction(state,{type:'expense',date:'2026-10-14',amountCents:75,accountId:'account-cash',categoryId:'expense-other',note:'later independent synthetic entry'});
 state=L.validateState({...state,simulation:S.defaultSettings()});
 const result=I.rollback(state,batchId);assert.equal(result.rolledBack,true);assert.equal(result.state.transactions.length,1);assert.equal(result.state.transactions[0].amountCents,75);assert.deepEqual(result.state.simulation,state.simulation);
 assert.deepEqual(L.parseBackup(L.backup(result.state)),result.state);
});
test('tampered dangling import references are rejected without replacing storage',()=>{
 const state=imported();state.imports.evidence[0].transactionId='missing-reference';
 const raw=JSON.stringify(state),storage={getItem:()=>raw,setItem:()=>assert.fail('must never write')};
 const loaded=L.load(storage);assert.ok(loaded.error);assert.equal(loaded.state.transactions.length,0);assert.equal(storage.getItem(),raw);
});
