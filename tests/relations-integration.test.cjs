'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const L=require('../dist/ledger.js'),I=require('../dist/importer.js'),R=require('../dist/relations.js'),S=require('../dist/scenario.js');
const {loadApp,memoryStorage}=require('./ui.test.cjs');
function combined(){
 const csv='date,amount,type,id\n2026-09-15,100,expense,SYN-A\n2026-09-16,100,expense,SYN-B\n2026-10-05,70,income,SYN-C';
 const empty=L.createEmpty(),p=I.preview(empty,csv,{sourceKey:'SYNTHETIC-evidence',accountId:'account-cash',delimiter:',',columns:{date:0,amount:1,direction:2,stableId:3}});
 let s=I.commit(empty,p,p.rows.map(r=>r.key));const [purchase,shadow,income]=s.transactions.map(t=>t.id);
 s=R.linkEvidence(s,{primaryId:purchase,shadowId:shadow,reason:'Synthetic same physical purchase'});
 s=R.createClaim(s,{expenseId:purchase,amountCents:5000,kind:'advance',name:'Synthetic participant share'});
 s=R.settleClaim(s,{incomeId:income,claimId:s.bookkeeping.claims[0].id,amountCents:3000,reason:'Synthetic repayment actually received'});
 s=R.addRefundPlan(s,{expenseId:purchase,expectedAmountCents:2000,dueDate:'2026-10-05'});
 s=R.allocateRefund(s,{expenseId:purchase,incomeId:income,amountCents:2000,planId:s.bookkeeping.refundPlans[0].id,reason:'Synthetic actual refund'});
 s=R.addSnapshot(s,{accountId:'account-cash',date:'2026-10-31',actualBalanceCents:-3000,note:'Synthetic end-of-day verified balance'});
 const simulation=S.defaultSettings();simulation.completeMonths=['2026-09'];s=L.validateState({...s,simulation});return {s,purchase,shadow,income};
}
test('v4 integrates imports, own consumption, received cash, receivables and scenario without duplication',()=>{
 const {s,purchase,shadow}=combined();assert.equal(s.version,4);
 assert.deepEqual(L.summary(s),{incomeCents:2000,expenseCents:3000,transferCents:0,netCents:-1000});
 const view=L.financialView(s);assert.equal(view.cash.netCents,-3000);assert.equal(view.receivables.outstandingCents,2000);assert.equal(L.balances(s)['account-cash'],-3000);
 assert.equal(L.expenseAmounts(s)[purchase],3000);assert.equal(L.expenseAmounts(s)[shadow],0);
 assert.equal(S.calculate(s,s.simulation,'2026-10-14').baseline.monthlyCents,3000);
 assert.equal(L.summary(s,'2026-09').expenseCents,3000);assert.equal(L.summary(s,'2026-10').incomeCents,2000);
});
test('v4 backup round trip preserves all relationships and isolated counts',()=>{
 const {s}=combined(),text=L.backup(s),copy=L.parseBackup(text),result=L.verifyBackup(text);
 assert.deepEqual(copy,s);assert.deepEqual(result.state,s);assert.equal(result.counts.links,1);assert.equal(result.counts.refunds,1);assert.equal(result.counts.claims,1);assert.equal(result.counts.snapshots,1);
 const storage=memoryStorage();L.save(storage,s);assert.deepEqual(L.load(storage).state,s);
 const bad=JSON.parse(text);bad.version=3;bad.data.version=3;assert.throws(()=>L.parseBackup(JSON.stringify(bad)));
});
test('v4 without imports is valid and legacy backup versions retain original meaning',()=>{
 let manual=L.putTransaction(L.createEmpty(),{type:'expense',date:'2026-09-01',amountCents:100,accountId:'account-cash',categoryId:'expense-food'});
 manual=R.createClaim(manual,{expenseId:manual.transactions[0].id,amountCents:50,kind:'reimbursement',name:'Synthetic claim'});
 assert.equal(L.parseBackup(L.backup(manual)).version,4);assert.equal(manual.imports,undefined);
 for(const legacy of [L.createEmpty(),{...L.createEmpty(),simulation:S.defaultSettings()}]){const before=L.validateState(legacy);assert.deepEqual(L.parseBackup(L.backup(before)),before);}
});
test('financial dependency guards reject edits/deletes atomically but permit notes and categories',()=>{
 const {s,purchase,income}=combined(),before=JSON.stringify(s),p=s.transactions.find(t=>t.id===purchase),receipt=s.transactions.find(t=>t.id===income);
 for(const [id,row,patch] of [[purchase,p,{amountCents:20000}],[purchase,p,{date:'2026-09-01'}],[income,receipt,{amountCents:8000}]])assert.throws(()=>L.putTransaction(s,{...row,...patch},id));
 assert.throws(()=>L.deleteTransaction(s,purchase));assert.equal(JSON.stringify(s),before);
 const corrected=L.putTransaction(s,{...p,note:'Synthetic corrected note',categoryId:'expense-shopping'},purchase);assert.equal(L.summary(corrected).expenseCents,3000);assert.equal(corrected.bookkeeping.claims[0].expenseId,purchase);
});
test('import rollback returns relationship conflicts and does not silently discard links',()=>{
 const {s}=combined(),before=JSON.stringify(s),r=I.rollback(s,s.imports.batches[0].id);assert.equal(r.rolledBack,false);assert.ok(r.conflicts.some(c=>c.dependencies?.length));assert.equal(JSON.stringify(r.state),before);
});
test('snapshots remain historical on unrelated changes while current differences are visible',()=>{
 const {s}=combined(),id=s.bookkeeping.snapshots[0].id;
 const future=L.putTransaction(s,{type:'expense',date:'2026-11-01',amountCents:3,accountId:'account-cash',categoryId:'expense-other'});assert.equal(R.reconciliation(future,id).changed,false);
 const earlier=L.putTransaction(s,{type:'expense',date:'2026-10-30',amountCents:3,accountId:'account-cash',categoryId:'expense-other'});assert.equal(R.reconciliation(earlier,id).changed,true);assert.equal(R.reconciliation(earlier,id).differenceCents,3);
});
test('real app report, categories and filtered ledger use net personal amounts and expose raw cash',()=>{
 const {s,shadow}=combined(),app=loadApp(memoryStorage({[L.STORAGE_KEY]:JSON.stringify(s)}));
 app.run("month='2026-09';page='report';render()");assert.match(app.node('#app').innerHTML,/本月个人消费/);assert.match(app.node('#app').innerHTML,/¥30\.00/);assert.match(app.node('#app').innerHTML,/cash-expense/);
 app.putGlobal('shadowId',shadow);assert.equal(app.run('expenseValue(state.transactions.find(t=>t.id===shadowId))'),0);
 app.run("page='ledger';render()");assert.match(app.node('#app').innerHTML,/个人消费 ¥30\.00/);assert.match(app.node('#app').innerHTML,/重复证据 · 未重复计账/);
 app.run("page='bookkeeping';render()");assert.match(app.node('#app').innerHTML,/退款/);assert.match(app.node('#app').innerHTML,/应收/);
});
test('safe snapshots-only extension leaves old financial totals unchanged',()=>{
 const original=L.putTransaction(L.createEmpty(),{type:'income',date:'2026-09-01',amountCents:99,accountId:'account-cash',categoryId:'income-other'}),s=R.addSnapshot(original,{accountId:'account-cash',date:'2026-09-01',actualBalanceCents:99});
 assert.deepEqual(L.summary(s),L.summary(original));assert.deepEqual(L.balances(s),L.balances(original));assert.equal(R.reconciliation(s,s.bookkeeping.snapshots[0].id).reconciled,true);
});
