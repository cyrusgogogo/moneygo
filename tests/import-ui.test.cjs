'use strict';
const {readEntryManifest,applyBodyAttributes,addListener,removeListener}=require('./entry-manifest.cjs');
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const L=require('../dist/ledger.js');
const {memoryStorage}=require('./ui.test.cjs');

// A minimal DOM substitute verifies event wiring, generated markup and transaction
// guards. It does not claim browser layout, native file dialog or accessibility QA.
function loadImportApp(storage=memoryStorage()) {
 const nodes=new Map(),documentListeners=new Map(),windowListeners=new Map();
 const document={body:{style:{},append(){}},activeElement:null,addEventListener(type,cb){addListener(documentListeners,type,cb);},removeEventListener(type,cb){removeListener(documentListeners,type,cb);},createElement(){return {click(){},remove(){}};}};
 function node(selector){if(!nodes.has(selector))nodes.set(selector,{innerHTML:'',textContent:'',value:'',disabled:false,checked:false,hidden:false,isConnected:true,dataset:{},style:{},elements:{},classList:{add(){},remove(){}},focus(){document.activeElement=this;},addEventListener(){},setSelectionRange(){},querySelectorAll(){return [];},closest(){return null;}});return nodes.get(selector);}
 document.querySelectorAll=()=>[...nodes.values()];
 document.querySelector=selector=>selector==='.modal'&&!node('#modal-root').innerHTML?null:selector==='#entry-form'&&!node('#modal-root').innerHTML.includes('id="entry-form"')?null:node(selector);
 const window={document,localStorage:storage,confirm(){return true;},scrollTo(){},addEventListener(type,cb){addListener(windowListeners,type,cb);},removeEventListener(type,cb){removeListener(windowListeners,type,cb);}};
 const context=vm.createContext({document,window,console,TextDecoder,TextEncoder,Blob,URL:{createObjectURL(){return 'blob:test';},revokeObjectURL(){}},setTimeout(){return 1;},clearTimeout(){}});
 const entry=readEntryManifest();applyBodyAttributes(document.body,entry);
 for(const file of entry.scripts)vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist',file),'utf8'),context,{filename:file});
 return {node,storage,documentListeners,windowListeners,run(code){return vm.runInContext(code,context);},value(code){return JSON.parse(vm.runInContext('JSON.stringify('+code+')',context));},put(key,value){context[key]=value;}};
}
function configure(app,text,extra={}) {
 app.put('testCSV',text);app.put('testConfig',extra);
 app.run("page='import'; importDraft=freshImportDraft();importDraft.text=testCSV;importDraft.config.sourceKey='source-test';Object.assign(importDraft.config,testConfig);inspectImportText(true);importDraft.statusCompletedConfirmed=true;render()");
}
function preview(app,text,extra={}){configure(app,text,extra);app.run('makeImportPreview()');}
const csv='date,amount,direction,note,id,status\n2026-09-01,12.50,expense,Coffee,stable-1,completed\n2026-09-02,20.00,expense,Pending,stable-2,pending';

module.exports={loadImportApp};

test('real import navigation and source-local disclosure exist with correct script order',()=>{
 const app=loadImportApp();app.run("page='import';render()");const html=app.node('#app').innerHTML;
 assert.match(html,/账单导入/);assert.match(html,/不承诺.*官方格式兼容/);assert.match(html,/accept="\.csv,\.tsv/);assert.match(html,/下载合成 CSV 样例/);assert.equal(app.storage.writes.length,0);
 const index=fs.readFileSync(path.join(__dirname,'../dist/index.html'),'utf8');assert.ok(index.indexOf('importer.js')<index.indexOf('app-runtime-v1.js'));
});

test('UTF-8 decode is strict; BOM preserved for inspection and explicit UTF-16 works',()=>{
 const app=loadImportApp();app.put('bytes',Uint8Array.from([0xc3,0x28]));assert.throws(()=>app.run("decodeImportBytes(bytes,'utf-8')"),/有效的 UTF-8/);
 app.put('bytes',new TextEncoder().encode('\ufeffdate,amount\n2026-09-01,1.00'));assert.equal(app.run("decodeImportBytes(bytes,'utf-8').charCodeAt(0)"),0xfeff);
 app.put('bytes',Uint8Array.from([0xff,0xfe,0x41,0]));assert.equal(app.run("decodeImportBytes(bytes,'utf-16le')"),'\ufeffA');
});

test('file inspection is local, mapping is provisional and source identity stays explicit',async()=>{
 const app=loadImportApp();app.run("page='import'");app.put('file',{name:'my-statement.csv',size:csv.length,arrayBuffer:async()=>new TextEncoder().encode(csv).buffer});await app.run('readImportFile(file)');
 assert.equal(app.run('importDraft.config.sourceKey'),'');assert.equal(app.run('importDraft.parsed.rows.length'),2);assert.equal(app.run('importDraft.config.columns.amount'),1);assert.equal(app.storage.writes.length,0);assert.match(app.node('#app').innerHTML,/按用户所选 UTF-8 解码成功/);
});

test('latest file selection wins when earlier arrayBuffer resolves later',async()=>{
 const app=loadImportApp();app.run("page='import'");let finish;const first=new Promise(resolve=>finish=resolve);
 app.put('first',{name:'first.csv',size:1,arrayBuffer:()=>first});const pending=app.run('readImportFile(first)');
 app.put('second',{name:'second.csv',size:csv.length,arrayBuffer:async()=>new TextEncoder().encode(csv).buffer});await app.run('readImportFile(second)');finish(new TextEncoder().encode('old,header\n1,2').buffer);await pending;
 assert.equal(app.run('importDraft.fileName'),'second.csv');assert.equal(app.run('importDraft.parsed.rows.length'),2);
});

test('navigation and reset cancel an outstanding file read without writing',async()=>{
 const app=loadImportApp();app.run("page='import'");let finish;app.put('file',{name:'read.csv',size:1,arrayBuffer:()=>new Promise(resolve=>finish=resolve)});const pending=app.run('readImportFile(file)');app.run("cancelImportRead();page='report';render()");finish(new TextEncoder().encode(csv).buffer);await pending;
 assert.equal(app.run('importDraft.text'),'');assert.equal(app.storage.writes.length,0);assert.match(app.node('#app').innerHTML,/这是你的账本/);
});

test('invalid extension, oversized file, malformed decode never produce a preview',async()=>{
 const app=loadImportApp();app.run("page='import'");let reads=0;app.put('file',{name:'workbook.xlsx',size:1,arrayBuffer:async()=>{reads++;return new ArrayBuffer(0);}});await app.run('readImportFile(file)');assert.equal(reads,0);assert.match(app.run('importDraft.error'),/csv/);
 app.put('file',{name:'large.csv',size:9*1024*1024,arrayBuffer:async()=>{reads++;return new ArrayBuffer(0);}});await app.run('readImportFile(file)');assert.equal(reads,0);assert.match(app.run('importDraft.error'),/8 MB/);
 app.put('file',{name:'broken.csv',size:2,arrayBuffer:async()=>Uint8Array.from([0xc3,0x28]).buffer});await app.run('readImportFile(file)');assert.equal(app.run('importDraft.preview'),null);assert.match(app.run('importDraft.error'),/UTF-8/);assert.equal(app.storage.writes.length,0);
});

test('unmapped status requires explicit completion confirmation and custom maps reject ambiguity',()=>{
 const app=loadImportApp();configure(app,'date,amount\n2026-09-01,1.00');app.run('importDraft.statusCompletedConfirmed=false');assert.throws(()=>app.run('effectiveImportConfig()'),/确认/);
 app.run('importDraft.statusCompletedConfirmed=true');assert.equal(app.value('effectiveImportConfig().columns').status,undefined);
 assert.throws(()=>app.run("parseImportMap('X = expense\\nX = income',['income','expense'],'方向')"),/重复/);
 assert.throws(()=>app.run("parseImportMap('X = refunded',['completed','pending','cancelled'],'状态')"),/无效/);
});

test('preview starts with every row unchecked and bulk selection excludes candidates',()=>{
 const app=loadImportApp();preview(app,'date,amount,note,status\n2026-09-01,5.00,A,completed\n2026-09-01,5.00,B,completed');
 assert.deepEqual(app.value('importDraft.preview.rows.map(r=>r.action)'),['new','candidate']);assert.equal(app.run('importDraft.selected.size'),0);
 assert.match(app.node('#app').innerHTML,/确认是独立交易，新增/);assert.doesNotMatch(app.run('importPreviewMarkup()'),/data-import-select="[^"]+" checked/);
 app.node('#import-select-page').onclick();assert.equal(app.run('importDraft.selected.size'),1);assert.equal(app.run('importDraft.selected.has(importDraft.preview.rows[1].key)'),false);
 const key=app.run('importDraft.preview.rows[1].key');app.node('#import-preview-region').onchange({target:{dataset:{importSelect:key},checked:true}});assert.equal(app.run('importDraft.selected.size'),2);
});

test('preview pagination retains row selection without selecting other pages',()=>{
 const app=loadImportApp();const text='date,amount,id,status\n'+Array.from({length:45},(_,i)=>`2026-09-01,${i+1}.00,id-${i},completed`).join('\n');preview(app,text);
 assert.equal((app.run('importPreviewMarkup()').match(/data-import-select=/g)||[]).length,40);app.node('#import-select-page').onclick();assert.equal(app.run('importDraft.selected.size'),40);app.node('#import-next').onclick();assert.equal(app.run('importDraft.offset'),40);assert.equal((app.run('importPreviewMarkup()').match(/data-import-select=/g)||[]).length,5);app.node('#import-prev').onclick();assert.equal(app.run('importDraft.selected.size'),40);
});

test('selected-only monetary effect excludes unselected and pending rows',()=>{
 const app=loadImportApp();preview(app,csv);assert.match(app.run('selectedImportImpact()'),/支出 ¥0.00/);app.run('importDraft.selected.add(importDraft.preview.rows[1].key)');assert.match(app.run('selectedImportImpact()'),/支出 ¥0.00/);app.run('importDraft.selected.add(importDraft.preview.rows[0].key)');assert.match(app.run('selectedImportImpact()'),/支出 ¥12.50/);
});

test('commit writes once, retains pending evidence, and double clicks do not import twice',()=>{
 const app=loadImportApp();preview(app,csv);app.run('importDraft.preview.rows.forEach(r=>importDraft.selected.add(r.key))');assert.equal(app.run('commitImportSelection()'),true);assert.equal(app.value('state.transactions.length'),1);assert.equal(app.value('state.imports.evidence.length'),2);assert.equal(app.storage.writes.length,1);assert.equal(app.run('commitImportSelection()'),false);assert.equal(app.storage.writes.length,1);assert.equal(app.run('importBusy'),false);assert.doesNotMatch(app.node('#app').innerHTML,/id="import-file"[^>]*disabled/);
});

test('failed storage commit preserves current ledger and review for safe retry',()=>{
 const app=loadImportApp();preview(app,csv);app.run('importDraft.selected.add(importDraft.preview.rows[0].key)');app.storage.failSet=()=>true;
 assert.equal(app.run('commitImportSelection()'),false);assert.equal(app.run('state.transactions.length'),0);assert.equal(app.run('importDraft.selected.size'),1);assert.match(app.node('#import-commit-error').textContent,/保存失败/);
 app.storage.failSet=null;assert.equal(app.run('commitImportSelection()'),true);assert.equal(app.run('state.transactions.length'),1);
});

test('cross-tab changes refuse selected commit and preserve the other tab data',()=>{
 const app=loadImportApp();preview(app,csv);app.run('importDraft.selected.add(importDraft.preview.rows[0].key)');const other=L.putAccount(L.createEmpty(),{name:'Other',openingBalanceCents:0},'account-cash');app.storage.setItem(L.STORAGE_KEY,JSON.stringify(other));assert.equal(app.run('commitImportSelection()'),false);assert.equal(app.run('state.transactions.length'),0);assert.deepEqual(JSON.parse(app.storage.getItem(L.STORAGE_KEY)),other);assert.match(app.node('#import-commit-error').textContent,/另一个页面/);
});

test('template reuse blocks changed headers until explicit confirmation and versions mappings',()=>{
 const app=loadImportApp();configure(app,csv);app.run('saveImportTemplate()');assert.equal(app.run('state.transactions.length'),0);assert.equal(app.run('state.imports.templates.length'),1);const id=app.run('state.imports.templates[0].id');
 app.put('newCSV',csv.replace('date,amount','when,amount'));app.put('templateId',id);app.run('importDraft.text=newCSV;loadImportTemplate(templateId)');assert.equal(app.run('importDraft.headerMismatch'),true);assert.match(app.node('#app').innerHTML,/表头与模板不同/);assert.throws(()=>app.run('makeImportPreview()'),/表头/);
 app.run('importDraft.config.expectedHeaders=currentImportHeaders();importDraft.headerMismatch=false;makeImportPreview()');assert.equal(app.run('importDraft.preview.rows.length'),2);app.run('saveImportTemplate()');assert.equal(app.run('state.imports.templates.length'),2);
});

test('headerless numeric mapping preserves first row and saved synthetic header contract',()=>{
 const app=loadImportApp();configure(app,'2026-09-01,1.00\n2026-09-02,2.00',{header:false});app.run('importDraft.config.columns={date:0,amount:1};makeImportPreview()');assert.equal(app.run('importDraft.preview.rows.length'),2);assert.deepEqual(app.value('currentImportHeaders()'),['第1列','第2列']);app.run('saveImportTemplate()');assert.deepEqual(app.value('state.imports.templates[0].headers'),['第1列','第2列']);
});

test('coverage is absent unless explicitly confirmed with both valid dates',()=>{
 const app=loadImportApp();configure(app,csv);assert.equal(app.run('effectiveImportConfig().coverage'),undefined);app.run('importDraft.coverageConfirmed=true');assert.throws(()=>app.run('effectiveImportConfig()'),/开始和结束/);app.run("importDraft.coverageStart='2026-09-01';importDraft.coverageEnd='2026-09-30';makeImportPreview();commitImportSelection(true)");assert.equal(app.run('state.imports.coverage.length'),1);assert.equal(app.run('state.transactions.length'),0);assert.equal(app.run('Boolean(state.simulation)'),false);
});

test('quarantine retains safe mapped fields and local provenance is escaped',()=>{
 const app=loadImportApp();const attack='<img src=x onerror=alert(1)>';preview(app,'date,amount,note,id,status,secret\n2026-09-01,1.00,"'+attack+'",ok-1,completed,never-store-me\nnot-a-date,2.00,B,bad-1,completed,never-store-me');app.run('importDraft.selected.add(importDraft.preview.rows[0].key);commitImportSelection()');assert.equal(app.run('state.imports.quarantine.length'),1);assert.ok(!app.storage.getItem(L.STORAGE_KEY).includes('never-store-me'));assert.ok(!app.run('importProvenance(state.transactions[0].id)').includes(attack));assert.match(app.run('importProvenance(state.transactions[0].id)'),/&lt;img/);app.run('showImportBatch(state.imports.batches[0].id)');assert.match(app.node('#import-quarantine-list').innerHTML,/修正已映射字段/);
});

test('safe rollback reports post-import edit conflicts without overwriting edits',()=>{
 const app=loadImportApp();preview(app,csv);app.run('importDraft.selected.add(importDraft.preview.rows[0].key);commitImportSelection();persist(L.putTransaction(state,{...state.transactions[0],note:"manual edit"},state.transactions[0].id));confirmImportRollback(state.imports.batches[0].id)');const writes=app.storage.writes.length;app.node('#confirm-import-rollback').onclick();assert.equal(app.storage.writes.length,writes);assert.equal(app.run('state.transactions[0].note'),'manual edit');assert.match(app.node('#modal-root').innerHTML,/回滚遇到冲突/);
});

test('isolated backup verification validates imports with no financial writes',async()=>{
 const app=loadImportApp();preview(app,csv);app.run('importDraft.selected.add(importDraft.preview.rows[0].key);commitImportSelection()');
 const backup=app.run('L.backup(state)'),before=app.storage.getItem(L.STORAGE_KEY),rollbackKey='moneygo.ledger.beforeRestore.v1',beforeRollback=app.storage.getItem(rollbackKey),writes=app.storage.writes.length,financialWrites=app.storage.writes.filter(([key])=>key===L.STORAGE_KEY||key===rollbackKey);
 app.run('verifyBackupFile()');await app.node('#verify-backup-file').onchange({target:{files:[{size:backup.length,text:async()=>backup}]}});
 assert.match(app.node('#verify-backup-result').innerHTML,/备份验证通过/);assert.equal(app.storage.getItem(L.STORAGE_KEY),before);assert.equal(app.storage.getItem(rollbackKey),beforeRollback);assert.deepEqual(app.storage.writes.filter(([key])=>key===L.STORAGE_KEY||key===rollbackKey),financialWrites);
 const noteKey=require('../dist/backup-safety.js').NOTE_KEY;assert.equal(app.storage.writes.length,writes+1);assert.deepEqual(app.storage.writes.slice(writes).map(([key])=>key),[noteKey]);const noteRaw=app.storage.getItem(noteKey),note=JSON.parse(noteRaw);assert.ok(noteRaw.length<=512);assert.deepEqual(Object.keys(note).sort(),['backupVersion','completedAt','kind','verifierRevision','version']);assert.equal(note.kind,'moneygo-backup-verification-note');assert.equal(note.version,1);assert.equal(note.verifierRevision,1);assert.equal(note.backupVersion,app.run('state.version'));assert.equal(new Date(note.completedAt).toISOString(),note.completedAt);
});

test('legacy single-file helper cancels stale decoding when its matching encoding handler changes',async()=>{
 const app=loadImportApp();app.run("page='import';render()");let finish;app.put('file',{name:'waiting.csv',size:1,arrayBuffer:()=>new Promise(resolve=>finish=resolve)});const pending=app.run('readImportFile(file)');app.run('bindImportPage()');app.node('#import-encoding').onchange({target:{value:'utf-16le'}});finish(new TextEncoder().encode(csv).buffer);await pending;
 assert.equal(app.run('importDraft.text'),'');assert.equal(app.run('importDraft.encoding'),'utf-16le');assert.match(app.run('importDraft.error'),/重新选择/);
});

test('unselected candidates are retained and a repaired row needs a new explicit selection',()=>{
 const app=loadImportApp();preview(app,'date,amount,note,status\n2026-09-01,5.00,A,completed\n2026-09-01,5.00,B,completed');app.run('importDraft.selected.add(importDraft.preview.rows[0].key);commitImportSelection()');assert.equal(app.run('state.imports.quarantine.length'),1);
 app.run('repairImportRow(state.imports.quarantine[0].id)');const form=app.node('#entry-form');form.elements={date:{value:'2026-09-01'},amount:{value:'5.00'},note:{value:'B'},status:{value:'completed'}};form.onsubmit({preventDefault(){}});
 assert.equal(app.run('importDraft.selected.size'),0);assert.equal(app.run('importDraft.preview.rows[0].action'),'candidate');assert.equal(app.run('commitImportSelection(true)'),false);assert.doesNotMatch(app.run('importPreviewMarkup()'),/id="import-save-pending"/);
 app.run('importDraft.selected.add(importDraft.preview.rows[0].key)');assert.equal(app.run('commitImportSelection()'),true);assert.equal(app.run('state.transactions.length'),2);assert.equal(app.run('Boolean(state.imports.quarantine[0].resolvedByBatchId)'),true);
});

test('repair form exposes only originally mapped fields, and repairs an invalid date',()=>{
 const app=loadImportApp();preview(app,'date,amount\ninvalid,3.00');app.run('commitImportSelection(true);repairImportRow(state.imports.quarantine[0].id)');assert.doesNotMatch(app.node('#modal-root').innerHTML,/name="direction"/);assert.doesNotMatch(app.node('#modal-root').innerHTML,/name="status"/);
 const form=app.node('#entry-form');form.elements={date:{value:'2026-09-03'},amount:{value:'3.00'}};form.onsubmit({preventDefault(){}});assert.equal(app.run('importDraft.preview.rows[0].action'),'new');app.run('importDraft.selected.add(importDraft.preview.rows[0].key);commitImportSelection()');assert.equal(app.run('state.transactions.length'),1);assert.equal(app.run('state.transactions[0].date'),'2026-09-03');
});

test('all batch history remains accessible through bounded pagination',()=>{
 const app=loadImportApp();app.run("page='import';for(let i=0;i<32;i++){const text='date,amount,id,status\\n2026-09-01,1.00,history-'+i+',completed';const p=I.preview(state,text,{sourceKey:'history-'+i,accountId:'account-cash',delimiter:',',columns:{date:0,amount:1,stableId:2,status:3},defaultType:'expense'});state=I.commit(state,p,[]);}render()");
 assert.equal((app.node('#app').innerHTML.match(/data-import-batch=/g)||[]).length,30);assert.ok(!app.node('#app').innerHTML.includes('>history-0</strong>'));app.node('#import-history-next').onclick();assert.equal(app.run('importHistoryOffset'),30);assert.match(app.node('#app').innerHTML,/>history-0<\/strong>/);assert.equal((app.node('#app').innerHTML.match(/data-import-batch=/g)||[]).length,2);app.node('#import-history-prev').onclick();assert.equal(app.run('importHistoryOffset'),0);
});

test('pipe separator is selectable and quoted valid CSV ignores irrelevant delimiter errors',()=>{
 const app=loadImportApp();configure(app,'date|amount|status\n2026-09-01|1.00|completed',{delimiter:'|'});assert.match(app.run('importConfigForm()'),/value="\|" selected/);app.run('makeImportPreview()');assert.equal(app.run('importDraft.preview.rows[0].action'),'new');configure(app,'date,amount,note,status\n2026-09-01,1.00,"Quoted, note",completed');assert.doesNotMatch(app.run('importInspection()'),/引号后只能/);
});

test('mapping change invalidates an already generated preview instead of reusing old decisions',()=>{
 const app=loadImportApp();preview(app,csv);app.run('importDraft.selected.add(importDraft.preview.rows[0].key);invalidateImportPreview()');assert.equal(app.run('importDraft.preview'),null);assert.equal(app.run('importDraft.selected.size'),0);assert.equal(app.run('commitImportSelection()'),false);assert.match(app.node('#import-preview-region').innerHTML,/重新生成预览/);
});

test('successful safe rollback removes only the import and retains the audit record',()=>{
 const app=loadImportApp();preview(app,csv);app.run('importDraft.selected.add(importDraft.preview.rows[0].key);commitImportSelection();confirmImportRollback(state.imports.batches[0].id)');const handler=app.node('#confirm-import-rollback').onclick;handler();assert.equal(app.run('state.transactions.length'),0);assert.equal(app.run('state.imports.batches[0].rolledBack'),true);const writes=app.storage.writes.length;handler();assert.equal(app.storage.writes.length,writes);
});

test('new file never inherits completion or coverage confirmation from the prior file',async()=>{
 const app=loadImportApp();configure(app,csv);app.run("importDraft.coverageConfirmed=true;importDraft.coverageStart='2026-09-01';importDraft.coverageEnd='2026-09-30'");app.put('file',{name:'another.csv',size:csv.length,arrayBuffer:async()=>new TextEncoder().encode(csv).buffer});await app.run('readImportFile(file)');assert.equal(app.run('importDraft.coverageConfirmed'),false);assert.equal(app.run('importDraft.statusCompletedConfirmed'),false);assert.equal(app.run('effectiveImportConfig().coverage'),undefined);
});
