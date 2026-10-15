'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const F=require('./spending-boundary-combined-fixture.cjs');
test('genuine combined v8 includes every legacy feature and valid/missing/stale/future/cancelled/retired/reconfirmed/reversed spending history',()=>{
  const {state,ids}=F.combined();for(const key of ['simulation','imports','bookkeeping','organizer','obligations','incomePlanning','spendingPlanning'])assert.ok(state[key],key);
  for(const key of ['links','transferPairs','composites','refunds','claims','settlements','snapshots','heldPositions','heldRecognitions','heldReturns'])assert.ok(state.bookkeeping[key].length,key);
  for(const key of ['profiles','statements','contracts','repayments','inclusions','fees'])assert.ok(state.obligations[key].length,key);
  assert.ok(state.organizer.closes.length);assert.ok(state.simulation.exclusions.some(e=>typeof e==='object'));assert.ok(state.simulation.scenarios.some(s=>s.oneOffs.length));
  const view=F.P.view(state,F.options),find=key=>view.plans.find(p=>p.plan.id===ids[key]);assert.equal(find('main').grossPaidCents,1000);assert.equal(find('main').remainingCents,9000);for(const key of ['missing','stale','future']){assert.equal(find(key).grossPaidCents,null);assert.equal(find(key).remainingCents,null);}
  for(const [key,why] of [['missing','source-missing'],['stale','basis-changed'],['future','future-at-cutoff']])assert.equal(view.payments.find(p=>p.planId===ids[key]).applicability,why);
  assert.equal(find('cancelled').futureExclusionReason,'cancelled-exclusion');assert.equal(find('retired'),undefined);assert.equal(find('reversed').grossPaidCents,0);assert.equal(find('reversed').remainingCents,null);
  assert.deepEqual(F.R.calculate(state),F.economic(state));
});
test('full v8 isolated backup roundtrip keeps exact preexisting counts, money and replay-derived spending counts',()=>{
  const {state,oldCounts}=F.combined(),verified=F.L.verifyBackup(F.L.backup(state));assert.deepEqual(verified.state,state);assert.deepEqual(verified.counts,oldCounts);
  assert.deepEqual(verified.incomePlanningCounts,{currentPlans:6,cancelledPlans:1,retiredPlans:1,currentReceipts:4,reversedReceipts:3,auditOperations:19});
  assert.deepEqual(verified.spendingPlanningCounts,{currentPlans:7,cancelledPlans:1,retiredPlans:1,currentPayments:5,reversedPayments:2,auditOperations:25});
  assert.deepEqual(F.economic(verified.state),F.economic(state));assert.deepEqual(F.L.personalEvents(verified.state),F.L.personalEvents(state));
  const foreign=require('node:vm').runInNewContext('('+JSON.stringify(state)+')');assert.deepEqual(F.L.validateState(foreign),state,'genuine cross-realm all-extension v8 keeps exact normalized field/array order');assert.deepEqual(F.L.parseBackup(F.L.backup(foreign)),state);
  assert.notEqual(verified.state.spendingPlanning,state.spendingPlanning);assert.notEqual(verified.state.spendingPlanning.payments[0].proof,state.spendingPlanning.payments[0].proof);
  const mutable=JSON.parse(F.L.backup(state)).data;mutable.spendingPlanning.payments[0].proof.grossPaymentCents++;assert.throws(()=>F.L.validateState(mutable));assert.deepEqual(F.L.parseBackup(F.L.backup(verified.state)),state);
});
test('all retired spending retains outer8 and exact create-minus-current backup counts',()=>{
  const {L,spending,base}=require('./spending-boundary-helpers.cjs');const state=spending(base(),{retired:true,both:true}),verified=L.verifyBackup(L.backup(state));assert.equal(state.version,8);assert.deepEqual(verified.spendingPlanningCounts,{currentPlans:0,cancelledPlans:0,retiredPlans:1,currentPayments:0,reversedPayments:0,auditOperations:3});assert.deepEqual(verified.state,state);
});
