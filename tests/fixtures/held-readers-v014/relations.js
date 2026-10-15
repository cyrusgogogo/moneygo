/* Deterministic local bookkeeping relationships. CNY integer cents, no network. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoneygoRelations = api;
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const VERSION = 2, COMPOSITE_VERSION = 3;
  const compositeTickets = new WeakMap();
  const MAX_AMOUNT_CENTS = 999999999999;
  const LIMITS = Object.freeze({ rows: 10000, audit: 50000, snapshots: 100, candidates: 100, name: 80, note: 500, id: 100, composites: 1000, compositeMembers: 20, compositeCells: 100000, candidatePool: 24, candidateNodes: 10000 });
  const COLLECTIONS = Object.freeze({ link: 'links', refund: 'refunds', claim: 'claims', settlement: 'settlements', snapshot: 'snapshots', refundPlan: 'refundPlans', transferPair: 'transferPairs', composite: 'composites' });
  const ASSUMPTIONS = Object.freeze([
    '收支与账户余额按真实交易日期计算，账户间转账不计入个人消费。',
    '转账汇总本金仅按转出日期计一次；现金收支排除内部转移，实际账户流入流出另列，跨日到账不提前入账。',
    '本人账户双边记录须人工确认；缺少一边保持未知，不自动造账；手续费与后续现金消费单独记支出。',
    '退款按原购买月份重算个人消费；后续到账可改变历史月份的个人消费。',
    '报销与垫付应收不等于到账现金；待退款计划不影响任何收支或余额。',
    '期初余额假设位于所有已录入交易之前；对账为用户输入日期的日终余额。',
    '本地记录与用户输入的快照不代表支付平台或银行实时余额，也不证明数据覆盖完整。'
  ]);
  class RelationsError extends Error {
    constructor(code, message) { super(message); this.name = 'RelationsError'; this.code = code; }
  }
  function fail(code, message) { throw new RelationsError(code, message); }
  function personalEventEngine() {
    const engine = typeof module === 'object' && module.exports ? require('./personal-events.js') : root.MoneygoPersonalEvents;
    if (!engine) fail('PERSONAL_EVENTS_UNAVAILABLE', '个人收支投影模块未加载，请刷新后重试');
    return engine;
  }
  // Direct financial-only callers need not provide valid classification data.
  // Copy an own-data raw identifier only; never coerce or inspect nested values.
  function personalCategory(row) {
    if (row.type === 'transfer') return null;
    const descriptor = Object.getOwnPropertyDescriptor(row, 'categoryId');
    const value = descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value') ? descriptor.value : null;
    return typeof value === 'string' && value.length <= LIMITS.id &&
      /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) && value !== 'constructor' && value !== 'prototype' ? value : null;
  }
  function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_RELATIONS', label + '格式无效');
    const proto = Object.getPrototypeOf(value); if (proto !== null && Object.getPrototypeOf(proto) !== null) fail('INVALID_RELATIONS', label + '不能继承记录字段');
    for (const key of Reflect.ownKeys(value)) { const d = Object.getOwnPropertyDescriptor(value, key); if (typeof key !== 'string' || !d.enumerable || !Object.prototype.hasOwnProperty.call(d, 'value')) fail('INVALID_RELATIONS', label + '字段必须为普通数据'); }
    return value;
  }
  function shape(value, keys, label) {
    object(value, label);
    if (Object.keys(value).some(key => !keys.includes(key))) fail('INVALID_RELATIONS', label + '含未知字段');
    return value;
  }
  function array(value, max, label) {
    if (!Array.isArray(value) || value.length > max) fail('RELATION_LIMIT', label + '数量或格式无效');
    const proto = Object.getPrototypeOf(value); if (!proto || !Array.isArray(proto) || !Object.getPrototypeOf(proto) || Object.getPrototypeOf(Object.getPrototypeOf(proto)) !== null) fail('INVALID_RELATIONS', label + '数组原型无效');
    for (let i = 0; i < value.length; i++) { const d = Object.getOwnPropertyDescriptor(value, String(i)); if (!d || !d.enumerable || !Object.prototype.hasOwnProperty.call(d, 'value')) fail('INVALID_RELATIONS', label + '含空记录或非普通数据'); }
    if (Reflect.ownKeys(value).length !== value.length + 1) fail('INVALID_RELATIONS', label + '数组含未知属性');
    return value;
  }
  function id(value) {
    if (typeof value !== 'string' || value.length > LIMITS.id || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) || value === 'constructor' || value === 'prototype') fail('INVALID_ID', '关联标识无效');
    return value;
  }
  function text(value, max, label, empty) {
    if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail('INVALID_RELATIONS', label + '无效或过长');
    return value;
  }
  function note(value) { return text(value === undefined ? '' : value, LIMITS.note, '备注', true); }
  function reason(value) { return text(value, LIMITS.note, '操作原因', false).trim(); }
  function name(value) { const result = text(value, LIMITS.name, '名称', false).trim(); if (/[\u0000-\u001f\u007f]/.test(value)) fail('INVALID_RELATIONS', '名称不能含控制字符'); return result; }
  function integer(value, min, max, code) { if (!Number.isSafeInteger(value) || value < min || value > max) fail(code || 'INVALID_RELATIONS', '整数值无效'); return value === 0 ? 0 : value; }
  function amount(value, signed, zero) { return integer(value, signed ? -MAX_AMOUNT_CENTS : zero ? 0 : 1, MAX_AMOUNT_CENTS, 'INVALID_AMOUNT'); }
  function safe(value) { if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) fail('AMOUNT_OVERFLOW', '累计金额过大，无法安全计算'); return Number(value); }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const y = +value.slice(0, 4), m = +value.slice(5, 7), d = +value.slice(8, 10);
    return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }
  function date(value) { if (!validDate(value)) fail('INVALID_DATE', '日期无效'); return value; }
  function timestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !validDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('INVALID_DATE', '关联时间无效');
    return value;
  }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }
  function same(a, b) { return canonical(a) === canonical(b); }
  function defaultState() { return { version: VERSION, revision: 0, links: [], refunds: [], claims: [], settlements: [], snapshots: [], refundPlans: [], transferPairs: [], audit: [] }; }
  // Financial signatures intentionally omit descriptions and classification. Canonical notes survive evidence association.
  function signature(value) {
    return { type: value.type, date: value.date, amountCents: value.amountCents, accountId: value.accountId, toAccountId: value.type === 'transfer' ? value.toAccountId : null };
  }
  function financial(value, withId) {
    shape(value, (withId ? ['id'] : []).concat(['type', 'date', 'amountCents', 'accountId', 'toAccountId']), '资金快照');
    if (!['income', 'expense', 'transfer'].includes(value.type)) fail('INVALID_TYPE', '资金快照类型无效');
    const row = { type: value.type, date: date(value.date), amountCents: amount(value.amountCents), accountId: id(value.accountId), toAccountId: value.type === 'transfer' ? id(value.toAccountId) : null };
    if (value.type !== 'transfer' && value.toAccountId !== null) fail('INVALID_REFERENCE', '收支不能包含转入账户');
    if (value.type === 'transfer' && row.accountId === row.toAccountId) fail('SAME_ACCOUNT', '转出转入账户不能相同');
    return withId ? { id: id(value.id), ...row } : row;
  }
  function compositeIds(value) {
    const result = array(value, LIMITS.compositeMembers, '组合来源').map(id);
    if (!result.length || new Set(result).size !== result.length) fail('INVALID_COMPOSITE', '每个口径须明确选择非空且不重复的来源');
    return result;
  }
  function compositeProof(value) {
    shape(value, ['id', 'createdAt', 'name', 'personalIds', 'fundingIds', 'paidCents', 'grossCents', 'discountCents', 'reason', 'signatures'], '组合证据');
    const row = { id: id(value.id), createdAt: timestamp(value.createdAt), name: name(value.name), personalIds: compositeIds(value.personalIds), fundingIds: compositeIds(value.fundingIds), paidCents: amount(value.paidCents), grossCents: value.grossCents === null ? null : amount(value.grossCents, false, true), discountCents: value.discountCents === null ? null : amount(value.discountCents, false, true), reason: reason(value.reason), signatures: array(value.signatures, LIMITS.compositeMembers * 2, '组合签名').map(v => financial(v, true)) };
    const union = new Set([...row.personalIds, ...row.fundingIds]), signatures = new Map(row.signatures.map(v => [v.id, v]));
    if (union.has(row.id) || signatures.size !== row.signatures.length || signatures.size !== union.size || row.signatures.some(v => !union.has(v.id) || v.type !== 'expense' || union.has(v.accountId) || row.id === v.accountId)) fail('INVALID_COMPOSITE', '组合来源与完整支出签名不一致');
    for (const ids of [row.personalIds, row.fundingIds]) if (ids.reduce((n, key) => n + BigInt(signatures.get(key).amountCents), 0n) !== BigInt(row.paidCents)) fail('COMPOSITE_MISMATCH', '消费证据、资金证据与实付金额必须各自精确相等，不补差额');
    if (row.grossCents !== null && row.grossCents < row.paidCents || row.grossCents !== null && row.discountCents !== null && row.grossCents - row.discountCents !== row.paidCents) fail('PRICE_MISMATCH', '原价、优惠与实付矛盾');
    return row;
  }
  function compositeContext(extension) {
    const result = new Map();
    for (const row of extension.composites || []) { const personal = new Set(row.personalIds), funding = new Set(row.fundingIds); for (const sig of row.signatures) result.set(sig.id, { row, personal: personal.has(sig.id), funding: funding.has(sig.id) }); }
    return result;
  }
  function frozen(value) { if (value && typeof value === 'object') { Object.freeze(value); Object.values(value).forEach(frozen); } return value; }
  // This is a one-way dependency: validate never calls Ledger or an importer/scenario validator.
  function baseIndex(state) {
    object(state, '账本');
    if (state.currency !== 'CNY') fail('INVALID_CURRENCY', '当前关联仅支持人民币 CNY');
    const accounts = new Map(), transactions = new Map(), used = new Set();
    for (const value of array(state.accounts, 100, '账户')) {
      object(value, '账户'); const key = id(value.id);
      if (used.has(key)) fail('DUPLICATE_ID', '账本标识重复'); used.add(key);
      accounts.set(key, { id: key, openingBalanceCents: amount(value.openingBalanceCents, true, true) });
    }
    if (!accounts.size) fail('LAST_ACCOUNT', '至少需要一个账户');
    if (state.categories !== undefined) for (const value of array(state.categories, 200, '分类')) {
      object(value, '分类'); const key = id(value.id); if (used.has(key)) fail('DUPLICATE_ID', '账本标识重复'); used.add(key);
    }
    for (const value of array(state.transactions, LIMITS.rows, '交易')) {
      object(value, '交易'); const row = financial({ id: value.id, ...signature(value) }, true);
      if (used.has(row.id)) fail('DUPLICATE_ID', '账本标识重复'); used.add(row.id);
      if (!accounts.has(row.accountId) || (row.toAccountId && !accounts.has(row.toAccountId))) fail('INVALID_REFERENCE', '资金账户不存在');
      transactions.set(row.id, { ...value, ...row });
    }
    if (state.trash !== undefined) for (const value of array(state.trash, LIMITS.rows, '已删除交易')) {
      object(value, '已删除交易'); const key = id(value.id); if (used.has(key)) fail('DUPLICATE_ID', '账本标识重复'); used.add(key);
    }
    return { accounts, transactions, used };
  }
  function basisValue(value) {
    shape(value, ['openingBalanceCents', 'transactions', 'excluded', 'composites'], '对账依据');
    const rows = array(value.transactions, LIMITS.rows, '对账交易').map(v => financial(v, true));
    const seen = new Set(); for (const row of rows) { if (seen.has(row.id)) fail('DUPLICATE_ID', '对账交易重复'); seen.add(row.id); }
    const excluded = array(value.excluded, LIMITS.rows, '排除证据').map(v => { shape(v, ['shadowId', 'primaryId'], '排除证据'); return { shadowId: id(v.shadowId), primaryId: id(v.primaryId) }; });
    const shadows = new Set(); for (const row of excluded) { if (shadows.has(row.shadowId) || row.primaryId === row.shadowId || seen.has(row.shadowId)) fail('INVALID_RELATIONS', '对账排除证据重复'); shadows.add(row.shadowId); }
    return { openingBalanceCents: amount(value.openingBalanceCents, true, true), transactions: rows, excluded, ...(value.composites === undefined ? {} : { composites: array(value.composites, LIMITS.composites, '对账组合').map(compositeProof) }) }; 
  }
  function normalizeRow(kind, value) {
    if (kind === 'composite') return compositeProof(value);
    const common = ['id', 'createdAt'];
    const fields = {
      link: ['primaryId', 'shadowId', 'reason', 'primarySignature', 'shadowSignature'],
      refund: ['incomeId', 'expenseId', 'amountCents', 'reason', 'planId', 'incomeSignature', 'expenseSignature'],
      claim: ['expenseId', 'amountCents', 'kind', 'name', 'dueDate', 'status', 'note', 'expenseSignature'],
      settlement: ['incomeId', 'claimId', 'amountCents', 'reason', 'expenseId', 'incomeSignature', 'expenseSignature'],
      snapshot: ['accountId', 'date', 'actualBalanceCents', 'note', 'ledgerBalanceCents', 'basis'],
      refundPlan: ['expenseId', 'expectedAmountCents', 'dueDate', 'status', 'note', 'expenseSignature'],
      transferPair: ['expenseId', 'incomeId', 'amountCents', 'reason', 'expenseSignature', 'incomeSignature']
    };
    if (!COLLECTIONS[kind]) fail('INVALID_RELATION_KIND', '关联种类无效');
    shape(value, common.concat(fields[kind]), '关联记录');
    const row = { id: id(value.id), createdAt: timestamp(value.createdAt) };
    if (kind === 'transferPair') {
      const pair = { ...row, expenseId: id(value.expenseId), incomeId: id(value.incomeId), amountCents: amount(value.amountCents), reason: reason(value.reason), expenseSignature: financial(value.expenseSignature), incomeSignature: financial(value.incomeSignature) };
      if (pair.expenseId === pair.incomeId || pair.expenseSignature.type !== 'expense' || pair.incomeSignature.type !== 'income' || pair.expenseSignature.accountId === pair.incomeSignature.accountId || pair.expenseSignature.amountCents !== pair.amountCents || pair.incomeSignature.amountCents !== pair.amountCents) fail('TRANSFER_PAIR_MISMATCH', '本人账户转账须为不同账户的等额正数支出与收入，手续费须单列');
      return pair;
    }
    if (kind === 'link') {
      const linked = { ...row, primaryId: id(value.primaryId), shadowId: id(value.shadowId), reason: reason(value.reason), primarySignature: financial(value.primarySignature), shadowSignature: financial(value.shadowSignature) };
      if (linked.primaryId === linked.shadowId) fail('RELATION_OVERLAP', '证据不能自关联');
      if (!sameMovement(linked.primarySignature, linked.shadowSignature)) fail('RELATION_MISMATCH', '重复证据的金额、方向与资金账户必须相同');
      return linked;
    }
    if (kind === 'refund') return allocationProof({ ...row, incomeId: id(value.incomeId), expenseId: id(value.expenseId), amountCents: amount(value.amountCents), reason: reason(value.reason), planId: value.planId === null ? null : id(value.planId), incomeSignature: financial(value.incomeSignature), expenseSignature: financial(value.expenseSignature) });
    if (kind === 'settlement') return allocationProof({ ...row, incomeId: id(value.incomeId), claimId: id(value.claimId), amountCents: amount(value.amountCents), reason: reason(value.reason), expenseId: id(value.expenseId), incomeSignature: financial(value.incomeSignature), expenseSignature: financial(value.expenseSignature) });
    if (kind === 'claim') {
      if (!['reimbursement', 'advance'].includes(value.kind) || !['unsubmitted', 'incomplete', 'submitted'].includes(value.status)) fail('INVALID_RELATION_STATUS', '应收类型或提交状态无效');
      return expenseProof({ ...row, expenseId: id(value.expenseId), amountCents: amount(value.amountCents), kind: value.kind, name: name(value.name), dueDate: value.dueDate === null ? null : date(value.dueDate), status: value.status, note: note(value.note), expenseSignature: financial(value.expenseSignature) }, false);
    }
    if (kind === 'refundPlan') {
      if (!['waiting', 'cancelled', 'closed'].includes(value.status)) fail('INVALID_RELATION_STATUS', '待退款状态无效');
      return expenseProof({ ...row, expenseId: id(value.expenseId), expectedAmountCents: amount(value.expectedAmountCents), dueDate: value.dueDate === null ? null : date(value.dueDate), status: value.status, note: note(value.note), expenseSignature: financial(value.expenseSignature) }, true);
    }
    const snapshot = { ...row, accountId: id(value.accountId), date: date(value.date), actualBalanceCents: amount(value.actualBalanceCents, true, true), note: note(value.note), ledgerBalanceCents: integer(value.ledgerBalanceCents, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'INVALID_AMOUNT'), basis: basisValue(value.basis) };
    if ((snapshot.basis.composites || []).some(p => p.id === snapshot.id || p.signatures.some(t => t.id === snapshot.id))) fail('INVALID_RELATIONS', '对账快照标识不能与组合或来源重复');
    if (basisBalance(snapshot.basis, snapshot.accountId, snapshot.date) !== snapshot.ledgerBalanceCents) fail('INVALID_RELATIONS', '快照保存的账本余额与依据不一致');
    safe(BigInt(snapshot.actualBalanceCents) - BigInt(snapshot.ledgerBalanceCents));
    return snapshot;
  }
  function expenseProof(row, plan) {
    if (row.expenseSignature.type !== 'expense') fail('INVALID_RELATIONS', '原支出签名方向无效');
    if ((plan ? row.expectedAmountCents : row.amountCents) > row.expenseSignature.amountCents) fail(plan ? 'INVALID_REFUND_PLAN' : 'EXPENSE_OVERALLOCATED', plan ? '预计退款金额或日期与原支出不符' : '退款与应收份额合计超过原支出');
    if (row.dueDate && row.dueDate < row.expenseSignature.date) fail(plan ? 'INVALID_REFUND_PLAN' : 'RELATION_DATE', '预计到账日期不能早于原支出');
    return row;
  }
  function allocationProof(row) {
    if (row.incomeId === row.expenseId || row.incomeSignature.type !== 'income' || row.expenseSignature.type !== 'expense') fail('INVALID_RELATIONS', '金额分配原记录方向无效');
    if (row.incomeSignature.date < row.expenseSignature.date) fail('RELATION_DATE', '到账日期不能早于原支出');
    if (row.amountCents > row.incomeSignature.amountCents) fail('INCOME_OVERALLOCATED', '退款与回款合计超过这笔实际到账收入');
    if (row.amountCents > row.expenseSignature.amountCents) fail('EXPENSE_OVERALLOCATED', '退款与应收份额合计超过原支出');
    return row;
  }
  function sameMovement(a, b) { return a.type === b.type && a.amountCents === b.amountCents && a.accountId === b.accountId && (a.type !== 'transfer' || a.toAccountId === b.toAccountId); }
  function addMap(map, key, value) { map.set(key, (map.get(key) || 0n) + BigInt(value)); }
  function balanceBasis(index, extension, accountId, asOf) {
    const shadows = new Set(extension.links.map(v => v.shadowId)), composites = compositeContext(extension);
    const touches = value => value.accountId === accountId || value.toAccountId === accountId;
    const transactions = [...index.transactions.values()].filter(v => v.date <= asOf && touches(v) && !shadows.has(v.id) && (!composites.has(v.id) || composites.get(v.id).funding)).map(v => ({ id: v.id, ...signature(v) })).sort((a, b) => a.id.localeCompare(b.id));
    const excluded = extension.links.filter(v => { const t = index.transactions.get(v.shadowId); return t.date <= asOf && touches(t); }).map(v => ({ shadowId: v.shadowId, primaryId: v.primaryId })).sort((a, b) => a.shadowId.localeCompare(b.shadowId));
    const proofs = (extension.composites || []).filter(v => v.signatures.some(t => t.date <= asOf && touches(t))).map(clone).sort((a,b) => a.id.localeCompare(b.id));
    return { openingBalanceCents: index.accounts.get(accountId).openingBalanceCents, transactions, excluded, ...(proofs.length ? { composites: proofs } : {}) }; 
  }
  function basisBalance(basis, accountId, asOf) {
    let result = BigInt(basis.openingBalanceCents);
    const transactions = new Map(basis.transactions.map(v => [v.id, v])), allMembers = new Set(), groupIds = new Set();
    for (const proof of basis.composites || []) {
      if (groupIds.has(proof.id) || transactions.has(proof.id)) fail('INVALID_RELATIONS', '对账组合标识重复'); groupIds.add(proof.id);
      const funding = new Set(proof.fundingIds); let touches = false;
      for (const captured of proof.signatures) {
        if (allMembers.has(captured.id) || groupIds.has(captured.id)) fail('INVALID_RELATIONS', '对账组合来源重叠'); allMembers.add(captured.id);
        const included = transactions.get(captured.id), relevant = captured.accountId === accountId && captured.date <= asOf; touches ||= relevant;
        if (included && (!funding.has(captured.id) || !same(included, captured)) || relevant && funding.has(captured.id) && !included) fail('INVALID_RELATIONS', '对账依据缺少真实资金来源或混入仅消费证据');
        if (basis.excluded.some(v => v.shadowId === captured.id)) fail('INVALID_RELATIONS', '组合主记录不能同时为重复证据');
      }
      if (!touches) fail('INVALID_RELATIONS', '对账组合不属于账户或日期');
    }
    for (const key of groupIds) if (allMembers.has(key)) fail('INVALID_RELATIONS', '对账组合标识与来源冲突');
    for (const row of basis.transactions) {
      if (row.date > asOf || (row.accountId !== accountId && row.toAccountId !== accountId)) fail('INVALID_RELATIONS', '对账依据超出账户或日期');
      if (row.accountId === accountId) result += BigInt(row.type === 'income' ? row.amountCents : -row.amountCents);
      if (row.type === 'transfer' && row.toAccountId === accountId) result += BigInt(row.amountCents);
    }
    return safe(result);
  }
  function validate(input, state) {
    const index = baseIndex(state);
    const value = input === undefined ? defaultState() : input;
    shape(value, ['version', 'revision', ...Object.values(COLLECTIONS), 'audit'], '账务关联');
    if (value.version === COMPOSITE_VERSION && (!Number.isInteger(state.version) || state.version < 4)) fail('INVALID_RELATIONS_VERSION', '组合证据须放入账务关联版本的账本');
    if (![1, VERSION, COMPOSITE_VERSION].includes(value.version)) fail('INVALID_RELATIONS_VERSION', '不支持此关联版本');
    if (value.version === 1 && Object.prototype.hasOwnProperty.call(value, 'transferPairs')) fail('INVALID_RELATIONS_VERSION', '转账配对须使用新版关联格式');
    if (value.version < COMPOSITE_VERSION && Object.prototype.hasOwnProperty.call(value, 'composites')) fail('INVALID_RELATIONS_VERSION', '组合证据须使用新版关联格式');
    // Reject oversized composite proof graphs before allocating normalized snapshots.
    let proofCells = 0;
    function budgetProof(raw) { object(raw, '组合证明'); proofCells += array(raw.signatures, LIMITS.compositeMembers * 2, '组合签名').length; if (proofCells > LIMITS.compositeCells) fail('RELATION_LIMIT', '组合历史签名数量超过上限'); }
    function budgetRow(raw, kind) { if (raw === null) return; object(raw, '关联记录'); if (kind === 'composite') { if (value.version < COMPOSITE_VERSION) fail('INVALID_RELATIONS_VERSION', '组合历史须使用新版关联格式'); budgetProof(raw); } if (kind === 'snapshot' && raw.basis !== undefined) { object(raw.basis, '对账依据'); if (raw.basis.composites !== undefined && value.version < COMPOSITE_VERSION) fail('INVALID_RELATIONS_VERSION', '组合对账依据须使用新版关联格式'); if (raw.basis.composites !== undefined) for (const proof of array(raw.basis.composites, LIMITS.composites, '对账组合')) budgetProof(proof); } }
    for (const raw of value.version === COMPOSITE_VERSION ? array(value.composites, LIMITS.composites, '组合证据') : []) budgetProof(raw);
    for (const raw of array(value.snapshots, LIMITS.snapshots, '余额快照')) budgetRow(raw, 'snapshot');
    for (const event of array(value.audit, LIMITS.audit, '关联历史')) { object(event, '关联历史'); budgetRow(event.before, event.kind); budgetRow(event.after, event.kind); }
    const result = defaultState(); if (value.version === COMPOSITE_VERSION) { result.version = COMPOSITE_VERSION; result.composites = []; } result.revision = integer(value.revision, 0, LIMITS.audit);
    const activeIds = new Set();
    for (const [kind, collection] of Object.entries(COLLECTIONS)) {
      if (kind === 'composite' && value.version < COMPOSITE_VERSION) continue;
      result[collection] = array(value.version === 1 && kind === 'transferPair' ? [] : value[collection], kind === 'snapshot' ? LIMITS.snapshots : kind === 'composite' ? LIMITS.composites : LIMITS.rows, '关联列表').map(v => {
        const row = normalizeRow(kind, v); if (activeIds.has(row.id) || index.used.has(row.id)) fail('DUPLICATE_ID', '关联标识重复'); activeIds.add(row.id); return row;
      });
    }
    // Replay the journal. Active records cannot silently disappear or change outside an audited operation.
    const journal = new Map(), ever = new Set(), auditIds = new Set(), historicalUses = new Map(), historicalFinancial = new Map(), historicalPaidClaims = new Map(), historicalPaidPlans = new Map();
    function historicalRefs(kind, row) {
      if (!row || kind === 'snapshot') return [];
      if (kind === 'composite') return row.signatures.map(v => ({ id: v.id, composite: row.personalIds.includes(v.id) ? 'personal' : 'funding', signature: signature(v) }));
      if (kind === 'link') return [{ id: row.primaryId, proof: true, signature: row.primarySignature }, { id: row.shadowId, shadow: true, signature: row.shadowSignature }];
      return [...new Set([row.expenseId, row.incomeId].filter(Boolean))].map(id => ({ id, shadow: false, signature: id === row.expenseId ? row.expenseSignature : row.incomeSignature, allocated: id === row.expenseId && ['claim', 'refund'].includes(kind) || id === row.incomeId && ['refund', 'settlement'].includes(kind) ? row.amountCents : 0 }));
    }
    function changeHistoricalUses(kind, row, delta) {
      for (const ref of historicalRefs(kind, row)) {
        const uses = historicalUses.get(ref.id) || new Map(), label = kind === 'transferPair' ? 'pair' : ref.composite ? 'composite-' + ref.composite : ref.shadow ? 'shadow' : ref.proof ? 'proof' : 'allocation';
        if (delta > 0 && (label === 'proof' && uses.has('shadow') || label === 'shadow' && (uses.has('shadow') || uses.has('proof')))) fail('RELATION_OVERLAP', '重复证据历史不能形成自关联、串联、循环或重复附属');
        if (delta > 0 && (label === 'shadow' && uses.has('allocation') || label === 'allocation' && uses.has('shadow'))) fail('RELATION_SHADOW', '重复附属证据历史不能同时分配金额');
        if (delta > 0 && ((label === 'pair' && [...uses.keys()].some(key => key !== 'proof')) || (label !== 'pair' && label !== 'proof' && uses.has('pair')))) fail('INVALID_RELATIONS_AUDIT', '转账配对历史与重复证据或金额分配重叠');
        if (delta > 0 && ((ref.composite && (uses.has('composite-personal') || uses.has('composite-funding') || uses.has('shadow') || ref.composite === 'funding' && uses.has('allocation'))) || label === 'shadow' && (uses.has('composite-personal') || uses.has('composite-funding')) || label === 'allocation' && uses.has('composite-funding'))) fail('INVALID_RELATIONS_AUDIT', '组合历史的角色、证据或金额分配冲突');
        if (delta < 0 && ref.composite && uses.has('allocation')) fail('INVALID_RELATIONS_AUDIT', '须先撤销组合来源的金额分配再撤销组合');
        const financial = historicalFinancial.get(ref.id) || { signature: ref.signature, count: 0, allocated: 0n };
        if (delta > 0 && financial.count && !same(financial.signature, ref.signature)) fail('INVALID_RELATIONS_AUDIT', '同一来源在同时有效的历史关联中签名不一致');
        financial.count += delta; financial.allocated += BigInt(ref.allocated || 0) * BigInt(delta);
        if (financial.allocated > BigInt(financial.signature.amountCents)) fail(financial.signature.type === 'income' ? 'INCOME_OVERALLOCATED' : 'EXPENSE_OVERALLOCATED', financial.signature.type === 'income' ? '退款与回款合计超过这笔实际到账收入' : '退款与应收份额合计超过原支出');
        if (financial.count) historicalFinancial.set(ref.id, financial); else historicalFinancial.delete(ref.id);
        const count = (uses.get(label) || 0) + delta; if (count > 0) uses.set(label, count); else uses.delete(label);
        if (uses.size) historicalUses.set(ref.id, uses); else historicalUses.delete(ref.id);
      }
      function allocated(map, key, n) { const total = (map.get(key) || 0n) + BigInt(n) * BigInt(delta); if (total < 0n) fail('INVALID_RELATIONS_AUDIT', '历史金额撤销顺序无效'); if (total) map.set(key, total); else map.delete(key); return total; }
      if (kind === 'settlement') {
        const claim = journal.get('claim:' + row.claimId);
        if (!claim || claim.expenseId !== row.expenseId || !same(claim.expenseSignature, row.expenseSignature)) fail('INVALID_RELATIONS_AUDIT', '历史回款须引用同时有效且一致的应收');
        if (allocated(historicalPaidClaims, row.claimId, row.amountCents) > BigInt(claim.amountCents)) fail('CLAIM_OVERPAID', '回款合计超过应收金额');
      }
      if (kind === 'refund' && row.planId) {
        const plan = journal.get('refundPlan:' + row.planId);
        if (!plan || plan.expenseId !== row.expenseId || !same(plan.expenseSignature, row.expenseSignature)) fail('INVALID_RELATIONS_AUDIT', '历史退款须引用同时有效且一致的退款计划');
        if (allocated(historicalPaidPlans, row.planId, row.amountCents) > BigInt(plan.expectedAmountCents)) fail('REFUND_PLAN_OVERPAID', '已关联到账超过预计退款，请先调整计划金额');
      }
      if (delta > 0 && kind === 'claim' && (historicalPaidClaims.get(row.id) || 0n) > BigInt(row.amountCents)) fail('CLAIM_OVERPAID', '回款合计超过应收金额');
      if (delta > 0 && kind === 'refundPlan' && (historicalPaidPlans.get(row.id) || 0n) > BigInt(row.expectedAmountCents)) fail('REFUND_PLAN_OVERPAID', '已关联到账超过预计退款，请先调整计划金额');
    }
    let captureCells = (result.composites || []).reduce((n, row) => n + row.signatures.length, 0);
    function countProof(row) { if (!row) return; captureCells += row.signatures?.length || 0; captureCells += row.basis?.composites?.reduce((n, p) => n + p.signatures.length, 0) || 0; if (captureCells > LIMITS.compositeCells) fail('RELATION_LIMIT', '组合历史签名数量超过上限'); }
    for (const row of result.snapshots) countProof(row);
    result.audit = array(value.audit, LIMITS.audit, '关联历史').map((v, i) => {
      shape(v, ['id', 'revision', 'at', 'kind', 'recordId', 'action', 'reason', 'before', 'after'], '关联历史');
      const row = { id: id(v.id), revision: integer(v.revision, 1, LIMITS.audit), at: timestamp(v.at), kind: v.kind, recordId: id(v.recordId), action: v.action, reason: reason(v.reason), before: v.before === null ? null : normalizeRow(v.kind, v.before), after: v.after === null ? null : normalizeRow(v.kind, v.after) };
      countProof(row.before); countProof(row.after);
      if (value.version < COMPOSITE_VERSION && (row.kind === 'composite' || row.before?.basis?.composites !== undefined || row.after?.basis?.composites !== undefined)) fail('INVALID_RELATIONS_VERSION', '组合历史须使用新版关联格式');
      if (value.version === 1 && row.kind === 'transferPair') fail('INVALID_RELATIONS_VERSION', '旧版关联不能含转账配对历史');
      if (!COLLECTIONS[row.kind] || !['create', 'update', 'unlink'].includes(row.action) || row.revision !== i + 1 || auditIds.has(row.id) || index.used.has(row.id) || activeIds.has(row.id)) fail('INVALID_RELATIONS_AUDIT', '关联历史标识或顺序无效');
      if ((row.before && row.before.id !== row.recordId) || (row.after && row.after.id !== row.recordId)) fail('INVALID_RELATIONS_AUDIT', '关联历史对象不一致');
      auditIds.add(row.id);
      const key = row.kind + ':' + row.recordId;
      if (row.action === 'create') {
        if (row.before !== null || !row.after || ever.has(row.recordId) || row.after.createdAt !== row.at) fail('INVALID_RELATIONS_AUDIT', '关联创建历史无效');
        changeHistoricalUses(row.kind, row.after, 1); ever.add(row.recordId); journal.set(key, row.after);
      } else {
        if (!row.before || !journal.has(key) || !same(journal.get(key), row.before)) fail('INVALID_RELATIONS_AUDIT', '关联历史缺少前一版本');
        if (row.action === 'unlink') {
          if (row.after !== null) fail('INVALID_RELATIONS_AUDIT', '撤销历史无效');
          for (const [otherKey, active] of journal) {
            if ((row.kind === 'claim' && otherKey.startsWith('settlement:') && active.claimId === row.recordId) ||
                (row.kind === 'refundPlan' && otherKey.startsWith('refund:') && active.planId === row.recordId)) fail('INVALID_RELATIONS_AUDIT', '撤销顺序无效，须先撤销关联的回款或退款');
          }
          changeHistoricalUses(row.kind, row.before, -1); journal.delete(key);
        }
        else {
          if (!['claim', 'refundPlan'].includes(row.kind) || !row.after || row.after.createdAt !== row.before.createdAt || row.after.expenseId !== row.before.expenseId || !same(row.after.expenseSignature, row.before.expenseSignature)) fail('INVALID_RELATIONS_AUDIT', '关联修改历史无效');
          changeHistoricalUses(row.kind, row.before, -1); changeHistoricalUses(row.kind, row.after, 1); journal.set(key, row.after);
        }
      }
      return row;
    });
    if (result.revision !== result.audit.length) fail('INVALID_RELATIONS_AUDIT', '关联版本与历史不一致');
    for (const key of ever) if (auditIds.has(key) || index.used.has(key)) fail('DUPLICATE_ID', '关联历史标识重复');
    for (const [kind, collection] of Object.entries(COLLECTIONS)) for (const row of result[collection] || []) {
      const key = kind + ':' + row.id;
      if (!journal.has(key) || !same(journal.get(key), row)) fail('INVALID_RELATIONS_AUDIT', '关联记录与操作历史不一致'); journal.delete(key);
    }
    if (journal.size) fail('INVALID_RELATIONS_AUDIT', '关联记录缺少明确撤销历史');
    const composites = compositeContext(result);
    const shadows = new Set(), primaries = new Set(), paired = new Set(), usedIncome = new Map(), usedExpense = new Map(), paidClaims = new Map(), paidPlans = new Map();
    function tx(key, type) {
      const row = index.transactions.get(key);
      if (!row || (type && row.type !== type)) fail('RELATION_REFERENCED', '关联交易不存在或收支方向已变化，请先撤销相关关联');
      if (shadows.has(key)) fail('RELATION_SHADOW', '重复证据不能再次分配金额，请使用主记录');
      if (paired.has(key)) fail('TRANSFER_PAIR_OVERLAP', '本人账户转账不能同时关联退款、应收、回款或待退款');
      if (type === 'expense' && composites.has(key) && !composites.get(key).personal) fail('COMPOSITE_FUNDING_ONLY', '仅资金证据不能分配退款、应收或待退款，请选择组合的消费明细');
      return row;
    }
    function unchanged(transaction, captured) { if (!same(signature(transaction), captured)) fail('RELATION_CHANGED', '已关联交易的金额、日期或资金账户不能直接修改，请先撤销相关关联'); }
    for (const row of result.links) {
      const a = index.transactions.get(row.primaryId), b = index.transactions.get(row.shadowId);
      if (!a || !b) fail('RELATION_REFERENCED', '关联证据仍被引用，不能删除');
      if (row.primaryId === row.shadowId || shadows.has(row.primaryId) || shadows.has(row.shadowId) || primaries.has(row.shadowId)) fail('RELATION_OVERLAP', '证据不能自关联、循环、串联或重复关联；一份主记录可有多份独立证据');
      if (!sameMovement(a, b)) fail('RELATION_MISMATCH', '只有金额、方向与资金账户相同的记录才能关联');
      if (!same(signature(a), row.primarySignature) || !same(signature(b), row.shadowSignature)) fail('RELATION_CHANGED', '已关联证据的金额、日期或资金账户不能直接修改，请先撤销关联');
      primaries.add(row.primaryId); shadows.add(row.shadowId);
    }
    for (const row of result.transferPairs) {
      if (composites.has(row.expenseId) || composites.has(row.incomeId)) fail('COMPOSITE_OVERLAP', '组合证据不能同时属于本人账户转账');
      if (paired.has(row.expenseId) || paired.has(row.incomeId)) fail('TRANSFER_PAIR_OVERLAP', '一笔原记录只能属于一个转账配对');
      const expense = tx(row.expenseId, 'expense'), income = tx(row.incomeId, 'income');
      unchanged(expense, row.expenseSignature); unchanged(income, row.incomeSignature);
      paired.add(row.expenseId); paired.add(row.incomeId);
    }
    const compositeMembers = new Set();
    for (const row of result.composites || []) for (const captured of row.signatures) {
      const transaction = index.transactions.get(captured.id);
      if (activeIds.has(captured.id) || !transaction || transaction.type !== 'expense' || shadows.has(captured.id) || paired.has(captured.id) || compositeMembers.has(captured.id)) fail('COMPOSITE_OVERLAP', '组合来源须为未被另一组合占用的有效主支出记录');
      if (!same({ id: transaction.id, ...signature(transaction) }, captured)) fail('RELATION_CHANGED', '组合来源的金额、日期、类型或账户已变化，须先撤销组合');
      compositeMembers.add(captured.id);
    }
    const claims = new Map(result.claims.map(v => [v.id, v]));
    const plans = new Map(result.refundPlans.map(v => [v.id, v]));
    for (const row of result.claims) { const expense = tx(row.expenseId, 'expense'); unchanged(expense, row.expenseSignature); if (row.dueDate && row.dueDate < expense.date) fail('RELATION_DATE', '预计回款日期不能早于原支出'); addMap(usedExpense, row.expenseId, row.amountCents); }
    for (const row of result.refundPlans) {
      const expense = tx(row.expenseId, 'expense'); unchanged(expense, row.expenseSignature);
      if (row.expectedAmountCents > expense.amountCents || (row.dueDate && row.dueDate < expense.date)) fail('INVALID_REFUND_PLAN', '预计退款金额或日期与原支出不符');
    }
    for (const row of result.refunds) {
      const income = tx(row.incomeId, 'income'), expense = tx(row.expenseId, 'expense');
      unchanged(income, row.incomeSignature); unchanged(expense, row.expenseSignature);
      if (income.date < expense.date) fail('RELATION_DATE', '退款到账不能早于原支出');
      if (row.planId) { const plan = plans.get(row.planId); if (!plan || plan.expenseId !== row.expenseId) fail('RELATION_REFERENCED', '退款计划不存在或对应其他支出'); addMap(paidPlans, plan.id, row.amountCents); }
      addMap(usedIncome, row.incomeId, row.amountCents); addMap(usedExpense, row.expenseId, row.amountCents);
    }
    for (const row of result.settlements) {
      const income = tx(row.incomeId, 'income'), claim = claims.get(row.claimId);
      if (!claim) fail('RELATION_REFERENCED', '应收已有回款关联，不能直接删除');
      if (row.expenseId !== claim.expenseId) fail('RELATION_CHANGED', '回款对应的原支出不能直接修改');
      const expense = tx(row.expenseId, 'expense'); unchanged(income, row.incomeSignature); unchanged(expense, row.expenseSignature);
      if (income.date < expense.date) fail('RELATION_DATE', '回款到账不能早于原支出');
      addMap(usedIncome, row.incomeId, row.amountCents); addMap(paidClaims, row.claimId, row.amountCents);
    }
    for (const [key, allocated] of usedIncome) if (allocated > BigInt(tx(key, 'income').amountCents)) fail('INCOME_OVERALLOCATED', '退款与回款合计超过这笔实际到账收入');
    for (const [key, allocated] of usedExpense) if (allocated > BigInt(tx(key, 'expense').amountCents)) fail('EXPENSE_OVERALLOCATED', '退款与应收份额合计超过原支出');
    for (const [key, allocated] of paidClaims) if (allocated > BigInt(claims.get(key).amountCents)) fail('CLAIM_OVERPAID', '回款合计超过应收金额');
    for (const [key, allocated] of paidPlans) if (allocated > BigInt(plans.get(key).expectedAmountCents)) fail('REFUND_PLAN_OVERPAID', '已关联到账超过预计退款，请先调整计划金额');
    for (const row of result.snapshots) {
      if (value.version < COMPOSITE_VERSION && row.basis.composites !== undefined) fail('INVALID_RELATIONS_VERSION', '组合对账依据须使用新版关联格式');
      if (!index.accounts.has(row.accountId)) fail('RELATION_REFERENCED', '余额快照引用的账户不能直接删除');
      // Historical captured differences are checked in normalizeRow; current differences must stay safe too.
      const currentBalance = basisBalance(balanceBasis(index, result, row.accountId, row.date), row.accountId, row.date);
      safe(BigInt(row.actualBalanceCents) - BigInt(currentBalance));
    }
    // Reject all unsafe totals, including otherwise valid imported extension data.
    compute(state, result, index);
    return result;
  }
  function normalized(state) { const bookkeeping = validate(state.bookkeeping, state); return { ...state, bookkeeping }; }
  function newId(state, prefix, revision) {
    const used = baseIndex(state).used;
    for (const section of [state.bookkeeping, state.imports, state.organizer, state.obligations]) if (section) for (const values of Object.values(section)) if (Array.isArray(values)) for (const row of values) { if (row.id) used.add(row.id); if (row.recordId) used.add(row.recordId); }
    let suffix = 0, candidate;
    do { candidate = 'relation-' + prefix + '-' + revision + (suffix ? '-' + suffix : ''); suffix++; } while (used.has(candidate));
    return id(candidate);
  }
  function change(state, kind, action, row, why) {
    const next = clone(state); next.version = Math.max(state.version, 4);
    const data = next.bookkeeping, collection = COLLECTIONS[kind], index = data[collection].findIndex(v => v.id === row.id);
    const before = index < 0 ? null : data[collection][index];
    if (action !== 'create' && !before) fail('NOT_FOUND', '关联记录不存在');
    if (action === 'create') data[collection].push(row);
    else if (action === 'unlink') data[collection].splice(index, 1);
    else data[collection][index] = row;
    const revision = data.revision + 1;
    data.audit.push({ id: newId(next, 'audit', revision), revision, at: action === 'create' ? row.createdAt : new Date().toISOString(), kind, recordId: row.id, action, reason: reason(why), before: before && clone(before), after: action === 'unlink' ? null : clone(row) });
    data.revision = revision;
    next.bookkeeping = validate(data, next);
    if (next.obligations !== undefined) {
      const obligations = typeof module === 'object' && module.exports ? require('./obligations.js') : root.MoneygoObligations;
      if (!obligations) fail('OBLIGATIONS_UNAVAILABLE', '信用义务模块未加载');
      obligations.assertRelationChange(state, next);
    }
    return next;
  }
  function create(state, kind, fields, why) {
    const current = normalized(state), index = baseIndex(current);
    // Capture economic dependencies internally. Public callers cannot supply or replace these signatures.
    function capture(transactionId, type) {
      const transaction = index.transactions.get(id(transactionId));
      if (!transaction || transaction.type !== type) fail('RELATION_REFERENCED', '关联交易不存在或收支方向不符');
      return signature(transaction);
    }
    if (['refund', 'claim', 'refundPlan'].includes(kind)) fields = { ...fields, expenseSignature: capture(fields.expenseId, 'expense') };
    if (kind === 'transferPair') fields = { ...fields, expenseSignature: capture(fields.expenseId, 'expense'), incomeSignature: capture(fields.incomeId, 'income') };
    if (kind === 'refund') fields = { ...fields, incomeSignature: capture(fields.incomeId, 'income') };
    if (kind === 'settlement') {
      const claim = current.bookkeeping.claims.find(value => value.id === id(fields.claimId));
      if (!claim) fail('RELATION_REFERENCED', '应收不存在，不能分配回款');
      fields = { ...fields, expenseId: claim.expenseId, expenseSignature: capture(claim.expenseId, 'expense'), incomeSignature: capture(fields.incomeId, 'income') };
    }
    const row = normalizeRow(kind, { id: newId(current, kind, current.bookkeeping.revision + 1), createdAt: new Date().toISOString(), ...fields });
    return change(current, kind, 'create', row, why);
  }
  function linkEvidence(state, input) {
    shape(input, ['primaryId', 'shadowId', 'reason'], '证据关联');
    const index = baseIndex(state), primary = index.transactions.get(id(input.primaryId)), shadow = index.transactions.get(id(input.shadowId));
    if (!primary || !shadow) fail('NOT_FOUND', '要关联的交易不存在');
    return create(state, 'link', { primaryId: primary.id, shadowId: shadow.id, reason: reason(input.reason), primarySignature: signature(primary), shadowSignature: signature(shadow) }, input.reason);
  }
  function pairTransfer(state, input) {
    shape(input, ['expenseId', 'incomeId', 'reason'], '本人账户转账配对');
    const index = baseIndex(state), expense = index.transactions.get(id(input.expenseId));
    if (!expense || expense.type !== 'expense') fail('RELATION_REFERENCED', '须选择实际转出的原支出记录');
    return create(state, 'transferPair', { expenseId: expense.id, incomeId: id(input.incomeId), amountCents: expense.amountCents, reason: reason(input.reason) }, input.reason);
  }
  function allocateRefund(state, input) {
    shape(input, ['incomeId', 'expenseId', 'amountCents', 'reason', 'planId'], '退款分配');
    return create(state, 'refund', { incomeId: input.incomeId, expenseId: input.expenseId, amountCents: input.amountCents, reason: reason(input.reason), planId: input.planId === undefined ? null : input.planId }, input.reason);
  }
  function createClaim(state, input) {
    shape(input, ['expenseId', 'amountCents', 'kind', 'name', 'dueDate', 'status', 'note'], '应收');
    return create(state, 'claim', { expenseId: input.expenseId, amountCents: input.amountCents, kind: input.kind, name: input.name, dueDate: input.dueDate === undefined || input.dueDate === '' ? null : input.dueDate, status: input.status === undefined ? 'unsubmitted' : input.status, note: note(input.note) }, '登记应收份额');
  }
  function settleClaim(state, input) {
    shape(input, ['incomeId', 'claimId', 'amountCents', 'reason'], '应收回款');
    return create(state, 'settlement', { incomeId: input.incomeId, claimId: input.claimId, amountCents: input.amountCents, reason: reason(input.reason) }, input.reason);
  }
  function updateRow(state, kind, recordId, patch, why) {
    const fields = kind === 'claim' ? ['amountCents', 'kind', 'name', 'dueDate', 'status', 'note'] : ['expectedAmountCents', 'dueDate', 'status', 'note'];
    shape(patch, fields, '关联修改'); reason(why);
    const current = normalized(state), row = current.bookkeeping[COLLECTIONS[kind]].find(v => v.id === id(recordId));
    if (!row) fail('NOT_FOUND', '要修改的关联不存在');
    return change(current, kind, 'update', normalizeRow(kind, { ...row, ...patch }), why);
  }
  function updateClaim(state, recordId, patch, why) { return updateRow(state, 'claim', recordId, patch, why); }
  function addRefundPlan(state, input) {
    shape(input, ['expenseId', 'expectedAmountCents', 'dueDate', 'status', 'note'], '待退款');
    return create(state, 'refundPlan', { expenseId: input.expenseId, expectedAmountCents: input.expectedAmountCents, dueDate: input.dueDate === undefined || input.dueDate === '' ? null : input.dueDate, status: input.status === undefined ? 'waiting' : input.status, note: note(input.note) }, '登记待退款计划（尚未到账）');
  }
  function updateRefundPlan(state, recordId, patch, why) { return updateRow(state, 'refundPlan', recordId, patch, why); }
  function addSnapshot(state, input) {
    shape(input, ['accountId', 'date', 'actualBalanceCents', 'note'], '余额快照');
    const current = normalized(state), index = baseIndex(current), key = id(input.accountId), asOf = date(input.date);
    if (!index.accounts.has(key)) fail('NOT_FOUND', '对账账户不存在');
    const basis = balanceBasis(index, current.bookkeeping, key, asOf);
    return create(current, 'snapshot', { accountId: key, date: asOf, actualBalanceCents: input.actualBalanceCents, note: note(input.note), ledgerBalanceCents: basisBalance(basis, key, asOf), basis }, '记录用户提供的日终实际余额');
  }
  function unlink(state, kind, recordId, why) {
    if (kind === 'composite') fail('CONFIRMATION_REQUIRED', '组合撤销须先预览并明确确认');
    if (!COLLECTIONS[kind]) fail('INVALID_RELATION_KIND', '关联种类无效');
    const current = normalized(state), row = current.bookkeeping[COLLECTIONS[kind]].find(v => v.id === id(recordId));
    if (!row) fail('NOT_FOUND', '要撤销的关联不存在');
    if ((kind === 'claim' && current.bookkeeping.settlements.some(v => v.claimId === row.id)) ||
        (kind === 'refundPlan' && current.bookkeeping.refunds.some(v => v.planId === row.id))) fail('RELATION_REFERENCED', '须先撤销关联的回款或退款，才能删除此记录');
    return change(current, kind, 'unlink', row, why);
  }
  function compute(state, extension, index, month) {
    const shadows = new Map(extension.links.map(v => [v.shadowId, v.primaryId])), composites = compositeContext(extension);
    const pairs = new Map(); for (const pair of extension.transferPairs) { pairs.set(pair.expenseId, pair); pairs.set(pair.incomeId, pair); }
    const refunds = new Map(), claims = new Map(), incomeRefunds = new Map(), incomeSettlements = new Map(), settled = new Map(), planReceived = new Map();
    for (const row of extension.refunds) { addMap(refunds, row.expenseId, row.amountCents); addMap(incomeRefunds, row.incomeId, row.amountCents); if (row.planId) addMap(planReceived, row.planId, row.amountCents); }
    for (const row of extension.claims) addMap(claims, row.expenseId, row.amountCents);
    for (const row of extension.settlements) { addMap(incomeSettlements, row.incomeId, row.amountCents); addMap(settled, row.claimId, row.amountCents); }
    const cash = { incomeCents: 0n, expenseCents: 0n, transferCents: 0n, netCents: 0n };
    const accountFlows = { inflowCents: 0n, outflowCents: 0n, transferInCents: 0n, transferOutCents: 0n, netCents: 0n };
    const personal = { incomeCents: 0n, expenseCents: 0n, transferCents: 0n, netCents: 0n, refundCents: 0n, claimCents: 0n };
    const balances = new Map([...index.accounts.values()].map(v => [v.id, BigInt(v.openingBalanceCents)]));
    const impacts = Object.create(null), excludedEvidence = [], cashRows = [], personalRows = [], accountFlowRows = [], personalFacts = [];
    for (const row of index.transactions.values()) {
      const excluded = shadows.has(row.id), active = !excluded, pair = pairs.get(row.id) || null, composite = composites.get(row.id), personalAuthority = active && (!composite || composite.personal), fundingAuthority = active && (!composite || composite.funding);
      const refundCents = safe(refunds.get(row.id) || 0n), claimCents = safe(claims.get(row.id) || 0n);
      const cashIncomeCents = active && !pair && row.type === 'income' ? row.amountCents : 0;
      const cashExpenseCents = fundingAuthority && !pair && row.type === 'expense' ? row.amountCents : 0;
      const transferCents = active && (row.type === 'transfer' || pair && row.type === 'expense') ? row.amountCents : 0;
      const transferOutCents = transferCents, transferInCents = active && (row.type === 'transfer' || pair && row.type === 'income') ? row.amountCents : 0;
      const accountInflowCents = cashIncomeCents + transferInCents, accountOutflowCents = cashExpenseCents + transferOutCents;
      const ordinaryIncomeCents = row.type === 'income' && active && !pair ? safe(BigInt(row.amountCents) - (incomeRefunds.get(row.id) || 0n) - (incomeSettlements.get(row.id) || 0n)) : 0;
      const personalExpenseCents = row.type === 'expense' && personalAuthority && !pair ? row.amountCents - refundCents - claimCents : 0;
      const impact = { transactionId: row.id, date: row.date, type: row.type, compositeId: composite?.row.id || null, personalAuthority, fundingAuthority, excluded, primaryId: shadows.get(row.id) || null, cashIncomeCents, cashExpenseCents, cashSignedCents: cashIncomeCents - cashExpenseCents, transferCents, transferInCents, transferOutCents, accountInflowCents, accountOutflowCents, accountSignedCents: accountInflowCents - accountOutflowCents, transferPairId: pair ? pair.id : null, transferRole: pair ? row.type === 'expense' ? 'out' : 'in' : null, ordinaryIncomeCents, personalExpenseCents, refundCents, claimCents, receivedRefundCents: safe(incomeRefunds.get(row.id) || 0n), settlementCents: safe(incomeSettlements.get(row.id) || 0n), allocatedIncomeCents: safe((incomeRefunds.get(row.id) || 0n) + (incomeSettlements.get(row.id) || 0n)), availableIncomeCents: ordinaryIncomeCents, refundableExpenseCents: personalExpenseCents };
      impacts[row.id] = impact;
      personalFacts.push({
        transactionId: row.id, kind: row.type, effectiveDate: row.date,
        categoryId: personalCategory(row), accountId: row.accountId,
        rawAmountCents: row.amountCents,
        personalAmountCents: row.type === 'expense' ? personalExpenseCents : ordinaryIncomeCents,
        excluded, primaryId: impact.primaryId, transferPairId: impact.transferPairId,
        compositeId: impact.compositeId, personalAuthority, fundingAuthority
      });
      if (fundingAuthority) {
        addMap(balances, row.accountId, row.type === 'income' ? row.amountCents : -row.amountCents);
        if (row.type === 'transfer') addMap(balances, row.toAccountId, row.amountCents);
      }
      if (month !== undefined && row.date.slice(0, 7) !== month) continue;
      if (excluded) { excludedEvidence.push({ transactionId: row.id, primaryId: shadows.get(row.id), type: row.type, amountCents: row.amountCents, date: row.date }); continue; }
      accountFlows.inflowCents += BigInt(accountInflowCents); accountFlows.outflowCents += BigInt(accountOutflowCents); accountFlows.transferInCents += BigInt(transferInCents); accountFlows.transferOutCents += BigInt(transferOutCents);
      cash.incomeCents += BigInt(cashIncomeCents); cash.expenseCents += BigInt(cashExpenseCents); cash.transferCents += BigInt(transferCents);
      personal.incomeCents += BigInt(ordinaryIncomeCents); personal.expenseCents += BigInt(personalExpenseCents); personal.transferCents += BigInt(transferCents); personal.refundCents += BigInt(refundCents); personal.claimCents += BigInt(claimCents);
      accountFlowRows.push({ transactionId: row.id, date: row.date, type: row.type, transferPairId: pair ? pair.id : null, transferRole: pair ? row.type === 'expense' ? 'out' : 'in' : null, accountId: row.accountId, toAccountId: row.toAccountId, accountInflowCents, accountOutflowCents, transferInCents, transferOutCents, movements: fundingAuthority ? [{ accountId: row.accountId, signedCents: row.type === 'income' ? row.amountCents : -row.amountCents }, ...(row.type === 'transfer' ? [{ accountId: row.toAccountId, signedCents: row.amountCents }] : [])] : [] });
      cashRows.push({ transactionId: row.id, date: row.date, type: row.type, amountCents: row.amountCents, cashIncomeCents, cashExpenseCents, transferCents, transferPairId: pair ? pair.id : null });
      personalRows.push({ transactionId: row.id, incomeCents: ordinaryIncomeCents, expenseCents: personalExpenseCents, refundCents, claimCents });
    }
    accountFlows.netCents = accountFlows.inflowCents - accountFlows.outflowCents;
    cash.netCents = cash.incomeCents - cash.expenseCents; personal.netCents = personal.incomeCents - personal.expenseCents;
    let claimed = 0n, received = 0n;
    const claimRows = extension.claims.map(row => { const paid = settled.get(row.id) || 0n; claimed += BigInt(row.amountCents); received += paid; return { ...row, settledCents: safe(paid), outstandingCents: safe(BigInt(row.amountCents) - paid) }; });
    const refundPlans = extension.refundPlans.map(row => { const paid = planReceived.get(row.id) || 0n; return { ...row, receivedCents: safe(paid), remainingCents: Math.max(0, row.expectedAmountCents - safe(paid)), receiptStatus: paid >= BigInt(row.expectedAmountCents) ? 'received' : paid > 0n ? 'partial' : 'unreceived' }; });
    const accountBalances = Object.create(null); let balanceTotal = 0n;
    for (const [key, value] of balances) { accountBalances[key] = safe(value); balanceTotal += value; }
    safe(balanceTotal);
    const result = { composites: (extension.composites || []).map(clone), accountFlows: Object.fromEntries(Object.entries(accountFlows).map(([key, value]) => [key, safe(value)])), cash: Object.fromEntries(Object.entries(cash).map(([key, value]) => [key, safe(value)])), personal: Object.fromEntries(Object.entries(personal).map(([key, value]) => [key, safe(value)])), receivables: { claimedCents: safe(claimed), settledCents: safe(received), outstandingCents: safe(claimed - received), claims: claimRows }, refundPlans, impacts, accountBalances, balanceTotalCents: safe(balanceTotal), excludedEvidence, drilldown: { cash: cashRows, personal: personalRows, accountFlows: accountFlowRows }, cashScope: 'external-cash-flows', accountFlowScope: 'actual-recorded-dates', transferRecognition: 'outgoing-date-once', month: month === undefined ? null : month, receivablesScope: 'all-current', balanceScope: 'all-recorded-transactions', assumptions: ASSUMPTIONS.slice() };
    // Finish every legacy guard above before invoking the derived leaf. The raw
    // personal drilldown remains a compatibility view, including transfer zeros.
    const engine = personalEventEngine(), events = engine.projectLegacy(personalFacts);
    result.personalExpenseEvents = month === undefined ? events.expenseEvents : engine.select(events.expenseEvents, { month });
    result.personalIncomeEvents = month === undefined ? events.incomeEvents : engine.select(events.incomeEvents, { month });
    const eventTotals = engine.reduce(result.personalExpenseEvents.concat(result.personalIncomeEvents));
    result.personal.incomeCents = eventTotals.incomeCents;
    result.personal.expenseCents = eventTotals.expenseCents;
    result.personal.netCents = eventTotals.netCents;
    return result;
  }
  function financialTotals(state) { const data = calculate(state); return { cash: data.cash, personal: data.personal, accountBalances: data.accountBalances }; }
  function prepareComposite(state, input, why) {
    shape(input, ['name', 'personalIds', 'fundingIds', 'paidCents', 'grossCents', 'discountCents'], '组合选择');
    const current = normalized(state), index = baseIndex(current), personalIds = compositeIds(input.personalIds), fundingIds = compositeIds(input.fundingIds);
    current.version = Math.max(current.version, 4);
    current.bookkeeping = { ...current.bookkeeping, version: COMPOSITE_VERSION, composites: current.bookkeeping.composites || [] };
    const signatures = [...new Set([...personalIds, ...fundingIds])].map(key => { const t = index.transactions.get(key); if (!t || t.type !== 'expense') fail('INVALID_COMPOSITE', '组合须引用已存在的支出记录'); return { id: t.id, ...signature(t) }; });
    return create(current, 'composite', { name: input.name, personalIds, fundingIds, paidCents: input.paidCents, grossCents: input.grossCents, discountCents: input.discountCents, reason: why, signatures }, why);
  }
  function reviewTicket(state, action, record, after, input) {
    const beforeData = validate(state.bookkeeping, state), afterData = validate(after.bookkeeping, after), beforeIndex = baseIndex(state), afterIndex = baseIndex(after);
    function totals(s, data, index, month) {
      const v = compute(s, data, index, month), byAccount = new Map(s.accounts.map(a => [a.id, { inflowCents: 0n, outflowCents: 0n, netCents: 0n }]));
      for (const row of v.drilldown.accountFlows) for (const movement of row.movements) { const a = byAccount.get(movement.accountId), n = BigInt(movement.signedCents); a.netCents += n; if (n > 0n) a.inflowCents += n; else a.outflowCents -= n; }
      const accountFlowsByAccount = Object.fromEntries([...byAccount].map(([key, row]) => [key, Object.fromEntries(Object.entries(row).map(([k,n]) => [k, safe(n)]))]));
      return { cash: v.cash, personal: v.personal, accountBalances: v.accountBalances, accountFlows: v.accountFlows, accountFlowsByAccount };
    }
    function snapshot(data, index, row) { const basis = balanceBasis(index, data, row.accountId, row.date), ledgerBalanceCents = basisBalance(basis, row.accountId, row.date); return { ledgerBalanceCents, differenceCents: safe(BigInt(row.actualBalanceCents) - BigInt(ledgerBalanceCents)), changed: !same(basis, row.basis) }; }
    const months = [...new Set(record.signatures.map(v => v.date.slice(0, 7)))].sort().map(month => ({ month, before: totals(state, beforeData, beforeIndex, month), after: totals(after, afterData, afterIndex, month) }));
    const snapshots = beforeData.snapshots.map(row => ({ id: row.id, accountId: row.accountId, date: row.date, before: snapshot(beforeData, beforeIndex, row), after: snapshot(afterData, afterIndex, row) }));
    const preview = frozen({ action, record: clone(record), before: totals(state, beforeData, beforeIndex), after: totals(after, afterData, afterIndex), months, snapshots, warnings: [
      '消费来源和真实资金来源由你分别确认；金额相等本身不能证明订单归属。',
      '保留每份原记录的金额、账户和日期；组合不生成交易，也不补差额。',
      '原价或优惠未知仍为空；优惠不是收入。',
      ...(action === 'remove-composite' ? ['撤销后恢复每份原记录的独立口径，可能重新出现待核对的重复金额。'] : [])
    ] });
    const basis = canonical(state), maxBytes = 32 * 1024 * 1024; if (basis.length > maxBytes) fail('RELATION_LIMIT', '组合复核依据过大');
    let bytes = 0; for (let i = 0; i < basis.length; i++) { const c = basis.charCodeAt(i); if (c < 128) bytes++; else if (c < 2048) bytes += 2; else if (c >= 55296 && c <= 56319 && basis.charCodeAt(i + 1) >= 56320 && basis.charCodeAt(i + 1) <= 57343) { bytes += 4; i++; } else bytes += 3; if (bytes > maxBytes) fail('RELATION_LIMIT', '组合复核依据过大'); }
    compositeTickets.set(preview, { basis, action, input: clone(input) }); return preview;
  }
  function previewComposite(state, input) {
    const next = prepareComposite(state, input, '预览待确认的消费与资金证据组合'), record = next.bookkeeping.composites.at(-1);
    return reviewTicket(state, 'create-composite', record, next, input);
  }
  function previewCompositeRemoval(state, compositeId) {
    const current = normalized(state), key = id(compositeId), record = (current.bookkeeping.composites || []).find(v => v.id === key);
    if (!record) fail('NOT_FOUND', '组合不存在');
    const next = change(current, 'composite', 'unlink', record, '预览撤销消费与资金证据组合');
    return reviewTicket(state, 'remove-composite', record, next, { compositeId: key });
  }
  function useCompositeTicket(state, preview, confirmation, action) {
    const ticket = compositeTickets.get(preview); compositeTickets.delete(preview);
    if (!ticket || ticket.action !== action) fail('INVALID_PREVIEW', '请重新预览组合，不能复用或复制确认对象');
    shape(confirmation, ['confirmed', 'reason'], '组合确认');
    if (confirmation.confirmed !== true) fail('CONFIRMATION_REQUIRED', '须核对两种来源并明确确认');
    const why = reason(confirmation.reason);
    if (canonical(state) !== ticket.basis) fail('STALE_REVIEW', '账本已变化，请重新预览并确认');
    return { ticket, why };
  }
  function createComposite(state, preview, confirmation) {
    const { ticket, why } = useCompositeTicket(state, preview, confirmation, 'create-composite');
    return prepareComposite(state, ticket.input, why);
  }
  function unlinkComposite(state, preview, confirmation) {
    const { ticket, why } = useCompositeTicket(state, preview, confirmation, 'remove-composite'), current = normalized(state), record = current.bookkeeping.composites.find(v => v.id === ticket.input.compositeId);
    if (!record) fail('NOT_FOUND', '组合不存在');
    return change(current, 'composite', 'unlink', record, why);
  }
  function compositeCandidates(state, input, options = {}) {
    shape(input, ['fundingIds', 'candidatePersonalIds'], '组合候选范围'); shape(options, ['maxResults', 'maxMembers', 'maxNodes'], '组合搜索限制');
    const maxResults = options.maxResults === undefined ? 20 : integer(options.maxResults, 1, LIMITS.candidates), maxMembers = options.maxMembers === undefined ? 6 : integer(options.maxMembers, 1, LIMITS.compositeMembers), maxNodes = options.maxNodes === undefined ? LIMITS.candidateNodes : integer(options.maxNodes, 1, LIMITS.candidateNodes);
    const data = validate(state.bookkeeping, state), index = baseIndex(state), context = transferContext(data), fundingIds = compositeIds(input.fundingIds), pool = array(input.candidatePersonalIds, LIMITS.candidatePool, '明确选择的候选来源').map(id);
    if (new Set(pool).size !== pool.length) fail('INVALID_COMPOSITE', '候选来源不能重复');
    const locked = new Set([...(state.obligations?.contracts || []).map(v => v.purchaseTransactionId), ...(state.obligations?.fees || []).map(v => v.transactionId)]);
    function source(key) { const t = index.transactions.get(key); if (!t || t.type !== 'expense' || context.shadows.has(key) || context.pairs.has(key) || context.composites.has(key) || locked.has(key)) fail('INVALID_COMPOSITE', '候选须为可用的主支出记录，不能占用转账、组合或信用义务证据'); return t; }
    const targetCents = safe(fundingIds.reduce((n, key) => n + BigInt(source(key).amountCents), 0n)); amount(targetCents);
    const rows = pool.map(source), candidates = []; let exploredNodes = 0, nodeLimited = false, resultLimited = false;
    function visit(start, selected, total) {
      if (exploredNodes >= maxNodes) { nodeLimited = true; return; } exploredNodes++;
      if (selected.length) {
        const sumCents = safe(total), differenceCents = targetCents - sumCents;
        const candidate = { personalIds: selected.slice(), fundingIds: fundingIds.slice(), sumCents, targetCents, differenceCents, exactMatch: differenceCents === 0, confirmed: false, reasons: [differenceCents === 0 ? '所选明细合计与资金合计精确相同' : '所选明细合计与资金合计存在差额', '来源范围由用户明确选择；金额关系不证明订单归属'], warnings: ['不会自动确认、补记差额或改变记录日期与账户'] };
        candidates.push(candidate); candidates.sort((a,b) => Math.abs(a.differenceCents) - Math.abs(b.differenceCents) || a.personalIds.length - b.personalIds.length || a.personalIds.join(',').localeCompare(b.personalIds.join(',')));
        if (candidates.length > maxResults) { candidates.pop(); resultLimited = true; }
      }
      if (selected.length >= maxMembers) return;
      for (let i = start; i < rows.length; i++) { if (exploredNodes >= maxNodes) { nodeLimited = true; break; } visit(i + 1, [...selected, rows[i].id], total + BigInt(rows[i].amountCents)); }
    }
    visit(0, [], 0n);
    return { fundingIds, candidatePersonalIds: pool, targetCents, candidates, exploredNodes, searchComplete: !nodeLimited && maxMembers >= rows.length, truncated: nodeLimited || resultLimited || maxMembers < rows.length, limits: { maxResults, maxMembers, maxNodes, pool: LIMITS.candidatePool }, reasons: ['只搜索明确选择的候选范围，按差额绝对值排序；不推断消费与资金角色', '受候选、组合大小和节点上限限制；没有精确候选不能证明缺账或归属错误'] };
  }

  function calculate(state, month) {
    if (month !== undefined && (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month) || !validDate(month + '-01'))) fail('INVALID_MONTH', '月份须为 YYYY-MM');
    const extension = validate(state.bookkeeping, state);
    return compute(state, extension, baseIndex(state), month);
  }
  function dependencies(state, transactionId) {
    const data = validate(state.bookkeeping, state), key = id(transactionId), result = [];
    for (const row of data.composites || []) if (row.signatures.some(v => v.id === key)) result.push({ kind: 'composite', id: row.id });
    for (const row of data.links) if (row.primaryId === key || row.shadowId === key) result.push({ kind: 'link', id: row.id });
    for (const row of data.transferPairs) if (row.expenseId === key || row.incomeId === key) result.push({ kind: 'transferPair', id: row.id });
    for (const row of data.refunds) if (row.incomeId === key || row.expenseId === key) result.push({ kind: 'refund', id: row.id });
    for (const row of data.claims) if (row.expenseId === key) result.push({ kind: 'claim', id: row.id });
    for (const row of data.settlements) if (row.incomeId === key) result.push({ kind: 'settlement', id: row.id });
    for (const row of data.refundPlans) if (row.expenseId === key) result.push({ kind: 'refundPlan', id: row.id });
    return result;
  }
  function sources(state, transactionId) {
    return state.imports && Array.isArray(state.imports.evidence) ? state.imports.evidence.filter(v => v.transactionId === transactionId).map(v => ({ evidenceId: v.id, sourceKey: v.sourceKey, channel: v.mapped && typeof v.mapped.channel === 'string' ? v.mapped.channel : null, status: v.status })) : [];
  }
  function candidates(state, transactionId) {
    const data = validate(state.bookkeeping, state), index = baseIndex(state), row = index.transactions.get(id(transactionId));
    if (!row) fail('NOT_FOUND', '交易不存在');
    const shadows = new Set(data.links.map(v => v.shadowId)), primaries = new Set(data.links.map(v => v.primaryId));
    const financialDependencies = new Set(data.refunds.flatMap(v => [v.expenseId, v.incomeId]).concat(data.claims.map(v => v.expenseId), data.settlements.map(v => v.incomeId), data.refundPlans.map(v => v.expenseId), data.transferPairs.flatMap(v => [v.expenseId, v.incomeId]), (data.composites || []).flatMap(v => v.signatures.map(t => t.id))));
    if (shadows.has(row.id)) return [];
    return [...index.transactions.values()].filter(v => v.id !== row.id && !shadows.has(v.id) && v.type === row.type && v.amountCents === row.amountCents).map(v => {
      const eligible = sameMovement(row, v) && !primaries.has(v.id), matchingBasis = ['金额相同', '收支方向相同'];
      if (row.date === v.date) matchingBasis.push('交易日期相同');
      if (row.accountId === v.accountId) matchingBasis.push('实际资金账户相同');
      if (row.type === 'transfer' && row.toAccountId === v.toAccountId) matchingBasis.push('转入账户相同');
      const warnings = ['相同金额与日期不能证明是同一笔交易，需要人工确认'];
      if (!sameMovement(row, v)) warnings.push('资金账户不同，须先核实并修正账户才能关联');
      if (primaries.has(v.id)) warnings.push('该记录已有附属证据，不能成为另一主记录的附属；请先选它作为主记录');
      if (financialDependencies.has(v.id)) warnings.push('候选记录已有转账配对、退款、应收、回款或待退款关联；保留这些关联时必须选它为主记录');
      if (financialDependencies.has(row.id)) warnings.push('当前记录已有账务关联；保留这些关联时必须继续作为主记录');
      if (financialDependencies.has(v.id) && (financialDependencies.has(row.id) || primaries.has(row.id))) warnings.push('两条记录都需要保留为主记录，请先核对并撤销其中一条的相关关联');
      if (row.date !== v.date) warnings.push('日期不同，现金流采用所选主记录日期');
      return { transactionId: v.id, date: v.date, amountCents: v.amountCents, accountId: v.accountId, eligible, confirmed: false, mustBePrimary: financialDependencies.has(v.id), matchingBasis, warnings, sources: sources(state, v.id) };
    }).sort((a, b) => Number(b.date === row.date) - Number(a.date === row.date) || Number(b.eligible) - Number(a.eligible) || a.date.localeCompare(b.date) || a.transactionId.localeCompare(b.transactionId));
  }
  function candidateLimit(options) {
    shape(options, ['limit', 'offset'], '候选选项');
    return options.limit === undefined ? 50 : integer(options.limit, 1, LIMITS.candidates);
  }
  function candidateOffset(options) { return options.offset === undefined ? 0 : integer(options.offset, 0, LIMITS.rows * 2 + 1); }
  function transferContext(data) {
    const shadows = new Set(data.links.map(v => v.shadowId)), pairs = new Map(), allocated = new Set();
    for (const pair of data.transferPairs) { pairs.set(pair.expenseId, pair); pairs.set(pair.incomeId, pair); }
    for (const collection of ['refunds', 'claims', 'settlements', 'refundPlans']) for (const row of data[collection]) for (const key of [row.expenseId, row.incomeId]) if (key) allocated.add(key);
    return { shadows, pairs, allocated, composites: compositeContext(data) }; 
  }
  function transferBlocker(row, context) {
    if (row.type === 'transfer') return '原记录已经是双边转账，不能再配对';
    if (context.shadows.has(row.id)) return '附属重复证据不能配对，请选择主记录';
    if (context.composites.has(row.id)) return '原记录已经属于消费与资金证据组合';
    if (context.pairs.has(row.id)) return '原记录已经属于已确认的本人账户转账';
    if (context.allocated.has(row.id)) return '原记录已有退款、应收、回款或待退款关联，须先核对';
    return null;
  }
  function transferCandidates(state, transactionId, options = {}) {
    const limit = candidateLimit(options), offset = candidateOffset(options), data = validate(state.bookkeeping, state), index = baseIndex(state), row = index.transactions.get(id(transactionId));
    if (!row) fail('NOT_FOUND', '交易不存在');
    const context = transferContext(data), blockedReason = transferBlocker(row, context), pair = context.pairs.get(row.id);
    if (blockedReason) return { transactionId: row.id, status: pair ? 'paired' : 'ineligible', counterpart: pair ? 'confirmed' : 'unknown', transferPairId: pair ? pair.id : null, candidates: [], matchingCount: 0, hasMore: false, offset, nextOffset: null, reason: blockedReason };
    const matches = [...index.transactions.values()].filter(v => v.id !== row.id && v.type !== row.type && v.type !== 'transfer' && v.amountCents === row.amountCents && v.accountId !== row.accountId && !transferBlocker(v, context)).sort((a, b) => Number(b.date === row.date) - Number(a.date === row.date) || a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    return { transactionId: row.id, status: 'unpaired', counterpart: 'unknown', transferPairId: null, matchingCount: matches.length, hasMore: matches.length > offset + limit, offset, nextOffset: matches.length > offset + limit ? offset + limit : null, reason: matches.length ? '仅发现等额、反向、不同本人账户候选；金额相同不能证明资金归属，须人工核对原始证据' : '未找到可配对的另一边；保持原记录与未知状态，不创建另一边或改动收支', candidates: matches.slice(offset, offset + limit).map(v => ({ transactionId: v.id, expenseId: row.type === 'expense' ? row.id : v.id, incomeId: row.type === 'income' ? row.id : v.id, date: v.date, amountCents: v.amountCents, accountId: v.accountId, confirmed: false, eligible: true, matchingBasis: ['金额完全相同', '一笔支出与一笔收入', '资金账户不同', ...(v.date === row.date ? ['交易日期相同'] : [])], warnings: ['须确认两个账户均为本人资金账户且确为同一次资金转移；候选不会自动关联', '手续费必须另记支出；缺少一边不自动补账', ...(v.date !== row.date ? ['原始日期分别保留，不把到账提前到转出日期'] : [])], sources: sources(state, v.id) })) };
  }
  // Read-only exact arithmetic hypotheses. A match is neither evidence of an error nor permission to adjust.
  function differenceCandidates(state, snapshotId, options = {}) {
    const limit = candidateLimit(options), offset = candidateOffset(options), data = validate(state.bookkeeping, state), index = baseIndex(state), snapshot = data.snapshots.find(v => v.id === id(snapshotId));
    if (!snapshot) fail('NOT_FOUND', '余额快照不存在');
    const current = balanceBasis(index, data, snapshot.accountId, snapshot.date), ledgerBalanceCents = basisBalance(current, snapshot.accountId, snapshot.date), differenceCents = safe(BigInt(snapshot.actualBalanceCents) - BigInt(ledgerBalanceCents));
    const context = transferContext(data), candidates = [], currentRows = new Map(current.transactions.map(v => [v.id, v])), oldRows = new Map(snapshot.basis.transactions.map(v => [v.id, v]));
    function push(kind, transactionIds, delta, reasons) {
      if (!differenceCents || BigInt(delta) !== BigInt(differenceCents)) return;
      candidates.push({ kind, transactionIds, differenceCents, hypotheticalBalanceChangeCents: differenceCents, exactMatch: true, confirmed: false, requiresEvidence: true, reasons, warnings: ['金额关系只是待核对假设，不能证明重复、漏记或方向错误；不会新增、删除或修改账目'] });
    }
    const changedIds = [...new Set([...currentRows.keys(), ...oldRows.keys()])].filter(key => !same(currentRows.get(key) || null, oldRows.get(key) || null)).sort();
    const capturedDelta = BigInt(snapshot.ledgerBalanceCents) - BigInt(ledgerBalanceCents);
    if (changedIds.length || snapshot.basis.openingBalanceCents !== current.openingBalanceCents) push('captured-basis-change', changedIds, capturedDelta, ['快照保存后账本依据发生变化', '若恢复保存时的全部依据，其余额差恰好等于当前差额；这不是恢复建议']);
    for (const row of [...currentRows.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
      const signed = BigInt(row.accountId === snapshot.accountId ? row.type === 'income' ? row.amountCents : -row.amountCents : row.amountCents);
      push('recorded-entry-removal-check', [row.id], -signed, ['若这笔已计入日终余额的记录经核实属于重复，移除其账户影响恰好等于差额', '须查看原始凭证与已有证据关联；配对或原生转账不能只删除其中一边']);
      if (row.type !== 'transfer' && !context.pairs.has(row.id) && !context.composites.has(row.id)) push('recorded-direction-check', [row.id], -2n * signed, ['若原记录的收入／支出方向经核实完全相反，差额应为原金额的两倍', '这是方向核对候选，金额相同不证明方向有误']);
    }
    for (const row of [...index.transactions.values()].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
      if (row.date > snapshot.date || row.accountId === snapshot.accountId || transferBlocker(row, context)) continue;
      const missingSide = row.type === 'expense' ? BigInt(row.amountCents) : -BigInt(row.amountCents);
      push('unpaired-other-account-leg', [row.id], missingSide, ['其他本人账户有未配对的等额反向资金记录', '只有确认另一边确实发生在本快照账户且不晚于快照日期时，缺失一边才能解释此差额；目前账户归属、日期与另一边均未知']);
    }
    const confirmedIntervals = (state.imports && Array.isArray(state.imports.coverage) ? state.imports.coverage : []).filter(v => v && v.accountId === snapshot.accountId && v.confirmed === true && validDate(v.start) && validDate(v.end) && v.start <= v.end && typeof v.sourceKey === 'string').map(v => ({ sourceKey: v.sourceKey, start: v.start, end: v.end })).sort((a, b) => a.sourceKey.localeCompare(b.sourceKey) || a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
    return { snapshotId: snapshot.id, accountId: snapshot.accountId, asOf: snapshot.date, actualBalanceCents: snapshot.actualBalanceCents, ledgerBalanceCents, differenceCents, status: differenceCents === 0 ? 'reconciled' : 'unresolved', candidates: candidates.slice(offset, offset + limit), matchingCount: candidates.length, hasMore: candidates.length > offset + limit, offset, nextOffset: candidates.length > offset + limit ? offset + limit : null, coverage: { status: 'unknown', confirmedIntervals, reason: '仅列用户确认的来源覆盖区间；无法据此证明本账户自期初以来完整，不能从首末交易日期推断完整覆盖' }, assumptions: ['只检查单笔精确金额关系和快照依据总差，不枚举任意交易组合', '重新配对转账、分配退款或应收本身不改变实际账户余额，不能用分类操作消除余额差额', '即使没有候选也不表示没有漏账；缺档、金额错误、日期错误和期初余额仍可能需要原始资料核对'] };
  }
  function reconciliation(state, snapshotId) {
    const data = validate(state.bookkeeping, state), row = data.snapshots.find(v => v.id === id(snapshotId));
    if (!row) fail('NOT_FOUND', '余额快照不存在');
    const basis = balanceBasis(baseIndex(state), data, row.accountId, row.date), ledgerBalanceCents = basisBalance(basis, row.accountId, row.date);
    return { snapshotId: row.id, accountId: row.accountId, asOf: row.date, actualBalanceCents: row.actualBalanceCents, ledgerBalanceCents, differenceCents: safe(BigInt(row.actualBalanceCents) - BigInt(ledgerBalanceCents)), capturedLedgerBalanceCents: row.ledgerBalanceCents, capturedDifferenceCents: safe(BigInt(row.actualBalanceCents) - BigInt(row.ledgerBalanceCents)), changed: !same(basis, row.basis), reconciled: row.actualBalanceCents === ledgerBalanceCents, note: row.note, assumptions: ASSUMPTIONS.slice() };
  }
  return Object.freeze({ VERSION, COMPOSITE_VERSION, MAX_AMOUNT_CENTS, LIMITS, RelationsError, defaultState, validate, compositeProof, previewComposite, createComposite, previewCompositeRemoval, unlinkComposite, compositeCandidates, linkEvidence, pairTransfer, transferCandidates, differenceCandidates, unlink, allocateRefund, createClaim, updateClaim, settleClaim, addRefundPlan, updateRefundPlan, addSnapshot, calculate, candidates, dependencies, reconciliation });
}));
