'use strict';
const {test}=require('node:test');
const F=require('./refund-receipts-independent-fixtures.cjs');
const {A,L,R,I,S,day,bytes,tx,allocate,conform,closure,normalizeNewTime}=F;
// The inherited helpers assemble validator-valid duplicate-link journals. The
// planning attribution itself is made by each unchanged public planner writer
// at its genuine 200-component boundary before a 201st component is introduced.
for(const planner of ['income','spending'])test('RR independent inherited planner limit: complete '+planner+' unsupported proof remains unknown and stored bytes unchanged',()=>{
 let s,cmd,key,P,stored,kind;
 if(planner==='income'){
  s=I.allocate(I.apply(I.linked(200),I.plan()),40000);s=I.linked(201,s);s.transactions.push(tx('expense','expense',100000,'2026-09-01'));
  cmd={expenseId:'expense',incomeId:'source',amountCents:1};key='incomePlanning';P=I.P;kind='receipts';
 }else{
  s=S.allocate(S.committed(S.linked(200)),40000,60000);s=S.linked(201,s);s.transactions.push(tx('receipt','income',5000,'2026-10-10'));
  cmd={expenseId:'source',incomeId:'receipt',amountCents:1};key='spendingPlanning';P=S.P;kind='payments';
 }
 s=L.validateState(s);stored=bytes(s[key]);const before=P.view(s,{asOfDate:day}),source=planner==='income'?before.sources.find(r=>r.transactionId==='source'):P.source(s,{asOfDate:day,transactionId:'source'});
 A.equal(source.basisStatus,'unsupported');if(planner==='spending')A.equal(source.currentProof,null);else{A.equal(source.applicableAttributedCents,null);A.equal(source.unassociatedOrdinaryCents,null);}A.equal(before[kind][0].applicability,'unsupported-basis');A.equal(s.bookkeeping.links.length,201);
 const {ticket,state}=allocate(s,cmd),r=ticket.review,refs=closure(r);conform(ticket,'ticket');F.authoritativeProof(r,s,state);
 A.equal(bytes(s[key]),stored);A.equal(bytes(state[key]),stored);A.deepEqual(normalizeNewTime(state),normalizeNewTime(R.allocateRefund(s,F.command(cmd))));
 const effect=r.effects.planningAttributions.find(e=>e.planner===planner);A.ok(effect);A.equal(effect.beforeApplicability,'unsupported-basis');A.equal(effect.afterApplicability,'unsupported-basis');A.equal(effect.storedBytesUnchanged,true);
 for(const ref of [effect.beforeSourceViewRef,effect.afterSourceViewRef]){const v=refs.get(ref).value;A.equal(v.basisStatus,'unsupported');if(planner==='spending')A.equal(v.currentProof,null);else{A.equal(v.applicableAttributedCents,null);A.equal(v.unassociatedOrdinaryCents,null);}A.ok(v.reasonCodes.includes('proof-limit'));}
 for(const ref of [effect.beforeViewRef,effect.afterViewRef])A.equal(refs.get(ref).value.applicability,'unsupported-basis');
 A.ok(r.warnings.some(w=>w.code==='planning-proof-unknown'));for(const phase of ['before','after'])A.equal(r.proof.entries.filter(e=>e.phase===phase&&e.kind==='duplicate-link').length,201,'complete current duplicate closure '+phase);
 A.equal(L.validateState(state).bookkeeping.refunds.at(-1).amountCents,1);
});
