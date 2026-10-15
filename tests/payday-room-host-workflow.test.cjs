'use strict';
// H01-H06, H09-H11: actual production entries with genuine owned model identities.
// This test host establishes VM/markup behavior only; browser layout/AT remain unperformed.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const H=require('./payday-room-host-harness.cjs');
const currentDaily=a=>{const d=H.latest(a,'confirm');return d.real.isCurrent(a.run('state'),d.out,d.args[3]);};
const currentRoom=(a,r=H.latest(a,'confirmRoom'))=>r.real.isRoomCurrent(a.run('state'),r.out,r.args[3]);
const visibleRoom=a=>a.node('#daily-room-result')?.textContent||'';
function unchecked(a){const form=a.node('#daily-room-consent');assert.ok(form);for(const name of H.ROOM_CONSENT)assert.equal(form.elements.namedItem(name).checked,false,name);assert.equal(form.elements.namedItem('reason').value,'');}
for(const personal of [true,false]){
 const label=personal?'index':'demo';
 test('room host H01 '+label+': packaged script order and exact owned-source roundtrip are read only',()=>{
  const state=H.fixture({outflows:3,inflows:5,checkpoint:2,later:2}).state,a=H.app({personal,state}),before=H.snapshot(a);
  const literal=[...fs.readFileSync(path.join(H.ROOT,'dist',a.entry),'utf8').matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*><\/script>/g)].map(m=>m[1]);assert.deepEqual(a.scriptNames,literal);
  for(const [earlier,later]of [['cash-basis.js','daily-cash.js'],['daily-cash.js','daily-cash-ui.js'],['cash-basis-ui.js','daily-cash-ui.js'],['daily-cash-ui.js','app-runtime-v1.js']])assert.ok(literal.indexOf(earlier)<literal.indexOf(later));
  assert.equal(literal.filter(x=>/room/.test(x)).length,0,'No new room loader');H.confirm(H.preview(H.inventory(a)));const d=H.latest(a,'confirm');H.roomConfirm(H.roomPreview(H.roomInputs(H.openRoom(a),{amount:'20.00'})));const p=H.latest(a,'previewRoom'),r=H.latest(a,'confirmRoom');
  assert.equal(p.real,d.real);assert.equal(r.real,d.real);assert.equal(p.args[1],d.out,'Preview receives genuine retained daily identity');assert.equal(r.args[1],d.out,'Confirm receives same source identity');assert.equal(r.out.sourceReport,d.out,'Full source embedded once by genuine immutable identity');assert.equal(r.out.status,'confirmed');assert.equal(r.out.accounts[0].conditionalRoomCents,97700);assert.equal(r.out.accounts[0].ignoredKnownInflowCents,500);assert.equal(r.out.accounts[0].sourceDailyClosingAtWindowEndCents,100200);assert.equal(currentRoom(a),true);assert.equal(currentDaily(a),true);H.quiet(a,before);
 });
 test('room host H02 '+label+': entering and dismissing room adds no coordinator, basis instance, route or duplicate ID',()=>{
  const a=H.ready({personal}),before={...a.constructors};assert.equal(before.daily,1);assert.equal(a.doc.querySelectorAll('#cash-daily-basis-root').length,0);
  for(let i=0;i<3;i++){H.openRoom(a);assert.deepEqual(a.constructors,before);const ids=a.doc.querySelectorAll('[id]').map(n=>n.id);assert.equal(new Set(ids).size,ids.length);H.roomPreview(H.roomInputs(a));H.click(a,'#daily-room-back');assert.equal(currentDaily(a),true);}
  assert.deepEqual(a.constructors,before);assert.equal(a.run('page'),'daily-cash');H.quiet(a);
 });
 test('room host H03 '+label+': date, floor state, amount, purpose and consent begin empty',()=>{
  const a=H.openRoom(H.ready({personal}));for(const selector of ['#daily-room-date','#daily-room-floor-state-0','#daily-room-floor-amount-0','#daily-room-floor-purpose-0'])assert.equal(a.node(selector).value,'',selector);assert.equal(a.counts.previewRoom||0,0);assert.equal(a.counts.confirmRoom||0,0);H.roomPreview(H.roomInputs(a));unchecked(a);assert.ok(H.latest(a,'previewRoom').out.report.accounts.every(x=>x.classification==='pending'&&x.conditionalRoomCents===null));H.quiet(a);
 });
 test('room host H03 '+label+': explicit zero and unknown remain distinct after confirmation',()=>{
  for(const [state,amount,result,classification]of [['known','0',100000,'positive'],['unknown','',null,'unknown']]){const a=H.roomReady({personal},{state,amount});const row=H.roomReport(a).accounts[0];assert.equal(row.protectionFloor.state,state);assert.equal(row.protectionFloor.amountCents,state==='known'?0:null);assert.equal(row.conditionalRoomCents,result);assert.equal(row.classification,classification);H.quiet(a);}
 });
 test('room host H04 '+label+': pending remains null and repeat detached confirm creates one result only',()=>{
  const a=H.roomPreview(H.roomInputs(H.openRoom(H.ready({personal})))),p=H.latest(a,'previewRoom');assert.equal(p.out.report.status,'pending');assert.equal(p.out.report.accounts[0].conditionalRoomCents,null);const old=a.node('#daily-room-consent');H.roomConfirm(a);assert.equal(a.counts.confirmRoom,1);const first=H.roomReport(a);old.dispatch('submit');assert.equal(a.counts.confirmRoom,1);assert.equal(H.roomReport(a),first);assert.equal(currentRoom(a),true);H.quiet(a);
 });
 test('room host H06 '+label+': pending and confirmed Back preserves daily, clears room draft and review',()=>{
  const a=H.ready({personal}),before=H.snapshot(a),d=H.report(a);for(const confirmed of [false,true]){H.roomPreview(H.roomInputs(H.openRoom(a)));const pending=H.latest(a,'previewRoom'),old=a.node('#daily-room-consent');H.fill(old,{...Object.fromEntries(H.ROOM_CONSENT.map(k=>[k,true])),reason:'Old detached review'});if(confirmed)H.roomConfirm(a);const count=a.counts.confirmRoom||0;H.click(a,'#daily-room-back');old.dispatch('submit');assert.equal(a.counts.confirmRoom||0,count);assert.equal(pending.real.cancelRoom(pending.out.ticket).cancelled,false);assert.equal(currentDaily(a),true);assert.equal(H.report(a),d);assert.ok(a.node('#daily-room-open'));H.openRoom(a);assert.equal(a.node('#daily-room-date').value,'');assert.equal(a.node('#daily-room-floor-state-0').value,'');H.click(a,'#daily-room-back');}H.quiet(a,before);
 });
 test('room host H09 '+label+': hostile-looking labels and floor purpose stay literal text',()=>{
  let {state}=H.fixture();state=H.L.putAccount(state,{name:'<img src=x onerror=roomAttack()> & account',openingBalanceCents:100000},'account-cash');const purpose='<svg onload=roomAttack()> & <script>roomAttack()</script> 😀';const a=H.roomReady({personal,state},{purpose});assert.equal(H.roomReport(a).accounts[0].protectionFloor.purpose,purpose);assert.ok(visibleRoom(a).includes(purpose));assert.equal(a.doc.querySelectorAll('img').length,0);assert.equal(a.node('#daily-cash-root').querySelectorAll('svg').length,0);assert.equal(a.doc.querySelectorAll('[onload]').length,0);H.click(a,'#daily-room-full');assert.deepEqual(JSON.parse(H.readProof(a)),H.copy(H.roomReport(a)));H.quiet(a);
 });
 test('room host H10 '+label+': every room action captures host raw state once',()=>{
  const a=H.ready({personal});const once=fn=>{a.run('roomStateReads=0');fn();assert.equal(a.run('roomStateReads'),1);};once(()=>H.openRoom(a));once(()=>H.field(a,'#daily-room-date','2026-10-20','input'));once(()=>H.field(a,'#daily-room-floor-state-0','known'));once(()=>H.field(a,'#daily-room-floor-amount-0','0','input'));once(()=>H.field(a,'#daily-room-floor-purpose-0','Explicit extra stock','input'));once(()=>H.roomPreview(a));once(()=>H.roomConfirm(a));once(()=>H.field(a,'#daily-room-kind','omittedInflows'));once(()=>H.click(a,'#daily-room-full'));once(()=>H.click(a,'#daily-proof-next'));once(()=>H.click(a,'#daily-room-back'));H.quiet(a);
 });
 test('room host H11 '+label+': day-end cutoff, checkpoint boundary, ignored inflows and stock-floor caveat visible',()=>{
  const a=H.roomReady({personal,state:H.fixture({outflows:1,inflows:1,checkpoint:1,later:1}).state},{amount:'1.00'}),r=H.roomReport(a);const text=a.node('#daily-workflow').textContent;for(const date of [r.asOfDate,r.windowStart,r.windowEnd,r.nextIncomeDate,r.sourceDailyHorizonEnd])assert.ok(text.includes(date),date);assert.match(text,/日终/);assert.match(text,/额外|附加/);assert.match(text,/流入/);assert.match(text,/费用|支出/);assert.match(a.node('#daily-cash-root').textContent,/不证明实时余额/);assert.equal(r.scope.pooledRoom,'not-provided');assert.equal(r.scope.futureInflowCredit,'none');assert.equal(r.partitions.checkpoint.fixedIds.length,1);assert.equal(r.partitions.afterCheckpoint.fixedIds.length,1);assert.ok(a.node('#daily-room-source-full'));assert.ok(a.node('#daily-room-scope'));H.click(a,'#daily-room-source-full');assert.deepEqual(JSON.parse(H.readProof(a)),H.copy(H.report(a)));H.quiet(a);
 });
}
for(const missing of [...H.ROOM_CONSENT,'reason'])test('room host H04: missing '+missing+' cannot confirm',()=>{
 const a=H.roomPreview(H.roomInputs(H.openRoom(H.ready())));H.roomConfirm(a,{[missing]:missing==='reason'?'':false});assert.equal(a.counts.confirmRoom||0,0);assert.equal(H.roomReport(a),undefined);assert.equal(currentDaily(a),true);assert.equal(H.latest(a,'previewRoom').out.report.accounts[0].conditionalRoomCents,null);H.quiet(a);
});
for(const [label,value]of [['blank',''],['whitespace',' '],['negative-zero','-0'],['negative','-1'],['plus','+1'],['exponent','1e3'],['comma','1,000'],['fraction-cent','0.001'],['NaN','NaN'],['Infinity','Infinity'],['over-cap','10000000000.00']])test('room host H03: malformed floor '+label+' rejects without retiring daily',()=>{
 const a=H.roomInputs(H.openRoom(H.ready()),{amount:value});H.click(a,'#daily-room-preview');assert.equal(a.node('#daily-room-consent'),null);assert.equal(a.counts.confirmRoom||0,0);assert.equal(currentDaily(a),true);assert.equal(H.roomReport(a),undefined);H.quiet(a);
});
for(const amount of ['0.01','12.34','9999999999.99'])test('room host H03: decimal '+amount+' reaches model as exact integer cents',()=>{
 const a=H.roomPreview(H.roomInputs(H.openRoom(H.ready()),{amount}));const cents=Number(BigInt(amount.replace('.','')));assert.equal(H.latest(a,'previewRoom').out.report.query.protectionFloors[0].amountCents,cents);H.quiet(a);
});
for(const [selector,value,revert,event]of [['#daily-room-date','2026-10-21','2026-10-20','input'],['#daily-room-date','2026-10-21','2026-10-20','change'],['#daily-room-floor-state-0','unknown','known','change'],['#daily-room-floor-amount-0','1','0','input'],['#daily-room-floor-amount-0','1','0','change'],['#daily-room-floor-purpose-0','Changed purpose','Synthetic additional stock floor','input'],['#daily-room-floor-purpose-0','Changed purpose','Synthetic additional stock floor','change']])test('room host H05: '+selector+' '+event+' immediately retires room but preserves daily',()=>{
 const a=H.roomReady(),r=H.latest(a,'confirmRoom'),old=a.node('#daily-room-full'),before=a.counts.invalidateRoom||0;assert.equal(currentRoom(a,r),true);H.field(a,selector,value,event);assert.ok((a.counts.invalidateRoom||0)>before);assert.equal(currentRoom(a,r),false);assert.equal(currentDaily(a),true);assert.doesNotMatch(visibleRoom(a),/本次已确认/);old.dispatch('click');assert.equal(currentRoom(a,r),false);H.field(a,selector,revert,event);assert.equal(currentRoom(a,r),false);H.roomPreview(a);unchecked(a);assert.equal(currentDaily(a),true);H.quiet(a);
});
test('room host H05: detached pending consent cannot confirm after room edit and redraw',()=>{
 const a=H.roomPreview(H.roomInputs(H.openRoom(H.ready()))),old=a.node('#daily-room-consent');H.fill(old,{...Object.fromEntries(H.ROOM_CONSENT.map(k=>[k,true])),reason:'Old no-longer-current consent'});H.field(a,'#daily-room-date','2026-10-21','input');old.dispatch('submit');assert.equal(a.counts.confirmRoom||0,0);assert.equal(currentDaily(a),true);H.roomPreview(a);unchecked(a);H.quiet(a);
});
