'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const L=require('../dist/ledger.js'),R=require('../dist/relations.js');
const O=require('../dist/organizer.js');
const legacyClose=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/organizer-v1-close.json'),'utf8'));
const copy=v=>JSON.parse(JSON.stringify(v)),at='2026-10-14T10:00:00.000Z';
function fixture(){const s=L.createEmpty();s.accounts.push({id:'bank',name:'Synthetic bank',openingBalanceCents:100000});s.transactions=[{id:'out',type:'expense',amountCents:10000,date:'2026-09-30',accountId:'bank',categoryId:'expense-other',note:'Synthetic withdrawal'},{id:'in',type:'income',amountCents:10000,date:'2026-10-02',accountId:'account-cash',categoryId:'income-other',note:'Synthetic cash received'}];return L.validateState(s);}
const pair=s=>R.pairTransfer(s,{expenseId:'out',incomeId:'in',reason:'Synthetic confirmed own-account withdrawal'});
const close=(s,month='2026-09')=>O.closeMonth(s,{month,at,reason:'Synthetic frozen close'});

test('organizer migration leaves existing v1 frozen rows and audits exactly intact',()=>{
 const old=copy(legacyClose);assert.equal(old.organizer.version,1);const rows=copy(old.organizer.closes),audit=copy(old.organizer.audit),next=L.validateState(old);assert.equal(next.organizer.version,2);assert.deepEqual(next.organizer.closes,rows);assert.deepEqual(next.organizer.audit,audit);assert.deepEqual(next.transactions,old.transactions);assert.equal(O.compareMonth(next,rows[0].id).changed,false);
});
test('outgoing-only and incoming-only month closes capture both signatures and exact current totals',()=>{
 const s=pair(fixture()),sep=close(s),oct=close(s,'2026-10');
 for(const [state,month]of [[sep,'2026-09'],[oct,'2026-10']]){const c=state.organizer.closes[0],r=R.calculate(state,month);assert.equal(c.rows.length,1);assert.deepEqual(c.rows[0].transferPair,s.bookkeeping.transferPairs[0]);assert.deepEqual(c.totals.cash,r.cash);assert.deepEqual(c.totals.personal,r.personal);assert.equal(c.totals.categories[0].cashCents,0);assert.equal(c.totals.categories[0].personalCents,0);assert.deepEqual(L.parseBackup(L.backup(state)),L.validateState(state));assert.equal(O.compareMonth(state,c.id).changed,false);}
 assert.equal(sep.organizer.closes[0].totals.cash.transferCents,10000);assert.equal(oct.organizer.closes[0].totals.cash.transferCents,0);
});
test('frozen pair proof survives unlink, financial editing and original transaction deletion',()=>{
 let s=close(pair(fixture())),frozen=copy(s.organizer.closes[0]);s=R.unlink(s,'transferPair',s.bookkeeping.transferPairs[0].id,'Synthetic correction');s=L.deleteTransaction(s,'out');s=L.deleteTransaction(s,'in');assert.deepEqual(s.organizer.closes[0],frozen);assert.equal(O.compareMonth(s,frozen.id).changed,true);assert.deepEqual(L.parseBackup(L.backup(s)).organizer.closes[0],frozen);
});
test('pairing after an old close preserves old semantics and produces an explained comparison',()=>{
 const old=copy(legacyClose),frozen=copy(old.organizer.closes[0]),s=pair(old),r=O.compareMonth(s,frozen.id);assert.deepEqual(r.frozen,frozen);assert.equal(r.frozen.totals.personal.expenseCents,10000);assert.equal(r.current.totals.personal.expenseCents,0);assert.equal(r.delta.cash.expenseCents,-10000);assert.equal(r.delta.cash.transferCents,10000);assert.ok(r.drivers.some(v=>v.transactionId==='out'));assert.equal(r.current.rows[0].transferPair.incomeSignature.date,'2026-10-02');
});
test('corrupt paired row signature or impact cannot weaken existing close invariants',()=>{
 const s=close(pair(fixture()));
 for(const mutation of [r=>r.impact.cashExpenseCents=10000,r=>r.impact.personalExpenseCents=1,r=>r.impact.transferCents=0,r=>r.transferPair.incomeSignature.amountCents--,r=>r.transferPair.expenseSignature.date='2026-09-29',r=>r.transferPair.expenseSignature.accountId='account-cash',r=>delete r.transferPair,r=>r.transferPair.confidence=100]){const bad=copy(s);mutation(bad.organizer.closes[0].rows[0]);mutation(bad.organizer.audit.at(-1).changes[0].after.rows[0]);assert.throws(()=>L.validateState(bad));}
 const legacy=copy(s);legacy.organizer.version=1;assert.throws(()=>L.validateState(legacy),e=>e.code==='INVALID_ORGANIZER_VERSION');
});
test('both legs in one close require identical captured pair proof and cannot disguise an unpaired counterpart',()=>{
 const base=fixture();base.transactions[1].date='2026-09-30';const s=close(pair(base));assert.equal(s.organizer.closes[0].rows.length,2);
 for(const change of [row=>row.transferPair.reason='Different proof',row=>row.transferPair.id='another-pair']){const bad=copy(s);change(bad.organizer.closes[0].rows[0]);change(bad.organizer.audit.at(-1).changes[0].after.rows[0]);assert.throws(()=>L.validateState(bad),e=>e.code==='INVALID_CLOSE');}
});
test('paired transaction rule application and merchant grouping preserve zero personal/cash expense',()=>{
 let s=pair(fixture());s=O.saveRule(s,{name:'Synthetic classification',conditions:{type:'expense'},actions:{categoryId:'expense-shopping'},at});const preview=O.previewRules(s);s=O.applyPreview(s,preview,{transactionIds:['out'],at});assert.equal(R.calculate(s).personal.expenseCents,0);assert.equal(R.calculate(s).cash.expenseCents,0);assert.equal(s.transactions.find(t=>t.id==='out').categoryId,'expense-shopping');const group=O.merchantView(s).find(g=>g.transactionIds.includes('out'));assert.equal(group.cashCents,0);assert.equal(group.rawCents,10000);assert.equal(group.externalCashCents,0);assert.equal(group.transferCents,10000);assert.equal(O.rawView(s,'out').transaction.amountCents,10000);const saved=close(s);assert.equal(saved.organizer.closes[0].totals.categories[0].cashCents,0);
});

test('all-month captured pair dates require every same-month counterpart while selected closes may contain one leg',()=>{
 const s=close(pair(fixture())),bad=copy(s);for(const row of [bad.organizer.closes[0],bad.organizer.audit.at(-1).changes[0].after])row.rows[0].transferPair.incomeSignature.date='2026-09-30';assert.throws(()=>L.validateState(bad),e=>e.code==='INVALID_CLOSE');
 const base=fixture();base.transactions[1].date='2026-09-30';const selected=O.closeMonth(pair(base),{month:'2026-09',transactionIds:['out'],reason:'Synthetic selected leg',at});assert.equal(selected.organizer.closes[0].rows.length,1);assert.deepEqual(L.parseBackup(L.backup(selected)),L.validateState(selected));
});
