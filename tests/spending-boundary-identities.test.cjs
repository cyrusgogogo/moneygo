'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {L,copy,spending,base,tx,confirmation}=require('./spending-boundary-helpers.cjs');
const R=require('../dist/relations'),O=require('../dist/organizer'),C=require('../dist/obligations'),S=require('../dist/scenario');
const contract=(id='installment-1')=>({accountId:'credit',name:'Contract',principalCents:10000,feeCents:0,source:'Synthetic',purchaseTransactionId:null,status:'active',schedule:[{id,dueDate:'2026-11-01',principalCents:10000,feeCents:0}],note:''});
const credit=s=>C.putProfile(s,{accountId:'credit',role:'credit',creditLimitCents:null,note:''},confirmation(s));
test('spending collector traverses typed definitions, remaining snapshots, proof and full before/after/reversal history',()=>{
  const s=spending(base([tx('payment-source','expense')]),{payment:true,sourceId:'payment-source',reversed:true,retired:true}),rows=L.collectRetainedIdentities(s);
  assert.ok(Object.isFrozen(rows));for(const r of rows){assert.ok(Object.isFrozen(r));assert.ok(Object.isFrozen(r.paths));}
  const plan=rows.find(r=>r.namespace==='spendingPlanning'&&r.kind==='plan'&&r.usage==='definition');assert.equal(plan.ownerKey,'["spendingPlanning","plan","spending-plan-fixture"]');assert.ok(plan.paths.every(p=>p.includes('.audit[')));assert.ok(plan.paths.some(p=>p.endsWith('.before.id')));assert.ok(plan.paths.some(p=>p.endsWith('.after.id')));
  const payment=rows.find(r=>r.namespace==='spendingPlanning'&&r.kind==='payment'&&r.usage==='definition');assert.equal(payment.paths.length,2);
  assert.ok(rows.some(r=>r.id===payment.id&&r.usage==='reference'&&r.paths.some(p=>p.includes('remainingConfirmation.paymentIds'))));
  assert.ok(rows.some(r=>r.kind==='audit'&&r.usage==='reference'&&r.paths.some(p=>p.endsWith('.reverses'))));
  assert.ok(rows.some(r=>r.id==='payment-source'&&r.namespace==='core'&&r.kind==='transaction'&&r.usage==='reference'&&r.paths.some(p=>p.endsWith('.proof.source.id'))));
  assert.ok(rows.some(r=>r.namespace==='obligations'&&r.kind==='profile'&&r.usage==='reference'&&r.paths.some(p=>p.endsWith('.proof.cashProfile.id'))));
});
test('every retained old raw identity including income/history rejects forged spending ownership',()=>{
  const input=require('./income-root-fixture.cjs').combined().state, ids=[...new Set(L.collectRetainedIdentities(input).map(r=>r.id))];assert.ok(ids.length>100);for(const id of ids)assert.throws(()=>spending(input,{id}),{code:'IDENTITY_COLLISION'},id);
});
test('income-owned and spending-owned definitions protect both directions without global foreign uniqueness',()=>{
  const {planning:income}=require('./income-boundary-helpers.cjs');const i=income(base());assert.throws(()=>spending(i,{id:i.incomePlanning.plans[0].id}),{code:'IDENTITY_COLLISION'});
  const s=spending();const raw=copy(income(base(),{id:s.spendingPlanning.plans[0].id}));raw.version=8;raw.spendingPlanning=copy(s.spendingPlanning);assert.throws(()=>L.validateState(raw),{code:'IDENTITY_COLLISION'});
});
for(const both of [false,true])test('legacy account/local-installment and contract-local repeated strings remain legal '+both,()=>{
  let s=base();s.accounts.push({id:'installment-1',name:'Separate account',openingBalanceCents:0});s=credit(s);s=C.putContract(s,contract(),confirmation(s));s=C.putContract(s,contract(),confirmation(s));s=spending(s,{both,expectedAccountId:'installment-1'});
  assert.equal(new Set(L.collectRetainedIdentities(s).filter(r=>r.id==='installment-1'&&r.kind==='installment'&&r.usage==='definition').map(r=>r.ownerKey)).size,2);
  s=L.removeAccount(s,'installment-1');assert.equal(s.spendingPlanning.plans[0].expectedAccountId,'installment-1');assert.deepEqual(L.parseBackup(L.backup(s)),s);
});
for(const both of [false,true])test('new nested installment owners reserve both planning histories and borrowed names '+both,()=>{
  for(const id of ['spending-plan-fixture','spending-audit-fixture','missing-account',...(both?['income-plan-fixture','income-audit-fixture']:[])]){const s=spending(credit(base()),{both,expectedAccountId:'missing-account'}),before=JSON.stringify(s);assert.throws(()=>C.putContract(s,contract(id),confirmation(s)),{code:'IDENTITY_COLLISION'});assert.equal(JSON.stringify(s),before);}
  let s=credit(base());s=C.putContract(s,contract(),confirmation(s));s=spending(s,{both,expectedAccountId:'installment-1'});const row=s.obligations.contracts[0],fields=Object.fromEntries(C.FIELDS.contract.map(k=>[k,copy(row[k])]));s=C.putContract(s,{...fields,name:'Changed'},confirmation(s),row.id);s=C.revert(s,s.obligations.audit.at(-1).id,confirmation(s));assert.equal(s.obligations.contracts[0].name,'Contract');assert.throws(()=>C.putContract(s,contract(),confirmation(s)),{code:'IDENTITY_COLLISION'});
});
test('stale typed simulation refs and removed relation history stay reserved',()=>{
  let s=base([tx('expense','expense')]);s.version=2;s.simulation=S.defaultSettings();s.simulation.version=2;s.simulation.exclusions=[{kind:'held-recognition',id:'retired-held-event'},{kind:'transaction-expense',id:'missing-expense'}];s=R.createClaim(s,{expenseId:'expense',amountCents:100,name:'Synthetic',kind:'advance'});const claim=s.bookkeeping.claims[0].id;s=R.unlink(s,'claim',claim,'Remove');s=spending(s);for(const id of ['retired-held-event','missing-expense',claim]){assert.ok(L.collectRetainedIdentities(s).some(r=>r.id===id));const bare=copy(s);delete bare.spendingPlanning;bare.version=4;assert.throws(()=>spending(bare,{id}),{code:'IDENTITY_COLLISION'});}
});
test('new deterministic relation/organizer IDs avoid spending current, retired, audit and borrowed strings',()=>{
  for(const options of [{id:'relation-claim-1'},{id:'retired',retired:true,auditId:'relation-audit-1'},{expectedAccountId:'relation-claim-1'}]){const s=spending(base([tx('expense','expense')]),options),used=new Set(L.collectRetainedIdentities(s).map(r=>r.id)),n=R.createClaim(s,{expenseId:'expense',amountCents:100,name:'Claim',kind:'advance'});assert.ok(!used.has(n.bookkeeping.claims[0].id));assert.ok(!used.has(n.bookkeeping.audit[0].id));}
  const s=spending(base(),{expectedAccountId:'organizer-rule-1',auditId:'organizer-audit-1'}),n=O.saveRule(s,{name:'Rule',conditions:{type:'expense'},actions:{categoryId:'expense-food'}});assert.equal(n.organizer.rules[0].id,'organizer-rule-2');assert.equal(n.organizer.audit[0].id,'organizer-audit-2');
});
test('removed relation ID may be a later cash-profile ID across historical proofs, preserving typed foreign reuse',()=>{
  const F=require('./spending-model-fixtures.cjs'),old=require('./fixtures/spending-readers-v016/ledger.js');
  let s=F.claim(F.base(),1000),claimId=s.bookkeeping.claims[0].id;s=F.committed(s);s=F.allocate(s,500,99500);const oldPayment=s.spendingPlanning.payments[0].id;
  s=R.unlink(s,'claim',claimId,'Synthetic reversal');const profileId=s.obligations.profiles[0].id;s=C.remove(s,'profile',profileId,confirmation(s));s=F.profile(s);
  const replacement=s.obligations.profiles[0].id;const raw=copy(s);
  function rename(value){if(Array.isArray(value))return value.map(rename);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rename(v)]));return value===replacement?claimId:value;}
  raw.obligations=rename(raw.obligations);const legacy=copy(raw);delete legacy.spendingPlanning;legacy.version=6;assert.doesNotThrow(()=>old.validateState(legacy));
  s=L.validateState(raw);assert.equal(F.P.view(s,F.options).payments[0].applicability,'role-changed');s=F.apply(s,{action:'reconfirm-payment',paymentId:oldPayment,remainingAfterCents:99500});
  assert.equal(s.spendingPlanning.payments[0].proof.cashProfile.id,claimId);assert.equal(F.P.view(s,F.options).payments[0].applicability,'applicable');
  const records=L.collectRetainedIdentities(s).filter(r=>r.id===claimId);assert.ok(records.some(r=>r.namespace==='relations'&&r.kind==='claim'));assert.ok(records.some(r=>r.namespace==='obligations'&&r.kind==='profile'));assert.deepEqual(L.parseBackup(L.backup(s)),s);
});
test('new v8 installment owner reserves every retained raw identity while old typed reuse/restore/update remain legal',()=>{
  let legacy=credit(base());legacy.accounts.push({id:'local-foreign',name:'Foreign same-spelling account',openingBalanceCents:0});legacy=L.validateState(legacy);
  legacy=C.putContract(legacy,contract('local-foreign'),confirmation(legacy));legacy=C.putContract(legacy,contract('local-foreign'),confirmation(legacy));
  const v7=require('./income-boundary-helpers.cjs').planning(legacy);const v7New=C.putContract(v7,contract('local-foreign'),confirmation(v7));assert.equal(v7New.obligations.contracts.length,3,'existing v7 creation behavior remains');
  let s=spending(v7);assert.deepEqual(L.parseBackup(L.backup(s)),s,'valid restored foreign typed reuse remains accepted');
  for(const id of ['local-foreign','account-cash','expense-food',s.obligations.profiles[0].id,s.obligations.contracts[0].id,s.obligations.audit[0].id]){const before=JSON.stringify(s);assert.throws(()=>C.putContract(s,contract(id),confirmation(s)),{code:'IDENTITY_COLLISION'},id);assert.equal(JSON.stringify(s),before);}
  const existing=s.obligations.contracts[0],fields=Object.fromEntries(C.FIELDS.contract.map(k=>[k,copy(existing[k])]));s=C.putContract(s,{...fields,note:'Retain exact typed owner'},confirmation(s),existing.id);assert.equal(s.obligations.contracts[0].schedule[0].id,'local-foreign');s=C.revert(s,s.obligations.audit.at(-1).id,confirmation(s));assert.equal(s.obligations.contracts[0].note,'');assert.deepEqual(L.parseBackup(L.backup(s)),s);
});
