'use strict';
// Meaningful current-day UI disclosure using genuine public writers and literal host.
// This suite does not claim native layout, screen-reader or platform acceptance.
const test=require('node:test'),A=require('node:assert/strict');
const H=require('./refund-receipts-host-harness.cjs'),F=require('./spending-model-fixtures.cjs'),IF=require('./income-planning-model-fixtures.cjs');
function overviewText(a){return a.node('#bk-workspace').textContent;}
function allocatedFuture({future=2000,current=1000,status='waiting',due='2026-10-12'}={}){
 const f=H.fixture({future:true,status});let s=f.state;
 if(due!=='2026-10-12')s=H.R.updateRefundPlan(s,f.planId,{dueDate:due},'Synthetic expected-date change');
 if(current)s=H.R.allocateRefund(s,{expenseId:f.expenseId,incomeId:f.incomeId,planId:f.planId,amountCents:current,reason:'Synthetic recorded earlier receipt'});
 if(future)s=H.R.allocateRefund(s,{expenseId:f.expenseId,incomeId:f.ids['host-future'],planId:f.planId,amountCents:future,reason:'Synthetic preserved future-linked receipt'});
 return {...f,state:s};
}
test('refund UI RR-002: overview separates current receipt evidence, all-date allocation and future reservation',()=>{
 const f=allocatedFuture(),a=H.app({fixture:f}),p=H.latest(a,'overview').out.plans[0],text=overviewText(a);
 A.deepEqual([p.recordedThroughTodayCents,p.futureLinkedCents,p.allLinkedCents,p.notEvidencedByTodayCents,p.planCapacityCents,p.expenseCapacityCents],[1000,2000,3000,5000,3000,7000]);
 for(const phrase of ['截至今天已关联记录','全部日期已关联','未来日期已关联（仍占用份额）','截至今天尚无关联记录','当前计划可分配份额','原支出当前可分配份额','¥10.00','¥20.00','¥30.00','¥50.00','¥70.00','超过预计日期，待核对','不证明银行到账或商户未付款'])A.ok(text.includes(phrase),phrase);
 A.equal(a.value('state.bookkeeping.refunds.length'),2);A.equal(a.calls.preview||0,0);A.equal(a.calls.commit||0,0);A.equal(H.io(a,'set',H.KEY).length,0);
});
test('refund UI RR-002: completely reserved future plan still needs a check without freeing capacity',()=>{
 const f=allocatedFuture({future:6000,current:0}),a=H.app({fixture:f}),p=H.latest(a,'overview').out.plans[0];
 A.equal(p.needsCheck,true);A.equal(p.planCapacityCents,0);A.equal(p.futureLinkedCents,6000);A.equal(p.recordedThroughTodayCents,0);A.match(overviewText(a),/超过预计日期，待核对/);
 H.click(a,H.action(a,'refund-candidates',f.expenseId,f.planId));A.equal(H.latest(a,'candidates').out.eligibleCount,0);A.equal(H.picker(a,'incomeId').root.querySelectorAll('[data-bk-pick-id]').length,0);A.match(a.node('#modal-root').textContent,/未来日期关联仍占用份额/);A.equal(a.value('state.bookkeeping.refunds.length'),1);
});
for(const status of ['waiting','cancelled','closed'])test('refund UI RR-003: '+status+' due-today overview does not call merchant overdue',()=>{
 const f=allocatedFuture({future:0,current:0,status,due:H.DAY}),a=H.app({fixture:f});
 A.equal(H.latest(a,'overview').out.plans[0].needsCheck,false);A.doesNotMatch(overviewText(a),/超过预计日期，待核对/);A.match(overviewText(a),/预计日期是今天，非逾期/);
 A.equal(Boolean(H.action(a,'refund-candidates',f.expenseId,f.planId)),status==='waiting');A.ok(H.action(a,'refund',f.expenseId,f.planId));
});
for(const status of ['cancelled','closed'])test('refund UI RR-003: inactive '+status+' keeps shortfall without pending encouragement',()=>{
 const f=allocatedFuture({future:0,current:1000,status}),a=H.app({fixture:f});A.equal(H.latest(a,'overview').out.plans[0].notEvidencedByTodayCents,5000);A.doesNotMatch(overviewText(a),/超过预计日期，待核对/);A.match(overviewText(a),/不会重新打开计划/);A.equal(H.action(a,'refund-candidates',f.expenseId,f.planId),undefined);
 H.preview(H.draft(a,{route:'plan',planId:f.planId}));A.match(a.node('#modal-root').textContent,/计划已取消或结束/);A.equal(a.node('#entry-form').elements.namedItem('confirmed').checked,false);
});
test('refund UI RR-005: arrival of the local receipt date naturally unblocks same preserved record',()=>{
 const f=H.fixture({future:true}),a=H.app({fixture:f});H.click(a,H.action(a,'refund-candidates',f.expenseId,f.planId));H.picker(a,'incomeId').search(f.ids['host-future']);A.equal(H.picker(a,'incomeId').root.querySelector('[data-bk-pick-id]'),null);const original=a.value('state.transactions');
 H.click(a,a.node('#modal-root').querySelector('[data-close]'));a.clock.day='2026-10-15';a.clock.now='2026-10-15T12:00:00.000Z';H.click(a,H.action(a,'refund-candidates',f.expenseId,f.planId));H.picker(a,'incomeId').search(f.ids['host-future']);A.ok(H.picker(a,'incomeId').root.querySelector('[data-bk-pick-id]'));A.deepEqual(a.value('state.transactions'),original);A.equal(H.io(a,'set',H.KEY).length,0);
});
test('refund UI RR-019: both planners disclose before/after applicability and expose full proof without extra cash reservation',()=>{
 let s=F.base([F.tx('expense','expense',10000),F.tx('receipt','income',3000),F.tx('other-expense','expense',10000),F.tx('other-receipt','income',3000)]);
 s=IF.apply(s,IF.plan());s=IF.allocate(s,100,'receipt');s=IF.allocate(s,100,'other-receipt');s=F.committed(s);s=F.allocate(s,100,99900,'expense');s=F.allocate(s,100,99800,'other-expense');
 const f={state:s,expenseId:'expense',incomeId:'receipt',otherIncomeId:'other-receipt',planId:null},a=H.app({fixture:f,clock:{day:F.day,now:F.now}});H.preview(H.draft(a));const r=H.latest(a,'preview').out.review,text=a.node('#modal-root').textContent;
 A.equal(r.effects.planningAttributions.length,4);A.equal(r.capacity.before.receiptAvailableCents,3000);A.equal(r.capacity.before.expenseRefundableCents,10000);A.match(text,/计划归属不另扣一次收入或支出份额/);A.match(text,/收入计划证明|收入计划/);A.match(text,/支出计划/);A.match(text,/视图已改变，需重新核对/);
 for(const p of r.effects.planningAttributions){A.ok(text.includes(p.planId));A.ok(text.includes(p.attributionId));for(const ref of [p.storedProofRef,p.beforeViewRef,p.afterViewRef]){const button=a.node('#refund-review-body').querySelectorAll('[data-refund-proof-ref]').find(n=>n.dataset.refundProofRef===ref);A.ok(button,ref);H.click(a,button);A.ok(a.node('#refund-proof-title').textContent.includes(ref));}}
 const income=JSON.stringify(s.incomePlanning),spending=JSON.stringify(s.spendingPlanning);H.confirm(a);A.equal(a.run('JSON.stringify(state.incomePlanning)'),income);A.equal(a.run('JSON.stringify(state.spendingPlanning)'),spending);
});
for(const role of ['credit','restricted','unknown'])test('refund UI RR-007: '+role+' source is an account record rather than newly spendable cash',()=>{
 const f=H.fixture({plan:false});let s=f.state;if(role==='unknown'){s=H.O.remove(s,'profile',s.obligations.profiles[0].id,{confirmed:true,expectedRevision:s.obligations.revision,reason:'Synthetic remove recorded role'});}else{s=H.O.putProfile(s,{accountId:'account-cash',role,creditLimitCents:role==='credit'?100000:null,note:'Synthetic '+role},{confirmed:true,expectedRevision:s.obligations.revision,reason:'Synthetic account role change'},s.obligations.profiles[0].id);}
 const a=H.app({fixture:{...f,state:s}});H.preview(H.draft(a));const r=H.latest(a,'preview').out.review;A.equal(r.receipt.account.role,role);A.match(a.node('#modal-root').textContent,/不据此称为新增可花现金/);A.equal(r.effects.accountBalances.every(b=>b.deltaCents===0),true);H.confirm(a);A.equal(a.value('state.bookkeeping.refunds.length'),1);
});
test('refund UI has no direct allocator fallback, timer, storage acquisition or fabricated consent',()=>{
 const source=require('node:fs').readFileSync(require('node:path').join(H.ROOT,'dist/refund-receipts-ui.js'),'utf8');A.doesNotMatch(source,/\.allocateRefund\s*\(|localStorage|sessionStorage|\bfetch\s*\(|XMLHttpRequest|setTimeout|setInterval/);A.match(source,/coordinator\.commit/);
 const a=H.app();H.click(a,H.action(a,'refund'));const f=a.node('#entry-form');for(const key of ['expenseId','incomeId','amount','reason'])A.equal(f.elements.namedItem(key).value,'');A.equal(a.calls.preview||0,0);A.equal(a.calls.commit||0,0);
});

test('refund UI RR-025/034: candidate paging clock failure clears unusable rows visibly and preserves exact draft choice',()=>{
 const a=H.app({fixtureOptions:{count:30}});H.draft(a);const p=H.picker(a,'incomeId'),form=a.node('#entry-form'),id=form.elements.namedItem('incomeId').value;A.ok(id);a.clock.day='not-a-date';A.doesNotThrow(()=>p.search(''));A.equal(p.root.querySelectorAll('[data-bk-pick-id]').length,0);A.match(p.root.textContent,/列表不可用/);A.equal(form.elements.namedItem('incomeId').value,id);A.equal(form.elements.namedItem('amount').value,'30.00');A.equal(a.calls.preview||0,0);A.equal(a.calls.commit||0,0);A.equal(H.io(a,'set',H.KEY).length,0);a.clock.day=H.DAY;A.doesNotThrow(()=>p.search(id));A.ok(p.root.querySelector('[data-bk-pick-id]'));A.equal(form.elements.namedItem('incomeId').value,id);
});

for(const [year,month,day,expected]of [[1,1,1,'0001-01-01'],[99,3,1,'0099-03-01'],[999,12,31,'0999-12-31'],[2026,10,14,'2026-10-14'],[9999,12,31,'9999-12-31'],[2000,2,29,'2000-02-29'],[1900,3,1,'1900-03-01']])test('refund UI RR-004: actual host local date formatter preserves padded civil year '+expected,()=>{
 const a=H.app({open:false}),constructor=a.run('Date');const formatted=a.run('(()=>{const value=new Date(0);value.setHours(12,0,0,0);value.setFullYear('+year+','+(month-1)+','+day+');return formatLocalDate(value)})()');A.equal(formatted,expected);A.equal(H.L.validDate(formatted),true);A.equal(a.run('Date'),constructor);A.equal(a.calls.createCoordinator||0,0);A.equal(a.writerCalls.length,0);A.equal(H.io(a,'set',H.KEY).length,0);
});
for(const year of [0,10000,'invalid'])test('refund UI RR-025: actual host date output outside approved domain stays fail-closed '+year,()=>{
 const a=H.ready(),old=H.retained(a),before=H.snapshot(a),expression=year==='invalid'?'formatLocalDate(new Date(NaN))':'(()=>{const value=new Date(0);value.setFullYear('+year+',0,1);return formatLocalDate(value)})()';a.clock.day=a.run(expression);A.equal(H.L.validDate(a.clock.day),false);H.consent(a);A.equal(a.node('#refund-confirm').disabled,true);A.equal(a.node('#entry-form').elements.namedItem('confirmed').checked,false);H.submitReview(a);A.equal(a.calls.commit||0,0);A.equal(H.current(a,old.ticket),false);A.equal(a.run('JSON.stringify(state)'),before.state);A.equal(H.io(a,'set',H.KEY).length,0);
});
