/* Local credit-obligation workspace. Host owns persistence and dialog lifecycle. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoneygoObligationsUI = api;
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const PAGE_SIZE = 25;
  const ROLES = { cash: '现金资金', credit: '信用负债', restricted: '受限资金', other: '其他' };
  const KINDS = { profile: '账户角色', statement: '账单', contract: '分期合约', repayment: '实际还款分配', inclusion: '分期入账关联', fee: '费用索引' };
  const COLLECTIONS = { profile: 'profiles', statement: 'statements', contract: 'contracts', repayment: 'repayments', inclusion: 'inclusions', fee: 'fees' };
  const TABS = [['overview', '到期与未知'], ['accounts', '账户角色'], ['statements', '信用账单'], ['contracts', '完整分期'], ['repayments', '实际还款'], ['fees', '已记费用'], ['audit', '变更历史']];
  const COVERAGE = { unknown: '未知', unallocated: '尚未分配', partial: '部分本地覆盖', 'locally-covered': '本地记录已覆盖' };
  const FEE_KINDS = { interest: '利息', handling: '手续费', service: '服务费' };
  const ui = { tab: 'overview', offsets: Object.create(null), horizon: 'all' };
  let context = null, boundDocument = null;
  const e = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const engine = ctx => ctx.engine || root.MoneygoObligations;
  const relations = ctx => ctx.relations || root.MoneygoRelations;
  const dataOf = (ctx, state) => state.obligations || engine(ctx).defaultState();
  const now = ctx => typeof ctx.today === 'function' ? ctx.today() : ctx.today;
  const m = (ctx, cents) => cents == null ? '未知' : e(ctx.money(cents));
  const inputAmount = (ctx, cents) => cents == null ? '' : ctx.amountText(cents);
  const dateText = value => e(value || '未知');
  const selected = (a, b) => a === b ? ' selected' : '';
  const cancel = ctx => ctx.cancel || '<button class="btn" type="button" data-close>取消</button>';
  const btn = (action, title, id, extra = '') => `<button type="button" class="btn" data-ob-action="${e(action)}"${id == null ? '' : ` data-ob-id="${e(id)}"`}${extra}>${e(title)}</button>`;
  const empty = message => `<p class="empty compact">${e(message)}</p>`;
  const actions = content => `<div class="ob-actions">${content}</div>`;
  const badge = (label, warning = false) => `<span class="ob-badge${warning ? ' warning' : ''}">${e(label)}</span>`;
  const copy = value => JSON.parse(JSON.stringify(value));
  const source = value => `<p class="ob-source">依据：${e(value || '尚未提供，不能视为已核实')}</p>`;
  const row = (body, controls = '') => `<article class="ob-row">${body}${controls ? actions(controls) : ''}</article>`;
  const card = (title, hint, body, controls = '') => `<section class="card ob-card"><div class="card-head"><div><h2>${e(title)}</h2><p>${e(hint)}</p></div>${controls ? actions(controls) : ''}</div>${body}</section>`;
  const removeButton = (kind, id) => btn('remove', '移除' + (KINDS[kind] || '记录'), id, ` data-ob-kind="${e(kind)}" aria-label="移除${e(KINDS[kind] || '记录')} ${e(id)}"`);
  const getRecord = (ctx, kind, id, state = ctx.getState()) => {
    const found = dataOf(ctx, state)[COLLECTIONS[kind]]?.find(r => r.id === id);
    if (!found) throw Error('记录已不存在，请重新打开。');
    return found;
  };
  function paged(key, rows, draw, message) {
    const last = Math.max(0, Math.floor((rows.length - 1) / PAGE_SIZE) * PAGE_SIZE), offset = Math.min(ui.offsets[key] || 0, last);
    ui.offsets[key] = offset;
    return (rows.length ? rows.slice(offset, offset + PAGE_SIZE).map(draw).join('') : empty(message)) + `<div class="ob-pager" aria-label="分页">${rows.length > PAGE_SIZE ? btn('page', '上一页', key, ` data-ob-delta="-1"${offset === 0 ? ' disabled' : ''}`) : ''}<span role="status">${rows.length ? `${offset + 1}–${Math.min(offset + PAGE_SIZE, rows.length)} / ${rows.length}` : '0 条'}</span>${rows.length > PAGE_SIZE ? btn('page', '下一页', key, ` data-ob-delta="1"${offset + PAGE_SIZE >= rows.length ? ' disabled' : ''}`) : ''}</div>`;
  }
  function transactionEvidence(ctx, state, id) {
    const tx = state.transactions.find(t => t.id === id);
    if (!tx) return `<p>交易 ${e(id)} 的当前原始记录不存在；请查看保存时证据。</p>`;
    const evidence = state.imports?.evidence?.filter(v => v.transactionId === id) || [];
    return `<div class="ob-evidence"><strong>${e(tx.note || '原始交易')} · ${m(ctx, tx.amountCents)}</strong><p>${e(tx.date)} · ${e(ctx.accountName(tx.accountId))}${tx.toAccountId ? ` → ${e(ctx.accountName(tx.toAccountId))}` : ''} · ${e(tx.type)} · 编号 ${e(tx.id)}</p>${evidence.length ? evidence.map(v => source(`${v.sourceKey} · ${v.mapped?.channel || '渠道未知'} · ${v.status}`)).join('') : '<p>手工记录或没有导入来源索引，不能据此证明来源完整。</p>'}</div>`;
  }
  function inspectObject(value) { return `<pre class="ob-json">${e(JSON.stringify(value, null, 2))}</pre>`; }
  function render(ctx) {
    if (!engine(ctx)) return '<div class="notice warning" role="alert">信用义务模块未加载，无法读取或保存。</div>';
    try {
      const state = ctx.getState(), data = dataOf(ctx, state), view = engine(ctx).view(state, { asOf: now(ctx) });
      const content = ui.tab === 'accounts' ? renderProfiles(ctx, data, view) : ui.tab === 'statements' ? renderStatements(ctx, view) : ui.tab === 'contracts' ? renderContracts(ctx, view) : ui.tab === 'repayments' ? renderRepayments(ctx, state, data, view) : ui.tab === 'fees' ? renderFees(ctx, state, view) : ui.tab === 'audit' ? renderAudit(ctx, data) : renderOverview(ctx, state, view);
      return `<section id="obligations-root" class="obligations"><div class="notice warning"><span>本地信用义务，信息可能不完整。授信额度不是资产，也不计入可花的钱。这里只登记与核对，不执行还款。</span></div><nav class="ob-tabs" aria-label="信用义务工作区">${TABS.map(([id, text]) => `<button type="button" data-ob-action="tab" data-ob-id="${id}"${ui.tab === id ? ' class="active" aria-current="page"' : ''}>${text}</button>`).join('')}</nav><div id="ob-workspace" tabindex="-1">${content}</div><p class="ob-note">查看日 ${e(view.asOf)} · 本地修订 ${e(view.revision)}。到账覆盖、到期检查与已记录余额截到查看日；其余资料采用当前版本，不是历史状态重建。真实收入、消费、现金与账户余额仍由原始交易和账务关系计算；这些义务记录不会制造交易。以机构最新账单和实际到账为准。</p></section>`;
    } catch (error) { return `<div class="notice warning" role="alert">信用义务无法读取：${e(error.message)}。请保留备份后核对。</div>`; }
  }
  function renderProfiles(ctx, data, view) {
    return card('明确账户角色', '未设置时保持未知；账户余额正负不能自动说明资金性质。', paged('profiles', view.profiles, r => {
      const profile = data.profiles.find(p => p.accountId === r.accountId);
      return row(`<h3>${e(ctx.accountName(r.accountId))}</h3>${badge(ROLES[r.role] || '角色未知', r.role === 'unknown')}<p>授信额度 ${m(ctx, r.creditLimitCents)}（仅供记录，不计资产）</p>${r.note ? source(r.note) : ''}`, btn('profile', profile ? '编辑角色' : '设置角色', r.accountId) + (profile ? removeButton('profile', profile.id) : ''));
    }, '还没有账户。请先在账户分类中创建。'));
  }
  function renderStatements(ctx, view) {
    const official = view.statements.filter(r => r.provenance === 'official'), estimates = view.statements.filter(r => r.provenance === 'estimate');
    const draw = r => row(`<h3>${e(ctx.accountName(r.accountId))} · ${r.provenance === 'official' ? '正式账单' : '估计账单'}</h3>${badge(r.provenance === 'official' ? '用户录入的正式账单' : '估计 · 不纳入义务预测', r.provenance !== 'official')}${r.overdue ? badge('已过到期日 · 仍有本地未覆盖金额', true) : ''}<dl class="ob-facts"><div><dt>账期</dt><dd>${dateText(r.periodStart)} 至 ${dateText(r.periodEnd)}</dd></div><div><dt>出账 / 到期</dt><dd>${dateText(r.statementDate)} / ${dateText(r.dueDate)}</dd></div><div><dt>账单所列应还金额</dt><dd>${m(ctx, r.amountCents)}</dd></div><div><dt>截至查看日已转入并分配</dt><dd>${m(ctx, r.allocatedCents)}</dd></div><div><dt>未来到账、已预留分配</dt><dd>${m(ctx, r.pendingArrivalAllocatedCents)}</dd></div><div><dt>本地未覆盖额</dt><dd>${m(ctx, r.outstandingCents)}</dd></div></dl><p>${e(COVERAGE[r.coverageStatus] || '覆盖情况未知')}；不是银行已还清证明。</p>${source(r.source)}`, btn('statement', '查看 / 编辑', r.id) + (r.provenance === 'official' ? btn('repayment', '分配真实还款', r.id) + btn('inclusion', '关联已入账分期', r.id) : '') + removeButton('statement', r.id));
    return card('正式账单', '金额修订需要核对原始依据并写明原因；不产生现金调整。', paged('statements', official, draw, '没有正式账单；不能把缺失账单当作零负债。'), btn('statement', '登记账单')) + card('估计账单', '估计与正式账单分别保留，不自动合并，不猜测重复关系。', paged('estimates', estimates, draw, '没有估计账单。'));
  }
  function scheduleRows(ctx, schedule) {
    return `<div class="ob-table-wrap"><table class="ob-table"><caption>完整期次表（按明确录入的日期，不按三个月截断）</caption><thead><tr><th scope="col">期编号</th><th scope="col">到期日</th><th scope="col">本金</th><th scope="col">费用</th><th scope="col">合计</th><th scope="col">预测状态 / 关联</th></tr></thead><tbody>${schedule.map(s => `<tr><th scope="row">${e(s.id)}</th><td>${e(s.dueDate)}</td><td>${m(ctx, s.principalCents)}</td><td>${m(ctx, s.feeCents)}</td><td>${m(ctx, s.amountCents === undefined ? s.feeCents === null ? null : safeSum([s.principalCents, s.feeCents]) : s.amountCents)}</td><td>${e({ billed: '已入正式账单，仅使用账单未覆盖额', unbilled: '未关联账单／是否已入账待核对', cancelled: '合约已取消' }[s.forecastStatus] || '待提交核对')}${s.statementId ? `<br>账单 ${e(s.statementId)}` : ''}${s.inclusionId ? removeButton('inclusion', s.inclusionId) : ''}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function safeSum(numbers) { const sum = numbers.reduce((a, v) => a + BigInt(v), 0n); if (sum > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('金额合计超过安全范围'); return Number(sum); }
  function scheduleTail(ctx, schedule, asOf) {
    const pending = schedule.filter(s => s.forecastStatus !== 'billed' && s.forecastStatus !== 'cancelled'), late = pending.filter(s => s.dueDate < asOf), future = pending.filter(s => s.dueDate >= asOf);
    const summary = (label, rows) => `<p>${label} ${rows.length} 期：本金 ${m(ctx, safeSum(rows.map(s => s.principalCents)))}，已知费用 ${m(ctx, safeSum(rows.filter(s => s.feeCents !== null).map(s => s.feeCents)))}，费用未知 ${rows.filter(s => s.feeCents === null).length} 期。</p>`;
    return `<div class="ob-tail">${summary('全部未关联账单的计划尾款', pending)}${summary('其中已过到期日、仍待核对', late)}${summary('其中当日与未来全部期次', future)}<p>未关联账单不等于尚未入账或尚未实际付款；关联后由正式账单替代该期预测。</p></div>`;
  }
  function renderContracts(ctx, view) {
    return card('完整分期与剩余尾款', '分期计划不重复记消费；已发生购买与实际费用仍由交易核算。', paged('contracts', view.contracts, r => row(`<h3>${e(r.name)} · ${e(ctx.accountName(r.accountId))}</h3>${badge(r.status === 'cancelled' ? '用户记录已取消' : '有效合约')}<p>全部本金 ${m(ctx, r.principalCents)} · 全部费用 ${m(ctx, r.feeCents)} · 完整 ${r.schedule.length} 期</p>${source(r.source)}${r.purchaseTransactionId ? `<p>原购买交易 ${e(r.purchaseTransactionId)}（消费只计一次）</p>` : '<p class="ob-warning">尚未关联购买证据；不能证明已记入真实消费。</p>'}${scheduleTail(ctx, r.schedule, view.asOf)}`, btn('schedule', '查看全部期次', r.id) + btn('contract', '编辑合约 / 取消状态', r.id) + removeButton('contract', r.id)), '没有分期合约；这不代表不存在未录入的分期。'), btn('contract', '登记完整分期'));
  }
  const heldHistoryCache=new WeakMap();
  function heldHistoryIds(state){let ids=heldHistoryCache.get(state);if(!ids){ids=new Set();const data=state.bookkeeping;if(data?.version>=4){const add=(kind,row)=>{if(row&&kind==='heldPosition')ids.add(row.expenseId);if(row&&kind==='heldReturn')ids.add(row.incomeId);};for(const row of data.heldPositions)add('heldPosition',row);for(const row of data.heldReturns)add('heldReturn',row);for(const event of data.audit){add(event.kind,event.before);add(event.kind,event.after);}}heldHistoryCache.set(state,ids);}return ids;}
  function repaymentSources(ctx, state, accountId, projection) {
    const view = projection || engine(ctx).view(state, { asOf: now(ctx) });
    if (!Array.isArray(view.repaymentSources)) throw Error('模型未提供完整还款来源，请更新模块后再核对。');
    return view.repaymentSources.filter(p => (!accountId || p.toAccountId === accountId) && !p.legs.some(leg=>heldHistoryIds(state).has(leg.id))).map(p => ({ ...p, key: `${p.sourceKind}:${p.sourceId}`, outgoingId: p.legs[0].id, incomingId: p.legs.at(-1).id, accountId: p.toAccountId, availableCents: p.unallocatedCents })).sort((a, b) => b.incomingDate.localeCompare(a.incomingDate) || a.key.localeCompare(b.key));
  }
  function renderRepayments(ctx, state, data, view) {
    const credits = new Set(view.profiles.filter(p => p.role === 'credit').map(p => p.accountId)), sources = repaymentSources(ctx, state, undefined, view).filter(s => credits.has(s.accountId));
    return card('真实转账的分配', '只认原生转账或已确认转账配对，普通收入不能代替还款证据。押金/预付历史引用过的来源不能复用作信用证据。修改时先移除旧分配，再重新登记。', paged('repayments', view.repayments.slice().reverse(), r => {
      const s = sources.find(v => v.key === `${r.sourceKind}:${r.sourceId}`);
      return row(`<h3>${m(ctx, r.amountCents)} → 账单 ${e(r.statementId)}</h3><p>证据 ${e(r.sourceKind)} / ${e(r.sourceId)}</p>${badge(r.receiptStatus === 'recorded-future-arrival' ? '未来到账记录，尚不抵扣截至查看日的账单' : '截至查看日已有转入记录，未经银行实时核实')}${s ? `<p>转出 ${e(s.outgoingDate)} · 转入 ${e(s.incomingDate)}；此来源全部账单已分配 ${m(ctx, s.allocatedCents)}，尚未分配 ${m(ctx, s.availableCents)}</p>` : '<p>请查看保存时的资金证据快照。</p>'}${btn('evidence', '查看完整证据', r.id, ' data-ob-kind="repayment"')}`, removeButton('repayment', r.id));
    }, '没有分配记录；有转账也不会自动判定还款。'), btn('repayment', '分配已有转账')) + card('转入信用账户的已有转账记录', '未分配部分只是已有真实资金移动，不自动视为多还款，也不会创造可花资产。', paged('repayment-sources', sources, s => row(`<h3>${e(ctx.accountName(s.fromAccountId))} → ${e(ctx.accountName(s.accountId))}</h3>${badge(s.receiptStatus === 'recorded-future-arrival' ? '未来转入记录，尚不抵扣当前账单' : '已有日期内的转入记录，实时状态未核实')}<p>${e(s.sourceKind)} / ${e(s.sourceId)} · 转出 ${e(s.outgoingDate)} / 转入 ${e(s.incomingDate)}</p><p>本金 ${m(ctx, s.amountCents)} · 全部已分配 ${m(ctx, s.allocatedCents)} · 尚未分配 ${m(ctx, s.availableCents)}</p>`), '没有符合条件的真实转账。请先记入真实交易，或在账务核对中确认转账配对。'));
  }
  function renderFees(ctx, state, view) {
    return card('已经记入交易的费用', '这里只给既有支出加费用索引，不增加第二笔支出；计划费用不冒充实际费用。修改时先移除旧索引，再重新登记。', paged('fees', view.fees, r => row(`<h3>${e(FEE_KINDS[r.kind] || r.kind)} · 原始金额 ${m(ctx, r.recordedAmountCents ?? r.amountCents)}</h3><p>Relations 当前个人消费 ${m(ctx, r.personalExpenseCents)} · 账单 ${e(r.statementId || '未关联')} · 分期 ${e(r.contractId || '未关联')}</p>${transactionEvidence(ctx, state, r.transactionId)}${r.note ? source(r.note) : ''}`, removeButton('fee', r.id)), '没有已分类的实际费用；未知费用不按零处理。'), btn('fee', '索引已有费用支出'));
  }
  function horizonEnd(asOf) { const year = Number(asOf.slice(0, 4)), month = Number(asOf.slice(5, 7)), next = year * 12 + month - 1 + 3; return next >= 120000 ? null : `${String(Math.floor(next / 12)).padStart(4, '0')}-${String(next % 12 + 1).padStart(2, '0')}-01`; }
  function renderOverview(ctx, state, view) {
    const all = Array.isArray(view.forecast) ? view.forecast : view.forecast?.rows || [], end = horizonEnd(view.asOf);
    const shown = ui.horizon === 'near' ? all.filter(r => !end || !r.dueDate || r.dueDate < end) : all;
    const horizon = actions(btn('horizon', '全部期限', 'all', ui.horizon === 'all' ? ' aria-pressed="true"' : ' aria-pressed="false"') + btn('horizon', '本月起三个月 + 过去未解决 + 日期未知', 'near', ui.horizon === 'near' ? ' aria-pressed="true"' : ' aria-pressed="false"'));
    const uncertainty = Array.isArray(view.uncertainty) ? view.uncertainty : [view.uncertainty];
    const pending = Array.isArray(view.unbilledEvidence) ? view.unbilledEvidence : view.unbilledEvidence?.rows || [];
    return roleSummary(ctx, view) + card('已录入的到期义务', '逐项列示，不能直接相加：连续账单可能包含上期未还额，未关联分期也可能已在账单中。预测不完整，不提供可安全消费余额。', `${horizon}${view.forecastOverlapStatus === 'possible' ? '<p class="ob-warning" role="status">汇总待核对（可能重复覆盖）。不合计为总额或最低应还额；请先核对结转账单与分期入账关系。</p>' : '<p>未检测到已知重叠不代表已证明独立；这里仅逐项列示。</p>'}<p role="status">当前视图 ${shown.length} / 全部 ${all.length} 项${ui.horizon === 'near' ? (end ? `；${end} 起 ${all.length - shown.length} 项仍保留在全部期限和完整分期中。` : '；视图已到支持日历的 9999 年末，全部有效期次保留。') : '；包括所有过去未解决与远期尾款。'}</p>${paged('forecast', shown, r => row(`<h3>${r.provenance === 'official' || r.statementId && !r.installmentId ? '正式账单未覆盖额' : '未关联账单的分期'}</h3><p>到期 ${dateText(r.dueDate)} · ${e(ctx.accountName(r.accountId))}</p><p>金额 ${m(ctx, r.amountCents)}${r.amountCents == null ? `；该期计划已知部分 ${m(ctx, r.knownMinimumCents)}，其余未知` : ''}</p>${r.billingOverlapStatus ? badge('可能已被其他账单覆盖，待核对', true) : ''}<p>账单 ${e(r.statementId || '无')} · 合约 ${e(r.contractId || '无')} · 期次 ${e(r.installmentId || '无')}</p>`), '尚无可列示的义务，不能解读为零负债。')}`) + card('数据不足与覆盖条件', '下列未知不会变成零。来源覆盖和快照只提供背景，不能证明账单完整或新鲜。', uncertainty.filter(Boolean).length ? uncertainty.filter(Boolean).map(r => uncertaintyRow(ctx, r)).join('') : '<p>模型未列出其他条目，账单完整性与新鲜度仍未核实。</p>') + card('未入账消费证据', '按模型提供的最近正式账期分类；没有明确到期日或与分期的对照，因此不叠加进义务预测。', pending.length ? paged('unbilled', pending, r => row(`<h3>${e(ctx.accountName(r.accountId))}</h3><p>${r.classification === 'unknown' ? '缺少正式账期，未入账分类未知' : `最近已知正式账期止日 ${e(r.afterDate)} 之后的消费证据`}</p><p>原始交易合计 ${m(ctx, r.recordedAmountCents)}，不加入义务预测。</p>${r.rows.map(t => transactionEvidence(ctx, state, t.transactionId)).join('') || '<p>没有符合当前分类的交易，不能认定没有未入账消费。</p>'}`), '') : '<p>没有可列示证据，或账期信息不足，分类仍可能未知。</p>') + `<details class="ob-details"><summary>查看本地覆盖记录与日终快照依据</summary><p>这是用户保存的来源记录，不代表机构实时证明。</p>${inspectObject(view.freshness || { overallCoverage: 'unknown', overallFreshness: 'unknown' })}</details>`;
  }
  function legacyCashLabel(ctx, label) { return ctx.getState().obligations !== undefined ? label.replace(/对外现金/g, '全账户外部记录').replace(/实际现金/g, '全账户实际记录') : label; }
  function legacyScopeNotice(ctx, historical = false) {
    if (ctx.getState().obligations === undefined) return '';
    return `<p class="ob-warning">此处沿用全账户外部记录口径，排除本人转移；信用消费不等于现金账户流出，还款虽属内部转移仍会减少现金账户。请在信用义务中查看按明确账户角色分组的真实变动。<button type="button" class="text-link" data-page="obligations">前往信用义务</button>${historical ? '封存未保存历史账户角色快照；角色分组采用当前角色，不能据此重建历史角色报告。旧封存金额不改写。' : '未明确的账户角色保持未知，授信额度和信用账户正余额不计入现金资产。'}</p>`;
  }
  function uncertaintyRow(ctx, r) {
    if (typeof r === 'string') return `<p class="ob-warning">${e(r)}</p>`;
    const labels = { 'unknown-role': '账户角色未知', 'estimated-statement': '仅有估计账单，未纳入正式义务', 'unknown-fee': '分期费用未知，不按零处理', 'missing-contract-source': '合约来源未知', 'missing-purchase-evidence': '购买证据缺失，不能确认已计入真实消费', 'missing-official-statement': '缺少正式账单，未入账分类未知', 'source-coverage-and-freshness-unknown': '来源覆盖和新鲜度未知', 'statement-carryover-unknown': '连续账单是否结转相同欠款未知', 'installment-billing-inclusion-unknown': '未关联分期是否已包含在正式账单中未知', 'possible-statement-overlap': '连续账单可能结转相同欠款', 'possible-installment-overlap': '分期可能已经包含在正式账单中' };
    return `<div class="ob-warning"><p>${e(labels[r.kind] || r.message || '仍有待核对条件')} ${r.accountId ? '· ' + e(ctx.accountName(r.accountId)) : ''}${r.statementId ? ' · 账单 ' + e(r.statementId) : ''}${r.contractId ? ' · 合约 ' + e(r.contractId) : ''}${r.installmentId ? ' · 期次 ' + e(r.installmentId) : ''}</p>${r.message ? `<p>${e(r.message)}</p>` : ''}<details><summary>查看完整条件与引用</summary>${inspectObject(r)}</details></div>`;
  }
  function roleSummary(ctx, view) {
    const actual = view.roleAwareActuals;
    if (!actual) return '<p class="ob-warning">角色分组的真实变动暂不可用，请勿把全账户记录解释为可花现金。</p>';
    const labels = { cash: '明确现金账户', credit: '信用负债账户', restricted: '受限资金账户', other: '其他账户', unknown: '角色未知账户' };
    return card('按账户角色看真实记录', `截至 ${actual.asOf}，采用当前明确角色和 Relations 真实账户变动；数据覆盖仍未核实，不是可安全消费金额。`, `<dl class="ob-facts"><div><dt>已明确现金账户余额</dt><dd>${m(ctx, actual.knownCashBalanceCents)}</dd></div><div><dt>角色齐全的现金账户余额</dt><dd>${actual.rolesComplete ? m(ctx, actual.liquidBalanceCents) : '未知（仍有未明确角色）'}</dd></div><div><dt>信用账户已记录负余额</dt><dd>${m(ctx, actual.recordedCreditDebtCents)}</dd></div><div><dt>信用账户已记录正余额</dt><dd>${m(ctx, actual.recordedCreditPositiveBalanceCents)}（不计现金）</dd></div></dl><p class="ob-note">信用负余额不是最新账单应还额。信用正余额可能涉及多种情况，不自动认定溢缴款或可提现资产。额度从未计入这些余额。</p><details><summary>逐组、逐账户核对真实变动</summary>${Object.entries(actual.groups).map(([key, g]) => `<section class="ob-row"><h3>${e(labels[key] || key)} · 余额 ${m(ctx, g.balanceCents)}</h3><p>期间累计流入 ${m(ctx, g.inflowCents)} · 流出 ${m(ctx, g.outflowCents)} · 净变动 ${m(ctx, g.netCents)}</p>${g.accounts.map(a => `<p>${e(a.name)} · 期初 ${m(ctx, a.openingBalanceCents)} · 记录余额 ${m(ctx, a.recordedBalanceCents)} · 流入 ${m(ctx, a.inflowCents)} / 流出 ${m(ctx, a.outflowCents)}</p>`).join('') || '<p>没有明确属于本组的账户；不代表现实中不存在。</p>'}</section>`).join('')}</details><p class="ob-note">按原交易日期截到查看日；原生转账与配对各腿保持原日期。当前账户角色并非历史角色快照。全账户记录口径与明确现金账户口径不同。</p>`);
  }
  function renderAudit(ctx, data) {
    return card('可回看的修改历史', '撤销会追加反向记录；必须与当前记录完全匹配且依赖仍成立。不会抹去历史。', paged('audit', data.audit.slice().reverse(), a => row(`<h3>${e(KINDS[a.kind] || a.kind)} · ${e(a.action)} · 修订 ${a.revision}</h3><p>${e(a.at)} · ${e(a.recordId)}${a.reverses ? ` · 撤销目标 ${e(a.reverses)}` : ''}</p>${source(a.reason)}<details><summary>修改前 / 后完整快照</summary><h4>修改前</h4>${inspectObject(a.before)}<h4>修改后</h4>${inspectObject(a.after)}</details>`, btn('revert', '核对并撤销此变更', a.id)), '还没有义务变更。'));
  }
  function field(label, name, value, attrs = '') { return `<label class="field">${e(label)}<input name="${e(name)}" value="${e(value ?? '')}" ${attrs}></label>`; }
  function textarea(label, name, value, attrs = '') { return `<label class="field full">${e(label)}<textarea name="${e(name)}" rows="4" ${attrs}>${e(value ?? '')}</textarea></label>`; }
  function selectField(label, name, options, value, required = true) { return `<label class="field">${e(label)}<select name="${e(name)}"${required ? ' required' : ''}><option value="">${required ? '请明确选择' : '未知 / 不关联'}</option>${options.map(([id, text]) => `<option value="${e(id)}"${selected(value, id)}>${e(text)}</option>`).join('')}</select></label>`; }
  function formMarkup(ctx, body, title = '核对变更') { return `<form id="entry-form" class="ob-form">${body}<div class="modal-bottom">${cancel(ctx)}<button class="btn primary" type="submit">${e(title)}</button></div></form>`; }
  const val = (form, name) => form.elements.namedItem(name)?.value ?? '';
  const optional = value => String(value).trim() || null;
  function requireValue(value, label) { const s = String(value).trim(); if (!s) throw Error('请填写或选择' + label); return s; }
  function parseCents(ctx, value, unknown = false) { const s = String(value).trim(); if (unknown && (!s || s === '?')) return null; return ctx.ledger.parseAmount(s, { allowZero: true }); }
  function bindForm(ctx, submit, ready) {
    const form = ctx.$('#entry-form');
    if (!form) throw Error('表单未打开，请重试。');
    form.addEventListener('input', () => { form.dataset.dirty = 'true'; });
    form.addEventListener('change', () => { form.dataset.dirty = 'true'; });
    form.onsubmit = event => { event.preventDefault(); if (form.reportValidity && !form.reportValidity()) return; try { submit(form); } catch (err) { ctx.error(err.message); } };
    if (ready) ready(form);
  }
  function capture(ctx) { const state = ctx.getState(); return { state, revision: dataOf(ctx, state).revision, basis: JSON.stringify(state) }; }
  function assertCurrent(ctx, captured) { if (ctx.getState() !== captured.state || dataOf(ctx, ctx.getState()).revision !== captured.revision || JSON.stringify(ctx.getState()) !== captured.basis) throw Error('打开表单后账本已改变。请关闭并重新核对，不能覆盖新数据。'); }
  function accountOptions(ctx, creditOnly) { const s = ctx.getState(), profiles = dataOf(ctx, s).profiles; return s.accounts.filter(a => !creditOnly || profiles.some(p => p.accountId === a.id && p.role === 'credit')).map(a => [a.id, a.name]); }
  function editor(ctx, title, markup, read, method, id, initial, hint, extraReady, captured = capture(ctx)) {
    const draw = values => ctx.modal(title, formMarkup(ctx, `<p class="ob-note">${e(hint)}</p><div class="form-grid">${markup(values)}</div>`), '', () => bindForm(ctx, form => {
      assertCurrent(ctx, captured);
      const input = read(form);
      review(ctx, { title, method, id, input, before: id ? getRecord(ctx, method === 'putProfile' ? 'profile' : method === 'putStatement' ? 'statement' : 'contract', id) : null, captured, back: () => draw(input) });
    }, form => extraReady?.(form, values)));
    draw(initial);
  }
  function reviewRecord(ctx, kind, record, state) {
    if (!record) return '<p>无记录。</p>';
    let summary = '';
    if (kind === 'profile') summary = `<p>${e(ctx.accountName(record.accountId))} · ${e(ROLES[record.role] || '角色未知')} · 授信额度 ${m(ctx, record.creditLimitCents)}（不计资产）</p>`;
    else if (kind === 'statement') summary = `<p>${e(ctx.accountName(record.accountId))} · ${record.provenance === 'official' ? '正式账单' : '估计账单'} · 所列应还金额 ${m(ctx, record.amountCents)}</p><p>账期 ${dateText(record.periodStart)} 至 ${dateText(record.periodEnd)} · 出账 ${dateText(record.statementDate)} · 到期 ${dateText(record.dueDate)}</p>${source(record.source)}`;
    else if (kind === 'contract') summary = `<p>${e(record.name)} · ${e(ctx.accountName(record.accountId))} · ${record.status === 'cancelled' ? '用户记录已取消' : '有效合约'}</p><p>全部本金 ${m(ctx, record.principalCents)} · 全部费用 ${m(ctx, record.feeCents)} · ${record.schedule.length} 期完整计划</p>${source(record.source)}${scheduleRows(ctx, record.schedule)}${record.purchaseTransactionId ? transactionEvidence(ctx, state, record.purchaseTransactionId) : '<p>购买证据未知。</p>'}`;
    else if (kind === 'repayment') {
      const bill = dataOf(ctx, state).statements.find(s => s.id === record.statementId), src = repaymentSources(ctx, state).find(s => s.sourceKind === record.sourceKind && s.sourceId === record.sourceId);
      summary = `<p>此次分配 ${m(ctx, record.amountCents)} → ${e(bill ? ctx.accountName(bill.accountId) : '历史账单')} · 账单 ${e(record.statementId)}</p>${bill ? `<p>账单所列应还 ${m(ctx, bill.amountCents)} · 到期 ${dateText(bill.dueDate)}</p>${source(bill.source)}` : ''}${src ? `<p>转出 ${e(src.outgoingDate)} / 转入 ${e(src.incomingDate)} · 尚未分配来源本金 ${m(ctx, src.availableCents)}</p>${transactionEvidence(ctx, state, src.outgoingId)}${src.incomingId !== src.outgoingId ? transactionEvidence(ctx, state, src.incomingId) : ''}` : '<p>当前来源已不可用，请核对保存时完整证据。</p>'}`;
    } else if (kind === 'inclusion') {
      const c = dataOf(ctx, state).contracts.find(c => c.id === record.contractId), item = c?.schedule.find(s => s.id === record.installmentId);
      summary = `<p>正式账单 ${e(record.statementId)} ← ${e(c?.name || record.contractId)} / ${e(record.installmentId)}</p>${item ? scheduleRows(ctx, [item]) : '<p>当前期次不存在，请查看保存时快照。</p>'}<p>确认关联后，整期预测由正式账单未覆盖额替代。</p>`;
    } else if (kind === 'fee') summary = `<p>${e(FEE_KINDS[record.kind])} · 账单 ${e(record.statementId || '未关联')} · 合约 ${e(record.contractId || '未关联')}</p>${transactionEvidence(ctx, state, record.transactionId)}`;
    return summary + `<details><summary>完整字段与保存时证据（金额字段单位：分）</summary>${inspectObject(record)}</details>`;
  }
  function review(ctx, op) {
    assertCurrent(ctx, op.captured);
    const after = op.method === 'remove' ? null : op.input;
    const kind = op.kind || ({ putProfile: 'profile', putStatement: 'statement', putContract: 'contract', allocateRepayment: 'repayment', includeInstallment: 'inclusion', markFee: 'fee' })[op.method];
    const body = `<p class="ob-warning">${e(op.method === 'remove' ? '移除此本地记录。若有依赖，须先明确移除依赖。' : op.method === 'revert' ? '尝试恢复这条历史变更前的记录；当前状态和依赖须仍匹配。' : '请对照真实依据核对下列全部字段。正式账单金额改变只是资料修订。')} 真实交易、现金、消费和期初余额不因本次操作增加或减少。</p><div class="ob-review"><h3>修改前</h3>${reviewRecord(ctx, kind, op.before, op.captured.state)}<h3>拟保存内容</h3>${reviewRecord(ctx, kind, after, op.captured.state)}</div>${textarea('确认原因（必填，最多 500 字）', 'reason', '', 'required maxlength="500"')}<label class="ob-confirm"><input name="confirmed" type="checkbox" required>我已核对来源和完整内容，确认仅保存本地记录；这不会替我向机构还款。</label><p>本次依据修订 ${op.captured.revision}；任何已发生的账本变化都会要求重新核对。</p>${op.back ? '<button class="btn" type="button" id="ob-review-back">返回修改内容</button>' : ''}`;
    ctx.modal('确认：' + op.title, formMarkup(ctx, body, '确认保存本地变更'), '', () => bindForm(ctx, form => {
      if (form.dataset.submitted === 'true') return;
      if (!form.elements.namedItem('confirmed').checked) throw Error('请先明确勾选核对确认。');
      const reason = requireValue(val(form, 'reason'), '确认原因'); if (reason.length > 500) throw Error('确认原因不能超过 500 字。');
      assertCurrent(ctx, op.captured);
      form.dataset.submitted = 'true';
      const ok = ctx.change(() => {
        assertCurrent(ctx, op.captured);
        const current = ctx.getState(), approval = { confirmed: true, expectedRevision: op.captured.revision, reason };
        if (op.method === 'remove') return engine(ctx).remove(current, op.kind, op.id, approval);
        if (op.method === 'revert') return engine(ctx).revert(current, op.id, approval);
        return engine(ctx)[op.method](current, copy(op.input), approval, op.id);
      }, '本地义务记录已保存；真实交易未改变。');
      if (ok !== true) form.dataset.submitted = 'false';
    }, form => {
      form.dataset.dirty = 'true';
      if (op.back) ctx.$('#ob-review-back').onclick = () => { try { assertCurrent(ctx, op.captured); op.back(); } catch (err) { ctx.error(err.message); } };
    }));
  }
  function editProfile(ctx, accountId) {
    const data = dataOf(ctx, ctx.getState()), existing = data.profiles.find(p => p.accountId === accountId), values = existing || { accountId, role: '', creditLimitCents: null, note: '' };
    editor(ctx, existing ? '编辑账户角色' : '明确账户角色', v => selectField('账户', 'accountId', accountOptions(ctx, false), v.accountId) + selectField('明确角色', 'role', Object.entries(ROLES), v.role) + field('授信额度（元，未知留空）', 'creditLimit', inputAmount(ctx, v.creditLimitCents), 'inputmode="decimal" maxlength="32"') + textarea('依据 / 备注', 'note', v.note, 'maxlength="500"'), f => ({ accountId: requireValue(val(f, 'accountId'), '账户'), role: requireValue(val(f, 'role'), '角色'), creditLimitCents: parseCents(ctx, val(f, 'creditLimit'), true), note: val(f, 'note').trim() }), 'putProfile', existing?.id, values, '授信额度仅为信息；不增加资产。变更角色不能遗留引用它的信用账单或分期。');
  }
  function editStatement(ctx, id) {
    const initial = id ? getRecord(ctx, 'statement', id) : { accountId: '', provenance: '', periodStart: null, periodEnd: null, statementDate: null, dueDate: null, amountCents: null, source: null, note: '' };
    editor(ctx, id ? '修订账单资料' : '登记信用账单', v => selectField('信用账户', 'accountId', accountOptions(ctx, true), v.accountId) + selectField('资料性质', 'provenance', [['official', '正式账单（请对照机构账单）'], ['estimate', '估计（不纳入正式义务预测）']], v.provenance) + ['periodStart', 'periodEnd', 'statementDate', 'dueDate'].map((key, i) => field(['账期起日', '账期止日', '出账日', '到期日'][i], key, v[key], 'type="date" min="0001-01-01" max="9999-12-31"')).join('') + field('账单所列应还金额（元，估计未知可留空）', 'amount', inputAmount(ctx, v.amountCents), 'inputmode="decimal" maxlength="32"') + textarea('账单来源 / 核对依据', 'source', v.source, 'maxlength="500"') + textarea('备注', 'note', v.note, 'maxlength="500"'), f => {
      const provenance = requireValue(val(f, 'provenance'), '资料性质');
      const input = { accountId: requireValue(val(f, 'accountId'), '信用账户'), provenance, periodStart: optional(val(f, 'periodStart')), periodEnd: optional(val(f, 'periodEnd')), statementDate: optional(val(f, 'statementDate')), dueDate: optional(val(f, 'dueDate')), amountCents: parseCents(ctx, val(f, 'amount'), provenance !== 'official'), source: optional(val(f, 'source')), note: val(f, 'note').trim() };
      if (provenance === 'official') for (const key of ['periodStart', 'periodEnd', 'statementDate', 'dueDate', 'source']) requireValue(input[key] || '', key === 'source' ? '正式账单来源' : '正式账单的全部日期');
      return input;
    }, 'putStatement', id, initial, '正式账单应还金额不是信用账户总余额或本期消费合计。必须有完整日期、来源和金额。未知保持空白，明确为零才填 0；修订金额不会伪造现金。');
  }
  function parseSchedule(ctx, text) {
    const lines = String(text).trim().split(/\r?\n/).filter(s => s.trim());
    if (!lines.length) throw Error('请提供完整分期表。');
    return lines.map((line, index) => {
      const parts = line.split(',').map(s => s.trim());
      if (parts.length !== 4 || !parts[0] || !parts[1]) throw Error(`第 ${index + 1} 行须为：期编号,到期日,本金元,费用元或 ?`);
      return { id: parts[0], dueDate: parts[1], principalCents: parseCents(ctx, parts[2]), feeCents: parseCents(ctx, parts[3], true) };
    });
  }
  function scheduleText(ctx, schedule) { return schedule.map(s => `${s.id},${s.dueDate},${inputAmount(ctx, s.principalCents)},${s.feeCents === null ? '?' : inputAmount(ctx, s.feeCents)}`).join('\n'); }
  function editContract(ctx, id) {
    const initial = id ? getRecord(ctx, 'contract', id) : { accountId: '', name: '', principalCents: null, feeCents: null, source: '', purchaseTransactionId: null, status: 'active', schedule: [], note: '' };
    const txOptions = () => ctx.getState().transactions.filter(t => t.type === 'expense' && !heldHistoryIds(ctx.getState()).has(t.id)).map(t => [t.id, `${t.date} ${ctx.accountName(t.accountId)} ${ctx.money(t.amountCents)} ${t.note || t.id}`]);
    editor(ctx, id ? '编辑完整分期合约' : '登记完整分期合约', v => selectField('信用账户', 'accountId', accountOptions(ctx, true), v.accountId) + field('合约名称', 'name', v.name, 'required maxlength="80"') + field('全部本金（元）', 'principal', inputAmount(ctx, v.principalCents), 'required inputmode="decimal" maxlength="32"') + field('全部费用（元，未知留空）', 'fee', inputAmount(ctx, v.feeCents), 'inputmode="decimal" maxlength="32"') + selectField('用户记录状态', 'status', [['active', '有效'], ['cancelled', '已取消（须有真实依据）']], v.status) + selectField('已记录的购买支出（可不关联）', 'purchaseTransactionId', txOptions(), v.purchaseTransactionId, false) + textarea('合约来源 / 条款依据（未知可留空）', 'source', v.source, 'maxlength="500"') + textarea('完整期次：每行 期编号,到期日,本金元,费用元或 ?', 'schedule', scheduleText(ctx, v.schedule), 'required rows="10" spellcheck="false"') + '<p class="ob-note full">明确输入全部过去与未来期次，不自动顺延月份。已有期编号须保持稳定；已入正式账单的期次不能静默改变。</p>' + textarea('可选均摊助手：全部明确到期日，每行一个 YYYY-MM-DD', 'dates', '', 'spellcheck="false"') + '<div class="full"><button type="button" class="btn" id="ob-split">生成均摊草案（不保存）</button><p id="ob-split-status" role="status">本金与费用分别按整数分均摊，余分按输入次序分给前面的期次。先核对完整表，再确认保存。</p><div id="ob-split-preview"></div></div>' + textarea('备注', 'note', v.note, 'maxlength="500"'), f => ({ accountId: requireValue(val(f, 'accountId'), '信用账户'), name: requireValue(val(f, 'name'), '合约名称'), principalCents: parseCents(ctx, val(f, 'principal')), feeCents: parseCents(ctx, val(f, 'fee'), true), source: optional(val(f, 'source')), purchaseTransactionId: optional(val(f, 'purchaseTransactionId')), status: val(f, 'status'), schedule: parseSchedule(ctx, val(f, 'schedule')), note: val(f, 'note').trim() }), 'putContract', id, initial, '完整计划只表示用户提供的义务。已有押金/预付历史的来源不在购买证据选项中，即使当前分类已撤销。费用未知填 ?；已知零填 0。取消状态不代表已与机构解除合约。', form => {
      ctx.$('#ob-split').onclick = () => {
        try {
          const dates = val(form, 'dates').split(/\r?\n/).map(s => s.trim()).filter(Boolean), proposal = engine(ctx).splitSchedule({ principalCents: parseCents(ctx, val(form, 'principal')), feeCents: parseCents(ctx, val(form, 'fee'), true), dates });
          const schedule = Array.isArray(proposal) ? proposal : proposal.schedule;
          if (!Array.isArray(schedule)) throw Error('分期助手未返回完整期次表。');
          // Keep established IDs by position only when dates and count still match exactly.
          const old = initial.schedule;
          const full = schedule.map((s, i) => ({ ...s, id: old.length === schedule.length && old.every((v, j) => v.dueDate === schedule[j].dueDate) ? old[i].id : s.id }));
          form.elements.namedItem('schedule').value = scheduleText(ctx, full); form.dataset.dirty = 'true';
          ctx.$('#ob-split-status').textContent = `已生成 ${full.length} 期草案，未保存。余分按输入次序分给前面的期次；请逐期核对来源。`;
          ctx.$('#ob-split-preview').innerHTML = scheduleRows(ctx, full);
        } catch (err) { ctx.error(err.message); }
      };
    });
  }
  function simpleEditor(ctx, title, markup, read, method, initial, hint, ready) { editor(ctx, title, markup, read, method, undefined, initial, hint, ready); }
  function editRepayment(ctx, statementId) {
    const statements = dataOf(ctx, ctx.getState()).statements.filter(r => r.provenance === 'official'), sources = repaymentSources(ctx, ctx.getState());
    simpleEditor(ctx, '分配真实转账还款', v => selectField('正式账单', 'statementId', statements.map(s => [s.id, `${ctx.accountName(s.accountId)} · ${s.periodEnd} · ${ctx.money(s.amountCents)} · ${s.id}`]), v.statementId) + selectField('转账来源（金额跨全部账单共享）', 'sourceKey', sources.map(s => [s.key, `${s.sourceKind} ${s.sourceId} · ${ctx.accountName(s.accountId)} · ${s.outgoingDate} → ${s.incomingDate} · 尚未分配 ${ctx.money(s.availableCents)}`]), v.sourceKind ? `${v.sourceKind}:${v.sourceId}` : '') + field('此次分配金额（元）', 'amount', inputAmount(ctx, v.amountCents), 'required inputmode="decimal" maxlength="32"') + '<div id="ob-repayment-evidence" class="full" aria-live="polite"></div>', f => {
      const statement = requireValue(val(f, 'statementId'), '正式账单'), key = requireValue(val(f, 'sourceKey'), '真实转账'), src = sources.find(s => s.key === key);
      if (!src) throw Error('转账证据已不可选，请重新打开。');
      return { statementId: statement, sourceKind: src.sourceKind, sourceId: src.sourceId, amountCents: parseCents(ctx, val(f, 'amount')) };
    }, 'allocateRepayment', { statementId, amountCents: null }, '只能分配转入同一信用账户的已有真实转账；不能超过来源剩余本金或正式账单金额。先记录真实交易不会自动分配。', form => {
      const draw = () => { const src = sources.find(s => s.key === val(form, 'sourceKey')); ctx.$('#ob-repayment-evidence').innerHTML = src ? `<p>转出 ${e(src.outgoingDate)} · 转入 ${e(src.incomingDate)}，不同日期原样保留。跨全部账单已分配 ${m(ctx, src.allocatedCents)}，尚未分配 ${m(ctx, src.availableCents)}。</p>${transactionEvidence(ctx, ctx.getState(), src.outgoingId)}${src.incomingId !== src.outgoingId ? transactionEvidence(ctx, ctx.getState(), src.incomingId) : ''}` : '<p>请先选择来源以核对真实资金证据。</p>'; };
      form.elements.namedItem('sourceKey').onchange = draw; draw();
    });
  }
  function editInclusion(ctx, statementId) {
    const data = dataOf(ctx, ctx.getState()), statements = data.statements.filter(s => s.provenance === 'official'), items = data.contracts.flatMap(c => c.schedule.map(s => ({ contract: c, installment: s, key: `${c.id}:${s.id}` })));
    simpleEditor(ctx, '关联已进入正式账单的期次', v => selectField('正式账单', 'statementId', statements.map(s => [s.id, `${ctx.accountName(s.accountId)} · ${s.periodEnd} · ${s.id}`]), v.statementId) + selectField('完整期次（含远期，依赖由模型再次校验）', 'item', items.map(({ contract: c, installment: s, key }) => [key, `${c.name} / ${s.id} · ${s.dueDate} · 本金 ${ctx.money(s.principalCents)} · 费用 ${s.feeCents === null ? '未知，不能确认整期入账' : ctx.money(s.feeCents)}`]), v.contractId ? `${v.contractId}:${v.installmentId}` : ''), f => {
      const item = items.find(s => s.key === requireValue(val(f, 'item'), '分期期次')); if (!item) throw Error('期次不存在。');
      return { statementId: requireValue(val(f, 'statementId'), '正式账单'), contractId: item.contract.id, installmentId: item.installment.id };
    }, 'includeInstallment', { statementId }, '请以账单明细为依据。关联后该期预测完全被正式账单未覆盖额替代，避免叠加；费用未知的期次不能确认整期入账。');
  }
  function editFee(ctx) {
    const state = ctx.getState(), calculated = relations(ctx).calculate(state), data = dataOf(ctx, state), available = state.transactions.filter(t => t.type === 'expense' && !heldHistoryIds(state).has(t.id) && !calculated.impacts[t.id]?.excluded && !calculated.impacts[t.id]?.transferPairId && !data.fees.some(f => f.transactionId === t.id));
    simpleEditor(ctx, '索引已入账的实际费用', v => selectField('原始支出证据', 'transactionId', available.map(t => [t.id, `${t.date} · ${ctx.accountName(t.accountId)} · ${ctx.money(t.amountCents)} · ${t.note || t.id}`]), v.transactionId) + selectField('费用类型', 'kind', Object.entries(FEE_KINDS), v.kind) + selectField('相关账单（可留空）', 'statementId', data.statements.map(s => [s.id, `${ctx.accountName(s.accountId)} / ${s.periodEnd || '未知账期'} / ${s.id}`]), v.statementId, false) + selectField('相关合约（可留空）', 'contractId', data.contracts.map(s => [s.id, s.name]), v.contractId, false) + textarea('索引依据 / 备注', 'note', v.note, 'maxlength="500"') + '<div id="ob-fee-evidence" class="full"></div>', f => ({ transactionId: requireValue(val(f, 'transactionId'), '真实支出'), kind: requireValue(val(f, 'kind'), '费用类型'), statementId: optional(val(f, 'statementId')), contractId: optional(val(f, 'contractId')), note: val(f, 'note').trim() }), 'markFee', {}, '不生成新的支出。押金/预付本金和退回来源即使已撤销分类，也不能复用作信用费用、分期购买或还款证据，因为两份历史没有共同先后证明。未发生的合约费用只能留在计划，不能在这里假装已入账。', form => { const draw = () => { ctx.$('#ob-fee-evidence').innerHTML = val(form, 'transactionId') ? transactionEvidence(ctx, state, val(form, 'transactionId')) : ''; }; form.elements.namedItem('transactionId').onchange = draw; draw(); });
  }
  function showSchedule(ctx, id) {
    const state = ctx.getState(), view = engine(ctx).view(state, { asOf: now(ctx) }), contract = view.contracts.find(c => c.id === id);
    if (!contract) throw Error('分期合约不存在。');
    ctx.modal(contract.name + ' · 完整期次', `<p>共 ${contract.schedule.length} 期；这是完整表，没有三个月截断。</p>${source(contract.source)}${scheduleTail(ctx, contract.schedule, view.asOf)}${scheduleRows(ctx, contract.schedule)}${contract.purchaseTransactionId ? transactionEvidence(ctx, state, contract.purchaseTransactionId) : '<p>购买证据未知；计划不会自动生成消费。</p>'}`, cancel(ctx));
  }
  function showEvidence(ctx, kind, id) { const r = getRecord(ctx, kind, id); ctx.modal('保存时的完整证据', '<p>以下为本地保存的来源签名与引用，不证明机构最新状态。</p>' + inspectObject(r), cancel(ctx)); }
  function canReplace(ctx) { const form = ctx.$('#entry-form'); if (!form || form.dataset.dirty !== 'true') return true; if (!root.confirm || !root.confirm('放弃未保存的修改，打开另一项信用义务操作？')) return false; form.dataset.dirty = 'false'; return true; }
  function dispatch(ctx, target) {
    if (ctx.isActive?.() === false) return;
    const { obAction: action, obId: id, obKind: kind } = target.dataset;
    if (action === 'tab') { if (!TABS.some(([key]) => key === id)) return; ui.tab = id; ctx.render(); ctx.$('#ob-workspace')?.focus(); return; }
    if (action === 'page') { const delta = Number(target.dataset.obDelta); if (![1, -1].includes(delta)) return; ui.offsets[id] = Math.max(0, (ui.offsets[id] || 0) + delta * PAGE_SIZE); ctx.render(); ctx.$('#ob-workspace')?.focus(); return; }
    if (action === 'horizon') { if (!['all', 'near'].includes(id)) return; ui.horizon = id; ui.offsets.forecast = 0; ctx.render(); return; }
    if (!canReplace(ctx)) return;
    if (action === 'profile') editProfile(ctx, id);
    else if (action === 'statement') editStatement(ctx, id);
    else if (action === 'contract') editContract(ctx, id);
    else if (action === 'repayment') editRepayment(ctx, id);
    else if (action === 'inclusion') editInclusion(ctx, id);
    else if (action === 'fee') editFee(ctx);
    else if (action === 'schedule') showSchedule(ctx, id);
    else if (action === 'evidence') showEvidence(ctx, kind, id);
    else if (action === 'remove') { const before = getRecord(ctx, kind, id); review(ctx, { title: '移除' + KINDS[kind], method: 'remove', kind, id, before, input: null, captured: capture(ctx) }); }
    else if (action === 'revert') { const a = dataOf(ctx, ctx.getState()).audit.find(v => v.id === id); if (!a) throw Error('历史记录不存在。'); review(ctx, { title: '撤销历史变更', method: 'revert', kind: a.kind, id, before: a.after, input: a.before, captured: capture(ctx) }); }
  }
  function bind(ctx) {
    if (ctx.isActive?.() === false) return;
    context = ctx; const document = root.document;
    if (!document || document === boundDocument) return;
    boundDocument = document; ctx.onDispose?.(() => { context = null; ui.offsets = Object.create(null); });
    document.addEventListener('click', event => { const target = event.target.closest?.('[data-ob-action]'); if (!target || target.disabled || !context || context.isActive?.() === false) return; try { dispatch(context, target); } catch (error) { context.error(error.message); } });
  }
  return Object.freeze({ render, bind, parseSchedule, scheduleText, repaymentSources, legacyCashLabel, legacyScopeNotice, PAGE_SIZE });
}));
