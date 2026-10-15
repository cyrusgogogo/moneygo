'use strict';
// First executable gate: no app effects, storage, bindings, or defaults precede it.
const runtime=(()=>{const descriptor=Object.getOwnPropertyDescriptor(window,'MoneygoRuntimeGate');if(!descriptor||!Object.hasOwn(descriptor,'value')||descriptor.writable||descriptor.configurable||!Object.isFrozen(descriptor.value))throw Error('Explicit runtime required');return descriptor.value.claim();})();
const synthetic=runtime.mode==='synthetic';
const active=()=>runtime.lifecycle.active();
const currentEpoch=epoch=>active()&&epoch===runtime.lifecycle.epoch();
const ownedUrls=new Set(),ownedTimers=new Set();
function later(fn,delay){const epoch=runtime.lifecycle.epoch();let timer=setTimeout(()=>{ownedTimers.delete(timer);if(currentEpoch(epoch))fn();},delay);ownedTimers.add(timer);return timer;}
function sessionText(value){if(!synthetic)return value;const labels={'已保存到当前浏览器':'已保存到本次演练内存','已保存到此浏览器':'已保存到本次演练内存','沙盘已保存，真实账目未改变':'沙盘已保存到本次会话，演练账目未改变','已更新历史覆盖范围，真实账目未改变':'已更新本次会话历史覆盖范围，演练账目未改变'};return Object.hasOwn(labels,value)?labels[value]:value;}

function sessionNotice(){return synthetic?'<aside class="session-notice" role="note"><strong>临时演练账本 · 初始数据为合成样例</strong><p>修改仅留在本页内存，刷新或重置后恢复。不会读取或改动个人账本。本次演练可能包含你选择或填写的数据；导出文件也可能包含这些内容。</p><p>初始账本样例固定日期：2026-09 至 2026-11，分期计划至 2026-12；参考日：2026-11-02；初始报告月份：2026-10。初始样例中的正式账单为合成记录，非真实银行账单。样例日期固定，设备时钟未改动；未来推算仍使用设备日期。</p><button class="btn" data-action="practice-files">下载合成练习文件与步骤</button> <button class="btn" data-action="reset-demo">重新开始演练</button></aside>':'';}
function sessionFileName(name){return synthetic?'moneygo-DEMO-SESSION-'+name.replace(/^moneygo-?/,''):name;}
function fenceControls(){for(const node of document.querySelectorAll('button,input,select,textarea,form,a,div'))for(const type of ['onclick','onchange','oninput','onsubmit','ondrop','ondragover']){const fn=node[type];if(typeof fn==='function'&&!fn.moneygoFenced){const epoch=runtime.lifecycle.epoch(),token=modalToken,withinModal=Boolean(node.closest?.('.modal')),wrapped=function(...args){if(!currentEpoch(epoch)||withinModal&&token!==modalToken||node.isConnected===false||![...document.querySelectorAll('button,input,select,textarea,form,a,div')].includes(node))return;return fn.apply(this,args);};Object.defineProperty(wrapped,'moneygoFenced',{value:true});node[type]=wrapped;}}}
function disposeRuntime(message='演练已结束。请重新加载此页面开始新的会话。'){
 if(!active())return false;
 window.MoneygoRefundReceiptsUI?.invalidate('当前会话已结束。');
 runtime.lifecycle.dispose();
 for(const timer of ownedTimers)clearTimeout(timer);ownedTimers.clear();
 for(const url of ownedUrls){try{URL.revokeObjectURL(url);}catch(_){}}ownedUrls.clear();
 try{modalToken++;cancelImportRead();for(const item of importQueue?.list()||[]){item.file=null;item.draft=freshImportDraft();}importQueue?.clear();importDraft=freshImportDraft();}catch(_){}
 try{state=null;savedRaw=null;loaded=null;backupSafety=null;storage=null;lastFocus=null;filters={};personalFilters={};ledgerMode='raw';}catch(_){}
 for(const selector of ['#app','#modal-root','#toast']){const el=document.querySelector(selector);if(el){el.innerHTML='';el.textContent='';el.hidden=true;el.inert=true;}}
 document.body.style.overflow='';const blocker=document.querySelector('#boot-blocker');if(blocker){blocker.hidden=false;blocker.textContent=message;}return true;
}
function reloadSynthetic(){try{window.location.reload();}catch(_){} }
function resetDemo(){if(!active()||!synthetic)return;modal('重新开始演练？','<p>本页的修改、已选文件、验证记录和恢复副本都会清空，重新加载初始合成样例。已下载的文件不会删除。未完成的文件读取可能仍由浏览器保留到结束；这不是安全擦除。</p>',`${cancel}<button class="btn danger" id="confirm-demo-reset">确认丢弃本次修改并重新加载</button>`,()=>{const epoch=runtime.lifecycle.epoch();$('#confirm-demo-reset').onclick=()=>{if(!currentEpoch(epoch))return;if(disposeRuntime())reloadSynthetic();};});}
function practiceFiles(){ if(!active())return;if(!active()||!synthetic)return;const pack=window.MoneygoSyntheticSamples;modal('合成练习文件与步骤','<p>下载不改变账本。建议先下载空白练习备份，通过「数据备份 → 选择 JSON 备份」预览并确认恢复，再用普通文件选择和逐笔确认完成练习。</p><p>也可选择本机文件，内容仅在本页处理，不上传。文件和手动输入可能是真实数据；刷新或重置会清空本次修改。</p><p><a href="synthetic-practice.html" target="_blank" rel="noopener noreferrer">在新标签页打开逐步指南（本页演练保持不变）</a></p><ul>'+pack.files.map(file=>'<li><button class="text-link" data-sample-download="'+esc(file.id)+'">'+esc(file.label)+'</button><p>'+esc(file.purpose)+'</p></li>').join('')+'</ul>',cancel,()=>{for(const node of document.querySelectorAll('[data-sample-download]'))node.onclick=()=>{const file=pack.files.find(f=>f.id===node.dataset.sampleDownload);if(file)download(file.text,file.fileName,file.mimeType,true);};});}

window.addEventListener('error',()=>{if(synthetic)disposeRuntime('演练程序出错，已停止本次会话。请重新加载此演练页面。');});
const paths={grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/>',check:'<path d="m7 12 3 3 7-7"/><rect x="3" y="3" width="18" height="18" rx="5"/>',list:'<path d="M9 5h11M9 12h11M9 19h11M4 5h.01M4 12h.01M4 19h.01"/>',arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',chevron:'<path d="m9 5 7 7-7 7"/>',down:'<path d="m6 9 6 6 6-6"/>',shield:'<path d="m12 3 8 4v6c0 5-8 8-8 8s-8-3-8-8V7l8-4Z"/><path d="m8 12 3 3 5-5"/>',coffee:'<path d="M4 8h12v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8ZM16 9h2a3 3 0 1 1 0 6h-2M7 3v2m6-2v2"/>',home:'<path d="m3 10 9-7 9 7v10H3V10Zm6 10v-7h6v7"/>',bag:'<path d="M4 8h16l-1 13H5L4 8Zm4 0V6a4 4 0 0 1 8 0v2"/>',car:'<path d="m5 7 2-4h10l2 4 2 3v8H3v-8l2-3Zm-2 5h18M6 17v4m12-4v4M6 15h2m8 0h2"/>',spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',repeat:'<path d="M20 7H7a4 4 0 0 0-4 4m17-4-4-4m4 4-4 4M4 17h13a4 4 0 0 0 4-4M4 17l4-4m-4 4 4 4"/>',refund:'<path d="m8 3-5 5 5 5M3 8h10a7 7 0 1 1 0 14"/>',tag:'<path d="M3 3h8l10 10-8 8L3 11V3Z"/><circle cx="7" cy="7" r="1"/>',info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.01"/>',search:'<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',close:'<path d="m6 6 12 12M6 18 18 6"/>',wallet:'<path d="M20 7H4V4h14v3M4 7v14h16V7M20 12h-6v5h6"/>',download:'<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',plus:'<path d="M12 4v16M4 12h16"/>'};
const icon=(n)=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[n]||paths.bag}</svg>`;
const L = window.MoneygoLedger;
const P = window.MoneygoPersonalEvents;
const S = window.MoneygoScenario;
const B = window.MoneygoBookkeepingUI;
const O = window.MoneygoOrganizerUI;
const C = window.MoneygoObligationsUI;
const H = window.MoneygoHeldFundsUI;
const IP = window.MoneygoIncomePlanningUI;
const SP = window.MoneygoSpendingPlanningUI;
const CB = window.MoneygoCashBasisUI;
const DC = window.MoneygoDailyCashUI;
const RR = window.MoneygoRefundReceiptsUI;
const I = window.MoneygoImporter;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = cents => `${cents < 0 ? '−' : ''}¥${Math.floor(Math.abs(cents) / 100).toLocaleString('zh-CN')}.${String(Math.abs(cents) % 100).padStart(2,'0')}`;
const amountText = cents => `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2,'0')}`;
const formatLocalDate = d => `${String(d.getFullYear()).padStart(4,'0')}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const today = () => formatLocalDate(new Date());
const $ = selector => document.querySelector(selector);
const ROLLBACK_KEY = 'moneygo.ledger.beforeRestore.v1';
let storage = runtime.storage, startupError = runtime.startupError, savedRaw = null, ledgerRead = 'unknown';
try { if(!storage)throw Error('Storage unavailable'); savedRaw = storage.getItem(L.STORAGE_KEY); ledgerRead=savedRaw===null?'absent':'present'; } catch (_) { ledgerRead='failed'; startupError = synthetic?'本次演练内存无法读取，未启用编辑。请重新加载演练页面。':'浏览器不允许本地存储。请允许此网站保存数据，或使用普通浏览模式后重试。'; }
let loaded = storage ? L.load(storage) : {state:L.createEmpty(),error:startupError};
if(loaded.error && ['STORAGE_READ_FAILED','STORAGE_UNAVAILABLE'].includes(loaded.error.code))ledgerRead='failed';
if(synthetic&&(startupError||loaded.error||!loaded.state)){runtime.lifecycle.dispose();window.MoneygoRuntimeGate.unavailable();throw Error('Synthetic initial ledger unavailable');}
// Optional diagnostics must never prevent the ledger from opening.
let backupSafety=null,backupNoteKey=null;
try {
 const api=window.MoneygoBackupSafety,key=api.NOTE_KEY,controller=api.create({verifyBackup:L.verifyBackup.bind(L),metadataStorage:storage});
 if(typeof key!=='string'||!key||!controller||['verifySelectedBackup','refreshHistory','releaseHistoryForWrite','observeStorage','view'].some(method=>typeof controller[method]!=='function'))throw Error('验证记录功能不可用');
 backupSafety=controller;backupNoteKey=key;
} catch (_) {}
let state = loaded.state || L.createEmpty(), blocked = loaded.error || startupError || '', page = 'report', month = synthetic?runtime.presentation.initialMonth:today().slice(0,7);
let filters = {q:'',type:'all',account:'all',category:'all'}, stale = false, toastTimer, lastFocus, modalToken = 0;
let ledgerMode='raw';
let personalFilters={q:'',type:'all',account:'all',category:'all'};
const names = {income:'收入',expense:'支出',transfer:'转账'};
const nav = [['report','grid','收支概览'],['ledger','list','交易明细'],['bookkeeping','check','账务核对'],['obligations','wallet','信用义务'],['held','wallet','押金与预付'],['income-planning','repeat','收入计划'],['spending-planning','bag','支出计划与承诺'],['cash-basis','check','按日核对现金基线'],['daily-cash','check','逐日现金假设'],['organizer','tag','整理复盘'],['import','upload','账单导入'],['sandbox','spark','消费沙盘'],['manage','wallet','账户分类'],['backup','shield','数据备份']];
const financeCache = new WeakMap();
function finance(selectedMonth) {let cache=financeCache.get(state);if(!cache){cache=new Map();financeCache.set(state,cache);}const key=selectedMonth||'*';if(!cache.has(key))cache.set(key,L.financialView(state,selectedMonth));return cache.get(key);}
// Derived identities stay local to reads; edit, restore and exclusion actions use raw IDs.
const personalEventCache = new WeakMap();
function personalEventFor(t,kind) {
 const calculated=finance();let events=personalEventCache.get(calculated);
 if(!events){events=new Map([...calculated.personalExpenseEvents,...calculated.personalIncomeEvents].map(event=>[P.keyOf(event.key),event]));personalEventCache.set(calculated,events);}
 const event=events.get(P.keyOf({kind,id:t.id}));
 if(!event||event.route.kind!=='transaction'||event.route.transactionId!==t.id)throw Error('个人口径来源记录不完整');
 return event;
}
function expenseValue(t) {return t.type==='expense'?personalEventFor(t,'transaction-expense').amountCents:0;}
function incomeValue(t) {return t.type==='income'?personalEventFor(t,'transaction-income').amountCents:0;}
function personalTotalsForRows(rows) {
 const calculated=finance(),query={transactionIds:rows.map(t=>t.id)};
 return P.reduce([...P.select(calculated.personalExpenseEvents,query),...P.select(calculated.personalIncomeEvents,query)]);
}
function expenseGroups(events,keyOf) {
 const groups=new Map();for(const event of events){const key=keyOf(event);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(event);}
 return new Map([...groups].map(([key,rows])=>[key,P.reduce(rows).expenseCents]));
}
function bookkeepingContext(){return {isActive:active,onDispose:runtime.lifecycle.onDispose,getState:()=>{if(!active())throw Error('Inactive session');return state;},now:()=>new Date().toISOString(),refundState:()=>{if(!active()||stale||blocked)throw Error('账本状态需先处理，请刷新或检查备份。');return state;},engine:window.MoneygoRelations,ledger:L,esc,money,amountText,accountName,categoryName,today,modal,closeModal,error,change,render,$,cancel,options,selected,showHeldRecognition,showHeldPosition};}
function heldContext(){return {...bookkeepingContext(),engine:window.MoneygoHeldFunds,relations:window.MoneygoRelations};}
function incomePlanningContext(){return {...bookkeepingContext(),engine:window.MoneygoIncomePlanning,relations:window.MoneygoRelations,organizer:window.MoneygoOrganizer,obligations:window.MoneygoObligations,now:()=>new Date().toISOString(),recordIncome:()=>entry(undefined,'income'),getPage:()=>page,pageId:'income-planning'};}
function spendingPlanningContext(){return {...bookkeepingContext(),engine:window.MoneygoSpendingPlanning,now:()=>new Date().toISOString(),recordExpense:()=>entry(undefined,'expense'),getPage:()=>page,pageId:'spending-planning',editAccountRoles:()=>{closeModal(true);page='obligations';render();}};}
function dailyCashContext(){return {isActive:active,onDispose:runtime.lifecycle.onDispose,getState:()=>{if(!active()||stale||blocked)throw Error('账本状态需先处理，请刷新或检查备份。');return state;},engine:window.MoneygoDailyCash,today,now:()=>new Date().toISOString()};}
function cashBasisContext(){return {isActive:active,onDispose:runtime.lifecycle.onDispose,getState:()=>{if(!active()||stale||blocked)throw Error('账本状态需先处理，请刷新或检查备份。');return state;},engine:window.MoneygoCashBasis,today,now:()=>new Date().toISOString()};}
function showHeldPosition(positionId){if(!active())return;H.positionDetails(heldContext(),positionId);}
function showHeldRecognition(positionId,recognitionId){if(!active())return;H.recognitionDetails(heldContext(),positionId,recognitionId);}
function organizerContext(){return {...bookkeepingContext(),engine:window.MoneygoOrganizer};}
function obligationsContext(){return {...bookkeepingContext(),engine:window.MoneygoObligations,relations:window.MoneygoRelations};}
function monthEnd(value){const y=Number(value.slice(0,4)),m=Number(value.slice(5)),days=[31,y%4===0&&(y%100!==0||y%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];return value+'-'+days[m-1];}
function scopeDisclosure(value=month){return O.scopeSummaryFor(organizerContext(),value+'-01',monthEnd(value));}

const accountName = id => state.accounts.find(a => a.id === id)?.name || '未知账户';
const categoryName = id => state.categories.find(c => c.id === id)?.name || '';
const monthRows = () => state.transactions.filter(t => t.date.slice(0,7) === month);
const selected = (a,b) => a === b ? 'selected' : '';
const options = (rows,value) => rows.map(r => `<option value="${esc(r.id)}" ${selected(value,r.id)}>${esc(r.name)}</option>`).join('');
function toast(message) { if(!active())return; const el=$('#toast'); el.textContent=(synthetic?'本次会话 · ':'')+sessionText(message);el.classList.add('show');clearTimeout(toastTimer);toastTimer=later(()=>el.classList.remove('show'),5000); }
function error(message) { if(!active())return; const el=$('#form-error'); if(el){el.textContent=sessionText(message);el.hidden=false;el.focus();}else toast(message); }
// Diagnostics never participate in the financial commit or restore compensation.
function diagnostic(fn) { if(!active())return;try { return fn(); } catch (_) { return undefined; } }
function observeStorage(event) { diagnostic(()=>backupSafety.observeStorage(event)); }
function observedLedgerRead() {
 try { const raw=storage.getItem(L.STORAGE_KEY);ledgerRead=raw===null?'absent':'present';observeStorage({target:'ledger',operation:'read',outcome:'accepted'});return raw; }
 catch(e){ledgerRead='failed';observeStorage({target:'ledger',operation:'read',outcome:'failed',cause:'read-failed'});refreshBackupStatus();throw e;}
}
function directQuota(error) { try { return error!==null && typeof error==='object' && error.name==='QuotaExceededError'; } catch (_) { return false; } }
function ledgerQuota(error) { try { return error!==null && typeof error==='object' && error.code==='STORAGE_WRITE_FAILED' && directQuota(error.cause); } catch (_) { return false; } }
function storageWriteError(error) { try { return error?.code==='STORAGE_WRITE_FAILED'; } catch (_) { return false; } }
function errorData(error,key) { try { if(error===null||!['object','function'].includes(typeof error))return undefined;const d=Object.getOwnPropertyDescriptor(error,key);return d&&Object.hasOwn(d,'value')?d.value:undefined; } catch (_) { return undefined; } }
function failureMessage(error) { const value=errorData(error,'message'),message=typeof value==='string'?value:'存储操作失败',cause=errorData(error,'code')==='STORAGE_WRITE_FAILED'?errorData(error,'cause'):error;return errorData(cause,'name')==='SecurityError'?message+' 浏览器拒绝访问本地存储（SecurityError）。':message; }
function retryFailure(original,detail,latest) { const hasLatest=arguments.length>2,error=Error(failureMessage(original)+' '+detail+(hasLatest?' '+failureMessage(latest):''));error.cause=original;if(hasLatest)error.retryCause=latest;return error; }
function ledgerGuard(basis=savedRaw) {
 if(!active())throw Error('Inactive session');
 if(stale || observedLedgerRead()!==basis){stale=true;IP.invalidate();SP.invalidate();CB.invalidate();DC.invalidate();RR?.invalidate('其他页面已修改原始账本。确认已清除；草稿保留，请刷新后重新核对。',true);diagnostic(()=>render());throw Error('另一个页面已修改账本。为避免覆盖，请刷新本页后重试。');}
}
function forwardWrite(write,isQuota,budget,guard) {
 try { return write(); } catch(original) {
  if(!isQuota(original)||budget.used)throw original;
  budget.used=true; // One budget shared by both forward restore phases.
  let removed=false;try { removed=backupSafety.releaseHistoryForWrite()?.status==='removed'; } catch (_) {}
  refreshBackupStatus();
  if(!removed)throw retryFailure(original,'未能确认释放可选验证记录，未重试写入。');
  try { guard(); } catch(blocker) { throw retryFailure(original,'释放验证记录后，账本检查未通过；未重试写入。',blocker); }
  try { return write(); } catch(latest) { throw retryFailure(original,'释放可选验证记录后的第二次写入仍未被接受。',latest); }
 }
}
function preflightUnavailable(cause) {
 const error=Error('保存前的完整备份检查暂不可用；本次修改未保存。可到「数据备份」下载原始恢复数据或恢复有效备份。');
 Object.assign(error,{name:'SavePreflightError',code:'SAVE_PREFLIGHT_UNAVAILABLE',phase:'capability'});if(cause!==undefined)error.cause=cause;return error;
}
function prepareOrdinary(next) {
 let helper,prepare;
 try { const binding=Object.getOwnPropertyDescriptor(window,'MoneygoSavePreflight');if(!binding||!Object.hasOwn(binding,'value')||binding.value===null||typeof binding.value!=='object')throw preflightUnavailable();helper=binding.value;const method=Object.getOwnPropertyDescriptor(helper,'prepare');if(!method||!Object.hasOwn(method,'value')||typeof method.value!=='function')throw preflightUnavailable();prepare=method.value; }
 catch(cause){throw preflightUnavailable(cause);}
 try { return Reflect.apply(prepare,helper,[next,L]); }
 catch(cause){if(errorData(cause,'name')==='SavePreflightError'&&typeof errorData(cause,'code')==='string'&&typeof errorData(cause,'phase')==='string'&&typeof errorData(cause,'message')==='string')throw cause;throw preflightUnavailable(cause);}
}
function commitLedger(next,basis,retryBudget,compactRaw) {
 const validated=forwardWrite(()=>{
  try { return L.save(storage,next); }
  catch(e){if(storageWriteError(e))observeStorage({target:'ledger',operation:'write',outcome:'failed',cause:ledgerQuota(e)?'quota-reported':'write-failed'});refreshBackupStatus();throw e;}
 },ledgerQuota,retryBudget,()=>ledgerGuard(basis));
 state=validated;savedRaw=compactRaw===undefined?JSON.stringify(validated):compactRaw;blocked='';IP.invalidate();SP.invalidate();CB.invalidate();DC.invalidate();RR?.invalidate();
 observeStorage({target:'ledger',operation:'write',outcome:'accepted'});refreshBackupStatus();
}
function persist(next) {
 if(!active())throw Error('Inactive session');
 if(!storage)throw Error('本地存储不可用，未保存。');
 if(blocked)throw Error('原有数据无法读取。请先到「数据备份」导出原始数据，再恢复有效备份。');
 const basis=savedRaw;ledgerGuard(basis);
 const prepared=prepareOrdinary(next);
 ledgerGuard(basis);
 commitLedger(prepared.state,basis,{used:false},prepared.compactRaw);
}
// Recovery authority is private to the two already-consented restore continuations.
function persistRecovery(next,retryBudget={used:false}) {
 if(!active())throw Error('Inactive session');
 if(!storage)throw Error('本地存储不可用，未保存。');
 const basis=savedRaw;ledgerGuard(basis);commitLedger(next,basis,retryBudget);
}
function noteAge(age) {
 if(age?.status==='clock-anomaly')return '设备时间异常，请核对时间并重新验证';
 if(age?.status==='old')return '记录已满 30 天，可重新选择文件验证';
 if(age?.status==='recent')return '记录距今 '+age.elapsedDays+' 天';
 return '记录年龄未知';
}
function backupStatusText() {
 if(synthetic){const lines=['仅在本页内存保存；浏览器存储容量、配额与持久保存诊断不适用于演练。','验证记录仅属于本次会话，未认证；刷新或重置会清空。当前账本备份覆盖、下载文件保留情况未评估。'];if(!backupSafety)lines.push('验证记录功能暂不可用；仍可独立验证所选文件，本次不会保存验证记录。');else{const v=backupSafety.view({ledgerRead,blocked:Boolean(blocked),stale});if(v.sessionVerification.status==='session-passed')lines.push('本次会话曾独立验证所选文件通过，不表示当前账本已有备份。');if(v.ledgerWriteFailure)lines.push('最近会话写入未被接受；修改未保存。');}return {primary:blocked?'演练内容需处理':'临时内存会话',lines};}

 if(!backupSafety)return {primary:blocked?'账本读取或内容需处理':stale?'其他页面已修改账本':ledgerRead==='failed'?'账本读取失败':'存储诊断暂不可用',lines:['验证记录与存储诊断暂不可用；仍可选择文件独立验证，本次不会保存验证记录。','当前账本的备份覆盖情况未评估；容量、文件保留与未来保留情况未知。']};
 const v=backupSafety.view({ledgerRead,blocked:Boolean(blocked),stale});
 const primary=blocked?'账本读取或内容需处理':stale?'其他页面已修改账本':ledgerRead==='failed'?'账本读取失败':v.ledgerWriteFailure?'最近账本写入未被接受':v.lastLedgerWrite?.outcome==='accepted'?'最近账本写入已接受':ledgerRead==='absent'?'尚未观察到已存账本':ledgerRead==='present'?'已读取本地账本':'账本读取状态未知';
 const lines=[primary+'。容量与未来保留情况未知。'];
 if(v.ledgerWriteFailure)lines.push(v.ledgerWriteFailure.cause==='quota-reported'?'浏览器报告配额或存储限制，本次账本写入未被接受。':'最近账本写入失败，修改未保存；请选择重试或导出。');
 if(v.recoveryCopyFailure)lines.push(v.recoveryCopyFailure.phase==='compensation'?'原先的撤销副本无法还原，请立即导出当前账本。':'未能保留恢复前副本，恢复未完成。');
 if(v.sessionVerification.status==='session-passed')lines.push('本页曾验证所选文件通过'+(v.sessionVerification.completedAt?'（设备时间 '+v.sessionVerification.completedAt+'）':'（完成时间未知）')+'。');
 const h=v.storedNote;
 lines.push(h.status==='recorded-only'?'此浏览器现有一条本地历史记录（未认证、未重新验证）：'+h.completedAt+'；'+noteAge(h.age)+'。':h.status==='invalid'?'本地验证记录无效或版本不支持。':h.status==='unreadable'?'无法读取本地验证记录。':'没有可用的本地验证记录；这不表示你没有其他备份。');
 if(['failed','not-confirmed','skipped-invalid-time','skipped-invalid-version'].includes(v.notePersistence))lines.push('本次验证记录未确认保存在此浏览器；文件验证结果不受影响。');
 if(v.notePersistence==='released')lines.push('可选验证记录已释放，以优先尝试账本或恢复副本写入。');
 lines.push('当前账本的备份覆盖情况未评估；文件是否仍存在未知。所有时间来自设备时钟。');
 return {primary,lines};
}
function refreshBackupStatus() { if(!active())return;
 diagnostic(()=>{const text=backupStatusText(),header=$('#local-storage-status'),detail=$('#backup-safety-status');if(header)header.textContent=text.primary;if(detail)detail.textContent=text.lines.join('\n');});
}
function backupSafetyCard() { return '<article class="card section-space"><div class="card-head"><h2>存储与验证记录</h2><button class="text-link" data-action="refresh-backup-status">刷新记录</button></div><p id="backup-safety-status" class="body-copy" role="status" aria-live="polite" style="white-space:pre-line">状态暂不可用。当前账本的备份覆盖情况未评估，容量与未来保留情况未知。</p></article>'; }
function change(fn,message) { if(!active())return false;try {const next=fn();persist(next);closeModal(true);render();$('.heading h1')?.focus();toast(message);return true;}catch(e){error(failureMessage(e));return false;} }
function render() { if(!active())return;
 refreshImportQueueStaleness();
 const title={'daily-cash':['逐日现金假设','把未来每一天，逐项核清。','本日日终基线、已记录未来资金腿与独立剩余假设；保留未知和完整尾项。'],'cash-basis':['按日核对现金基线','在同一天，把已知与未知分清。','明确账户与来源范围，只读核对日终基线；不保存账本或预留现金。'],'spending-planning':['支出计划与承诺','把打算与承诺，分别核清。','关联已经记录的现金角色付款，明确确认当前剩余；不移动或预留现金。'],'income-planning':['收入计划','把确定与期待，分开记清。','关联已经记录的普通收入，单独核对未来假设与待复核来源。'],held:['押金与预付','已付的钱，按实际使用分清。','登记充值成本、实际使用、确认损失与真实退回；剩余记录权利不当可花现金。'],obligations:['信用义务','把应还的，逐项核清。','登记正式账单、核对真实还款，保留完整分期与未知信息。'],organizer:['整理复盘','少一点重复，多一点明白。','试跑规则、整理商户、核对范围，再留下可回看的月结。'],bookkeeping:['账务核对','每一笔，都有来处。','核对重复证据，理清退款、应收与账户余额。'],report:['收支概览','每一笔，都心中有数。','从今天开始，留住生活里的每一笔收支。'],ledger:['交易明细','认真记下，自在生活。','收入、支出和转账，都能随时核对。'],import:['账单导入','先核对，再记进账本。','选择本地 CSV / TSV，明确来源和列映射，逐笔确认。'],manage:['账户与分类','给每笔钱，找个好位置。','设置期初余额，让账本更贴近实际。'],sandbox:['消费沙盘','给未来的消费，做个预演。','真实历史作参考，新的打算先试一试。'],backup:['数据与备份','记下的生活，好好留存。','本地保存，也请给账本多一份备份。']}[page];
 $('#app').innerHTML=`${sessionNotice()}<div class="shell"><aside class="sidebar"><div class="brand"><span class="brandmark">${icon('repeat')}</span>moneygo<span class="dot">.</span></div><div class="workspace">MY MONEY, MY WAY</div><nav class="nav" aria-label="主导航">${nav.map(([p,i,t])=>`<button data-page="${p}" class="${page===p?'active':''}" ${page===p?'aria-current="page"':''}>${icon(i)}${t}</button>`).join('')}</nav><div class="side-bottom"><div class="side-note">${icon('shield')}${synthetic?'只在本页内存暂存':'只在这个浏览器保存'}<br>不上传账单，不自动同步。</div><div class="person"><div class="avatar">M</div><div>${synthetic?'临时演练账本':'我的个人账本'}<small>${synthetic?'临时会话 · 人民币':'本地账本 · 人民币'}</small></div></div></div></aside><main class="main" id="main-content"><header class="topbar"><div class="crumb">${synthetic?'演练账本':'个人账本'} ${icon('chevron')} <span>${title[0]}</span></div><div class="brand mobile-brand"><span class="brandmark">${icon('repeat')}</span>moneygo<span class="dot">.</span></div><div class="top-right"><span class="local-label" id="local-storage-status" role="status" aria-live="polite">${blocked||stale?'保存需处理':'本地存储状态待确认'}</span><button class="iconbutton" data-action="method" aria-label="查看记账口径">${icon('info')}</button></div></header><section class="heading"><div><div class="eyebrow">A LITTLE CLARITY, EVERY DAY</div><h1 tabindex="-1">${title[1]}</h1><p class="subtitle">${synthetic&&page==='backup'?'本次会话可导出与验证；文件可能包含你选择或填写的数据。':synthetic&&page==='sandbox'?'演练历史作参考，新的打算先试一试。':title[2]}</p></div><div class="actions">${['report','ledger'].includes(page)?`<label class="sr-only" for="month">选择月份</label><input type="month" class="month-select" id="month" value="${month}" min="0001-01" max="9999-12">`:''}<button class="btn primary" data-action="new" ${blocked?'disabled':''}>${icon('plus')}记一笔</button></div></section>${blocked?`<div class="notice warning" role="alert"><span>${esc(blocked)} 原有存储不会被自动覆盖。<button class="text-link" data-page="backup">前往数据恢复</button></span></div>`:stale?'<div class="notice warning" role="alert">其他页面已更新账本。请刷新本页后再保存，避免覆盖。</div>':''}${page==='daily-cash'?DC.render(dailyCashContext()):page==='cash-basis'?CB.render(cashBasisContext()):page==='spending-planning'?SP.render(spendingPlanningContext()):page==='income-planning'?IP.render(incomePlanningContext()):page==='held'?H.render(heldContext()):page==='obligations'?C.render(obligationsContext()):page==='organizer'?O.render(organizerContext()):page==='bookkeeping'?B.render(bookkeepingContext()):page==='report'?report():page==='ledger'?ledger():page==='manage'?manage():page==='sandbox'?sandbox():page==='import'?importPage():backupPage()}<footer class="page-foot"><span>${synthetic?'演练 v0.23.0 · 刷新或重置恢复初始合成样例；下载文件不会随重置删除。':'本地版本 v0.23.0 · 数据保存在当前浏览器，清理网站数据可能丢失账本。请定期导出备份。'}</span><button data-action="demo">体验虚构样例</button></footer></main></div>`;
 if(page==='import'){bindImportPage();bindImportWorkflow();}
 B.bind(bookkeepingContext());
 O.bind(organizerContext());
 C.bind(obligationsContext());
 H.bind(heldContext());
 IP.bind(incomePlanningContext());
 SP.bind(spendingPlanningContext());
 if(page==='cash-basis')CB.bind(cashBasisContext());
 if(page==='daily-cash')DC.bind(dailyCashContext());
 refreshBackupStatus();fenceControls();
}
function report() {
 const s=L.summary(state,month),bal=L.balances(state),rows=monthRows();
 const categoryTotals=expenseGroups(P.select(finance().personalExpenseEvents,{month}),event=>event.categoryId);
 const cats=state.categories.filter(c=>c.type==='expense').map(c=>({...c,total:categoryTotals.has(c.id)?categoryTotals.get(c.id):0})).filter(c=>c.total).sort((a,b)=>b.total-a.total);
 const colors=['#6e8461','#e99a72','#d6bb88','#a6b59c','#a5b3bc','#c3b0c6'];let acc=0;
 const gradient=cats.map((c,i)=>{const from=acc;acc+=c.total/s.expenseCents*100;return `${colors[i%colors.length]} ${from}% ${acc}%`;}).join(',');
 return `${state.transactions.length===0?`<section class="welcome card"><div><span class="tiny-label">从空白开始</span><h2>这是你的账本，还没有交易。</h2><p>先设置账户期初余额，再记下第一笔。也可以进入独立的样例演示。</p></div><div class="actions"><button class="btn" data-page="manage">设置账户</button><button class="btn primary" data-action="new">记下第一笔 ${icon('arrow')}</button></div></section>`:''}<section class="stats"><article class="stat hero"><div class="stat-label">${state.bookkeeping?'本月个人消费':'本月支出'} ${icon('bag')}</div><div class="big-number">${money(s.expenseCents)}</div><div class="stat-foot">${rows.filter(t=>t.type==='expense'&&!finance().impacts[t.id]?.excluded).length} 条原支出记录 · ${heldActive()?'另 '+P.select(finance().personalExpenseEvents,{month}).filter(e=>e.key.kind==='held-recognition').length+' 个非现金核销；资金投入与个人消费分开':state.bookkeeping?'已扣关联退款、应收及本人转移':'转账不计消费'}</div></article><article class="stat"><div class="stat-label">${state.bookkeeping?'本月普通收入':'本月收入'}</div><div class="big-number secondary income">${money(s.incomeCents)}</div><div class="stat-foot">${rows.filter(t=>t.type==='income').length} 条原收入记录</div></article><article class="stat"><div class="stat-label">${state.bookkeeping?'个人收支差额':'本月结余'}</div><div class="big-number secondary">${money(s.netCents)}</div><div class="stat-foot">${state.bookkeeping?'普通收入 − 个人消费，不等于现金变化':'收入 − 支出，不含期初余额'}</div></article></section>${B.reportSummary(bookkeepingContext(),month)}${scopeDisclosure(month)}<section class="content-grid"><article class="card"><div class="card-head"><div><h2>钱都花在哪儿</h2><p>按支出分类，看看消费的重心</p></div><span class="tiny-label">${month}</span></div>${cats.length?`<div class="category-area"><div class="donut" style="background:conic-gradient(${gradient})" role="img" aria-label="本月支出分类占比"><div class="donut-center"><span>最大支出</span><strong>${Math.round(cats[0].total/s.expenseCents*100)}%</strong><span class="donut-label">${esc(cats[0].name)}</span></div></div><div class="legend">${cats.map((c,i)=>`<button class="legend-row" data-category="${esc(c.id)}"><span class="legend-name"><i class="swatch" style="background:${colors[i%colors.length]}"></i>${esc(c.name)}</span><span class="legend-value">${money(c.total)}</span></button>`).join('')}</div></div>`:'<div class="empty"><span class="empty-icon">'+icon('bag')+'</span><h3>这个月还没有可统计的消费</h3><p>记下第一笔后，这里会慢慢丰富起来。</p></div>'}</article><article class="card"><div class="card-head"><div><h2>账户余额</h2><p>期初余额 + 全部已记收支与转账</p></div><button class="text-link" data-page="manage">管理 ${icon('arrow')}</button></div>${state.accounts.map(a=>`<div class="account-line"><span>${icon('wallet')}${esc(a.name)}</span><strong>${money(bal[a.id])}</strong></div>`).join('')}<div class="account-total"><span>全部账户合计</span><strong>${money(finance().balanceTotalCents)}</strong></div><p class="history-note">账本余额按全部日期的已确认资金口径计算；组合中仅个人消费的证据不影响账户余额。未记入的交易不会体现，不代表银行实时余额。${state.obligations?' 全部账户合计不是可花现金；信用额度不计资产，信用正余额与角色未知账户请到信用义务单独核对。':''}</p></article></section><article class="card"><div class="card-head"><h2>${heldActive()?'本月原始交易':'最近的几笔'}</h2><button class="text-link" data-page="ledger">全部交易 ${icon('arrow')}</button></div>${rows.length?rows.slice().sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5).map(t=>txRow(t)).join(''):heldActive()?'<div class="empty compact">本月没有原始交易。非现金核销请到个人收支事项查看。<button class="text-link" data-ledger-mode="personal">查看个人事项</button></div>':'<div class="empty compact">这个月还没有记录。选择其他月份，或记一笔新的收支。</div>'}</article>`;
}
function compositeRowLabel(t) { const impact=finance().impacts[t.id];return impact?.compositeId ? (impact.personalAuthority && impact.fundingAuthority ? '组合 · 消费与资金双重证据' : impact.personalAuthority ? '组合 · 仅消费证据，账户零影响' : '组合 · 仅资金证据，个人消费零影响') : ''; }
function txRow(t,deleted=false) { return `<button class="transaction-row" ${deleted?`data-undo="${esc(t.id)}"`:`data-tx="${esc(t.id)}"`}><span class="merchant-icon">${icon(t.type==='transfer'?'repeat':t.type==='income'?'download':'bag')}</span><span><span class="tx-name">${esc(t.note||categoryName(t.categoryId)||'账户转账')}</span><span class="tx-meta">${t.date} · ${esc(accountName(t.accountId))}${t.type==='transfer'?` → ${esc(accountName(t.toAccountId))}`:` · ${esc(categoryName(t.categoryId))}`}</span></span><span class="tx-amount ${t.type==='income'?'income':''}">${t.type==='income'?'+':t.type==='expense'?'−':''}${money(t.amountCents)}<small>${deleted?'点击恢复':finance().impacts[t.id]?.excluded?'重复证据 · 未重复计账':finance().impacts[t.id]?.transferPairId?(finance().impacts[t.id].transferRole==='out'?'已配对本人转出 · 原支出':'已配对本人转入 · 原收入'):compositeRowLabel(t)||names[t.type]}</small></span></button>`; }
function heldActive(){return state.bookkeeping?.version>=4;}
const eventPresentationCache=new WeakMap();
function eventPresentation(event){
 let index=eventPresentationCache.get(state);
 if(!index){index={transactions:new Map(state.transactions.map(t=>[t.id,t])),positions:new Map((state.bookkeeping?.heldPositions||[]).map(p=>[p.id,p])),recognitions:new Map((state.bookkeeping?.heldRecognitions||[]).map(r=>[r.id,r]))};eventPresentationCache.set(state,index);}
 if(event.route.kind==='transaction'){
  const t=index.transactions.get(event.route.transactionId);
  if(!t||event.origin.kind!=='transaction'||event.key.id!==t.id||event.origin.transactionId!==t.id)throw Error('个人收支原始来源不完整');
  return {label:t.note||categoryName(t.categoryId),detail:accountName(t.accountId),accountId:t.accountId,kind:t.type,original:t,noncash:false};
 }
 if(event.route.kind==='held-recognition'){
  const r=index.recognitions.get(event.route.recognitionId),p=index.positions.get(event.route.positionId);
  if(!r||!p||r.positionId!==p.id||event.key.id!==r.id||event.origin.positionId!==p.id||event.origin.recognitionId!==r.id)throw Error('核销事项来源不完整');
  return {label:p.name+' · '+(r.kind==='loss'?'确认损失':'实际使用'),detail:r.merchant||'未填写商户',accountId:event.attribution.fundingAccountId,kind:'expense',noncash:true};
 }
 throw Error('不支持的个人收支来源');
}
function openPersonalEvent(encoded){
 const event=[...finance().personalExpenseEvents,...finance().personalIncomeEvents].find(e=>P.keyOf(e.key)===encoded);
 if(!event)throw Error('个人收支事项已改变，请重新选择');
 eventPresentation(event);
 if(event.route.kind==='transaction')entry(event.route.transactionId);
 else showHeldRecognition(event.route.positionId,event.route.recognitionId);
}
function personalEventRow(event){
 const meta=eventPresentation(event);
 return `<button class="transaction-row" data-personal-key="${esc(P.keyOf(event.key))}"><span class="merchant-icon">${icon(meta.noncash?'check':meta.kind==='income'?'download':'bag')}</span><span><span class="tx-name">${esc(meta.label)}</span><span class="tx-meta">${event.effectiveDate} · ${esc(categoryName(event.categoryId))} · ${meta.noncash?'资金来源账户':'原记录账户'} ${esc(accountName(meta.accountId))} · ${esc(meta.detail)}</span></span><span class="tx-amount ${meta.kind==='income'?'income':''}">${meta.kind==='income'?'+':'−'}${money(event.amountCents)}<small>${meta.noncash?'非现金核销 · 账户变化 ¥0.00':'个人口径 · 原记录 '+money(meta.original.amountCents)}</small></span></button>`;
}
function ledgerModeChooser(){return heldActive()?`<div class="actions section-space" aria-label="明细口径"><button class="btn ${ledgerMode==='raw'?'primary':''}" data-ledger-mode="raw" aria-pressed="${ledgerMode==='raw'}">原始交易</button><button class="btn ${ledgerMode==='personal'?'primary':''}" data-ledger-mode="personal" aria-pressed="${ledgerMode==='personal'}">个人收支事项</button></div>`:'';}
function personalLedger(){
 const all=[...P.select(finance().personalExpenseEvents,{month,positiveOnly:true}),...P.select(finance().personalIncomeEvents,{month,positiveOnly:true})];
 const rows=all.filter(event=>{const meta=eventPresentation(event);return(personalFilters.type==='all'||meta.kind===personalFilters.type)&&(personalFilters.account==='all'||meta.accountId===personalFilters.account)&&(personalFilters.category==='all'||event.categoryId===personalFilters.category)&&[meta.label,meta.detail,accountName(meta.accountId),categoryName(event.categoryId)].join(' ').toLowerCase().includes(personalFilters.q.toLowerCase());}).sort((a,b)=>b.effectiveDate.localeCompare(a.effectiveDate));
 const totals=P.reduce(rows),noncash=rows.filter(e=>e.key.kind==='held-recognition').length;
 return ledgerModeChooser()+`<article class="card"><div class="card-head"><h2>个人收支事项</h2><span class="tiny-label">${rows.length} 个贡献事项 · ${noncash} 个非现金核销</span></div><div class="filters"><label class="search">${icon('search')}<input id="personal-search" maxlength="500" value="${esc(personalFilters.q)}" placeholder="搜索事项、商户、来源账户或分类" aria-label="搜索个人收支"></label><select id="personal-filter-type" class="month-select" aria-label="个人收支类型"><option value="all">全部类型</option><option value="expense" ${selected(personalFilters.type,'expense')}>个人消费</option><option value="income" ${selected(personalFilters.type,'income')}>普通收入</option></select><select id="personal-filter-account" class="month-select" aria-label="资金来源账户"><option value="all">全部资金来源账户</option>${options(state.accounts,personalFilters.account)}</select><select id="personal-filter-category" class="month-select" aria-label="个人收支分类"><option value="all">全部分类</option>${options(state.categories,personalFilters.category)}</select></div><div class="ledger-summary"><span>个人消费 ${money(totals.expenseCents)}</span><span>普通收入 ${money(totals.incomeCents)}</span><button class="text-link" data-action="clear-personal-filters">清除筛选</button></div>${rows.length?rows.map(personalEventRow).join(''):'<div class="empty">这个月没有符合筛选的正数个人收支事项。</div>'}</article><p class="history-note">本页逐项金额与筛选汇总一致。非现金使用/损失按其确认日期计个人消费，不再次改变账户余额；资金来源账户只表示原付款来源。原始交易金额、零贡献记录与实际账户流请切换到原始交易查看。</p>`;
}
function ledger() {
 if(heldActive()&&ledgerMode==='personal')return personalLedger();
 const rows=monthRows().filter(t=>(filters.type==='all'||(filters.type==='paired-transfer'?Boolean(finance().impacts[t.id]?.transferPairId):t.type===filters.type))&&(filters.account==='all'||t.accountId===filters.account||t.toAccountId===filters.account)&&(filters.category==='all'||t.categoryId===filters.category)&&(`${t.note} ${accountName(t.accountId)} ${t.toAccountId?accountName(t.toAccountId):''} ${categoryName(t.categoryId)}`.toLowerCase().includes(filters.q.toLowerCase()))).sort((a,b)=>b.date.localeCompare(a.date));
 const personal=personalTotalsForRows(rows);
 return ledgerModeChooser()+`<article class="card"><div class="card-head"><h2>每一笔收支</h2><span class="tiny-label">${rows.length} 笔</span></div><div class="filters"><label class="search">${icon('search')}<input id="search" maxlength="500" value="${esc(filters.q)}" placeholder="搜索备注、账户或分类" aria-label="搜索交易"></label><select class="month-select" id="filter-type" aria-label="筛选类型"><option value="all">全部类型</option><option value="paired-transfer" ${selected(filters.type,'paired-transfer')}>已配对本人转移</option>${Object.entries(names).map(([k,v])=>`<option value="${k}" ${selected(filters.type,k)}>${v}</option>`).join('')}</select><select class="month-select" id="filter-account" aria-label="筛选账户"><option value="all">全部账户</option>${options(state.accounts,filters.account)}</select><select class="month-select" id="filter-category" aria-label="筛选分类"><option value="all">全部分类</option>${options(state.categories,filters.category)}</select></div><div class="ledger-summary"><span>${heldActive()?'这些原记录的个人消费':state.bookkeeping?'个人消费':'支出'} ${money(personal.expenseCents)}</span><span>${heldActive()?'这些原记录的普通收入':state.bookkeeping?'普通收入':'收入'} ${money(personal.incomeCents)}</span><button class="text-link" data-action="clear-filters">清除筛选</button></div>${rows.length?rows.map(t=>txRow(t)).join(''):'<div class="empty">没有符合条件的交易。<br>试试清除筛选，或选择其他月份。</div>'}</article><p class="history-note">${heldActive()?'本视图只汇总所列原始记录的个人残余，不包含另列的非现金核销；完整口径请切换个人收支事项。 ':''}逐行金额保留原始证据金额与日期，汇总显示个人消费／普通收入；关联重复证据不重复计数。已配对本人转移保留原收支方向、金额和各自日期，个人及对外现金口径为零；账户实际变动照常计入。组合成员明确标出消费 / 资金角色，只有资金成员影响账户余额。点击交易查看原金额、组合角色、转账配对、退款和应收分解。有关联的财务字段须先撤销关联再编辑，删除后可到回收区恢复。</p>`;
}
function manage() {
 const bal=L.balances(state);
 return `<article class="card section-space"><div class="card-head"><div><h2>我的账户</h2><p>账户不连接银行，余额由你记录的交易计算</p></div><button class="btn" data-action="add-account">${icon('plus')}新增账户</button></div><div class="account-grid">${state.accounts.map(a=>`<section class="account-tile"><div class="account-tile-head">${icon('wallet')}<h3>${esc(a.name)}</h3><button class="text-link" data-account="${esc(a.id)}">编辑</button></div><strong>${money(bal[a.id])}</strong><p>期初余额 ${money(a.openingBalanceCents)}</p></section>`).join('')}</div></article><article class="card"><div class="card-head"><h2>收支分类</h2><button class="btn" data-action="add-category">${icon('plus')}新增分类</button></div>${['expense','income'].map(type=>`<section class="category-section"><h3>${names[type]}分类</h3><div class="category-chips">${state.categories.filter(c=>c.type===type).map(c=>`<button class="category-chip" data-edit-category="${esc(c.id)}">${esc(c.name)} ${icon('chevron')}</button>`).join('')||'<span class="muted">暂无分类，请新增。</span>'}</div></section>`).join('')}<p class="history-note">有交易引用的账户与分类不能删除，包含已删除但可恢复的交易。修改名称会同步显示于历史记录。</p></article>`;
}
function backupPage() {
 let hasRollback=false;try{hasRollback=Boolean(storage)&&storage.getItem(ROLLBACK_KEY)!==null;}catch(_){}
 return `<div class="notice">${icon('shield')}<span>${synthetic?'演练账本只在本页内存中，不上传或跨设备同步。刷新、关闭或重置会丢弃本次修改。导出可能包含你选择或填写的数据，请妥善保管。':'账本只保存在当前设备的这个浏览器中，不会上传或跨设备同步。清理网站数据、使用无痕模式或更换网址可能使数据不可用。备份文件包含完整财务记录，请妥善保管。'}</span></div>${backupSafetyCard()}<article class="card section-space"><div class="card-head"><h2>原始恢复数据</h2></div>${rawRecoveryControls()}</article><div class="backup-grid"><article class="card"><div class="card-head"><h2>导出备份</h2>${icon('download')}</div><p class="body-copy">保存账户、分类、全部交易、已删除交易、消费沙盘设置，以及导入模板、来源证据、批次、待核对记录和覆盖确认、账务关系、购买组合的消费 / 资金角色与原始签名、规则与商户别名、整理批次、冻结月结及完整组合证明、信用账户角色、账单、完整分期、还款分配、费用索引和审计，为 JSON 文件。原始 CSV 文件内容不进入备份。跨设备时，可在另一个浏览器中恢复此文件。</p><button class="btn" data-action="verify-backup">验证备份（不替换账本）</button><button class="btn primary" data-action="export" ${blocked?'disabled':''}>导出账本 JSON</button></article><article class="card"><div class="card-head"><h2>从备份恢复</h2>${icon('upload')}</div><p class="body-copy">仅接受 moneygo JSON 备份。先校验并显示预览，确认后替换当前账本。${synthetic?'恢复前会在本页内存保留一份原演练账本供撤销；刷新或重置会清空。':'恢复前会在浏览器保留一份原账本供撤销。'}</p><button class="btn" data-action="restore">选择 JSON 备份</button>${hasRollback?'<button class="text-link rollback-link" data-action="rollback">撤销上次恢复</button>':''}</article></div><article class="card section-space"><div class="card-head"><h2>已删除交易</h2><span class="tiny-label">${state.trash.length} 笔</span></div><p class="body-copy">这些交易不计入收支和余额，点击可恢复。不会自动永久清除。</p>${state.trash.length?state.trash.slice().reverse().map(e=>txRow(e.transaction,true)).join(''):'<div class="empty compact">没有已删除的交易。</div>'}</article><article class="card"><div class="card-head"><h2>账单导入</h2><span class="tiny-label">本地 CSV / TSV</span></div><p class="body-copy">导入前检查格式、设置列映射并逐笔核对。仅保存已映射的必要字段与来源证据，原始文件留在你的设备。不同平台的导出格式需要你核对，不承诺官方兼容。</p><button class="btn" data-page="import">导入和查看历史 ${icon('arrow')}</button></article>`;
}
function modal(title,body,buttons='',ready) { if(!active())return;
 IP.invalidate();SP.invalidate();CB.invalidate();DC.invalidate();RR?.invalidate();
 modalToken++;if(!$('.modal'))lastFocus=document.activeElement;
 $('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button data-close aria-label="关闭">${icon('close')}</button></div>${synthetic?'<p class="session-modal-note">临时演练账本 · 内容可能包含你选择或填写的数据；修改仅在本页内存，刷新或重置即丢弃。</p>':''}${body}<p id="form-error" class="form-error" role="alert" tabindex="-1" hidden></p>${buttons?`<div class="modal-bottom">${buttons}</div>`:''}</section></div>`;
 document.body.style.overflow='hidden';$('#app').inert=true;$('.modal [data-close]')?.focus();ready?.();fenceControls();
}
function closeModal(force=false) { if(!active())return;
 if(!force && $('#entry-form')?.dataset.dirty==='true' && !window.confirm('放弃未保存的修改？'))return;
 IP.invalidate();SP.invalidate();CB.invalidate();DC.invalidate();RR?.invalidate();modalToken++;$('#modal-root').innerHTML='';document.body.style.overflow='';$('#app').inert=false;if(lastFocus?.isConnected)lastFocus.focus();else $('.heading h1')?.focus();
}
const cancel='<button class="btn" type="button" data-close>取消</button>';
function entry(id,initialType='expense') { if(!active())return;
 const t=state.transactions.find(t=>t.id===id);const data=t||{type:initialType==='income'?'income':'expense',date:today(),accountId:state.accounts[0]?.id,note:''};
 modal(t?'编辑交易':'记一笔',`<form id="entry-form"><div class="type-switch" role="group" aria-label="交易类型">${Object.entries(names).map(([k,v])=>`<label><input type="radio" name="type" value="${k}" ${data.type===k?'checked':''}><span>${v}</span></label>`).join('')}</div><div class="form-grid"><label class="field amount-field full">金额（人民币元）<input id="amount" name="amount" type="text" inputmode="decimal" maxlength="14" autocomplete="off" placeholder="0.00" value="${t?amountText(t.amountCents):''}" required></label><label class="field">日期<input name="date" type="date" min="0001-01-01" max="9999-12-31" value="${data.date}" required></label><label class="field"><span id="account-label">账户</span><select name="accountId" required>${options(state.accounts,data.accountId)}</select></label><label class="field full" id="category-field">分类<select name="categoryId" required></select></label><label class="field full" id="destination-field" hidden>转入账户<select name="toAccountId">${options(state.accounts,data.toAccountId||state.accounts.find(a=>a.id!==data.accountId)?.id)}</select></label><label class="field full">备注（可选）<textarea name="note" rows="3" maxlength="500" placeholder="这笔钱用在了哪里？">${esc(data.note)}</textarea></label></div><p class="form-hint" id="entry-hint"></p>${t?B.transactionDetails(bookkeepingContext(),t.id)+(state.organizer?O.transactionDetails(organizerContext(),t.id):''):''}<div class="modal-bottom">${t?'<button class="btn danger" type="button" id="delete-transaction">删除</button>':''}${cancel}<button class="btn primary" type="submit">保存${t?'修改':''}</button></div></form>`,'',()=>{
  const form=$('#entry-form');
  function typeChanged(){const type=form.elements.type.value,transfer=type==='transfer';$('#category-field').hidden=transfer;$('#destination-field').hidden=!transfer;form.elements.categoryId.required=!transfer;form.elements.toAccountId.required=transfer;form.elements.categoryId.innerHTML=options(state.categories.filter(c=>c.type===type),data.categoryId);$('#account-label').textContent=transfer?'转出账户':'账户';$('#entry-hint').textContent=transfer?'转账会同时减少转出账户余额、增加转入账户余额，不计收入或支出。':'金额大于 0，最多两位小数。账本按交易日期统计。';}
  typeChanged();form.elements.type.forEach(r=>r.onchange=typeChanged);
  form.addEventListener('input',()=>form.dataset.dirty='true');form.addEventListener('change',()=>form.dataset.dirty='true');
  form.onsubmit=e=>{e.preventDefault();try{const values=new FormData(form),type=values.get('type');const input={type,date:values.get('date'),amountCents:L.parseAmount(values.get('amount')),accountId:values.get('accountId'),note:values.get('note')};if(type==='transfer')input.toAccountId=values.get('toAccountId');else input.categoryId=values.get('categoryId');const next=L.putTransaction(state,input,t?.id);persist(next);month=input.date.slice(0,7);closeModal(true);render();toast(t?'交易已更新':'已保存到当前浏览器');}catch(e){error(e.message);}};
  if(t)$('#delete-transaction').onclick=()=>confirmDelete(t);
  $('#amount').focus();
 });
}
function confirmDelete(t) {modal('删除这笔交易？',`<p>${esc(t.note||names[t.type])} · ${t.date} · ${money(t.amountCents)}</p><p>删除后收支和账户余额会重算。你可以随时在「数据备份 → 已删除交易」恢复。</p>`,`${cancel}<button class="btn danger" id="confirm-delete">确认删除</button>`,()=>$('#confirm-delete').onclick=()=>change(()=>L.deleteTransaction(state,t.id),'已删除，可到「数据备份」恢复'));}
function editAccount(id) { if(!active())return;
 const a=state.accounts.find(a=>a.id===id);
 modal(a?'编辑账户':'新增账户',`<form id="entry-form"><div class="form-grid"><label class="field full">账户名称<input name="name" value="${esc(a?.name||'')}" maxlength="80" placeholder="例如：工资卡" required></label><label class="field full">期初余额（人民币元）<input name="opening" type="text" inputmode="decimal" value="${a?amountText(a.openingBalanceCents):'0.00'}" maxlength="15" required></label></div><p class="form-hint">记第一笔交易前的账户余额，可为负数。不是收入；修改期初余额会调整当前账本余额。</p><div class="modal-bottom">${a?'<button class="btn danger" type="button" id="remove-account">删除账户</button>':''}${cancel}<button class="btn primary" type="submit">保存账户</button></div></form>`,'',()=>{
  const f=$('#entry-form');f.addEventListener('input',()=>f.dataset.dirty='true');f.onsubmit=e=>{e.preventDefault();try{const input={name:f.elements.name.value,openingBalanceCents:L.parseAmount(f.elements.opening.value,{allowNegative:true,allowZero:true})};const next=L.putAccount(state,input,a?.id);if(a&&input.openingBalanceCents!==a.openingBalanceCents){modal('调整期初余额？',`<p>${esc(input.name)} 的期初余额将从 ${money(a.openingBalanceCents)} 改为 ${money(input.openingBalanceCents)}。账户余额同步调整，历史交易保持不变。</p>`,`${cancel}<button class="btn primary" id="confirm-opening">确认调整</button>`,()=>$('#confirm-opening').onclick=()=>change(()=>next,'账户已更新'));}else change(()=>next,'账户已保存');}catch(e){error(e.message);}};
  if(a)$('#remove-account').onclick=()=>modal('删除账户？',`<p>将删除「${esc(a.name)}」。其期初余额 ${money(a.openingBalanceCents)} 也将从账户合计中移除。有交易引用的账户无法删除。</p>`,`${cancel}<button class="btn danger" id="confirm-remove">确认删除账户</button>`,()=>$('#confirm-remove').onclick=()=>change(()=>L.removeAccount(state,a.id),'账户已删除'));
 });
}
function editCategory(id) { if(!active())return;
 const c=state.categories.find(c=>c.id===id);
 modal(c?'编辑分类':'新增分类',`<form id="entry-form"><div class="form-grid"><label class="field full">分类名称<input name="name" maxlength="80" value="${esc(c?.name||'')}" required></label><label class="field full">类型<select name="type" ${c?'disabled':''}><option value="expense">支出</option><option value="income" ${c?.type==='income'?'selected':''}>收入</option></select></label></div><p class="form-hint">已创建分类的收支类型不能更改，避免改变历史交易的含义。</p><div class="modal-bottom">${c?'<button class="btn danger" type="button" id="remove-category">删除分类</button>':''}${cancel}<button class="btn primary" type="submit">保存分类</button></div></form>`,'',()=>{
  const f=$('#entry-form');f.addEventListener('input',()=>f.dataset.dirty='true');f.onsubmit=e=>{e.preventDefault();change(()=>L.putCategory(state,{name:f.elements.name.value,type:c?.type||f.elements.type.value},c?.id),'分类已保存');};
  if(c)$('#remove-category').onclick=()=>modal('删除分类？',`<p>将删除「${esc(c.name)}」。有交易引用的分类无法删除，包括已删除的可恢复交易。</p>`,`${cancel}<button class="btn danger" id="confirm-remove">确认删除分类</button>`,()=>$('#confirm-remove').onclick=()=>change(()=>L.removeCategory(state,c.id),'分类已删除'));
 });
}
function download(text,filename,mimeType='application/json;charset=utf-8',immutableSample=false) {
 if(!active())return false;const epoch=runtime.lifecycle.epoch();let url,a,initiated=false;const release=()=>{if(!ownedUrls.has(url))return;try{URL.revokeObjectURL(url);}catch(_){}ownedUrls.delete(url);};
 try {const blob=new Blob([text],{type:mimeType});url=URL.createObjectURL(blob);ownedUrls.add(url);if(!currentEpoch(epoch))return false;a=document.createElement('a');a.href=url;a.download=immutableSample?filename:sessionFileName(filename);document.body.append(a);if(!currentEpoch(epoch))return false;a.click();initiated=true;if(currentEpoch(epoch)){try{later(release,1000);}catch(_){release();}}else release();return true;}
 finally {try{a?.remove();}catch(_){}if(url&&!initiated)release();}
}
function rawRecoveryControls(retainedId='') {
 return `<p class="body-copy">原始恢复数据保留存储中的原文，可能包含完整财务记录，未加密。它不是标准 Moneygo 备份，不能直接通过“选择 JSON 备份”恢复；请妥善保管。下载不会修改账本或恢复副本。</p><button class="btn" data-action="export-raw">下载当前存储的原始恢复数据</button><button class="btn" ${retainedId?'id="'+retainedId+'"':''} data-action="export-recovery-raw">下载恢复前副本的原始数据</button>`;
}
function rawRecoveryDownload(retained) {
 if(!active())return;const epoch=runtime.lifecycle.epoch(),source=retained?'恢复前副本':'当前存储';let raw;
 try {if(!storage)throw Error('Storage unavailable');raw=storage.getItem(retained?ROLLBACK_KEY:L.STORAGE_KEY);}
 catch(_){error('无法读取'+source+'的原始恢复数据，未发起下载。请检查浏览器存储访问权限。');return;}
 if(!currentEpoch(epoch))return;
 if(raw===null){error('没有可下载的'+source+'原始恢复数据。');return;}
 try {
  let malformed=false;for(let i=0;i<raw.length;i++){const code=raw.charCodeAt(i);if(code>=0xd800&&code<=0xdbff){const next=raw.charCodeAt(i+1);if(next>=0xdc00&&next<=0xdfff)i++;else{malformed=true;break;}}else if(code>=0xdc00&&code<=0xdfff){malformed=true;break;}}
  let payload=raw,mime='application/json;charset=utf-8',suffix='.json';
  if(malformed){payload=new Uint8Array(2+2*raw.length);payload[0]=0xff;payload[1]=0xfe;for(let i=0;i<raw.length;i++){const code=raw.charCodeAt(i);payload[2+2*i]=code&255;payload[3+2*i]=code>>>8;}mime='application/octet-stream';suffix='.raw-utf16le';}
  if(download(payload,`moneygo-raw-${retained?'before-restore':'current'}-${today()}${suffix}`,mime))diagnostic(()=>toast((malformed?'原始 UTF-16LE 恢复数据（含 BOM），不是标准 Moneygo 备份，不能直接恢复。':'')+'已发起原始恢复数据下载，请检查浏览器下载列表。'));
 }catch(_){error(source+'原始恢复数据下载未能发起，请检查浏览器下载功能后重试。');}
}
function exportCurrentBackup() {
 if(!active())return;let text;
 try{text=L.backup(state);}catch(e){error(errorData(e,'code')==='BACKUP_TOO_LARGE'?'当前账本超过支持的完整备份容量，未发起备份下载。请下载原始恢复数据，或恢复较小的有效备份；不会自动删减历史。':'完整备份生成失败：'+failureMessage(e)+' 可下载原始恢复数据，或恢复有效备份。');return;}
 try{if(download(text,`moneygo-${today()}.json`))diagnostic(()=>toast('已发起备份下载，请检查浏览器下载列表。'));}catch(_){error('备份下载未能发起，请检查浏览器下载功能后重试。也可下载原始恢复数据。');}
}

function showRestore() { if(!active())return;
 modal('选择账本备份',`<p>选择 moneygo 导出的 JSON 文件（最多 32 MB）。文件只在浏览器内读取，不会上传。</p><label class="field restore-file">JSON 备份文件<input type="file" accept=".json,application/json" id="restore-file"></label><div id="restore-preview"></div>`,cancel,()=>{
 const epoch=runtime.lifecycle.epoch(),token=modalToken;let readNumber=0;$('#restore-file').onchange=async e=>{if(!currentEpoch(epoch))return;const read=++readNumber;$('#restore-preview').innerHTML='';$('#form-error').hidden=true;const file=e.target.files[0];if(!file)return;try{if(file.size>32*1024*1024)throw Error('文件超过 32 MB，请选择有效备份。');const text=await file.text();if(!currentEpoch(epoch)||token!==modalToken||read!==readNumber)return;const next=L.parseBackup(text),verification=next.bookkeeping?.version===4||next.incomePlanning||next.spendingPlanning?L.verifyBackup(text):null;restorePreview(verification?verification.state:next,verification);}catch(e){if(currentEpoch(epoch)&&token===modalToken&&read===readNumber){$('#restore-preview').innerHTML='';error(e.message);}}};
 });
}
function incomeBackupReview(result) {
 if(!result?.state?.incomePlanning)return '';
 const counts=result.incomePlanningCounts||{},count=key=>Number.isSafeInteger(counts[key])&&counts[key]>=0?counts[key]:'未知';
 let applicability='<p>当前来源适用性尚未核对；不影响已经完成的备份结构校验。</p>';
 try { const cutoff=today(),view=window.MoneygoIncomePlanning.view(result.state,{asOfDate:cutoff}),rows=view.receipts,number=status=>rows.filter(row=>row.applicability===status).length;
  applicability=`<p>按当前来源关系核对至 ${esc(cutoff)} 日终：${number('applicable')} 笔适用；${number('source-missing')} 笔来源缺失；${number('source-changed')} 笔来源字段变化；${number('role-changed')} 笔角色或构成变化；${number('unsupported-basis')} 笔依据超限；${number('future-at-cutoff')} 笔来源尚晚于查看日。</p><p>这是当前关系与注释的查看结果，不代表当时已知信息。待复核的计划完整已收及剩余保持未知，不作为备份拒绝条件。</p>`;
 } catch (_) { /* Structural restore verification remains authoritative; projection is a separate advisory read. */ }
 return `<section class="income-backup-review"><h4>收入计划与非现金到账归属</h4><p>${count('currentPlans')} 项当前计划（含 ${count('cancelledPlans')} 项已取消） · ${count('retiredPlans')} 项退役历史<br>${count('currentReceipts')} 笔当前归属 · ${count('reversedReceipts')} 笔已撤销归属 · ${count('auditOperations')} 个审计操作</p>${applicability}<p>这些归属解释已有普通收入，不新增交易、账户余额或可花现金；备份未加密。</p></section>`;
}
function spendingBackupReview(result) {
 if(!result?.state?.spendingPlanning)return '';
 const counts=result.spendingPlanningCounts||{},count=key=>Number.isSafeInteger(counts[key])&&counts[key]>=0?counts[key]:'未知';
 let applicability='<p>当前来源适用性尚未核对；不影响已经完成的备份结构校验。</p>';
 try { const cutoff=today(),view=window.MoneygoSpendingPlanning.view(result.state,{asOfDate:cutoff}),rows=view.payments,number=status=>rows.filter(row=>row.applicability===status).length;
  applicability=`<p>按当前来源关系核对至 ${esc(cutoff)} 日终：${number('applicable')} 笔适用；${number('source-missing')} 笔来源缺失；${number('source-changed')} 笔来源字段变化；${number('role-changed')} 笔角色变化；${number('basis-changed')} 笔退款、应收或重复依据变化；${number('unsupported-basis')} 笔依据超限；${number('future-at-cutoff')} 笔来源尚晚于查看日。</p><p>这是当前关系与注释的查看结果，不代表当时已知信息。待复核的完整已关联付款及剩余保持未知，不作为备份拒绝条件。退款不自动形成新欠款。</p>`;
 } catch (_) { /* Structural verification and current applicability are separate. */ }
 return `<section class="spending-backup-review"><h4>支出计划与非现金付款归属</h4><p>${count('currentPlans')} 项当前计划（含 ${count('cancelledPlans')} 项已取消） · ${count('retiredPlans')} 项退役历史<br>${count('currentPayments')} 笔当前付款归属 · ${count('reversedPayments')} 笔已撤销付款归属 · ${count('auditOperations')} 个审计操作</p>${applicability}<p>以已有付款毛额作注释，剩余单独由用户确认；不增加真实交易，不改变账户余额，不表示可花现金。备份未加密。</p></section>`;
}
function heldBackupReview(result) {
 if(!result.heldCounts)return '';const c=result.heldCounts,h=result.heldSummary,r=result.dateRanges;
 const range=value=>value?.start?esc(value.start)+' 至 '+esc(value.end):'无记录';
 return `<section class="held-backup-review"><h4>押金与预付凭据</h4><p>${c.positions} 项本金 · ${c.uses} 次实际使用 · ${c.losses} 次确认损失 · ${c.returns} 笔实收退回 · ${c.auditOperations} 次历史审计操作</p><p>原始记录（含已删除）日期范围：${range(r.raw)}<br>当前个人事件日期范围：${range(r.personalEvents)}</p><p>全部已记录日期合计：原本金 ${money(h.fundedCents)}；使用 ${money(h.usedCents)}；损失 ${money(h.lostCents)}；退回 ${money(h.returnedCents)}；未核销本金 ${money(h.remainingCents)}。</p><p>合计包含已录入的未来日期，不是截至今天的余额；只反映已记录本金，不增加现金，不保证可退或可收回。已撤销核销保留在审计历史中，不属于当前个人事件日期范围。</p></section>`;
}
function heldRestoreReview(next) {
 if(next.bookkeeping?.version!==4)return '';const data=next.bookkeeping,financial=window.MoneygoRelations.calculate(next);
 const range=values=>{values.sort();return {start:values[0]||null,end:values.at(-1)||null};};
 return heldBackupReview({heldCounts:{positions:data.heldPositions.length,uses:data.heldRecognitions.filter(row=>row.kind==='use').length,losses:data.heldRecognitions.filter(row=>row.kind==='loss').length,returns:data.heldReturns.length,auditOperations:data.audit.filter(row=>['heldPosition','heldRecognition','heldReturn'].includes(row.kind)).length},heldSummary:financial.held.totals,dateRanges:{raw:range(next.transactions.concat(next.trash.map(row=>row.transaction)).map(row=>row.date)),personalEvents:range(financial.personalExpenseEvents.concat(financial.personalIncomeEvents).map(event=>event.effectiveDate))}});
}
function restorePreview(next,verification=null) { if(!active())return;
 const epoch=runtime.lifecycle.epoch(),token=modalToken,previewState=state,previewRaw=savedRaw;
 const dates=next.transactions.map(t=>t.date).sort();
 $('#restore-preview').innerHTML=`<div class="restore-summary"><h3>备份已通过校验</h3><p>${next.accounts.length} 个账户 · ${next.categories.length} 个分类<br>${next.transactions.length} 笔交易 · ${next.trash.length} 笔已删除交易<br>${next.simulation?next.simulation.scenarios.length+' 个模拟方案':'无模拟方案（旧版备份兼容）'}<br>${next.imports?next.imports.batches.length+' 个导入批次 · '+next.imports.quarantine.length+' 条待核对记录':'无导入记录（旧版备份兼容）'}<br>${next.bookkeeping?next.bookkeeping.links.length+' 组证据关联 · '+next.bookkeeping.refunds.length+' 笔退款分配 · '+next.bookkeeping.claims.length+' 笔应收 · '+(next.bookkeeping.transferPairs?.length||0)+' 组本人转账配对 · '+(next.bookkeeping.composites?.length||0)+' 组购买组合 · '+next.bookkeeping.settlements.length+' 笔回款分配 · '+next.bookkeeping.snapshots.length+' 份余额快照 · '+next.bookkeeping.refundPlans.length+' 份待退款计划':'无账务关系（旧版备份兼容）'}<br>${next.organizer?next.organizer.rules.length+' 条规则 · '+next.organizer.aliases.length+' 条别名 · '+next.organizer.closes.length+' 份月结 · '+next.organizer.batches.length+' 个整理批次 · '+next.organizer.scopes.length+' 项来源范围':'无整理复盘数据（旧版备份兼容）'}<br>${next.obligations?next.obligations.profiles.length+' 个信用账户角色 · '+next.obligations.statements.length+' 份信用账单 · '+next.obligations.contracts.length+' 份分期合同 · '+next.obligations.repayments.length+' 笔还款分配 · '+next.obligations.inclusions.length+' 项已入账分期 · '+next.obligations.fees.length+' 条费用证据':'无信用义务数据（旧版备份兼容）'}<br>${dates.length?`${dates[0]} 至 ${dates[dates.length-1]}`:'空账本'} · 人民币</p>${verification?heldBackupReview(verification)+incomeBackupReview(verification)+spendingBackupReview(verification):heldRestoreReview(next)}</div><p>当前账本：${state.transactions.length} 笔交易。恢复会完整替换账本及所有扩展，不会合并。旧版备份不含的沙盘、导入、账务关系（包括购买组合、押金与预付）、整理复盘、信用义务、收入计划及支出计划与付款归属注释将被清除。原账本将保留一份供撤销下次恢复前使用。</p><label class="confirm-check"><input type="checkbox" id="restore-consent">我确认用这份备份替换当前账本</label><button class="btn primary" id="confirm-restore" disabled>确认替换并恢复</button>`;
 const consent=$('#restore-consent'),confirm=$('#confirm-restore');
 const currentPreview=()=>currentEpoch(epoch)&&token===modalToken&&$('#confirm-restore')===confirm&&$('#restore-consent')===consent;
 consent.onchange=e=>{if(currentPreview())confirm.disabled=!e.target.checked;};
 confirm.onclick=()=>{if(!currentPreview())return;try{
  if(!consent.checked)return;
  if(state!==previewState||savedRaw!==previewRaw)throw Error('账本已变化，请重新选择文件并核对恢复预览。');
  if(!storage)throw Error('本地存储不可用，不能恢复。');
  const basis=savedRaw;ledgerGuard(basis);
  const original=savedRaw ?? JSON.stringify(state),previousRollback=storage.getItem(ROLLBACK_KEY),retryBudget={used:false};
  // A rejected staging write must not enter the compensation region.
  forwardWrite(()=>{try{storage.setItem(ROLLBACK_KEY,original);}catch(e){observeStorage({target:'recovery-copy',operation:'write',outcome:'failed',cause:directQuota(e)?'quota-reported':'write-failed',phase:'staging'});refreshBackupStatus();throw e;}},directQuota,retryBudget,()=>ledgerGuard(basis));
  try {
   observeStorage({target:'recovery-copy',operation:'write',outcome:'accepted',phase:'staging'});
   let staged;
   try{staged=storage.getItem(ROLLBACK_KEY);}catch(e){observeStorage({target:'recovery-copy',operation:'read',outcome:'failed',cause:'read-failed',phase:'readback'});throw e;}
   if(staged!==original){observeStorage({target:'recovery-copy',operation:'read',outcome:'failed',cause:'copy-mismatch',phase:'readback'});throw Error('无法保留原账本，恢复已取消。');}
   observeStorage({target:'recovery-copy',operation:'read',outcome:'accepted',phase:'readback'});
   persistRecovery(next,retryBudget);
  }catch(saveError){
   try{if(previousRollback===null)storage.removeItem(ROLLBACK_KEY);else storage.setItem(ROLLBACK_KEY,previousRollback);}
   catch(_){observeStorage({target:'recovery-copy',operation:'write',outcome:'failed',cause:'write-failed',phase:'compensation'});refreshBackupStatus();throw Error(failureMessage(saveError)+' 原先的撤销副本无法还原，请立即导出当前账本。');}
   observeStorage({target:'recovery-copy',operation:'write',outcome:'accepted',phase:'compensation'});refreshBackupStatus();throw saveError;
  }
  closeModal(true);render();toast('恢复成功，原账本可通过「撤销上次恢复」找回。');
 }catch(e){error(`恢复未完成：${failureMessage(e)}`);}};fenceControls();

}
function rollback() { if(!active())return;try{const raw=storage?.getItem(ROLLBACK_KEY);if(raw===null||raw===undefined)throw Error('没有可撤销的恢复。');const next=L.validateState(JSON.parse(raw));modal('撤销上次恢复？',`<p>将用恢复前保留的 ${next.transactions.length} 笔交易替换当前账本。上次恢复之后新增或修改的内容会被替换，请先导出当前备份。</p>${rawRecoveryControls()}`,`${cancel}<button class="btn" id="export-current">导出当前备份</button><button class="btn primary" id="confirm-rollback">确认撤销恢复</button>`,()=>{$('#export-current').onclick=()=>exportCurrentBackup();$('#confirm-rollback').onclick=()=>{try{persistRecovery(next);closeModal(true);render();$('.heading h1')?.focus();toast('已恢复到上次恢复之前的账本');}catch(e){error(failureMessage(e));}};});}catch(e){modal('无法自动撤销',`<p>保留的原始数据无法通过校验。可以先下载保留的数据进行检查，当前账本不会改变。</p>${rawRecoveryControls('download-original')}`,cancel);}}
function demo() {if(synthetic){practiceFiles();return;}modal('进入独立的临时演练账本',`<p>初始数据为合成样例，使用真实导入、核对与备份流程。不会读取或改变个人账本；演练修改仅留在本页内存，刷新后重置。</p>`,`${cancel}<a class="btn primary" href="demo.html">进入虚构样例</a>`);}
function method(){modal('怎样计算这本账',`${C.legacyScopeNotice(obligationsContext())}<div class="accounting-steps"><div class="accounting-step"><strong>信用义务与现金角色</strong>正式账单记录所列应还金额，不等于信用账户总余额或本期消费。只有已记录的真实转账才能分配还款，未来到账仍待发生。分期保留全部期次，明确关联到账单后替代对应预测；连续账单和未关联分期可能重叠，因此不擅自合计为总债务。授信额度从不计资产。按当前账户角色分组的余额和变动截止查看日，其他资料为当前版本；不重建历史角色，不证明可安全消费或银行已还清。</div><div class="accounting-step"><strong>收入、支出、结余</strong>按交易日期的年月统计；启用账务关联后，个人消费扣除已关联退款与应收份额，普通收入扣除退款及回款。现金按实际到账／付出日期单列，后续退款可重算原购买月。所有金额以整数分保存。</div><div class="accounting-step"><strong>押金与预付</strong>从一笔已记录支出中明确划分已付本金，充值或付押金本身不计该份额的个人消费；实际使用或确认损失按各自日期与分类计消费，不再扣现金。退回必须关联真实收入，退回本金不算普通收入。剩余本金不是银行余额或收回保证，到期只作提示，不自动确认损失。暂不支持赠送余额、多笔充值合并、损失后追回及已跟踪钱包重复记账。</div><div class="accounting-step"><strong>账户余额</strong>期初余额 + 全部收入 − 全部支出 + 转入 − 转出，包含全部日期。期初余额不计作收入。</div><div class="accounting-step"><strong>转账不算消费</strong>手工双边转账在同一天影响两个不同账户。导入原支出与另一本人账户的等额原收入需人工确认配对，分别保留原日期；跨月不提前确认到账。本人转移不计个人消费、普通收入或对外现金，全部账户流入／流出仍逐边列示，转移本金仅按转出日计一次。手续费与后续现金消费另记支出；单边证据保持未配对，不自动补另一边。</div><div class="accounting-step"><strong>本地账本</strong>支持人民币手动收支、账户转账和用户映射的本地 CSV / TSV 收支导入。来源标识用于区分数据，目标账户单独指定；候选重复不会自动合并。支持人工确认多份证据、已到账退款和应收回款；个人消费、对外现金和全部账户实际变动分开展示。支持用户提供的本地信用账期与完整分期；不连接机构、不自动同步、不代为付款，也不承诺官方账单格式兼容。</div></div>`, '<button class="btn primary" data-close>知道了</button>');}
// Import text and file bytes exist only in this tab's memory, never in persisted UI state.
const IMPORT_PAGE_SIZE = 40;
const importLabels = {new:'新增',update:'来源修订',status:'状态变更',candidate:'可能重复',duplicate:'确定重复',invalid:'字段错误',conflict:'本地修改冲突','transfer-candidate':'可能为转账'};
let importReadToken = 0, importBusy = false, importHistoryOffset = 0;
let importDraft = freshImportDraft();
function freshImportDraft() {
 return {text:'',bytes:null,fileName:'',encoding:'utf-8',inspection:null,parsed:null,error:'',reading:false,preview:null,repairId:null,selected:new Set(),offset:0,templateId:'',headerMismatch:false,preambleConfirmed:false,recordOffset:0,config:{sourceKey:'',accountId:state.accounts[0]?.id||'',delimiter:',',header:true,columns:{},dateFormat:'YYYY-MM-DD',amountMode:'absolute',defaultType:'expense',categoryIds:{expense:state.categories.find(c=>c.type==='expense')?.id||'',income:state.categories.find(c=>c.type==='income')?.id||''}},directionText:'',statusText:'',statusCompletedConfirmed:false,coverageConfirmed:false,coverageStart:'',coverageEnd:''};
}
function cancelImportRead() { for(const item of importQueue?.list()||[])importQueue.cancel(item.id);importReadToken++;if(importDraft.reading){importDraft.reading=false;importDraft.error='文件读取已取消，请重新选择文件。';} }
// Multi-file intake is ephemeral. Only one explicitly reviewed file becomes one import batch.
const W = window.MoneygoImportWorkflow;
const importQueue = W ? W.createQueue(freshImportDraft) : null;
let importCoverageMonth = synthetic?runtime.presentation.initialMonth:today().slice(0, 7), importCoverageOffset = 0;
function activeImportItem() { const item=importQueue?.active();return item?.draft===importDraft?item:null; }
function refreshImportQueueStaleness() {
 for(const item of importQueue?.list()||[])if(item.draft.preview&&(stale||blocked||item.draft.previewState!==state)){item.draft.preview=null;item.draft.previewState=null;item.draft.selected=new Set();item.draft.offset=0;item.draft.error='账本已变化，请重新生成此文件的预览并重新选择。';item.status='stale';}
}
function rememberImportForm() {if(importDraft.text&&$('#import-config-form')?.elements?.sourceKey)captureImportConfig();}
async function addImportFiles(files) { if(!active())return;
 if(!importQueue)return files?.length?readImportFile(files[0]):undefined;
 if(importBusy||blocked||stale||!files?.length)return;
 rememberImportForm();const before=importQueue.active(),result=importQueue.add(files);
 if(result.errors.length)toast(result.errors.join('；'));
 if(!before&&importQueue.active())return selectImportQueueFile(importQueue.active().id);
 render();
}
async function readQueuedImportFile(item) { if(!active())return;
 if(!item||!item.file)return;
 const epoch=runtime.lifecycle.epoch(),readToken=importReadToken,encoding=item.draft.encoding;
 item.draft.preambleConfirmed=false;item.draft.recordOffset=0;item.draft.statusCompletedConfirmed=false;item.draft.coverageConfirmed=false;item.draft.preview=null;item.draft.previewState=null;item.draft.selected=new Set();
 const job=importQueue.read(item.id,(bytes)=>{
  if(!currentEpoch(epoch)||readToken!==importReadToken)throw Error('Inactive read');
  const text=decodeImportBytes(bytes,encoding),inspection=I.inspectCSV(text),config={...item.draft.config};
  config.delimiter=item.name.toLowerCase().endsWith('.tsv')?'\t':inspection.suggestedDelimiter||',';
  let parsed;try{parsed=I.parseCSV(text,{delimiter:config.delimiter,header:config.header,startLine:config.startLine});}catch(error){return {text,bytes,inspection,parsed:null,config,preview:null,selected:new Set(),offset:0,error:error.message};}config.columns=guessImportColumns(parsed.headers||[]);
  const headers=config.header===false?Array.from({length:parsed.rows[0]?.fields.length||0},(_,i)=>'第'+(i+1)+'列'):parsed.headers;
  return {text,bytes,inspection,parsed,config,headerMismatch:!!config.expectedHeaders&&JSON.stringify(config.expectedHeaders)!==JSON.stringify(headers),preview:null,selected:new Set(),offset:0};
 });
 const queueToken=item.token;if(page==='import')render();await job;if(!currentEpoch(epoch)||readToken!==importReadToken||item.token!==queueToken||importQueue.get(item.id)!==item)return;if(page==='import'&&activeImportItem()?.id===item.id){render();$('#import-active-heading')?.focus();}
}
async function selectImportQueueFile(id) { if(!active())return;
 if(importBusy)return;rememberImportForm();const item=importQueue.select(id);importDraft=item.draft;refreshImportQueueStaleness();
 render();if(item.status==='queued'||item.status==='error'&&item.file)await readQueuedImportFile(item);else $('#import-active-heading')?.focus();
}
function removeImportQueueFile(id) { if(!active())return;
 if(importBusy)return;rememberImportForm();const current=activeImportItem(),wasCurrent=current?.id===id;
 importQueue.remove(id);if(wasCurrent)importDraft=importQueue.active()?.draft||freshImportDraft();render();$('#import-file')?.focus();
}
function importQueueMarkup() {
 if(!importQueue)return '';const items=importQueue.list(),current=activeImportItem();
 return `<div id="import-drop-zone" class="import-drop-zone" role="group" aria-label="本地多文件接收区"><p>可一次选择或拖入多个 CSV / TSV。每份文件单独确认来源、账户和映射，逐份预览、逐份提交。</p><p class="form-hint">最多 20 个文件，合计 32 MB，每份最多 8 MB / 10,000 行。只读取你当前打开的文件；本页队列刷新后清除，已提交批次保留。读取失败可再次点开重试。</p>${items.length?`<ol class="import-file-queue">${items.map(item=>{const rolledBack=item.batchId&&(state.imports?.batches||[]).find(b=>b.id===item.batchId)?.rolledBack;return `<li class="${current?.id===item.id?'active':''}"><button type="button" data-intake-open="${esc(item.id)}" ${current?.id===item.id?'aria-current="true"':''} ${importBusy?'disabled':''}><strong>${esc(item.name)}</strong><span>${rolledBack?'已回滚，请重新选择文件':esc(W.STATUSES[item.status])}${item.draft.config.sourceKey?' · '+esc(item.draft.config.sourceKey):' · 来源待确认'}${item.draft.config.accountId?' · '+esc(accountName(item.draft.config.accountId)):' · 账户待确认'}</span></button><button type="button" class="text-link" data-intake-remove="${esc(item.id)}" aria-label="从待处理队列移除 ${esc(item.name)}" ${importBusy?'disabled':''}>移除</button></li>`;}).join('')}</ol><p class="form-hint">移除文件只清除本页草稿，不撤销已提交批次。需要撤销请使用下方导入历史。</p>`:''}</div>`;
}
function importCoverageMarkup() {
 if(!W)return '';let calendar,checklist;try{calendar=W.coverageCalendar(state,importCoverageMonth);checklist=W.exportChecklist(state,importCoverageMonth,today());}catch(e){return `<div class="notice warning" role="alert">${esc(e.message)}</div>`;}
 const pageSize=8;importCoverageOffset=Math.min(importCoverageOffset,Math.max(0,Math.ceil(calendar.sources.length/pageSize)-1)*pageSize);
 const sources=calendar.sources.slice(importCoverageOffset,importCoverageOffset+pageSize),keys=new Set(sources.map(s=>s.key));
 const ranges=items=>items.map(r=>r.start===r.end?esc(r.start):`${esc(r.start)} 至 ${esc(r.end)}`).join('；');
 return `<article class="card section-space"><div class="card-head"><div><h2>账单覆盖日历</h2><p>只看你明确确认过的导出范围，按来源和资金账户分别展示</p></div><label class="field">查看月份<input type="month" id="import-coverage-month" value="${esc(importCoverageMonth)}" min="0001-01" max="9999-12"></label></div><p class="form-hint">${esc(calendar.warning)}</p><p class="coverage-legend">✓ 已确认导出范围 · ≋ 重叠范围 · ? 未确认覆盖</p>${sources.map(s=>`<section class="coverage-source"><h3>${esc(s.sourceKey)} · ${esc(accountName(s.accountId))}</h3><p class="form-hint">${s.included===false?'用户已从分析范围排除：'+esc(s.reason):s.declared?'用户已声明纳入分析范围':'尚未声明是否纳入分析范围'} · 已确认 ${s.coveredDays}/${calendar.dayCount} 天 · 重叠 ${s.overlapDays} 天</p><ol class="coverage-days" aria-label="${esc(s.sourceKey)} ${esc(accountName(s.accountId))} ${esc(importCoverageMonth)} 每日覆盖状态">${['一','二','三','四','五','六','日'].map(day=>`<li class="weekday" aria-hidden="true">周${day}</li>`).join('')}${Array.from({length:calendar.weekOffset},()=>'<li class="spacer" aria-hidden="true"></li>').join('')}${s.days.map(d=>`<li class="${d.status}" title="${esc(d.date)}：${d.count?d.count+' 个已确认导出范围':'未确认覆盖'}"><span>${Number(d.date.slice(8))}</span><span aria-hidden="true">${d.count===0?'?':d.count===1?'✓':'≋'}</span><span class="sr-only">${d.count?d.count+' 个已确认导出范围':'未确认覆盖'}</span></li>`).join('')}</ol><p class="form-hint">未确认覆盖：${s.gaps.length?ranges(s.gaps):'本月各日均在已确认导出范围内'}${s.overlaps.length?'<br>重叠：'+ranges(s.overlaps):''}${s.pendingEvidenceCount?'<br>另有 '+s.pendingEvidenceCount+' 条处理中证据（不限本月），不会当作已完成收支。':''}${s.unresolvedRows?'<br>该来源仍有 '+s.unresolvedRows+' 条待核对记录（不限本月），覆盖确认不代表这些行已入账。':''}</p></section>`).join('')||'<p class="empty compact">尚无来源声明或导入历史。没有交易记录不代表零消费。</p>'}${calendar.sources.length>pageSize?`<div class="exclusion-pager"><button class="btn" id="import-coverage-prev" ${importCoverageOffset===0?'disabled':''}>上一组来源</button><span>${importCoverageOffset+1}–${Math.min(importCoverageOffset+pageSize,calendar.sources.length)} / ${calendar.sources.length}</span><button class="btn" id="import-coverage-next" ${importCoverageOffset+pageSize>=calendar.sources.length?'disabled':''}>下一组来源</button></div>`:''}<h3>下次导出清单</h3><p class="form-hint">根据上面所选月份的未确认区间和最新确认截止日整理。按你自己的节奏处理；这里没有自动提醒或已验证的品牌导出指引。</p><ul class="export-checklist">${checklist.sources.filter(s=>keys.has(JSON.stringify([s.sourceKey,s.accountId]))).map(s=>`<li><strong>${esc(s.sourceKey)} · ${esc(accountName(s.accountId))}</strong>${s.excluded?`<p>已明确排除，不列为补齐要求。原因：${esc(s.reason)}</p>`:`<p>${s.latestConfirmedEnd?'最新确认覆盖截至 '+esc(s.latestConfirmedEnd)+'；'+(s.nextStart?'后续可从 '+esc(s.nextStart)+' 起自行选择导出终点。':'已到支持的日期上限。'):'尚无已确认截止日，请自行核对希望开始的日期。'}</p><p>所选月份需核对的范围：${s.gaps.length?ranges(s.gaps):'无未确认覆盖区间'}。</p>${s.needsSourceDeclaration?'<p>请先在来源范围中确认是否纳入；不会自动要求补齐。</p>':''}${s.pendingEvidenceCount?`<p>另有 ${s.pendingEvidenceCount} 条处理中证据，等待后续状态核对。</p>`:''}${s.unresolvedRows?`<p>另有 ${s.unresolvedRows} 条待核对记录；重新导出不代替逐条处理。</p>`:''}`}</li>`).join('')||'<li>请先声明你想纳入的来源与账户，再核对导出起止日期。</li>'}</ul>${calendar.unknownAccounts.length?`<p class="form-hint">尚未声明来源范围的账户：${calendar.unknownAccounts.map(id=>esc(accountName(id))).join('、')}。系统无法自动发现未声明的来源。</p>`:''}</article>`;
}
function bindImportWorkflow() { if(!active())return;
 if(!importQueue)return;
 $('#import-file').onchange=e=>{const files=e.target.files,job=addImportFiles(files);e.target.value='';return job;};
 const zone=$('#import-drop-zone');zone.ondragover=e=>{e.preventDefault();};zone.ondrop=e=>{e.preventDefault();if(!importBusy&&!blocked&&!stale)addImportFiles(e.dataTransfer?.files);};
 zone.onclick=e=>{const button=e.target.closest('button');if(button?.dataset.intakeOpen)selectImportQueueFile(button.dataset.intakeOpen);if(button?.dataset.intakeRemove)removeImportQueueFile(button.dataset.intakeRemove);};
 $('#reset-import').onclick=()=>{const current=activeImportItem();if(current)removeImportQueueFile(current.id);else{cancelImportRead();importDraft=freshImportDraft();render();}};
 $('#import-encoding').onchange=async e=>{if(!active())return;const item=activeImportItem();if(!item)return;rememberImportForm();importQueue.cancel(item.id);item.draft.encoding=e.target.value;item.draft.preambleConfirmed=false;item.draft.recordOffset=0;item.draft.statusCompletedConfirmed=false;item.draft.coverageConfirmed=false;item.draft.text='';item.draft.bytes=null;item.draft.parsed=null;item.draft.inspection=null;item.draft.preview=null;item.draft.previewState=null;item.draft.selected=new Set();await readQueuedImportFile(item);};
 $('#import-coverage-month').onchange=e=>{try{W.monthRange(e.target.value);importCoverageMonth=e.target.value;importCoverageOffset=0;render();}catch(err){toast(err.message);}};
 let total=0;try{total=W.coverageCalendar(state,importCoverageMonth).sources.length;}catch(_){return;}if(total>8){$('#import-coverage-prev').onclick=()=>{importCoverageOffset=Math.max(0,importCoverageOffset-8);render();};$('#import-coverage-next').onclick=()=>{importCoverageOffset+=8;render();};}
}

function supportedImportEncoding(encoding) {try{new TextDecoder(encoding,{fatal:true});return true;}catch(_){return false;}}
function decodeImportBytes(bytes,encoding) {
 if(!supportedImportEncoding(encoding))throw Error('当前浏览器不支持所选编码，请将文件另存为 UTF-8 后重试。');
 try{return new TextDecoder(encoding,{fatal:true,ignoreBOM:true}).decode(bytes);}catch(_){throw Error('文件不是有效的 '+encoding.toUpperCase()+' 文本，未进行替换字符或自动猜测。请明确选择正确编码后重试。');}
}
function currentImportHeaders() {return importDraft.config.header===false?Array.from({length:importDraft.parsed?.rows?.[0]?.fields.length||0},(_,i)=>'第'+(i+1)+'列'):(importDraft.parsed?.headers||[]);}
function importColumnOptions(value,optional=false) {
 const headers=importDraft.parsed?.headers||[];
 const width=headers.length||importDraft.parsed?.rows?.[0]?.fields.length||0;
 return `<option value="">${optional?'不映射':'请选择列'}</option>`+Array.from({length:width},(_,i)=>`<option value="${i}" ${String(value)===String(i)?'selected':''}>第 ${i+1} 列${headers[i]?' · '+esc(headers[i]):''}</option>`).join('');
}
function guessImportColumns(headers) {
 const aliases={date:['date','日期','交易日期','交易时间','时间'],amount:['amount','金额','交易金额','金额(元)','金额（元）'],direction:['direction','type','收支','收/支','收支类型','类型'],note:['note','备注','商品','商品说明','交易说明','摘要'],stableId:['id','流水号','交易号','交易单号','订单号'],status:['status','状态','交易状态'],channel:['channel','支付方式','渠道']};
 const columns={};for(const [key,words] of Object.entries(aliases)){const at=headers.findIndex(h=>words.includes(String(h).trim().toLowerCase()));if(at>=0)columns[key]=at;}return columns;
}
function inspectImportText(resetMapping=true) {
 importDraft.inspection=I.inspectCSV(importDraft.text);
 importDraft.parsed=I.parseCSV(importDraft.text,{delimiter:importDraft.config.delimiter,header:importDraft.config.header,startLine:importDraft.config.startLine});
 if(resetMapping)importDraft.config.columns=guessImportColumns(importDraft.parsed.headers||[]);
 importDraft.preview=null;importDraft.selected=new Set();importDraft.offset=0;
 importDraft.headerMismatch=!!importDraft.config.expectedHeaders&&JSON.stringify(importDraft.config.expectedHeaders)!==JSON.stringify(currentImportHeaders());
}
async function readImportFile(file,encoding=importDraft.encoding) { if(!active())return;
 const epoch=runtime.lifecycle.epoch(),token=++importReadToken;importDraft.preambleConfirmed=false;importDraft.recordOffset=0;importDraft.statusCompletedConfirmed=false;importDraft.coverageConfirmed=false;importDraft.preview=null;importDraft.selected=new Set();importDraft.text='';importDraft.bytes=null;importDraft.inspection=null;importDraft.parsed=null;importDraft.error='';importDraft.fileName=file?.name||'';importDraft.encoding=encoding;
 if(!file){importDraft.reading=false;render();return;}
 importDraft.reading=true;render();
 try{
  if(!/\.(csv|tsv)$/i.test(file.name||''))throw Error('请选择 .csv 或 .tsv 文件。Excel 工作簿请先另存为 CSV。');
  if(file.size>8*1024*1024)throw Error('文件超过 8 MB。请从原始数据分段导出后重试。');
  const bytes=await file.arrayBuffer();
  if(!currentEpoch(epoch)||token!==importReadToken||page!=='import')return;
  importDraft.bytes=bytes;importDraft.text=decodeImportBytes(bytes,encoding);importDraft.inspection=I.inspectCSV(importDraft.text);
  importDraft.config.delimiter=file.name.toLowerCase().endsWith('.tsv')?'\t':importDraft.inspection.suggestedDelimiter||',';
  inspectImportText(true);importDraft.reading=false;render();
 }catch(e){if(currentEpoch(epoch)&&token===importReadToken&&page==='import'){importDraft.reading=false;importDraft.error=e.message;render();}}
}
function importPage() {
 if(!I)return '<div class="notice warning" role="alert">账单导入模块未加载，请刷新页面后重试。</div>';
 const d=importDraft,templates=state.imports?.templates||[],batches=state.imports?.batches||[];
 importHistoryOffset=Math.min(importHistoryOffset,Math.max(0,Math.ceil(batches.length/30)-1)*30);
 return `<div class="notice">${icon('shield')}<span>文件只在当前浏览器解析，不上传。支持你自行映射的 CSV / TSV；不承诺微信、支付宝或银行的官方格式兼容。原始文件不保存进账本，导入后仅保留必要的映射字段、来源和核对记录。</span></div>
 ${importQueueMarkup()}<article class="card section-space"><div class="card-head"><div><h2 id="import-active-heading" tabindex="-1">1. 选择并检查文件</h2><p>最多 8 MB / 10,000 条数据行 · 人民币收支</p></div><div class="actions"><button class="text-link" id="download-import-sample">下载合成 CSV 样例</button><button class="text-link" id="reset-import" ${importBusy?'disabled':''}>清除当前文件</button></div></div><div class="form-grid"><label class="field">本地账单文件<input id="import-file" type="file" ${W?'multiple':''} accept=".csv,.tsv,text/csv,text/tab-separated-values" ${blocked||stale||importBusy?'disabled':''}></label><label class="field">文本编码<select id="import-encoding">${[['utf-8','UTF-8（严格校验）'],['gb18030','GB18030（手动选择）'],['utf-16le','UTF-16 LE（手动选择）'],['utf-16be','UTF-16 BE（手动选择）']].filter(([v])=>v==='utf-8'||supportedImportEncoding(v)).map(([v,t])=>`<option value="${v}" ${selected(d.encoding,v)}>${t}</option>`).join('')}</select></label></div><p class="form-hint">默认只接受有效 UTF-8；不会悄悄用乱码替换。若原文件是其他编码，请明确选择后重新读取。</p>${d.reading?'<p role="status" class="body-copy">正在本地读取文件…</p>':''}${d.fileName?`<p class="import-filename">${esc(d.fileName)}${d.bytes?' · '+Math.ceil(d.bytes.byteLength/1024)+' KB':''}</p>`:''}${d.error?`<p class="form-error" role="alert">${esc(d.error)}</p>`:''}${d.parsed?importInspection():''}</article>
 ${d.text?`<article class="card section-space"><div class="card-head"><div><h2>2. 确认来源与列映射</h2><p>数据来源与记入账户是两个独立设置</p></div></div>${templates.length?`<div class="import-template-tools"><label class="field">已保存的映射模板<select id="import-template"><option value="">选择模板</option>${templates.map(t=>`<option value="${esc(t.id)}" ${selected(d.templateId,t.id)}>${esc(t.name||t.sourceKey)} · ${esc(accountName(t.accountId))} · v${t.version}</option>`).join('')}</select></label><button class="btn" id="load-import-template">载入模板</button></div>`:''}${d.headerMismatch?'<div class="notice warning" role="alert"><span>当前文件表头与模板不同。预览已阻止；请逐列核对新表头和映射，再明确确认。<button class="text-link" id="accept-import-headers">我已核对，使用当前表头</button></span></div>':''}${importConfigForm()}</article>`:''}
 <div id="import-preview-region">${d.preview?importPreviewMarkup():''}</div>
 ${importCoverageMarkup()}
 <article class="card section-space"><div class="card-head"><div><h2>导入历史与待核对记录</h2><p>保留每批来源、确认范围和回滚结果；本地修改冲突不会被强制覆盖</p></div><span class="tiny-label">${batches.length} 个批次</span></div>${batches.length?batches.slice().reverse().slice(importHistoryOffset,importHistoryOffset+30).map(b=>`<div class="import-history-row"><button class="import-history-open" data-import-batch="${esc(b.id)}"><strong>${esc(b.sourceKey)}</strong><small>${esc(b.createdAt)} · ${esc(accountName(b.accountId))}</small><span>${b.selectedRowKeys?.length||0} 条已选 · ${b.quarantineIds?.length||0} 条核对记录${b.rolledBack?' · 已回滚':''}</span></button>${!b.rolledBack?`<button class="btn" data-import-rollback="${esc(b.id)}">安全回滚</button>`:''}</div>`).join(''):'<div class="empty compact">还没有导入批次。先选择文件，核对后再提交。</div>'}${batches.length>30?`<div class="exclusion-pager"><button class="btn" id="import-history-prev" ${importHistoryOffset===0?'disabled':''}>较新批次</button><span>${importHistoryOffset+1}–${Math.min(importHistoryOffset+30,batches.length)} / ${batches.length}</span><button class="btn" id="import-history-next" ${importHistoryOffset+30>=batches.length?'disabled':''}>较早批次</button></div>`:''}</article>`;
}
function importInspection() {
 const d=importDraft,p=d.parsed,i=d.inspection||{},headers=p.headers||[],rows=p.rows||[],lineInfo=i.newline||i.newlines||'已检查';
 return `<div class="import-inspection"><div><strong>${rows.length}</strong><span>解析数据行</span></div><div><strong>${headers.length||rows[0]?.fields.length||0}</strong><span>列</span></div><div><strong>${Array.isArray(p.blankLines)?p.blankLines.length:p.blankLines||0}</strong><span>跳过空白行</span></div><div><strong>${i.bom?'有':'无'}</strong><span>文本 BOM</span></div></div><p class="form-hint">按用户所选 ${esc(d.encoding.toUpperCase())} 解码成功 · 换行 ${esc(typeof lineInfo==='string'?lineInfo:JSON.stringify(lineInfo))}。文件范围不代表账单已完整覆盖，请另行确认。${i.errors?.some(e=>e.delimiter===d.config.delimiter)?'检查提示：'+esc(i.errors.filter(e=>e.delimiter===d.config.delimiter).map(e=>e.message||e).join('；')):i.ambiguous?'分隔符存在多个候选，请手动确认。':''}</p>`;
}
// Only the active file's ephemeral draft owns this review. Contents never enter config/state.
function importRecordReview() {
 const d=importDraft,p=d.parsed;if(!p)return '<p class="form-hint full">起始行无效时请清空起始行，再查看完整文件记录。</p>';
 const records=p.records||[],size=10;d.recordOffset=Math.min(d.recordOffset,Math.max(0,Math.ceil(records.length/size)-1)*size);
 const start=p.headerLine||p.rows[0]?.line,skipped=p.skippedPhysicalLines||0;
 return `<div class="full import-record-review" id="import-record-review"><p class="form-hint">当前${d.config.header===false?'首条数据':'表头'}：物理第 ${start||'—'} 行。${skipped?`将跳过前 ${skipped} 个物理行，其中 ${p.skippedRecords.length} 条非空 CSV 记录。`:'未选择跳过前置记录。'}后续非空记录均进入逐笔预览，错误记录保留待核对。</p><details open><summary>查看全部 ${records.length} 条 CSV 记录并选择起点（每页 ${size} 条）</summary>${records.slice(d.recordOffset,d.recordOffset+size).map(record=>`<div class="import-quarantine-row"><strong>物理第 ${record.line} 行${record.line===start?' · 当前起点':record.line<start?' · 前置记录':''}</strong><details><summary>${esc(record.fields.join(' | ').slice(0,160))}${record.fields.join(' | ').length>160?'…':''}（展开全部字段）</summary>${record.fields.map((field,index)=>`<p class="body-copy" style="white-space:pre-wrap;overflow-wrap:anywhere">第 ${index+1} 列：${esc(field)}</p>`).join('')}</details><button class="text-link" type="button" data-import-start-line="${record.line}">从此记录作为${d.config.header===false?'数据':'表头'}开始</button></div>`).join('')}<div class="exclusion-pager"><button class="btn" type="button" id="import-record-prev" ${d.recordOffset===0?'disabled':''}>上一页记录</button><span>${records.length?d.recordOffset+1:0}–${Math.min(d.recordOffset+size,records.length)} / ${records.length}</span><button class="btn" type="button" id="import-record-next" ${d.recordOffset+size>=records.length?'disabled':''}>下一页记录</button></div></details>${skipped?`<label class="confirm-check"><input name="preambleConfirmed" type="checkbox" ${d.preambleConfirmed?'checked':''}>我已核对前 ${skipped} 个物理行（${p.skippedRecords.length} 条非空记录），确认不导入，也不保存这些前置内容</label>`:''}</div>`;
}
function bindImportRecordReview(form) {
 const region=$('#import-record-review');if(!importDraft.parsed||!region)return;
 const redraw=()=>{captureImportConfig(form);render();};
 $('#import-record-prev').onclick=()=>{importDraft.recordOffset=Math.max(0,importDraft.recordOffset-10);redraw();};
 $('#import-record-next').onclick=()=>{importDraft.recordOffset+=10;redraw();};
 region.onclick=event=>{const button=event.target.closest('[data-import-start-line]');if(!button)return;captureImportConfig(form);importDraft.config.startLine=Number(button.dataset.importStartLine);importDraft.preambleConfirmed=false;invalidateImportPreview();try{inspectImportText(true);importDraft.error='';}catch(error){importDraft.parsed=null;importDraft.error=error.message;}render();};
}
function importMapText(map) {return Object.entries(map||{}).map(([from,to])=>`${from} = ${to}`).join('\n');}
function importConfigForm() {
 const d=importDraft,c=d.config,col=c.columns||{},dates=['YYYY-MM-DD','YYYY/MM/DD','DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD HH:mm:ss','YYYY/MM/DD HH:mm:ss'];
 return `<form id="import-config-form"><div class="form-grid"><label class="field">稳定来源标识<input name="sourceKey" maxlength="80" value="${esc(c.sourceKey)}" placeholder="例如：my-bank-card-2024" required></label><label class="field">记入账户<select name="accountId" required><option value="" ${c.accountId?'':'selected'}>请选择资金账户</option>${options(state.accounts,c.accountId)}</select></label><p class="form-hint full">同一份来源的后续账单请继续使用同一标识；不要把文件名或月份当作来源。来源不同也可能是同一笔支付，候选重复需要逐笔核对。</p><label class="field">分隔符<select name="delimiter"><option value="," ${selected(c.delimiter,',')}>逗号 ,</option><option value="tab" ${selected(c.delimiter,'\t')}>制表符 Tab</option><option value=";" ${selected(c.delimiter,';')}>分号 ;</option><option value="|" ${selected(c.delimiter,'|')}>竖线 |</option></select></label><label class="field">起始记录格式<select name="header"><option value="true" ${c.header!==false?'selected':''}>起始记录是表头</option><option value="false" ${c.header===false?'selected':''}>没有表头，起始记录也是数据</option></select></label><label class="field">${c.header===false?'首条数据':'表头'}起始物理行<input name="startLine" type="number" min="1" max="${I.LIMITS.bytes}" step="1" value="${esc(c.startLine===undefined?'':String(c.startLine))}" placeholder="留空：首个非空 CSV 记录"></label><p class="form-hint full">物理行从 1 计数。留空沿用首个非空 CSV 记录；引号内换行不能作为起点。仅按你的选择跳过前置说明，不自动识别任何品牌格式。含前置说明在内，最多 10,000 条非表头记录。</p>${importRecordReview()}${[['date','交易日期',false],['amount','金额（人民币元）',false],['direction','收支方向',true],['note','备注',true],['stableId','原始交易唯一编号',true],['status','交易状态',true],['channel','支付渠道',true]].map(([key,title,optional])=>`<label class="field">${title}<select name="column-${key}" ${optional?'':'required'}>${importColumnOptions(col[key],optional)}</select></label>`).join('')}<label class="field">日期格式<select name="dateFormat">${dates.map(v=>`<option ${selected(c.dateFormat,v)}>${v}</option>`).join('')}</select></label><label class="field">金额方式<select name="amountMode"><option value="absolute" ${selected(c.amountMode,'absolute')}>正金额 + 方向列 / 默认类型</option><option value="signed" ${selected(c.amountMode,'signed')}>带正负号（负为支出，正为收入）</option></select></label><label class="field">无方向列时的默认类型<select name="defaultType"><option value="expense" ${selected(c.defaultType,'expense')}>支出</option><option value="income" ${selected(c.defaultType,'income')}>收入</option></select></label><label class="field">默认支出分类<select name="expenseCategory">${options(state.categories.filter(c=>c.type==='expense'),c.categoryIds?.expense)}</select></label><label class="field">默认收入分类<select name="incomeCategory">${options(state.categories.filter(c=>c.type==='income'),c.categoryIds?.income)}</select></label><label class="field">自定义方向映射（可选）<textarea name="directionText" rows="3" maxlength="4000" placeholder="支出 = expense&#10;收入 = income">${esc(d.directionText)}</textarea></label><label class="field">自定义状态映射（可选）<textarea name="statusText" rows="3" maxlength="4000" placeholder="支付成功 = completed&#10;已关闭 = cancelled">${esc(d.statusText)}</textarea></label><p class="form-hint full">每行「原始值 = 目标值」。方向：expense / income / transfer；状态：completed / pending / cancelled。空白使用内置常见词；未知值保留待核对。转账提示不会自动生成或合并交易，需核实两端账户后手工记账。</p><label class="confirm-check full"><input name="statusCompletedConfirmed" type="checkbox" ${d.statusCompletedConfirmed?'checked':''}>如果未映射状态列，我确认文件中的记录均已完成</label></div><details class="import-coverage"><summary>确认来源覆盖日期（可选）</summary><p class="form-hint">只有你核实原始导出范围确实完整时才勾选。这里只记录该来源、该账户的确认范围，不自动把整本账或沙盘月份视为完整。</p><div class="form-grid"><label class="field">开始日期<input name="coverageStart" type="date" value="${esc(d.coverageStart)}"></label><label class="field">结束日期<input name="coverageEnd" type="date" value="${esc(d.coverageEnd)}"></label></div><label class="confirm-check"><input name="coverageConfirmed" type="checkbox" ${d.coverageConfirmed?'checked':''}>我确认这个来源在上述日期范围内已完整导出，并会核对未入账的行</label></details><p id="import-config-error" class="form-error" role="alert" hidden></p><div class="import-form-actions"><button class="btn" type="button" id="save-import-template">${d.templateId?'保存新版映射模板':'保存映射模板'}</button><button class="btn primary" type="submit" ${blocked||stale?'disabled':''}>生成逐笔预览 ${icon('arrow')}</button></div></form>`;
}
function parseImportMap(text,allowed,label) {
 const map=Object.create(null);for(const line of text.split(/\r?\n/)){if(!line.trim())continue;const at=line.lastIndexOf('=');if(at<1)throw Error(label+'每行需使用「原始值 = 目标值」格式');const from=line.slice(0,at).trim(),to=line.slice(at+1).trim();if(!from||!allowed.includes(to))throw Error(label+'目标值无效：'+to);if(Object.hasOwn(map,from))throw Error(label+'包含重复原始值：'+from);map[from]=to;}return map;
}
function captureImportConfig(form=$('#import-config-form')) {
 if(!form)return;const e=form.elements,c=importDraft.config;
 if(e.startLine){if(e.startLine.value==='')delete c.startLine;else c.startLine=Number(e.startLine.value);}
 if(e.preambleConfirmed)importDraft.preambleConfirmed=e.preambleConfirmed.checked;
 c.sourceKey=e.sourceKey.value.trim();c.accountId=e.accountId.value;c.delimiter=e.delimiter.value==='tab'?'\t':e.delimiter.value;c.header=e.header.value==='true';c.dateFormat=e.dateFormat.value;c.amountMode=e.amountMode.value;c.defaultType=e.defaultType.value;c.categoryIds={expense:e.expenseCategory.value,income:e.incomeCategory.value};c.columns={};
 for(const key of ['date','amount','direction','note','stableId','status','channel']){const value=e['column-'+key].value;if(value!=='')c.columns[key]=Number(value);}
 importDraft.directionText=e.directionText.value;importDraft.statusText=e.statusText.value;importDraft.statusCompletedConfirmed=e.statusCompletedConfirmed.checked;importDraft.coverageStart=e.coverageStart.value;importDraft.coverageEnd=e.coverageEnd.value;importDraft.coverageConfirmed=e.coverageConfirmed.checked;
}
function effectiveImportConfig() {
 const d=importDraft,c=JSON.parse(JSON.stringify(d.config));
 c.directionMap=parseImportMap(d.directionText,['expense','income','transfer'],'方向映射');c.statusMap=parseImportMap(d.statusText,['completed','pending','cancelled'],'状态映射');
 if(!Object.keys(c.directionMap).length)delete c.directionMap;if(!Object.keys(c.statusMap).length)delete c.statusMap;
 if(d.coverageConfirmed){if(!d.coverageStart||!d.coverageEnd)throw Error('确认覆盖前请填写开始和结束日期');c.coverage={start:d.coverageStart,end:d.coverageEnd,confirmed:true};}else delete c.coverage;
 if(c.columns.status===undefined&&!d.statusCompletedConfirmed)throw Error('未映射状态列，请先确认这些记录均已完成，或映射状态列');
 if(!d.parsed)throw Error('请先选择有效的 CSV 起始行和分隔符');
 if(d.parsed.delimiter!==c.delimiter||(c.startLine??d.parsed.records?.[0]?.line)!==(c.header===false?d.parsed.rows[0]?.line:d.parsed.headerLine))throw Error('起始行或分隔符已更改，请先完成文件检查');
 if(d.parsed.skippedPhysicalLines){if(!d.preambleConfirmed)throw Error('请核对并确认跳过前置说明行');c.preambleConfirmed=true;}
 if(d.headerMismatch)throw Error('模板表头不同，请逐列核对并确认当前表头后再预览');
 return c;
}
function invalidateImportPreview() {if(activeImportItem()&&activeImportItem().status!=='committed')activeImportItem().status='ready';importDraft.preview=null;importDraft.previewState=null;importDraft.selected=new Set();importDraft.offset=0;const region=$('#import-preview-region');if(region)region.innerHTML='<p class="history-note" role="status">映射已更改，请重新生成预览。</p>';}
function importConfigError(message) {const el=$('#import-config-error');if(el){el.textContent=sessionText(message);el.hidden=false;}else toast(message);}
function bindImportPage() { if(!active())return;
 if(!I)return;$('#import-file').onchange=e=>readImportFile(e.target.files[0]);
 $('#import-encoding').onchange=e=>{const encoding=e.target.value;importDraft.encoding=encoding;importDraft.preambleConfirmed=false;importDraft.recordOffset=0;importDraft.statusCompletedConfirmed=false;importDraft.coverageConfirmed=false;if(importDraft.reading){cancelImportRead();importDraft.error='编码已更改，先前读取已取消。请重新选择文件。';render();return;}if(!importDraft.bytes)return;cancelImportRead();try{importDraft.text=decodeImportBytes(importDraft.bytes,encoding);importDraft.error='';inspectImportText(true);}catch(e){importDraft.text='';importDraft.parsed=null;importDraft.preview=null;importDraft.error=e.message;}render();};
 $('#download-import-sample').onclick=downloadImportSample;
 $('#reset-import').onclick=()=>{cancelImportRead();importDraft=freshImportDraft();render();};
 if(importDraft.text){const f=$('#import-config-form');f.oninput=e=>{captureImportConfig(f);if(['delimiter','header','startLine'].includes(e?.target?.name)){importDraft.preambleConfirmed=false;if(f.elements.preambleConfirmed)f.elements.preambleConfirmed.checked=false;}invalidateImportPreview();};f.onchange=e=>{const structural=['delimiter','header','startLine'].includes(e.target.name);captureImportConfig(f);invalidateImportPreview();if(structural){importDraft.preambleConfirmed=false;importDraft.recordOffset=0;try{inspectImportText(true);importDraft.error='';}catch(err){importDraft.parsed=null;importDraft.error=err.message;}render();}};
  bindImportRecordReview(f);
  f.onsubmit=e=>{e.preventDefault();try{captureImportConfig(f);makeImportPreview();}catch(err){importConfigError(err.message);}};
  $('#save-import-template').onclick=()=>{try{captureImportConfig(f);saveImportTemplate();}catch(err){importConfigError(err.message);}};
  if(state.imports?.templates?.length)$('#load-import-template').onclick=()=>loadImportTemplate($('#import-template').value);
  if(importDraft.headerMismatch)$('#accept-import-headers').onclick=()=>{captureImportConfig(f);importDraft.config.expectedHeaders=currentImportHeaders().slice();importDraft.headerMismatch=false;invalidateImportPreview();render();};
 }
 if(importDraft.preview)bindImportPreview();
 if((state.imports?.batches.length||0)>30){$('#import-history-prev').onclick=()=>{importHistoryOffset=Math.max(0,importHistoryOffset-30);render();};$('#import-history-next').onclick=()=>{importHistoryOffset+=30;render();};}
}
function loadImportTemplate(id) {
 const template=state.imports?.templates.find(t=>t.id===id);if(!template)return toast('请先选择一个模板');
 const config=JSON.parse(JSON.stringify(template.config));config.sourceKey=template.sourceKey;config.accountId=template.accountId;config.expectedHeaders=template.headers.slice();delete config.coverage;
 importDraft.config=config;importDraft.preambleConfirmed=false;importDraft.recordOffset=0;importDraft.templateId=template.id;importDraft.directionText=importMapText(config.directionMap);importDraft.statusText=importMapText(config.statusMap);importDraft.statusCompletedConfirmed=false;importDraft.coverageConfirmed=false;importDraft.coverageStart='';importDraft.coverageEnd='';
 try{inspectImportText(false);importDraft.error='';}catch(e){importDraft.error=e.message;importDraft.parsed=null;}
 render();
}
function saveImportTemplate() {
 if(importBusy)return;const config=effectiveImportConfig();const next=I.saveTemplate(state,{id:importDraft.templateId||undefined,headers:currentImportHeaders(),config});persist(next);const template=state.imports.templates.filter(t=>t.sourceKey===config.sourceKey&&t.accountId===config.accountId).sort((a,b)=>b.version-a.version)[0];importDraft.templateId=template?.id||'';invalidateImportPreview();render();toast('映射模板已保存。尚未导入交易。');
}
function makeImportPreview() {
 const config=effectiveImportConfig(),preview=I.preview(state,importDraft.text,config);importDraft.preview=preview;importDraft.previewState=state;importDraft.error='';importDraft.selected=new Set();importDraft.offset=0;if(activeImportItem())activeImportItem().status='review';render();$('#import-preview-heading')?.focus();
}
function selectedImportImpact() {
 const totals={incomeCents:0n,expenseCents:0n};
 for(const row of importDraft.preview.rows){if(!importDraft.selected.has(row.key))continue;const before=row.previousEvidence?.expectedLocation==='active'?row.previousEvidence.expectedTransaction:null;if(before)totals[before.type+'Cents']-=BigInt(before.amountCents);if(row.status==='completed'&&row.transaction)totals[row.transaction.type+'Cents']+=BigInt(row.transaction.amountCents);}
 const net=totals.incomeCents-totals.expenseCents,limit=BigInt(Number.MAX_SAFE_INTEGER);
 if([...Object.values(totals),net].some(n=>n>limit||n< -limit))return '已选金额超出安全统计范围，提交时将再次校验。';
 return `已选行的账本变化：收入 ${money(Number(totals.incomeCents))} · 支出 ${money(Number(totals.expenseCents))} · 结余 ${money(Number(net))}`;
}
function importSelectable(row) {return ['new','update','status','candidate'].includes(row.action);}
function importPreviewMarkup() {
 const d=importDraft,p=d.preview,rows=p.rows.slice(d.offset,d.offset+IMPORT_PAGE_SIZE),totals=p.totals||{},selectedRows=p.rows.filter(r=>d.selected.has(r.key));
 return `<article class="card section-space import-preview"><div class="card-head"><div><h2 id="import-preview-heading" tabindex="-1">3. 逐笔核对后提交</h2><p>默认不勾选任何行；只提交你明确选中的记录</p></div><span class="tiny-label">${p.rows.length} 行</span></div>${p.selection?.skippedPhysicalLines?`<p class="notice warning">已确认跳过前 ${p.selection.skippedPhysicalLines} 个物理行（${p.selection.skippedRecordCount} 条非空记录）；这些前置内容不会保存。表头或数据的起始物理行设置随模板保存。</p>`:''}<div class="import-counts">${Object.entries(importLabels).map(([key,label])=>`<span class="import-count ${key}">${label} <strong>${totals[key==='transfer-candidate'?'transferCandidate':key]||0}</strong></span>`).join('')}</div><p class="body-copy">来源编号完全相同的重复行不可再导入；同日同金额等候选不能当作确定重复。候选行只有选择「独立交易」才会新增，否则保留待核对。来源修订和状态变更可能改变已入账金额；本地修改冲突需单独处理。</p><div class="import-preview-tools"><button class="btn" id="import-select-page">选择本页新增 / 修订 / 状态</button><button class="text-link" id="import-clear-selection">清除全部选择</button><span id="import-selection-count" aria-live="polite">已选择 ${d.selected.size} 条</span></div><p class="form-hint" id="import-selected-impact">${selectedImportImpact()}</p><div class="import-review-list">${rows.map(row=>importPreviewRow(row)).join('')||'<p class="empty compact">没有数据行。</p>'}</div><div class="exclusion-pager"><button class="btn" id="import-prev" ${d.offset===0?'disabled':''}>上一页</button><span>${p.rows.length?`${d.offset+1}–${Math.min(d.offset+IMPORT_PAGE_SIZE,p.rows.length)} / ${p.rows.length}`:'0 行'}</span><button class="btn" id="import-next" ${d.offset+IMPORT_PAGE_SIZE>=p.rows.length?'disabled':''}>下一页</button></div><div class="import-commit"><p class="form-hint">${synthetic?'提交一次性写入本次演练内存。':'提交一次性写入本地账本。'}未选中或错误的行会保留核对记录，不会默认为零或自动入账。原文件仍需自行保管。${p.config.coverage?'本批含你明确确认的来源覆盖日期。':''}</p><p id="import-commit-error" class="form-error" role="alert" hidden></p><div class="actions">${d.repairId?'':`<button class="btn" id="import-save-pending" ${importBusy||blocked||stale?'disabled':''}>仅保留待核对</button>`}<button class="btn primary" id="import-commit" ${!selectedRows.length||importBusy||blocked||stale?'disabled':''}>确认提交 ${selectedRows.length} 条</button></div></div></article>`;
}
function importPreviewRow(row) {
 const picked=importDraft.selected.has(row.key),t=row.transaction,m=row.mapped||{},label=importLabels[row.action]||row.action;
 const summary=t?`${t.date} · ${names[t.type]||t.type} ${money(t.amountCents)} · ${categoryName(t.categoryId)}`:`${m.date||'日期待核对'} · ${m.amount||'金额待核对'}`;
 return `<section class="import-review-row ${esc(row.action)}"><div class="import-row-head"><span class="tag">第 ${row.line} 行 · ${label}</span>${row.action==='candidate'?`<label class="import-pick"><input type="checkbox" data-import-select="${esc(row.key)}" ${picked?'checked':''}>确认是独立交易，新增</label>`:importSelectable(row)?`<label class="import-pick"><input type="checkbox" data-import-select="${esc(row.key)}" ${picked?'checked':''}>${row.action==='new'?'导入此行':'确认此项变更'}</label>`:'<span class="muted">不可直接导入</span>'}</div><strong>${esc(summary)}</strong><p>${esc(t?.note||m.note||'无备注')}</p>${row.status?`<p class="form-hint">来源状态：${esc(row.status)}${row.status!=='completed'?' · 不计入收支':''}</p>`:''}${row.previousEvidence?.normalized?`<p class="form-hint">原来源记录：${esc(row.previousEvidence.normalized.date)} · ${money(row.previousEvidence.normalized.amountCents)} · ${esc(row.previousEvidence.normalized.note||'无备注')} · ${esc(row.previousEvidence.status)}</p>`:''}<p class="import-explanation">${esc(row.explanation||'')}${row.errors?.length?' · '+esc(row.errors.map(e=>e.message||e).join('；')):''}</p>${row.candidateTransactionIds?.length?`<p class="form-hint">可能对应账内交易（共 ${row.candidateTransactionCount??row.candidateTransactionIds.length} 条，最多展示 20 条）：${row.candidateTransactionIds.map(id=>{const tx=state.transactions.find(t=>t.id===id);return tx?`${esc(tx.date)} · ${esc(tx.note||categoryName(tx.categoryId))} · ${money(tx.amountCents)}（${esc(accountName(tx.accountId))}）`:esc(id);}).join('；')}</p>`:''}${row.candidateRowKeys?.length?`<p class="form-hint">同文件此前有 ${row.candidateRowCount??row.candidateRowKeys.length} 条相似行，请逐笔核对。</p>`:''}</section>`;
}
function refreshImportPreview() {if(!active())return;$('#import-preview-region').innerHTML=importPreviewMarkup();bindImportPreview();fenceControls();}
function bindImportPreview() {
 const p=importDraft.preview;if(!p)return;
 $('#import-preview-region').onchange=e=>{const key=e.target.dataset.importSelect;if(!key)return;const row=p.rows.find(r=>r.key===key);if(!row||!importSelectable(row))return;if(e.target.checked)importDraft.selected.add(key);else importDraft.selected.delete(key);$('#import-selection-count').textContent=`已选择 ${importDraft.selected.size} 条`;$('#import-commit').textContent=`确认提交 ${importDraft.selected.size} 条`;$('#import-commit').disabled=!importDraft.selected.size||importBusy||!!blocked||stale;$('#import-selected-impact').textContent=selectedImportImpact();};
 $('#import-select-page').onclick=()=>{for(const r of p.rows.slice(importDraft.offset,importDraft.offset+IMPORT_PAGE_SIZE))if(['new','update','status'].includes(r.action))importDraft.selected.add(r.key);refreshImportPreview();};
 $('#import-clear-selection').onclick=()=>{importDraft.selected.clear();refreshImportPreview();};
 $('#import-prev').onclick=()=>{importDraft.offset=Math.max(0,importDraft.offset-IMPORT_PAGE_SIZE);refreshImportPreview();};$('#import-next').onclick=()=>{importDraft.offset+=IMPORT_PAGE_SIZE;refreshImportPreview();};
 $('#import-commit').onclick=()=>commitImportSelection(false);if(!importDraft.repairId)$('#import-save-pending').onclick=()=>commitImportSelection(true);
}
function commitImportSelection(pendingOnly=false) {
 if(!active())return false;
 if(importBusy||!importDraft.preview)return false;const preview=importDraft.preview,keys=pendingOnly?[]:[...importDraft.selected];if(pendingOnly&&importDraft.repairId)return false;if(!pendingOnly&&!keys.length)return false;
 importBusy=true;try{const item=activeImportItem(),next=I.commit(state,preview,keys),beforeBatchIds=new Set((state.imports?.batches||[]).map(b=>b.id));persist(next);if(item){const batch=state.imports.batches.find(b=>!beforeBatchIds.has(b.id));importQueue.markCommitted(item.id,batch?.id||null);}else importDraft=freshImportDraft();importBusy=false;render();toast(keys.length?`已提交 ${keys.length} 条确认记录，其余保留待核对。`:'已保留待核对记录，没有新增或修改交易。');return true;}catch(e){const el=$('#import-commit-error');if(el){el.textContent=e.message;el.hidden=false;}else error(e.message);return false;}finally{importBusy=false;}
}
function importProvenance(transactionId) {
 const evidence=(state.imports?.evidence||[]).filter(e=>e.transactionId===transactionId);if(!evidence.length)return '';
 return `<details class="import-provenance"><summary>导入来源与核对证据（${evidence.length}）</summary><p class="form-hint">编辑只修改账本。本地变动会与原始映射证据区分，后续来源修订或回滚遇到冲突时不会强制覆盖。</p>${evidence.map(e=>`<dl class="import-source-details"><div><dt>来源</dt><dd>${esc(e.sourceKey)}</dd></div><div><dt>来源账户</dt><dd>${esc(accountName(e.accountId))}</dd></div><div><dt>原始编号</dt><dd>${esc(e.stableId||'未提供')}</dd></div><div><dt>来源状态</dt><dd>${esc(e.status)}</dd></div>${['date','amount','direction','note','channel'].filter(k=>e.mapped?.[k]).map(k=>`<div><dt>${({date:'映射日期',amount:'映射金额',direction:'映射方向',note:'映射备注',channel:'映射渠道'})[k]}</dt><dd>${esc(e.mapped[k])}</dd></div>`).join('')}<div><dt>最近批次</dt><dd>${esc(e.lastBatchId)}</dd></div></dl>`).join('')}</details>`;
}
function showImportBatch(id) {
 const b=state.imports?.batches.find(b=>b.id===id);if(!b)return;const q=(state.imports.quarantine||[]).filter(q=>q.batchId===id),coverage=state.imports.coverage.filter(c=>c.batchId===id);let offset=0;
 modal('导入批次与核对记录',`<p><strong>${esc(b.sourceKey)}</strong> · ${esc(accountName(b.accountId))}<br>${esc(b.createdAt)}<br>${b.selectedRowKeys.length} 条确认变更 · ${q.length} 条核对记录${b.rolledBack?' · 已回滚':''}</p><p class="form-hint">只显示映射字段，不包含原文件完整行。修正后仍需预览确认；已解决的记录保留审计。${coverage.length?'已确认来源范围：'+coverage.map(c=>esc(c.start)+' 至 '+esc(c.end)).join('；'):'本批未确认来源完整覆盖范围。'}</p><div id="import-quarantine-list"></div><div class="exclusion-pager"><button class="btn" id="quarantine-prev">上一页</button><span id="quarantine-page"></span><button class="btn" id="quarantine-next">下一页</button></div>`,`${b.rolledBack?'':`<button class="btn" data-import-rollback="${esc(id)}">安全回滚本批</button>`}<button class="btn primary" data-close>关闭</button>`,()=>{
  const draw=()=>{$('#import-quarantine-list').innerHTML=q.slice(offset,offset+20).map(row=>`<div class="import-quarantine-row"><strong>第 ${row.line} 行${row.resolvedByBatchId?' · 已修正':''}</strong><p>${esc([row.mapped?.date,row.mapped?.amount,row.mapped?.note].filter(Boolean).join(' · '))}</p><p class="form-hint">${esc((row.errors||[]).map(e=>e.message||e).join('；'))}</p>${!row.resolvedByBatchId&&!b.rolledBack?`<button class="text-link" data-repair-quarantine="${esc(row.id)}">修正已映射字段并重新预览</button>`:''}</div>`).join('')||'<p class="empty compact">本批没有待核对记录。</p>';$('#quarantine-prev').disabled=offset===0;$('#quarantine-next').disabled=offset+20>=q.length;$('#quarantine-page').textContent=q.length?`${offset+1}–${Math.min(offset+20,q.length)} / ${q.length}`:'0 条';};draw();$('#quarantine-prev').onclick=()=>{offset=Math.max(0,offset-20);draw();};$('#quarantine-next').onclick=()=>{offset+=20;draw();};$('#import-quarantine-list').onclick=e=>{const button=e.target.closest('[data-repair-quarantine]');if(button)repairImportRow(button.dataset.repairQuarantine);};
 });
}
function repairImportRow(id) {
 const row=state.imports?.quarantine.find(q=>q.id===id);if(!row)return;
 modal('修正待核对行',`<form id="entry-form"><p>只可修正已映射字段。原核对记录会保留；修正后先预览，再确认入账。来源和账户沿用原批次。</p><div class="form-grid">${[['date','日期'],['amount','金额'],['direction','方向'],['note','备注'],['stableId','原始交易编号'],['status','状态'],['channel','渠道']].filter(([key])=>Object.hasOwn(row.mapped,key)).map(([key,label])=>`<label class="field">${label}<input name="${key}" maxlength="${key==='note'?500:200}" value="${esc(row.mapped?.[key]||'')}"></label>`).join('')}</div><div class="modal-bottom">${cancel}<button class="btn primary" type="submit">重新预览此行</button></div></form>`,'',()=>{const f=$('#entry-form');f.addEventListener('input',()=>f.dataset.dirty='true');f.onsubmit=e=>{e.preventDefault();try{const patch={};for(const k of ['date','amount','direction','note','stableId','status','channel'])if(Object.hasOwn(row.mapped,k))patch[k]=f.elements[k].value;const preview=I.previewRepair(state,id,patch);cancelImportRead();importDraft=freshImportDraft();importDraft.preview=preview;importDraft.repairId=id;closeModal(true);page='import';render();$('#import-preview-heading')?.focus();}catch(e){error(e.message);}};});
}
function confirmImportRollback(id) {
 const b=state.imports?.batches.find(b=>b.id===id);if(!b||b.rolledBack)return;
 modal('安全回滚这个导入批次？',`<p>${esc(b.sourceKey)} · ${esc(b.createdAt)}</p><p>仅撤销仍与导入后内容一致的交易及相关来源记录。后续人工编辑、删除或其他批次影响到的交易会报告冲突，不会强制覆盖。请先导出备份。</p>`,`${cancel}<button class="btn" id="export-before-import-rollback">导出当前备份</button><button class="btn danger" id="confirm-import-rollback">检查并回滚</button>`,()=>{
  $('#export-before-import-rollback').onclick=()=>download(L.backup(state),`moneygo-${today()}.json`);let submitted=false;
  $('#confirm-import-rollback').onclick=()=>{if(submitted)return;submitted=true;try{const result=I.rollback(state,id);if(result.rolledBack){persist(result.state);closeModal(true);render();toast('本批已安全回滚，历史记录仍保留。');}else{modal('回滚遇到冲突',`<p>此批未执行回滚，账本保持原样。请核对以下后续改动，或保留现有账目。</p><div class="import-conflicts">${result.conflicts.map(c=>`<p>${esc(c.transactionId||c.evidenceId||'来源记录')}：${esc(c.reason)}</p>`).join('')}</div>`,'<button class="btn primary" data-close>知道了</button>');}}catch(e){submitted=false;error(e.message);}};
 });
}
function downloadImportSample() { if(!active())return;
 const text='日期,金额,方向,备注,交易编号,状态\r\n2026-01-03,12.50,支出,合成样例咖啡,SYNTHETIC-001,已完成\r\n2026-01-04,100.00,收入,合成样例收入,SYNTHETIC-002,已完成\r\n2026-01-05,20.00,支出,合成样例待支付,SYNTHETIC-003,待支付\r\n';
 download('\ufeff'+text,'moneygo-SYNTHETIC-example.csv','text/csv;charset=utf-8',true);toast('已发起合成样例下载，请检查浏览器下载列表。未写入账本；若导入，仍需选择文件并逐笔确认。');
}
function backupCount(counts,key) { return Number.isSafeInteger(counts[key]) && counts[key]>=0 ? counts[key] : '未知（模块未提供）'; }
function verifyBackupFile() { if(!active())return;
 modal('验证备份，不替换账本',`<p>在独立副本中校验 JSON、账户余额与导入证据，并执行序列化往返检查。当前账本及恢复副本不变。</p><label class="field restore-file">选择 JSON 备份<input type="file" accept=".json,application/json" id="verify-backup-file"></label><div id="verify-backup-result"></div>`,cancel,()=>{const epoch=runtime.lifecycle.epoch(),token=modalToken;let reads=0;$('#verify-backup-file').onchange=async e=>{if(!currentEpoch(epoch))return;const read=++reads,file=e.target.files[0];$('#verify-backup-result').innerHTML='';$('#form-error').hidden=true;$('#form-error').textContent='';if(!file)return;try{if(file.size>32*1024*1024)throw Error('文件超过 32 MB');const text=await file.text();if(!currentEpoch(epoch)||token!==modalToken||read!==reads)return;const verified=backupSafety?backupSafety.verifySelectedBackup(text):{verification:L.verifyBackup(text),notePersistence:'unavailable'},result=verified.verification,counts=result.counts;refreshBackupStatus();$('#verify-backup-result').innerHTML=`<div class="restore-summary"><h3>备份验证通过</h3><p>${backupCount(counts,'accounts')} 个账户 · ${backupCount(counts,'categories')} 个分类<br>${backupCount(counts,'transactions')} 笔交易 · ${backupCount(counts,'trash')} 笔已删除交易<br>${backupCount(counts,'importBatches')} 个导入批次 · ${backupCount(counts,'evidence')} 条来源证据<br>${backupCount(counts,'links')} 组证据关系 · ${backupCount(counts,'refunds')} 笔退款分配 · ${backupCount(counts,'claims')} 笔应收 · ${backupCount(counts,'settlements')} 笔回款分配 · ${backupCount(counts,'snapshots')} 份余额快照 · ${backupCount(counts,'transferPairs')} 组本人转账配对 · ${backupCount(counts,'composites')} 组购买组合 · ${backupCount(counts,'refundPlans')} 份待退款计划<br>${backupCount(counts,'rules')} 条规则 · ${backupCount(counts,'aliases')} 条别名 · ${backupCount(counts,'organizerBatches')} 个整理批次 · ${backupCount(counts,'closes')} 份冻结月结 · ${backupCount(counts,'scopes')} 项来源范围<br>${backupCount(counts,'creditProfiles')} 个信用账户角色 · ${backupCount(counts,'creditStatements')} 份信用账单 · ${backupCount(counts,'installmentContracts')} 份分期合同 · ${backupCount(counts,'creditRepayments')} 笔还款分配 · ${backupCount(counts,'billedInstallments')} 项已入账分期 · ${backupCount(counts,'feeEvidence')} 条费用证据</p>${heldBackupReview(result)}${incomeBackupReview(result)}${spendingBackupReview(result)}<p>设备校验时间 ${esc(result.verifiedAt||'未知')}<br>当前账本未被替换；此结果只针对刚才选择的文件，当前账本的备份覆盖情况未评估。</p><p>${synthetic?(verified.notePersistence==='recorded'?'验证记录仅写入本次会话内存，刷新或重置即清空。':'文件验证通过；本次会话验证记录未确认保存。'):(verified.notePersistence==='recorded'?'已确认本地验证记录写入此浏览器，但不保证以后保留。':'文件验证通过；本地验证记录未确认保存。')}</p></div>`;}catch(e){if(currentEpoch(epoch)&&token===modalToken&&read===reads)error('验证失败：'+e.message);}};});
}

// Sandbox settings share the atomic ledger backup envelope, never ledger rows/balances.
function simulationSettings() { return S.validate(state.simulation || S.defaultSettings()); }
function saveSimulation(mutator, message='沙盘已保存，真实账目未改变',reset=false) {
 if(!active())return false;try {const next=(()=>{
  const settings=simulationSettings(),identities=(state.incomePlanning||state.spendingPlanning||state.version===8)?L.collectRetainedIdentities(state):null;
  const reserved=identities?new Set(identities.map(row=>row.id)):null,originalReserved=reserved?new Set(reserved):null;
  const priorOwners=new Set();for(const scenario of state.simulation?.scenarios||[]){priorOwners.add('scenario:'+scenario.id);for(const row of scenario.oneOffs)priorOwners.add('oneOff:'+row.id);}
  const generate=prefix=>simulationId(prefix,reserved);
  mutator(settings,generate);
  if(reserved){
   // The legacy empty/reset default is a new identity only if it is not the
   // same existing scenario. Resolve its fixed ID at this successful write,
   // never by changing a read-only default or by reusing a retained identity.
   for(const scenario of settings.scenarios)if(scenario.id==='scenario-main'&&!priorOwners.has('scenario:'+scenario.id)&&originalReserved.has(scenario.id)){
    const previous=scenario.id;scenario.id=generate('scenario');if(settings.activeId===previous)settings.activeId=scenario.id;
   }
   for(const scenario of settings.scenarios){
    if(!priorOwners.has('scenario:'+scenario.id)&&originalReserved.has(scenario.id))throw Error('新模拟方案标识与保留历史冲突，请重新核对。');
    for(const row of scenario.oneOffs)if(!priorOwners.has('oneOff:'+row.id)&&originalReserved.has(row.id))throw Error('新一次性计划标识与保留历史冲突，请重新核对。');
   }
  }
  S.calculate(state,settings,today());return {...state,simulation:settings};
 })();persist(next);closeModal(true);render();$('.heading h1')?.focus();toast(message);return true;}catch(e){error(reset&&errorData(e,'code')==='SAVE_BACKUP_CAPACITY'?'沙盘重置后的完整账本仍超过备份容量，重置未保存。请先到「数据备份」下载原始恢复数据，或恢复较小的有效备份。':failureMessage(e));return false;}
}
function activeScenario(settings=simulationSettings()) { return settings.scenarios.find(s=>s.id===settings.activeId); }
function simulationId(prefix,reserved) {
 if(reserved===undefined)reserved=(state.incomePlanning||state.spendingPlanning||state.version===8)?new Set(L.collectRetainedIdentities(state).map(row=>row.id)):null;
 for(let attempt=0;attempt<10;attempt++){
  const id=prefix+'-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10)+(attempt?'-'+attempt:'');
  if(!reserved||!reserved.has(id)){reserved?.add(id);return id;}
 }
 throw Error('无法生成不冲突的模拟记录标识，请重新核对。');
}
const scenarioAmount = value => value===null?'待补全':money(value);
function warningText(w) {
 const messages={NO_CONFIRMED_HISTORY:'尚未确认完整历史月份。基准未知；可以先手动填写各分类假设。未设置的分类不会被当作零。',SHORT_HISTORY:'完整历史不足 3 个月，均值容易受单月波动影响，请重点核对假设。',OLD_HISTORY:'最近确认的历史月份较早，可能已不能代表现在的消费习惯。',IGNORED_COMPLETE_MONTHS:'当前月、未来月或超出最近 6 个的确认月份未用于基准。',STALE_EXCLUSIONS:'部分排除标记对应的支出已不存在或类型已变更，当前不生效。',STALE_ADJUSTMENT:'部分分类假设的分类已删除或类型已变更，当前不生效。',STALE_ONE_OFF_CATEGORY:'部分一次性计划的分类已失效，当前不计入。',ONE_OFF_OUTSIDE_FORECAST:'部分一次性计划不在接下来三个月内，当前不计入。'};
 return w.code==='STALE_EXCLUSIONS'&&w.eventKeys?'部分排除标记对应的原交易或核销已撤销、删除或改变类型，当前不生效；标记保留，不会转给新事项。':messages[w.code]||'部分历史或方案设置未计入，请核对。';
}
function sandbox() {
 let result,settings;try{settings=simulationSettings();result=S.calculate(state,settings,today());}catch(e){return `<div class="notice warning" role="alert">${esc(e.message)}</div><button class="btn" data-action="reset-sandbox">重置沙盘设置</button><p class="history-note">重置只清除模拟方案、完整月份确认与排除标记，${synthetic?'演练账目':'真实账目'}保持不变。也可先导出备份。</p>`;}
 const active=result.scenarios.find(s=>s.id===result.activeId),raw=activeScenario(settings),warnings=[...result.warnings,...active.warnings];
 const uniqueWarnings=[...new Set(warnings.map(warningText))];
 return `<div class="notice simulation-notice">${icon('spark')}<span>这里是消费假设，不是保证发生的预测。未来三个月：${result.months.join('、')}。从下月开始，不估算本月剩余天数，也不推算账户余额。</span></div>
 <section class="sandbox-intro card section-space"><div><span class="tiny-label">不接 AI · 全部在本机计算</span><h2>先试一试，再做消费决定。</h2><p>从真实历史建立基准，调整每月支出，再放入旅行或换手机等计划。</p></div><button class="btn" data-action="history-months">${icon('check')}确认历史月份</button></section>
 ${scopeDisclosure(today().slice(0,7))}
 ${uniqueWarnings.length?`<div class="notice warning"><div>${uniqueWarnings.map(t=>`<p>${esc(t)}</p>`).join('')}</div></div>`:''}
 <section class="stats sandbox-stats"><article class="stat hero"><div class="stat-label">历史基准 · 三个月</div><div class="big-number">${scenarioAmount(result.baseline.totalCents)}</div><div class="stat-foot">${result.historyMonthCount?`最近 ${result.historyMonthCount} 个已确认完整月的分类均值`:'需要先确认完整历史月份'}</div></article><article class="stat"><div class="stat-label">${esc(active.name)} · 三个月</div><div class="big-number secondary">${scenarioAmount(active.totalCents)}</div><div class="stat-foot">${active.incomplete?`已设置部分：${money(active.knownTotalCents)}；其余未知`:'每月分类假设 + 一次性计划'}</div></article><article class="stat"><div class="stat-label">相对基准</div><div class="big-number secondary ${active.deltaCents!==null&&active.deltaCents<0?'income':''}">${active.deltaCents===null?'待补全':`${active.deltaCents>0?'+':''}${money(active.deltaCents)}`}</div><div class="stat-foot">${active.deltaCents===null?'基准与方案完整后才可比较':active.deltaCents<0?'按当前假设，三个月支出减少':active.deltaCents>0?'按当前假设，三个月支出增加':'按当前假设，三个月支出相同'}</div></article></section>
 <article class="card section-space"><div class="card-head"><div><h2>比较不同的打算</h2><p>最多保存 3 个方案，历史来源与排除标记共用</p></div><button class="btn" data-action="add-scenario" ${settings.scenarios.length>=3?'disabled':''}>${icon('plus')}新建方案</button></div><div class="scenario-choices">${result.scenarios.map(s=>`<button class="scenario-choice ${s.id===active.id?'selected':''}" data-scenario="${esc(s.id)}" aria-pressed="${s.id===active.id}"><span>${esc(s.name)}</span><strong>${scenarioAmount(s.totalCents)}</strong><small>${s.deltaCents===null?'假设尚不完整':`相对基准 ${s.deltaCents>0?'+':''}${money(s.deltaCents)}`}</small></button>`).join('')}</div><div class="scenario-toolbar"><span>正在编辑：${esc(active.name)}</span><button class="text-link" data-action="rename-scenario">改名</button><button class="text-link" data-action="reset-scenario">清空当前方案</button>${settings.scenarios.length>1?'<button class="text-link" data-action="delete-scenario">删除方案</button>':''}</div></article>
 <section class="sandbox-grid"><article class="card"><div class="card-head"><div><h2>每月分类假设</h2><p>点击分类，设金额、百分比或固定月支出</p></div></div><div class="scenario-column-head"><span>分类</span><span>历史月均 → 方案每月</span></div>${active.categories.map(c=>`<button class="budget-row" data-budget="${esc(c.categoryId)}"><span><strong>${esc(c.name)}</strong><small>${c.mode==='baseline'?'沿用基准':c.mode==='fixed'?'固定月支出 · 替换此分类':c.mode==='amount'?'手动月预算 · 替换此分类':`基准调整 ${c.value>0?'+':''}${c.value}%`}</small></span><span>${scenarioAmount(c.baselineCents)}<b>→ ${scenarioAmount(c.monthlyCents)}</b></span>${icon('chevron')}</button>`).join('')||'<p class="body-copy">请先在「账户分类」添加支出分类。</p>'}<p class="history-note">「固定」与「月预算」都替换该分类全部月支出，不叠加历史均值。房租等可单独建立分类。没有历史时，每个分类都需手动设值（允许明确填 0）。</p></article>
 <article class="card"><div class="card-head"><div><h2>一次性计划</h2><p>只在选定月份额外增加一次</p></div><button class="btn" data-action="add-oneoff" ${state.categories.some(c=>c.type==='expense')?'':'disabled'}>${icon('plus')}添加</button></div>${raw.oneOffs.length?raw.oneOffs.map(o=>`<div class="plan-row"><button class="plan-edit" data-oneoff="${esc(o.id)}"><strong>${esc(o.name)}</strong><small>${o.month} · ${esc(categoryName(o.categoryId)||'分类已失效')}${result.months.includes(o.month)?'':' · 不在当前模拟期'}</small><b>${money(o.amountCents)}</b></button><button class="iconbutton" data-remove-oneoff="${esc(o.id)}" aria-label="删除计划 ${esc(o.name)}">${icon('close')}</button></div>`).join(''):'<div class="empty compact">比如 12 月旅行，或下月更换手机。<br>没有计划时无需填写。</div>'}<p class="history-note">这里只添加月预算之外的额外支出。同一笔计划不要同时写进月预算和一次性计划；历史中的大额偶发支出可在下方从基准排除。</p></article></section>
 <article class="card section-space"><div class="card-head"><div><h2>接下来三个月</h2><p>每月金额都可以追溯到分类假设和计划</p></div></div><div class="forecast-months">${active.months.map(m=>`<section class="forecast-month"><h3>${m.month}</h3><strong>${scenarioAmount(m.totalCents)}</strong><dl><div><dt>历史基准</dt><dd>${scenarioAmount(result.baseline.monthlyCents)}</dd></div><div><dt>每月分类合计</dt><dd>${scenarioAmount(m.recurringCents)}</dd></div><div><dt>一次性计划</dt><dd>${money(m.oneOffCents)}</dd></div>${m.totalCents===null?`<div><dt>已设置部分</dt><dd>${money(m.knownTotalCents)}</dd></div>`:''}</dl></section>`).join('')}</div></article>
 <article class="card section-space"><div class="card-head"><div><h2>基准从哪里来</h2><p>计算日 ${result.today} · 金额以整数分计算，分类均值四舍五入到分</p></div><button class="text-link" data-action="history-months">修改完整月份</button></div><p class="body-copy">只使用你确认已完整记录、且已经结束的月份，最多取最近 6 个。每个分类的历史个人消费（扣除已关联退款、应收份额与排除项）÷ 采用月份数，得到每月基准；三个未来月使用同一基准。未确认的月份不会被当成零消费。确认完整后，该月没有记录的分类按 0 计。</p>${result.historyMonths.length?O.scopeSummaryFor(organizerContext(),result.historyMonths[0]+'-01',monthEnd(result.historyMonths.at(-1))):''}${result.historyMonths.length?`<div class="history-month-list">${result.baseline.months.map(m=>`<button class="history-month-chip" data-history-exclusions="${m.month}"><strong>${m.month}</strong><span>${money(m.totalCents)}</span><small>查看 / 排除偶发支出</small></button>`).join('')}</div>`:'<p class="body-copy">还没有可用的完整历史月。请确认实际记账覆盖范围，或先手动填写方案。</p>'}<p class="history-note">收入、转账、重复证据、已删除交易、本月及未来交易均不进入历史基准。跨月退款到账或应收调整会重算原购买月份的个人消费。已记入未来日期的交易不会自动变成计划，需自行核对，避免漏算或重复。排除项只影响沙盘，原账本仍完整保留。不识别年度季节性，不提供概率区间，也不估算未来收入。</p><p class="history-note">当前 ${settings.exclusions.length} 个历史排除标记；${settings.completeMonths.length} 个完整月确认。确认之后如补录或修改账目，基准会随之重算。</p><button class="text-link reset-sandbox" data-action="reset-sandbox">重置整个沙盘</button></article>`;
}
function historyMonths() {
 const settings=simulationSettings(),current=today().slice(0,7),monthSet=new Set([...settings.completeMonths,...state.transactions.filter(t=>t.date.slice(0,7)<current).map(t=>t.date.slice(0,7)),...finance().personalExpenseEvents.filter(e=>e.effectiveDate.slice(0,7)<current).map(e=>e.effectiveDate.slice(0,7))]);
 const y=Number(current.slice(0,4)),m=Number(current.slice(5,7));for(let i=1;i<=12;i++){const n=y*12+m-1-i;if(n>=12)monthSet.add(String(Math.floor(n/12)).padStart(4,'0')+'-'+String(n%12+1).padStart(2,'0'));}
 const recent=[...monthSet].filter(m=>m<current).sort().reverse().slice(0,120);
 const months=[...new Set([...recent,...settings.completeMonths.filter(m=>m<current)])].sort().reverse();
 const personalByMonth=expenseGroups(finance().personalExpenseEvents,event=>event.effectiveDate.slice(0,7)),noncashByMonth=new Map();for(const event of finance().personalExpenseEvents)if(event.key.kind==='held-recognition'){const key=event.effectiveDate.slice(0,7);noncashByMonth.set(key,(noncashByMonth.get(key)||0)+1);}
 modal('哪些月份已经记全？',`<form id="entry-form"><p>只勾选你确定已完整记录全部消费的月份。过去的月份不一定记全；没有记录也不代表没有消费。</p><p class="form-hint">确认没有支出的完整月份也可以勾选，基准会明确按 0 计算。只采用最近 6 个勾选月，当前月与未来月不参与。</p><div class="month-confirm-list">${months.map(m=>{const rows=state.transactions.filter(t=>t.type==='expense'&&t.date.slice(0,7)===m);return `<label><input type="checkbox" name="completeMonths" value="${m}" ${settings.completeMonths.includes(m)?'checked':''}><span><strong>${m}</strong><small>${rows.length} 笔支出 · ${money(personalByMonth.has(m)?personalByMonth.get(m):0)}${noncashByMonth.has(m)?' · '+noncashByMonth.get(m)+' 个非现金核销':rows.length?'':' · 确认后视为零支出月'}</small></span></label>`;}).join('')}</div><div class="modal-bottom">${cancel}<button class="btn primary" type="submit">保存完整月份确认</button></div></form>`,'',()=>{const f=$('#entry-form');f.addEventListener('change',()=>f.dataset.dirty='true');f.onsubmit=e=>{e.preventDefault();const months=new FormData(f).getAll('completeMonths');saveSimulation(s=>s.completeMonths=months,'已更新历史覆盖范围，真实账目未改变');};});
}
function editScenarioName(create=false) {
 const settings=simulationSettings(),active=activeScenario(settings);if(create&&settings.scenarios.length>=3)return;
 modal(create?'新建模拟方案':'方案改名',`<form id="entry-form"><label class="field">方案名称<input name="name" maxlength="80" value="${create?'':esc(active.name)}" placeholder="例如：减少外卖 / 计划旅行" required></label><p class="form-hint">新方案从历史基准开始，各方案的分类假设和一次性计划互相独立。</p><div class="modal-bottom">${cancel}<button class="btn primary" type="submit">保存方案</button></div></form>`,'',()=>{const f=$('#entry-form');f.addEventListener('input',()=>f.dataset.dirty='true');f.onsubmit=e=>{e.preventDefault();saveSimulation((s,generate)=>{if(create){const id=generate('scenario');s.scenarios.push({id,name:f.elements.name.value,adjustments:[],oneOffs:[]});s.activeId=id;}else activeScenario(s).name=f.elements.name.value;});};});
}
function editBudget(categoryId) {
 const settings=simulationSettings(),active=activeScenario(settings),adj=active.adjustments.find(a=>a.categoryId===categoryId),category=state.categories.find(c=>c.id===categoryId&&c.type==='expense');if(!category)return;
 modal('调整「'+category.name+'」每月支出',`<form id="entry-form"><div class="form-grid"><label class="field full">计算方式<select name="mode"><option value="baseline">沿用历史基准</option><option value="amount" ${selected(adj?.mode,'amount')}>手动月预算（替换）</option><option value="percent" ${selected(adj?.mode,'percent')}>百分比调整基准</option><option value="fixed" ${selected(adj?.mode,'fixed')}>固定每月支出（替换）</option></select></label><label class="field full" id="budget-value-field"><span id="budget-value-label">金额</span><input name="value" type="text" inputmode="decimal" maxlength="14" value="${adj?(adj.mode==='percent'?adj.value:amountText(adj.value)):''}"></label></div><p class="form-hint" id="budget-hint"></p><div class="modal-bottom">${cancel}<button class="btn primary" type="submit">保存分类假设</button></div></form>`,'',()=>{const f=$('#entry-form');const update=()=>{const mode=f.elements.mode.value;$('#budget-value-field').hidden=mode==='baseline';f.elements.value.required=mode!=='baseline';$('#budget-value-label').textContent=mode==='percent'?'调整百分比（整数 %）':'每月金额（人民币元，可为 0）';$('#budget-hint').textContent=mode==='percent'?'例如 -20 表示减少 20%，+20 表示增加 20%。只接受 -100 到 1000 的整数，没有历史基准时仍为未知。':mode==='baseline'?'取消这项手动假设，重新沿用历史分类月均；历史不足时保留未知。':'替换此分类全部月支出，连续使用三个月，不再叠加历史均值。一次性计划会额外增加，不要重复填写。';};update();f.elements.mode.onchange=()=>{f.elements.value.value='';update();};f.addEventListener('input',()=>f.dataset.dirty='true');f.addEventListener('change',()=>f.dataset.dirty='true');f.onsubmit=e=>{e.preventDefault();try{const mode=f.elements.mode.value,text=f.elements.value.value.trim();let value;if(mode==='percent'){if(!/^[+-]?\d{1,4}$/.test(text))throw Error('百分比须为 -100 到 1000 的整数');value=Number(text);}else if(mode!=='baseline')value=L.parseAmount(text,{allowZero:true});saveSimulation(s=>{const a=activeScenario(s);a.adjustments=a.adjustments.filter(a=>a.categoryId!==categoryId);if(mode!=='baseline')a.adjustments.push({categoryId,mode,value});});}catch(e){error(e.message);}};});
}
function editOneOff(id) {
 const settings=simulationSettings(),active=activeScenario(settings),item=active.oneOffs.find(o=>o.id===id),months=S.calculate(state,settings,today()).months;
 const selectMonths=[...new Set([...months,...(item?[item.month]:[])])].sort();
 modal(item?'编辑一次性计划':'添加一次性计划',`<form id="entry-form"><div class="form-grid"><label class="field full">计划名称<input name="name" maxlength="80" value="${esc(item?.name||'')}" placeholder="例如：去旅行" required></label><label class="field">发生月份<select name="month">${selectMonths.map(m=>`<option value="${m}" ${selected(item?.month,m)}>${m}${months.includes(m)?'':'（不在模拟期）'}</option>`).join('')}</select></label><label class="field">支出分类<select name="categoryId" required>${options(state.categories.filter(c=>c.type==='expense'),item?.categoryId)}</select></label><label class="field full">额外支出（人民币元）<input name="amount" type="text" inputmode="decimal" maxlength="14" value="${item?amountText(item.amountCents):''}" required></label></div><p class="form-hint">只在选定月份、在每月分类预算之外加一次。请确认这笔支出未包含在月预算中；历史类似偶发支出可从基准排除。</p><div class="modal-bottom">${cancel}<button class="btn primary" type="submit">保存计划</button></div></form>`,'',()=>{const f=$('#entry-form');f.addEventListener('input',()=>f.dataset.dirty='true');f.addEventListener('change',()=>f.dataset.dirty='true');f.onsubmit=e=>{e.preventDefault();try{const value={id:item?.id||null,name:f.elements.name.value,month:f.elements.month.value,categoryId:f.elements.categoryId.value,amountCents:L.parseAmount(f.elements.amount.value)};saveSimulation((s,generate)=>{if(!item)value.id=generate('plan');const a=activeScenario(s);if(item)a.oneOffs=a.oneOffs.map(o=>o.id===item.id?value:o);else a.oneOffs.push(value);});}catch(e){error(e.message);}};});
}
function exclusionsForMonth(month) {
 if(heldActive()||simulationSettings().version===2)return eventExclusionsForMonth(month);
 const settings=simulationSettings(),rows=state.transactions.filter(t=>t.type==='expense'&&t.date.slice(0,7)===month).sort((a,b)=>b.amountCents-a.amountCents),chosen=new Set(settings.exclusions);let offset=0;
 modal(month+' · 排除历史偶发支出',`<form id="entry-form"><p>勾选旅行、换手机等不想重复推算的消费，只从沙盘基准中排除。收入、转账和${synthetic?'演练账本':'真实账本'}完全不变。此设置由所有方案共用。</p><div id="exclusion-list" class="month-confirm-list"></div><div class="exclusion-pager"><button class="btn" id="exclude-prev" type="button">上一页</button><span id="exclude-page"></span><button class="btn" id="exclude-next" type="button">下一页</button></div><div class="modal-bottom">${cancel}<button class="btn primary" type="submit">保存排除标记</button></div></form>`,'',()=>{const f=$('#entry-form');function draw(){$('#exclusion-list').innerHTML=rows.slice(offset,offset+50).map(t=>`<label><input type="checkbox" data-exclusion-id="${esc(t.id)}" ${chosen.has(t.id)?'checked':''}><span><strong>${esc(t.note||categoryName(t.categoryId))} · ${money(t.amountCents)}</strong><small>${t.date} · ${esc(categoryName(t.categoryId))} · 当前个人消费 ${money(expenseValue(t))}</small></span></label>`).join('')||'<p class="body-copy">这个月没有支出记录。</p>';$('#exclude-prev').disabled=offset===0;$('#exclude-next').disabled=offset+50>=rows.length;$('#exclude-page').textContent=rows.length?`${offset+1}–${Math.min(offset+50,rows.length)} / ${rows.length}`:'0 笔';}draw();$('#exclusion-list').onchange=e=>{const id=e.target.dataset.exclusionId;if(!id)return;if(e.target.checked)chosen.add(id);else chosen.delete(id);f.dataset.dirty='true';};$('#exclude-prev').onclick=()=>{offset=Math.max(0,offset-50);draw();};$('#exclude-next').onclick=()=>{offset+=50;draw();};f.onsubmit=e=>{e.preventDefault();saveSimulation(s=>s.exclusions=[...chosen]);};});
}
function eventExclusionsForMonth(selectedMonth){
 const settings=simulationSettings(),basis=state;
 const chosen=new Map(settings.exclusions.map(key=>{const value=settings.version===1?{kind:'transaction-expense',id:key}:key;return[P.keyOf(value),{...value}];}));
 const rows=P.select(finance().personalExpenseEvents,{month:selectedMonth}).map(event=>({event,meta:eventPresentation(event)})).sort((a,b)=>(b.meta.original?.amountCents??b.event.amountCents)-(a.meta.original?.amountCents??a.event.amountCents));let offset=0;
 modal(selectedMonth+' · 排除历史个人消费',`<form id="entry-form"><p>只从沙盘基准排除所选事项。原付款的排除不延伸到后续使用或损失；非现金核销可以单独选择。不会改变真实账户、原始交易或记录权利。</p><div id="event-exclusion-list" class="month-confirm-list"></div><div class="exclusion-pager"><button type="button" class="btn" id="event-exclude-prev">上一页</button><span id="event-exclude-page"></span><button type="button" class="btn" id="event-exclude-next">下一页</button></div><div class="modal-bottom">${cancel}<button class="btn primary" type="submit">保存排除标记</button></div></form>`,'',()=>{
  const form=$('#entry-form');function draw(){
   $('#event-exclusion-list').innerHTML=rows.slice(offset,offset+50).map(({event,meta})=>`<label><input type="checkbox" data-event-exclusion-key="${esc(P.keyOf(event.key))}" ${chosen.has(P.keyOf(event.key))?'checked':''}><span><strong>${esc(meta.label)} · 当前个人消费 ${money(event.amountCents)}</strong><small>${event.effectiveDate} · ${esc(categoryName(event.categoryId))} · ${meta.noncash?'非现金核销，不是再次付款':'原交易 '+money(meta.original.amountCents)}</small></span></label>`).join('')||'<p class="body-copy">这个月没有个人消费来源事项。</p>';
   $('#event-exclude-prev').disabled=offset===0;$('#event-exclude-next').disabled=offset+50>=rows.length;$('#event-exclude-page').textContent=rows.length?`${offset+1}–${Math.min(offset+50,rows.length)} / ${rows.length}`:'0 个事项';
  }draw();
  $('#event-exclusion-list').onchange=event=>{const key=event.target.dataset.eventExclusionKey;if(!key)return;const row=rows.find(row=>P.keyOf(row.event.key)===key);if(!row){error('事项已变化，请重新选择');return;}if(event.target.checked)chosen.set(key,{...row.event.key});else chosen.delete(key);form.dataset.dirty='true';};
  $('#event-exclude-prev').onclick=()=>{offset=Math.max(0,offset-50);draw();};$('#event-exclude-next').onclick=()=>{offset+=50;draw();};
  form.onsubmit=event=>{event.preventDefault();if($('#entry-form')!==form||state!==basis){error('账本或当前窗口已变化，请重新打开排除设置');return;}saveSimulation(next=>{const keys=[...chosen.values()],typed=next.version===2||keys.some(key=>key.kind==='held-recognition');if(typed){next.version=2;next.exclusions=keys;}else next.exclusions=keys.map(key=>key.id);});};
 });
}
function confirmScenarioAction(action,id) {
 const settings=simulationSettings(),active=activeScenario(settings);
 const title=action==='reset-sandbox'?'重置整个消费沙盘？':action==='reset-scenario'?'清空当前方案假设？':action==='delete-scenario'?'删除当前方案？':'删除这笔一次性计划？';
 const copy=action==='reset-sandbox'?(synthetic?'所有模拟方案、完整月份确认和历史排除标记都会清除。演练账户、交易和已删除交易不变。':'所有模拟方案、完整月份确认和历史排除标记都会清除。真实账户、交易和已删除交易不变。'):action==='reset-scenario'?'清空「'+active.name+'」的分类调整和一次性计划，恢复为历史基准。其他方案、历史确认和'+(synthetic?'演练账目':'真实账目')+'不变。':action==='delete-scenario'?'删除「'+active.name+'」的模拟设置，其他方案和'+(synthetic?'演练账目':'真实账目')+'不变。':(synthetic?'只删除模拟计划，演练账目不变。':'只删除模拟计划，真实账目不变。');
 modal(title,`<p>${esc(copy)}</p><p class="form-hint">此操作没有单独撤销；需要保留时，请先导出 JSON 备份。</p>`,`${cancel}<button class="btn danger" id="confirm-scenario-action">确认</button>`,()=>$('#confirm-scenario-action').onclick=()=>saveSimulation(s=>{if(action==='reset-sandbox'){const version=s.version;Object.assign(s,S.defaultSettings());if(version===2)s.version=2;}else if(action==='reset-scenario'){activeScenario(s).adjustments=[];activeScenario(s).oneOffs=[];}else if(action==='delete-scenario'){if(s.scenarios.length<=1)throw Error('至少保留一个方案');s.scenarios=s.scenarios.filter(a=>a.id!==active.id);s.activeId=s.scenarios[0].id;}else activeScenario(s).oneOffs=activeScenario(s).oneOffs.filter(o=>o.id!==id);},undefined,action==='reset-sandbox'));
}

document.addEventListener('click',e=>{if(!active())return;
 if(e.target.classList?.contains('modal-backdrop')&&$('#entry-form')?.dataset.refundStage){closeModal();return;}
 const el=e.target.closest('button,a');if(!el)return;
 if(el.hasAttribute('data-close')){closeModal();return;}
 if(el.dataset.page){IP.invalidate();SP.invalidate();CB.invalidate();DC.invalidate();RR?.invalidate();if(page==='import'&&el.dataset.page!=='import')cancelImportRead();page=el.dataset.page;render();$('.heading h1')?.focus();window.scrollTo({top:0,behavior:'smooth'});return;}
 if(el.dataset.importBatch){showImportBatch(el.dataset.importBatch);return;}
 if(el.dataset.importRollback){confirmImportRollback(el.dataset.importRollback);return;}
 if(el.dataset.personalKey){try{openPersonalEvent(el.dataset.personalKey);}catch(error){toast(error.message);}return;}
 if(el.dataset.ledgerMode){RR?.invalidate();page='ledger';ledgerMode=el.dataset.ledgerMode==='personal'?'personal':'raw';render();return;}
 if(el.dataset.tx){entry(el.dataset.tx);return;}if(el.dataset.account){editAccount(el.dataset.account);return;}if(el.dataset.editCategory){editCategory(el.dataset.editCategory);return;}
 if(el.dataset.scenario){saveSimulation(s=>s.activeId=el.dataset.scenario,'已切换方案');return;}
 if(el.dataset.budget){editBudget(el.dataset.budget);return;}
 if(el.dataset.oneoff){editOneOff(el.dataset.oneoff);return;}
 if(el.dataset.removeOneoff){confirmScenarioAction('remove-oneoff',el.dataset.removeOneoff);return;}
 if(el.dataset.historyExclusions){exclusionsForMonth(el.dataset.historyExclusions);return;}
 if(el.dataset.category){RR?.invalidate();if(heldActive()){ledgerMode='personal';personalFilters={q:'',type:'expense',account:'all',category:el.dataset.category};}else filters.category=el.dataset.category;page='ledger';render();return;}
 if(el.dataset.undo){const id=el.dataset.undo;modal('恢复这笔交易？','<p>交易将重新计入收支与账户余额。</p>',`${cancel}<button class="btn primary" id="confirm-undo">确认恢复</button>`,()=>$('#confirm-undo').onclick=()=>change(()=>L.undoDelete(state,id),'交易已恢复'));return;}
 const action=el.dataset.action;if(!action)return;
 if(action==='reset-demo'){resetDemo();return;}if(action==='practice-files'){practiceFiles();return;}if(action==='refresh-backup-status'){diagnostic(()=>backupSafety.refreshHistory());refreshBackupStatus();}if(action==='verify-backup')verifyBackupFile();if(action==='new')entry();if(action==='add-account')editAccount();if(action==='add-category')editCategory();if(action==='method')method();if(action==='demo')demo();if(action==='restore')showRestore();if(action==='rollback')rollback();
 if(action==='history-months')historyMonths();if(action==='add-scenario')editScenarioName(true);if(action==='rename-scenario')editScenarioName();if(action==='add-oneoff')editOneOff();if(['reset-sandbox','reset-scenario','delete-scenario'].includes(action))confirmScenarioAction(action);
 if(action==='clear-personal-filters'){personalFilters={q:'',type:'all',account:'all',category:'all'};render();}
 if(action==='clear-filters'){filters={q:'',type:'all',account:'all',category:'all'};render();}
 if(action==='export')exportCurrentBackup();
 if(action==='export-raw'||action==='export-recovery-raw'){if(el.isConnected===false||![...document.querySelectorAll('button,a')].includes(el))return;rawRecoveryDownload(action==='export-recovery-raw');}
});
document.addEventListener('change',e=>{if(!active())return;const el=e.target;if(el.id==='month'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(el.value)&&!el.value.startsWith('0000')){month=el.value;render();}for(const key of ['type','account','category']){if(el.id===`filter-${key}`){filters[key]=el.value;render();}if(el.id===`personal-filter-${key}`){personalFilters[key]=el.value;render();}}});
document.addEventListener('input',e=>{if(!active())return;if(e.target.id==='personal-search'){const pos=e.target.selectionStart;personalFilters.q=e.target.value;render();$('#personal-search').focus();$('#personal-search').setSelectionRange(pos,pos);return;}if(e.target.id==='search'){const pos=e.target.selectionStart;filters.q=e.target.value;render();$('#search').focus();$('#search').setSelectionRange(pos,pos);}});
document.addEventListener('keydown',e=>{if(!active())return;const m=$('.modal');if(!m)return;if(e.key==='Escape'){e.preventDefault();closeModal();}if(e.key==='Tab'){const all=[...m.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea,[tabindex="0"]')].filter(x=>!x.closest('[hidden]'));const first=all[0],last=all.at(-1);if(!all.includes(document.activeElement)){e.preventDefault();(e.shiftKey?last:first)?.focus();}else if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}});
if(!synthetic)window.addEventListener('storage',e=>{if(!active())return;CB.invalidate();DC.invalidate();if(e.key===backupNoteKey||e.key===null){diagnostic(()=>backupSafety.refreshHistory());refreshBackupStatus();}if(e.key===L.STORAGE_KEY||e.key===null){stale=true;IP.invalidate();SP.invalidate();CB.invalidate();DC.invalidate();RR?.invalidate('其他页面已修改账本。确认已清除；草稿保留，请刷新后重新核对。',true);render();toast('账本在其他页面已更改。请刷新本页后继续。');}});
// Initialization is atomic from the page's perspective: no controls until all render/bind work succeeds.
try{
 observeStorage({target:'ledger',operation:'read',outcome:ledgerRead==='failed'?'failed':'accepted',...(ledgerRead==='failed'?{cause:'read-failed'}:{})});
 render();$('#app').hidden=false;$('#app').inert=false;$('#modal-root').hidden=false;$('#toast').hidden=false;$('#boot-blocker').hidden=true;
}catch(_){disposeRuntime(synthetic?'演练未启动：所需程序或合成样例不可用。未连接个人账本。请重新加载此演练页面。':'账本未启动。请重新加载此页面。');}
if(synthetic){window.addEventListener('pagehide',()=>disposeRuntime());window.addEventListener('pageshow',event=>{if(event.persisted){disposeRuntime();reloadSynthetic();}});}

