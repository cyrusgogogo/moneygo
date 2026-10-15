/* Local, single-lot recorded principal. The host exclusively owns durable writes. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoneygoHeldFundsUI = api;
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const KINDS = {deposit:'押金',prepayment:'预付款','stored-value':'储值本金'};
  const REFUNDABILITY = {unknown:'未知',refundable:'用户填写：可退',conditional:'用户填写：有条件可退',nonrefundable:'用户填写：不可退'};
  const ACTIONS = {'create-position':'建立实付本金记录','update-position':'修改条款与说明',recognize:'确认非现金消费 / 损失','allocate-return':'分配已到账本金','reverse-recognition':'撤销消费 / 损失分类','reverse-return':'撤销到账本金分配','reverse-position':'撤销本金分类'};
  const PAGE_SIZE = 25;
  let context = null, boundDocument = null, clickListener = null, closeListener = null, activeDialog = null, lifecycle = null;
  let asOfDate = '', query = '', offset = 0;
  const e = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const engine = ctx => ctx.engine || root.MoneygoHeldFunds;
  const today = ctx => typeof ctx.today === 'function' ? ctx.today() : ctx.today;
  const money = (ctx, value) => Number.isSafeInteger(value) ? e(ctx.money(value)) : '未知';
  const button = (action,label,id,extra='') => `<button class="btn" type="button" data-held-action="${e(action)}"${id ? ` data-held-id="${e(id)}"` : ''}${extra}>${e(label)}</button>`;
  const field = (label,name,value,attrs='') => `<label class="field">${e(label)}<input name="${e(name)}" value="${e(value)}" ${attrs}></label>`;
  const area = (label,name,value,required=false) => `<label class="field full">${e(label)}<textarea name="${e(name)}" maxlength="500" rows="3"${required?' required':''}>${e(value)}</textarea></label>`;
  const choices = (name,label,values,value) => `<label class="field">${e(label)}<select name="${e(name)}">${Object.entries(values).map(([id,text])=>`<option value="${e(id)}"${id===value?' selected':''}>${e(text)}</option>`).join('')}</select></label>`;
  const dateField = (name,label,value) => field(label,name,value,'type="date" min="0001-01-01" max="9999-12-31" required');
  const amountField = value => field('金额（人民币元，实付本金口径）','amount',value,'type="text" inputmode="decimal" maxlength="14" required');
  const cancel = ctx => ctx.cancel || '<button class="btn" type="button" data-close>取消</button>';
  const empty = text => `<p class="empty compact">${e(text)}</p>`;
  const full = (label,value,open=false) => `<details class="held-proof"${open?' open':''}><summary>${e(label)}</summary><pre>${e(JSON.stringify(value,null,2))}</pre></details>`;
  const stateOf = ctx => ctx.getState();
  const active = ctx => ctx.isActive?.() !== false;
  function invalidate() { if (activeDialog) { activeDialog.ticket = null; activeDialog.valid = false; } activeDialog = null; }
  function dialog(ctx,title,body,buttons,ready) {
    invalidate(); const token = {valid:true,ticket:null,form:null}; activeDialog = token;
    ctx.modal(title,body,buttons,()=>{ if (activeDialog !== token || !active(ctx)) return; ready?.(token); });
    return token;
  }
  function current(ctx,token,form) { return active(ctx) && token.valid && activeDialog === token && (!form || (token.form === form && ctx.$('#entry-form') === form)); }
  function bindForm(ctx,token,submit) {
    const form = ctx.$('#entry-form'); token.form = form;
    if (!form) throw Error('表单尚未准备好，请重新打开。');
    const dirty = () => { if (current(ctx,token,form)) form.dataset.dirty='true'; };
    form.addEventListener('input',dirty); form.addEventListener('change',dirty);
    form.onsubmit = event => {
      event.preventDefault(); if (!current(ctx,token,form)) return;
      try { if (form.reportValidity && !form.reportValidity()) return; submit(form); } catch (error) { ctx.error(error.message); }
    };
    return form;
  }
  function read(form,name) { const node = form.elements.namedItem(name); if (!node) throw Error('缺少表单字段：'+name); return node.value; }
  function checked(form,name) { const node=form.elements.namedItem(name); return !!node && node.checked === true; }
  function requireReason(value) { if (typeof value!=='string' || !value.trim() || value.length>500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw Error('请填写 1–500 字的确认依据 / 原因，不含无效控制字符。'); return value.trim(); }
  function reasonField(value) { return area('确认依据 / 原因（必填）','reason',value,true); }
  function caveat() { return '<p class="held-caveat">这里只记录单笔实付本金的非现金权利，不是账户余额、可用现金或保证可退金额。不支持赠送额度、面值换算、多批次合并、钱包迁移或损失后追回分类。条款未知时保持未知，不猜测。</p>'; }
  function metrics(ctx,p) { return `<dl class="held-metrics">${[['fundedCents','实付本金'],['usedCents','已确认消费'],['lostCents','已确认损失'],['returnedCents','已到账本金'],['remainingCents','剩余记录本金']].map(([key,label])=>`<div><dt>${label}</dt><dd>${money(ctx,p[key])}</dd></div>`).join('')}</dl>`; }
  function terms(p) {
    const expiry=p.expiry?.kind==='date' ? p.expiry.date : p.expiry?.kind==='none'?'用户填写：无到期日':'未知';
    return `<p>用户填写的到期条款：${e(expiry)} · 退款条款：${e(REFUNDABILITY[p.refundability]||'未知')}</p><p>条款原文：${e(p.terms||'未填写，未知')}<br>条款来源：${e(p.termsSource||'未填写，未知')}</p>`;
  }
  function warnings(ctx,p) {
    const amount=p.expiredUnconsumedRecordedPrincipalCents;
    return `${amount>0?`<p class="held-warning" role="status">已过用户填写的到期日，仍有 ${money(ctx,amount)} 记录本金未消耗。这里只提示核对，不代表法律上的失效，不会自动记损失，也不保证可退款。</p>`:''}${(p.warnings||[]).length?full('本次警示与未知信息',p.warnings,true):''}`;
  }
  function sourceDetails(ctx,source,label) {
    if (!source) return `<p class="held-warning">${e(label)}的来源信息尚未提供。</p>`;
    const t=source.transaction || source;
    return `<section class="held-source"><h3>${e(label)}</h3><p>原始编号 ${e(t.id)} · 原日期 ${e(t.date)} · 原金额 ${money(ctx,t.amountCents)} · 原账户 ${e(source.accountName||ctx.accountName(t.accountId))}</p><p>原分类 ${e(source.categoryName||ctx.categoryName(t.categoryId)||'未分类')} · 商户 ${e(source.merchant||'未填写商户')} · 原备注 ${e(t.note||'未填写')}</p><p>当前普通收支剩余部分 ${money(ctx,source.ordinaryResidualCents)}。本金分类不会改动原始现金记录。</p>${full('完整来源、导入证据与原始字段',source)}</section>`;
  }
  function render(ctx) {
    if (!engine(ctx)) return '<p class="notice warning" role="alert">押金与预付模块未加载，请刷新后重试。</p>';
    try {
      if (!asOfDate) asOfDate=today(ctx);
      const view=engine(ctx).view(stateOf(ctx),{asOfDate});
      const rows=view.positions.filter(p=>`${p.id} ${p.name} ${p.purpose} ${p.reference}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
      offset=Math.min(offset,Math.max(0,Math.floor((rows.length-1)/PAGE_SIZE)*PAGE_SIZE));
      return `<section class="held-workspace" id="held-root"><article class="card"><div class="card-head"><div><h2>押金与预付</h2><p>实际付款、个人消费、剩余记录本金分开看</p></div>${button('new','从真实支出建立记录')}</div>${caveat()}<div class="form-grid"><label class="field">明确的本地核对日期<input id="held-as-of" type="date" min="0001-01-01" max="9999-12-31" value="${e(asOfDate)}" required></label><label class="field">搜索名称、用途、编号或参考<input id="held-query" type="search" maxlength="500" value="${e(query)}"></label></div>${metrics(ctx,view.totals)}<p>以上为 ${e(view.asOfDate)} 当日结束的记录权利。每笔续充建立独立记录；余额用完仍保留原支出的本金占用。</p>${rows.slice(offset,offset+PAGE_SIZE).map(p=>`<article class="held-position"><div class="card-head"><h3>${e(p.name)} · ${e(KINDS[p.kind])}</h3>${button('detail','查看来源、使用与撤销',p.id)}</div>${metrics(ctx,p)}${terms(p)}${warnings(ctx,p)}</article>`).join('')||empty('当前没有符合条件的本金记录。先按真实凭证记入付款，再从已有支出建立记录。')}<div class="held-pager">${button('prev','上一页','',offset===0?' disabled':'')}<span role="status">${rows.length?`${offset+1}–${Math.min(offset+PAGE_SIZE,rows.length)} / ${rows.length}`:'0 条'}</span>${button('next','下一页','',offset+PAGE_SIZE>=rows.length?' disabled':'')}</div></article></section>`;
    } catch (error) { return `<p class="notice warning" role="alert">押金与预付暂时无法读取：${e(error.message)}</p>`; }
  }
  function findPosition(ctx,id) { const p=engine(ctx).view(stateOf(ctx),{asOfDate:asOfDate||today(ctx)}).positions.find(p=>p.id===id); if(!p) throw Error('本金记录已不存在，请重新核对。'); return p; }
  function children(ctx,p) {
    const recognition=(p.recognitions||[]).map(r=>`<article class="held-child"><h4>${r.kind==='use'?'非现金消费':'非现金损失'} · ${money(ctx,r.amountCents)}</h4><p>${e(r.effectiveDate)} · ${e(r.categoryName||ctx.categoryName(r.categoryId))} · ${e(r.merchant||'未填写商户')} · 依据 ${e(r.reason)}</p><p>编号 ${e(r.id)} · 核对日期 ${e(r.asOfDate)} · 实际现金变化 0</p>${button('recognition','查看完整消费 / 损失依据',p.id,` data-held-recognition="${e(r.id)}"`)}${button('reverse-recognition','单独预览撤销',r.id)}</article>`);
    const returns=(p.returns||[]).map(r=>`<article class="held-child"><h4>已到账本金 · ${money(ctx,r.amountCents)}</h4><p>实际收入日期 ${e(r.incomeSignature.date)} · 分配编号 ${e(r.id)} · 依据 ${e(r.reason)}</p>${sourceDetails(ctx,r.source,'已有实际收入')}${button('reverse-return','单独预览撤销到账分配',r.id)}</article>`);
    return [...recognition,...returns].join('')||empty('这笔本金尚无已确认消费、损失或到账本金分配。');
  }
  function historicalPosition(ctx,positionId) {
    const state=ctx.ledger.validateState(stateOf(ctx)), data=state.bookkeeping;
    const audit=(data?.audit||[]).filter(event=>event.kind==='heldPosition'&&event.recordId===positionId||['heldRecognition','heldReturn'].includes(event.kind)&&(event.before?.positionId===positionId||event.after?.positionId===positionId));
    const position=[...audit].reverse().find(event=>event.kind==='heldPosition'&&event.after)?.after;
    if(!position)throw Error('未找到这笔本金的保存历史，请回到冻结月结查看当时的完整证明。');
    return {state,position,audit};
  }
  function capturedSource(ctx,p) {
    const t=p.expenseSignature;
    return `<section class="held-source"><h3>保存时的本金付款签名</h3><p>原始编号 ${e(p.expenseId)} · 保存日期 ${e(t.date)} · 保存金额 ${money(ctx,t.amountCents)} · 保存账户编号 ${e(t.accountId)}</p><p>以下是历史保存值。之后允许的原交易修改不会重写它；当前名称、备注或类别不能代替当时的凭证。</p>${full('不可变历史付款签名',{expenseId:p.expenseId,expenseSignature:t},true)}</section>`;
  }
  function positionDetails(ctx,positionId) {
    try {
      let p;
      try { p=findPosition(ctx,positionId); } catch (_) {
        const history=historicalPosition(ctx,positionId), record=history.position;
        dialog(ctx,'已撤销本金分类的保存历史',`<div class="held-details"><h2>${e(record.name)} · ${e(KINDS[record.kind])}</h2><p class="held-warning">这笔本金分类已撤销，不纳入当前剩余本金。原始交易和历史仍保留；撤销不代表实际退款或资金移动。</p>${terms(record)}${capturedSource(ctx,record)}${full('保存的本金字段',record,true)}${full('完整历史（每项分别撤销，无自动连带删除）',history.audit,true)}</div>`,'<button class="btn" type="button" data-close>关闭</button>');return;
      }
      const hasChildren=(p.recognitions||[]).length+(p.returns||[]).length>0;
      dialog(ctx,'本金记录与完整依据',`<div class="held-details"><h2>${e(p.name)} · ${e(KINDS[p.kind])}</h2><p>记录编号 ${e(p.id)} · 核对截至 ${e(asOfDate||today(ctx))} · 建立时核对日期 ${e(p.asOfDate)}</p>${caveat()}${metrics(ctx,p)}<p>原始本金占用 ${money(ctx,p.amountCents)}，即使用完也不释放来源额度。</p>${terms(p)}${warnings(ctx,p)}<p>用途：${e(p.purpose||'未填写')} · 参考：${e(p.reference||'未填写')} · 建立依据：${e(p.reason)}</p>${sourceDetails(ctx,p.source,'真实付款来源')}<div class="held-actions">${button('use','确认部分消费',p.id)}${button('loss','单独确认损失',p.id)}${button('return','分配实际到账本金',p.id)}${button('metadata','修改条款与说明',p.id)}</div><h3>逐项消费、损失与到账本金</h3>${children(ctx,p)}<h3>撤销分类</h3><p>撤销只改变分类，不移动或退回现金，不删除原交易和历史。先逐项核对并撤销所有子记录，再撤销本金；不会自动连带撤销。</p>${button('reverse-position','预览撤销本金分类',p.id,hasChildren?' disabled':'')}${hasChildren?'<p>仍有子记录，不能撤销本金分类。</p>':''}${full('完整本金记录与来源',p)}${full('审计历史（含已撤销项目）',p.audit||[])}</div>`, '<button class="btn" type="button" data-close>关闭</button>');
    } catch(error) { ctx.error(error.message); }
  }
  function recognitionDetails(ctx,positionId,recognitionId) {
    try {
      const history=historicalPosition(ctx,positionId), data=history.state.bookkeeping;
      const activeRecognition=(data.heldRecognitions||[]).find(r=>r.id===recognitionId&&r.positionId===positionId);
      const creation=history.audit.find(event=>event.kind==='heldRecognition'&&event.recordId===recognitionId&&event.action==='create');
      const r=activeRecognition||creation?.after;
      if(!r||r.positionId!==positionId)throw Error('未找到这项消费 / 损失的保存记录，请回到冻结月结查看当时的完整证明。');
      const p=history.position, retired=!activeRecognition;
      const category=retired?r.categoryProof.name:ctx.categoryName(r.categoryId)||r.categoryProof.name;
      const audit=history.audit.filter(event=>event.kind==='heldRecognition'&&event.recordId===recognitionId);
      dialog(ctx,retired?'已撤销非现金消费 / 损失的保存依据':'非现金消费 / 损失依据',`<div class="held-details"><h2>${e(p.name)} · ${r.kind==='use'?'已确认消费':'已确认损失'}</h2>${retired?'<p class="held-warning">这项分类已撤销，不纳入当前个人收支或剩余本金计算。下面保留原始确认依据，不会自动转给替代事件。</p>':''}<p>${e(r.effectiveDate)} · ${money(ctx,r.amountCents)} · ${e(category)}${retired?'（建立时分类）':''} · 商户 ${e(r.merchant||'未填写商户')}</p><p>实际现金变化 0。来源账户只说明原本金从何处付出，当前没有新付款。</p><p>依据 ${e(r.reason)} · 参考 ${e(r.reference||'未填写')} · 明确核对日期 ${e(r.asOfDate)}</p>${capturedSource(ctx,p)}${full('完整不可变消费 / 损失记录',r,true)}${full('本项创建与撤销历史',audit,true)}</div>`, `<button class="btn" type="button" data-close>关闭</button>${button('detail','返回本金详情',p.id)}${retired?'':button('reverse-recognition','预览单独撤销',r.id)}`);
    } catch(error) { ctx.error(error.message); }
  }
  function metadataFields(d) { return `<div class="form-grid">${field('名称','name',d.name,'maxlength="80" required')}${field('用途','purpose',d.purpose,'maxlength="500"')}${field('参考编号 / 说明','reference',d.reference,'maxlength="500"')}${choices('expiryKind','用户填写的到期条款',{unknown:'未知',none:'明确无到期日',date:'明确到期日期'},d.expiryKind)}${field('到期日期（仅选择明确日期时填写）','expiryDate',d.expiryDate,'type="date" min="0001-01-01" max="9999-12-31"')}${choices('refundability','用户填写的退款条款',REFUNDABILITY,d.refundability)}${area('条款原文（未知可留空）','terms',d.terms)}${area('条款来源（未知可留空）','termsSource',d.termsSource)}</div><p>到期仅提示核对；不会自动记损失。未填写的条款和退款能力保持未知。</p>`; }
  function sourcePicker(ctx,state,role,d) {
    const isFunding=role==='funding', name=isFunding?'expenseId':'incomeId';
    const rows=state.transactions.filter(t=>t.type===(isFunding?'expense':'income')).slice().sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
    return `<label class="field full">${isFunding?'选择已有真实支出':'选择已经入账的真实收入'}<select name="${name}" required><option value="">请逐条核对后选择</option>${rows.map(t=>`<option value="${e(t.id)}"${d[name]===t.id?' selected':''}>${e(t.date)} · ${money(ctx,t.amountCents)} · ${e(ctx.accountName(t.accountId))} · ${e(t.note||t.id)} · ${e(t.id)}</option>`).join('')}</select></label><p>选择后显示完整来源、可分配金额和不可用原因；只有符合来源规则的记录可以进入预览。</p><div id="held-picked-source" aria-live="polite"></div>`;
  }
  function initialDraft(ctx,action,id) {
    const d={action,asOfDate:asOfDate||today(ctx),reason:'',amount:'',reference:''};
    if(action==='create-position') return {...d,expenseId:'',kind:'deposit',name:'',purpose:'',expiryKind:'unknown',expiryDate:'',refundability:'unknown',terms:'',termsSource:'',paidPrincipalOnly:false,noTrackedWalletOverlap:false};
    if(action==='update-position') { const p=findPosition(ctx,id); return {...d,positionId:id,name:p.name,purpose:p.purpose,reference:p.reference,expiryKind:p.expiry.kind,expiryDate:p.expiry.date||'',refundability:p.refundability,terms:p.terms,termsSource:p.termsSource}; }
    if(action==='use'||action==='loss') return {...d,action:'recognize',positionId:id,kind:action,effectiveDate:d.asOfDate,categoryId:'',merchant:'',notAlreadyRecordedAsExpense:false};
    if(action==='allocate-return') return {...d,positionId:id,incomeId:''};
    return {...d,[action==='reverse-recognition'?'recognitionId':action==='reverse-return'?'returnId':'positionId']:id};
  }
  function readDraft(form,d) {
    for(const key of Object.keys(d)) { const n=form.elements.namedItem(key); if(n) d[key]=typeof d[key]==='boolean'?n.checked===true:n.value; }
    d.reason=requireReason(read(form,'reason'));
  }
  function command(ctx,d) {
    const base={action:d.action,asOfDate:d.asOfDate};
    if(!ctx.ledger.validDate(d.asOfDate)) throw Error('请明确填写有效的本地核对日期。');
    if(d.action==='create-position'||d.action==='update-position') {
      const expiry={kind:d.expiryKind,date:d.expiryKind==='date'?d.expiryDate:null};
      const meta={name:d.name,purpose:d.purpose,reference:d.reference,expiry,refundability:d.refundability,terms:d.terms,termsSource:d.termsSource};
      if(d.action==='update-position') return {...base,positionId:d.positionId,...meta};
      if(d.paidPrincipalOnly!==true||d.noTrackedWalletOverlap!==true) throw Error('只可记录已实际支付的本金，并须确认未与已跟踪钱包资产重复；不确定时请暂缓。');
      return {...base,expenseId:d.expenseId,amountCents:ctx.ledger.parseAmount(d.amount),kind:d.kind,...meta,confirmations:{paidPrincipalOnly:true,noTrackedWalletOverlap:true}};
    }
    if(d.action==='recognize') {
      if(d.notAlreadyRecordedAsExpense!==true) throw Error('若已有原始支出代表同一消费 / 损失，请停止本次确认；不要重复记账或隐藏证据。');
      return {...base,positionId:d.positionId,kind:d.kind,amountCents:ctx.ledger.parseAmount(d.amount),effectiveDate:d.effectiveDate,categoryId:d.categoryId,merchant:d.merchant.trim()?d.merchant.trim():null,reference:d.reference,confirmations:{notAlreadyRecordedAsExpense:true}};
    }
    if(d.action==='allocate-return') return {...base,positionId:d.positionId,incomeId:d.incomeId,amountCents:ctx.ledger.parseAmount(d.amount),reference:d.reference};
    if(d.action==='reverse-recognition') return {...base,recognitionId:d.recognitionId};
    if(d.action==='reverse-return') return {...base,returnId:d.returnId};
    return {...base,positionId:d.positionId};
  }
  function showDraft(ctx,d) {
    const state=stateOf(ctx), sourceRole=d.action==='create-position'?'funding':d.action==='allocate-return'?'return':null;
    let body=dateField('asOfDate','明确核对日期（本地记账日）',d.asOfDate);
    if(d.action==='create-position') body+=sourcePicker(ctx,state,'funding',d)+amountField(d.amount)+choices('kind','本金类型',KINDS,d.kind)+metadataFields(d)+'<label class="confirm-check"><input type="checkbox" name="paidPrincipalOnly" required'+(d.paidPrincipalOnly?' checked':'')+'>我确认这里只包含实际支付的本金，不包含赠送额度或面值加成</label><label class="confirm-check"><input type="checkbox" name="noTrackedWalletOverlap" required'+(d.noTrackedWalletOverlap?' checked':'')+'>我确认同一权利没有同时作为钱包余额或其他资产跟踪</label>';
    else if(d.action==='update-position') body+='<p>只改说明与用户填写的条款。本金来源、金额、类型和原确认日期不可在此修改。</p>'+metadataFields(d);
    else if(d.action==='recognize') body+=`<p class="held-warning">本次单独确认${d.kind==='use'?'已经发生的非现金消费':'已确认的非现金损失'}。不会生成付款、账户流水或自动退款。损失不能仅因到期推断。</p><div class="form-grid">${amountField(d.amount)}${dateField('effectiveDate',d.kind==='use'?'真实消费日期':'确认损失的生效日期',d.effectiveDate)}<label class="field">本次个人支出分类<select name="categoryId" required><option value="">请选择本次独立分类</option>${state.categories.filter(c=>c.type==='expense').map(c=>`<option value="${e(c.id)}"${c.id===d.categoryId?' selected':''}>${e(c.name)}</option>`).join('')}</select></label>${field('本次商户（留空为未填写）','merchant',d.merchant,'maxlength="80"')}${field('本次参考 / 凭证','reference',d.reference,'maxlength="500"')}</div><label class="confirm-check"><input type="checkbox" name="notAlreadyRecordedAsExpense" required${d.notAlreadyRecordedAsExpense?' checked':''}>我已核对，没有另一条原始支出记录同一笔消费或损失</label><p>若已有导入消费支出代表同一事项，请停止此流程；系统不会自动消除重复，也不要删除或隐藏证据来继续。</p>`;
    else if(d.action==='allocate-return') body+=sourcePicker(ctx,state,'return',d)+amountField(d.amount)+field('到账分配参考','reference',d.reference,'maxlength="500"')+'<p>日期和账户取自所选真实收入，不能在此另填。这里只分配尚存本金；超出部分仍是普通收入，不自动解释为利息或补偿。有效损失后的追回分类尚不支持，请保留真实收入原分类。</p>';
    else body+='<p class="held-warning">仅撤销这一项分类，不删除原记录、历史或实际收入，不移动现金。不会连带撤销其他项目。本金有子记录时必须先逐项核对并撤销。</p>'+full('本次待撤销对象',{action:d.action,positionId:d.positionId,recognitionId:d.recognitionId,returnId:d.returnId});
    dialog(ctx,d.action==='recognize'?(d.kind==='use'?'确认非现金消费':'单独确认本金损失'):ACTIONS[d.action],`<form id="entry-form" class="held-form">${caveat()}${body}${reasonField(d.reason)}<div class="modal-bottom">${cancel(ctx)}<button class="btn primary" id="held-preview" type="submit">生成影响预览，不保存</button></div></form>`,'',token=>{
      const form=bindForm(ctx,token,f=>{readDraft(f,d);const cmd=command(ctx,d);if(sourceRole){const result=engine(ctx).eligibility(stateOf(ctx),{role:sourceRole,transactionId:sourceRole==='funding'?d.expenseId:d.incomeId,...(sourceRole==='return'?{positionId:d.positionId}:{}),asOfDate:d.asOfDate});if(!result.eligible)throw Error((result.reasons||[]).map(r=>r.message).join('；')||'此来源不可用于本次分配。');}showReview(ctx,engine(ctx).preview(stateOf(ctx),cmd),d,d.reason);});
      if(d.action==='create-position'||d.action==='update-position') {
        const kind=form.elements.namedItem('expiryKind'),date=form.elements.namedItem('expiryDate');
        const updateExpiry=()=>{if(!current(ctx,token,form))return;date.disabled=kind.value!=='date';date.required=kind.value==='date';if(kind.value!=='date')date.value='';};
        kind.onchange=updateExpiry;updateExpiry();
      }
      if(sourceRole) {
        const selection=form.elements.namedItem(sourceRole==='funding'?'expenseId':'incomeId');
        const draw=()=>{if(!current(ctx,token,form))return; const host=ctx.$('#held-picked-source'),submit=ctx.$('#held-preview');
          try {const transactionId=selection.value;if(!transactionId){host.innerHTML=empty('请选择真实来源并核对。');submit.disabled=true;return;}const result=engine(ctx).eligibility(stateOf(ctx),{role:sourceRole,transactionId,...(sourceRole==='return'?{positionId:d.positionId}:{}),asOfDate:read(form,'asOfDate')});host.innerHTML=sourceDetails(ctx,result.source,sourceRole==='funding'?'所选付款来源':'所选实际收入')+`<p>本次最多可分配 ${money(ctx,result.capacityCents)}</p>`+(!result.eligible?`<p class="held-warning">不可用：${e((result.reasons||[]).map(r=>r.message).join('；'))}</p>`:'<p>来源当前符合规则；提交预览时仍会重新核对所有依赖。</p>');submit.disabled=!result.eligible;}catch(error){host.innerHTML=`<p class="held-warning">${e(error.message)}</p>`;submit.disabled=true;}};
        selection.onchange=draw;form.elements.namedItem('asOfDate').onchange=draw;draw();
      }
    });
  }
  function metricChange(ctx,label,before,after) { return `<div><dt>${e(label)}</dt><dd>${money(ctx,before)} → ${money(ctx,after)}</dd></div>`; }
  function reviewMarkup(ctx,ticket) {
    const r=ticket.review;
    return `<h3>${e(ACTIONS[ticket.action])} · 明确核对日 ${e(ticket.asOfDate)}</h3><p>以下完整内容来自本次不可变预览。每项本金、消费、损失和到账分配各自留审计。</p><dl class="held-metrics">${[['fundedCents','实付本金'],['usedCents','已确认消费'],['lostCents','已确认损失'],['returnedCents','已到账本金'],['remainingCents','剩余记录本金']].map(([key,label])=>metricChange(ctx,label,r.before?.totals?.[key],r.after?.totals?.[key])).join('')}</dl><p class="held-warning">${(r.backdatedMonths||[]).length?'回溯修改影响以前月份：'+e(r.backdatedMonths.join('、'))+'。请逐月核对。':'请核对以下所有受影响月份，金额和分类按各自真实生效日期归属。'}</p>${full('实际现金、账户流量与可用资金角色影响（分类操作应为零）',r.actualDeltas,true)}${full('所有来源 / 收入：原金额、日期、账户、证据及普通剩余部分',r.sources,true)}${full('每个受影响月份',r.changedMonths,true)}${full('所有受影响历史截止日的本金权利',r.rights,true)}${full('所有分类变化',r.categories)}${full('所有商户变化',r.merchants)}${full('沙盘基准、排除项身份与变化',r.scenario)}${full('所有已有冻结月结的差异',r.frozenComparisons)}${full('条款、未知信息与警示',r.warnings,true)}${full('操作前完整本金权利、子记录、条款和来源',r.before)}${full('操作后完整本金权利、子记录、条款和来源',r.after)}${full('本次精确操作及全部预览字段',ticket)}`;
  }
  function showReview(ctx,ticket,d,reason) {
    dialog(ctx,'逐项核对影响，再确认保存',`<form id="entry-form" class="held-form held-review">${caveat()}${reviewMarkup(ctx,ticket)}${reasonField(reason)}<label class="confirm-check"><input type="checkbox" name="confirmed" required>我已核对来源、日期、所有月份、分类、商户、现金不变、权利与条款警示，并确认本次单项分类</label><p id="held-review-status" class="held-warning" role="alert"></p><div class="modal-bottom">${cancel(ctx)}<button class="btn" type="button" id="held-back">返回修改</button><button class="btn" type="button" id="held-fresh-review" hidden>重新生成预览并核对</button><button class="btn primary" id="held-commit" type="submit">确认保存本次分类</button></div></form>`,'',token=>{
      token.ticket=ticket;
      const form=bindForm(ctx,token,f=>{
        if(!token.ticket) throw Error('旧预览已失效。请重新预览、核对并再次勾选确认。');
        if(!checked(f,'confirmed')) throw Error('请明确勾选已核对本次预览。');
        const reason=requireReason(read(f,'reason')); d.reason=reason;
        const reviewed=token.ticket; token.ticket=null;ctx.$('#held-commit').disabled=true;
        let saved=false;
        try {saved=ctx.change(()=>{if(!current(ctx,token,form))throw Error('对话框已失效，请重新核对。');return engine(ctx).commit(stateOf(ctx),reviewed,{confirmed:true,reason});},'已保存本次本金分类；原始现金记录不变');}catch(error){ctx.error(error.message);}
        if(saved===true){invalidate();return;}
        if(current(ctx,token,form)){form.elements.namedItem('confirmed').checked=false;ctx.$('#held-fresh-review').hidden=false;ctx.$('#held-review-status').textContent='本次未保存。预览已作废，原账本与现金记录不变。请重新生成预览、核对并再次勾选确认；不能重用旧确认。';form.dataset.dirty='true';}
      });form.dataset.dirty='true';
      const back=ctx.$('#held-back'),fresh=ctx.$('#held-fresh-review');
      back.onclick=()=>{if(!current(ctx,token,form))return;d.reason=read(form,'reason');token.ticket=null;showDraft(ctx,d);};
      fresh.onclick=()=>{if(!current(ctx,token,form))return;token.ticket=null;try{const reason=read(form,'reason');showReview(ctx,engine(ctx).preview(stateOf(ctx),command(ctx,d)),d,reason);}catch(error){ctx.error(error.message);}};
    });
  }
  function dispose() {
    invalidate();
    if(boundDocument&&clickListener)boundDocument.removeEventListener?.('click',clickListener);
    if(boundDocument&&closeListener){boundDocument.removeEventListener?.('click',closeListener,true);boundDocument.removeEventListener?.('keydown',closeListener,true);}
    context=null;boundDocument=null;clickListener=null;closeListener=null;lifecycle=null;asOfDate='';query='';offset=0;
  }
  function initialize(ctx) {
    if(!active(ctx))return;
    context=ctx;
    if(lifecycle!==ctx.onDispose){lifecycle=ctx.onDispose;ctx.onDispose?.(dispose);}
    if(boundDocument===root.document)return;
    boundDocument=root.document;if(!boundDocument)return;
    closeListener=event=>{
      if(event.type==='keydown'&&event.key!=='Escape')return;
      if(event.type==='click'&&!event.target.closest?.('[data-close]'))return;
      const token=activeDialog,ctx=context;
      // The host may decline a dirty-form close. Inspect after it handles the
      // event so a declined cancellation does not leave an unusable live form.
      Promise.resolve().then(()=>{if(token&&activeDialog===token&&ctx&&(!token.form||ctx.$('#entry-form')!==token.form))invalidate();});
    };
    boundDocument.addEventListener('click',closeListener,true);boundDocument.addEventListener('keydown',closeListener,true);
    clickListener=event=>{
      const target=event.target.closest?.('[data-held-action]'),ctx=context;
      if(!target||target.disabled||!ctx||!active(ctx))return;
      const action=target.dataset.heldAction,id=target.dataset.heldId;
      if(!['prev','next','new','metadata','return','use','loss','detail','recognition','reverse-recognition','reverse-return','reverse-position'].includes(action))return;
      try {
        if(action==='prev'||action==='next'){offset=Math.max(0,offset+(action==='prev'?-PAGE_SIZE:PAGE_SIZE));ctx.render();return;}
        const existing=ctx.$('#entry-form');if(existing?.dataset.dirty==='true'){if(typeof root.confirm!=='function'||!root.confirm('放弃尚未保存的内容并打开本金核对？'))return;existing.dataset.dirty='false';}
        if(action==='detail')positionDetails(ctx,id);else if(action==='recognition')recognitionDetails(ctx,id,target.dataset.heldRecognition);else showDraft(ctx,initialDraft(ctx,action==='new'?'create-position':action==='metadata'?'update-position':action==='return'?'allocate-return':action,id));
      }catch(error){ctx.error(error.message);}
    };boundDocument.addEventListener('click',clickListener);
  }
  function bind(ctx) {
    initialize(ctx);if(!active(ctx))return;
    const day=ctx.$('#held-as-of'),search=ctx.$('#held-query');
    if(day)day.onchange=()=>{if(!active(ctx))return;try{if(!ctx.ledger.validDate(day.value))throw Error('请填写有效核对日期。');asOfDate=day.value;offset=0;invalidate();ctx.render();}catch(error){ctx.error(error.message);}};
    if(search)search.oninput=()=>{if(!active(ctx))return;query=search.value;offset=0;ctx.render();};
  }
  return Object.freeze({render,bind,initialize,positionDetails,recognitionDetails});
}));
