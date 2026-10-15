'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const Core=require('../dist/spending-core.js'),F=require('./spending-core-fixtures.cjs');
const fails=(value,code='SPENDING_HISTORY')=>assert.throws(()=>Core.validateExtension(value),e=>e instanceof Core.SpendingCoreError && (Array.isArray(code)?code.includes(e.code):e.code===code));
const committed=()=>F.builder().createPlan().commitPlan();
test('full lifecycle preserves original target, explicit remaining and immutable payment audit',()=>{
  const b=committed().allocate(F.payment({amountCents:40000}),60000).updatePlan('plan-1',{targetAmountCents:95000}).confirmRemaining('plan-1',50000).cancelPlan().reopenPlan('plan-1',40000).reverse('payment-1',null).cancelPlan().returnToPlan('plan-1',12000).cancelPlan().retirePlan();
  const x=Core.validateExtension(b.finish()),m=Core.metricsOf(x);
  assert.equal(x.audit[0].changes[0].after.targetAmountCents,100000);assert.equal(x.plans.length,0);assert.equal(x.payments.length,0);
  assert.deepEqual([m.planCreates,m.retiredPlans,m.paymentCreates,m.reversedPayments,m.journalOperations],[1,1,1,1,12]);
});
test('target is reference only; gross120000 with target100000 and remaining20000 is structurally valid',()=>{
  const p=F.payment({amountCents:120000,proof:F.proof({source:{amountCents:120000}})});
  const x=Core.validateExtension(committed().allocate(p,20000).finish());assert.equal(x.payments[0].amountCents,120000);assert.equal(x.plans[0].targetAmountCents,100000);assert.equal(x.plans[0].remainingConfirmation.amountCents,20000);
});
test('same-basis source capacity is enforced at every prefix despite later reversal',()=>{
  const b=committed().allocate(F.payment({amountCents:60000}),null).allocate(F.payment({id:'payment-2',amountCents:40001}),null);
  fails(b.finish(),'SPENDING_CAPACITY');b.reverse('payment-2',null);fails(b.finish(),'SPENDING_CAPACITY');
  const good=committed().allocate(F.payment({amountCents:60000}),null).allocate(F.payment({id:'payment-2',amountCents:40000}),null);assert.equal(Core.validateExtension(good.finish()).payments.length,2);
});
test('capacity is shared across plans for exact source/proof but distinct captured bases remain legitimate',()=>{
  const b=committed().createPlan(F.plan({id:'plan-2'})).commitPlan('plan-2').allocate(F.payment({amountCents:60000}),null).allocate(F.payment({id:'payment-2',planId:'plan-2',amountCents:40000}),null);
  assert.equal(Core.validateExtension(b.finish()).payments.length,2);
  const smaller=F.proof({source:{amountCents:90000}}), replacement=F.payment({id:'payment-new',amountCents:60000,proof:smaller});
  b.reconfirm('payment-1',replacement,null);let x=Core.validateExtension(b.finish());assert.equal(x.payments.length,2);assert.equal(x.plans[0].remainingConfirmation,null);
  b.reconfirm('payment-2',F.payment({id:'other-new',planId:'plan-2',amountCents:40000,proof:smaller}),null);fails(b.finish(),'SPENDING_CAPACITY');
});
test('atomic reconfirm updates exact link set without rejecting its transient mismatch',()=>{
  const b=committed().allocate(F.payment({amountCents:60000}),40000), p=F.payment({id:'replacement',amountCents:60000,proof:F.claimProof(1)});
  b.reconfirm('payment-1',p,30000);const x=Core.validateExtension(b.finish());assert.deepEqual(x.plans[0].remainingConfirmation.paymentIds,['replacement']);
  assert.equal(x.audit[3].changes.length,3);assert.equal(x.audit[3].changes[0].reverses,x.audit[2].id);
});
test('compound identical null-confirmation plan snapshots are permitted; metadata no-ops reject',()=>{
  const b=F.builder().createPlan(F.plan({remainingConfirmation:null})).commitPlan('plan-1',null).allocate(F.payment(),null);
  assert.deepEqual(b.extension.audit[2].changes[1].before,b.extension.audit[2].changes[1].after);assert.equal(Core.validateExtension(b.finish()).payments.length,1);
  b.reconfirm('payment-1',F.payment({id:'replacement',proof:F.claimProof(1)}),null).reverse('replacement',null);assert.equal(Core.validateExtension(b.finish()).payments.length,0);
  b.updatePlan('plan-1',{});fails(b.finish());
});
test('remaining is bound to captured economic date, not annotation review date or UTC timestamp day',()=>{
  const later={asOfDate:'2026-10-30'}, p=F.payment({reviewedAsOfDate:'2026-10-30',proof:F.proof({source:{date:'2026-10-10'}})});
  const b=committed().allocate(p,null,later).confirmRemaining('plan-1',90000,{asOfDate:'2026-10-14'});
  assert.equal(Core.validateExtension(b.finish()).plans[0].remainingConfirmation.reviewedAsOfDate,'2026-10-14');
  const badp=F.payment({reviewedAsOfDate:'2026-10-30',proof:F.proof({source:{date:'2026-10-20'}})});
  fails(committed().allocate(badp,null,later).confirmRemaining('plan-1',0,{asOfDate:'2026-10-14'}).finish());
});
test('authored confirmations and payment cutoff equal operation cutoff; preserved confirmation keeps original cutoff',()=>{
  const b=committed().allocate(F.payment(),90000);b.updatePlan('plan-1',{name:'Updated'},{asOfDate:'2026-10-20'}).cancelPlan('plan-1',{asOfDate:'2026-10-21'});assert.equal(Core.validateExtension(b.finish()).plans[0].remainingConfirmation.reviewedAsOfDate,F.AS_OF);
  const x=committed().allocate(F.payment(),90000).finish();x.audit[2].asOfDate='2026-10-15';fails(x);
  const y=F.builder().createPlan(F.plan({remainingConfirmation:F.confirmation(1,[],'2026-10-15')})).finish();fails(y);
  const backwards=F.builder().createPlan().updatePlan('plan-1',{name:'Backwards clock'},{at:'2026-10-01T00:00:00.000Z'}).finish();assert.equal(Core.validateExtension(backwards).revision,2);
});
test('remaining orphan/cross-plan/repeated/current-set mismatches reject',()=>{
  for(const ids of [[],['missing'],['payment-1','payment-1'],['payment-1','other']]){
    const b=committed().allocate(F.payment(),10000),op=b.extension.audit[2];op.changes[1].after.remainingConfirmation.paymentIds=ids;b.extension.plans[0].remainingConfirmation.paymentIds=ids;fails(b.finish(),['SPENDING_HISTORY','SPENDING_IDENTITY']);
  }
  const b=committed().allocate(F.payment(),null).createPlan(F.plan({id:'plan-2',remainingConfirmation:F.confirmation(0,['payment-1'])}));fails(b.finish());
});
test('all action transition fields and preconditions are enforced',()=>{
  const cases=[
    F.builder().createPlan(F.plan({stage:'committed',commitmentBasis:'x'})),
    F.builder().createPlan().allocate(F.payment(),null),
    committed().cancelPlan().allocate(F.payment(),null),
    committed().allocate(F.payment(),null).cancelPlan().returnToPlan('plan-1',null),
    committed().retirePlan(),
    committed().reopenPlan(),
    committed().commitPlan(),
    committed().cancelPlan().confirmRemaining('plan-1',0),
    committed().updatePlan('plan-1',{remainingConfirmation:null}),
    committed().transition('cancel-plan','plan-1',{status:'cancelled',targetAmountCents:123}),
    committed().transition('reopen-plan','plan-1',{status:'open'}),
  ];
  for(const b of cases)fails(b.finish());
});
test('payment immutability, exact original create reversal, identity never-reuse and revision continuity',()=>{
  const b=committed().allocate(F.payment(),null),x=b.finish();x.payments[0].amountCents--;fails(x);
  b.reverse('payment-1',null);const reversed=b.finish();reversed.audit[3].changes[0].reverses=reversed.audit[0].id;fails(reversed);
  b.allocate(F.payment(),null);fails(b.finish(),'SPENDING_IDENTITY');
  const gap=committed().finish();gap.audit[1].revision=3;fails(gap);
  const dupe=committed().finish();dupe.audit[1].id=dupe.audit[0].id;fails(dupe,'SPENDING_IDENTITY');
  const collision=committed().finish();collision.audit[1].id='plan-1';fails(collision,'SPENDING_IDENTITY');
  const reused=committed().cancelPlan().retirePlan().createPlan().finish();fails(reused,'SPENDING_IDENTITY');
});
test('reconfirm requires fresh ID, changed proof and unchanged economic attribution/reference',()=>{
  for(const patch of [{id:'payment-1'},{amountCents:9999},{transactionId:'source-2',proof:F.proof({source:{id:'source-2'}})},{reference:'changed'},{proof:F.proof()}]){
    const p=F.payment({id:'replacement',proof:F.claimProof(1),...patch}),b=committed().allocate(F.payment(),null).reconfirm('payment-1',p,null);fails(b.finish(),['SPENDING_HISTORY','SPENDING_IDENTITY']);
  }
});
test('missing/reordered/extra compound changes fail without partial replay',()=>{
  for(const mutation of [op=>op.changes.pop(),op=>op.changes.reverse(),op=>op.changes.push(F.clone(op.changes[1])),op=>op.changes[1].recordId='different-plan']){
    const x=committed().allocate(F.payment(),null).finish();mutation(x.audit[2]);fails(x);
  }
});
test('foreign typed borrowed identities may be reused between historical proofs',()=>{
  const old=F.claimProof(1);old.claims[0].id='removed-relation';
  const updated=F.proof({cashProfile:{id:'removed-relation',accountId:'account-1',role:'cash'}});
  const b=committed().allocate(F.payment({proof:old}),null).reconfirm('payment-1',F.payment({id:'replacement',proof:updated}),null);
  assert.equal(Core.validateExtension(b.finish()).payments[0].proof.cashProfile.id,'removed-relation');
});
test('current row and proof array ordering canonicalizes but journal order is immutable',()=>{
  const b=committed().allocate(F.payment({id:'z',amountCents:1,proof:F.duplicateProof(2)}),null).allocate(F.payment({id:'a',amountCents:1,proof:F.duplicateProof(2)}),null).createPlan(F.plan({id:'a-plan'}));
  const expected=Core.validateExtension(b.finish()),x=b.finish();x.plans.reverse();x.payments.reverse();for(const p of x.payments)p.proof.duplicateEvidence.reverse();
  assert.deepEqual(Core.validateExtension(x),expected);x.audit.reverse();fails(x);
});
