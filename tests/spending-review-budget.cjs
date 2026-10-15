'use strict';
// Explicit slow synthetic boundary evidence: node tests/spending-review-budget.cjs
// Calibration only: MONEYGO_SPENDING_CALIBRATE=1 node tests/spending-review-budget.cjs
const assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const f=require('./spending-model-fixtures.cjs'),LIMIT=8388608;
function fixed(prefix,n,length=100){return(prefix+String(n).padStart(5,'0')).padEnd(length,'x');}
function rawState(linkLength=100,count=25){
 const state=f.copy(f.seeded({links:100})),ext=state.spendingPlanning,financial=f.R.defaultState(),profile=state.obligations.profiles[0],oldProfile=profile.id;
 // Stable synthetic role identity/time makes byte evidence reproducible.
 profile.id='budget-profile';profile.createdAt=f.now;state.obligations.audit[0].id='budget-profile-event';state.obligations.audit[0].recordId=profile.id;state.obligations.audit[0].at=f.now;state.obligations.audit[0].after=f.copy(profile);
 state.transactions=[];
 function sig(row,withId=false){return{...(withId?{id:row.id}:{}),type:row.type,date:row.date,amountCents:row.amountCents,accountId:row.accountId,toAccountId:null};}
 for(let i=0;i<100;i++){
  const source=f.tx(fixed('source',i));state.transactions.push(source);
  const payment=ext.payments[i];payment.transactionId=source.id;payment.proof.source=sig(source,true);payment.proof.cashProfile.id=profile.id;payment.reference='';
  const operation=ext.audit.find(e=>e.changes.some(c=>c.kind==='payment'&&c.recordId===payment.id&&c.before===null));operation.changes[0].after=f.copy(payment);
  for(let j=0;j<count;j++){
   const n=i*count+j,shadow=f.tx(fixed('shadow',n));state.transactions.push(shadow);
   const row={id:fixed('link',n,linkLength),createdAt:f.now,primaryId:source.id,shadowId:shadow.id,reason:'Synthetic duplicate context',primarySignature:sig(source),shadowSignature:sig(shadow)};
   financial.links.push(row);financial.audit.push({id:fixed('audit',n,30),revision:++financial.revision,at:f.now,kind:'link',recordId:row.id,action:'create',reason:'Synthetic',before:null,after:f.copy(row)});
  }
 }
 state.bookkeeping=financial;return state;
}
const command={action:'update-plan',planId:'fixture-plan',patch:{note:'Synthetic complete consent budget'}};
function references(state,count){let remaining=count;for(const payment of state.spendingPlanning.payments){const n=Math.min(remaining,500);payment.reference='x'.repeat(n);remaining-=n;state.spendingPlanning.audit.find(e=>e.changes.some(c=>c.kind==='payment'&&c.recordId===payment.id&&c.before===null)).changes[0].after.reference=payment.reference;}assert.equal(remaining,0);}
function pin(){const names=['spending-core','spending-planning','ledger','relations','obligations','retained-identities'];return Object.fromEntries(names.map(name=>[name+'.js',crypto.createHash('sha256').update(fs.readFileSync(require.resolve('../dist/'+name))).digest('hex')]));}
async function main(){const started=performance.now(),sourceHashes=pin();
 if(process.env.MONEYGO_SPENDING_CALIBRATE==='1'){
  // Non-acceptance calibration only, bypassing result size to measure exact schema expansion.
  const mod={exports:{}},code=fs.readFileSync(require.resolve('../dist/spending-planning'),'utf8');
  new Function('module','require',code)(mod,name=>{const actual=require('../dist/'+name.replace('./',''));return name==='./spending-core.js'?{...actual,canonicalData(value,opt){return actual.canonicalData(value,{maxBytes:33554432});}}:actual;});
  const state=rawState(),ticket=mod.exports.createCoordinator({now:()=>f.now,today:()=>f.day}).preview(state,command,f.options);
  console.log(JSON.stringify({calibrationOnly:true,bytes:Buffer.byteLength(f.C.canonicalData(ticket,{maxBytes:33554432})),elapsedMs:Math.round(performance.now()-started),heapMiB:Math.round(process.memoryUsage().heapUsed/1048576)}));return;
 }
 // Full schema calibration: 8,555,181 bytes at100-char link IDs; 2,500 links
 // occur four times per complete source review. Shortening17 chars saves170,000
 // bytes, then3,427 explicit reference bytes reaches the exact boundary.
 const state=rawState(83,25);references(state,3427);
 const unicode=state.spendingPlanning.payments[0];unicode.reference='汉\n😀\ud800'+unicode.reference.slice(15);
 state.spendingPlanning.audit.find(e=>e.changes.some(c=>c.kind==='payment'&&c.recordId===unicode.id&&c.before===null)).changes[0].after.reference=unicode.reference;
 const before=JSON.stringify(state),c=f.coordinator(),t=c.preview(state,command,f.options),actual=Buffer.byteLength(f.C.canonicalData(t,{maxBytes:LIMIT}));
 assert.equal(actual,LIMIT);assert.equal(JSON.stringify(state),before);c.cancel(t);
 const plus=f.copy(state),payment=plus.spendingPlanning.payments.find(p=>p.reference.length<500);payment.reference+='z';plus.spendingPlanning.audit.find(e=>e.changes.some(c=>c.kind==='payment'&&c.recordId===payment.id&&c.before===null)).changes[0].after.reference=payment.reference;
 assert.throws(()=>c.preview(plus,command,f.options),e=>e.code==='SPENDING_RESULT_LIMIT');assert.deepEqual(f.P.view(plus,f.options),f.P.view(state,f.options));
 assert.deepEqual(pin(),sourceHashes);
 console.log(JSON.stringify({exactTicketBytes:actual,rejectedTicketBytes:actual+1,ledgerBytes:Buffer.byteLength(f.C.canonicalData(state,{maxBytes:33554432})),spendingBytes:Buffer.byteLength(f.C.canonicalData(f.C.validateExtension(state.spendingPlanning),{maxBytes:LIMIT})),currentPayments:100,currentSources:state.transactions.length,currentDuplicateComponents:state.bookkeeping.links.length,elapsedMs:Math.round(performance.now()-started),heapMiB:Math.round(process.memoryUsage().heapUsed/1048576),rssMiB:Math.round(process.memoryUsage().rss/1048576),sourceHashes}));
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={rawState,references,command};
