'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const L=require('../dist/ledger.js'),I=require('../dist/importer.js'),C=require('../dist/obligations.js');
const cfg=extra=>({sourceKey:'review-source',accountId:'account-cash',delimiter:',',columns:{date:0,amount:1,stableId:2,status:3},defaultType:'expense',...extra});
const body='date,amount,id,status,unmapped\n2026-09-01,1.00,x,completed,PRIVATE_VALUE_X\ninvalid,2.00,y,completed,PRIVATE_VALUE_Y';
const prefix='PRIVATE_PREFIX\n"inside\nquoted",PRIVATE_PREFIX_COLUMN\n\n';
const pcfg=extra=>cfg({startLine:5,preambleConfirmed:true,...extra});
const copy=x=>JSON.parse(JSON.stringify(x)),code=w=>e=>e.code===w;

test('review exhaustive physical boundary matrix accepts only complete records for all newline styles',()=>{
 for(const nl of ['\n','\r','\r\n'])for(const header of [true,false]){
  const csv=(prefix+body).replaceAll('\n',nl),p=I.parseCSV(csv,{delimiter:',',header});
  assert.deepEqual(p.records.map(r=>r.line),[1,2,5,6,7]);
  for(let line=1;line<=10;line++){if([1,2,5,6,7].includes(line)){const x=I.parseCSV(csv,{header,startLine:line});assert.equal(header?x.headerLine:x.rows[0].line,line);}else assert.throws(()=>I.parseCSV(csv,{header,startLine:line}),code('INVALID_START_LINE'));}
 }
});
test('review exact prefix replacement keeps idless receipt and source physical quarantine lines',()=>{
 const c=pcfg({columns:{date:0,amount:1,status:3}}),p=I.preview(L.createEmpty(),prefix+body,c),s=I.commit(L.createEmpty(),p,[p.rows[0].key]);
 const q=I.preview(s,(prefix+body).replace('PRIVATE_PREFIX','ANOTHER_PREFIX').replace('PRIVATE_PREFIX_COLUMN','ANOTHER_VALUE'),c);
 assert.equal(q.fileFingerprint,p.fileFingerprint);assert.equal(q.rows[0].action,'duplicate');assert.equal(s.imports.quarantine[0].line,7);
 const shifted=I.preview(s,'extra\n'+prefix+body,{...c,startLine:6});assert.equal(shifted.rows[0].action,'duplicate');assert.equal(shifted.fileFingerprint,p.fileFingerprint);
});
test('review no implicit preamble skipping, malformed prefix cannot be bypassed in either header mode',()=>{
 const plain=I.parseCSV(prefix+body);assert.deepEqual(plain.headers,['PRIVATE_PREFIX']);assert.equal(plain.rows[0].line,2);
 for(const header of [true,false])for(const bad of ['invalid"quote\n'+body,'"unfinished\n'+body,'"closed"tail\n'+body])assert.throws(()=>I.parseCSV(bad,{header,startLine:2}),code('CSV_QUOTE'));
});
test('review unmapped fields and skipped records never enter state or backup, including invalid rows',()=>{
 const p=I.preview(L.createEmpty(),prefix+body,pcfg()),s=I.commit(L.createEmpty(),p,[p.rows[0].key]);
 const saved=JSON.stringify(s)+L.backup(s);for(const secret of ['PRIVATE_PREFIX','PRIVATE_PREFIX_COLUMN','PRIVATE_VALUE_X','PRIVATE_VALUE_Y','skippedRecords','preambleConfirmed'])assert.ok(!saved.includes(secret),secret);
 assert.deepEqual(s.imports.evidence[0].mapped,{date:'2026-09-01',amount:'1.00',stableId:'x',status:'completed'});
 assert.equal(s.imports.quarantine.length,1);const q=s.imports.quarantine[0],r=I.previewRepair(s,q.id,{date:'2026-09-02'});assert.equal(r.rows[0].line,7);const done=I.commit(s,r,[r.rows[0].key]);assert.equal(done.transactions.length,2);assert.doesNotThrow(()=>L.parseBackup(L.backup(done)));
});
test('review same-valued genuine rows without stable IDs stay separate, exact reimport stays duplicate',()=>{
 const c=cfg({columns:{date:0,amount:1,status:2},startLine:2,preambleConfirmed:true}),csv='note\ndate,amount,status\n2026-09-01,1,completed\n2026-09-01,1,completed';
 const p=I.preview(L.createEmpty(),csv,c);assert.deepEqual(p.rows.map(x=>x.action),['new','candidate']);const s=I.commit(L.createEmpty(),p,p.rows.map(x=>x.key));assert.equal(s.transactions.length,2);assert.notEqual(s.transactions[0].id,s.transactions[1].id);assert.deepEqual(I.preview(s,csv,c).rows.map(x=>x.action),['duplicate','duplicate']);
});
test('review stable IDs preserve conflict, duplicate and update distinctions after selected preamble',()=>{
 const p=I.preview(L.createEmpty(),prefix+body,pcfg()),s=I.commit(L.createEmpty(),p,[p.rows[0].key]);
 assert.equal(I.preview(s,prefix+body,pcfg()).rows[0].action,'duplicate');assert.equal(I.preview(s,prefix+body.replace(',1.00,x',',5.00,x'),pcfg()).rows[0].action,'update');
 const manual=L.putTransaction(s,{...s.transactions[0],amountCents:101},s.transactions[0].id);assert.equal(I.preview(manual,prefix+body,pcfg()).rows[0].action,'conflict');
});
test('review old unset file fingerprint and row receipt survive genuine v1 migration exactly',()=>{
 const original=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/imports-v1-frozen-v08.json'),'utf8')),raw=JSON.stringify(original),next=L.validateState(original),expected=copy(original);expected.imports.version=2;assert.deepEqual(next,expected);assert.equal(JSON.stringify(original),raw);
 const csv='date,amount,id,status\n2026-09-01,1.00,first,completed\n2026-09-02,4.00,second,completed\ninvalid,3.00,bad,completed';const p=I.preview(next,csv,cfg({sourceKey:'frozen-v08-source'}));assert.deepEqual(p.rows.map(r=>r.action),['duplicate','duplicate','invalid']);assert.equal(p.fileFingerprint,original.imports.batches[1].fileFingerprint);
});
test('review version1 cannot smuggle valid, invalid or null new startLine configuration',()=>{
 const original=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/imports-v1-frozen-v08.json'),'utf8'));
 for(const startLine of [1,5,0,-1,null,'5']){const bad=copy(original);bad.imports.templates[0].config.startLine=startLine;assert.throws(()=>L.validateState(bad),code('INVALID_IMPORT_VERSION'));}
});
test('review stale and cloned preview tickets cannot reuse prior header consent or selections',()=>{
 const p=I.preview(L.createEmpty(),prefix+body,pcfg());assert.throws(()=>I.commit(L.createEmpty(),copy(p),[p.rows[0].key]),code('INVALID_PREVIEW'));
 const changed=L.putAccount(L.createEmpty(),{name:'changed',openingBalanceCents:0},'account-cash');assert.throws(()=>I.commit(changed,p,[p.rows[0].key]),code('STALE_PREVIEW'));
 assert.throws(()=>I.preview(L.createEmpty(),prefix+body,{...p.config}),code('PREAMBLE_CONFIRMATION_REQUIRED'));
});
test('review chosen start survives fee dependency guard and safe rollback after explicit unlink',()=>{
 const p=I.preview(L.createEmpty(),prefix+body,pcfg()),s=I.commit(L.createEmpty(),p,[p.rows[0].key]),review=state=>({confirmed:true,expectedRevision:state.obligations?.revision||0,reason:'Independent review'});
 const linked=C.markFee(s,{transactionId:s.transactions[0].id,kind:'service',statementId:null,contractId:null,note:''},review(s)),before=JSON.stringify(linked),r=I.rollback(linked,s.imports.batches[0].id);assert.equal(r.rolledBack,false);assert.ok(r.conflicts.some(c=>c.dependencies?.some(d=>d.kind==='feeEvidence')));assert.equal(JSON.stringify(linked),before);
 const unlinked=C.remove(linked,'fee',linked.obligations.fees[0].id,review(linked)),done=I.rollback(unlinked,s.imports.batches[0].id);assert.equal(done.rolledBack,true);assert.equal(done.state.transactions.length,0);assert.equal(done.state.imports.templates[0].config.startLine,5);
});

const {host}=require('./header-review-host.cjs');
const file=(name,csv)=>({name,size:Buffer.byteLength(csv),arrayBuffer:async()=>new TextEncoder().encode(csv).buffer});
async function intake(a,files){const n=a.node('#import-file');assert.ok(n);return n.onchange({target:{files,value:'selected.csv'}});}
function showImport(a){a.node('[data-page="import"]').click();assert.equal(a.run('page'),'import');}
function set(a,name,value){const f=a.node('#import-config-form'),n=f.elements[name];assert.ok(n,`rendered ${name}`);if(typeof value==='boolean')n.checked=value;else n.value=String(value);n.dispatch('input');n.dispatch('change');}
function configure(a){set(a,'sourceKey','host-source');set(a,'accountId','account-cash');}
function pick(a,line){const b=a.node('[data-import-start-line="'+line+'"]');assert.ok(b,`rendered start ${line}`);b.click();}
function submit(a){a.node('#import-config-form').onsubmit({preventDefault(){}});}

test('review actual host script list and rendered controls select header, require consent, commit once',async()=>{
 const a=host();showImport(a);await intake(a,[file('private.csv',prefix+body)]);assert.equal(a.writes.length,0);pick(a,5);configure(a);submit(a);assert.equal(a.run('importDraft.preview'),null);assert.match(a.node('#import-config-error').textContent,/确认跳过/);set(a,'preambleConfirmed',true);submit(a);assert.deepEqual(a.value('importDraft.preview.rows.map(r=>r.line)'),[6,7]);
 a.node('#import-select-page').click();a.node('#import-commit').click();assert.equal(a.writes.length,1);assert.equal(a.run('state.transactions.length'),1);assert.equal(a.run('state.imports.quarantine[0].line'),7);assert.ok(!a.writes[0][1].includes('PRIVATE_VALUE'));assert.ok(!a.node('#import-config-form'));
});
test('review rendered pagination shows full escaped skipped content and each physical boundary',async()=>{
 const a=host();showImport(a);const intro=Array.from({length:23},(_,i)=>i===22?'PRIVATE_LONG_<img src=x>_'+('z'.repeat(600)):'notice-'+i).join('\n');await intake(a,[file('pages.csv',intro+'\n'+body)]);
 a.node('#import-record-next').click();a.node('#import-record-next').click();const region=a.node('#import-record-review');assert.match(region.textContent,/z{600}/);assert.ok(!region.querySelector('img'));pick(a,24);assert.equal(a.run('importDraft.parsed.headerLine'),24);assert.match(a.node('#import-record-review').textContent,/23 条非空 CSV 记录/);
});
test('review rendered form changes invalidate selections and fresh consent across header/delimiter/start',async()=>{
 for(const [name,value]of [['startLine','6'],['header','false'],['delimiter',';']]){const a=host();showImport(a);await intake(a,[file('a.csv',prefix+body)]);pick(a,5);configure(a);set(a,'preambleConfirmed',true);submit(a);a.node('#import-select-page').click();set(a,name,value);assert.equal(a.run('importDraft.preview'),null);assert.equal(a.run('importDraft.selected.size'),0);assert.equal(a.run('importDraft.preambleConfirmed'),false);assert.equal(a.writes.length,0);}
});
test('review actual per-file queue controls retain isolated starts, require new file consent, stale after commit',async()=>{
 const a=host();showImport(a);await intake(a,[file('a.csv',prefix+body),file('b.csv','other\n'+body.replace(',x,',',z,'))]);pick(a,5);configure(a);set(a,'preambleConfirmed',true);submit(a);a.node('#import-select-page').click();const [first,second]=a.value('importQueue.list().map(i=>i.id)');a.node('[data-intake-open="'+second+'"]').click();await new Promise(resolve=>setImmediate(resolve));assert.equal(a.run('importDraft.preambleConfirmed'),false);pick(a,2);configure(a);set(a,'preambleConfirmed',true);submit(a);a.node('#import-select-page').click();a.node('[data-intake-open="'+first+'"]').click();assert.equal(a.run('importDraft.config.startLine'),5);a.node('#import-commit').click();assert.equal(a.run('importQueue.list()[1].draft.config.startLine'),2);assert.equal(a.run('importQueue.list()[1].draft.preview'),null);assert.equal(a.run('importQueue.list()[1].draft.selected.size'),0);assert.equal(a.writes.length,1);
});

test('review uncommitted input event cannot reuse earlier preamble consent or stale parsed header',async()=>{
 for(const [name,value]of [['startLine','6'],['header','false'],['delimiter',';']]){const a=host();showImport(a);await intake(a,[file('a.csv',prefix+body)]);pick(a,5);configure(a);set(a,'preambleConfirmed',true);submit(a);a.node('#import-select-page').click();const n=a.node('#import-config-form').elements[name];n.value=value;n.dispatch('input');assert.equal(a.run('importDraft.preambleConfirmed'),false);assert.equal(a.node('#import-config-form').elements.preambleConfirmed.checked,false);submit(a);assert.equal(a.run('importDraft.preview'),null);assert.equal(a.writes.length,0);}
});
test('review receipt identity is invariant to prefix line shifts and explicit versus unset first-record start',()=>{
 const c=cfg({columns:{date:0,amount:1,status:2}}),data='date,amount,status\n2026-09-01,1,completed\n2026-09-01,1,completed',p=I.preview(L.createEmpty(),data,c),s=I.commit(L.createEmpty(),p,p.rows.map(r=>r.key));
 for(const [csv,extra]of [[data,{startLine:1}],['intro\n'+data,{startLine:2,preambleConfirmed:true}],['intro\n"multi\nline"\n\n'+data,{startLine:5,preambleConfirmed:true}]]){const q=I.preview(s,csv,{...c,...extra});assert.equal(q.fileFingerprint,p.fileFingerprint);assert.deepEqual(q.rows.map(r=>r.action),['duplicate','duplicate']);}
});
test('review excluding start position does not conflate changed data, record counts, width, headers, mapping or source',()=>{
 const c=cfg({columns:{date:0,amount:1,status:2}}),data='date,amount,status\n2026-09-01,1,completed\n2026-09-01,1,completed',p=I.preview(L.createEmpty(),data,c),s=I.commit(L.createEmpty(),p,p.rows.map(r=>r.key));
 const cases=[
  [data+'\n2026-09-01,1,completed',c],
  [data.replace('\n2026-09-01,1,completed',''),c],
  [data.replace(',1,',',2,'),c],
  [data.replaceAll('completed','pending'),c],
  [data.split('\n').map(x=>x+',extra').join('\n'),c],
  [data.replace('date,amount,status','when,amount,status'),c],
  [data,{...c,sourceKey:'other-source'}],
  ['date,amount,status,other_amount\n2026-09-01,1,completed,1\n2026-09-01,1,completed,1',{...c,columns:{date:0,amount:3,status:2}}]
 ];
 for(const [csv,config]of cases){const q=I.preview(s,'new prefix\n'+csv,{...config,startLine:2,preambleConfirmed:true});assert.ok(q.rows.every(r=>r.action!=='duplicate'),JSON.stringify([csv,config,q.rows.map(r=>r.action)]));assert.ok(q.rows.every(r=>['candidate','new'].includes(r.action)));}
});
test('review duplicate-position receipt only suppresses selected occurrence after line shift',()=>{
 const c=cfg({columns:{date:0,amount:1,status:2}}),data='date,amount,status\n2026-09-01,1,completed\n2026-09-01,1,completed';const p=I.preview(L.createEmpty(),data,c),s=I.commit(L.createEmpty(),p,[p.rows[1].key]);assert.equal(s.transactions.length,1);const q=I.preview(s,'intro\n'+data,{...c,startLine:2,preambleConfirmed:true});assert.deepEqual(q.rows.map(r=>r.action),['candidate','duplicate']);assert.equal(q.rows[0].candidateTransactionCount,1);
});
test('review host template reload clears preamble confirmation and changed header requires explicit review',async()=>{
 const a=host();showImport(a);await intake(a,[file('first.csv',prefix+body)]);pick(a,5);configure(a);set(a,'preambleConfirmed',true);a.node('#save-import-template').click();assert.equal(a.writes.length,1);const id=a.run('state.imports.templates[0].id');assert.equal(a.run('Object.hasOwn(state.imports.templates[0].config,"preambleConfirmed")'),false);
 await intake(a,[file('second.csv',(prefix+body).replace('date,amount,id,status','when,amount,id,status'))]);const next=a.value('importQueue.list().map(x=>x.id)')[1];a.node('[data-intake-open="'+next+'"]').click();await new Promise(resolve=>setImmediate(resolve));a.node('#import-template').value=id;a.node('#load-import-template').click();assert.equal(a.run('importDraft.config.startLine'),5);assert.equal(a.run('importDraft.preambleConfirmed'),false);assert.equal(a.run('importDraft.headerMismatch'),true);set(a,'preambleConfirmed',true);submit(a);assert.equal(a.run('importDraft.preview'),null);a.node('#accept-import-headers').click();submit(a);assert.ok(a.run('importDraft.preview'));assert.equal(a.writes.length,1);
});

test('review new successful and noncompleted evidence persists exact physical line through backup',()=>{
 const csv='private\n"preface\nmultiline"\n\ndate,amount,id,status,unmapped\n2026-09-01,1,good,completed,"unmapped\nsecret"\n\n2026-09-02,2,waiting,pending,secret2\n2026-09-03,3,closed,cancelled,secret3';
 const p=I.preview(L.createEmpty(),csv,pcfg());assert.deepEqual(p.rows.map(r=>r.line),[6,9,10]);const s=I.commit(L.createEmpty(),p,p.rows.map(r=>r.key)),restored=L.parseBackup(L.backup(s));assert.equal(restored.transactions.length,1);assert.deepEqual(restored.imports.evidence.map(e=>e.sourceLine),[6,9,10]);assert.deepEqual(restored.imports.batches[0].changes.map(c=>c.after.sourceLine),[6,9,10]);assert.ok(restored.imports.evidence.every(e=>!('line'in e)));assert.ok(!JSON.stringify(restored).includes('secret'));
});
test('review stable-ID updates preserve earlier source locator and rollback restores it exactly',()=>{
 const first=I.preview(L.createEmpty(),prefix+body,pcfg()),s=I.commit(L.createEmpty(),first,[first.rows[0].key]);assert.equal(s.imports.evidence[0].sourceLine,6);
 const revised='extra\n'+prefix+body.replace(',1.00,x',',4.00,x'),p=I.preview(s,revised,pcfg({startLine:6})),next=I.commit(s,p,[p.rows[0].key]);assert.equal(next.imports.evidence[0].sourceLine,7);const change=next.imports.batches[1].changes[0];assert.equal(change.before.sourceLine,6);assert.equal(change.after.sourceLine,7);assert.equal(L.parseBackup(L.backup(next)).imports.evidence[0].sourceLine,7);
 const back=I.rollback(next,next.imports.batches[1].id);assert.equal(back.rolledBack,true);assert.equal(back.state.imports.evidence[0].sourceLine,6);assert.equal(back.state.imports.batches[1].changes[0].after.sourceLine,7);assert.doesNotThrow(()=>L.parseBackup(L.backup(back.state)));
});
test('review cancellation and resumed completion move sourceLine but preserve status and historical locations',()=>{
 const make=(status,pad)=>'prefix\n'.repeat(pad)+'date,amount,id,status\n2026-09-01,1,id,'+status;let state=L.createEmpty();
 for(const [status,pad,expectedCount]of [['completed',1,1],['pending',3,0],['cancelled',4,0],['completed',6,1]]){const p=I.preview(state,make(status,pad),cfg({startLine:pad+1,preambleConfirmed:true}));state=I.commit(state,p,[p.rows[0].key]);assert.equal(state.imports.evidence[0].sourceLine,pad+2);assert.equal(state.transactions.length,expectedCount);assert.equal(state.imports.evidence[0].status,status);assert.doesNotThrow(()=>L.parseBackup(L.backup(state)));}
 assert.deepEqual(state.imports.batches.map(b=>b.changes[0].after.sourceLine),[3,5,6,8]);assert.deepEqual(state.imports.batches.map(b=>b.changes[0].before?.sourceLine??null),[null,3,5,6]);
});
test('review repaired evidence gets original physical quarantine line rather than synthetic CSV row',()=>{
 const p=I.preview(L.createEmpty(),prefix+body,pcfg()),s=I.commit(L.createEmpty(),p,[p.rows[0].key]),q=s.imports.quarantine[0],repair=I.previewRepair(s,q.id,{date:'2026-09-02'}),next=I.commit(s,repair,[repair.rows[0].key]);assert.equal(q.line,7);assert.equal(next.imports.evidence.find(e=>e.stableId==='y').sourceLine,7);assert.equal(next.imports.batches[1].changes[0].after.sourceLine,7);assert.equal(L.parseBackup(L.backup(next)).imports.evidence.find(e=>e.stableId==='y').sourceLine,7);const back=I.rollback(next,next.imports.batches[1].id);assert.equal(back.rolledBack,true);assert.equal(back.state.imports.quarantine[0].resolvedByBatchId,null);
});
test('review old evidence migration leaves sourceLine absent, update learns it, rollback restores unknown',()=>{
 const old=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/imports-v1-frozen-v08.json'),'utf8')),state=L.validateState(old);assert.ok(state.imports.evidence.every(e=>!Object.hasOwn(e,'sourceLine')));assert.ok(state.imports.batches.every(b=>b.changes.every(c=>!Object.hasOwn(c.after,'sourceLine')&&(!c.before||!Object.hasOwn(c.before,'sourceLine')))));
 const csv='intro\ndate,amount,id,status\n2026-09-01,8.00,first,completed',p=I.preview(state,csv,cfg({sourceKey:'frozen-v08-source',startLine:2,preambleConfirmed:true})),next=I.commit(state,p,[p.rows[0].key]);assert.equal(next.imports.evidence.find(e=>e.stableId==='first').sourceLine,3);assert.equal(Object.hasOwn(next.imports.batches.at(-1).changes[0].before,'sourceLine'),false);const back=I.rollback(next,next.imports.batches.at(-1).id);assert.equal(back.rolledBack,true);assert.equal(Object.hasOwn(back.state.imports.evidence.find(e=>e.stableId==='first'),'sourceLine'),false);
});
test('review sourceLine rejects invalid bounded types and cannot be hidden in v1 current or historical evidence',()=>{
 const old=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/imports-v1-frozen-v08.json'),'utf8'));
 const locators=s=>[s.imports.evidence[0],s.imports.batches[0].changes[0].after,s.imports.batches.find(b=>b.changes.some(c=>c.before)).changes.find(c=>c.before).before];
 for(let where=0;where<3;where++){const s=copy(old);locators(s)[where].sourceLine=3;assert.throws(()=>L.validateState(s),code('INVALID_IMPORT_VERSION'));}
 for(const value of [0,-1,1.2,'3',null,NaN,Infinity,I.LIMITS.bytes+1]){const s=L.validateState(copy(old));locators(s)[0].sourceLine=value;assert.throws(()=>L.validateState(s));}
});

test('review user-visible transaction details expose latest source physical line through real navigation',async()=>{
 const a=host();showImport(a);await intake(a,[file('a.csv',prefix+body)]);pick(a,5);configure(a);set(a,'preambleConfirmed',true);submit(a);a.node('#import-select-page').click();a.node('#import-commit').click();a.node('[data-page="ledger"]').click();const month=a.node('#month');month.value='2026-09';month.dispatch('change');a.node('[data-tx]').click();const modal=a.node('#modal-root');assert.ok(modal.querySelector('#entry-form'));assert.match(modal.textContent,/最近确认的来源物理行/);assert.match(modal.textContent,/第 6 行/);assert.match(modal.textContent,/重复预览不会改写原证据/);
});
test('review restored legacy transaction details explicitly show unknown physical row',()=>{
 const old=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/imports-v1-frozen-v08.json'),'utf8')),a=host([[L.STORAGE_KEY,JSON.stringify(old)]]);a.node('[data-page="ledger"]').click();const month=a.node('#month');month.value='2026-09';month.dispatch('change');a.node('[data-tx]').click();assert.match(a.node('#modal-root').textContent,/旧记录未保存，未知/);assert.equal(a.writes.length,0);
});
