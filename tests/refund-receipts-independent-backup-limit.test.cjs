'use strict';
const {test}=require('node:test');
const F=require('./refund-receipts-independent-fixtures.cjs');
const {A,L,R,from,bytes,coordinator}=F;
const B=from('tests/refund-receipts-boundary/resources.cjs'),H=from('tests/refund-receipts-boundary/helpers.cjs');
const LIMIT=33554432;
function envelopeBytes(state){return Buffer.byteLength(JSON.stringify({format:'moneygo-backup',version:state.version,exportedAt:F.now,data:state},null,2),'utf8');}
test('RR independent backup limit: recoverable source cannot authorize a refund that exceeds the unchanged ordinary backup envelope',t=>{
 const initial=B.imported(2400,[]),overhead=envelopeBytes(initial.s)-H.bytes(initial.s),a=B.rawExact(LIMIT-overhead-500),raw=bytes(a.s),before=L.backup(a.s),beforeBytes=Buffer.byteLength(before),cmd=H.command(a);
 A.equal(beforeBytes,LIMIT-500);A.deepEqual(L.parseBackup(before),a.s);A.equal(beforeBytes,envelopeBytes(a.s));
 const candidate=R.allocateRefund(a.s,cmd),candidateBytes=envelopeBytes(candidate);A.ok(H.bytes(candidate)<LIMIT,'canonical candidate still fits');A.ok(candidateBytes>LIMIT,'ordinary backup crosses its separate guard');A.doesNotThrow(()=>L.validateState(candidate));A.throws(()=>L.backup(candidate),e=>e.code==='BACKUP_TOO_LARGE');
 const c=coordinator();A.throws(()=>c.preview(a.s,cmd),e=>e.code==='RR_PROOF_UNAVAILABLE'&&e.downstreamCode==='BACKUP_TOO_LARGE');A.equal(bytes(a.s),raw);A.deepEqual(L.parseBackup(L.backup(a.s)),a.s);
 t.diagnostic(JSON.stringify({sourceCanonicalBytes:H.bytes(a.s),sourceOrdinaryBackupBytes:beforeBytes,publicAllocatorCandidateCanonicalBytes:H.bytes(candidate),publicAllocatorCandidateOrdinaryBackupBytes:candidateBytes,sourceRoundtripVerified:true,coordinatorAuthorityAccepted:false,rejectionCode:'RR_PROOF_UNAVAILABLE/BACKUP_TOO_LARGE',rawPreserved:true,provenance:a.construction,globalDatePatched:false}));
});
