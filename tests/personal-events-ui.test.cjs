'use strict';
const test=require('node:test'),A=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {host}=require('./actual-entry-host.cjs');
const H=require('./personal-events-ui-helper.cjs');
const {root,L,R,S,LONG_ID,ATTACK,transaction,fixture,app,click,close,filter,ids,readonly}=H;
const money=n=>'¥'+(n/100).toFixed(2);
const monthRows=s=>s.transactions.filter(t=>t.date.startsWith('2026-10'));
const sorted=rows=>rows.slice().sort((a,b)=>b.date.localeCompare(a.date));
const file=text=>({name:'legacy.json',size:Buffer.byteLength(text),text:async()=>text});
async function choose(a,selector,text){const input=a.node(selector);A.ok(input);input.files=[file(text)];await input.onchange({target:input});}
function consent(a){a.node('#restore-consent').checked=true;a.node('#restore-consent').dispatch('change');click(a,'#confirm-restore');}

for(const mode of ['personal','synthetic']){
 test(mode+': report keeps raw counts/recent tie order while event categories reconcile exactly',()=>{
  const s=fixture(),a=app(mode,s),before=a.run('JSON.stringify(state)');
  const text=a.node('#app').textContent;
  A.match(text,/11 条原支出记录/);A.match(text,/5 条原收入记录/);
  A.match(a.node('.stats').textContent,/¥50\.00/);A.match(a.node('.stats').textContent,/¥52\.00/);
  A.deepEqual(a.value('[finance(month).personalExpenseEvents.length,finance(month).personalIncomeEvents.length]'),[12,5]);
  A.deepEqual(a.value('[finance(month).personalExpenseEvents.filter(e=>e.amountCents>0).length,finance(month).personalIncomeEvents.filter(e=>e.amountCents>0).length]'),[8,2]);
  A.deepEqual(ids(a),['shadow','z-tie','a-tie',LONG_ID,'transaction-expense-x']);
  A.deepEqual(a.doc.querySelectorAll('[data-category]').map(n=>[n.dataset.category,n.querySelector('.legend-value').textContent]),[['expense-food','¥38.00'],['expense-other','¥12.00']]);
  A.equal(a.node('[data-category="expense-zero"]'),null);
  A.match(a.node('[data-tx="shadow"]').textContent,/¥1\.00/);
  A.match(a.node('#app').innerHTML,/&lt;img src=x onerror=&quot;routeAttack\(\)&quot;&gt;/);
  A.equal(a.doc.querySelector('img'),null);A.equal(a.run('typeof routeAttack'),'undefined');
  click(a,'[data-category="expense-food"]');
  A.equal(a.run('page'),'ledger');A.equal(a.run('filters.category'),'expense-food');
  A.deepEqual(ids(a),sorted(monthRows(s).filter(t=>t.categoryId==='expense-food')).map(t=>t.id));
  A.match(a.node('.ledger-summary').textContent,/个人消费 ¥38\.00普通收入 ¥0\.00/);
  readonly(a,before);
 });

 test(mode+': all raw filter predicates retain exact membership, counts and event-only sums',()=>{
  const s=fixture(),a=app(mode,s),before=a.run('JSON.stringify(state)'),raw=monthRows(s);
  const cases=[
   [{},raw,5000,5200],
   [{type:'expense'},raw.filter(t=>t.type==='expense'),5000,0],
   [{type:'income'},raw.filter(t=>t.type==='income'),0,5200],
   [{type:'transfer'},raw.filter(t=>t.type==='transfer'),0,0],
   [{type:'paired-transfer'},raw.filter(t=>['out','in'].includes(t.id)),0,0],
   [{account:'bank'},raw.filter(t=>t.accountId==='bank'||t.toAccountId==='bank'),200,5200],
   [{account:'account-cash'},raw.filter(t=>t.accountId==='account-cash'||t.toAccountId==='account-cash'),4800,0],
   [{category:'expense-zero'},raw.filter(t=>t.categoryId==='expense-zero'),0,0],
   [{category:'income-salary'},raw.filter(t=>t.categoryId==='income-salary'),0,5000],
   [{q:ATTACK},raw.filter(t=>t.id==='z-tie'),100,0],
   [{q:'Zero <safe>'},raw.filter(t=>t.categoryId==='expense-zero'),0,0],
   [{q:'Bank <safe>'},raw.filter(t=>t.accountId==='bank'||t.toAccountId==='bank'),200,5200],
   [{q:'transaction-expense'},raw.filter(t=>[LONG_ID,'transaction-expense-x'].includes(t.id)),700,0],
   [{q:'funding'},raw.filter(t=>t.id==='funding'),0,0],
   [{account:'bank',type:'expense'},raw.filter(t=>t.accountId==='bank'&&t.type==='expense'),200,0],
   [{q:'not present'},[],0,0]
  ];
  for(const [query,rows,expense,income]of cases){filter(a,query);A.deepEqual(ids(a),sorted(rows).map(t=>t.id),JSON.stringify(query));A.equal(a.node('.card-head').querySelector('.tiny-label').textContent,rows.length+' 笔');A.equal(a.node('.ledger-summary').textContent,'个人消费 '+money(expense)+'普通收入 '+money(income)+'清除筛选');}
  readonly(a,before);
 });

 test(mode+': personal drilldowns use positive events, typed raw routes and escaped original labels',()=>{
  const a=app(mode),before=a.run('JSON.stringify(state)');
  for(const [kind,expected,total]of [
   ['personal-expense',['a-tie','recognition-future','sixth','transaction-expense-x',LONG_ID,'z-tie','part-oct','claim-buy'],5000],
   ['ordinary-income',['settle','salary'],5200]
  ]){
   click(a,'[data-bk-id="'+kind+'"]');
   const rows=a.node('#bk-modal-rows');A.ok(rows);
   A.deepEqual(rows.querySelectorAll('[data-bk-action="details"]').map(n=>n.dataset.bkId),expected);
   A.equal(a.node('#bk-modal-count').textContent,'1–'+expected.length+' / '+expected.length);
   A.match(a.node('#modal-root').textContent,new RegExp('合计 '+money(total).replace('.','\\.')));
   for(const n of rows.querySelectorAll('[data-bk-action="details"]')){A.equal(n.dataset.bkId.startsWith('['),false);A.ok(a.value('state.transactions').some(t=>t.id===n.dataset.bkId));}
   if(kind==='personal-expense'){A.equal(rows.querySelector('img'),null);A.match(rows.innerHTML,/&lt;img/);click(a,'#bk-modal-rows [data-bk-id="'+LONG_ID+'"]');A.match(a.node('#modal-root').textContent,new RegExp('交易编号 '+LONG_ID));}
   close(a);
  }
  // Suppressed rows remain reachable from unchanged raw details.
  filter(a,{});
  for(const id of ['shadow','out','in','funding','zero-buy','salary-shadow','native',LONG_ID]){
   click(a,'[data-tx="'+id+'"]');A.equal(a.node('#modal-title').textContent,'编辑交易');A.equal(a.node('#entry-form').elements.note.value,a.value('state.transactions').find(t=>t.id===id).note);close(a);
  }
  readonly(a,before);
 });

 test(mode+': report, filtered ledger, history and exclusion annotations never aggregate legacy impact amounts',()=>{
  const a=app(mode),before=a.run('JSON.stringify(state)');
  a.run("for(const view of [finance(),finance(month)])for(const impact of Object.values(view.impacts))for(const key of ['personalExpenseCents','ordinaryIncomeCents'])Object.defineProperty(impact,key,{get(){throw Error('Legacy aggregate accessed');},configurable:true})");
  A.doesNotThrow(()=>a.run('report()'));A.doesNotThrow(()=>filter(a,{type:'expense'}));
  a.run('historyMonths()');A.match(a.node('#modal-root').textContent,/12 笔支出 · ¥50\.00/);close(a);
  a.run("exclusionsForMonth('2026-10')");
  const options=a.doc.querySelectorAll('[data-exclusion-id]');A.equal(options.length,12);A.deepEqual(options.map(n=>n.dataset.exclusionId),['funding','part-oct','claim-buy','out','zero-buy','sixth','recognition-future','transaction-expense-x',LONG_ID,'a-tie','z-tie','shadow']);
  A.match(a.node('[data-exclusion-id="funding"]').closest('label').textContent,/¥30\.00.*当前个人消费 ¥0\.00/);
  A.match(a.node('[data-exclusion-id="claim-buy"]').closest('label').textContent,/¥12\.00.*当前个人消费 ¥9\.00/);
  A.equal(a.node('#exclusion-list').querySelector('img'),null);A.throws(()=>a.run("expenseValue({id:'missing-personal-origin',type:'expense'})"),/个人口径来源记录不完整/);close(a);readonly(a,before);
 });

 test(mode+': Relations personal drilldowns ignore old impact amounts and reject unknown routes',()=>{
  const a=app(mode),before=a.run('JSON.stringify(state)');
  a.run("globalThis.drilldownProbeCalls=0;globalThis.routeOriginalRelations=window.MoneygoRelations;window.MoneygoRelations={...routeOriginalRelations,calculate(...args){drilldownProbeCalls++;const view=routeOriginalRelations.calculate(...args);for(const impact of Object.values(view.impacts))for(const key of ['personalExpenseCents','ordinaryIncomeCents'])Object.defineProperty(impact,key,{get(){throw Error('Legacy drilldown accessed');}});return view;}};B.bind(bookkeepingContext())");
  click(a,'[data-bk-id="personal-expense"]');A.equal(a.run('drilldownProbeCalls'),1);A.equal(a.node('#bk-modal-rows').querySelectorAll('[data-bk-action="details"]').length,8);close(a);
  click(a,'[data-bk-id="ordinary-income"]');A.equal(a.run('drilldownProbeCalls'),2);A.equal(a.node('#bk-modal-rows').querySelectorAll('[data-bk-action="details"]').length,2);close(a);
  a.run("window.MoneygoRelations={...routeOriginalRelations,calculate(...args){drilldownProbeCalls++;const view=routeOriginalRelations.calculate(...args);view.personalExpenseEvents=view.personalExpenseEvents.map(event=>event.amountCents>0?{...event,route:{kind:'unknown',transactionId:event.origin.transactionId}}:event);return view;}};B.bind(bookkeepingContext())");
  click(a,'[data-bk-id="personal-expense"]');A.equal(a.run('drilldownProbeCalls'),3);A.equal(a.node('#modal-root').querySelectorAll('[data-bk-action="details"]').length,0);A.match((a.node('#form-error')?.textContent||a.node('#toast').textContent),/不支持的个人口径来源/);close(a);
  a.run('window.MoneygoRelations=routeOriginalRelations;B.bind(bookkeepingContext())');readonly(a,before);
 });

 test(mode+': exclusions preserve off-month/trash/stale raw IDs and insertion order, saving once',()=>{
  let s=fixture();s.transactions.push(transaction('trash-expense','expense',50,'2026-08-01'));s=L.deleteTransaction(s,'trash-expense');s.simulation.exclusions=['shadow','part-sep','missing-retained','trash-expense'];s=L.validateState(s);
  const a=app(mode,s),real=a.value('({accounts:state.accounts,categories:state.categories,transactions:state.transactions,trash:state.trash})');
  a.run("exclusionsForMonth('2026-10')");
  const uncheck=a.node('[data-exclusion-id="shadow"]');uncheck.checked=false;uncheck.dispatch('change');
  const add=a.node('[data-exclusion-id="funding"]');add.checked=true;add.dispatch('change');
  A.deepEqual(a.value('eventUIWrites'),[]);a.node('#entry-form').dispatch('submit');
  A.deepEqual(a.value('state.simulation.exclusions'),['part-sep','missing-retained','trash-expense','funding']);
  A.deepEqual(a.value('({accounts:state.accounts,categories:state.categories,transactions:state.transactions,trash:state.trash})'),real);
  const writes=a.value('eventUIWrites').filter(x=>x[1]===L.STORAGE_KEY);A.equal(writes.length,1);
  A.deepEqual(JSON.parse(writes[0][2]).simulation.exclusions,['part-sep','missing-retained','trash-expense','funding']);
  A.doesNotMatch(writes[0][2],/personalExpenseEvents|personalIncomeEvents|"effectiveDate"|"transaction-expense",/);
 });

 test(mode+': zero personal history is not labelled as a raw empty month',()=>{
  let s=L.createEmpty();s.accounts.push({id:'bank',name:'Bank',openingBalanceCents:1000});s.transactions=[transaction('zero-out','expense',100,'2026-09-02','bank'),transaction('zero-in','income',100,'2026-09-03')];s=R.pairTransfer(s,{expenseId:'zero-out',incomeId:'zero-in',reason:'Synthetic pair'});s.simulation=S.defaultSettings();s.simulation.completeMonths=['2026-08','2026-09'];s=L.validateState(s);
  const a=app(mode,s),before=a.run('JSON.stringify(state)');a.run('historyMonths()');
  const september=a.node('input[value="2026-09"]').closest('label').textContent,august=a.node('input[value="2026-08"]').closest('label').textContent;
  A.match(september,/1 笔支出 · ¥0\.00/);A.doesNotMatch(september,/零支出月/);A.match(august,/0 笔支出 · ¥0\.00 · 确认后视为零支出月/);close(a);readonly(a,before);
 });

 test(mode+': old backup versions 1–6 verify and restore through real entry controls without saved events',async()=>{
  const old=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/legacy-outer-v1-v5.json'),'utf8'));
  const v6=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/all-extensions-v6.json'),'utf8'));
  const a=app(mode);
  for(const envelope of [...old,v6]){
   const text=JSON.stringify(envelope),normalized=JSON.stringify(L.parseBackup(text));
   a.run('showRestore()');await choose(a,'#restore-file',text);A.ok(a.node('#restore-consent'));consent(a);
   A.equal(a.run('JSON.stringify(state)'),normalized);A.equal(a.run('savedRaw'),normalized);A.equal(a.run('storage.getItem(L.STORAGE_KEY)'),normalized);
   A.doesNotMatch(normalized,/personalExpenseEvents|personalIncomeEvents|"effectiveDate"/);
   A.equal(a.run('state.version'),L.parseBackup(text).version);
  }
  if(mode==='synthetic'){A.equal(a.counters.localStorage,0);A.deepEqual(a.counters.personalIO,[]);}
 });
}

for(const mode of ['personal','synthetic'])for(const missing of ['module','projectLegacy','select','reduce','keyOf','PersonalEventError','Ledger.personalEvents']){
 test(mode+': missing '+missing+' fails before storage acquisition even with a plain legacy ledger',()=>{
  let fired=0;const a=host(root,{entry:mode==='personal'?'index.html':'demo.html',personal:{[L.STORAGE_KEY]:JSON.stringify(L.createEmpty())},beforeScript(file,context,window){
   if(file!==(mode==='personal'?'personal-bootstrap-v1.js':'synthetic-bootstrap-v1.js'))return;fired++;
   if(missing==='module')delete window.MoneygoPersonalEvents;
   else if(missing==='Ledger.personalEvents')vm.runInContext("window.MoneygoLedger={...window.MoneygoLedger,personalEvents:undefined}",context);
   else vm.runInContext('window.MoneygoPersonalEvents={...window.MoneygoPersonalEvents,'+JSON.stringify(missing)+':undefined}',context);
  }});
  A.equal(fired,1);A.equal(a.node('#app').hidden,true);A.equal(a.node('#app').innerHTML,'');A.equal(a.node('#boot-blocker').hidden,false);
  A.equal(a.counters.localStorage,0);A.equal(a.counters.sessionStorage,0);A.deepEqual(a.counters.personalIO,[]);A.equal(a.run('Object.hasOwn(window,"MoneygoRuntimeCapability")'),false);
 });
}

for(const mode of ['personal','synthetic'])for(const accessor of ['module','method']){
 test(mode+': personal-event '+accessor+' accessor is rejected without executing it or acquiring storage',()=>{
  let fired=0,reads=0;const a=host(root,{entry:mode==='personal'?'index.html':'demo.html',personal:{[L.STORAGE_KEY]:JSON.stringify(L.createEmpty())},beforeScript(file,context,window){
   if(file!==(mode==='personal'?'personal-bootstrap-v1.js':'synthetic-bootstrap-v1.js'))return;fired++;
   if(accessor==='module')Object.defineProperty(window,'MoneygoPersonalEvents',{get(){reads++;throw Error('Projection getter fired');},configurable:true});
   else{const projected={...window.MoneygoPersonalEvents};Object.defineProperty(projected,'select',{get(){reads++;throw Error('Projection method getter fired');}});window.MoneygoPersonalEvents=projected;}
  }});
  A.equal(fired,1);A.equal(reads,0);A.equal(a.node('#app').hidden,true);A.equal(a.node('#app').innerHTML,'');A.equal(a.counters.localStorage,0);A.deepEqual(a.counters.personalIO,[]);A.equal(a.run('Object.hasOwn(window,"MoneygoRuntimeCapability")'),false);
 });
}

test('actual entries load one real pure leaf first; the practice guide remains script-free',()=>{
 for(const entry of ['index.html','demo.html']){const html=fs.readFileSync(path.join(root,'dist',entry),'utf8'),scripts=[...html.matchAll(/<script src="([^"]+)"/g)].map(m=>m[1]);A.equal(scripts[0],'held-core.js');A.equal(scripts[1],'personal-events.js');A.equal(scripts.filter(x=>x==='personal-events.js').length,1);A.ok(scripts.indexOf('personal-events.js')<scripts.indexOf('ledger.js'));A.ok(scripts.indexOf('personal-events.js')<scripts.indexOf('relations.js'));}
 A.doesNotMatch(fs.readFileSync(path.join(root,'dist/synthetic-practice.html'),'utf8'),/<script\b/i);
 const runtime=fs.readFileSync(path.join(root,'dist/app-runtime-v1.js'),'utf8');A.ok(runtime.indexOf('const runtime=')<runtime.indexOf('const P ='));A.doesNotMatch(runtime,/L\.expenseAmounts\(/);
});
