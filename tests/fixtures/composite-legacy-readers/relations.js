/* Deterministic local bookkeeping relationships. CNY integer cents, no network. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoneygoRelations = api;
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const VERSION = 2;
  const MAX_AMOUNT_CENTS = 999999999999;
  const LIMITS = Object.freeze({ rows: 10000, audit: 50000, snapshots: 100, candidates: 100, name: 80, note: 500, id: 100 });
  const COLLECTIONS = Object.freeze({ link: 'links', refund: 'refunds', claim: 'claims', settlement: 'settlements', snapshot: 'snapshots', refundPlan: 'refundPlans', transferPair: 'transferPairs' });
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
  function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.prototype.toString.call(value) !== '[object Object]') fail('INVALID_RELATIONS', label + '格式无效');
    return value;
  }
  function shape(value, keys, label) {
    object(value, label);
    if (Object.keys(value).some(key => !keys.includes(key))) fail('INVALID_RELATIONS', label + '含未知字段');
    return value;
  }
  function array(value, max, label) {
    if (!Array.isArray(value) || value.length > max) fail('RELATION_LIMIT', label + '数量或格式无效');
    for (let i = 0; i < value.length; i++) if (!Object.prototype.hasOwnProperty.call(value, i)) fail('INVALID_RELATIONS', label + '含空记录');
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
    shape(value, ['openingBalanceCents', 'transactions', 'excluded'], '对账依据');
    const rows = array(value.transactions, LIMITS.rows, '对账交易').map(v => financial(v, true));
    const seen = new Set(); for (const row of rows) { if (seen.has(row.id)) fail('DUPLICATE_ID', '对账交易重复'); seen.add(row.id); }
    const excluded = array(value.excluded, LIMITS.rows, '排除证据').map(v => { shape(v, ['shadowId', 'primaryId'], '排除证据'); return { shadowId: id(v.shadowId), primaryId: id(v.primaryId) }; });
    const shadows = new Set(); for (const row of excluded) { if (shadows.has(row.shadowId) || row.primaryId === row.shadowId || seen.has(row.shadowId)) fail('INVALID_RELATIONS', '对账排除证据重复'); shadows.add(row.shadowId); }
    return { openingBalanceCents: amount(value.openingBalanceCents, true, true), transactions: rows, excluded };
  }
  function normalizeRow(kind, value) {
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
    if (kind === 'link') return { ...row, primaryId: id(value.primaryId), shadowId: id(value.shadowId), reason: reason(value.reason), primarySignature: financial(value.primarySignature), shadowSignature: financial(value.shadowSignature) };
    if (kind === 'refund') return { ...row, incomeId: id(value.incomeId), expenseId: id(value.expenseId), amountCents: amount(value.amountCents), reason: reason(value.reason), planId: value.planId === null ? null : id(value.planId), incomeSignature: financial(value.incomeSignature), expenseSignature: financial(value.expenseSignature) };
    if (kind === 'settlement') return { ...row, incomeId: id(value.incomeId), claimId: id(value.claimId), amountCents: amount(value.amountCents), reason: reason(value.reason), expenseId: id(value.expenseId), incomeSignature: financial(value.incomeSignature), expenseSignature: financial(value.expenseSignature) };
    if (kind === 'claim') {
      if (!['reimbursement', 'advance'].includes(value.kind) || !['unsubmitted', 'incomplete', 'submitted'].includes(value.status)) fail('INVALID_RELATION_STATUS', '应收类型或提交状态无效');
      return { ...row, expenseId: id(value.expenseId), amountCents: amount(value.amountCents), kind: value.kind, name: name(value.name), dueDate: value.dueDate === null ? null : date(value.dueDate), status: value.status, note: note(value.note), expenseSignature: financial(value.expenseSignature) };
    }
    if (kind === 'refundPlan') {
      if (!['waiting', 'cancelled', 'closed'].includes(value.status)) fail('INVALID_RELATION_STATUS', '待退款状态无效');
      return { ...row, expenseId: id(value.expenseId), expectedAmountCents: amount(value.expectedAmountCents), dueDate: value.dueDate === null ? null : date(value.dueDate), status: value.status, note: note(value.note), expenseSignature: financial(value.expenseSignature) };
    }
    const snapshot = { ...row, accountId: id(value.accountId), date: date(value.date), actualBalanceCents: amount(value.actualBalanceCents, true, true), note: note(value.note), ledgerBalanceCents: integer(value.ledgerBalanceCents, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'INVALID_AMOUNT'), basis: basisValue(value.basis) };
    if (basisBalance(snapshot.basis, snapshot.accountId, snapshot.date) !== snapshot.ledgerBalanceCents) fail('INVALID_RELATIONS', '快照保存的账本余额与依据不一致');
    safe(BigInt(snapshot.actualBalanceCents) - BigInt(snapshot.ledgerBalanceCents));
    return snapshot;
  }
  function sameMovement(a, b) { return a.type === b.type && a.amountCents === b.amountCents && a.accountId === b.accountId && (a.type !== 'transfer' || a.toAccountId === b.toAccountId); }
  function addMap(map, key, value) { map.set(key, (map.get(key) || 0n) + BigInt(value)); }
  function balanceBasis(index, extension, accountId, asOf) {
    const shadows = new Set(extension.links.map(v => v.shadowId));
    const touches = value => value.accountId === accountId || value.toAccountId === accountId;
    const transactions = [...index.transactions.values()].filter(v => v.date <= asOf && touches(v) && !shadows.has(v.id)).map(v => ({ id: v.id, ...signature(v) })).sort((a, b) => a.id.localeCompare(b.id));
    const excluded = extension.links.filter(v => { const t = index.transactions.get(v.shadowId); return t.date <= asOf && touches(t); }).map(v => ({ shadowId: v.shadowId, primaryId: v.primaryId })).sort((a, b) => a.shadowId.localeCompare(b.shadowId));
    return { openingBalanceCents: index.accounts.get(accountId).openingBalanceCents, transactions, excluded };
  }
  function basisBalance(basis, accountId, asOf) {
    let result = BigInt(basis.openingBalanceCents);
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
    if (![1, VERSION].includes(value.version)) fail('INVALID_RELATIONS_VERSION', '不支持此关联版本');
    if (value.version === 1 && Object.prototype.hasOwnProperty.call(value, 'transferPairs')) fail('INVALID_RELATIONS_VERSION', '转账配对须使用新版关联格式');
    const result = defaultState(); result.revision = integer(value.revision, 0, LIMITS.audit);
    const activeIds = new Set();
    for (const [kind, collection] of Object.entries(COLLECTIONS)) {
      result[collection] = array(value.version === 1 && kind === 'transferPair' ? [] : value[collection], kind === 'snapshot' ? LIMITS.snapshots : LIMITS.rows, '关联列表').map(v => {
        const row = normalizeRow(kind, v); if (activeIds.has(row.id) || index.used.has(row.id)) fail('DUPLICATE_ID', '关联标识重复'); activeIds.add(row.id); return row;
      });
    }
    // Replay the journal. Active records cannot silently disappear or change outside an audited operation.
    const journal = new Map(), ever = new Set(), auditIds = new Set(), historicalUses = new Map();
    function historicalRefs(kind, row) {
      if (!row || kind === 'snapshot') return [];
      if (kind === 'link') return [{ id: row.shadowId, shadow: true }];
      return [...new Set([row.expenseId, row.incomeId].filter(Boolean))].map(id => ({ id, shadow: false }));
    }
    function changeHistoricalUses(kind, row, delta) {
      for (const ref of historicalRefs(kind, row)) {
        const uses = historicalUses.get(ref.id) || new Map(), label = kind === 'transferPair' ? 'pair' : ref.shadow ? 'shadow' : 'allocation';
        if (delta > 0 && ((label === 'pair' && uses.size) || (label !== 'pair' && uses.has('pair')))) fail('INVALID_RELATIONS_AUDIT', '转账配对历史与重复证据或金额分配重叠');
        const count = (uses.get(label) || 0) + delta; if (count > 0) uses.set(label, count); else uses.delete(label);
        if (uses.size) historicalUses.set(ref.id, uses); else historicalUses.delete(ref.id);
      }
    }
    result.audit = array(value.audit, LIMITS.audit, '关联历史').map((v, i) => {
      shape(v, ['id', 'revision', 'at', 'kind', 'recordId', 'action', 'reason', 'before', 'after'], '关联历史');
      const row = { id: id(v.id), revision: integer(v.revision, 1, LIMITS.audit), at: timestamp(v.at), kind: v.kind, recordId: id(v.recordId), action: v.action, reason: reason(v.reason), before: v.before === null ? null : normalizeRow(v.kind, v.before), after: v.after === null ? null : normalizeRow(v.kind, v.after) };
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
          journal.set(key, row.after);
        }
      }
      return row;
    });
    if (result.revision !== result.audit.length) fail('INVALID_RELATIONS_AUDIT', '关联版本与历史不一致');
    for (const key of ever) if (auditIds.has(key) || index.used.has(key)) fail('DUPLICATE_ID', '关联历史标识重复');
    for (const [kind, collection] of Object.entries(COLLECTIONS)) for (const row of result[collection]) {
      const key = kind + ':' + row.id;
      if (!journal.has(key) || !same(journal.get(key), row)) fail('INVALID_RELATIONS_AUDIT', '关联记录与操作历史不一致'); journal.delete(key);
    }
    if (journal.size) fail('INVALID_RELATIONS_AUDIT', '关联记录缺少明确撤销历史');
    const shadows = new Set(), primaries = new Set(), paired = new Set(), usedIncome = new Map(), usedExpense = new Map(), paidClaims = new Map(), paidPlans = new Map();
    function tx(key, type) {
      const row = index.transactions.get(key);
      if (!row || (type && row.type !== type)) fail('RELATION_REFERENCED', '关联交易不存在或收支方向已变化，请先撤销相关关联');
      if (shadows.has(key)) fail('RELATION_SHADOW', '重复证据不能再次分配金额，请使用主记录');
      if (paired.has(key)) fail('TRANSFER_PAIR_OVERLAP', '本人账户转账不能同时关联退款、应收、回款或待退款');
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
      if (paired.has(row.expenseId) || paired.has(row.incomeId)) fail('TRANSFER_PAIR_OVERLAP', '一笔原记录只能属于一个转账配对');
      const expense = tx(row.expenseId, 'expense'), income = tx(row.incomeId, 'income');
      unchanged(expense, row.expenseSignature); unchanged(income, row.incomeSignature);
      paired.add(row.expenseId); paired.add(row.incomeId);
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
    for (const event of state.bookkeeping.audit) { used.add(event.id); used.add(event.recordId); }
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
    if (!COLLECTIONS[kind]) fail('INVALID_RELATION_KIND', '关联种类无效');
    const current = normalized(state), row = current.bookkeeping[COLLECTIONS[kind]].find(v => v.id === id(recordId));
    if (!row) fail('NOT_FOUND', '要撤销的关联不存在');
    if ((kind === 'claim' && current.bookkeeping.settlements.some(v => v.claimId === row.id)) ||
        (kind === 'refundPlan' && current.bookkeeping.refunds.some(v => v.planId === row.id))) fail('RELATION_REFERENCED', '须先撤销关联的回款或退款，才能删除此记录');
    return change(current, kind, 'unlink', row, why);
  }
  function compute(state, extension, index, month) {
    const shadows = new Map(extension.links.map(v => [v.shadowId, v.primaryId]));
    const pairs = new Map(); for (const pair of extension.transferPairs) { pairs.set(pair.expenseId, pair); pairs.set(pair.incomeId, pair); }
    const refunds = new Map(), claims = new Map(), incomeRefunds = new Map(), incomeSettlements = new Map(), settled = new Map(), planReceived = new Map();
    for (const row of extension.refunds) { addMap(refunds, row.expenseId, row.amountCents); addMap(incomeRefunds, row.incomeId, row.amountCents); if (row.planId) addMap(planReceived, row.planId, row.amountCents); }
    for (const row of extension.claims) addMap(claims, row.expenseId, row.amountCents);
    for (const row of extension.settlements) { addMap(incomeSettlements, row.incomeId, row.amountCents); addMap(settled, row.claimId, row.amountCents); }
    const cash = { incomeCents: 0n, expenseCents: 0n, transferCents: 0n, netCents: 0n };
    const accountFlows = { inflowCents: 0n, outflowCents: 0n, transferInCents: 0n, transferOutCents: 0n, netCents: 0n };
    const personal = { incomeCents: 0n, expenseCents: 0n, transferCents: 0n, netCents: 0n, refundCents: 0n, claimCents: 0n };
    const balances = new Map([...index.accounts.values()].map(v => [v.id, BigInt(v.openingBalanceCents)]));
    const impacts = Object.create(null), excludedEvidence = [], cashRows = [], personalRows = [], accountFlowRows = [];
    for (const row of index.transactions.values()) {
      const excluded = shadows.has(row.id), active = !excluded, pair = pairs.get(row.id) || null;
      const refundCents = safe(refunds.get(row.id) || 0n), claimCents = safe(claims.get(row.id) || 0n);
      const cashIncomeCents = active && !pair && row.type === 'income' ? row.amountCents : 0;
      const cashExpenseCents = active && !pair && row.type === 'expense' ? row.amountCents : 0;
      const transferCents = active && (row.type === 'transfer' || pair && row.type === 'expense') ? row.amountCents : 0;
      const transferOutCents = transferCents, transferInCents = active && (row.type === 'transfer' || pair && row.type === 'income') ? row.amountCents : 0;
      const accountInflowCents = cashIncomeCents + transferInCents, accountOutflowCents = cashExpenseCents + transferOutCents;
      const ordinaryIncomeCents = row.type === 'income' && active && !pair ? safe(BigInt(row.amountCents) - (incomeRefunds.get(row.id) || 0n) - (incomeSettlements.get(row.id) || 0n)) : 0;
      const personalExpenseCents = row.type === 'expense' && active && !pair ? row.amountCents - refundCents - claimCents : 0;
      const impact = { transactionId: row.id, date: row.date, type: row.type, excluded, primaryId: shadows.get(row.id) || null, cashIncomeCents, cashExpenseCents, cashSignedCents: cashIncomeCents - cashExpenseCents, transferCents, transferInCents, transferOutCents, accountInflowCents, accountOutflowCents, accountSignedCents: accountInflowCents - accountOutflowCents, transferPairId: pair ? pair.id : null, transferRole: pair ? row.type === 'expense' ? 'out' : 'in' : null, ordinaryIncomeCents, personalExpenseCents, refundCents, claimCents, receivedRefundCents: safe(incomeRefunds.get(row.id) || 0n), settlementCents: safe(incomeSettlements.get(row.id) || 0n), allocatedIncomeCents: safe((incomeRefunds.get(row.id) || 0n) + (incomeSettlements.get(row.id) || 0n)), availableIncomeCents: ordinaryIncomeCents, refundableExpenseCents: personalExpenseCents };
      impacts[row.id] = impact;
      if (active) {
        addMap(balances, row.accountId, row.type === 'income' ? row.amountCents : -row.amountCents);
        if (row.type === 'transfer') addMap(balances, row.toAccountId, row.amountCents);
      }
      if (month !== undefined && row.date.slice(0, 7) !== month) continue;
      if (excluded) { excludedEvidence.push({ transactionId: row.id, primaryId: shadows.get(row.id), type: row.type, amountCents: row.amountCents, date: row.date }); continue; }
      accountFlows.inflowCents += BigInt(accountInflowCents); accountFlows.outflowCents += BigInt(accountOutflowCents); accountFlows.transferInCents += BigInt(transferInCents); accountFlows.transferOutCents += BigInt(transferOutCents);
      cash.incomeCents += BigInt(cashIncomeCents); cash.expenseCents += BigInt(cashExpenseCents); cash.transferCents += BigInt(transferCents);
      personal.incomeCents += BigInt(ordinaryIncomeCents); personal.expenseCents += BigInt(personalExpenseCents); personal.transferCents += BigInt(transferCents); personal.refundCents += BigInt(refundCents); personal.claimCents += BigInt(claimCents);
      accountFlowRows.push({ transactionId: row.id, date: row.date, type: row.type, transferPairId: pair ? pair.id : null, transferRole: pair ? row.type === 'expense' ? 'out' : 'in' : null, accountId: row.accountId, toAccountId: row.toAccountId, accountInflowCents, accountOutflowCents, transferInCents, transferOutCents, movements: [{ accountId: row.accountId, signedCents: row.type === 'income' ? row.amountCents : -row.amountCents }, ...(row.type === 'transfer' ? [{ accountId: row.toAccountId, signedCents: row.amountCents }] : [])] });
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
    return { accountFlows: Object.fromEntries(Object.entries(accountFlows).map(([key, value]) => [key, safe(value)])), cash: Object.fromEntries(Object.entries(cash).map(([key, value]) => [key, safe(value)])), personal: Object.fromEntries(Object.entries(personal).map(([key, value]) => [key, safe(value)])), receivables: { claimedCents: safe(claimed), settledCents: safe(received), outstandingCents: safe(claimed - received), claims: claimRows }, refundPlans, impacts, accountBalances, balanceTotalCents: safe(balanceTotal), excludedEvidence, drilldown: { cash: cashRows, personal: personalRows, accountFlows: accountFlowRows }, cashScope: 'external-cash-flows', accountFlowScope: 'actual-recorded-dates', transferRecognition: 'outgoing-date-once', month: month === undefined ? null : month, receivablesScope: 'all-current', balanceScope: 'all-recorded-transactions', assumptions: ASSUMPTIONS.slice() };
  }
  function calculate(state, month) {
    if (month !== undefined && (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month) || !validDate(month + '-01'))) fail('INVALID_MONTH', '月份须为 YYYY-MM');
    const extension = validate(state.bookkeeping, state);
    return compute(state, extension, baseIndex(state), month);
  }
  function dependencies(state, transactionId) {
    const data = validate(state.bookkeeping, state), key = id(transactionId), result = [];
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
    const financialDependencies = new Set(data.refunds.flatMap(v => [v.expenseId, v.incomeId]).concat(data.claims.map(v => v.expenseId), data.settlements.map(v => v.incomeId), data.refundPlans.map(v => v.expenseId), data.transferPairs.flatMap(v => [v.expenseId, v.incomeId])));
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
    return { shadows, pairs, allocated };
  }
  function transferBlocker(row, context) {
    if (row.type === 'transfer') return '原记录已经是双边转账，不能再配对';
    if (context.shadows.has(row.id)) return '附属重复证据不能配对，请选择主记录';
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
      if (row.type !== 'transfer' && !context.pairs.has(row.id)) push('recorded-direction-check', [row.id], -2n * signed, ['若原记录的收入／支出方向经核实完全相反，差额应为原金额的两倍', '这是方向核对候选，金额相同不证明方向有误']);
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
  return Object.freeze({ VERSION, MAX_AMOUNT_CENTS, LIMITS, RelationsError, defaultState, validate, linkEvidence, pairTransfer, transferCandidates, differenceCandidates, unlink, allocateRefund, createClaim, updateClaim, settleClaim, addRefundPlan, updateRefundPlan, addSnapshot, calculate, candidates, dependencies, reconciliation });
}));
