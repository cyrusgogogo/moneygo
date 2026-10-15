'use strict';
// Source/markup-level integration evidence only; no browser acceptance claim.
const test=require('node:test'),A=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {host}=require('./backup-safety-host.cjs');
const L=require('../dist/ledger.js'),N=require('../dist/backup-safety.js');
const K=L.STORAGE_KEY,R='moneygo.ledger.beforeRestore.v1',NOTE=N.NOTE_KEY;
const clone=x=>JSON.parse(JSON.stringify(x));
const quota=()=>Object.assign(new Error('reported storage restriction'),{name:'QuotaExceededError'});
const security=()=>Object.assign(new Error('access denied'),{name:'SecurityError'});
const ledger=(name='Current')=>L.putAccount(L.createEmpty(),{name,openingBalanceCents:0},'account-cash');
const initial=(extra=[])=>[[K,JSON.stringify(ledger())],...extra];
const operations=(h,op,key)=>h.attempts.filter(x=>x[0]===op&&x[1]===key);
const snapshot=h=>({state:h.value('state'),savedRaw:h.value('savedRaw'),raw:h.store.values.get(K)});
const status=h=>h.value('backupSafety.view({ledgerRead,blocked:Boolean(blocked),stale})');
function save(h,name='Next'){h.put('nextState',ledger(name));return h.run('persist(nextState)');}
function restore(h,name='Restored'){h.node('[data-action="restore"]')?.click();if(!h.node('#restore-file'))h.run('showRestore()');h.put('nextState',ledger(name));h.run('restorePreview(nextState)');h.node('#restore-consent').checked=true;h.node('#restore-consent').dispatch('change');h.node('#confirm-restore').click();}
function viewBackup(h){h.node('[data-page="backup"]').click();return h;}
async function select(h,text,{size,read}={}){const input=h.node('#verify-backup-file');input.files=text===null?[]:[{name:'private-name.json',size:size??String(text).length,text:read||(()=>Promise.resolve(text))}];return input.onchange({target:input});}
function verifyOpen(h){viewBackup(h);h.node('[data-action="verify-backup"]').click();return h;}
function throwingName(){return Object.defineProperty({},'name',{get(){throw Error('getter');}});}

test('host executes every actual index script in order, without alternative roots or APIs',async()=>{
 const h=host(undefined,{without:['TextEncoder','TextDecoder','navigator','crypto']});
 const html=fs.readFileSync(path.join(__dirname,'../dist/index.html'),'utf8');
 A.deepEqual(h.scripts,[...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*><\/script>/g)].map(m=>m[1]));
 A.deepEqual(h.scripts.slice(-3),['runtime-capability-v1.js','personal-bootstrap-v1.js','app-runtime-v1.js']);A.ok(h.scripts.includes('backup-safety.js'));A.ok(h.scripts.indexOf('backup-safety.js')<h.scripts.indexOf('runtime-capability-v1.js'));
 A.equal(h.value('ledgerRead'),'absent');A.match(h.node('#local-storage-status').textContent,/尚未观察到/);
 verifyOpen(h);await select(h,L.backup(ledger()));A.match(h.node('#verify-backup-result').innerHTML,/备份验证通过/);
});

test('actual selected verifier records only note and leaves live/raw/recovery exactly unchanged',async()=>{
 const h=verifyOpen(host(initial([[R,'prior raw rollback']]))),before=snapshot(h);h.attempts.length=0;
 await select(h,L.backup(ledger('Selected')));
 A.deepEqual(snapshot(h),before);A.equal(h.store.values.get(R),'prior raw rollback');
 A.equal(operations(h,'set',NOTE).length,1);A.equal(operations(h,'set',K).length,0);
 A.equal(status(h).sessionVerification.status,'session-passed');A.equal(status(h).currentLedgerCoverage,'not-assessed');
 const note=JSON.parse(h.store.values.get(NOTE));A.deepEqual(Object.keys(note).sort(),['backupVersion','completedAt','kind','verifierRevision','version']);
 A.doesNotMatch(h.store.values.get(NOTE),/private-name|Selected|accounts|transactions|balance/);
 A.match(h.node('#verify-backup-result').innerHTML,/设备校验时间/);A.match(h.node('#verify-backup-result').innerHTML,/未评估/);
});

test('failed new selection clears success markup and error resets; valid previous history survives',async()=>{
 const h=verifyOpen(host(initial()));await select(h,L.backup(ledger()));const note=h.store.values.get(NOTE),before=snapshot(h);
 await select(h,'{"kind":"broken"}');A.equal(h.node('#verify-backup-result').innerHTML,'');A.match(h.node('#form-error').textContent,/验证失败/);A.equal(h.store.values.get(NOTE),note);A.deepEqual(snapshot(h),before);
 await select(h,null);A.equal(h.node('#form-error').hidden,true);A.equal(h.node('#verify-backup-result').innerHTML,'');A.equal(h.store.values.get(NOTE),note);
});

test('oversized/unreadable/cancelled selections never produce note or live pass',async()=>{
 for(const opts of [{size:32*1024*1024+1},{read:()=>Promise.reject(Error('read denied'))}]){
  const h=verifyOpen(host(initial()));await select(h,'{}',opts);A.equal(h.store.values.has(NOTE),false);A.equal(status(h).sessionVerification.status,'absent');A.equal(h.node('#verify-backup-result').innerHTML,'');
 }
 const h=verifyOpen(host());await select(h,null);A.equal(h.store.values.has(NOTE),false);
});

test('real file A/B read ordering and close/reopen reject obsolete results before verifier or note',async()=>{
 const h=verifyOpen(host(initial()));let finish;const old=select(h,L.backup(ledger('A')),{read:()=>new Promise(r=>finish=r)});
 await select(h,L.backup(ledger('B')));const note=h.store.values.get(NOTE),sets=operations(h,'set',NOTE).length;finish(L.backup(ledger('A')));await old;A.equal(h.store.values.get(NOTE),note);A.equal(operations(h,'set',NOTE).length,sets);
 let late;const pending=select(h,'{}',{read:()=>new Promise(r=>late=r)});h.node('[data-close]').click();h.node('[data-action="verify-backup"]').click();late(L.backup(ledger('Late')));await pending;A.equal(h.node('#verify-backup-result').innerHTML,'');A.equal(operations(h,'set',NOTE).length,sets);
});

test('metadata write denial, silent failure and readback throw preserve actual verifier success',async()=>{
 for(const mode of ['throw','silent','readback']){
  const h=verifyOpen(host(initial()));let written=false;h.store.onSet=(key)=>{if(key===NOTE){written=true;if(mode==='throw')throw security();if(mode==='silent')return {skip:true};}};h.store.onGet=key=>{if(key===NOTE&&written&&mode==='readback')throw security();};
  await select(h,L.backup(ledger()));A.match(h.node('#verify-backup-result').innerHTML,/备份验证通过/);A.equal(h.node('#form-error').hidden,true);A.equal(status(h).sessionVerification.status,'session-passed');A.match(h.node('#verify-backup-result').innerHTML,/未确认保存/);
 }
});

test('only immediate real named quota write errors evict; ordinary errors/messages/codes never do',()=>{
 const errors=[new Error('Quota exceeded'),new Error('QuotaExceededError'),security(),{name:'Other',code:22},{cause:quota()},null,'QuotaExceededError',throwingName()];
 for(const problem of errors){const h=host(initial([[NOTE,'optional']])),before=snapshot(h);h.attempts.length=0;h.store.onSet=k=>{if(k===K)throw problem;};A.throws(()=>save(h));A.deepEqual(snapshot(h),before);A.equal(operations(h,'set',K).length,1);A.equal(operations(h,'remove',NOTE).length,0);}
 const h=host(initial([[NOTE,'optional']]));const cause=quota();h.put('quotaCause',cause);h.run("testWrapped=new L.LedgerError('OTHER','other',quotaCause)");A.equal(h.run('ledgerQuota(testWrapped)'),false);A.equal(h.run("ledgerQuota({code:'STORAGE_WRITE_FAILED',cause:{cause:quotaCause}})"),false);A.equal(h.run("ledgerQuota({get code(){throw Error('getter')}})"),false);A.equal(h.run("ledgerQuota({code:'STORAGE_WRITE_FAILED',get cause(){throw Error('getter')}})"),false);
});

test('named quota releases present invalid or empty notes once and retries same precomputed candidate',()=>{
 for(const note of ['', 'invalid', '{"version":999}']){const h=host(initial([[NOTE,note]]));h.attempts.length=0;let attempts=0;h.store.onSet=k=>{if(k===K&&++attempts===1)throw quota();};save(h);A.equal(attempts,2);A.equal(operations(h,'remove',NOTE).length,1);A.equal(h.store.values.has(NOTE),false);A.equal(h.value('state.accounts[0].name'),'Next');A.equal(h.value('savedRaw'),h.store.values.get(K));A.equal(operations(h,'set',NOTE).length,0);A.equal(operations(h,'set',K)[0][2],operations(h,'set',K)[1][2]);}
 const h=host(initial([[NOTE,'optional']]));let calls=0,attempt=0;h.put('candidate',()=>{calls++;return ledger('Once');});h.store.onSet=k=>{if(k===K&&++attempt===1)throw quota();};h.run("change(candidate,'saved')");A.equal(calls,1);A.equal(attempt,2);
});

test('capacity-bound storage fits only after note deletion, without note reinsertion',()=>{
 const h=host(initial([[NOTE,'x'.repeat(300)]]));const candidate=ledger('Larger'.repeat(8)),serialized=JSON.stringify(candidate),capacity=serialized.length;h.put('candidate',candidate);
 h.store.onSet=(key,value)=>{const total=[...h.store.values].filter(([k])=>k!==key).reduce((sum,[,v])=>sum+v.length,0)+value.length;if(total>capacity)throw quota();};h.attempts.length=0;
 h.run('persist(candidate)');A.equal(operations(h,'set',K).length,2);A.equal(operations(h,'remove',NOTE).length,1);A.equal(h.store.values.get(K),serialized);A.equal(h.store.values.has(NOTE),false);
});

test('absent/unreadable/unremovable/silently retained/recreated note forbids blind retry',()=>{
 for(const mode of ['absent','get','remove','silent','recreated','readback']){
  const h=host(initial(mode==='absent'?[]:[[NOTE,'optional']])),before=snapshot(h);let removed=false;h.attempts.length=0;
  h.store.onSet=k=>{if(k===K)throw quota();};h.store.onGet=k=>{if(k===NOTE&&(mode==='get'||mode==='readback'&&removed))throw security();if(k===NOTE&&mode==='recreated'&&removed){h.store.values.set(NOTE,'other tab');return {value:'other tab'};}};h.store.onRemove=k=>{if(k===NOTE){removed=true;if(mode==='remove')throw security();if(mode==='silent')return {skip:true};}};
  A.throws(()=>save(h),/未重试写入/);A.equal(operations(h,'set',K).length,1);A.deepEqual(snapshot(h),before);
 }
});

test('second failed attempt stops and preserves later access-denial context',()=>{
 const h=host(initial([[NOTE,'optional']])),before=snapshot(h);let attempts=0;h.store.onSet=k=>{if(k===K)throw ++attempts===1?quota():security();};h.attempts.length=0;A.throws(()=>save(h),e=>/SecurityError/.test(e.message)&&e.retryCause?.cause?.name==='SecurityError');A.equal(attempts,2);A.equal(operations(h,'remove',NOTE).length,1);A.deepEqual(snapshot(h),before);A.equal(status(h).ledgerWriteFailure.cause,'write-failed');
});

test('all second failures retain exact failure identity and never loop',()=>{
 for(const problem of [quota(),new Error('generic retry rejection'),security(),null,'unknown rejection']){
  const h=host(initial([[NOTE,'optional']])),before=snapshot(h);let attempts=0;h.store.onSet=k=>{if(k===K)throw ++attempts===1?quota():problem;};h.attempts.length=0;
  A.throws(()=>save(h),e=>e.retryCause?.cause===problem);A.equal(attempts,2);A.equal(operations(h,'remove',NOTE).length,1);A.deepEqual(snapshot(h),before);
 }
});

test('changed raw/stale/read-denied retry guard stops after note release and preserves other-tab ledger',()=>{
 for(const mode of ['changed','stale','denied']){
  const h=host(initial([[NOTE,'optional']])),before=snapshot(h),other=JSON.stringify(ledger('Other tab'));let removed=false;h.store.onSet=k=>{if(k===K)throw quota();};h.store.onRemove=k=>{if(k===NOTE){removed=true;if(mode==='changed')h.store.values.set(K,other);if(mode==='stale')h.run('stale=true');}};h.store.onGet=k=>{if(k===K&&removed&&mode==='denied')throw security();};h.attempts.length=0;
  A.throws(()=>save(h),/未重试写入/);A.equal(operations(h,'set',K).length,1);A.deepEqual(h.value('state'),before.state);A.equal(h.value('savedRaw'),before.savedRaw);A.equal(h.store.values.get(K),mode==='changed'?other:before.raw);
 }
});

test('blocked, stale, changed-raw, invalid state and preflight read failure never evict or invent failed writes',()=>{
 for(const mode of ['blocked','stale','changed','invalid','read']){
  const h=host(initial([[NOTE,'optional']]));if(mode==='blocked')h.run("blocked='invalid original'");if(mode==='stale')h.run('stale=true');if(mode==='changed')h.store.values.set(K,'other');if(mode==='read')h.store.onGet=k=>{if(k===K)throw security();};h.attempts.length=0;h.put('candidate',mode==='invalid'?{}:ledger('New'));
  A.throws(()=>h.run('persist(candidate)'));A.equal(operations(h,'set',K).length,0);A.equal(operations(h,'remove',NOTE).length,0);A.equal(status(h).lastLedgerWrite,null);
 }
});

test('successful first save never touches optional note or reads ledger after accepted write',()=>{
 const h=host(initial([[NOTE,'optional']]));let accepted=false;h.store.onSet=k=>{if(k===K)accepted=true;};h.store.onGet=()=>{if(accepted)throw security();};h.attempts.length=0;save(h);A.equal(operations(h,'set',K).length,1);A.equal(h.attempts.filter(x=>x[1]===NOTE).length,0);A.equal(h.value('state.accounts[0].name'),'Next');A.equal(h.attempts.at(-1)[0],'set');
});

test('retry accepted save also commits with every subsequent read denied',()=>{
 const h=host(initial([[NOTE,'optional']]));let count=0,accepted=false;h.store.onSet=k=>{if(k===K){if(++count===1)throw quota();accepted=true;}};h.store.onGet=()=>{if(accepted)throw security();};h.attempts.length=0;save(h);A.equal(count,2);A.equal(h.value('state.accounts[0].name'),'Next');A.equal(h.attempts.at(-1)[0],'set');
});

test('restore staging failures do not compensate, with prior copy present or absent',()=>{
 for(const prior of [null,'','previous raw'])for(const problem of [quota(),new Error('Quota exceeded'),security()]){
  const h=host(initial([...(prior===null?[]:[[R,prior]]),[NOTE,'optional']])),before=snapshot(h);h.store.onSet=k=>{if(k===R)throw problem;};h.attempts.length=0;restore(h);A.deepEqual(snapshot(h),before);A.equal(h.store.values.get(R)??null,prior);A.equal(operations(h,'set',K).length,0);A.equal(operations(h,'remove',R).length,0);A.equal(operations(h,'set',R).length,problem.name==='QuotaExceededError'?2:1);A.match(h.node('#form-error').textContent,/恢复未完成/);
 }
});

test('accepted restore stage requires copy readback; mismatch/read denial compensates exact bytes',()=>{
 for(const prior of [null,'','{invalid previous}','x'.repeat(5000)])for(const mode of ['throw','mismatch']){
  const h=host(initial(prior===null?[]:[[R,prior]])),before=snapshot(h);let staged=false;h.store.onSet=k=>{if(k===R)staged=true;};h.store.onGet=k=>{if(k===R&&staged){if(mode==='throw')throw security();return {value:'not staged original'};}};h.attempts.length=0;restore(h);A.deepEqual(snapshot(h),before);A.equal(h.store.values.get(R)??null,prior);A.equal(operations(h,'set',K).length,0);A.equal(status(h).recoveryCopyFailure.phase,'readback');
 }
});

test('restore stage quota can retry once; later ledger quota shares the consumed budget even with recreated note',()=>{
 const h=host(initial([[R,'previous'],[NOTE,'optional']])),before=snapshot(h);let stages=0;
 h.store.onSet=k=>{if(k===R&&++stages===1)throw quota();if(k===K){h.store.values.set(NOTE,'recreated by another tab');throw quota();}};h.attempts.length=0;restore(h);A.deepEqual(snapshot(h),before);A.equal(h.store.values.get(R),'previous');A.equal(h.store.values.get(NOTE),'recreated by another tab');A.equal(operations(h,'remove',NOTE).length,1);A.equal(operations(h,'set',K).length,1);
 // A later independent user action gets a fresh budget.
 let saves=0;h.store.onSet=k=>{if(k===K&&++saves===1)throw quota();};save(h,'Later');A.equal(saves,2);A.equal(operations(h,'remove',NOTE).length,2);
});

test('restore ledger quota retry succeeds and retains original raw recovery copy',()=>{
 for(const raw of [JSON.stringify(ledger()),'corrupt original raw',null]){
  const h=host([...(raw===null?[]:[[K,raw]]),[R,'previous'],[NOTE,'optional']]);let writes=0;h.store.onSet=k=>{if(k===K&&++writes===1)throw quota();};h.attempts.length=0;const expected=raw??JSON.stringify(h.value('state'));restore(h);A.equal(h.value('state.accounts[0].name'),'Restored');A.equal(h.store.values.get(R),expected);A.equal(writes,2);A.equal(operations(h,'remove',NOTE).length,1);A.equal(h.node('#modal-root').innerHTML,'');
 }
});

test('ledger restore failure compensates exact prior copy including absent and empty; no compensation retry',()=>{
 for(const prior of [null,'','invalid prior','x'.repeat(5000)]){
  const h=host(initial([...(prior===null?[]:[[R,prior]]),[NOTE,'optional']])),before=snapshot(h);h.store.onSet=k=>{if(k===K)throw security();};h.attempts.length=0;restore(h);A.deepEqual(snapshot(h),before);A.equal(h.store.values.get(R)??null,prior);A.equal(operations(h,'remove',NOTE).length,0);A.equal(operations(h,'set',K).length,1);
 }
 for(const prior of [null,'prior']){
  const h=host(initial([...(prior===null?[]:[[R,prior]]),[NOTE,'optional']]));let ledgerFailed=false;h.store.onSet=k=>{if(k===K){ledgerFailed=true;throw security();}if(k===R&&ledgerFailed)throw quota();};h.store.onRemove=k=>{if(k===R)throw quota();};h.attempts.length=0;restore(h);A.match(h.node('#form-error').textContent,/原先的撤销副本无法还原/);A.equal(status(h).recoveryCopyFailure.phase,'compensation');A.equal(operations(h,'remove',NOTE).length,0);
 }
});

test('restore call ordering and successful final write with all subsequent reads failing never compensate',()=>{
 const h=host(initial([[R,'previous'],[NOTE,'optional']]));let accepted=false;h.store.onSet=k=>{if(k===K)accepted=true;};h.store.onGet=()=>{if(accepted)throw security();};h.attempts.length=0;restore(h);A.equal(h.value('state.accounts[0].name'),'Restored');A.equal(h.store.values.get(R),JSON.stringify(ledger()));A.equal(operations(h,'set',R).length,1);A.equal(operations(h,'remove',R).length,0);
 const log=h.attempts.map(x=>x.slice(0,2));A.deepEqual(log.slice(0,6),[['get',K],['get',R],['set',R],['get',R],['get',K],['set',K]]);
});

test('throwing diagnostics and status-node access cannot reverse accepted ledger or restore',()=>{
 for(const mode of ['observeStorage','view','dom']){
  let faultHooks=0;const options={beforeScript(file,context,window){if(file!=='app-runtime-v1.js'||mode==='dom')return;faultHooks++;const actual=window.MoneygoBackupSafety.create;window.MoneygoBackupSafety={...window.MoneygoBackupSafety,create(...args){const c=actual(...args);return {...c,[mode](){throw Error('diagnostic failed');}};}};}};
  const h=host(initial([[R,'prior']]),options);A.equal(faultHooks,mode==='dom'?0:1);if(mode==='dom'){const query=h.doc.querySelector.bind(h.doc);h.doc.querySelector=s=>{if(s==='#local-storage-status'||s==='#backup-safety-status')throw Error('DOM failed');return query(s);};}
  A.doesNotThrow(()=>save(h));restore(h);A.equal(h.value('state.accounts[0].name'),'Restored');A.equal(operations(h,'set',R).length,1);
 }
});

test('throwing release method stops retry, preserving failed open form and current ledger',()=>{
 let faultHooks=0;const h=host(initial([[NOTE,'optional']]),{beforeScript(file,context,window){if(file!=='app-runtime-v1.js')return;faultHooks++;const create=window.MoneygoBackupSafety.create;window.MoneygoBackupSafety={...window.MoneygoBackupSafety,create(...args){return {...create(...args),releaseHistoryForWrite(){throw Error('diagnostic failed');}};}};}}),before=snapshot(h);A.equal(faultHooks,1);h.node('[data-action="new"]').click();const form=h.node('#entry-form');form.elements.note.value='unsaved';h.store.onSet=k=>{if(k===K)throw quota();};h.put('candidate',ledger('Unsaved'));h.run("change(()=>candidate,'saved')");A.equal(h.node('#entry-form'),form);A.equal(form.elements.note.value,'unsaved');A.deepEqual(snapshot(h),before);A.equal(operations(h,'set',K).length,1);
});

test('startup classifies missing/valid/corrupt/first-read-failed/second-read-failed/getter-denied without probe writes',()=>{
 for(const mode of ['missing','valid','corrupt','first','second','getter']){
  let reads=0;const options=mode==='getter'?{localStorageGetter(){throw security();}}:{storage:{onGet(k){if(k===K&&((mode==='first'&&++reads===1)||(mode==='second'&&++reads===2)))throw security();}}};
  const h=host(mode==='missing'?[]:[[K,mode==='corrupt'?'broken':JSON.stringify(ledger())]],options);A.equal(h.writes.length,0);A.equal(h.value('ledgerRead'),['first','second','getter'].includes(mode)?'failed':mode==='missing'?'absent':'present');A.equal(Boolean(h.value('blocked')),['corrupt','first','second','getter'].includes(mode));
 }
});

test('note-only storage event refreshes history without discarding page/modal form or setting stale',async()=>{
 const h=viewBackup(host(initial()));h.node('[data-action="new"]').click();const form=h.node('#entry-form'),app=h.node('#app');form.elements.note.value='unsaved draft';form.elements.note.focus();const active=h.doc.activeElement;
 h.store.values.set(NOTE,JSON.stringify({kind:'moneygo-backup-verification-note',version:1,completedAt:'2026-10-14T00:00:00.000Z',backupVersion:6,verifierRevision:1}));h.winListeners.get('storage')({key:NOTE});
 A.equal(h.node('#entry-form'),form);A.equal(h.node('#app'),app);A.equal(form.elements.note.value,'unsaved draft');A.equal(h.doc.activeElement,active);A.equal(h.value('stale'),false);A.equal(status(h).sessionVerification.status,'absent');A.equal(status(h).storedNote.status,'recorded-only');
 h.store.values.clear();h.winListeners.get('storage')({key:null});A.equal(h.value('stale'),true);A.equal(status(h).storedNote.status,'missing');
});

test('blocked and stale warnings outrank successful selected verification; no coverage claim',async()=>{
 for(const mode of ['blocked','stale']){
  const h=verifyOpen(host([[K,mode==='blocked'?'broken':JSON.stringify(ledger())]]));if(mode==='stale')h.run('stale=true');await select(h,L.backup(ledger()));A.equal(Boolean(h.value(mode)),true);A.match(h.node('#local-storage-status').textContent,mode==='blocked'?/需处理/:/其他页面/);A.match(h.node('#backup-safety-status').textContent,/覆盖情况未评估/);A.doesNotMatch(h.node('#local-storage-status').textContent,/验证通过|健康|安全/);
 }
});

test('verification, export, note refresh and restore compensation never clear unresolved ledger-write failure',async()=>{
 const h=verifyOpen(host(initial([[R,'prior']])));h.store.onSet=k=>{if(k===K)throw security();};A.throws(()=>save(h));const failed=status(h).ledgerWriteFailure;
 await select(h,L.backup(ledger()));A.deepEqual(status(h).ledgerWriteFailure,failed);h.node('[data-close]').click();h.node('[data-action="export"]').click();h.node('[data-action="refresh-backup-status"]').click();A.deepEqual(status(h).ledgerWriteFailure,failed);restore(h);A.deepEqual(status(h).ledgerWriteFailure,failed);h.store.onSet=null;save(h);A.equal(status(h).ledgerWriteFailure,null);
});

test('exports, preview, restore, rollback and demo entry create no verification note or timestamp',()=>{
 const h=viewBackup(host(initial([[R,JSON.stringify(ledger('Old'))]])));h.node('[data-action="export"]').click();A.match(h.node('#toast').textContent,/已发起备份下载/);A.equal(h.downloads.length,1);restore(h);h.run('rollback()');h.node('#export-current').click();h.node('#confirm-rollback').click();h.run('demo()');A.equal(h.node('[href="demo.html"]').getAttribute('href'),'demo.html');A.equal(status(h).sessionVerification.status,'absent');A.equal(operations(h,'set',NOTE).length,0);
 const corrupt=viewBackup(host([[K,'broken raw']]));corrupt.node('[data-action="export-raw"]').click();A.equal(corrupt.downloads.length,1);A.equal(operations(corrupt,'set',NOTE).length,0);
});


test('a later real read denial outranks an earlier accepted write without inventing another write',()=>{
 const h=host(initial());save(h);h.store.onGet=k=>{if(k===K)throw security();};h.attempts.length=0;A.throws(()=>save(h,'Unreadable'));
 A.match(h.node('#local-storage-status').textContent,/读取失败/);A.equal(operations(h,'set',K).length,0);A.equal(status(h).lastLedgerWrite.outcome,'accepted');A.equal(status(h).ledgerWriteFailure,null);
});

test('throwing age clock cannot mask real verification or accepted financial writes',async()=>{
 let faultHooks=0;const h=verifyOpen(host(initial(),{beforeScript(file,context,window){if(file!=='app-runtime-v1.js')return;faultHooks++;const create=window.MoneygoBackupSafety.create;window.MoneygoBackupSafety={...window.MoneygoBackupSafety,create(options){return create({...options,now(){throw Error('clock failed');}});}};}}));
 A.equal(faultHooks,1);await select(h,L.backup(ledger()));A.match(h.node('#verify-backup-result').innerHTML,/备份验证通过/);A.equal(status(h).sessionVerification.age.status,'unknown');A.doesNotThrow(()=>save(h));
});

test('reloaded same-count same-balance historical note remains recorded-only and unassessed',async()=>{
 const h=verifyOpen(host(initial()));await select(h,L.backup(ledger('Different content with same counts and balances')));
 const fresh=viewBackup(host([...h.store.values]));A.equal(status(fresh).sessionVerification.status,'absent');A.equal(status(fresh).storedNote.status,'recorded-only');A.equal(status(fresh).currentLedgerCoverage,'not-assessed');A.match(fresh.node('#backup-safety-status').textContent,/未认证、未重新验证/);A.match(fresh.node('#backup-safety-status').textContent,/覆盖情况未评估/);
});


test('missing/throwing diagnostic initialization never blocks ordinary saves, restore or one real file verification',async()=>{
 for(const mode of ['missing','global-getter','create','key-getter','invalid-controller']){
  let calls=0,faultHooks=0;const h=host(initial([[NOTE,'optional']]),{beforeScript(file,context,window){if(file!=='app-runtime-v1.js')return;faultHooks++;const verify=window.MoneygoLedger.verifyBackup;window.MoneygoLedger={...window.MoneygoLedger,verifyBackup(...args){calls++;return verify(...args);}};
   if(mode==='missing')delete window.MoneygoBackupSafety;
   else if(mode==='global-getter')Object.defineProperty(window,'MoneygoBackupSafety',{get(){throw Error('global getter failed');}});
   else if(mode==='key-getter')window.MoneygoBackupSafety={...window.MoneygoBackupSafety,get NOTE_KEY(){throw Error('key failed');}};
   else window.MoneygoBackupSafety={...window.MoneygoBackupSafety,create(){if(mode==='create')throw Error('create failed');return {};}};
  }});
  A.equal(faultHooks,1);A.doesNotThrow(()=>save(h));viewBackup(h);A.match(h.node('#backup-safety-status').textContent,/诊断暂不可用/);verifyOpen(h);await select(h,L.backup(ledger()));A.equal(calls,1);A.match(h.node('#verify-backup-result').innerHTML,/备份验证通过/);A.equal(operations(h,'set',NOTE).length,0);
  h.node('[data-close]').click();restore(h);A.equal(h.value('state.accounts[0].name'),'Restored');A.doesNotThrow(()=>h.winListeners.get('storage')({key:NOTE}));
 }
});

test('uncertain controller verification failure never reruns the verifier through fallback',async()=>{
 let calls=0,faultHooks=0;const h=verifyOpen(host(initial(),{beforeScript(file,context,window){if(file!=='app-runtime-v1.js')return;faultHooks++;const verify=window.MoneygoLedger.verifyBackup,create=window.MoneygoBackupSafety.create;window.MoneygoLedger={...window.MoneygoLedger,verifyBackup(...args){calls++;return verify(...args);}};window.MoneygoBackupSafety={...window.MoneygoBackupSafety,create(options){const c=create(options);return {...c,verifySelectedBackup(text){options.verifyBackup(text);throw Error('after real verification');}};}};}}));
 A.equal(faultHooks,1);await select(h,L.backup(ledger()));A.equal(calls,1);A.equal(operations(h,'set',NOTE).length,0);A.equal(h.node('#verify-backup-result').innerHTML,'');A.match(h.node('#form-error').textContent,/验证失败/);
});

test('cached diagnostic note key protects financial storage events from a later throwing module getter',()=>{
 const h=host(initial());h.run("Object.defineProperty(window,'MoneygoBackupSafety',{get(){throw Error('late getter')}})");A.doesNotThrow(()=>h.winListeners.get('storage')({key:NOTE}));A.equal(h.value('stale'),false);A.doesNotThrow(()=>h.winListeners.get('storage')({key:K}));A.equal(h.value('stale'),true);
});
