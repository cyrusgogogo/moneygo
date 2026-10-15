'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {captureUI,uiHost}=require('./personal-events-ui-oracle.cjs');
const root=process.env.MONEYGO_EQUIVALENCE_ROOT||path.resolve(__dirname,'..');
const model=require('./fixtures/personal-events-legacy-oracle.json'),oracle=require('./fixtures/personal-events-legacy-ui-oracle.json');
for(const frozen of oracle.fixtures)test('UI legacy raw counts, routes, filter membership, ties and personal sums: '+frozen.id,()=>{
 const fixture=model.fixtures.find(f=>f.id===frozen.id);const result=captureUI(root,fixture);
 // The sole approved visible addition is this exact residual annotation. Preserve every old byte before it.
 const amounts=new Map(fixture.expectedEvents.personalExpenseEvents.map(e=>[e.origin.transactionId,e.amountCents]));
 const money=cents=>`${cents<0?'−':''}¥${Math.floor(Math.abs(cents)/100).toLocaleString('zh-CN')}.${String(Math.abs(cents)%100).padStart(2,'0')}`;
 for(const month of fixture.months){const old=frozen.expected[month].exclusions,next=result[month].exclusions;assert.equal(next.length,old.length);for(let i=0;i<old.length;i++){assert.equal(next[i].id,old[i].id);assert.ok(amounts.has(next[i].id));assert.equal(next[i].text,old[i].text+' · 当前个人消费 '+money(amounts.get(next[i].id)),'Only the exact approved suffix may differ');next[i].text=old[i].text;}}
 assert.deepEqual(result,frozen.expected);
 assert.deepEqual(result.unchanged,{state:true,saved:true,writes:[],forbidden:[]});
});
test('real executable entry manifests load the pure leaf before financial consumers',()=>{
 for(const entry of ['index.html','demo.html']){const html=fs.readFileSync(path.join(root,'dist',entry),'utf8'),scripts=[...html.matchAll(/<script\b[^>]*src=["']([^"']+)["']/g)].map(m=>m[1]);assert.equal(scripts.filter(f=>f==='personal-events.js').length,1,entry);assert.ok(scripts.indexOf('personal-events.js')<scripts.indexOf('ledger.js'),entry);assert.ok(scripts.indexOf('personal-events.js')<scripts.indexOf('relations.js'),entry);}
 assert.doesNotMatch(fs.readFileSync(path.join(root,'dist/synthetic-practice.html'),'utf8'),/<script\b/i);
});
for(const entry of ['index.html','demo.html'])for(const fault of ['module','projectLegacy','select','reduce','keyOf','PersonalEventError','ledger-personalEvents','getter'])test('missing projection dependency fails before storage acquisition: '+entry+' / '+fault,()=>{
 let reads=0;const app=uiHost(root,model.fixtures[0],{entry,beforeScript(name,context,window){if(name===(entry==='index.html'?'personal-bootstrap-v1.js':'synthetic-bootstrap-v1.js')){
   if(fault==='module')delete window.MoneygoPersonalEvents;
   else if(fault==='getter')Object.defineProperty(window,'MoneygoPersonalEvents',{get(){reads++;throw Error('Getter invoked');},configurable:true});
   else if(fault==='ledger-personalEvents')window.MoneygoLedger={...window.MoneygoLedger,personalEvents:undefined};
   else window.MoneygoPersonalEvents={...window.MoneygoPersonalEvents,[fault]:undefined};
 }}});
 assert.equal(app.node('#boot-blocker').hidden,false);assert.equal(app.node('#app').hidden,true);assert.equal(app.node('#app').innerHTML,'');assert.equal(app.counters.localStorage,0);assert.equal(app.counters.sessionStorage,0);assert.deepEqual(app.counters.personalIO,[]);assert.equal(reads,0);assert.equal(Object.hasOwn(app.window,'MoneygoRuntimeCapability'),false);
});
test('memory-only demo boot, report/navigation and reset do not acquire or alter personal storage',()=>{
 const {host}=require(path.join(root,'tests/actual-entry-host.cjs'));const app=host(root),before=[...app.personal];
 assert.deepEqual(app.errors.map(e=>e.message),[]);assert.equal(app.run('runtime.mode'),'synthetic');assert.equal(app.run('active()'),true);const saved=app.run('savedRaw');
 for(const page of ['report','ledger','bookkeeping','organizer','obligations','sandbox']){app.run('page='+JSON.stringify(page)+';render();');assert.equal(app.run('savedRaw'),saved);}
 app.run('resetDemo()');app.node('#confirm-demo-reset').click();assert.equal(app.run('active()'),false);assert.equal(app.counters.reloads,1);assert.equal(app.counters.localStorage,0);assert.equal(app.counters.sessionStorage,0);assert.deepEqual(app.counters.personalIO,[]);assert.deepEqual([...app.personal],before);assert.deepEqual(app.counters.forbidden,[]);
});
test('raw Scenario exclusions preserve off-month, future, trash and stale entries with one unchanged save',()=>{
 const fixture=model.fixtures.find(f=>f.id==='independent-future-trash-type-change-exclusions'),app=uiHost(root,fixture);const before=app.run('JSON.stringify(state)'),initial=app.value('state.simulation.exclusions');
 app.run("exclusionsForMonth('2026-09')");
 const inputs=app.node('#modal-root').querySelectorAll('[data-exclusion-id]');assert.deepEqual(inputs.map(n=>n.dataset.exclusionId),['transaction-income-expense']);
 assert.equal(inputs[0].checked,true);assert.equal(app.counters.personalIO.filter(x=>x[0]==='set').length,0);
 app.node('#entry-form').onsubmit({preventDefault(){}});
 assert.equal(app.run('JSON.stringify(state)'),before);assert.deepEqual(app.value('state.simulation.exclusions'),initial);assert.equal(app.counters.personalIO.filter(x=>x[0]==='set'&&x[1]==='moneygo.ledger.v1').length,1);
 assert.ok(initial.includes('transaction-expense-future'));assert.ok(initial.includes('trashed-expense'));assert.ok(initial.includes('type-changed-income'));assert.ok(initial.includes('missing-expense'));
});
test('frozen synthetic economic seed and download bytes are unchanged',()=>{
 const crypto=require('node:crypto');const expected={
 'SYNTHETIC-complex-v6.json':'653d1c849274368e2697b28401a8ec10ac3d1f7c68fc8efc8b02be8362d6f71b',
 'SYNTHETIC-practice-bank.csv':'501f6a80873cc8e424db70472a6493f162bf8c89c17a95c8aa9eaf71ee84e569',
 'SYNTHETIC-practice-coffee-cancellation.csv':'123772c6c34aec1f416869e0db48c5887c96c08ebd859ef9eb6c7b76b9bf9d27',
 'SYNTHETIC-practice-coffee-correction.csv':'e04fea2ed7d5dab24cc8fe2d6e650069eadeeb519b46d5961b876952b10b531f',
 'SYNTHETIC-practice-credit.tsv':'8bc5b4183873f62a6800b1e959111864a62a8a51777712ecdb4cad00dc038274',
 'SYNTHETIC-starter.json':'a088a0ba283854679ab3e6dc27f6491dc028fa8c7269acc3865c8096b2c42cc8'};
 for(const [name,hash] of Object.entries(expected))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'dist/samples',name))).digest('hex'),hash,name);
});
