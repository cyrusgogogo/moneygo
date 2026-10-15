'use strict';
const A=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),vm=require('node:vm');
const ROOT=process.env.MONEYGO_REVIEW_ROOT||path.resolve(__dirname,'..');
const L=require(ROOT+'/dist/ledger.js'),R=require(ROOT+'/dist/relations.js'),O=require(ROOT+'/dist/obligations.js'),P=require(ROOT+'/dist/spending-planning.js'),C=require(ROOT+'/dist/spending-core.js'),I=require(ROOT+'/dist/income-planning.js');
const F=require('./spending-independent-oracle.cjs'),copy=F.clone,day='2026-10-14',at='2026-10-14T12:00:00.000Z',opt={asOfDate:day};
const coord=(today='2026-11-01')=>P.createCoordinator({now:()=>at,today:()=>today});
function frozen(value){if(value&&typeof value==='object'){A.ok(Object.isFrozen(value));for(const x of Object.values(value))frozen(x);}}
function run(state,command,asOfDate=day,c=coord()){const raw=JSON.stringify(state),t=c.preview(state,command,{asOfDate});A.equal(JSON.stringify(state),raw,'preview leaves input unchanged');frozen(t);const next=c.commit(state,t,{confirmed:true,reason:'Independent explicit user review'});A.equal(JSON.stringify(state),raw,'commit leaves input unchanged');F.preserve(state,next);frozen(next);A.equal(next.version,8);A.equal(t.review.unchangedSubtrees.allOtherSubtreesEqual,true);A.deepEqual(t.review.unchangedSubtrees.allowedChangedPaths,['version','spendingPlanning']);for(const key of ['ordinaryIncomeCents','personalExpenseCents','cashInCents','cashOutCents'])A.equal(t.review.financialDeltas[key],0);A.deepEqual(t.review.financialDeltas.accounts.map(x=>x.accountId).sort(),state.accounts.map(x=>x.id).sort());for(const a of t.review.financialDeltas.accounts)A.deepEqual([a.inflowCents,a.outflowCents,a.balanceCents],[0,0,0]);return{state:next,ticket:t};}
const create=(s,name='Independent plan',remaining=100000,patch={},d=day)=>run(s,{action:'create-plan',plan:{name,targetAmountCents:100000,expectedDate:'2026-10-20',expectedAccountId:'account-cash',note:'',...patch},remainingAfterCents:remaining},d).state;
const pid=(s,name)=>s.spendingPlanning.plans.find(x=>name===undefined||x.name===name).id;
const commit=(s,id=pid(s),remaining=100000,d=day)=>run(s,{action:'commit-plan',planId:id,commitmentBasis:'Independent seller terms',remainingAfterCents:remaining},d).state;
const alloc=(s,amountCents=100000,remainingAfterCents=0,transactionId='expense',planId=pid(s),d=day)=>run(s,{action:'allocate-payment',planId,transactionId,amountCents,reference:'Independent exact payment reference',remainingAfterCents},d).state;
const view=(s,d=day)=>P.view(s,{asOfDate:d}),source=(s,id='expense',d=day)=>P.source(s,{asOfDate:d,transactionId:id});
function reject(state,command,code){const raw=JSON.stringify(state);A.throws(()=>coord().preview(state,command,opt),{code});A.equal(JSON.stringify(state),raw);}
function normalized(s){return L.validateState(s);}
function proof(){return{version:1,source:{id:'expense',type:'expense',date:'2026-10-01',amountCents:100000,accountId:'account-cash',toAccountId:null},role:'cash-primary-payment',cashProfile:{id:'cash-profile',accountId:'account-cash',role:'cash'},duplicateEvidence:[],refunds:[],claims:[],grossPaymentCents:100000};}
function changeProofEverywhere(ext,id,mutate){for(const p of ext.payments)if(p.id===id)mutate(p);for(const op of ext.audit)for(const ch of op.changes)if(ch.kind==='payment'&&ch.recordId===id)for(const side of ['before','after'])if(ch[side])mutate(ch[side]);}
function amendPlanEverywhere(ext,mutate){for(const p of ext.plans)mutate(p);for(const op of ext.audit)for(const ch of op.changes)if(ch.kind==='plan')for(const side of ['before','after'])if(ch[side])mutate(ch[side]);}

module.exports={ROOT,L,R,O,P,C,I,F,copy,day,at,opt,coord,run,create,pid,commit,alloc,view,source,reject,proof,changeProofEverywhere};
