'use strict';
const test=require('node:test'),H=require('./daily-cash-independent-host-harness.cjs'),{A}=H;
function ready(a){H.dailyReview(H.dailyOpen(a));H.dailyPreview(a);H.dailyApprove(a);return a;}
function hidden(a){A.doesNotMatch(a.node('#daily-result')?.textContent||'',/本次已确认的条件/);}
function stale(a){A.equal(a.run('dailySessions.at(-1).real.isCurrent(state,dailySessions.at(-1).confirmed,dailySessions.at(-1).scenario)'),false);hidden(a);}
for(const personal of [true,false]){const label=personal?'index':'demo';
 for(const event of ['freeze','document-freeze','popstate','hashchange','pagehide','visibilitychange','runtime-dispose'])test('daily independent '+label+': '+event+' retires confirmed values and captured handlers',()=>{
  const a=ready(H.app(personal)),before=H.snapshot(a),old=a.node('#daily-result-full');if(event==='document-freeze')a.documentEvent('freeze');else if(event==='visibilitychange'){a.doc.visibilityState='hidden';a.documentEvent('visibilitychange');a.doc.visibilityState='visible';a.documentEvent('visibilitychange');}else if(event==='runtime-dispose')a.run('disposeRuntime()');else a.windowEvent(event);stale(a);old.onclick({preventDefault(){}});hidden(a);if(a.run('active()')){a.run('render()');hidden(a);A.equal(a.node('#daily-review-sources').disabled,true);H.quiet(a,before);}else H.quiet(a);
 });
 for(const trigger of ['focus','pageshow','render','action'])test('daily independent '+label+': day rollover on '+trigger+' clears old displayed report',()=>{
  const a=ready(H.app(personal)),before=H.snapshot(a);a.run(`Date=class extends Date{constructor(...xs){super(...(xs.length?xs:['2026-10-15T12:00:00.000Z']))}}`);if(trigger==='render')a.run('render()');else if(trigger==='action')H.click(a,'#daily-result-full');else a.windowEvent(trigger);stale(a);a.run(`Date=class extends Date{constructor(...xs){super(...(xs.length?xs:['2026-10-14T12:00:00.000Z']))}}`);H.quiet(a,before);
 });
 test('daily independent '+label+': clock rollback and same-reference state edits fail closed on action',()=>{
  for(const edit of ['clock','state']){const a=ready(H.app(personal)),before=H.snapshot(a);if(edit==='clock')a.run(`Date=class extends Date{constructor(...xs){super(...(xs.length?xs:['2026-10-14T11:00:00.000Z']))}}`);else a.run('state.accounts[0].name="Mutated same state reference"');H.click(a,'#daily-result-full');stale(a);if(edit==='state'){a.put('oldName',JSON.parse(before.raw).accounts[0].name);a.run('state.accounts[0].name=oldName');}a.run(`Date=class extends Date{constructor(...xs){super(...(xs.length?xs:['2026-10-14T12:00:00.000Z']))}}`);H.quiet(a,before);}
 });
 test('daily independent '+label+': real ledger edit adds only existing write, requires fresh basis',()=>{
  const s=H.base(),a=ready(H.app(personal,s));a.run('change(()=>L.putAccount(state,{name:"Changed account",openingBalanceCents:100000},"account-cash"),"Changed account")');stale(a);A.deepEqual(a.value('cashHostWrites').map(x=>x.slice(0,2)),[['set',H.L.STORAGE_KEY]]);A.deepEqual(a.value('state'),H.L.putAccount(s,{name:'Changed account',openingBalanceCents:100000},'account-cash'));const after=H.snapshot(a);a.run('cashHostWrites=[];dailyFinanceWrites=[]');H.dailyBasis(a);H.quiet(a,after);
 });
 test('daily independent '+label+': modal cancellation retires pending review twice without writes',()=>{
  const a=H.dailyReview(H.dailyOpen(H.app(personal))),before=H.snapshot(a),old=H.dailyPreview(a);H.fill(old,H.dailyConsent());a.run('showRestore();closeModal();closeModal()');old.onsubmit({preventDefault(){}});A.equal(a.value('dailyCalls.filter(x=>x==="confirm").length'),0);hidden(a);a.run('render()');A.equal(a.node('#daily-review-sources').disabled,true);H.quiet(a,before);
 });
 test('daily independent '+label+': actual restore and rollback retire reviewed cash and preserve existing writer pattern',async()=>{
  const a=ready(H.app(personal)),before=H.snapshot(a);a.run('showRestore()');stale(a);const raw=H.L.backup(H.L.createEmpty());await a.node('#restore-file').onchange({target:{files:[{size:Buffer.byteLength(raw),text:async()=>raw}]}});A.deepEqual(a.value('cashHostWrites'),[]);H.set(a.node('#restore-consent'),true);H.click(a,'#confirm-restore');A.deepEqual(a.value('cashHostWrites').map(x=>x.slice(0,2)),[['set','moneygo.ledger.beforeRestore.v1'],['set',H.L.STORAGE_KEY]]);hidden(a);a.run('cashHostWrites=[];rollback()');H.click(a,'#confirm-rollback');A.equal(a.run('JSON.stringify(state)'),before.raw);hidden(a);A.deepEqual(a.value('cashHostWrites').map(x=>x.slice(0,2)),[['set',H.L.STORAGE_KEY]]);a.run('cashHostWrites=[];dailyFinanceWrites=[]');const after=H.snapshot(a);H.dailyBasis(a);H.quiet(a,after);
 });
}
for(const key of ['unrelated','moneygo.backupVerification.note.v1','moneygo.ledger.v1',null])test('daily independent index: storage event '+key+' invalidates any pending/confirmed cash report',()=>{
 const a=ready(H.app(true)),before=H.snapshot(a),old=a.node('#daily-result-full');a.windowEvent('storage',{key});stale(a);old.onclick({preventDefault(){}});hidden(a);H.quiet(a,before);
});
test('daily independent demo: reset disposes all opaque authority, old pending handler and ledger state',()=>{
 const a=H.dailyReview(H.dailyOpen(H.app(false))),old=H.dailyPreview(a);H.fill(old,H.dailyConsent());a.run('resetDemo()');H.click(a,'#confirm-demo-reset');old.onsubmit({preventDefault(){}});A.equal(a.run('active()'),false);A.equal(a.run('state'),null);A.equal(a.value('dailyCalls.filter(x=>x==="confirm").length'),0);hidden(a);H.quiet(a);
});
test('daily independent both hosts: no pre-use or post-disposal daily/basis DOM queries and no duplicated listeners on reentry',()=>{
 for(const personal of [true,false]){let allowed=false;const queries=[];const a=H.app(personal,H.base(),{beforeLoad({doc}){for(const method of ['querySelector','querySelectorAll']){const real=doc[method];doc[method]=function(selector,...args){if(!allowed&&/#(?:cash|daily)-|\[data-(?:cash|daily)-/.test(selector))queries.push({method,selector});return real.call(this,selector,...args);};}}});a.run('render();DC.invalidate();CB.invalidate();render()');A.deepEqual(queries,[]);A.equal(a.run('dailySessions.length'),0);allowed=true;ready(a);const before=Object.fromEntries([...a.winListeners].map(([k,v])=>[k,v.length]));H.click(a,'[data-page="report"]');H.dailyOpen(a);const after=Object.fromEntries([...a.winListeners].map(([k,v])=>[k,v.length]));A.deepEqual(after,before);a.run('disposeRuntime()');queries.length=0;allowed=false;a.run('DC.invalidate();CB.invalidate()');A.deepEqual(queries,[]);}
});
test('daily independent index: unavailable startup storage fails closed without creating an anchor, scenario or replacement data',()=>{
 const a=H.app(true,H.base(),{storageDenied:true});A.match(a.run('blocked'),/本地存储/);H.click(a,'[data-page="daily-cash"]');A.ok(a.node('#daily-cash-root'));A.equal(a.node('#daily-result'),null);A.equal(a.node('#daily-consent'),null);A.equal(a.value('dailyCalls.filter(x=>x==="confirmBasis"||x==="inspect"||x==="preview"||x==="confirm").length'),0);H.quiet(a);
});
