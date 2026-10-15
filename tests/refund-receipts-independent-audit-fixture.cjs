'use strict';
// Synthetic journal assembled from two genuine public-writer event templates.
// This does not claim that 50,000 mutations were sequentially executed by the writer.
const F=require('./refund-receipts-independent-fixtures.cjs'),{L,R,copy,base}=F;
function auditFixture(count){
 let seed=L.createEmpty();seed=R.addSnapshot(seed,{accountId:'account-cash',date:'2026-10-14',actualBalanceCents:0});seed=R.unlink(seed,'snapshot',seed.bookkeeping.snapshots[0].id,'Synthetic removed historical balance');
 const templates=copy(seed.bookkeeping.audit),s=base(),book=copy(seed.bookkeeping);book.audit=[];book.revision=count;
 for(let i=0;i<count;i++){
  const event=copy(templates[i%2]),recordId='audit-cap-snapshot-'+Math.floor(i/2);event.id='audit-cap-event-'+i;event.revision=i+1;event.recordId=recordId;if(event.before)event.before.id=recordId;if(event.after)event.after.id=recordId;book.audit.push(event);
 }
 book.snapshots=count%2?[copy(book.audit.at(-1).after)]:[];s.version=4;s.bookkeeping=book;
 return {state:s,construction:{method:'Two exact unchanged public Relations.addSnapshot and Relations.unlink event structures and financial basis snapshots, deterministically repeated with unique event/record IDs and monotonically increasing revisions; complete result checked by actual Ledger.validateState.',sequentialPublicWriterCalls:2,assembledEventCount:count,allEventsSequentiallyPublicWritten:false,syntheticDataOnly:true,simultaneousIndependentMaximaClaimed:false}};
}
module.exports={auditFixture};
