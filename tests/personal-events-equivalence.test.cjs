'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {realm,capture,boundaries,validatorCounts}=require('./personal-events-oracle.cjs');
const root=process.env.MONEYGO_EQUIVALENCE_ROOT||path.resolve(__dirname,'..');
const oraclePath=path.join(__dirname,'fixtures/personal-events-legacy-oracle.json');
const oracle=JSON.parse(fs.readFileSync(oraclePath,'utf8'));
const full=oracle.fixtures.find(f=>f.id==='historical-all-extensions-v6.json');
const json=x=>JSON.stringify(x);
const parseOutcome=x=>JSON.parse(x);
test('frozen oracle files retain their pre-implementation hashes',()=>{
 for(const [name,sha] of [['personal-events-legacy-oracle.json','b89e7f54077a9ee1e9f4b86d0109995913cd421f83399eb72c80a43bb1b92890'],['personal-events-legacy-ui-oracle.json','512e943f38613b378a587db65baf2be78d6736f822cdf8940a870ff79320f2ce']])assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'fixtures',name))).digest('hex'),sha,name);
});
for(const fixture of oracle.fixtures)test('legacy compatibility bytes and every old field: '+fixture.id,()=>{
  const actual=capture(root,fixture);
  assert.deepEqual(Object.keys(actual),Object.keys(fixture.expected),'No old operation omitted or new comparison silently introduced');
  for(const [operation,expected] of Object.entries(fixture.expected))assert.equal(actual[operation],expected,fixture.id+' / '+operation);
});
test('legacy boundary acceptance, error class/code and first-error order',()=>{
  const actual=boundaries(root);
  assert.deepEqual(Object.keys(actual),Object.keys(oracle.boundaries));
  for(const [name,expected] of Object.entries(oracle.boundaries))assert.deepEqual(actual[name],expected,name);
  assert.deepEqual(actual['temporary-balance-overflow-false'],{accepted:false,name:'LedgerError',code:'AMOUNT_OVERFLOW'});
  assert.equal(actual['temporary-balance-overflow-true'].accepted,true);
  assert.equal(actual['temporary-overflow-unrelated-month-false'].accepted,false);
});
test('validation ceilings retain both plain 2/0 and bookkeeping 2/5 Scenario paths',()=>{
  const actual=validatorCounts(root,full.inputState);
  assert.deepEqual(oracle.validatorCounts.scenarioPlain,{Ledger:2,Relations:0,Organizer:0,Obligations:0});
  assert.deepEqual(oracle.validatorCounts.scenarioBookkeeping,{Ledger:2,Relations:5,Organizer:0,Obligations:0});
  for(const [operation,counts] of Object.entries(oracle.validatorCounts))for(const [engine,count] of Object.entries(counts))assert.ok(actual[operation][engine]<=count,operation+' '+engine+' validation '+actual[operation][engine]+' > '+count);
});
test('frozen proof replay preserves standalone ordinary closes and the existing pure compositeProof dependency',()=>{
  const ordinary=realm(root,{names:['organizer'],leaf:false});
  const proof=realm(root,{names:['relations','organizer'],leaf:false});
  proof.run(`var proofCalls=0;window.MoneygoRelations=new Proxy({compositeProof(...args){proofCalls++;return R.compositeProof(...args);}},{get(target,key){if(key!=='compositeProof')throw Error('Historical replay consulted live Relations.'+String(key));return target[key];}});
    for(const name of ['MoneygoLedger','MoneygoPersonalEvents','MoneygoObligations'])Object.defineProperty(window,name,{get(){throw Error('Historical replay consulted '+name);},configurable:true});`);
  for(const f of oracle.fixtures){
    const normalized=parseOutcome(f.expected.normalized);if(!normalized.accepted)continue;
    const states=[];if(normalized.value.organizer)states.push(normalized.value);
    for(const [op,text] of Object.entries(f.expected))if(op.startsWith('close:')){const value=parseOutcome(text);if(value.accepted)states.push(value.value);}
    for(const state of states){const needsProof=JSON.stringify(state.organizer).includes('"compositeProofs"');const h=needsProof?proof:ordinary;h.set('state',state);assert.equal(h.run('JSON.stringify(O.validate(state.organizer,state))'),json(state.organizer),f.id);}
  }
  const composite=oracle.fixtures.find(f=>f.id==='composite-distinct-dates-accounts');
  const close=parseOutcome(composite.expected['close:'+json({month:'2026-10'})]).value;
  ordinary.set('missingHelper',close);assert.deepEqual(ordinary.value('outcome(()=>O.validate(missingHelper.organizer,missingHelper))'),{accepted:false,name:'OrganizerError',code:'RELATIONS_UNAVAILABLE'});
  // Composite proofs retain their signatures after their original live sources disappear.
  delete close.bookkeeping;close.transactions=[];close.trash=[];
  proof.set('retired',close);assert.equal(proof.run('JSON.stringify(O.validate(retired.organizer,retired))'),json(close.organizer));
  assert.ok(proof.run('proofCalls')>0);
});
test('legacy personal event origin, route, date/category/account and zero traces match locked frozen residuals',()=>{
  const h=realm(root);assert.equal(h.run('typeof P?.projectLegacy'),'function');assert.equal(h.run('typeof L.personalEvents'),'function');
  for(const f of oracle.fixtures){h.set('input',f.inputState);const before=h.run('JSON.stringify(input)');h.run('freeze(input);');
    const actual=h.value('(() => {const v=R.calculate(input);return {personalExpenseEvents:v.personalExpenseEvents,personalIncomeEvents:v.personalIncomeEvents};})()');
    assert.equal(json(actual),json(f.expectedEvents),f.id+' exact event bytes');
    const convenience=h.value('L.personalEvents(input)');
    assert.equal(json(convenience),json({expenseEvents:f.expectedEvents.personalExpenseEvents,incomeEvents:f.expectedEvents.personalIncomeEvents}),f.id+' convenience API shape');
    assert.equal(actual.personalExpenseEvents.length+actual.personalIncomeEvents.length,f.inputState.transactions.filter(t=>t.type!=='transfer').length,f.id+' trace count');
    for(const month of f.months){h.set('selectedMonth',month);const selected=h.value('(() => {const v=R.calculate(input,selectedMonth);return {personalExpenseEvents:v.personalExpenseEvents,personalIncomeEvents:v.personalIncomeEvents};})()');
      for(const field of ['personalExpenseEvents','personalIncomeEvents'])assert.equal(json(selected[field]),json(f.expectedEvents[field].filter(e=>e.effectiveDate.slice(0,7)===month)),f.id+' '+month+' '+field);
      const summary=parseOutcome(f.expected['summary:'+month]);
      if(summary.accepted){const expense=Number(selected.personalExpenseEvents.reduce((n,e)=>n+BigInt(e.amountCents),0n)),income=Number(selected.personalIncomeEvents.reduce((n,e)=>n+BigInt(e.amountCents),0n));assert.equal(expense,summary.value.expenseCents);assert.equal(income,summary.value.incomeCents);}
    }
    assert.equal(h.run('JSON.stringify(input)'),before,f.id+' input bytes unchanged');
    assert.equal(h.run('(() => {const x=L.personalEvents(input);const all=[...x.expenseEvents,...x.incomeEvents];return Object.isFrozen(x.expenseEvents)&&Object.isFrozen(x.incomeEvents)&&all.every(e=>Object.isFrozen(e)&&Object.isFrozen(e.key)&&Object.isFrozen(e.origin)&&Object.isFrozen(e.attribution)&&Object.isFrozen(e.route));})()'),true);
  }
});
test('new convenience API invalid-month errors precede old state errors; no cached validation bypass',()=>{
  const h=realm(root);for(const m of [null,'','2026-13','0000-01',1]){h.set('month',m);assert.deepEqual(h.value('outcome(()=>L.personalEvents({version:999},month))'),{accepted:false,name:'LedgerError',code:'INVALID_MONTH'});}
  h.set('input',oracle.fixtures[0].inputState);h.run('L.personalEvents(input);input.transactions[0].amountCents=0;');assert.deepEqual(h.value('outcome(()=>L.personalEvents(input))'),{accepted:false,name:'LedgerError',code:'INVALID_AMOUNT'});
});
test('no-bookkeeping Ledger and Scenario work with leaf alone and no Date/storage/DOM/network',()=>{
  const h=realm(root,{names:['ledger','scenario'],forbidden:true});
  h.set('input',oracle.fixtures[0].inputState);h.set('settings',oracle.fixtures[0].settings);
  assert.equal(json(h.value('L.summary(input)')),json(parseOutcome(oracle.fixtures[0].expected['summary:all']).value));
  assert.equal(json(h.value('S.calculate(input,settings,"2026-10-14")')),json(parseOutcome(oracle.fixtures[0].expected.scenario).value));
  assert.equal(h.run('L.personalEvents(input).expenseEvents.length'),1);
  assert.equal(h.run('window.MoneygoRelations'),undefined);
});
test('direct finance-only Relations event categories preserve missing, malformed and unknown-reference domain',()=>{
 const h=realm(root);h.run(`var input={currency:'CNY',accounts:[{id:'a',openingBalanceCents:0}],transactions:[{id:'e',type:'expense',date:'2026-01-01',amountCents:101,accountId:'a',toAccountId:null},{id:'i',type:'income',date:'2026-01-02',amountCents:51,accountId:'a',toAccountId:null}]};`);
 for(const [value,expected] of [[null,null],[14,null],[{},null],['bad/category',null],['missing','missing'],['income-other','income-other']]){h.set('category',value);h.run('input.transactions.forEach(t=>t.categoryId=category);');const result=h.value('R.calculate(input)');assert.equal(result.personal.expenseCents,101);assert.equal(result.personal.incomeCents,51);assert.equal(result.personalExpenseEvents[0].categoryId,expected);assert.equal(result.personalIncomeEvents[0].categoryId,expected);}
 h.run('input.transactions.forEach(t=>delete t.categoryId);');assert.equal(h.run('R.calculate(input).personalExpenseEvents[0].categoryId'),null);
 assert.deepEqual(h.value(`(()=>{let reads=0;const c={get valueOf(){reads++;throw Error('No nested classification inspection');},toString(){reads++;throw Error('No coercion');}};input.transactions[0].categoryId=c;const value=R.calculate(input);return {reads,category:value.personalExpenseEvents[0].categoryId,expense:value.personal.expenseCents};})()`),{reads:0,category:null,expense:101});
});
test('gross overflow still fails with a safe net and opposing account balances',()=>{
 const h=realm(root);const value=h.value(`(() => {const max=999999999999,s=L.createEmpty();s.accounts.push({id:'bank',name:'Bank',openingBalanceCents:0});s.transactions=Array.from({length:10000},(_,i)=>({id:'row-'+i,type:i<9008?'expense':'income',date:'2026-09-01',amountCents:max,accountId:i%2?'bank':'account-cash',categoryId:i<9008?'expense-food':'income-other',note:''}));return {plain:outcome(()=>L.summary(s)),book:outcome(()=>L.summary({...s,version:4,bookkeeping:R.defaultState()}))};})()`);
 for(const e of Object.values(value))assert.deepEqual(e,{accepted:false,name:e.name,code:'AMOUNT_OVERFLOW'});
 assert.equal(value.plain.name,'LedgerError');assert.equal(value.book.name,'RelationsError');
});
test('separate opposing account balances cannot conceal overflow, and invalid openings keep old errors',()=>{
 const h=realm(root);for(const opening of [1000000000000,-1000000000000,Number.MAX_SAFE_INTEGER,1.5,'1']){h.set('opening',opening);for(const extended of [false,true])assert.deepEqual(h.value(`outcome(()=>{const s=L.createEmpty();s.accounts[0].openingBalanceCents=opening;return L.summary(${extended?'{...s,version:4,bookkeeping:R.defaultState()}':'s'});})`),{accepted:false,name:'LedgerError',code:'INVALID_AMOUNT'});}
 const x=h.value(`(() => {const s=L.createEmpty(),max=999999999999;s.accounts.push({id:'bank',name:'Bank',openingBalanceCents:0});s.transactions=Array.from({length:10000},(_,i)=>({id:'opposed-'+i,type:i<9008?'expense':'income',date:'2026-09-01',amountCents:max,accountId:i<9008?'account-cash':'bank',categoryId:i<9008?'expense-food':'income-other',note:''}));return {plain:outcome(()=>L.summary(s)),book:outcome(()=>L.summary({...s,version:4,bookkeeping:R.defaultState()}))};})()`);
 assert.deepEqual(x.plain,{accepted:false,name:'LedgerError',code:'AMOUNT_OVERFLOW'});assert.deepEqual(x.book,{accepted:false,name:'RelationsError',code:'AMOUNT_OVERFLOW'});
});
test('late refund keeps frozen January bytes and changes only the original purchase driver',()=>{
 const file=path.join(__dirname,'fixtures/personal-events-legacy-transitions.json');assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),'42479dd38ea6766f0b76d94a9419bcf389fd3bb43522b4be05587bea1ef280c8');
 const fixture=JSON.parse(fs.readFileSync(file,'utf8')).lateRefund,h=realm(root);h.set('input',fixture.inputState);h.set('operation',fixture.operation);h.set('closeId',fixture.closeId);
 const actual=h.value(`(()=>{const before=JSON.stringify(input),saved=JSON.stringify(input.organizer.closes.find(c=>c.id===closeId));const after=R.allocateRefund(input,operation);return {inputUnchanged:JSON.stringify(input)===before,frozenBefore:saved,frozenAfter:JSON.stringify(after.organizer.closes.find(c=>c.id===closeId)),normalized:JSON.stringify(L.validateState(after)),backup:L.backup(after),comparison:O.compareMonth(after,closeId),januarySummary:L.summary(after,'2026-01'),februarySummary:L.summary(after,'2026-02')};})()`);
 assert.deepEqual(actual,fixture.expected);assert.equal(actual.frozenBefore,actual.frozenAfter);assert.deepEqual(actual.comparison.drivers.map(d=>d.transactionId),['purchase']);assert.equal(actual.comparison.delta.personal.expenseCents,-1111);assert.equal(actual.comparison.delta.cash.expenseCents,0);assert.equal(actual.januarySummary.expenseCents,5668);assert.equal(actual.februarySummary.incomeCents,0);
});
