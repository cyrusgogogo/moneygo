'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { L, copy, spending, base, tx } = require('./spending-boundary-helpers.cjs');
const { buildFullBackupFixture } = require('./full-backup-fixture.cjs');
const old = require('./fixtures/spending-readers-v016/ledger.js');
const R = require('../dist/relations'), O = require('../dist/organizer'), C = require('../dist/obligations'), I = require('../dist/importer');
test('v8 preserves all normalized old subtrees and introduces no unrelated optional extension', () => {
  for (const input of [L.createEmpty(), buildFullBackupFixture().state, require('./income-root-fixture.cjs').combined().state]) {
    const before = L.validateState(input), next = spending(before), stripped = copy(next); delete stripped.spendingPlanning; stripped.version = before.version;
    assert.deepEqual(stripped, before); for (const key of ['incomePlanning','imports','bookkeeping','organizer','obligations','simulation']) assert.equal(Object.hasOwn(next,key),Object.hasOwn(before,key));
  }
});
test('v8 requires spending v1, optional income v1; downlevel/missing/unknown wrappers fail', () => {
  for (const both of [false,true]) {
    const state = spending(base(), {both}); assert.equal(state.version,8); assert.equal(Object.hasOwn(state,'incomePlanning'),both);
    for (const version of [1,2,3,4,5,6,7,9]) { const bad = copy(state); bad.version=version; assert.throws(()=>L.validateState(bad)); }
    const missing=copy(state);delete missing.spendingPlanning;assert.throws(()=>L.validateState(missing),{code:'INVALID_VERSION'});
    for(const key of ['spendingPlanning', ...(both?['incomePlanning']:[])]) {const bad=copy(state);bad[key].version=2;assert.throws(()=>L.validateState(bad));}
    const unknown=copy(state);unknown.surprise=true;assert.throws(()=>L.validateState(unknown),{code:'INVALID_DATA'});
    const envelope=JSON.parse(L.backup(state));for(const version of [7,9]){envelope.version=version;assert.throws(()=>L.parseBackup(JSON.stringify(envelope)));}
  }
  const v7=require('./income-boundary-helpers.cjs').planning(base());assert.deepEqual(L.validateState(v7),old.validateState(v7));
});
test('legacy v1–v7 normalized order and byte behavior are frozen-reader identical', () => {
  const all=buildFullBackupFixture().state, extensions=['simulation','imports','bookkeeping','organizer','obligations'];
  for(let version=1;version<=6;version++) {const raw=copy(all);raw.version=version;for(let i=version-1;i<extensions.length;i++)delete raw[extensions[i]];assert.equal(JSON.stringify(L.validateState(raw)),JSON.stringify(old.validateState(raw)));}
  const v7=require('./income-boundary-helpers.cjs').planning(base([tx('z'),tx('a')]));assert.equal(JSON.stringify(L.validateState(v7)),JSON.stringify(old.validateState(v7)));assert.deepEqual(v7.transactions.map(x=>x.id),['z','a']);
});
test('v8 strict preflight rejects getters, hidden/symbol/custom data and downlevel inherited extensions before execution/writes', () => {
  let executed=0,writes=0;const storage={setItem(){writes++;}};
  const mutations=[s=>Object.defineProperty(s.transactions[0],'type',{enumerable:true,get(){executed++;return 'expense';}}),s=>Object.defineProperty(s.accounts[0],'hidden',{value:true}),s=>{s.spendingPlanning.audit[0].changes[0].after.toJSON=()=>{executed++;};},s=>Object.setPrototypeOf(s.accounts[0],{custom:true}),s=>{s.accounts.extra=true;},s=>{s[Symbol('extra')]=true;},s=>Object.defineProperty(s,'spendingPlanning',{enumerable:true,get(){executed++;return {};}}),s=>Object.defineProperty(s.spendingPlanning,'version',{enumerable:true,get(){executed++;return 1;}})];
  for(const mutate of mutations){const s=copy(spending(base([tx('expense','expense')])));mutate(s);assert.throws(()=>L.save(storage,s));assert.throws(()=>L.collectRetainedIdentities(s));}
  const inherited=base();Object.setPrototypeOf(inherited,{get spendingPlanning(){executed++;return {};}});assert.throws(()=>L.validateState(inherited));
  assert.equal(executed,0);assert.equal(writes,0);
});
test('ordinary other-realm data accepted; new strict preflight does not reorder legacy arrays',()=>{const raw=vm.runInNewContext('('+JSON.stringify(spending(base([tx('z'),tx('a')])))+')');const normalized=L.validateState(raw);assert.equal(normalized.version,8);assert.deepEqual(Array.from(normalized.transactions,x=>x.id),['z','a']);});
test('every direct legacy family enters full v8 validation before touching malicious base getters',()=>{
  const writers=[s=>R.createClaim(s,{expenseId:'expense',amountCents:100,kind:'advance',name:'Claim',status:'unsubmitted',note:''}),s=>O.saveRule(s,{name:'Rule',conditions:{type:'expense'},actions:{categoryId:'expense-food'}}),s=>C.putProfile(s,{accountId:'credit',role:'credit',creditLimitCents:null,note:''},{confirmed:true,expectedRevision:0,reason:'Test'}),s=>I.preview(s,'date,amount\n2026-10-01,10',{sourceKey:'Synthetic',accountId:'account-cash',columns:{date:'date',amount:'amount'}})];
  let touched=0;for(const write of writers){for(const version of [8,7,1]){const s=copy(spending(base([tx('expense','expense')])));s.version=version;Object.defineProperty(s.transactions[0],'type',{enumerable:true,get(){touched++;return 'expense';}});assert.throws(()=>write(s));}}assert.equal(touched,0);
});
test('corrupt v8 storage is returned with error without overwriting original bytes',()=>{const s=copy(spending());s.spendingPlanning.audit[0].changes[0].after.name='unrecorded';const saved=JSON.stringify(s),writes=[];const result=L.load({getItem:()=>saved,setItem:(...x)=>writes.push(x)});assert.ok(result.error);assert.deepEqual(writes,[]);assert.deepEqual(result.state,L.createEmpty());});
test('hostile v8 Proxy boundary traps normalize stable invalid-data errors with no writes or serialization',()=>{
  const s=spending(base([tx('expense','expense')]));let serialized=0,writes=0;
  const traps=[{getOwnPropertyDescriptor(){throw new Error('hostile descriptor');}},{has(){throw new Error('hostile membership');}},{getPrototypeOf(){throw new Error('hostile prototype');}},{ownKeys(){throw new Error('hostile keys');}}];
  const actions=[x=>L.validateState(x),x=>L.collectRetainedIdentities(x),x=>L.save({setItem(){writes++;}},x),x=>R.createClaim(x,{expenseId:'expense',amountCents:1,name:'Claim',kind:'advance'}),x=>O.saveRule(x,{name:'Rule',conditions:{type:'expense'},actions:{categoryId:'expense-food'}}),x=>C.putProfile(x,{accountId:'credit',role:'credit',creditLimitCents:null,note:''},{confirmed:true,expectedRevision:0,reason:'Synthetic'}),x=>I.saveTemplate(x,{headers:[],config:{}})];
  for(const trap of traps)for(const action of actions){const proxied=new Proxy(copy(s),{...trap,get(target,key,receiver){if(key==='toJSON')serialized++;return Reflect.get(target,key,receiver);}});assert.throws(()=>action(proxied),error=>['INVALID_DATA','SPENDING_INVALID_DATA','SPENDING_INVALID_RECORD'].includes(error.code),Object.keys(trap)[0]);}
  assert.equal(serialized,0);assert.equal(writes,0);
});
test('v8 detaches own descriptors before legacy reads, never executing hostile get/toJSON traps',()=>{
  const raw=spending(base([tx('expense','expense')]));let reads=0;
  const wrapped=new WeakMap();function proxy(value){if(!value||typeof value!=='object')return value;if(wrapped.has(value))return wrapped.get(value);const p=new Proxy(value,{get(){reads++;throw new Error('Caller property get must not execute');},getOwnPropertyDescriptor(target,key){const d=Reflect.getOwnPropertyDescriptor(target,key);return d&&Object.hasOwn(d,'value')?{...d,value:proxy(d.value)}:d;}});wrapped.set(value,p);return p;}
  // Proxy invariants require configurable/writable copies, not the frozen accepted extension.
  const hostile=proxy(copy(raw));assert.deepEqual(L.validateState(hostile),raw);assert.deepEqual(L.collectRetainedIdentities(hostile),L.collectRetainedIdentities(raw));
  const writes=[];assert.deepEqual(L.save({setItem:(...args)=>writes.push(args)},hostile),raw);assert.equal(writes.length,1);
  assert.equal(R.createClaim(hostile,{expenseId:'expense',amountCents:1,name:'Synthetic claim',kind:'advance'}).version,8);
  assert.equal(O.saveRule(hostile,{name:'Rule',conditions:{type:'expense'},actions:{categoryId:'expense-food'}}).version,8);
  assert.equal(C.putProfile(hostile,{accountId:'credit',role:'credit',creditLimitCents:null,note:''},{confirmed:true,expectedRevision:0,reason:'Synthetic'}).version,8);
  const config={sourceKey:'Synthetic',accountId:'account-cash',delimiter:',',columns:{date:'date',amount:'amount',direction:'direction'}};assert.doesNotThrow(()=>I.preview(hostile,'date,amount,direction\n2026-10-01,1,expense',config));assert.equal(reads,0);
});
test('late proxy descriptor changes fail atomically during bounded snapshot without invoking getters',()=>{
  for(const kind of ['accessor','cycle','thrown']){
    const raw=copy(spending()),account=raw.accounts[0];let passes=0,executed=0,writes=0;
    raw.accounts[0]=new Proxy(account,{ownKeys(target){if(++passes===2){if(kind==='accessor')Object.defineProperty(target,'late',{enumerable:true,configurable:true,get(){executed++;return 'unsafe';}});else if(kind==='cycle')target.late=target;else throw new Proxy({}, {get(){executed++;throw new Error('Thrown values must never be inspected');}});}return Reflect.ownKeys(target);}});
    assert.throws(()=>L.save({setItem(){writes++;}},raw),error=>error.code==='INVALID_DATA');assert.equal(executed,0);assert.equal(writes,0);assert.ok(passes>=2);
  }
});
test('snapshot has its own node/string bounds even when earlier safety inspection completed',()=>{
  const fs=require('node:fs'),path=require('node:path'),Core=require('../dist/spending-core.js');
  for(const limits of [{dataNodes:2},{stringCodeUnits:2}]){
    const holder={exports:{}},fake={...Core,LIMITS:{...Core.LIMITS,...limits}};
    Function('module','require',fs.readFileSync(require.resolve('../dist/ledger.js'),'utf8'))(holder,p=>p==='./spending-core.js'?fake:require(path.join(__dirname,'../dist',p)));
    let writes=0;assert.throws(()=>holder.exports.save({setItem(){writes++;}},spending()),error=>error.code==='INVALID_DATA');assert.equal(writes,0);
  }
});
test('v8 cross-realm Obligations and captured cash-role proof accepted without relaxing older direct guards',()=>{
  const state=spending(base([tx('source','expense')]),{payment:true,sourceId:'source',both:true});const foreign=vm.runInNewContext('('+JSON.stringify(state)+')');assert.deepEqual(L.validateState(foreign),state);assert.deepEqual(L.parseBackup(L.backup(foreign)),state);
  const oldState=copy(state);delete oldState.spendingPlanning;oldState.version=7;const foreignOld=vm.runInNewContext('('+JSON.stringify(oldState)+')');assert.throws(()=>old.validateState(foreignOld));assert.throws(()=>L.validateState(foreignOld));
});
test('v8 strict field/version gates use the detached snapshot, never an earlier mutable proxy header',()=>{
  const raw=copy(spending());raw.unexpected='must not silently drop';let reads=0,writes=0;const proxy=new Proxy(raw,{getOwnPropertyDescriptor(target,key){const d=Reflect.getOwnPropertyDescriptor(target,key);return key==='version'&&++reads===1?{...d,value:1}:d;}});
  assert.throws(()=>L.save({setItem(){writes++;}},proxy),{code:'INVALID_DATA'});assert.equal(writes,0);
});
