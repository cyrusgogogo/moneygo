/* Exact existing-money refund review. No storage, financial writer or background job. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoneygoRefundReceiptsUI = api;
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const PAGE_SIZE = 25, PROOF_PAGE_SIZE = 10, FIELD_PAGE_SIZE = 50;
  const LIFE = { waiting: '等待核对', cancelled: '已取消', closed: '已结束' };
  const PROGRESS = { none: '尚无到账关联记录', partial: '部分到账关联记录', full: '已有足额关联记录' };
  const ROLE = { cash: '现金类账户', credit: '信用账户', restricted: '受限账户', other: '其他账户', unknown: '账户角色未知' };
  const REASONS = {
    'income-duplicate-shadow': '这是重复证据附属记录，不能再次分配。',
    'income-internal-transfer': '这是已确认的本人账户转移，不是退款收入来源。',
    'income-held-return': '这笔收入已用于退回押金或预付本金，整笔来源不能再作退款分配。',
    'income-after-today': '记录日期在今天之后，暂不能在本次到账复核中分配；原记录和已有分配保留。',
    'income-before-expense': '收入日期早于原支出，现有模型要求收入日期不早于购买日期（RELATION_DATE）；跨来源入账日期可能不同，这不证明现实中不可能退款。',
    'income-capacity-exhausted': '这笔收入当前已无可分配余额。',
    'expense-duplicate-shadow': '原支出是重复证据附属记录。',
    'expense-internal-transfer': '原支出属于已确认的本人账户转移。',
    'expense-held-position': '原支出已有押金或预付本金分类，不能重复分配。',
    'expense-composite-funding-only': '原支出仅是组合的资金证据，没有个人消费分配权。',
    'expense-capacity-exhausted': '原支出的退款和第三方应收份额已用尽可分配余额。',
    'plan-capacity-exhausted': '计划当前已无未分配份额；未来日期关联仍占用份额，不会自动释放。'
  };
  const LABEL = {
    personalIncomeCents: '普通收入', personalExpenseCents: '个人消费', personalNetCents: '个人收支差额',
    recordedExternalIncomeCents: '已记录对外流入', recordedExternalExpenseCents: '已记录对外流出', recordedExternalNetCents: '已记录对外净流量',
    accountInflowCents: '账户总流入', accountOutflowCents: '账户总流出', accountNetCents: '账户净变动',
    amountCents: '金额', expectedAmountCents: '预计金额', availableIncomeCents: '收入可分配余额', refundableExpenseCents: '原支出可分配余额',
    transactionId: '交易编号', expenseId: '原支出编号', incomeId: '收入编号', planId: '计划编号', accountId: '账户编号', categoryId: '分类编号',
    id: '记录编号', name: '名称', date: '原记录日期', dueDate: '预计日期', note: '备注', reason: '依据', status: '状态', applicability: '证明适用状态',
    createdAt: '建立时间（新记录在保存时确定）', signature: '原始签名', sourceKey: '来源', sourcePath: '来源路径', revision: '账务修订',
    rawInputUnchanged: '原始输入未改动', normalizedUnrelatedSubtreesUnchanged: '其他规范化数据未改动', oldRefundRowsUnchanged: '已有退款未改动',
    oldAuditPrefixUnchanged: '已有审计前缀未改动', transactionsAccountsCategoriesUnchanged: '交易、账户、分类未改动', planningSubtreesUnchanged: '收入和支出计划原存储未改动',
    versionBefore: '原账本版本', versionAfter: '保存后的账本版本', relationVersionBefore: '原关系版本', relationVersionAfter: '保存后的关系版本', materializedPaths: '现有写入器补全的路径', changedPaths: '本次改变的路径'
  };
  const e = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (ctx, cents) => cents === null ? '不适用' : e(ctx.money(cents));
  const safeMessage = error => { try { const d = Object.getOwnPropertyDescriptor(error || {}, 'message'); return d && typeof d.value === 'string' ? d.value : '到账复核无法完成，请保留草稿并重新核对。'; } catch (_) { return '到账复核无法完成，请保留草稿并重新核对。'; } };
  let context = null, documentBound = null, coordinator = null, session = null, generation = 0, disposed = false, lifecycleBound = false;
  function model(ctx) {
    initialize(ctx);
    if (disposed || ctx.isActive?.() === false) throw Error('当前账本会话已结束');
    if (!root.MoneygoRefundReceipts || typeof root.MoneygoRefundReceipts.createCoordinator !== 'function') throw Error('到账复核模块未加载，不能保存退款分配。请重新加载完整页面。');
    if (!coordinator) {
      if (typeof ctx.today !== 'function' || typeof ctx.now !== 'function') throw Error('到账复核需要有效的本地日期和时间，请重新加载页面。');
      coordinator = root.MoneygoRefundReceipts.createCoordinator({ today: () => context.today(), now: () => context.now() });
      if (!lifecycleBound) {
        lifecycleBound = true;
        root.addEventListener?.('pagehide', () => invalidate('页面已离开，请重新生成到账复核。'));
        root.addEventListener?.('pageshow', event => { if (event.persisted) invalidate('页面从缓存恢复，请重新生成到账复核。'); else if (session?.ticket) checkCurrent(session, true); });
      }
    }
    return coordinator;
  }
  function invalidate(reason = '复核已失效，请重新生成。', preserveDraft = false) {
    generation++;
    coordinator?.invalidateAll();
    if (session) {
      session.ticket = null;
      const form = session.form, check = form?.elements?.namedItem('confirmed');
      if (check) check.checked = false;
      const submit = context?.$('#refund-confirm'); if (submit) submit.disabled = true;
      const status = context?.$('#refund-review-status'); if (status) { status.textContent = reason; status.dataset.current = 'false'; }
      if (preserveDraft) { session.generation = generation; const refresh = context?.$('#refund-refresh'); if (refresh) refresh.hidden = false; return; }
      session.retired = true;
    }
    session = null;
  }
  function initialize(ctx) {
    if (ctx.isActive?.() === false) return;
    context = ctx;
    const doc = root.document;
    if (!doc || documentBound === doc) return;
    documentBound = doc;
    ctx.onDispose?.(() => { invalidate('当前会话已结束。'); disposed = true; context = null; coordinator = null; });
    // Re-observe on return to the document; no timer or background refund scan.
    const check = () => { if (session?.ticket) checkCurrent(session, true); };
    doc.addEventListener('visibilitychange', check);
    root.addEventListener?.('focus', check);
  }
  function live(s) { return session === s && !s.retired && s.generation === generation && s.ctx.isActive?.() !== false && s.ctx.$('#entry-form') === s.form; }
  // A cheap descriptor-first UI freshness stamp, not allocation authority. It never
  // invokes getters/toJSON or any financial projection while paging frozen proof.
  function stamp(value) {
    const seen = new Set();
    function visit(v) {
      if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
      if (typeof v === 'number' && Number.isSafeInteger(v)) return v;
      if (!v || typeof v !== 'object' || seen.has(v)) throw Error('账本数据需重新核对');
      const proto = Object.getPrototypeOf(v), array = Array.isArray(v);
      if (!array && proto !== null && Object.getPrototypeOf(proto) !== null) throw Error('账本数据需重新核对');
      const descriptors = Object.getOwnPropertyDescriptors(v), keys = Reflect.ownKeys(descriptors);
      if (keys.some(k => typeof k !== 'string' || !Object.hasOwn(descriptors[k], 'value'))) throw Error('账本数据需重新核对');
      seen.add(v);
      let result;
      if (array) {
        if (keys.length !== v.length + 1) throw Error('账本数据需重新核对');
        result = []; for (let i = 0; i < v.length; i++) { if (!Object.hasOwn(descriptors, i)) throw Error('账本数据需重新核对'); result.push(visit(descriptors[i].value)); }
      } else { result = Object.create(null); for (const key of keys.sort()) result[key] = visit(descriptors[key].value); }
      seen.delete(v); return result;
    }
    return JSON.stringify(visit(value));
  }
  function retireReview(s, message) {
    if (!live(s)) return false;
    if (s.ticket) coordinator.cancel(s.ticket);
    s.ticket = null;
    const check = s.form.elements.namedItem('confirmed'); if (check) check.checked = false;
    s.ctx.$('#refund-confirm').disabled = true;
    const status = s.ctx.$('#refund-review-status'); status.textContent = message; status.dataset.current = 'false';
    s.ctx.$('#refund-refresh').hidden = false;
    return false;
  }
  function checkCurrent(s, substantive = false) {
    if (!live(s) || !s.ticket) return false;
    try {
      const raw = (s.ctx.refundState || s.ctx.getState)(), day = s.ctx.today(), now = s.ctx.now();
      if (day !== s.ticket.review.asOfDate || typeof now !== 'string' || !Number.isFinite(Date.parse(now)) || Date.parse(now) < s.lastNow || stamp(raw) !== s.basis || substantive && !coordinator.isCurrent(raw, s.ticket)) return retireReview(s, '账本、日期或设备时间已变化。原确认已清除，请重新生成复核。');
      s.lastNow = Date.parse(now); return true;
    } catch (_) { return retireReview(s, '账本或存储当前无法核对。原确认已清除，请刷新账本后重新复核。'); }
  }
  function warn(warnings) { return warnings.length ? `<ul class="bk-warning-text">${warnings.map(w => `<li>${e(w.message)}${w.recordIds.length ? '（' + w.recordIds.map(e).join('、') + '）' : ''}</li>`).join('')}</ul>` : ''; }
  function planSummary(ctx, p) {
    if (!p) return '<p>未关联待退款计划。</p>';
    return `<section class="bk-record bk-record-stack"><h3>计划 ${e(p.planId)} · ${e(LIFE[p.lifecycle])} · ${e(PROGRESS[p.recordedProgress])}</h3><p>原支出 ${e(p.expenseId)} · 预计日期 ${e(p.dueDate || '未知')} · ${p.needsCheck ? '<strong class="bk-warning-text">超过预计日期，待核对</strong>' : e({ unknown: '日期未知', 'past-expected-date': '已过预计日期', today: '预计日期是今天，非逾期', future: '预计日期在未来' }[p.dueState])}</p><dl class="bk-numbers">${[
      ['预计金额', p.expectedAmountCents], ['截至今天已关联记录', p.recordedThroughTodayCents], ['全部日期已关联', p.allLinkedCents], ['未来日期已关联（仍占用份额）', p.futureLinkedCents], ['截至今天尚无关联记录', p.notEvidencedByTodayCents], ['当前计划可分配份额', p.planCapacityCents], ['原支出当前可分配份额', p.expenseCapacityCents]
    ].map(([label, cents]) => `<div><dt>${label}</dt><dd>${money(ctx, cents)}</dd></div>`).join('')}</dl>${p.lifecycle !== 'waiting' ? '<p class="bk-warning-text">计划已取消或结束；手动分配仍可核对，但不会重新打开计划或撤销已有分配。</p>' : ''}<p>以上仅为账本中的关联记录，不证明银行到账或商户未付款。未来关联不会释放为额外可分配份额。</p></section>`;
  }
  function overview(ctx) { return model(ctx).overview((ctx.refundState || ctx.getState)()); }
  function txSummary(ctx, t) { return `<strong>${e(t.note || t.id)}</strong><span class="bk-tx-meta">${e(t.date)} · ${money(ctx, t.amountCents)} · ${e(ctx.accountName(t.accountId))} · ${e(ctx.categoryName(t.categoryId))}</span><span class="bk-record-id">交易编号 ${e(t.id)}</span>`; }
  function pickerMarkup(name, label) { return `<fieldset class="bk-picker" data-bk-picker="${name}"><legend>${e(label)}</legend><input type="hidden" name="${name}"><label class="field">搜索日期、备注、账户、金额或交易编号<input type="search" data-bk-search maxlength="500" autocomplete="off"></label><p data-bk-picked class="bk-picked" aria-live="polite">尚未选择</p><div data-bk-pick-list class="bk-pick-list"></div><div class="bk-pager"><button class="btn" type="button" data-bk-pick-prev>上一页</button><span data-bk-pick-count role="status"></span><button class="btn" type="button" data-bk-pick-next>下一页</button></div></fieldset>`; }
  function draftOf(form) { const get = name => form.elements.namedItem(name).value; return { expenseId: get('expenseId'), incomeId: get('incomeId'), planId: get('planId'), amount: get('amount'), reason: get('reason') }; }
  function field(label, name, v, attrs = '') { return `<label class="field">${e(label)}<input name="${name}" value="${e(v || '')}" ${attrs}></label>`; }
  function candidateMarkup(ctx, row, selectedId) {
    const facts = row.ranking, match = v => v === null ? '未知 / 不适用' : v ? '相同' : '不同';
    const summary = `<strong>${e(row.note || row.incomeId)}</strong><span class="bk-tx-meta">${e(row.date)} · 原金额 ${money(ctx, row.originalAmountCents)} · 可分配 ${money(ctx, row.availableIncomeCents)} · ${e(row.account.name)}（${e(ROLE[row.account.role])}）</span><span class="bk-record-id">收入编号 ${e(row.incomeId)} · 商户 ${e(row.confirmedMerchant || '未知')}</span>`;
    return `<section class="bk-record bk-record-stack" data-refund-candidate="${e(row.incomeId)}">${row.eligible ? `<button type="button" class="bk-pick-row${selectedId === row.incomeId ? ' selected' : ''}" data-bk-pick-id="${e(row.incomeId)}" aria-pressed="${selectedId === row.incomeId}">${summary}</button>` : `<div class="bk-picked">${summary}<strong>当前不可分配</strong></div>`}<p>本次上限 ${money(ctx, row.maxAllocatableCents)} · 原支出份额 ${money(ctx, row.expenseCapacityCents)} · 计划份额 ${money(ctx, row.planCapacityCents)}</p><p class="bk-copy">排序事实：确认商户${match(facts.confirmedMerchantMatch)}；可用金额与计划余量${match(facts.exactAvailableAmountMatch)}；账户${match(facts.sameAccount)}；距 ${e(facts.basisDate)} 为 ${facts.distanceDays} 天。${facts.ambiguous ? `有 ${facts.substantiveTieCount} 条实质依据并列，存在歧义。` : ''}这些事实不是匹配概率或退款证明。</p><p>来源证据：${row.sourceEvidenceIds.length ? row.sourceEvidenceIds.map(e).join('、') : '没有导入证据，需核对原始凭证'}；重复证据关联：${row.duplicateLinkIds.length ? row.duplicateLinkIds.map(e).join('、') : '无'}</p>${row.reasonCodes.map(code => `<p class="bk-warning-text">${e(REASONS[code] || code)}</p>`).join('')}${warn(row.warnings)}<button type="button" class="text-link" data-refund-inspect="${e(row.incomeId)}">查看完整来源与容量依据</button></section>`;
  }
  function picker(s, name, rows, selectedId, onSelect, income = false) {
    const ctx = s.ctx, form = s.form, host = form.querySelector(`[data-bk-picker="${name}"]`), hidden = form.elements.namedItem(name);
    const search = host.querySelector('[data-bk-search]'), list = host.querySelector('[data-bk-pick-list]'), picked = host.querySelector('[data-bk-picked]'), prev = host.querySelector('[data-bk-pick-prev]'), next = host.querySelector('[data-bk-pick-next]'), count = host.querySelector('[data-bk-pick-count]');
    const idOf = row => income ? row.incomeId : row.id;
    let offset = 0, entries = rows;
    const remembered = new Map(rows.map(row => [idOf(row), row]));
    hidden.value = entries.some(row => idOf(row) === selectedId && (!income || row.eligible)) ? selectedId : '';
    function paint() {
      if (!live(s)) return;
      const q = search.value.toLocaleLowerCase().trim(), classification = income ? ctx.$('#refund-classification').value : 'all';
      let filtered, matchingCount, total;
      if (income) {
        const expenseId = form.elements.namedItem('expenseId').value, planId = form.elements.namedItem('planId').value || null;
        if (!expenseId) { filtered = []; matchingCount = 0; total = 0; }
        else {
          const raw = (ctx.refundState || ctx.getState)();
          let report = coordinator.candidates(raw, { expenseId, planId, classification, search: search.value, offset, limit: PAGE_SIZE });
          const last = Math.max(0, Math.floor((report.matchingCount - 1) / PAGE_SIZE) * PAGE_SIZE);
          if (offset > last) { offset = last; report = coordinator.candidates(raw, { expenseId, planId, classification, search: search.value, offset, limit: PAGE_SIZE }); }
          if (!report.completeScan) throw Error('收入候选未能完整读取，不能使用不完整列表。');
          s.candidateReport = report; entries = report.rows; filtered = entries; matchingCount = report.matchingCount; total = report.scannedIncomeCount;
          for (const row of entries) remembered.set(idOf(row), row);
          ctx.$('#refund-plan-summary').innerHTML = planSummary(ctx, report.plan);
          ctx.$('#refund-candidate-summary').textContent = `截至 ${report.asOfDate}，完整扫描 ${report.scannedIncomeCount} 笔收入；可分配 ${report.eligibleCount} 笔，当前不可分配 ${report.blockedCount} 笔；筛选后 ${report.matchingCount} 笔。各阻挡原因可重叠，不可相加。`;
        }
      } else {
        filtered = entries.filter(row => `${row.date} ${row.id} ${row.note} ${ctx.accountName(row.accountId)} ${ctx.categoryName(row.categoryId)} ${ctx.money(row.amountCents)} ${ctx.amountText(row.amountCents)}`.toLocaleLowerCase().includes(q));
        matchingCount = filtered.length; total = entries.length;
        offset = Math.min(offset, Math.max(0, Math.floor((filtered.length - 1) / PAGE_SIZE) * PAGE_SIZE));
        filtered = filtered.slice(offset, offset + PAGE_SIZE);
      }
      list.innerHTML = filtered.map(row => income ? candidateMarkup(ctx, row, hidden.value) : `<button type="button" class="bk-pick-row${hidden.value === row.id ? ' selected' : ''}" data-bk-pick-id="${e(row.id)}" aria-pressed="${hidden.value === row.id}">${txSummary(ctx, row)}</button>`).join('') || '<p class="empty compact">没有符合条件的记录。没有候选不证明没有退款；可以调整搜索或检查原始账单。</p>';
      const chosen = remembered.get(hidden.value);
      picked.innerHTML = chosen ? `<strong>已选择 ${e(idOf(chosen))}</strong>` + (income ? `<p>${e(chosen.date)} · ${money(ctx, chosen.originalAmountCents)} · ${e(chosen.account.name)}</p>` : txSummary(ctx, chosen)) : '尚未选择';
      count.textContent = matchingCount ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, matchingCount)} / ${matchingCount} 笔（全部 ${total} 笔）` : `0 笔（全部 ${total} 笔）`;
      prev.disabled = offset === 0; next.disabled = offset + PAGE_SIZE >= matchingCount;
    }
    function draw() {
      if (!live(s)) return;
      try { paint(); }
      catch (error) {
        entries = [];
        list.innerHTML = `<p class="bk-warning-text" role="alert">${e(safeMessage(error))} 当前列表不可用，不能从不完整结果选择；原选择仅保留为草稿，请重新核对。</p>`;
        count.textContent = '列表不可用，未返回完整结果'; prev.disabled = true; next.disabled = true;
        if (income) ctx.$('#refund-candidate-summary').textContent = '收入候选未能完整读取；请修正日期或刷新账本后重新核对。';
        ctx.error(safeMessage(error));
      }
    }
    search.oninput = () => { if (!live(s)) return; offset = 0; draw(); };
    prev.onclick = () => { if (!live(s)) return; offset = Math.max(0, offset - PAGE_SIZE); draw(); };
    next.onclick = () => { if (!live(s)) return; offset += PAGE_SIZE; draw(); };
    list.onclick = event => {
      if (!live(s)) return;
      const target = event.target.closest?.('[data-bk-pick-id]'), detail = event.target.closest?.('[data-refund-inspect]');
      if (detail?.dataset.refundInspect && income) { const row = entries.find(r => r.incomeId === detail.dataset.refundInspect); if (row) showInspection(s, row); return; }
      if (!target || target.disabled) return;
      const row = entries.find(r => idOf(r) === target.dataset.bkPickId);
      if (!row || income && !row.eligible) return;
      hidden.value = idOf(row); form.dataset.dirty = 'true'; draw(); onSelect?.(hidden.value);
    };
    if (!income) draw();
    return { draw, reset(id = '') { offset = 0; hidden.value = id; if (income && id) { const row = remembered.get(id); if (!row) { const raw = (ctx.refundState || ctx.getState)(), t = raw.transactions.find(t => t.id === id); if (t) remembered.set(id, { incomeId: t.id, date: t.date, originalAmountCents: t.amountCents, account: { name: ctx.accountName(t.accountId) } }); } } draw(); } };
  }
  function retainedDraft(ctx, draft, suggested, message) {
    // Stale/blocked storage must not be read as current finance. Retain only the
    // user's detached inputs for copying/editing until the host is refreshed.
    ctx.modal('保留未保存的退款草稿', `<form id="entry-form" class="bk-form" data-refund-stage="blocked-draft"><p class="bk-warning-text">${e(message)} 本次未保存；以下只保留你输入的草稿，不是当前有效的财务证明。刷新页面前请自行复制需要保留的输入。</p>${field('原支出编号', 'expenseId', draft.expenseId, 'required')}${field('收入编号', 'incomeId', draft.incomeId, 'required')}${field('计划编号（可留空）', 'planId', draft.planId)}${field('本次分配金额（人民币元）', 'amount', draft.amount, 'inputmode="decimal" required')}<label class="field full">退款分配依据<textarea name="reason" maxlength="500" required>${e(draft.reason)}</textarea></label><div class="modal-bottom"><button type="button" class="btn" data-close>关闭草稿</button><button type="submit" class="btn">重新检查账本并返回选择</button></div></form>`, '', () => {
      const s = { ctx, form: ctx.$('#entry-form'), generation, retired: false, ticket: null, kind: 'blocked-draft' }; session = s;
      s.form.onsubmit = event => { event.preventDefault(); if (!live(s)) return; try { const next = draftOf(s.form); (ctx.refundState || ctx.getState)(); showDraft(ctx, next, suggested); } catch (error) { ctx.error(safeMessage(error)); } };
      s.form.addEventListener('input', () => { if (live(s)) s.form.dataset.dirty = 'true'; });
    });
  }
  function showDraft(ctx, seed = {}, suggested = false) {
    model(ctx);
    const draft = { expenseId: seed.expenseId || '', incomeId: seed.incomeId || '', planId: seed.planId || '', amount: seed.amount || '', reason: seed.reason || '' };
    let raw;
    try { raw = (ctx.refundState || ctx.getState)(); }
    catch (error) { if (draft.amount || draft.reason) return retainedDraft(ctx, draft, suggested, safeMessage(error)); throw error; }
    const plans = raw.bookkeeping?.refundPlans || [], chosen = plans.find(p => p.id === draft.planId);
    if (draft.planId && !chosen) throw Error('待退款计划不存在，请重新选择');
    if (chosen) draft.expenseId = chosen.expenseId;
    const calculated = (ctx.engine || root.MoneygoRelations).calculate(raw), held = new Set((raw.bookkeeping?.heldPositions || []).map(p => p.expenseId));
    const expenses = raw.transactions.filter(t => t.type === 'expense' && !held.has(t.id) && !calculated.impacts[t.id].excluded && !calculated.impacts[t.id].transferPairId && calculated.impacts[t.id].personalAuthority !== false).slice().sort((a, b) => b.date.localeCompare(a.date) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const body = `<form id="entry-form" class="bk-form" data-refund-stage="draft"><p class="bk-copy">只分配账本中已有的收入，不新增交易或账户资金变动。${suggested ? '候选仅为待核对线索，不会替你选择收入、填写金额或同意保存。' : ''}先选择原支出和具体收入，亲自填写金额与依据，再完整复核。银行及平台覆盖未知。</p>${pickerMarkup('expenseId', '1. 原支出（可跨月）')}<p id="bk-expense-hint" role="status"></p><label class="field">对应待退款计划（可选）<select name="planId" id="bk-refund-plan"><option value="">不关联计划</option></select></label><div id="refund-plan-summary"></div><label class="field">收入记录范围<select id="refund-classification"><option value="all">全部收入（含当前不可分配）</option><option value="eligible">当前可分配</option><option value="blocked">当前不可分配及原因</option></select></label><p id="refund-candidate-summary" role="status"></p>${pickerMarkup('incomeId', '2. 具体收入记录')}<p id="bk-income-hint" role="status"></p><p>扫描范围仅含当前有效的已记收入；本人原生转账、回收站及未提交导入不在范围内。未找到记录不代表商户未退款。</p>${field('本次分配金额（人民币元）', 'amount', draft.amount, 'type="text" inputmode="decimal" maxlength="14" required')}<label class="field full">退款分配依据<textarea name="reason" rows="3" maxlength="500" required>${e(draft.reason)}</textarea></label><div class="modal-bottom">${ctx.cancel || '<button type="button" class="btn" data-close>取消</button>'}<button type="submit" class="btn primary">生成完整到账复核</button></div></form>`;
    ctx.modal('分配一笔实际到账退款', body, '', () => {
      const form = ctx.$('#entry-form'), s = { ctx, form, generation, ticket: null, retired: false, kind: 'draft', draft, suggested };
      session = s;
      const plan = form.elements.namedItem('planId'); let incomePicker;
      ctx.$('#refund-classification').value = 'all';
      function refreshIncome() {
        if (!live(s)) return;
        try {
          const expenseId = form.elements.namedItem('expenseId').value, selectedId = form.elements.namedItem('incomeId').value || draft.incomeId;
          if (!expenseId) { incomePicker.reset(); ctx.$('#refund-candidate-summary').textContent = '先选择原支出，再查看全部收入的可分配依据。'; return; }
          incomePicker.reset(selectedId);
          ctx.$('#bk-expense-hint').textContent = '所有候选均保留；请核对来源、日期和剩余份额。';
          ctx.$('#bk-income-hint').textContent = '未来日期记录可查看但不能选择；原记录与既有分配保持不变。';
        } catch (error) { form.elements.namedItem('incomeId').value = ''; ctx.$('#refund-candidate-summary').textContent = safeMessage(error); ctx.error(safeMessage(error)); }
      }
      incomePicker = picker(s, 'incomeId', [], '', () => {}, true);
      picker(s, 'expenseId', expenses, draft.expenseId, id => {
        const prior = plan.value;
        plan.innerHTML = '<option value="">不关联计划</option>' + plans.filter(p => p.expenseId === id).map(p => `<option value="${e(p.id)}"${p.id === prior ? ' selected' : ''}>${e(p.id)} · ${e(LIFE[p.status])} · ${money(ctx, p.expectedAmountCents)} · ${e(p.note)}</option>`).join('');
        form.elements.namedItem('incomeId').value = ''; draft.incomeId = ''; refreshIncome();
      });
      plan.innerHTML = '<option value="">不关联计划</option>' + plans.filter(p => p.expenseId === draft.expenseId).map(p => `<option value="${e(p.id)}"${p.id === draft.planId ? ' selected' : ''}>${e(p.id)} · ${e(LIFE[p.status])} · ${money(ctx, p.expectedAmountCents)} · ${e(p.note)}</option>`).join('');
      plan.onchange = () => { if (live(s)) { form.dataset.dirty = 'true'; refreshIncome(); } };
      ctx.$('#refund-classification').onchange = () => { if (live(s)) incomePicker.draw(); };
      form.addEventListener('input', () => { if (live(s)) form.dataset.dirty = 'true'; });
      form.addEventListener('change', () => { if (live(s)) form.dataset.dirty = 'true'; });
      form.onsubmit = event => {
        event.preventDefault(); if (!live(s)) return;
        if (typeof form.reportValidity === 'function' && !form.reportValidity()) return;
        try {
          const values = draftOf(form);
          if (!values.expenseId || !values.incomeId) throw Error('请先选择原支出与当前可分配的具体收入记录');
          const command = { expenseId: values.expenseId, incomeId: values.incomeId, planId: values.planId || null, amountCents: ctx.ledger.parseAmount(values.amount), reason: values.reason };
          showReview(ctx, values, command, suggested);
        } catch (error) { ctx.error(safeMessage(error)); }
      };
      refreshIncome();
    });
  }
  function capacitySummary(ctx, before, after) {
    return `<dl class="bk-numbers">${[['收入可分配', 'receiptAvailableCents'], ['原支出可分配', 'expenseRefundableCents'], ['计划可分配', 'planAvailableCents'], ['本次最大可分配', 'maximumCents']].map(([label, key]) => `<div><dt>${label}</dt><dd>${money(ctx, before[key])}${after ? ' → ' + money(ctx, after[key]) : ''}</dd></div>`).join('')}</dl>`;
  }
  function sourceSummary(ctx, source, proof, title) {
    const record = proof.entries.find(p => p.ref === source.transactionRef)?.value;
    if (!record) throw Error('完整来源证明未能解析，不能继续复核');
    return `<section class="bk-record bk-record-stack"><h3>${e(title)} · ${e(source.transactionId)}</h3><strong>${e(record.note || record.id)}</strong><p>${e(record.date)} · ${money(ctx, record.amountCents)} · ${e(record.type === 'income' ? '收入' : '支出')} · 分类 ${e(record.categoryId)}</p><p>账户 ${e(source.account.name)}（${e(source.account.id)}；${e(ROLE[source.account.role])}） · 确认商户 ${e(source.confirmedMerchant || '未知')}</p><p>完整来源 ${source.evidenceRefs.length} 条；关联交易证据 ${source.linkedSourceIds.length} 条；重复关联 ${source.duplicateLinkRefs.length} 条。${source.account.role !== 'cash' ? '这是已记录账户入账或支出，不据此称为新增可花现金。' : ''}</p><button type="button" class="text-link" data-refund-proof-ref="${e(source.transactionRef)}">查看这笔原交易完整字段</button></section>`;
  }
  function totalsSummary(ctx, label, totals) { return `<section class="bk-record bk-record-stack"><h3>${e(label)}</h3><dl class="bk-numbers">${Object.keys(totals.before).map(key => `<div><dt>${e(LABEL[key] || key)}</dt><dd>${money(ctx, totals.before[key])} → ${money(ctx, totals.after[key])}</dd></div>`).join('')}</dl></section>`; }
  function reviewSummary(ctx, r) {
    return `<p class="bk-warning-text">待确认，尚未保存。这里只建立一条已存在金额的有审计重分类；不付款、不新增交易、不再次改变账户余额，也不自动结束计划。</p><p>复核本地日期 ${e(r.asOfDate)} · 本次分配 <strong>${money(ctx, r.command.amountCents)}</strong></p><p>保存依据：${e(r.command.reason)}</p>${sourceSummary(ctx, r.expense, r.proof, '原支出')}${sourceSummary(ctx, r.receipt, r.proof, '选定收入')}<h3>可分配份额：保存前 → 保存后</h3>${capacitySummary(ctx, r.capacity.before, r.capacity.after)}<h3>计划：保存前</h3>${planSummary(ctx, r.plan.before)}<h3>计划：保存后</h3>${planSummary(ctx, r.plan.after)}${warn(r.warnings)}${totalsSummary(ctx, '全部日期的口径变化', r.effects.allDateTotals)}${r.effects.affectedMonths.map(m => totalsSummary(ctx, m.month + ' 原日期月份的口径变化', m.totals)).join('')}<section class="bk-record bk-record-stack"><h3>全部账户余额保持不变</h3>${r.effects.accountBalances.map(a => `<p>${e(ctx.accountName(a.accountId))}（${e(a.accountId)}）：${money(ctx, a.beforeCents)} → ${money(ctx, a.afterCents)}；变动 ${money(ctx, a.deltaCents)}</p>`).join('')}<p>已记录对外流量不是实时可花现金；信用、受限及未知角色账户请按原角色理解。原资金流量及账户变动保留。</p></section><section class="bk-record bk-record-stack"><h3>收入与支出计划证明影响</h3><p>计划归属不另扣一次收入或支出份额。原计划及证明记录保留，适用状态可能因本次分类变化而失效；不会自动重新确认。</p>${r.effects.planningAttributions.length ? r.effects.planningAttributions.map(p => `<p>${p.planner === 'income' ? '收入计划' : '支出计划'} ${e(p.planId)} · 归属 ${e(p.attributionId)} · 原交易 ${e(p.transactionId)}：证明适用状态 ${e(p.beforeApplicability)} → ${e(p.afterApplicability)}；${p.viewChanged ? '视图已改变，需重新核对' : '视图未改变'}。<button type="button" class="text-link" data-refund-proof-ref="${e(p.storedProofRef)}">完整原证明</button> <button type="button" class="text-link" data-refund-proof-ref="${e(p.beforeViewRef)}">改变前视图</button> <button type="button" class="text-link" data-refund-proof-ref="${e(p.afterViewRef)}">改变后视图</button></p>`).join('') : '<p>没有受本次选择影响或关联到选定来源的既有计划归属。</p>'}</section><section class="bk-record bk-record-stack"><h3>历史月结与数据保留</h3><p>已有冻结月结仍是历史记录，本次个人消费可能改变；需另行核对当前口径。</p>${r.effects.affectedSavedCloses.map(c => `<p>保留月结 ${e(c.closeId)} · ${e(c.month)}</p>`).join('')}<dl class="refund-proof-fields">${Object.entries(r.preservation).map(([key, value]) => `<div><dt>${e(LABEL[key] || key)}</dt><dd>${e(Array.isArray(value) ? value.join('、') || '无' : value === true ? '已验证' : value === null ? '原本未存储' : value)}</dd></div>`).join('')}</dl><p>待保存退款 ${e(r.generated.refundId)} · 审计 ${e(r.generated.auditId)} · 修订 ${r.generated.revision}；新记录时间在实际保存操作时确定。</p></section>`;
  }
  function proofMarkup(proof) { return `<section class="bk-record bk-record-stack" id="refund-proof"><h3>完整冻结证明（${proof.entries.length} 项，全部可查）</h3><p>这里只翻阅本次复核中固定的来源、容量消耗、两端交易、计划证明与财务视图。不会重新计算、自动改变选择或保存。</p><p>${Object.entries(proof.closure).map(([key, refs]) => `${e({ selectedSourceRefs: '选定来源', receiptReductionRefs: '收入份额消耗', expenseReductionRefs: '支出份额消耗', planAllocationRefs: '计划已有分配', eligibilityRefs: '角色资格', provenanceRefs: '来源与批次', planningRefs: '计划原证明和视图', financialRefs: '财务口径' }[key])} ${refs.length} 项`).join('；')}</p><label class="field">搜索证明类别、编号或路径<input id="refund-proof-search" type="search" maxlength="500"></label><div id="refund-proof-list"></div><div class="bk-pager"><button type="button" class="btn" id="refund-proof-prev">上一组证明</button><span id="refund-proof-count" role="status"></span><button type="button" class="btn" id="refund-proof-next">下一组证明</button></div><h4 id="refund-proof-title"></h4><div id="refund-proof-fields"></div><div class="bk-pager"><button type="button" class="btn" id="refund-fields-prev">上一页字段</button><span id="refund-fields-count" role="status"></span><button type="button" class="btn" id="refund-fields-next">下一页字段</button></div></section>`; }
  function proofBrowser(s, proof) {
    const ctx = s.ctx; let offset = 0, fieldOffset = 0, selected = proof.entries[0] || null, leaves = [];
    const guard = () => live(s) && (s.kind !== 'review' || !s.ticket || checkCurrent(s));
    function flatten(value, path = '') {
      if (value !== null && typeof value === 'object' && Object.keys(value).length) for (const key of Object.keys(value)) flatten(value[key], path ? path + '.' + key : key);
      else leaves.push([path || '记录', value]);
    }
    function detail() {
      if (!selected) { ctx.$('#refund-proof-fields').textContent = '无证明项'; return; }
      ctx.$('#refund-proof-title').textContent = `${selected.phase === 'before' ? '保存前' : '保存后'} · ${selected.kind} · ${selected.recordId || '整体视图'} · ${selected.ref}`;
      ctx.$('#refund-proof-fields').innerHTML = `<p class="bk-record-id">${e(selected.sourcePath)}</p><dl class="refund-proof-fields">${leaves.slice(fieldOffset, fieldOffset + FIELD_PAGE_SIZE).map(([path, value]) => { const key = path.split('.').at(-1), display = typeof value === 'number' && /Cents$/.test(key) ? money(ctx, value) : e(value === null ? '未知 / 不适用（null）' : value === true ? '是' : value === false ? '否' : Array.isArray(value) ? '空数组' : typeof value === 'object' ? '空对象' : value); return `<div><dt>${e(LABEL[key] || key)} <span class="bk-record-id">${e(path)}</span></dt><dd>${display}</dd></div>`; }).join('')}</dl>`;
      ctx.$('#refund-fields-count').textContent = leaves.length ? `${fieldOffset + 1}–${Math.min(fieldOffset + FIELD_PAGE_SIZE, leaves.length)} / ${leaves.length} 个字段` : '0 个字段';
      ctx.$('#refund-fields-prev').disabled = fieldOffset === 0; ctx.$('#refund-fields-next').disabled = fieldOffset + FIELD_PAGE_SIZE >= leaves.length;
    }
    function choose(entry) { selected = entry; fieldOffset = 0; leaves = []; flatten(entry.value); detail(); }
    function draw() {
      const q = ctx.$('#refund-proof-search').value.toLocaleLowerCase().trim(), rows = proof.entries.filter(p => `${p.kind} ${p.ref} ${p.recordId || ''} ${p.sourcePath} ${p.phase}`.toLocaleLowerCase().includes(q));
      offset = Math.min(offset, Math.max(0, Math.floor((rows.length - 1) / PROOF_PAGE_SIZE) * PROOF_PAGE_SIZE));
      ctx.$('#refund-proof-list').innerHTML = rows.slice(offset, offset + PROOF_PAGE_SIZE).map(p => `<p><button class="text-link" type="button" data-refund-proof-ref="${e(p.ref)}">${e(p.phase === 'before' ? '保存前' : '保存后')} · ${e(p.kind)} · ${e(p.recordId || '整体视图')} · ${e(p.ref)}</button></p>`).join('') || '<p>没有符合搜索的证明。</p>';
      ctx.$('#refund-proof-count').textContent = rows.length ? `${offset + 1}–${Math.min(offset + PROOF_PAGE_SIZE, rows.length)} / ${rows.length} 项` : '0 项';
      ctx.$('#refund-proof-prev').disabled = offset === 0; ctx.$('#refund-proof-next').disabled = offset + PROOF_PAGE_SIZE >= rows.length;
    }
    ctx.$('#refund-proof-search').oninput = () => { if (!guard()) return; offset = 0; draw(); };
    ctx.$('#refund-proof-prev').onclick = () => { if (!guard()) return; offset = Math.max(0, offset - PROOF_PAGE_SIZE); draw(); };
    ctx.$('#refund-proof-next').onclick = () => { if (!guard()) return; offset += PROOF_PAGE_SIZE; draw(); };
    ctx.$('#refund-fields-prev').onclick = () => { if (!guard()) return; fieldOffset = Math.max(0, fieldOffset - FIELD_PAGE_SIZE); detail(); };
    ctx.$('#refund-fields-next').onclick = () => { if (!guard()) return; fieldOffset += FIELD_PAGE_SIZE; detail(); };
    s.form.addEventListener('click', event => { const target = event.target.closest?.('[data-refund-proof-ref]'); if (!target || !guard()) return; const entry = proof.entries.find(p => p.ref === target.dataset.refundProofRef); if (entry) choose(entry); });
    if (selected) choose(selected); draw();
  }
  function showInspection(s, row) {
    if (!live(s)) return;
    const ctx = s.ctx, draft = draftOf(s.form), suggested = s.suggested;
    try {
      const inspection = coordinator.inspect((ctx.refundState || ctx.getState)(), { expenseId: row.expenseId, incomeId: row.incomeId, planId: row.planId });
      ctx.modal('收入来源与可分配依据', `<form id="entry-form" class="bk-form" data-refund-stage="inspect"><p>仅查看来源，不代表同意分配。${inspection.eligible ? '当前符合基础资格，仍需填写金额和完整复核。' : '当前不能分配，完整记录仍保留。'}</p>${sourceSummary(ctx, inspection.expense, inspection.proof, '原支出')}${sourceSummary(ctx, inspection.receipt, inspection.proof, '收入来源')}${inspection.reasonCodes.map(c => `<p class="bk-warning-text">${e(REASONS[c] || c)}</p>`).join('')}${capacitySummary(ctx, inspection.capacity)}${planSummary(ctx, inspection.plan)}${warn(inspection.warnings)}${proofMarkup(inspection.proof)}<div class="modal-bottom"><button type="button" class="btn" data-close>暂不处理</button><button type="button" class="btn primary" id="refund-inspect-back">返回原草稿</button></div></form>`, '', () => {
        const next = { ctx, form: ctx.$('#entry-form'), generation, retired: false, kind: 'inspect', ticket: null }; session = next;
        proofBrowser(next, inspection.proof);
        ctx.$('#refund-inspect-back').onclick = () => { if (live(next)) showDraft(ctx, draft, suggested); };
        next.form.onsubmit = event => event.preventDefault();
      });
    } catch (error) { ctx.error(safeMessage(error)); }
  }
  function showReview(ctx, draft, command, suggested) {
    // Opening the new modal retires any prior UI review before minting this one.
    ctx.modal('完整到账分配复核', `<form id="entry-form" class="bk-form" data-refund-stage="review"><p id="refund-review-status" role="status" data-current="false">正在核对完整来源与影响，尚未保存。</p><div id="refund-review-body"></div><label class="confirm-check"><input type="checkbox" name="confirmed" id="refund-consent">我已核对上面具体收入、原支出、金额、全部来源与容量消耗，以及计划和历史口径影响，同意只保存这一次分配</label><div class="modal-bottom"><button type="button" class="btn" data-close>取消</button><button type="button" class="btn" id="refund-review-back">返回修改草稿</button><button type="button" class="btn" id="refund-refresh" hidden>重新生成复核</button><button type="submit" class="btn primary" id="refund-confirm" disabled>确认保存这一笔分配</button></div></form>`, '', () => {
      const form = ctx.$('#entry-form'), s = { ctx, form, generation, retired: false, ticket: null, kind: 'review', draft: { ...draft }, suggested }; session = s;
      ctx.$('#refund-review-back').onclick = () => { if (live(s)) showDraft(ctx, s.draft, suggested); };
      ctx.$('#refund-refresh').onclick = () => { if (live(s)) showReview(ctx, s.draft, command, suggested); };
      try {
        s.ticket = coordinator.preview((ctx.refundState || ctx.getState)(), command); s.basis = stamp((ctx.refundState || ctx.getState)()); s.lastNow = Date.parse(ctx.now());
        if (!Number.isFinite(s.lastNow)) throw Error('当前设备时间无效，请重新核对');
        ctx.$('#refund-review-body').innerHTML = reviewSummary(ctx, s.ticket.review) + proofMarkup(s.ticket.review.proof);
        ctx.$('#refund-review-status').textContent = '本次完整复核待你明确同意；尚未保存。'; ctx.$('#refund-review-status').dataset.current = 'true';
        proofBrowser(s, s.ticket.review.proof);
      } catch (error) {
        if (s.ticket) coordinator.cancel(s.ticket); s.ticket = null;
        // An unsuccessful preview preserves the original editable inputs.
        showDraft(ctx, s.draft, suggested); ctx.error(safeMessage(error)); return;
      }
      const consent = form.elements.namedItem('confirmed');
      consent.onchange = () => { if (!live(s)) return; ctx.$('#refund-confirm').disabled = !consent.checked || !checkCurrent(s, true); };
      form.addEventListener('input', event => { if (!live(s) || event.target === consent || event.target === ctx.$('#refund-proof-search')) return; retireReview(s, '复核内容已编辑。原确认已清除，请返回草稿重新复核。'); });
      form.onsubmit = event => {
        event.preventDefault(); if (!live(s) || !s.ticket) return;
        if (!consent.checked) { ctx.error('请先明确确认本次完整复核'); return; }
        if (!checkCurrent(s, true)) return;
        const ticket = s.ticket; s.ticket = null; consent.checked = false; ctx.$('#refund-confirm').disabled = true;
        let accepted = false;
        try { accepted = ctx.change(() => coordinator.commit((ctx.refundState || ctx.getState)(), ticket, { confirmed: true }), '到账退款已保存分配，原购买月份的个人消费已更新') === true; }
        catch (error) { ctx.error(safeMessage(error)); }
        finally { coordinator.cancel(ticket); }
        if (!accepted && live(s)) {
          // The host owns error detail; do not close, clear draft or report success.
          ctx.$('#refund-review-status').textContent = '本次未保存，原账本保持不变；草稿已保留，确认已清除。请重新生成复核后再试。';
          ctx.$('#refund-review-status').dataset.current = 'false'; ctx.$('#refund-refresh').hidden = false;
        }
      };
    });
  }
  return Object.freeze({ initialize, overview, planSummary, showDraft, invalidate, PAGE_SIZE, PROOF_PAGE_SIZE, FIELD_PAGE_SIZE });
}));
