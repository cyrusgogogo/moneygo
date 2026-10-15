'use strict';
const path=require('node:path');
const AT='2026-10-14T10:00:00.000Z';
function uiHost(root,fixture,options={}){
  const {host}=require(path.join(root,'tests/actual-entry-host.cjs'));
  class FixedDate extends Date{constructor(...args){super(...(args.length?args:[AT]));}static now(){return Date.parse(AT);}}
  return host(root,{entry:'index.html',personal:{'moneygo.ledger.v1':JSON.stringify(fixture.inputState)},globals:{Date:FixedDate},...options});
}
function captureUI(root,fixture){
 const app=uiHost(root,fixture);if(app.errors.length)throw Error(JSON.stringify(app.errors.map(e=>e.message)));if(!app.run('active()')||app.run('blocked'))throw Error('Baseline/candidate UI not ready');
 const result={};const stateBefore=app.run('JSON.stringify(state)'),savedBefore=app.run('savedRaw');
 const transactionRows=()=>app.doc.querySelectorAll('.transaction-row').map(n=>({id:n.dataset.tx||n.dataset.undo,name:n.querySelector('.tx-name')?.textContent,meta:n.querySelector('.tx-meta')?.textContent,amount:n.querySelector('.tx-amount')?.textContent}));
 for(const month of fixture.months){app.run('month='+JSON.stringify(month)+";page='report';render();");
   const report={stats:app.doc.querySelectorAll('.stat').map(n=>({amount:n.querySelector('.big-number')?.textContent,foot:n.querySelector('.stat-foot')?.textContent})),categories:app.doc.querySelectorAll('.legend-row').map(n=>({id:n.dataset.category,value:n.querySelector('.legend-value')?.textContent})),recent:transactionRows()};
   const drills={};for(const mode of ['personal-expense','ordinary-income','cash-expense','cash-income','excluded']){
     const button=app.doc.querySelectorAll('[data-bk-action]').find(n=>n.dataset.bkAction==='drilldown'&&n.dataset.bkId===mode);if(!button)throw Error('Missing report drilldown '+mode);button.click();
     drills[mode]={routes:app.node('#modal-root').querySelectorAll('.bk-tx-link').map(n=>n.dataset.bkId),amounts:app.node('#modal-root').querySelectorAll('strong').map(n=>n.textContent).filter(t=>/[¥]/.test(t)),page:app.node('#bk-modal-page')?.textContent||null};app.run('closeModal(true)');
   }
   const filters=[{q:'',type:'all',account:'all',category:'all'},...['expense','income','transfer','paired-transfer'].map(type=>({q:'',type,account:'all',category:'all'})),...fixture.inputState.accounts.map(a=>({q:'',type:'all',account:a.id,category:'all'})),...fixture.inputState.categories.filter(c=>c.type==='expense').map(c=>({q:'',type:'all',account:'all',category:c.id})),{q:'Tied raw row',type:'all',account:'all',category:'all'}];
   const filtered=[];for(const filtersValue of filters){app.run("page='ledger';filters="+JSON.stringify(filtersValue)+';render();');filtered.push({filters:filtersValue,count:app.node('#app').querySelector('.tiny-label')?.textContent,summary:app.node('#app').querySelector('.ledger-summary')?.textContent,rows:transactionRows()});}
   app.run('exclusionsForMonth('+JSON.stringify(month)+');');
   const exclusions=app.node('#modal-root').querySelectorAll('[data-exclusion-id]').map(n=>({id:n.dataset.exclusionId,checked:n.checked,text:n.parentNode.textContent}));app.run('closeModal(true)');
   result[month]={report,drills,filtered,exclusions};
 }
 app.run('historyMonths()');result.history=app.node('#modal-root').querySelectorAll('input').filter(n=>n.name==='completeMonths').map(n=>({month:n.value,checked:n.checked,text:n.parentNode.textContent}));app.run('closeModal(true)');
 result.unchanged={state:app.run('JSON.stringify(state)')===stateBefore,saved:app.run('savedRaw')===savedBefore,writes:app.counters.personalIO.filter(x=>x[0]!=='get'),forbidden:app.counters.forbidden};
 return result;
}
module.exports={uiHost,captureUI};
