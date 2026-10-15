'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),f=require('./helpers.cjs'),{A}=f,pins=require('./baseline-continuity.json'),adaptations=require('../refund-receipts-approved-legacy-pins.json'),transitions=require('../save-preflight-approved-legacy-pins.json');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex'),read=p=>fs.readFileSync(path.join(f.ROOT,p));
const newMethods=['cancelBuffer','confirmBuffer','invalidateBuffer','isBufferCurrent','previewBuffer'];
function normalized(p,s){if(['tests/daily-cash-boundary.test.cjs','tests/payday-room-boundary.test.cjs'].includes(p))s=s.replace(/'(?:cancelBuffer|confirmBuffer|invalidateBuffer|isBufferCurrent|previewBuffer)',/g,'');if(['tests/independent-runtime.test.cjs','tests/spending-entry-capabilities.test.cjs','tests/synthetic-samples.test.cjs'].includes(p))s=s.replaceAll('0.20.0','<approved-release>').replaceAll('0.21.0','<approved-release>').replaceAll('0.22.0','<approved-release>').replaceAll('0.23.0','<approved-release>');return s;}
function register(test){
test('CB B23 exactly five new coordinator methods; existing exports VERSION LIMITS and all prior methods remain',()=>{A.deepEqual(Reflect.ownKeys(f.D).sort(),['LIMITS','VERSION','createCoordinator']);A.equal(f.D.VERSION,1);A.deepEqual(Reflect.ownKeys(f.engine().c).sort(),['cancel','cancelRoom','confirm','confirmBasis','confirmRoom','inspect','inspectBasis','invalidateAll','invalidateProjection','invalidateRoom','isAnchorCurrent','isCurrent','isRoomCurrent','preview','previewBasis','previewRoom',...newMethods].sort());A.equal(f.D.LIMITS.inputBytes,33554432);A.equal(f.D.LIMITS.queryBytes,8388608);A.equal(f.D.LIMITS.resultBytes,8388608);});
test('CB B23 accepted baseline test sources and assertions remain byte-identical except approved exact API/release literals',()=>{
 A.equal(pins.baselineTests,4462);A.equal(pins.protectedTestFiles.length,217);
 A.equal(sha(read('tests/cash-buffer-boundary/baseline-continuity.json')),'280d48e55a9669a4835c3ed027004bb255a955c838caeb6f14c751930f51d22c');
 A.equal(sha(read('tests/refund-receipts-approved-legacy-pins.json')),'e870f6db7bcdc59f38d9ef86c2aa79ea6d4f44cd64e260cba9cc4a196719cffd');
 A.equal(adaptations.version,1);A.equal(adaptations.approvedRelease,'0.22.0');A.equal(adaptations.inheritedPinFileSha256,'280d48e55a9669a4835c3ed027004bb255a955c838caeb6f14c751930f51d22c');A.equal(adaptations.acceptedBaselineManifestSha256,'861d5a032b82f072952ed0b0c80ee28fac2084355cb0e2f5e8bf6572534bf074');
 A.deepEqual(adaptations.files.map(x=>x.path).sort(),['tests/independent-practice-ui.test.cjs','tests/independent-runtime.test.cjs','tests/relations-ui.test.cjs','tests/transfer-ui-harness.cjs']);
 // The separate accepted-v0.22 before-basis is immutable; no two editable pin fields alone authorize a change.
 const acceptedBefore={
  "tests/backup-storage-independent.test.cjs": {
    "sha256": "c9574bde4f7e21f6d53b30353746f171aac9e343e63a95e958a78aeb8f3b4a54",
    "bytes": 15945,
    "normalizedSha256": "c9574bde4f7e21f6d53b30353746f171aac9e343e63a95e958a78aeb8f3b4a54"
  },
  "tests/refund-receipts-host-workflow.test.cjs": {
    "sha256": "84516570c3e10ced6f5f541a4badb6ac67588eeb911d69d3f96cd25a1c390a1d",
    "bytes": 6230,
    "normalizedSha256": "84516570c3e10ced6f5f541a4badb6ac67588eeb911d69d3f96cd25a1c390a1d"
  },
  "tests/refund-receipts-host-storage.test.cjs": {
    "sha256": "5abc1189c42467051c49f7bd031177336235f0846939f7e4bba6e38282cb0b4f",
    "bytes": 5718,
    "normalizedSha256": "5abc1189c42467051c49f7bd031177336235f0846939f7e4bba6e38282cb0b4f"
  },
  "tests/independent-runtime.test.cjs": {
    "sha256": "bf3f7b8510c0bd408eead61ab2c9961076fabfa274234255d45a195d76e629dc",
    "bytes": 30937,
    "normalizedSha256": "f6f2a6360c2146ead0e7f1278ecc7e5182a2a789d0a2a30b9c6912c4deeece14"
  },
  "tests/spending-entry-capabilities.test.cjs": {
    "sha256": "617ed692a595f0f312bc84389f5285c5540ba62b8f9e05e0501ce6e23cbf01ef",
    "bytes": 4087,
    "normalizedSha256": "bce46f9d5509c009edf5b27b1aa16931f31b0887e174172f74c09ceaccc3b55e"
  },
  "tests/synthetic-samples.test.cjs": {
    "sha256": "fdf107330f506aa5a7eb332b8ea5dd2110ec60ce09c60c515288c95e8b38b35d",
    "bytes": 20845,
    "normalizedSha256": "caa7081ad65405cc0624dd660d2192d25b00afa82cfc755bb9036764fd3c0d08"
  },
  "tests/refund-receipts-continuity.test.cjs": {
    "sha256": "5475ace424b336cedc10115b18b02c4b2fc192b6835638c6f7344da9b0c2c0dd",
    "bytes": 4016,
    "normalizedSha256": "5475ace424b336cedc10115b18b02c4b2fc192b6835638c6f7344da9b0c2c0dd"
  }
};
 A.equal(sha(read('tests/save-preflight-approved-legacy-pins.json')),'ee03e16c149e892cae15ef3ce83540d1434c4ac3db4b1c1f6f99f216ea105e30');
 A.equal(transitions.version,1);A.equal(transitions.approvedRelease,'0.23.0');
 A.equal(transitions.acceptedBaselineManifestSha256,'2e9f1ecc010ea8d3dab63fd2286c20b4b14d332404ceb16b7a69f16145c121b7');
 A.equal(transitions.inheritedPinFileSha256,'280d48e55a9669a4835c3ed027004bb255a955c838caeb6f14c751930f51d22c');
 A.equal(transitions.inheritedRefundPinFileSha256,'e870f6db7bcdc59f38d9ef86c2aa79ea6d4f44cd64e260cba9cc4a196719cffd');
 A.equal(transitions.files.length,7);A.deepEqual(transitions.files.map(x=>x.path).sort(),Object.keys(acceptedBefore).sort());
 const approved=new Map(adaptations.files.map(x=>[x.path,x])),nextApproved=new Map(transitions.files.map(x=>[x.path,x]));
 A.equal(nextApproved.size,7,'transition paths remain unique');
 for(const next of transitions.files){
  const before=acceptedBefore[next.path],historical=pins.protectedTestFiles.find(x=>x.path===next.path),prior=approved.get(next.path),raw=read(next.path);
  A.equal(next.v022RawSha256,before.sha256,'accepted before raw '+next.path);A.equal(next.v022Bytes,before.bytes,'accepted before bytes '+next.path);A.equal(next.v022NormalizedSha256,before.normalizedSha256,'accepted before normalized '+next.path);
  A.equal(next.historicalNormalizedSha256,historical?historical.sha256:null,'retained original217 linkage '+next.path);
  if(prior){A.equal(prior.v022RawSha256,before.sha256,'retained v0.22 raw linkage '+next.path);A.equal(prior.v022NormalizedSha256,before.normalizedSha256,'retained v0.22 normalized linkage '+next.path);}
  else if(historical)A.equal(before.normalizedSha256,historical.sha256,'retained historical normalized basis '+next.path);
  A.equal(sha(raw),next.v023RawSha256,'exact v0.23 transition raw '+next.path);A.equal(raw.length,next.v023Bytes,'exact v0.23 transition bytes '+next.path);A.equal(sha(normalized(next.path,raw.toString('utf8'))),next.v023NormalizedSha256,'exact v0.23 transition normalized '+next.path);
 }
 for(const p of pins.protectedTestFiles){const raw=read(p.path),next=approved.get(p.path);if(next)A.equal(next.historicalNormalizedSha256,p.sha256,'retained historical pin '+p.path);if(nextApproved.has(p.path))continue;if(next){A.equal(sha(raw),next.v022RawSha256,'exact approved raw source '+p.path);A.equal(sha(normalized(p.path,raw.toString('utf8'))),next.v022NormalizedSha256,'exact approved normalized source '+p.path);}else A.equal(sha(normalized(p.path,raw.toString('utf8'))),p.sha256,'protected baseline '+p.path);}
});
test('CB B24 six authored downloads and two established guides remain exactly pinned',()=>{
 A.equal(pins.authoredAssets.length,8);A.equal(sha(read('tests/cash-buffer-boundary/baseline-continuity.json')),'280d48e55a9669a4835c3ed027004bb255a955c838caeb6f14c751930f51d22c');
 A.equal(sha(read('tests/refund-receipts-approved-legacy-pins.json')),'e870f6db7bcdc59f38d9ef86c2aa79ea6d4f44cd64e260cba9cc4a196719cffd');
 A.deepEqual(adaptations.authoredGuideAdaptations.map(x=>x.path).sort(),['SAMPLE_GUIDE.md','dist/synthetic-practice.html']);
 const guides=new Map(adaptations.authoredGuideAdaptations.map(x=>[x.path,x]));
 for(const p of pins.authoredAssets){const next=guides.get(p.path);if(next){A.equal(next.historicalRawSha256,p.sha256,'retained historical guide pin '+p.path);A.equal(sha(read(p.path)),next.v022RawSha256,'exact reviewed guide '+p.path);}else A.equal(sha(read(p.path)),p.sha256,p.path);}
});
test('CB B24 seven genuine new resource observations match exact model/runner pins',()=>{A.equal(require('./verify-resources.cjs').verify().observations,7);});
test('CB B24 inherited daily4 and room5 resource observations must be fresh at exact final model bytes',()=>{const moduleSha=sha(read('dist/daily-cash.js')),daily=JSON.parse(read('tests/daily-cash-model/resource-results.json')),room=JSON.parse(read('tests/payday-room-boundary/resource-results.json'));A.equal(daily.moduleSha256,moduleSha);A.equal(room.moduleSha256,moduleSha);A.equal(daily.results.length,4);A.equal(room.observations.length,5);A.equal(daily.runnerSha256,sha(read('tests/daily-cash-model/boundary-resources.cjs')));A.equal(room.runnerSha256,sha(read('tests/payday-room-boundary/resources.cjs')));for(const r of [...daily.results,...room.observations]){A.equal(r.moduleSha256,moduleSha);A.equal(r.onDiskModuleSha256AtEnd,moduleSha);A.ok(Number.isFinite(Date.parse(r.measuredAt)));A.ok(r.processPeakRssBytes>0);}for(const r of room.observations)A.ok(r.elapsedMs>0);for(const p of daily.results.flatMap(r=>r.phases))A.ok(Number.isFinite(p.elapsedMs)&&p.elapsedMs>=0);});
}
module.exports={register};
