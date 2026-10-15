'use strict';
const R=require('../dist/relations.js');
const copy=x=>JSON.parse(JSON.stringify(x));
const options={at:'2026-04-15T12:00:00.000Z',reason:'Synthetic reviewed record'};
function tx(id,type,amountCents,date='2026-01-10',accountId='cash-a'){return {id,type,amountCents,date,accountId,categoryId:type==='expense'?'category-personal':'category-income',note:''};}
function base(rows=[tx('pay','expense',10000),tx('receipt','income',10000,'2026-03-10','cash-b')]){return {version:4,currency:'CNY',accounts:[{id:'cash-a',name:'Cash A',openingBalanceCents:0},{id:'cash-b',name:'Cash B',openingBalanceCents:0}],categories:[{id:'category-personal',type:'expense',name:'Personal'},{id:'category-income',type:'income',name:'Income'}],transactions:rows,trash:[]};}
function command(action,extra={}){const common={action,asOfDate:'2026-04-15'};const defaults={
'create-position':{expenseId:'pay',amountCents:10000,kind:'deposit',name:'Held principal',purpose:'',reference:'',expiry:{kind:'unknown',date:null},refundability:'unknown',terms:'',termsSource:'',confirmations:{paidPrincipalOnly:true,noTrackedWalletOverlap:true}},
recognize:{kind:'use',amountCents:2000,effectiveDate:'2026-02-10',categoryId:'category-personal',merchant:null,reference:'',confirmations:{notAlreadyRecordedAsExpense:true}},
'allocate-return':{incomeId:'receipt',amountCents:3000,reference:''},
'update-position':{name:'Renamed',purpose:'',reference:'',expiry:{kind:'unknown',date:null},refundability:'unknown',terms:'',termsSource:''}
};return {...common,...defaults[action],...extra};}
function apply(state,action,extra={},opts=options){return R.applyHeldTransition(state,command(action,extra),opts);}
function funded(rows,extra){return apply(base(rows),'create-position',extra);}
function position(state){return state.bookkeeping.heldPositions[0].id;}
function graphInput(state){const b=state.bookkeeping;return {positions:b.heldPositions,recognitions:b.heldRecognitions,returns:b.heldReturns,sources:state.transactions.map(t=>({id:t.id,type:t.type,date:t.date,amountCents:t.amountCents,accountId:t.accountId,toAccountId:t.type==='transfer'?t.toAccountId:null})),categories:state.categories};}
module.exports={R,copy,options,tx,base,command,apply,funded,position,graphInput};
