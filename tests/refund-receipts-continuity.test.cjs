'use strict';
const {test}=require('node:test'),A=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),GUARD='tests/cash-buffer-boundary/compatibility.cjs';
const CASE='CB B23 accepted baseline test sources and assertions remain byte-identical except approved exact API/release literals';
// Execute the actual registered historical assertion with read-only fault injection.
// No fixture/source bytes or process-global fs method is modified.
function runGuard(changedPath,mutate,caseName=CASE){
 const raw=(name)=>{const b=fs.readFileSync(path.join(ROOT,name));return name===changedPath?Buffer.from(mutate(b.toString('utf8'))):b;};
 const context=vm.createContext({module:{exports:{}}});
 const readJson=name=>vm.runInContext('JSON.parse('+JSON.stringify(raw(name).toString('utf8'))+')',context);
 context.require=name=>{
  if(name==='node:fs')return {readFileSync:file=>raw(path.relative(ROOT,file))};
  if(name==='node:path')return path;
  if(name==='node:crypto')return crypto;
  if(name==='./helpers.cjs')return {ROOT,A};
  if(name==='./baseline-continuity.json')return readJson('tests/cash-buffer-boundary/baseline-continuity.json');
  if(name==='../refund-receipts-approved-legacy-pins.json')return readJson('tests/refund-receipts-approved-legacy-pins.json');
  if(name==='../save-preflight-approved-legacy-pins.json')return readJson('tests/save-preflight-approved-legacy-pins.json');
  throw Error('Unexpected guard dependency: '+name);
 };
 vm.runInContext(fs.readFileSync(path.join(ROOT,GUARD),'utf8'),context,{filename:GUARD});
 let callback,count=0;context.module.exports.register((name,fn)=>{if(name===caseName){callback=fn;count++;}});A.equal(count,1,'original exact case name remains singular');callback();
}
const rejects=(name,mutate)=>A.throws(()=>runGuard(name,mutate),e=>e.code==='ERR_ASSERTION');
test('RR continuity: actual historical guard accepts only the exact reviewed source set',()=>runGuard());
for(const name of ['tests/independent-practice-ui.test.cjs','tests/independent-runtime.test.cjs','tests/relations-ui.test.cjs','tests/transfer-ui-harness.cjs'])test('RR continuity: adapted file remains whole-byte protected '+name,()=>rejects(name,s=>s+'\n'));
test('RR continuity: an unrelated historical financial assertion file remains protected',()=>rejects('tests/ledger.test.cjs',s=>s+'\n'));
test('RR continuity: release-only assertions are not broadly exempt',()=>rejects('tests/spending-entry-capabilities.test.cjs',s=>s+'\n'));
test('RR continuity: future unapproved release literal remains rejected',()=>{const name='tests/synthetic-samples.test.cjs',before=fs.readFileSync(path.join(ROOT,name),'utf8'),after=before.replaceAll('0.23.0','0.24.0');A.notEqual(after,before,'named future-release mutation must occur before expecting a guard refusal');rejects(name,()=>after);});
test('RR continuity: changing the original217 pin manifest remains rejected',()=>rejects('tests/cash-buffer-boundary/baseline-continuity.json',s=>{const p=JSON.parse(s);p.protectedTestFiles[0].sha256='0'.repeat(64);return JSON.stringify(p);}));
test('RR continuity: adding an adaptation path cannot broaden the exception set',()=>rejects('tests/refund-receipts-approved-legacy-pins.json',s=>{const p=JSON.parse(s);p.files.push({...p.files[0],path:'tests/ledger.test.cjs'});return JSON.stringify(p);}));

const ASSET_CASE='CB B24 six authored downloads and two established guides remain exactly pinned';
for(const name of ['SAMPLE_GUIDE.md','dist/synthetic-practice.html'])test('RR continuity: corrected practice guide remains whole-byte protected '+name,()=>A.throws(()=>runGuard(name,s=>s+'\n',ASSET_CASE),e=>e.code==='ERR_ASSERTION'));
test('RR continuity: original raw practice downloads remain protected',()=>A.throws(()=>runGuard('dist/samples/SYNTHETIC-practice-bank.csv',s=>s+'\n',ASSET_CASE),e=>e.code==='ERR_ASSERTION'));
test('RR continuity: adding a guide exception cannot broaden the authored asset set',()=>A.throws(()=>runGuard('tests/refund-receipts-approved-legacy-pins.json',s=>{const p=JSON.parse(s);p.authoredGuideAdaptations.push({...p.authoredGuideAdaptations[0],path:'dist/samples/SYNTHETIC-practice-bank.csv'});return JSON.stringify(p);},ASSET_CASE),e=>e.code==='ERR_ASSERTION'));
