/* Local-only organizer workspace. Persistence and modal ownership stay in app.js. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoneygoOrganizerUI = api;
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const PAGE_SIZE = 25;
  const cashLabel = (ctx, label) => root.MoneygoObligationsUI?.legacyCashLabel(ctx, label) || label;
  const roleNotice = ctx => root.MoneygoObligationsUI?.legacyScopeNotice(ctx, true) || '';

  const TYPES = { income: '收入', expense: '支出', transfer: '转账' };
  const REVIEW_KINDS = { quarantine: '待处理导入记录', 'duplicate-candidate': '可能重复的交易证据', 'refund-plan': '预计退款尚未到齐', claim: '尚未收回的应收', 'balance-difference': '账户余额存在差异' };
  const IMPACT_KINDS = { 'raw-row-amount': '原始待导入金额', 'possible-duplicate-upper-bound': '可能重复计入的上限', 'expected-not-received': '预计未到账金额', 'claim-outstanding': '未收回应收', 'absolute-balance-difference': '余额差额绝对值' };
  const TABS = [['review', '优先核对'], ['rules', '分类规则'], ['aliases', '商户名称'], ['scope', '数据范围'], ['closes', '月末封存'], ['history', '整理历史']];
  const ui = { tab: 'review', month: '', showDeferred: false, offsets: Object.create(null) };
  let context = null, boundDocument = null;
  const e = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const engineOf = ctx => ctx.engine || root.MoneygoOrganizer;
  const stateOf = ctx => ctx.getState();
  const dataOf = (ctx, state) => state.organizer || engineOf(ctx).defaultState();
  const today = ctx => typeof ctx.today === 'function' ? ctx.today() : ctx.today;
  const money = (ctx, cents) => Number.isSafeInteger(cents) ? e(ctx.money(cents)) : '未知';
  const txOf = (state, id) => state.transactions.find(t => t.id === id);
  const selected = (value, option) => value === option ? ' selected' : '';
  const btn = (action, label, id, extra) => `<button type="button" class="btn" data-org-action="${e(action)}"${id ? ` data-org-id="${e(id)}"` : ''}${extra || ''}>${e(label)}</button>`;
  const empty = text => `<div class="empty compact">${e(text)}</div>`;
  const tag = (text, kind) => `<span class="org-badge ${e(kind || '')}">${e(text)}</span>`;
  const field = (label, name, value, attrs) => `<label class="field">${e(label)}<input name="${e(name)}" value="${e(value == null ? '' : value)}" ${attrs || ''}></label>`;
  const textarea = (label, name, value, required) => `<label class="field full">${e(label)}<textarea name="${e(name)}" rows="3" maxlength="500" ${required ? 'required' : ''}>${e(value || '')}</textarea></label>`;
  const select = (label, name, rows, value) => `<label class="field">${e(label)}<select name="${e(name)}">${rows.map(([id, label]) => `<option value="${e(id)}"${selected(value, id)}>${e(label)}</option>`).join('')}</select></label>`;
  const checkbox = (name, label, checked, required) => `<label class="confirm-check"><input type="checkbox" name="${e(name)}" ${checked ? 'checked' : ''} ${required ? 'required' : ''}>${e(label)}</label>`;
  const card = (title, copy, body, actions) => `<article class="card org-card"><div class="card-head"><div><h2>${e(title)}</h2>${copy ? `<p>${e(copy)}</p>` : ''}</div>${actions ? `<div class="org-actions">${actions}</div>` : ''}</div>${body}</article>`;
  const formBody = (ctx, body, submit) => `<form id="entry-form" class="org-form">${body}<div class="modal-bottom">${ctx.cancel || '<button type="button" class="btn" data-close>取消</button>'}<button class="btn primary" type="submit">${e(submit)}</button></div></form>`;
  const value = (form, name) => form.elements.namedItem(name).value;
  const checked = (form, name) => form.elements.namedItem(name).checked;
  function required(value, label) { if (!value || !value.trim()) throw Error('请填写' + label); return value; }
  function bindForm(ctx, submit, ready) {
    const form = ctx.$('#entry-form'); if (!form) return;
    form.addEventListener('input', () => { form.dataset.dirty = 'true'; });
    form.addEventListener('change', () => { form.dataset.dirty = 'true'; });
    form.onsubmit = event => { event.preventDefault(); if (form.dataset.submitted === 'true') return; if (typeof form.reportValidity === 'function' && !form.reportValidity()) return; try { submit(form); } catch (error) { ctx.error(error.message); } };
    if (ready) ready(form);
  }
  function change(ctx, form, operation, success) {
    if (form.dataset.submitted === 'true') return;
    form.dataset.submitted = 'true';
    try { const saved = ctx.change(operation, success); if (saved === false) form.dataset.submitted = 'false'; }
    catch (error) { form.dataset.submitted = 'false'; throw error; }
  }
  function pageRows(key, rows, draw, message) {
    const last = Math.max(0, Math.floor((rows.length - 1) / PAGE_SIZE) * PAGE_SIZE);
    const offset = Math.min(ui.offsets[key] || 0, last); ui.offsets[key] = offset;
    return (rows.length ? rows.slice(offset, offset + PAGE_SIZE).map(draw).join('') : empty(message)) + (rows.length > PAGE_SIZE ? `<div class="org-pager" aria-label="分页">${btn('page', '上一页', key, ` data-org-delta="-1" ${offset === 0 ? 'disabled' : ''}`)}<span role="status">${offset + 1}–${Math.min(offset + PAGE_SIZE, rows.length)} / ${rows.length}</span>${btn('page', '下一页', key, ` data-org-delta="1" ${offset + PAGE_SIZE >= rows.length ? 'disabled' : ''}`)}</div>` : `<p class="org-count">共 ${rows.length} 条</p>`);
  }
  function txSummary(ctx, state, id) {
    const t = txOf(state, id); if (!t) return `<span class="org-warning">交易已不存在：${e(id)}</span>`;
    return `<strong class="org-tx-name">${e(t.note || ctx.categoryName(t.categoryId) || TYPES[t.type])}</strong><span class="org-meta">${e(t.date)} · ${e(TYPES[t.type])} ${money(ctx, t.amountCents)} · ${e(ctx.accountName(t.accountId))} · ${e(ctx.categoryName(t.categoryId))}</span><span class="org-id">交易编号 ${e(id)}</span>`;
  }
  function monthRange(month) { const year = Number(month.slice(0, 4)), m = Number(month.slice(5)); const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0); return { start: month + '-01', end: month + '-' + [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] }; }
  function render(ctx) {
    if (!engineOf(ctx)) return '<div class="notice warning" role="alert">整理模块未加载，请刷新后重试。</div>';
    try {
      const state = stateOf(ctx), data = dataOf(ctx, state); if (!ui.month) ui.month = today(ctx).slice(0, 7);
      const body = ui.tab === 'rules' ? renderRules(ctx, state, data) : ui.tab === 'aliases' ? renderAliases(ctx, state, data) : ui.tab === 'scope' ? renderScope(ctx, state) : ui.tab === 'closes' ? renderCloses(ctx, state, data) : ui.tab === 'history' ? renderHistory(ctx, data) : renderReview(ctx, state, data);
      return `<section class="organizer" id="organizer-root"><div class="notice"><span>先看依据，再确认。规则只在本地预览后应用；原始备注、来源证据和资金金额完整保留。</span></div><nav class="org-tabs" aria-label="账本整理工作区">${TABS.map(([id, label]) => `<button type="button" data-org-action="tab" data-org-id="${id}" class="${ui.tab === id ? 'active' : ''}" ${ui.tab === id ? 'aria-current="page"' : ''}>${label}</button>`).join('')}</nav><section id="org-workspace" tabindex="-1" aria-label="${e(TABS.find(t => t[0] === ui.tab)?.[1])}">${body}</section><p class="org-note">所有操作只修改当前浏览器的本地账本，不上传财务资料，不连接银行。未知覆盖不等于零消费；请定期导出备份。</p></section>`;
    } catch (error) { return `<div class="notice warning" role="alert">整理工作区暂时无法读取：${e(error.message)}。请先保留备份并核对数据。</div>`; }
  }
  function conditionsText(ctx, conditions) {
    const c = conditions || {}, parts = [];
    if (c.note) parts.push(`原始备注${c.note.operator === 'equals' ? '完全等于' : '包含'}「${c.note.value}」${c.note.caseSensitive ? '（区分大小写）' : '（不区分大小写）'}`);
    if (c.type) parts.push(TYPES[c.type] || c.type);
    if (c.accountId) parts.push('账户：' + ctx.accountName(c.accountId));
    if (c.sourceKey) parts.push('来源：' + c.sourceKey);
    if (c.minAmountCents !== undefined && c.minAmountCents !== null) parts.push('金额 ≥ ' + ctx.money(c.minAmountCents));
    if (c.maxAmountCents !== undefined && c.maxAmountCents !== null) parts.push('金额 ≤ ' + ctx.money(c.maxAmountCents));
    if (c.startDate) parts.push('日期 ≥ ' + c.startDate); if (c.endDate) parts.push('日期 ≤ ' + c.endDate);
    return parts.join('；') || '没有附加条件';
  }
  function renderRules(ctx, state, data) {
    const rows = data.rules;
    return card('由你定义的分类规则', '只支持明确文字和范围条件，不执行正则表达式或代码。保存规则不会自动修改交易。', pageRows('rules', rows, r => `<section class="org-record"><div><div class="org-record-title"><strong>${e(r.name)}</strong>${tag(r.enabled === false ? '已停用' : '启用', r.enabled === false ? '' : 'good')}</div><p class="org-copy">${e(conditionsText(ctx, r.conditions))}</p><p class="org-copy">改为 ${e(ctx.categoryName(r.actions.categoryId))}${r.actions.merchant ? ' · 商户：' + e(r.actions.merchant) : ''}</p></div><div class="org-actions">${btn('edit-rule', '编辑', r.id)}${btn('remove-rule', '删除规则', r.id)}</div></section>`, '还没有规则。先新增一个规则，再查看每笔命中的依据。'), btn('edit-rule', '新增规则') + btn('preview-rules', '预览规则', '', rows.some(r => r.enabled !== false) ? '' : ' disabled'));
  }
  function renderAliases(ctx, state, data) {
    return card('统一商户显示名称', '只匹配完整文字，不模糊猜测。别名作用于商户显示层；交易原始备注和导入证据始终保留。', pageRows('aliases', data.aliases, a => `<section class="org-record"><div><strong>${e(a.from)} → ${e(a.to)}</strong><p class="org-copy">${a.caseSensitive ? '区分大小写' : '不区分大小写'}${a.sourceKey ? ' · 来源：' + e(a.sourceKey) : ' · 全部来源'}${a.accountId ? ' · 账户：' + e(ctx.accountName(a.accountId)) : ' · 全部账户'}${a.enabled === false ? ' · 已停用' : ''}</p></div><div class="org-actions">${btn('edit-alias', '编辑', a.id)}${btn('remove-alias', '删除别名', a.id)}</div></section>`, '还没有商户别名。可以把不同写法统一为一个便于阅读的名称。'), btn('edit-alias', '新增别名') + btn('preview-aliases', '预览别名', '', data.aliases.some(a => a.enabled !== false) ? '' : ' disabled')) + renderMerchantGroups(ctx, state);
  }
  function showRule(ctx, id) {
    const state = stateOf(ctx), old = dataOf(ctx, state).rules.find(r => r.id === id); if (id && !old) throw Error('规则不存在');
    const c = old?.conditions || {}, a = old?.actions || {};
    const body = `<p class="org-copy">所有填写的条件必须同时满足。目标分类必须与交易收支类型匹配，不会改写原始备注、日期、账户或金额。保存后需另行预览并勾选交易。</p><div class="form-grid">${field('规则名称', 'name', old?.name, 'maxlength="80" required')}${select('规则状态', 'enabled', [['true', '启用'], ['false', '停用']], old?.enabled === false ? 'false' : 'true')}${select('原始备注条件', 'operator', [['contains', '包含文字'], ['equals', '完全等于'], ['', '不限制备注']], c.note?.operator || (old ? '' : 'contains'))}${field('匹配文字（选择包含 / 相等时必填）', 'noteValue', c.note?.value, 'maxlength="500"')}${select('收支类型（可选）', 'type', [['', '全部类型'], ['expense', '支出'], ['income', '收入']], c.type || '')}${select('账户范围（可选）', 'accountId', [['', '全部账户'], ...state.accounts.map(a => [a.id, a.name])], c.accountId || '')}${field('来源标识（可选，精确匹配）', 'sourceKey', c.sourceKey, 'maxlength="100"')}${field('最小金额（元，可选）', 'minAmount', c.minAmountCents == null ? '' : ctx.amountText(c.minAmountCents), 'type="text" inputmode="decimal" maxlength="14"')}${field('最大金额（元，可选）', 'maxAmount', c.maxAmountCents == null ? '' : ctx.amountText(c.maxAmountCents), 'type="text" inputmode="decimal" maxlength="14"')}${field('开始日期（可选）', 'startDate', c.startDate, 'type="date" min="0001-01-01" max="9999-12-31"')}${field('结束日期（可选）', 'endDate', c.endDate, 'type="date" min="0001-01-01" max="9999-12-31"')}${select('目标分类', 'categoryId', [['', '请选择分类'], ...state.categories.map(c => [c.id, TYPES[c.type] + ' · ' + c.name])], a.categoryId || '')}${field('同时设置商户名称（可选）', 'merchant', a.merchant, 'maxlength="80"')}</div>${checkbox('caseSensitive', '匹配原始备注时区分大小写', c.note?.caseSensitive)}${textarea('保存原因', 'reason', '', true)}`;
    ctx.modal(old ? '编辑分类规则' : '新增分类规则', formBody(ctx, body, '保存规则，不应用交易'), '', () => bindForm(ctx, form => {
      const conditions = {}; if (value(form, 'operator')) conditions.note = { operator: value(form, 'operator'), value: required(value(form, 'noteValue'), '匹配文字'), caseSensitive: checked(form, 'caseSensitive') };
      for (const key of ['sourceKey', 'accountId', 'type', 'startDate', 'endDate']) if (value(form, key)) conditions[key] = value(form, key);
      for (const [key, fieldName] of [['minAmountCents', 'minAmount'], ['maxAmountCents', 'maxAmount']]) if (value(form, fieldName).trim()) conditions[key] = ctx.ledger.parseAmount(value(form, fieldName), { allowZero: true });
      const actions = { categoryId: required(value(form, 'categoryId'), '目标分类') }; if (value(form, 'merchant').trim()) actions.merchant = value(form, 'merchant').trim();
      const input = { name: required(value(form, 'name'), '规则名称'), enabled: value(form, 'enabled') === 'true', conditions, actions, reason: required(value(form, 'reason'), '保存原因') }; if (old) input.id = old.id;
      change(ctx, form, () => engineOf(ctx).saveRule(stateOf(ctx), input), '规则已保存；请预览后再应用');
    }));
  }
  function showAlias(ctx, id) {
    const state = stateOf(ctx), old = dataOf(ctx, state).aliases.find(r => r.id === id); if (id && !old) throw Error('别名不存在');
    const body = `<p class="org-copy">只匹配完整原始备注，不沿用商户别名再次匹配。商户显示名独立保存，原始备注不会被改写。</p><div class="form-grid">${field('原名称（完整文字）', 'from', old?.from, 'maxlength="500" required')}${field('统一显示名称', 'to', old?.to, 'maxlength="80" required')}${field('来源标识（可选）', 'sourceKey', old?.sourceKey, 'maxlength="100"')}${select('账户范围（可选）', 'accountId', [['', '全部账户'], ...state.accounts.map(a => [a.id, a.name])], old?.accountId || '')}${select('别名状态', 'enabled', [['true', '启用'], ['false', '停用']], old?.enabled === false ? 'false' : 'true')}</div>${checkbox('caseSensitive', '区分大小写', old?.caseSensitive)}${textarea('保存原因', 'reason', '', true)}`;
    ctx.modal(old ? '编辑商户别名' : '新增商户别名', formBody(ctx, body, '保存别名，不应用交易'), '', () => bindForm(ctx, form => {
      const input = { from: required(value(form, 'from'), '原名称'), to: required(value(form, 'to'), '统一显示名称'), caseSensitive: checked(form, 'caseSensitive'), enabled: value(form, 'enabled') === 'true', reason: required(value(form, 'reason'), '保存原因') };
      for (const key of ['sourceKey', 'accountId']) if (value(form, key)) input[key] = value(form, key); if (old) input.id = old.id;
      change(ctx, form, () => engineOf(ctx).saveAlias(stateOf(ctx), input), '商户别名已保存；请预览后再应用');
    }));
  }
  function showRemove(ctx, kind, id) {
    const state = stateOf(ctx), list = kind === 'rule' ? dataOf(ctx, state).rules : dataOf(ctx, state).aliases, row = list.find(r => r.id === id); if (!row) throw Error('记录不存在');
    const body = `<p class="org-copy">删除「${e(row.name || row.from + ' → ' + row.to)}」只停止未来使用，不会撤销已经应用的结果。已应用变更可在整理历史中按批次撤销。</p>${textarea('删除原因', 'reason', '', true)}${checkbox('confirmed', '我确认删除此配置', false, true)}`;
    ctx.modal(kind === 'rule' ? '删除分类规则？' : '删除商户别名？', formBody(ctx, body, '确认删除'), '', () => bindForm(ctx, form => {
      if (!checked(form, 'confirmed')) throw Error('请先确认删除'); const reason = required(value(form, 'reason'), '删除原因');
      change(ctx, form, () => kind === 'rule' ? engineOf(ctx).removeRule(stateOf(ctx), id, { reason }) : engineOf(ctx).removeAlias(stateOf(ctx), id, { reason }), '配置已删除，已应用结果保留');
    }));
  }
  function queueItems(ctx, state) { const result = engineOf(ctx).reviewQueue(state, { asOf: today(ctx) }); return (Array.isArray(result) ? result : result.items).map((r, index) => ({ ...r, title: REVIEW_KINDS[r.kind] || '待核对事项', reason: r.explanation, priority: index + 1 })); }
  function renderReview(ctx, state, data) {
    const all = queueItems(ctx, state), rows = all.filter(r => ui.showDeferred || !r.deferred);
    return card('先处理影响最大的未核对项', '顺序来自可解释的固定规则；手动优先级和延后日期只改变提醒顺序，不会自动认定问题已解决。', `<div class="org-filterbar"><label class="confirm-check"><input type="checkbox" id="org-show-deferred" ${ui.showDeferred ? 'checked' : ''}>显示已延后项目（${all.filter(r => r.deferred).length}）</label></div><ol class="org-review-list">${pageRows('review', rows, r => `<li class="org-record"><span class="org-rank">${e(r.rank != null ? r.rank : r.priority)}</span><div class="org-record-content"><div class="org-record-title"><strong>${e(r.title)}</strong>${r.deferred ? tag('已延后至 ' + r.deferUntil) : ''}${r.rank != null ? tag('手动优先级 ' + r.rank) : ''}${r.dueDate ? tag('用户登记日期 ' + r.dueDate + (r.overdue ? ' · 已超过' : ''), r.overdue ? 'warning' : '') : ''}</div><p class="org-copy">${e(r.reason)}</p><p class="org-copy">${e(IMPACT_KINDS[r.impactKind] || '相关金额')}：${money(ctx, r.impactCents)}</p><p class="org-note">${e(r.sortExplanation)}</p><p class="org-meta">${e(r.kind)} · ${e(r.key)}</p><div class="org-actions">${btn('review-item', '查看依据', r.key)}${btn('set-review', '优先级 / 延后', r.key)}</div></div></li>`, '当前筛选下没有待核对项目。没有提示也不代表账单已全部导入或账户已对平。')}</ol>`);
  }
  function showReviewItem(ctx, key) {
    const state = stateOf(ctx), row = queueItems(ctx, state).find(r => r.key === key); if (!row) throw Error('这项核对提示已变化，请刷新后重试');
    const ids = row.transactionIds || (row.transactionId ? [row.transactionId] : []);
    const body = `<div class="org-form"><p class="org-copy">${e(row.reason)}</p><p class="org-note">系统优先级 ${e(row.priority)}${row.rank != null ? ' · 手动优先级 ' + e(row.rank) : ''}${row.deferUntil ? ' · 延后至 ' + e(row.deferUntil) : ''}。提示不是自动结论，请核对原始账单。</p>${ids.map(id => `<div class="org-record"><div>${txSummary(ctx, state, id)}${transactionDetails(ctx, id)}</div></div>`).join('')}${row.sourceKey ? `<p class="org-copy">来源 ${e(row.sourceKey)}${row.accountId ? ' · ' + e(ctx.accountName(row.accountId)) : ''}</p>` : ''}${row.details ? `<details class="org-detail"><summary>完整提示依据</summary><pre>${e(JSON.stringify(row.details, null, 2))}</pre></details>` : ''}<p class="org-note">交易问题可在交易明细更正；来源覆盖和待导入记录请到「账单导入」，重复证据、退款、应收和余额差异请到「账务核对」。本窗口不会把提示标记为已解决。</p></div>`;
    ctx.modal(row.title, body, '<button type="button" class="btn" data-close>关闭</button>');
  }
  function showReviewOverride(ctx, key) {
    const state = stateOf(ctx), item = queueItems(ctx, state).find(r => r.key === key); if (!item) throw Error('这项核对提示已变化，请刷新后重试');
    const body = `<p class="org-copy">${e(item.title)} · ${e(item.reason)}</p><p class="org-note">数字越小越优先。留空可恢复系统优先级；清空延后日期即可立即恢复提醒。延后不会改写交易，也不会消除未解决的问题。</p><div class="form-grid">${field('手动优先级（可选整数）', 'rank', item.rank, 'type="number" step="1" min="0" max="1000000"')}${field('延后至（可选）', 'deferUntil', item.deferUntil, 'type="date" min="0001-01-01" max="9999-12-31"')}</div>${textarea('调整原因', 'reason', '', true)}`;
    ctx.modal('调整核对顺序', formBody(ctx, body, '保存提醒安排'), '', () => bindForm(ctx, form => {
      const rankText = value(form, 'rank').trim(), rank = rankText === '' ? null : Number(rankText); if (rank !== null && (!Number.isSafeInteger(rank) || rank < 0 || rank > 1000000)) throw Error('优先级须为 0–1000000 的整数');
      const input = { key, rank, deferUntil: value(form, 'deferUntil') || null, reason: required(value(form, 'reason'), '调整原因') };
      change(ctx, form, () => engineOf(ctx).setReview(stateOf(ctx), input), '提醒顺序已保存；原始问题仍保留');
    }));
  }
  function scopeRows(ctx, state) { const result = engineOf(ctx).scopeReport(state, monthRange(ui.month)); return result.sources.map(r => ({ ...r, coverageStatus: r.included === false ? 'excluded' : r.complete ? 'complete' : r.coverageComplete ? (r.unresolvedCount ? 'blocked' : 'covered') : r.coverage.length ? 'partial' : 'unknown', latestCoveredDate: r.confirmedThrough, missingRanges: r.gaps })); }
  function monthPicker(label) { return `<label class="field">${e(label)}<input type="month" id="org-month" min="0001-01" max="9999-12" value="${e(ui.month)}"></label>`; }
  function renderScope(ctx, state) {
    const report = engineOf(ctx).scopeReport(state, monthRange(ui.month)), rows = scopeRows(ctx, state);
    return card('明确哪些来源与账户纳入你的视野', '范围确认不改写交易或银行余额。覆盖记录只代表已确认的导入区间；未覆盖、过期或未知都不能当成零消费。', `<div class="org-filterbar">${monthPicker('检查月份')}${btn('set-scope', '新增范围确认')}</div>${scopeSummary(ctx, report)}${pageRows('scope', rows, (r, index) => `<section class="org-record"><div><strong>${e(r.sourceKey)} · ${e(ctx.accountName(r.accountId))}</strong><div class="org-record-title">${tag(r.included === true ? '确认纳入' : r.included === false ? '确认排除' : '范围未知', r.included === null || r.included === undefined ? 'warning' : '')}${tag(coverageLabel(r.coverageStatus), r.coverageStatus === 'complete' || r.coverageStatus === 'covered' ? 'good' : 'warning')}</div><p class="org-copy">${e(r.reason || '尚未填写纳入 / 排除依据')}</p><p class="org-meta">最晚覆盖截止日（不表示连续）：${e(r.latestCoveredDate || '未知')}</p>${(r.missingRanges || []).length ? `<p class="org-warning org-copy">尚未确认覆盖：${r.missingRanges.map(g => `${e(g.start)} 至 ${e(g.end)}`).join('；')}</p>` : ''}${r.unresolvedCount ? `<p class="org-warning org-copy">${r.unresolvedCount} 行待处理，尚不能视为完成。</p><details class="org-detail"><summary>查看阻碍完整性的记录</summary><ul class="org-closing-list">${(r.blockers || []).map(b => `<li>${e(b.date || '日期未知')} · ${e(b.reason)} · ${e(b.id)}</li>`).join('')}</ul></details>` : ''}</div><div class="org-actions">${btn('set-scope', '确认 / 调整范围', '', ` data-org-source="${e(r.sourceKey)}" data-org-account="${e(r.accountId)}"`)}</div></section>`, '尚无已识别的来源与账户组合。可先导入账单，或明确登记需要核对的数据范围。')}`) + card('账户余额核验新鲜度', '日期来自你保存的日终余额快照，不代表银行实时余额。未核验不能当作已对平。', report.accounts.map(a => `<section class="org-record"><div><strong>${e(ctx.accountName(a.accountId))}</strong><p class="org-copy">最近快照日期：${e(a.balanceSnapshotAt || '未知')} · 当前同日重算${a.balanceReconciled === true ? '一致' : a.balanceReconciled === false ? '不一致' : '尚未核验'}</p><p class="org-meta">核验一致日期：${e(a.balanceVerifiedAt || '未知')} · 差额：${money(ctx, a.balanceDifferenceCents)}</p></div></section>`).join(''));
  }
  function coverageLabel(status) { return ({ complete: '日期覆盖齐全，已无待处理行', covered: '日期覆盖齐全', blocked: '日期覆盖已确认，仍有待处理行', partial: '部分覆盖', stale: '覆盖未更新', missing: '没有覆盖', unknown: '覆盖未知', excluded: '已排除范围' })[status] || '覆盖未知'; }
  function showScope(ctx, sourceKey, accountId) {
    const state = stateOf(ctx), rows = scopeRows(ctx, state), old = rows.find(r => r.sourceKey === sourceKey && r.accountId === accountId);
    const body = `<p class="org-copy">明确这一来源与实际资金账户是否纳入数据范围，并写下依据。来源可能是支付渠道，不能替代资金账户判断。此确认不会声称账单已经完整，也不会删除任何交易。</p><div class="form-grid">${field('来源标识（精确文字）', 'sourceKey', sourceKey, 'maxlength="100" required')}${select('实际资金账户', 'accountId', [['', '请选择账户'], ...state.accounts.map(a => [a.id, a.name])], accountId || '')}${select('范围决定（必须选择）', 'included', [['', '请选择'], ['true', '确认纳入'], ['false', '确认排除']], old?.included === true ? 'true' : old?.included === false ? 'false' : '')}</div>${textarea('纳入 / 排除原因', 'reason', '', true)}${checkbox('confirmed', '我已核实来源与实际账户，并确认上述范围决定', false, true)}`;
    ctx.modal('确认数据范围', formBody(ctx, body, '保存范围确认'), '', () => bindForm(ctx, form => {
      if (!checked(form, 'confirmed')) throw Error('请先确认来源、实际账户与范围决定');
      const inclusion = value(form, 'included'); if (!['true', 'false'].includes(inclusion)) throw Error('请选择确认纳入或确认排除');
      const input = { sourceKey: required(value(form, 'sourceKey'), '来源标识'), accountId: required(value(form, 'accountId'), '实际资金账户'), included: inclusion === 'true', reason: required(value(form, 'reason'), '范围原因'), confirmed: true };
      change(ctx, form, () => engineOf(ctx).setScope(stateOf(ctx), input), '数据范围确认已保存；覆盖完整性仍单独核对');
    }));
  }
  function previewRow(ctx, row, definitions, isSelected) {
    const applicable = row.eligible && row.changed;
    return `<div class="org-preview-row"><input type="checkbox" data-org-pick="${e(row.transactionId)}" aria-label="选择交易 ${e(row.transactionId)}" ${isSelected ? 'checked' : ''} ${applicable ? '' : 'disabled'}><div><strong class="org-tx-name">${e(row.before.note || '无备注')}</strong><span class="org-meta">${e(row.before.date)} · ${e(TYPES[row.before.type])} ${money(ctx, row.before.amountCents)} · ${e(ctx.accountName(row.before.accountId))}</span><span class="org-id">交易编号 ${e(row.transactionId)}</span><div class="org-record-title">${row.conflict ? tag(row.resolvedByPrecedence ? '冲突已按明确顺序解决' : '冲突未解决，不可应用', 'warning') : tag(applicable ? '可选择应用' : '不应用')}${row.selectedRuleId ? tag('采用：' + (definitions.find(d => d.id === row.selectedRuleId)?.name || definitions.find(d => d.id === row.selectedRuleId)?.to || row.selectedRuleId), 'good') : ''}</div><dl class="org-change"><div><dt>应用前</dt><dd>分类：${e(ctx.categoryName(row.before.categoryId) || '转账无分类')}<br>商户：${e(row.merchantBefore || '未设置')}</dd></div><div><dt>应用后</dt><dd>分类：${e(ctx.categoryName(row.after.categoryId) || '转账无分类')}<br>商户：${e(row.merchantAfter || '未设置')}</dd></div></dl><p class="org-copy">${e(row.explanation)}</p><details class="org-detail"><summary>命中依据（${row.matches.length} 条），原始备注保持不变</summary><ul class="org-match-list">${row.matches.map(m => { const d = definitions.find(d => d.id === m.id); return `<li><strong>${e(d?.name || d?.from + ' → ' + d?.to || m.id)}</strong>：${e(d?.conditions ? conditionsText(ctx, d.conditions) : `原始备注完全等于「${d?.from || m.explanation.noteEquals || ''}」${d?.caseSensitive ? '（区分大小写）' : '（不区分大小写）'}${d?.sourceKey ? '；来源：' + d.sourceKey : ''}${d?.accountId ? '；账户：' + ctx.accountName(d.accountId) : ''}`)}${m.eligible ? '' : '；目标分类与交易方向不符'}</li>`; }).join('')}</ul></details></div></div>`;
  }
  function showPreview(ctx, kind) {
    const state = stateOf(ctx), definitions = dataOf(ctx, state)[kind].filter(r => r.enabled !== false); if (!definitions.length) throw Error('没有已启用的规则可预览');
    const previewMethod = kind === 'rules' ? 'previewRules' : 'previewAliases', idsKey = kind === 'rules' ? 'ruleIds' : 'aliasIds';
    const emptyTicket = () => ({ rows: [], matchedCount: 0, actionableCount: 0, conflictCount: 0, skippedShadowCount: 0, precedence: [] });
    let ticket = emptyTicket(), selection = new Set(), offset = 0, query = '', needsRefresh = false, previewError = '';
    try { ticket = engineOf(ctx)[previewMethod](state); } catch (error) { if (error.code !== 'PREVIEW_LIMIT') throw error; needsRefresh = true; previewError = error.message; }
    const body = `<p class="org-copy">先看每笔命中和应用前后，再逐笔选择。冲突不会自动决定；如需采用先后顺序，请检查下列编号并重新预览。只更改分类或商户显示名，不改变金额和原始备注。</p><details class="org-detail" ${previewError ? 'open' : ''}><summary>选择规则并明确冲突优先级（数字越小越优先）</summary><fieldset><legend>本次使用的${kind === 'rules' ? '分类规则' : '商户别名'}</legend>${definitions.map((r, index) => `<div class="org-priority-row"><input type="checkbox" name="use-${index}" checked aria-label="本次使用${e(r.name || r.from)}"><span>${e(r.name || r.from + ' → ' + r.to)}</span><input type="number" name="order-${index}" value="${index + 1}" min="1" max="9999" step="1" aria-label="${e(r.name || r.from)}的优先级"></div>`).join('')}</fieldset><button type="button" class="btn" id="org-preview-refresh">按所选规则与优先级重新预览</button></details><p id="org-preview-status" class="org-note" role="status" aria-live="polite"></p><label class="field">搜索本次命中的交易<input id="org-preview-search" type="search" maxlength="500" placeholder="日期、备注、账户、编号或商户名称"></label><div class="org-actions"><button class="btn" type="button" id="org-preview-select-page">选择本页可应用项</button><button class="btn" type="button" id="org-preview-clear">清空全部选择</button></div><div class="org-preview-list" id="org-preview-rows"></div><div class="org-pager"><button type="button" class="btn" id="org-preview-prev">上一页</button><span id="org-preview-count" role="status"></span><button type="button" class="btn" id="org-preview-next">下一页</button></div>${textarea('本次应用原因', 'reason', '', true)}${checkbox('confirmed', '我已核对所选交易与应用结果，确认只应用勾选项', false, true)}<p class="org-note">账本在预览后有任何变化都会拒绝应用；保存失败时，请重新预览再选择。</p>`;
    ctx.modal(kind === 'rules' ? '试跑分类规则，逐笔确认' : '试跑商户别名，逐笔确认', formBody(ctx, body, '应用所选交易'), '', () => bindForm(ctx, form => {
      if (needsRefresh) throw Error('规则或优先级已改变，请先重新预览'); if (!selection.size) throw Error('请至少选择一笔可应用的交易'); if (!checked(form, 'confirmed')) throw Error('请先确认所选交易与应用结果');
      const selectedIds = [...selection], reason = required(value(form, 'reason'), '应用原因');
      change(ctx, form, () => engineOf(ctx).applyPreview(stateOf(ctx), ticket, { transactionIds: selectedIds, reason }), `已应用 ${selectedIds.length} 笔；可在整理历史中撤销本批次`);
    }, form => {
      const rowsNode = ctx.$('#org-preview-rows'), status = ctx.$('#org-preview-status'), count = ctx.$('#org-preview-count'), prev = ctx.$('#org-preview-prev'), next = ctx.$('#org-preview-next');
      function filteredRows() { const q = query.trim().toLowerCase(); return ticket.rows.filter(r => `${r.transactionId} ${r.before.date} ${r.before.note} ${ctx.accountName(r.before.accountId)} ${r.merchantBefore || ''} ${r.merchantAfter || ''}`.toLowerCase().includes(q)); }
      function draw() {
        const rows = filteredRows(); offset = Math.min(offset, Math.max(0, Math.floor((rows.length - 1) / PAGE_SIZE) * PAGE_SIZE));
        rowsNode.innerHTML = rows.slice(offset, offset + PAGE_SIZE).map(r => previewRow(ctx, r, definitions, selection.has(r.transactionId))).join('') || empty('本次没有符合条件的命中。未命中的交易保持不变。');
        status.textContent = `${previewError ? previewError + ' 请在上方取消部分规则或返回编辑匹配条件，再重新预览。' : ''}${needsRefresh ? '规则选择或优先级已变更，必须重新预览。' : ''}命中 ${ticket.matchedCount} 笔，可应用 ${ticket.actionableCount} 笔，冲突 ${ticket.conflictCount} 笔；已选 ${selection.size} 笔。已跳过 ${ticket.skippedShadowCount} 条重复附属证据。${ticket.precedence.length ? '已采用你明确提交的优先顺序。' : '尚未采用任何冲突优先顺序。'}`;
        count.textContent = rows.length ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, rows.length)} / ${rows.length}` : '0 笔'; prev.disabled = offset === 0; next.disabled = offset + PAGE_SIZE >= rows.length;
      }
      form.addEventListener('change', event => { const name = event.target?.name || ''; if (name.startsWith('use-') || name.startsWith('order-')) { needsRefresh = true; checked(form, 'confirmed') && (form.elements.namedItem('confirmed').checked = false); draw(); } });
      form.addEventListener('input', event => { if ((event.target?.name || '').startsWith('order-')) { needsRefresh = true; draw(); } });
      ctx.$('#org-preview-refresh').onclick = () => { try {
        const choices = definitions.map((d, index) => ({ id: d.id, use: checked(form, 'use-' + index), order: Number(value(form, 'order-' + index)) })).filter(d => d.use);
        if (!choices.length) throw Error('至少选择一条已启用规则'); if (choices.some(d => !Number.isSafeInteger(d.order) || d.order < 1 || d.order > 9999) || new Set(choices.map(d => d.order)).size !== choices.length) throw Error('所选规则的优先级须为不重复的 1–9999 整数');
        const precedence = choices.sort((a, b) => a.order - b.order).map(d => d.id); ticket = engineOf(ctx)[previewMethod](stateOf(ctx), { [idsKey]: precedence, precedence }); selection = new Set(); needsRefresh = false; previewError = ''; offset = 0; form.elements.namedItem('confirmed').checked = false; form.dataset.submitted = 'false'; draw();
      } catch (error) { needsRefresh = true; selection.clear(); form.elements.namedItem('confirmed').checked = false; if (error.code === 'PREVIEW_LIMIT') { ticket = emptyTicket(); previewError = error.message; } draw(); ctx.error(error.message); } };
      rowsNode.onchange = event => { const input = event.target.closest && event.target.closest('[data-org-pick]'); if (!input) return; const row = ticket.rows.find(r => r.transactionId === input.dataset.orgPick); if (!row || !row.eligible || !row.changed) return; if (input.checked) selection.add(row.transactionId); else selection.delete(row.transactionId); form.dataset.dirty = 'true'; draw(); rowsNode.querySelector?.(`[data-org-pick="${row.transactionId}"]`)?.focus(); };
      ctx.$('#org-preview-search').oninput = event => { query = event.target.value; offset = 0; draw(); };
      ctx.$('#org-preview-select-page').onclick = () => { filteredRows().slice(offset, offset + PAGE_SIZE).filter(r => r.eligible && r.changed).forEach(r => selection.add(r.transactionId)); form.dataset.dirty = 'true'; draw(); };
      ctx.$('#org-preview-clear').onclick = () => { selection.clear(); form.elements.namedItem('confirmed').checked = false; form.dataset.dirty = 'true'; draw(); };
      prev.onclick = () => { offset = Math.max(0, offset - PAGE_SIZE); draw(); }; next.onclick = () => { offset += PAGE_SIZE; draw(); }; draw();
    }));
  }
  function renderHistory(ctx, data) {
    const batches = pageRows('batches', data.batches.slice().reverse(), b => `<section class="org-record"><div><strong>${b.kind === 'rules' ? '分类规则批次' : '商户别名批次'} · ${b.changes.length} 笔</strong><p class="org-copy">${e(b.reason)}</p><p class="org-meta">${e(b.createdAt)} · ${e(b.id)}</p>${tag(b.rolledBack ? '已撤销 ' + b.rolledBackAt : '已应用', b.rolledBack ? '' : 'good')}</div><div class="org-actions">${btn('batch-details', '查看变更', b.id)}${btn('rollback', '撤销整批', b.id, b.rolledBack ? ' disabled' : '')}</div></section>`, '尚未应用整理批次。规则或别名保存后不会自动改变交易。');
    const audit = pageRows('audit', data.audit.slice().reverse(), r => `<section class="org-record"><div><strong>${e(r.action)}</strong><p class="org-copy">${e(r.reason)}</p><p class="org-meta">${e(r.at || r.createdAt)} · 本地版本 ${e(r.revision)}</p><details class="org-detail"><summary>查看操作前后记录</summary><pre>${e(JSON.stringify(r.changes, null, 2))}</pre></details></div></section>`, '还没有整理操作历史。');
    return card('可撤销的应用批次', '整批原子撤销。任何一笔后来已修改、删除、重新分组或成为重复附属证据，整个撤销都会被拒绝，避免覆盖后续工作。', batches) + card('完整整理日志', '规则、商户、范围、提醒安排与月末封存均保留操作依据。', audit);
  }
  function showBatch(ctx, id, rollback) {
    const state = stateOf(ctx), batch = dataOf(ctx, state).batches.find(b => b.id === id); if (!batch) throw Error('整理批次不存在');
    const rows = batch.changes.map(c => `<section class="org-record"><div><strong>${e(c.before.note || c.transactionId)}</strong><p class="org-meta">${e(c.before.date)} · ${money(ctx, c.before.amountCents)} · ${e(c.transactionId)}</p><dl class="org-change"><div><dt>应用前</dt><dd>${e(ctx.categoryName(c.before.categoryId) || '转账无分类')} · 商户 ${e(c.merchantBefore?.merchant || '未设置')}</dd></div><div><dt>应用后</dt><dd>${e(ctx.categoryName(c.after.categoryId) || '转账无分类')} · 商户 ${e(c.merchantAfter?.merchant || '未设置')}</dd></div></dl></div></section>`);
    const intro = `<p class="org-copy">${e(batch.reason)} · ${e(batch.createdAt)} · ${batch.changes.length} 笔</p><p class="org-note">原始备注与金额未改写。${rollback ? '此操作会恢复整个批次的应用前分类与商户显示。任何后续更改冲突都会阻止整个撤销；不会部分回退。' : '历史快照独立保存，可核对当时规则与应用前后的结果。'}</p><div id="org-batch-rows" class="org-preview-list"></div><div class="org-pager"><button class="btn" type="button" id="org-batch-prev">上一页</button><span id="org-batch-count" role="status"></span><button class="btn" type="button" id="org-batch-next">下一页</button></div>`;
    const ready = () => { let offset = 0; function draw() { ctx.$('#org-batch-rows').innerHTML = rows.slice(offset, offset + PAGE_SIZE).join(''); ctx.$('#org-batch-count').textContent = `${offset + 1}–${Math.min(offset + PAGE_SIZE, rows.length)} / ${rows.length}`; ctx.$('#org-batch-prev').disabled = offset === 0; ctx.$('#org-batch-next').disabled = offset + PAGE_SIZE >= rows.length; } ctx.$('#org-batch-prev').onclick = () => { offset = Math.max(0, offset - PAGE_SIZE); draw(); }; ctx.$('#org-batch-next').onclick = () => { offset += PAGE_SIZE; draw(); }; draw(); };
    if (!rollback) { ctx.modal('整理批次的逐笔变更', `<div class="org-form">${intro}<details class="org-detail"><summary>本批采用的规则快照</summary><pre>${e(JSON.stringify(batch.definitions, null, 2))}</pre></details></div>`, '<button type="button" class="btn" data-close>关闭</button>', ready); return; }
    if (batch.rolledBack) throw Error('这个批次已经撤销');
    ctx.modal('确认撤销整个整理批次？', formBody(ctx, intro + textarea('撤销原因', 'reason', '', true) + checkbox('confirmed', '我确认恢复整个批次的应用前结果', false, true), '确认撤销整批'), '', () => bindForm(ctx, form => {
      if (!checked(form, 'confirmed')) throw Error('请先确认撤销整批'); const reason = required(value(form, 'reason'), '撤销原因');
      change(ctx, form, () => engineOf(ctx).rollbackBatch(stateOf(ctx), id, { reason }), '整个整理批次已安全撤销，原始记录仍保留');
    }, ready));
  }
  function scopeSummaryFor(ctx, start, end) {
    try {
      const report = engineOf(ctx).scopeReport(stateOf(ctx), { start, end });
      const relevant = report.sources.filter(s => s.included !== false), cutoffs = relevant.slice(0, 3).map(s => `${s.sourceKey} / ${ctx.accountName(s.accountId)}：${s.confirmedThrough || '未知'}`);
      const unknownBalances = report.accounts.filter(a => !a.balanceVerifiedAt).length;
      return `<aside class="org-scope-inline" aria-label="来源范围与新鲜度"><p><strong>当前区间的数据覆盖</strong> ${e(start)} 至 ${e(end)} · ${report.coverageComplete ? '已声明范围的日期覆盖已确认' : '日期覆盖仍有缺口或未知'}</p><p>覆盖记录最晚截止（不表示连续）：${e(cutoffs.join('；') || '未知')}${relevant.length > 3 ? `；另 ${relevant.length - 3} 个来源 / 账户组合` : ''}</p><p>${report.unknownAccounts.length} 个账户尚未声明来源范围 · 已知 ${report.unresolvedCount || 0} 行待处理 · ${unknownBalances} 个账户尚无当前重算一致的日终余额核验。</p><p class="org-note">范围确认只作披露，不会自动筛除统计中的交易；不能据此证明全部经济活动齐全，未知数据不算零。沙盘中手动选择的完整月份不会因此自动通过审计。<button type="button" class="org-inline-link" data-page="organizer">查看范围与核对</button></p></aside>`;
    } catch (error) { return `<aside class="org-scope-inline" role="status">来源范围暂时无法核验：${e(error.message)}。请勿按完整数据解释结果。<button type="button" class="org-inline-link" data-page="organizer">查看范围与核对</button></aside>`; }
  }
  function scopeSummary(ctx, report) {
    return `<p class="org-copy">${tag(report.complete ? '已声明范围内覆盖齐全' : '覆盖尚不完整或未知', report.complete ? 'good' : 'warning')} ${e(report.start)} 至 ${e(report.end)}</p>${report.unresolvedCount ? `<p class="org-warning org-copy">${report.unresolvedCount} 行尚待处理。覆盖区间已经确认，也不代表这些记录已成功记账。</p>` : ''}${report.unknownAccounts.length ? `<p class="org-warning org-copy">尚未声明来源范围的账户：${report.unknownAccounts.map(id => e(ctx.accountName(id))).join('、')}。未知不代表无交易。</p>` : ''}<ul class="org-closing-list">${report.assumptions.map(a => `<li>${e(a)}</li>`).join('')}</ul>`;
  }
  function closeMetrics(ctx, totals, prefix) {
    const rows = [[cashLabel(ctx, '对外现金流入'), totals.cash.incomeCents], [cashLabel(ctx, '对外现金流出'), totals.cash.expenseCents], [cashLabel(ctx, '对外现金结余'), totals.cash.netCents], ['个人消费', totals.personal.expenseCents], ['普通收入', totals.personal.incomeCents], ['个人收支差额', totals.personal.netCents]];
    return `<dl class="org-metrics" aria-label="${e(prefix)}">${rows.map(([label, cents]) => `<div><dt>${e(prefix)} · ${e(label)}</dt><dd>${money(ctx, cents)}</dd></div>`).join('')}</dl>`;
  }
  function renderCloses(ctx, state, data) {
    const report = engineOf(ctx).scopeReport(state, monthRange(ui.month));
    return roleNotice(ctx) + card('把当时看到的月份单独封存', '封存保存所选月份的有效主记录、商户名称、来源、分类与计算口径。以后补账仍可继续，并能逐笔比较变化；旧版本不覆盖。', `<div class="org-filterbar">${monthPicker('准备封存的月份')}${btn('close-month', '检查并封存本月')}</div>${scopeSummary(ctx, report)}`) + card('已封存的月份', '当时快照与当前重算结果分开显示。金额相同也可能存在分类、备注、范围或来源变化。', pageRows('closes', data.closes.slice().reverse(), c => `<section class="org-record"><div><strong>${e(c.month)} · ${c.actualRows?.length ?? c.rows.length} 笔实际流水${c.personalRows ? ` · ${c.personalRows.length} 条个人事件` : ''} · ${c.selection === 'selected' ? '所选记录' : '全月有效主记录'}</strong><p class="org-copy">${e(c.reason)}</p><p class="org-meta">封存于 ${e(c.createdAt)} · ${e(c.id)}</p><p class="org-copy">封存个人消费 ${money(ctx, c.totals.personal.expenseCents)} · ${e(cashLabel(ctx, '封存对外现金结余'))} ${money(ctx, c.totals.cash.netCents)}</p>${tag(c.scope.complete ? '当时已声明范围覆盖齐全' : '当时覆盖不完整或未知', c.scope.complete ? 'good' : 'warning')}</div><div class="org-actions">${btn('compare-close', '查看封存与当前差异', c.id)}</div></section>`, '还没有封存月份。封存只是留住当时的证据与口径，不代表全部数据已核实。'));
  }
  function showCloseMonth(ctx) {
    const state = stateOf(ctx), report = engineOf(ctx).scopeReport(state, monthRange(ui.month)), items = queueItems(ctx, state), month = ui.month, basis = JSON.stringify(state);
    const body = `${roleNotice(ctx)}<p class="org-copy">将封存 ${e(month)} 全月有效主记录及个人收支事件，包含本月非现金使用与损失；本金来源跨月时保留证明，实际资金仍按原日期。已明确关联的重复附属证据不再次计金额；来源和账户范围排除仅作披露，不会偷偷删除原交易。以后补记、退款或分类调整不会覆盖这份封存。</p>${scopeSummary(ctx, report)}<p class="org-warning org-copy">全账本当前有 ${items.length} 项未解决核对提示（包括 ${items.filter(r => r.deferred).length} 项延后）。这些提示会继续存在，封存不等于对账完成。</p>${textarea('封存备注与依据', 'reason', '', true)}${checkbox('transactionsChecked', '我已核对该月流水及个人事件，理解这里只保存当时已记录的全月范围', false, true)}${checkbox('coverageChecked', '我已查看来源覆盖与未知范围，并接受按当前不完整程度留存快照', false, true)}${checkbox('confirmed', '我理解封存不可覆盖，但可以继续补账并保存新版本比较', false, true)}`;
    ctx.modal('确认月末封存：' + month, formBody(ctx, body, '保存不可覆盖的月份快照'), '', () => bindForm(ctx, form => {
      if (!checked(form, 'transactionsChecked') || !checked(form, 'coverageChecked') || !checked(form, 'confirmed')) throw Error('请先完成三项封存确认');
      if (JSON.stringify(stateOf(ctx)) !== basis) throw Error('账本在封存检查后已变化，请关闭后重新检查');
      const reason = required(value(form, 'reason'), '封存备注与依据');
      change(ctx, form, () => engineOf(ctx).closeMonth(stateOf(ctx), { month, reason }), month + ' 已封存；后续补账可与这份快照比较');
    }));
  }
  function compositeProofs(ctx, proofs, label) {
    if (!proofs?.length) return '';
    return `<details class="org-detail"><summary>${e(label)}购买组合完整证明（${proofs.length} 组）</summary><p class="org-note">以下来自该版本捕获的完整签名。跨月成员仍保留原日期与账户编号；后续撤销组合或编辑原交易不会改写封存。</p>${proofs.map(p => `<section class="org-record"><strong>${e(p.name)} · ${money(ctx, p.paidCents)} 确认实付</strong><p>优惠前总额 ${money(ctx, p.grossCents)} · 优惠 ${money(ctx, p.discountCents)}（未知不算零，优惠不记收入）</p>${[['personalIds','个人消费证据'],['fundingIds','实际资金证据']].map(([key,title]) => `<h4>${title}</h4><ul>${p[key].map(id => { const t = p.signatures.find(r => r.id === id); return `<li>${e(id)} · 原日期 ${e(t.date)} · 原账户 ${e(t.accountId)} · 原金额 ${money(ctx, t.amountCents)}</li>`; }).join('')}</ul>`).join('')}<pre>${e(JSON.stringify(p, null, 2))}</pre></section>`).join('')}</details>`;
  }
  function capturedSummary(ctx, row, categories) {
    if (!row) return '<p class="org-copy">此版本没有这笔有效主记录。</p>';
    const t = row.transaction, category = categories.find(c => c.id === t.categoryId)?.name;
    return `<strong>${e(t.note || '无备注')}</strong><p class="org-meta">${e(t.date)} · ${e(TYPES[t.type])} ${money(ctx, t.amountCents)} · ${e(category || '转账无分类')}</p><p class="org-copy">商户：${e(row.merchant || '未设置')}<br>个人消费 ${money(ctx, row.impact.personalExpenseCents)} · 普通收入 ${money(ctx, row.impact.ordinaryIncomeCents)}</p>${row.compositeId ? `<p class="org-copy">组合编号 ${e(row.compositeId)}；原记录按封存的消费 / 资金角色计金额。完整角色与跨月成员见下方组合证明。</p>` : ''}${row.transferPair ? `<p class="org-copy">已封存本人转账配对 ${e(row.transferPair.id)}：转出原记录 ${e(row.transferPair.expenseId)}（${e(row.transferPair.expenseSignature.date)}），转入原记录 ${e(row.transferPair.incomeId)}（${e(row.transferPair.incomeSignature.date)}）。两个原账户与日期完整保留，配对记录不计对外现金与个人收支。</p>` : ''}<p class="org-meta">来源：${row.sources.length ? row.sources.map(s => e(s.sourceKey) + ' / ' + e(s.evidenceId)).join('；') : '手工记录 / 无导入证据'}</p>`;
  }
  function personalCaptureSummary(ctx, row, link = false) {
    if (!row) return '<p class="org-copy">此版本没有这条个人收支事件。</p>';
    const event = row.event, held = event.route.kind === 'held-recognition', title = held ? event.recognitionKind === 'loss' ? '已确认非现金损失' : '已确认非现金使用' : event.key.kind === 'transaction-income' ? '原流水普通收入' : '原流水个人消费余量';
    return `<strong>${e(title)} · ${money(ctx, event.amountCents)}</strong><p class="org-meta">${e(event.effectiveDate)} · ${e(row.categoryName)} · ${e(row.merchant || (held ? '未填写商户' : '未设置商户'))}</p><p class="org-copy">${held ? '本事件实际资金变动为零；资金来源账户仅用于追溯。' : '此个人金额来自原始流水的分类后余量。'}</p>${held ? `<p class="org-meta">本金记录 ${e(event.route.positionId)} · 事件 ${e(event.route.recognitionId)} · 原始支出 ${e(event.attribution.expenseId)} · 资金来源账户 ${e(event.attribution.fundingAccountId)}</p><p class="org-copy">确认原因：${e(row.reason)}</p>${link && ctx.showHeldRecognition ? btn('held-recognition', '查看使用或损失依据', event.route.recognitionId, ` data-org-position="${e(event.route.positionId)}"`) : ''}` : `<p class="org-meta">原始流水 ${e(event.route.transactionId)}</p>`}`;
  }
  function rightsSummary(ctx, close, label) {
    if (!close.rights) return '';
    return `<section class="org-record"><div><strong>${e(label)} · 捕获图中的全部已记录本金</strong><p class="org-copy">月初记录余量 ${money(ctx, close.rights.openingCents)} · 月末记录余量 ${money(ctx, close.rights.closingCents)} · ${close.rights.positions.length} 笔本金记录（包括余额为零和本月无活动记录）</p><p class="org-note">这是记录成本余量，不是现金、可用余额或保证可退金额；与本次选择的收支事件范围独立。</p></div></section>`;
  }
  function showPersonalComparison(ctx, result) {
    const old = result.frozen, now = result.current, heldRows = old.personalRows || [], actualCount = old.actualRows?.length ?? old.rows?.length ?? 0;
    const body = `<div class="org-form">${roleNotice(ctx)}<p class="org-copy">${e(result.month)} · ${old.selection === 'selected' ? '部分选择，不能解释为完整月份' : '全月捕获的有效流水与个人事件'} · ${result.changed ? '当前与封存存在差异' : '当前与封存一致'}。差额均为当前减去封存；分类变化不会移动实际资金。</p>${closeMetrics(ctx, old.totals, '封存')}${closeMetrics(ctx, now.totals, '当前')}${closeMetrics(ctx, result.delta, '差额')}<p class="org-copy">封存实际流水 ${actualCount} 笔 · 个人事件 ${heldRows.length || (old.rows || []).filter(r => r.transaction.type !== 'transfer').length} 条。逐条变化 ${result.drivers.length} 条；证明 / 输入${result.proofChanged ? '变化' : '未变'}，记录本金${result.rightsChanged ? '变化' : '未变'}，范围${result.scopeChanged ? '变化' : '未变'}，分类${result.categoriesChanged ? '变化' : '未变'}。</p>${rightsSummary(ctx, old, '封存')}${rightsSummary(ctx, now, '当前')}<div id="org-compare-rows" class="org-preview-list"></div><div class="org-pager"><button class="btn" type="button" id="org-compare-prev">上一页</button><span id="org-compare-count" role="status"></span><button class="btn" type="button" id="org-compare-next">下一页</button></div><details class="org-detail"><summary>封存个人事件（${heldRows.length} 条）</summary><div id="org-captured-personal-rows"></div><div class="org-pager"><button class="btn" type="button" id="org-captured-personal-prev">上一页</button><span id="org-captured-personal-count" role="status"></span><button class="btn" type="button" id="org-captured-personal-next">下一页</button></div></details><details class="org-detail"><summary>封存的全部原始及本金证明</summary><p class="org-note">跨月来源是证明，不计入所选月资金总额。完整证明只能验证本地内部一致，不能验证外部真实性或发现整体一致重写。</p><pre>${e(JSON.stringify(old.format ? { rawProofs: old.rawProofs, heldProof: old.heldProof, manifest: old.manifest, rights: old.rights } : old.rows, null, 2))}</pre></details>${compositeProofs(ctx, old.compositeProofs, '封存的')}${compositeProofs(ctx, now.compositeProofs, '当前的')}<details class="org-detail"><summary>封存范围</summary>${scopeSummary(ctx, old.scope)}</details><details class="org-detail"><summary>当前范围</summary>${scopeSummary(ctx, now.scope)}</details></div>`;
    ctx.modal('月份封存与当前比较', body, '<button class="btn" type="button" data-close>关闭</button>', () => {
      let personalOffset = 0; function drawPersonal() { if (ctx.isActive?.() === false) return; ctx.$('#org-captured-personal-rows').innerHTML = heldRows.slice(personalOffset, personalOffset + PAGE_SIZE).map(row => personalCaptureSummary(ctx, row, true)).join('') || '<p>此版本没有所选个人事件；旧版封存仍保留原始逐笔格式。</p>'; ctx.$('#org-captured-personal-count').textContent = heldRows.length ? `${personalOffset + 1}–${Math.min(personalOffset + PAGE_SIZE, heldRows.length)} / ${heldRows.length}` : '0 条'; ctx.$('#org-captured-personal-prev').disabled = personalOffset === 0; ctx.$('#org-captured-personal-next').disabled = personalOffset + PAGE_SIZE >= heldRows.length; } ctx.$('#org-captured-personal-prev').onclick = () => { personalOffset = Math.max(0, personalOffset - PAGE_SIZE); drawPersonal(); }; ctx.$('#org-captured-personal-next').onclick = () => { personalOffset += PAGE_SIZE; drawPersonal(); }; drawPersonal();
      let offset = 0; function draw() { if (ctx.isActive?.() === false) return; ctx.$('#org-compare-rows').innerHTML = result.drivers.slice(offset, offset + PAGE_SIZE).map(r => `<section class="org-record"><div><strong>${r.stream === 'actual' ? '实际流水' : '个人收支事件'} · ${e(r.key.kind)} · ${e(r.key.id)}</strong><dl class="org-change"><div><dt>封存时</dt><dd>${r.stream === 'actual' ? capturedSummary(ctx, r.before, old.categories) : personalCaptureSummary(ctx, r.before, true)}</dd></div><div><dt>当前</dt><dd>${r.stream === 'actual' ? capturedSummary(ctx, r.after, now.categories) : personalCaptureSummary(ctx, r.after, true)}</dd></div></dl><p class="org-copy">实际资金结余差额 ${money(ctx, r.cashNetDeltaCents)} · 个人收支差额 ${money(ctx, r.personalNetDeltaCents)}</p></div></section>`).join('') || empty('所选月份没有逐条金额或显示差异；完整证明和范围变化另行列出。'); ctx.$('#org-compare-count').textContent = result.drivers.length ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, result.drivers.length)} / ${result.drivers.length}` : '0 条'; ctx.$('#org-compare-prev').disabled = offset === 0; ctx.$('#org-compare-next').disabled = offset + PAGE_SIZE >= result.drivers.length; } ctx.$('#org-compare-prev').onclick = () => { offset = Math.max(0, offset - PAGE_SIZE); draw(); }; ctx.$('#org-compare-next').onclick = () => { offset += PAGE_SIZE; draw(); }; draw();
    });
  }
  function showPersonalMerchantGroup(ctx, group, state) {
    const items = group.transactionIds.map(id => ({ kind: 'raw', id })).concat(group.personalEvents.filter(r => r.event.amountCents > 0).map(row => ({ kind: 'personal', row })));
    ctx.modal('商户分组：' + (group.merchant || '无备注'), `<div class="org-form"><p class="org-copy">实际原流水 ${group.transactionIds.length} 笔（支出 ${group.rawPaymentCount} 笔、收入 ${group.rawReceiptCount} 笔），正额个人事件 ${group.positivePersonalEventCount} 条，其中使用 / 损失 ${group.recognitionCount} 条。</p><p class="org-copy">个人金额 ${money(ctx, group.personalCents)} · 非现金使用 ${money(ctx, group.useCents)} · 非现金损失 ${money(ctx, group.lossCents)}</p><p class="org-note">原流水与个人事件分开列示；同一笔原流水的分类后余量可出现在个人事件中，不应把两个列表的金额相加。</p><div id="org-merchant-rows"></div><div class="org-pager"><button class="btn" type="button" id="org-merchant-prev">上一页</button><span id="org-merchant-count" role="status"></span><button class="btn" type="button" id="org-merchant-next">下一页</button></div></div>`, '<button class="btn" type="button" data-close>关闭</button>', () => {
      let offset = 0; function draw() { if (ctx.isActive?.() === false) return; ctx.$('#org-merchant-rows').innerHTML = items.slice(offset, offset + PAGE_SIZE).map(item => `<section class="org-record"><div>${item.kind === 'raw' ? '<strong>原始流水</strong>' + txSummary(ctx, state, item.id) + transactionDetails(ctx, item.id) : personalCaptureSummary(ctx, item.row, true)}</div></section>`).join('') || empty('没有正额个人事件或原始流水。'); ctx.$('#org-merchant-count').textContent = items.length ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, items.length)} / ${items.length}` : '0 条'; ctx.$('#org-merchant-prev').disabled = offset === 0; ctx.$('#org-merchant-next').disabled = offset + PAGE_SIZE >= items.length; } ctx.$('#org-merchant-prev').onclick = () => { offset = Math.max(0, offset - PAGE_SIZE); draw(); }; ctx.$('#org-merchant-next').onclick = () => { offset += PAGE_SIZE; draw(); }; draw();
    });
  }
  function showComparison(ctx, id) {
    const result = engineOf(ctx).compareMonth(stateOf(ctx), id), old = result.frozen;
    if (result.current.format === 'personal-events-v1') return showPersonalComparison(ctx, result);
    const body = `<div class="org-form">${roleNotice(ctx)}<p class="org-copy">${e(result.month)} · 封存于 ${e(old.createdAt)}。${result.changed ? '当前与封存存在差异。' : '当前交易、分类与范围结果和封存一致。'}${result.inputsChanged && !result.changed ? '导入或账务操作版本已变化，但本次结果相同。' : ''}</p><p class="org-note">封存依据：${e(old.reason)}。这里的差额均为「当前 − 封存」，不代表新的银行资金变动。</p>${closeMetrics(ctx, old.totals, '封存')}${closeMetrics(ctx, result.current.totals, '当前')}${closeMetrics(ctx, result.delta, '差额')}<p class="org-copy">交易变化 ${result.drivers.length} 笔 · 范围 / 覆盖${result.scopeChanged ? '有变化' : '未变化'} · 分类资料${result.categoriesChanged ? '有变化' : '未变化'}</p><div id="org-compare-rows" class="org-preview-list"></div><div class="org-pager"><button class="btn" type="button" id="org-compare-prev">上一页</button><span id="org-compare-count" role="status"></span><button class="btn" type="button" id="org-compare-next">下一页</button></div><details class="org-detail"><summary>封存时的来源范围与覆盖</summary>${scopeSummary(ctx, old.scope)}<pre>${e(JSON.stringify(old.scope, null, 2))}</pre></details><details class="org-detail"><summary>当前来源范围与覆盖</summary>${scopeSummary(ctx, result.current.scope)}<pre>${e(JSON.stringify(result.current.scope, null, 2))}</pre></details>${compositeProofs(ctx, old.compositeProofs, '封存的')}${compositeProofs(ctx, result.current.compositeProofs, '当前的')}<details class="org-detail"><summary>封存的完整逐笔证据（${old.rows.length} 笔）</summary><pre>${e(JSON.stringify(old.rows, null, 2))}</pre></details></div>`;
    ctx.modal('月份封存与当前比较', body, '<button class="btn" type="button" data-close>关闭</button>', () => {
      let offset = 0; function draw() {
        ctx.$('#org-compare-rows').innerHTML = result.drivers.slice(offset, offset + PAGE_SIZE).map(r => `<section class="org-record"><div><strong>${e(({ added: '新增记录', 'removed-or-excluded': '删除、移出该月或成为重复证据', changed: '记录 / 关联依据变化' })[r.kind] || r.kind)} · ${e(r.transactionId)}</strong><dl class="org-change"><div><dt>封存时</dt><dd>${capturedSummary(ctx, r.before, old.categories)}</dd></div><div><dt>当前</dt><dd>${capturedSummary(ctx, r.after, result.current.categories)}</dd></div></dl><p class="org-copy">${e(cashLabel(ctx, '对外现金结余差额'))} ${money(ctx, r.cashNetDeltaCents)} · 个人收支差额 ${money(ctx, r.personalNetDeltaCents)}</p></div></section>`).join('') || empty('没有逐笔差异。范围或分类资料变化可在下方查看。');
        ctx.$('#org-compare-count').textContent = result.drivers.length ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, result.drivers.length)} / ${result.drivers.length}` : '0 笔'; ctx.$('#org-compare-prev').disabled = offset === 0; ctx.$('#org-compare-next').disabled = offset + PAGE_SIZE >= result.drivers.length;
      } ctx.$('#org-compare-prev').onclick = () => { offset = Math.max(0, offset - PAGE_SIZE); draw(); }; ctx.$('#org-compare-next').onclick = () => { offset += PAGE_SIZE; draw(); }; draw();
    });
  }
  function transactionDetails(ctx, id) {
    const raw = engineOf(ctx).rawView(stateOf(ctx), id);
    return `<details class="org-detail"><summary>原始备注与商户整理依据</summary><dl class="org-keyvalue"><dt>原始备注</dt><dd>${e(raw.transaction.note || '无备注')}</dd><dt>商户显示名称</dt><dd>${e(raw.merchant || '未设置，沿用原始备注显示')}</dd><dt>整理批次</dt><dd>${e(raw.groupingSource || '无')}</dd></dl>${raw.evidence.length ? `<details class="org-detail"><summary>原始导入证据（${raw.evidence.length} 条）</summary><pre>${e(JSON.stringify(raw.evidence, null, 2))}</pre></details>` : '<p class="org-note">没有导入证据。当前原始备注与交易仍完整保留。</p>'}</details>`;
  }
  function renderMerchantGroups(ctx, state) {
    const groups = engineOf(ctx).merchantView(state, ui.month);
    return roleNotice(ctx) + card('商户分组与原始流水', '统一显示名便于阅读；点击分组可回看每一笔原始备注和来源。原流水金额保留各条原记录金额；对外现金排除已确认的本人转移，转移本金只按转出日计一次。支出、收入、转账分别展示，不混成一个消费总数。', `<div class="org-filterbar">${monthPicker('商户统计月份')}</div>${pageRows('merchants', groups, r => `<section class="org-record"><div><strong>${e(r.merchant || '无备注')} · ${e(TYPES[r.type])}</strong><p class="org-copy">${r.transactionIds.length} 笔原流水${r.personalEventKeys ? ` · ${r.positivePersonalEventCount} 条正额个人事件（${r.recognitionCount} 条非现金使用 / 损失）` : ''} · 原流水金额 ${money(ctx, r.rawCents ?? r.cashCents)} · ${e(cashLabel(ctx, '对外现金'))} ${money(ctx, r.externalCashCents ?? (r.type === 'transfer' ? 0 : r.cashCents))} · 转移本金（仅转出日）${money(ctx, r.transferCents ?? (r.type === 'transfer' ? r.cashCents : 0))}${r.type === 'expense' ? ' · 个人消费 ' + money(ctx, r.personalCents) : r.type === 'income' ? ' · 普通收入 ' + money(ctx, r.personalCents) : ' · 转账不算消费'}</p></div><div class="org-actions">${btn('merchant-group', r.personalEventKeys ? '查看流水与个人事件' : '查看原始记录', '', ` data-org-merchant="${e(r.merchant)}" data-org-type="${e(r.type)}"`)}</div></section>`, '所选月份没有有效原流水或个人事件。')}`);
  }
  function showMerchantGroup(ctx, merchant, type) {
    const state = stateOf(ctx), group = engineOf(ctx).merchantView(state, ui.month).find(g => g.merchant === merchant && g.type === type); if (!group) throw Error('商户分组已变化，请刷新后重试');
    if (group.personalEvents) return showPersonalMerchantGroup(ctx, group, state);
    ctx.modal('商户分组：' + (merchant || '无备注'), '<div class="org-form"><p class="org-note">逐笔保留原始备注；统一商户名称只是独立显示层。</p><div id="org-merchant-rows"></div><div class="org-pager"><button class="btn" type="button" id="org-merchant-prev">上一页</button><span id="org-merchant-count" role="status"></span><button class="btn" type="button" id="org-merchant-next">下一页</button></div></div>', '<button class="btn" type="button" data-close>关闭</button>', () => {
      let offset = 0; function draw() { ctx.$('#org-merchant-rows').innerHTML = group.transactionIds.slice(offset, offset + PAGE_SIZE).map(id => `<section class="org-record"><div>${txSummary(ctx, state, id)}${transactionDetails(ctx, id)}</div></section>`).join(''); ctx.$('#org-merchant-count').textContent = `${offset + 1}–${Math.min(offset + PAGE_SIZE, group.transactionIds.length)} / ${group.transactionIds.length}`; ctx.$('#org-merchant-prev').disabled = offset === 0; ctx.$('#org-merchant-next').disabled = offset + PAGE_SIZE >= group.transactionIds.length; } ctx.$('#org-merchant-prev').onclick = () => { offset = Math.max(0, offset - PAGE_SIZE); draw(); }; ctx.$('#org-merchant-next').onclick = () => { offset += PAGE_SIZE; draw(); }; draw();
    });
  }
  function canReplaceModal(ctx) { const form = ctx.$('#entry-form'); if (!form || form.dataset.dirty !== 'true') return true; if (typeof root.confirm !== 'function' || !root.confirm('放弃未保存的修改，打开账本整理操作？')) return false; form.dataset.dirty = 'false'; return true; }
  function dispatch(ctx, target) {
    if (ctx.isActive?.() === false) return;
    const action = target.dataset.orgAction, id = target.dataset.orgId;
    if (action === 'tab') { if (!TABS.some(t => t[0] === id)) return; if (!canReplaceModal(ctx)) return; if (ctx.$('#entry-form')) ctx.closeModal(true); ui.tab = id; ctx.render(); ctx.$('#org-workspace')?.focus(); return; }
    if (action === 'page') { const delta = Number(target.dataset.orgDelta); if (![1, -1].includes(delta)) return; ui.offsets[id] = Math.max(0, (ui.offsets[id] || 0) + delta * PAGE_SIZE); ctx.render(); ctx.$('#org-workspace')?.focus(); return; }
    if (!canReplaceModal(ctx)) return;
    if (action === 'edit-rule') showRule(ctx, id);
    else if (action === 'edit-alias') showAlias(ctx, id);
    else if (action === 'remove-rule') showRemove(ctx, 'rule', id);
    else if (action === 'remove-alias') showRemove(ctx, 'alias', id);
    else if (action === 'preview-rules') showPreview(ctx, 'rules');
    else if (action === 'preview-aliases') showPreview(ctx, 'aliases');
    else if (action === 'set-scope') showScope(ctx, target.dataset.orgSource, target.dataset.orgAccount);
    else if (action === 'review-item') showReviewItem(ctx, id);
    else if (action === 'set-review') showReviewOverride(ctx, id);
    else if (action === 'rollback') showBatch(ctx, id, true);
    else if (action === 'batch-details') showBatch(ctx, id, false);
    else if (action === 'close-month') showCloseMonth(ctx);
    else if (action === 'compare-close') showComparison(ctx, id);
    else if (action === 'held-recognition') { if (ctx.showHeldRecognition) ctx.showHeldRecognition(target.dataset.orgPosition, id); else throw Error('请在押金与预付中查看这条使用或损失依据'); }
    else if (action === 'merchant-group') showMerchantGroup(ctx, target.dataset.orgMerchant, target.dataset.orgType);
  }
  function initialize(ctx) {
    if (ctx.isActive?.() === false) return;
    context = ctx; const document = root.document; if (!document || boundDocument === document) return; boundDocument = document; ctx.onDispose?.(() => { context = null; ui.month = ''; ui.offsets = Object.create(null); });
    document.addEventListener('click', event => { const target = event.target.closest && event.target.closest('[data-org-action]'); if (!target || target.disabled || !context || context.isActive?.() === false) return; try { dispatch(context, target); } catch (error) { context.error(error.message); } });
  }
  function bind(ctx) {
    if (ctx.isActive?.() === false) return;
    initialize(ctx);
    const month = ctx.$('#org-month'); if (month) month.onchange = () => { if (ctx.isActive?.() === false) return; if (/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/.test(month.value)) { ui.month = month.value; ctx.render(); ctx.$('#org-month')?.focus(); } };
    const deferred = ctx.$('#org-show-deferred'); if (deferred) deferred.onchange = () => { if (ctx.isActive?.() === false) return; ui.showDeferred = deferred.checked; ui.offsets.review = 0; ctx.render(); ctx.$('#org-show-deferred')?.focus(); };
  }
  return Object.freeze({ render, bind, initialize, transactionDetails, scopeSummaryFor, PAGE_SIZE });
}));
