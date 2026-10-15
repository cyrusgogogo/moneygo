'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{performance}=require('node:perf_hooks'),f=require('./boundary-fixtures.cjs');
const OUT=process.env.MONEYGO_DAILY_EVIDENCE_DIR||fs.mkdtempSync(path.join(require('node:os').tmpdir(),'moneygo-daily-cash-exact-'));
const utf8Text=bytes=>'界'.repeat(Math.floor(bytes/3))+(bytes%3===2?'é':bytes%3===1?'x':'');

function registerTest({api,moduleSha256}){test('A25 real schema-valid public preview is exactly 8388608 bytes; 8388609 is atomically refused',()=>{
 const start=performance.now(),source=path.join(f.ROOT,'dist/daily-cash.js'),hash=()=>crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex'),sourceHash=moduleSha256;
 let s=f.fixture({accounts:100});s=f.imported(s,{rows:120});f.L.validateState(s);const before=JSON.stringify(s),a=f.ready(s,{api,horizonEnd:'2027-01-15'});
 a.scenario.standaloneEvents=Array.from({length:1000},(_,i)=>f.event({id:'e'+i,accountId:s.accounts[i%100].id,reason:'r',label:'e',amountCents:1,direction:i%2?'in':'out'}));
 const baseline=a.c.preview(s,a.anchor,a.scenario),baseBytes=f.bytes(baseline);let remaining=8388608-baseBytes;assert.ok(remaining>0&&remaining<=3476000,'honest schema padding capacity');
 // Each scenario Event is retained exactly in scenario and residualEvents.
 // Its ID also occurs once in the day row: one extra ID character changes 3 bytes.
 if(remaining%2){a.scenario.standaloneEvents[0].id+='x';remaining-=3;}assert.ok(remaining>=0);
 for(const event of a.scenario.standaloneEvents){for(const [field,maxBytes]of [['reason',1500],['label',240]]){const extra=Math.min(maxBytes-1,remaining/2);assert.ok(Number.isInteger(extra));event[field]=utf8Text(1+extra);remaining-=extra*2;}if(!remaining)break;}
 assert.equal(remaining,0);const exact=a.c.preview(s,a.anchor,a.scenario);assert.equal(f.bytes(exact),8388608);assert.equal(exact.report.inventory.fixedEvents.length,120);assert.equal(exact.report.days.length,9300);assert.equal(exact.report.residualEvents.length,1000);assert.ok(exact.report.inventory.basis.proofRecords.length>=120);f.frozen(exact);
 const confirmed=a.c.confirm(s,a.anchor,exact.ticket,a.scenario,f.consent());assert.equal(confirmed.status,'confirmed');assert.equal(a.c.isCurrent(s,confirmed,a.scenario),true);
 const above=f.copy(a.scenario);above.standaloneEvents[0].id+='x';const oldReasonBytes=Buffer.byteLength(above.standaloneEvents[0].reason,'utf8');assert.ok(oldReasonBytes>1);above.standaloneEvents[0].reason=utf8Text(oldReasonBytes-1);
 // ID contributes +3, the two reason copies contribute -2: full result +1.
 assert.throws(()=>a.c.preview(s,a.anchor,above),f.error('PROJECTION_RESULT_LIMIT'));
 assert.equal(a.c.isAnchorCurrent(s,a.anchor),true);assert.equal(JSON.stringify(s),before);const small=f.scenario(a.inventory);assert.equal(a.c.preview(s,a.anchor,small).report.status,'pending');assert.equal(hash(),sourceHash);
 const evidence={case:'A25-real-public-schema-valid-preview',moduleSha256:sourceHash,syntheticFinancialRecordsMadeBy:'Ledger.putAccount, Obligations.putProfile, Relations.addSnapshot, Importer.preview/commit',basisAuthority:'DailyCash.previewBasis/confirmBasis wrapping genuine private CashBasis',sourceBytes:f.bytes(s),scenarioBytes:f.bytes(a.scenario),baselinePreviewBytes:baseBytes,exactPreviewBytes:f.bytes(exact),confirmedBytes:f.bytes(confirmed),rejectedCompletePreviewBytes:8388609,rejectionCode:'PROJECTION_RESULT_LIMIT',counts:{accounts:100,days:93,dayAccountRows:9300,residualEvents:1000,fixedEvents:120},elapsedMs:performance.now()-start,processPeakRssBytes:process.resourceUsage().maxRSS*1024,inputUnchanged:true,ledgerStillUsable:true,seamUsed:false};
 fs.mkdirSync(OUT,{recursive:true});fs.writeFileSync(path.join(OUT,'daily-cash-public-exact-result.json'),JSON.stringify(evidence,null,2)+'\n');
});}
module.exports={registerTest,utf8Text};
