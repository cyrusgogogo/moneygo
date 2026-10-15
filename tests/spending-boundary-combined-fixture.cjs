'use strict';
const assert=require('node:assert/strict');
const F=require('./spending-model-fixtures.cjs'), I=require('./income-root-fixture.cjs');
const oldL=require('./fixtures/spending-readers-v016/ledger'),oldR=require('./fixtures/spending-readers-v016/relations');
const {L,R,P,copy,tx}=F;
function oldState(state){const old=copy(state);delete old.spendingPlanning;old.version=old.incomePlanning?7:old.obligations?6:old.organizer?5:old.bookkeeping?4:old.imports?3:old.simulation?2:1;return oldL.validateState(old);}
function economic(state){return oldR.calculate(oldState(state));}
let cached;
function combined(){
  if(cached)return copy(cached);
  let state=I.combined().state;
  state.simulation.version=2;state.simulation.exclusions=state.simulation.exclusions.map(value=>typeof value==='string'?{kind:'transaction-expense',id:value}:value);
  state.simulation.exclusions.push({kind:'held-recognition',id:state.bookkeeping.heldRecognitions[0].id});
  state=L.validateState(state);const original=copy(state),ids={};
  for(const key of ['a','missing','stale','future','cancelled','reversed'])state.transactions.push(tx('spending-combined-'+key,'expense',10000,key==='future'?'2026-10-15':'2026-10-01'));
  state.transactions.push(tx('spending-combined-refund','income',1000));state=L.validateState(state);
  const run=(command,asOfDate='2026-10-14')=>{const before=oldState(state),financial=economic(state),api=F.coordinator('2026-10-15T12:00:00.000Z','2026-10-15');const ticket=api.preview(state,command,{asOfDate});state=api.commit(state,ticket,{confirmed:true,reason:'SYNTHETIC complete combined backup acceptance'});assert.deepEqual(oldState(state),before);assert.deepEqual(economic(state),financial);return ticket;};
  const plan=(key,commit=true)=>{const ticket=run(F.plan({name:'Synthetic combined '+key,targetAmountCents:10000},10000));ids[key]=ticket.review.plan.planId;if(commit)run({action:'commit-plan',planId:ids[key],commitmentBasis:'Synthetic merchant instruction',remainingAfterCents:10000});};
  const allocate=(key,amountCents=500)=>run({action:'allocate-payment',planId:ids[key],transactionId:'spending-combined-'+(key==='main'?'a':key),amountCents,reference:'Synthetic combined proof',remainingAfterCents:10000-amountCents},key==='future'?'2026-10-15':'2026-10-14');
  plan('main');allocate('main',1000);const prior=state.spendingPlanning.payments.find(p=>p.planId===ids.main).id;state=L.putTransaction(state,{...state.transactions.find(t=>t.id==='spending-combined-a'),amountCents:9000},'spending-combined-a');run({action:'reconfirm-payment',paymentId:prior,remainingAfterCents:9000});
  plan('missing');allocate('missing');state=L.deleteTransaction(state,'spending-combined-missing');
  plan('stale');allocate('stale');state=R.allocateRefund(state,{incomeId:'spending-combined-refund',expenseId:'spending-combined-stale',amountCents:100,reason:'Synthetic current refund correction'});
  plan('future');allocate('future');
  plan('cancelled');allocate('cancelled');run({action:'cancel-plan',planId:ids.cancelled});
  plan('retired',false);run({action:'cancel-plan',planId:ids.retired});run({action:'retire-plan',planId:ids.retired});
  plan('reversed');allocate('reversed');run({action:'reverse-payment',paymentId:state.spendingPlanning.payments.find(p=>p.planId===ids.reversed).id,remainingAfterCents:null});
  plan('planned',false);
  assert.deepEqual(state.incomePlanning,original.incomePlanning);assert.deepEqual(state.organizer.closes,original.organizer.closes);
  cached={state:L.validateState(state),ids,oldCounts:L.verifyBackup(L.backup(oldState(state))).counts};return copy(cached);
}
module.exports={...F,oldL,oldR,oldState,economic,combined};
