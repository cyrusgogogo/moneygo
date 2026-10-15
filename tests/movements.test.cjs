'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const L = require('../dist/ledger.js'), R = require('../dist/relations.js'), I = require('../dist/importer.js'), S = require('../dist/scenario.js');
const copy = v => JSON.parse(JSON.stringify(v));
const freeze = v => { if (v && typeof v === 'object') { Object.freeze(v); Object.values(v).forEach(freeze); } return v; };
const error = code => e => e.code === code;
function tx(id, type, amountCents = 10000, date = '2026-09-30', accountId = 'bank', extra = {}) { return { id, type, amountCents, date, accountId, ...(type === 'transfer' ? {toAccountId:'account-cash'} : {categoryId:type === 'expense' ? 'expense-other' : 'income-other'}), note:'Synthetic evidence', ...extra }; }
function fixture(rows) { const s = L.createEmpty(); s.accounts.push({id:'bank',name:'Synthetic bank',openingBalanceCents:100000}); s.accounts.push({id:'other',name:'Synthetic other own account',openingBalanceCents:0}); s.transactions = rows || [tx('out','expense'),tx('in','income',10000,'2026-10-02','account-cash')]; return L.validateState(s); }
function pair(s=fixture()) { return R.pairTransfer(s,{expenseId:'out',incomeId:'in',reason:'Synthetic manually verified own-account movement'}); }
function snap(s,accountId,date,actualBalanceCents) { return R.addSnapshot(s,{accountId,date,actualBalanceCents,note:'Synthetic user-entered day-end balance'}); }
function importRows(state,accountId,sourceKey,rows) { const p=I.preview(state,'date,amount,type,id\n'+rows.join('\n'),{accountId,sourceKey,delimiter:',',columns:{date:0,amount:1,direction:2,stableId:3}}); return I.commit(state,p,p.rows.map(v=>v.key)); }
function oldRelations(s) { const out=copy(s);out.bookkeeping.version=1;delete out.bookkeeping.transferPairs;return out; }

test('same-day paired evidence and native transfer have equivalent cash, personal, account flows and balances',()=>{
 const evidence=pair(fixture([tx('out','expense'),tx('in','income',10000,'2026-09-30','account-cash')]));
 const native=fixture([tx('native','transfer')]),a=R.calculate(evidence),b=R.calculate(native);
 for(const field of ['cash','personal','accountFlows','accountBalances','balanceTotalCents']) assert.deepEqual(a[field],b[field]);
 assert.deepEqual(a.cash,{incomeCents:0,expenseCents:0,transferCents:10000,netCents:0});
 assert.deepEqual(a.accountFlows,{inflowCents:10000,outflowCents:10000,transferInCents:10000,transferOutCents:10000,netCents:0});
 assert.equal(a.cashScope,'external-cash-flows');assert.equal(a.transferRecognition,'outgoing-date-once');
});
test('cross-month pair preserves separate outgoing and incoming dates with no synthetic cash',()=>{
 const original=fixture(),s=pair(original),sep=R.calculate(s,'2026-09'),oct=R.calculate(s,'2026-10');
 assert.deepEqual(s.transactions,original.transactions);assert.equal(s.transactions.length,2);
 assert.equal(sep.cash.netCents,0);assert.equal(sep.personal.expenseCents,0);assert.equal(sep.cash.transferCents,10000);assert.equal(sep.accountFlows.netCents,-10000);assert.equal(sep.accountFlows.transferInCents,0);
 assert.equal(oct.cash.netCents,0);assert.equal(oct.personal.incomeCents,0);assert.equal(oct.cash.transferCents,0);assert.equal(oct.accountFlows.netCents,10000);assert.equal(oct.accountFlows.transferOutCents,0);
 assert.deepEqual(sep.drilldown.accountFlows[0].movements,[{accountId:'bank',signedCents:-10000}]);assert.equal(oct.drilldown.accountFlows[0].transferRole,'in');
 assert.equal(sep.drilldown.accountFlows[0].date,'2026-09-30');assert.equal(oct.drilldown.accountFlows[0].date,'2026-10-02');
});
test('incoming posting before outgoing is preserved rather than invented or date-normalized',()=>{
 const s=pair(fixture([tx('out','expense',10000,'2026-10-02'),tx('in','income',10000,'2026-09-30','account-cash')]));assert.equal(R.calculate(s,'2026-09').accountFlows.netCents,10000);assert.equal(R.calculate(s,'2026-09').cash.transferCents,0);assert.equal(R.calculate(s,'2026-10').cash.transferCents,10000);
});
test('snapshots preserve actual original cash basis across pairing and audited unlink',()=>{
 let s=snap(fixture(),'bank','2026-09-30',90000);s=snap(s,'account-cash','2026-09-30',0);s=snap(s,'account-cash','2026-10-02',10000);
 const before=copy(s.bookkeeping.snapshots),paired=pair(s);
 for(const snapshot of before) {const r=R.reconciliation(paired,snapshot.id);assert.equal(r.reconciled,true);assert.equal(r.changed,false);}
 assert.deepEqual(paired.bookkeeping.snapshots,before);
 const unlinked=R.unlink(paired,'transferPair',paired.bookkeeping.transferPairs[0].id,'Synthetic correction');
 for(const snapshot of before)assert.equal(R.reconciliation(unlinked,snapshot.id).changed,false);
 assert.deepEqual(R.calculate(unlinked).accountBalances,R.calculate(paired).accountBalances);
 assert.equal(R.calculate(unlinked).personal.expenseCents,10000);assert.equal(R.calculate(unlinked).personal.incomeCents,10000);
 assert.equal(unlinked.bookkeeping.audit.at(-1).action,'unlink');assert.equal(unlinked.bookkeeping.audit.at(-1).after,null);
});
test('bank to cash withdrawal plus separate fee and subsequent cash spend counts only actual expenses',()=>{
 const original=fixture([tx('out','expense'),tx('in','income',10000,'2026-10-02','account-cash'),tx('fee','expense',200),tx('cash-spend','expense',1500,'2026-10-03','account-cash')]);const s=pair(original),r=R.calculate(s);
 assert.equal(r.personal.expenseCents,1700);assert.equal(r.cash.expenseCents,1700);assert.equal(r.cash.incomeCents,0);assert.equal(r.cash.transferCents,10000);assert.deepEqual({...r.accountBalances},{'account-cash':8500,bank:89800,other:0});
 assert.equal(L.expenseAmounts(s).out,0);assert.equal(L.expenseAmounts(s)['cash-spend'],1500);assert.deepEqual(s.transactions,original.transactions);
 const native=fixture([tx('native','transfer'),tx('fee','expense',200),tx('cash-spend','expense',1500,'2026-10-03','account-cash')]);assert.deepEqual(R.calculate(native).cash,r.cash);
});
test('only one side remains unknown and unchanged; no named-channel or cash-account inference',()=>{
 const s=fixture([tx('out','expense',10000,'2026-09-30','bank',{note:'ATM 微信 转账'} )]),before=JSON.stringify(s),r=R.transferCandidates(s,'out');
 assert.equal(r.status,'unpaired');assert.equal(r.counterpart,'unknown');assert.deepEqual(r.candidates,[]);assert.equal(R.calculate(s).personal.expenseCents,10000);assert.equal(JSON.stringify(s),before);
 assert.throws(()=>R.pairTransfer(s,{expenseId:'out',incomeId:'missing',reason:'Synthetic'}));assert.equal(JSON.stringify(s),before);
});
test('equal amount matching is only a suggestion and multiple candidates stay ambiguous',()=>{
 const s=fixture([tx('out','expense'),tx('in','income',10000,'2026-10-02','account-cash'),tx('another','income',10000,'2026-09-30','other'),tx('same-account','income'),tx('amount-off','income',9999,'2026-09-30','other')]);const before=JSON.stringify(s),r=R.transferCandidates(s,'out');
 assert.equal(r.matchingCount,2);assert.deepEqual(r.candidates.map(v=>v.transactionId),['another','in']);assert.ok(r.candidates.every(v=>!v.confirmed&&v.warnings.length&&v.matchingBasis.length));assert.equal(r.counterpart,'unknown');assert.equal(JSON.stringify(s),before);
 const limit=R.transferCandidates(s,'out',{limit:1});assert.equal(limit.candidates.length,1);assert.equal(limit.hasMore,true);assert.equal(limit.matchingCount,2);
});
test('pair rejects same account, unequal amount, zero, negative, native transfer, reversed types and unknown fields atomically',()=>{
 const base=fixture(),before=JSON.stringify(base);
 for(const rows of [[tx('out','expense'),tx('in','income')],[tx('out','expense'),tx('in','income',9900,'2026-09-30','account-cash')],[tx('out','transfer'),tx('in','income',10000,'2026-09-30','account-cash')],[tx('out','income'),tx('in','expense',10000,'2026-09-30','account-cash')]]) assert.throws(()=>pair(fixture(rows)));
 for(const amount of [0,-1,0.1,Number.MAX_SAFE_INTEGER])assert.throws(()=>pair({...base,transactions:[tx('out','expense',amount),base.transactions[1]]}));
 assert.throws(()=>R.pairTransfer(base,{expenseId:'out',incomeId:'in',reason:'Synthetic',amountCents:10000}));assert.equal(JSON.stringify(base),before);
});
test('already paired legs, trash and duplicate shadows cannot be paired',()=>{
 const paired=pair(),before=JSON.stringify(paired);assert.throws(()=>pair(paired));assert.equal(R.transferCandidates(paired,'out').status,'paired');assert.equal(JSON.stringify(paired),before);
 let s=fixture([tx('out','expense'),tx('in','income',10000,'2026-10-02','account-cash'),tx('shadow','expense')]);s=R.linkEvidence(s,{primaryId:'out',shadowId:'shadow',reason:'Synthetic duplicate'});assert.throws(()=>R.pairTransfer(s,{expenseId:'shadow',incomeId:'in',reason:'Synthetic'}));
 s=L.deleteTransaction(fixture(),'in');assert.throws(()=>pair(s));
});
test('canonical primaries preserve multiple raw evidence records and notes while shadows are excluded',()=>{
 let s=fixture([tx('out','expense',10000,'2026-09-30','bank',{note:'Manual original'}),tx('out-shadow','expense'),tx('in','income',10000,'2026-10-02','account-cash'),tx('in-shadow','income',10000,'2026-10-03','account-cash')]);
 s=R.linkEvidence(s,{primaryId:'out',shadowId:'out-shadow',reason:'Synthetic duplicate'});s=R.linkEvidence(s,{primaryId:'in',shadowId:'in-shadow',reason:'Synthetic duplicate'});s.imports={evidence:[{id:'raw','transactionId':'out-shadow',sourceKey:'Synthetic source',mapped:{channel:'Synthetic channel'},status:'unknown'}],opaque:'preserve original bytes'};s.simulation={opaque:'preserve'};
 const before=copy(s);freeze(s);const p=pair(s);assert.deepEqual(p.transactions,before.transactions);assert.deepEqual(p.imports,before.imports);assert.deepEqual(p.simulation,before.simulation);assert.deepEqual(s,before);
 const r=R.calculate(p);assert.equal(r.cash.transferCents,10000);assert.equal(r.excludedEvidence.length,2);assert.equal(r.accountFlows.outflowCents,10000);assert.equal(r.accountFlows.inflowCents,10000);
});
test('paired canonical leg may gain independent evidence, but cannot become someone else’s shadow',()=>{
 const s=pair(fixture([tx('out','expense'),tx('in','income',10000,'2026-10-02','account-cash'),tx('other-out','expense')]));
 const good=R.linkEvidence(s,{primaryId:'out',shadowId:'other-out',reason:'Synthetic duplicate'});assert.equal(R.calculate(good).cash.transferCents,10000);
 assert.throws(()=>R.linkEvidence(s,{primaryId:'other-out',shadowId:'out',reason:'Unsafe'}));
});
test('refund, claim, settlement and refund-plan overlap is rejected in both operation orders',()=>{
 const base=fixture([tx('out','expense'),tx('in','income',10000,'2026-10-02','account-cash'),tx('expense','expense',10000,'2026-09-01','other'),tx('receipt','income',10000,'2026-10-03','other')]);
 const withClaim=s=>R.createClaim(s,{expenseId:'out',amountCents:1000,kind:'advance',name:'Synthetic'});
 const operations=[withClaim,s=>R.allocateRefund(s,{expenseId:'out',incomeId:'receipt',amountCents:1000,reason:'Synthetic'}),s=>R.allocateRefund(s,{expenseId:'expense',incomeId:'in',amountCents:1000,reason:'Synthetic'}),s=>R.addRefundPlan(s,{expenseId:'out',expectedAmountCents:1000}),s=>{s=R.createClaim(s,{expenseId:'expense',amountCents:1000,kind:'advance',name:'Synthetic'});return R.settleClaim(s,{claimId:s.bookkeeping.claims[0].id,incomeId:'in',amountCents:1000,reason:'Synthetic'});}];
 for(const op of operations){const a=op(base);assert.throws(()=>pair(a));const p=pair(base),before=JSON.stringify(p);assert.throws(()=>op(p));assert.equal(JSON.stringify(p),before);}
});
test('financial signatures lock edit/delete while classification, notes and account names can be corrected',()=>{
 const s=pair(),before=JSON.stringify(s),out=s.transactions.find(v=>v.id==='out'),incoming=s.transactions.find(v=>v.id==='in');
 for(const [row,patch]of [[out,{amountCents:9999}],[out,{date:'2026-09-29'}],[out,{accountId:'other'}],[incoming,{date:'2026-10-01'}],[incoming,{type:'expense',categoryId:'expense-other'}]])assert.throws(()=>L.putTransaction(s,{...row,...patch},row.id));
 assert.throws(()=>L.deleteTransaction(s,'out'));assert.throws(()=>L.deleteTransaction(s,'in'));assert.equal(JSON.stringify(s),before);
 const edited=L.putTransaction(s,{...out,note:'User corrected original',categoryId:'expense-shopping'},'out');assert.equal(L.summary(edited).expenseCents,0);assert.equal(edited.transactions.find(v=>v.id==='out').note,'User corrected original');
 const unpaired=R.unlink(s,'transferPair',s.bookkeeping.transferPairs[0].id,'Synthetic user correction');assert.equal(L.putTransaction(unpaired,{...out,amountCents:9000},'out').transactions.find(v=>v.id==='out').amountCents,9000);
});
test('full imports survive pairing and rollback is blocked for either leg until explicit unlink',()=>{
 let s=importRows(fixture([]),'bank','Synthetic bank',['2026-09-30,100,expense,OUT']);const out=s.transactions[0].id,outBatch=s.imports.batches[0].id;
 s=importRows(s,'account-cash','Synthetic cash',['2026-10-02,100,income,IN']);const incoming=s.transactions.at(-1).id,inBatch=s.imports.batches.at(-1).id,raw=copy(s.imports);
 s=R.pairTransfer(s,{expenseId:out,incomeId:incoming,reason:'Synthetic verified'});const before=JSON.stringify(s);assert.deepEqual(s.imports,raw);
 for(const batch of [outBatch,inBatch]){const r=I.rollback(s,batch);assert.equal(r.rolledBack,false);assert.ok(r.conflicts.some(v=>v.dependencies?.some(d=>d.kind==='transferPair')));assert.deepEqual(r.state,s);}assert.equal(JSON.stringify(s),before);
 s=R.unlink(s,'transferPair',s.bookkeeping.transferPairs[0].id,'Synthetic unlink');const r=I.rollback(s,inBatch);assert.equal(r.rolledBack,true);assert.equal(r.state.transactions.length,1);assert.equal(R.transferCandidates(r.state,out).counterpart,'unknown');
});
test('migration reads strict v1 relations and backups without changing old records or audit',()=>{
 let s=R.createClaim(fixture(),{expenseId:'out',amountCents:1000,kind:'advance',name:'Synthetic existing claim'});s=snap(s,'bank','2026-09-30',90000);const legacy=oldRelations(s),before=copy(legacy);
 const data=R.validate(legacy.bookkeeping,legacy);assert.equal(data.version,2);assert.deepEqual(data.transferPairs,[]);for(const key of ['links','claims','snapshots','audit','revision'])assert.deepEqual(data[key],before.bookkeeping[key]);assert.deepEqual(legacy,before);
 const envelope={format:'moneygo-backup',version:legacy.version,exportedAt:'2026-10-14T10:00:00.000Z',data:legacy};const restored=L.parseBackup(JSON.stringify(envelope));assert.equal(restored.bookkeeping.version,2);assert.deepEqual(restored.bookkeeping.audit,before.bookkeeping.audit);
 assert.deepEqual(L.parseBackup(L.backup(restored)),restored);assert.deepEqual(R.calculate(restored).cash,R.calculate(legacy).cash);
});
test('old outer v1-v5 backups stay readable and all extensions survive current roundtrip',()=>{
 const base=fixture([]),v2={...base,version:2,simulation:S.defaultSettings()},v3=importRows(base,'bank','Synthetic source',['2026-09-30,100,expense,OUT']),v4=pair();
 const v5={...v4,version:5,organizer:require('../dist/organizer.js').defaultState()};v5.simulation=S.defaultSettings();
 for(const s of [base,v2,v3,v4,v5]){const restored=L.parseBackup(L.backup(s));assert.equal(restored.version,s.version);assert.deepEqual(L.balances(restored),L.balances(s));}
 assert.equal(L.verifyBackup(L.backup(v5)).counts.transferPairs,1);assert.deepEqual(L.parseBackup(L.backup(v5)).organizer,v5.organizer);
});
test('v1 cannot smuggle pair data or audits; future versions and incomplete v2 fail closed',()=>{
 const s=pair();for(const mutate of [b=>b.version=1,b=>b.version=3,b=>delete b.transferPairs,b=>b.extra=true]){const v=copy(s);mutate(v.bookkeeping);assert.throws(()=>R.validate(v.bookkeeping,v));}
 const legacy=oldRelations(s);assert.throws(()=>R.validate(legacy.bookkeeping,legacy),error('INVALID_RELATIONS_VERSION'));
});
test('corrupt active pair signatures, amounts, audit action, missing history and extra fields are rejected',()=>{
 const s=pair();for(const mutate of [v=>v.bookkeeping.transferPairs[0].amountCents++,v=>v.bookkeeping.transferPairs[0].expenseSignature.date='2026-09-29',v=>v.bookkeeping.audit=[],v=>v.bookkeeping.audit[0].action='update',v=>v.bookkeeping.transferPairs[0].confidence=99,v=>v.bookkeeping.revision++]){const bad=copy(s);mutate(bad);assert.throws(()=>L.validateState(bad));}
 for(const mutate of [p=>p.incomeSignature.accountId=p.expenseSignature.accountId,p=>p.incomeSignature.amountCents--,p=>p.incomeSignature.type='expense',p=>p.expenseId=p.incomeId]){const bad=copy(s);mutate(bad.bookkeeping.transferPairs[0]);bad.bookkeeping.audit[0].after=copy(bad.bookkeeping.transferPairs[0]);assert.throws(()=>L.validateState(bad));}
});
test('journal rejects a historical overlapping pair even if the final pair state appears valid',()=>{
 const s=pair(fixture([tx('out','expense'),tx('in','income',10000,'2026-10-02','account-cash'),tx('in2','income',10000,'2026-10-02','other')]));const p1=copy(s.bookkeeping.transferPairs[0]),p2={...copy(p1),id:'pair-second',incomeId:'in2',incomeSignature:{...p1.incomeSignature,accountId:'other'}};
 s.bookkeeping.transferPairs=[p2];s.bookkeeping.audit.push({id:'pair-second-audit',revision:2,at:p2.createdAt,kind:'transferPair',recordId:p2.id,action:'create',reason:'Synthetic',before:null,after:p2},{id:'pair-unlink-audit',revision:3,at:p1.createdAt,kind:'transferPair',recordId:p1.id,action:'unlink',reason:'Synthetic',before:p1,after:null});s.bookkeeping.revision=3;
 assert.throws(()=>L.validateState(s),error('INVALID_RELATIONS_AUDIT'));
});
test('difference candidates show exact hypotheses with unknown coverage and never mutate',()=>{
 const s=snap(fixture([tx('spend','expense',500)]),'bank','2026-09-30',100000),before=JSON.stringify(s),r=R.differenceCandidates(s,s.bookkeeping.snapshots[0].id);
 assert.equal(r.differenceCents,500);assert.equal(r.status,'unresolved');assert.equal(r.coverage.status,'unknown');assert.ok(r.candidates.some(v=>v.kind==='recorded-entry-removal-check'));assert.ok(r.candidates.every(v=>v.hypotheticalBalanceChangeCents===500&&!v.confirmed&&v.requiresEvidence));
 assert.equal(JSON.stringify(s),before);assert.doesNotMatch(JSON.stringify(r),/confidence|probability|百分比/);
});
test('direction hypotheses require exactly twice the signed recorded amount',()=>{
 const s=snap(fixture([tx('spend','expense',500)]),'bank','2026-09-30',100500),r=R.differenceCandidates(s,s.bookkeeping.snapshots[0].id);assert.equal(r.differenceCents,1000);assert.deepEqual(r.candidates.map(v=>v.kind),['recorded-direction-check']);
 const near=snap(fixture([tx('spend','expense',500)]),'bank','2026-09-30',100499);assert.equal(R.differenceCandidates(near,near.bookkeeping.snapshots[0].id).candidates.length,0);
});
test('unpaired counterpart hypothesis states account and date unknown; pairing itself cannot fix balances',()=>{
 let s=snap(fixture([tx('out','expense',10000,'2026-09-30','bank')]),'account-cash','2026-09-30',10000);let r=R.differenceCandidates(s,s.bookkeeping.snapshots[0].id);assert.ok(r.candidates.some(v=>v.kind==='unpaired-other-account-leg'&&v.reasons.some(x=>x.includes('未知'))));
 s=snap(pair(),'account-cash','2026-09-30',10000);r=R.differenceCandidates(s,s.bookkeeping.snapshots[0].id);assert.equal(r.candidates.length,0);assert.equal(r.differenceCents,10000);
});
test('difference candidates exclude future, shadow, allocated and already-paired counterpart hypotheses',()=>{
 let s=fixture([tx('out','expense'),tx('in','income',10000,'2026-10-02','account-cash'),tx('future','expense',10000,'2026-11-01','other'),tx('allocated','expense',10000,'2026-09-01','other'),tx('shadow','expense')]);s=R.linkEvidence(s,{primaryId:'out',shadowId:'shadow',reason:'Synthetic'});s=R.createClaim(s,{expenseId:'allocated',amountCents:1000,kind:'advance',name:'Synthetic'});s=pair(s);s=snap(s,'account-cash','2026-09-30',10000);assert.deepEqual(R.differenceCandidates(s,s.bookkeeping.snapshots[0].id).candidates,[]);
});
test('captured basis delta is exact and explicitly separates already recorded change from a suggestion',()=>{
 let s=snap(fixture([]),'bank','2026-09-30',100000);const id=s.bookkeeping.snapshots[0].id;s=L.putTransaction(s,tx('ignored','expense',100,'2026-09-29'));const r=R.differenceCandidates(s,id);assert.equal(r.differenceCents,100);assert.ok(r.candidates.some(v=>v.kind==='captured-basis-change'&&v.transactionIds.length===1));assert.equal(r.coverage.status,'unknown');
});
test('zero difference reports reconciled while coverage remains unknown and no correction candidate exists',()=>{
 const s=snap(pair(),'bank','2026-09-30',90000),r=R.differenceCandidates(s,s.bookkeeping.snapshots[0].id);assert.equal(r.status,'reconciled');assert.equal(r.coverage.status,'unknown');assert.deepEqual(r.candidates,[]);
});
test('candidate options and references reject malformed, noninteger or oversized limits without mutation',()=>{
 const s=snap(fixture(),'bank','2026-09-30',90000),before=JSON.stringify(s);
 for(const limit of [0,-1,1.5,101,Infinity,'10']){assert.throws(()=>R.transferCandidates(s,'out',{limit}));assert.throws(()=>R.differenceCandidates(s,s.bookkeeping.snapshots[0].id,{limit}));}
 assert.throws(()=>R.transferCandidates(s,'missing'));assert.throws(()=>R.differenceCandidates(s,'missing'));assert.equal(JSON.stringify(s),before);
});
test('10,000-record candidate scan is bounded and deterministic rather than combinatorial',()=>{
 const rows=[tx('out','expense',100)];for(let i=1;i<10000;i++)rows.push(tx('in-'+String(i).padStart(5,'0'),'income',100,'2026-09-30','account-cash'));const s=fixture(rows),before=JSON.stringify(s),r=R.transferCandidates(s,'out',{limit:100});assert.equal(r.matchingCount,9999);assert.equal(r.candidates.length,100);assert.equal(r.hasMore,true);assert.equal(r.candidates[0].transactionId,'in-00001');assert.equal(JSON.stringify(s),before);
});
test('5,000 audited pairs over 10,000 original rows validate and aggregate safely',()=>{
 const s=fixture([]),b=R.defaultState(),at='2026-10-14T10:00:00.000Z';s.version=4;s.bookkeeping=b;
 for(let i=0;i<5000;i++){const out=tx('out-'+i,'expense',100),incoming=tx('in-'+i,'income',100,'2026-10-02','account-cash');s.transactions.push(out,incoming);const sig=t=>({type:t.type,date:t.date,amountCents:t.amountCents,accountId:t.accountId,toAccountId:null});const row={id:'pair-'+i,createdAt:at,expenseId:out.id,incomeId:incoming.id,amountCents:100,reason:'Synthetic verified',expenseSignature:sig(out),incomeSignature:sig(incoming)};b.transferPairs.push(row);b.audit.push({id:'audit-pair-'+i,revision:i+1,at,kind:'transferPair',recordId:row.id,action:'create',reason:row.reason,before:null,after:copy(row)});}b.revision=5000;
 const r=R.calculate(s);assert.equal(r.cash.transferCents,500000);assert.equal(r.personal.expenseCents,0);assert.equal(r.accountFlows.netCents,0);assert.equal(r.impacts['in-4999'].transferRole,'in');
});
test('paired principal respects safe-total bounds and overflow rejection remains atomic',()=>{
 const s=fixture([tx('out','expense',R.MAX_AMOUNT_CENTS),tx('in','income',R.MAX_AMOUNT_CENTS,'2026-10-02','account-cash')]);const p=pair(s);assert.equal(R.calculate(p).cash.transferCents,R.MAX_AMOUNT_CENTS);assert.deepEqual(L.parseBackup(L.backup(p)),p);
});

test('transfer and difference pagination reaches every match and reports exhaustion deterministically',()=>{
 const s=fixture([tx('out','expense',100),...Array.from({length:205},(_,i)=>tx('candidate-'+String(i).padStart(3,'0'),'income',100,'2026-09-30','account-cash'))]);
 const seen=[];let offset=0;do{const r=R.transferCandidates(s,'out',{limit:100,offset});assert.equal(r.offset,offset);seen.push(...r.candidates.map(v=>v.transactionId));offset=r.nextOffset;}while(offset!==null);assert.equal(seen.length,205);assert.equal(new Set(seen).size,205);
 const empty=R.transferCandidates(s,'out',{limit:100,offset:205});assert.equal(empty.nextOffset,null);assert.equal(empty.hasMore,false);assert.deepEqual(empty.candidates,[]);
 const snapshot=snap(s,'bank','2026-09-30',99800),id=snapshot.bookkeeping.snapshots[0].id,all=[];offset=0;do{const r=R.differenceCandidates(snapshot,id,{limit:50,offset});all.push(...r.candidates.map(v=>v.transactionIds[0]));offset=r.nextOffset;}while(offset!==null);assert.equal(all.length,205);assert.equal(new Set(all).size,205);
 for(const offset of [-1,0.2,20002,'1'])assert.throws(()=>R.transferCandidates(s,'out',{offset}));
});
