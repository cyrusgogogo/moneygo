'use strict';
const {historyFixture}=require('./held-a-history-fixture.cjs');
const R=require('../dist/relations.js');
const result=[];
for(const config of [{positions:500,children:5000,updates:9000,concentrated:true,dateBuckets:true},{positions:500,children:5000,updates:10000,concentrated:true,dateBuckets:true}]){
 const state=historyFixture(config),bytes=Buffer.byteLength(JSON.stringify(state.bookkeeping)),rssBefore=process.memoryUsage().rss,start=performance.now();let outcome;
 try{R.validate(state.bookkeeping,state);outcome='accepted';}catch(error){outcome=error.code;}
 result.push({...config,auditEntries:state.bookkeeping.audit.length,proofCells:4*(config.positions+config.children)+4*config.updates,serializedBytes:bytes,outcome,elapsedMs:performance.now()-start,rssBefore,rssAfter:process.memoryUsage().rss,maxRssKiB:process.resourceUsage().maxRSS});
}
console.log(JSON.stringify({scope:'Synthetic observed validation measurements only; no latency guarantee',results:result},null,2));
