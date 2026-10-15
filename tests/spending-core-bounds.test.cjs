'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{performance}=require('node:perf_hooks');
const Core=require('../dist/spending-core.js'),F=require('./spending-core-fixtures.cjs');
function limit(fn,pattern){assert.throws(fn,e=>e instanceof Core.SpendingCoreError&&e.code==='SPENDING_LIMIT'&&(!pattern||pattern.test(e.message)));}
function measure(t,label,input){const memory=process.memoryUsage(),started=performance.now(),result=Core.validateExtension(input);t.diagnostic(JSON.stringify({label,elapsedMs:+(performance.now()-started).toFixed(2),heapDeltaBytes:process.memoryUsage().heapUsed-memory.heapUsed,rssBytes:process.memoryUsage().rss,...Core.metricsOf(result)}));return result;}
function many(plans,each){const b=F.builder();for(let p=0;p<plans;p++)b.createPlan(F.plan({id:'p-'+p,targetAmountCents:null,remainingConfirmation:null})).commitPlan('p-'+p,null);for(let p=0;p<plans;p++)for(let i=0;i<each;i++)b.allocate(F.payment({id:'r-'+p+'-'+i,planId:'p-'+p,amountCents:1}),null);return b;}
function history(ops){const b=F.builder().createPlan(F.plan({id:'p',name:'A',targetAmountCents:null,expectedDate:null,expectedAccountId:null,remainingConfirmation:null}));for(let i=1;i<ops;i++)b.updatePlan('p',{name:i%2?'B':'A'},{reason:'r',id:'e'+i});return b;}
test('200 active plans accepted; 201 historical prefix rejects after retiring back below limit',t=>{
  const b=F.builder();for(let i=0;i<200;i++)b.createPlan(F.plan({id:'p-'+i}));assert.equal(measure(t,'active-plans-200',b.finish()).plans.length,200);
  b.createPlan(F.plan({id:'p-200'}));limit(()=>Core.validateExtension(b.finish()));b.cancelPlan('p-200').retirePlan('p-200');limit(()=>Core.validateExtension(b.finish()),/prefix/);
});
test('100 payments per plan accepted;101 prefix rejects despite later reversal',t=>{
  const b=many(1,100);assert.equal(measure(t,'payments-per-plan-100',b.finish()).payments.length,100);
  b.allocate(F.payment({id:'extra',planId:'p-0',amountCents:1}),null);limit(()=>Core.validateExtension(b.finish()),/per plan/);b.reverse('extra',null);limit(()=>Core.validateExtension(b.finish()),/per plan/);
});
test('1000 active payments accepted;1001 prefix rejects despite later reversal',t=>{
  const b=many(10,100);assert.equal(measure(t,'active-payments-1000',b.finish()).payments.length,1000);
  b.createPlan(F.plan({id:'extra-plan'})).commitPlan('extra-plan',null).allocate(F.payment({id:'extra',planId:'extra-plan',amountCents:1}),null);limit(()=>Core.validateExtension(b.finish()));b.reverse('extra',null);limit(()=>Core.validateExtension(b.finish()),/prefix/);
});
test('200 total proof components accepted and201 rejected before normalization',()=>{
  assert.equal(Core.normalizeProof(F.duplicateProof(200)).duplicateEvidence.length,200);assert.equal(Core.normalizeProof(F.claimProof(200)).claims.length,200);assert.equal(Core.normalizeProof(F.refundProof(200)).refunds.length,200);
  for(const p of [F.duplicateProof(201),F.claimProof(201),F.refundProof(201)])limit(()=>Core.normalizeProof(p));
  const p=F.duplicateProof(100);p.refunds=F.refundProof(50).refunds;p.claims=F.claimProof(50).claims;assert.equal(Core.normalizeProof(p).claims.length,50);p.claims.push(F.claimProof(51).claims[50]);limit(()=>Core.normalizeProof(p),/component/);
});
test('proof and remaining metrics charge every current/history occurrence',()=>{
  const p=F.duplicateProof(2);p.refunds=F.refundProof(3).refunds;p.claims=F.claimProof(4).claims;
  const b=F.builder().createPlan().commitPlan().allocate(F.payment({proof:p}),90000).allocate(F.payment({id:'second',proof:p}),80000);
  let m=Core.metricsOf(Core.validateExtension(b.finish()));assert.equal(m.proofOccurrences,4);assert.equal(m.basisCells,4*(2+4+6+4));assert.equal(m.remainingReferenceCells,6);
  b.reverse('payment-1',null);m=Core.metricsOf(Core.validateExtension(b.finish()));assert.equal(m.proofOccurrences,4);assert.equal(m.basisCells,64);assert.equal(m.remainingReferenceCells,6);
});
test('100000 basis-cell preflight passes its dimension but byte ceiling rejects;100001 rejects cells first',t=>{
  // Proof cost402.124*402+152=50000; persisted current+create doubles it.
  const b=F.builder().createPlan(F.plan({id:'p-0',remainingConfirmation:null})).commitPlan('p-0',null).createPlan(F.plan({id:'p-1',remainingConfirmation:null})).commitPlan('p-1',null);
  const big=F.duplicateProof(200);for(let i=0;i<124;i++)b.allocate(F.payment({id:'r-'+i,planId:i<100?'p-0':'p-1',amountCents:1,proof:big}),null);
  const last=F.duplicateProof(75);b.allocate(F.payment({id:'last',planId:'p-1',amountCents:1,proof:last}),null);
  const x=b.finish(),started=performance.now();limit(()=>Core.validateExtension(x),/JSON UTF-8 byte budget/);t.diagnostic(JSON.stringify({label:'basis-cells-100000',bytes:Buffer.byteLength(JSON.stringify(x)),elapsedMs:+(performance.now()-started).toFixed(2),outcome:'Dimension passes; independent8MiB ceiling rejects'}));
  x.payments[x.payments.length-1].proof.claims=F.claimProof(1).claims;limit(()=>Core.validateExtension(x),/basis cells/);
});
test('100000 remaining-reference cells accepted;100001 is preflight-only odd boundary rejection',t=>{
  const b=many(1,100).confirmRemaining('p-0',100); // First snapshot contributes200 cells.
  for(let i=0;i<499;i++)b.updatePlan('p-0',{name:i%2?'A':'B'}); // Each retained snapshot contributes200 more.
  const x=b.finish(),result=measure(t,'remaining-reference-cells-100000',x);assert.equal(Core.metricsOf(result).remainingReferenceCells,100000);
  // An extra one-cell current confirmation cannot be a valid complete history;
  // this boundary explicitly tests raw resource preflight before replay/copies.
  x.plans.push(F.plan({id:'unreplayed',remainingConfirmation:F.confirmation(1,['r-0-0'])}));limit(()=>Core.validateExtension(x),/remaining-reference/);
});
test('12000 operations accepted,12001 rejected; normalized8MiB exact and plus1',t=>{
  const b=history(12000),x=b.finish(),result=measure(t,'operations-12000',x);assert.equal(Core.metricsOf(result).journalOperations,12000);
  b.updatePlan('p',{name:'C'},{reason:'r'});limit(()=>Core.validateExtension(b.finish()));
  let left=Core.LIMITS.planningBytes-Buffer.byteLength(JSON.stringify(x));assert.ok(left>0);for(const op of x.audit){const n=Math.min(500-op.reason.length,left);op.reason+='x'.repeat(n);left-=n;if(!left)break;}assert.equal(left,0);
  assert.equal(Core.metricsOf(measure(t,'normalized-extension-8MiB',x)).jsonBytes,Core.LIMITS.planningBytes);
  const op=x.audit.find(o=>o.reason.length<498),reason=op.reason;op.reason=' '+reason+' ';assert.equal(Core.inspectData(x).jsonBytes,Core.LIMITS.planningBytes+2);assert.equal(Core.metricsOf(Core.validateExtension(x)).jsonBytes,Core.LIMITS.planningBytes);
  op.reason=reason+'x';limit(()=>Core.validateExtension(x),/JSON UTF-8 byte budget/);
});
test('ever6000 entity dimension reaches byte ceiling;6001 rejects at entity budget without exceeding12000 operations',t=>{
  const b=F.builder().createPlan(F.plan({targetAmountCents:null,remainingConfirmation:null})).commitPlan('plan-1',null);
  for(let i=0;i<5998;i++){const key='old-'+i;b.allocate(F.payment({id:key,amountCents:1}),null).reverse(key,null);}
  b.allocate(F.payment({id:'last-one',amountCents:1}),null);const x=b.finish();assert.equal(x.audit.length,11999);const started=performance.now();limit(()=>Core.validateExtension(x),/JSON UTF-8 byte budget/);
  t.diagnostic(JSON.stringify({label:'ever-6000',operations:x.audit.length,bytes:Buffer.byteLength(JSON.stringify(x)),elapsedMs:+(performance.now()-started).toFixed(2),outcome:'Entity dimension passes; independent8MiB ceiling rejects'}));
  b.allocate(F.payment({id:'last-two',amountCents:1}),null);assert.equal(b.extension.audit.length,12000);limit(()=>Core.validateExtension(b.finish()),/Ever-created/);
});
test('canonical8MiB/32MiB exact byte boundaries count Unicode and JSON escaping',t=>{
  for(const maxBytes of [Core.LIMITS.resultBytes,Core.LIMITS.backupBytes]){const value='x'.repeat(maxBytes-2),started=performance.now();assert.equal(Core.inspectData(value).jsonBytes,maxBytes);assert.equal(Buffer.byteLength(Core.canonicalData(value,{maxBytes})),maxBytes);limit(()=>Core.canonicalData(value+'x',{maxBytes}));t.diagnostic(JSON.stringify({label:'canonical-bytes',maxBytes,elapsedMs:+(performance.now()-started).toFixed(2)}));}
  for(const unit of ['汉','😀','\ud800','\u0000']){const bytes=Buffer.byteLength(JSON.stringify(unit))-2,count=Math.floor((Core.LIMITS.resultBytes-2)/bytes),tail=Core.LIMITS.resultBytes-2-count*bytes,value=unit.repeat(count)+'x'.repeat(tail);assert.equal(Core.inspectData(value).jsonBytes,Core.LIMITS.resultBytes);limit(()=>Core.canonicalData(value+'x',{maxBytes:Core.LIMITS.resultBytes}));}
});
test('deep ordinary inspection/canonicalization is iterative; oversized sparse arrays reject without getter execution',()=>{
  let x=null;for(let i=0;i<20000;i++)x=[x];assert.equal(Core.inspectData(x).nodeCount,20001);assert.equal(Core.canonicalData(x,{maxBytes:Core.LIMITS.resultBytes}).length,40004);
  let touched=0;const a=new Array(Core.LIMITS.dataNodes);Object.defineProperty(a,'0',{enumerable:true,get(){touched++;return null;}});limit(()=>Core.inspectData(a));assert.equal(touched,0);
});
test('raw safety-only inspect can exceed32MiB aggregate before harmless normalization; unsafe scalar integers reject',()=>{
  const raw={a:' '.repeat(16*1024*1024)+'x',b:' '.repeat(16*1024*1024)+'y'};assert.ok(Core.inspectData(raw).jsonBytes>Core.LIMITS.backupBytes);limit(()=>Core.canonicalData(raw,{maxBytes:Core.LIMITS.backupBytes}));assert.equal(Core.canonicalData({a:raw.a.trim(),b:raw.b.trim()},{maxBytes:Core.LIMITS.backupBytes}),'{"a":"x","b":"y"}');
  assert.throws(()=>Core.inspectData(Number.MAX_SAFE_INTEGER+1),e=>e.code==='SPENDING_AMOUNT');
});
test('work counters track operation changes and persisted proof occurrences without financial model dependencies',t=>{
  const observed=[];for(const n of [1,25,100]){const result=measure(t,'linear-payments-'+n,many(1,n).finish()),m=Core.metricsOf(result);observed.push([m.journalOperations,m.changeCount,m.proofOccurrences,m.basisCells]);}
  assert.deepEqual(observed,[[3,4,2,4],[27,52,50,100],[102,202,200,400]]);
});
