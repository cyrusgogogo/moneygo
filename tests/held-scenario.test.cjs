'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const L = require('../dist/ledger.js');
const S = require('../dist/scenario.js');
const copy = value => JSON.parse(JSON.stringify(value));
const settings = exclusions => ({ ...S.defaultSettings(), version: 2, completeMonths: ['2026-03'], exclusions });
const key = (kind, id) => ({ kind, id });

test('held Scenario defaults and v1 normalization remain unactivated and byte-exact', () => {
  const v1 = S.defaultSettings(); v1.exclusions = ['stale', 'raw'];
  assert.equal(S.VERSION, 1); assert.equal(S.EVENT_VERSION, 2);
  assert.equal(JSON.stringify(S.validate(v1)), JSON.stringify(v1));
  const v2 = settings(v1.exclusions.map(id => key('transaction-expense', id)));
  assert.deepEqual(S.validate(v2).exclusions, v2.exclusions);
  assert.equal(S.validate({ ...v2, exclusions: [] }).version, 2);
  assert.deepEqual(v1.exclusions, ['stale', 'raw']);
});

test('held Scenario v2 rejects mixed, unknown, income, duplicate, sparse and non-data keys', () => {
  const invalid = [ ['raw'], [key('transaction-income', 'raw')], [key('future-event', 'raw')], [key('held-recognition', 'same'), key('held-recognition', 'same')], [{kind:'held-recognition',id:'a',extra:1}], [{kind:'held-recognition',id:null}], new Array(1) ];
  for (const exclusions of invalid) assert.throws(() => S.validate(settings(exclusions)));
  let calls = 0; const accessor = {kind:'held-recognition'}; Object.defineProperty(accessor,'id',{enumerable:true,get(){calls++;return 'a';}});
  assert.throws(() => S.validate(settings([accessor]))); assert.equal(calls,0);
  const tagged = settings([]); Object.defineProperty(tagged, Symbol.toStringTag, {get(){calls++;return 'Object';}});
  assert.throws(() => S.validate(tagged)); assert.equal(calls,0);
  const inherited = Object.assign(Object.create({bad:true}),key('held-recognition','a'));
  assert.throws(() => S.validate(settings([inherited])));
  const hidden = key('held-recognition','a'); Object.defineProperty(hidden,'id',{enumerable:false,value:'a'});
  assert.throws(() => S.validate(settings([hidden])));
  assert.throws(() => S.validate(settings(Array.from({length:10001},(_,i)=>key('held-recognition','r'+i)))));
  assert.throws(() => S.validate({...S.defaultSettings(),exclusions:[key('held-recognition','a')]}));
  assert.throws(() => S.validate({...settings([]),version:3}));
});

test('held review seam reuses supplied validated event stream and legacy arithmetic without upward calls', () => {
  const state = L.createEmpty(); state.transactions = [{id:'raw',type:'expense',date:'2026-03-10',amountCents:501,accountId:'account-cash',categoryId:'expense-food',note:''}];
  const normalized = L.validateState(state), set = {...S.defaultSettings(),completeMonths:['2026-02','2026-03']};
  const events = L.personalEvents(normalized), expected = S.calculate(normalized,set,'2026-04-15');
  const window = { MoneygoLedger: {...L,validateState(){throw Error('No full validation');},personalEvents(){throw Error('No event reconstruction');}}, MoneygoPersonalEvents: require('../dist/personal-events.js') };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../dist/scenario.js'),'utf8'),{window});
  assert.deepEqual(copy(window.MoneygoScenario.calculateHeldReview(normalized,set,'2026-04-15',events)),expected);
  assert.equal(expected.baseline.categories.find(c=>c.categoryId==='expense-food').baselineCents,251);
});

test('held Scenario prepared-stream identity isolates funding exclusions and retains stale reversal IDs', () => {
  const P=require('../dist/personal-events.js'), state=L.createEmpty();
  state.bookkeeping={heldRecognitions:[{id:'use-march'}]};
  state.transactions=[{id:'fund',type:'expense',date:'2026-01-10',amountCents:10000,categoryId:'expense-food',accountId:'account-cash',note:''}];
  const streams=P.projectHeld({rawFacts:[{transactionId:'fund',kind:'expense',effectiveDate:'2026-01-10',categoryId:'expense-food',accountId:'account-cash',rawAmountCents:10000,personalAmountCents:0,excluded:false,primaryId:null,transferPairId:null,compositeId:null,personalAuthority:true,fundingAuthority:true}],recognitions:[{recognitionId:'use-march',positionId:'position',kind:'use',amountCents:2000,effectiveDate:'2026-03-10',categoryId:'expense-food',expenseId:'fund',fundingAccountId:'account-cash',merchant:'School'}]});
  const stream={expenseEvents:streams.expenseEvents,incomeEvents:streams.incomeEvents};
  const v1={...S.defaultSettings(),completeMonths:['2026-03'],exclusions:['fund','missing']};
  const before=copy(v1), result=S.calculateHeldReview(state,S.validate(v1),'2026-04-15',stream);
  assert.equal(result.baseline.monthlyCents,2000);assert.deepEqual(v1,before);
  assert.deepEqual(result.warnings.find(w=>w.code==='STALE_EXCLUSIONS'),{code:'STALE_EXCLUSIONS',transactionIds:['missing'],count:1});
  const v2=settings([key('transaction-expense','fund'),key('held-recognition','use-march'),key('held-recognition','retired')]);
  assert.equal(S.calculateHeldReview(state,S.validate(v2),'2026-04-15',stream).baseline.monthlyCents,0);
  state.bookkeeping.heldRecognitions=[{id:'replacement'}];
  const replacement=copy(stream), changed=replacement.expenseEvents.find(e=>e.key.kind==='held-recognition');changed.key.id='replacement';changed.origin.recognitionId='replacement';changed.attribution.recognitionId='replacement';changed.route.recognitionId='replacement';replacement.expenseEvents=P.select(replacement.expenseEvents,{});
  const after=S.calculateHeldReview(state,S.validate(v2),'2026-04-15',replacement);
  assert.equal(after.baseline.monthlyCents,2000);
  assert.deepEqual(after.warnings.find(w=>w.code==='STALE_EXCLUSIONS'),{code:'STALE_EXCLUSIONS',eventKeys:[key('held-recognition','use-march'),key('held-recognition','retired')],count:2});
  assert.deepEqual(v2.exclusions,[key('transaction-expense','fund'),key('held-recognition','use-march'),key('held-recognition','retired')]);
});

test('held Scenario v2 raw exclusions preserve trashed expense applicability and distinct typed identity', () => {
  const state=L.createEmpty();state.bookkeeping={heldRecognitions:[]};
  state.trash=[{id:'trashed',transaction:{type:'expense'}},{id:'income',transaction:{type:'income'}}];
  const set=settings([key('transaction-expense','trashed'),key('held-recognition','trashed'),key('transaction-expense','income')]);
  const result=S.calculateHeldReview(state,S.validate(set),'2026-04-15',{expenseEvents:[],incomeEvents:[]});
  assert.deepEqual(result.warnings.find(w=>w.code==='STALE_EXCLUSIONS'),{code:'STALE_EXCLUSIONS',eventKeys:[key('held-recognition','trashed'),key('transaction-expense','income')],count:2});
});

test('held Scenario real coordinator state includes event-only months and preserves reversal/replacement exclusion identity',()=>{
 const H=require('../dist/held-funds.js').createCoordinator({now:()=> '2026-04-15T12:00:00.000Z'});
 let state=L.createEmpty();state.version=2;state.transactions=[{id:'pay',type:'expense',date:'2026-01-10',amountCents:10000,accountId:'account-cash',categoryId:'expense-food',note:'Principal'}];
 state.simulation={...S.defaultSettings(),completeMonths:['2026-03'],exclusions:['pay','old-stale']};
 function apply(command){const ticket=H.preview(state,command);state=H.commit(state,ticket,{confirmed:true,reason:'Synthetic identity fixture'});}
 apply({action:'create-position',asOfDate:'2026-04-15',expenseId:'pay',amountCents:10000,kind:'stored-value',name:'Paid principal',purpose:'',reference:'',expiry:{kind:'unknown',date:null},refundability:'unknown',terms:'',termsSource:'',confirmations:{paidPrincipalOnly:true,noTrackedWalletOverlap:true}});
 const p=state.bookkeeping.heldPositions[0].id;
 const recognize={action:'recognize',asOfDate:'2026-04-15',positionId:p,kind:'use',amountCents:2000,effectiveDate:'2026-03-10',categoryId:'expense-food',merchant:'Separate merchant',reference:'',confirmations:{notAlreadyRecordedAsExpense:true}};
 apply(recognize);const oldId=state.bookkeeping.heldRecognitions[0].id;
 assert.equal(state.transactions.filter(r=>r.date.startsWith('2026-03')).length,0);
 assert.equal(S.calculate(state,state.simulation,'2026-04-15').baseline.monthlyCents,2000);assert.equal(state.simulation.version,1);
 state.simulation={...state.simulation,version:2,exclusions:[...state.simulation.exclusions.map(id=>key('transaction-expense',id)),key('held-recognition',oldId)]};state=L.validateState(state);
 assert.equal(S.calculate(state,state.simulation,'2026-04-15').baseline.monthlyCents,0);
 apply({action:'reverse-recognition',asOfDate:'2026-04-15',recognitionId:oldId});apply(recognize);
 assert.notEqual(state.bookkeeping.heldRecognitions[0].id,oldId);
 const result=S.calculate(state,state.simulation,'2026-04-15');assert.equal(result.baseline.monthlyCents,2000);
 assert.deepEqual(result.warnings.find(w=>w.code==='STALE_EXCLUSIONS').eventKeys,[key('transaction-expense','old-stale'),key('held-recognition',oldId)]);
 const restored=L.parseBackup(L.backup(state));assert.deepEqual(restored.simulation,state.simulation);assert.deepEqual(S.calculate(restored,restored.simulation,'2026-04-15'),result);
});

test('held Scenario v2 supports ordinary cross-realm JSON, repeated aliases and rejects cyclic input before traversal',()=>{
 const input=settings([]),other=vm.runInNewContext('('+JSON.stringify(input)+')');assert.deepEqual(copy(S.validate(other)),input);
 const empty=[];input.scenarios[0].adjustments=empty;input.scenarios[0].oneOffs=empty;assert.deepEqual(S.validate(input),settings([]));
 const cyclic=settings([]);cyclic.exclusions.push(cyclic);assert.throws(()=>S.validate(cyclic),e=>e.code==='INVALID_SCHEMA');
});
