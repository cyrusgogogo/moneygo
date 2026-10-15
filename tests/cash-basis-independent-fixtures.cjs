'use strict';
// Independent synthetic fixtures use only accepted existing public writer/validator APIs.
const path=require('node:path'), A=require('node:assert/strict');
const ROOT=process.env.MONEYGO_ROOT||path.resolve(__dirname,'..');
const load=n=>require(path.join(ROOT,'dist',n+'.js'));
const L=load('ledger'),R=load('relations'),O=load('obligations'),I=load('importer'),Org=load('organizer'),Income=load('income-planning'),Spending=load('spending-planning'),H=load('held-funds'),Scenario=load('scenario');
const DAY='2026-10-14',NOW=DAY+'T12:00:00.000Z';
const copy=v=>JSON.parse(JSON.stringify(v));
const account=(id='a',openingBalanceCents=100000)=>({id,name:'Independent '+id,openingBalanceCents});
const tx=(id,type='expense',amountCents=10000,date='2026-10-12',accountId='a',extra={})=>({id,type,amountCents,date,accountId,...(type==='transfer'?{toAccountId:'b'}:{categoryId:type==='income'?'income-other':'expense-other'}),note:'Independent synthetic',...extra});
function base(rows=[],accounts=[account()]){const s=L.createEmpty();s.accounts=accounts;s.transactions=rows;return L.validateState(s)}
const approval=s=>({confirmed:true,expectedRevision:s.obligations?.revision||0,reason:'Independent synthetic review'});
const role=(s,id='a',kind='cash')=>O.putProfile(s,{accountId:id,role:kind,creditLimitCents:kind==='credit'?500000:null,note:''},approval(s));
const allCash=s=>s.accounts.reduce((v,a)=>role(v,a.id),s);
const snap=(s,id='a',date='2026-10-10',cents=100000)=>R.addSnapshot(s,{accountId:id,date,actualBalanceCents:cents,note:'Independent synthetic day-end report'});
function simple(){return snap(role(base()))}
function imported(s,{key='bank-file',owner='a',start='2026-10-11',end=DAY,csv='Date,Amount,Status,Id\n2026-10-12,100.00,completed,stable-a\n',select=true}={}){const p=I.preview(s,csv,{sourceKey:key,accountId:owner,delimiter:',',columns:{date:0,amount:1,status:2,stableId:3},defaultType:'expense',coverage:{start,end,confirmed:true}});return I.commit(s,p,select?p.rows.filter(r=>!r.errors.length).map(r=>r.key):[])}
const manual=(accountId,start='2026-10-11',end=DAY)=>({source:{kind:'manual',accountId,sourceKey:null},decision:'include',reason:'',manualCoverage:start===null?null:{start,end,allUnimportedMovementsRecorded:true,reason:'Independent review of all unimported activity'}});
function query(s,{asOfDate=DAY,start='2026-10-11',exclude=[],additional=[]}={}){
 const entries=new Map();
 for(const kind of ['templates','evidence','coverage','quarantine','batches'])for(const row of s.imports?.[kind]||[])if(!row.rolledBack)entries.set(JSON.stringify([row.accountId,row.sourceKey]),{source:{kind:'import',accountId:row.accountId,sourceKey:row.sourceKey},decision:'include',reason:'',manualCoverage:null});
 for(const row of s.organizer?.scopes||[])entries.set(JSON.stringify([row.accountId,row.sourceKey]),{source:{kind:'import',accountId:row.accountId,sourceKey:row.sourceKey},decision:'include',reason:'',manualCoverage:null});
 return {asOfDate,accounts:s.accounts.map(a=>({accountId:a.id,decision:exclude.includes(a.id)?'exclude':'include',reason:exclude.includes(a.id)?'Explicit selected-scope exclusion':''})),sources:[...entries.values(),...s.accounts.map(a=>manual(a.id,start,asOfDate)),...additional]};
}
const consent=()=>({accountUniverseReviewed:true,sourceUniverseReviewed:true,userDeclarationsNotBankVerification:true,dayEndNotRealtime:true,reason:'Reviewed all listed accounts and sources.'});
const coord=(clock={now:NOW,today:DAY})=>load('cash-basis').createCoordinator({now:()=>clock.now,today:()=>clock.today});
function confirmed(s,q=query(s),c=coord(),cs=consent()){const p=c.preview(s,q);return c.confirm(s,p.ticket,q,cs)}
const row=(r,id='a')=>r.accounts.find(a=>a.accountId===id);
const source=(r,key,owner='a')=>r.sources.find(x=>x.source.accountId===owner&&x.source.sourceKey===key);
function preservation(s){const backup=JSON.parse(L.backup(s));delete backup.exportedAt;return {raw:JSON.stringify(s),backup,relations:R.calculate(s),obligations:O.view(s,{asOf:DAY}),scenario:Scenario.calculate(s,Scenario.defaultSettings(),DAY),income:Income.view(s,{asOfDate:DAY}),spending:Spending.view(s,{asOfDate:DAY})}}
const paths={'account':'accounts','transaction':'transactions','trash-transaction':'trash','role-profile':'obligations.profiles','snapshot':'bookkeeping.snapshots','snapshot-create-audit':'bookkeeping.audit','duplicate-link':'bookkeeping.links','composite':'bookkeeping.composites','transfer-pair':'bookkeeping.transferPairs','import-template':'imports.templates','import-evidence':'imports.evidence','import-batch':'imports.batches','import-quarantine':'imports.quarantine','import-coverage':'imports.coverage','source-scope':'organizer.scopes'};
const key=r=>JSON.stringify([r.kind,r.id]);
function proofCheck(s,r){const retained=new Map();for(const [kind,p] of Object.entries(paths))for(const value of p.split('.').reduce((v,k)=>v?.[k],s)||[])retained.set(key({kind,id:value.id}),value);const found=new Map();for(const p of r.proofRecords){A.deepEqual(Object.keys(p).sort(),['ref','value']);A.deepEqual(Object.keys(p.ref).sort(),['id','kind']);const k=key(p.ref);A.ok(!found.has(k),'unique proof '+k);A.ok(retained.has(k),'retained proof '+k);A.deepEqual(p.value,retained.get(k),'exact complete raw proof '+k);found.set(k,p)}function walk(x){if(!x||typeof x!=='object')return;if(Object.keys(x).length===2&&Object.hasOwn(x,'kind')&&Object.hasOwn(x,'id')&&Object.hasOwn(paths,x.kind))A.ok(found.has(key(x)),'closed ref '+key(x));for(const [k,v]of Object.entries(x))if(k!=='proofRecords')walk(v)}walk(r);return found}
function frozenTree(x,seen=new Set()){if(!x||typeof x!=='object'||seen.has(x))return;seen.add(x);A.equal(Object.isFrozen(x),true,'deeply frozen');for(const v of Object.values(x))frozenTree(v,seen)}
function importedNative(){let s=snap(snap(allCash(base([],[account('a'),account('b',20000)])),'a'),'b','2026-10-10',20000);s=imported(s,{csv:'Date,Amount,Status,Id\n2026-10-12,300.00,completed,stable-a\n'});const t=s.transactions[0];s=L.putTransaction(s,{id:t.id,type:'transfer',date:t.date,amountCents:30000,accountId:'a',toAccountId:'b',note:t.note},t.id);return s}
function capacitySources(){let s=allCash(base([],Array.from({length:100},(_,n)=>account('a'+String(n).padStart(3,'0'),0))));for(const a of s.accounts)s=snap(s,a.id,DAY,0);const q=query(s,{start:null});for(let i=0;i<10000;i++)q.sources.push({source:{kind:'import',accountId:'a'+String(Math.floor(i/100)).padStart(3,'0'),sourceKey:'s'+String(i).padStart(5,'0')},decision:'include',reason:'',manualCoverage:null});return{s,q}}
module.exports={ROOT,load,L,R,O,I,Org,Income,Spending,H,Scenario,DAY,NOW,copy,account,tx,base,role,allCash,snap,simple,imported,manual,query,consent,coord,confirmed,row,source,preservation,proofCheck,frozenTree,importedNative,capacitySources};
