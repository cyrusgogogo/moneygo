/* Non-cash income annotations. Financial interpretation and one-use tickets belong to the engine. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoneygoIncomePlanningUI = api;
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const MODES = {'confirmed-only':'仅确定',planned:'按计划',conservative:'保守'};
  const CERTAINTY = {'confirmed-plan':'确定计划（仍不保证到账）',expectation:'期待（尚不确定）'};
  const PROGRESS = {unresolved:'待复核，完整已收 / 剩余暂无法确定',none:'尚未关联到账',partial:'部分到账归属',complete:'已完整关联', 'target-unknown':'目标未知，不能判断完成'};
  const APPLICABILITY = {'source-missing':'原来源已不存在','source-changed':'来源资金字段已改变','role-changed':'普通收入构成 / 角色已改变','unsupported-basis':'当前依据超限，无法完整核验','future-at-cutoff':'实际来源日期晚于截止日',applicable:'当前依据匹配，截止日内适用'};
  const BUCKET = {excluded:'本模式明确排除',tail:'窗口外尾部',blocked:'归属待复核',undated:'预计日期未知',overdue:'到期 / 过期需核对',dated:'窗口内有明确日期'};
  const EXCLUSIONS = {cancelled:'计划已取消',fulfilled:'已完整关联',expectation:'期待未进入仅确定模式','conservative-assumption':'保守假设：未来未到账暂不计入'};
  const MATCH = {same:'相同',different:'不一致','expected-unspecified':'预计值未填写','source-unavailable':'当前来源不可得'};
  const ACTIONS = {'create-plan':'登记收入计划','update-plan':'修改收入计划','retire-plan':'退役收入计划','allocate-receipt':'关联已有实际普通收入','reverse-receipt':'撤销到账归属','reconfirm-receipt':'重新核对到账归属',cancel:'取消计划',reopen:'重开计划'};
  const WARNINGS = {'proof-limit':'当前依据超限，无法完整核验','unsupported-basis':'当前依据无法完整支持归属','source-missing':'原实际来源已不存在','source-changed':'实际来源资金字段已改变','role-changed':'普通收入构成或角色已改变','future-at-cutoff':'来源经济日期晚于截止日','expected-account-missing':'原预计账户缺失，未自动替换','expected-account-not-found':'所选预计账户不存在','plan-cancelled':'计划已取消，不能新增归属','plan-unresolved':'计划仍有待复核归属，不能新增','plan-not-found':'所选计划已不存在','receipt-not-found':'所选归属已不存在','plan-has-receipts':'须先逐项撤销当前归属，才能退役','reconfirm-unnecessary':'当前依据已匹配，无需重新核对','source-ineligible':'当前来源不是可关联的普通收入','source-unavailable':'当前来源依据不可得','no-additional-capacity':'没有可新增的归属容量','allocation-capacity-exceeded':'本次金额超过归属容量','source-capacity-exceeded':'本次金额超过当前来源容量','plan-capacity-exceeded':'本次金额超过计划目标余量','cutoff-in-future':'新操作的复核截止日不能晚于今天','target-unknown':'计划目标金额未知','plan-no-op':'计划字段没有实际变化'};
  const PAGE_SIZE = 25;
  let context = null, coordinator = null, engineOwner = null, boundDocument = null, clickListener = null, closeListener = null, lifecycle = null, activeDialog = null;
  let asOfDate = '', horizonEnd = '', mode = 'confirmed-only', customHorizon = false, planOffset = 0, sourceOffset = 0, query = '', selectedAccount = '';
  const e = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const engine = ctx => ctx.engine || root.MoneygoIncomePlanning;
  const today = ctx => typeof ctx.today === 'function' ? ctx.today() : ctx.today;
  const stateOf = ctx => ctx.getState();
  const active = ctx => ctx.isActive?.() !== false;
  const money = (ctx,n) => Number.isSafeInteger(n) ? e(ctx.money(n)) : '未知';
  const full = (label,value,open=false) => `<details class="income-proof"${open?' open':''}><summary>${e(label)}</summary><pre>${e(JSON.stringify(value,null,2))}</pre></details>`;
  const empty = text => `<p class="empty compact">${e(text)}</p>`;
  const button = (action,label,id='',attrs='') => `<button class="btn" type="button" data-income-action="${e(action)}"${id?` data-income-id="${e(id)}"`:''}${attrs}>${e(label)}</button>`;
  const field = (label,name,value,attrs='') => `<label class="field">${e(label)}<input name="${e(name)}" value="${e(value)}" aria-describedby="income-form-error" ${attrs}></label>`;
  const area = (label,name,value,required=false) => `<label class="field full">${e(label)}<textarea name="${e(name)}" maxlength="500" rows="3" aria-describedby="income-form-error"${required?' required':''}>${e(value)}</textarea></label>`;
  const choices = (name,label,values,value) => `<label class="field">${e(label)}<select name="${e(name)}" aria-describedby="income-form-error">${Object.entries(values).map(([key,text])=>`<option value="${e(key)}"${key===value?' selected':''}>${e(text)}</option>`).join('')}</select></label>`;
  const dateField = (name,label,value,required=true) => field(label,name,value,`type="date" min="0001-01-01" max="9999-12-31"${required?' required':''}`);
  const cancelButton = ctx => ctx.cancel || '<button class="btn" type="button" data-close>取消</button>';
  const errorBox = () => '<p id="income-form-error" class="income-warning" role="alert" tabindex="-1"></p>';
  const caveat = () => '<p class="income-caveat">计划与到账归属都是非现金注释。只关联已有实际普通收入，不新增真实交易、不移动资金、不预留现金。退款、报销回款和本金退回使用各自工作区；这里只关联财务模型确认的普通残余。</p>';
  const knowledge = () => '<p class="income-disclosure">按明确日终经济截止日，使用当前关系与注释，不代表当时已知信息。未关联普通收入份额、未来计划和账户余额分别展示；这些数值不能判断资金是否安全或可花额度。</p>';
  const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
  function defaultHorizon(day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return '';
    const y = Number(day.slice(0,4)), m = Number(day.slice(5,7)), index = y * 12 + m - 1 + 3;
    const year = Math.floor(index / 12), month = index % 12 + 1;
    if (year > 9999 || year < 1) return '';
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = month === 2 ? (leap ? 29 : 28) : [4,6,9,11].includes(month) ? 30 : 31;
    return String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0')+'-'+String(days).padStart(2,'0');
  }
  function options(ctx) {
    if (!asOfDate) asOfDate = today(ctx);
    if (!horizonEnd && !customHorizon) horizonEnd = defaultHorizon(asOfDate);
    return {asOfDate,horizonEnd,mode};
  }
  function validateOptions(ctx,o) {
    if (!ctx.ledger.validDate(o.asOfDate)) throw Error('请填写有效的日终经济截止日。');
    if (!ctx.ledger.validDate(o.horizonEnd) || o.horizonEnd <= o.asOfDate) throw Error('请填写晚于截止日的有效窗口末日。年界不足三个完整月时，需要明确选择。');
    if (!Object.hasOwn(MODES,o.mode)) throw Error('请选择有效收入假设模式。');
    return o;
  }
  function getCoordinator(ctx) {
    const model = engine(ctx);
    if (!model || typeof model.createCoordinator !== 'function') throw Error('收入计划模块尚未准备好。');
    if (coordinator && engineOwner !== model) invalidate();
    if (!coordinator || engineOwner !== model) {
      if (typeof ctx.now !== 'function' || typeof ctx.today !== 'function') throw Error('缺少明确的核对时间能力，请重新打开页面。');
      coordinator = model.createCoordinator({now:ctx.now,today:ctx.today}); engineOwner = model;
    }
    return coordinator;
  }
  function invalidate() {
    if (activeDialog) {
      if (activeDialog.ticket && coordinator) coordinator.cancel(activeDialog.ticket);
      activeDialog.ticket = null; activeDialog.valid = false;
    }
    coordinator?.invalidateAll(); activeDialog = null;
  }
  function dialog(ctx,title,body,buttons,ready) {
    invalidate();
    // The host invalidates its previous modal during replacement. Assign the
    // new token and create any preview only after that replacement has finished.
    ctx.modal(title,body,buttons,()=>{
      if (!active(ctx)) return;
      const token = {valid:true,ticket:null,form:null,submitted:false}; activeDialog = token;
      ready?.(token);
    });
  }
  function current(ctx,token,form) { return active(ctx) && token.valid && activeDialog === token && (!form || token.form===form && ctx.$('#entry-form')===form); }
  function fail(ctx,error) {
    const message = error?.message || String(error), box = ctx.$('#income-form-error');
    if (box) { box.textContent = message; box.focus?.(); }
    else ctx.error(message);
  }
  function bindForm(ctx,token,submit) {
    const form = ctx.$('#entry-form'); if (!form) throw Error('表单尚未准备好，请重新打开。'); token.form=form;
    const dirty = () => { if (current(ctx,token,form)) form.dataset.dirty='true'; };
    form.addEventListener('input',dirty); form.addEventListener('change',dirty);
    form.onsubmit = event => { event.preventDefault(); if (!current(ctx,token,form)||token.submitted) return; try { if (form.reportValidity && !form.reportValidity()) return; submit(form); } catch (error) { fail(ctx,error); } };
    return form;
  }
  function read(form,name) { const n=form.elements.namedItem(name); if (!n) throw Error('缺少字段：'+name); return n.value; }
  function reason(value) { if (typeof value!=='string'||!value.trim()||value.length>500||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw Error('请填写 1–500 字的本次确认原因，不含无效控制字符。'); return value.trim(); }
  function metrics(ctx,rows) { return `<dl class="income-metrics">${rows.map(([label,value])=>`<div><dt>${e(label)}</dt><dd>${money(ctx,value)}</dd></div>`).join('')}</dl>`; }
  function warningList(values) { return values?.length ? `<p class="income-warning">提示：${values.map(value=>WARNINGS[value]?e(WARNINGS[value])+'（'+e(value)+'）':e(value)).join('；')}</p>` : ''; }
  function planMarkup(ctx,pv) {
    if (!pv) return '<p>此侧没有计划。</p>';
    const p=pv.plan;
    return `<h4>${e(p.name)}</h4><p>${e(CERTAINTY[p.certainty])} · ${p.status==='cancelled'?'已取消':'开放中'} · ${e(PROGRESS[pv.progress])}</p>${pv.progress==='unresolved'?'<p class="income-warning" role="status">待复核：完整已收与剩余未知。已知适用部分不能与待复核捕获额相加当作已收。</p>':''}${metrics(ctx,[['目标',p.expectedAmountCents],['完整已收',pv.receivedCents],['完整剩余',pv.remainingCents],['已知适用部分',pv.knownApplicableCents],['待复核捕获额',pv.unresolvedCapturedCents]])}<p>预计日期 ${e(p.expectedDate||'未知')} · 预计账户 ${p.expectedAccountId?e(ctx.accountName(p.expectedAccountId)):'未知'}（${e({known:'账户存在',unspecified:'未填写',missing:'原账户缺失，未自动替换'}[pv.expectedAccountStatus])}）</p><p class="income-user-text">计划确认依据：${e(p.basis||'未填写')}</p><p class="income-user-text">备注：${e(p.note||'未填写')}</p>${warningList(pv.warnings)}`;
  }
  function sourceMarkup(ctx,s) {
    const t=s.currentTransaction;
    return `<article class="income-source"><h4>来源 ${e(s.transactionId)}</h4>${t?`<p>当前原始 ${e({income:'收入',expense:'支出',transfer:'转账'}[t.type]||t.type)} · ${e(t.date)} · 原金额 ${money(ctx,t.amountCents)} · 账户 ${e(ctx.accountName(t.accountId))}${t.toAccountId?' → '+e(ctx.accountName(t.toAccountId)):''}</p>`:'<p class="income-warning">当前来源已不存在，金额未知。历史捕获不会被当前值覆盖。</p>'}${t&&t.date>s.asOfDate?'<p>未来原始记录：不计入此截止日的实际普通收入。</p>':''}<p>当前依据状态：${e({available:'可完整核验',missing:'来源缺失',ineligible:'非普通收入来源',unsupported:'依据超限，无法完整核验'}[s.basisStatus]||s.basisStatus)}</p>${metrics(ctx,[['截止日内普通收入',s.ordinaryIncomeCents],['当前适用归属',s.applicableAttributedCents],['未关联普通收入份额',s.unassociatedOrdinaryCents],['其他待复核捕获额',s.unresolvedCapturedCents]])}<p>未关联份额不是未占用现金。待复核记录：${e(s.unresolvedReceiptIds.join('、')||'无')}</p>${warningList(s.reasonCodes)}${full('完整来源投影',s)}</article>`;
  }
  function assumptionMarkup(ctx,a,details=true) {
    return `<section class="income-assumption"><h3>${e(MODES[a.mode])}</h3><p>窗口 (${e(a.asOfDate)}, ${e(a.horizonEnd)}]；截止日当日到期的计划进入到期复核。</p>${a.mode==='conservative'?'<p>未来未到账暂不计入是此模式的假设，不代表实际收入为零。</p>':''}${metrics(ctx,[['窗口完整假设收入',a.scheduledTotalCents],['窗口内已知部分',a.knownDatedTotalCents],['窗口外尾部已知部分',a.knownTailTotalCents]])}<p>尾部未知金额 ${e(a.unknownTailCount)} 项；阻挡窗口完整合计的计划：${e(a.blockingPlanIds.join('、')||'无')}。</p>${warningList(a.warnings)}${details?(a.rows.map(row=>`<article class="income-assumption-row"><h4>${e(row.planView.plan.name)} · ${e(BUCKET[row.bucket])}</h4><p>${row.exclusionReason?e(EXCLUSIONS[row.exclusionReason])+' · ':''}日期状态：${e({undated:'未知',due:'已到期 / 当日到期','in-window':'窗口内',tail:'窗口外'}[row.dateState])} · 预计 ${e(row.expectedDate||'未知')}</p>${metrics(ctx,[['本模式计划未来贡献',row.contributionCents],['窗口贡献',row.windowContributionCents],['真实归属完整已收',row.receivedCents],['真实归属剩余',row.remainingCents]])}${warningList(row.warnings)}${full('完整情景行（含计划原字段）',row)}</article>`).join('')||empty('此模式没有当前计划。')):''}</section>`;
  }
  function pagination(kind,offset,count) { return `<div class="income-pager">${button(kind+'-prev','上一页','',offset===0?' disabled':'')}<span role="status">${count?`${offset+1}–${Math.min(offset+PAGE_SIZE,count)} / ${count}`:'0 条'}</span>${button(kind+'-next','下一页','',offset+PAGE_SIZE>=count?' disabled':'')}</div>`; }
  function accountSelector(state) { return `<label class="field">单独查看账户快照与覆盖<select id="income-account"><option value="">请选择账户，逐个核对</option>${state.accounts.map(a=>`<option value="${e(a.id)}"${a.id===selectedAccount?' selected':''}>${e(a.name)}</option>`).join('')}</select></label>`; }
  function accountMarkup(ctx,state,id,day) {
    const account=state.accounts.find(a=>a.id===id); if (!account) return empty('请选择一个账户。不同账户不同日期的快照不会相加为同一时点现金。');
    const snapshots=(state.bookkeeping?.snapshots||[]).filter(s=>s.accountId===id), revisions=new Map();
    for (const event of state.bookkeeping?.audit||[]) if (event.kind==='snapshot'&&event.action==='create') revisions.set(event.recordId,event.revision);
    const sorted=snapshots.filter(s=>s.date<=day).sort((a,b)=>compare(b.date,a.date)||(revisions.get(b.id)||0)-(revisions.get(a.id)||0)||compare(b.id,a.id));
    const latest=sorted[0], future=snapshots.filter(s=>s.date>day).sort((a,b)=>compare(a.date,b.date)||compare(a.id,b.id));
    const r=latest?ctx.relations.reconciliation(state,latest.id):null;
    const profile=(state.obligations?.profiles||[]).find(p=>p.accountId===id), role=profile?.role||'unknown';
    const scopes=(state.organizer?.scopes||[]).filter(s=>s.accountId===id), coverage=(state.imports?.coverage||[]).filter(c=>c.accountId===id&&c.confirmed===true);
    const batches=new Map((state.imports?.batches||[]).map(b=>[b.id,b]));
    const pending=(state.imports?.evidence||[]).filter(x=>x.accountId===id&&x.status==='pending');
    const quarantine=(state.imports?.quarantine||[]).filter(x=>x.accountId===id&&x.resolvedByBatchId===null&&!batches.get(x.batchId)?.rolledBack);
    return `<section class="income-account"><h3>${e(account.name)} · 单账户核对</h3><p>角色：${e({cash:'用户声明为现金账户',credit:'信用负债',restricted:'受限',other:'其他',unknown:'未知'}[role])}。账户角色不单独证明可动用现金。</p>${r?`<p>最新适用快照 ${e(latest.date)} · ${e(latest.id)} · 原创建审计修订 ${e(revisions.get(latest.id)??'未知')}</p>${metrics(ctx,[['用户填写日终实际余额',r.actualBalanceCents],['该日当前账本余额',r.ledgerBalanceCents],['当前差额',r.differenceCents]])}<p class="${r.changed||!r.reconciled?'income-warning':'income-disclosure'}">${r.differenceCents!==0?'存在差额，请核对；不会自动补平。':r.changed?'金额一致、依据变化，需重核。':'金额一致；这不单独证明来源完整。'} 依据变化：${r.changed?'是':'否'}。</p>${full('本账户快照完整对账结果',r)}`:'<p class="income-warning">尚未核对：没有截止日内适用快照。</p>'}<p>未来快照 ${future.length} 条，未用于当前选择。来源覆盖完整性仍未知；下列声明、已确认区间与未决记录保留各自边界，不把对平当作覆盖完整。</p>${full('未来快照（不进入当前选择）',future)}${full('用户声明的来源范围',scopes)}${full('用户已确认的覆盖区间',coverage)}${full('当前未决来源记录',{pendingEvidence:pending,unresolvedQuarantine:quarantine},true)}<p>未声明来源无法自动发现。不同日期的余额不汇总为今天现金；信用、受限、其他和未知角色不自动当作可动用现金。</p></section>`;
  }
  function render(ctx) {
    try {
      if (!engine(ctx)) throw Error('收入计划模块未加载，请刷新后重试。');
      const o=options(ctx), state=stateOf(ctx), view=engine(ctx).view(state,{asOfDate:o.asOfDate});
      const validWindow=ctx.ledger.validDate(o.horizonEnd)&&o.horizonEnd>o.asOfDate;
      const projection=validWindow?engine(ctx).project(state,o):null;
      const plans=view.plans.filter(p=>`${p.plan.name} ${p.plan.id} ${p.plan.basis} ${p.plan.note}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
      planOffset=Math.min(planOffset,Math.max(0,Math.floor((plans.length-1)/PAGE_SIZE)*PAGE_SIZE)); sourceOffset=Math.min(sourceOffset,Math.max(0,Math.floor((view.sources.length-1)/PAGE_SIZE)*PAGE_SIZE));
      const currentIds=new Set(view.plans.map(p=>p.plan.id)), retired=(state.incomePlanning?.audit||[]).filter(x=>x.kind==='plan'&&x.action==='retire'&&!currentIds.has(x.recordId));
      return `<section class="income-workspace" id="income-root"><article class="card"><div class="card-head"><div><h2>收入计划与到账归属</h2><p>原始收入、计划归属、未关联份额与未来假设分别核对</p></div>${button('new','登记收入计划')}</div>${caveat()}${knowledge()}<div class="form-grid"><label class="field">日终经济截止日<input id="income-as-of" type="date" min="0001-01-01" max="9999-12-31" value="${e(o.asOfDate)}" required></label><label class="field">未来窗口末日<input id="income-horizon" type="date" min="0001-01-01" max="9999-12-31" value="${e(o.horizonEnd)}" required></label><label class="field">收入假设模式<select id="income-mode">${Object.entries(MODES).map(([key,label])=>`<option value="${key}"${key===mode?' selected':''}>${label}</option>`).join('')}</select></label><label class="field">搜索计划名称、依据、备注或编号<input id="income-query" type="search" maxlength="500" value="${e(query)}"></label></div><p>默认窗口：本月剩余及未来三个完整月。日期按整数日历处理；计划不会自动挪到明天。</p>${warningList(view.warnings)}${plans.slice(planOffset,planOffset+PAGE_SIZE).map(p=>`<article class="income-plan">${planMarkup(ctx,p)}${button('detail','查看 / 修改 / 关联 / 历史',p.plan.id)}</article>`).join('')||empty('尚无符合条件的收入计划。金额、日期和预计账户未知时可留空登记期待。')}${pagination('plans',planOffset,plans.length)}<details class="income-history"><summary>退役计划与保留历史（${retired.length} 项）</summary>${retired.map(x=>`<p>${e(x.before.name)} · ${e(x.recordId)} ${button('detail','查看退役历史',x.recordId)}</p>`).join('')||empty('没有退役计划。')}</details></article><article class="card">${projection?assumptionMarkup(ctx,projection):'<p class="income-warning" role="alert">默认窗口超出有效年份或窗口不合法。请明确选择晚于截止日、且不超过 9999-12-31 的窗口末日。</p>'}<p>未关联计划可能与已有实际收入重复，请人工核对后关联；不会按金额自动匹配。未来原始收入不会自动转换为计划。</p></article><article class="card"><div class="card-head"><h3>所有原始收入及当前归属引用的来源</h3>${button('record-income','录入一笔真实收入')}</div><p>包括未关联、未来、非普通来源及已缺失来源。三项金额均按 ${e(view.asOfDate)} 截止日解释。</p>${view.sources.slice(sourceOffset,sourceOffset+PAGE_SIZE).map(s=>sourceMarkup(ctx,s)).join('')||empty('还没有实际收入来源。计划不能充当实际到账；需要时请进入真实收入录入。')}${pagination('sources',sourceOffset,view.sources.length)}</article><article class="card"><h3>账户快照与覆盖边界</h3>${accountSelector(state)}<div id="income-account-details">${accountMarkup(ctx,state,selectedAccount,o.asOfDate)}</div></article></section>`;
    } catch (error) { return `<p class="notice warning" role="alert">收入计划暂时无法读取：${e(error.message)}</p>`; }
  }
  function receiptMarkup(ctx,rv,receipt) {
    return `<article class="income-receipt"><h4>归属 ${e(rv.receiptId)} · ${money(ctx,rv.capturedAmountCents)}</h4><p>${e(APPLICABILITY[rv.applicability])} · 实际经济日 ${e(rv.economicDate)} · 建立时复核截止日 ${e(rv.reviewedAsOfDate)}</p><p>截止日内当前普通收入 ${money(ctx,rv.currentOrdinaryIncomeCents)} · 来源 ${e(rv.transactionId)}</p>${warningList(rv.reasonCodes)}${full('不可改写的完整归属及捕获 proof',receipt,true)}<div class="income-actions">${button('reverse','撤销此项归属',rv.receiptId)}${button('reconfirm','重新核对当前依据',rv.receiptId,rv.applicability==='applicable'?' disabled':'')}</div></article>`;
  }
  function planDetails(ctx,id) {
    try {
      const state=stateOf(ctx), view=engine(ctx).view(state,{asOfDate:options(ctx).asOfDate}), pv=view.plans.find(p=>p.plan.id===id);
      const data=state.incomePlanning, events=(data?.audit||[]).filter(x=>x.kind==='plan'&&x.recordId===id||x.kind==='receipt'&&(x.before?.planId===id||x.after?.planId===id));
      const record=pv?.plan||events.findLast(x=>x.kind==='plan'&&x.before)?.before||events.find(x=>x.kind==='plan'&&x.after)?.after;
      if (!record) throw Error('没有找到此计划及其保留历史。');
      const receiptMap=new Map((data?.receipts||[]).map(x=>[x.id,x]));
      const rows=view.receipts.filter(r=>r.planId===id);
      const controls=pv?`<div class="income-actions">${button('edit','修改计划',id)}${button(record.status==='cancelled'?'reopen':'cancel',record.status==='cancelled'?'预览重开':'预览取消',id)}${button('allocate','关联已有实际普通收入',id,record.status==='cancelled'||pv.progress==='unresolved'?' disabled':'')}${button('retire','预览退役',id,rows.length?' disabled':'')}</div>${rows.length?'<p>退役前须逐项撤销当前归属；不会自动连带删除。</p>':''}`:'';
      dialog(ctx,pv?'收入计划详情与修复':'退役计划的保留历史',`<div class="income-details">${caveat()}${knowledge()}${pv?planMarkup(ctx,pv):`<h3>${e(record.name)} · 已退役</h3><p>此计划不进入当前收入假设。原字段、归属与操作历史仍保留。</p>${full('最后保留的计划字段',record,true)}`}${controls}<h3>当前逐项归属</h3>${rows.map(r=>receiptMarkup(ctx,r,receiptMap.get(r.receiptId))).join('')||empty('没有当前归属。')}<h3>完整历史（包括已撤销 / 重核 / 退役）</h3>${full('不可改写的操作事件与 before / after 捕获',events,true)}<p>来源金融纠错仍在原交易 / 退款 / 回款 / 本金工作区处理；这里不会锁住原实际收入。重核只替换选中归属，不自动缩额或修复其他条目。</p></div>`,'<button class="btn" type="button" data-close>关闭</button>');
    } catch (error) { ctx.error(error.message); }
  }
  function draft(ctx,action,id) {
    const state=stateOf(ctx), o=options(ctx), d={action,id,asOfDate:o.asOfDate,horizonEnd:o.horizonEnd,mode:o.mode,reason:''};
    if (action==='create-plan') return {...d,name:'',certainty:'expectation',amount:'',expectedDate:'',expectedAccountId:'',basis:'',note:''};
    if (action==='update-plan') {
      const p=state.incomePlanning?.plans.find(p=>p.id===id); if (!p) throw Error('计划已不存在。');
      return {...d,name:p.name,certainty:p.certainty,amount:p.expectedAmountCents===null?'':ctx.amountText(p.expectedAmountCents),expectedDate:p.expectedDate||'',expectedAccountId:p.expectedAccountId||'',basis:p.basis,note:p.note};
    }
    if (action==='allocate-receipt') return {...d,transactionId:'',amount:'',reference:''};
    return d;
  }
  function planFields(ctx,d) {
    const state=stateOf(ctx), missing=d.expectedAccountId&&!state.accounts.some(a=>a.id===d.expectedAccountId);
    return `<div class="form-grid">${field('计划名称','name',d.name,'maxlength="80" required')}${choices('certainty','确定程度',CERTAINTY,d.certainty)}${field('目标金额（人民币元；留空为未知）','amount',d.amount,'inputmode="decimal" maxlength="14"')}${dateField('expectedDate','预计到账日（留空为未知）',d.expectedDate,false)}<label class="field">预计账户（留空为未知）<select name="expectedAccountId" aria-describedby="income-form-error"><option value="">未知 / 未填写</option>${missing?`<option value="${e(d.expectedAccountId)}" selected>缺失账户：${e(d.expectedAccountId)}（可保留原引用）</option>`:''}${state.accounts.map(a=>`<option value="${e(a.id)}"${a.id===d.expectedAccountId?' selected':''}>${e(a.name)}</option>`).join('')}</select></label>${area('计划确认依据（确定计划必填）','basis',d.basis,d.certainty==='confirmed-plan')}${area('计划备注','note',d.note)}</div><p>确定程度与到账进度独立。预计日 / 账户不改写实际来源；修改目标须满足当前归属约束。未知值始终保留为未知。</p>`;
  }
  function sourcePicker(ctx,d) {
    const view=engine(ctx).view(stateOf(ctx),{asOfDate:d.asOfDate});
    return `<label class="field full">选择已有实际收入来源<select name="transactionId" required aria-describedby="income-form-error"><option value="">请逐条核对后选择</option>${view.sources.map(s=>{const t=s.currentTransaction;return `<option value="${e(s.transactionId)}"${s.transactionId===d.transactionId?' selected':''}>${e(s.transactionId)} · ${e(t?.date||'来源缺失')} · ${e(t?.type||'missing')} · 截止日普通收入 ${money(ctx,s.ordinaryIncomeCents)}</option>`;}).join('')}</select></label><p>列表保留未来、非普通和缺失来源，选择后明确说明是否可关联。来源原额不是可关联容量；金额以财务模型的普通残余与当前容量为准。</p>${!view.sources.length?empty('没有实际收入记录。请先录入真实到账，再返回人工关联。'):''}${button('record-income','进入真实收入录入')}<div id="income-picked-source" aria-live="polite"></div>`;
  }
  function command(ctx,d) {
    if (d.action==='create-plan'||d.action==='update-plan') {
      const plan={name:d.name,certainty:d.certainty,expectedAmountCents:d.amount.trim()===''?null:ctx.ledger.parseAmount(d.amount),expectedDate:d.expectedDate||null,expectedAccountId:d.expectedAccountId||null,basis:d.basis,note:d.note};
      return d.action==='create-plan'?{action:d.action,plan}:{action:d.action,planId:d.id,patch:plan};
    }
    if (d.action==='cancel'||d.action==='reopen') return {action:'update-plan',planId:d.id,patch:{status:d.action==='cancel'?'cancelled':'open'}};
    if (d.action==='retire-plan') return {action:d.action,planId:d.id};
    if (d.action==='allocate-receipt') return {action:d.action,planId:d.id,transactionId:d.transactionId,amountCents:ctx.ledger.parseAmount(d.amount),reference:d.reference};
    return {action:d.action,receiptId:d.id};
  }
  function readDraft(form,d) { for (const key of Object.keys(d)) { const n=form.elements.namedItem(key); if(n) d[key]=n.value; } }
  function eligibilityMarkup(ctx,result) {
    return `<section class="income-eligibility"><h4>操作资格：${result.eligible?'当前符合条件':'当前不能执行'}</h4>${metrics(ctx,[['来源可用归属容量',result.sourceCapacityCents],['本次最多新增',result.maxAdditionalCents],['重核固定旧额',result.amountToReconfirmCents],['目标捕获余量',result.planTargetCapacity.cents]])}<p>目标容量类型：${e({known:'已知', 'target-unknown':'目标未知（不虚构有限上限）', unresolved:'未决'}[result.planTargetCapacity.kind])}。重核容量已临时移除所选旧归属；不会自动缩减原金额。</p>${warningList(result.reasonCodes)}${full('完整操作资格',result)}</section>`;
  }
  function showDraft(ctx,d) {
    try {
      let body=`<div class="form-grid">${dateField('asOfDate','明确日终经济截止日',d.asOfDate)}${dateField('horizonEnd','未来窗口末日',d.horizonEnd)}${choices('mode','首屏收入假设模式',MODES,d.mode)}</div>`;
      if (d.action==='create-plan'||d.action==='update-plan') body+=planFields(ctx,d);
      else if (d.action==='allocate-receipt') body+=sourcePicker(ctx,d)+field('本次关联金额（人民币元）','amount',d.amount,'inputmode="decimal" maxlength="14" required')+area('本次关联参考','reference',d.reference);
      else if (d.action==='cancel'||d.action==='reopen') body+=`<p>本次${d.action==='cancel'?'取消':'重开'}计划只改变未来假设资格。已有实际收入和归属不删除，待复核状态不会因此解除。</p>`;
      else if (d.action==='retire-plan') body+='<p>只有没有任何当前归属的计划可以退役。历史永久保留，不能重用编号；不会删除实际交易。</p>';
      else {
        const record=stateOf(ctx).incomePlanning?.receipts.find(r=>r.id===d.id); if (!record) throw Error('归属已不存在或已撤销。');
        body+=full('本次原归属及完整捕获依据',record,true)+`<p>${d.action==='reverse-receipt'?'仅撤销此项归属，不删除实际收入，不移动现金。':'仅以当前完整依据重核此项：金额与参考不变；其他未决归属保持待复核。取消计划也可重核，但不能新增归属。'}</p>`;
        if(d.action==='reconfirm-receipt') body+='<div id="income-picked-source" aria-live="polite"></div>';
      }
      dialog(ctx,ACTIONS[d.action],`<form id="entry-form" class="income-form">${caveat()}${body}${area('本次确认原因（确认保存前必填）','reason',d.reason)}${errorBox()}<div class="modal-bottom">${cancelButton(ctx)}<button class="btn primary" id="income-preview" type="submit">生成完整影响预览，不保存</button></div></form>`,'',token=>{
        const form=bindForm(ctx,token,f=>{readDraft(f,d);const o=validateOptions(ctx,{asOfDate:d.asOfDate,horizonEnd:d.horizonEnd,mode:d.mode});showReview(ctx,command(ctx,d),o,d);});
        if(d.action==='create-plan'||d.action==='update-plan') {
          const certainty=form.elements.namedItem('certainty'),basis=form.elements.namedItem('basis');
          const update=()=>{if(current(ctx,token,form))basis.required=certainty.value==='confirmed-plan';}; certainty.onchange=update;update();
        }
        if(d.action==='allocate-receipt'||d.action==='reconfirm-receipt') {
          const picker=form.elements.namedItem('transactionId'),day=form.elements.namedItem('asOfDate');
          const draw=()=>{
            if(!current(ctx,token,form))return;
            const box=ctx.$('#income-picked-source'),submit=ctx.$('#income-preview');
            try {
              if(d.action==='allocate-receipt'&&!picker.value){box.innerHTML=empty('请选择来源并核对普通残余。');submit.disabled=true;return;}
              const query=d.action==='allocate-receipt'?{action:d.action,planId:d.id,transactionId:picker.value,asOfDate:day.value}:{action:d.action,receiptId:d.id,asOfDate:day.value};
              const result=engine(ctx).eligibility(stateOf(ctx),query);
              const sourceId=picker?.value||stateOf(ctx).incomePlanning.receipts.find(r=>r.id===d.id)?.transactionId;
              const source=engine(ctx).view(stateOf(ctx),{asOfDate:day.value}).sources.find(s=>s.transactionId===sourceId);
              box.innerHTML=(source?sourceMarkup(ctx,source):'')+eligibilityMarkup(ctx,result);submit.disabled=!result.eligible;
            }catch(error){box.innerHTML=`<p class="income-warning" role="alert">${e(error.message)}</p>`;submit.disabled=true;}
          };
          if(picker)picker.onchange=draw;day.onchange=draw;draw();
        }
      });
    } catch(error) { ctx.error(error.message); }
  }
  function requireKeys(value,keys,label) { if(!value||typeof value!=='object'||keys.some(key=>!Object.hasOwn(value,key))) throw Error('预览缺少必需复核字段：'+label+'。请重新生成完整预览。'); }
  function requireReview(r) {
    requireKeys(r,['version','command','options','confirmationStamp','newEvents','plans','receipts','sources','operationEligibility','scenarioImpacts','financialDeltas','unchangedSubtrees'],'review');
    requireKeys(r.options,['asOfDate','horizonEnd','mode'],'明确截止日 / 窗口 / 模式');
    requireKeys(r.confirmationStamp,['status','previewAt','reason'],'待确认时间');
    const pvKeys=['plan','receiptIds','knownApplicableCents','unresolvedCapturedCents','unresolvedReceiptIds','receivedCents','remainingCents','progress','expectedAccountStatus','warnings'];
    const planKeys=['id','createdAt','name','certainty','expectedAmountCents','expectedDate','expectedAccountId','status','basis','note'];
    const sourceKeys=['transactionId','asOfDate','currentTransaction','ordinaryIncomeCents','applicableAttributedCents','unassociatedOrdinaryCents','unresolvedCapturedCents','unresolvedReceiptIds','basisStatus','reasonCodes'];
    const receiptViewKeys=['receiptId','planId','transactionId','economicDate','reviewedAsOfDate','capturedAmountCents','applicability','reasonCodes','currentOrdinaryIncomeCents'];
    function pv(v) { if(v!==null){requireKeys(v,pvKeys,'完整计划投影');requireKeys(v.plan,planKeys,'完整计划字段与确认依据');} }
    function proof(v) { requireKeys(v,['version','source','role','duplicateEvidence','reductions','ordinaryIncomeCents'],'完整 proof'); requireKeys(v.source,['id','type','date','amountCents','accountId','toAccountId'],'来源资金签名'); for(const x of v.reductions)requireKeys(x,['id','kind','amountCents','incomeSignature'],'全部减项'); for(const x of v.duplicateEvidence)requireKeys(x,['id','primaryId','shadowId','primarySignature','shadowSignature'],'全部重复证据'); }
    for(const p of r.plans){requireKeys(p,['planId','before','after','targetHeadroomBefore','targetHeadroomAfter'],'计划前后与目标余量');pv(p.before);pv(p.after);requireKeys(p.targetHeadroomBefore,['kind','cents'],'目标余量 before');requireKeys(p.targetHeadroomAfter,['kind','cents'],'目标余量 after');}
    for(const x of r.receipts){requireKeys(x,['receipt','before','after','proofComparison','planMatchBefore','planMatchAfter'],'归属前后及差异');requireKeys(x.receipt,['id','createdAt','reviewedAsOfDate','planId','transactionId','amountCents','proof','reference'],'完整原捕获');proof(x.receipt.proof);requireKeys(x.proofComparison,['result','differentFields'],'proof 差异');for(const v of [x.before,x.after])if(v!==null)requireKeys(v,receiptViewKeys,'归属适用性');for(const m of [x.planMatchBefore,x.planMatchAfter])if(m!==null){requireKeys(m,['captured','current'],'预计与实际比较');requireKeys(m.captured,['date','account'],'原捕获日期 / 账户比较');requireKeys(m.current,['date','account'],'当前日期 / 账户比较');}}
    for(const s of r.sources){requireKeys(s,['transactionId','currentTransaction','currentBasis','currentProof','ordinaryResidualCents','reductionComponents','duplicateLinks','before','after','applicableAllocationsBefore','applicableAllocationsAfter'],'来源完整依据与容量');if(s.currentProof!==null)proof(s.currentProof);for(const v of [s.before,s.after])if(v!==null)requireKeys(v,sourceKeys,'来源前后容量');for(const x of [...s.applicableAllocationsBefore,...s.applicableAllocationsAfter])requireKeys(x,['receiptId','planId','amountCents'],'同源全部归属');}
    if(r.operationEligibility!==null){requireKeys(r.operationEligibility,['eligible','reasonCodes','sourceCapacityCents','planTargetCapacity','maxAdditionalCents','amountToReconfirmCents'],'操作资格');requireKeys(r.operationEligibility.planTargetCapacity,['kind','cents'],'操作目标容量');}
    for(const key of ['confirmedOnly','planned','conservative']){const s=r.scenarioImpacts[key];requireKeys(s,['mode','before','after','rows'],'三模式 '+key);for(const t of [s.before,s.after])requireKeys(t,['knownDatedTotalCents','scheduledTotalCents','knownTailTotalCents','unknownTailCount','blockingPlanIds','warnings'],'完整情景合计');for(const row of s.rows){requireKeys(row,['planId','before','after'],'目标情景前后');for(const v of [row.before,row.after])if(v!==null){requireKeys(v,['planId','planView','dateState','bucket','exclusionReason','expectedDate','contributionCents','windowContributionCents','blocksWindowTotal','receivedCents','remainingCents','warnings'],'完整情景行');pv(v.planView);}}}
    requireKeys(r.financialDeltas,['scope','ordinaryIncomeCents','personalExpenseCents','cashInCents','cashOutCents','accounts'],'逐项金融零变化');for(const a of r.financialDeltas.accounts)requireKeys(a,['accountId','inflowCents','outflowCents','balanceCents'],'各账户零变化');
    requireKeys(r.unchangedSubtrees,['basis','allowedChangedPaths','allOtherSubtreesEqual'],'其余持久子树保持不变');
    for(const ev of r.newEvents)requireKeys(ev,['id','revision','kind','recordId','action','reverses'],'新增事件');
  }
  function matchMarkup(match) { return match?`<p>原捕获对预计：日期 ${e(MATCH[match.captured.date])}，账户 ${e(MATCH[match.captured.account])}。<br>当前来源对预计：日期 ${e(MATCH[match.current.date])}，账户 ${e(MATCH[match.current.account])}。</p>`:'<p>此侧没有归属，不进行预计 / 实际比较。</p>'; }
  function reviewProof(ctx,label,p) {
    if(!p)return `<p class="income-warning">${e(label)}不可得。请核对当前依据状态与不可用原因；没有生成替代 proof。</p>`;
    return `<section class="income-proof-summary"><h5>${e(label)}</h5><p>原始 ${e(p.source.type)} · ${e(p.source.date)} · 原额 ${money(ctx,p.source.amountCents)} · 账户 ${e(ctx.accountName(p.source.accountId))} · 来源 ${e(p.source.id)}</p><p>普通残余 ${money(ctx,p.ordinaryIncomeCents)}。以下全部减项由引擎提供，界面不另算。</p>${p.reductions.length?`<ul>${p.reductions.map(x=>`<li>${e(x.kind)} · ${e(x.id)} · ${money(ctx,x.amountCents)}</li>`).join('')}</ul>`:'<p>没有收入侧减项。</p>'}${full('完整重复证据（包括全部资金签名）',p.duplicateEvidence,true)}${full(label+'完整字段',p,true)}</section>`;
  }
  function reviewMarkup(ctx,r) {
    requireReview(r);
    const impactKeys=['confirmedOnly','planned','conservative'], newEntities=new Set(r.newEvents.filter(x=>x.action==='create').map(x=>x.recordId));
    return `<h3>${e(ACTIONS[r.command.action])} · ${e(MODES[r.options.mode])}首屏</h3><p>固定截止日 ${e(r.options.asOfDate)} · 窗口末日 ${e(r.options.horizonEnd)}</p><p>待确认预览时间 ${e(r.confirmationStamp.previewAt)}。本次新实体 createdAt 标为待确认，最终保存时记录确认时间和本次原因；既有历史时间不改写。</p>${knowledge()}<section><h3>目标计划：完整前后与确认依据</h3>${r.plans.map(p=>`<article class="income-review-plan"><h4>计划 ${e(p.planId)}${newEntities.has(p.planId)?'（本次新建，创建时间待确认）':''}</h4><div class="income-compare"><section><h5>操作前</h5>${planMarkup(ctx,p.before)}<p>目标捕获余量：${e(p.targetHeadroomBefore.kind)} · ${money(ctx,p.targetHeadroomBefore.cents)}</p>${full('完整 before PlanView',p.before,true)}</section><section><h5>操作后</h5>${planMarkup(ctx,p.after)}<p>目标捕获余量：${e(p.targetHeadroomAfter.kind)} · ${money(ctx,p.targetHeadroomAfter.cents)}</p>${full('完整 after PlanView',p.after,true)}</section></div><p>捕获余量含待复核条目，不等于真实已收剩余。</p></article>`).join('')}</section><section><h3>每项归属：捕获 / 当前依据、适用性与日期账户差异</h3>${r.receipts.map(x=>`<article class="income-review-receipt"><h4>${e(x.receipt.id)}${newEntities.has(x.receipt.id)?'（新归属，创建时间待确认）':''}</h4><p>${x.before===null?'本次新增':x.after===null?'本次撤销，历史保留':'此归属保留'} · ${money(ctx,x.receipt.amountCents)} · 参考 ${e(x.receipt.reference||'未填写')}</p><p>proof 比较：${e(x.proofComparison.result)} · 差异字段 ${e(x.proofComparison.differentFields.join('、')||'无 / 不可比较')}。</p>${reviewProof(ctx,'原捕获 / 本次新捕获 proof',x.receipt.proof)}<div class="income-compare"><section><h5>操作前适用性与比较</h5>${x.before?`<p>${e(APPLICABILITY[x.before.applicability])}</p>${warningList(x.before.reasonCodes)}`:'<p>操作前不存在此归属。</p>'}${matchMarkup(x.planMatchBefore)}${full('完整 before ReceiptView',x.before,true)}</section><section><h5>操作后适用性与比较</h5>${x.after?`<p>${e(APPLICABILITY[x.after.applicability])}</p>${warningList(x.after.reasonCodes)}`:'<p>操作后不再活跃，历史保留。</p>'}${matchMarkup(x.planMatchAfter)}${full('完整 after ReceiptView',x.after,true)}</section></div>${full('完整不可变 Receipt 与双侧比较',x,true)}</article>`).join('')||empty('此计划没有当前归属。')}</section><section><h3>来源：原额 / 全部减项 / 普通残余 / 同源归属与容量</h3>${r.sources.map(s=>`<article class="income-review-source"><h4>来源 ${e(s.transactionId)}</h4><p>当前依据 ${e(s.currentBasis)}。${s.currentTransaction?`当前实际类型 ${e(s.currentTransaction.type)} · 日期 ${e(s.currentTransaction.date)} · 原额 ${money(ctx,s.currentTransaction.amountCents)} · 账户 ${e(ctx.accountName(s.currentTransaction.accountId))}`:'来源缺失，当前实际字段不可得。'}</p><p>当前财务依据普通残余（尚未按截止日置零）：${money(ctx,s.ordinaryResidualCents)}。日期 / 账户相同不能独自证明当前是到账普通收入。</p>${reviewProof(ctx,'当前完整 proof',s.currentProof)}${full('全部当前收入侧减项（不可截断）',s.reductionComponents,true)}${full('全部当前主重复链接（不可截断）',s.duplicateLinks,true)}<div class="income-compare"><section><h5>操作前：截止日容量与所有适用归属</h5>${s.before?sourceMarkup(ctx,s.before):'<p>操作前不属于当前来源集合。</p>'}${full('同源全部适用归属（含其他计划）before',s.applicableAllocationsBefore,true)}</section><section><h5>操作后：截止日容量与所有适用归属</h5>${s.after?sourceMarkup(ctx,s.after):'<p>操作后不属于当前来源集合。</p>'}${full('同源全部适用归属（含其他计划）after',s.applicableAllocationsAfter,true)}</section></div></article>`).join('')||empty('没有受影响收入来源。')}</section>${r.operationEligibility?eligibilityMarkup(ctx,r.operationEligibility):'<p>本操作没有新增 / 重核归属资格计算。</p>'}<section><h3>三个模式的完整前后影响</h3><p>三个模式使用同一截止日与窗口。未知只列前后，不进行 null 减法；只列目标计划行，全账合计仍完整。</p>${impactKeys.map(key=>{const s=r.scenarioImpacts[key];return `<article class="income-review-scenario"><h4>${e(MODES[s.mode])}</h4><div class="income-compare"><section><h5>全账合计：操作前</h5>${metrics(ctx,[['窗口完整假设收入',s.before.scheduledTotalCents],['窗口内已知部分',s.before.knownDatedTotalCents],['尾部已知部分',s.before.knownTailTotalCents]])}${full('完整六字段合计 before',s.before,true)}</section><section><h5>全账合计：操作后</h5>${metrics(ctx,[['窗口完整假设收入',s.after.scheduledTotalCents],['窗口内已知部分',s.after.knownDatedTotalCents],['尾部已知部分',s.after.knownTailTotalCents]])}${full('完整六字段合计 after',s.after,true)}</section></div>${full('目标计划完整情景行 before / after',s.rows,true)}</article>`;}).join('')}</section><section><h3>真实财务逐项变化与持久子树</h3><p>口径：全部已记录日期的当前财务模型。这不是截止日可信现金。</p>${metrics(ctx,[['普通收入变化',r.financialDeltas.ordinaryIncomeCents],['个人消费变化',r.financialDeltas.personalExpenseCents],['实际流入变化',r.financialDeltas.cashInCents],['实际流出变化',r.financialDeltas.cashOutCents]])}${r.financialDeltas.accounts.map(a=>`<article><h4>${e(ctx.accountName(a.accountId))} · ${e(a.accountId)}</h4>${metrics(ctx,[['流入变化',a.inflowCents],['流出变化',a.outflowCents],['余额变化',a.balanceCents]])}</article>`).join('')||empty('没有账户。')}${full('所有账户与完整 FinancialDeltas',r.financialDeltas,true)}${full('除版本与 incomePlanning 外全部持久子树比较',r.unchangedSubtrees,true)}<p>本次只改计划与归属注释；以上每个金融分量都应为 0，不能只检查净额。</p></section>${full('本次新增审计事件（撤销指向原 create 事件）',r.newEvents,true)}${full('完整不可变复核 payload',r,true)}`;
  }
  function showReview(ctx,cmd,o,d) {
    dialog(ctx,'逐项核对收入计划影响，再确认保存',`<form id="entry-form" class="income-form income-review">${caveat()}<div id="income-review-body" aria-live="polite">正在生成完整复核内容。</div>${area('本次确认原因（必填）','reason',d.reason,true)}<label class="confirm-check"><input type="checkbox" name="confirmed" required aria-describedby="income-form-error">我已核对完整计划、来源 / 捕获差异、日期 / 账户、所有归属容量、三模式及逐项金融零变化，确认只改变非现金注释</label>${errorBox()}<p id="income-review-status" class="income-warning" role="status"></p><div class="modal-bottom">${cancelButton(ctx)}<button class="btn" type="button" id="income-back">返回修改</button><button class="btn" type="button" id="income-fresh" hidden>重新生成预览并核对</button><button class="btn primary" type="submit" id="income-commit" disabled>确认保存本次注释</button></div></form>`,'',token=>{
      let c;
      const form=bindForm(ctx,token,f=>{
        if(!token.ticket)throw Error('此预览已失效，请重新生成并核对。');
        if(f.elements.namedItem('confirmed')?.checked!==true)throw Error('请明确勾选已核对本次完整预览。');
        const why=reason(read(f,'reason'));d.reason=why;
        const ticket=token.ticket;token.ticket=null;token.submitted=true;ctx.$('#income-commit').disabled=true;
        let saved=false;
        try{saved=ctx.change(()=>{if(!current(ctx,token,form))throw Error('窗口已失效，请重新预览。');return c.commit(stateOf(ctx),ticket,{confirmed:true,reason:why});},'已保存收入计划注释；实际收入与现金记录不变');}catch(error){fail(ctx,error);}
        if(saved===true){invalidate();return;}
        // A failed persistence attempt never revives a consumed capability.
        c.cancel(ticket);
        if(current(ctx,token,form)){form.elements.namedItem('confirmed').checked=false;ctx.$('#income-fresh').hidden=false;ctx.$('#income-review-status').textContent='本次未保存，原账本不变。旧预览已作废；请重新生成、逐项核对并再次勾选确认。';form.dataset.dirty='true';}
      });
      form.dataset.dirty='true';
      ctx.$('#income-back').onclick=()=>{if(!current(ctx,token,form))return;d.reason=read(form,'reason');invalidate();showDraft(ctx,d);};
      ctx.$('#income-fresh').onclick=()=>{if(!current(ctx,token,form))return;d.reason=read(form,'reason');invalidate();showReview(ctx,cmd,o,d);};
      try {
        c=getCoordinator(ctx);const ticket=c.preview(stateOf(ctx),cmd,o);token.ticket=ticket;
        ctx.$('#income-review-body').innerHTML=reviewMarkup(ctx,ticket.review);ctx.$('#income-commit').disabled=false;
      }catch(error){if(token.ticket&&c)c.cancel(token.ticket);token.ticket=null;ctx.$('#income-review-body').innerHTML='<p class="income-warning">没有生成可提交的完整预览；账本未保存。</p>';ctx.$('#income-fresh').hidden=false;fail(ctx,error);}
    });
  }
  function dispose() {
    invalidate();
    if(boundDocument&&clickListener)boundDocument.removeEventListener?.('click',clickListener);
    if(boundDocument&&closeListener){boundDocument.removeEventListener?.('click',closeListener,true);boundDocument.removeEventListener?.('keydown',closeListener,true);}
    context=null;coordinator=null;engineOwner=null;boundDocument=null;clickListener=null;closeListener=null;lifecycle=null;
    asOfDate='';horizonEnd='';mode='confirmed-only';customHorizon=false;planOffset=0;sourceOffset=0;query='';selectedAccount='';
  }
  function initialize(ctx) {
    if(!active(ctx))return;context=ctx;
    if(lifecycle!==ctx.onDispose){lifecycle=ctx.onDispose;ctx.onDispose?.(dispose);}
    if(boundDocument===root.document)return;boundDocument=root.document;if(!boundDocument)return;
    closeListener=event=>{
      if(event.type==='keydown'&&event.key!=='Escape')return;
      if(event.type==='click'&&!event.target.closest?.('[data-close]'))return;
      const token=activeDialog,owner=context;
      // A declined dirty-close must keep both form and ticket usable. Accepted
      // closes are also invalidated explicitly by the host; this is a fallback.
      Promise.resolve().then(()=>{if(token&&activeDialog===token&&owner&&(!token.form||owner.$('#entry-form')!==token.form))invalidate();});
    };
    clickListener=event=>{
      const node=event.target.closest?.('[data-income-action]'),ctx=context;
      if(!node||node.disabled||!ctx||!active(ctx))return;
      const action=node.dataset?.incomeAction,id=node.dataset?.incomeId;
      if(typeof action!=='string'||!action)return;
      const known=['new','detail','edit','cancel','reopen','retire','allocate','reverse','reconfirm','record-income','plans-prev','plans-next','sources-prev','sources-next'];
      if(!known.includes(action))return;
      try {
        if(action==='detail'){planDetails(ctx,id);return;}
        if(action==='record-income'){if(typeof ctx.recordIncome!=='function')throw Error('请从「记一笔」进入真实收入录入。');invalidate();ctx.recordIncome();return;}
        if(action==='plans-prev'||action==='plans-next'){planOffset=Math.max(0,planOffset+(action.endsWith('next')?PAGE_SIZE:-PAGE_SIZE));ctx.render();return;}
        if(action==='sources-prev'||action==='sources-next'){sourceOffset=Math.max(0,sourceOffset+(action.endsWith('next')?PAGE_SIZE:-PAGE_SIZE));ctx.render();return;}
        const mapped={new:'create-plan',edit:'update-plan',cancel:'cancel',reopen:'reopen',retire:'retire-plan',allocate:'allocate-receipt',reverse:'reverse-receipt',reconfirm:'reconfirm-receipt'}[action];
        if(!mapped)return;showDraft(ctx,draft(ctx,mapped,id));
      }catch(error){ctx.error(error.message);}
    };
    boundDocument.addEventListener('click',clickListener);boundDocument.addEventListener('click',closeListener,true);boundDocument.addEventListener('keydown',closeListener,true);
  }
  function bind(ctx) {
    initialize(ctx);if(!active(ctx))return;
    const day=ctx.$('#income-as-of'),end=ctx.$('#income-horizon'),select=ctx.$('#income-mode'),search=ctx.$('#income-query'),account=ctx.$('#income-account');
    if(day)day.onchange=()=>{if(!active(ctx))return;try{if(!ctx.ledger.validDate(day.value))throw Error('请填写有效截止日。');asOfDate=day.value;if(!customHorizon)horizonEnd=defaultHorizon(asOfDate);planOffset=0;sourceOffset=0;invalidate();ctx.render();}catch(error){ctx.error(error.message);}};
    if(end)end.onchange=()=>{if(!active(ctx))return;try{validateOptions(ctx,{asOfDate,horizonEnd:end.value,mode});horizonEnd=end.value;customHorizon=true;invalidate();ctx.render();}catch(error){ctx.error(error.message);}};
    if(select)select.onchange=()=>{if(!active(ctx))return;try{if(!Object.hasOwn(MODES,select.value))throw Error('请选择有效模式。');mode=select.value;invalidate();ctx.render();}catch(error){ctx.error(error.message);}};
    if(search)search.oninput=()=>{if(!active(ctx))return;query=search.value;planOffset=0;ctx.render();};
    if(account)account.onchange=()=>{if(!active(ctx))return;selectedAccount=account.value;try{ctx.$('#income-account-details').innerHTML=accountMarkup(ctx,stateOf(ctx),selectedAccount,asOfDate);}catch(error){ctx.error(error.message);}};
  }
  return Object.freeze({render,bind,initialize,invalidate,planDetails});
}));
