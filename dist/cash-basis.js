/* Read-only, explicitly reviewed day-end cash basis. No persistence capabilities. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoneygoCashBasis = api;
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const VERSION = 1;
  const LIMITS = Object.freeze({ inputBytes:33554432, queryBytes:8388608, resultBytes:8388608, accounts:100, accountDecisions:200, transactions:10000, movements:20000, nonfundingRecords:10000, snapshots:100, importSources:10000, manualSources:100, sourceDecisions:10100, dependencyPairs:1010000, blockerRows:100000, importConflicts:10000, conflictPossibilities:4, proofRecords:100000, depth:128, dataNodes:33554432, stringCodeUnits:33554432, reasonCodeUnits:500, pageRows:50, mountedDataRows:200, proofTextPageCodeUnits:4000 });
  const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
  const sortedUnique = values => [...new Set(values)].sort(compare);
  const own = (v,k) => Object.prototype.hasOwnProperty.call(v,k);
  // A thrown proxy is untrusted too: identity lookup must not inspect its prototype.
  const cashErrors = new WeakMap();
  class CashBasisError extends Error { constructor(code,message) { super(message); this.name='CashBasisError'; this.code=code; cashErrors.set(this, Object.freeze({code,message})); } }
  function fail(code,message) { throw new CashBasisError(code,message); }
  function ledger() { const x=typeof module==='object'&&module.exports?require('./ledger.js'):root.MoneygoLedger; if(!x)fail('CASH_INVALID_DATA','账本校验模块未加载'); return x; }
  function relations() { const x=typeof module==='object'&&module.exports?require('./relations.js'):root.MoneygoRelations; if(!x)fail('CASH_INVALID_DATA','账户流水模块未加载'); return x; }
  function freeze(v, seen=new Set()) { if(v&&typeof v==='object'&&!seen.has(v)){seen.add(v);for(const k of Object.keys(v))freeze(v[k],seen);Object.freeze(v);}return v; }
  function utf8(s) { let n=0; for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c<128)n++;else if(c<2048)n+=2;else if(c>=0xd800&&c<=0xdbff&&s.charCodeAt(i+1)>=0xdc00&&s.charCodeAt(i+1)<=0xdfff){n+=4;i++;}else n+=3;}return n; }
  function canonical(v) { if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.keys(v).sort(compare).map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}'; }
  // Descriptor-first capture: no raw getter or serializer is called. Proxy traps
  // cannot all be prevented by JavaScript; introspection failures are contained.
  function detach(raw, limit, invalid, limitCode) {
    let bytes=0,nodes=0,chars=0; const seen=new Set();
    function add(n){bytes+=n;if(bytes>limit)fail(limitCode,'完整数据超过字节上限');}
    function string(s){chars+=s.length;if(chars>LIMITS.stringCodeUnits)fail(limitCode,'文本超过数据上限');add(utf8(JSON.stringify(s)));return s;}
    function ordinaryPrototype(v,array) {
      const p=Object.getPrototypeOf(v);
      if(p===null){if(array)fail(invalid,'数组原型无效');return;}
      const c=Object.getOwnPropertyDescriptor(p,'constructor');
      if(!c||!own(c,'value')||typeof c.value!=='function'||Function.prototype.toString.call(c.value)!==(array?'function Array() { [native code] }':'function Object() { [native code] }')||Object.getOwnPropertyDescriptor(c.value,'prototype')?.value!==p)fail(invalid,'仅接受普通数据原型');
      const pp=Object.getPrototypeOf(p);
      if(!array&&pp!==null)fail(invalid,'对象原型无效');
      if(array){if(pp===null||Object.getPrototypeOf(pp)!==null)fail(invalid,'数组原型无效');const oc=Object.getOwnPropertyDescriptor(pp,'constructor');if(!oc||!own(oc,'value')||typeof oc.value!=='function'||Function.prototype.toString.call(oc.value)!=='function Object() { [native code] }')fail(invalid,'数组原型无效');}
    }
    function walk(v,depth){
      if(++nodes>LIMITS.dataNodes||depth>LIMITS.depth)fail(limitCode,'数据树超过上限');
      if(v===null){add(4);return null;}if(typeof v==='string')return string(v);
      if(typeof v==='boolean'){add(v?4:5);return v;}
      if(typeof v==='number'){if(!Number.isFinite(v)||Object.is(v,-0))fail(invalid,'数字必须有限且不能为负零');add(JSON.stringify(v).length);return v;}
      if(typeof v!=='object')fail(invalid,'仅接受 JSON 普通数据');
      if(seen.has(v))fail(invalid,'数据不能包含循环或共享引用');seen.add(v);
      const array=Array.isArray(v);ordinaryPrototype(v,array);const keys=Reflect.ownKeys(v);
      const ds=new Map();for(const k of keys){if(typeof k!=='string')fail(invalid,'数据不能含符号字段');const d=Object.getOwnPropertyDescriptor(v,k);if(!d||!own(d,'value')||(!d.enumerable&&!(array&&k==='length')))fail(invalid,'字段必须为自有可枚举数据');ds.set(k,d);if(++nodes>LIMITS.dataNodes)fail(limitCode,'数据节点超过上限');}
      add(2);
      if(array){const len=ds.get('length')?.value;if(!Number.isSafeInteger(len)||len<0||keys.length!==len+1)fail(invalid,'数组必须连续且没有额外字段');const out=[];for(let i=0;i<len;i++){const d=ds.get(String(i));if(!d)fail(invalid,'数组不能稀疏');if(i)add(1);out.push(walk(d.value,depth+1));}return out;}
      const out={};let i=0;for(const k of [...ds.keys()].sort(compare)){if(i++)add(1);string(k);add(1);Object.defineProperty(out,k,{value:walk(ds.get(k).value,depth+1),enumerable:true,writable:true,configurable:true});}return out;
    }
    try { return walk(raw,0); } catch(e){const internal=cashErrors.get(e);if(internal)fail(internal.code,internal.message);fail(invalid,'无法安全读取普通数据');}
  }
  function exact(v,keys,code) { if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==keys.length||keys.some(k=>!own(v,k)))fail(code,'字段不符合完整封闭格式'); }
  function id(v,code) { if(typeof v!=='string'||v.length>100||!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(v)||v==='constructor'||v==='prototype')fail(code,'标识无效');return v; }
  const controls=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
  function reason(v,required,code) { if(typeof v!=='string'||v.length>500||controls.test(v)||(required&&!v.trim()))fail(code,'理由须为允许的非空文本且不超过 500 字符');return v; }
  function validDate(v) { return typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&v>='0001-01-01'&&v<='9999-12-31'&&ledger().validDate(v); }
  function day(v,code='CASH_INVALID_DATE') { if(!validDate(v))fail(code,'日期须为 0001 至 9999 年有效公历日期');return v; }
  function adjacent(v,delta) { const d=new Date(v+'T00:00:00.000Z');d.setUTCDate(d.getUTCDate()+delta);return d.toISOString().slice(0,10); }
  function sourceKey(v) { if(typeof v!=='string'||v.length>100||!v.trim()||controls.test(v))fail('CASH_INVALID_QUERY','来源键无效');return v; }
  const sourceId = s => JSON.stringify([s.kind,s.accountId,s.sourceKey]);
  const sourceCompare = (a,b) => compare(a.kind,b.kind)||compare(a.accountId,b.accountId)||compare(a.sourceKey,b.sourceKey);
  const proofCompare = (a,b) => compare(a.kind,b.kind)||compare(a.id,b.id);
  function decision(v) { if(!['include','exclude','unreviewed'].includes(v))fail('CASH_INVALID_QUERY','范围决定无效');return v; }
  function queryShape(q,state,inspect) {
    const code='CASH_INVALID_QUERY';exact(q,inspect?['asOfDate']:['asOfDate','accounts','sources'],code);day(q.asOfDate);
    if(inspect)return q;
    if(!Array.isArray(q.accounts)||q.accounts.length>LIMITS.accountDecisions)fail(code,'账户决定数量无效');
    if(!Array.isArray(q.sources))fail(code,'来源决定须为数组');if(q.sources.length>LIMITS.sourceDecisions)fail('CASH_SOURCE_LIMIT','来源决定数量超过上限');
    const accounts=new Set(state.accounts.map(a=>a.id)), seenA=new Set(),seenS=new Set();let missing=0;
    for(const a of q.accounts){exact(a,['accountId','decision','reason'],code);id(a.accountId,code);decision(a.decision);reason(a.reason,a.decision==='exclude',code);if(seenA.has(a.accountId))fail(code,'账户决定重复');seenA.add(a.accountId);if(!accounts.has(a.accountId)&&++missing>100)fail(code,'不存在账户声明超过上限');}
    for(const d of q.sources){exact(d,['source','decision','reason','manualCoverage'],code);exact(d.source,['kind','accountId','sourceKey'],code);const s=d.source;id(s.accountId,code);if(!accounts.has(s.accountId))fail(code,'来源所属账户不存在');if(s.kind==='manual'){if(s.sourceKey!==null)fail(code,'手工来源不能有导入键');}else if(s.kind==='import')sourceKey(s.sourceKey);else fail(code,'来源类型无效');decision(d.decision);reason(d.reason,d.decision==='exclude',code);const k=sourceId(s);if(seenS.has(k))fail(code,'来源决定重复');seenS.add(k);
      if(d.manualCoverage!==null){if(s.kind!=='manual')fail(code,'导入来源不能使用手工覆盖');const c=d.manualCoverage;exact(c,['start','end','allUnimportedMovementsRecorded','reason'],code);day(c.start,code);day(c.end,code);if(c.start>c.end||c.allUnimportedMovementsRecorded!==true)fail(code,'手工覆盖区间或声明无效');reason(c.reason,true,code);}
    }
    q.accounts.sort((a,b)=>compare(a.accountId,b.accountId));q.sources.sort((a,b)=>sourceCompare(a.source,b.source));return q;
  }
  function consentShape(c) { const code='CASH_INVALID_CONSENT';exact(c,['accountUniverseReviewed','sourceUniverseReviewed','userDeclarationsNotBankVerification','dayEndNotRealtime','reason'],code);for(const k of ['accountUniverseReviewed','sourceUniverseReviewed','userDeclarationsNotBankVerification','dayEndNotRealtime'])if(c[k]!==true)fail(code,'须明确确认全部范围声明');reason(c.reason,true,code);return c; }
  function legacy(fn) {try{return fn();}catch(e){const internal=cashErrors.get(e);if(internal)fail(internal.code,internal.message);let code=null;try{const d=e&&(typeof e==='object'||typeof e==='function')?Object.getOwnPropertyDescriptor(e,'code'):null;if(d&&own(d,'value'))code=d.value;}catch(_){}if(code==='AMOUNT_OVERFLOW'||code==='OVERFLOW')fail('CASH_AMOUNT_OVERFLOW','金额运算超出安全整数范围');fail('CASH_INVALID_DATA','账本未通过既有完整校验');}}
  function capture(raw,q,inspect) {const detached=detach(raw,LIMITS.inputBytes,'CASH_INVALID_DATA','CASH_INPUT_LIMIT'), query=detach(q,LIMITS.queryBytes,'CASH_INVALID_QUERY','CASH_QUERY_LIMIT');if(Array.isArray(detached?.accounts)&&detached.accounts.length>LIMITS.accounts||Array.isArray(detached?.transactions)&&detached.transactions.length>LIMITS.transactions||Array.isArray(detached?.bookkeeping?.snapshots)&&detached.bookkeeping.snapshots.length>LIMITS.snapshots)fail('CASH_INPUT_LIMIT','账本记录数量超过上限');freeze(detached);const state=legacy(()=>ledger().validateState(detached));queryShape(query,state,inspect);freeze(state);freeze(query);return {raw:detached,state,query,stateKey:canonical(detached),queryKey:canonical(query)};}
  function safe(n) {const b=typeof n==='bigint'?n:BigInt(n);if(b>BigInt(Number.MAX_SAFE_INTEGER)||b<BigInt(Number.MIN_SAFE_INTEGER))fail('CASH_AMOUNT_OVERFLOW','金额运算超出安全整数范围');return Number(b);}
  function sum(values) {let total=0n;for(const v of values){total+=BigInt(v);safe(total);}return Number(total);}
  function resultLimit(v) {if(utf8(canonical(v))>LIMITS.resultBytes)fail('CASH_RESULT_LIMIT','完整报告超过 8 MiB，不能截断证据');return freeze(v);}
  function financial(t) {return t?{id:t.id,type:t.type,date:t.date,amountCents:t.amountCents,accountId:t.accountId,toAccountId:t.type==='transfer'?t.toAccountId:null}:null;}
  function gaps(intervals,start,end) {const rows=intervals.filter(i=>i.end>=start&&i.start<=end).slice().sort((a,b)=>compare(a.start,b.start)||compare(a.end,b.end));const out=[];let cursor=start;for(const r of rows){if(r.end<cursor)continue;if(r.start>cursor)out.push({start:cursor,end:adjacent(r.start,-1)});if(r.end>=end)return out;cursor=adjacent(r.end,1);}if(cursor<=end)out.push({start:cursor,end});return out;}
  function build(capture,clock,status,consent) {
    const {raw,state,query}=capture, cutoff=query.asOfDate, confirmed=status==='confirmed', selected=status!=='unreviewed';
    const actual=legacy(()=>relations().calculate(state));
    const book=state.bookkeeping||{}, imports=state.imports||{};
    const pools=new Map(),proofs=new Map();
    const paths={account:raw.accounts,transaction:raw.transactions,'trash-transaction':raw.trash,'role-profile':raw.obligations?.profiles,snapshot:raw.bookkeeping?.snapshots,'snapshot-create-audit':raw.bookkeeping?.audit,'duplicate-link':raw.bookkeeping?.links,composite:raw.bookkeeping?.composites,'transfer-pair':raw.bookkeeping?.transferPairs,'import-template':raw.imports?.templates,'import-evidence':raw.imports?.evidence,'import-batch':raw.imports?.batches,'import-quarantine':raw.imports?.quarantine,'import-coverage':raw.imports?.coverage,'source-scope':raw.organizer?.scopes};
    for(const [kind,rows] of Object.entries(paths))pools.set(kind,new Map((rows||[]).map(row=>[row.id,row])));
    function ref(kind,id) {const key=JSON.stringify([kind,id]);if(!proofs.has(key)){const value=pools.get(kind)?.get(id);if(!value)fail('CASH_INVARIANT','证明引用缺少原始记录');if(proofs.size>=LIMITS.proofRecords)fail('CASH_RESULT_LIMIT','证明记录数量超过上限');proofs.set(key,{ref:{kind,id},value});}return proofs.get(key).ref;}
    function batch(id) {if(!id)return;const queue=[id];while(queue.length){const key=queue.pop(),pk=JSON.stringify(['import-batch',key]);if(proofs.has(pk))continue;const r=pools.get('import-batch').get(key);if(!r)fail('CASH_INVARIANT','批次证明链缺失');ref('import-batch',key);ref('import-template',r.templateId);for(const ch of r.changes||[])if(ch.before?.lastBatchId)queue.push(ch.before.lastBatchId);if(r.repair?.previousResolvedByBatchId)queue.push(r.repair.previousResolvedByBatchId);}}
    function evidenceProof(e){const r=ref('import-evidence',e.id);batch(e.firstBatchId);batch(e.lastBatchId);return r;}
    const accountDecisions=new Map((selected?query.accounts:[]).map(d=>[d.accountId,d])), sourceDecisions=new Map((selected?query.sources:[]).map(d=>[sourceId(d.source),d]));
    const profiles=new Map((state.obligations?.profiles||[]).map(p=>[p.accountId,p]));
    const creates=new Map();for(const a of book.audit||[])if(a.kind==='snapshot'&&a.action==='create'&&a.before===null&&a.after?.id===a.recordId){if(!creates.has(a.recordId))creates.set(a.recordId,[]);creates.get(a.recordId).push(a);}
    const snapshots=new Map();for(const s of book.snapshots||[]){if(!snapshots.has(s.accountId))snapshots.set(s.accountId,[]);snapshots.get(s.accountId).push(s);}
    const accountRows=new Map(state.accounts.map(a=>[a.id,a]));
    const accountIds=sortedUnique([...accountRows.keys(),...accountDecisions.keys()]);
    const accounts=accountIds.map(accountId=>{
      const a=accountRows.get(accountId),d=accountDecisions.get(accountId),profile=profiles.get(accountId),reasons=[];
      const result={accountId,accountRef:a?ref('account',a.id):null,name:a?a.name:null,decision:d?.decision||'unreviewed',exclusionReason:d?.decision==='exclude'?d.reason:null,role:a?(profile?.role||'unknown'):'missing',profileRef:profile?ref('role-profile',profile.id):null,selectedSnapshotRef:null,snapshotCandidates:[],futureSnapshotRefs:[],selectionAuditRevision:null,snapshotDate:null,observedSnapshotCents:null,currentReconciliation:null,bridge:{startExclusive:null,endInclusive:cutoff,coverage:'unknown',requiredSourceRefs:[],movementKeys:[]},knownBridgeDeltaCents:null,arithmeticCandidateCents:null,supportedBasisCents:null,reasonCodes:reasons};
      if(!a)reasons.push('account-not-found');
      if(result.decision==='unreviewed')reasons.push('account-unreviewed');if(result.decision==='exclude')reasons.push('account-excluded');
      if(result.role==='unknown')reasons.push('role-unknown');else if(a&&result.role!=='cash')reasons.push('role-not-cash');
      const rows=(snapshots.get(accountId)||[]).slice();const eligible=rows.filter(s=>s.date<=cutoff);const latest=eligible.reduce((date,s)=>s.date>date?s.date:date,'');const bucket=eligible.filter(s=>s.date===latest);
      const original=s=>{const events=creates.get(s.id)||[];return events.length===1?events[0]:null;};
      let winner=null,ambiguous=false;
      if(bucket.length){const revs=bucket.map(s=>original(s)?.revision);ambiguous=revs.some(v=>v===undefined)||new Set(revs).size!==revs.length;if(!ambiguous)winner=bucket.reduce((w,s)=>original(s).revision>original(w).revision?s:w);else reasons.push('snapshot-order-unproven');}else if(a)reasons.push('snapshot-missing');
      rows.sort((x,y)=>compare(x.date,y.date)||compare(original(x)?.revision??Infinity,original(y)?.revision??Infinity)||compare(x.id,y.id));
      for(const s of rows){const audit=original(s),snapshotRef=ref('snapshot',s.id);const selection=s.date>cutoff?'future':s.date<latest?'older':ambiguous?'ambiguous':s.id===winner?.id?'selected':'same-day-not-selected';result.snapshotCandidates.push({snapshotRef,date:s.date,originalCreateAuditRef:audit?ref('snapshot-create-audit',audit.id):null,originalCreateRevision:audit?.revision??null,selection});if(selection==='future')result.futureSnapshotRefs.push(snapshotRef);}
      if(winner){result.selectedSnapshotRef=ref('snapshot',winner.id);result.selectionAuditRevision=original(winner).revision;result.snapshotDate=winner.date;result.observedSnapshotCents=winner.actualBalanceCents;result.currentReconciliation=legacy(()=>relations().reconciliation(state,winner.id));result.bridge.startExclusive=winner.date;if(winner.date===cutoff)result.bridge.coverage='not-required-at-anchor';if(!result.currentReconciliation.reconciled)reasons.push('snapshot-difference');if(result.currentReconciliation.changed)reasons.push('snapshot-proof-changed');}
      if(!confirmed)reasons.push('scope-review-pending');return result;
    });
    const byAccount=new Map(accounts.map(a=>[a.accountId,a]));
    const sourcesMap=new Map();let importCount=0,manualCount=0,pairsCount=0,blockersCount=0,conflictsCount=0;
    function source(identity){const key=sourceId(identity);let s=sourcesMap.get(key);if(!s){if(identity.kind==='import'&&++importCount>LIMITS.importSources||identity.kind==='manual'&&++manualCount>LIMITS.manualSources)fail('CASH_SOURCE_LIMIT','来源目录超过上限');const d=sourceDecisions.get(key);s={source:identity,decision:d?.decision||'unreviewed',reason:d?.reason||'',affectedAccountIds:[],storedScopeRefs:[],coverageRefs:[],coverageIntervals:[],manualCoverage:d?.manualCoverage||null,evidenceRefs:[],conflicts:[],blockers:[],reasonCodes:[],affected:new Set(),required:new Set(),pending:[]};sourcesMap.set(key,s);affect(s,identity.accountId);}return s;}
    function affect(s,a){if(!s.affected.has(a)){s.affected.add(a);if(++pairsCount>LIMITS.dependencyPairs)fail('CASH_RESULT_LIMIT','来源账户依赖数量超过上限');}}
    const importIdentity=r=>({kind:'import',accountId:r.accountId,sourceKey:r.sourceKey});
    for(const a of state.accounts)source({kind:'manual',accountId:a.id,sourceKey:null});
    for(const d of selected?query.sources:[])source(d.source);
    for(const row of state.organizer?.scopes||[]){const s=source(importIdentity(row));s.storedScopeRefs.push(ref('source-scope',row.id));}
    for(const row of imports.templates||[]){source(importIdentity(row));ref('import-template',row.id);}
    for(const row of imports.batches||[])if(!row.rolledBack){source(importIdentity(row));batch(row.id);}
    for(const row of imports.coverage||[]){const s=source(importIdentity(row)),r=ref('import-coverage',row.id);batch(row.batchId);s.coverageRefs.push(r);s.coverageIntervals.push({start:row.start,end:row.end,proofRef:r});}
    const evidenceByTransaction=new Map();
    for(const e of imports.evidence||[]){const s=source(importIdentity(e));s.evidenceRefs.push(evidenceProof(e));if(e.transactionId)evidenceByTransaction.set(e.transactionId,e);if(e.status==='pending')s.pending.push({code:'import-pending',date:validDate(e.normalized?.date)?e.normalized.date:null,proofRefs:[ref('import-evidence',e.id)]});}
    for(const q of imports.quarantine||[])if(!q.resolvedByBatchId){const s=source(importIdentity(q)),r=ref('import-quarantine',q.id);batch(q.batchId);s.evidenceRefs.push(r);s.pending.push({code:'import-quarantine',date:!(q.rawTruncated||[]).includes('date')&&validDate(q.mapped?.date)?q.mapped.date:null,proofRefs:[r]});}
    const relationRefs=new Map(),connected=new Map(),connectedCache=new Map();
    function relation(kind,r,ids){const rr=ref(kind,r.id);for(const id of ids){if(!relationRefs.has(id))relationRefs.set(id,[]);relationRefs.get(id).push(rr);if(!connected.has(id))connected.set(id,new Set([id]));for(const other of ids)connected.get(id).add(other);}}
    for(const r of book.links||[])relation('duplicate-link',r,[r.primaryId,r.shadowId]);
    for(const r of book.composites||[])relation('composite',r,sortedUnique([...r.personalIds,...r.fundingIds]));
    for(const r of book.transferPairs||[])relation('transfer-pair',r,[r.expenseId,r.incomeId]);
    function provenance(t,accountId){const direct=evidenceByTransaction.get(t);let related=connectedCache.get(t);if(!related){related=new Set();const queue=[t];while(queue.length){const next=queue.pop();if(related.has(next))continue;related.add(next);for(const other of connected.get(next)||[])queue.push(other);}for(const id of related)connectedCache.set(id,related);}const ids=new Map(),refs=[];for(const id of related)refs.push(...(relationRefs.get(id)||[]));if(!direct){const s=source({kind:'manual',accountId,sourceKey:null});ids.set(sourceId(s.source),s.source);}
      for(const id of related){const e=evidenceByTransaction.get(id);if(e){const s=source(importIdentity(e));ids.set(sourceId(s.source),s.source);refs.push(evidenceProof(e));affect(s,accountId);}}
      return {sourceRefs:[...ids.values()].sort(sourceCompare),proofRefs:[...new Map(refs.map(r=>[JSON.stringify(r),r])).values()].sort(proofCompare)};
    }
    const movements=[],nonfundingRecords=[];
    for(const row of actual.drilldown.accountFlows)for(const m of row.movements){if(!m.signedCents)fail('CASH_INVARIANT','账户资金腿不能为零');const a=byAccount.get(m.accountId);if(!a)fail('CASH_INVARIANT','资金腿账户缺失');const p=provenance(row.transactionId,m.accountId),date=row.date;const temporalPosition=date>cutoff?'after-cutoff':!a.snapshotDate?'unanchored-through-cutoff':date<=a.snapshotDate?'at-or-before-anchor':'bridge';const disposition=a.decision==='exclude'?'excluded-account':a.decision==='unreviewed'?'unreviewed-account':a.role!=='cash'?'ineligible-account':date>cutoff?'future-recorded':!a.snapshotDate?'no-anchor':date<=a.snapshotDate?'absorbed-in-snapshot':'known-bridge';const codes=[];if(temporalPosition==='after-cutoff')codes.push('after-cutoff');if(temporalPosition==='at-or-before-anchor')codes.push('at-or-before-anchor');if(temporalPosition==='unanchored-through-cutoff')codes.push('no-anchor');if(a.decision==='exclude')codes.push('account-excluded');if(a.decision==='unreviewed')codes.push('account-unreviewed');if(a.role!=='cash')codes.push(a.role==='unknown'?'role-unknown':'role-not-cash');movements.push({key:{transactionId:row.transactionId,accountId:m.accountId,leg:m.signedCents>0?'in':'out'},date,signedCents:safe(m.signedCents),transactionRef:ref('transaction',row.transactionId),sourceRefs:p.sourceRefs,proofRefs:p.proofRefs,accountDecision:a.decision,temporalPosition,disposition,reasonCodes:sortedUnique(codes)});}
    movements.sort((a,b)=>compare(a.date,b.date)||compare(a.key.transactionId,b.key.transactionId)||compare(a.key.accountId,b.key.accountId)||compare(a.key.leg,b.key.leg));
    if(movements.length>LIMITS.movements)fail('CASH_RESULT_LIMIT','账户资金腿超过上限');
    for(const t of state.transactions){const p=actual.impacts[t.id];if(p.excluded||p.fundingAuthority===false){const refs=provenance(t.id,t.accountId).proofRefs;nonfundingRecords.push({transactionId:t.id,date:t.date,accountId:t.accountId,reason:p.excluded?'duplicate-shadow':'composite-nonfunding',transactionRef:ref('transaction',t.id),proofRefs:refs});}}
    nonfundingRecords.sort((a,b)=>compare(a.date,b.date)||compare(a.transactionId,b.transactionId)||compare(a.accountId,b.accountId));
    if(nonfundingRecords.length>LIMITS.nonfundingRecords)fail('CASH_RESULT_LIMIT','非资金证明记录超过上限');
    // Each partition is reduced in canonical order, with every partial checked.
    const partitionSums=new Map(),accountMovementSums=new Map(),bridgeAmounts=new Map();
    for(const m of movements){accountMovementSums.set(m.key.accountId,safe(BigInt(accountMovementSums.get(m.key.accountId)||0)+BigInt(m.signedCents)));const pk=JSON.stringify([m.key.accountId,m.temporalPosition]);partitionSums.set(pk,safe(BigInt(partitionSums.get(pk)||0)+BigInt(m.signedCents)));if(m.temporalPosition==='bridge'){const a=byAccount.get(m.key.accountId);a.bridge.movementKeys.push(m.key);if(!bridgeAmounts.has(a.accountId))bridgeAmounts.set(a.accountId,[]);bridgeAmounts.get(a.accountId).push(m.signedCents);for(const identity of m.sourceRefs)source(identity).required.add(a.accountId);}}
    for(const a of accounts)if(a.snapshotDate){a.knownBridgeDeltaCents=sum(bridgeAmounts.get(a.accountId)||[]);a.arithmeticCandidateCents=safe(BigInt(a.observedSnapshotCents)+BigInt(a.knownBridgeDeltaCents));}
    const locations=new Map(state.transactions.map(t=>[t.id,{location:'active',transaction:t}]));for(const row of state.trash)locations.set(row.transaction.id,{location:'trash',transaction:row.transaction});
    function possibility(t,side){if(!t)return [];const legs=[{accountId:t.accountId,leg:t.type==='income'?'in':'out'}];if(t.type==='transfer')legs.push({accountId:t.toAccountId,leg:'in'});return legs.map(leg=>{const a=byAccount.get(leg.accountId),date=validDate(t.date)?t.date:null;const relevance=!a?.snapshotDate||date===null?'unknown':date>a.snapshotDate&&date<=cutoff?'bridge':'outside-bridge';return {accountId:leg.accountId,date,side,leg:leg.leg,relevance,blocksSupport:a?.decision==='include'&&!!a.snapshotDate&&a.snapshotDate<cutoff&&(relevance==='bridge'||date===null)};});}
    for(const e of imports.evidence||[]){if(e.status==='pending')continue;const s=source(importIdentity(e)),current=locations.get(e.transactionId)||{location:null,transaction:null},expected=financial(e.expectedTransaction),now=financial(current.transaction);const differences=[];if(e.expectedLocation!==current.location)differences.push('location');for(const field of ['id','type','date','amountCents','accountId','toAccountId'])if((expected?.[field]??null)!==(now?.[field]??null))differences.push(field);
      // Preserve all captured/current dependencies even when no conflict exists.
      const possibilities=[...possibility(expected,'captured'),...possibility(now,'current')];for(const p of possibilities)affect(s,p.accountId);
      if(!differences.length)continue;if(++conflictsCount>LIMITS.importConflicts||possibilities.length>LIMITS.conflictPossibilities)fail('CASH_RESULT_LIMIT','导入差异数量超过上限');
      const conflict={evidenceRef:ref('import-evidence',e.id),currentTransactionRef:current.transaction?ref(current.location==='active'?'transaction':'trash-transaction',current.transaction.id):null,expectedLocation:e.expectedLocation,currentLocation:current.location,expectedFinancial:expected,currentFinancial:now,differences:sortedUnique(differences),affectedPossibilities:possibilities,blocksSupport:possibilities.some(p=>p.blocksSupport)};s.conflicts.push(conflict);for(const p of possibilities)if(p.relevance==='bridge'||p.date===null)s.required.add(p.accountId);
    }
    function blocker(s,b){if(++blockersCount>LIMITS.blockerRows)fail('CASH_RESULT_LIMIT','来源阻塞记录超过上限');s.blockers.push(b);s.reasonCodes.push(b.code);const a=byAccount.get(b.accountId);if(a?.decision==='include')a.reasonCodes.push(b.code);}
    for(const s of sourcesMap.values())s.required.add(s.source.accountId);
    const sources=[...sourcesMap.values()].sort((a,b)=>sourceCompare(a.source,b.source));
    for(const s of sources){s.coverageIntervals.sort((a,b)=>compare(a.start,b.start)||compare(a.end,b.end)||proofCompare(a.proofRef,b.proofRef));s.coverageRefs.sort(proofCompare);s.storedScopeRefs.sort(proofCompare);s.evidenceRefs.sort(proofCompare);s.conflicts.sort((a,b)=>proofCompare(a.evidenceRef,b.evidenceRef));
      if(s.decision==='unreviewed')s.reasonCodes.push('source-unreviewed');if(s.decision==='exclude')s.reasonCodes.push('source-excluded');
      for(const accountId of [...s.required].sort(compare)){const a=byAccount.get(accountId);if(!a||!a.accountRef)continue;a.bridge.requiredSourceRefs.push(s.source);if(a.decision!=='include'||!a.snapshotDate)continue;
        const empty=a.snapshotDate===cutoff;if(s.decision==='unreviewed')blocker(s,{code:'source-unreviewed',accountId,date:null,proofRefs:[]});else if(s.decision==='exclude'&&!empty)blocker(s,{code:'source-excluded',accountId,date:null,proofRefs:[]});if(empty)continue;
        const start=adjacent(a.snapshotDate,1);
        if(s.source.kind==='manual'){if(s.decision==='include'){if(!s.manualCoverage)blocker(s,{code:'manual-coverage-missing',accountId,date:null,proofRefs:[]});else if(s.manualCoverage.start>start||s.manualCoverage.end<cutoff)blocker(s,{code:'manual-coverage-gap',accountId,date:null,proofRefs:[]});}}
        else {for(const gap of gaps(s.coverageIntervals,start,cutoff))blocker(s,{code:'coverage-gap',accountId,start:gap.start,end:gap.end,proofRefs:[]});for(const p of s.pending){if(p.date===null||p.date>a.snapshotDate&&p.date<=cutoff){blocker(s,{code:p.code,accountId,date:p.date,proofRefs:p.proofRefs});if(p.date===null)blocker(s,{code:'unknown-evidence-date',accountId,date:null,proofRefs:p.proofRefs});}else s.reasonCodes.push('source-history-outside-bridge');}}
      }
      for(const c of s.conflicts){if(!c.blocksSupport)s.reasonCodes.push('source-history-outside-bridge');const distinct=new Set();for(const p of c.affectedPossibilities)if(p.blocksSupport){for(const code of [...(c.differences.some(d=>d!=='location')?['import-financial-conflict']:[]),...(c.differences.includes('location')?['import-location-conflict']:[])]){const k=JSON.stringify([code,p.accountId,p.date]);if(!distinct.has(k)){distinct.add(k);blocker(s,{code,accountId:p.accountId,date:p.date,proofRefs:[c.evidenceRef,...(c.currentTransactionRef?[c.currentTransactionRef]:[])]});}}}}
      s.affectedAccountIds=[...s.affected].sort(compare);s.reasonCodes=sortedUnique(s.reasonCodes);delete s.affected;delete s.required;delete s.pending;
    }
    for(const a of accounts){a.bridge.requiredSourceRefs.sort(sourceCompare);a.reasonCodes=sortedUnique(a.reasonCodes);if(a.snapshotDate&&a.snapshotDate<cutoff&&confirmed&&a.decision==='include'&&!a.reasonCodes.some(c=>['source-unreviewed','source-excluded','manual-coverage-missing','manual-coverage-gap','coverage-gap','import-pending','import-quarantine','unknown-evidence-date','import-financial-conflict','import-location-conflict'].includes(c)))a.bridge.coverage='supported';if(confirmed&&a.decision==='include'&&a.role==='cash'&&a.arithmeticCandidateCents!==null&&a.reasonCodes.length===0)a.supportedBasisCents=a.arithmeticCandidateCents;}
    const included=accounts.filter(a=>a.decision==='include'),supported=included.filter(a=>a.supportedBasisCents!==null), unsupportedIncludedAccountIds=included.filter(a=>a.supportedBasisCents===null).map(a=>a.accountId),unreviewedAccountIds=accounts.filter(a=>a.accountRef&&a.decision==='unreviewed').map(a=>a.accountId),excludedAccountIds=accounts.filter(a=>a.decision==='exclude').map(a=>a.accountId),missingDeclaredAccountIds=accounts.filter(a=>!a.accountRef).map(a=>a.accountId),totalReasons=[];
    if(!confirmed)totalReasons.push('scope-review-pending');if(!included.length)totalReasons.push('no-included-accounts');if(unreviewedAccountIds.length)totalReasons.push('account-unreviewed');if(missingDeclaredAccountIds.length)totalReasons.push('account-not-found');if(unsupportedIncludedAccountIds.length)totalReasons.push('unsupported-included-account');
    const totals={supportedSelectedCents:totalReasons.length?null:sum(supported.map(a=>a.supportedBasisCents)),knownSupportedIncludedCents:supported.length?sum(supported.map(a=>a.supportedBasisCents)):null,unsupportedIncludedAccountIds,unreviewedAccountIds,excludedAccountIds,missingDeclaredAccountIds,reasonCodes:sortedUnique(totalReasons)};
    const disclosures=['仅为明确选择账户的有条件现金基线；范围和来源由用户复核，未发现的数据无法自动检测。','使用当前关系、角色和证据解释所选日终，不重建当时所知的信息。','余额快照、覆盖区间和手工活动声明均来自用户，不是银行核验。','日期精度为日终，不证明日内顺序、实时可用余额或支付成功。','未知账户和缺少活动不能视作零；已支持账户小计不是下界，也不是可安全支出的金额。','未来已记录资金腿、收入计划、支出计划、信用义务预测、非现金权益和旧沙盘不加入现金基线。'];if(cutoff===clock.today)disclosures.push('本日数字按用户填写／已记录的日终假设展示，不是此刻经银行核实的可用余额。');
    return {version:VERSION,asOfDate:cutoff,datePrecision:'day-end',todayAtReview:clock.today,reviewedAt:confirmed?clock.now:null,knowledgeBasis:'current-state-not-historical-knowledge',reviewStatus:status,query:selected?query:null,consent:confirmed?consent:null,scope:{accountUniverse:confirmed?'user-reviewed':'unreviewed',sourceUniverse:confirmed?'user-reviewed':'unreviewed',scopeLabel:'selected-accounts-only',sourceDiscovery:'retained-local-data-plus-user-declarations',undiscoveredData:'not-detectable',historicalImportCompleteness:'not-certified'},accounts,sources,movements,nonfundingRecords,totals,excludedInputKinds:['future-recorded-movements','income-plans','spending-plans','credit-obligation-forecast','held-noncash-rights','legacy-scenario'],proofRecords:[...proofs.values()].sort((a,b)=>proofCompare(a.ref,b.ref)),reasonCodes:sortedUnique([...totals.reasonCodes,...accounts.flatMap(a=>a.reasonCodes),...sources.flatMap(s=>s.reasonCodes)]),disclosures};
  }
  function createCoordinator(capabilities) {
    let now,today;
    try {if(!capabilities||typeof capabilities!=='object'||Array.isArray(capabilities))fail('CASH_INVALID_DATA','须提供两个时钟能力');const keys=Reflect.ownKeys(capabilities);if(keys.length!==2||!keys.includes('now')||!keys.includes('today'))fail('CASH_INVALID_DATA','仅接受 now 与 today 能力');const n=Object.getOwnPropertyDescriptor(capabilities,'now'),t=Object.getOwnPropertyDescriptor(capabilities,'today');if(!n||!t||!n.enumerable||!t.enumerable||!own(n,'value')||!own(t,'value')||typeof n.value!=='function'||typeof t.value!=='function')fail('CASH_INVALID_DATA','时钟须为自有函数能力');now=n.value;today=t.value;}catch(e){const internal=cashErrors.get(e);if(internal)fail(internal.code,internal.message);fail('CASH_INVALID_DATA','无法安全读取时钟能力');}
    let generation=0,greatestNow=null;const tickets=new WeakMap(),reports=new WeakMap();
    function invalidateAll(){generation++;}
    function clock(){let n,t;try{n=now();t=today();}catch(_){invalidateAll();fail('CASH_INVALID_DATA','无法读取当前时间');}if(typeof n!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(n)||!validDate(n.slice(0,10))||!Number.isFinite(Date.parse(n))||new Date(n).toISOString()!==n||!validDate(t)){invalidateAll();fail('CASH_INVALID_DATA','时钟值格式无效');}if(greatestNow!==null&&n<greatestNow){invalidateAll();fail('CASH_CLOCK_ROLLBACK','时钟倒退，请重新核对');}greatestNow=n;return {now:n,today:t};}
    clock();
    function cutoff(q,c){if(q.asOfDate>c.today)fail('CASH_CUTOFF_IN_FUTURE','截止日期不能晚于当前本地日期');}
    function inspect(raw,options){const c=capture(raw,options,true),time=clock();cutoff(c.query,time);return resultLimit(build(c,time,'unreviewed',null));}
    function preview(raw,query){invalidateAll();const c=capture(raw,query,false),time=clock();cutoff(c.query,time);const ticket=Object.freeze({}),report=build(c,time,'pending',null),result=resultLimit({ticket,report});tickets.set(ticket,{generation,stateKey:c.stateKey,queryKey:c.queryKey,today:time.today,live:true});return result;}
    function confirm(raw,ticket,query,consent){const held=ticket&&typeof ticket==='object'?tickets.get(ticket):null;if(!held||!held.live||held.generation!==generation)fail('CASH_REVIEW_USED','核对凭据已使用或不属于当前会话');held.live=false;const time=clock(),permissionRaw=detach(consent,LIMITS.queryBytes,'CASH_INVALID_CONSENT','CASH_INVALID_CONSENT'),c=capture(raw,query,false);if(held.today!==time.today||held.stateKey!==c.stateKey||held.queryKey!==c.queryKey)fail('CASH_STALE_REVIEW','范围或依据已改变，请重新核对');cutoff(c.query,time);const permission=consentShape(permissionRaw),report=resultLimit(build(c,time,'confirmed',permission));reports.set(report,{generation,stateKey:c.stateKey,queryKey:c.queryKey,today:time.today,accounts:c.state.accounts.map(a=>({id:a.id})),live:true});return report;}
    function cancel(ticket){const held=ticket&&typeof ticket==='object'?tickets.get(ticket):null;const cancelled=!!held&&held.live&&held.generation===generation;if(cancelled){held.live=false;invalidateAll();}return Object.freeze({cancelled});}
    function isCurrent(raw,report,query){const held=report&&typeof report==='object'?reports.get(report):null;if(!held||!held.live)return false;try{if(held.generation!==generation){held.live=false;return false;}const time=clock(),data=detach(raw,LIMITS.inputBytes,'CASH_INVALID_DATA','CASH_INPUT_LIMIT'),q=detach(query,LIMITS.queryBytes,'CASH_INVALID_QUERY','CASH_QUERY_LIMIT');if(canonical(data)!==held.stateKey){held.live=false;return false;}queryShape(q,{accounts:held.accounts},false);cutoff(q,time);if(time.today!==held.today||canonical(q)!==held.queryKey){held.live=false;return false;}return true;}catch(_){held.live=false;return false;}}
    return Object.freeze({inspect,preview,confirm,cancel,invalidateAll,isCurrent});
  }
  return Object.freeze({VERSION,LIMITS,createCoordinator});
}));
