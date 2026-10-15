'use strict';
const {base,tx,options}=require('./held-a-fixtures.cjs');
function historyFixture({positions=500,children=5000,updates=0,retired=0,concentrated=false,dateBuckets=false}={}){
 const s=base(Array.from({length:positions||1},(_,i)=>tx('source'+i,'expense',100000,dateBuckets?'2025-01-01':'2026-01-01'))),d={version:4,revision:0,links:[],refunds:[],claims:[],settlements:[],snapshots:[],refundPlans:[],transferPairs:[],composites:[],heldPositions:[],heldRecognitions:[],heldReturns:[],audit:[]};s.bookkeeping=d;
 function event(kind,action,before,after,reverses=null){const revision=d.audit.length+1,e={id:'audit'+revision,revision,at:options.at,kind,recordId:(before||after).id,action,reason:'x',before,after,asOfDate:'2026-04-15',reverses};d.audit.push(e);return e;}
 function pos(id,expenseId){return {id,createdAt:options.at,asOfDate:'2026-04-15',kind:'deposit',name:'x',purpose:'',reference:'',expenseId,expenseSignature:{type:'expense',date:dateBuckets?'2025-01-01':'2026-01-01',amountCents:100000,accountId:'cash-a',toAccountId:null},amountCents:100000,expiry:{kind:'unknown',date:null},refundability:'unknown',terms:'',termsSource:'',confirmations:{paidPrincipalOnly:true,noTrackedWalletOverlap:true},reason:'x'};}
 for(let i=0;i<positions;i++){const p=pos('position'+i,'source'+i);d.heldPositions.push(p);event('heldPosition','create',null,p);}
 for(let i=0;i<children;i++){const p=d.heldPositions[concentrated?Math.floor(i/200):i%positions],r={id:'recognition'+i,createdAt:options.at,asOfDate:'2026-04-15',positionId:p.id,kind:i%2?'use':'loss',amountCents:1,effectiveDate:dateBuckets?new Date(Date.UTC(2025,0,2+i%200)).toISOString().slice(0,10):'2026-02-01',categoryId:'category-personal',categoryProof:{id:'category-personal',type:'expense',name:'Personal'},merchant:null,reference:'',confirmations:{notAlreadyRecordedAsExpense:true},reason:'x'};d.heldRecognitions.push(r);event('heldRecognition','create',null,r);}
 for(let i=0;i<updates;i++){const index=concentrated?0:i%positions,before=d.heldPositions[index],after={...before,name:i%2?'a':'b'};d.heldPositions[index]=after;event('heldPosition','update',before,after);}
 for(let i=0;i<retired;i++){const p=pos('retired'+i,'source0'),e=event('heldPosition','create',null,p);event('heldPosition','unlink',p,null,e.id);}
 d.revision=d.audit.length;return s;
}
module.exports={historyFixture};
