'use strict';
const {test}=require('node:test');const {A,L,R,tx,base,query,coordinator,bytes}=require('./refund-receipts-independent-fixtures.cjs');
test('RR independent limits: genuine exact 10000-row state scans all 9999 income rows without top-N truncation',()=>{
 const s=base([tx('expense','expense',10000,'2026-09-01'),...Array.from({length:9999},(_,i)=>tx('capacity-'+String(i).padStart(4,'0'),'income',1))]),before=bytes(s),c=coordinator();A.equal(L.validateState(s).transactions.length,10000);const r=c.candidates(s,query({limit:1,search:'capacity-9998'}));A.equal(r.scannedIncomeCount,9999);A.equal(r.eligibleCount,9999);A.equal(r.blockedCount,0);A.equal(r.completeScan,true);A.equal(r.matchingCount,1);A.equal(r.rows[0].incomeId,'capacity-9998');A.equal(r.nextOffset,null);A.equal(bytes(s),before);
 const over={...s,transactions:[...s.transactions,tx('capacity-over','income',1)]};A.throws(()=>L.validateState(over));A.throws(()=>c.candidates(over,query()));A.equal(bytes(s),before);
});
