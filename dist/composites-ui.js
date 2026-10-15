/* Explicit local composite-evidence review. The host owns storage and modal lifecycle. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoneygoCompositeUI = api;
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const PAGE_SIZE = 25, ROLE_LIMIT = 20;
  let context = null, boundDocument = null, query = '', offset = 0;
  const e = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const engine = ctx => ctx.engine || root.MoneygoRelations;
  const money = (ctx, cents) => Number.isSafeInteger(cents) ? e(ctx.money(cents)) : '未知';
  const account = (state, id) => state.accounts.find(a => a.id === id)?.name || id || '未知账户';
  const tx = (state, id) => state.transactions.find(t => t.id === id);
  const groups = state => state.bookkeeping?.composites || [];
  const btn = (action, label, id, attrs) => `<button class="btn" type="button" data-com-action="${e(action)}"${id ? ` data-com-id="${e(id)}"` : ''}${attrs || ''}>${e(label)}</button>`;
  const empty = text => `<p class="bk-copy">${e(text)}</p>`;
  const field = (label, name, value, attrs) => `<label class="field">${e(label)}<input name="${e(name)}" value="${e(value)}" ${attrs || ''}></label>`;
  const reasonField = reason => `<label class="field full">确认依据 / 原因<textarea name="reason" rows="3" maxlength="500" required>${e(reason || '')}</textarea></label>`;
  const sourceLine = line => Number.isSafeInteger(line) && line >= 1 && line <= 8 * 1024 * 1024 ? '第 ' + line + ' 行' : '旧记录未保存，未知';
  function sourceDetails(state, id) {
    const rows = (state.imports?.evidence || []).filter(s => s.transactionId === id);
    return `<details class="bk-detail-group"><summary>完整来源引用（${rows.length}）</summary>${rows.length ? rows.map(s => `<section class="com-source"><p>来源 ${e(s.sourceKey)} · 证据编号 ${e(s.id)} · 原始编号 ${e(s.stableId || '未提供')} · 最近批次 ${e(s.lastBatchId || '未知')} · 最近确认的来源物理行 ${e(sourceLine(s.sourceLine))}</p><pre>${e(JSON.stringify(s, null, 2))}</pre></section>`).join('') : '<p>手工记录 / 没有导入来源。请自行核对原始凭证。</p>'}</details>`;
  }
  function rowSummary(ctx, state, id, captured) {
    const t = tx(state, id) || captured;
    if (!t) return `<p class="bk-warning-text">原记录已不存在：${e(id)}</p>`;
    return `<strong class="bk-tx-name">${e(t.note || ctx.categoryName(t.categoryId) || '支出证据')}</strong><span class="bk-tx-meta">原日期 ${e(t.date)} · 原金额 ${money(ctx, t.amountCents)} · 原账户 ${e(account(state, t.accountId))}</span><span class="bk-record-id">交易编号 ${e(id)}</span>`;
  }
  function recordRoles(ctx, state, row) {
    return `<div class="com-roles">${[['personalIds', '个人消费证据', '仅这些原记录决定个人消费、原购买月份与退款 / 应收分配。'], ['fundingIds', '实际资金证据', '仅这些原记录决定实际账户流出、余额与各自原记账日期。']].map(([key, label, copy]) => `<section class="com-role"><h3>${label}（${row[key].length} 笔）</h3><p class="bk-copy">${copy}</p>${row[key].map(id => `<div class="bk-record bk-record-stack">${rowSummary(ctx, state, id, row.signatures?.find(s => s.id === id))}${sourceDetails(state, id)}</div>`).join('')}</section>`).join('')}</div><p class="bk-copy">同一条原记录可以同时属于两个口径，在每个口径只计一次。原日期、账户与金额不改写，不合并成虚构新交易。</p>`;
  }
  function prices(ctx, row) {
    return `<dl class="bk-numbers"><div><dt>确认实付</dt><dd>${money(ctx, row.paidCents)}</dd></div><div><dt>优惠前总额</dt><dd>${money(ctx, row.grossCents)}</dd></div><div><dt>优惠金额</dt><dd>${money(ctx, row.discountCents)}</dd></div></dl><p class="bk-copy">未知金额保留为未知，不当作零，也不从其他金额反推。优惠仅用于解释价格，不记成收入。</p>`;
  }
  function roleBadge(state, id) {
    const row = groups(state).find(g => g.personalIds.includes(id) || g.fundingIds.includes(id));
    if (!row) return '';
    return `<span class="bk-badge">组合：${e(row.name)} · ${row.personalIds.includes(id) ? '个人消费证据' : '非个人消费证据'} · ${row.fundingIds.includes(id) ? '实际资金证据' : '不影响账户余额'}</span>${btn('detail', '查看组合与安全撤销', row.id)}`;
  }
  function render(ctx) {
    const state = ctx.getState(), all = groups(state).slice().reverse();
    const rows = all.filter(g => `${g.id} ${g.name} ${g.reason} ${g.personalIds.join(' ')} ${g.fundingIds.join(' ')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    offset = Math.min(offset, Math.max(0, Math.floor((rows.length - 1) / PAGE_SIZE) * PAGE_SIZE));
    return `<article class="card bk-card"><div class="card-head"><div><h2>一笔购买，多条消费与支付证据</h2><p>手工指定两个口径：两组各自合计都必须精确等于确认实付。</p></div>${btn('new', '核对一笔购买的组合')}</div><div class="notice"><span>金额相等只是一条线索。必须核对原始资料，确认属于同一次真实购买。不会猜测消费或资金角色，不会补差额、生成缺失资金或把优惠记成收入。</span></div><p class="bk-copy">例如银行 10 月 3 日合计扣款 100 元，可以对应 10 月 1 日 30 元与 10 月 2 日 70 元的消费明细。消费与资金各按自己的原日期统计。每个口径最多 ${ROLE_LIMIT} 条；手工选择可搜索所有记录，不受组合建议范围限制。</p><label class="field bk-search">搜索已确认组合<input type="search" id="com-group-search" maxlength="500" value="${e(query)}" placeholder="名称、交易编号或确认依据"></label>${rows.slice(offset, offset + PAGE_SIZE).map(g => `<section class="bk-record"><div><strong>${e(g.name)}</strong><p class="bk-copy">确认实付 ${money(ctx, g.paidCents)} · 消费 ${g.personalIds.length} 条 · 资金 ${g.fundingIds.length} 条</p><p class="bk-tx-meta">${e(g.id)} · ${e(g.reason)}</p></div>${btn('detail', '查看完整组合', g.id)}</section>`).join('') || empty('还没有符合条件的已确认购买组合。') }<div class="bk-pager">${btn('page', '上一页', '', offset === 0 ? ' disabled' : ' data-com-delta="-1"')}<span role="status">${rows.length ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, rows.length)} / ${rows.length}` : '0 条'}</span>${btn('page', '下一页', '', offset + PAGE_SIZE >= rows.length ? ' disabled' : ' data-com-delta="1"')}</div></article>`;
  }
  function eligibility(state, calculated, t) {
    const impact = calculated.impacts[t.id];
    if (t.type !== 'expense') return '只能选择原支出证据';
    if(impact?.heldFundingCents>0||impact?.heldReturnCents>0)return '已作为押金或预付款本金来源，整笔不能同时加入组合';
    if (impact?.excluded) return '已作为重复附属证据';
    if (impact?.transferPairId) return '已确认本人账户转移';
    if (groups(state).some(g => g.personalIds.includes(t.id) || g.fundingIds.includes(t.id))) return '已属于另一购买组合';
    if (state.obligations?.fees?.some(f => f.transactionId === t.id)) return '已关联信用费用';
    if (state.obligations?.contracts?.some(c => c.purchaseTransactionId === t.id)) return '已关联分期本金消费';
    return '';
  }
  function pickerMarkup(name, label, help) {
    return `<fieldset class="bk-picker com-picker" data-com-picker="${e(name)}"><legend>${e(label)}</legend><p class="bk-copy">${e(help)}</p><label class="field">搜索日期、备注、账户、金额、来源或编号<input type="search" data-com-search maxlength="500"></label><div data-com-picked aria-live="polite"></div><div class="bk-pick-list" data-com-list></div><div class="bk-pager"><button class="btn" type="button" data-com-prev>上一页</button><span data-com-count role="status"></span><button class="btn" type="button" data-com-next>下一页</button></div></fieldset>`;
  }
  function setupPicker(ctx, form, state, calculated, name, selection, limit, onChange) {
    const host = form.querySelector(`[data-com-picker="${name}"]`), input = host.querySelector('[data-com-search]'), list = host.querySelector('[data-com-list]'), picked = host.querySelector('[data-com-picked]'), prev = host.querySelector('[data-com-prev]'), next = host.querySelector('[data-com-next]'), count = host.querySelector('[data-com-count]');
    const rows = state.transactions.filter(t => t.type === 'expense').slice().sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    let pageOffset = 0;
    function draw() {
      const q = input.value.toLocaleLowerCase().trim();
      const filtered = rows.filter(t => `${t.id} ${t.date} ${t.note} ${account(state, t.accountId)} ${ctx.money(t.amountCents)} ${ctx.amountText(t.amountCents)} ${(state.imports?.evidence || []).filter(s => s.transactionId === t.id).map(s => `${s.sourceKey} ${s.id} ${s.stableId}`).join(' ')}`.toLocaleLowerCase().includes(q));
      pageOffset = Math.min(pageOffset, Math.max(0, Math.floor((filtered.length - 1) / PAGE_SIZE) * PAGE_SIZE));
      const choice = t => { const selected = selection.has(t.id), why = eligibility(state, calculated, t); return `<button class="bk-pick-row${selected ? ' selected' : ''}" type="button" data-com-pick="${e(t.id)}" aria-pressed="${selected}"${why ? ' disabled' : ''}>${rowSummary(ctx, state, t.id)}<span>${why ? e(why) : selected ? '已选择 · 点击取消' : '选择这条'}</span></button>`; };
      list.innerHTML = filtered.slice(pageOffset, pageOffset + PAGE_SIZE).map(choice).join('') || empty('没有符合搜索条件的原支出。缺失证据需先按真实资料记入账本。');
      picked.innerHTML = `<strong>已选择 ${selection.size} / ${limit} 条 · 原金额合计 ${money(ctx, [...selection].reduce((n, id) => n + (tx(state, id)?.amountCents || 0), 0))}</strong>` + [...selection].map(id => `<section class="com-selected">${rowSummary(ctx, state, id)}<button class="text-link" type="button" data-com-pick="${e(id)}">取消选择</button>${sourceDetails(state, id)}</section>`).join('');
      count.textContent = `${filtered.length ? `${pageOffset + 1}–${Math.min(pageOffset + PAGE_SIZE, filtered.length)} / ${filtered.length}` : '0'} 条（全部原支出 ${rows.length} 条；不可用原因逐条列出）`;
      prev.disabled = pageOffset === 0; next.disabled = pageOffset + PAGE_SIZE >= filtered.length;
    }
    function pick(event) {
      const target = event.target.closest?.('[data-com-pick]'); if (!target || target.disabled || ctx.$('#entry-form') !== form) return;
      const id = target.dataset.comPick, t = tx(state, id); if (!t) return;
      if (selection.has(id)) selection.delete(id);
      else { const why = eligibility(state, calculated, t); if (why) { ctx.error(why); return; } if (selection.size >= limit) { ctx.error(`本组最多选择 ${limit} 条；请先取消一条。手工消费与资金组分别最多 ${ROLE_LIMIT} 条。`); return; } selection.add(id); }
      form.dataset.dirty = 'true'; draw(); onChange?.();
    }
    list.onclick = pick; picked.onclick = pick; input.oninput = () => { if (ctx.isActive?.() === false) return; pageOffset = 0; draw(); };
    prev.onclick = () => { pageOffset = Math.max(0, pageOffset - PAGE_SIZE); draw(); }; next.onclick = () => { pageOffset += PAGE_SIZE; draw(); }; draw();
  }
  function freshDraft() { return { name: '', paid: '', gross: '', discount: '', personal: new Set(), funding: new Set(), pool: new Set(), reason: '' }; }
  function readDraft(form, draft) { for (const key of ['name', 'paid', 'gross', 'discount']) draft[key] = form.elements.namedItem(key).value; }
  function draftInput(ctx, draft) {
    const optional = text => text.trim() === '' ? null : ctx.ledger.parseAmount(text, { allowZero: true });
    return { name: draft.name, personalIds: [...draft.personal], fundingIds: [...draft.funding], paidCents: ctx.ledger.parseAmount(draft.paid), grossCents: optional(draft.gross), discountCents: optional(draft.discount) };
  }
  function bindForm(ctx, submit) {
    const form = ctx.$('#entry-form');
    form.addEventListener('input', () => { form.dataset.dirty = 'true'; }); form.addEventListener('change', () => { form.dataset.dirty = 'true'; });
    form.onsubmit = event => { event.preventDefault(); if (ctx.$('#entry-form') !== form) return; if (form.reportValidity && !form.reportValidity()) return; try { submit(form); } catch (error) { ctx.error(error.message); } };
    return form;
  }
  function showDraft(ctx, draft = freshDraft()) {
    const state = ctx.getState(), calculated = engine(ctx).calculate(state), poolLimit = engine(ctx).LIMITS?.candidatePool || 24;
    ctx.modal('核对同一次真实购买', `<form id="entry-form" class="bk-form"><p class="bk-copy">分别选择消费明细和实际支付来源。两个选择组都从空白开始；一条记录可以手动加入两个组。不会因金额相同自动确认关系。</p><div class="form-grid">${field('购买事项', 'name', draft.name, 'maxlength="80" required')}${field('确认实付（元）', 'paid', draft.paid, 'inputmode="decimal" maxlength="14" required')}${field('优惠前总额（元，留空为未知）', 'gross', draft.gross, 'inputmode="decimal" maxlength="14"')}${field('优惠金额（元，留空为未知）', 'discount', draft.discount, 'inputmode="decimal" maxlength="14"')}</div><p class="bk-copy">两组原金额各自必须等于确认实付。已知总额与优惠同时填写时：总额 − 优惠 = 实付。未知保持未知，优惠不会成为收入。</p>${pickerMarkup('personal', '1. 个人消费证据', '个人消费、退款与应收跟随这些原明细及其各自日期。最多 20 条。')}${pickerMarkup('funding', '2. 实际资金证据', '账户余额与资金流跟随这些原扣款及其各自日期。最多 20 条。')}<details class="bk-detail-group"><summary>可选：在明确范围内寻找金额组合线索</summary><p class="bk-copy">先手工指定实际资金证据，再在下面明确选择待检查的消费证据范围。建议仅检查该范围的有限子集，不能证明属于同一次购买；不会加入上面任何选择组。</p>${pickerMarkup('pool', '仅用于搜索的候选范围', `最多 ${poolLimit} 条，算法另有节点、组合条数和返回数上限；完整限制会随结果列出。手工角色选择可搜索全部原记录。`)}<button class="btn" type="button" id="com-find-subsets">只读搜索组合线索</button><div id="com-suggestions" aria-live="polite"></div></details><div class="modal-bottom">${ctx.cancel || '<button type="button" data-close>取消</button>'}<button class="btn primary" type="submit">生成影响预览，不保存</button></div></form>`, '', () => {
      const form = bindForm(ctx, current => { readDraft(current, draft); const ticket = engine(ctx).previewComposite(ctx.getState(), draftInput(ctx, draft)); showReview(ctx, ticket, draft, null); });
      const invalidate = () => { ctx.$('#com-suggestions').innerHTML = empty('选择范围已变化。需要时重新运行只读搜索；手工选择不会自动改变。'); };
      setupPicker(ctx, form, state, calculated, 'personal', draft.personal, ROLE_LIMIT);
      setupPicker(ctx, form, state, calculated, 'funding', draft.funding, ROLE_LIMIT, invalidate);
      setupPicker(ctx, form, state, calculated, 'pool', draft.pool, poolLimit, invalidate);
      ctx.$('#com-find-subsets').onclick = () => { if (ctx.$('#entry-form') !== form) return; try { readDraft(form, draft); const report = engine(ctx).compositeCandidates(ctx.getState(), { fundingIds: [...draft.funding], candidatePersonalIds: [...draft.pool] }, { maxResults: 100, maxMembers: 6, maxNodes: 10000 }); drawCandidates(ctx, ctx.getState(), report); } catch (error) { ctx.error(error.message); } };
      if (draft.personal.size || draft.funding.size || draft.name) form.dataset.dirty = 'true';
    });
  }
  // Candidate results are read-only. There is intentionally no apply-candidate action.
  function drawCandidates(ctx, state, report) {
    const rows = report.candidates || [], host = ctx.$('#com-suggestions'); let q = '', pageOffset = 0;
    host.innerHTML = `<div class="notice warning"><span>有限范围搜索，结果不是购买身份或资金角色的证明。未找到结果不代表不存在组合。必须回到上面两组逐条手工选择。</span></div><div id="com-candidate-disclosure"></div><label class="field">搜索本次返回的线索<input type="search" id="com-candidate-search" maxlength="500"></label><div id="com-candidate-rows"></div><div class="bk-pager"><button type="button" class="btn" id="com-candidate-prev">上一页</button><span id="com-candidate-count" role="status"></span><button type="button" class="btn" id="com-candidate-next">下一页</button></div>`;
    const disclosure = { ...report }; delete disclosure.candidates;
    ctx.$('#com-candidate-disclosure').innerHTML = `<p class="bk-copy">目标资金合计 ${money(ctx, report.targetCents)}。本次候选范围 ${report.candidatePersonalIds?.length || 0} / ${report.limits?.pool ?? '未知'} 条；每个建议最多 ${report.limits?.maxMembers ?? '未知'} 条；最多返回 ${report.limits?.maxResults ?? '未知'} 项；已探索 ${report.exploredNodes ?? '未知'} / ${report.limits?.maxNodes ?? '未知'} 个节点。搜索完整：${report.searchComplete ? '是' : '否'}；结果或搜索被截断：${report.truncated ? '是' : '否'}。</p><p class="bk-copy">下方保留完整范围与限制：</p><pre class="com-proof">${e(JSON.stringify(disclosure, null, 2))}</pre>`;
    function draw() {
      const filtered = rows.filter(r => JSON.stringify(r).toLocaleLowerCase().includes(q.toLocaleLowerCase())); pageOffset = Math.min(pageOffset, Math.max(0, Math.floor((filtered.length - 1) / PAGE_SIZE) * PAGE_SIZE));
      ctx.$('#com-candidate-rows').innerHTML = filtered.slice(pageOffset, pageOffset + PAGE_SIZE).map(r => `<section class="bk-record bk-record-stack"><p>目标 ${money(ctx, r.targetCents ?? report.targetCents)} · 所选金额 ${money(ctx, r.sumCents)} · 差额 ${money(ctx, r.differenceCents)}</p>${(r.personalIds || r.transactionIds || []).map(id => `<div>${rowSummary(ctx, state, id)}${sourceDetails(state, id)}</div>`).join('')}<p class="bk-copy">${(r.reasons || []).map(e).join('；')}</p><p class="bk-copy bk-warning-text">${(r.warnings || []).map(e).join('；')}</p><details><summary>完整线索记录</summary><pre>${e(JSON.stringify(r, null, 2))}</pre></details></section>`).join('') || empty('本次返回结果中没有匹配项；请检查明确范围和搜索限制。');
      ctx.$('#com-candidate-count').textContent = filtered.length ? `${pageOffset + 1}–${Math.min(pageOffset + PAGE_SIZE, filtered.length)} / ${filtered.length}` : '0 条';
      ctx.$('#com-candidate-prev').disabled = pageOffset === 0; ctx.$('#com-candidate-next').disabled = pageOffset + PAGE_SIZE >= filtered.length;
    }
    ctx.$('#com-candidate-search').oninput = event => { q = event.target.value; pageOffset = 0; draw(); }; ctx.$('#com-candidate-prev').onclick = () => { pageOffset = Math.max(0, pageOffset - PAGE_SIZE); draw(); }; ctx.$('#com-candidate-next').onclick = () => { pageOffset += PAGE_SIZE; draw(); }; draw();
  }
  function metricPair(ctx, label, before, after) { return `<div><dt>${e(label)}</dt><dd>操作前 ${money(ctx, before)} → 操作后 ${money(ctx, after)}${Number.isSafeInteger(before) && Number.isSafeInteger(after) ? ` · 差额 ${money(ctx, after - before)}` : ''}</dd></div>`; }
  function totalsReview(ctx, before, after) {
    return `<dl class="com-effects">${metricPair(ctx, '个人消费', before?.personal?.expenseCents, after?.personal?.expenseCents)}${metricPair(ctx, '普通收入', before?.personal?.incomeCents, after?.personal?.incomeCents)}${metricPair(ctx, root.MoneygoObligationsUI?.legacyCashLabel(ctx, '对外现金流出') || '对外现金流出', before?.cash?.expenseCents, after?.cash?.expenseCents)}${metricPair(ctx, '账户实际流出', before?.accountFlows?.outflowCents, after?.accountFlows?.outflowCents)}</dl>`;
  }
  function accountFlowReview(ctx, state, before, after) {
    const ids = [...new Set([...Object.keys(before?.accountFlowsByAccount || {}), ...Object.keys(after?.accountFlowsByAccount || {})])];
    return `<div class="com-account-flows">${ids.map(id => `<h4>${e(account(state, id))} · ${e(id)} · 本范围实际账户流量</h4><dl class="com-effects">${metricPair(ctx, '流入', before.accountFlowsByAccount[id]?.inflowCents, after.accountFlowsByAccount[id]?.inflowCents)}${metricPair(ctx, '流出', before.accountFlowsByAccount[id]?.outflowCents, after.accountFlowsByAccount[id]?.outflowCents)}${metricPair(ctx, '净变动', before.accountFlowsByAccount[id]?.netCents, after.accountFlowsByAccount[id]?.netCents)}</dl>`).join('')}</div>`;
  }
  function accountReview(ctx, state, before, after) {
    const ids = [...new Set([...Object.keys(before?.accountBalances || {}), ...Object.keys(after?.accountBalances || {})])];
    return `<h4>逐账户账本余额（全部已记日期，不是银行实时余额）</h4><dl class="com-effects">${ids.map(id => metricPair(ctx, account(state, id) + ' · ' + id, before?.accountBalances?.[id], after?.accountBalances?.[id])).join('')}</dl>`;
  }
  function effectsReview(ctx, ticket) {
    const state = ctx.getState();
    return `<section class="com-review"><h3>操作前后影响</h3>${totalsReview(ctx, ticket.before, ticket.after)}${accountReview(ctx, state, ticket.before, ticket.after)}${accountFlowReview(ctx, state, ticket.before, ticket.after)}<div id="com-review-months">${(ticket.months || []).map(row => `<section><h4>${e(row.month)} · 原日期所在月份</h4>${totalsReview(ctx, row.before, row.after)}${accountFlowReview(ctx, state, row.before, row.after)}</section>`).join('')}</div>${ticket.snapshots?.length ? `<h4>已有日终余额快照的影响</h4>${ticket.snapshots.map(s => `<section class="com-snapshot-impact"><p>${e(s.date)} · ${e(account(state, s.accountId))} · 快照 ${e(s.id)}</p><dl class="com-effects">${metricPair(ctx, '账本日终余额', s.before.ledgerBalanceCents, s.after.ledgerBalanceCents)}${metricPair(ctx, '差异（实际 − 账本）', s.before.differenceCents, s.after.differenceCents)}</dl><p class="bk-copy">保存依据已变化：操作前 ${s.before.changed ? '是' : '否'} → 操作后 ${s.after.changed ? '是' : '否'}。不会改写原快照实际余额。</p></section>`).join('')}` : ''}<details open class="bk-detail-group"><summary>完整按月、逐账户影响与预览依据</summary><pre class="com-proof">${e(JSON.stringify({ before: ticket.before, after: ticket.after, months: ticket.months, snapshots: ticket.snapshots }, null, 2))}</pre></details></section>`;
  }
  function showReview(ctx, originalTicket, draft, removalId, retainedReason) {
    let ticket = originalTicket, attempted = false;
    const state = JSON.parse(JSON.stringify(ctx.getState())), row = ticket.record;
    ctx.modal(removalId ? '核对撤销组合后的影响' : '核对组合影响，再明确确认', `<form id="entry-form" class="bk-form"><p class="bk-copy">${removalId ? '撤销后，每条原记录恢复独立统计，可能再次重复计金额。若要修改成员或价格，请先完成安全撤销，再重新建立一笔购买组合。' : '这是一笔经你确认的真实购买。下面两组已分别精确对平确认实付；请按原始证据核对角色与日期。'}</p><h3>${e(row.name)}</h3>${prices(ctx, row)}${recordRoles(ctx, state, row)}${effectsReview(ctx, ticket)}<ul class="bk-source-list">${(ticket.warnings || []).map(w => `<li>${e(w)}</li>`).join('')}</ul>${reasonField(retainedReason ?? draft?.reason)}<label class="confirm-check"><input type="checkbox" name="confirmed" required>${removalId ? '我已核对撤销后的各月、账户影响，确认撤销本组合' : '我已核对这是同一次购买、两个角色集合、原日期及各月 / 账户影响'}</label><p id="com-review-status" role="alert" class="bk-warning-text"></p><div class="modal-bottom">${ctx.cancel || '<button type="button" data-close>取消</button>'}${draft ? '<button class="btn" type="button" id="com-back-draft">返回修改选择</button>' : ''}<button class="btn" type="button" id="com-fresh-review" hidden>重新生成预览并核对</button><button class="btn primary" type="submit" id="com-commit">${removalId ? '确认撤销组合' : '确认保存购买组合'}</button></div></form>`, '', () => {
      const form = bindForm(ctx, current => {
        if (!ticket || attempted) throw Error('旧预览已失效。请重新生成预览并再次核对、勾选确认。');
        if (!current.elements.namedItem('confirmed').checked) throw Error('请先明确勾选确认已核对本次影响');
        const reason = current.elements.namedItem('reason').value.trim(); if (!reason) throw Error('请填写确认依据 / 原因');
        if (draft) draft.reason = reason;
        attempted = true; const activeTicket = ticket; ticket = null; ctx.$('#com-commit').disabled = true;
        let saved = false;
        try { saved = ctx.change(() => removalId ? engine(ctx).unlinkComposite(ctx.getState(), activeTicket, { confirmed: true, reason }) : engine(ctx).createComposite(ctx.getState(), activeTicket, { confirmed: true, reason }), removalId ? '组合已撤销；原交易与历史完整保留' : '购买组合已保存；两个口径采用各自原始证据与日期'); }
        catch (error) { ctx.error(error.message); }
        if (saved !== true && ctx.$('#entry-form') === form) {
          current.elements.namedItem('confirmed').checked = false; ctx.$('#com-fresh-review').hidden = false;
          ctx.$('#com-review-status').textContent = '本次未保存。草稿与原因保留；预览可能已消耗，不能重用。请重新生成预览、核对影响并再次勾选确认。';
          form.dataset.dirty = 'true';
        }
      });
      form.dataset.dirty = 'true';
      if (draft) ctx.$('#com-back-draft').onclick = () => { if (ctx.$('#entry-form') !== form) return; draft.reason = form.elements.namedItem('reason').value; ticket = null; showDraft(ctx, draft); };
      ctx.$('#com-fresh-review').onclick = () => { if (ctx.$('#entry-form') !== form) return; try { const reason = form.elements.namedItem('reason').value; const fresh = removalId ? engine(ctx).previewCompositeRemoval(ctx.getState(), removalId) : engine(ctx).previewComposite(ctx.getState(), draftInput(ctx, draft)); showReview(ctx, fresh, draft, removalId, reason); } catch (error) { ctx.error(error.message); } };
    });
  }
  function showDetail(ctx, id) {
    const state = ctx.getState(), row = groups(state).find(g => g.id === id); if (!row) throw Error('组合不存在，请刷新后核对');
    ctx.modal('已确认购买组合（只读）', `<div class="bk-form"><h3>${e(row.name)}</h3><p class="bk-copy">组合编号 ${e(row.id)} · ${e(row.createdAt)} · 确认依据：${e(row.reason)}</p>${prices(ctx, row)}${recordRoles(ctx, state, row)}<p class="bk-copy">不能直接改写组内成员或金额。修改需先清理成员上的到账退款、应收、回款与待退款计划，预览并确认撤销；然后重新选择和确认新组合。原记录与审计历史完整保留。</p><details class="bk-detail-group"><summary>已保存的完整签名与角色证明</summary><pre>${e(JSON.stringify(row, null, 2))}</pre></details></div>`, `<button type="button" class="btn" data-close>关闭</button>${btn('remove', '检查依赖并预览安全撤销', id)}`);
  }
  function showRemoval(ctx, id) {
    try { showReview(ctx, engine(ctx).previewCompositeRemoval(ctx.getState(), id), null, id); }
    catch (error) {
      const state = ctx.getState(), row = groups(state).find(g => g.id === id); if (!row) throw error;
      const ids = new Set([...row.personalIds, ...row.fundingIds]), data = state.bookkeeping;
      const claims = data.claims.filter(r => ids.has(r.expenseId)), claimIds = new Set(claims.map(r => r.id));
      const dependencies = [['refund', data.refunds.filter(r => ids.has(r.expenseId))], ['settlement', data.settlements.filter(r => claimIds.has(r.claimId))], ['claim', claims], ['refundPlan', data.refundPlans.filter(r => ids.has(r.expenseId))]];
      ctx.modal('组合暂时不能撤销', `<div class="bk-form"><p class="bk-warning-text">${e(error.message)}</p><p class="bk-copy">不会自动移除依赖或改写交易。请逐项核对，先撤销回款或退款，再处理应收与待退款计划；每项均使用现有安全撤销流程。完成后重新打开本组合预览。</p>${dependencies.flatMap(([kind, rows]) => rows.map(r => `<section class="bk-record"><div><strong>${e({ refund: '到账退款', settlement: '实际回款', claim: '应收', refundPlan: '待退款计划' }[kind])}</strong><pre>${e(JSON.stringify(r, null, 2))}</pre></div><button type="button" class="btn" data-bk-action="unlink" data-bk-kind="${kind}" data-bk-id="${e(r.id)}">核对并撤销这项依赖</button></section>`)).join('')}</div>`, `<button type="button" class="btn" data-close>关闭</button>${btn('detail', '返回组合详情', id)}`);
    }
  }
  function bind(ctx) {
    if (ctx.isActive?.() === false) return;
    context = ctx;
    if (root.document && boundDocument !== root.document) {
      boundDocument = root.document;
      ctx.onDispose?.(() => { context = null; query = ''; offset = 0; });
      root.document.addEventListener('click', event => {
        const target = event.target.closest?.('[data-com-action]'); if (!target || target.disabled || !context || context.isActive?.() === false) return;
        const action = target.dataset.comAction, id = target.dataset.comId;
        try {
          if (action === 'page') { offset = Math.max(0, offset + Number(target.dataset.comDelta) * PAGE_SIZE); context.render(); return; }
          const form = context.$('#entry-form');
          if (form?.dataset.dirty === 'true') { if (typeof root.confirm !== 'function' || !root.confirm('放弃未保存的修改，打开组合证据核对？')) return; form.dataset.dirty = 'false'; }
          if (action === 'new') showDraft(context); else if (action === 'detail') showDetail(context, id); else if (action === 'remove') showRemoval(context, id);
        } catch (error) { context.error(error.message); }
      });
    }
    const input = ctx.$('#com-group-search');
    if (input) input.oninput = () => { if (ctx.isActive?.() === false) return; const start = input.selectionStart, end = input.selectionEnd; query = input.value; offset = 0; ctx.render(); const next = ctx.$('#com-group-search'); next?.focus(); try { next?.setSelectionRange(start, end); } catch (_) {} };
  }
  return Object.freeze({ render, bind, roleBadge, recordRoles, PAGE_SIZE, ROLE_LIMIT });
}));
