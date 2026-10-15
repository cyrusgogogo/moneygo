'use strict';
// Verifies recorded bounded observations against the exact current model pin.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),A=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),sha=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'dist/cash-basis.js'))).digest('hex');
const results=JSON.parse(fs.readFileSync(path.join(__dirname,'resource-results.json'),'utf8'));
A.equal(results.length,4);
for(const r of results){A.equal(r.sourceSha256,sha);A.equal(r.fixtureValidated,true);A.equal(r.inputUnchanged,true);A.ok(r.inputBytes<=33554432);A.ok(r.queryBytes<=8388608);for(const p of r.phases){A.ok(p.elapsedMs>=0);A.ok((p.legacyCalls['cash-basis.js:directCalculate']||0)<=1);A.ok((p.legacyCalls['cash-basis.js:directReconciliation']||0)<=100);if(p.method==='isCurrent'){A.equal(p.current,true);for(const n of Object.values(p.legacyCalls))A.equal(n,0);}else if(p.status==='ok')A.ok(p.bytes<=8388608);else {A.equal(p.code,'CASH_RESULT_LIMIT');A.ok(p.candidateResultBytes>8388608);}}}
const compact=results.find(r=>r.kind==='compact-sources');A.equal(compact.phases[0].sourceCount,10100);A.equal(compact.phases[0].proofCount,400);A.equal(compact.phases[1].supportedSelectedCents,0);A.equal(compact.phases[0].legacyCalls['cash-basis.js:directReconciliation'],100);
const snapshots=results.find(r=>r.kind==='hundred-snapshots');A.equal(snapshots.phases[0].proofCount,400);A.equal(snapshots.phases[1].supportedSelectedCents,0);
const movements=results.find(r=>r.kind==='max-movements');A.equal(movements.phases[0].code,'CASH_RESULT_LIMIT');A.equal(movements.phases[0].candidateResultBytes,9414376);
const chain=results.find(r=>r.kind==='proof-chain');A.equal(chain.phases[0].proofCount,135);A.equal(chain.phases[1].supportedSelectedCents,83700);
console.log('4/4 resource observations verified against '+sha);
