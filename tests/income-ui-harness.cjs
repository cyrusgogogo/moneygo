'use strict';
// Markup-backed Node DOM/VM double using untouched production entry and scripts.
// This is not browser layout, native keyboard, screen-reader, or file-dialog QA.
const path=require('node:path'),assert=require('node:assert/strict');
const {host}=require('./actual-entry-host.cjs');
const fixture=require('./income-planning-model-fixtures.cjs');
const ROOT=path.resolve(__dirname,'..'),KEY='moneygo.ledger.v1';
class FixedDate extends Date { constructor(...args){super(...(args.length?args:['2026-10-14T12:00:00.000Z']));}static now(){return Date.parse('2026-10-14T12:00:00.000Z');} }
function app(state=fixture.base(),opts={}) {
 const counts={preview:0,commit:0,cancel:0,invalidate:0,reconciliation:0},tickets=[];
 const a=host(ROOT,{entry:opts.personal?'index.html':'demo.html',personal:opts.personal?{[KEY]:JSON.stringify(state)}:undefined,globals:{Date:FixedDate},confirm:opts.confirm,
  beforeScript(file,context,window,doc){
   if(file==='app-runtime-v1.js') {
    const model=window.MoneygoIncomePlanning,relations=window.MoneygoRelations;
    window.MoneygoIncomePlanning=Object.freeze({...model,createCoordinator(c){const original=model.createCoordinator(c);return Object.freeze({preview(...args){counts.preview++;const t=original.preview(...args);tickets.push(t);return opts.reviewTransform?{review:opts.reviewTransform(JSON.parse(JSON.stringify(t.review)))}:t;},commit(...args){counts.commit++;return original.commit(...args);},cancel(...args){counts.cancel++;return original.cancel(...args);},invalidateAll(...args){counts.invalidate++;return original.invalidateAll(...args);}});}});
    window.MoneygoRelations=Object.freeze({...relations,reconciliation(...args){counts.reconciliation++;return relations.reconciliation(...args);}});
   }
   opts.beforeScript?.(file,context,window,doc);
  }
 });
 assert.deepEqual(a.errors.map(e=>e.message),[]);assert.equal(a.run('active()'),true);
 if(!opts.personal){a.put('incomeFixtureText',JSON.stringify(state));a.run('state=L.validateState(JSON.parse(incomeFixtureText));savedRaw=JSON.stringify(state);storage.setItem(L.STORAGE_KEY,savedRaw)');}
 a.run("globalThis.incomeWrites=[];globalThis.incomeStorage=storage;globalThis.incomeFailWrite=false;storage=Object.freeze({getItem:key=>incomeStorage.getItem(key),setItem(key,value){if(incomeFailWrite&&key===L.STORAGE_KEY)throw new Error('Synthetic write failed');incomeWrites.push([key,String(value)]);return incomeStorage.setItem(key,value);},removeItem:key=>incomeStorage.removeItem(key)});page='report';render()");
 click(a,'[data-page="income-planning"]');a.counts=counts;a.tickets=tickets;
 return a;
}
function click(a,selector){const node=a.node(selector);assert.ok(node,'Actual rendered control '+selector);assert.equal(node.disabled,false,'Enabled '+selector);node.click();return node;}
function action(a,name,id){const nodes=a.doc.querySelectorAll('[data-income-action]'),n=nodes.find(n=>n.dataset.incomeAction===name&&(id===undefined||n.dataset.incomeId===id));assert.ok(n,'Actual rendered income '+name+' '+(id||''));assert.equal(n.disabled,false,'Enabled '+name);n.click();return n;}
function fields(a,values){const form=a.node('#entry-form');assert.ok(form,'Form exists');for(const[name,value]of Object.entries(values)){const field=form.elements.namedItem(name);assert.ok(field,'Actual field '+name);if(typeof value==='boolean')field.checked=value;else field.value=value;field.dispatch('input');}return form;}
function submit(a){const form=a.node('#entry-form');assert.ok(form,'Actual form exists');form.dispatch('submit');return a.node('#entry-form');}
function errors(a){return [a.node('#income-form-error')?.textContent,a.node('#form-error')?.textContent].filter(Boolean).join('; ');}
function approve(a,why='Synthetic complete review confirmed'){fields(a,{reason:why,confirmed:true});submit(a);assert.equal(a.node('#entry-form'),null,errors(a));}
function create(a,extra={}){action(a,'new');fields(a,{name:'Synthetic UI income',certainty:'confirmed-plan',amount:'1000.00',expectedDate:'2026-10-20',expectedAccountId:'account-cash',basis:'Employer synthetic confirmation',note:'Synthetic annotation',...extra});submit(a);assert.ok(a.node('#income-commit')&&!a.node('#income-commit').disabled,errors(a));approve(a);return a.value('state.incomePlanning.plans').find(p=>p.name===(extra.name||'Synthetic UI income')).id;}
function details(a,id){action(a,'detail',id);}
function allocate(a,pid,source,amount){details(a,pid);action(a,'allocate',pid);fields(a,{transactionId:source,amount,reference:'Synthetic receipt reference'});a.node('#entry-form').elements.namedItem('transactionId').dispatch('change');assert.equal(a.node('#income-preview').disabled,false,errors(a));submit(a);assert.equal(a.node('#income-commit').disabled,false,errors(a));approve(a);}
function operation(a,pid,actionName,id){details(a,pid);action(a,actionName,id||pid);submit(a);assert.equal(a.node('#income-commit').disabled,false,errors(a));approve(a);}
function snapshot(a){return {state:a.run('JSON.stringify(state)'),raw:a.run('savedRaw'),stored:a.run('storage.getItem(L.STORAGE_KEY)'),recovery:a.run("storage.getItem('moneygo.ledger.beforeRestore.v1')"),writes:a.value('incomeWrites')};}
function isolated(a){assert.equal(a.counters.localStorage,0);assert.equal(a.counters.sessionStorage,0);assert.deepEqual(a.counters.personalIO,[]);assert.deepEqual(a.counters.forbidden,[]);}
module.exports={...fixture,modelAllocate:fixture.allocate,app,click,action,fields,submit,errors,approve,create,details,allocate,operation,snapshot,isolated,KEY};
