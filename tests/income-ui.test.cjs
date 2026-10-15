'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const f=require('./income-ui-harness.cjs');
const {L,R,P,base,tx,seeded,linked,apply,plan,pid,rid,change,copy,app,click,action,fields,submit,errors,approve,create,details,allocate,operation,snapshot,isolated}=f;
const current=a=>a.value('state'),view=a=>P.view(current(a),{asOfDate:'2026-10-14'});
function openNew(a,extra={}){action(a,'new');fields(a,{name:'Synthetic expectation',certainty:'expectation',amount:'',expectedDate:'',expectedAccountId:'',basis:'',note:'',...extra});}
function pageText(a){return a.node('#income-root')?.textContent||a.node('#app').textContent;}

test('income packaged entry loads actual UI scripts; empty read is lazy and global actual sources remain visible',()=>{
 const a=app(base([tx('unassociated','income',10000),tx('future','income',20000,'2026-11-01')]));const before=snapshot(a);
 assert.ok(a.scriptNames.includes('income-planning-ui.js'));assert.deepEqual(a.value('Object.keys(window.MoneygoIncomePlanningUI)'),['render','bind','initialize','invalidate','planDetails']);
 assert.match(pageText(a),/尚无符合条件/);assert.match(pageText(a),/unassociated/);assert.match(pageText(a),/future/);assert.match(pageText(a),/未来原始记录/);assert.match(pageText(a),/未关联份额不是未占用现金/);assert.equal(a.run('state.incomePlanning'),undefined);assert.equal(a.run('state.version'),1);assert.deepEqual(snapshot(a),before);isolated(a);
});

test('income unknown expectation create preview cancellation preserves exact bytes, confirmed create persists and personal refresh reloads',()=>{
 const a=app(L.createEmpty(),{personal:true}),before=snapshot(a);openNew(a);submit(a);assert.equal(a.node('#income-commit').disabled,false,errors(a));assert.deepEqual(snapshot(a),before);assert.match(a.node('.modal').textContent,/待确认/);click(a,'[data-close]');assert.deepEqual(snapshot(a),before);assert.ok(a.counts.cancel>=1);
 const id=create(a,{certainty:'expectation',amount:'',expectedDate:'',expectedAccountId:'',basis:''});const s=current(a),p=P.view(s,{asOfDate:'2026-10-14'}).plans[0];assert.equal(s.version,7);assert.equal(p.plan.id,id);assert.equal(p.receivedCents,0);assert.equal(p.remainingCents,null);assert.equal(p.progress,'target-unknown');assert.equal(s.transactions.length,0);
 const b=app(s,{personal:true});assert.match(pageText(b),/目标未知/);assert.equal(b.run('state.incomePlanning.plans.length'),1);
});

test('income confirmed basis and invalid amounts/dates block before any write',()=>{
 for(const extra of [{certainty:'confirmed-plan',basis:''},{amount:'1e3'},{amount:'0'},{amount:'-0'},{amount:'0.001'},{expectedDate:'2025-02-29'},{asOfDate:'2026-10-15'},{horizonEnd:'2026-10-14'}]){
  const a=app(),before=snapshot(a);openNew(a,extra);submit(a);assert.deepEqual(snapshot(a),before);assert.ok(errors(a),JSON.stringify(extra));if(a.node('#income-commit'))assert.equal(a.node('#income-commit').disabled,true);
 }
});

test('income actual rendered create, split actual allocation, metadata, cancel/reopen, reversal and retirement preserve finance',()=>{
 const a=app(base([tx('a','income',40000),tx('b','income',60000)])),original=current(a),fin=R.calculate(original),id=create(a);
 allocate(a,id,'a','400.00');assert.equal(view(a).plans[0].remainingCents,60000);allocate(a,id,'b','600.00');assert.equal(view(a).plans[0].progress,'complete');
 details(a,id);action(a,'edit',id);fields(a,{name:'Updated synthetic income',expectedDate:'',note:'New note'});submit(a);approve(a);assert.equal(view(a).plans[0].progress,'complete');
 operation(a,id,'cancel');assert.equal(view(a).plans[0].plan.status,'cancelled');details(a,id);assert.equal(a.doc.querySelectorAll('[data-income-action]').find(n=>n.dataset.incomeAction==='allocate').disabled,true);click(a,'[data-close]');operation(a,id,'reopen');
 for(const receipt of current(a).incomePlanning.receipts)operation(a,id,'reverse',receipt.id);
 operation(a,id,'retire');assert.equal(current(a).incomePlanning.plans.length,0);assert.match(pageText(a),/退役计划/);details(a,id);assert.match(a.node('.modal').textContent,/已退役/);assert.match(a.node('.modal').textContent,/Updated synthetic income/);
 assert.deepEqual(current(a).transactions,original.transactions);assert.deepEqual(R.calculate(current(a)).cash,fin.cash);assert.equal(R.calculate(current(a)).personal.incomeCents,100000);isolated(a);
});

test('income review renders complete v3 data, all modes, original capture and financial components before saving',()=>{
 const a=app(seeded({receipt:'partial'})),id=pid(current(a));details(a,id);action(a,'edit',id);fields(a,{expectedDate:'2026-10-01',expectedAccountId:'bank',basis:'New exact confirmation'});submit(a);
 assert.equal(a.node('#income-commit').disabled,false,errors(a));const text=a.node('#income-review-body').textContent;
 for(const value of ['目标计划','New exact confirmation','原捕获','当前完整 proof','不一致','全部当前收入侧减项','同源全部适用归属','仅确定','按计划','保守','窗口完整假设收入','个人消费变化','实际流入变化','实际流出变化','余额变化','allOtherSubtreesEqual','完整不可变复核 payload'])assert.ok(text.includes(value),value);
 assert.equal(a.node('#entry-form').elements.namedItem('confirmed').checked,false);const before=snapshot(a);submit(a);assert.deepEqual(snapshot(a),before);assert.match(errors(a),/勾选/);approve(a);
});

test('income mixed raw100000/refund20000/settlement10000 only offers ordinary70000 and exposes all reductions',()=>{
 let s=base([tx('source'),tx('spend','expense',100000)]);s=R.allocateRefund(s,{expenseId:'spend',incomeId:'source',amountCents:20000,reason:'Synthetic refund'});s=R.createClaim(s,{expenseId:'spend',name:'Synthetic claim',amountCents:10000,kind:'advance',status:'submitted',dueDate:null,note:''});s=R.settleClaim(s,{claimId:s.bookkeeping.claims[0].id,incomeId:'source',amountCents:10000,reason:'Synthetic settlement'});
 const a=app(s),id=create(a);details(a,id);action(a,'allocate',id);fields(a,{transactionId:'source',amount:'700.00'});a.node('#entry-form').elements.namedItem('transactionId').dispatch('change');assert.match(a.node('#income-picked-source').textContent,/700.00/);submit(a);const text=a.node('#income-review-body').textContent;for(const n of ['1,000.00','200.00','100.00','700.00','refund','settlement'])assert.ok(text.includes(n),n);approve(a);assert.equal(view(a).plans[0].receivedCents,70000);
});

test('income stale same-plan40000+60000 repair retains unknown until both items reconfirm atomically',()=>{
 let s=apply(base([tx('source','income',120000)]),plan());s=f.modelAllocate(s,40000);s=f.modelAllocate(s,60000);s=change(s,'source',{amountCents:100000});
 const a=app(s),id=pid(s),ids=s.incomePlanning.receipts.map(r=>r.id);assert.match(pageText(a),/待复核/);assert.equal(view(a).plans[0].receivedCents,null);
 operation(a,id,'reconfirm',ids[0]);assert.equal(view(a).plans[0].knownApplicableCents,40000);assert.equal(view(a).plans[0].receivedCents,null);operation(a,id,'reconfirm',ids[1]);assert.equal(view(a).plans[0].receivedCents,100000);assert.equal(view(a).plans[0].remainingCents,0);assert.equal(current(a).incomePlanning.audit.length,s.incomePlanning.audit.length+4);assert.equal(current(a).transactions[0].amountCents,100000);
});

test('income source shrink rejects fixed reconfirm without auto-shrink; explicit reverse then allocate repairs',()=>{
 let s=apply(base([tx('source','income',120000)]),plan());s=f.modelAllocate(s,40000);s=f.modelAllocate(s,60000);s=change(s,'source',{amountCents:90000});
 const a=app(s),id=pid(s),ids=s.incomePlanning.receipts.map(r=>r.id);operation(a,id,'reconfirm',ids[0]);details(a,id);action(a,'reconfirm',ids[1]);assert.equal(a.node('#income-preview').disabled,true);assert.match(a.node('#income-picked-source').textContent,/500.00/);assert.match(a.node('#income-picked-source').textContent,/600.00/);const before=snapshot(a);submit(a);assert.deepEqual(snapshot(a),before);assert.equal(a.node('#income-commit').disabled,true);click(a,'[data-close]');operation(a,id,'reverse',ids[1]);allocate(a,id,'source','500.00');assert.equal(view(a).plans[0].receivedCents,90000);assert.equal(view(a).plans[0].remainingCents,10000);
});

test('income missing source remains visible, original capture survives and reverse needs no fabricated proof',()=>{
 let s=seeded({receipt:'partial'});s.transactions=[];s=L.validateState(s);const a=app(s),id=pid(s);assert.match(pageText(a),/当前来源已不存在/);details(a,id);action(a,'reverse',rid(s));submit(a);assert.equal(a.node('#income-commit').disabled,false,errors(a));assert.match(a.node('#income-review-body').textContent,/当前完整 proof不可得/);assert.match(a.node('#income-review-body').textContent,/2026-10-01/);approve(a);assert.equal(view(a).plans[0].receivedCents,0);assert.equal(current(a).transactions.length,0);
});

test('income cancelled stale plan can reconfirm and reverse while new allocation remains disabled',()=>{
 const s=seeded({status:'cancelled',receipt:'stale'}),a=app(s),id=pid(s);operation(a,id,'reconfirm',rid(s));assert.equal(view(a).plans[0].plan.status,'cancelled');assert.equal(P.project(current(a),{asOfDate:'2026-10-14',horizonEnd:'2027-01-31',mode:'planned'}).scheduledTotalCents,0);details(a,id);assert.equal(a.doc.querySelectorAll('[data-income-action]').find(n=>n.dataset.incomeAction==='allocate').disabled,true);click(a,'[data-close]');operation(a,id,'reverse',rid(current(a)));assert.equal(current(a).incomePlanning.receipts.length,0);
});

test('income three page modes preserve stale actual unknown while explicit future exclusion is zero',()=>{
 const a=app(seeded({certainty:'expectation',receipt:'stale'}));let select=a.node('#income-mode');select.value='planned';select.dispatch('change');assert.match(pageText(a),/归属待复核/);select=a.node('#income-mode');select.value='conservative';select.dispatch('change');assert.match(pageText(a),/未来未到账暂不计入是此模式的假设/);assert.match(pageText(a),/完整已收 \/ 剩余暂无法确定/);assert.match(pageText(a),/本模式明确排除/);assert.equal(view(a).plans[0].receivedCents,null);
});

test('income real income-entry control opens existing income editor without creating a fake transaction',()=>{
 const a=app(L.createEmpty()),before=snapshot(a);action(a,'record-income');assert.equal(a.node('#entry-form').elements.namedItem('type').value,'income');assert.deepEqual(snapshot(a),before);assert.equal(a.run('state.transactions.length'),0);click(a,'[data-close]');
});

test('income double submit commits once and detached old form cannot reuse consent',()=>{
 const a=app();openNew(a);submit(a);const old=a.node('#entry-form'),fn=old.onsubmit;fields(a,{reason:'Explicit confirmation',confirmed:true});fn({preventDefault(){}});assert.equal(a.counts.commit,1);fn({preventDefault(){}});assert.equal(a.counts.commit,1);assert.equal(current(a).incomePlanning.plans.length,1);
 openNew(a,{name:'Another'});submit(a);fields(a,{confirmed:true,reason:'New confirmation'});const fresh=a.node('#entry-form');fn({preventDefault(){}});assert.equal(a.node('#entry-form'),fresh);approve(a);assert.equal(a.counts.commit,2);
});

test('income back explicitly cancels ticket, preserves draft, and fresh preview requires new checkbox',()=>{
 const a=app();openNew(a,{name:'Saved draft',note:'Retained text'});submit(a);const old=a.node('#entry-form'),before=a.counts.cancel;click(a,'#income-back');assert.ok(a.counts.cancel>before);assert.equal(a.node('#entry-form').elements.namedItem('name').value,'Saved draft');assert.equal(a.node('#entry-form').elements.namedItem('note').value,'Retained text');fields(a,{amount:'250.00'});submit(a);assert.equal(a.node('#entry-form').elements.namedItem('confirmed').checked,false);old.elements.namedItem('confirmed').checked=true;old.onsubmit({preventDefault(){}});assert.equal(a.counts.commit,0);approve(a);assert.equal(current(a).incomePlanning.plans[0].expectedAmountCents,25000);
});

test('income accepted close and Escape invalidate; declined dirty close preserves form and usable ticket',async()=>{
 for(const key of ['click','Escape']){
  const a=app();openNew(a);submit(a);const old=a.node('#entry-form'),before=snapshot(a),cancelCount=a.counts.cancel;
  if(key==='click')click(a,'[data-close]');else a.documentEvent('keydown',{key:'Escape',preventDefault(){}});
  await Promise.resolve();assert.equal(a.node('#entry-form'),null);assert.ok(a.counts.cancel>cancelCount);old.elements.namedItem('confirmed').checked=true;old.onsubmit({preventDefault(){}});assert.deepEqual(snapshot(a),before);
 }
 const a=app(undefined,{confirm:false});openNew(a);submit(a);const form=a.node('#entry-form'),count=a.counts.cancel;click(a,'[data-close]');await Promise.resolve();assert.equal(a.node('#entry-form'),form);assert.equal(a.counts.cancel,count);approve(a);assert.equal(a.counts.commit,1);
});

test('income navigation and generic modal replacement cancel old ticket before any new preview',()=>{
 for(const route of ['navigation','replacement']){
  const a=app();openNew(a);submit(a);const old=a.node('#entry-form'),count=a.counts.cancel;
  if(route==='navigation')click(a,'[data-page="ledger"]');else a.run("modal('Another workflow','<p>Another task</p>')");
  assert.ok(a.counts.cancel>count);old.elements.namedItem('confirmed').checked=true;old.onsubmit({preventDefault(){}});assert.equal(a.counts.commit,0);assert.equal(current(a).incomePlanning,undefined);
 }
});

test('income storage failure consumes capability, never shows success, and fresh review is required',()=>{
 const a=app();openNew(a);submit(a);a.run('incomeFailWrite=true');const before=snapshot(a),old=a.node('#entry-form');fields(a,{confirmed:true,reason:'Attempt write'});submit(a);assert.deepEqual(snapshot(a),before);assert.equal(a.counts.commit,1);assert.equal(a.node('#income-commit').disabled,true);assert.equal(a.node('#income-fresh').hidden,false);assert.equal(a.node('#entry-form').elements.namedItem('confirmed').checked,false);assert.match(a.node('#income-review-status').textContent,/未保存/);assert.match(errors(a),/写入|保存|Synthetic/);old.elements.namedItem('confirmed').checked=true;old.onsubmit({preventDefault(){}});assert.equal(a.counts.commit,1);
 a.run('incomeFailWrite=false');click(a,'#income-fresh');assert.equal(a.node('#entry-form').elements.namedItem('confirmed').checked,false);approve(a);assert.equal(a.counts.commit,2);assert.equal(current(a).incomePlanning.audit.length,1);
});

test('income full-state stale ticket rejects unrelated metadata edit without overwriting latest state',()=>{
 const a=app();openNew(a);submit(a);a.run("state=L.putCategory(state,{name:'Changed synthetic category',type:'expense'},state.categories.find(c=>c.type==='expense').id);savedRaw=JSON.stringify(state);storage.setItem(L.STORAGE_KEY,savedRaw)");const before=snapshot(a);fields(a,{reason:'Confirm old view',confirmed:true});submit(a);assert.deepEqual(snapshot(a),before);assert.equal(a.node('#income-fresh').hidden,false);assert.equal(a.counts.commit,1);click(a,'#income-fresh');approve(a);assert.equal(current(a).categories.find(c=>c.type==='expense').name,'Changed synthetic category');
});

test('income reset disposes old handlers and no late save can survive lifecycle closure',()=>{
 const a=app();openNew(a);submit(a);const old=a.node('#entry-form'),count=a.counts.cancel;click(a,'[data-action="reset-demo"]');assert.ok(a.counts.cancel>count);click(a,'#confirm-demo-reset');assert.equal(a.run('active()'),false);old.elements.namedItem('confirmed').checked=true;old.onsubmit({preventDefault(){}});assert.equal(a.counts.commit,0);assert.equal(a.counters.reloads,1);
});

test('income missing or unrecognized data-income-action is a strict no-op',()=>{
 const a=app(),before=snapshot(a);for(const value of ['', 'not-a-command']){const n=a.doc.createElement('button');n.setAttribute('data-income-action',value);a.doc.body.append(n);n.click();n.remove();}const n=a.doc.createElement('button');n.setAttribute('data-income-action','');delete n.dataset.incomeAction;a.doc.body.append(n);n.click();assert.deepEqual(snapshot(a),before);assert.equal(a.node('.modal'),null);assert.equal(a.counts.preview,0);
});

test('income untrusted names, notes, basis, references and account names stay escaped in actual DOM',()=>{
 const attack='<img src=x onerror=alert(1)> & " quoted',s=seeded({receipt:'partial'});s.accounts[0].name=attack;
 const a=app(s),id=pid(s);details(a,id);action(a,'edit',id);fields(a,{name:attack,basis:attack,note:attack});submit(a);const body=a.node('#income-review-body');assert.ok(body.textContent.includes(attack));assert.equal(body.querySelectorAll('img').length,0);assert.ok(body.innerHTML.includes('&lt;img'));approve(a);assert.equal(a.doc.querySelectorAll('img').length,0);assert.ok(pageText(a).includes(attack));
});

for(const [label,mutate]of [
 ['plan basis',r=>delete r.plans[0].after.plan.basis],['captured proof',r=>delete r.receipts[0].receipt.proof],['current proof',r=>delete r.sources[0].currentProof],['all reductions',r=>delete r.sources[0].reductionComponents],['capacity',r=>delete r.sources[0].before.unassociatedOrdinaryCents],['same source allocations',r=>delete r.sources[0].applicableAllocationsBefore],['date/account match',r=>delete r.receipts[0].planMatchAfter],['one scenario',r=>delete r.scenarioImpacts.conservative],['financial components',r=>delete r.financialDeltas.cashInCents],['unchanged subtrees',r=>delete r.unchangedSubtrees]
])test('income review fails closed if mandatory '+label+' is absent',()=>{
 const s=seeded({receipt:'partial'}),a=app(s,{reviewTransform:r=>{mutate(r);return r;}}),before=snapshot(a),id=pid(s);details(a,id);action(a,'edit',id);fields(a,{note:'Changed note'});submit(a);assert.equal(a.node('#income-commit').disabled,true);assert.match(errors(a),/缺少必需/);assert.deepEqual(snapshot(a),before);assert.equal(a.counts.commit,0);
});

test('income default horizon is integer calendar with leap/end-year boundaries and refuses overflow',()=>{
 const a=app();assert.equal(a.node('#income-horizon').value,'2027-01-31');
 for(const [day,end]of [['2023-11-30','2024-02-29'],['2024-11-30','2025-02-28'],['2026-12-31','2027-03-31'],['9999-09-30','9999-12-31'],['9999-10-01','']]){const n=a.node('#income-as-of');n.value=day;n.dispatch('change');assert.equal(a.node('#income-horizon').value,end,day);}
 assert.match(pageText(a),/默认窗口超出有效年份/);assert.equal(current(a).incomePlanning,undefined);
});

test('income latest applicable account snapshot uses date then original creation revision then ID, no reconciled cherry-pick',()=>{
 let s=base();s=R.addSnapshot(s,{accountId:'account-cash',date:'2026-10-10',actualBalanceCents:100000,note:'Old matching snapshot'});s=R.addSnapshot(s,{accountId:'account-cash',date:'2026-10-10',actualBalanceCents:90000,note:'New discrepant snapshot'});s=R.addSnapshot(s,{accountId:'account-cash',date:'2026-10-20',actualBalanceCents:100000,note:'Future matching snapshot'});
 const a=app(s),before=a.counts.reconciliation;const select=a.node('#income-account');select.value='account-cash';select.dispatch('change');assert.equal(a.counts.reconciliation,before+1);const text=a.node('#income-account-details').textContent;assert.ok(text.includes('New discrepant snapshot'));assert.match(text,/存在差额/);assert.match(text,/未来快照 1 条/);assert.match(text,/角色：未知/);assert.match(text,/来源覆盖完整性仍未知/);assert.equal(current(a).incomePlanning,undefined);
});

test('income amount-matching snapshot with changed basis explicitly needs recheck',()=>{
 let s=base();s=R.addSnapshot(s,{accountId:'account-cash',date:'2026-10-10',actualBalanceCents:100000,note:'Captured original'});s=copy(s);s.transactions[0].date='2026-10-02';s=L.validateState(s);const a=app(s),n=a.node('#income-account');n.value='account-cash';n.dispatch('change');assert.match(a.node('#income-account-details').textContent,/金额一致、依据变化，需重核/);assert.match(a.node('#income-account-details').textContent,/依据变化：是/);
});

test('income selected missing snapshot and future-only snapshot never claim verified today balance',()=>{
 let s=base();s=R.addSnapshot(s,{accountId:'bank',date:'2026-10-20',actualBalanceCents:0,note:'Future only'});const a=app(s);for(const id of ['account-cash','bank']){const n=a.node('#income-account');n.value=id;n.dispatch('change');assert.match(a.node('#income-account-details').textContent,/没有截止日内适用快照/);}assert.match(a.node('#income-account-details').textContent,/未来快照 1 条/);
});

test('income compound reconfirm write failure leaves original receipt and both-event journal completely unchanged',()=>{
 const s=seeded({receipt:'stale'}),a=app(s),id=pid(s);details(a,id);action(a,'reconfirm',rid(s));submit(a);a.run('incomeFailWrite=true');const before=snapshot(a);fields(a,{reason:'Synthetic compound reconfirm',confirmed:true});submit(a);assert.deepEqual(snapshot(a),before);assert.equal(a.counts.commit,1);assert.equal(current(a).incomePlanning.receipts[0].id,rid(s));assert.equal(current(a).incomePlanning.audit.length,s.incomePlanning.audit.length);a.run('incomeFailWrite=false');click(a,'#income-fresh');approve(a);assert.equal(current(a).incomePlanning.audit.length,s.incomePlanning.audit.length+2);assert.notEqual(current(a).incomePlanning.receipts[0].id,rid(s));
});

test('income host quota retry persists the same computed candidate without a second ticket commit',()=>{
 const a=app();openNew(a);submit(a);a.run("storage.setItem('moneygo.backupVerification.note.v1','optional synthetic note');globalThis.incomeQuotaStore=storage;globalThis.incomeQuotaAttempts=[];storage=Object.freeze({getItem:key=>incomeQuotaStore.getItem(key),setItem(key,value){if(key===L.STORAGE_KEY){incomeQuotaAttempts.push(String(value));if(incomeQuotaAttempts.length===1)throw Object.assign(new Error('Synthetic quota'),{name:'QuotaExceededError'});}return incomeQuotaStore.setItem(key,value);},removeItem:key=>incomeQuotaStore.removeItem(key)})");approve(a);assert.equal(a.counts.commit,1);const attempts=a.value('incomeQuotaAttempts');assert.equal(attempts.length,2);assert.equal(attempts[0],attempts[1]);assert.equal(current(a).incomePlanning.audit.length,1);
});

test('income accepted whole-ledger restore invalidates old preview and detached consent cannot overwrite restored book',async()=>{
 const a=app();openNew(a);submit(a);const old=a.node('#entry-form');click(a,'[data-page="backup"]');click(a,'[data-action="restore"]');const text=L.backup(L.createEmpty()),input=a.node('#restore-file');input.files=[{name:'SYNTHETIC-empty.json',size:Buffer.byteLength(text),text:async()=>text}];await input.onchange({target:input});const consent=a.node('#restore-consent');assert.ok(consent,errors(a));consent.checked=true;consent.dispatch('change');click(a,'#confirm-restore');const restored=snapshot(a);old.elements.namedItem('confirmed').checked=true;old.onsubmit({preventDefault(){}});assert.deepEqual(snapshot(a),restored);assert.equal(current(a).incomePlanning,undefined);assert.equal(current(a).transactions.length,0);assert.equal(a.counts.commit,0);isolated(a);
});

test('income future and nonordinary source rows remain visible but cannot be used as ordinary receipts',()=>{
 const s=linked(1),a=app(s),id=create(a);assert.match(pageText(a),/shadow-0/);details(a,id);action(a,'allocate',id);fields(a,{transactionId:'shadow-0',amount:'1.00'});a.node('#entry-form').elements.namedItem('transactionId').dispatch('change');assert.equal(a.node('#income-preview').disabled,true);assert.match(a.node('#income-picked-source').textContent,/未来原始记录|非普通收入来源/);const before=snapshot(a);submit(a);assert.deepEqual(snapshot(a),before);assert.equal(a.node('#income-commit').disabled,true);
});

test('income source201 displays unsupported/unknown and reverse review includes all current components',()=>{
 const s=linked(201,seeded({receipt:'partial'})),a=app(s),id=pid(s);assert.match(pageText(a),/依据超限/);assert.match(pageText(a),/待复核/);details(a,id);action(a,'reverse',rid(s));submit(a);assert.equal(a.node('#income-commit').disabled,false,errors(a));const text=a.node('#income-review-body').textContent;assert.match(text,/proof-limit/);assert.match(text,/link-200/);assert.match(text,/当前完整 proof不可得/);const detail=a.node('#income-review-body').querySelectorAll('details').find(n=>n.querySelector('summary')?.textContent==='全部当前主重复链接（不可截断）');assert.ok(detail);const rendered=JSON.parse(detail.querySelector('pre').textContent);assert.equal(rendered.length,201);assert.deepEqual(rendered.map(x=>x.id),s.bookkeeping.links.map(x=>x.id).sort());approve(a);assert.equal(current(a).incomePlanning.receipts.length,0);assert.equal(current(a).bookkeeping.links.length,201);
});

test('income missing expected account is retained on edit and never changes actual receipt arithmetic',()=>{
 let s=seeded({receipt:'partial'});s=apply(s,{action:'update-plan',planId:pid(s),patch:{expectedAccountId:'bank'}});s=L.removeAccount(s,'bank');const a=app(s),id=pid(s);assert.match(pageText(a),/原账户缺失/);assert.equal(view(a).plans[0].receivedCents,50000);details(a,id);action(a,'edit',id);assert.equal(a.node('#entry-form').elements.namedItem('expectedAccountId').value,'bank');assert.match(a.node('.modal').textContent,/缺失账户：bank/);fields(a,{note:'Metadata correction preserving missing reference'});submit(a);approve(a);assert.equal(view(a).plans[0].plan.expectedAccountId,'bank');assert.equal(view(a).plans[0].receivedCents,50000);
});
