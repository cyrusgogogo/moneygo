'use strict';
const L=require('../../dist/ledger'), R=require('../../dist/relations'), O=require('../../dist/obligations'), I=require('../../dist/importer'), G=require('../../dist/organizer'), C=require('../../dist/cash-basis');
const DAY='2026-10-14', NOW=DAY+'T12:00:00.000Z', copy=v=>JSON.parse(JSON.stringify(v));
function state(rows=[],accounts=[{id:'a',name:'Cash a',openingBalanceCents:100000}]) {const s=L.createEmpty();s.accounts=accounts;s.transactions=rows;return L.validateState(s);}
function tx(id,type,cents,date,accountId='a',extra={}){return {id,type,amountCents:cents,date,accountId,...(type==='transfer'?{toAccountId:'b'}:{categoryId:type==='expense'?'expense-other':'income-other'}),note:'Synthetic',...extra};}
function role(s,id='a',role='cash'){return O.putProfile(s,{accountId:id,role,creditLimitCents:role==='credit'?500000:null,note:''},{confirmed:true,expectedRevision:s.obligations?.revision||0,reason:'Synthetic review'});}
function snap(s,date='2026-10-10',cents=100000,id='a'){return R.addSnapshot(s,{accountId:id,date,actualBalanceCents:cents,note:'Synthetic reported day-end'});}
function imported(s,key='bank',start='2026-10-11',end=DAY,csv='Date,Amount,Status\n',accountId='a',select=true){const p=I.preview(s,csv,{sourceKey:key,accountId,delimiter:',',columns:{date:0,amount:1,status:2},defaultType:'expense',coverage:{start,end,confirmed:true}});return I.commit(s,p,select?p.rows.filter(r=>!r.errors.length&&r.action!=='transfer-candidate').map(r=>r.key):[]);}
function co(day=DAY){return C.createCoordinator({now:()=>NOW,today:()=>day});}
function query(s,cutoff=DAY){const r=co(cutoff).inspect(s,{asOfDate:cutoff});return {asOfDate:cutoff,accounts:r.accounts.map(a=>({accountId:a.accountId,decision:'include',reason:''})),sources:r.sources.map(s=>({source:copy(s.source),decision:'include',reason:'',manualCoverage:s.source.kind==='manual'?{start:'0001-01-01',end:cutoff,allUnimportedMovementsRecorded:true,reason:'All synthetic unimported activity reviewed'}:null}))};}
function consent(){return {accountUniverseReviewed:true,sourceUniverseReviewed:true,userDeclarationsNotBankVerification:true,dayEndNotRealtime:true,reason:'Reviewed all listed accounts and sources.'};}
function confirmed(s,q=query(s),c=co(q.asOfDate)){return c.confirm(s,c.preview(s,q).ticket,q,consent());}
module.exports={L,R,O,I,G,C,DAY,NOW,copy,state,tx,role,snap,imported,co,query,consent,confirmed};
