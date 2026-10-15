'use strict';
// Independent read-only compatibility harness. All paths are relative to a caller's repository root.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const CLOCK = '2026-10-14T10:00:00.000Z';
const MODULES = ['ledger', 'scenario', 'importer', 'relations', 'organizer', 'obligations'];
function realm(root, { counts = false, names = MODULES, forbidden = false, leaf = true } = {}) {
  const calls = { Ledger: 0, Relations: 0, Organizer: 0, Obligations: 0 };
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [CLOCK])); } static now() { return Date.parse(CLOCK); } }
  const context = vm.createContext({ window: {}, TextEncoder, TextDecoder, Date: FixedDate, __counts: calls });
  if (forbidden) for (const key of ['Date','document','localStorage','sessionStorage','fetch','XMLHttpRequest','WebSocket','setTimeout','indexedDB']) {
    Object.defineProperty(context, key, { get() { throw Error('Forbidden host access: ' + key); }, configurable: true });
    Object.defineProperty(context.window, key, { get() { throw Error('Forbidden window access: ' + key); }, configurable: true });
  }
  const files = [...(leaf && fs.existsSync(path.join(root, 'dist/personal-events.js')) ? ['personal-events'] : []), ...names];
  for (const name of files) {
    let source = fs.readFileSync(path.join(root, 'dist', name + '.js'), 'utf8');
    const key = { ledger: 'Ledger', relations: 'Relations', organizer: 'Organizer', obligations: 'Obligations' }[name];
    if (counts && key) {
      const token = name === 'ledger' ? 'function validateState(input) {' : name === 'organizer' ? 'function validate(value, state) {' : 'function validate(input, state) {';
      if (source.split(token).length !== 2) throw Error('Validator instrumentation needs review: ' + name);
      source = source.replace(token, token + ' __counts.' + key + '++;');
    }
    vm.runInContext(source, context, { filename: name + '.js' });
  }
  vm.runInContext(`const L=window.MoneygoLedger,S=window.MoneygoScenario,I=window.MoneygoImporter,R=window.MoneygoRelations,O=window.MoneygoOrganizer,C=window.MoneygoObligations,P=window.MoneygoPersonalEvents;
  const copy=x=>JSON.parse(JSON.stringify(x));
  function outcome(f) { try { return {accepted:true,value:f()}; } catch(e) {return {accepted:false,name:e.name,code:e.code===undefined?null:e.code};} }
  function freeze(x) { if(x&&typeof x==='object'){Object.freeze(x);for(const v of Object.values(x))freeze(v);}return x; }
  function oldView(v) { const result={...v};delete result.personalExpenseEvents;delete result.personalIncomeEvents;return result; }
  `, context);
  return {
    context, calls,
    set(key, value) { context.__inputJSON = JSON.stringify(value); vm.runInContext('var ' + key + '=JSON.parse(__inputJSON);delete globalThis.__inputJSON;', context); },
    run(code) { return vm.runInContext(code, context); },
    value(code) { const text = vm.runInContext('JSON.stringify(' + code + ')', context); return text === undefined ? undefined : JSON.parse(text); },
    count(code) { for (const key of Object.keys(calls)) calls[key] = 0; const result = this.value(code); return { counts: { ...calls }, result }; }
  };
}
function capture(root, fixture) {
  const h = realm(root); h.set('input', fixture.inputState); h.set('settings', fixture.settings); h.set('months', fixture.months); h.set('closeSelections', fixture.closeSelections || []);
  h.run('freeze(input);freeze(settings);');
  const before = h.run('JSON.stringify(input)');
  const result = h.value(`(() => {
    const output={}; const save=(key, fn)=>{output[key]=JSON.stringify(outcome(fn));};
    save('normalized',()=>L.validateState(input));
    save('backup',()=>L.backup(input));
    save('backupRoundTrip',()=>L.parseBackup(L.backup(input)));
    save('backupVerify',()=>L.verifyBackup(L.backup(input)));
    save('balances',()=>L.balances(input)); save('expenseAmounts',()=>L.expenseAmounts(input));
    for(const month of [undefined,...months]) {const k=month===undefined?'all':month;
      save('relations:'+k,()=>oldView(R.calculate(input,month)));
      save('financialView:'+k,()=>oldView(L.financialView(input,month)));
      save('summary:'+k,()=>L.summary(input,month));
      save('merchants:'+k,()=>O.merchantView(input,month));
    }
    save('scenario',()=>S.calculate(input,settings,'2026-10-14'));
    save('obligations',()=>C.view(input,{asOf:'2026-10-31'}));
    for(const request of closeSelections) {
      const key=JSON.stringify(request);
      save('close:'+key,()=>O.closeMonth(input,{...request,reason:'Independent compatibility close',at:'${CLOCK}'}));
      save('closeCompare:'+key,()=>{const state=O.closeMonth(input,{...request,reason:'Independent compatibility close',at:'${CLOCK}'});return O.compareMonth(state,state.organizer.closes.at(-1).id);});
    }
    for(const close of input.organizer?.closes||[])save('existingClose:'+close.id,()=>O.compareMonth(input,close.id));
    save('store',()=>{const map=new Map(),operations=[];const storage={getItem:k=>map.has(k)?map.get(k):null,setItem(k,v){operations.push(['set',k,v]);map.set(k,v);},removeItem(k){operations.push(['remove',k]);map.delete(k);}};L.save(storage,input);const loaded=L.load(storage);return {operations,loaded,stored:[...map]};});
    return output;
  })()`);
  if (h.run('JSON.stringify(input)') !== before) throw Error('Read APIs mutated fixture ' + fixture.id);
  return result;
}
// An independently specified event oracle from frozen old raw impacts. Never called by the candidate tests.
function expectedEvents(root, state) {
  const h = realm(root); h.set('input', state);
  return h.value(`(() => {const v=R.calculate(input),expenseEvents=[],incomeEvents=[];
    for(const t of input.transactions){if(t.type==='transfer')continue;const x=v.impacts[t.id];
      const amountCents=t.type==='expense'?x.personalExpenseCents:x.ordinaryIncomeCents;
      const event={key:{kind:t.type==='expense'?'transaction-expense':'transaction-income',id:t.id},effectiveDate:t.date,categoryId:t.categoryId,amountCents,origin:{kind:'transaction',transactionId:t.id},attribution:{kind:'transaction',transactionId:t.id,accountId:t.accountId},route:{kind:'transaction',transactionId:t.id},excluded:x.excluded,suppression:x.excluded?'duplicate-evidence':x.transferPairId?'transfer-leg':t.type==='expense'&&!x.personalAuthority?'composite-nonpersonal':amountCents===0?'fully-allocated':null};
      (t.type==='expense'?expenseEvents:incomeEvents).push(event);
    }return {personalExpenseEvents:expenseEvents,personalIncomeEvents:incomeEvents};})()`);
}
function boundaries(root) {
 const h=realm(root);return h.value(`(() => {
   const results={};const save=(name,fn)=>results[name]=outcome(fn);
   function base(){const s=L.createEmpty();s.accounts.push({id:'bank',name:'Bank',openingBalanceCents:0});s.transactions=[{id:'e',type:'expense',date:'2026-09-01',amountCents:101,accountId:'account-cash',categoryId:'expense-food',note:''},{id:'i',type:'income',date:'2026-09-02',amountCents:51,accountId:'account-cash',categoryId:'income-other',note:''}];return s;}
   for(const [name,value] of [['omitted',undefined],['null',null],['number',14],['object',{}],['malformed','bad/category'],['missing','missing'],['wrong-type','income-other']]){
     const s=base();s.transactions[0].categoryId=value;if(name==='omitted')delete s.transactions[0].categoryId;
     save('relations-category-'+name,()=>oldView(R.calculate(s)));
     save('ledger-category-'+name,()=>L.summary(s));
   }
   const missingTable=base();delete missingTable.categories;save('relations-no-category-table',()=>oldView(R.calculate(missingTable)));
   for(const kind of ['getter','prototype','symbol','sparse']){const s=base();
     if(kind==='getter')Object.defineProperty(s.transactions[0],'categoryId',{get(){throw Error('Getter executed');},enumerable:true});
     if(kind==='prototype')Object.setPrototypeOf(s.transactions[0],{categoryId:'expense-food'});
     if(kind==='symbol')s.transactions[0][Symbol('hidden')]=1;
     if(kind==='sparse')delete s.transactions[0];
     save('relations-structure-'+kind,()=>oldView(R.calculate(s)));save('ledger-structure-'+kind,()=>L.summary(s));
   }
   for(const m of [null,'','2026-00','2026-13','0000-01','2026-9',202609])for(const api of ['summary','financialView','relations']){
     save(api+'-invalid-state-month-'+JSON.stringify(m),()=>api==='relations'?R.calculate({version:999},m):L[api]({version:999},m));
     save(api+'-valid-state-month-'+JSON.stringify(m),()=>api==='relations'?R.calculate(base(),m):L[api](base(),m));
   }
   for(const v of [0,-1,1.1,'1',null,NaN,Infinity,999999999999,1000000000000,Number.MAX_SAFE_INTEGER])for(const bk of [false,true]){
     const s=base();s.transactions[0].amountCents=v;if(bk){s.version=4;s.bookkeeping=R.defaultState();}
     save('amount-'+String(v)+'-'+bk,()=>L.summary(s));
   }
   const max=999999999999,overflow=base();overflow.accounts[0].openingBalanceCents=-max;overflow.transactions=Array.from({length:9007},(_,i)=>({id:'expense-'+i,type:'expense',date:'2026-09-01',amountCents:max,accountId:'account-cash',categoryId:'expense-food',note:''}));overflow.transactions.push({id:'income',type:'income',date:'2026-09-01',amountCents:max,accountId:'account-cash',categoryId:'income-other',note:''});
   for(const bk of [false,true]){const s={...overflow,...(bk?{version:4,bookkeeping:R.defaultState()}:{})};save('temporary-balance-overflow-'+bk,()=>L.summary(s));save('temporary-overflow-unrelated-month-'+bk,()=>L.summary(s,'2026-08'));}
   const gross=base();gross.transactions=Array.from({length:9010},(_,i)=>({id:'row-'+i,type:'expense',date:'2026-09-01',amountCents:max,accountId:i%2?'bank':'account-cash',categoryId:'expense-food',note:''}));
   for(const bk of [false,true])save('gross-overflow-'+bk,()=>L.summary({...gross,...(bk?{version:4,bookkeeping:R.defaultState()}:{})}));
   const future=base();future.transactions.push({id:'future',type:'expense',date:'9999-12-31',amountCents:3,accountId:'account-cash',categoryId:'expense-other',note:''});save('future-all-summary',()=>L.summary(future));save('future-month-summary',()=>L.summary(future,'9999-12'));save('scenario-out-of-range',()=>S.calculate(base(),S.defaultSettings(),'9999-10-01'));
   return results;
 })()`);
}
function validatorCounts(root, fullState) {
  const h=realm(root,{counts:true});h.set('full',fullState);
  h.run(`var plain=L.createEmpty();plain.transactions=[{id:'e',type:'expense',date:'2026-09-01',amountCents:101,accountId:'account-cash',categoryId:'expense-food',note:''}];var book={...plain,version:4,bookkeeping:R.defaultState()};var settings={...S.defaultSettings(),completeMonths:['2026-09']};`);
  const ops={scenarioPlain:"S.calculate(plain,settings,'2026-10-14')",scenarioBookkeeping:"S.calculate(book,settings,'2026-10-14')",financialViewPlain:'oldView(L.financialView(plain))',summaryPlain:'L.summary(plain)',scenarioFull:"S.calculate(full,full.simulation,'2026-10-14')",financialViewFull:'oldView(L.financialView(full))',merchantFull:"O.merchantView(full,'2026-10')",compareFull:'O.compareMonth(full,full.organizer.closes[0].id)',obligationsFull:"C.view(full,{asOf:'2026-10-31'})"};
  return Object.fromEntries(Object.entries(ops).map(([name,code])=>[name,h.count(code).counts]));
}
module.exports={CLOCK,MODULES,realm,capture,expectedEvents,boundaries,validatorCounts};
