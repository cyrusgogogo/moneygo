/* Local bookkeeping UI. Load after relations.js; no network or storage access. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoneygoBookkeepingUI = api;
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const PAGE_SIZE = 25;
  const cashLabel = (ctx, label) => root.MoneygoObligationsUI?.legacyCashLabel(ctx, label) || label;
  const roleNotice = ctx => root.MoneygoObligationsUI?.legacyScopeNotice(ctx) || '';

  const TYPES = { income: '收入', expense: '支出', transfer: '转账' };
  const KINDS = { heldPosition:'押金与预付本金', heldRecognition:'非现金使用或损失', heldReturn:'实际退回本金', link: '重复证据关联', refund: '到账退款分配', claim: '报销 / 垫付应收', settlement: '实际回款分配', snapshot: '日终余额快照', refundPlan: '待退款计划', transferPair: '本人账户转账配对', composite: '购买组合证据' };
  const COLLECTIONS = { link: 'links', refund: 'refunds', claim: 'claims', settlement: 'settlements', snapshot: 'snapshots', refundPlan: 'refundPlans', transferPair: 'transferPairs', composite: 'composites' };
  const CLAIM_STATUS = { unsubmitted: '未提交', incomplete: '材料待补齐', submitted: '已提交' };
  const PLAN_STATUS = { waiting: '等待到账', cancelled: '已取消', closed: '已结束' };
  const RECEIPT_STATUS = { unreceived: '未到账', partial: '部分到账', received: '已足额到账' };
  const TABS = [['evidence', '证据核对'], ['composites', '购买组合'], ['transfers', '本人账户转移'], ['refunds', '退款'], ['claims', '报销与垫付'], ['snapshots', '账户对账'], ['audit', '操作历史']];
  const ui = { tab: 'evidence', query: '', transferQuery: '', offsets: Object.create(null), month: '' };
  let boundDocument = null, context = null;
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const e = value => escape(value);
  const amount = (ctx, cents) => e(ctx.money(cents));
  const stateOf = ctx => ctx.getState();
  const engineOf = ctx => ctx.engine || root.MoneygoRelations;
  const dataOf = (ctx, state) => state.bookkeeping || engineOf(ctx).defaultState();
  const txOf = (state, id) => state.transactions.find(t => t.id === id);
  const txName = (ctx, t) => t ? t.note || ctx.categoryName(t.categoryId) || TYPES[t.type] || '交易' : '交易不存在';
  const dateNow = ctx => typeof ctx.today === 'function' ? ctx.today() : ctx.today;
  const select = (value, option) => value === option ? ' selected' : '';
  const cancel = ctx => ctx.cancel || '<button class="btn" type="button" data-close>取消</button>';
  const button = (action, label, id, extra) => `<button type="button" class="btn" data-bk-action="${e(action)}"${id ? ` data-bk-id="${e(id)}"` : ''}${extra || ''}>${e(label)}</button>`;
  function actionLink(action, label, id, extra) { return `<button type="button" class="text-link" data-bk-action="${e(action)}"${id ? ` data-bk-id="${e(id)}"` : ''}${extra || ''}>${e(label)}</button>`; }
  function txSummary(ctx, t, detail) {
    if (!t) return '<span class="bk-warning-text">交易不存在，请刷新账本后重试。</span>';
    return `<span class="bk-tx-name">${e(txName(ctx, t))}</span><span class="bk-tx-meta">${e(t.date)} · ${e(TYPES[t.type])} ${amount(ctx, t.amountCents)} · ${e(ctx.accountName(t.accountId))}${t.type === 'transfer' ? ` → ${e(ctx.accountName(t.toAccountId))}` : ` · ${e(ctx.categoryName(t.categoryId))}`}</span>${detail ? `<span class="bk-record-id">交易编号 ${e(t.id)}</span>` : ''}`;
  }
  function txLink(ctx, state, id) { const t = txOf(state, id); return `<button type="button" class="bk-tx-link" data-bk-action="details" data-bk-id="${e(id)}">${txSummary(ctx, t, true)}</button>`; }
  function eventTransactionId(event) { if (event.route.kind !== 'transaction') throw Error('不支持的个人口径来源'); return event.route.transactionId; }
  function eventTxLink(ctx, transactions, event) {
    if(event.route.kind==='held-recognition'){
      if(event.key.kind!=='held-recognition'||event.key.id!==event.route.recognitionId||event.origin.positionId!==event.route.positionId||event.origin.recognitionId!==event.route.recognitionId)throw Error('核销事项来源不完整');
      const state=stateOf(ctx),position=(state.bookkeeping.heldPositions||[]).find(p=>p.id===event.route.positionId),recognition=(state.bookkeeping.heldRecognitions||[]).find(r=>r.id===event.route.recognitionId);
      if(!position||!recognition||recognition.positionId!==position.id)throw Error('核销事项已改变');
      return `<button type="button" class="bk-tx-link" data-bk-action="held-recognition" data-bk-id="${e(recognition.id)}" data-bk-position="${e(position.id)}"><strong>${e(position.name)} · ${recognition.kind==='loss'?'确认损失':'实际使用'}</strong><span class="bk-tx-meta">${e(event.effectiveDate)} · ${e(ctx.categoryName(event.categoryId))} · 非现金，账户变化为零</span></button>`;
    }
    const id = eventTransactionId(event), transaction = transactions.get(id);
    if (!transaction || event.origin.kind !== 'transaction' || event.origin.transactionId !== id) throw Error('个人口径来源记录不完整');
    return `<button type="button" class="bk-tx-link" data-bk-action="details" data-bk-id="${e(id)}">${txSummary(ctx, transaction, true)}</button>`;
  }
  function empty(text) { return `<div class="empty compact">${e(text)}</div>`; }
  function clampPage(key, length) { const last = Math.max(0, Math.floor((length - 1) / PAGE_SIZE) * PAGE_SIZE); ui.offsets[key] = Math.min(ui.offsets[key] || 0, last); return ui.offsets[key]; }
  function pager(key, offset, total) {
    if (total <= PAGE_SIZE) return `<p class="bk-count">共 ${total} 条</p>`;
    return `<div class="bk-pager" aria-label="分页"><button class="btn" type="button" data-bk-action="page" data-bk-key="${e(key)}" data-bk-delta="-1" ${offset === 0 ? 'disabled' : ''}>上一页</button><span role="status">${offset + 1}–${Math.min(offset + PAGE_SIZE, total)} / ${total}</span><button class="btn" type="button" data-bk-action="page" data-bk-key="${e(key)}" data-bk-delta="1" ${offset + PAGE_SIZE >= total ? 'disabled' : ''}>下一页</button></div>`;
  }
  function paged(ctx, key, rows, renderer, message) { const offset = clampPage(key, rows.length); return (rows.length ? rows.slice(offset, offset + PAGE_SIZE).map(renderer).join('') : empty(message)) + pager(key, offset, rows.length); }
  function card(title, copy, body, actions) { return `<article class="card bk-card"><div class="card-head"><div><h2>${e(title)}</h2>${copy ? `<p>${e(copy)}</p>` : ''}</div>${actions ? `<div class="bk-actions">${actions}</div>` : ''}</div>${body}</article>`; }
  function field(label, name, value, attrs) { return `<label class="field">${e(label)}<input name="${e(name)}" value="${e(value || '')}" ${attrs || ''}></label>`; }
  function textarea(label, name, value, required) { return `<label class="field full">${e(label)}<textarea name="${e(name)}" rows="3" maxlength="500" ${required ? 'required' : ''}>${e(value || '')}</textarea></label>`; }
  function enumSelect(label, name, values, value) { return `<label class="field">${e(label)}<select name="${e(name)}">${Object.entries(values).map(([key, text]) => `<option value="${e(key)}"${select(value, key)}>${e(text)}</option>`).join('')}</select></label>`; }
  function formBody(ctx, body, submit) { return `<form id="entry-form" class="bk-form">${body}<div class="modal-bottom">${cancel(ctx)}<button class="btn primary" type="submit">${e(submit)}</button></div></form>`; }
  function bindForm(ctx, onSubmit, ready) {
    const form = ctx.$('#entry-form');
    if (!form) return;
    form.addEventListener('input', () => { form.dataset.dirty = 'true'; });
    form.addEventListener('change', () => { form.dataset.dirty = 'true'; });
    form.onsubmit = event => { event.preventDefault(); if (ctx.$('#entry-form') !== form) return; if (typeof form.reportValidity === 'function' && !form.reportValidity()) return; try { onSubmit(form); } catch (error) { ctx.error(error.message); } };
    if (ready) ready(form);
  }
  function value(form, name) { return form.elements.namedItem(name).value; }
  function requireChoice(form, name, label) { const result = value(form, name); if (!result) throw Error('请先选择' + label); return result; }
  function parseAmount(ctx, input, signed) { return ctx.ledger.parseAmount(input, signed ? { allowNegative: true, allowZero: true } : undefined); }
  function receiptInfo(ctx, impact) { if(impact.heldReturnCents>0)return '该收入已有退回本金分配，整笔来源暂不能另作退款/应收回款；剩余部分仍按普通收入显示。';return `这笔收入尚可分配 ${ctx.money(impact.availableIncomeCents)}；已分配 ${ctx.money(impact.allocatedIncomeCents)}。`; }
  function expenseInfo(ctx, impact) { if(impact.heldFundingCents>0)return '该支出已有押金预付本金分类，整笔来源暂不能同时分配退款/应收或作为其他消费证据；原记录个人残余不表示可复用。';return `原支出尚可分配 ${ctx.money(impact.refundableExpenseCents)}；已退款 ${ctx.money(impact.refundCents)}，应收份额 ${ctx.money(impact.claimCents)}。`; }
  function pickerMarkup(name, label) {
    return `<fieldset class="bk-picker" data-bk-picker="${e(name)}"><legend>${e(label)}</legend><input type="hidden" name="${e(name)}"><label class="field">搜索日期、备注、账户、金额或交易编号<input type="search" data-bk-search maxlength="500" autocomplete="off"></label><p data-bk-picked class="bk-picked" aria-live="polite">尚未选择</p><div data-bk-pick-list class="bk-pick-list"></div><div class="bk-pager"><button class="btn" type="button" data-bk-pick-prev>上一页</button><span data-bk-pick-count role="status"></span><button class="btn" type="button" data-bk-pick-next>下一页</button></div></fieldset>`;
  }
  // Every eligible transaction is reachable through search and pagination. Selection survives paging/search.
  function setupPicker(ctx, form, name, rows, selectedId, onChange) {
    const host = form.querySelector(`[data-bk-picker="${name}"]`), hidden = form.elements.namedItem(name), input = host.querySelector('[data-bk-search]');
    const list = host.querySelector('[data-bk-pick-list]'), picked = host.querySelector('[data-bk-picked]');
    const prev = host.querySelector('[data-bk-pick-prev]'), next = host.querySelector('[data-bk-pick-next]'), count = host.querySelector('[data-bk-pick-count]');
    const entries = rows.slice().sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    let offset = 0;
    hidden.value = entries.some(t => t.id === selectedId) ? selectedId : '';
    function draw() {
      const q = input.value.toLocaleLowerCase().trim();
      const filtered = entries.filter(t => `${t.date} ${t.id} ${t.note} ${ctx.accountName(t.accountId)} ${t.toAccountId ? ctx.accountName(t.toAccountId) : ''} ${ctx.categoryName(t.categoryId)} ${ctx.money(t.amountCents)} ${ctx.amountText(t.amountCents)}`.toLocaleLowerCase().includes(q));
      const last = Math.max(0, Math.floor((filtered.length - 1) / PAGE_SIZE) * PAGE_SIZE); offset = Math.min(offset, last);
      list.innerHTML = filtered.slice(offset, offset + PAGE_SIZE).map(t => `<button type="button" class="bk-pick-row${hidden.value === t.id ? ' selected' : ''}" data-bk-pick-id="${e(t.id)}" aria-pressed="${hidden.value === t.id}">${txSummary(ctx, t, true)}</button>`).join('') || empty('没有符合条件的交易。请调整搜索，或先在交易明细记入真实交易。');
      const current = entries.find(t => t.id === hidden.value); picked.innerHTML = current ? `<strong>已选择</strong>${txSummary(ctx, current, true)}` : '尚未选择';
      count.textContent = filtered.length ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, filtered.length)} / ${filtered.length} 笔（可选共 ${entries.length} 笔）` : `0 笔（可选共 ${entries.length} 笔）`;
      prev.disabled = offset === 0; next.disabled = offset + PAGE_SIZE >= filtered.length;
    }
    input.oninput = () => { if (ctx.isActive?.() === false) return; offset = 0; draw(); };
    prev.onclick = () => { offset = Math.max(0, offset - PAGE_SIZE); draw(); list.querySelector('button')?.focus(); };
    next.onclick = () => { offset += PAGE_SIZE; draw(); list.querySelector('button')?.focus(); };
    list.onclick = event => { const target = event.target.closest('[data-bk-pick-id]'); if (!target) return; hidden.value = target.dataset.bkPickId; form.dataset.dirty = 'true'; draw(); if (onChange) onChange(hidden.value); list.querySelector(`[data-bk-pick-id="${hidden.value}"]`)?.focus(); };
    draw(); if (onChange) onChange(hidden.value);
  }
  const heldSourceCache=new WeakMap();
  function heldSourceIds(state){let ids=heldSourceCache.get(state);if(!ids){ids=new Set([...(state.bookkeeping?.heldPositions||[]).map(row=>row.expenseId),...(state.bookkeeping?.heldReturns||[]).map(row=>row.incomeId)]);heldSourceCache.set(state,ids);}return ids;}
  function eligibleTransactions(state, calculated, type, available) { return state.transactions.filter(t => !heldSourceIds(state).has(t.id) && (!type || t.type === type) && (type !== 'expense' || calculated.impacts[t.id].personalAuthority !== false) && !calculated.impacts[t.id].excluded && !calculated.impacts[t.id].transferPairId && (!available || calculated.impacts[t.id][available] > 0)); }
  function reportSummary(ctx, month) {
    const calculated = engineOf(ctx).calculate(stateOf(ctx), month), monthAttr = month ? ` data-bk-month="${e(month)}"` : '';
    const metric = (label, cents, mode, hint) => `<button type="button" class="bk-metric" data-bk-action="drilldown" data-bk-id="${e(mode)}"${monthAttr}><span>${e(label)}</span><strong>${amount(ctx, cents)}</strong><small>${e(hint)} · 查看明细</small></button>`;
    return `${roleNotice(ctx)}<section class="bk-summary" aria-label="${e(cashLabel(ctx, '对外现金与个人口径'))}">${metric('个人消费', calculated.personal.expenseCents, 'personal-expense', stateOf(ctx).bookkeeping?.version>=4?'原支出残余＋按各自日期确认的非现金使用/损失':'原支出 − 到账退款 − 第三方应收份额')}${metric('普通收入', calculated.personal.incomeCents, 'ordinary-income', stateOf(ctx).bookkeeping?.version>=4?'实际收入扣除已分配退款、回款和退回本金':'实际收入扣除已分配退款和回款')}${metric(cashLabel(ctx, '对外现金流入'), calculated.cash.incomeCents, 'cash-income', '真实收入日期；排除已确认的本人转移')}${metric(cashLabel(ctx, '对外现金流出'), calculated.cash.expenseCents, 'cash-expense', '真实支出日期；排除已确认的本人转移')}${metric('当前未收回款', calculated.receivables.outstandingCents, 'receivables', '全部日期的应收余额，不是可用现金')}${`<button type="button" class="bk-metric" data-bk-action="drilldown" data-bk-id="excluded"${monthAttr}><span>重复证据</span><strong>${calculated.excludedEvidence.length} 条</strong><small>完整保留但不重复计金额 · 查看明细</small></button>`}</section><p class="bk-method-note">后续到账退款会重算原购买月份的个人消费；应收份额也归原支出月份。${e(cashLabel(ctx, '对外现金结余'))} ${amount(ctx, calculated.cash.netCents)}，不含本人账户转移和期初余额。未收回款始终显示全账本当前余额。</p>${accountFlowSummary(ctx, calculated, month)}`;
  }
  function accountFlowSummary(ctx, calculated, month) {
    if (!calculated.accountFlows) return '';
    const flows = calculated.accountFlows, monthAttr = month ? ` data-bk-month="${e(month)}"` : '';
    const metric = (label, cents, mode, hint) => `<button type="button" class="bk-metric" data-bk-action="drilldown" data-bk-id="${mode}"${monthAttr}><span>${label}</span><strong>${amount(ctx, cents)}</strong><small>${hint} · 查看原交易</small></button>`;
    return `<section class="bk-movement-summary" aria-label="全部账户实际变动"><h3>全部账户实际变动</h3><p class="bk-copy">包含对外收支和本人账户转移；每一边保留实际记账日期，期初余额不计入流量。</p><div class="bk-summary">${metric('账户总流入', flows.inflowCents, 'account-inflow', '含本人转入')}${metric('账户总流出', flows.outflowCents, 'account-outflow', '含本人转出')}${metric('账户净变动', flows.netCents, 'account-net', '总流入 − 总流出')}${metric('其中：本人转入', flows.transferInCents, 'account-transfer-in', '按转入原记录日期')}${metric('其中：本人转出', flows.transferOutCents, 'account-transfer-out', '按转出原记录日期')}${metric('转移本金（计一次）', calculated.cash.transferCents, 'transfer-principal', '仅按转出日期统计一次')}</div><p class="bk-method-note">跨日、跨月配对不会把到账提前：只含转出一边的月份，账户净变动可以为负；只含转入一边的月份可以为正。这是已记录日期之间的在途口径，不是银行实时在途状态。手工双边转账的两边记在同一天。确认本人转移后，个人消费与普通收入都为零；手续费与后续现金消费另记支出。</p></section>`;
  }
  function transferPairSummary(ctx, state, row) {
    return `<div class="bk-pair"><div><span class="bk-label">本人转出 · 原支出</span>${txLink(ctx, state, row.expenseId)}</div><div><span class="bk-label">本人转入 · 原收入</span>${txLink(ctx, state, row.incomeId)}</div></div>`;
  }
  function transferRows(ctx, state, calculated) {
    const data = dataOf(ctx, state), allocated = new Set();
    for (const collection of ['refunds', 'claims', 'settlements', 'refundPlans', 'transferPairs']) for (const row of data[collection] || []) for (const id of [row.expenseId, row.incomeId]) if (id) allocated.add(id);
    return state.transactions.filter(t => t.type !== 'transfer' && !calculated.impacts[t.id].excluded && !calculated.impacts[t.id].compositeId && !heldSourceIds(state).has(t.id) && !allocated.has(t.id));
  }
  function sourceSummary(ctx, state, id) {
    const rows = (state.imports?.evidence || []).filter(row => row.transactionId === id);
    return rows.length ? `<ul class="bk-source-list">${rows.map(row => `<li>来源 ${e(row.sourceKey)} · 状态 ${e(row.status)}${row.mapped?.channel ? ' · 渠道 ' + e(row.mapped.channel) : ''}${row.stableId ? ' · 原始编号 ' + e(row.stableId) : ''}</li>`).join('')}</ul>` : '<p class="bk-tx-meta">没有导入来源；这条手工记录也需核对原始凭证。</p>';
  }
  function transferReviewToken(state, ids) {
    return JSON.stringify({ transactions: ids.map(id => txOf(state, id) || null), accounts: state.accounts, bookkeeping: state.bookkeeping || null, evidence: (state.imports?.evidence || []).filter(row => ids.includes(row.transactionId)) });
  }
  function requireTransferReview(state, ids, token) {
    if (transferReviewToken(state, ids) !== token) throw Error('核对期间记录、账户、来源或关联已变化。请关闭后重新核对，不会使用旧确认保存。');
  }
  function pairedTransactionNumbers(ctx, state, transaction, impact, data) {
    const pair = (data.transferPairs || []).find(row => row.id === impact.transferPairId);
    return `<div class="notice"><span>已确认本人账户${impact.transferRole === 'out' ? '转出' : '转入'}：本条原交易仍影响原账户余额，对外现金、个人消费和普通收入均为零。金额和日期未被改写。</span></div><dl class="bk-numbers"><div><dt>本账户实际变动</dt><dd>${amount(ctx, impact.accountSignedCents)}</dd></div><div><dt>实际记账日期</dt><dd>${e(transaction.date)}</dd></div><div><dt>转移本金</dt><dd>${amount(ctx, pair.amountCents)}</dd></div></dl>${transferPairSummary(ctx, state, pair)}<p class="bk-copy">配对依据：${e(pair.reason)}</p>`;
  }
  function renderTransfers(ctx, state, data, calculated) {
    const allowed = new Set(transferRows(ctx, state, calculated).map(t => t.id));
    const rows = state.transactions.filter(t => t.type !== 'transfer' && !calculated.impacts[t.id].excluded && !calculated.impacts[t.id].transferPairId).filter(t => `${t.date} ${t.id} ${t.note} ${ctx.accountName(t.accountId)} ${ctx.money(t.amountCents)}`.toLocaleLowerCase().includes(ui.transferQuery.toLocaleLowerCase())).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    const list = `<label class="field bk-search">搜索待人工核对的收支<input id="bk-transfer-search" type="search" maxlength="500" value="${e(ui.transferQuery)}" placeholder="日期、备注、账户、金额或编号"></label>${paged(ctx, 'transferRows', rows, t => `<section class="bk-record"><div>${txLink(ctx, state, t.id)}<span class="bk-badge warning">${allowed.has(t.id) ? '未配对 · 用途待人工确认' : '已有其他关联 · 暂不能配对'}</span></div><div class="bk-actions">${button('transfer', '选择并核对另一边', t.id, allowed.has(t.id) ? '' : ' disabled')}</div></section>`, '没有符合搜索条件的未配对记录。没有记录不代表数据完整。')}`;
    const pairs = paged(ctx, 'transferPairs', (data.transferPairs || []).slice().reverse(), row => `<section class="bk-record bk-record-stack"><div class="bk-record-heading"><strong>${amount(ctx, row.amountCents)} 本人账户转移</strong><span class="bk-badge good">人工已确认 · 两边证据保留</span></div>${transferPairSummary(ctx, state, row)}<p class="bk-copy">${e(row.reason)}</p><div class="bk-actions">${unlinkButton(row.id, 'transferPair')}</div></section>`, '还没有人工确认的双边转账配对。');
    return card('核对本人账户之间的资金搬运', '只接受一条原支出与另一本人账户的等额原收入。日期可以不同；金额相同、名称相似或渠道相同都不能证明是同一次转移。', `<div class="notice"><span>这里的未配对清单只是现有收支，不表示它们一定是转账。缺少另一边时保留原记录与未知状态，不会生成收入、虚构到账或自动改分类。</span></div>${list}`, button('transfer', '选择两条原记录')) + card('已确认的本人转账配对', '金额保留到分；账户余额与原始日期不变。转移本金只在转出日统计一次。', pairs) + card('现金取出与后续消费', '取现应使用账本中已有的现金账户。已有两条实际记录时可配对；只有准备手工记账且两边均已核实同日发生时，可在「记一笔 → 转账」选择本人账户与已有现金账户。', '<p class="bk-copy">单边导入保持未配对，不能再添加一笔完整手工转账来补另一边，避免重复扣款。现金账户名称不自动证明账户性质；请自己确认。手续费单独记支出，后来用现金买东西再记现金账户支出。这里只记账，不执行提现或转账。</p>');
  }
  function showTransfer(ctx, originId) {
    const state = stateOf(ctx), calculated = engineOf(ctx).calculate(state), available = transferRows(ctx, state, calculated), origin = originId ? available.find(t => t.id === originId) : null;
    if (originId && !origin) throw Error('这条记录已有转账、退款、应收或其他依赖，或是重复证据。请先核对相关关联。');
    const selectionIds = available.map(t => t.id), selectionToken = transferReviewToken(state, selectionIds);
    const body = `<p class="bk-copy">先明确选择两条已经入账的原记录。另一边不会自动选中。金额须完全相同，方向相反，且来自两个不同的本人账户；不要求同日。</p>${pickerMarkup('expenseId', '1. 本人账户实际转出（原支出）')}${pickerMarkup('incomeId', '2. 另一本人账户实际转入（原收入）')}<div id="bk-transfer-facts" aria-live="polite"></div><p class="bk-method-note">找不到另一边时，请取消并核对原始账单。现有证据保持未配对，不凭空补另一边。手续费另记支出。</p>`;
    ctx.modal('选择本人转移的两边原记录', formBody(ctx, body, '继续核对这两边'), '', () => bindForm(ctx, form => {
      const expenseId = requireChoice(form, 'expenseId', '实际转出的原支出'), incomeId = requireChoice(form, 'incomeId', '实际转入的原收入');
      const latest = stateOf(ctx); requireTransferReview(latest, selectionIds, selectionToken);
      const selected = available.filter(t => t.id === expenseId || t.id === incomeId);
      if (selected.length !== 2) throw Error('请只选择当前可配对的两条原记录');
      form.dataset.dirty = 'false'; showTransferConfirmation(ctx, expenseId, incomeId);
    }, form => {
      let chosenIncome = origin?.type === 'income' ? origin.id : '';
      function showFacts() {
        const expense = txOf(state, value(form, 'expenseId')), income = txOf(state, value(form, 'incomeId'));
        ctx.$('#bk-transfer-facts').innerHTML = expense && income ? transferFacts(ctx, state, expense, income) : '<p class="bk-copy">尚未选齐两边。未配对不是已确认转账，当前不会改变任何金额。</p>';
      }
      setupPicker(ctx, form, 'expenseId', available.filter(t => t.type === 'expense' && (!origin || origin.type !== 'income' || t.amountCents === origin.amountCents && t.accountId !== origin.accountId)), origin?.type === 'expense' ? origin.id : '', expenseId => {
        const expense = txOf(state, expenseId), current = value(form, 'incomeId') || chosenIncome;
        const incomes = expense ? available.filter(t => t.type === 'income' && t.amountCents === expense.amountCents && t.accountId !== expense.accountId) : origin?.type === 'income' ? [origin] : [];
        setupPicker(ctx, form, 'incomeId', incomes, current, showFacts); chosenIncome = ''; showFacts();
      });
    }));
  }
  function transferFacts(ctx, state, expense, income) {
    if (expense.type !== 'expense' || income.type !== 'income' || expense.amountCents !== income.amountCents || expense.accountId === income.accountId) throw Error('配对必须是一条原支出与不同本人账户的一条等额原收入');
    return `<div class="bk-transfer-facts"><p class="bk-copy"><strong>候选筛选依据：</strong>金额完全相同（${amount(ctx, expense.amountCents)}）；一笔支出与一笔收入；资金账户不同。${expense.date === income.date ? '原日期相同。' : `原日期不同：${e(expense.date)} 转出，${e(income.date)} 转入。`}</p><p class="bk-copy bk-warning-text">这些条件只用于筛选，不能证明资金归属或同一次转移。来源名称和渠道也不是配对证明。请逐条核对原始凭证。</p><div class="bk-pair"><div><span class="bk-label">转出原记录与来源</span>${txLink(ctx, state, expense.id)}${sourceSummary(ctx, state, expense.id)}</div><div><span class="bk-label">转入原记录与来源</span>${txLink(ctx, state, income.id)}${sourceSummary(ctx, state, income.id)}</div></div></div>`;
  }
  function showTransferConfirmation(ctx, expenseId, incomeId) {
    const state = stateOf(ctx), calculated = engineOf(ctx).calculate(state), available = new Set(transferRows(ctx, state, calculated).map(t => t.id));
    if (!available.has(expenseId) || !available.has(incomeId)) throw Error('记录已有其他依赖，不能配对。请重新核对。');
    const expense = txOf(state, expenseId), income = txOf(state, incomeId), token = transferReviewToken(state, [expenseId, incomeId]);
    const facts = transferFacts(ctx, state, expense, income);
    const body = `${facts}<dl class="bk-numbers"><div><dt>配对后：这两条的个人消费</dt><dd>${amount(ctx, 0)}</dd></div><div><dt>配对后：这两条的普通收入</dt><dd>${amount(ctx, 0)}</dd></div><div><dt>配对后：这两条的对外现金收支</dt><dd>${amount(ctx, 0)}</dd></div></dl><p class="bk-copy">账户仍按各自原日期减少或增加 ${amount(ctx, expense.amountCents)}，不会改变账户余额。转移本金只在 ${e(expense.date)} 计一次。跨月时两个月分别保留转出与到账，不能把在途时间视为零。手续费与后续现金消费必须另记支出。</p>${textarea('配对依据（例如两边原始凭证与本人账户归属）', 'reason', '', true)}<label class="confirm-check"><input type="checkbox" name="confirmed" required>我已核对原始凭证，确认两个账户都属于本人，这两条是同一次真实资金转移，金额不含另记的手续费</label>`;
    ctx.modal('确认本人账户转账配对？', formBody(ctx, body, '确认配对，保留原交易'), '', () => bindForm(ctx, form => {
      if (!form.elements.namedItem('confirmed').checked) throw Error('请先明确确认本人账户归属与两条凭证');
      ctx.change(() => { const latest = stateOf(ctx); requireTransferReview(latest, [expenseId, incomeId], token); return engineOf(ctx).pairTransfer(latest, { expenseId, incomeId, reason: value(form, 'reason') }); }, '本人转移已配对；两条原交易、实际日期与来源证据完整保留');
    }));
  }
  function showAccountFlowDrilldown(ctx, state, calculated, mode, month) {
    if (!calculated.accountFlows || !calculated.drilldown.accountFlows) throw Error('账户变动模块未加载，请刷新后重试');
    const modes = { 'account-inflow': ['账户总流入', 'accountInflowCents', calculated.accountFlows.inflowCents], 'account-outflow': ['账户总流出', 'accountOutflowCents', calculated.accountFlows.outflowCents], 'account-net': ['账户净变动', null, calculated.accountFlows.netCents], 'account-transfer-in': ['本人账户转入', 'transferInCents', calculated.accountFlows.transferInCents], 'account-transfer-out': ['本人账户转出', 'transferOutCents', calculated.accountFlows.transferOutCents], 'transfer-principal': ['转移本金（仅按转出日期计一次）', 'transferOutCents', calculated.cash.transferCents] };
    if (!Object.hasOwn(modes, mode)) throw Error('未知的账户变动口径');
    const [title, key, total] = modes[mode], rows = calculated.drilldown.accountFlows.filter(row => !key || row[key] > 0);
    showPagedModal(ctx, title, `<p class="bk-copy">${month ? e(month) : '全部日期'} · 合计 ${amount(ctx, total)}。以下从原交易逐项下钻，保留真实记账日期；含内部转移，不含期初余额。</p><p class="bk-method-note">手工双边转账在同一天展示两个账户变动。配对的原收入与原支出各按自己的日期显示，跨月时只出现本月实际记录的一边；同一笔转移本金仅在转出日计一次。对外现金口径另列。</p>`, rows, row => `<section class="bk-record bk-record-stack">${txLink(ctx, state, row.transactionId)}<strong>本项${key ? '计入' : '净变动'} ${amount(ctx, key ? row[key] : row.accountInflowCents - row.accountOutflowCents)}</strong><ul class="bk-movement-list">${row.movements.map(m => `<li>${e(ctx.accountName(m.accountId))} · ${e(row.date)} · ${amount(ctx, m.signedCents)}</li>`).join('')}</ul>${row.transferPairId ? '<span class="bk-badge good">已确认本人转移 · 对外现金与个人口径为零</span>' : ''}${sourceSummary(ctx, state, row.transactionId)}</section>`, '此范围内没有计入该口径的账户变动；这不证明记录完整。');
  }
  function showDifferenceCandidates(ctx, snapshotId) {
    const state = stateOf(ctx), report = engineOf(ctx).differenceCandidates(state, snapshotId, { limit: PAGE_SIZE, offset: 0 });
    const kinds = { 'captured-basis-change': '快照保存后的依据变化', 'recorded-entry-removal-check': '某条记录是否重复的核对假设', 'recorded-direction-check': '某条记录方向是否相反的核对假设', 'unpaired-other-account-leg': '另一账户未配对记录的缺边假设' };
    const signed = cents => (cents > 0 ? '+' : '') + ctx.money(cents);
    const coverage = report.coverage.confirmedIntervals;
    const intro = `<p class="bk-copy">${e(ctx.accountName(report.accountId))} · ${e(report.asOf)} 日终。实际 ${amount(ctx, report.actualBalanceCents)} − 账本 ${amount(ctx, report.ledgerBalanceCents)} = 差额 ${e(signed(report.differenceCents))}。</p><div class="notice ${report.differenceCents ? 'warning' : ''}" role="status"><span>${report.differenceCents ? '差额仍未解决。下面只列有符号金额恰好相等的待核对假设，没有可信度或概率排名，也不是调整建议。' : '当前差额为零，没有差额候选；一致仍不代表来源已完整。'}</span></div><p class="bk-copy"><strong>覆盖状态：未知。</strong>${e(report.coverage.reason)}</p>${coverage.length ? `<ul class="bk-source-list">${coverage.map(row => `<li>用户确认的来源区间：${e(row.sourceKey)} · ${e(row.start)} 至 ${e(row.end)}</li>`).join('')}</ul>` : '<p class="bk-tx-meta">此账户没有可展示的来源覆盖确认。</p>'}<p class="bk-copy">${report.assumptions.map(e).join('；')}。</p><p class="bk-method-note">需你打开原交易和原始资料手工核对。这里只读展示，不生成补平交易、不改余额、不自动配对。共 ${report.matchingCount} 个精确金额假设，逐页核对；这里不检查任意多笔组合。</p>`;
    showPagedModal(ctx, '查看日终差额的核对线索', intro, report.candidates, row => `<section class="bk-record bk-record-stack"><strong>${e(kinds[row.kind] || row.kind)}</strong><p class="bk-copy">假设造成的账本余额变化 ${e(signed(row.hypotheticalBalanceChangeCents))}，恰好等于当前差额 ${e(signed(row.differenceCents))}。金额相等不证明该假设为真。</p><ul class="bk-source-list">${row.reasons.map(reason => `<li>${e(reason)}</li>`).join('')}</ul><p class="bk-warning-text bk-copy">${row.warnings.map(e).join('；')}</p>${row.transactionIds.map(id => `<div>${txOf(state, id) ? txLink(ctx, state, id) : `<p class="bk-copy">保存时涉及交易 ${e(id)}，当前活动账本中已不存在；请核对原快照依据与回收区，不能直接按此线索改账。</p>`}${sourceSummary(ctx, state, id)}</div>`).join('') || '<p class="bk-copy">请核对保存时与当前期初余额及完整账本依据。</p>'}</section>`, report.differenceCents ? '没有找到本次可检查范围内的精确金额假设。差额仍未解决，请检查原始资料、日期、缺档和期初余额。' : '差额为零，没有差额候选。', offset => { const page = engineOf(ctx).differenceCandidates(state, snapshotId, { limit: PAGE_SIZE, offset }); return { rows: page.candidates, total: page.matchingCount }; });
  }
  function render(ctx) {
    const engine = engineOf(ctx);
    if (!engine) return '<div class="notice warning" role="alert">账务关联模块未加载，请刷新后重试。</div>';
    try {
      const state = stateOf(ctx), data = dataOf(ctx, state), calculated = engine.calculate(state);
      if (!ui.month) ui.month = dateNow(ctx).slice(0, 7);
      return `<section class="bookkeeping" id="bookkeeping-root"><div class="notice"><span>每条证据都留着，金额只算一次。退款与回款必须对应已经入账的收入；计划与应收不会增加可用余额。</span></div><div class="bk-overview-head"><h2>分开看，才清楚</h2><label class="field">统计月份<input type="month" id="bk-month" min="0001-01" max="9999-12" value="${e(ui.month)}"></label></div>${reportSummary(ctx, ui.month)}<nav class="bk-tabs" aria-label="账务核对工作区">${TABS.map(([id, label]) => `<button type="button" data-bk-action="tab" data-bk-id="${id}" class="${ui.tab === id ? 'active' : ''}" ${ui.tab === id ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</nav><section id="bk-workspace" tabindex="-1" aria-label="${e(TABS.find(t => t[0] === ui.tab)?.[1] || '账务核对')}">${ui.tab === 'evidence' ? renderEvidence(ctx, state, data, calculated) : ui.tab === 'composites' ? (root.MoneygoCompositeUI?.render(ctx) || '<p>组合证据界面未加载，请刷新。</p>') : ui.tab === 'transfers' ? renderTransfers(ctx, state, data, calculated) : ui.tab === 'refunds' ? renderRefunds(ctx, state, data, calculated) : ui.tab === 'claims' ? renderClaims(ctx, state, data, calculated) : ui.tab === 'snapshots' ? renderSnapshots(ctx, state, data) : renderAudit(ctx, data)}</section><p class="bk-method-note">只改变当前浏览器里的记账关系，不发起退款、报销、转账或通知。账本不连接银行；请定期导出备份。</p></section>`;
    } catch (error) { return `<div class="notice warning" role="alert">账务核对暂时无法读取：${e(error.message)}。请先保留备份并核对数据。</div>`; }
  }
  function renderEvidence(ctx, state, data, calculated) {
    const rows = state.transactions.filter(t => `${t.date} ${t.id} ${t.note} ${ctx.accountName(t.accountId)} ${ctx.money(t.amountCents)}`.toLocaleLowerCase().includes(ui.query.toLocaleLowerCase())).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    const used = new Set(data.links.flatMap(l => [l.primaryId, l.shadowId]));
    const shadows = new Set(data.links.map(l => l.shadowId));
    const all = `<label class="field bk-search">搜索所有交易<input id="bk-evidence-search" type="search" maxlength="500" value="${e(ui.query)}" placeholder="日期、备注、账户、金额或编号"></label>${paged(ctx, 'transactions', rows, t => `<section class="bk-record"><div>${txLink(ctx, state, t.id)}${calculated.impacts[t.id].excluded ? '<span class="bk-badge">重复证据 · 不计金额</span>' : used.has(t.id) ? '<span class="bk-badge good">主记录 · 计金额</span>' : ''}</div><div class="bk-actions">${button('candidates', '核对候选', t.id, shadows.has(t.id) ? ' disabled' : '')}</div></section>`, '还没有交易。先记入手工交易或导入账单。')}`;
    const links = paged(ctx, 'links', data.links.slice().reverse(), row => `<section class="bk-record bk-record-stack"><div class="bk-pair"><div><span class="bk-badge good">主记录 · 采用日期与分类</span>${txLink(ctx, state, row.primaryId)}</div><div><span class="bk-badge">重复证据 · 不再计金额</span>${txLink(ctx, state, row.shadowId)}</div></div><p class="bk-copy">关联依据：${e(row.reason)}</p><div class="bk-actions">${unlinkButton(row.id, 'link')}</div></section>`, '没有确认过的重复证据。同日同金额的独立消费会继续各自计入。');
    return card('找到同一笔钱的不同证据', '候选只是提示。请核对实际资金账户；支付渠道名称不等于资金账户。', all) + card('已确认的证据关联', '保留全部原记录，只排除明确选定的重复证据。撤销后两条记录会恢复各自计金额。', links);
  }
  function unlinkButton(id, kind) { if (kind === 'composite') return `<button type="button" class="text-link" data-com-action="remove" data-com-id="${e(id)}">预览安全撤销组合</button>`; return actionLink('unlink', kind === 'snapshot' ? '移除快照' : '撤销关联', id, ` data-bk-kind="${e(kind)}"`); }
  function renderRefunds(ctx, state, data, calculated) {
    const refunds = paged(ctx, 'refunds', data.refunds.slice().reverse(), row => `<section class="bk-record bk-record-stack"><div class="bk-record-heading"><strong>${amount(ctx, row.amountCents)} 已记录退款分配</strong><span class="bk-badge">${e(txOf(state, row.incomeId)?.date)}</span></div><div class="bk-pair"><div><span class="bk-label">原购买</span>${txLink(ctx, state, row.expenseId)}</div><div><span class="bk-label">原收入记录日期</span>${txLink(ctx, state, row.incomeId)}</div></div><p class="bk-copy">${e(row.reason)}${row.planId ? ' · 已关联待退款计划' : ''}</p><div class="bk-actions">${unlinkButton(row.id, 'refund')}</div></section>`, '还没有退款分配。先把实际到账记为收入，再分配到原支出。');
    const adapter = root.MoneygoRefundReceiptsUI;
    let plans;
    try {
      if (!adapter || typeof adapter.overview !== 'function') throw Error('到账复核模块未加载；原记录保留，退款分配暂不可用。');
      const overview = adapter.overview(ctx), byId = new Map(data.refundPlans.map(p => [p.id, p]));
      plans = `<p class="bk-copy">截至本地日期 ${e(overview.asOfDate)}。银行和平台覆盖未知；计划金额不等于保证可收回的钱，也不能把重叠计划相加。</p>` + paged(ctx, 'refundPlans', overview.plans.slice().reverse(), row => {
        const stored = byId.get(row.planId);
        return adapter.planSummary(ctx, row) + `<div class="bk-actions">${row.lifecycle === 'waiting' ? button('refund-candidates', '查看可核对的收入候选', row.expenseId, ` data-bk-plan="${e(row.planId)}"`) : ''}${button('refund', '手动关联具体收入', row.expenseId, ` data-bk-plan="${e(row.planId)}"`)}${actionLink('edit-plan', '编辑计划', row.planId)}${unlinkButton(row.planId, 'refundPlan')}</div>${stored?.note ? `<p class="bk-copy">${e(stored.note)}</p>` : ''}`;
      }, '没有待退款计划。这里只记期待，不把未到账金额算作收入。');
    } catch (error) { plans = `<p class="bk-warning-text" role="alert">${e(error.message)}</p>`; }
    return card('已记录的退款分配', '支持部分退款、跨月退款和多笔分配。原日期记录均保留；未来日期的既有分配仍占用份额。', refunds, button('refund', '分配到账退款')) + card('待退款计划与截至今天的关联记录', '计划不新增收入或余额。所有日期的已保存关联继续占用份额；超过预计日期只提示核对，不证明商户未付款。', plans, button('plan', '登记待退款'));
  }

  function renderClaims(ctx, state, data, calculated) {
    const claims = paged(ctx, 'claims', calculated.receivables.claims.slice().reverse(), row => `<section class="bk-record bk-record-stack"><div class="bk-record-heading"><strong>${e(row.name)}</strong><span class="bk-badge">${row.kind === 'advance' ? '替人垫付' : '待报销'} · ${e(CLAIM_STATUS[row.status])}</span></div>${txLink(ctx, state, row.expenseId)}<dl class="bk-numbers"><div><dt>第三方份额</dt><dd>${amount(ctx, row.amountCents)}</dd></div><div><dt>已收回</dt><dd>${amount(ctx, row.settledCents)}</dd></div><div><dt>尚未收回</dt><dd>${amount(ctx, row.outstandingCents)}</dd></div></dl>${row.dueDate ? `<p class="bk-copy">预计回款日 ${e(row.dueDate)}</p>` : ''}${row.note ? `<p class="bk-copy">${e(row.note)}</p>` : ''}<div class="bk-actions">${button('settle', '关联实际回款', row.id, row.outstandingCents <= 0 ? ' disabled' : '')}${actionLink('edit-claim', '编辑应收', row.id)}${unlinkButton(row.id, 'claim')}</div></section>`, '还没有应收。把一笔支出中的第三方份额单独记下，剩余部分才是自己的消费。');
    const settlements = paged(ctx, 'settlements', data.settlements.slice().reverse(), row => `<section class="bk-record bk-record-stack"><div class="bk-record-heading"><strong>${amount(ctx, row.amountCents)} 已收回</strong><span>${e(data.claims.find(c => c.id === row.claimId)?.name || '应收')}</span></div>${txLink(ctx, state, row.incomeId)}<p class="bk-copy">${e(row.reason)}</p><div class="bk-actions">${unlinkButton(row.id, 'settlement')}</div></section>`, '还没有实际回款。应收不会自动增加账户余额。');
    return card('报销与垫付', `当前未收回 ${ctx.money(calculated.receivables.outstandingCents)}，来自全部日期的应收。提交状态与实际到账分开记录。`, claims, button('claim', '登记应收份额')) + card('已经收到的回款', '支持分次回款；只分配已入账收入，不重复生成现金交易。', settlements);
  }
  function renderSnapshots(ctx, state, data) {
    const rows = data.snapshots.slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    return card('把账本与实际余额对一下', '填写你核实过的某日结束时余额。这里只记录差异，不自动创建补平交易。', paged(ctx, 'snapshots', rows, row => {
      const result = engineOf(ctx).reconciliation(state, row.id);
      return `<section class="bk-record bk-record-stack"><div class="bk-record-heading"><strong>${e(ctx.accountName(row.accountId))} · ${e(row.date)} 日终</strong><span class="bk-badge ${result.reconciled ? 'good' : 'warning'}">${result.reconciled ? '当前一致' : '存在差异'}</span></div><dl class="bk-numbers"><div><dt>你填写的实际余额</dt><dd>${amount(ctx, result.actualBalanceCents)}</dd></div><div><dt>当前账本日终余额</dt><dd>${amount(ctx, result.ledgerBalanceCents)}</dd></div><div><dt>差异：实际 − 账本</dt><dd>${amount(ctx, result.differenceCents)}</dd></div></dl><p class="bk-copy">${result.changed ? '记录快照后，影响该日的账本依据已变化。请重新核对。' : '影响该日的账本依据自快照保存后未变化。'} 保存时账本余额 ${amount(ctx, result.capturedLedgerBalanceCents)}，差异 ${amount(ctx, result.capturedDifferenceCents)}。</p>${row.note ? `<p class="bk-copy">${e(row.note)}</p>` : ''}<div class="bk-actions">${button('snapshot-details', '核对当日依据', row.id)}${button('difference-candidates', '查看差额核对线索', row.id)}${unlinkButton(row.id, 'snapshot')}</div></section>`;
    }, '还没有余额快照。请先核实账户的实际日终余额。') + '<p class="bk-method-note">期初余额假定在所有已录入交易之前；只累计快照日期及之前的实际现金记录并排除重复证据。未来交易不影响过去的对账。你的输入不代表银行实时余额。</p>', button('snapshot', '记录日终余额'));
  }
  function renderAudit(ctx, data) {
    return card('每次关联，都有来处', '撤销只移除当前关系；原交易、来源证据和这里的操作记录都保留。可重新建立关系。', paged(ctx, 'audit', data.audit.slice().reverse(), row => `<section class="bk-record bk-record-stack"><div class="bk-record-heading"><strong>${e(KINDS[row.kind])} · ${e({ create: '建立', update: '更新', unlink: '撤销' }[row.action])}</strong><span class="bk-record-id">第 ${row.revision} 次</span></div><p class="bk-copy">${e(row.reason)}</p><p class="bk-tx-meta">${e(row.at)} · ${e(row.recordId)}</p><details class="bk-audit-details"><summary>查看保存前后的完整关联字段</summary><div class="bk-pair"><div><h3>操作前</h3><pre>${e(JSON.stringify(row.before, null, 2))}</pre></div><div><h3>操作后</h3><pre>${e(JSON.stringify(row.after, null, 2))}</pre></div></div></details></section>`, '还没有账务关联操作。'));
  }
  function showCandidates(ctx, id) {
    const state = stateOf(ctx), transaction = txOf(state, id);
    if (!transaction) throw Error('交易不存在，请刷新后重试');
    const rows = engineOf(ctx).candidates(state, id); let offset = 0;
    ctx.modal('核对可能重复的证据', `<div class="bk-form"><div class="bk-picked"><strong>当前核对的交易</strong>${txSummary(ctx, transaction, true)}</div><p class="bk-copy">相同金额、日期或商户都不能证明是同一笔钱。请用原始凭证确认实际资金账户、方向、金额，以及是哪一笔支付；不确定就保留为独立交易。</p><div id="bk-candidate-list"></div><div class="bk-pager"><button class="btn" type="button" id="bk-candidate-prev">上一页</button><span id="bk-candidate-count" role="status"></span><button class="btn" type="button" id="bk-candidate-next">下一页</button></div></div>`, '<button class="btn" type="button" data-close>暂不关联</button>', () => {
      function draw() {
        ctx.$('#bk-candidate-list').innerHTML = rows.slice(offset, offset + PAGE_SIZE).map(row => `<section class="bk-record bk-record-stack">${txLink(ctx, state, row.transactionId)}<p class="bk-copy"><strong>匹配依据：</strong>${e(row.matchingBasis.join('；'))}</p><p class="bk-copy bk-warning-text">${e(row.warnings.join('；'))}</p>${row.sources.length ? `<p class="bk-tx-meta">来源：${row.sources.map(s => e(s.sourceKey) + (s.channel ? ` / ${e(s.channel)}` : '') + `（${e(s.status)}）`).join('；')}</p>` : '<p class="bk-tx-meta">无导入来源，可能为手工记录。</p>'}<div class="bk-actions">${button('pair', '核对这两条', row.transactionId, ` data-bk-base="${e(id)}"${row.eligible ? '' : ' disabled'}`)}</div></section>`).join('') || empty('没有可供核对的候选。已作为重复证据的记录不会再次作为候选；其他金额或方向不同的交易也不会显示。');
        ctx.$('#bk-candidate-count').textContent = rows.length ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, rows.length)} / ${rows.length} 个候选` : '0 个候选';
        ctx.$('#bk-candidate-prev').disabled = offset === 0; ctx.$('#bk-candidate-next').disabled = offset + PAGE_SIZE >= rows.length;
      }
      ctx.$('#bk-candidate-prev').onclick = () => { offset = Math.max(0, offset - PAGE_SIZE); draw(); };
      ctx.$('#bk-candidate-next').onclick = () => { offset += PAGE_SIZE; draw(); }; draw();
    });
  }
  function showPair(ctx, baseId, candidateId) {
    const state = stateOf(ctx), left = txOf(state, baseId), right = txOf(state, candidateId);
    const candidate = engineOf(ctx).candidates(state, baseId).find(r => r.transactionId === candidateId);
    if (!left || !right || !candidate?.eligible) throw Error('这两条记录当前无法关联。请先核实金额、方向和实际资金账户，并确认没有其他关联。');
    const hasShadows = dataOf(ctx, state).links.some(row => row.primaryId === baseId);
    const body = `<p class="bk-copy">请选择哪一条作为主记录。保留它的日期、分类和备注用于统计；另一条完整保留为重复证据，但金额不再重复计算。</p><fieldset class="bk-canonical"><legend>明确选择主记录（不会自动选择）</legend>${[left, right].map(t => `<label class="bk-canonical-choice"><input type="radio" name="primaryId" value="${e(t.id)}" ${hasShadows && t.id !== baseId ? 'disabled' : 'required'}><span><strong>使用这条作为主记录</strong>${txSummary(ctx, t, true)}</span></label>`).join('')}</fieldset>${hasShadows ? '<p class="bk-copy">当前主记录已有其他证据。本次需继续使用它作为主记录；若要更换，先撤销原有证据关联后再重新选择。</p>' : ''}<p class="bk-copy"><strong>匹配依据：</strong>${e(candidate.matchingBasis.join('；'))}</p><p class="bk-copy bk-warning-text">${e(candidate.warnings.join('；'))}</p>${textarea('确认依据（例如原始支付编号、订单与扣款凭证对应）', 'reason', '', true)}<label class="confirm-check"><input type="checkbox" name="confirmed" required>我已确认这是同一笔真实资金变动，且实际资金账户相同</label>`;
    ctx.modal('确定同一笔钱，保留两份证据', formBody(ctx, body, '确认关联并只计一次金额'), '', () => bindForm(ctx, form => {
      const primaryId = requireChoice(form, 'primaryId', '主记录');
      if (!form.elements.namedItem('confirmed').checked) throw Error('请先确认这是同一笔真实资金变动');
      const shadowId = primaryId === baseId ? candidateId : baseId;
      ctx.change(() => engineOf(ctx).linkEvidence(stateOf(ctx), { primaryId, shadowId, reason: value(form, 'reason') }), '证据已关联；两份记录完整保留，金额只计一次');
    }));
  }
  function showRefund(ctx, expenseId, planId, suggested = false) {
    const adapter = root.MoneygoRefundReceiptsUI;
    if (!adapter || typeof adapter.showDraft !== 'function') throw Error('到账复核模块未加载，不能保存退款分配。请重新加载完整页面。');
    adapter.showDraft(ctx, { expenseId, planId }, suggested);
  }
  function showPlan(ctx, expenseId, recordId) {
    const state = stateOf(ctx), calculated = engineOf(ctx).calculate(state), existing = dataOf(ctx, state).refundPlans.find(p => p.id === recordId);
    if (recordId && !existing) throw Error('待退款计划不存在');
    const body = `<p class="bk-copy">这只是尚未到账的计划，不改变消费、收入、应收或余额。已到账时，请另外关联实际收入。取消或结束计划也不会撤销已保存的到账分配。</p>${existing ? `<div class="bk-picked">原支出${txSummary(ctx, txOf(state, existing.expenseId), true)}</div>` : pickerMarkup('expenseId', '原支出')}<div class="form-grid">${field('预计退款金额（人民币元）', 'amount', existing ? ctx.amountText(existing.expectedAmountCents) : '', 'type="text" inputmode="decimal" maxlength="14" required')}${field('预计到账日期（可选）', 'dueDate', existing?.dueDate, 'type="date" min="0001-01-01" max="9999-12-31"')}${enumSelect('计划状态', 'status', PLAN_STATUS, existing?.status || 'waiting')}</div>${textarea('备注（可选）', 'note', existing?.note)}${existing ? textarea('修改原因', 'reason', '', true) : ''}`;
    ctx.modal(existing ? '编辑待退款计划' : '登记待退款计划', formBody(ctx, body, '保存待退款计划'), '', () => bindForm(ctx, form => {
      const input = { expectedAmountCents: parseAmount(ctx, value(form, 'amount')), dueDate: value(form, 'dueDate') || null, status: value(form, 'status'), note: value(form, 'note') };
      ctx.change(() => existing ? engineOf(ctx).updateRefundPlan(stateOf(ctx), existing.id, input, value(form, 'reason')) : engineOf(ctx).addRefundPlan(stateOf(ctx), { ...input, expenseId: requireChoice(form, 'expenseId', '原支出') }), '待退款计划已保存，现金与个人消费没有变化');
    }, form => { if (!existing) setupPicker(ctx, form, 'expenseId', eligibleTransactions(state, calculated, 'expense'), expenseId); }));
  }
  function showClaim(ctx, expenseId, recordId) {
    const state = stateOf(ctx), calculated = engineOf(ctx).calculate(state), existing = calculated.receivables.claims.find(c => c.id === recordId);
    if (recordId && !existing) throw Error('应收不存在');
    const body = `<p class="bk-copy">从原支出中划出应由第三方承担的部分，减少自己的消费并登记应收；不会增加现金。提交状态只用于你自己跟进，不代表已经收回。</p>${existing ? `<div class="bk-picked">原支出${txSummary(ctx, txOf(state, existing.expenseId), true)}<p>已实际收回 ${amount(ctx, existing.settledCents)}，应收金额不能低于已收回金额。</p></div>` : pickerMarkup('expenseId', '原支出')}<p id="bk-claim-hint" class="form-hint" aria-live="polite"></p><div class="form-grid">${field('名称（报销事项或垫付对象）', 'name', existing?.name, 'maxlength="80" required')}${field('第三方份额（人民币元）', 'amount', existing ? ctx.amountText(existing.amountCents) : '', 'type="text" inputmode="decimal" maxlength="14" required')}${enumSelect('应收类型', 'kind', { reimbursement: '报销', advance: '替人垫付' }, existing?.kind || 'reimbursement')}${enumSelect('提交状态', 'status', CLAIM_STATUS, existing?.status || 'unsubmitted')}${field('预计回款日期（可选）', 'dueDate', existing?.dueDate, 'type="date" min="0001-01-01" max="9999-12-31"')}</div>${textarea('备注（可选）', 'note', existing?.note)}${existing ? textarea('修改原因', 'reason', '', true) : ''}`;
    ctx.modal(existing ? '编辑报销 / 垫付应收' : '登记第三方应收份额', formBody(ctx, body, '保存应收份额'), '', () => bindForm(ctx, form => {
      const input = { name: value(form, 'name'), amountCents: parseAmount(ctx, value(form, 'amount')), kind: value(form, 'kind'), status: value(form, 'status'), dueDate: value(form, 'dueDate') || null, note: value(form, 'note') };
      ctx.change(() => existing ? engineOf(ctx).updateClaim(stateOf(ctx), existing.id, input, value(form, 'reason')) : engineOf(ctx).createClaim(stateOf(ctx), { ...input, expenseId: requireChoice(form, 'expenseId', '原支出') }), '应收份额已保存，个人消费已更新；现金尚未增加');
    }, form => { if (!existing) setupPicker(ctx, form, 'expenseId', eligibleTransactions(state, calculated, 'expense', 'refundableExpenseCents'), expenseId, id => { ctx.$('#bk-claim-hint').textContent = id ? expenseInfo(ctx, calculated.impacts[id]) : '选择原支出，查看尚可分配的份额。'; }); }));
  }
  function showSettlement(ctx, claimId) {
    const state = stateOf(ctx), calculated = engineOf(ctx).calculate(state), claim = calculated.receivables.claims.find(c => c.id === claimId);
    if (!claim || claim.outstandingCents <= 0) throw Error('这笔应收不存在，或已经全部收回');
    const body = `<div class="bk-picked"><strong>${e(claim.name)}</strong><p>应收 ${amount(ctx, claim.amountCents)} · 已收 ${amount(ctx, claim.settledCents)} · 剩余 ${amount(ctx, claim.outstandingCents)}</p>${txSummary(ctx, txOf(state, claim.expenseId), true)}</div><p class="bk-copy">可以分次收回。先将真实到账记为收入，再选择这笔收入分配给应收；分配后不会重复增加余额。</p>${pickerMarkup('incomeId', '实际到账收入')}<p id="bk-settle-hint" class="form-hint" aria-live="polite"></p>${field('本次回款分配（人民币元）', 'amount', '', 'type="text" inputmode="decimal" maxlength="14" required')}${textarea('回款分配依据', 'reason', '', true)}`;
    ctx.modal('关联一笔实际回款', formBody(ctx, body, '保存实际回款分配'), '', () => bindForm(ctx, form => {
      const input = { claimId, incomeId: requireChoice(form, 'incomeId', '实际到账收入'), amountCents: parseAmount(ctx, value(form, 'amount')), reason: value(form, 'reason') };
      ctx.change(() => engineOf(ctx).settleClaim(stateOf(ctx), input), '回款已分配，应收余额已更新');
    }, form => setupPicker(ctx, form, 'incomeId', eligibleTransactions(state, calculated, 'income', 'availableIncomeCents'), '', id => { ctx.$('#bk-settle-hint').textContent = id ? receiptInfo(ctx, calculated.impacts[id]) : '只显示尚有可分配余额的真实收入。'; })));
  }
  function showSnapshot(ctx) {
    const state = stateOf(ctx);
    const body = `<p class="bk-copy">填写你从账户记录中核实的日终实际余额，可为负数。快照只用于对账，不产生任何资金变动；请先确认期初余额在所有交易之前。</p><div class="form-grid"><label class="field">核对账户<select name="accountId" required><option value="">请选择账户</option>${state.accounts.map(a => `<option value="${e(a.id)}">${e(a.name)}</option>`).join('')}</select></label>${field('余额日期（日终）', 'date', dateNow(ctx), 'type="date" min="0001-01-01" max="9999-12-31" required')}${field('你核实的实际余额（人民币元）', 'amount', '', 'type="text" inputmode="decimal" maxlength="15" required')}</div>${textarea('核对备注（可选）', 'note', '')}<label class="confirm-check"><input type="checkbox" name="confirmed" required>我填写的是该账户在上述日期结束时的实际余额</label>`;
    ctx.modal('记录一次日终余额', formBody(ctx, body, '保存快照并查看差异'), '', () => bindForm(ctx, form => {
      if (!form.elements.namedItem('confirmed').checked) throw Error('请先确认余额的账户与日期');
      const input = { accountId: requireChoice(form, 'accountId', '账户'), date: value(form, 'date'), actualBalanceCents: parseAmount(ctx, value(form, 'amount'), true), note: value(form, 'note') };
      ui.tab = 'snapshots';
      ctx.change(() => engineOf(ctx).addSnapshot(stateOf(ctx), input), '日终余额快照已保存，请核对当前差异');
    }));
  }
  function dependenciesForRelation(data, kind, id) {
    if (kind === 'claim') return data.settlements.filter(r => r.claimId === id).map(r => ({ kind: 'settlement', row: r }));
    if (kind === 'refundPlan') return data.refunds.filter(r => r.planId === id).map(r => ({ kind: 'refund', row: r }));
    return [];
  }
  function relationSummary(ctx, state, kind, row) {
    if (kind === 'composite') return `<strong>${e(row.name)} · ${amount(ctx, row.paidCents)} 确认实付</strong><p class="bk-copy">个人消费证据 ${row.personalIds.length} 条；实际资金证据 ${row.fundingIds.length} 条。两组各按自己的原日期统计。</p><button type="button" class="btn" data-com-action="detail" data-com-id="${e(row.id)}">查看完整组合与来源</button>`;
    if (kind === 'transferPair') return transferPairSummary(ctx, state, row);
    if (kind === 'link') return `<div class="bk-pair"><div><span class="bk-label">主记录</span>${txLink(ctx, state, row.primaryId)}</div><div><span class="bk-label">重复证据</span>${txLink(ctx, state, row.shadowId)}</div></div>`;
    if (kind === 'refund') return `<strong>${amount(ctx, row.amountCents)} 到账退款</strong><div class="bk-pair"><div><span class="bk-label">原支出</span>${txLink(ctx, state, row.expenseId)}</div><div><span class="bk-label">到账收入</span>${txLink(ctx, state, row.incomeId)}</div></div>`;
    if (kind === 'claim') return `<strong>${e(row.name)} · ${amount(ctx, row.amountCents)}</strong>${txLink(ctx, state, row.expenseId)}`;
    if (kind === 'settlement') return `<strong>${amount(ctx, row.amountCents)} 回款 · ${e(dataOf(ctx, state).claims.find(c => c.id === row.claimId)?.name || '应收')}</strong>${txLink(ctx, state, row.incomeId)}`;
    if (kind === 'refundPlan') return `<strong>预计 ${amount(ctx, row.expectedAmountCents)} · ${e(PLAN_STATUS[row.status])}</strong>${txLink(ctx, state, row.expenseId)}`;
    return `<strong>${e(ctx.accountName(row.accountId))} · ${e(row.date)} 日终</strong><p>用户填写余额 ${amount(ctx, row.actualBalanceCents)}</p>`;
  }
  function showUnlink(ctx, kind, id) {
    if (kind === 'composite') throw Error('组合须使用专用的影响预览与明确确认。请从组合详情选择安全撤销。');
    if (!Object.hasOwn(COLLECTIONS, kind)) throw Error('未知的关联类型');
    const state = stateOf(ctx), data = dataOf(ctx, state), row = data[COLLECTIONS[kind]].find(r => r.id === id);
    if (!row) throw Error('关联已不存在，请刷新后重试');
    const dependencies = dependenciesForRelation(data, kind, id);
    const consequences = {
      link: '撤销后，这条重复证据将恢复为独立交易并重新计金额，可能改变现金、个人消费和对账差异。主记录的其他证据关联保留。',
      refund: '撤销后，退款对应的个人消费会恢复；这笔到账的相应份额重新归为普通收入。实际现金记录保持不变。',
      claim: '撤销后，这份第三方份额会重新计入自己的消费，应收余额减少。已有回款分配需要先逐条撤销。',
      settlement: '撤销后，应收未收余额会增加；这笔到账的相应份额重新归为普通收入。实际现金记录保持不变。',
      refundPlan: '只移除当前待退款计划。与它关联的已到账退款需先撤销，或保留计划。移除计划本身不改变现金。',
      transferPair: '撤销后，两条原交易恢复为独立支出与收入，并重新计入对外现金和个人口径。原账户、金额、日期、余额及来源证据保持不变；跨月账户变动仍按各自原日期记录。',
      snapshot: '移除当前快照，不改变任何账户余额和交易。原快照字段仍保留在操作历史中，可再次按原实际余额创建快照。'
    };
    const blockers = dependencies.length ? `<div class="notice warning" role="alert"><span>还有 ${dependencies.length} 条依赖，需先逐条撤销，才能继续。每次撤销都要你明确确认。</span></div>${dependencies.map(d => `<div class="bk-record bk-record-stack">${relationSummary(ctx, state, d.kind, d.row)}${unlinkButton(d.row.id, d.kind)}</div>`).join('')}` : '';
    const reviewToken = kind === 'transferPair' ? transferReviewToken(state, [row.expenseId, row.incomeId]) : null;
    const body = `<div class="bk-picked">${relationSummary(ctx, state, kind, row)}</div><p class="bk-copy">${e(consequences[kind])}</p><p class="bk-copy">原交易、导入证据和操作历史完整保留。需要时可重新建立关系；不会删除交易。</p>${blockers}${textarea('撤销原因', 'reason', '', true)}${kind === 'transferPair' ? '<label class="confirm-check"><input type="checkbox" name="confirmed" required>我已核对撤销影响，确认恢复为独立收支</label>' : ''}<div class="modal-bottom">${cancel(ctx)}<button class="btn danger" type="submit" ${dependencies.length ? 'disabled' : ''}>确认${kind === 'snapshot' ? '移除快照' : '撤销关联'}</button></div>`;
    ctx.modal('撤销' + KINDS[kind] + '？', `<form id="entry-form" class="bk-form">${body}</form>`, '', () => bindForm(ctx, form => {
      if (kind === 'transferPair' && !form.elements.namedItem('confirmed').checked) throw Error('请先确认恢复为独立收支的影响');
      ctx.change(() => { const latest = stateOf(ctx); if (kind === 'transferPair') requireTransferReview(latest, [row.expenseId, row.incomeId], reviewToken); return engineOf(ctx).unlink(latest, kind, id, value(form, 'reason')); }, '关联已撤销，原始交易与操作历史仍保留');
    }));
  }
  function transactionDetails(ctx, id) {
    const state = stateOf(ctx), transaction = txOf(state, id);
    if (!transaction) return '';
    const engine = engineOf(ctx), calculated = engine.calculate(state), impact = calculated.impacts[id], data = dataOf(ctx, state);
    const sources = (state.imports?.evidence || []).filter(row => row.transactionId === id);
    const sourceLineLabel = value => Number.isSafeInteger(value) && value >= 1 && value <= 8 * 1024 * 1024 ? '第 ' + value + ' 行' : '旧记录未保存，未知';
    const linked = data.links.filter(row => row.primaryId === id || row.shadowId === id);
    const dependencies = engine.dependencies(state, id);
    const relations = dependencies.filter(d => d.kind !== 'link' && !['heldPosition','heldRecognition','heldReturn'].includes(d.kind)).map(d => ({ ...d, row: (data[COLLECTIONS[d.kind]] || []).find(r => r.id === d.id) }));
    const numbers = impact.transferPairId ? pairedTransactionNumbers(ctx, state, transaction, impact, data) : impact.excluded ? `<div class="notice"><span>这是重复证据，不再计入任何金额。主记录采用其自身日期、分类和备注。</span></div>${txLink(ctx, state, impact.primaryId)}` : transaction.type === 'expense' ? `<dl class="bk-numbers"><div><dt>${e(cashLabel(ctx, '对外现金流出'))}</dt><dd>${amount(ctx, impact.cashExpenseCents)}</dd></div><div><dt>${impact.heldFundingCents?'原记录个人残余':'个人消费'}</dt><dd>${amount(ctx, impact.personalExpenseCents)}</dd></div><div><dt>已分配退款</dt><dd>${amount(ctx, impact.refundCents)}</dd></div><div><dt>第三方应收份额</dt><dd>${amount(ctx, impact.claimCents)}</dd></div></dl>` : transaction.type === 'income' ? `<dl class="bk-numbers"><div><dt>${e(cashLabel(ctx, '对外现金流入'))}</dt><dd>${amount(ctx, impact.cashIncomeCents)}</dd></div><div><dt>${impact.heldReturnCents?'原记录普通收入残余（不可另行分配）':'普通收入 / 尚可分配'}</dt><dd>${amount(ctx, impact.ordinaryIncomeCents)}</dd></div><div><dt>已分配退款</dt><dd>${amount(ctx, impact.receivedRefundCents || 0)}</dd></div><div><dt>已分配应收回款</dt><dd>${amount(ctx, impact.settlementCents)}</dd></div></dl>` : `<p class="bk-copy">账户间转账 ${amount(ctx, transaction.amountCents)}。转出账户减少、转入账户增加；不计入收入或个人消费。</p>`;
    const heldReferences=[...(data.heldPositions||[]).filter(row=>row.expenseId===id).map(row=>({positionId:row.id,amountCents:row.amountCents,label:'原本金分配'})),...(data.heldReturns||[]).filter(row=>row.incomeId===id).map(row=>({positionId:row.positionId,amountCents:row.amountCents,label:'实际退回本金'}))];
    const heldDetails=heldReferences.length?'<section class="bk-record bk-record-stack"><h4>押金与预付来源</h4><p>整笔来源已参与本金分类，剩余个人金额不能同时用于普通退款/应收/组合等互斥关系。用尽或退完仍保留原本金占用。核销按各自日期另列，不再次改变现金。</p>'+heldReferences.map(row=>`<p>${e(row.label)} ${amount(ctx,row.amountCents)} <button class="text-link" type="button" data-bk-action="held-position" data-bk-id="${e(row.positionId)}">查看本金与核销</button></p>`).join('')+'</section>':'';
    const actions = !impact.excluded && !heldReferences.length ? button('candidates', '核对重复证据', id) + (!impact.transferPairId && !impact.compositeId && transaction.type !== 'transfer' ? button('transfer', '核对本人账户转移', id) : '') + (!impact.transferPairId && impact.personalAuthority !== false && transaction.type === 'expense' ? button('refund', '分配到账退款', id) + button('plan', '登记待退款', id) + button('claim', '登记应收份额', id) : '') : '';
    return `<section class="bk-transaction-details"><h3>这笔交易的账务口径</h3>${roleNotice(ctx)}${root.MoneygoCompositeUI?.roleBadge(state, id) || ''}${numbers}${heldDetails}<p class="bk-method-note">后续退款或应收会影响原购买月份的个人消费；现金日期始终来自真实交易。</p>${actions ? `<div class="bk-actions">${actions}</div>` : ''}${dependencies.length ? '<p class="bk-warning-text bk-copy">这笔交易存在关联。删除或修改金额、账户、日期等若使关联失效，会被拒绝。请先核对并撤销相关依赖。</p>' : ''}${linked.length ? `<details class="bk-detail-group"><summary>关联的完整交易证据（${linked.length} 组）</summary>${linked.map(row => `<div class="bk-record bk-record-stack">${relationSummary(ctx, state, 'link', row)}<p class="bk-copy">依据：${e(row.reason)}</p>${unlinkButton(row.id, 'link')}</div>`).join('')}</details>` : ''}${relations.length ? `<details class="bk-detail-group"><summary>组合、转账配对、退款、应收与计划（${relations.length}）</summary>${relations.map(d => `<div class="bk-record bk-record-stack"><span class="bk-label">${e(KINDS[d.kind])}</span>${relationSummary(ctx, state, d.kind, d.row)}${unlinkButton(d.id, d.kind)}</div>`).join('')}</details>` : ''}<details class="bk-detail-group"><summary>本条记录的来源证据（${sources.length}）</summary>${sources.length ? '<p class="bk-copy">来源行号对应最近确认的导入或修复；重复预览不会改写原证据。</p>' : ''}${sources.length ? sources.map(row => `<dl class="bk-source"><div><dt>来源</dt><dd>${e(row.sourceKey)}</dd></div><div><dt>原始编号</dt><dd>${e(row.stableId || '未提供')}</dd></div><div><dt>来源状态</dt><dd>${e(row.status)}</dd></div><div><dt>来源账户</dt><dd>${e(ctx.accountName(row.accountId))}</dd></div>${Object.entries({ date: '映射日期', amount: '映射金额', direction: '映射方向', note: '映射备注', channel: '支付渠道' }).filter(([key]) => row.mapped && row.mapped[key] !== undefined).map(([key, label]) => `<div><dt>${label}</dt><dd>${e(row.mapped[key])}</dd></div>`).join('')}<div><dt>最近确认的来源物理行</dt><dd>${e(sourceLineLabel(row.sourceLine))}</dd></div><div><dt>证据编号</dt><dd>${e(row.id)}</dd></div><div><dt>最近批次</dt><dd>${e(row.lastBatchId)}</dd></div></dl>`).join('') : '<p class="bk-copy">没有导入来源证据。手工记录本身仍完整保留。</p>'}</details></section>`;
  }
  function showTransaction(ctx, id) {
    const state = stateOf(ctx), transaction = txOf(state, id);
    if (!transaction) throw Error('交易不存在');
    ctx.modal('账务明细', `<div class="bk-form"><div class="bk-picked">${txSummary(ctx, transaction, true)}</div>${transactionDetails(ctx, id)}</div>`, '<button class="btn" type="button" data-close>关闭</button>');
  }
  function showPagedModal(ctx, title, intro, rows, renderer, emptyMessage, loader) {
    let offset = 0;
    ctx.modal(title, `<div class="bk-form">${intro}<div id="bk-modal-rows"></div><div class="bk-pager"><button class="btn" type="button" id="bk-modal-prev">上一页</button><span id="bk-modal-count" role="status"></span><button class="btn" type="button" id="bk-modal-next">下一页</button></div></div>`, '<button class="btn" type="button" data-close>关闭</button>', () => {
      function draw() { const page = loader ? loader(offset) : { rows: rows.slice(offset, offset + PAGE_SIZE), total: rows.length }; ctx.$('#bk-modal-rows').innerHTML = page.rows.map(renderer).join('') || empty(emptyMessage); ctx.$('#bk-modal-count').textContent = page.total ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, page.total)} / ${page.total}` : '0 条'; ctx.$('#bk-modal-prev').disabled = offset === 0; ctx.$('#bk-modal-next').disabled = offset + PAGE_SIZE >= page.total; }
      ctx.$('#bk-modal-prev').onclick = () => { offset = Math.max(0, offset - PAGE_SIZE); draw(); };
      ctx.$('#bk-modal-next').onclick = () => { offset += PAGE_SIZE; draw(); }; draw();
    });
  }
  function showDrilldown(ctx, mode, month) {
    const state = stateOf(ctx), calculated = engineOf(ctx).calculate(state, month || undefined);
    if (mode === 'receivables') {
      const rows = calculated.receivables.claims.filter(c => c.outstandingCents > 0);
      showPagedModal(ctx, '当前未收回款', `<p class="bk-copy">全部日期应收余额 ${amount(ctx, calculated.receivables.outstandingCents)}，不随统计月份过滤，不是账户可用余额。</p>`, rows, row => `<section class="bk-record bk-record-stack"><strong>${e(row.name)} · 尚未收回 ${amount(ctx, row.outstandingCents)}</strong>${txLink(ctx, state, row.expenseId)}<div class="bk-actions">${button('settle', '关联实际回款', row.id)}${actionLink('edit-claim', '查看 / 编辑应收', row.id)}</div></section>`, '当前没有未收回的应收。'); return;
    }
    if (mode === 'excluded') { showPagedModal(ctx, '已排除的重复证据', `<p class="bk-copy">${month ? e(month) + ' · ' : ''}共 ${calculated.excludedEvidence.length} 条，完整保留但不重复计入金额。主记录可能采用不同日期。</p>`, calculated.excludedEvidence, row => `<section class="bk-record bk-record-stack"><span class="bk-label">重复证据</span>${txLink(ctx, state, row.transactionId)}<span class="bk-label">采用的主记录</span>${txLink(ctx, state, row.primaryId)}</section>`, '这个范围内没有排除的重复证据。'); return; }
    if (mode.startsWith('account-') || mode === 'transfer-principal') { showAccountFlowDrilldown(ctx, state, calculated, mode, month); return; }
    const modes = { 'personal-expense': ['个人消费明细', 'personalExpenseCents', calculated.personal.expenseCents], 'ordinary-income': ['普通收入明细', 'ordinaryIncomeCents', calculated.personal.incomeCents], 'cash-income': [cashLabel(ctx, '对外现金流入明细'), 'cashIncomeCents', calculated.cash.incomeCents], 'cash-expense': [cashLabel(ctx, '对外现金流出明细'), 'cashExpenseCents', calculated.cash.expenseCents] };
    if (!Object.hasOwn(modes, mode)) throw Error('未知的统计口径');
    const [title, key, total] = modes[mode];
    if (mode === 'personal-expense' || mode === 'ordinary-income') {
      const events = mode === 'personal-expense' ? calculated.personalExpenseEvents : calculated.personalIncomeEvents;
      const transactions = new Map(state.transactions.map(t => [t.id, t]));
      const rows = events.filter(event => event.amountCents > 0).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || (a.route.kind==='transaction'?eventTransactionId(a):a.key.id).localeCompare(b.route.kind==='transaction'?eventTransactionId(b):b.key.id));
      showPagedModal(ctx, title, `${roleNotice(ctx)}<p class="bk-copy">${month ? e(month) : '全部日期'} · 合计 ${amount(ctx, total)}。退款与回款按分配后口径计算；点击交易可查看完整现金与个人口径。</p>`, rows, event => `<section class="bk-record"><div>${eventTxLink(ctx, transactions, event)}</div><strong>${amount(ctx, event.amountCents)}</strong></section>`, '这个范围内没有计入此口径的交易。');
      return;
    }
    const rows = state.transactions.filter(t => (!month || t.date.slice(0, 7) === month) && calculated.impacts[t.id][key] > 0).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    showPagedModal(ctx, title, `${roleNotice(ctx)}<p class="bk-copy">${month ? e(month) : '全部日期'} · 合计 ${amount(ctx, total)}。退款与回款按分配后口径计算；点击交易可查看完整现金与个人口径。</p>`, rows, t => `<section class="bk-record"><div>${txLink(ctx, state, t.id)}</div><strong>${amount(ctx, calculated.impacts[t.id][key])}</strong></section>`, '这个范围内没有计入此口径的交易。');
  }
  function showSnapshotDetails(ctx, id) {
    const state = stateOf(ctx), data = dataOf(ctx, state), snapshot = data.snapshots.find(s => s.id === id);
    if (!snapshot) throw Error('余额快照不存在');
    const calculated = engineOf(ctx).calculate(state), result = engineOf(ctx).reconciliation(state, id), account = state.accounts.find(a => a.id === snapshot.accountId);
    const rows = state.transactions.filter(t => t.date <= snapshot.date && (t.accountId === snapshot.accountId || t.toAccountId === snapshot.accountId)).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    const intro = `<p class="bk-copy">${e(account.name)} · ${e(snapshot.date)} 日终。当前期初余额 ${amount(ctx, account.openingBalanceCents)} + 下列有效现金变动 = 当前账本余额 ${amount(ctx, result.ledgerBalanceCents)}。</p><p class="bk-copy">你记录的实际余额 ${amount(ctx, result.actualBalanceCents)}；差异（实际 − 账本）${amount(ctx, result.differenceCents)}。${result.changed ? '该日账本依据在快照记录后已变化。' : '该日账本依据自快照保存后未变化。'}</p><p class="bk-method-note">期初余额假定位于全部交易之前。以下包括截至该日日终的全部相关交易，未来交易不纳入；重复证据标记为零影响。</p>`;
    showPagedModal(ctx, '核对日终余额的依据', intro, rows, t => {
      const impact = calculated.impacts[t.id], signed = impact.excluded || impact.fundingAuthority === false ? 0 : t.accountId === snapshot.accountId ? (t.type === 'income' ? t.amountCents : -t.amountCents) : t.amountCents;
      return `<section class="bk-record"><div>${txLink(ctx, state, t.id)}${impact.excluded ? '<span class="bk-badge">重复证据 · 零影响</span>' : impact.fundingAuthority === false ? '<span class="bk-badge">仅个人消费证据 · 账户零影响</span>' : ''}</div><strong>${amount(ctx, signed)}</strong></section>`;
    }, '截至该日没有相关交易，账本余额等于期初余额。');
  }
  function canReplaceModal(ctx) {
    const form = ctx.$('#entry-form');
    if (!form || form.dataset.dirty !== 'true') return true;
    if (typeof root.confirm !== 'function' || !root.confirm('放弃未保存的修改，打开账务核对操作？')) return false;
    form.dataset.dirty = 'false'; return true;
  }
  function dispatch(ctx, target) {
    if (ctx.isActive?.() === false) return;
    const action = target.dataset.bkAction, id = target.dataset.bkId;
    if (action === 'tab') { root.MoneygoRefundReceiptsUI?.invalidate('已切换账务页面，请重新复核。'); if (!TABS.some(t => t[0] === id)) return; ui.tab = id; ctx.render(); ctx.$('#bk-workspace')?.focus(); return; }
    if (action === 'page') { const key = target.dataset.bkKey; ui.offsets[key] = Math.max(0, (ui.offsets[key] || 0) + Number(target.dataset.bkDelta) * PAGE_SIZE); ctx.render(); ctx.$('#bk-workspace')?.focus(); return; }
    if (!canReplaceModal(ctx)) return;
    if (action === 'candidates') showCandidates(ctx, id);
    else if (action === 'transfer') showTransfer(ctx, id);
    else if (action === 'difference-candidates') showDifferenceCandidates(ctx, id);
    else if (action === 'pair') showPair(ctx, target.dataset.bkBase, id);
    else if (action === 'details') showTransaction(ctx, id);
    else if (action === 'held-position') { if(typeof ctx.showHeldPosition!=='function')throw Error('本金详情入口未加载');ctx.showHeldPosition(id); }
    else if (action === 'held-recognition') { if(typeof ctx.showHeldRecognition!=='function')throw Error('核销详情入口未加载');ctx.showHeldRecognition(target.dataset.bkPosition,id); }
    else if (action === 'refund') showRefund(ctx, id, target.dataset.bkPlan);
    else if (action === 'refund-candidates') showRefund(ctx, id, target.dataset.bkPlan, true);
    else if (action === 'plan') showPlan(ctx, id);
    else if (action === 'edit-plan') showPlan(ctx, null, id);
    else if (action === 'claim') showClaim(ctx, id);
    else if (action === 'edit-claim') showClaim(ctx, null, id);
    else if (action === 'settle') showSettlement(ctx, id);
    else if (action === 'snapshot') showSnapshot(ctx);
    else if (action === 'snapshot-details') showSnapshotDetails(ctx, id);
    else if (action === 'unlink') showUnlink(ctx, target.dataset.bkKind, id);
    else if (action === 'drilldown') showDrilldown(ctx, id, target.dataset.bkMonth);
  }
  function initialize(ctx) {
    if (ctx.isActive?.() === false) return;
    context = ctx;
    root.MoneygoRefundReceiptsUI?.initialize(ctx);
    const document = root.document;
    if (!document || boundDocument === document) return;
    boundDocument = document; ctx.onDispose?.(() => { context = null; ui.query = ''; ui.transferQuery = ''; ui.month = ''; ui.offsets = Object.create(null); });
    document.addEventListener('click', event => {
      const target = event.target.closest && event.target.closest('[data-bk-action]');
      if (!target || target.disabled || !context || context.isActive?.() === false) return;
      try { dispatch(context, target); } catch (error) { context.error(error.message); }
    });
  }
  function bind(ctx) {
    if (ctx.isActive?.() === false) return;
    initialize(ctx);
    root.MoneygoCompositeUI?.bind(ctx);
    const input = ctx.$('#bk-evidence-search');
    if (input) input.oninput = () => { if (ctx.isActive?.() === false) return; const start = input.selectionStart, end = input.selectionEnd; ui.query = input.value; ui.offsets.transactions = 0; ctx.render(); const next = ctx.$('#bk-evidence-search'); if (next) { next.focus(); try { next.setSelectionRange(start, end); } catch (_) { /* Some engines disallow a selection on search inputs. */ } } };
    const transferSearch = ctx.$('#bk-transfer-search');
    if (transferSearch) transferSearch.oninput = () => { if (ctx.isActive?.() === false) return; const start = transferSearch.selectionStart, end = transferSearch.selectionEnd; ui.transferQuery = transferSearch.value; ui.offsets.transferRows = 0; ctx.render(); const next = ctx.$('#bk-transfer-search'); if (next) { next.focus(); try { next.setSelectionRange(start, end); } catch (_) {} } };
    const month = ctx.$('#bk-month');
    if (month) month.onchange = () => { if (ctx.isActive?.() === false) return; if (/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(month.value)) { ui.month = month.value; ctx.render(); ctx.$('#bk-month')?.focus(); } };
  }
  return Object.freeze({ render, bind, initialize, transactionDetails, reportSummary, PAGE_SIZE });
}));
