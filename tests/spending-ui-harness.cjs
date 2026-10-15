'use strict';
// Literal packaged entry and production UI in a markup-backed Node DOM/VM.
// Does not assert native browser layout, picker, storage, keyboard or AT behavior.
const path=require('node:path'),assert=require('node:assert/strict');
const {host}=require('./actual-entry-host.cjs'),F=require('./spending-model-fixtures.cjs');
const ROOT=path.resolve(__dirname,'..'),KEY='moneygo.ledger.v1';
class FixedDate extends Date{constructor(...args){super(...(args.length?args:[F.now]));}static now(){return Date.parse(F.now);}}
function app(state=F.base(),opts={}){
 const counts={preview:0,commit:0,cancel:0,invalidate:0},tickets=[];
 const a=host(ROOT,{entry:opts.personal?'index.html':'demo.html',personal:opts.personal?{[KEY]:JSON.stringify(state)}:undefined,globals:{Date:FixedDate},confirm:opts.confirm,beforeScript(file,context,window,doc){if(file==='app-runtime-v1.js'){const model=window.MoneygoSpendingPlanning;window.MoneygoSpendingPlanning=Object.freeze({...model,createCoordinator(cap){const c=model.createCoordinator(cap);return Object.freeze({preview(...args){counts.preview++;const t=c.preview(...args);tickets.push(t);return opts.reviewTransform?{review:opts.reviewTransform(JSON.parse(JSON.stringify(t.review)))}:t;},commit(...args){counts.commit++;return c.commit(...args);},cancel(...args){counts.cancel++;return c.cancel(...args);},invalidateAll(...args){counts.invalidate++;return c.invalidateAll(...args);}});}});}opts.beforeScript?.(file,context,window,doc);}});
 assert.deepEqual(a.errors.map(e=>e.message),[]);assert.equal(a.run('active()'),true);
 if(!opts.personal){a.put('spendingFixtureText',JSON.stringify(state));a.run('state=L.validateState(JSON.parse(spendingFixtureText));savedRaw=JSON.stringify(state);storage.setItem(L.STORAGE_KEY,savedRaw)');}
 a.run("globalThis.spendingWrites=[];globalThis.spendingStorage=storage;globalThis.spendingFailWrite=false;storage=Object.freeze({getItem:key=>spendingStorage.getItem(key),setItem(key,value){if(spendingFailWrite&&key===L.STORAGE_KEY)throw Error('Synthetic write failed');spendingWrites.push([key,String(value)]);return spendingStorage.setItem(key,value);},removeItem:key=>spendingStorage.removeItem(key)});page='report';render()");
 click(a,'[data-page="spending-planning"]');a.counts=counts;a.tickets=tickets;return a;
}
function click(a,selector){const n=a.node(selector);assert.ok(n,'Actual rendered control '+selector);assert.equal(n.disabled,false,'Enabled '+selector);n.click();return n;}
function action(a,name,id){const n=a.doc.querySelectorAll('[data-spending-action]').find(n=>n.dataset.spendingAction===name&&(id===undefined||n.dataset.spendingId===id));assert.ok(n,'Actual spending action '+name+' '+(id||''));assert.equal(n.disabled,false,'Enabled '+name);n.click();return n;}
function fields(a,values){const form=a.node('#entry-form');assert.ok(form,'Form exists');for(const[name,value]of Object.entries(values)){const n=form.elements.namedItem(name);assert.ok(n,'Field '+name);if(typeof value==='boolean')n.checked=value;else n.value=value;n.dispatch('input');}return form;}
function submit(a){const f=a.node('#entry-form');assert.ok(f,'Form exists');f.dispatch('submit');return a.node('#entry-form');}
function errors(a){return [a.node('#spending-form-error')?.textContent,a.node('#form-error')?.textContent].filter(Boolean).join('; ');}
function approve(a,why='Synthetic explicitly reviewed remaining and full consent'){fields(a,{reason:why,confirmed:true});submit(a);assert.equal(a.node('#entry-form'),null,errors(a));}
function preview(a){submit(a);assert.ok(a.node('#spending-commit'),errors(a));assert.equal(a.node('#spending-commit').disabled,false,errors(a));}
function create(a,extra={}){action(a,'new');fields(a,{name:'Synthetic UI purchase',amount:'1000.00',expectedDate:'2026-10-20',expectedAccountId:'account-cash',note:'Synthetic annotation',remaining:'1000.00',...extra});preview(a);approve(a);return a.value('state.spendingPlanning.plans').find(p=>p.name===(extra.name||'Synthetic UI purchase')).id;}
function details(a,id){action(a,'detail',id);}
function operation(a,pid,name,extra={},id=pid){details(a,pid);action(a,name,id);fields(a,extra);preview(a);approve(a);}
function commit(a,pid,remaining='1000.00'){operation(a,pid,'commit',{commitmentBasis:'Synthetic merchant confirmed',remaining});}
function allocate(a,pid,amount='400.00',remaining='600.00',source='source'){details(a,pid);action(a,'allocate',pid);fields(a,{transactionId:source,amount,reference:'Synthetic payment reference',remaining});a.node('#entry-form').elements.namedItem('transactionId').dispatch('change');assert.equal(a.node('#spending-preview').disabled,false,errors(a));preview(a);approve(a);}
function snapshot(a){return {state:a.run('JSON.stringify(state)'),raw:a.run('savedRaw'),stored:a.run('storage.getItem(L.STORAGE_KEY)'),recovery:a.run('storage.getItem(ROLLBACK_KEY)'),writes:a.value('spendingWrites')};}
function isolated(a){assert.equal(a.counters.localStorage,0);assert.equal(a.counters.sessionStorage,0);assert.deepEqual(a.counters.personalIO,[]);assert.deepEqual(a.counters.forbidden,[]);}
module.exports={...F,modelAllocate:F.allocate,app,click,action,fields,submit,errors,approve,preview,create,details,operation,commit,allocate,snapshot,isolated,KEY,ROOT};
