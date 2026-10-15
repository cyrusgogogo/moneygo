'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {harness, fixture, transaction, L, R} = require('./transfer-ui-harness.cjs');
function rows(cents=10001) {return [transaction('out','expense',cents,'2026-09-30',{accountId:'bank',note:'本人转出'}),transaction('in','income',cents,'2026-10-02',{note:'现金到账'}),transaction('fee','expense',1,'2026-09-30',{accountId:'bank',note:'另记手续费'})];}
function choose(h, origin='out', counterpart='in') {h.click('transfer',origin);h.picker(origin==='in'?'expenseId':'incomeId').pick(counterpart);h.submit();}
function pair(h){choose(h);h.fields({reason:'已核对两个本人账户与原始凭证',confirmed:true});h.submit();}

test('new scope, candidate list and no-counterpart state are explicit and entirely read-only',()=>{
 const h=harness(fixture([rows()[0]])); const before=JSON.stringify(h.state);h.click('tab','transfers');assert.match(h.html,/未配对 · 用途待人工确认/);assert.match(h.html,/不表示它们一定是转账/);assert.match(h.html,/不会生成收入/);assert.match(h.html,/已有的现金账户/);assert.match(h.html,/不能再添加一笔完整手工转账/);assert.match(h.html,/手续费单独记支出/);h.click('transfer','out');assert.equal(h.form.elements.namedItem('incomeId').value,'');assert.match(h.picker('incomeId').count,/0 笔/);h.submit();assert.match(h.errors.at(-1),/选择实际转入/);assert.equal(h.writes,0);assert.equal(JSON.stringify(h.state),before);
 const summary=h.UI.reportSummary(h.ctx,'2026-09');assert.match(summary,/对外现金流出/);assert.match(summary,/账户总流出/);assert.match(summary,/跨日、跨月配对不会把到账提前/);assert.match(summary,/不是银行实时在途状态/);
});

test('pair requires explicit two-leg selection and ownership/evidence confirmation, preserving exact cents and originals',()=>{
 const h=harness(fixture(rows())), before=JSON.stringify(h.state.transactions);h.click('transfer');assert.equal(h.form.elements.namedItem('expenseId').value,'');assert.equal(h.form.elements.namedItem('incomeId').value,'');h.submit();assert.match(h.errors.at(-1),/选择实际转出/);h.picker('expenseId').pick('out');assert.equal(h.form.elements.namedItem('incomeId').value,'');h.picker('incomeId').pick('in');h.submit();assert.match(h.modal,/原日期不同：2026-09-30 转出，2026-10-02 转入/);assert.match(h.modal,/¥100.01/);assert.match(h.modal,/来源名称和渠道也不是配对证明/);h.fields({reason:'核对本人转移'});h.submit();assert.match(h.errors.at(-1),/明确确认本人账户/);assert.equal(h.writes,0);h.fields({confirmed:true});const form=h.form;h.submit();assert.equal(h.writes,1);assert.equal(h.state.bookkeeping.transferPairs.length,1);assert.equal(JSON.stringify(h.state.transactions),before);assert.equal(h.state.bookkeeping.transferPairs[0].amountCents,10001);form.onsubmit({preventDefault(){}});assert.equal(h.writes,1,'dismissed form cannot be re-submitted');
 const sep=R.calculate(h.state,'2026-09'),oct=R.calculate(h.state,'2026-10');assert.equal(sep.cash.expenseCents,1);assert.equal(sep.accountFlows.outflowCents,10002);assert.equal(sep.personal.expenseCents,1);assert.equal(oct.cash.incomeCents,0);assert.equal(oct.accountFlows.inflowCents,10001);assert.equal(oct.personal.incomeCents,0);
});

test('starting from income retains only that explicit origin; expense counterpart is never auto-selected',()=>{
 const h=harness(fixture(rows()));h.click('transfer','in');assert.equal(h.form.elements.namedItem('incomeId').value,'in');assert.equal(h.form.elements.namedItem('expenseId').value,'');assert.match(h.picker('expenseId').list.innerHTML,/out/);assert.doesNotMatch(h.picker('expenseId').list.innerHTML,/fee/);h.picker('expenseId').pick('out');assert.equal(h.form.elements.namedItem('incomeId').value,'in');h.submit();assert.match(h.title,/确认本人账户转账配对/);assert.equal(h.writes,0);
});

test('all counterpart rows beyond API maximum are reachable; search/pages preserve a choice and base changes clear incompatible choice',()=>{
 const many=Array.from({length:135},(_,i)=>transaction('in-'+String(i).padStart(3,'0'),'income',10001,'2026-10-02'));
 const h=harness(fixture([rows()[0],transaction('out-small','expense',1,'2026-09-30',{accountId:'bank'}),...many]));h.click('transfer','out');const picker=h.picker('incomeId');assert.match(picker.count,/1–25 \/ 135/);for(let i=0;i<5;i++)picker.next();assert.match(picker.list.innerHTML,/in-134/);picker.pick('in-134');picker.search('in-000');assert.equal(h.form.elements.namedItem('incomeId').value,'in-134');assert.match(picker.picked.innerHTML,/in-134/);picker.search('');assert.equal(h.form.elements.namedItem('incomeId').value,'in-134');h.picker('expenseId').pick('out-small');assert.equal(h.form.elements.namedItem('incomeId').value,'');assert.match(h.picker('incomeId').count,/0 笔/);assert.equal(h.writes,0);
});

test('candidate filters exclude same account, wrong cents, native transfers, duplicate shadows and financial dependencies',()=>{
 let s=fixture([...rows(),transaction('same-account','income',10001,'2026-10-02',{accountId:'bank'}),transaction('wrong-cents','income',10000,'2026-10-02'),transaction('shadow','income',10001,'2026-10-02'),transaction('native','transfer',10001,'2026-10-02',{accountId:'bank',toAccountId:'account-cash',categoryId:null})]);
 s=R.linkEvidence(s,{primaryId:'in',shadowId:'shadow',reason:'重复证据'});const h=harness(s);h.click('transfer','out');assert.match(h.picker('incomeId').list.innerHTML,/data-bk-pick-id="in"/);for(const id of ['same-account','wrong-cents','shadow','native'])assert.doesNotMatch(h.picker('incomeId').list.innerHTML,new RegExp('data-bk-pick-id="'+id+'"'));
 h.state=R.addRefundPlan(h.state,{expenseId:'out',expectedAmountCents:10001,status:'waiting',note:'已有计划'});h.ctx.closeModal();h.click('transfer','out');assert.match(h.errors.at(-1),/其他依赖/);assert.equal(h.writes,0);
});

test('forged mismatched selection cannot reach confirmation or change the ledger',()=>{
 const h=harness(fixture([...rows(),transaction('wrong','income',9,'2026-10-02')]));h.click('transfer','out');h.fields({incomeId:'wrong'});h.submit();assert.match(h.errors.at(-1),/配对必须/);assert.equal(h.writes,0);assert.equal(h.state.bookkeeping,undefined);
});

test('cancel and declining modal replacement preserve both ledger and selected inputs',()=>{
 const h=harness(fixture(rows())),before=JSON.stringify(h.state);h.click('transfer','out');h.picker('incomeId').pick('in');h.setConfirm(false);h.click('details','out');assert.match(h.title,/选择本人转移/);assert.equal(h.form.elements.namedItem('incomeId').value,'in');h.cancel();assert.ok(h.form);h.setConfirm(true);h.cancel();assert.equal(h.modal,'');assert.equal(JSON.stringify(h.state),before);assert.equal(h.writes,0);choose(h);h.fields({reason:'只填写不确认',confirmed:true});h.cancel();assert.equal(JSON.stringify(h.state),before);
});

test('storage failure and external stale guard keep confirmation, original state and zero writes',()=>{
 for(const options of [{failPersist:true},{stale:true}]){const h=harness(fixture(rows()),options),before=JSON.stringify(h.state);choose(h);h.fields({reason:'核对过但不能保存',confirmed:true});h.submit();assert.equal(JSON.stringify(h.state),before);assert.equal(h.writes,0);assert.ok(h.form);assert.equal(h.form.elements.namedItem('reason').value,'核对过但不能保存');assert.match(h.errors.at(-1),options.failPersist?/存储失败/:/另一个页面/);}
});

test('in-place row changes during selection and latest dependencies during final confirmation are rejected atomically',()=>{
 const h=harness(fixture(rows()));h.click('transfer','out');h.picker('incomeId').pick('in');h.state.transactions[1].date='2026-10-03';h.submit();assert.match(h.errors.at(-1),/核对期间/);assert.equal(h.writes,0);h.ctx.closeModal();choose(h);h.state=R.createClaim(h.state,{expenseId:'out',amountCents:1,name:'已有应收',kind:'advance',status:'unsubmitted'});const before=JSON.stringify(h.state);h.fields({reason:'旧确认不能覆盖新应收',confirmed:true});h.submit();assert.match(h.errors.at(-1),/核对期间/);assert.equal(JSON.stringify(h.state),before);assert.equal(h.writes,0);
});

test('paired details disclose original movement and pair identity, while refund/claim/plan actions are gated',()=>{
 const h=harness(fixture(rows()));pair(h);for(const id of ['out','in']){const detail=h.UI.transactionDetails(h.ctx,id);assert.match(detail,/已确认本人账户/);assert.match(detail,/本账户实际变动/);assert.match(detail,/金额和日期未被改写/);assert.match(detail,/data-bk-id="out"/);assert.match(detail,/data-bk-id="in"/);assert.doesNotMatch(detail,/data-bk-action="(?:refund|claim|plan|transfer)"/);assert.match(detail,/data-bk-kind="transferPair"/);}
 h.click('tab','transfers');assert.match(h.html,/两边证据保留/);h.click('tab','audit');assert.match(h.html,/本人账户转账配对/);
});

test('unlink requires explicit checkbox/reason, preserves original evidence and balances, then restores external/personal income and expense',()=>{
 let s=fixture([...rows(),transaction('copy','expense',10001,'2026-09-30',{accountId:'bank'})]);s=R.linkEvidence(s,{primaryId:'out',shadowId:'copy',reason:'主支出另有证据'});const h=harness(s);pair(h);const id=h.state.bookkeeping.transferPairs[0].id,before=JSON.stringify(h.state.transactions),balances=R.calculate(h.state).accountBalances;h.click('unlink',id,{bkKind:'transferPair'});assert.match(h.modal,/恢复为独立支出与收入/);h.fields({reason:'更正配对'});h.submit();assert.match(h.errors.at(-1),/先确认恢复/);assert.equal(h.writes,1);h.fields({confirmed:true});h.submit();assert.equal(h.writes,2);assert.equal(h.state.bookkeeping.transferPairs.length,0);assert.equal(h.state.bookkeeping.links.length,1);assert.equal(JSON.stringify(h.state.transactions),before);assert.deepEqual(R.calculate(h.state).accountBalances,balances);assert.equal(R.calculate(h.state).cash.incomeCents,10001);assert.equal(R.calculate(h.state).personal.expenseCents,10002);
});

test('unlink with changed evidence review and failed persistence both leave the pair intact',()=>{
 const h=harness(fixture(rows()));pair(h);const id=h.state.bookkeeping.transferPairs[0].id;h.click('unlink',id,{bkKind:'transferPair'});h.state.accounts[0].name='账户名已更正';h.fields({reason:'旧确认',confirmed:true});h.submit();assert.match(h.errors.at(-1),/核对期间/);assert.equal(h.state.bookkeeping.transferPairs.length,1);
 const failed=harness(h.state,{failPersist:true});failed.click('unlink',id,{bkKind:'transferPair'});failed.fields({reason:'已确认撤销',confirmed:true});const before=JSON.stringify(failed.state);failed.submit();assert.equal(JSON.stringify(failed.state),before);assert.equal(failed.writes,0);assert.match(failed.errors.at(-1),/存储失败/);
});

test('account flow drilldowns use original dated source rows; external cash excludes paired legs and native transfer shows both sides',()=>{
 let s=fixture([...rows(),transaction('native','transfer',25,'2026-10-03',{accountId:'bank',toAccountId:'account-cash',categoryId:null})]);s=R.pairTransfer(s,{expenseId:'out',incomeId:'in',reason:'原日期保留'});const h=harness(s);h.click('drilldown','account-inflow',{bkMonth:'2026-10'});let html=h.ctx.$('#bk-modal-rows').innerHTML;assert.match(html,/data-bk-id="in"/);assert.doesNotMatch(html,/data-bk-id="out"/);assert.match(html,/2026-10-02/);assert.match(html,/native/);assert.match(html,/−¥0.25/);assert.match(html,/¥100.01/);h.click('drilldown','cash-income',{bkMonth:'2026-10'});assert.doesNotMatch(h.ctx.$('#bk-modal-rows').innerHTML,/data-bk-id="in"/);h.click('drilldown','transfer-principal',{bkMonth:'2026-10'});assert.doesNotMatch(h.ctx.$('#bk-modal-rows').innerHTML,/data-bk-id="in"/);assert.match(h.ctx.$('#bk-modal-rows').innerHTML,/native/);h.click('drilldown','account-net',{bkMonth:'2026-09'});assert.match(h.ctx.$('#bk-modal-rows').innerHTML,/out/);assert.match(h.ctx.$('#bk-modal-rows').innerHTML,/fee/);assert.equal(h.writes,0);
});

test('difference hypotheses disclose exact signed deltas, unknown coverage, manual checking and no adjustment action',()=>{
 let s=fixture([transaction('expense','expense',100,'2026-10-01')]);s=R.addSnapshot(s,{accountId:'account-cash',date:'2026-10-01',actualBalanceCents:0,note:'实际余额'});const h=harness(s),before=JSON.stringify(h.state);h.click('tab','snapshots');assert.match(h.html,/查看差额核对线索/);h.click('difference-candidates',s.bookkeeping.snapshots[0].id);assert.match(h.modal,/差额 \+¥1.00/);assert.match(h.modal,/覆盖状态：未知/);assert.match(h.modal,/没有可信度或概率排名/);assert.match(h.modal,/不生成补平交易/);const html=h.ctx.$('#bk-modal-rows').innerHTML;assert.match(html,/假设造成的账本余额变化 \+¥1.00/);assert.match(html,/金额相等不证明该假设为真/);assert.match(html,/data-bk-action="details"/);assert.doesNotMatch(html,/data-bk-action="(?:pair|transfer|unlink|adjust)"/);assert.equal(JSON.stringify(h.state),before);assert.equal(h.writes,0);
});

test('zero and negative differences remain distinct; zero rows do not become adjustment candidates',()=>{
 for(const [actual,expected] of [[100,'零'],[0,'−¥1.00']]){let s=fixture([transaction('income','income',100,'2026-10-01')]);s=R.addSnapshot(s,{accountId:'account-cash',date:'2026-10-01',actualBalanceCents:actual,note:'已核对'});const h=harness(s),before=JSON.stringify(h.state);h.click('difference-candidates',s.bookkeeping.snapshots[0].id);if(actual===100){assert.match(h.modal,/差额为零/);assert.match(h.ctx.$('#bk-modal-rows').innerHTML,/差额为零/);assert.match(h.modal,/一致仍不代表来源已完整/);}else{assert.match(h.modal,/−¥1.00/);assert.match(h.ctx.$('#bk-modal-rows').innerHTML,/变化 −¥1.00/);}assert.equal(JSON.stringify(h.state),before);assert.equal(h.writes,0);}
});

test('difference candidate pagination reaches beyond 100 without silently truncating',()=>{
 let s=fixture(Array.from({length:135},(_,i)=>transaction('expense-'+String(i).padStart(3,'0'),'expense',1,'2026-10-01')));s=R.addSnapshot(s,{accountId:'account-cash',date:'2026-10-01',actualBalanceCents:-134,note:'一分差额'});const h=harness(s);h.click('difference-candidates',s.bookkeeping.snapshots[0].id);assert.match(h.ctx.$('#bk-modal-count').textContent,/1–25 \/ 135/);for(let i=0;i<5;i++)h.ctx.$('#bk-modal-next').onclick();assert.match(h.ctx.$('#bk-modal-count').textContent,/126–135 \/ 135/);assert.match(h.ctx.$('#bk-modal-rows').innerHTML,/expense-134/);assert.equal(h.ctx.$('#bk-modal-next').disabled,true);assert.equal(h.writes,0);
});

test('malicious notes, account names, source identities and reasons are escaped in picker, confirmation, pair view and hypotheses',()=>{
 const attack='<img src=x onerror="bad()">',s=fixture(rows());s.transactions[0].note=attack;s.accounts[1].name=attack;s.imports={evidence:[{id:'ev',transactionId:'out',sourceKey:attack,status:attack,stableId:attack,mapped:{channel:attack},accountId:'bank'}]};const h=harness(s);choose(h);assert.doesNotMatch(h.modal,/<img src=x/);assert.match(h.modal,/&lt;img/);h.fields({reason:attack,confirmed:true});h.submit();h.click('tab','transfers');assert.doesNotMatch(h.html,/<img src=x/);assert.match(h.html,/&lt;img/);assert.doesNotMatch(h.UI.transactionDetails(h.ctx,'out'),/<img src=x/);
});

test('new controls expose accessible labels, native semantics and local-only code; no new storage or network',()=>{
 const h=harness(fixture(rows()));choose(h);assert.match(h.modal,/<label class="confirm-check"><input type="checkbox" name="confirmed" required>/);h.ctx.closeModal();h.click('transfer','out');assert.match(h.modal,/aria-live="polite"/);assert.match(h.modal,/<legend>1\. 本人账户实际转出/);assert.match(h.picker('incomeId').list.innerHTML,/aria-pressed="false"/);const source=fs.readFileSync(path.join(__dirname,'../dist/relations-ui.js'),'utf8');assert.doesNotMatch(source,/\bfetch\s*\(|XMLHttpRequest|localStorage|setInterval|setTimeout|Notification|https?:\/\//);assert.equal(h.writes,0);
});

test('generic refund-plan, claim and refund pickers also exclude paired original legs',()=>{
 const h=harness(fixture(rows()));pair(h);for(const action of ['plan','claim','refund']){h.ctx.closeModal();h.click(action);assert.doesNotMatch(h.picker('expenseId').list.innerHTML,/data-bk-pick-id="out"/);assert.match(h.picker('expenseId').list.innerHTML,/data-bk-pick-id="fee"/);}h.ctx.closeModal();h.click('refund');assert.doesNotMatch(h.picker('incomeId').list.innerHTML,/data-bk-pick-id="in"/);assert.equal(h.writes,1);
});
