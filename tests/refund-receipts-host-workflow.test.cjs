'use strict';
// RR-021/024/027/031/035/036. Real production entry order and public allocation.
const test=require('node:test'),A=require('node:assert/strict'),H=require('./refund-receipts-host-harness.cjs');

// Full own-data evidence is realm-independent, preserves field presence and array
// order, and records every original node's prior frozen status before preparation.
function preparedObservation(){
 const rows=[];
 function inspect(value){const data=[],frozen=[],stack=[{value,path:[]}];while(stack.length){const {value,path}=stack.pop();if(value===null||typeof value!=='object'){A.ok(value===null||['string','number','boolean'].includes(typeof value));data.push({path,type:value===null?'null':typeof value,value});continue;}A.equal(Object.getOwnPropertySymbols(value).length,0);const keys=Object.getOwnPropertyNames(value).sort();data.push({path,type:Array.isArray(value)?'array':'object',keys});frozen.push({path,frozen:Object.isFrozen(value)});for(const key of keys.slice().reverse()){const d=Object.getOwnPropertyDescriptor(value,key);A.ok(Object.hasOwn(d,'value'));A.ok(d.enumerable||Array.isArray(value)&&key==='length');stack.push({value:d.value,path:path.concat(key)});}}return {data,frozen};}
 return {rows,inspect,afterScript(file,context,window){if(file!=='save-preflight.js')return;const real=window.MoneygoSavePreflight;window.MoneygoSavePreflight=Object.freeze({...real,prepare(...args){const record={input:args[0],before:inspect(args[0])};rows.push(record);record.out=real.prepare(...args);record.after=inspect(args[0]);return record.out;}});}};
}
function assertPreparedRefund(a,observation){const row=observation.rows[0],commit=H.latest(a,'commit').out,saved=a.saves[0].args[1];A.equal(observation.rows.length,1);A.equal(row.input,commit);A.notEqual(saved,commit);A.equal(saved,row.out.state);A.deepEqual(observation.inspect(saved).data,row.before.data);A.deepEqual(observation.inspect(commit),row.before);A.deepEqual(row.after,row.before);A.ok(row.before.frozen.every(x=>x.frozen));A.ok(observation.inspect(saved).frozen.every(x=>x.frozen));for(const attempt of H.io(a,'set',H.KEY))A.equal(attempt[2],row.out.compactRaw);}
for(const personal of [true,false])test('refund host RR-031 '+(personal?'personal':'synthetic')+': literal scripts, inert initial report and one binding per document',()=>{
 const a=H.app({personal,open:false}),before=H.snapshot(a);
 A.ok(a.scriptNames.includes('refund-receipts.js'));A.ok(a.scriptNames.includes('refund-receipts-ui.js'));
 A.ok(a.scriptNames.indexOf('refund-receipts.js')<a.scriptNames.indexOf('refund-receipts-ui.js'));
 A.ok(a.scriptNames.indexOf('refund-receipts-ui.js')<a.scriptNames.indexOf('app-runtime-v1.js'));
 A.equal(a.calls.createCoordinator||0,0);A.equal(a.writerCalls.length,0);A.equal(a.run('Date.name'),'Date');
 const count=()=>Object.fromEntries([...a.docListeners].map(([k,v])=>[k,v.length]));const listeners=count();
 a.run('B.bind(bookkeepingContext());B.bind(bookkeepingContext());render();render()');A.deepEqual(count(),listeners);
 A.equal(a.calls.overview||0,0);A.equal(a.calls.candidates||0,0);H.quiet(a,before);
 H.open(a);const constructors=a.calls.createCoordinator;A.equal(constructors,1);a.run('B.bind(bookkeepingContext());render();render()');A.equal(a.calls.createCoordinator,constructors);A.deepEqual(count(),listeners);H.quiet(a,before);
});
for(const personal of [true,false])for(const route of ['manual','plan','detail'])test('refund host RR-031 '+(personal?'personal':'synthetic')+' '+route+': exact draft, real review, explicit consent, one audited save',()=>{
 const observation=preparedObservation(),a=H.app({personal,afterScript:observation.afterScript}),before=H.snapshot(a),initial=a.run('state'),f=a.fixture;
 H.draft(a,{route,planId:route==='plan'?f.planId:null});A.equal(a.node('#entry-form').elements.namedItem('amount').value,'30.00');H.preview(a);
 const review=H.latest(a,'preview').out.review,form=a.node('#entry-form');A.equal(review.command.expenseId,f.expenseId);A.equal(review.command.incomeId,f.incomeId);A.equal(review.command.amountCents,3000);A.equal(review.command.reason,'Explicit synthetic exact refund review');A.equal(review.command.planId,route==='plan'?f.planId:null);
 A.equal(form.elements.namedItem('confirmed').checked,false);A.equal(a.node('#refund-confirm').disabled,true);A.equal(a.calls.commit||0,0);A.equal(a.writerCalls.length,1);A.ok(Object.isFrozen(review));A.ok(Object.isFrozen(review.command));H.quiet(a,before);
 H.confirm(a);A.equal(a.calls.commit,1);A.equal(a.writerCalls.length,2);A.equal(H.io(a,'set',H.KEY).length,1);A.equal(a.saves.length,1);assertPreparedRefund(a,observation);A.equal(a.saves[0].stateAtSave,initial);
 const after=H.snapshot(a),saved=JSON.parse(after.state);A.equal(after.savedRaw,after.stored);A.equal(saved.bookkeeping.refunds.length,1);A.equal(saved.bookkeeping.refunds[0].amountCents,3000);A.equal(saved.bookkeeping.refundPlans[0].status,'waiting');A.equal(saved.bookkeeping.audit.filter(r=>r.kind==='refund'&&r.action==='create').length,1);A.deepEqual(after.balances,before.balances);A.deepEqual(saved.transactions,JSON.parse(before.state).transactions);A.deepEqual(saved.accounts,JSON.parse(before.state).accounts);A.equal(saved.transactions.length,3);
 A.equal(H.R.calculate(saved,'2026-09').personal.expenseCents,7000);A.equal(H.R.calculate(saved,'2026-10').personal.incomeCents,6000);A.equal(H.R.calculate(saved,'2026-10').cash.incomeCents,9000);A.match(a.node('#toast').textContent,/退款|分配/);A.equal(a.node('#refund-confirm'),null);
 A.deepEqual(H.L.parseBackup(H.L.backup(saved)),H.L.validateState(saved));A.deepEqual(a.counters.forbidden,[]);if(!personal){A.equal(a.counters.localStorage,0);A.equal(a.counters.sessionStorage,0);A.deepEqual(a.counters.personalIO,[]);}
});
for(const status of ['cancelled','closed'])test('refund host RR-031: financially valid manual '+status+' plan keeps lifecycle and requires review',()=>{
 const a=H.app({fixtureOptions:{status}}),before=H.snapshot(a);H.preview(H.draft(a,{route:'plan',planId:a.fixture.planId}));A.match(a.node('#modal-root').textContent,status==='closed'?/关闭|closed/:/取消|cancelled/);H.quiet(a,before);H.confirm(a);A.equal(a.value('state.bookkeeping.refundPlans[0].status'),status);A.equal(a.value('state.bookkeeping.refunds[0].planId'),a.fixture.planId);
});
test('refund host RR-024: editing a reviewed command returns to detached draft with original exact values and resets consent',()=>{
 const a=H.ready(),before=H.snapshot(a),old=H.retained(a);H.consent(a);H.click(a,'#refund-review-back');A.equal(H.current(a,old.ticket),false);H.staleCallbacks(a,old);
 const form=a.node('#entry-form');A.equal(form.elements.namedItem('amount').value,'30.00');A.equal(form.elements.namedItem('reason').value,'Explicit synthetic exact refund review');H.fill(form,{amount:'20.00',reason:'A new exact synthetic review'});H.preview(a);A.equal(a.node('#entry-form').elements.namedItem('confirmed').checked,false);A.equal(H.latest(a,'preview').out.review.command.amountCents,2000);A.equal(H.latest(a,'preview').out.review.command.reason,'A new exact synthetic review');H.quiet(a,before);H.confirm(a);A.equal(a.value('state.bookkeeping.refunds[0].amountCents'),2000);
});
test('refund host RR-023: retained successful form and button cannot create a second refund',()=>{
 const a=H.ready(),old=H.retained(a);H.confirm(a);const after=H.snapshot(a);H.staleCallbacks(a,old);A.deepEqual(H.snapshot(a),after);A.equal(a.calls.commit,1);A.equal(a.value('state.bookkeeping.refunds.length'),1);
});
test('refund host RR-031: disposed contexts never construct or evaluate refund state on rebind',()=>{
 const a=H.app({open:false}),before={constructors:a.calls.createCoordinator||0,overview:a.calls.overview||0,candidates:a.calls.candidates||0,preview:a.calls.preview||0,calculate:a.financial.calculate};a.run('disposeRuntime();B.bind(bookkeepingContext());window.MoneygoRefundReceiptsUI.initialize(bookkeepingContext());render()');A.deepEqual({constructors:a.calls.createCoordinator||0,overview:a.calls.overview||0,candidates:a.calls.candidates||0,preview:a.calls.preview||0,calculate:a.financial.calculate},before);A.equal(H.io(a,'set',H.KEY).length,0);A.deepEqual(a.counters.forbidden,[]);
});
