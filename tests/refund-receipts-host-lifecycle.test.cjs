'use strict';
// RR-025/030/031: all retained callback tests use actual mounted host forms.
const test=require('node:test'),A=require('node:assert/strict'),H=require('./refund-receipts-host-harness.cjs');
const events=['close','escape','backdrop','back-to-draft','target-switch','new-dialog','page-navigation','tab-navigation','live-details','unrelated-save','restore','pagehide','bfcache-return','runtime-disposal','storage-event'];
for(const personal of [true,false])for(const origin of ['manual','candidate'])for(const event of events.filter(e=>personal||e!=='storage-event'))test('refund host RR-030 '+(personal?'personal':'synthetic')+' '+origin+': '+event+' permanently retires review and retained submit callbacks',()=>{
 const a=H.ready({personal,route:origin}),old=H.retained(a),before=H.snapshot(a);H.consent(a);
 switch(event){
  case'close':H.click(a,a.node('#modal-root').querySelector('[data-close]'));break;
  case'escape':a.documentEvent('keydown',{key:'Escape',preventDefault(){}});break;
  case'backdrop':H.click(a,'.modal-backdrop');break;
  case'back-to-draft':H.click(a,'#refund-review-back');break;
  case'target-switch':H.draft(a,{incomeId:a.fixture.otherIncomeId,amount:'10.00',reason:'Different selected source'});break;
  case'new-dialog':a.run('entry()');break;
  case'page-navigation':H.click(a,'[data-page="report"]');break;
  case'tab-navigation':H.click(a,H.action(a,'tab','audit'));break;
  case'live-details':a.run('entry('+JSON.stringify(a.fixture.incomeId)+')');break;
  case'unrelated-save':a.run('change(()=>L.putTransaction(state,{type:"expense",amountCents:1,date:"2026-10-14",accountId:"account-cash",categoryId:"expense-other",note:"Synthetic unrelated accepted save"}),"Synthetic unrelated save")');break;
  case'restore':{
   const next=H.L.putAccount(H.L.createEmpty(),{name:'Synthetic restored ledger',openingBalanceCents:12345},'account-cash');a.put('refundRestoreState',next);a.run('showRestore();restorePreview(refundRestoreState)');H.field(a,'#restore-consent',true);H.click(a,'#confirm-restore');A.equal(a.value('state.accounts[0].name'),'Synthetic restored ledger');break;
  }
  case'pagehide':a.windowEvent('pagehide');break;
  case'bfcache-return':a.windowEvent('pagehide',{persisted:true});a.windowEvent('pageshow',{persisted:true});break;
  case'runtime-disposal':a.run('disposeRuntime()');break;
  case'storage-event':a.windowEvent('storage',{key:H.KEY});break;
 }
 A.equal(H.current(a,old.ticket),false,'Boundary permanently cancels original coordinator ticket');H.staleCallbacks(a,old);A.equal(a.calls.commit||0,0);A.equal(a.writerCalls.length,1);A.equal(a.saves.length,['unrelated-save','restore'].includes(event)?1:0);
 if(a.run('active()')&&!['unrelated-save','restore'].includes(event)){A.equal(a.run('JSON.stringify(state)'),before.state);A.equal(a.run('savedRaw'),before.savedRaw);}
 A.equal(a.store.values.get(H.KEY),personal&&['unrelated-save','restore'].includes(event)?a.run('savedRaw'):before.stored);
 if(!personal){A.equal(a.counters.localStorage,0);A.equal(a.counters.sessionStorage,0);A.deepEqual(a.counters.personalIO,[]);}A.deepEqual(a.counters.forbidden,[]);
});
test('refund host RR-030: confirmed synthetic reset destroys review and cannot revive it after BFCache return',()=>{
 const a=H.ready({personal:false}),old=H.retained(a);H.consent(a);a.run('resetDemo()');H.click(a,'#confirm-demo-reset');A.equal(a.run('active()'),false);A.equal(a.counters.reloads,1);H.staleCallbacks(a,old);A.equal(H.current(a,old.ticket),false);a.windowEvent('pageshow',{persisted:true});H.staleCallbacks(a,old);A.equal(a.calls.commit||0,0);A.equal(a.counters.localStorage,0);A.equal(a.counters.sessionStorage,0);A.deepEqual(a.counters.personalIO,[]);
});
for(const event of ['focus','pageshow','visibilitychange','submit'])test('refund host RR-025: observed local midnight before '+event+' clears visual consent, retires callback and cannot be revived by clock reversion',()=>{
 const a=H.ready(),old=H.retained(a),before=H.snapshot(a);H.consent(a);a.clock.day='2026-10-15';a.clock.now='2026-10-15T00:00:00.000Z';
 if(event==='submit')H.submitReview(a);else if(event==='visibilitychange'){a.doc.visibilityState='visible';a.documentEvent(event);}else a.windowEvent(event,{persisted:false});
 A.equal(H.current(a,old.ticket),false);const c=a.node('#entry-form')?.elements.namedItem('confirmed');if(c)A.equal(c.checked,false);const b=a.node('#refund-confirm');if(b)A.equal(b.disabled,true);A.ok(a.node('#refund-refresh'),'Stale review visibly offers regeneration');A.equal(a.node('#refund-refresh').hidden,false);A.equal(H.io(a,'set',H.KEY).length,0);A.equal(a.run('JSON.stringify(state)'),before.state);
 a.clock.day=H.DAY;a.clock.now=H.NOW;A.equal(H.current(a,old.ticket),false);H.staleCallbacks(a,old);
});
for(const change of ['invalid-day','invalid-now','backward-now'])test('refund host RR-025: '+change+' expires reviewed consent and cannot save',()=>{
 const a=H.ready(),old=H.retained(a),before=H.snapshot(a);H.consent(a);if(change==='invalid-day')a.clock.day='invalid';else a.clock.now=change==='invalid-now'?'not an instant':'2026-10-14T11:59:59.000Z';H.submitReview(a);A.equal(H.io(a,'set',H.KEY).length,0);A.equal(a.run('JSON.stringify(state)'),before.state);A.equal(H.current(a,old.ticket),false);const c=a.node('#entry-form')?.elements.namedItem('confirmed');if(c)A.equal(c.checked,false);A.ok(a.node('#refund-refresh'));H.staleCallbacks(a,old);
});
test('refund host RR-025: supported local day can differ from UTC date without changing global Date or blocking valid review',()=>{
 const a=H.ready({clock:{day:'2026-10-14',now:'2026-10-15T01:00:00.000Z'}});A.equal(H.latest(a,'preview').out.review.asOfDate,'2026-10-14');A.equal(a.run('Date.name'),'Date');H.confirm(a);A.equal(a.value('state.bookkeeping.refunds.length'),1);
});
for(const missing of ['MoneygoRefundReceipts','MoneygoRefundReceiptsUI','MoneygoIncomePlanning','MoneygoSpendingPlanning'])test('refund host RR-031: missing '+missing+' fails closed without legacy direct-allocation fallback',()=>{
 const a=H.app(missing==='MoneygoIncomePlanning'||missing==='MoneygoSpendingPlanning'?{missingAfterBoot:[missing]}:{missing:[missing]}),before=H.snapshot(a),button=H.action(a,'refund');if(button&&!button.disabled)H.click(a,button);
 const form=a.node('#entry-form');if(form?.elements.namedItem('amount')){try{H.fill(form,{expenseId:a.fixture.expenseId,incomeId:a.fixture.incomeId,planId:'',amount:'30.00',reason:'Synthetic missing dependency attempt'});form.dispatch('submit');}catch(error){A.fail('Missing-module action must produce a visible bounded error, not throw to host: '+error.message);}}
 A.equal(a.calls.commit||0,0);if(missing==='MoneygoRefundReceipts'||missing==='MoneygoRefundReceiptsUI')A.equal(a.writerCalls.length,0);A.equal(a.saves.length,0);A.equal(H.io(a,'set',H.KEY).length,0);A.equal(a.run('JSON.stringify(state)'),before.state);A.ok(/未加载|不可用|无法|缺少|失败/.test(a.node('#modal-root').textContent+' '+a.node('#bk-workspace')?.textContent),'Dependency failure is visible');A.deepEqual(a.counters.forbidden,[]);
});

test('refund host RR-031: synthetic storage notifications do not access personal storage or mutate the private ledger',()=>{const a=H.ready({personal:false}),before=H.snapshot(a);a.windowEvent('storage',{key:H.KEY,newValue:'untrusted external storage notification'});H.quiet(a,before);A.equal(a.calls.commit||0,0);});

for(const event of ['close','navigation','new-dialog','dispose'])test('refund host RR-030: retained candidate draft submit, picker, paging and inspection callbacks after '+event+' are inert',()=>{
 const a=H.app({fixtureOptions:{count:30}});H.click(a,H.action(a,'refund-candidates',a.fixture.expenseId,a.fixture.planId));const form=a.node('#entry-form'),p=H.picker(a,'incomeId');p.search(a.fixture.incomeId);p.pick(a.fixture.incomeId);p.search('');H.fill(form,{amount:'10.00',reason:'Retained synthetic draft callback'});const list=p.root.querySelector('[data-bk-pick-list]'),search=p.root.querySelector('[data-bk-search]'),next=p.root.querySelector('[data-bk-pick-next]'),pick=list.querySelector('[data-bk-pick-id]'),inspect=list.querySelector('[data-refund-inspect]'),submit=form.onsubmit,searchCallback=search.oninput,nextCallback=next.onclick,listCallback=list.onclick;
 if(event==='close')H.click(a,a.node('#modal-root').querySelector('[data-close]'));else if(event==='navigation')H.click(a,'[data-page="report"]');else if(event==='new-dialog')a.run('entry()');else a.run('disposeRuntime()');const counts={preview:a.calls.preview||0,inspect:a.calls.inspect||0,candidates:a.calls.candidates||0,commit:a.calls.commit||0,calculate:a.financial.calculate};submit?.call(form,{preventDefault(){}});searchCallback?.call(search,{target:search});nextCallback?.call(next,{target:next});listCallback?.call(list,{target:pick});listCallback?.call(list,{target:inspect});form.dispatch('submit');pick?.click();inspect?.click();A.deepEqual({preview:a.calls.preview||0,inspect:a.calls.inspect||0,candidates:a.calls.candidates||0,commit:a.calls.commit||0,calculate:a.financial.calculate},counts);A.equal(H.io(a,'set',H.KEY).length,0);A.deepEqual(a.counters.forbidden,[]);
});

test('refund host RR-022: a financially neutral unsaved source note change clears visible consent and preserves the exact original draft',()=>{
 const a=H.ready(),old=H.retained(a);H.consent(a);a.put('changedRefundIncomeId',a.fixture.incomeId);a.run('const tx=state.transactions.find(t=>t.id===changedRefundIncomeId);state=L.putTransaction(state,{...tx,note:"Synthetic financially neutral source change"},tx.id)');const changed=a.run('JSON.stringify(state)');a.windowEvent('focus');A.equal(a.node('#entry-form').elements.namedItem('confirmed').checked,false);A.equal(a.node('#refund-confirm').disabled,true);A.equal(a.node('#refund-review-status').dataset.current,'false');A.equal(a.node('#refund-refresh').hidden,false);A.equal(H.current(a,old.ticket),false);H.staleCallbacks(a,old);A.equal(a.calls.commit||0,0);A.equal(H.io(a,'set',H.KEY).length,0);A.equal(a.run('JSON.stringify(state)'),changed);H.click(a,'#refund-review-back');A.equal(a.node('#entry-form').elements.namedItem('reason').value,'Explicit synthetic exact refund review');
});
