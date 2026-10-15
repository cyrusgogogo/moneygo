'use strict';
const test = require('node:test'); const A = require('node:assert/strict'); const path = require('node:path');
const D=path.join(__dirname, '../dist');
const L=require(path.join(D,'ledger.js')),R=require(path.join(D,'relations.js')),I=require(path.join(D,'importer.js')),O=require(path.join(D,'organizer.js')),S=require(path.join(D,'scenario.js'));
const clone=x=>JSON.parse(JSON.stringify(x));
const tx=(id,type,amountCents,date,accountId,extra={})=>({id,type,amountCents,date,accountId,note:'Synthetic review only',...(type==='transfer'?{toAccountId:'account-cash'}:{categoryId:type==='income'?'income-other':'expense-other'}),...extra});
const empty=()=>{const s=L.createEmpty();s.accounts.push({id:'bank',name:'Synthetic bank',openingBalanceCents:50000},{id:'wallet',name:'Synthetic wallet',openingBalanceCents:-3000}); return s;};
const base=()=>{const s=empty();s.transactions=[tx('out','expense',10000,'2026-09-30','bank'),tx('in','income',10000,'2026-10-02','account-cash')];return L.validateState(s);};
const pair=s=>R.pairTransfer(s,{expenseId:'out',incomeId:'in',reason:'Synthetic verified pair'});
const sum=(a,k)=>a.reduce((n,v)=>n+BigInt(v[k]),0n);
const allMonths=['2026-08','2026-09','2026-10','2026-11'];
function assertIndependent(s) {
 const z=R.calculate(s);const shadow=new Set(s.bookkeeping?.links.map(r=>r.shadowId)||[]),paired=new Set(s.bookkeeping?.transferPairs.flatMap(r=>[r.expenseId,r.incomeId])||[]);
 const bal=Object.fromEntries(s.accounts.map(a=>[a.id,BigInt(a.openingBalanceCents)]));
 for(const t of s.transactions)if(!shadow.has(t.id)){bal[t.accountId]+=BigInt(t.type==='income'?t.amountCents:-t.amountCents);if(t.type==='transfer')bal[t.toAccountId]+=BigInt(t.amountCents);}
 for(const [k,v] of Object.entries(bal))A.equal(z.accountBalances[k],Number(v));
 A.equal(BigInt(z.balanceTotalCents),Object.values(bal).reduce((a,b)=>a+b,0n));
 for(const m of [...allMonths,undefined]) {
  const r=R.calculate(s,m),rows=s.transactions.filter(t=>!shadow.has(t.id)&&(!m||t.date.startsWith(m)));
  let income=0n,expense=0n,p=0n,inn=0n,out=0n;
  for(const t of rows){if(t.type==='income')inn+=BigInt(t.amountCents);else out+=BigInt(t.amountCents);if(t.type==='transfer')inn+=BigInt(t.amountCents);if(t.type==='transfer'||paired.has(t.id)&&t.type==='expense')p+=BigInt(t.amountCents);if(!paired.has(t.id)){if(t.type==='income')income+=BigInt(t.amountCents);if(t.type==='expense')expense+=BigInt(t.amountCents);}}
  A.deepEqual(r.cash,{incomeCents:Number(income),expenseCents:Number(expense),transferCents:Number(p),netCents:Number(income-expense)});
  A.equal(r.accountFlows.inflowCents,Number(inn));A.equal(r.accountFlows.outflowCents,Number(out));A.equal(r.accountFlows.netCents,Number(inn-out));
  A.equal(sum(r.drilldown.accountFlows,'accountInflowCents'),inn);A.equal(sum(r.drilldown.accountFlows,'accountOutflowCents'),out);
  A.equal(r.drilldown.accountFlows.flatMap(t=>t.movements).reduce((n,t)=>n+BigInt(t.signedCents),0n),inn-out);
 }
 const results=allMonths.map(m=>R.calculate(s,m));for(const group of ['cash','personal','accountFlows'])for(const key of Object.keys(z[group]))A.equal(sum(results.map(r=>r[group]),key),BigInt(z[group][key]));
 A.equal(BigInt(z.balanceTotalCents)-s.accounts.reduce((n,a)=>n+BigInt(a.openingBalanceCents),0n),BigInt(z.accountFlows.netCents));
}
test('independent deterministic 36-fixture conservation, 4 months, all accounts, shadows and transfer timings',()=>{
 let seed=31337;const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
 for(let trial=0;trial<36;trial++){
  let s=empty();for(let i=0;i<16;i++){const n=1+rand(90000),m=allMonths[rand(4)],kind=['income','expense','transfer'][rand(3)],a=['bank','wallet'][rand(2)];s.transactions.push(tx('ordinary-'+i,kind,n,m+'-15',a));}
  s.transactions.push(tx('out','expense',997,'2026-09-30','bank'),tx('in','income',997,trial%2?'2026-08-30':'2026-10-02','account-cash'),tx('out-shadow','expense',997,'2026-11-15','bank'));
  s=R.linkEvidence(s,{primaryId:'out',shadowId:'out-shadow',reason:'Synthetic duplicate'});const before=clone(s);s=pair(s);A.deepEqual(s.transactions,before.transactions);assertIndependent(s);
  s=R.unlink(s,'transferPair',s.bookkeeping.transferPairs[0].id,'Synthetic undo');assertIndependent(s);s=pair(s);assertIndependent(s);
 }
});
test('same-day pair equals native transfer for every summary and account flow at 1-cent and maximum amounts',()=>{
 for(const amount of [1,101,999999999999]){let s=base();s.transactions.forEach(t=>{t.amountCents=amount;t.date='2026-09-30';});const p=pair(s),n=empty();n.transactions=[tx('native','transfer',amount,'2026-09-30','bank')];for(const month of [undefined,...allMonths]){const a=R.calculate(p,month),b=R.calculate(n,month);for(const key of ['cash','personal','accountFlows','accountBalances','balanceTotalCents'])A.deepEqual(a[key],b[key]);}}
});
test('withdrawal and top-up with explicit fee + cash spend never create spending twice, including scenario baseline',()=>{
 let s=base();s.transactions.push(tx('fee','expense',25,'2026-09-30','bank'),tx('coffee','expense',389,'2026-10-03','account-cash'));s=pair(s);A.equal(L.summary(s).expenseCents,414);const settings=S.defaultSettings();settings.completeMonths=['2026-09','2026-10'];const c=S.calculate(s,settings,'2026-11-02');A.equal(c.baseline.monthlyCents,207);A.equal(c.baseline.totalCents,621);assertIndependent(s);
});
test('incoming earlier date never gets silently reordered or creates synthetic cash',()=>{let s=base();s.transactions[0].date='2026-10-10';s.transactions[1].date='2026-08-10';s=pair(s);A.equal(R.calculate(s,'2026-08').cash.transferCents,0);A.equal(R.calculate(s,'2026-10').cash.transferCents,10000);assertIndependent(s);});
test('snapshot stale flags are unchanged by pair/unlink but react to original-date edits after unlink',()=>{
 let s=base();for(const a of s.accounts)for(const date of ['2026-09-30','2026-10-02'])s=R.addSnapshot(s,{accountId:a.id,date,actualBalanceCents:0});const pre=s.bookkeeping.snapshots.map(x=>R.reconciliation(s,x.id));s=pair(s);A.deepEqual(s.bookkeeping.snapshots.map(x=>R.reconciliation(s,x.id)),pre);s=R.unlink(s,'transferPair',s.bookkeeping.transferPairs[0].id,'Synthetic undo');A.deepEqual(s.bookkeeping.snapshots.map(x=>R.reconciliation(s,x.id)),pre);s=L.putTransaction(s,{...s.transactions.find(t=>t.id==='in'),date:'2026-09-30'},'in');A.equal(R.reconciliation(s,s.bookkeeping.snapshots.find(x=>x.accountId==='account-cash'&&x.date==='2026-09-30').id).changed,true);
});
test('paired legs preserve evidence metadata and can be classified by organizer but financial fields stay locked',()=>{
 let s=pair(base());s=O.saveRule(s,{name:'Synthetic',conditions:{type:'expense'},actions:{categoryId:'expense-food'},enabled:true});let preview=O.previewRules(s);s=O.applyPreview(s,preview,{transactionIds:['out'],reason:'Synthetic category'});A.equal(s.transactions.find(t=>t.id==='out').categoryId,'expense-food');A.equal(L.summary(s).expenseCents,0);s=O.rollbackBatch(s,s.organizer.batches[0].id,{reason:'Synthetic revert'});A.equal(s.transactions.find(t=>t.id==='out').categoryId,'expense-other');A.equal(L.summary(s).expenseCents,0);
 for(const field of ['amountCents','date','accountId','type']){const t=s.transactions.find(t=>t.id==='out');const value={amountCents:9999,date:'2026-10-01',accountId:'wallet',type:'income'}[field];A.throws(()=>L.putTransaction(s,{...t,[field]:value,categoryId:field==='type'?'income-other':t.categoryId},'out'));}
});
test('organizer paired close cash and category totals must agree, pair identity preserved',()=>{
 const s=pair(base()),closed=O.closeMonth(s,{month:'2026-09',reason:'Synthetic close'}),r=closed.organizer.closes[0];A.equal(r.totals.cash.expenseCents,0);A.equal(r.totals.cash.transferCents,10000);A.equal(r.totals.categories.filter(c=>c.type==='expense').reduce((a,c)=>a+c.cashCents,0),0);A.deepEqual(L.parseBackup(L.backup(closed)),closed);
});
test('organizer merchant cash grouping must exclude internal pairs as external cash',()=>{const rows=O.merchantView(pair(base()));for(const r of rows.filter(r=>r.type!=='transfer'))A.equal(r.cashCents,0);});
test('full audit history allows unlink, edit amount, pair afresh without weakening earlier historical records',()=>{let s=pair(base());const old=clone(s.bookkeeping.audit);s=R.unlink(s,'transferPair',s.bookkeeping.transferPairs[0].id,'Synthetic undo');for(const t of s.transactions)s=L.putTransaction(s,{...t,amountCents:123},t.id);s=pair(s);A.deepEqual(s.bookkeeping.audit.slice(0,old.length),old);A.equal(R.calculate(s).cash.transferCents,123);A.deepEqual(L.parseBackup(L.backup(s)),s);});
test('all dependencies block both transfer roles: settled claim, cancelled/closed plan, partial refunds, both orders',()=>{
 const extras=s=>{s.transactions.push(tx('purchase','expense',10000,'2026-08-01','wallet'),tx('receipt','income',10000,'2026-10-10','wallet'));return s;};
 const ops=[s=>R.createClaim(s,{expenseId:'out',amountCents:1,kind:'advance',name:'Synthetic'}),s=>R.addRefundPlan(s,{expenseId:'out',expectedAmountCents:1,status:'cancelled'}),s=>R.addRefundPlan(s,{expenseId:'out',expectedAmountCents:1,status:'closed'}),s=>R.allocateRefund(s,{expenseId:'out',incomeId:'receipt',amountCents:1,reason:'Synthetic'}),s=>R.allocateRefund(s,{expenseId:'purchase',incomeId:'in',amountCents:1,reason:'Synthetic'}),s=>{s=R.createClaim(s,{expenseId:'purchase',amountCents:1,kind:'advance',name:'Synthetic'});return R.settleClaim(s,{incomeId:'in',claimId:s.bookkeeping.claims[0].id,amountCents:1,reason:'Synthetic'});}];
 for(const op of ops){A.throws(()=>pair(op(extras(base()))));const s=pair(extras(base())),before=JSON.stringify(s);A.throws(()=>op(s));A.equal(JSON.stringify(s),before);}
});
test('pair IDs, audit IDs, transaction IDs cannot collide; generated IDs recover predictably',()=>{
 let s=base();s.transactions.push(tx('relation-transferPair-1','expense',10,'2026-08-01','wallet'),tx('relation-audit-1','expense',10,'2026-08-01','wallet'));s=pair(s);A.equal(s.bookkeeping.transferPairs[0].id,'relation-transferPair-1-1');A.equal(s.bookkeeping.audit[0].id,'relation-audit-1-1');
 for(const id of ['out','bank','expense-other',s.bookkeeping.audit[0].id]){const b=clone(s);b.bookkeeping.transferPairs[0].id=id;b.bookkeeping.audit[0].recordId=id;b.bookkeeping.audit[0].after.id=id;A.throws(()=>L.validateState(b));}
});
test('historical overlap rejects malicious pair with shadow/claim/refund even after unlink removes final overlap',()=>{
 let s=base();s.transactions.push(tx('shadow','expense',10000,'2026-09-30','bank'));s=R.linkEvidence(s,{primaryId:'out',shadowId:'shadow',reason:'Synthetic'});const unlinked=R.unlink(s,'link',s.bookkeeping.links[0].id,'Synthetic undo');let b=pair(unlinked);const pairEvt=clone(b.bookkeeping.audit[2]),unlinkEvt=clone(b.bookkeeping.audit[1]);pairEvt.after.expenseId='shadow';pairEvt.revision=2;unlinkEvt.revision=3;b.bookkeeping.audit=[b.bookkeeping.audit[0],pairEvt,unlinkEvt];b.bookkeeping.transferPairs[0].expenseId='shadow';A.throws(()=>L.validateState(b));
});
test('difference exact signed deltas work for both cash signs and native transfer sides',()=>{
 for(const type of ['income','expense','transfer'])for(const account of ['bank','account-cash'])for(const diff of [-300,-200,-100,100,200,300]){let s=empty();s.transactions=[tx('entry',type,100,'2026-09-20','bank')];const balance=R.calculate(s).accountBalances[account];s=R.addSnapshot(s,{accountId:account,date:'2026-09-30',actualBalanceCents:balance+diff});const r=R.differenceCandidates(s,s.bookkeeping.snapshots[0].id);for(const c of r.candidates)A.equal(c.hypotheticalBalanceChangeCents,diff);if(type==='transfer')A.equal(r.candidates.some(c=>c.kind==='recorded-direction-check'),false);if(account==='bank'&&Math.abs(diff)===300)A.equal(r.candidates.length,0);}
});
test('difference zero/unknown coverage never infers completeness or changes data',()=>{let s=base();s=R.addSnapshot(s,{accountId:'bank',date:'2026-09-30',actualBalanceCents:40000});const before=JSON.stringify(s);A.equal(R.differenceCandidates(s,s.bookkeeping.snapshots[0].id).coverage.status,'unknown');A.equal(R.differenceCandidates(s,s.bookkeeping.snapshots[0].id).status,'reconciled');A.equal(JSON.stringify(s),before);});
test('10k candidate paging is bounded, stable, complete and non-mutating at offset boundaries',()=>{
 const s=empty();s.transactions=[tx('out','expense',7,'2026-09-30','bank')];for(let i=0;i<9999;i++)s.transactions.push(tx('in-'+String(i).padStart(5,'0'),'income',7,'2026-10-01','account-cash'));const before=JSON.stringify(s);let count=0,last=null,offset=0;for(;;){const r=R.transferCandidates(s,'out',{limit:100,offset});A.ok(r.candidates.length<=100);for(const t of r.candidates){A.ok(!last||last<t.transactionId);last=t.transactionId;count++;}if(!r.hasMore)break;offset=r.nextOffset;}A.equal(count,9999);A.equal(R.transferCandidates(s,'out',{offset:9999}).candidates.length,0);A.equal(JSON.stringify(s),before);
});
test('unsafe gross account flow rejects even if external and personal cash net to zero',()=>{const s=empty();s.transactions=Array.from({length:10000},(_,i)=>tx('t-'+i,'transfer',999999999999,'2026-09-30','bank'));A.throws(()=>R.calculate(s),e=>e.code==='AMOUNT_OVERFLOW');});
test('real v0.6 generated v4/v5 backups migrate without rewriting original relations, frozen closes or journals',()=>{
 const fs=require('node:fs');for(const version of [4,5]){const raw=fs.readFileSync(path.join(__dirname, 'fixtures/legacy-relations-v'+version+'.json'),'utf8'),old=JSON.parse(raw).data,s=L.parseBackup(raw);A.equal(old.bookkeeping.version,1);A.equal(s.bookkeeping.version,2);A.deepEqual(s.bookkeeping.audit,old.bookkeeping.audit);A.deepEqual(s.transactions,old.transactions);A.deepEqual(s.bookkeeping.transferPairs,[]);for(const key of ['links','refunds','claims','settlements','refundPlans','snapshots'])A.deepEqual(s.bookkeeping[key],old.bookkeeping[key]);if(version===5){A.equal(old.organizer.version,1);A.equal(s.organizer.version,2);A.deepEqual(s.organizer.audit,old.organizer.audit);A.deepEqual(s.organizer.closes,old.organizer.closes);A.equal(O.compareMonth(s,s.organizer.closes[0].id).changed,false);const p=pair(s),comparison=O.compareMonth(p,p.organizer.closes[0].id);A.equal(comparison.delta.cash.expenseCents,-10000);A.equal(comparison.delta.cash.transferCents,10000);A.equal(comparison.frozen.totals.cash.expenseCents,11000);A.equal(comparison.current.totals.cash.expenseCents,1000);}A.deepEqual(L.parseBackup(L.backup(s)),s);}
});
test('both imported pair-leg batches remain locked until unlink; later unrelated edits block rollback independently',()=>{
 function imp(s,account,src,text){const p=I.preview(s,'date,amount,type,id\n'+text,{accountId:account,sourceKey:src,delimiter:',',columns:{date:0,amount:1,direction:2,stableId:3}});return I.commit(s,p,p.rows.map(r=>r.key));}
 let s=imp(empty(),'bank','Synthetic bank','2026-09-30,100,expense,withdrawal\n2026-09-30,1,expense,fee'),b1=s.imports.batches[0].id,expense=s.transactions.find(t=>t.amountCents===10000).id;s=imp(s,'account-cash','Synthetic cash','2026-10-02,100,income,cash');const b2=s.imports.batches[1].id,income=s.transactions.find(t=>t.type==='income').id;s=R.pairTransfer(s,{expenseId:expense,incomeId:income,reason:'Synthetic'});
 for(const b of [b1,b2]){const x=I.rollback(s,b);A.equal(x.rolledBack,false);A.deepEqual(x.state,s);}
 const raw=clone(s.imports),fee=s.transactions.find(t=>t.amountCents===100).id;s=L.putTransaction(s,{...s.transactions.find(t=>t.id===fee),note:'User corrected fee'},fee);s=R.unlink(s,'transferPair',s.bookkeeping.transferPairs[0].id,'Synthetic undo');A.equal(I.rollback(s,b1).rolledBack,false);A.equal(I.rollback(s,b2).rolledBack,true);A.deepEqual(s.imports,raw);
});
test('row-level personal/cash identities hold when pairs coexist with refunds, claims, plans and settlements',()=>{
 let s=base();s.transactions.push(tx('purchase','expense',1000,'2026-08-01','wallet'),tx('refund','income',200,'2026-09-01','bank'),tx('settle','income',300,'2026-10-03','account-cash'),tx('plan-purchase','expense',700,'2026-11-01','wallet'));s=R.allocateRefund(s,{expenseId:'purchase',incomeId:'refund',amountCents:150,reason:'Synthetic'});s=R.createClaim(s,{expenseId:'purchase',amountCents:200,kind:'advance',name:'Synthetic'});s=R.settleClaim(s,{incomeId:'settle',claimId:s.bookkeeping.claims[0].id,amountCents:100,reason:'Synthetic'});s=R.addRefundPlan(s,{expenseId:'plan-purchase',expectedAmountCents:500});s=pair(s);for(const impact of Object.values(R.calculate(s).impacts)){A.equal(impact.personalExpenseCents+impact.refundCents+impact.claimCents,impact.cashExpenseCents);A.equal(impact.ordinaryIncomeCents+impact.receivedRefundCents+impact.settlementCents,impact.cashIncomeCents);}A.equal(R.calculate(s).receivables.outstandingCents,100);assertIndependent(s);
});
test('transfer pair and journal mutation matrix fails closed without mutating source',()=>{
 const s=pair(base()),before=JSON.stringify(s);const attacks=[s=>s.bookkeeping.version=1,s=>s.bookkeeping.version=99,s=>delete s.bookkeeping.transferPairs,s=>s.bookkeeping.extra=true,s=>s.bookkeeping.audit=[],s=>s.bookkeeping.audit[0].action='update',s=>s.bookkeeping.audit[0].revision=2,s=>s.bookkeeping.revision=2,s=>s.bookkeeping.audit[0].before=clone(s.bookkeeping.audit[0].after),s=>s.bookkeeping.transferPairs[0].amountCents++,s=>s.bookkeeping.transferPairs[0].incomeSignature.date='2026-10-01',s=>s.transactions[0].amountCents++,s=>s.transactions.splice(0,1)];for(const attack of attacks){const b=clone(s);attack(b);A.throws(()=>L.validateState(b));A.equal(JSON.stringify(s),before);}
});
test('10k difference candidates remain limited, exact, deterministic and read-only',()=>{
 let s=empty();s.transactions=Array.from({length:10000},(_,i)=>tx('expense-'+String(i).padStart(5,'0'),'expense',100,'2026-09-30','bank'));s=R.addSnapshot(s,{accountId:'bank',date:'2026-09-30',actualBalanceCents:50000-1000000+100});const before=JSON.stringify(s),id=s.bookkeeping.snapshots[0].id,a=R.differenceCandidates(s,id,{limit:100}),z=R.differenceCandidates(s,id,{limit:100,offset:9900});A.equal(a.matchingCount,10000);A.equal(a.candidates.length,100);A.equal(a.nextOffset,100);A.equal(z.candidates.length,100);A.equal(z.hasMore,false);A.equal(z.nextOffset,null);A.ok([...a.candidates,...z.candidates].every(c=>c.hypotheticalBalanceChangeCents===100&&c.confirmed===false));A.equal(JSON.stringify(s),before);
});
test('merchant raw, external and principal fields keep distinct exact meanings across pair and native transfer',()=>{
 let s=base();s.transactions.push(tx('native','transfer',50,'2026-10-03','bank'),tx('fee','expense',27,'2026-09-30','bank'));s=pair(s);const rows=O.merchantView(s),r=R.calculate(s);A.equal(rows.reduce((n,x)=>n+x.rawCents,0),20077);A.equal(rows.reduce((n,x)=>n+x.externalCashCents,0),r.cash.incomeCents+r.cash.expenseCents);A.equal(rows.reduce((n,x)=>n+x.transferCents,0),r.cash.transferCents);A.equal(rows.find(x=>x.type==='income').rawCents,10000);A.equal(rows.find(x=>x.type==='income').externalCashCents,0);A.equal(rows.find(x=>x.type==='transfer').rawCents,50);A.equal(rows.find(x=>x.type==='transfer').externalCashCents,0);A.equal(rows.find(x=>x.type==='transfer').transferCents,50);
});
