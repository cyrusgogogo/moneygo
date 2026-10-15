/* Deterministic, local-only organization and frozen reporting. All money is integer CNY cents. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoneygoOrganizer = api;
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const VERSION = 2, COMPOSITE_VERSION = 3, LEDGER_VERSION = 5, MAX_AMOUNT_CENTS = 999999999999;
  const LIMITS = Object.freeze({ rules: 200, aliases: 500, rows: 10000, previewMatches: 50000, previewBytes: 16 * 1024 * 1024, scopes: 500, reviews: 10000, batches: 200, closes: 36, audit: 2000, compositeProofCells: 40000, compositeHistoryCells: 160000, bytes: 16 * 1024 * 1024, backupBytes: 32 * 1024 * 1024 });
  const COLLECTIONS = ['rules', 'aliases', 'merchants', 'batches', 'scopes', 'reviews', 'closes'];
  const tickets = new WeakMap();
  class OrganizerError extends Error { constructor(code, message) { super(message); this.name = 'OrganizerError'; this.code = code; } }
  function fail(code, message) { throw new OrganizerError(code, message); }
  function object(v) { if (!v || typeof v !== 'object' || Array.isArray(v)) fail('INVALID_ORGANIZER', '整理数据须为对象'); const proto = Object.getPrototypeOf(v); if (proto !== null && Object.getPrototypeOf(proto) !== null) fail('INVALID_ORGANIZER', '整理记录不能继承自其他数据记录'); for (const key of Reflect.ownKeys(v)) { const d = Object.getOwnPropertyDescriptor(v, key); if (typeof key !== 'string' || !d.enumerable || !Object.prototype.hasOwnProperty.call(d, 'value')) fail('INVALID_ORGANIZER', '整理字段必须是普通可枚举数据'); } return v; }
  function shape(v, keys) { object(v); if (Object.keys(v).some(k => !keys.includes(k)) || keys.some(k => k in v && !Object.prototype.hasOwnProperty.call(v, k))) fail('INVALID_ORGANIZER', '整理数据含未知字段'); return v; }
  function array(v, limit) { if (!Array.isArray(v) || v.length > limit) fail('ORGANIZER_LIMIT', '整理记录数量超过上限或格式无效'); for (let i = 0; i < v.length; i++) { const d = Object.getOwnPropertyDescriptor(v, String(i)); if (!d || !d.enumerable || !Object.prototype.hasOwnProperty.call(d, 'value')) fail('INVALID_ORGANIZER', '整理记录含空项或非普通数据'); } if (Reflect.ownKeys(v).length !== v.length + 1) fail('INVALID_ORGANIZER', '数组包含未知属性'); return v; }
  function text(v, max = 500, empty = false) { if (typeof v !== 'string' || v.length > max || (!empty && !v.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) fail('INVALID_ORGANIZER', '文字为空、过长或包含控制字符'); return v; }
  function id(v) { if (typeof v !== 'string' || v.length > 100 || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(v) || ['constructor', 'prototype'].includes(v)) fail('INVALID_ID', '整理标识无效'); return v; }
  function integer(v, min = 0, max = Number.MAX_SAFE_INTEGER) { if (!Number.isSafeInteger(v) || v < min || v > max) fail('INVALID_AMOUNT', '数值必须是范围内的安全整数'); return v === 0 ? 0 : v; }
  function cents(v, signed = false) { return integer(v, signed ? -MAX_AMOUNT_CENTS : 0, MAX_AMOUNT_CENTS); }
  function safe(v) { if (v < BigInt(Number.MIN_SAFE_INTEGER) || v > BigInt(Number.MAX_SAFE_INTEGER)) fail('AMOUNT_OVERFLOW', '金额合计超出安全范围'); return Number(v); }
  function date(v) { if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail('INVALID_DATE', '日期须为 YYYY-MM-DD'); const y = +v.slice(0, 4), m = +v.slice(5, 7), d = +v.slice(8); if (y < 1 || m < 1 || m > 12 || d < 1 || d > [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]) fail('INVALID_DATE', '日期无效'); return v; }
  function month(v) { if (typeof v !== 'string' || !/^\d{4}-\d{2}$/.test(v)) fail('INVALID_MONTH', '月份须为 YYYY-MM'); date(v + '-01'); return v; }
  function timestamp(v) { if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v) fail('INVALID_DATE', '操作时间须为 UTC ISO 时间'); date(v.slice(0, 10)); return v; }
  function bool(v) { if (typeof v !== 'boolean') fail('INVALID_ORGANIZER', '需要明确的是或否'); return v; }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function canonical(v) { if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'; if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}'; return JSON.stringify(v); }
  function same(a, b) { return canonical(a) === canonical(b); }
  function frozen(v) { if (v && typeof v === 'object') { Object.freeze(v); Object.values(v).forEach(frozen); } return v; }
  function byteLength(v) { return new TextEncoder().encode(v).length; }
  function bounded(v, limit = LIMITS.bytes) { let encoded; try { encoded = JSON.stringify(v); } catch (_) { fail('INVALID_ORGANIZER', '数据不能编码为 JSON'); } if (byteLength(encoded) > limit) fail('ORGANIZER_LIMIT', '整理记录超过备份大小上限'); return v; }
  function defaultState() { return { version: VERSION, revision: 0, rules: [], aliases: [], merchants: [], batches: [], scopes: [], reviews: [], closes: [], audit: [] }; }
  function txSnapshot(v) {
    shape(v, ['id', 'type', 'date', 'amountCents', 'accountId', 'toAccountId', 'categoryId', 'note']);
    if (!['income', 'expense', 'transfer'].includes(v.type)) fail('INVALID_TYPE', '交易方向无效');
    const out = { id: id(v.id), type: v.type, date: date(v.date), amountCents: integer(v.amountCents, 1, MAX_AMOUNT_CENTS), accountId: id(v.accountId), note: text(v.note === undefined ? '' : v.note, 500, true) };
    if (v.type === 'transfer') { out.toAccountId = id(v.toAccountId); if (v.categoryId !== undefined || out.toAccountId === out.accountId) fail('INVALID_REFERENCE', '转账账户或分类无效'); }
    else { out.categoryId = id(v.categoryId); if (v.toAccountId !== undefined) fail('INVALID_REFERENCE', '普通收支不能有转入账户'); }
    return out;
  }
  function transaction(v) { object(v); return txSnapshot(Object.fromEntries(['id', 'type', 'date', 'amountCents', 'accountId', 'toAccountId', 'categoryId', 'note'].filter(k => v[k] !== undefined).map(k => [k, v[k]]))); }
  function baseIndex(state) {
    object(state); if (![1, 2, 3, 4, 5, 6].includes(state.version) || (state.version === 5 && state.organizer === undefined) || (state.version === 6 && state.obligations === undefined)) fail('INVALID_VERSION', '账本版本无效'); if (state.currency !== 'CNY') fail('INVALID_CURRENCY', '整理仅支持 CNY');
    const accounts = new Map(), categories = new Map(), transactions = new Map(), allTransactions = new Map(), used = new Set(), sources = new Set();
    const unique = key => { if (used.has(key)) fail('DUPLICATE_ID', '记录标识重复'); used.add(key); };
    for (const a of array(state.accounts, 100)) { object(a); unique(id(a.id)); cents(a.openingBalanceCents, true); accounts.set(a.id, a); }
    if (!accounts.size) fail('INVALID_REFERENCE', '至少保留一个账户');
    for (const c of array(state.categories, 200)) { object(c); unique(id(c.id)); if (!['expense', 'income'].includes(c.type)) fail('INVALID_TYPE', '分类方向无效'); categories.set(c.id, c); }
    function add(v, active) { const t = transaction(v); unique(t.id); if (!accounts.has(t.accountId) || (t.type === 'transfer' ? !accounts.has(t.toAccountId) : categories.get(t.categoryId)?.type !== t.type)) fail('INVALID_REFERENCE', '交易引用无效'); allTransactions.set(t.id, t); if (active) transactions.set(t.id, t); }
    for (const t of array(state.transactions, LIMITS.rows)) add(t, true);
    for (const t of array(state.trash || [], LIMITS.rows)) add(t.transaction, false);
    if (allTransactions.size > LIMITS.rows) fail('ORGANIZER_LIMIT', '交易含回收区超过上限');
    const imports = state.imports;
    if (imports) for (const collection of ['templates', 'evidence', 'quarantine', 'coverage']) for (const row of array(imports[collection] || [], LIMITS.rows)) if (row.sourceKey || row.config?.sourceKey) sources.add(text(row.sourceKey || row.config.sourceKey, 100));
    return { accounts, categories, transactions, allTransactions, used, sources };
  }
  function conditions(v) {
    shape(v, ['note', 'sourceKey', 'accountId', 'type', 'minAmountCents', 'maxAmountCents', 'startDate', 'endDate']); if (!Object.keys(v).length) fail('INVALID_RULE', '规则至少需要一个明确条件');
    const out = {};
    if (v.note !== undefined) { shape(v.note, ['operator', 'value', 'caseSensitive']); if (!['contains', 'equals'].includes(v.note.operator)) fail('INVALID_RULE', '备注仅支持包含或相等'); out.note = { operator: v.note.operator, value: text(v.note.value), caseSensitive: bool(v.note.caseSensitive) }; }
    if (v.sourceKey !== undefined) out.sourceKey = text(v.sourceKey, 100);
    if (v.accountId !== undefined) out.accountId = id(v.accountId);
    if (v.type !== undefined) { if (!['income', 'expense'].includes(v.type)) fail('INVALID_TYPE', '分类规则仅适用于普通收支'); out.type = v.type; }
    for (const key of ['minAmountCents', 'maxAmountCents']) if (v[key] !== undefined) out[key] = cents(v[key]);
    for (const key of ['startDate', 'endDate']) if (v[key] !== undefined) out[key] = date(v[key]);
    if (out.minAmountCents !== undefined && out.maxAmountCents !== undefined && out.minAmountCents > out.maxAmountCents) fail('INVALID_RULE', '金额条件上下界颠倒');
    if (out.startDate && out.endDate && out.startDate > out.endDate) fail('INVALID_RULE', '日期条件上下界颠倒');
    return out;
  }
  function normalizeRule(v) { shape(v, ['id', 'name', 'enabled', 'conditions', 'actions']); shape(v.actions, ['categoryId', 'merchant']); const actions = { categoryId: id(v.actions.categoryId) }; if (v.actions.merchant !== undefined) actions.merchant = text(v.actions.merchant, 80); return { id: id(v.id), name: text(v.name, 80), enabled: bool(v.enabled), conditions: conditions(v.conditions), actions }; }
  function normalizeAlias(v) { shape(v, ['id', 'from', 'to', 'caseSensitive', 'enabled', 'sourceKey', 'accountId']); const out = { id: id(v.id), from: text(v.from), to: text(v.to, 80), caseSensitive: bool(v.caseSensitive), enabled: bool(v.enabled) }; if (v.sourceKey !== undefined) out.sourceKey = text(v.sourceKey, 100); if (v.accountId !== undefined) out.accountId = id(v.accountId); return out; }
  function normalizeMerchant(v) { shape(v, ['transactionId', 'merchant', 'batchId']); return { transactionId: id(v.transactionId), merchant: text(v.merchant, 80), batchId: id(v.batchId) }; }
  function normalizeScope(v) { shape(v, ['id', 'sourceKey', 'accountId', 'included', 'reason', 'confirmed', 'updatedAt']); if (v.confirmed !== true) fail('INVALID_SCOPE', '范围须由用户确认'); return { id: id(v.id), sourceKey: text(v.sourceKey, 100), accountId: id(v.accountId), included: bool(v.included), reason: text(v.reason), confirmed: true, updatedAt: timestamp(v.updatedAt) }; }
  function normalizeReview(v) { shape(v, ['key', 'deferUntil', 'rank', 'reason', 'updatedAt']); return { key: text(v.key, 200), deferUntil: v.deferUntil === null ? null : date(v.deferUntil), rank: v.rank === null ? null : integer(v.rank, 0, 1000000), reason: text(v.reason), updatedAt: timestamp(v.updatedAt) }; }
  function normalizeChange(v) {
    shape(v, ['transactionId', 'before', 'after', 'merchantBefore', 'merchantAfter', 'matches', 'selectedRuleId']);
    const out = { transactionId: id(v.transactionId), before: txSnapshot(v.before), after: txSnapshot(v.after), merchantBefore: v.merchantBefore === null ? null : normalizeMerchant(v.merchantBefore), merchantAfter: v.merchantAfter === null ? null : normalizeMerchant(v.merchantAfter), matches: array(v.matches, LIMITS.aliases).map(id), selectedRuleId: id(v.selectedRuleId) };
    const a = { ...out.before }, b = { ...out.after }; delete a.categoryId; delete b.categoryId;
    if (out.before.id !== out.transactionId || out.after.id !== out.transactionId || !same(a, b) || !out.matches.includes(out.selectedRuleId) || new Set(out.matches).size !== out.matches.length || (out.merchantBefore && out.merchantBefore.transactionId !== out.transactionId) || (out.merchantAfter && out.merchantAfter.transactionId !== out.transactionId)) fail('INVALID_BATCH', '整理只允许修改分类及单独商户元数据');
    return out;
  }
  function normalizeBatch(v) {
    shape(v, ['id', 'kind', 'createdAt', 'reason', 'definitions', 'changes', 'rolledBack', 'rolledBackAt']); if (!['rules', 'aliases'].includes(v.kind)) fail('INVALID_BATCH', '整理批次类型无效');
    const out = { id: id(v.id), kind: v.kind, createdAt: timestamp(v.createdAt), reason: text(v.reason), definitions: array(v.definitions, v.kind === 'rules' ? LIMITS.rules : LIMITS.aliases).map(v.kind === 'rules' ? normalizeRule : normalizeAlias), changes: array(v.changes, LIMITS.rows).map(normalizeChange), rolledBack: bool(v.rolledBack), rolledBackAt: v.rolledBackAt === null ? null : timestamp(v.rolledBackAt) };
    if (out.rolledBack !== (out.rolledBackAt !== null) || !out.changes.length) fail('INVALID_BATCH', '整理撤销状态无效');
    const defs = new Map(out.definitions.map(d => [d.id, d])), seen = new Set(); if (defs.size !== out.definitions.length) fail('DUPLICATE_ID', '规则快照重复');
    for (const c of out.changes) { if (seen.has(c.transactionId) || c.matches.some(key => !defs.has(key)) || (c.merchantAfter && c.merchantAfter.batchId !== out.id)) fail('INVALID_BATCH', '整理批次引用无效'); seen.add(c.transactionId); const chosen = defs.get(c.selectedRuleId); if (!chosen.enabled || out.definitions.some(d => !d.enabled)) fail('INVALID_BATCH', '应用快照不能包含已停用的规则'); if (out.kind === 'rules') { if (c.after.categoryId !== chosen.actions.categoryId || (chosen.actions.merchant !== undefined && c.merchantAfter?.merchant !== chosen.actions.merchant)) fail('INVALID_BATCH', '应用值与规则快照不一致'); } else if (!same(c.before, c.after) || c.merchantAfter?.merchant !== chosen.to) fail('INVALID_BATCH', '商户别名不能改变原始交易'); }
    return out;
  }
  function normalizeImpact(v) { shape(v, ['cashIncomeCents', 'cashExpenseCents', 'transferCents', 'ordinaryIncomeCents', 'personalExpenseCents', 'refundCents', 'claimCents']); return Object.fromEntries(Object.keys(v).map(k => [k, cents(v[k])])); }
  // Frozen transfer proof is self-contained; replay never depends on live records or links.
  function transferPairSnapshot(v) {
    shape(v, ['id', 'createdAt', 'expenseId', 'incomeId', 'amountCents', 'reason', 'expenseSignature', 'incomeSignature']);
    function signature(v, type) { shape(v, ['type', 'date', 'amountCents', 'accountId', 'toAccountId']); if (v.type !== type || v.toAccountId !== null) fail('INVALID_CLOSE', '冻结转账原记录方向无效'); return { type, date: date(v.date), amountCents: integer(v.amountCents, 1, MAX_AMOUNT_CENTS), accountId: id(v.accountId), toAccountId: null }; }
    const p = { id: id(v.id), createdAt: timestamp(v.createdAt), expenseId: id(v.expenseId), incomeId: id(v.incomeId), amountCents: integer(v.amountCents, 1, MAX_AMOUNT_CENTS), reason: text(v.reason), expenseSignature: signature(v.expenseSignature, 'expense'), incomeSignature: signature(v.incomeSignature, 'income') };
    if (new Set([p.id, p.expenseId, p.incomeId]).size !== 3 || p.expenseSignature.accountId === p.incomeSignature.accountId || p.amountCents !== p.expenseSignature.amountCents || p.amountCents !== p.incomeSignature.amountCents) fail('INVALID_CLOSE', '冻结转账双边金额或本人账户不符');
    return p;
  }
  // Count compact proof cells before normalization, cloning or journal comparison.
  // The history budget includes both current snapshots and their immutable journal copies.
  function compositeProofCells(v) {
    if (!Object.prototype.hasOwnProperty.call(v, 'compositeProofs')) return 0;
    let cells = 0;
    const proofs = array(v.compositeProofs, LIMITS.rows);
    if (!proofs.length) fail('INVALID_CLOSE', '组合依据不能为空；普通月结无需此字段');
    for (const p of proofs) {
      object(p);
      cells += 1 + array(p.personalIds, 20).length + array(p.fundingIds, 20).length + array(p.signatures, 40).length;
      if (cells > LIMITS.compositeProofCells) fail('ORGANIZER_LIMIT', '单次月结的组合依据超过上限');
    }
    return cells;
  }
  function preflightCompositeHistory(input) {
    let cells = 0;
    function inspect(v) {
      object(v);
      const rows = array(v.rows, LIMITS.rows);
      if (input.version < COMPOSITE_VERSION && (Object.prototype.hasOwnProperty.call(v, 'compositeProofs') || rows.some(r => { object(r); return Object.prototype.hasOwnProperty.call(r, 'compositeId'); }))) fail('INVALID_ORGANIZER_VERSION', '冻结组合依据须使用新版整理格式');
      cells += compositeProofCells(v);
      if (cells > LIMITS.compositeHistoryCells) fail('ORGANIZER_LIMIT', '月结及历史的组合依据超过总上限');
    }
    for (const close of array(input.closes, LIMITS.closes)) inspect(close);
    for (const entry of array(input.audit, LIMITS.audit)) {
      object(entry);
      for (const change of array(entry.changes, LIMITS.rows + 1)) { object(change); if (change.collection === 'closes') { if (change.before !== null) inspect(change.before); if (change.after !== null) inspect(change.after); } }
    }
    return cells;
  }
  function compositeContext(v) {
    compositeProofCells(v);
    const proofs = [], byId = new Map(), byMember = new Map();
    if (Object.prototype.hasOwnProperty.call(v, 'compositeProofs')) {
      const engine = relationEngine();
      if (typeof engine.compositeProof !== 'function') fail('RELATIONS_UNAVAILABLE', '冻结组合依据需要新版账务关系模块');
      for (const value of v.compositeProofs) {
        const proof = engine.compositeProof(value);
        if (byId.has(proof.id)) fail('INVALID_CLOSE', '冻结组合依据标识重复');
        const context = { proof, personal: new Set(proof.personalIds), funding: new Set(proof.fundingIds), signatures: new Map(proof.signatures.map(s => [s.id, s])) };
        proofs.push(proof); byId.set(proof.id, context);
        for (const key of context.signatures.keys()) { if (byMember.has(key)) fail('INVALID_CLOSE', '同一冻结交易不能属于多个组合'); byMember.set(key, context); }
      }
      for (const key of byMember.keys()) if (byId.has(key)) fail('INVALID_CLOSE', '冻结组合标识与成员交易重复');
    }
    return { proofs, byId, byMember };
  }
  function frozenRow(v, composites) {
    shape(v, ['transaction', 'merchant', 'sources', 'impact', 'transferPair', 'compositeId']);
    const out = { transaction: txSnapshot(v.transaction), merchant: v.merchant === null ? null : text(v.merchant, 80), sources: array(v.sources, LIMITS.rows).map(s => { shape(s, ['evidenceId', 'sourceKey']); return { evidenceId: id(s.evidenceId), sourceKey: text(s.sourceKey, 100) }; }), impact: normalizeImpact(v.impact) };
    if (Object.keys(out.impact).length !== 7) fail('INVALID_CLOSE', '月结影响字段缺失');
    const t = out.transaction, p = out.impact;
    if (Object.prototype.hasOwnProperty.call(v, 'compositeId')) {
      const key = id(v.compositeId), context = composites.byId.get(key), captured = context?.signatures.get(t.id);
      if (v.transferPair !== undefined || !captured || !same(captured, { id: t.id, type: t.type, date: t.date, amountCents: t.amountCents, accountId: t.accountId, toAccountId: null })) fail('INVALID_CLOSE', '冻结组合成员、资金签名或关联依据不符');
      if (p.cashIncomeCents !== 0 || p.ordinaryIncomeCents !== 0 || p.transferCents !== 0 || p.cashExpenseCents !== (context.funding.has(t.id) ? t.amountCents : 0) || p.personalExpenseCents + p.refundCents + p.claimCents !== (context.personal.has(t.id) ? t.amountCents : 0)) fail('INVALID_CLOSE', '冻结组合的个人与资金口径不守恒');
      out.compositeId = key;
    } else if (v.transferPair !== undefined) {
      const pair = transferPairSnapshot(v.transferPair), outgoing = t.id === pair.expenseId;
      if (!outgoing && t.id !== pair.incomeId) fail('INVALID_CLOSE', '冻结交易不属于所存转账');
      const captured = outgoing ? pair.expenseSignature : pair.incomeSignature;
      if (!same(captured, { type: t.type, date: t.date, amountCents: t.amountCents, accountId: t.accountId, toAccountId: null }) || p.cashIncomeCents !== 0 || p.cashExpenseCents !== 0 || p.ordinaryIncomeCents !== 0 || p.personalExpenseCents !== 0 || p.refundCents !== 0 || p.claimCents !== 0 || p.transferCents !== (outgoing ? pair.amountCents : 0)) fail('INVALID_CLOSE', '冻结转账签名或个人、现金口径不守恒');
      out.transferPair = pair;
    } else if (p.cashIncomeCents !== (t.type === 'income' ? t.amountCents : 0) || p.cashExpenseCents !== (t.type === 'expense' ? t.amountCents : 0) || p.transferCents !== (t.type === 'transfer' ? t.amountCents : 0) || p.ordinaryIncomeCents > p.cashIncomeCents || p.personalExpenseCents + p.refundCents + p.claimCents !== p.cashExpenseCents) fail('INVALID_CLOSE', '月结现金与个人口径不守恒');
    return out;
  }
  function sums(rows) {
    const cash = { incomeCents: 0n, expenseCents: 0n, transferCents: 0n }, personal = { incomeCents: 0n, expenseCents: 0n, transferCents: 0n, refundCents: 0n, claimCents: 0n }, categories = new Map();
    for (const row of rows) { const p = row.impact, t = row.transaction; cash.incomeCents += BigInt(p.cashIncomeCents); cash.expenseCents += BigInt(p.cashExpenseCents); cash.transferCents += BigInt(p.transferCents); personal.incomeCents += BigInt(p.ordinaryIncomeCents); personal.expenseCents += BigInt(p.personalExpenseCents); personal.transferCents += BigInt(p.transferCents); personal.refundCents += BigInt(p.refundCents); personal.claimCents += BigInt(p.claimCents); if (t.type !== 'transfer') { const key = t.categoryId; const cat = categories.get(key) || { categoryId: key, type: t.type, cashCents: 0n, personalCents: 0n }; if (cat.type !== t.type) fail('INVALID_CLOSE', '同一分类出现相反方向'); cat.cashCents += BigInt(t.type === 'expense' ? p.cashExpenseCents : p.cashIncomeCents); cat.personalCents += BigInt(t.type === 'expense' ? p.personalExpenseCents : p.ordinaryIncomeCents); categories.set(key, cat); } }
    for (const totals of [cash, personal]) totals.netCents = totals.incomeCents - totals.expenseCents;
    return { cash: Object.fromEntries(Object.entries(cash).map(([k, v]) => [k, safe(v)])), personal: Object.fromEntries(Object.entries(personal).map(([k, v]) => [k, safe(v)])), categories: [...categories.values()].sort((a, b) => compare(a.categoryId, b.categoryId)).map(c => ({ ...c, cashCents: safe(c.cashCents), personalCents: safe(c.personalCents) })) };
  }
  function normalizeFreshness(v) {
    shape(v, ['start', 'end', 'sources', 'accounts', 'unknownAccounts', 'coverageComplete', 'unresolvedCount', 'complete', 'assumptions']); const start = date(v.start), end = date(v.end); if (start > end) fail('INVALID_SCOPE', '范围日期颠倒');
    const accounts = array(v.accounts, 100).map(a => {
      shape(a, ['accountId', 'balanceSnapshotAt', 'balanceVerifiedAt', 'balanceReconciled', 'balanceDifferenceCents', 'snapshotId']);
      const row = { accountId: id(a.accountId), balanceSnapshotAt: a.balanceSnapshotAt === null ? null : date(a.balanceSnapshotAt), balanceReconciled: a.balanceReconciled === null ? null : bool(a.balanceReconciled), balanceDifferenceCents: a.balanceDifferenceCents === null ? null : integer(a.balanceDifferenceCents, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), balanceVerifiedAt: a.balanceVerifiedAt === null ? null : date(a.balanceVerifiedAt), snapshotId: a.snapshotId === null ? null : id(a.snapshotId) };
      if (row.snapshotId === null ? [row.balanceSnapshotAt, row.balanceVerifiedAt, row.balanceReconciled, row.balanceDifferenceCents].some(x => x !== null) : row.balanceSnapshotAt === null || row.balanceReconciled === null || row.balanceDifferenceCents === null || row.balanceReconciled !== (row.balanceDifferenceCents === 0) || row.balanceVerifiedAt !== (row.balanceReconciled ? row.balanceSnapshotAt : null)) fail('INVALID_SCOPE', '余额核验元数据互相矛盾'); return row;
    });
    const accountIds = new Set(accounts.map(a => a.accountId)); if (accountIds.size !== accounts.length || !accounts.length) fail('INVALID_SCOPE', '范围账户重复或缺失');
    const sourceKeys = new Set(), coverageIds = new Set(), blockerIds = new Set();
    const sources = array(v.sources, LIMITS.scopes).map(s => {
      shape(s, ['sourceKey', 'accountId', 'included', 'reason', 'declared', 'coverage', 'gaps', 'coverageComplete', 'blockers', 'unresolvedCount', 'complete', 'confirmedThrough']);
      const coverage = array(s.coverage, LIMITS.rows).map(c => { shape(c, ['id', 'start', 'end', 'confirmed']); if (c.confirmed !== true || date(c.start) > date(c.end) || coverageIds.has(id(c.id))) fail('INVALID_SCOPE', '覆盖区间无效或重复'); coverageIds.add(c.id); return { id: c.id, start: c.start, end: c.end, confirmed: true }; });
      const gaps = array(s.gaps, LIMITS.rows).map(g => { shape(g, ['start', 'end']); if (date(g.start) > date(g.end)) fail('INVALID_SCOPE', '缺口区间无效'); return { start: g.start, end: g.end }; });
      const blockers = array(s.blockers, LIMITS.rows).map(b => { shape(b, ['kind', 'id', 'date', 'reason']); if (!['quarantine', 'pending-evidence'].includes(b.kind)) fail('INVALID_SCOPE', '未知未决来源'); const row = { kind: b.kind, id: id(b.id), date: b.date === null ? null : date(b.date), reason: text(b.reason, 1000) }; if (row.date && (row.date < start || row.date > end) || blockerIds.has(row.kind + ':' + row.id)) fail('INVALID_SCOPE', '未决记录超出范围或重复'); blockerIds.add(row.kind + ':' + row.id); return row; });
      const row = { sourceKey: text(s.sourceKey, 100), accountId: id(s.accountId), included: s.included === null ? null : bool(s.included), reason: s.reason === null ? null : text(s.reason), declared: bool(s.declared), coverage, gaps, coverageComplete: bool(s.coverageComplete), blockers, unresolvedCount: integer(s.unresolvedCount, 0, LIMITS.rows), complete: bool(s.complete), confirmedThrough: s.confirmedThrough === null ? null : date(s.confirmedThrough) }, key = canonical([row.sourceKey, row.accountId]);
      if (!accountIds.has(row.accountId) || sourceKeys.has(key) || row.declared !== (row.included !== null) || row.declared !== (row.reason !== null)) fail('INVALID_SCOPE', '来源声明或账户引用无效'); sourceKeys.add(key);
      if (!same(gaps, gapIntervals(coverage, start, end)) || row.coverageComplete !== (gaps.length === 0) || row.unresolvedCount !== blockers.length || row.complete !== (row.included === true && row.coverageComplete && blockers.length === 0) || row.confirmedThrough !== (coverage.length ? coverage.map(c => c.end).sort().at(-1) : null)) fail('INVALID_SCOPE', '新鲜度与确认覆盖或未决记录不符'); return row;
    });
    const unknownAccounts = array(v.unknownAccounts, 100).map(id), expectedUnknown = accounts.filter(a => !sources.some(s => s.accountId === a.accountId && s.declared)).map(a => a.accountId), assumptions = array(v.assumptions, 10).map(a => text(a));
    if (!same(unknownAccounts, expectedUnknown)) fail('INVALID_SCOPE', '未声明账户清单与冻结范围不符');
    const coverageComplete = bool(v.coverageComplete), expectedCoverage = unknownAccounts.length === 0 && sources.some(s => s.included === true) && sources.every(s => s.included === false || s.included === true && s.coverageComplete), unresolvedCount = integer(v.unresolvedCount, 0, LIMITS.rows * 2), expectedUnresolved = sources.filter(s => s.included !== false).reduce((n, s) => n + s.unresolvedCount, 0), complete = bool(v.complete);
    if (coverageComplete !== expectedCoverage || unresolvedCount !== expectedUnresolved || complete !== (coverageComplete && unresolvedCount === 0)) fail('INVALID_SCOPE', '完整性结论无依据');
    return { start, end, sources, accounts, unknownAccounts, coverageComplete, unresolvedCount, complete, assumptions };
  }
  function normalizeClose(v) {
    shape(v, ['id', 'createdAt', 'month', 'reason', 'revision', 'importRevision', 'bookkeepingRevision', 'selection', 'rows', 'categories', 'scope', 'totals', 'compositeProofs']);
    const composites = compositeContext(v);
    shape(v.totals, ['cash', 'personal', 'categories']);
    const totalFields = { cash: ['incomeCents', 'expenseCents', 'transferCents', 'netCents'], personal: ['incomeCents', 'expenseCents', 'transferCents', 'netCents', 'refundCents', 'claimCents'] }, totals = {};
    for (const type of ['cash', 'personal']) { shape(v.totals[type], totalFields[type]); totals[type] = Object.fromEntries(totalFields[type].map(k => [k, integer(v.totals[type][k], k === 'netCents' ? Number.MIN_SAFE_INTEGER : 0, Number.MAX_SAFE_INTEGER)])); }
    totals.categories = array(v.totals.categories, 200).map(c => { shape(c, ['categoryId', 'type', 'cashCents', 'personalCents']); if (!['income', 'expense'].includes(c.type)) fail('INVALID_CLOSE', '冻结分类合计方向无效'); return { categoryId: id(c.categoryId), type: c.type, cashCents: integer(c.cashCents), personalCents: integer(c.personalCents) }; });
    const out = { id: id(v.id), createdAt: timestamp(v.createdAt), month: month(v.month), reason: text(v.reason), revision: integer(v.revision, 0, LIMITS.audit), importRevision: integer(v.importRevision), bookkeepingRevision: integer(v.bookkeepingRevision), selection: v.selection, rows: array(v.rows, LIMITS.rows).map(r => frozenRow(r, composites)), categories: array(v.categories, 200).map(c => { shape(c, ['id', 'name', 'type']); if (!['income', 'expense'].includes(c.type)) fail('INVALID_CLOSE', '分类方向无效'); return { id: id(c.id), name: text(c.name, 80), type: c.type }; }), scope: normalizeFreshness(v.scope), totals };
    if (composites.proofs.length) out.compositeProofs = composites.proofs;
    if (!['all-month', 'selected'].includes(out.selection) || out.rows.some(r => r.transaction.date.slice(0, 7) !== out.month) || new Set(out.rows.map(r => r.transaction.id)).size !== out.rows.length || !same(out.totals, sums(out.rows))) fail('INVALID_CLOSE', '冻结月结与其交易快照不符');
    const pairByTransaction = new Map(), rowIds = new Set(out.rows.map(r => r.transaction.id));
    for (const r of out.rows) if (r.transferPair) {
      const pair = r.transferPair;
      if (rowIds.has(pair.id)) fail('INVALID_CLOSE', '冻结转账关联标识与交易重复');
      if ([pair.id, pair.expenseId, pair.incomeId].some(key => composites.byId.has(key) || composites.byMember.has(key))) fail('INVALID_CLOSE', '冻结组合不能与转账配对共用标识或交易');
      for (const key of [pair.expenseId, pair.incomeId]) { if (pairByTransaction.has(key) && !same(pairByTransaction.get(key), pair)) fail('INVALID_CLOSE', '冻结双边属于不同转账'); pairByTransaction.set(key, pair); }
    }
    for (const r of out.rows) if (pairByTransaction.has(r.transaction.id) && !same(pairByTransaction.get(r.transaction.id), r.transferPair)) fail('INVALID_CLOSE', '冻结转账的另一边缺少一致的配对依据');
    if (out.selection === 'all-month') for (const [key, pair] of pairByTransaction) { const signature = key === pair.expenseId ? pair.expenseSignature : pair.incomeSignature; if (signature.date.slice(0, 7) === out.month && !rowIds.has(key)) fail('INVALID_CLOSE', '全月冻结缺少同月转账的另一边'); }
    const usedProofs = new Set();
    for (const r of out.rows) {
      const context = composites.byMember.get(r.transaction.id);
      if (composites.byId.has(r.transaction.id) || context && r.compositeId !== context.proof.id) fail('INVALID_CLOSE', '冻结组合成员缺少一致的组合引用');
      if (r.compositeId !== undefined) usedProofs.add(r.compositeId);
    }
    for (const proof of composites.proofs) {
      if (!usedProofs.has(proof.id)) fail('INVALID_CLOSE', '冻结组合依据未被任何月结交易使用');
      if (out.selection === 'all-month' && proof.signatures.some(s => s.date.slice(0, 7) === out.month && !rowIds.has(s.id))) fail('INVALID_CLOSE', '全月冻结缺少同月组合成员');
    }
    const cats = new Map(out.categories.map(c => [c.id, c])); if (cats.size !== out.categories.length || out.rows.some(r => r.transaction.type !== 'transfer' && cats.get(r.transaction.categoryId)?.type !== r.transaction.type)) fail('INVALID_CLOSE', '月结分类快照缺失');
    const accounts = new Set(out.scope.accounts.map(a => a.accountId)), evidenceIds = new Set(); for (const row of out.rows) { const t = row.transaction; if (row.transferPair && (!accounts.has(row.transferPair.expenseSignature.accountId) || !accounts.has(row.transferPair.incomeSignature.accountId))) fail('INVALID_CLOSE', '冻结转账的双边账户不在保存范围中'); if (!accounts.has(t.accountId) || t.type === 'transfer' && !accounts.has(t.toAccountId)) fail('INVALID_CLOSE', '月结交易账户不在冻结范围中'); for (const source of row.sources) { if (evidenceIds.has(source.evidenceId)) fail('INVALID_CLOSE', '月结来源证据被重复列入'); evidenceIds.add(source.evidenceId); } }
    for (const proof of composites.proofs) {
      if ([proof.id, ...proof.signatures.map(s => s.id)].some(key => accounts.has(key) || cats.has(key) || key === out.id) || proof.signatures.some(s => !accounts.has(s.accountId))) fail('INVALID_CLOSE', '冻结组合标识冲突或成员账户不在保存范围中');
    }
    if (out.scope.start !== out.month + '-01' || out.scope.end !== monthEnd(out.month)) fail('INVALID_CLOSE', '月结范围不符'); return out;
  }
  const normalizers = { rules: normalizeRule, aliases: normalizeAlias, merchants: normalizeMerchant, batches: normalizeBatch, scopes: normalizeScope, reviews: normalizeReview, closes: normalizeClose };
  function keyOf(collection, row) { return collection === 'merchants' ? row.transactionId : collection === 'reviews' ? row.key : row.id; }
  function validate(value, state) {
    const index = baseIndex(state), input = value === undefined ? defaultState() : value; shape(input, ['version', 'revision', ...COLLECTIONS, 'audit']); if (![1, VERSION, COMPOSITE_VERSION].includes(input.version)) fail('INVALID_ORGANIZER_VERSION', '不支持此整理版本');
    if (input.version === COMPOSITE_VERSION && state.version < LEDGER_VERSION) fail('INVALID_ORGANIZER_VERSION', '组合月结证明不能放入旧版账本');
    preflightCompositeHistory(input);
    const out = defaultState(); out.version = input.version === COMPOSITE_VERSION ? COMPOSITE_VERSION : VERSION; out.revision = integer(input.revision, 0, LIMITS.audit);
    const maps = {};
    for (const c of COLLECTIONS) { out[c] = array(input[c], LIMITS[c] || LIMITS.rows).map(normalizers[c]); maps[c] = new Map(); for (const row of out[c]) { const key = keyOf(c, row); if (maps[c].has(key)) fail('DUPLICATE_ID', '整理记录重复'); maps[c].set(key, row); } }
    const journals = Object.fromEntries(COLLECTIONS.map(c => [c, new Map()])), auditIds = new Set();
    out.audit = array(input.audit, LIMITS.audit).map((entry, i) => {
      shape(entry, ['id', 'revision', 'at', 'action', 'reason', 'changes']);
      const row = { id: id(entry.id), revision: integer(entry.revision, 1, LIMITS.audit), at: timestamp(entry.at), action: text(entry.action, 40), reason: text(entry.reason), changes: [] };
      if (!['save-rule', 'save-alias', 'remove-rules', 'remove-aliases', 'apply-rules', 'apply-aliases', 'rollback-batch', 'set-scope', 'set-review', 'close-month'].includes(row.action)) fail('INVALID_ORGANIZER_AUDIT', '未知整理操作');
      if (row.revision !== i + 1 || auditIds.has(row.id) || index.used.has(row.id)) fail('INVALID_ORGANIZER_AUDIT', '整理日志顺序或标识无效'); auditIds.add(row.id);
      const seen = new Set(); row.changes = array(entry.changes, LIMITS.rows + 1).map(change => { shape(change, ['collection', 'key', 'before', 'after']); const c = change.collection; if (!COLLECTIONS.includes(c)) fail('INVALID_ORGANIZER_AUDIT', '未知日志集合'); const key = c === 'reviews' ? text(change.key, 200) : id(change.key), before = change.before === null ? null : normalizers[c](change.before), after = change.after === null ? null : normalizers[c](change.after); if ((!before && !after) || (before && keyOf(c, before) !== key) || (after && keyOf(c, after) !== key) || seen.has(c + ':' + key) || !same(journals[c].get(key) || null, before)) fail('INVALID_ORGANIZER_AUDIT', '整理日志前后版本不一致'); if (c === 'closes' && after && after.revision !== row.revision - 1) fail('INVALID_ORGANIZER_AUDIT', '月结记录的整理版本不符'); if (c === 'closes' && before) fail('INVALID_ORGANIZER_AUDIT', '冻结月结不能覆盖或删除'); if (c === 'batches' && before && (!after || before.rolledBack || !after.rolledBack || !same({ ...before, rolledBack: true, rolledBackAt: after.rolledBackAt }, after))) fail('INVALID_ORGANIZER_AUDIT', '已应用批次只允许一次撤销'); seen.add(c + ':' + key); if (after) journals[c].set(key, after); else journals[c].delete(key); return { collection: c, key, before, after }; }); if (!row.changes.length) fail('INVALID_ORGANIZER_AUDIT', '空整理日志'); return row;
    });
    if (input.version === 1 && (out.closes.some(c => c.rows.some(r => r.transferPair)) || out.audit.some(a => a.changes.some(c => c.collection === 'closes' && [c.before, c.after].some(v => v && v.rows.some(r => r.transferPair)))))) fail('INVALID_ORGANIZER_VERSION', '冻结转账配对须使用新版整理格式');
    if (out.revision !== out.audit.length) fail('INVALID_ORGANIZER_AUDIT', '整理版本与日志不一致');
    for (const c of COLLECTIONS) if (!same([...maps[c]].sort(), [...journals[c]].sort())) fail('INVALID_ORGANIZER_AUDIT', '整理记录缺少操作历史');
    const entityIds = new Set(auditIds);
    for (const c of ['rules', 'aliases', 'batches', 'scopes', 'closes']) for (const row of out[c]) { if (index.used.has(row.id) || entityIds.has(row.id)) fail('DUPLICATE_ID', '整理标识与其他记录冲突'); entityIds.add(row.id); }
    for (const s of out.scopes) { if (!index.accounts.has(s.accountId)) fail('INVALID_REFERENCE', '范围账户不存在'); index.sources.add(s.sourceKey); }
    if (new Set(out.scopes.map(s => canonical([s.sourceKey, s.accountId]))).size !== out.scopes.length) fail('INVALID_SCOPE', '同一来源与账户只能声明一次');
    for (const row of [...out.rules, ...out.aliases]) { const c = row.conditions || row; if (c.accountId && !index.accounts.has(c.accountId)) fail('INVALID_REFERENCE', '规则账户或来源不存在'); if (row.actions) { const cat = index.categories.get(row.actions.categoryId); if (!cat || c.type && cat.type !== c.type) fail('INVALID_REFERENCE', '规则分类不存在或方向不符'); } }
    const batchMerchants = new Map(out.batches.map(b => [b.id, new Map(b.changes.filter(c => c.merchantAfter !== null).map(c => [c.transactionId, c.merchantAfter]))]));
    for (const m of out.merchants) { const batch = maps.batches.get(m.batchId); if (!index.allTransactions.has(m.transactionId) || !batch || batch.rolledBack || !same(batchMerchants.get(m.batchId)?.get(m.transactionId) || null, m)) fail('INVALID_REFERENCE', '商户元数据缺少有效交易或应用记录'); }
    bounded(out); return out;
  }
  function normalized(state) { const organizer = validate(state.organizer, state), next = clone(state); next.organizer = organizer; next.version = Math.max(next.version, LEDGER_VERSION); return next; }
  function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function newId(state, kind) { const used = new Set(baseIndex(state).used); for (const c of COLLECTIONS) for (const row of state.organizer[c]) if (row.id) used.add(row.id); for (const row of state.organizer.audit) { used.add(row.id); for (const c of row.changes) { if (c.before?.id) used.add(c.before.id); if (c.after?.id) used.add(c.after.id); } } let n = state.organizer.revision + 1, key; do { key = 'organizer-' + kind + '-' + n++; } while (used.has(key)); return key; }
  function commit(state, action, changes, reason, at) {
    const next = state, o = next.organizer; if (o.audit.length >= LIMITS.audit) fail('ORGANIZER_LIMIT', '整理日志已达上限');
    if (changes.some(c => c.collection === 'closes' && c.after?.compositeProofs !== undefined)) {
      let cells = preflightCompositeHistory(o);
      for (const change of changes) if (change.collection === 'closes' && change.after) cells += 2 * compositeProofCells(change.after);
      if (cells > LIMITS.compositeHistoryCells) fail('ORGANIZER_LIMIT', '新增月结及历史的组合依据超过总上限');
    }
    const prepared = changes.map(c => { const rows = o[c.collection], before = rows.find(r => keyOf(c.collection, r) === c.key) || null; if (c.after === null) o[c.collection] = rows.filter(r => keyOf(c.collection, r) !== c.key); else if (before) rows[rows.indexOf(before)] = clone(c.after); else rows.push(clone(c.after)); return { collection: c.collection, key: c.key, before: clone(before), after: clone(c.after) }; });
    o.audit.push({ id: newId(next, 'audit'), revision: o.revision + 1, at: timestamp(at), action: text(action, 40), reason: text(reason), changes: prepared }); o.revision++; o.version = Math.max(o.version, changes.some(c => c.collection === 'closes' && c.after?.compositeProofs?.length) ? COMPOSITE_VERSION : VERSION); next.organizer = validate(o, next); bounded(next, LIMITS.backupBytes); return next;
  }
  function metadata(input, label) { return { reason: input.reason === undefined ? label : text(input.reason), at: timestamp(input.at === undefined ? new Date().toISOString() : input.at) }; }
  function assertSource(current, sourceKey, previous) { if (!sourceKey || sourceKey === previous) return; const sources = baseIndex(current).sources; current.organizer.scopes.forEach(s => sources.add(s.sourceKey)); if (!sources.has(sourceKey)) fail('INVALID_REFERENCE', '新规则来源不存在，请先声明来源范围'); }
  function saveRule(state, input) { shape(input, ['id', 'name', 'enabled', 'conditions', 'actions', 'reason', 'at']); const current = normalized(state), { reason, at } = metadata(input, '保存用户定义的分类规则'), row = normalizeRule({ id: input.id || newId(current, 'rule'), name: input.name, enabled: input.enabled === undefined ? true : input.enabled, conditions: input.conditions, actions: input.actions }); assertSource(current, row.conditions.sourceKey, current.organizer.rules.find(r => r.id === input.id)?.conditions.sourceKey); if (input.id && !current.organizer.rules.some(r => r.id === input.id)) fail('NOT_FOUND', '待修改规则不存在'); return commit(current, 'save-rule', [{ collection: 'rules', key: row.id, after: row }], reason, at); }
  function saveAlias(state, input) { shape(input, ['id', 'from', 'to', 'caseSensitive', 'enabled', 'sourceKey', 'accountId', 'reason', 'at']); const current = normalized(state), { reason, at } = metadata(input, '保存用户确认的具体商户别名'), data = { ...input }; delete data.reason; delete data.at; data.id = input.id || newId(current, 'alias'); data.enabled = input.enabled === undefined ? true : input.enabled; data.caseSensitive = input.caseSensitive === undefined ? true : input.caseSensitive; const row = normalizeAlias(data); assertSource(current, row.sourceKey, current.organizer.aliases.find(r => r.id === input.id)?.sourceKey); if (input.id && !current.organizer.aliases.some(r => r.id === input.id)) fail('NOT_FOUND', '待修改别名不存在'); return commit(current, 'save-alias', [{ collection: 'aliases', key: row.id, after: row }], reason, at); }
  function removeDefinition(state, collection, recordId, options = {}) { const current = normalized(state), key = id(recordId); if (!current.organizer[collection].some(r => r.id === key)) fail('NOT_FOUND', '规则不存在'); const { reason, at } = metadata(options, '删除未来试跑规则；已应用结果须另行撤销批次'); return commit(current, 'remove-' + collection, [{ collection, key, after: null }], reason, at); }
  function removeRule(state, recordId, options) { return removeDefinition(state, 'rules', recordId, options); }
  function removeAlias(state, recordId, options) { return removeDefinition(state, 'aliases', recordId, options); }
  function relationEngine() { if (root.MoneygoRelations) return root.MoneygoRelations; if (typeof module === 'object' && module.exports) { try { return require('./relations.js'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; } } fail('RELATIONS_UNAVAILABLE', '账务关系模块尚未加载'); }
  function eventEngine() { if (root.MoneygoPersonalEvents) return root.MoneygoPersonalEvents; if (typeof module === 'object' && module.exports) return require('./personal-events.js'); fail('PERSONAL_EVENTS_UNAVAILABLE', '个人收支事件模块尚未加载'); }
  function financialData(state) {
    if (state.bookkeeping !== undefined) return relationEngine().calculate(state);
    const impacts = Object.create(null), facts = [];
    for (const t of state.transactions) {
      impacts[t.id] = { excluded: false, cashIncomeCents: t.type === 'income' ? t.amountCents : 0, cashExpenseCents: t.type === 'expense' ? t.amountCents : 0, transferCents: t.type === 'transfer' ? t.amountCents : 0, ordinaryIncomeCents: t.type === 'income' ? t.amountCents : 0, personalExpenseCents: t.type === 'expense' ? t.amountCents : 0, refundCents: 0, claimCents: 0 };
      facts.push({ transactionId: t.id, kind: t.type, effectiveDate: t.date, categoryId: t.type === 'transfer' ? null : t.categoryId, accountId: t.accountId, rawAmountCents: t.amountCents, personalAmountCents: t.type === 'transfer' ? 0 : t.amountCents, excluded: false, primaryId: null, transferPairId: null, compositeId: null, personalAuthority: true, fundingAuthority: true });
    }
    const events = eventEngine().projectLegacy(facts);
    return { impacts, refundPlans: [], receivables: { claims: [] }, personalExpenseEvents: events.expenseEvents, personalIncomeEvents: events.incomeEvents };
  }
  function personalEventIndex(data) {
    const events = new Map();
    for (const event of [...data.personalExpenseEvents, ...data.personalIncomeEvents]) {
      if (event.origin.kind !== 'transaction' || event.key.id !== event.origin.transactionId || events.has(event.origin.transactionId)) fail('PERSONAL_EVENT_MISMATCH', '当前个人收支事件与原始记录不一致');
      events.set(event.origin.transactionId, event);
    }
    return events;
  }
  function personalValue(transaction, events) {
    if (transaction.type === 'transfer') return 0;
    const event = events.get(transaction.id);
    if (!event || event.key.kind !== 'transaction-' + transaction.type || event.effectiveDate !== transaction.date || event.categoryId !== transaction.categoryId || event.attribution.accountId !== transaction.accountId) fail('PERSONAL_EVENT_MISMATCH', '当前个人收支事件缺失或来源不一致');
    return event.amountCents;
  }
  function sourceIds(state, transactionId) { return new Set([transactionId, ...(state.bookkeeping?.links || []).filter(l => l.primaryId === transactionId).map(l => l.shadowId)]); }
  function sourceIndex(state) {
    const shadowToPrimary = new Map((state.bookkeeping?.links || []).map(l => [l.shadowId, l.primaryId])), grouped = new Map();
    for (const e of state.imports?.evidence || []) { if (!e.transactionId) continue; const key = shadowToPrimary.get(e.transactionId) || e.transactionId, rows = grouped.get(key) || []; rows.push({ evidenceId: id(e.id), sourceKey: text(e.sourceKey, 100) }); grouped.set(key, rows); }
    for (const rows of grouped.values()) rows.sort((a, b) => compare(a.evidenceId, b.evidenceId)); return grouped;
  }
  function merchantOf(o, transactionId) { return o.merchants.find(m => m.transactionId === transactionId) || null; }
  function matchesConditions(c, t, sourceKeys) { if (c.accountId && t.accountId !== c.accountId || c.sourceKey && !sourceKeys.includes(c.sourceKey) || c.type && t.type !== c.type || c.minAmountCents !== undefined && t.amountCents < c.minAmountCents || c.maxAmountCents !== undefined && t.amountCents > c.maxAmountCents || c.startDate && t.date < c.startDate || c.endDate && t.date > c.endDate) return false; if (c.note) { const a = c.note.caseSensitive ? t.note : t.note.toLowerCase(), b = c.note.caseSensitive ? c.note.value : c.note.value.toLowerCase(); if (!(c.note.operator === 'equals' ? a === b : a.includes(b))) return false; } return true; }
  function preview(state, kind, options = {}) {
    shape(options, [kind === 'rules' ? 'ruleIds' : 'aliasIds', 'precedence']); const current = normalized(state), index = baseIndex(current), o = current.organizer, choices = options[kind === 'rules' ? 'ruleIds' : 'aliasIds'];
    let definitions = o[kind].filter(r => r.enabled); if (choices !== undefined) { const ids = array(choices, LIMITS[kind]).map(id); if (new Set(ids).size !== ids.length || ids.some(key => !definitions.some(r => r.id === key))) fail('INVALID_REFERENCE', '试跑规则不存在、重复或已停用'); definitions = definitions.filter(r => ids.includes(r.id)); }
    const precedence = options.precedence === undefined ? [] : array(options.precedence, LIMITS[kind]).map(id); if (new Set(precedence).size !== precedence.length || precedence.some(key => !definitions.some(r => r.id === key))) fail('INVALID_PRECEDENCE', '优先顺序含未知或重复规则');
    const data = financialData(current), sourceMap = sourceIndex(current), merchantMap = new Map(o.merchants.map(m => [m.transactionId, m])), rows = []; let matchCount = 0, previewBytes = 1000 + byteLength(JSON.stringify(precedence));
    for (const t of [...index.transactions.values()].sort((a, b) => compare(a.id, b.id))) {
      if (data.impacts[t.id]?.excluded) continue;
      const sources = (sourceMap.get(t.id) || []).map(s => s.sourceKey), matches = definitions.filter(r => kind === 'rules' ? matchesConditions(r.conditions, t, sources) : matchesConditions({ note: { operator: 'equals', value: r.from, caseSensitive: r.caseSensitive }, ...(r.sourceKey ? { sourceKey: r.sourceKey } : {}), ...(r.accountId ? { accountId: r.accountId } : {}) }, t, sources));
      if (!matches.length) continue; matchCount += matches.length; if (matchCount > LIMITS.previewMatches) fail('PREVIEW_LIMIT', '本次试跑的详细命中数超过上限，请选择更少规则或缩小匹配条件后重试');
      const beforeMerchant = merchantMap.get(t.id) || null, details = matches.map(r => { const categoryId = kind === 'rules' ? r.actions.categoryId : t.categoryId || null, merchant = kind === 'rules' ? r.actions.merchant === undefined ? beforeMerchant?.merchant || null : r.actions.merchant : r.to, eligible = kind !== 'rules' || (t.type !== 'transfer' && index.categories.get(categoryId)?.type === t.type); return { id: r.id, eligible, categoryId, merchant, explanation: kind === 'rules' ? clone(r.conditions) : { noteEquals: r.from, caseSensitive: r.caseSensitive, sourceKey: r.sourceKey || null, accountId: r.accountId || null } }; });
      const outcomes = new Set(details.map(m => canonical([m.categoryId, m.merchant, m.eligible]))), conflict = outcomes.size > 1;
      let selected = details.length === 1 || !conflict ? details[0] : null;
      if (conflict) { const ordered = details.filter(m => precedence.includes(m.id)); if (ordered.length === details.length) selected = ordered.sort((a, b) => precedence.indexOf(a.id) - precedence.indexOf(b.id))[0]; }
      const after = clone(t); if (selected && kind === 'rules') after.categoryId = selected.categoryId;
      const changed = selected && (!same(after, t) || selected.merchant !== (beforeMerchant?.merchant || null));
      const resultRow = { transactionId: t.id, before: clone(t), after, merchantBefore: beforeMerchant?.merchant || null, merchantAfter: selected?.merchant || null, matches: details, conflict, resolvedByPrecedence: conflict && selected !== null, selectedRuleId: selected?.id || null, eligible: Boolean(selected?.eligible), changed: Boolean(changed), explanation: !selected ? '多条规则产生不同结果，请给出覆盖全部命中规则的明确优先顺序，或跳过此笔。' : !selected.eligible ? '分类与交易方向不符，不能应用。' : changed ? '只更改分类或单独商户分组，原始描述及资金保持不变。' : '命中规则，但结果与当前值相同。' }; previewBytes += byteLength(JSON.stringify(resultRow)) + 1; if (previewBytes > LIMITS.previewBytes) fail('PREVIEW_LIMIT', '本次详细预览过大，请选择更少规则或缩小匹配条件后重试'); rows.push(resultRow);
    }
    const result = frozen({ kind, rows, matchedCount: rows.length, actionableCount: rows.filter(r => r.eligible && r.changed).length, conflictCount: rows.filter(r => r.conflict).length, skippedShadowCount: Object.values(data.impacts).filter(i => i.excluded).length, precedence: precedence.slice() }); tickets.set(result, { basis: canonical(current), definitions: clone(definitions), used: false }); return result;
  }
  function previewRules(state, options) { return preview(state, 'rules', options); }
  function previewAliases(state, options) { return preview(state, 'aliases', options); }
  function applyPreview(state, result, options) {
    shape(options, ['transactionIds', 'reason', 'at']); const ticket = tickets.get(result); if (!ticket) fail('INVALID_PREVIEW', '请重新试跑规则'); if (ticket.used) fail('PREVIEW_USED', '此预览已应用');
    const current = normalized(state); if (ticket.basis !== canonical(current)) fail('STALE_PREVIEW', '账本已变化，请重新试跑'); const ids = array(options.transactionIds, LIMITS.rows).map(id); if (!ids.length || new Set(ids).size !== ids.length) fail('INVALID_SELECTION', '请明确选择不重复的交易');
    const previewRows = new Map(result.rows.map(r => [r.transactionId, r])), selected = ids.map(key => { const row = previewRows.get(key); if (!row || !row.eligible || !row.changed) fail('INVALID_SELECTION', '所选交易不可应用、无变化或仍有冲突'); return row; }); const { reason, at } = metadata(options, '应用用户选择的整理结果'), batchId = newId(current, 'batch');
    const merchantMap = new Map(current.organizer.merchants.map(m => [m.transactionId, m])), transactionIndices = new Map(current.transactions.map((t, i) => [t.id, i]));
    const changes = selected.map(r => ({ transactionId: r.transactionId, before: clone(r.before), after: clone(r.after), merchantBefore: clone(merchantMap.get(r.transactionId) || null), merchantAfter: r.merchantAfter === null ? null : { transactionId: r.transactionId, merchant: r.merchantAfter, batchId }, matches: r.matches.map(m => m.id), selectedRuleId: r.selectedRuleId }));
    const batch = { id: batchId, kind: result.kind, createdAt: at, reason, definitions: ticket.definitions, changes, rolledBack: false, rolledBackAt: null };
    const patches = [{ collection: 'batches', key: batchId, after: batch }]; for (const c of changes) { const i = transactionIndices.get(c.transactionId); current.transactions[i] = { ...current.transactions[i], ...c.after }; if (!same(c.merchantBefore, c.merchantAfter)) patches.push({ collection: 'merchants', key: c.transactionId, after: c.merchantAfter }); }
    const next = commit(current, 'apply-' + result.kind, patches, reason, at); ticket.used = true; return next;
  }
  function rollbackBatch(state, batchId, options = {}) {
    const current = normalized(state), batch = current.organizer.batches.find(b => b.id === id(batchId)); if (!batch) fail('NOT_FOUND', '整理批次不存在'); if (batch.rolledBack) fail('ALREADY_ROLLED_BACK', '此整理批次已撤销'); const data = financialData(current), transactionIndices = new Map(current.transactions.map((t, i) => [t.id, i])), merchantMap = new Map(current.organizer.merchants.map(m => [m.transactionId, m]));
    for (const c of batch.changes) { const t = current.transactions[transactionIndices.get(c.transactionId)]; if (!t || !same(transaction(t), c.after) || !same(merchantMap.get(c.transactionId) || null, c.merchantAfter) || data.impacts[t.id]?.excluded) fail('ROLLBACK_CONFLICT', '交易后来已修改、删除、重新分组或成为附属证据，不能覆盖后续操作'); }
    const { reason, at } = metadata(options, '撤销整理批次'), patches = [{ collection: 'batches', key: batch.id, after: { ...batch, rolledBack: true, rolledBackAt: at } }];
    for (const c of batch.changes) { const i = transactionIndices.get(c.transactionId); current.transactions[i] = { ...current.transactions[i], ...c.before }; if (!same(c.merchantBefore, c.merchantAfter)) patches.push({ collection: 'merchants', key: c.transactionId, after: c.merchantBefore }); }
    return commit(current, 'rollback-batch', patches, reason, at);
  }
  function setScope(state, input) { shape(input, ['sourceKey', 'accountId', 'included', 'reason', 'confirmed', 'at']); const current = normalized(state), { reason, at } = metadata({ ...input, reason: text(input.reason) }, '确认分析范围'), prior = current.organizer.scopes.find(s => s.sourceKey === input.sourceKey && s.accountId === input.accountId), row = normalizeScope({ id: prior?.id || newId(current, 'scope'), sourceKey: input.sourceKey, accountId: input.accountId, included: input.included, reason, confirmed: input.confirmed, updatedAt: at }); return commit(current, 'set-scope', [{ collection: 'scopes', key: row.id, after: row }], reason, at); }
  function dayAfter(v) { const d = new Date(v + 'T00:00:00.000Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
  function dayBefore(v) { const d = new Date(v + 'T00:00:00.000Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
  function monthEnd(v) { const y = +v.slice(0, 4), m = +v.slice(5); const n = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; return v + '-' + n; }
  function gapIntervals(coverage, start, end) { const gaps = []; let cursor = start; for (const c of coverage.slice().sort((a, b) => compare(a.start, b.start) || compare(a.end, b.end))) { if (c.end < cursor || c.start > end) continue; if (c.start > cursor) gaps.push({ start: cursor, end: dayBefore(c.start) }); if (c.end >= end) return gaps; if (c.end >= cursor) cursor = dayAfter(c.end); } if (cursor <= end) gaps.push({ start: cursor, end }); return gaps; }
  function scopeReport(state, range) { return scopeReportCurrent(normalized(state), range); }
  function scopeReportCurrent(current, range) {
    shape(range, ['start', 'end']); const start = date(range.start), end = date(range.end); if (start > end) fail('INVALID_SCOPE', '范围日期颠倒'); const sources = new Map();
    for (const s of current.organizer.scopes) sources.set(canonical([s.sourceKey, s.accountId]), { sourceKey: s.sourceKey, accountId: s.accountId, included: s.included, reason: s.reason, declared: true });
    for (const collection of ['evidence', 'coverage', 'quarantine']) for (const s of current.imports?.[collection] || []) { const key = canonical([s.sourceKey, s.accountId]); if (!sources.has(key)) sources.set(key, { sourceKey: s.sourceKey, accountId: s.accountId, included: null, reason: null, declared: false }); }
    const importBatches = new Map((current.imports?.batches || []).map(b => [b.id, b]));
    function blockerDate(raw) { if (typeof raw !== 'string') return null; try { return date(raw); } catch (_) { return null; } }
    const rows = [...sources.values()].map(s => {
      const coverage = (current.imports?.coverage || []).filter(c => c.sourceKey === s.sourceKey && c.accountId === s.accountId && c.confirmed === true).map(c => ({ id: c.id, start: c.start, end: c.end, confirmed: true })).sort((a, b) => compare(a.start, b.start) || compare(a.id, b.id)); for (const c of coverage) { date(c.start); date(c.end); }
      const gaps = gapIntervals(coverage, start, end), blockers = [];
      for (const q of current.imports?.quarantine || []) if (q.sourceKey === s.sourceKey && q.accountId === s.accountId && q.resolvedByBatchId === null && !importBatches.get(q.batchId)?.rolledBack) { const d = blockerDate(q.mapped?.date); if (d === null || d >= start && d <= end) blockers.push({ kind: 'quarantine', id: q.id, date: d, reason: '此行尚未完成校验或确认入账' }); }
      for (const e of current.imports?.evidence || []) if (e.sourceKey === s.sourceKey && e.accountId === s.accountId && e.status === 'pending') { const d = blockerDate(e.normalized?.date || e.mapped?.date); if (d === null || d >= start && d <= end) blockers.push({ kind: 'pending-evidence', id: e.id, date: d, reason: '来源记录仍在处理中，不能当作已确定完成' }); }
      blockers.sort((a, b) => compare(a.kind, b.kind) || compare(a.id, b.id));
      return { ...s, coverage, gaps, coverageComplete: gaps.length === 0, blockers, unresolvedCount: blockers.length, complete: s.included === true && gaps.length === 0 && blockers.length === 0, confirmedThrough: coverage.length ? coverage.map(c => c.end).sort().at(-1) : null };
    }).sort((a, b) => compare(a.sourceKey, b.sourceKey) || compare(a.accountId, b.accountId));
    const accounts = current.accounts.map(a => { const snapshots = (current.bookkeeping?.snapshots || []).filter(s => s.accountId === a.id).sort((a, b) => compare(b.date, a.date) || compare(a.id, b.id)); const latest = snapshots[0] || null, reconciliation = latest ? relationEngine().reconciliation(current, latest.id) : null; return { accountId: a.id, balanceSnapshotAt: latest?.date || null, balanceVerifiedAt: reconciliation?.reconciled ? latest.date : null, balanceReconciled: reconciliation ? reconciliation.reconciled : null, balanceDifferenceCents: reconciliation?.differenceCents ?? null, snapshotId: latest?.id || null }; }).sort((a, b) => compare(a.accountId, b.accountId));
    const unknownAccounts = accounts.filter(a => !rows.some(s => s.accountId === a.accountId && s.declared)).map(a => a.accountId); const coverageComplete = !unknownAccounts.length && rows.some(s => s.included === true) && rows.every(s => s.included === false || s.included === true && s.coverageComplete), unresolvedCount = rows.filter(s => s.included !== false).reduce((n, s) => n + s.unresolvedCount, 0), complete = coverageComplete && unresolvedCount === 0;
    return normalizeFreshness({ start, end, sources: rows, accounts, unknownAccounts, coverageComplete, unresolvedCount, complete, assumptions: ['完整性仅限用户声明的来源与账户；未声明来源无法自动发现。', '截止日来自用户确认覆盖，不从最早或最晚交易推断；无交易也可有已确认覆盖。', '余额核验日来自用户输入的快照，不代表银行实时余额；范围排除不自动删除或改变所选交易。'] });
  }
  function knownRawAmount(v) { if (typeof v !== 'string' || !/^-?\d+(?:\.\d{1,2})?$/.test(v.trim()) || v.length > 32) return null; const s = v.trim().replace(/^-/, ''), [whole, fraction = ''] = s.split('.'), n = BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2)); return n <= BigInt(MAX_AMOUNT_CENTS) ? Number(n) : null; }
  function reviewQueue(state, options) {
    shape(options, ['asOf']); const current = normalized(state), asOf = date(options.asOf), data = financialData(current), items = [], batches = new Map((current.imports?.batches || []).map(b => [b.id, b]));
    for (const q of current.imports?.quarantine || []) if (q.resolvedByBatchId === null && !batches.get(q.batchId)?.rolledBack) items.push({ key: 'quarantine:' + q.id, kind: 'quarantine', referenceId: q.id, transactionIds: [], impactCents: knownRawAmount(q.mapped?.amount), impactKind: 'raw-row-amount', explanation: q.errors.map(e => e.message).join('；'), dueDate: null });
    const groups = new Map(); for (const t of current.transactions) if (!data.impacts[t.id]?.excluded) { const key = canonical([t.date, t.type, t.amountCents, t.accountId, t.toAccountId || null]); const group = groups.get(key) || []; group.push(t); groups.set(key, group); }
    for (const group of groups.values()) if (group.length > 1) { group.sort((a, b) => compare(a.id, b.id)); items.push({ key: 'duplicate:' + group[0].id, kind: 'duplicate-candidate', referenceId: group[0].id, transactionIds: group.map(t => t.id), impactCents: safe(BigInt(group[0].amountCents) * BigInt(group.length - 1)), impactKind: 'possible-duplicate-upper-bound', explanation: '同日、同金额、同方向及资金账户相同。若全部是同一事项，列示金额是可能重复计入的上限；这些条件不能证明重复，必须逐笔确认。', dueDate: null }); }
    for (const p of data.refundPlans) if (p.status === 'waiting' && p.remainingCents > 0) items.push({ key: 'refundPlan:' + p.id, kind: 'refund-plan', referenceId: p.id, transactionIds: [p.expenseId], impactCents: p.remainingCents, impactKind: 'expected-not-received', explanation: '用户登记的预计退款尚未全部关联实际到账；不会计入现金。', dueDate: p.dueDate });
    for (const c of data.receivables.claims) if (c.outstandingCents > 0) items.push({ key: 'claim:' + c.id, kind: 'claim', referenceId: c.id, transactionIds: [c.expenseId], impactCents: c.outstandingCents, impactKind: 'claim-outstanding', explanation: c.status === 'submitted' ? '已提交应收尚未全部关联实际到账；到期日为用户填写，不代表已确定逾期责任。' : '用户登记的费用尚待提交或补材料；未提交不能称对方逾期欠款。', dueDate: c.dueDate });
    if (current.bookkeeping) for (const s of current.bookkeeping.snapshots) { const r = relationEngine().reconciliation(current, s.id); if (r.differenceCents !== 0) items.push({ key: 'snapshot:' + s.id, kind: 'balance-difference', referenceId: s.id, transactionIds: [], impactCents: Math.abs(r.differenceCents), impactKind: 'absolute-balance-difference', explanation: '用户输入的日终余额与账本同日重算存在差额；不会自动新增调平交易。', dueDate: s.date }); }
    const result = items.map(i => { const pref = current.organizer.reviews.find(r => r.key === i.key); return { ...i, rank: pref?.rank ?? null, deferUntil: pref?.deferUntil || null, deferred: Boolean(pref?.deferUntil && pref.deferUntil > asOf), overdue: Boolean(i.dueDate && i.dueDate < asOf && (i.kind !== 'claim' || data.receivables.claims.find(c => c.id === i.referenceId)?.status === 'submitted')), sortExplanation: pref?.rank !== null && pref?.rank !== undefined ? '用户明确排序优先；其后按已知影响金额从大到小排列。' : '按已知影响金额从大到小排列，未知金额在后；金额类型不同，不是概率或可相加的损失预测。' }; });
    result.sort((a, b) => Number(a.deferred) - Number(b.deferred) || (a.rank === null ? 1000001 : a.rank) - (b.rank === null ? 1000001 : b.rank) || Number(a.impactCents === null) - Number(b.impactCents === null) || (a.impactCents === b.impactCents ? 0 : a.impactCents > b.impactCents ? -1 : 1) || compare(a.key, b.key)); return result;
  }
  function setReview(state, input) { shape(input, ['key', 'deferUntil', 'rank', 'reason', 'at']); const current = normalized(state), { reason, at } = metadata(input, '用户安排核对顺序'), row = normalizeReview({ key: input.key, deferUntil: input.deferUntil === undefined ? null : input.deferUntil, rank: input.rank === undefined ? null : input.rank, reason, updatedAt: at }); if (!reviewQueue(current, { asOf: at.slice(0, 10) }).some(r => r.key === row.key)) fail('NOT_FOUND', '当前待核对事项不存在'); return commit(current, 'set-review', [{ collection: 'reviews', key: row.key, after: row }], reason, at); }
  function captureMonth(current, monthValue, selectedIds, givenFinancial) {
    const m = month(monthValue), data = givenFinancial || financialData(current), events = personalEventIndex(data), sourceMap = sourceIndex(current), merchantMap = new Map(current.organizer.merchants.map(m => [m.transactionId, m])); let transactions = current.transactions.filter(t => t.date.slice(0, 7) === m && !data.impacts[t.id]?.excluded);
    if (selectedIds !== undefined) { const keys = array(selectedIds, LIMITS.rows).map(id), selectedKeys = new Set(keys), eligibleKeys = new Set(transactions.map(t => t.id)); if (selectedKeys.size !== keys.length || keys.some(key => !eligibleKeys.has(key))) fail('INVALID_SELECTION', '月结选择包含重复、附属或其他月份交易'); transactions = transactions.filter(t => selectedKeys.has(t.id)); }
    const transferPairs = new Map((current.bookkeeping?.transferPairs || []).map(p => [p.id, p])), composites = new Map((current.bookkeeping?.composites || []).map(p => [p.id, p])), compositeIds = new Set();
    const rows = transactions.sort((a, b) => compare(a.id, b.id)).map(t => {
      const impact = data.impacts[t.id], value = personalValue(t, events), personal = { ordinaryIncomeCents: t.type === 'income' ? value : 0, personalExpenseCents: t.type === 'expense' ? value : 0 };
      if (impact.compositeId) compositeIds.add(impact.compositeId);
      return { transaction: transaction(t), merchant: merchantMap.get(t.id)?.merchant || null, sources: sourceMap.get(t.id) || [], ...(impact.transferPairId ? { transferPair: clone(transferPairs.get(impact.transferPairId)) } : {}), ...(impact.compositeId ? { compositeId: impact.compositeId } : {}), impact: Object.fromEntries(['cashIncomeCents', 'cashExpenseCents', 'transferCents', 'ordinaryIncomeCents', 'personalExpenseCents', 'refundCents', 'claimCents'].map(k => [k, Object.prototype.hasOwnProperty.call(personal, k) ? personal[k] : impact[k]])) };
    });
    const compositeProofs = [...compositeIds].sort(compare).map(key => { const proof = composites.get(key); if (!proof) fail('INVALID_CLOSE', '当前组合影响缺少完整依据'); return proof; });
    if (compositeProofs.length) compositeProofCells({ compositeProofs });
    const cats = new Set(rows.map(r => r.transaction.categoryId).filter(Boolean)); return { month: m, revision: current.organizer.revision, importRevision: current.imports?.revision || 0, bookkeepingRevision: current.bookkeeping?.revision || 0, selection: selectedIds === undefined ? 'all-month' : 'selected', rows, ...(compositeProofs.length ? { compositeProofs: clone(compositeProofs) } : {}), categories: current.categories.filter(c => cats.has(c.id)).map(c => ({ ...c })).sort((a, b) => compare(a.id, b.id)), scope: scopeReportCurrent(current, { start: m + '-01', end: monthEnd(m) }), totals: sums(rows) };
  }
  function closeMonth(state, input) { shape(input, ['month', 'transactionIds', 'reason', 'at']); const current = normalized(state), { reason, at } = metadata(input, '保存可重放的冻结月结'), row = normalizeClose({ id: newId(current, 'close'), createdAt: at, reason, ...captureMonth(current, input.month, input.transactionIds) }); return commit(current, 'close-month', [{ collection: 'closes', key: row.id, after: row }], reason, at); }
  function compareMonth(state, closeId) {
    const current = normalized(state), saved = current.organizer.closes.find(c => c.id === id(closeId)); if (!saved) fail('NOT_FOUND', '冻结月结不存在');
    const currentFinancial = financialData(current), active = new Set(current.transactions.filter(t => !currentFinancial.impacts[t.id]?.excluded && t.date.slice(0, 7) === saved.month).map(t => t.id)), ids = saved.selection === 'selected' ? saved.rows.map(r => r.transaction.id).filter(key => active.has(key)) : undefined, now = captureMonth(current, saved.month, ids, currentFinancial), oldRows = new Map(saved.rows.map(r => [r.transaction.id, r])), newRows = new Map(now.rows.map(r => [r.transaction.id, r])), drivers = [];
    for (const key of [...new Set([...oldRows.keys(), ...newRows.keys()])].sort()) { const before = oldRows.get(key) || null, after = newRows.get(key) || null; if (!same(before, after)) drivers.push({ transactionId: key, kind: before === null ? 'added' : after === null ? 'removed-or-excluded' : 'changed', before: clone(before), after: clone(after), cashNetDeltaCents: safe(BigInt(after ? after.impact.cashIncomeCents - after.impact.cashExpenseCents : 0) - BigInt(before ? before.impact.cashIncomeCents - before.impact.cashExpenseCents : 0)), personalNetDeltaCents: safe(BigInt(after ? after.impact.ordinaryIncomeCents - after.impact.personalExpenseCents : 0) - BigInt(before ? before.impact.ordinaryIncomeCents - before.impact.personalExpenseCents : 0)) }); }
    const delta = {}; for (const type of ['cash', 'personal']) delta[type] = Object.fromEntries(Object.keys(saved.totals[type]).map(k => [k, safe(BigInt(now.totals[type][k]) - BigInt(saved.totals[type][k]))]));
    const inputsChanged = drivers.length > 0 || !same(saved.compositeProofs, now.compositeProofs) || !same(saved.scope, now.scope) || !same(saved.categories, now.categories) || saved.importRevision !== now.importRevision || saved.bookkeepingRevision !== now.bookkeepingRevision;
    return { closeId: saved.id, month: saved.month, changed: inputsChanged, inputsChanged, frozen: clone(saved), current: now, delta, drivers, scopeChanged: !same(saved.scope, now.scope), categoriesChanged: !same(saved.categories, now.categories) };
  }
  function rawView(state, transactionId) { const current = normalized(state), t = baseIndex(current).allTransactions.get(id(transactionId)); if (!t) fail('NOT_FOUND', '交易不存在'); const ids = sourceIds(current, t.id); return { transaction: clone(t), merchant: merchantOf(current.organizer, t.id)?.merchant || null, evidence: clone((current.imports?.evidence || []).filter(e => ids.has(e.transactionId))), groupingSource: merchantOf(current.organizer, t.id)?.batchId || null }; }
  function merchantView(state, monthValue) { const current = normalized(state), data = financialData(current), m = monthValue === undefined ? null : month(monthValue), events = personalEventIndex(data), groups = new Map(), merchantMap = new Map(current.organizer.merchants.map(m => [m.transactionId, m])); for (const t of current.transactions) if (!data.impacts[t.id]?.excluded && (!m || t.date.slice(0, 7) === m)) { const merchant = merchantMap.get(t.id)?.merchant || t.note, key = canonical([merchant, t.type]); const g = groups.get(key) || { merchant, type: t.type, transactionIds: [], rawCents: 0n, externalCashCents: 0n, transferCents: 0n, cashCents: 0n, personalCents: 0n }; g.transactionIds.push(t.id); g.rawCents += BigInt(t.amountCents); g.externalCashCents += BigInt(data.impacts[t.id].cashIncomeCents + data.impacts[t.id].cashExpenseCents); g.transferCents += BigInt(data.impacts[t.id].transferCents); g.cashCents += BigInt(t.type === 'expense' ? data.impacts[t.id].cashExpenseCents : t.type === 'income' ? data.impacts[t.id].cashIncomeCents : data.impacts[t.id].transferCents); g.personalCents += BigInt(personalValue(t, events)); groups.set(key, g); } return [...groups.values()].map(g => ({ ...g, transactionIds: g.transactionIds.sort(), rawCents: safe(g.rawCents), externalCashCents: safe(g.externalCashCents), transferCents: safe(g.transferCents), cashCents: safe(g.cashCents), personalCents: safe(g.personalCents) })).sort((a, b) => compare(a.merchant, b.merchant) || compare(a.type, b.type)); }
  function dependencies(state, transactionId) { const data = validate(state.organizer, state), key = id(transactionId); return data.merchants.filter(m => m.transactionId === key).map(m => ({ kind: 'merchant', id: m.batchId })); }
  function exportBackup(state) { const current = normalized(state); return JSON.stringify(bounded(current, LIMITS.backupBytes)); }
  return Object.freeze({ VERSION, COMPOSITE_VERSION, LEDGER_VERSION, MAX_AMOUNT_CENTS, LIMITS, OrganizerError, defaultState, validate, saveRule, removeRule, saveAlias, removeAlias, previewRules, previewAliases, applyPreview, rollbackBatch, setScope, scopeReport, reviewQueue, setReview, closeMonth, compareMonth, rawView, merchantView, dependencies, exportBackup });
}));
