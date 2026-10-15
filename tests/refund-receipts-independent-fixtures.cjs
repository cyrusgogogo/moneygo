'use strict';
const path=require('node:path'),fs=require('node:fs'),vm=require('node:vm'),A=require('node:assert/strict');
const root=process.env.MONEYGO_REVIEW_ROOT||path.resolve(__dirname,'..');
const from=p=>require(path.join(root,p));
const L=from('dist/ledger.js'),R=from('dist/relations.js'),O=from('dist/organizer.js'),IM=from('dist/importer.js');
const I=from('tests/income-planning-model-fixtures.cjs'),S=from('tests/spending-model-fixtures.cjs');
const day='2026-10-14',now='2026-10-14T12:00:00.000Z',copy=v=>JSON.parse(JSON.stringify(v)),bytes=v=>JSON.stringify(v);
const tx=(id,type='income',amountCents=5000,date='2026-10-10',accountId='account-cash',extra={})=>({id,type,date,amountCents,accountId,...(type==='transfer'?{toAccountId:'bank'}:{categoryId:type==='expense'?'expense-other':'income-other'}),note:'',...extra});
function base(rows=[tx('expense','expense',10000,'2026-09-01'),tx('receipt')]){const s=L.createEmpty();s.accounts.push({id:'bank',name:'Synthetic bank',openingBalanceCents:0});s.transactions=rows;return L.validateState(s);}
function plan(s,patch={}){return R.addRefundPlan(s,{expenseId:'expense',expectedAmountCents:5000,dueDate:'2026-10-10',status:'waiting',note:'Synthetic plan',...patch});}
const pid=s=>s.bookkeeping.refundPlans[0].id;
const command=(patch={})=>({expenseId:'expense',incomeId:'receipt',planId:null,amountCents:1000,reason:'Synthetic independent review',...patch});
const query=(patch={})=>({expenseId:'expense',planId:null,classification:'all',search:'',offset:0,limit:100,...patch});
const selection=(patch={})=>({expenseId:'expense',incomeId:'receipt',planId:null,...patch});
const publicAlloc=(s,c={})=>R.allocateRefund(s,command(c));
const coordinator=(caps={})=>from('dist/refund-receipts.js').createCoordinator({today:()=>day,now:()=>now,...caps});
function allocate(s,c={},caps={}){const co=coordinator(caps),ticket=co.preview(s,command(c));return {co,ticket,state:co.commit(s,ticket,{confirmed:true})};}
function frozen(v){if(v&&typeof v==='object'){A.ok(Object.isFrozen(v),'output must be deeply frozen');for(const k of Object.keys(v))frozen(v[k]);}}
function noMutation(s,fn){const before=bytes(s);const out=fn();A.equal(bytes(s),before);return out;}
function rejects(s,fn){noMutation(s,()=>A.throws(fn));}
function merchant(s,id,value){const r=O.saveAlias(s,{from:id,to:value,caseSensitive:true,at:now});const p=O.previewAliases(r);return O.applyPreview(r,p,{transactionIds:p.rows.filter(x=>x.eligible&&x.changed).map(x=>x.transactionId),reason:'Confirmed merchant evidence',at:now});}
function imported(s,csv){const config={sourceKey:'independent-source',accountId:'account-cash',delimiter:',',header:true,columns:{date:0,amount:1,direction:2,note:3,stableId:4},coverage:{start:'2026-10-01',end:'2026-10-31',confirmed:true}};const p=IM.preview(s,csv,config);return IM.commit(s,p,p.rows.filter(r=>r.action==='new').map(r=>r.key));}
function planners(){let s=S.base([tx('expense','expense',100000,'2026-10-01'),tx('receipt','income',100000,'2026-10-10'),tx('other-expense','expense',30000),tx('other-income','income',30000)]);s=S.committed(s);s=S.allocate(s,40000,60000,'expense');s=S.allocate(s,10000,50000,'other-expense');s=I.apply(s,I.plan());s=I.allocate(s,40000,'receipt');s=I.allocate(s,10000,'other-income');return s;}
function normalizeNewTime(s){const x=copy(s);const r=x.bookkeeping.refunds.at(-1),a=x.bookkeeping.audit.at(-1);r.createdAt='GENERATED';a.at='GENERATED';a.after.createdAt='GENERATED';return x;}
const schema=require('./refund-receipts-independent-schema.json');
// Small assertion-only Draft2020-12 structural evaluator; it has no input authority.
function schemaErrors(v,s,p='$'){
 if(s.$ref)return schemaErrors(v,schema.$defs[s.$ref.split('/').at(-1)],p);
 const errors=[];const err=m=>errors.push(p+': '+m);
 if(s.oneOf){const n=s.oneOf.filter(x=>schemaErrors(v,x,p).length===0).length;if(n!==1)err('oneOf matched '+n);}
 if(s.anyOf&&!s.anyOf.some(x=>schemaErrors(v,x,p).length===0))err('no anyOf match');
 if(Object.hasOwn(s,'const')&&bytes(v)!==bytes(s.const))err('const mismatch');
 if(s.enum&&!s.enum.some(x=>bytes(v)===bytes(x)))err('enum mismatch');
 if(s.type){const t=s.type,ok=t==='null'?v===null:t==='array'?Array.isArray(v):t==='object'?v!==null&&typeof v==='object'&&!Array.isArray(v):t==='integer'?Number.isInteger(v):typeof v===t;if(!ok){err('type '+t);return errors;}}
 if(typeof v==='number'){if(s.minimum!==undefined&&v<s.minimum)err('minimum');if(s.maximum!==undefined&&v>s.maximum)err('maximum');}
 if(typeof v==='string'){if(s.minLength!==undefined&&v.length<s.minLength)err('minLength');if(s.maxLength!==undefined&&v.length>s.maxLength)err('maxLength');if(s.pattern&&!new RegExp(s.pattern).test(v))err('pattern');}
 if(Array.isArray(v)){if(s.minItems!==undefined&&v.length<s.minItems)err('minItems');if(s.maxItems!==undefined&&v.length>s.maxItems)err('maxItems');if(s.uniqueItems&&new Set(v.map(bytes)).size!==v.length)err('uniqueItems');if(s.items)v.forEach((x,i)=>errors.push(...schemaErrors(x,s.items,p+'/'+i)));}
 else if(v&&typeof v==='object'){for(const k of s.required||[])if(!Object.hasOwn(v,k))err('missing '+k);for(const k of Object.keys(v)){if(s.properties&&Object.hasOwn(s.properties,k))errors.push(...schemaErrors(v[k],s.properties[k],p+'/'+k));else if(s.additionalProperties===false)err('unknown '+k);else if(s.additionalProperties&&typeof s.additionalProperties==='object')errors.push(...schemaErrors(v[k],s.additionalProperties,p+'/'+k));}}
 return errors;
}
function conform(v,def){A.deepEqual(schemaErrors(v,schema.$defs[def]),[],'approved '+def+' schema');}
function closure(v){const entries=v.proof.entries,refs=new Map(entries.map(e=>[e.ref,e]));A.equal(refs.size,entries.length,'proof refs unique');A.equal(new Set(entries.map(e=>[e.phase,e.kind,e.sourcePath].join('|'))).size,entries.length,'each phase/source represented once');function walk(o){if(!o||typeof o!=='object')return;for(const [k,x]of Object.entries(o)){if(k==='entries')continue;if(k.endsWith('Ref')&&x!==null)A.ok(refs.has(x),'dangling '+k+'='+x);else if(k.endsWith('Refs')){A.ok(Array.isArray(x),k);for(const ref of x)A.ok(refs.has(ref),'dangling '+k+'='+ref);}else walk(x);}}walk(v);return refs;}
function authoritativeProof(review,before,saved){const after=copy(saved),fresh=review.proof.entries.find(e=>e.ref===review.generated.refundRef).value.createdAt;after.bookkeeping.refunds.at(-1).createdAt=fresh;after.bookkeeping.audit.at(-1).at=fresh;after.bookkeeping.audit.at(-1).after.createdAt=fresh;const states={before,after},cache={};
 for(const entry of review.proof.entries){const state=states[entry.phase];if(entry.sourcePath.startsWith('/')){const expected=entry.sourcePath.slice(1).split('/').map(k=>k.replaceAll('~1','/').replaceAll('~0','~')).reduce((o,k)=>o?.[k],state);A.deepEqual(entry.value,expected,'stored source snapshot '+entry.sourcePath);continue;}
  if(entry.kind.startsWith('income-')&&entry.kind.endsWith('-view')){const view=cache['income-'+entry.phase]||(cache['income-'+entry.phase]=I.P.view(state,{asOfDate:review.asOfDate}));const rows=entry.kind==='income-plan-view'?view.plans:entry.kind==='income-receipt-view'?view.receipts:view.sources;const expected=rows.find(v=>(v.plan?.id||v.receiptId||v.transactionId)===entry.recordId);A.deepEqual(entry.value,expected,'public '+entry.kind+' '+entry.recordId);}
  if(entry.kind.startsWith('spending-')&&entry.kind.endsWith('-view')){const view=cache['spending-'+entry.phase]||(cache['spending-'+entry.phase]=S.P.view(state,{asOfDate:review.asOfDate}));const expected=entry.kind==='spending-source-view'?S.P.source(state,{asOfDate:review.asOfDate,transactionId:entry.recordId}):(entry.kind==='spending-plan-view'?view.plans:view.payments).find(v=>(v.plan?.id||v.paymentId)===entry.recordId);A.deepEqual(entry.value,expected,'public '+entry.kind+' '+entry.recordId);}
 }
}

module.exports={root,from,fs,vm,A,L,R,O,IM,I,S,day,now,copy,bytes,tx,base,plan,pid,command,query,selection,publicAlloc,coordinator,allocate,frozen,noMutation,rejects,merchant,imported,planners,normalizeNewTime,conform,closure,authoritativeProof};
