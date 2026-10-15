'use strict';
const path = require('node:path'),fs=require('node:fs');
const repositoryParent=path.resolve(__dirname,'..');
const ROOT = process.env.MONEYGO_REVIEW_ROOT || (fs.existsSync(path.join(repositoryParent,'dist','ledger.js'))?repositoryParent:path.join(repositoryParent,'moneygo-batch12-held-funds'));
const mod = name => require(path.join(ROOT, 'dist', name + '.js'));
const L=mod('ledger'), R=mod('relations'), H=mod('held-funds'), C=mod('held-core'), P=mod('personal-events'), O=mod('organizer'), S=mod('scenario'), B=mod('obligations');
const copy = x => JSON.parse(JSON.stringify(x));
const at='2026-04-30T08:09:10.011Z', asOfDate='2026-04-30';
function tx(id,type,amountCents,date,accountId='account-cash') { return {id,type,amountCents,date,accountId,categoryId:type==='expense'?'expense-other':'income-other',note:'Independent '+id}; }
function base(rows) { const x=L.createEmpty();x.accounts.push({id:'bank',name:'Independent bank',openingBalanceCents:0}); x.categories.push({id:'own-cost',name:'Independent recognition category',type:'expense'});x.transactions=rows||[tx('fund','expense',120003,'2026-01-02'),tx('pay2','expense',40007,'2026-01-03'),tx('receipt','income',50009,'2026-02-05','bank'),tx('receipt2','income',30011,'2026-04-05','bank')];return L.validateState(x); }
function create(patch={}) { return {action:'create-position',asOfDate,expenseId:'fund',amountCents:100000,kind:'deposit',name:'Independent position',purpose:'',reference:'',expiry:{kind:'unknown',date:null},refundability:'unknown',terms:'',termsSource:'',confirmations:{paidPrincipalOnly:true,noTrackedWalletOverlap:true},...patch}; }
function recognize(positionId, patch={}) { return {action:'recognize',asOfDate,positionId,kind:'use',amountCents:20000,effectiveDate:'2026-03-02',categoryId:'own-cost',merchant:'Explicit independent merchant',reference:'',confirmations:{notAlreadyRecordedAsExpense:true},...patch}; }
function returned(positionId,patch={}) {return {action:'allocate-return',asOfDate,positionId,incomeId:'receipt',amountCents:30000,reference:'',...patch};}
function apply(state,command) { const h=H.createCoordinator({now:()=>at});return h.commit(state,h.preview(state,command),{confirmed:true,reason:'Independent explicit review'}); }
function fast(state,command) {return R.applyHeldTransition(state,command,{at,reason:'Independent explicit review'});}
const pid=s=>s.bookkeeping.heldPositions.at(-1).id;
const fund=(s=base(),patch={})=>apply(s,create(patch));
function reverseAll(state) {let s=state;for(const r of s.bookkeeping.heldRecognitions.slice())s=apply(s,{action:'reverse-recognition',asOfDate,recognitionId:r.id});for(const r of s.bookkeeping.heldReturns.slice())s=apply(s,{action:'reverse-return',asOfDate,returnId:r.id});for(const r of s.bookkeeping.heldPositions.slice())s=apply(s,{action:'reverse-position',asOfDate,positionId:r.id});return s;}
function graphInput(s) {return {positions:s.bookkeeping?.heldPositions||[],recognitions:s.bookkeeping?.heldRecognitions||[],returns:s.bookkeeping?.heldReturns||[],sources:s.transactions.map(t=>({id:t.id,type:t.type,date:t.date,amountCents:t.amountCents,accountId:t.accountId,toAccountId:t.toAccountId||null})),categories:s.categories.map(c=>({id:c.id,type:c.type,name:c.name}))};}
function close(s,month='2026-03',more={}) {return O.closePersonalMonth(s,{month,selection:'all-month',reason:'Independent frozen review',at,...more});}
function oldReader(version){return require(path.join(ROOT,'tests','fixtures','held-readers-v'+version,'ledger.js'));}
module.exports={ROOT,mod,oldReader,L,R,H,C,P,O,S,B,copy,at,asOfDate,tx,base,create,recognize,returned,apply,fast,pid,fund,reverseAll,graphInput,close};
