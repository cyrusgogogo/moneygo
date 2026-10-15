'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {loadApp,memoryStorage}=require('./transfer-app-harness.cjs');
const {fixture,transaction,L}=require('./transfer-ui-harness.cjs');
function appFixture(){return fixture([transaction('out','expense',10001,'2026-09-30',{accountId:'bank'}),transaction('in','income',10001,'2026-10-02')]);}
function build(){const s=appFixture();const storage=memoryStorage({[L.STORAGE_KEY]:JSON.stringify(s)});return loadApp(storage,{today:'2026-10-14'});}
function action(app,action,id){const target={dataset:{bkAction:action,bkId:id},disabled:false};app.documentListeners.get('click')({target:{closest(selector){return selector==='[data-bk-action]'?target:null;}}});}
function pick(app,name,id){const form=app.node('#entry-form'),list=form.querySelector(`[data-bk-picker="${name}"]`).querySelector('[data-bk-pick-list]');list.onclick({target:{closest(){return {dataset:{bkPickId:id}};}}});}
function submit(app){app.node('#entry-form').onsubmit({preventDefault(){}});}
function confirm(app){const form=app.node('#entry-form');form.elements.namedItem('confirmed').checked=true;form.elements.namedItem('reason').value='核对双方本人凭证';form.dataset.dirty='true';}
function prepare(app){action(app,'transfer','out');pick(app,'incomeId','in');submit(app);confirm(app);}

test('actual app Escape obeys dirty cancellation, restores focus/inert/scroll and writes nothing',()=>{
 const app=build(),before=app.value('state');action(app,'transfer','out');assert.match(app.node('#modal-root').innerHTML,/选择本人转移/);assert.equal(app.node('#app').inert,true);pick(app,'incomeId','in');app.run('window.confirm=()=>false');app.documentListeners.get('keydown')({key:'Escape',preventDefault(){}});assert.match(app.node('#modal-root').innerHTML,/选择本人转移/);assert.equal(app.node('#entry-form').elements.namedItem('incomeId').value,'in');assert.equal(app.storage.writes.length,0);app.run('window.confirm=()=>true');app.documentListeners.get('keydown')({key:'Escape',preventDefault(){}});assert.equal(app.node('#modal-root').innerHTML,'');assert.equal(app.node('#app').inert,false);assert.equal(app.run('document.body.style.overflow'),'');assert.deepEqual(app.value('state'),before);
});

test('actual app pair persistence atomically saves once and closes the confirmation',()=>{
 const app=build(),before=app.value('state.transactions');prepare(app);submit(app);assert.equal(app.storage.writes.length,1);assert.equal(app.value('state.bookkeeping.transferPairs.length'),1);assert.deepEqual(app.value('state.transactions'),before);assert.equal(app.node('#modal-root').innerHTML,'');assert.equal(app.node('#app').inert,false);assert.equal(JSON.parse(app.storage.getItem(L.STORAGE_KEY)).bookkeeping.transferPairs.length,1);
});

test('actual app quota failure leaves state/storage unchanged and confirmation retryable',()=>{
 const app=build(),before=app.value('state'),raw=app.storage.getItem(L.STORAGE_KEY);prepare(app);app.storage.failSet=()=>true;submit(app);assert.deepEqual(app.value('state'),before);assert.equal(app.storage.getItem(L.STORAGE_KEY),raw);assert.equal(app.storage.writes.length,0);assert.match(app.node('#form-error').textContent,/存储|保存|Quota/);assert.match(app.node('#modal-root').innerHTML,/确认本人账户转账配对/);assert.equal(app.node('#entry-form').elements.namedItem('reason').value,'核对双方本人凭证');app.storage.failSet=null;submit(app);assert.equal(app.storage.writes.length,1);assert.equal(app.value('state.bookkeeping.transferPairs.length'),1);
});

test('actual app storage-event staleness cannot overwrite another page while confirming',()=>{
 const app=build(),before=app.value('state');prepare(app);app.windowListeners.get('storage')({key:L.STORAGE_KEY});submit(app);assert.equal(app.storage.writes.length,0);assert.deepEqual(app.value('state'),before);assert.match(app.node('#form-error').textContent,/另一个页面已修改/);assert.match(app.node('#modal-root').innerHTML,/确认本人账户转账配对/);
});

test('narrow app patch labels paired original rows, exposes paired filter and preserves all-account scope on main report',()=>{
 const app=build();prepare(app);submit(app);app.run("month='2026-10';page='ledger';render()");assert.match(app.node('#app').innerHTML,/已配对本人转入 · 原收入/);assert.match(app.node('#app').innerHTML,/已配对本人转移/);assert.match(app.node('#app').innerHTML,/账户实际变动照常计入/);app.run("filters.type='paired-transfer';render()");assert.match(app.node('#app').innerHTML,/data-tx=\"in\"/);app.run("page='report';render()");assert.match(app.node('#app').innerHTML,/对外现金流入/);assert.match(app.node('#app').innerHTML,/账户总流入/);assert.match(app.node('#app').innerHTML,/条原收入记录/);app.run('method()');assert.match(app.node('#modal-root').innerHTML,/跨月不提前确认到账/);assert.match(app.node('#modal-root').innerHTML,/不自动补另一边/);
});
