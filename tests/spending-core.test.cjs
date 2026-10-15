'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const Core = require('../dist/spending-core.js'), F = require('./spending-core-fixtures.cjs');
const fails = (fn, code) => assert.throws(fn, e => e instanceof Core.SpendingCoreError && (!code || (Array.isArray(code) ? code.includes(e.code) : e.code === code)));
const valid = () => F.builder().createPlan().commitPlan().allocate(F.payment(), 90000).finish();
test('exact frozen spending facade, limits, result and metrics contracts', () => {
  assert.deepEqual(Object.keys(Core).sort(), ['validateExtension','normalizePlan','normalizeProof','normalizeReason','basisKey','inspectData','canonicalData','metricsOf','LIMITS','SpendingCoreError'].sort());
  const x = Core.validateExtension(valid()), m = Core.metricsOf(x);
  assert.deepEqual(Object.keys(m).sort(), ['jsonBytes','nodeCount','journalOperations','changeCount','proofOccurrences','basisCells','remainingReferenceCells','planCreates','paymentCreates','currentPlans','cancelledPlans','retiredPlans','currentPayments','reversedPayments','maxActivePlans','maxActivePayments','maxPaymentsPerPlan','everEntityIds'].sort());
  assert.deepEqual([m.journalOperations,m.changeCount,m.proofOccurrences,m.basisCells,m.remainingReferenceCells,m.everEntityIds], [3,4,2,4,2,2]);
  assert.ok(Object.isFrozen(Core) && Object.isFrozen(x) && Object.isFrozen(x.audit[2].changes[0].after.proof.source) && Object.isFrozen(m));
  fails(() => Core.metricsOf(F.clone(x)), 'SPENDING_INVALID_RECORD');
  assert.equal(m.jsonBytes, Buffer.byteLength(JSON.stringify(x)));
});
test('unknown target/date/account and zero versus unknown remaining remain explicit', () => {
  const p = Core.normalizePlan(F.plan({ targetAmountCents: null, expectedDate: null, expectedAccountId: null, remainingConfirmation: null }));
  assert.equal(p.targetAmountCents, null); assert.equal(p.expectedDate, null); assert.equal(p.expectedAccountId, null); assert.equal(p.remainingConfirmation, null);
  assert.equal(Core.normalizePlan(F.plan({ remainingConfirmation: F.confirmation(0) })).remainingConfirmation.amountCents, 0);
});
test('gross source100000 with refund20000 claim30000 stays gross100000', () => {
  const p = F.refundProof(1); p.refunds[0].amountCents = 20000; p.claims = F.claimProof(1).claims; p.claims[0].amountCents = 30000;
  assert.equal(Core.normalizeProof(p).grossPaymentCents, 100000);
  p.grossPaymentCents = 50000; fails(() => Core.normalizeProof(p), 'SPENDING_PROOF');
  p.grossPaymentCents = 100000; p.claims[0].amountCents = 80001; fails(() => Core.normalizeProof(p), 'SPENDING_PROOF');
});
test('refund income aggregate and exact shared signature are enforced', () => {
  const p = F.refundProof(2); for (const r of p.refunds) { r.incomeSignature.amountCents = 10000; r.amountCents = 10000; }
  fails(() => Core.normalizeProof(p), 'SPENDING_PROOF');
  p.refunds[1].amountCents = 1; p.refunds[0].amountCents = 9999;
  assert.equal(Core.normalizeProof(p).refunds.length, 2);
  p.refunds[1].incomeSignature.date = '2026-10-02'; fails(() => Core.normalizeProof(p), 'SPENDING_PROOF');
});
test('proof components canonicalize and same-proof owner collisions fail', () => {
  const p = F.duplicateProof(2); p.refunds = F.refundProof(2).refunds; p.claims = F.claimProof(2).claims;
  const key = Core.basisKey(p); p.duplicateEvidence.reverse(); p.refunds.reverse(); p.claims.reverse(); assert.equal(Core.basisKey(p), key);
  for (const id of ['source-1','account-1','shadow-0','refund-income-1','refund-0','claim-0','duplicate-0']) {
    const bad = F.clone(p); bad.cashProfile.id = id; fails(() => Core.normalizeProof(bad), 'SPENDING_PROOF');
  }
  const d = F.clone(p); d.claims[0].id = d.refunds[0].id; fails(() => Core.normalizeProof(d), 'SPENDING_PROOF');
  const s = F.clone(p); s.duplicateEvidence[1].shadowId = s.duplicateEvidence[0].shadowId; s.duplicateEvidence[1].shadowSignature.id = s.duplicateEvidence[0].shadowId; fails(() => Core.normalizeProof(s), 'SPENDING_PROOF');
});
test('missing and unexpected fields, versions, enums, ID and text controls reject', () => {
  for (const bad of [{...F.plan(), extra: true}, (() => { const p=F.plan(); delete p.note; return p; })(), {...F.plan(), stage:'actual'}, {...F.plan(), status:'done'}]) fails(() => Core.normalizePlan(bad));
  fails(() => Core.validateExtension({version:2,revision:0,plans:[],payments:[],audit:[]}), 'SPENDING_VERSION');
  for (const id of ['', 'constructor', 'prototype', 'a'.repeat(101), ' x', 'x.y']) fails(() => Core.normalizePlan(F.plan({id})), 'SPENDING_ID');
  for (const name of ['', ' ', '\n', 'x'.repeat(81), 'x\x7f']) fails(() => Core.normalizePlan(F.plan({name})), 'SPENDING_TEXT');
  assert.equal(Core.normalizeReason('  meaningful\nreview  '), 'meaningful\nreview');
  fails(() => Core.normalizeReason(' '), 'SPENDING_TEXT');
});
test('integer cents reject zero payment, negatives, fractions, nonfinite and unsafe values', () => {
  for (const amount of [0,-1,-0,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) {
    const x = valid(); x.payments[0].amountCents = amount; fails(() => Core.validateExtension(x), ['SPENDING_AMOUNT','SPENDING_INVALID_DATA']);
  }
  for (const amount of [-1,-0,1.2,1000000000000]) fails(() => Core.normalizePlan(F.plan({remainingConfirmation:F.confirmation(amount)})), ['SPENDING_AMOUNT','SPENDING_INVALID_DATA']);
});
test('calendar and canonical timestamp boundaries use real days without ambient clock', () => {
  for (const day of ['0000-01-01','1900-02-29','2026-02-29','2026-04-31','2026-1-01','10000-01-01']) fails(() => Core.normalizePlan(F.plan({expectedDate:day})), 'SPENDING_DATE');
  for (const day of ['0001-01-01','2000-02-29','2024-02-29','9999-12-31']) assert.equal(Core.normalizePlan(F.plan({expectedDate:day})).expectedDate, day);
  for (const at of ['2026-10-14T12:00:00Z','2026-10-14T24:00:00.000Z','2026-02-30T12:00:00.000Z']) fails(() => Core.normalizePlan(F.plan({createdAt:at})), 'SPENDING_DATE');
});
test('ordinary cross-realm/null-prototype values accepted without invoking accessors', () => {
  const raw=valid(), cross=vm.runInNewContext('('+JSON.stringify(raw)+')'); assert.deepEqual(Core.validateExtension(cross), Core.validateExtension(raw));
  const p=Object.assign(Object.create(null),F.plan()); assert.deepEqual(Core.normalizePlan(p),Core.normalizePlan(F.plan()));
  let touched=0;
  for (const field of ['version','plans','audit']) { const x=valid(); Object.defineProperty(x,field,{enumerable:true,get(){touched++;throw Error('getter');}}); fails(()=>Core.validateExtension(x)); }
  const p2=F.plan(); Object.defineProperty(p2,'name',{enumerable:true,get(){touched++;return 'x';}}); fails(()=>Core.normalizePlan(p2));
  const p3=F.proof(); p3.toJSON=()=>{touched++;return {};}; fails(()=>Core.normalizeProof(p3)); assert.equal(touched,0);
});
test('symbols, cycles, sparse/custom arrays and custom prototype impersonation reject', () => {
  const cyclic={}; cyclic.self=cyclic; fails(()=>Core.inspectData(cyclic));
  const symbol=F.plan(); symbol[Symbol('x')]=1; fails(()=>Core.normalizePlan(symbol));
  for (const a of [new Array(2), Object.assign([], {extra:1}), Object.setPrototypeOf([],null), Object.setPrototypeOf([],{})]) fails(()=>Core.inspectData(a));
  fails(()=>Core.normalizePlan(Object.assign(Object.create({}),F.plan())));
  const fake=Object.create(null); Object.defineProperty(fake,'constructor',{value:Object}); fails(()=>Core.normalizePlan(Object.assign(Object.create(fake),F.plan())));
});
test('throwing proxies normalize to stable invalid-data and never escape as raw exceptions', () => {
  for (const trap of ['getPrototypeOf','ownKeys','getOwnPropertyDescriptor']) {
    const p=new Proxy(F.plan(),{[trap](){throw Error('trap');}}); fails(()=>Core.normalizePlan(p),'SPENDING_INVALID_DATA');
  }
});
test('generic canonical keys, JSON string encoding and safety inspection are exact', () => {
  const data={z:'汉😀\ud800\u0000\n"\\',a:[true,false,null,123,1.5]};
  assert.equal(Core.inspectData(data).jsonBytes,Buffer.byteLength(JSON.stringify(data)));
  assert.equal(Core.canonicalData(data,{maxBytes:Core.LIMITS.resultBytes}),JSON.stringify({a:data.a,z:data.z}));
  fails(()=>Core.canonicalData(data,{})); fails(()=>Core.canonicalData(data,{maxBytes:1}));
});
test('descriptor-varying proxies cannot undercount normalized proof or remaining cells', () => {
  const x=F.builder().createPlan(F.plan({remainingConfirmation:null})).commitPlan('plan-1',null).allocate(F.payment(),0).finish();
  const full=F.claimProof(1);let proofReads=0;
  const varyingProof=new Proxy(full,{getOwnPropertyDescriptor(target,key){const d=Reflect.getOwnPropertyDescriptor(target,key);if(key==='claims'){proofReads++;return {...d,value:proofReads>2&&proofReads<=4?[]:target.claims};}return d;}});
  x.payments[0].proof=varyingProof;x.audit[2].changes[0].after.proof=varyingProof;
  let confirmationReads=0;const fullConfirmation=F.confirmation(0,['payment-1']);
  const varyingConfirmation=new Proxy(fullConfirmation,{getOwnPropertyDescriptor(target,key){const d=Reflect.getOwnPropertyDescriptor(target,key);if(key==='paymentIds'){confirmationReads++;return {...d,value:confirmationReads>2&&confirmationReads<=4?[]:target.paymentIds};}return d;}});
  x.plans[0].remainingConfirmation=varyingConfirmation;x.audit[2].changes[1].after.remainingConfirmation=varyingConfirmation;
  const normalized=Core.validateExtension(x),metrics=Core.metricsOf(normalized);
  assert.equal(metrics.basisCells,6);assert.equal(metrics.remainingReferenceCells,2);assert.equal(normalized.payments[0].proof.claims.length,1);
});
