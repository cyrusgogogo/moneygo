/* Local credit obligations. Metadata only; Relations remains the actual-money engine. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoneygoObligations = api;
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const VERSION = 1, LEDGER_VERSION = 6, MAX_AMOUNT_CENTS = 999999999999;
  const LIMITS = Object.freeze({ rows: 2000, audit: 5000, schedule: 1200, totalSchedule: 10000, snapshotCells: 100000, id: 100, text: 500 });
  const COLLECTIONS = Object.freeze({ profile: 'profiles', statement: 'statements', contract: 'contracts', repayment: 'repayments', inclusion: 'inclusions', fee: 'fees' });
  let sequence = 0;
  class ObligationsError extends Error { constructor(code, message) { super(message); this.name = 'ObligationsError'; this.code = code; } }
  function fail(code, message) { throw new ObligationsError(code, message); }
  function shape(v, fields) { if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v)) || Reflect.ownKeys(v).some(k => typeof k !== 'string' || !fields.includes(k) || !Object.getOwnPropertyDescriptor(v, k).enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), 'value'))) fail('INVALID_OBLIGATIONS', '记录格式或字段无效'); return v; }
  function array(v, max) { if (!Array.isArray(v) || v.length > max) fail('OBLIGATION_LIMIT', '记录数量超过上限或格式无效'); if (Reflect.ownKeys(v).some(k => k !== 'length' && (typeof k !== 'string' || !/^(0|[1-9][0-9]*)$/.test(k) || +k >= v.length || !Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), 'value')))) fail('INVALID_OBLIGATIONS', '数组不能包含额外字段或访问器'); for (let i = 0; i < v.length; i++) if (!Object.hasOwn(v, i)) fail('INVALID_OBLIGATIONS', '记录不能留有空项'); return v; }
  function id(v) { if (typeof v !== 'string' || v.length > LIMITS.id || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(v) || ['constructor', 'prototype'].includes(v)) fail('INVALID_ID', '记录标识无效'); return v; }
  function text(v, required = false, max = LIMITS.text) { if (typeof v !== 'string' || v.length > max || required && !v.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) fail('INVALID_OBLIGATIONS', '文字缺失、过长或包含无效字符'); return v; }
  function integer(v, min, max) { if (!Number.isSafeInteger(v) || v < min || v > max) fail('INVALID_AMOUNT', '须为范围内的整数分'); return v === 0 ? 0 : v; }
  function amount(v, positive = false) { return integer(v, positive ? 1 : 0, MAX_AMOUNT_CENTS); }
  function nullable(v, fn) { return v === null ? null : fn(v); }
  function sum(values) { let n = 0n; for (const v of values) n += BigInt(v); if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER)) fail('AMOUNT_OVERFLOW', '累计金额过大'); return Number(n); }
  function date(v) { if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(v)) fail('INVALID_DATE', '日期无效'); const y = +v.slice(0, 4), m = +v.slice(5, 7), d = +v.slice(8); if (y < 1 || m < 1 || m > 12 || d < 1 || d > [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]) fail('INVALID_DATE', '日期无效'); return v; }
  function timestamp(v) { if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) fail('INVALID_DATE', '时间无效'); date(v.slice(0, 10)); return v; }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function canonical(v) { return Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']' : v && typeof v === 'object' ? '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}' : JSON.stringify(v); }
  function same(a, b) { return canonical(a) === canonical(b); }
  function relations() { const r = typeof module === 'object' && module.exports ? require('./relations.js') : root.MoneygoRelations; if (!r) fail('RELATIONS_UNAVAILABLE', '账务模块未加载'); return r; }
  function defaultState() { return { version: VERSION, revision: 0, profiles: [], statements: [], contracts: [], repayments: [], inclusions: [], fees: [], audit: [] }; }
  function signature(t) { return { id: t.id, type: t.type, date: t.date, amountCents: t.amountCents, accountId: t.accountId, toAccountId: t.type === 'transfer' ? t.toAccountId : null }; }
  function financial(v) { shape(v, ['id', 'type', 'date', 'amountCents', 'accountId', 'toAccountId']); if (!['expense', 'income', 'transfer'].includes(v.type)) fail('INVALID_TYPE', '交易类型无效'); const row = { id: id(v.id), type: v.type, date: date(v.date), amountCents: amount(v.amountCents, true), accountId: id(v.accountId), toAccountId: v.type === 'transfer' ? id(v.toAccountId) : null }; if (v.type !== 'transfer' && v.toAccountId !== null || row.accountId === row.toAccountId) fail('INVALID_REFERENCE', '交易账户无效'); return row; }
  function proof(v) {
    shape(v, ['sourceKind', 'sourceId', 'amountCents', 'fromAccountId', 'toAccountId', 'outgoingDate', 'incomingDate', 'legs']);
    if (!['native', 'pair'].includes(v.sourceKind)) fail('INVALID_SOURCE', '还款必须引用原生转账或已确认双边转账');
    const p = { sourceKind: v.sourceKind, sourceId: id(v.sourceId), amountCents: amount(v.amountCents, true), fromAccountId: id(v.fromAccountId), toAccountId: id(v.toAccountId), outgoingDate: date(v.outgoingDate), incomingDate: date(v.incomingDate), legs: array(v.legs, 2).map(financial) };
    const a = p.legs[0], b = p.legs[1];
    if (!a || p.fromAccountId === p.toAccountId || a.accountId !== p.fromAccountId || a.amountCents !== p.amountCents || a.date !== p.outgoingDate) fail('INVALID_SOURCE', '转账来源快照不一致');
    if (p.sourceKind === 'native') { if (p.legs.length !== 1 || a.id !== p.sourceId || a.type !== 'transfer' || a.toAccountId !== p.toAccountId || p.incomingDate !== a.date) fail('INVALID_SOURCE', '原生转账快照无效'); }
    else if (p.legs.length !== 2 || a.type !== 'expense' || b.type !== 'income' || a.id === b.id || b.amountCents !== p.amountCents || b.accountId !== p.toAccountId || b.date !== p.incomingDate) fail('INVALID_SOURCE', '双边转账快照无效');
    return p;
  }
  const FIELDS = Object.freeze({
    profile: ['accountId', 'role', 'creditLimitCents', 'note'],
    statement: ['accountId', 'provenance', 'periodStart', 'periodEnd', 'statementDate', 'dueDate', 'amountCents', 'source', 'note'],
    contract: ['accountId', 'name', 'principalCents', 'feeCents', 'source', 'purchaseTransactionId', 'status', 'schedule', 'note'],
    repayment: ['statementId', 'sourceKind', 'sourceId', 'amountCents'],
    inclusion: ['statementId', 'contractId', 'installmentId'],
    fee: ['transactionId', 'kind', 'statementId', 'contractId', 'note']
  });
  for (const fields of Object.values(FIELDS)) Object.freeze(fields);
  function row(kind, v) {
    if (!COLLECTIONS[kind]) fail('INVALID_OBLIGATION_KIND', '记录种类无效');
    const captures = kind === 'contract' ? ['purchaseSignature'] : kind === 'repayment' ? ['sourceProof'] : kind === 'fee' ? ['transactionSignature'] : [];
    shape(v, ['id', 'createdAt', ...FIELDS[kind], ...captures]);
    const out = { id: id(v.id), createdAt: timestamp(v.createdAt) };
    if (kind === 'profile') {
      if (!['cash', 'credit', 'restricted', 'other'].includes(v.role)) fail('INVALID_ROLE', '账户角色须明确确认');
      const creditLimitCents = nullable(v.creditLimitCents, amount); if (v.role !== 'credit' && creditLimitCents !== null) fail('INVALID_ROLE', '非信用账户不能填写信用额度');
      return { ...out, accountId: id(v.accountId), role: v.role, creditLimitCents, note: text(v.note) };
    }
    if (kind === 'statement') {
      if (!['official', 'estimate'].includes(v.provenance)) fail('INVALID_PROVENANCE', '账单来源无效');
      const s = { ...out, accountId: id(v.accountId), provenance: v.provenance, periodStart: nullable(v.periodStart, date), periodEnd: nullable(v.periodEnd, date), statementDate: nullable(v.statementDate, date), dueDate: nullable(v.dueDate, date), amountCents: nullable(v.amountCents, amount), source: nullable(v.source, x => text(x, true)), note: text(v.note) };
      if (s.provenance === 'official' && [s.periodStart, s.periodEnd, s.statementDate, s.dueDate, s.amountCents, s.source].some(x => x === null)) fail('INCOMPLETE_STATEMENT', '正式账单须填写账期、出账日、到期日、金额与来源');
      const ordered = [s.periodStart, s.periodEnd, s.statementDate, s.dueDate].filter(x => x !== null); if (ordered.some((x, i) => i && x < ordered[i - 1])) fail('INVALID_DATE_ORDER', '账期与日期顺序无效');
      return s;
    }
    if (kind === 'contract') {
      if (!['active', 'cancelled'].includes(v.status)) fail('INVALID_STATUS', '分期状态无效');
      const c = { ...out, accountId: id(v.accountId), name: text(v.name, true, 80), principalCents: amount(v.principalCents, true), feeCents: nullable(v.feeCents, amount), source: nullable(v.source, x => text(x, true)), purchaseTransactionId: nullable(v.purchaseTransactionId, id), status: v.status, schedule: array(v.schedule, LIMITS.schedule).map(s => { shape(s, ['id', 'dueDate', 'principalCents', 'feeCents']); return { id: id(s.id), dueDate: date(s.dueDate), principalCents: amount(s.principalCents), feeCents: nullable(s.feeCents, amount) }; }), note: text(v.note), purchaseSignature: nullable(v.purchaseSignature, financial) };
      const seen = new Set(); for (const s of c.schedule) { if (seen.has(s.id)) fail('DUPLICATE_ID', '期次标识重复'); seen.add(s.id); if (s.principalCents === 0 && s.feeCents === 0) fail('INVALID_AMOUNT', '分期期次不能为已知零额'); }
      if (!c.schedule.length || c.schedule.some((s, i) => i && s.dueDate < c.schedule[i - 1].dueDate) || sum(c.schedule.map(s => s.principalCents)) !== c.principalCents) fail('SCHEDULE_MISMATCH', '全期本金须精确对平并按日期排序');
      const unknown = c.schedule.some(s => s.feeCents === null), knownFees = sum(c.schedule.map(s => s.feeCents || 0));
      if (c.feeCents === null ? !unknown : unknown || knownFees !== c.feeCents) fail('SCHEDULE_MISMATCH', '费用须精确对平，未知费用不能当作零');
      if ((c.purchaseTransactionId === null) !== (c.purchaseSignature === null) || c.purchaseSignature && (c.purchaseSignature.id !== c.purchaseTransactionId || c.purchaseSignature.type !== 'expense' || c.purchaseSignature.accountId !== c.accountId || c.purchaseSignature.amountCents !== c.principalCents)) fail('INVALID_PURCHASE', '原消费证据须与账户和完整本金一致');
      return c;
    }
    if (kind === 'repayment') { const r = { ...out, statementId: id(v.statementId), sourceKind: v.sourceKind, sourceId: id(v.sourceId), amountCents: amount(v.amountCents, true), sourceProof: proof(v.sourceProof) }; if (r.sourceKind !== r.sourceProof.sourceKind || r.sourceId !== r.sourceProof.sourceId) fail('INVALID_SOURCE', '还款引用与快照不一致'); return r; }
    if (kind === 'inclusion') return { ...out, statementId: id(v.statementId), contractId: id(v.contractId), installmentId: id(v.installmentId) };
    if (!['interest', 'handling', 'service'].includes(v.kind)) fail('INVALID_FEE_KIND', '费用类型须人工确认');
    const f = { ...out, transactionId: id(v.transactionId), kind: v.kind, statementId: nullable(v.statementId, id), contractId: nullable(v.contractId, id), note: text(v.note), transactionSignature: financial(v.transactionSignature) };
    if (f.transactionSignature.type !== 'expense' || f.transactionSignature.id !== f.transactionId) fail('INVALID_FEE', '费用须引用原有支出记录'); return f;
  }
  function by(collection) { return new Map(collection.map(x => [x.id, x])); }
  function graph(data) {
    const accounts = new Map(), bills = by(data.statements), contracts = by(data.contracts), paid = new Map(), sources = new Map(), included = new Map(), scheduled = new Set(), feeTx = new Set(), purchases = new Set();
    function credit(accountId) { if (accounts.get(accountId)?.role !== 'credit') fail('CREDIT_ROLE_REQUIRED', '须先明确确认该账户为信用负债账户'); }
    function add(map, key, n) { map.set(key, sum([map.get(key) || 0, n])); }
    for (const p of data.profiles) { if (accounts.has(p.accountId)) fail('DUPLICATE_PROFILE', '同一账户只能有一个角色记录'); accounts.set(p.accountId, p); }
    const official = new Map();
    for (const s of data.statements) { credit(s.accountId); if (s.provenance === 'official') { const list = official.get(s.accountId) || []; list.push(s); official.set(s.accountId, list); } }
    for (const list of official.values()) { list.sort((a, b) => a.periodStart.localeCompare(b.periodStart)); for (let i = 1; i < list.length; i++) if (list[i].periodStart <= list[i - 1].periodEnd) fail('STATEMENT_OVERLAP', '同账户正式账单账期不能重叠'); }
    let scheduleCount = 0;
    for (const c of data.contracts) { credit(c.accountId); scheduleCount += c.schedule.length; if (c.purchaseTransactionId) { if (purchases.has(c.purchaseTransactionId)) fail('PURCHASE_OVERLAP', '同一完整本金消费不能登记多个分期合同'); purchases.add(c.purchaseTransactionId); } }
    if (scheduleCount > LIMITS.totalSchedule) fail('OBLIGATION_LIMIT', '分期期次总数超过上限');
    for (const r of data.repayments) {
      const s = bills.get(r.statementId); if (!s || s.provenance !== 'official') fail('OFFICIAL_STATEMENT_REQUIRED', '还款分配须关联完整正式账单');
      if (s.accountId !== r.sourceProof.toAccountId) fail('WRONG_CREDIT_ACCOUNT', '还款转入账户与账单账户不同');
      const key = r.sourceKind + ':' + r.sourceId, source = sources.get(key); if (source && !same(source.proof, r.sourceProof)) fail('SOURCE_CHANGED', '同一转账的快照须一致');
      sources.set(key, { proof: r.sourceProof, allocated: sum([source?.allocated || 0, r.amountCents]) });
      if (sources.get(key).allocated > r.sourceProof.amountCents) fail('SOURCE_CAPACITY', '所有账单共享的还款分配不能超过原转账本金');
      add(paid, s.id, r.amountCents); if (paid.get(s.id) > s.amountCents) fail('STATEMENT_CAPACITY', '分配不能超过正式账单金额');
    }
    for (const i of data.inclusions) {
      const s = bills.get(i.statementId), c = contracts.get(i.contractId), item = c?.schedule.find(x => x.id === i.installmentId);
      if (!s || s.provenance !== 'official' || !c || !item || c.status !== 'active') fail('INVALID_INCLUSION', '入账关联须引用有效分期和正式账单');
      if (s.accountId !== c.accountId) fail('WRONG_CREDIT_ACCOUNT', '分期与账单账户不同');
      if (item.feeCents === null) fail('UNKNOWN_FEE', '费用未明确时不能确认整期已计入账单');
      const key = c.id + ':' + item.id; if (scheduled.has(key)) fail('INSTALLMENT_ALREADY_BILLED', '同一期只能计入一份账单'); scheduled.add(key);
      add(included, s.id, sum([item.principalCents, item.feeCents])); if (included.get(s.id) > s.amountCents) fail('INCLUSION_CAPACITY', '已关联分期总额不能超过正式账单金额');
    }
    for (const f of data.fees) {
      if (feeTx.has(f.transactionId) || purchases.has(f.transactionId)) fail('FEE_OVERLAP', '费用不能重复标注或重复占用本金消费'); feeTx.add(f.transactionId);
      if (f.statementId && (!bills.has(f.statementId) || bills.get(f.statementId).accountId !== f.transactionSignature.accountId)) fail('INVALID_REFERENCE', '费用账单引用无效');
      if (f.contractId && !contracts.has(f.contractId)) fail('INVALID_REFERENCE', '费用分期引用无效');
      if (f.statementId && f.contractId && bills.get(f.statementId).accountId !== contracts.get(f.contractId).accountId) fail('WRONG_CREDIT_ACCOUNT', '费用关联事项的账户不同');
    }
    // Bound every potentially exposed known component before accepting a state, even when fee totals are unknown.
    sum([...data.statements.filter(x => x.provenance === 'official').map(x => x.amountCents), ...data.contracts.filter(x => x.status === 'active').flatMap(x => [x.principalCents, ...x.schedule.map(i => i.feeCents || 0)])]);
    return { paid, included, sources };
  }
  function sourceCache(state, r) { return {transactions:new Map(state.transactions.map(t => [t.id,t])),shadows:new Set(r.links.map(x => x.shadowId)),pairs:new Map((r.transferPairs || []).map(x => [x.id,x]))}; }
  function currentSource(state, r, kind, sourceId, cache) {
    const {transactions,shadows,pairs} = cache || sourceCache(state,r);
    let legs;
    if (kind === 'native') { const t = transactions.get(id(sourceId)); if (!t || t.type !== 'transfer' || shadows.has(t.id)) fail('INVALID_SOURCE', '须选择有效主记录原生转账'); legs = [signature(t)]; }
    else if (kind === 'pair') { const p = pairs.get(id(sourceId)); if (!p) fail('INVALID_SOURCE', '已确认的双边转账不存在，请先补齐并确认双边证据'); legs = [signature(transactions.get(p.expenseId)), signature(transactions.get(p.incomeId))]; }
    else fail('INVALID_SOURCE', '普通收入或单边记录不能作为还款');
    return proof({ sourceKind: kind, sourceId, amountCents: legs[0].amountCents, fromAccountId: legs[0].accountId, toAccountId: kind === 'native' ? legs[0].toAccountId : legs[1].accountId, outgoingDate: legs[0].date, incomingDate: legs.at(-1).date, legs });
  }
  function validate(input, state) {
    const r = relations().validate(state.bookkeeping, state), accounts = new Set(state.accounts.map(x => x.id)), transactions = new Map(state.transactions.map(t => [t.id, t])), baseIds = new Set([...state.accounts, ...state.categories, ...state.transactions, ...state.trash].map(x => x.id));
    for (const collection of Object.values(r)) if (Array.isArray(collection)) for (const item of collection) if (item.id) baseIds.add(item.id);
    const v = input === undefined ? defaultState() : input;
    shape(v, ['version', 'revision', ...Object.values(COLLECTIONS), 'audit']); if (v.version !== VERSION) fail('INVALID_OBLIGATIONS_VERSION', '不支持此信用义务版本');
    const out = defaultState(); out.revision = integer(v.revision, 0, LIMITS.audit);
    const activeIds = new Set(); let cells = 0;
    function normalize(kind, value) { const result = row(kind, value); cells += 1 + (result.schedule?.length || 0); if (cells > LIMITS.snapshotCells) fail('OBLIGATION_LIMIT', '操作历史快照超过上限'); return result; }
    for (const [kind, collection] of Object.entries(COLLECTIONS)) out[collection] = array(v[collection], kind === 'profile' ? 100 : LIMITS.rows).map(value => { const result = normalize(kind, value); if (activeIds.has(result.id) || baseIds.has(result.id)) fail('DUPLICATE_ID', '记录标识重复'); activeIds.add(result.id); return result; });
    const replay = defaultState(), stores = Object.fromEntries(Object.keys(COLLECTIONS).map(k => [k, new Map()])), ever = new Set(), auditIds = new Set(), events = new Map();
    out.audit = array(v.audit, LIMITS.audit).map((value, n) => {
      shape(value, ['id', 'revision', 'at', 'kind', 'recordId', 'action', 'reason', 'before', 'after', 'reverses']);
      const a = { id: id(value.id), revision: integer(value.revision, 1, LIMITS.audit), at: timestamp(value.at), kind: value.kind, recordId: id(value.recordId), action: value.action, reason: text(value.reason, true), before: value.before === null ? null : normalize(value.kind, value.before), after: value.after === null ? null : normalize(value.kind, value.after), reverses: nullable(value.reverses, id) };
      if (!COLLECTIONS[a.kind] || !['create', 'update', 'remove', 'revert'].includes(a.action) || a.revision !== n + 1 || a.id === a.recordId || auditIds.has(a.id) || baseIds.has(a.id) || activeIds.has(a.id) || ever.has(a.id)) fail('INVALID_OBLIGATIONS_AUDIT', '操作历史顺序或标识无效');
      if (a.before?.id && a.before.id !== a.recordId || a.after?.id && a.after.id !== a.recordId || !same(stores[a.kind].get(a.recordId) || null, a.before)) fail('INVALID_OBLIGATIONS_AUDIT', '操作历史与修改前记录不符');
      if (a.action === 'create') { if (a.before || !a.after || ever.has(a.recordId) || auditIds.has(a.recordId) || baseIds.has(a.recordId) || a.after.createdAt !== a.at || a.reverses !== null) fail('INVALID_OBLIGATIONS_AUDIT', '创建历史无效'); ever.add(a.recordId); }
      else if (a.action === 'revert') { const source = events.get(a.reverses); if (!source || source.kind !== a.kind || source.recordId !== a.recordId || !same(source.after, a.before) || !same(source.before, a.after)) fail('INVALID_OBLIGATIONS_AUDIT', '撤销历史必须与原操作精确相反'); }
      else if (!a.before || a.reverses !== null || a.action === 'remove' && a.after || a.action === 'update' && (!a.after || !['profile', 'statement', 'contract'].includes(a.kind) || a.before.createdAt !== a.after.createdAt)) fail('INVALID_OBLIGATIONS_AUDIT', '修改或删除历史无效');
      if (a.before && a.after) guardUpdate(a.kind, a.before, a.after, replay);
      if (a.after) stores[a.kind].set(a.recordId, a.after); else stores[a.kind].delete(a.recordId);
      replay[COLLECTIONS[a.kind]] = [...stores[a.kind].values()]; graph(replay);
      auditIds.add(a.id); events.set(a.id, a); return a;
    });
    if (out.revision !== out.audit.length) fail('INVALID_OBLIGATIONS_AUDIT', '修订数与历史长度不一致');
    for (const [kind, collection] of Object.entries(COLLECTIONS)) { if (out[collection].length !== stores[kind].size || out[collection].some(x => !same(stores[kind].get(x.id), x))) fail('INVALID_OBLIGATIONS_AUDIT', '当前记录与完整历史不一致'); }
    graph(out);
    for (const p of out.profiles) if (!accounts.has(p.accountId)) fail('OBLIGATION_REFERENCED', '角色引用的账户不存在');
    const shadows = new Set(r.links.map(x => x.shadowId)), pairs = new Set((r.transferPairs || []).flatMap(x => [x.expenseId, x.incomeId])), composites = new Set((r.composites || []).flatMap(x => x.signatures.map(t => t.id)));
    function current(captured, expenseOnly) { const t = transactions.get(captured.id); if (!t || !same(signature(t), captured) || shadows.has(t.id) || expenseOnly && (pairs.has(t.id) || composites.has(t.id))) fail('OBLIGATION_REFERENCED', '交易已有信用义务引用，请先撤销引用后修改金额、日期、账户、重复关系或删除'); }
    const cachedSources = sourceCache(state,r);
    for (const payment of out.repayments) if (!same(currentSource(state, r, payment.sourceKind, payment.sourceId, cachedSources), payment.sourceProof)) fail('OBLIGATION_REFERENCED', '还款原始转账已变化，须先撤销分配');
    for (const c of out.contracts) if (c.purchaseSignature) current(c.purchaseSignature, true);
    for (const f of out.fees) current(f.transactionSignature, true);
    validateRoleRanges(state,out);
    return out;
  }
  function validateRoleRanges(state,data) {
    // Any valid saved state must remain renderable at every recorded day boundary.
    const roles = new Map(data.profiles.map(p => [p.accountId,p.role])), values = new Map(state.accounts.map(a => [a.id,BigInt(a.openingBalanceCents)]));
    const movements = relations().calculate(state).drilldown.accountFlows.slice().sort((a,b) => a.date.localeCompare(b.date));
    function check() { const groups = new Map(); let debt=0n,positive=0n; const safe = n => {if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER)) fail('AMOUNT_OVERFLOW','按日期与账户角色分组的记录余额过大，无法安全显示');}; for (const [key,value] of values) {safe(value);const role=roles.get(key)||'unknown';groups.set(role,(groups.get(role)||0n)+value);if(role==='credit'){if(value<0n)debt-=value;else positive+=value;}} for(const value of groups.values())safe(value);safe(debt);safe(positive); }
    check(); for(let i=0;i<movements.length;i++){for(const leg of movements[i].movements)values.set(leg.accountId,values.get(leg.accountId)+BigInt(leg.signedCents));if(i===movements.length-1||movements[i+1].date!==movements[i].date)check();}
  }
  function guardUpdate(kind, before, after, data) {
    if (kind === 'profile' && before.accountId !== after.accountId || kind === 'statement' && before.accountId !== after.accountId || kind === 'contract' && (before.accountId !== after.accountId || before.purchaseTransactionId !== after.purchaseTransactionId || !same(before.purchaseSignature, after.purchaseSignature))) fail('IMMUTABLE_REFERENCE', '账户与原始证据不能原地更换，请撤销后重新登记');
    if (kind === 'contract') for (const inclusion of data.inclusions.filter(x => x.contractId === before.id)) if (!same(before.schedule.find(x => x.id === inclusion.installmentId), after.schedule.find(x => x.id === inclusion.installmentId))) fail('OBLIGATION_REFERENCED', '已入账期次须先撤销入账关联后修改');
  }
  function review(value, revision) { shape(value, ['confirmed', 'expectedRevision', 'reason']); if (value.confirmed !== true) fail('CONFIRMATION_REQUIRED', '请核对后明确确认'); if (integer(value.expectedRevision, 0, LIMITS.audit) !== revision) fail('STALE_REVIEW', '记录已变化，请刷新并重新核对'); return text(value.reason, true); }
  function normalized(state) { const data = validate(state.obligations, state), next = clone(state); next.obligations = data; next.version = LEDGER_VERSION; return next; }
  function newId(state, prefix) { const used = new Set([...state.accounts, ...state.categories, ...state.transactions, ...state.trash].map(x => x.id)); for (const section of [state.bookkeeping, state.organizer, state.obligations]) if (section) for (const value of Object.values(section)) if (Array.isArray(value)) for (const x of value) { if (x.id) used.add(x.id); if (x.recordId) used.add(x.recordId); } for (let n = 0; n < 10; n++) { const candidate = 'obl-' + prefix + '-' + Date.now().toString(36) + '-' + (++sequence).toString(36); if (!used.has(candidate)) return candidate; } fail('ID_FAILURE', '无法生成标识'); }
  function change(state, kind, before, after, action, confirmation, reverses = null) {
    const next = normalized(state), data = next.obligations, why = review(confirmation, data.revision), collection = COLLECTIONS[kind]; if (!collection) fail('INVALID_OBLIGATION_KIND', '记录种类无效');
    if (data.revision >= LIMITS.audit) fail('OBLIGATION_LIMIT', '操作历史已达上限');
    if (before && after) guardUpdate(kind, before, after, data);
    const target = before?.id || after.id, index = data[collection].findIndex(x => x.id === target); if (!same(index < 0 ? null : data[collection][index], before)) fail('STALE_REVIEW', '记录已变化');
    if (after) { if (index < 0) data[collection].push(after); else data[collection][index] = after; } else data[collection].splice(index, 1);
    data.revision++; data.audit.push({ id: newId(next, 'audit'), revision: data.revision, at: action === 'create' ? after.createdAt : new Date().toISOString(), kind, recordId: target, action, reason: why, before: before && clone(before), after: after && clone(after), reverses });
    next.obligations = validate(data, next); return next;
  }
  function put(state, kind, input, confirmation, recordId) {
    shape(input, FIELDS[kind]); const next = normalized(state); review(confirmation, next.obligations.revision);
    const before = recordId === undefined ? null : next.obligations[COLLECTIONS[kind]].find(x => x.id === id(recordId)); if (recordId !== undefined && !before) fail('NOT_FOUND', '要修改的记录不存在');
    let fields = { ...input };
    if (kind === 'contract') { const purchase = input.purchaseTransactionId === null ? null : state.transactions.find(t => t.id === id(input.purchaseTransactionId)); if (input.purchaseTransactionId !== null && !purchase) fail('NOT_FOUND', '原始消费不存在'); fields.purchaseSignature = purchase ? signature(purchase) : null; }
    if (kind === 'repayment') fields.sourceProof = currentSource(state, relations().validate(state.bookkeeping, state), input.sourceKind, input.sourceId);
    if (kind === 'fee') { const transaction = state.transactions.find(t => t.id === id(input.transactionId)); if (!transaction) fail('NOT_FOUND', '费用原始交易不存在'); fields.transactionSignature = signature(transaction); }
    const after = row(kind, { id: before?.id || newId(next, kind), createdAt: before?.createdAt || new Date().toISOString(), ...fields });
    return change(next, kind, before, after, before ? 'update' : 'create', confirmation);
  }
  function putProfile(s, v, r, key) { return put(s, 'profile', v, r, key); }
  function putStatement(s, v, r, key) { return put(s, 'statement', v, r, key); }
  function putContract(s, v, r, key) { return put(s, 'contract', v, r, key); }
  function allocateRepayment(s, v, r) { return put(s, 'repayment', v, r); }
  function includeInstallment(s, v, r) { return put(s, 'inclusion', v, r); }
  function markFee(s, v, r) { return put(s, 'fee', v, r); }
  function remove(s, kind, key, confirmation) { if (!COLLECTIONS[kind]) fail('INVALID_OBLIGATION_KIND', '记录种类无效'); const data = validate(s.obligations, s), before = data[COLLECTIONS[kind]].find(x => x.id === id(key)); if (!before) fail('NOT_FOUND', '记录不存在'); return change(s, kind, before, null, 'remove', confirmation); }
  function revert(s, auditId, confirmation) { const data = validate(s.obligations, s), event = data.audit.find(x => x.id === id(auditId)); if (!event) fail('NOT_FOUND', '历史操作不存在'); return change(s, event.kind, event.after, event.before, 'revert', confirmation, event.id); }
  function dependencies(s, transactionId) { const data = validate(s.obligations, s), key = id(transactionId), out = []; for (const p of data.repayments) if (p.sourceProof.legs.some(x => x.id === key)) out.push({ kind: 'creditRepayment', id: p.id }); for (const c of data.contracts) if (c.purchaseTransactionId === key) out.push({ kind: 'installmentPurchase', id: c.id }); for (const f of data.fees) if (f.transactionId === key) out.push({ kind: 'feeEvidence', id: f.id }); return out; }
  function assertRelationChange(before, after) { if (before.obligations !== undefined) validate(before.obligations, before); if (after.obligations !== undefined) validate(after.obligations, after); return after; }
  function splitSchedule(input) { shape(input, ['principalCents', 'feeCents', 'dates']); const principal = amount(input.principalCents, true), fee = nullable(input.feeCents, amount), dates = array(input.dates, LIMITS.schedule).map(date); if (!dates.length || dates.some((d, i) => i && d < dates[i - 1])) fail('INVALID_DATE_ORDER', '分期日期须完整并排序'); const share = (total, i) => Math.floor(total / dates.length) + (i < total % dates.length ? 1 : 0); const result = dates.map((d, i) => ({ id: 'installment-' + (i + 1), dueDate: d, principalCents: share(principal, i), feeCents: fee === null ? null : share(fee, i) })); if (result.some(x => x.principalCents === 0 && x.feeCents === 0)) fail('INVALID_AMOUNT', '金额不足以生成所选期数的非零期次，请减少期数或手动填写真实计划'); return result; }
  function view(state, options) {
    shape(options, ['asOf']); const asOf = date(options.asOf), data = validate(state.obligations, state), g = graph(data), actual = relations().calculate(state), profileByAccount = new Map(data.profiles.map(p => [p.accountId, p])), inclusionByItem = new Map(data.inclusions.map(x => [x.contractId + ':' + x.installmentId, x])), uncertainty = [];
    const profiles = state.accounts.map(a => { const p = profileByAccount.get(a.id); if (!p) uncertainty.push({ kind: 'unknown-role', accountId: a.id }); return { accountId: a.id, name: a.name, profileId: p?.id || null, role: p?.role || 'unknown', creditLimitCents: p?.creditLimitCents ?? null, limitScope: 'informational-not-cash-or-assets' }; });
    const received = new Map(); for (const p of data.repayments) if (p.sourceProof.incomingDate <= asOf) received.set(p.statementId, sum([received.get(p.statementId) || 0, p.amountCents]));
    const statements = data.statements.map(s => { const allocatedCents = received.get(s.id) || 0, allRecordedAllocatedCents = g.paid.get(s.id) || 0, outstandingCents = s.amountCents === null ? null : s.amountCents - allocatedCents; if (s.provenance !== 'official') uncertainty.push({ kind: 'estimated-statement', statementId: s.id }); return { ...clone(s), allocatedCents, allRecordedAllocatedCents, pendingArrivalAllocatedCents: allRecordedAllocatedCents - allocatedCents, outstandingCents, includedInstallmentCents: g.included.get(s.id) || 0, coverageStatus: s.provenance !== 'official' ? 'unknown' : outstandingCents === 0 ? 'locally-covered' : allocatedCents ? 'partial' : 'unallocated', verifiedRepaid: false, overdue: s.dueDate === null || outstandingCents === null ? null : s.dueDate < asOf && outstandingCents > 0, excludedFromForecast: s.provenance !== 'official' }; });
    const forecast = statements.filter(s => !s.excludedFromForecast && s.outstandingCents > 0).map(s => ({ kind: 'statement', statementId: s.id, accountId: s.accountId, dueDate: s.dueDate, amountCents: s.outstandingCents, knownMinimumCents: s.outstandingCents, provenance: 'official-local', completeness: 'unknown' }));
    const contracts = data.contracts.map(c => {
      if (c.source === null) uncertainty.push({ kind: 'missing-contract-source', contractId: c.id }); if (c.purchaseTransactionId === null) uncertainty.push({ kind: 'missing-purchase-evidence', contractId: c.id });
      const schedule = c.schedule.map(item => { const inclusion = inclusionByItem.get(c.id + ':' + item.id), amountCents = item.feeCents === null ? null : sum([item.principalCents, item.feeCents]), forecastStatus = c.status === 'cancelled' ? 'cancelled' : inclusion ? 'billed' : 'unbilled'; if (item.feeCents === null && c.status === 'active') uncertainty.push({ kind: 'unknown-fee', contractId: c.id, installmentId: item.id }); if (forecastStatus === 'unbilled') forecast.push({ kind: 'installment', contractId: c.id, installmentId: item.id, accountId: c.accountId, dueDate: item.dueDate, amountCents, knownMinimumCents: item.principalCents + (item.feeCents || 0), provenance: 'user-commitment', completeness: item.feeCents === null ? 'unknown-fees' : 'user-entered' }); return { ...item, amountCents, inclusionId: inclusion?.id || null, statementId: inclusion?.statementId || null, forecastStatus }; });
      const unbilled = schedule.filter(x => x.forecastStatus === 'unbilled'); return { ...clone(c), schedule, unbilledPrincipalCents: sum(unbilled.map(x => x.principalCents)), unbilledKnownFeeCents: sum(unbilled.map(x => x.feeCents || 0)), unknownFeeInstallments: unbilled.filter(x => x.feeCents === null).length };
    });
    const relationData = relations().validate(state.bookkeeping,state), cachedSources = sourceCache(state,relationData), repaymentSources = [];
    for (const [kind,sourceId] of [...state.transactions.filter(t => t.type === 'transfer' && !cachedSources.shadows.has(t.id)).map(t => ['native',t.id]), ...(relationData.transferPairs || []).map(p => ['pair',p.id])]) { const captured = currentSource(state,relationData,kind,sourceId,cachedSources); if (profileByAccount.get(captured.toAccountId)?.role !== 'credit') continue; const allocatedCents = g.sources.get(kind+':'+sourceId)?.allocated || 0; repaymentSources.push({...captured,allocatedCents,unallocatedCents:captured.amountCents-allocatedCents,receiptStatus:captured.incomingDate <= asOf ? 'recorded-received' : 'recorded-future-arrival',classification:'real-movement-unallocated-is-not-new-money'}); }
    const repayments = data.repayments.map(p => { const source = g.sources.get(p.sourceKind + ':' + p.sourceId); return { ...clone(p), outgoingDate: p.sourceProof.outgoingDate, incomingDate: p.sourceProof.incomingDate, receiptStatus: p.sourceProof.incomingDate <= asOf ? 'recorded-received' : 'recorded-future-arrival', sourceAllocatedCents: source.allocated, sourceUnallocatedCents: source.proof.amountCents - source.allocated }; });
    const fees = data.fees.map(f => ({ ...clone(f), recordedAmountCents: f.transactionSignature.amountCents, personalExpenseCents: actual.impacts[f.transactionId].personalExpenseCents, date: f.transactionSignature.date, expenseScope: 'existing-relations-impact-only' }));
    const unbilledEvidence = profiles.filter(p => p.role === 'credit').map(p => { const official = statements.filter(s => s.accountId === p.accountId && s.provenance === 'official').sort((a, b) => b.periodEnd.localeCompare(a.periodEnd)), boundary = official[0]?.periodEnd || null; if (boundary === null) uncertainty.push({ kind: 'missing-official-statement', accountId: p.accountId }); const rows = state.transactions.filter(t => t.accountId === p.accountId && t.type === 'expense' && !actual.impacts[t.id].excluded && actual.impacts[t.id].fundingAuthority !== false && !actual.impacts[t.id].transferPairId && (boundary === null || t.date > boundary)).map(t => ({ transactionId: t.id, date: t.date, recordedAmountCents: t.amountCents, personalExpenseCents: actual.impacts[t.id].personalExpenseCents, contractId: data.contracts.find(c => c.purchaseTransactionId === t.id)?.id || null })); return { accountId: p.accountId, classification: boundary === null ? 'unknown' : 'after-latest-statement-period', afterDate: boundary, rows, recordedAmountCents: sum(rows.map(t => t.recordedAmountCents)), excludedFromForecast: true }; });
    uncertainty.push({ kind: 'source-coverage-and-freshness-unknown', message: '本地证据不证明银行最新到账、全部账单或完整历史；不能据此确认已核实还清。' });
    const forecastOverlapReasons = [];
    for (const profile of profiles.filter(p => p.role === 'credit')) {
      const official = statements.filter(s => s.accountId === profile.accountId && s.provenance === 'official' && s.amountCents > 0), openBills = official.filter(s => s.outstandingCents > 0), unbilled = forecast.filter(x => x.kind === 'installment' && x.accountId === profile.accountId);
      if (openBills.length > 1) forecastOverlapReasons.push({ kind: 'statement-carryover-unknown', accountId: profile.accountId, statementIds: openBills.map(s => s.id) });
      if (official.length && unbilled.length) { forecastOverlapReasons.push({ kind: 'installment-billing-inclusion-unknown', accountId: profile.accountId, statementIds: official.map(s => s.id), installmentRefs: unbilled.map(x => ({contractId:x.contractId, installmentId:x.installmentId})) }); for (const item of unbilled) item.billingOverlapStatus = 'possibly-already-billed-or-covered'; }
    }
    uncertainty.push(...forecastOverlapReasons);
    const roleAwareActuals = roleActuals(state, profiles, actual, asOf), blocked = forecastOverlapReasons.length > 0;
    forecast.sort((a, b) => (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31') || (a.statementId || a.contractId).localeCompare(b.statementId || b.contractId));
    return { revision: data.revision, asOf, asOfScope: 'incoming-repayment-date-and-role-movements-and-overdue-check; other-metadata-is-current', profiles, statements, contracts, repayments, repaymentSources, fees, unbilledEvidence, forecast, forecastOverlapStatus: blocked ? 'possible' : 'not-detected', forecastOverlapReasons, forecastKnownMinimumCents: blocked ? null : sum(forecast.map(x => x.knownMinimumCents)), forecastAmountCents: blocked || forecast.some(x => x.amountCents === null) ? null : sum(forecast.map(x => x.amountCents)), forecastComplete: false, roleAwareActuals, freshness: {overallCoverage:'unknown',overallFreshness:'unknown',latestRecordedTransactionDate:state.transactions.map(t => t.date).sort().at(-1) || null,sourceCoverage:Array.isArray(state.imports?.coverage) ? state.imports.coverage.map(c => ({id:c.id,sourceKey:c.sourceKey,accountId:c.accountId,start:c.start,end:c.end,confirmed:c.confirmed})) : [],snapshots:relationData.snapshots.map(s => ({id:s.id,accountId:s.accountId,date:s.date,actualBalanceCents:s.actualBalanceCents,recordedLedgerBalanceCents:s.ledgerBalanceCents}))}, uncertainty, actualsUnchanged: true };
  }
  function roleActuals(state, profiles, actual, asOf) {
    const accounts = new Map(state.accounts.map(a => [a.id, {accountId:a.id,name:a.name,role:profiles.find(p => p.accountId === a.id).role,openingBalanceCents:a.openingBalanceCents,recordedBalanceCents:a.openingBalanceCents,inflowCents:0,outflowCents:0,netCents:0}]));
    for (const row of actual.drilldown.accountFlows) if (row.date <= asOf) for (const movement of row.movements) { const a = accounts.get(movement.accountId); a.recordedBalanceCents = sum([a.recordedBalanceCents,movement.signedCents]); a.netCents = sum([a.netCents,movement.signedCents]); if (movement.signedCents > 0) a.inflowCents = sum([a.inflowCents,movement.signedCents]); else a.outflowCents = sum([a.outflowCents,-movement.signedCents]); }
    const groups = {}; for (const role of ['cash','credit','restricted','other','unknown']) { const rows = [...accounts.values()].filter(a => a.role === role); groups[role] = {accounts:rows,balanceCents:sum(rows.map(a => a.recordedBalanceCents)),inflowCents:sum(rows.map(a => a.inflowCents)),outflowCents:sum(rows.map(a => a.outflowCents)),netCents:sum(rows.map(a => a.netCents))}; }
    return {asOf,balanceBasis:'opening-plus-canonical-recorded-movements-through-asOf',source:'Relations.accountFlows',legacyCashScope:'all-account-external-record-flows-not-liquid-cash',rolesComplete:groups.unknown.accounts.length===0,coverageComplete:false,knownCashBalanceCents:groups.cash.balanceCents,liquidBalanceCents:groups.unknown.accounts.length ? null : groups.cash.balanceCents,recordedCreditDebtCents:sum(groups.credit.accounts.map(a => Math.max(0,-a.recordedBalanceCents))),recordedCreditPositiveBalanceCents:sum(groups.credit.accounts.map(a => Math.max(0,a.recordedBalanceCents))),groups};
  }
  return Object.freeze({ VERSION, LEDGER_VERSION, MAX_AMOUNT_CENTS, LIMITS, COLLECTIONS, FIELDS, ObligationsError, defaultState, validate, putProfile, putStatement, putContract, allocateRepayment, includeInstallment, markFee, remove, revert, dependencies, assertRelationChange, splitSchedule, view });
}));
