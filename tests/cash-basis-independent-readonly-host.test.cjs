'use strict';
const test=require('node:test'),H=require('./cash-basis-independent-host-harness.cjs'),{A}=H;
for(const personal of [true,false]){
 const label=personal?'personal':'synthetic';
 test('cash independent '+label+': literal entry order, complete read-only coordinator lifecycle and fixed-clock export preservation',()=>{
  const s=H.base({count:80}),a=H.app(personal,s),before=H.snapshot(a);
  for(const file of ['ledger.js','relations.js','cash-basis.js','cash-basis-ui.js','app-runtime-v1.js'])A.ok(a.scriptNames.includes(file),file+' must be loaded by actual HTML');
  const index=x=>a.scriptNames.indexOf(x);A.ok(index('ledger.js')<index('cash-basis.js'));A.ok(index('relations.js')<index('cash-basis.js'));A.ok(index('cash-basis.js')<index('cash-basis-ui.js'));A.ok(index('cash-basis-ui.js')<index('app-runtime-v1.js'));
  a.put('cashHostQuery',H.query(s));a.put('cashHostConsent',H.consent());
  a.run(`globalThis.cashHostDirect=window.MoneygoCashBasis.createCoordinator({now:()=>new Date().toISOString(),today:()=>today()});globalThis.cashHostCatalog=cashHostDirect.inspect(state,{asOfDate:today()});`);
  A.equal(a.run('cashHostCatalog.reviewStatus'),'unreviewed');A.equal(a.run('cashHostCatalog.accounts[0].supportedBasisCents'),null);H.quiet(a,before);
  a.run('globalThis.cashHostPreview=cashHostDirect.preview(state,cashHostQuery)');
  A.equal(a.run('cashHostPreview.report.reviewStatus'),'pending');A.deepEqual(a.value('Object.keys(cashHostPreview.ticket)'),[]);A.equal(a.run('cashHostPreview.report.accounts[0].supportedBasisCents'),null);H.quiet(a,before);
  a.run('globalThis.cashHostConfirmed=cashHostDirect.confirm(state,cashHostPreview.ticket,cashHostQuery,cashHostConsent)');
  A.equal(a.run('cashHostConfirmed.reviewStatus'),'confirmed');A.equal(a.run('cashHostConfirmed.accounts[0].supportedBasisCents'),s.bookkeeping.snapshots[0].actualBalanceCents);A.equal(a.run('cashHostDirect.isCurrent(state,cashHostConfirmed,cashHostQuery)'),true);H.quiet(a,before);
  a.run('cashHostDirect.invalidateAll()');A.equal(a.run('cashHostDirect.isCurrent(state,cashHostConfirmed,cashHostQuery)'),false);H.quiet(a,before);
  a.run('globalThis.cashHostCancelled=cashHostDirect.preview(state,cashHostQuery)');A.equal(a.run('cashHostDirect.cancel(cashHostCancelled.ticket).cancelled'),true);A.equal(a.run('cashHostDirect.cancel(cashHostCancelled.ticket).cancelled'),false);H.quiet(a,before);
 });
 test('cash independent '+label+': actual model stale/changed-state review never writes or serializes a ledger replacement',()=>{
  const s=H.base(),a=H.app(personal,s),before=H.snapshot(a);a.put('cashHostQuery',H.query(s));a.put('cashHostConsent',H.consent());
  a.run('globalThis.cashHostDirect=window.MoneygoCashBasis.createCoordinator({now:()=>new Date().toISOString(),today:()=>today()});globalThis.cashHostPreview=cashHostDirect.preview(state,cashHostQuery);globalThis.cashHostChanged=JSON.parse(JSON.stringify(state));cashHostChanged.accounts[0].name="Independent renamed account"');
  A.throws(()=>a.run('cashHostDirect.confirm(cashHostChanged,cashHostPreview.ticket,cashHostQuery,cashHostConsent)'),{code:'CASH_STALE_REVIEW'});
  A.throws(()=>a.run('cashHostDirect.confirm(state,cashHostPreview.ticket,cashHostQuery,cashHostConsent)'),{code:'CASH_REVIEW_USED'});H.quiet(a,before);
 });
 test('cash independent '+label+': cash lifecycle hooks register lazily and synthetic never subscribes to storage',()=>{
  const a=H.app(personal),before=H.snapshot(a),listeners=kind=>(a.winListeners.get(kind)||[]).length;
  A.equal(listeners('storage'),personal?1:0,'Only existing personal host ledger storage listener before cash visit');A.equal(listeners('pagehide'),personal?0:1,'No cash-specific pagehide listener before first cash visit');
  H.open(a);A.equal(listeners('storage'),personal?1:0,'Cash module must not add a generic storage listener');A.equal(listeners('pagehide'),personal?1:2);const seen={storage:listeners('storage'),pagehide:listeners('pagehide')};
  H.click(a,'[data-page="report"]');H.click(a,'[data-page="cash-basis"]');A.deepEqual({storage:listeners('storage'),pagehide:listeners('pagehide')},seen,'Revisit does not duplicate listeners');H.quiet(a,before);
 });
}
test('cash independent: pre-cash startup/render/global invalidation never query cash DOM; actual later review works in both hosts',()=>{
 for(const personal of [true,false]){
  const label=personal?'personal':'synthetic',queries=[];let cashDomAllowed=false;
  const a=H.app(personal,H.base(),{beforeLoad({doc}){for(const method of ['querySelector','querySelectorAll']){const original=doc[method];doc[method]=function(selector,...rest){if(!cashDomAllowed&&typeof selector==='string'&&(/#cash-/.test(selector)||/\[data-cash-/.test(selector)||/\.cash[-\w]*/.test(selector)))queries.push({method,selector});return original.call(this,selector,...rest);};}}});
  const before=H.snapshot(a);a.run('render();CB.invalidate();render();CB.invalidate()');A.deepEqual(queries,[],label+': no cash-specific DOM queries before cash initialization');A.equal(a.run('active()'),true);A.equal(H.counts(a).inspect,0);A.equal(H.counts(a).preview,0);A.equal(H.counts(a).confirm,0);H.quiet(a,before);
  cashDomAllowed=true;H.open(a);H.set(a.node('#cash-account-account-cash'),'include');H.set(a.node('#cash-source-0'),'include');H.click(a,'#cash-preview');const form=a.node('#cash-consent');A.ok(form,a.node('#cash-status')?.textContent);H.fill(form,H.consent());form.onsubmit({preventDefault(){}});A.equal(a.node('#cash-supported').textContent,'¥1000.00');A.equal(H.counts(a).confirm,1);H.quiet(a,before);
  a.run('disposeRuntime()');A.equal(a.run('active()'),false);queries.length=0;cashDomAllowed=false;a.run('CB.invalidate()');A.deepEqual(queries,[],label+': no cash-specific DOM queries after disposal');H.quiet(a);
 }
});
