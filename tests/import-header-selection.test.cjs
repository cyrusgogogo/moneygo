'use strict';
const {readEntryManifest,applyBodyAttributes,addListener,removeListener}=require('./entry-manifest.cjs');
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const L = require('../dist/ledger.js'), I = require('../dist/importer.js');
const config = extra => ({ sourceKey: 'user-declared-source', accountId: 'account-cash', delimiter: ',', columns: { date: 0, amount: 1, stableId: 2, status: 3 }, defaultType: 'expense', ...extra });
const plain = 'date,amount,id,status\n2026-09-01,1.00,stable-1,completed';
const prefixed = 'Private preamble,do-not-persist\r\n"Two physical\r\nlines",private-meta\r\n\r\ndate,amount,id,status\r\n2026-09-01,1.00,stable-1,completed\r\ninvalid,2.00,bad-1,completed';
const parse = (csv = prefixed, extra = {}) => I.parseCSV(csv, { delimiter: ',', startLine: 5, ...extra });
const preview = (state = L.createEmpty(), csv = prefixed, extra = {}) => I.preview(state, csv, config({ startLine: 5, preambleConfirmed: true, ...extra }));
const code = wanted => error => error.code === wanted;

test('physical start selection preserves all records, multiline boundaries, CRLF and blank lines', () => {
 const p = parse(); assert.deepEqual(p.records.map(r => r.line), [1, 2, 5, 6, 7]); assert.deepEqual(p.skippedRecords.map(r => r.line), [1, 2]);
 assert.equal(p.skippedPhysicalLines, 4); assert.equal(p.blankLines, 1); assert.equal(p.headerLine, 5); assert.deepEqual(p.rows.map(r => r.line), [6, 7]);
 assert.equal(p.skippedRecords[1].fields[0], 'Two physical\r\nlines'); assert.deepEqual(p.headers, ['date', 'amount', 'id', 'status']);
 for (const newline of ['\n', '\r', '\r\n']) { const q = parse(prefixed.replaceAll('\r\n', newline)); assert.deepEqual(q.records.map(r => r.line), [1, 2, 5, 6, 7]); }
});
test('start must be an explicit safe integer at a parsed record boundary, never blank or inside quotes', () => {
 for (const line of [0, -1, 1.5, '5', null, NaN, Infinity, I.LIMITS.bytes + 1, 3, 4, 8, 999]) assert.throws(() => parse(prefixed, { startLine: line }), code('INVALID_START_LINE'));
 assert.throws(() => parse('', { startLine: 1 }), code('INVALID_START_LINE')); assert.equal(parse(prefixed, { startLine: 1 }).headerLine, 1);
 assert.throws(() => parse('broken"intro\ndate,amount\n2026-09-01,1.00', { startLine: 2 }), code('CSV_QUOTE'));
 assert.throws(() => parse('intro\n"unterminated', { startLine: 2 }), code('CSV_QUOTE'));
});
test('legacy leading blank rows and unset start retain first-nonblank default exactly', () => {
 const csv = '\n\r\n' + plain, p = I.parseCSV(csv); assert.equal(p.headerLine, 3); assert.equal(p.rows[0].line, 4); assert.equal(p.skippedPhysicalLines, 0);
 const a = I.preview(L.createEmpty(), plain, config()), b = I.preview(L.createEmpty(), csv, config()); assert.equal(a.fileFingerprint, b.fileFingerprint); assert.deepEqual(a.config, b.config); assert.equal(Object.hasOwn(a.config, 'startLine'), false);
 assert.throws(() => I.preview(L.createEmpty(), csv, config({ startLine: 3 })), code('PREAMBLE_CONFIRMATION_REQUIRED'));
});
test('preamble skip requires exact fresh true confirmation but confirmation and raw preamble never persist', () => {
 for (const confirmed of [undefined, false, 1, 'true']) assert.throws(() => preview(L.createEmpty(), prefixed, { preambleConfirmed: confirmed }), code('PREAMBLE_CONFIRMATION_REQUIRED'));
 const p = preview(); assert.deepEqual(p.selection, { headerLine: 5, dataLine: 6, skippedRecordCount: 2, skippedPhysicalLines: 4 });
 assert.deepEqual(p.rows.map(r => [r.line, r.action]), [[6, 'new'], [7, 'invalid']]); assert.equal(p.config.startLine, 5); assert.equal(Object.hasOwn(p.config, 'preambleConfirmed'), false);
 const s = I.commit(L.createEmpty(), p, [p.rows[0].key]); assert.equal(s.imports.quarantine[0].line, 7); assert.equal(s.imports.templates[0].config.startLine, 5);
 for (const secret of ['Private preamble', 'do-not-persist', 'private-meta', 'Two physical', 'preambleConfirmed', 'skippedRecords']) assert.equal(JSON.stringify(s).includes(secret), false);
 assert.deepEqual(L.parseBackup(L.backup(s)), s); assert.equal(s.imports.evidence[0].sourceKey, 'user-declared-source'); assert.equal(s.imports.evidence[0].stableId, 'stable-1');
});
test('headerless start includes its first data row and preserves synthetic template headers', () => {
 const csv = 'Intro\n2026-09-01,1.00,a,completed\n2026-09-02,2.00,b,completed';
 const p = I.preview(L.createEmpty(), csv, config({ startLine: 2, header: false, preambleConfirmed: true })); assert.deepEqual(p.rows.map(r => r.line), [2, 3]); assert.deepEqual(p.headers, ['第1列', '第2列', '第3列', '第4列']);
 const s = I.commit(L.createEmpty(), p, p.rows.map(r => r.key)); assert.equal(s.transactions.length, 2); assert.equal(s.imports.templates[0].config.header, false); assert.equal(s.imports.templates[0].config.startLine, 2);
});
test('same selection keeps id-less receipt idempotence, while stable IDs keep later source changes connected', () => {
 const withoutId = config({ columns: { date: 0, amount: 1, status: 3 }, startLine: 2, preambleConfirmed: true }), csv = 'Notice\n' + plain;
 const p = I.preview(L.createEmpty(), csv, withoutId), s = I.commit(L.createEmpty(), p, [p.rows[0].key]), q = I.preview(s, csv, withoutId); assert.equal(q.fileFingerprint, p.fileFingerprint); assert.equal(q.rows[0].action, 'duplicate');
 const first = preview(), stored = I.commit(L.createEmpty(), first, [first.rows[0].key]), later = preview(stored, prefixed.replace('1.00,stable-1', '3.00,stable-1')); assert.equal(later.rows[0].action, 'update'); assert.equal(later.rows[0].previousEvidence.stableId, 'stable-1');
});
test('templates persist optional start and reject malformed values without rewriting genuine legacy config', () => {
 const legacy = I.saveTemplate(L.createEmpty(), { headers: ['date','amount','id','status'], config: config() }); const saved = JSON.parse(JSON.stringify(legacy));
 assert.deepEqual(L.parseBackup(L.backup(legacy)), saved); assert.equal(Object.hasOwn(legacy.imports.templates[0].config, 'startLine'), false);
 const configured = I.saveTemplate(legacy, { headers: ['date','amount','id','status'], config: config({ startLine: 5 }) }); assert.equal(configured.imports.templates.length, 2); assert.deepEqual(configured.imports.templates[0], saved.imports.templates[0]); assert.equal(configured.imports.templates[1].config.startLine, 5);
 for (const bad of [0, -1, 1.25, '5', null, I.LIMITS.bytes + 1]) { const s = JSON.parse(JSON.stringify(configured)); s.imports.templates[1].config.startLine = bad; assert.throws(() => L.validateState(s), code('INVALID_START_LINE')); }
 assert.throws(() => preview(L.createEmpty(), prefixed.replace('date,amount,id,status', 'when,amount,id,status'), { expectedHeaders: ['date','amount','id','status'] }), code('TEMPLATE_HEADERS_CHANGED'));
});
test('quarantine repairs use original source line and ignore original file start only for synthesized repair CSV', () => {
 const p = preview(), s = I.commit(L.createEmpty(), p, [p.rows[0].key]), q = s.imports.quarantine[0];
 const repair = I.previewRepair(s, q.id, { date: '2026-09-02' }); assert.equal(repair.rows[0].line, 7); assert.equal(repair.rows[0].action, 'new'); assert.equal(repair.config.startLine, undefined);
 const done = I.commit(s, repair, [repair.rows[0].key]); assert.equal(done.transactions.length, 2); assert.equal(done.imports.quarantine[0].line, 7); assert.ok(done.imports.quarantine[0].resolvedByBatchId);
});
test('all file records count against bounds before selection; selecting later cannot evade limits', () => {
 assert.throws(() => parse(Array.from({length: I.LIMITS.rows + 2}, () => 'x').join('\n'), { startLine: I.LIMITS.rows + 1 }), code('ROW_LIMIT'));
 assert.throws(() => parse(Array.from({length: I.LIMITS.rows + 1}, () => 'x').join('\n'), { header: false, startLine: 2 }), code('ROW_LIMIT'));
 assert.throws(() => preview(L.createEmpty(), 'Intro\n' + 'x'.repeat(201) + ',amount,id,status\n2026-09-01,1.00,a,completed', { startLine: 2 }), code('INVALID_IMPORT'));
});

function app() {
 const values = new Map(), writes = [], nodes = new Map(), listeners = new Map();
 const store = { getItem(k) { return values.get(k) || null; }, setItem(k,v) { writes.push([k,String(v)]); values.set(k,String(v)); }, removeItem(k) { values.delete(k); } };
 const document = { body: { style: {}, append() {} }, activeElement: null, addEventListener() {}, createElement() { return {click() {}, remove() {}}; } };
 function node(selector) { if (!nodes.has(selector)) nodes.set(selector, { innerHTML: '', textContent: '', value: '', disabled: false, checked: false, hidden: false, isConnected: true, dataset: {}, style: {}, elements: {}, classList: {add() {}, remove() {}}, focus() {document.activeElement = this;}, addEventListener() {}, setSelectionRange() {}, querySelectorAll() {return [];}, closest() {return null;} }); return nodes.get(selector); }
 document.querySelectorAll = () => [...nodes.values()];
 document.querySelector = selector => selector === '.modal' && !node('#modal-root').innerHTML ? null : selector === '#entry-form' && !node('#modal-root').innerHTML.includes('id="entry-form"') ? null : node(selector);
 const window = { document, localStorage: store, confirm() {return true;}, scrollTo() {}, addEventListener(type, callback) {addListener(listeners, type, callback);}, removeEventListener(type, callback) {removeListener(listeners, type, callback);} };
 const context = vm.createContext({ document, window, console, TextDecoder, TextEncoder, Blob, URL: {createObjectURL() {return 'blob:test';}, revokeObjectURL() {}}, setTimeout() {return 1;}, clearTimeout() {} });
 const entry = readEntryManifest(), scripts = entry.scripts; applyBodyAttributes(document.body, entry);
 for (const file of scripts) vm.runInContext(fs.readFileSync(path.join(__dirname, '../dist', file), 'utf8'), context, {filename: file});
 const a = { node, writes, listeners, run(code) {return vm.runInContext(code, context);}, value(code) {return JSON.parse(vm.runInContext('JSON.stringify('+code+')',context));}, put(k,v) {context[k]=v;} }; a.run("page='import';render()"); return a;
}
const file = (name, text, read) => ({name, size: new TextEncoder().encode(text).length, arrayBuffer: read || (async () => new TextEncoder().encode(text).buffer)});
async function add(a, files) {a.put('inputFiles', files); await a.node('#import-file').onchange({target: {files, value: 'selected.csv'}});}
function form(a) {
 const c = a.value('importDraft.config'), d = a.value('({preambleConfirmed:importDraft.preambleConfirmed,statusCompletedConfirmed:importDraft.statusCompletedConfirmed,directionText:importDraft.directionText,statusText:importDraft.statusText})');
 const fields = {sourceKey: c.sourceKey, accountId: c.accountId, delimiter: c.delimiter === '\t' ? 'tab' : c.delimiter, header: String(c.header !== false), startLine: c.startLine === undefined ? '' : String(c.startLine), dateFormat: c.dateFormat, amountMode: c.amountMode, defaultType: c.defaultType, expenseCategory: c.categoryIds.expense, incomeCategory: c.categoryIds.income, directionText: d.directionText, statusText: d.statusText, coverageStart: '', coverageEnd: ''};
 for (const key of ['date','amount','direction','note','stableId','status','channel']) fields['column-'+key] = c.columns[key] === undefined ? '' : String(c.columns[key]);
 const f = a.node('#import-config-form'); f.elements = Object.fromEntries(Object.entries(fields).map(([key,value]) => [key,{value}]));
 for (const key of ['preambleConfirmed','statusCompletedConfirmed','coverageConfirmed']) f.elements[key] = {checked: !!d[key]}; return f;
}
function selectStart(a, line) {form(a); a.node('#import-record-review').onclick({target: {closest() {return {dataset: {importStartLine: String(line)}};}}});}
function configureForm(a, source = 'app-source') {const f = form(a); f.elements.sourceKey.value = source; f.elements.accountId.value = 'account-cash'; return f;}
function submit(a, confirmed = true) {const f = configureForm(a); f.elements.preambleConfirmed.checked = confirmed; f.onsubmit({preventDefault() {}});}

test('actual app control selects a physical header, reviews/counts preamble, then commits selected rows only', async () => {
 const a = app(); await add(a, [file('provided.csv', prefixed)]); assert.equal(a.writes.length, 0); assert.match(a.node('#app').innerHTML, /name="startLine"/); assert.match(a.node('#app').innerHTML, /data-import-start-line="5"/);
 selectStart(a, 5); assert.equal(a.run('importDraft.config.startLine'), 5); assert.equal(a.run('importDraft.parsed.headerLine'), 5); assert.equal(a.run('importDraft.config.columns.amount'), 1); assert.equal(a.run('importDraft.preambleConfirmed'), false);
 assert.match(a.node('#app').innerHTML, /前 4 个物理行，其中 2 条非空 CSV 记录/); assert.match(a.node('#app').innerHTML, /do-not-persist/);
 submit(a, false); assert.equal(a.run('importDraft.preview'), null); assert.match(a.node('#import-config-error').textContent, /确认跳过/); assert.equal(a.writes.length, 0);
 submit(a, true); assert.equal(a.run('importDraft.preview.rows[0].line'), 6); assert.equal(a.run('importDraft.selected.size'), 0); a.node('#import-select-page').onclick(); a.node('#import-commit').onclick();
 assert.equal(a.writes.length, 1); assert.equal(a.run('state.transactions.length'), 1); assert.equal(a.run('state.imports.quarantine[0].line'), 7); assert.equal(a.run('importDraft.text'), ''); assert.equal(a.writes[0][1].includes('do-not-persist'), false);
});
test('template UI round-trip restores start, requires new skip confirmation, and changed headers still require approval', async () => {
 const a = app(); await add(a, [file('first.csv', prefixed)]); selectStart(a, 5); const f = configureForm(a); f.elements.preambleConfirmed.checked = true; a.node('#save-import-template').onclick(); assert.equal(a.writes.length, 1); const id = a.run('state.imports.templates[0].id');
 // Clear the stale fake-DOM form to model a fresh DOM after render and file switch.
 a.node('#import-config-form').elements = {}; await add(a, [file('second.csv', prefixed.replace('date,amount,id,status', 'when,amount,id,status'))]); await a.run('selectImportQueueFile(importQueue.list()[1].id)'); a.put('templateId', id); a.run('loadImportTemplate(templateId)');
 assert.equal(a.run('importDraft.config.startLine'), 5); assert.equal(a.run('importDraft.preambleConfirmed'), false); assert.equal(a.run('importDraft.headerMismatch'), true); submit(a, true); assert.equal(a.run('importDraft.preview'), null); assert.match(a.node('#import-config-error').textContent, /表头/);
 form(a); a.node('#accept-import-headers').onclick(); submit(a, true); assert.equal(a.run('importDraft.preview.rows.length'), 2); assert.equal(a.writes.length, 1);
});
test('changing start after preview clears selection and consent; invalid line cannot write or reuse preview', async () => {
 const a = app(); await add(a, [file('provided.csv', prefixed)]); selectStart(a, 5); submit(a); a.node('#import-select-page').onclick(); assert.equal(a.run('importDraft.selected.size'), 1);
 const f = form(a); f.elements.startLine.value = '3'; f.onchange({target: {name: 'startLine'}}); assert.equal(a.run('importDraft.parsed'), null); assert.equal(a.run('importDraft.preview'), null); assert.equal(a.run('importDraft.selected.size'), 0); assert.equal(a.run('importDraft.preambleConfirmed'), false); assert.equal(a.run('commitImportSelection()'), false); assert.match(a.run('importDraft.error'), /完整 CSV 记录/); assert.equal(a.writes.length, 0);
 const retry = form(a); retry.elements.startLine.value = ''; retry.onchange({target: {name: 'startLine'}}); assert.equal(a.run('importDraft.parsed.headerLine'), 1); assert.equal(a.run('importDraft.config.startLine'), undefined);
});
test('queue drafts retain separate starts/consent; changing one does not alter another, and commit stales the other preview', async () => {
 const a = app(); await add(a, [file('first.csv', prefixed), file('second.csv', 'Another intro\n'+plain.replace('stable-1','stable-2'))]); selectStart(a, 5); submit(a); a.node('#import-select-page').onclick();
 a.node('#import-config-form').elements = {}; await a.run('selectImportQueueFile(importQueue.list()[1].id)'); assert.equal(a.run('importDraft.config.startLine'), undefined); assert.equal(a.run('importDraft.preambleConfirmed'), false); selectStart(a, 2); submit(a); a.node('#import-select-page').onclick();
 a.node('#import-config-form').elements = {}; await a.run('selectImportQueueFile(importQueue.list()[0].id)'); assert.equal(a.run('importDraft.config.startLine'), 5); assert.equal(a.run('importDraft.preambleConfirmed'), true); assert.equal(a.run('importDraft.selected.size'), 1); a.node('#import-commit').onclick();
 assert.equal(a.run('importQueue.list()[1].draft.config.startLine'), 2); assert.equal(a.run('importQueue.list()[1].draft.preview'), null); assert.equal(a.run('importQueue.list()[1].draft.selected.size'), 0); assert.equal(a.run('importQueue.list()[1].status'), 'stale');
});
test('preamble records are completely reviewable through bounded pagination and escaped full-field details', async () => {
 const a = app(), attack = '<img src=x onerror=alert(1)>', csv = Array.from({length: 23}, (_,i) => i === 20 ? attack+' '+'x'.repeat(220) : 'notice-'+i).join('\n')+'\n'+plain;
 await add(a, [file('review.csv', csv)]); selectStart(a, 24); assert.equal((a.run('importRecordReview()').match(/data-import-start-line=/g)||[]).length, 10); assert.match(a.run('importRecordReview()'), /23 条非空 CSV 记录/);
 form(a); a.node('#import-record-next').onclick(); form(a); a.node('#import-record-next').onclick(); const html = a.run('importRecordReview()'); assert.equal((html.match(/data-import-start-line=/g)||[]).length, 5); assert.match(html, /notice-22/); assert.ok(html.includes('x'.repeat(220))); assert.ok(!html.includes(attack)); assert.match(html, /&lt;img/); assert.equal(a.writes.length, 0);
});
test('cancellation and late read completion never persist or resurrect selected preamble content', async () => {
 const a = app(); await add(a, [file('review.csv', prefixed)]); selectStart(a, 5); submit(a); a.node('#reset-import').onclick(); assert.equal(a.run('importQueue.list().length'), 0); assert.equal(a.run('importDraft.text'), ''); assert.equal(a.writes.length, 0);
 let finish; const pending = add(a, [file('delayed.csv', prefixed, () => new Promise(resolve => finish = resolve))]); await Promise.resolve(); a.node('#reset-import').onclick(); finish(new TextEncoder().encode(prefixed).buffer); await pending; assert.equal(a.run('importQueue.list().length'), 0); assert.equal(a.run('importDraft.text'), ''); assert.equal(a.writes.length, 0);
});
test('template load, encoding reread and different file never carry preamble consent', async () => {
 const a = app(); await add(a, [file('first.csv', prefixed)]); selectStart(a, 5); submit(a); assert.equal(a.run('importDraft.preambleConfirmed'), true); a.node('#import-config-form').elements = {}; await a.node('#import-encoding').onchange({target: {value: 'utf-8'}}); assert.equal(a.run('importDraft.preambleConfirmed'), false); assert.equal(a.run('importDraft.preview'), null); assert.equal(a.writes.length, 0);
});

test('genuine frozen inner-v1 import state migrates without rewriting historical records or losing duplicate receipts', () => {
 const original = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/imports-v1-frozen-v08.json'), 'utf8')); assert.equal(original.imports.version, 1);
 const before = JSON.stringify(original), next = L.validateState(original); assert.equal(next.imports.version, 2); assert.equal(JSON.stringify(original), before);
 const expected = JSON.parse(before); expected.imports.version = 2; assert.deepEqual(next, expected); assert.deepEqual(L.parseBackup(L.backup(next)), next);
 const csv = 'date,amount,id,status\n2026-09-01,1.00,first,completed\n2026-09-02,4.00,second,completed\ninvalid,3.00,bad,completed';
 const p = I.preview(next, csv, config({sourceKey:'frozen-v08-source'})); assert.deepEqual(p.rows.map(r=>r.action), ['duplicate','duplicate','invalid']);
 assert.equal(p.fileFingerprint, original.imports.batches[1].fileFingerprint); assert.equal(Object.hasOwn(next.imports.templates[0].config,'startLine'), false);
});
test('new startLine semantics cannot masquerade as a version-1 import state', () => {
 const p = preview(), s = I.commit(L.createEmpty(), p, [p.rows[0].key]); assert.equal(s.imports.version, 2); s.imports.version = 1; assert.throws(() => L.validateState(s), code('INVALID_IMPORT_VERSION'));
});

test('actual app no-header control selects first data record and requires manual numeric column mapping', async () => {
 const a = app(); await add(a, [file('no-header.csv','Private intro\n2026-09-01,1.00,a,completed\n2026-09-02,2.00,b,completed')]);
 const f = form(a); f.elements.header.value = 'false'; f.onchange({target: {name:'header'}}); selectStart(a,2);
 assert.match(a.node('#app').innerHTML,/首条数据起始物理行/); const mapping = configureForm(a); mapping.elements['column-date'].value='0';mapping.elements['column-amount'].value='1';mapping.elements['column-stableId'].value='2';mapping.elements['column-status'].value='3';mapping.elements.preambleConfirmed.checked=true;mapping.onsubmit({preventDefault(){}});
 assert.deepEqual(a.value('importDraft.preview.rows.map(r=>r.line)'),[2,3]);a.node('#import-select-page').onclick();a.node('#import-commit').onclick();assert.equal(a.run('state.transactions.length'),2);assert.equal(a.run('state.imports.templates[0].config.header'),false);assert.equal(a.run('state.imports.templates[0].config.startLine'),2);assert.equal(a.writes[0][1].includes('Private intro'),false);
});

test('structural input invalidates consent before change/blur and cannot submit a stale record inspection', async () => {
 const a=app();await add(a,[file('review.csv',prefixed)]);selectStart(a,5);submit(a);a.node('#import-select-page').onclick();const f=form(a);f.elements.startLine.value='6';f.oninput({target:{name:'startLine'}});
 assert.equal(a.run('importDraft.preambleConfirmed'),false);assert.equal(f.elements.preambleConfirmed.checked,false);assert.equal(a.run('importDraft.preview'),null);assert.equal(a.run('importDraft.selected.size'),0);
 f.elements.preambleConfirmed.checked=true;f.onsubmit({preventDefault(){}});assert.equal(a.run('importDraft.preview'),null);assert.match(a.node('#import-config-error').textContent,/先完成文件检查/);assert.equal(a.writes.length,0);
});

test('source location and changed preface never change receipts for identical data, with or without stable IDs', () => {
 for (const columns of [{date:0,amount:1,status:3},{date:0,amount:1,stableId:2,status:3}]) {
  const base = config({columns}), first=I.preview(L.createEmpty(),plain,base), s=I.commit(L.createEmpty(),first,[first.rows[0].key]);
  for (const [csv,startLine] of [[plain,1],['Intro\n'+plain,2],['Different intro\n"Two\nlines"\n\n'+plain,5],['Replaced preface\n'+plain,2]]) {
   const p=I.preview(s,csv,{...base,startLine,preambleConfirmed:true});assert.equal(p.fileFingerprint,first.fileFingerprint);assert.equal(p.rows[0].key,first.rows[0].key);assert.equal(p.rows[0].action,'duplicate');assert.equal(p.rows[0].line,startLine+1);assert.equal(p.config.startLine,startLine);
  }
  // Receipt matching also ignores only location when the original receipt used a saved explicit start.
  const prefixed=I.preview(L.createEmpty(),'Intro\n'+plain,{...base,startLine:2,preambleConfirmed:true}), stored=I.commit(L.createEmpty(),prefixed,[prefixed.rows[0].key]);
  const noPrefix=I.preview(stored,plain,base);assert.equal(noPrefix.fileFingerprint,prefixed.fileFingerprint);assert.equal(noPrefix.rows[0].action,'duplicate');
  const sameLineNewPrefix=I.preview(stored,'Changed intro\n'+plain,{...base,startLine:2,preambleConfirmed:true});assert.equal(sameLineNewPrefix.rows[0].action,'duplicate');
 }
});
test('excluding location preserves duplicate occurrence indices and distinguishes actual row/config changes', () => {
 const base=config({columns:{date:0,amount:1,status:3}}), duplicate=plain+'\n2026-09-01,1.00,other,completed', p=I.preview(L.createEmpty(),duplicate,base);assert.deepEqual(p.rows.map(r=>r.action),['new','candidate']);
 const s=I.commit(L.createEmpty(),p,p.rows.map(r=>r.key)), shifted=I.preview(s,'Notice\n'+duplicate,{...base,startLine:2,preambleConfirmed:true});assert.deepEqual(shifted.rows.map(r=>r.action),['duplicate','duplicate']);assert.deepEqual(shifted.rows.map(r=>r.key),p.rows.map(r=>r.key));assert.notEqual(p.rows[0].key,p.rows[1].key);
 for (const [csv,extra] of [[plain.replace('1.00','2.00'),{}],[plain.replace('completed','pending'),{}],[plain+'\n2026-09-02,2.00,b,completed',{}],[plain.replace('completed','completed,extra'),{}],[plain,{columns:{date:0,amount:1,note:2,status:3}}]]) assert.notEqual(I.preview(L.createEmpty(),csv,{...base,...extra}).fileFingerprint,I.preview(L.createEmpty(),plain,base).fileFingerprint);
});

test('accepted evidence and journal after-images retain exact physical source lines and survive backup', () => {
 const p=preview(),s=I.commit(L.createEmpty(),p,[p.rows[0].key]);assert.equal(s.imports.evidence[0].sourceLine,6);assert.equal(s.imports.batches[0].changes[0].after.sourceLine,6);assert.equal(s.imports.batches[0].changes[0].before,null);assert.deepEqual(L.parseBackup(L.backup(s)),s);
 const repair=I.previewRepair(s,s.imports.quarantine[0].id,{date:'2026-09-03'}),repaired=I.commit(s,repair,[repair.rows[0].key]);assert.equal(repaired.imports.evidence.find(e=>e.stableId==='bad-1').sourceLine,7);assert.equal(repaired.imports.batches[1].changes[0].after.sourceLine,7);
 const updated=preview(repaired,prefixed.replace('1.00,stable-1','5.00,stable-1'));const change=I.commit(repaired,updated,[updated.rows[0].key]);assert.equal(change.imports.batches[2].changes[0].before.sourceLine,6);assert.equal(change.imports.batches[2].changes[0].after.sourceLine,6);assert.equal(I.rollback(change,change.imports.batches[2].id).state.imports.evidence.find(e=>e.stableId==='stable-1').sourceLine,6);
 for(const secret of ['Private preamble','do-not-persist','private-meta'])assert.equal(JSON.stringify(change).includes(secret),false);
});
test('pending/cancelled/updated evidence tracks latest accepted source line and rollback restores prior line', () => {
 const csv='Notice\ndate,amount,id,status\n2026-09-01,1.00,a,pending\n2026-09-02,2.00,b,cancelled',cfg=config({startLine:2,preambleConfirmed:true});const p=I.preview(L.createEmpty(),csv,cfg),s=I.commit(L.createEmpty(),p,p.rows.map(r=>r.key));assert.deepEqual(s.imports.evidence.map(e=>e.sourceLine),[3,4]);assert.equal(s.transactions.length,0);
 const later=I.preview(s,'Additional\n'+csv.replace('a,pending','a,completed'),{...cfg,startLine:3});const next=I.commit(s,later,[later.rows[0].key]);assert.equal(next.imports.evidence.find(e=>e.stableId==='a').sourceLine,4);assert.equal(next.imports.evidence.find(e=>e.stableId==='b').sourceLine,4);assert.equal(next.imports.batches[1].changes[0].before.sourceLine,3);assert.equal(next.imports.batches[1].changes[0].after.sourceLine,4);
 const restored=I.rollback(next,next.imports.batches[1].id).state;assert.equal(restored.imports.evidence.find(e=>e.stableId==='a').sourceLine,3);assert.equal(restored.imports.evidence.find(e=>e.stableId==='a').status,'pending');
});
test('legacy unknown lines stay absent in migrated journals and before-images, including after rollback', () => {
 const legacy=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/imports-v1-frozen-v08.json'),'utf8')),next=L.validateState(legacy);assert.equal(Object.hasOwn(next.imports.evidence[0],'sourceLine'),false);
 const csv='Note\ndate,amount,id,status\n2026-09-01,5.00,first,completed',p=I.preview(next,csv,config({sourceKey:'frozen-v08-source',startLine:2,preambleConfirmed:true})),updated=I.commit(next,p,[p.rows[0].key]),batch=updated.imports.batches.at(-1);
 assert.equal(Object.hasOwn(batch.changes[0].before,'sourceLine'),false);assert.equal(batch.changes[0].after.sourceLine,3);assert.deepEqual(updated.imports.batches.slice(0,-1),legacy.imports.batches);
 const rollback=I.rollback(updated,batch.id).state;assert.equal(Object.hasOwn(rollback.imports.evidence.find(e=>e.stableId==='first'),'sourceLine'),false);assert.deepEqual(rollback.imports.batches.slice(0,-1),legacy.imports.batches);
});
test('physical provenance accepts only bounded integers and current/journal line drift fails validation', () => {
 const p=preview(),s=I.commit(L.createEmpty(),p,[p.rows[0].key]);
 for(const bad of [undefined,null,0,-1,1.5,'6',NaN,Infinity,I.LIMITS.bytes+1])for(const target of ['current','after']) {const copy=JSON.parse(JSON.stringify(s));(target==='current'?copy.imports.evidence[0]:copy.imports.batches[0].changes[0].after).sourceLine=bad;assert.throws(()=>L.validateState(copy));}
 const changed=JSON.parse(JSON.stringify(s));changed.imports.evidence[0].sourceLine=5;assert.throws(()=>L.validateState(changed));
 const legacy=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/imports-v1-frozen-v08.json'),'utf8'));
 for(const target of ['current','after','before']) {const copy=JSON.parse(JSON.stringify(legacy));const value=target==='current'?copy.imports.evidence[0]:copy.imports.batches[target==='after'?0:1].changes[0][target];value.sourceLine=2;assert.throws(()=>L.validateState(copy),code('INVALID_IMPORT_VERSION'));}
});
test('actual provenance UI labels latest accepted physical line and legacy unknown accurately', async () => {
 const a=app();await add(a,[file('provided.csv',prefixed)]);selectStart(a,5);submit(a);a.node('#import-select-page').onclick();a.node('#import-commit').onclick();a.node('#entry-form').elements={type:Object.assign([],{value:'expense'}),categoryId:{},toAccountId:{}};a.run('entry(state.transactions[0].id)');const html=a.node('#modal-root').innerHTML;assert.match(html,/最近确认的来源物理行/);assert.match(html,/第 6 行/);assert.match(html,/重复预览不会改写原证据/);
 a.put('legacyInput',JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/imports-v1-frozen-v08.json'),'utf8')));a.run('state=L.validateState(legacyInput)');a.run('entry(state.transactions[0].id)');assert.match(a.node('#modal-root').innerHTML,/旧记录未保存，未知/);
});
