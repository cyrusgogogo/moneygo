'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const L=require('../dist/ledger.js'), I=require('../dist/importer.js'), R=require('../dist/relations.js'), O=require('../dist/organizer.js'), S=require('../dist/scenario.js');
const copy=v=>JSON.parse(JSON.stringify(v));
const at='2026-10-14T10:00:00.000Z';
function imported(state=L.createEmpty(), id='SYN-A', amount='10', sourceKey='SYNTHETIC-source'){
 const p=I.preview(state,`date,amount,note,id\n2026-09-01,${amount},Synthetic coffee,${id}`,{sourceKey,accountId:'account-cash',delimiter:',',defaultType:'expense',columns:{date:0,amount:1,note:2,stableId:3},coverage:{start:'2026-09-01',end:'2026-09-30',confirmed:true}});
 return I.commit(state,p,p.rows.filter(r=>['new','candidate','update','status'].includes(r.action)).map(r=>r.key));
}
function rule(state,extra={}){return O.saveRule(state,{name:'Synthetic rule',conditions:{note:{operator:'equals',value:'Synthetic coffee',caseSensitive:true}},actions:{categoryId:'expense-shopping'},at,...extra});}
function organized(){let s=rule(imported());s=O.saveAlias(s,{from:'Synthetic coffee',to:'Synthetic cafe',at});s=O.applyPreview(s,O.previewAliases(s),{transactionIds:[s.transactions[0].id],at});s=O.applyPreview(s,O.previewRules(s),{transactionIds:[s.transactions[0].id],at});s=O.setScope(s,{sourceKey:'SYNTHETIC-source',accountId:'account-cash',included:true,confirmed:true,reason:'Synthetic account',at});return O.closeMonth(s,{month:'2026-09',reason:'Synthetic frozen review',at});}

test('v5 whole backup preserves organizer, imports, relations and scenario exactly',()=>{
 let s=organized();s.simulation=S.defaultSettings();s=L.validateState(s);
 s=R.addSnapshot(s,{accountId:'account-cash',date:'2026-09-30',actualBalanceCents:-1000,note:'Synthetic day-end'});
 assert.equal(s.version,5);const canonical=L.validateState(s),before=JSON.stringify(canonical),backup=L.backup(canonical),restored=L.parseBackup(backup);
 assert.deepEqual(restored,canonical);assert.equal(JSON.parse(backup).version,5);const verified=L.verifyBackup(backup);assert.deepEqual(verified.state,canonical);assert.equal(verified.counts.rules,1);assert.equal(verified.counts.aliases,1);assert.equal(verified.counts.organizerBatches,2);assert.equal(verified.counts.closes,1);assert.equal(verified.counts.scopes,1);assert.equal(JSON.stringify(canonical),before);
});
test('v1-v4 backups stay legacy with no synthesized organizer data',()=>{
 const v1=L.createEmpty(),v2={...L.createEmpty(),version:2,simulation:S.defaultSettings()},v3=imported();let v4=R.addSnapshot(v3,{accountId:'account-cash',date:'2026-09-30',actualBalanceCents:-1000,note:'Synthetic'});
 for(const s of [v1,v2,v3,v4]){const r=L.parseBackup(L.backup(s));assert.equal(r.version,s.version);assert.equal(r.organizer,undefined);assert.deepEqual(L.balances(r),L.balances(s));}
});
test('mismatched v5 wrapper and missing or corrupt organizer fail without storage writes',()=>{
 const text=L.backup(organized()),b=JSON.parse(text);b.version=4;b.data.version=4;assert.throws(()=>L.parseBackup(JSON.stringify(b)),e=>e.code==='INVALID_BACKUP');
 const missing=JSON.parse(text);delete missing.data.organizer;assert.throws(()=>L.parseBackup(JSON.stringify(missing)),/整理备份/);
 const corrupt=JSON.parse(text);corrupt.data.organizer.closes[0].totals.personal.expenseCents++;assert.throws(()=>L.parseBackup(JSON.stringify(corrupt)));
 const storage={getItem:()=>JSON.stringify(corrupt.data),setItem:()=>assert.fail('must not write')};const loaded=L.load(storage);assert.ok(loaded.error);assert.equal(loaded.state.transactions.length,0);
});
test('organizer survives manual transaction edits, trash and restore with originals unchanged',()=>{
 const s=organized(),id=s.transactions[0].id,original=copy(s.imports),oldClose=copy(s.organizer.closes[0]);let changed=L.putTransaction(s,{...s.transactions[0],note:'Later user note'},id);
 assert.deepEqual(changed.imports,original);assert.equal(O.rawView(changed,id).merchant,'Synthetic cafe');assert.equal(O.compareMonth(changed,oldClose.id).changed,true);assert.deepEqual(changed.organizer.closes[0],oldClose);
 changed=L.deleteTransaction(changed,id);assert.equal(O.rawView(changed,id).merchant,'Synthetic cafe');changed=L.undoDelete(changed,id);assert.equal(changed.transactions[0].note,'Later user note');
 assert.throws(()=>O.rollbackBatch(changed,s.organizer.batches[1].id,{at}),e=>e.code==='ROLLBACK_CONFLICT');
});
test('import rollback identifies later merchant metadata and preserves the whole state',()=>{
 let s=imported(),batch=s.imports.batches[0].id,id=s.transactions[0].id;s=O.saveAlias(s,{from:'Synthetic coffee',to:'Synthetic cafe',at});s=O.applyPreview(s,O.previewAliases(s),{transactionIds:[id],at});const before=JSON.stringify(s),result=I.rollback(s,batch);
 assert.equal(result.rolledBack,false);assert.ok(result.conflicts.some(c=>c.dependencies?.some(d=>d.kind==='merchant')));assert.equal(JSON.stringify(s),before);assert.deepEqual(result.state,L.validateState(s));
 s=O.rollbackBatch(s,s.organizer.batches[0].id,{at});const undo=I.rollback(s,batch);assert.equal(undo.rolledBack,true);assert.equal(undo.state.transactions.length,0);assert.equal(undo.state.organizer.aliases.length,1);
});
test('source-specific reusable rules allow later imports and rollback of unrelated batches',()=>{
 let s=rule(imported(),{conditions:{sourceKey:'SYNTHETIC-source'}});s=imported(s,'SYN-B','12','SYNTHETIC-other');assert.equal(s.transactions.length,2);const other=s.imports.batches.at(-1).id;s=I.rollback(s,other).state;assert.equal(s.transactions.length,1);
 s=I.rollback(s,s.imports.batches[0].id).state;assert.equal(s.transactions.length,0);assert.equal(s.organizer.rules[0].conditions.sourceKey,'SYNTHETIC-source');s=imported(s,'SYN-C','11');assert.equal(s.transactions.length,1);assert.equal(O.previewRules(s).actionableCount,1);
});
test('frozen month and scenario agree on original purchase month after late refund',()=>{
 let s=organized(),purchase=s.transactions[0].id;s=L.putTransaction(s,{type:'income',date:'2026-10-03',amountCents:300,accountId:'account-cash',categoryId:'income-other',note:'Synthetic actual refund'});const receipt=s.transactions.at(-1).id;
 s=R.allocateRefund(s,{expenseId:purchase,incomeId:receipt,amountCents:300,reason:'Synthetic confirmed refund'});s=L.validateState(s);
 const c=O.compareMonth(s,s.organizer.closes[0].id);assert.equal(c.frozen.totals.personal.expenseCents,1000);assert.equal(c.current.totals.personal.expenseCents,700);assert.equal(c.delta.personal.expenseCents,-300);assert.equal(L.summary(s,'2026-09').expenseCents,700);assert.equal(L.financialView(s,'2026-10').cash.incomeCents,300);assert.equal(L.summary(s,'2026-10').incomeCents,0);assert.equal(L.expenseAmounts(s)[purchase],700);
});
test('live rule and scope references protect deletion while historical frozen categories stay replayable',()=>{
 let s=L.putCategory(L.createEmpty(),{name:'Synthetic spare',type:'expense'}),categoryId=s.categories.at(-1).id;s=rule(s,{actions:{categoryId}});assert.throws(()=>L.removeCategory(s,categoryId),e=>e.code==='INVALID_REFERENCE');s=O.removeRule(s,s.organizer.rules[0].id,{at});s=L.removeCategory(s,categoryId);assert.ok(!s.categories.some(c=>c.id===categoryId));
 s=L.putAccount(s,{name:'Synthetic unused account',openingBalanceCents:0});const accountId=s.accounts.at(-1).id;s=O.setScope(s,{sourceKey:'SYNTHETIC-declared',accountId,included:false,confirmed:true,reason:'Out of scope',at});assert.throws(()=>L.removeAccount(s,accountId),e=>e.code==='INVALID_REFERENCE');
});
test('v5 quota failure does not report success or erase serialized prior state',()=>{
 const s=organized(),raw=JSON.stringify(s),storage={getItem:()=>raw,setItem:()=>{throw Error('Quota');}};const before=JSON.stringify(s);assert.throws(()=>L.save(storage,s),e=>e.code==='STORAGE_WRITE_FAILED');assert.equal(storage.getItem(L.STORAGE_KEY),raw);assert.equal(JSON.stringify(s),before);assert.deepEqual(L.load(storage).state,L.validateState(s));
});

test('integrated organizer navigation, provenance and freshness render against persisted v5',()=>{
 const {loadApp,memoryStorage}=require('./ui.test.cjs'),s=organized(),storage=memoryStorage({[L.STORAGE_KEY]:JSON.stringify(s)}),app=loadApp(storage,{today:'2026-10-14'});
 app.run("page='organizer';render()");assert.match(app.node('#app').innerHTML,/整理复盘/);assert.match(app.node('#app').innerHTML,/优先核对/);
 app.run("page='report';month='2026-09';render()");assert.match(app.node('#app').innerHTML,/来源范围与新鲜度/);assert.match(app.node('#app').innerHTML,/SYNTHETIC-source/);
 app.node('#entry-form').elements={type:{value:'expense',forEach(){}},categoryId:{required:true,innerHTML:''},toAccountId:{required:false}};app.run('entry(state.transactions[0].id)');assert.match(app.node('#modal-root').innerHTML,/Synthetic cafe/);assert.match(app.node('#modal-root').innerHTML,/Synthetic coffee/);
 app.run("closeModal(true);page='sandbox';render()");assert.match(app.node('#app').innerHTML,/沙盘中手动选择的完整月份/);assert.deepEqual(app.value('state'),L.validateState(s));assert.equal(storage.writes.length,0);
});
test('integrated organizer mutations persist once and reload including frozen snapshot',()=>{
 const {loadApp,memoryStorage}=require('./ui.test.cjs'),storage=memoryStorage({[L.STORAGE_KEY]:JSON.stringify(imported())}),app=loadApp(storage,{today:'2026-10-14'});
 assert.equal(app.run("organizerContext().change(()=>window.MoneygoOrganizer.saveRule(state,{name:'Synthetic live',conditions:{type:'expense'},actions:{categoryId:'expense-shopping'}}),'已保存')"),true);
 assert.equal(storage.writes.length,1);assert.equal(app.value('state.version'),5);const reloaded=loadApp(storage);assert.equal(reloaded.value('state.organizer.rules.length'),1);assert.equal(reloaded.value('state.imports.evidence.length'),1);
});
test('integrated organizer failed persistence preserves in-memory and stored original',()=>{
 const {loadApp,memoryStorage}=require('./ui.test.cjs'),s=imported(),storage=memoryStorage({[L.STORAGE_KEY]:JSON.stringify(s)}),app=loadApp(storage);storage.failSet=()=>true;
 assert.equal(app.run("organizerContext().change(()=>window.MoneygoOrganizer.saveAlias(state,{from:'Synthetic coffee',to:'Synthetic cafe'}),'should not succeed')"),false);assert.deepEqual(app.value('state'),s);assert.equal(storage.writes.length,0);
});
