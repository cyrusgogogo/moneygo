'use strict';
const {test}=require('node:test');const {A,L,R,vm,copy,bytes,tx,base,plan,pid,command,query,coordinator,conform,frozen,rejects,day,now}=require('./refund-receipts-independent-fixtures.cjs');
for(const [label,confirmation]of [['false',()=>({confirmed:false})],['missing',()=>({})],['extra',()=>({confirmed:true,reason:'replacement'})],['null',()=>null],['array',()=>[true]],['custom-prototype',()=>Object.create({confirmed:true})]])test('RR independent authority: recognized attempt burns '+label+' consent',()=>{
 const s=base(),c=coordinator(),t=c.preview(s,command());rejects(s,()=>c.commit(s,t,confirmation()));rejects(s,()=>c.commit(s,t,{confirmed:true}));A.equal(c.isCurrent(s,t),false);
});
test('RR independent authority: cloned foreign invented and raw-candidate identities never authorize',()=>{
 const s=base(),c=coordinator(),t=c.preview(s,command()),other=coordinator(),foreign=other.preview(s,command());for(const fake of [copy(t),foreign,{},R.allocateRefund(s,command())])rejects(s,()=>c.commit(s,fake,{confirmed:true}));A.equal(c.isCurrent(s,t),true);const out=c.commit(s,t,{confirmed:true});A.equal(out.bookkeeping.refunds.length,1);rejects(s,()=>c.commit(s,t,{confirmed:true}));A.equal(other.isCurrent(s,foreign),true);
});
test('RR independent authority: detached command immutable review and frozen candidate',()=>{
 const s=base(),before=bytes(s),draft=command(),c=coordinator(),t=c.preview(s,draft);draft.amountCents=5000;draft.reason='changed original';frozen(t);A.throws(()=>{t.review.command.amountCents=5000;});A.equal(t.review.command.amountCents,1000);const out=c.commit(s,t,{confirmed:true});frozen(out);A.equal(out.bookkeeping.refunds[0].amountCents,1000);A.equal(bytes(s),before);
});
for(const [label,change]of [
 ['income-note',s=>{s.transactions[1].note='changed';}],['income-amount',s=>{s.transactions[1].amountCents=6000;}],['income-date',s=>{s.transactions[1].date='2026-10-11';}],['income-account',s=>{s.transactions[1].accountId='bank';}],['income-category',s=>{s.transactions[1].categoryId='income-salary';}],['expense-note',s=>{s.transactions[0].note='changed';}],['expense-amount',s=>{s.transactions[0].amountCents=11000;}],['expense-date',s=>{s.transactions[0].date='2026-09-02';}],['expense-account',s=>{s.transactions[0].accountId='bank';}],['account-name',s=>{s.accounts[1].name='Changed bank';}],['account-opening',s=>{s.accounts[1].openingBalanceCents=1;}],['unrelated-row',s=>{s.transactions.push(tx('new','expense',1));}],['transaction-order',s=>{s.transactions.reverse();}],['account-order',s=>{s.accounts.reverse();}],['raw-optional-presence',s=>{s.transactions[1].toAccountId=null;}]
])test('RR independent authority: full raw basis stales '+label,()=>{
 const s=base(),c=coordinator(),t=c.preview(s,command()),changed=copy(s);change(changed);A.equal(c.isCurrent(changed,t),false);rejects(changed,()=>c.commit(changed,t,{confirmed:true}));rejects(s,()=>c.commit(s,t,{confirmed:true}));
});
test('RR independent authority: object insertion order alone retains current exact review',()=>{
 const s=base(),c=coordinator(),t=c.preview(s,command());function reorder(v){return Array.isArray(v)?v.map(reorder):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).reverse().map(([k,x])=>[k,reorder(x)])):v;}const next=reorder(s);A.equal(c.isCurrent(next,t),true);A.equal(c.commit(next,t,{confirmed:true}).bookkeeping.refunds.length,1);
});
test('RR independent authority: cancellation and context invalidation retire every retained ticket',()=>{
 const s=base(),c=coordinator(),a=c.preview(s,command()),b=c.preview(s,command());const result=c.cancel(a);conform(result,'cancelResult');c.cancel(a);A.equal(c.isCurrent(s,a),false);rejects(s,()=>c.commit(s,a,{confirmed:true}));A.equal(c.isCurrent(s,b),true);c.invalidateAll();A.equal(c.isCurrent(s,b),false);rejects(s,()=>c.commit(s,b,{confirmed:true}));A.equal(c.commit(s,c.preview(s,command()),{confirmed:true}).bookkeeping.refunds.length,1);
});
for(const [label,mutate]of [['midnight',clock=>{clock.date='2026-10-15';clock.instant='2026-10-15T00:00:00.000Z';}],['backward-instant',clock=>{clock.instant='2026-10-14T11:59:59.999Z';}],['invalid-day',clock=>{clock.date='2026-02-29';}],['invalid-instant',clock=>{clock.instant='not-an-instant';}]])test('RR independent authority: clock change fails closed '+label,()=>{
 const s=base(),clock={date:day,instant:now},c=coordinator({today:()=>clock.date,now:()=>clock.instant}),t=c.preview(s,command());mutate(clock);A.equal(c.isCurrent(s,t),false);rejects(s,()=>c.commit(s,t,{confirmed:true}));clock.date=day;clock.instant=now;rejects(s,()=>c.commit(s,t,{confirmed:true}));
});
test('RR independent authority: UTC/local mismatch and arbitrarily long same-day interval remain valid',()=>{
 const s=base(),clock={instant:'2026-10-13T23:00:00.000Z'},c=coordinator({now:()=>clock.instant}),t=c.preview(s,command());clock.instant='2099-01-01T12:00:00.000Z';A.equal(c.isCurrent(s,t),true);A.equal(c.commit(s,t,{confirmed:true}).bookkeeping.refunds.length,1);
});
test('RR independent authority: day changes during preview before completion cannot issue ticket',()=>{
 const s=base();let samples=0;const c=coordinator({today:()=>++samples===1?day:'2026-10-15'});rejects(s,()=>c.preview(s,command()));
});
test('RR independent authority: cross-realm ordinary data remains supported',()=>{
 const raw=vm.runInNewContext('('+bytes(base())+')'),cmd=vm.runInNewContext('('+bytes(command())+')'),c=coordinator(),t=c.preview(raw,cmd);conform(t,'ticket');A.equal(c.commit(raw,t,vm.runInNewContext('({confirmed:true})')).bookkeeping.refunds.length,1);
});
for(const target of ['raw','command','query','confirmation'])test('RR independent authority: descriptor-first '+target+' never invokes getters or toJSON',()=>{
 for(const mode of ['getter','toJSON','symbol','prototype','function','nan','unsafe','cycle']){let calls=0;const s=base(),c=coordinator(),t=target==='confirmation'?c.preview(s,command()):null;let v=target==='raw'?copy(s):target==='query'?query():target==='confirmation'?{confirmed:true}:command();if(mode==='getter')Object.defineProperty(v,target==='raw'?'transactions':target==='query'?'search':target==='confirmation'?'confirmed':'reason',{enumerable:true,get(){calls++;throw Error('must not execute');}});if(mode==='toJSON')v.toJSON=()=>{calls++;return {};};if(mode==='symbol')v[Symbol('hidden')]=true;if(mode==='prototype')v=Object.create(v);if(mode==='function')v.extra=()=>{};if(mode==='nan')v.extra=NaN;if(mode==='unsafe')v.extra=Number.MAX_SAFE_INTEGER+1;if(mode==='cycle')v.extra=v;
 const run=()=>target==='raw'?c.overview(v):target==='query'?c.candidates(s,v):target==='confirmation'?c.commit(s,t,v):c.preview(s,v);A.throws(run,undefined,target+'/'+mode);A.equal(calls,0,target+'/'+mode);if(t)rejects(s,()=>c.commit(s,t,{confirmed:true}));}
});
test('RR independent authority: sparse decorated arrays and hostile proxy thrown getters fail safely',()=>{
 let calls=0;for(const array of [new Array(1),Object.assign([],{extra:true})]){const s=base();s.transactions=array;A.throws(()=>coordinator().overview(s));}const evil={};Object.defineProperties(evil,{message:{get(){calls++;throw Error('message access');}},code:{get(){calls++;throw Error('code access');}}});for(const trap of ['getPrototypeOf','ownKeys','getOwnPropertyDescriptor']){const target=base(),p=new Proxy(target,{[trap](){throw evil;}});A.throws(()=>coordinator().overview(p));}A.equal(calls,0);
});
test('RR independent authority: exact reason and identifier boundaries follow allocator normalization',()=>{
 const id='x'.repeat(100),s=base([tx('expense','expense',10000,'2026-09-01'),tx(id)]),c=coordinator(),t=c.preview(s,command({incomeId:id,reason:'x'.repeat(500)}));A.equal(t.review.command.reason,'x'.repeat(500));A.equal(c.commit(s,t,{confirmed:true}).bookkeeping.refunds[0].reason,'x'.repeat(500));for(const reason of ['', ' '.repeat(10),'x'.repeat(501)])rejects(s,()=>coordinator().preview(s,command({incomeId:id,reason})));for(const incomeId of ['x'.repeat(101),'constructor','__proto__'])rejects(s,()=>coordinator().preview(s,command({incomeId})));for(const amountCents of [0,-1,0.1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])rejects(s,()=>coordinator().preview(s,command({incomeId:id,amountCents})));
});
for(const mode of ['missing-note','extra-null-account'])test('RR independent authority: raw base-row normalization cannot be hidden by successful review '+mode,()=>{
 const s=base();if(mode==='missing-note')delete s.transactions[1].note;else s.transactions[1].toAccountId=null;const before=bytes(s),rawRows=bytes(s.transactions);A.ok(L.validateState(s));A.equal(bytes(R.allocateRefund(s,command()).transactions),rawRows,'Unchanged public writer preserves these raw base fields');const c=coordinator();c.overview(s);A.equal(bytes(s),before);rejects(s,()=>c.preview(s,command()));A.equal(bytes(s),before);
});
for(const mode of ['trash-missing-note','legacy-organizer-v1','scenario-trimmed-name','legacy-imports-v1'])test('RR independent authority: unrelated raw subtree normalization must refuse '+mode,()=>{
 const F=require('./refund-receipts-independent-fixtures.cjs');let s=base(),key;if(mode==='trash-missing-note'){s.trash.push({id:'trash-row',deletedAt:now,transaction:tx('trash-row','expense',1)});delete s.trash[0].transaction.note;key='trash';}if(mode==='legacy-organizer-v1'){s.version=5;s.organizer=F.O.defaultState();s.organizer.version=1;key='organizer';}if(mode==='scenario-trimmed-name'){s.version=2;s.simulation=F.from('dist/scenario.js').defaultSettings();s.simulation.scenarios[0].name='  Synthetic padded scenario  ';key='simulation';}if(mode==='legacy-imports-v1'){s=F.imported(s,'date,amount,type,note,id\n2026-10-10,1.00,income,Imported unrelated source,legacy-stable\n');s.imports.version=1;(function walk(v){if(!v||typeof v!=='object')return;delete v.sourceLine;Object.values(v).forEach(walk);})(s.imports);key='imports';}
 A.ok(L.validateState(s));A.equal(bytes(R.allocateRefund(s,command())[key]),bytes(s[key]),'Direct unchanged writer preserves accepted raw '+key);const before=bytes(s),c=coordinator();c.overview(s);A.equal(bytes(s),before);rejects(s,()=>c.preview(s,command()));
});
