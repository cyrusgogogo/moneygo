'use strict';
const {test}=require('node:test'),path=require('node:path'),{createRequire}=require('node:module');
const {A,fs,root,L,R,copy,bytes,tx,base,command,coordinator,from,now,rejects}=require('./refund-receipts-independent-fixtures.cjs');
function instrument(mutate){const file=path.join(root,'dist/refund-receipts.js'),req=createRequire(file),m={exports:{}};let calls=0;const actual=[];new Function('require','module','exports',fs.readFileSync(file,'utf8'))(name=>{const dependency=req(name);if(name==='./relations.js')return {...dependency,allocateRefund(s,q){calls++;const out=dependency.allocateRefund(s,q);actual.push(copy(out));return calls===2?mutate(copy(out),s,q):out;}};return dependency;},m,m.exports);return {api:m.exports,calls:()=>calls,actual};}
function ready(){let s=base([tx('expense','expense',10000,'2026-09-01'),tx('receipt','income',5000),tx('old-income','income',1000,'2026-10-09')]);return R.allocateRefund(s,command({incomeId:'old-income',amountCents:1000,reason:'Existing independent history'}));}
function engine(api){return api.createCoordinator({today:()=> '2026-10-14',now:()=>now});}
test('RR independent replay: genuine public writer timestamp drift alone remains accepted',async()=>{
 const p=instrument(x=>x),s=ready(),c=engine(p.api),t=c.preview(s,command());await new Promise(resolve=>setTimeout(resolve,10));const out=c.commit(s,t,{confirmed:true}),r=out.bookkeeping.refunds.at(-1),a=out.bookkeeping.audit.at(-1);A.equal(p.calls(),2);A.notEqual(r.createdAt,p.actual[0].bookkeeping.refunds.at(-1).createdAt);A.equal(r.createdAt,a.at);A.equal(r.createdAt,a.after.createdAt);A.deepEqual(out,p.actual[1]);A.deepEqual(out.bookkeeping.audit.slice(0,-1),s.bookkeeping.audit);A.deepEqual(L.validateState(out),out);
});
const mutations=[
 ['fresh-refund-id',out=>{const r=out.bookkeeping.refunds.at(-1),a=out.bookkeeping.audit.at(-1);r.id='new-unreviewed-refund';a.recordId=r.id;a.after.id=r.id;}],
 ['fresh-audit-id',out=>{out.bookkeeping.audit.at(-1).id='new-unreviewed-audit';}],
 ['new-reason',out=>{const r=out.bookkeeping.refunds.at(-1),a=out.bookkeeping.audit.at(-1);r.reason='Different unreviewed reason';a.reason=r.reason;a.after.reason=r.reason;}],
 ['amount',out=>{const r=out.bookkeeping.refunds.at(-1),a=out.bookkeeping.audit.at(-1);r.amountCents++;a.after.amountCents++;}],
 ['signature',out=>{const r=out.bookkeeping.refunds.at(-1),a=out.bookkeeping.audit.at(-1);r.incomeSignature.amountCents++;a.after.incomeSignature.amountCents++;}],
 ['old-timestamp',out=>{const r=out.bookkeeping.refunds[0],a=out.bookkeeping.audit.find(a=>a.recordId===r.id);r.createdAt='2001-01-01T00:00:00.000Z';a.at=r.createdAt;a.after.createdAt=r.createdAt;}],
 ['old-row-note',out=>{out.transactions.find(t=>t.id==='old-income').note='Changed old source';}],
 ['unrelated-account',out=>{out.accounts.find(a=>a.id==='bank').name='Changed unrelated account';}],
 ['audit-at-mismatch',out=>{out.bookkeeping.audit.at(-1).at='2001-01-01T00:00:00.000Z';}],
 ['audit-after-timestamp-mismatch',out=>{out.bookkeeping.audit.at(-1).after.createdAt='2001-01-01T00:00:00.000Z';}],
 ['new-extra-field',out=>{out.bookkeeping.refunds.at(-1).unreviewed=true;}],
 ['revision',out=>{out.bookkeeping.revision++;out.bookkeeping.audit.at(-1).revision++;}],
 ['old-audit-prefix',out=>{out.bookkeeping.audit.shift();}],
 ['additional-generated-refund',out=>{out.bookkeeping.refunds.push(copy(out.bookkeeping.refunds.at(-1)));}],
];
for(const [label,mutate]of mutations)test('RR independent replay: reject every unreviewed mutation '+label,()=>{
 const p=instrument(out=>{mutate(out);return out;}),s=ready(),before=bytes(s),c=engine(p.api),t=c.preview(s,command());A.throws(()=>c.commit(s,t,{confirmed:true}),undefined,label);A.equal(bytes(s),before);A.equal(p.calls(),2);A.throws(()=>c.commit(s,t,{confirmed:true}));A.equal(p.calls(),2,'recognized failure burns identity before repeated writer');
});
test('RR independent replay: writer exception with hostile own getters is safely bounded',()=>{
 let reads=0;const hostile={};Object.defineProperties(hostile,{message:{get(){reads++;throw Error('message getter');}},code:{get(){reads++;throw Error('code getter');}}});const p=instrument(()=>{throw hostile;}),s=ready(),c=engine(p.api),t=c.preview(s,command());A.throws(()=>c.commit(s,t,{confirmed:true}),e=>e.code==='RR_WRITER_REJECTED');A.equal(reads,0);A.equal(p.calls(),2);A.throws(()=>c.commit(s,t,{confirmed:true}));A.equal(p.calls(),2);
});
