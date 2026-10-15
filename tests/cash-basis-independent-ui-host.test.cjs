'use strict';
const test=require('node:test'),H=require('./cash-basis-independent-host-harness.cjs'),{A}=H;
function scoped(a){H.set(a.node('#cash-account-account-cash'),'include');H.set(a.node('#cash-source-0'),'include');}
function preview(a){H.click(a,'#cash-preview');A.ok(a.node('#cash-consent'),a.node('#cash-status')?.textContent);A.equal(a.node('#cash-supported').textContent,'未知');return a.node('#cash-consent');}
function approve(a,form=a.node('#cash-consent')){H.fill(form,H.consent());form.onsubmit({preventDefault(){}});return form;}
function confirmed(a){scoped(a);preview(a);approve(a);A.equal(a.node('#cash-supported')?.textContent,'¥1000.00',a.node('#cash-status')?.textContent);}
function hidden(a){const headline=a.node('#cash-supported');if(headline)A.match(headline.textContent,/未知/);for(const n of a.doc.querySelectorAll('[data-cash-supported]'))A.match(n.textContent,/未知/);}
const finances=a=>a.value('cashHostFinanceCalls');
function readProof(a){let text='';for(;;){const block=a.node('#cash-proof-text');A.ok(block);A.ok(block.textContent.length<=4000);text+=block.textContent;const next=a.node('#cash-proof-next');A.ok(next);if(next.disabled)break;H.click(a,'#cash-proof-next');}return text;}
for(const personal of [true,false]){
 const label=personal?'personal':'synthetic';
 test('cash independent UI '+label+': explicit choices and four unchecked statements; preview/confirm/replay stay read-only',()=>{
  const a=H.open(H.app(personal)),before=H.snapshot(a);A.equal(a.node('#cash-account-account-cash').value,'unreviewed');A.equal(a.node('#cash-source-0').value,'unreviewed');A.equal(a.node('#cash-manual-0-checked').checked,false);A.equal(a.node('#cash-manual-0-start').value,'');A.equal(a.node('#cash-supported').textContent,'未知');
  let form=preview(a);for(const key of Object.keys(H.consent()).filter(x=>x!=='reason'))A.equal(form.elements.namedItem(key).checked,false);A.match(form.textContent,/未审阅账户 1；未审阅来源 1/);form.onsubmit({preventDefault(){}});A.equal(H.counts(a).confirm,0);H.quiet(a,before);
  scoped(a);A.equal(form.elements.namedItem('accountUniverseReviewed').checked,false);hidden(a);form=preview(a);approve(a,form);A.equal(a.node('#cash-supported').textContent,'¥1000.00');A.equal(H.counts(a).confirm,1);approve(a,form);A.equal(H.counts(a).confirm,1);H.quiet(a,before);
 });
 test('cash independent UI '+label+': changed cutoff/account/source/reason hides every supported number immediately',()=>{
  for(const edit of ['account','account-reason','source','source-reason','cutoff','cutoff-input']){const a=H.open(H.app(personal)),before=H.snapshot(a);confirmed(a);if(edit==='account')H.set(a.node('#cash-account-account-cash'),'unreviewed');if(edit==='account-reason')H.set(a.node('#cash-account-account-cash-reason'),'Changed reason','input');if(edit==='source')H.set(a.node('#cash-source-0'),'unreviewed');if(edit==='source-reason')H.set(a.node('#cash-source-0-reason'),'Changed reason','input');if(edit==='cutoff')H.set(a.node('#cash-cutoff'),'2026-10-13');if(edit==='cutoff-input')H.set(a.node('#cash-cutoff'),'2026-10-13','input');hidden(a);A.ok(H.counts(a).invalidateAll>3);H.quiet(a,before);}
 });
 test('cash independent UI '+label+': close/new inspect/new preview and section navigation invalidate captured handlers and review',()=>{
  const a=H.open(H.app(personal)),before=H.snapshot(a);scoped(a);const old=preview(a);H.click(a,'#cash-preview');const fresh=a.node('#cash-consent');approve(a,old);A.equal(H.counts(a).confirm,0);approve(a,fresh);A.equal(a.node('#cash-supported').textContent,'¥1000.00');H.click(a,'#cash-close');A.equal(a.node('#cash-supported'),null);H.click(a,'#cash-inspect');A.equal(a.node('#cash-account-account-cash').value,'unreviewed');hidden(a);confirmed(a);H.click(a,'[data-page="report"]');A.equal(a.node('#cash-supported'),null);H.click(a,'[data-page="cash-basis"]');hidden(a);A.equal(a.node('#cash-account-account-cash').value,'unreviewed');H.quiet(a,before);
 });
 test('cash independent UI '+label+': 50-row collections, full proof text pagination and filters never recalculate',()=>{
  const a=H.open(H.app(personal,H.base({count:80,accounts:75}))),before=H.snapshot(a);A.equal(a.doc.querySelectorAll('[data-cash-row="account"]').length,50);A.equal(a.doc.querySelectorAll('[data-cash-row="source"]').length,50);A.equal(a.doc.querySelectorAll('[data-cash-row="detail"]').length,50);A.equal(a.doc.querySelectorAll('[data-cash-row]').length,150);const calls=H.counts(a),financialCalls=finances(a);
  H.click(a,'#cash-accounts-next');A.equal(a.doc.querySelectorAll('[data-cash-row="account"]').length,25);A.match(a.node('#cash-accounts-count').textContent,/第 2 \/ 2 页/);H.click(a,'#cash-accounts-prev');H.click(a,'#cash-sources-next');A.equal(a.doc.querySelectorAll('[data-cash-row="source"]').length,25);H.click(a,'#cash-sources-prev');H.click(a,'#cash-details-next');A.equal(a.doc.querySelectorAll('[data-cash-row="detail"]').length,30);H.click(a,'#cash-details-prev');H.set(a.node('#cash-source-filter'),'account-cash','input');A.equal(a.doc.querySelectorAll('[data-cash-row="source"]').length,1);H.set(a.node('#cash-source-filter'),'','input');
  H.set(a.node('#cash-collection'),'proofRecords');let proofIndex=-1;while(proofIndex===-1){const rows=a.doc.querySelectorAll('[data-cash-row="detail"]');proofIndex=rows.findIndex(x=>/^snapshot · /.test(x.textContent));if(proofIndex===-1)H.click(a,'#cash-details-next');}
  H.click(a,'#cash-detail-'+proofIndex);const displayed=readProof(a),parsed=JSON.parse(displayed);A.equal(parsed.ref.kind,'snapshot');A.deepEqual(parsed.value,a.value('state.bookkeeping.snapshots[0]'));A.ok(displayed.length>4000);A.match(a.node('#cash-proof-count').textContent,new RegExp('完整文本 '+displayed.length+' 个'));A.ok(a.doc.querySelectorAll('[data-cash-row]').length<=200);A.deepEqual(H.counts(a),calls);A.deepEqual(finances(a),financialCalls);H.quiet(a,before);console.log('CASH_INDEPENDENT_PROOF_PAGINATION '+JSON.stringify({entry:a.entry,codeUnits:displayed.length,pages:Math.ceil(displayed.length/4000),maximumTextPageCodeUnits:4000,exactRawSnapshotReconstructed:true,maximumMountedRows:150,modelRecalculations:0,storageWrites:0}));
 });
 test('cash independent UI '+label+': current-page batch choices do not silently approve later pages',()=>{
  const a=H.open(H.app(personal,H.base({accounts:75,role:false,snapshot:false}))),before=H.snapshot(a);H.set(a.node('#cash-accounts-batch'),'include');H.click(a,'#cash-accounts-apply-page');H.set(a.node('#cash-sources-batch'),'include');H.click(a,'#cash-sources-apply-page');H.click(a,'#cash-accounts-next');A.ok(a.doc.querySelectorAll('[data-cash-row="account"] select').every(x=>x.value==='unreviewed'));const form=preview(a);A.match(form.textContent,/未审阅账户 25；未审阅来源 25/);approve(a,form);hidden(a);H.quiet(a,before);
 });
 test('cash independent UI '+label+': exact HTML-like retained strings stay text throughout proof browsing',()=>{
  const s=H.base({count:80});s.accounts[0].name='<img src=x onerror=independentAttack()> & text';const a=H.open(H.app(personal,s)),before=H.snapshot(a);A.equal(a.doc.querySelectorAll('img').length,0);A.match(a.node('[data-cash-row="account"]').textContent,/<img src=x onerror=independentAttack\(\)> & text/);H.set(a.node('#cash-collection'),'proofRecords');H.click(a,'#cash-detail-0');const text=readProof(a);A.ok(text.includes('<img src=x onerror=independentAttack()> & text'));A.equal(a.doc.querySelectorAll('img').length,0);H.quiet(a,before);
 });
}
for(const event of ['freeze','document-freeze','popstate','hashchange','pagehide','visibilitychange'])test('cash independent personal UI: '+event+' clears live supported values and does not resurrect consent',()=>{
 const a=H.open(H.app(true)),before=H.snapshot(a);confirmed(a);if(event==='visibilitychange'){a.doc.visibilityState='hidden';a.documentEvent(event);a.doc.visibilityState='visible';a.documentEvent(event);}else if(event==='document-freeze')a.documentEvent('freeze');else a.windowEvent(event);hidden(a);a.run('render()');hidden(a);A.equal(a.node('#cash-account-account-cash').value,'unreviewed');H.quiet(a,before);
});
test('cash independent personal UI: cross-tab ledger event retires pending form and supported values without writes',()=>{
 const a=H.open(H.app(true)),before=H.snapshot(a);scoped(a);const form=preview(a);a.windowEvent('storage',{key:H.L.STORAGE_KEY});approve(a,form);A.equal(H.counts(a).confirm,0);A.equal(a.run('stale'),true);hidden(a);H.quiet(a,before);
});
test('cash independent synthetic UI: page suspension and reset dispose state and retained handlers without personal storage',()=>{
 for(const end of ['pagehide','reset']){const a=H.open(H.app(false));scoped(a);const form=preview(a);if(end==='pagehide')a.windowEvent('pagehide');else{a.run('resetDemo()');H.click(a,'#confirm-demo-reset');}approve(a,form);A.equal(H.counts(a).confirm,0);A.equal(a.run('active()'),false);A.equal(a.run('state'),null);A.equal(a.node('#cash-supported'),null);H.quiet(a);}
});
for(const personal of [true,false])for(const change of ['midnight','clock-rollback','same-reference-state'])test('cash independent UI '+(personal?'personal':'synthetic')+': '+change+' invalidates supported pagination without financial recalculation',()=>{
 const a=H.open(H.app(personal)),before=H.snapshot(a);confirmed(a);const calls=finances(a);
 if(change==='midnight')a.run(`Date=class extends Date{constructor(...xs){super(...(xs.length?xs:['2026-10-15T12:00:00.000Z']))}}`);
 if(change==='clock-rollback')a.run(`Date=class extends Date{constructor(...xs){super(...(xs.length?xs:['2026-10-14T11:00:00.000Z']))}}`);
 if(change==='same-reference-state')a.run('state.accounts[0].name="Independent same-reference mutation"');
 H.set(a.node('#cash-collection'),'proofRecords');hidden(a);A.deepEqual(finances(a),calls,'Freshness guard must not recalculate money');
 if(change==='same-reference-state'){a.put('cashHostBeforeName',JSON.parse(before.raw).accounts[0].name);a.run('state.accounts[0].name=cashHostBeforeName');}
 a.run(`Date=class extends Date{constructor(...xs){super(...(xs.length?xs:['2026-10-14T12:00:00.000Z']))}}`);
 a.run('render()');hidden(a);H.quiet(a,before);
});
test('cash independent UI: full real retained Unicode proof pages preserve surrogate pairs and every code unit',()=>{
 let s=H.base({count:26,snapshot:false});s=H.R.addSnapshot(s,{accountId:'account-cash',date:H.day,actualBalanceCents:100000,note:'😀'.repeat(240)});const a=H.open(H.app(true,s)),before=H.snapshot(a);H.set(a.node('#cash-collection'),'proofRecords');const index=a.doc.querySelectorAll('[data-cash-row="detail"]').findIndex(x=>/^snapshot · /.test(x.textContent));A.ok(index>=0);const calls=H.counts(a),financialCalls=finances(a);H.click(a,'#cash-detail-'+index);const chunks=[];for(;;){const text=a.node('#cash-proof-text').textContent;A.ok(text.length<=4000);A.ok(!/[\uD800-\uDBFF]$/.test(text),'A page cannot end inside a surrogate pair');A.ok(!/^[\uDC00-\uDFFF]/.test(text),'A page cannot start inside a surrogate pair');chunks.push(text);if(a.node('#cash-proof-next').disabled)break;H.click(a,'#cash-proof-next');}A.ok(chunks.length>1);A.deepEqual(JSON.parse(chunks.join('')).value,a.value('state.bookkeeping.snapshots[0]'));A.deepEqual(H.counts(a),calls);A.deepEqual(finances(a),financialCalls);H.quiet(a,before);console.log('CASH_INDEPENDENT_UNICODE_PROOF '+JSON.stringify({codeUnits:chunks.join('').length,pageLengths:chunks.map(x=>x.length),exactRawSnapshotReconstructed:true}));
});
module.exports={scoped,preview,approve,confirmed,hidden,readProof};
