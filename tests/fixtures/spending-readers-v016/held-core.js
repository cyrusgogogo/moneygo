/* Pure held-principal proof kernel. Supplied facts only; no live model or clock. */
(function(root,factory){ 'use strict'; const api=factory(); if(typeof module==='object'&&module.exports)module.exports=api;else root.MoneygoHeldCore=api; }(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const LIMITS=Object.freeze({positions:500,childrenPerPosition:200,children:5000,everIds:10000,proofCells:100000,dateOccurrences:5500,daysPerPosition:201,sources:10000,categories:200,idLength:100});
  const MAX_AMOUNT_CENTS=999999999999, MAX_SAFE_CENTS=BigInt(Number.MAX_SAFE_INTEGER);
  const ownGraphs=new WeakSet(),leafErrors=new WeakSet();
  const hasOwn=Function.call.bind(Object.prototype.hasOwnProperty),nativeSource=Function.call.bind(Function.prototype.toString);
  const objectPrototypeKeys=Reflect.ownKeys(Object.prototype),arrayPrototypeKeys=Reflect.ownKeys(Array.prototype);
  class HeldCoreError extends Error {constructor(code,message){super(message);this.name='HeldCoreError';this.code=code;}}
  function fail(code,message){const error=new HeldCoreError(code,message);leafErrors.add(error);throw error;}
  function invalid(message){fail('INVALID_HELD_RECORD',message);}
  // Inspect descriptors, never caller methods or properties that could be accessors.
  // Genuine ordinary prototypes from another realm are allowed; custom chains are not.
  function sameKeys(value, expected) {
    const keys = Reflect.ownKeys(value);
    return keys.length === expected.length && keys.every(key => expected.includes(key));
  }
  function nativePrototype(proto, name) {
    const constructor = Object.getOwnPropertyDescriptor(proto, 'constructor');
    if (!constructor || !hasOwn(constructor, 'value') || typeof constructor.value !== 'function') return false;
    const back = Object.getOwnPropertyDescriptor(constructor.value, 'prototype');
    return !!back && hasOwn(back, 'value') && back.value === proto && nativeSource(constructor.value) === 'function ' + name + '() { [native code] }';
  }
  function ordinaryObjectPrototype(proto) {
    return proto !== null && Object.getPrototypeOf(proto) === null && nativePrototype(proto, 'Object') && sameKeys(proto, objectPrototypeKeys);
  }
  function record(value, fields, optional, code) {
    const errorCode = code || 'INVALID_HELD_RECORD';
    let keys, proto;
    try {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(errorCode, 'Expected an ordinary data record');
      proto = Object.getPrototypeOf(value);
      if (proto !== null && !ordinaryObjectPrototype(proto)) fail(errorCode, 'Inherited record fields are not allowed');
      keys = Reflect.ownKeys(value);
    } catch (error) {
      if (leafErrors.has(error)) throw error;
      fail(errorCode, 'Record cannot be inspected');
    }
    if ((!optional && keys.length !== fields.length) || keys.length > fields.length) fail(errorCode, 'Unexpected record fields');
    const result = Object.create(null);
    for (const key of keys) {
      if (typeof key !== 'string' || !fields.includes(key)) fail(errorCode, 'Unexpected record field');
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (_) { fail(errorCode, 'Record cannot be inspected'); }
      if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) fail(errorCode, 'Fields must be enumerable own data');
      result[key] = descriptor.value;
    }
    if (!optional) for (const field of fields) if (!hasOwn(result, field)) fail(errorCode, 'Missing record field');
    return result;
  }
  function arrayValues(value, maximum, code) {
    const errorCode = code || 'INVALID_HELD_RECORD';
    let length, proto, keys;
    try {
      if (!Array.isArray(value)) fail(errorCode, 'Expected an ordinary dense array');
      const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
      if (!descriptor || !hasOwn(descriptor, 'value')) fail(errorCode, 'Invalid array length');
      length = descriptor.value;
      if (!Number.isSafeInteger(length) || length < 0) fail(errorCode, 'Invalid array length');
      // Reject excessive lengths before copying or walking any index.
      if (length > maximum) fail('HELD_LIMIT', 'Too many held-fund rows');
      proto = Object.getPrototypeOf(value);
      if (!proto || !Array.isArray(proto) || !nativePrototype(proto, 'Array') || !ordinaryObjectPrototype(Object.getPrototypeOf(proto)) || !sameKeys(proto, arrayPrototypeKeys)) fail(errorCode, 'Custom array prototypes are not allowed');
      keys = Reflect.ownKeys(value);
    } catch (error) {
      if (leafErrors.has(error)) throw error;
      fail(errorCode, 'Array cannot be inspected');
    }
    if (keys.length !== length + 1) fail(errorCode, 'Array has missing or custom fields');
    const result = [];
    for (let index = 0; index < length; index++) {
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, String(index)); } catch (_) { fail(errorCode, 'Array cannot be inspected'); }
      if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) fail(errorCode, 'Array must contain dense own data');
      result.push(descriptor.value);
    }
    return result;
  }
  function validId(value) {
    return typeof value === 'string' && value.length <= LIMITS.idLength && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) && value !== 'constructor' && value !== 'prototype';
  }
  function id(value, code) { if (!validId(value)) fail(code || 'INVALID_ID', 'Invalid raw identifier'); return value; }
  function nullableId(value) { return value === null ? null : id(value); }
  function amount(value, minimum, maximum) {
    if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < minimum || value > maximum) fail('INVALID_AMOUNT', 'Invalid personal-event amount');
    return value === 0 ? 0 : value;
  }
  function boolean(value) { if (typeof value !== 'boolean') invalid('Expected a boolean'); return value; }
  function validMonth(value) {
    return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value.slice(0, 4) !== '0000';
  }
  function date(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !validMonth(value.slice(0, 7))) fail('INVALID_DATE', 'Invalid economic date');
    const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
    const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (day < 1 || day > days[month - 1]) fail('INVALID_DATE', 'Invalid economic day');
    return value;
  }

  function frozen(value){if(value&&typeof value==='object'){Object.values(value).forEach(frozen);Object.freeze(value);}return value;}
  function safe(n){if(n<0n||n>MAX_SAFE_CENTS)fail('AMOUNT_OVERFLOW','Unsafe independent held amount');return Number(n);}
  function text(value,max,nonblank,free){if(typeof value!=='string'||value.length>max||(free?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/:/[\u0000-\u001f\u007f]/).test(value)||(nonblank&&!value.trim()))invalid('Invalid held text');return nonblank?value.trim():value;}
  function timestamp(value){if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/.test(value))fail('INVALID_DATE','Invalid held timestamp');date(value.slice(0,10));return value;}
  function positive(value){return amount(value,1,MAX_AMOUNT_CENTS);}
  function signature(value){const r=record(value,['type','date','amountCents','accountId','toAccountId']);if(!['expense','income','transfer'].includes(r.type))invalid('Invalid source type');const out={type:r.type,date:date(r.date),amountCents:positive(r.amountCents),accountId:id(r.accountId),toAccountId:r.toAccountId===null?null:id(r.toAccountId)};if(out.type==='transfer'?out.toAccountId===null||out.accountId===out.toAccountId:out.toAccountId!==null)invalid('Invalid source destination');return out;}
  function confirmation(value,fields){const r=record(value,fields),out={};for(const key of fields){if(r[key]!==true)fail('HELD_CONFIRMATION_REQUIRED','Explicit held assertion required');out[key]=true;}return out;}
  function expiry(value,fundingDate){const r=record(value,['kind','date']);if(!['unknown','none','date'].includes(r.kind))invalid('Invalid expiry kind');const d=r.kind==='date'?date(r.date):null;if(r.kind!=='date'&&r.date!==null||d!==null&&d<fundingDate)fail('INVALID_DATE','Expiry is before funding or not explicit');return {kind:r.kind,date:d};}
  function normalizePosition(value){
    const r=record(value,['id','createdAt','asOfDate','kind','name','purpose','reference','expenseId','expenseSignature','amountCents','expiry','refundability','terms','termsSource','confirmations','reason']);
    if(!['deposit','prepayment','stored-value'].includes(r.kind)||!['unknown','refundable','conditional','nonrefundable'].includes(r.refundability))invalid('Invalid position terms');
    const sig=signature(r.expenseSignature),asOfDate=date(r.asOfDate),n=positive(r.amountCents);
    if(sig.type!=='expense'||sig.date>asOfDate)fail('HELD_DATE','Funding must be an actual expense by review date');if(n>sig.amountCents)fail('EXPENSE_OVERALLOCATED','Held principal exceeds funding source');
    return frozen({id:id(r.id),createdAt:timestamp(r.createdAt),asOfDate,kind:r.kind,name:text(r.name,80,true),purpose:text(r.purpose,500,false,true),reference:text(r.reference,500,false,true),expenseId:id(r.expenseId),expenseSignature:sig,amountCents:n,expiry:expiry(r.expiry,sig.date),refundability:r.refundability,terms:text(r.terms,500,false,true),termsSource:text(r.termsSource,500,false,true),confirmations:confirmation(r.confirmations,['paidPrincipalOnly','noTrackedWalletOverlap']),reason:text(r.reason,500,true,true)});
  }
  function normalizeRecognition(value){
    const r=record(value,['id','createdAt','asOfDate','positionId','kind','amountCents','effectiveDate','categoryId','categoryProof','merchant','reference','confirmations','reason']);
    if(!['use','loss'].includes(r.kind))invalid('Invalid recognition kind');
    const proof=record(r.categoryProof,['id','type','name']),categoryId=id(r.categoryId),effectiveDate=date(r.effectiveDate),asOfDate=date(r.asOfDate);
    if(proof.type!=='expense'||id(proof.id)!==categoryId)fail('INVALID_HELD_CATEGORY','Recognition category proof must match expense category');if(effectiveDate>asOfDate)fail('HELD_DATE','Recognition is after review date');
    return frozen({id:id(r.id),createdAt:timestamp(r.createdAt),asOfDate,positionId:id(r.positionId),kind:r.kind,amountCents:positive(r.amountCents),effectiveDate,categoryId,categoryProof:{id:categoryId,type:'expense',name:text(proof.name,80,true)},merchant:r.merchant===null?null:text(r.merchant,80,true),reference:text(r.reference,500,false,true),confirmations:confirmation(r.confirmations,['notAlreadyRecordedAsExpense']),reason:text(r.reason,500,true,true)});
  }
  function normalizeReturn(value){
    const r=record(value,['id','createdAt','asOfDate','positionId','incomeId','incomeSignature','amountCents','reference','reason']),sig=signature(r.incomeSignature),asOfDate=date(r.asOfDate),n=positive(r.amountCents);
    if(sig.type!=='income'||sig.date>asOfDate)fail('HELD_DATE','Return needs actual income by review date');if(n>sig.amountCents)fail('INCOME_OVERALLOCATED','Return exceeds actual receipt');
    return frozen({id:id(r.id),createdAt:timestamp(r.createdAt),asOfDate,positionId:id(r.positionId),incomeId:id(r.incomeId),incomeSignature:sig,amountCents:n,reference:text(r.reference,500,false,true),reason:text(r.reason,500,true,true)});
  }
  const totalKeys=['fundedCents','usedCents','lostCents','returnedCents','remainingCents'];
  function zeros(){return {fundedCents:0n,usedCents:0n,lostCents:0n,returnedCents:0n,remainingCents:0n};}
  function numbers(row){return Object.fromEntries(totalKeys.map(key=>[key,safe(row[key])]));}
  function equalSignature(a,b){return a.type===b.type&&a.date===b.date&&a.amountCents===b.amountCents&&a.accountId===b.accountId&&a.toAccountId===b.toAccountId;}
  function validateGraph(value){
    const r=record(value,['positions','recognitions','returns','sources','categories']);
    // Bound every array before normalizing any row, including semantically unused input.
    const ps=arrayValues(r.positions,LIMITS.positions),rs=arrayValues(r.recognitions,LIMITS.children),ts=arrayValues(r.returns,LIMITS.children),ss=arrayValues(r.sources,LIMITS.sources),cs=arrayValues(r.categories,LIMITS.categories);
    if(rs.length+ts.length>LIMITS.children||ps.length+rs.length+ts.length>LIMITS.dateOccurrences)fail('HELD_LIMIT','Too many active held children');
    const sources=new Map(),categories=new Map(),used=new Set(),accountIds=new Set();
    for(const value of ss){const row=record(value,['id','type','date','amountCents','accountId','toAccountId']),key=id(row.id);if(used.has(key))fail('DUPLICATE_ID','Repeated source');used.add(key);const sig=signature({type:row.type,date:row.date,amountCents:row.amountCents,accountId:row.accountId,toAccountId:row.toAccountId});sources.set(key,sig);accountIds.add(sig.accountId);if(sig.toAccountId)accountIds.add(sig.toAccountId);}
    for(const value of cs){const row=record(value,['id','type','name']),key=id(row.id);if(used.has(key))fail('DUPLICATE_ID','Repeated category');used.add(key);if(!['expense','income'].includes(row.type))invalid('Invalid category type');categories.set(key,{id:key,type:row.type,name:text(row.name,80,true)});}
    const positions=ps.map(normalizePosition),recognitions=rs.map(normalizeRecognition),returns=ts.map(normalizeReturn),parents=new Map(),children=new Map(),funding=new Map(),receipts=new Map(),totals=zeros();
    for(const row of [...positions,...recognitions,...returns]){if(used.has(row.id)||accountIds.has(row.id))fail('DUPLICATE_ID','Held identifier overlaps another record');used.add(row.id);}
    function reserve(map,key,n,sig){const source=sources.get(key);if(!source||!equalSignature(source,sig))fail('HELD_SOURCE_CHANGED','Active held source missing or changed');const sum=(map.get(key)||0n)+BigInt(n);if(sum>BigInt(source.amountCents))fail(source.type==='expense'?'EXPENSE_OVERALLOCATED':'INCOME_OVERALLOCATED','Held source is overallocated');map.set(key,sum);}
    for(const row of positions){parents.set(row.id,row);children.set(row.id,[]);reserve(funding,row.expenseId,row.amountCents,row.expenseSignature);totals.fundedCents+=BigInt(row.amountCents);}
    for(const row of [...recognitions,...returns]){const parent=parents.get(row.positionId);if(!parent)fail('HELD_PARENT_MISSING','Active held parent is required');const isReturn=hasOwn(row,'incomeId'),day=isReturn?row.incomeSignature.date:row.effectiveDate;if(day<parent.expenseSignature.date||row.asOfDate<parent.expenseSignature.date)fail('HELD_DATE','Child precedes funding');const list=children.get(parent.id);list.push({row,day,kind:isReturn?'returnedCents':row.kind==='use'?'usedCents':'lostCents'});if(list.length>LIMITS.childrenPerPosition)fail('HELD_LIMIT','Too many children for one position');if(isReturn)reserve(receipts,row.incomeId,row.amountCents,row.incomeSignature);else {const category=categories.get(row.categoryId);if(!category||category.type!=='expense')fail('INVALID_HELD_CATEGORY','Active recognition requires live expense category');}totals[isReturn?'returnedCents':row.kind==='use'?'usedCents':'lostCents']+=BigInt(row.amountCents);}
    const timelines=positions.map(row=>{const buckets=new Map();function bucket(day){if(!buckets.has(day))buckets.set(day,zeros());return buckets.get(day);}bucket(row.expenseSignature.date).fundedCents=BigInt(row.amountCents);for(const child of children.get(row.id))bucket(child.day)[child.kind]+=BigInt(child.row.amountCents);if(buckets.size>LIMITS.daysPerPosition)fail('HELD_LIMIT','Too many effective days');let balance=0n;const days=[...buckets.keys()].sort().map(day=>{const b=buckets.get(day);balance+=b.fundedCents-b.usedCents-b.lostCents-b.returnedCents;if(balance<0n)fail('HELD_OVERDRAWN','Recorded principal becomes negative');b.remainingCents=balance;return {date:day,...numbers(b)};});return {positionId:row.id,days};});
    totals.remainingCents=totals.fundedCents-totals.usedCents-totals.lostCents-totals.returnedCents;
    const result=frozen({positions,recognitions,returns,sourceReservations:[...funding].sort(([a],[b])=>a.localeCompare(b)).map(([expenseId,n])=>({expenseId,amountCents:safe(n)})),receiptReservations:[...receipts].sort(([a],[b])=>a.localeCompare(b)).map(([incomeId,n])=>({incomeId,amountCents:safe(n)})),timelines,totals:numbers(totals)});ownGraphs.add(result);return result;
  }
  function balancesAt(graph,value){if(!ownGraphs.has(graph))fail('INVALID_HELD_GRAPH','Use the original validated immutable graph');const asOfDate=date(value),totals=zeros(),positions=graph.timelines.map(timeline=>{const sums=zeros();for(const day of timeline.days){if(day.date>asOfDate)break;for(const key of totalKeys)if(key!=='remainingCents')sums[key]+=BigInt(day[key]);}sums.remainingCents=sums.fundedCents-sums.usedCents-sums.lostCents-sums.returnedCents;for(const key of totalKeys)totals[key]+=sums[key];return {positionId:timeline.positionId,...numbers(sums)};});return frozen({asOfDate,positions,totals:numbers(totals)});}
  return Object.freeze({normalizePosition,normalizeRecognition,normalizeReturn,validateGraph,balancesAt,HeldCoreError,LIMITS});
}));
