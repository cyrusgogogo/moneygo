'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {L,R,H,harness,fixture,create,copy}=require('./held-ui-harness.cjs');
function openCreate(h,overrides={}){h.click('new');h.fields({expenseId:'pay',amount:'1000.00',name:'Recorded principal',reason:'Reviewed original source',paidPrincipalOnly:true,noTrackedWalletOverlap:true,...overrides});}
function recognize(h,id,kind,amount,date){h.click(kind,id);h.fields({amount,effectiveDate:date,categoryId:'expense-food',merchant:'Independent merchant',reference:'Receipt evidence',notAlreadyRecordedAsExpense:true,reason:'Reviewed '+kind});h.submit();assert.match(h.title,/逐项核对/,h.errors.join(';'));h.approve();}
function reverse(h,action,id){h.click(action,id);h.fields({reason:'Classification correction individually reviewed'});h.submit();assert.match(h.title,/逐项核对/,h.errors.join(';'));h.approve();}

test('held UI exact API, lazy empty view and honest recorded-principal scope',()=>{
 const h=harness(),before=h.snapshot();assert.deepEqual(Object.keys(h.UI),['render','bind','initialize','positionDetails','recognitionDetails']);
 assert.match(h.html,/单笔实付本金/);assert.match(h.html,/不是账户余额、可用现金或保证可退金额/);assert.match(h.html,/赠送额度/);assert.match(h.html,/明确的本地核对日期/);assert.deepEqual(h.snapshot(),before);assert.equal(h.state.bookkeeping,undefined);
});

test('held UI real create, separate use/loss, actual return, metadata and each reversal preserve actual cash',()=>{
 const h=harness(),raw=copy(h.state.transactions),before=R.calculate(h.state),p=create(h);
 assert.equal(h.writes,1);assert.equal(h.state.bookkeeping.version,4);
 recognize(h,p,'use','200.00','2026-02-10');recognize(h,p,'loss','50.00','2026-03-20');
 h.click('return',p);assert.doesNotMatch(h.modal,/name="effectiveDate"|name="accountId"/);h.fields({incomeId:'receipt',amount:'300.00',reference:'Actual bank receipt',reason:'Actual receipt classified'});h.submit();h.approve();
 const view=H.view(h.state,{asOfDate:'2026-04-15'}).positions[0];assert.equal(view.remainingCents,45000);assert.equal(view.usedCents,20000);assert.equal(view.lostCents,5000);assert.equal(view.returnedCents,30000);
 h.click('metadata',p);h.fields({name:'Updated description',expiryKind:'date',expiryDate:'2026-03-31',refundability:'unknown',terms:'No known refund promise',termsSource:'Paper card',reason:'Entered known expiry'});h.submit();h.approve();
 assert.match(h.html,/已过用户填写的到期日/);assert.match(h.html,/¥450.00/);assert.equal(H.view(h.state,{asOfDate:'2026-04-15'}).positions[0].remainingCents,45000);
 h.UI.positionDetails(h.ctx,p);assert.match(h.modal,/原始本金占用/);assert.match(h.modal,/审计历史/);assert.match(h.modal,/data-held-action="reverse-position"[^>]*disabled/);
 const use=h.state.bookkeeping.heldRecognitions.find(r=>r.kind==='use'),loss=h.state.bookkeeping.heldRecognitions.find(r=>r.kind==='loss'),ret=h.state.bookkeeping.heldReturns[0];
 h.UI.recognitionDetails(h.ctx,p,use.id);assert.match(h.modal,/实际现金变化 0/);assert.match(h.modal,/Independent merchant/);assert.doesNotMatch(h.modal,/data-edit/);
 reverse(h,'reverse-recognition',use.id);reverse(h,'reverse-recognition',loss.id);reverse(h,'reverse-return',ret.id);reverse(h,'reverse-position',p);
 assert.equal(h.state.bookkeeping.heldPositions.length,0);assert.equal(h.state.bookkeeping.audit.length,9);assert.equal(h.writes,9);assert.deepEqual(h.state.transactions,raw);
 const after=R.calculate(h.state);assert.deepEqual(after.cash,before.cash);assert.deepEqual(after.accountBalances,before.accountBalances);
});

test('held UI full immutable review shows source, dates, cutoffs, groups, Scenario and frozen effects before commit',()=>{
 const h=harness();openCreate(h);h.submit();assert.equal(h.writes,0);assert.equal(h.state.bookkeeping,undefined);
 for(const text of ['实际现金、账户流量','所有来源 / 收入','每个受影响月份','所有受影响历史截止日','所有分类变化','所有商户变化','沙盘基准','冻结月结','操作前完整本金权利','操作后完整本金权利','本次精确操作'])assert.ok(h.modal.includes(text),text);
 assert.equal(h.form.elements.namedItem('confirmed').checked,false);h.submit();assert.equal(h.writes,0);assert.match(h.errors.at(-1),/勾选/);h.approve();assert.equal(h.writes,1);
});

test('held UI strict amounts, explicit dates, principal and wallet assertions block invalid drafts',()=>{
 for(const overrides of [{amount:''},{amount:'1e3'},{amount:'0'},{amount:'-0'},{amount:'0.001'},{asOfDate:''},{asOfDate:'2026-01-01'},{paidPrincipalOnly:false},{noTrackedWalletOverlap:false}]){
  const h=harness(),before=h.snapshot();openCreate(h,overrides);h.submit();assert.equal(h.writes,0);assert.deepEqual(h.snapshot(),before);assert.ok(h.errors.length,JSON.stringify(overrides));assert.doesNotMatch(h.title,/逐项核对/);
 }
});

test('held UI use and loss both require explicit duplicate-expense assertion and own category',()=>{
 for(const kind of ['use','loss'])for(const missing of ['notAlreadyRecordedAsExpense','categoryId']){
  const h=harness(),p=create(h),before=h.snapshot();h.click(kind,p);h.fields({amount:'1.00',effectiveDate:'2026-03-01',categoryId:missing==='categoryId'?'':'expense-food',reason:'Separate confirmation',notAlreadyRecordedAsExpense:missing!=='notAlreadyRecordedAsExpense'});h.submit();assert.deepEqual(h.snapshot(),before);assert.ok(h.errors.length);assert.doesNotMatch(h.title,/逐项核对/);
 }
});

test('held UI source selection displays capacity/restrictions and cannot use future or conflicting real source',()=>{
 const h=harness();openCreate(h,{asOfDate:'2026-01-01'});h.form.elements.namedItem('expenseId').onchange();assert.match(h.ctx.$('#held-picked-source').innerHTML,/来源日期晚于/);assert.equal(h.ctx.$('#held-preview').disabled,true);h.submit();assert.equal(h.writes,0);
 const p=create(h);h.click('new');h.fields({expenseId:'pay'});h.form.elements.namedItem('expenseId').onchange();assert.equal(h.ctx.$('#held-preview').disabled,true);assert.match(h.ctx.$('#held-picked-source').innerHTML,/耗尽余额不会释放|本金已被完整保留/);assert.equal(h.state.bookkeeping.heldPositions[0].id,p);
});

test('held UI cannot cascade reverse position or relabel loss recovery as outstanding principal return',()=>{
 const h=harness(),p=create(h);recognize(h,p,'loss','1000.00','2026-02-01');const before=h.snapshot();h.click('reverse-position',p);h.fields({reason:'Try dependency reversal'});h.submit();assert.deepEqual(h.snapshot(),before);assert.ok(h.errors.length);
 h.click('return',p);h.fields({incomeId:'receipt',amount:'1.00',reason:'Actual receipt after loss'});h.submit();assert.deepEqual(h.snapshot(),before);assert.match(h.modal,/有效损失后的追回分类尚不支持/);assert.match(h.errors.at(-1),/剩余本金|没有可分配/);
});

test('held UI modal identity rejects a detached old confirm even when a new review is approved',()=>{
 const h=harness();openCreate(h);h.submit();const old=h.form,submit=old.onsubmit;h.fields({confirmed:true});h.close();
 openCreate(h);h.submit();h.fields({confirmed:true});const fresh=h.form;submit({preventDefault(){}});assert.equal(h.writes,0);assert.equal(h.form,fresh);h.approve();assert.equal(h.writes,1);submit({preventDefault(){}});assert.equal(h.writes,1);
});

test('held UI back/reopen invalidates old ticket and requires fresh review consent',()=>{
 const h=harness();openCreate(h);h.submit();const old=h.form;h.action('#held-back');h.fields({amount:'900.00'});h.submit();assert.equal(h.form.elements.namedItem('confirmed').checked,false);old.elements.namedItem('confirmed').checked=true;old.onsubmit({preventDefault(){}});assert.equal(h.writes,0);h.approve();assert.equal(h.state.bookkeeping.heldPositions[0].amountCents,90000);
});

test('held UI full-state stale preview preserves memory/storage/recovery and requires re-review',()=>{
 const h=harness();openCreate(h);h.submit();const changed=copy(h.state);changed.categories[0].name='Unrelated edit';h.state=changed;const before=h.snapshot();h.approve();assert.deepEqual(h.snapshot(),before);assert.equal(h.form.elements.namedItem('confirmed').checked,false);assert.equal(h.ctx.$('#held-fresh-review').hidden,false);assert.match(h.errors.at(-1),/变化|失效|改变|STALE|重新/);
 h.action('#held-fresh-review');assert.equal(h.form.elements.namedItem('confirmed').checked,false);h.approve();assert.equal(h.writes,1);
});

for(const failure of ['failWrite','staleStorage'])test('held UI '+failure+' consumes old review without any partial durable write',()=>{
 const h=harness();openCreate(h);h.submit();h[failure]=true;const before=h.snapshot(),old=h.form;h.approve();assert.deepEqual(h.snapshot(),before);assert.equal(h.ctx.$('#held-commit').disabled,true);assert.equal(old.elements.namedItem('confirmed').checked,false);old.elements.namedItem('confirmed').checked=true;old.onsubmit({preventDefault(){}});assert.deepEqual(h.snapshot(),before);
 h[failure]=false;h.action('#held-fresh-review');h.approve();assert.equal(h.writes,1);old.onsubmit({preventDefault(){}});assert.equal(h.writes,1);
});

test('held UI dispose removes listeners and invalidates pending review handlers',()=>{
 const h=harness();openCreate(h);h.submit();const old=h.form,before=h.snapshot();assert.equal(h.listenerCount,3);h.ctx.render();assert.equal(h.listenerCount,3);h.dispose();assert.equal(h.listenerCount,0);old.elements.namedItem('confirmed').checked=true;old.onsubmit({preventDefault(){}});assert.deepEqual(h.snapshot(),before);
});

test('held UI historical recognition and position routes retain captured facts after reversal and raw correction',()=>{
 const h=harness(),p=create(h);recognize(h,p,'use','200.00','2026-02-10');const id=h.state.bookkeeping.heldRecognitions[0].id;
 reverse(h,'reverse-recognition',id);reverse(h,'reverse-position',p);
 const changed=copy(h.state);changed.transactions.find(t=>t.id==='pay').amountCents=90000;changed.transactions.find(t=>t.id==='pay').date='2026-01-20';h.state=L.validateState(changed);
 h.UI.recognitionDetails(h.ctx,p,id);assert.match(h.title,/已撤销/);assert.match(h.modal,/2026-01-10/);assert.match(h.modal,/¥1000.00/);assert.doesNotMatch(h.modal,/2026-01-20/);assert.doesNotMatch(h.modal,/data-held-action="reverse-recognition"|data-edit/);assert.match(h.modal,/不会自动转给替代事件/);
 h.UI.positionDetails(h.ctx,p);assert.match(h.title,/已撤销本金/);assert.match(h.modal,/不纳入当前剩余本金/);assert.doesNotMatch(h.modal,/data-held-action="reverse-position"/);
});

test('held UI declined close keeps current review usable without borrowing future consent',async()=>{
 const h=harness();openCreate(h);h.submit();const form=h.form;
 // Simulate only the close capture listener; the host refuses closing a dirty form.
 h.attemptClose(false);assert.equal(h.form,form);await Promise.resolve();h.approve();assert.equal(h.writes,1);
});

test('held UI preserves supported multiline reason text rather than coercing it away',()=>{
 const h=harness();openCreate(h,{reason:'First evidence line\nSecond evidence line'});h.submit();h.approve('First evidence line\nSecond evidence line');assert.equal(h.writes,1);assert.equal(h.state.bookkeeping.heldPositions[0].reason,'First evidence line\nSecond evidence line');
});
