/* Reviewed local held-principal classifications. No storage, network or implicit accounting date. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoneygoHeldFunds = api;
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const MAX_AMOUNT_CENTS = 999999999999;
  const PREVIEW_REASON = '预览：尚未确认';
  const METADATA = ['name', 'purpose', 'reference', 'expiry', 'refundability', 'terms', 'termsSource'];
  const FIELDS = Object.freeze({
    'create-position': ['action', 'asOfDate', 'expenseId', 'amountCents', 'kind', ...METADATA, 'confirmations'],
    'update-position': ['action', 'asOfDate', 'positionId', ...METADATA],
    recognize: ['action', 'asOfDate', 'positionId', 'kind', 'amountCents', 'effectiveDate', 'categoryId', 'merchant', 'reference', 'confirmations'],
    'allocate-return': ['action', 'asOfDate', 'positionId', 'incomeId', 'amountCents', 'reference'],
    'reverse-recognition': ['action', 'asOfDate', 'recognitionId'],
    'reverse-return': ['action', 'asOfDate', 'returnId'],
    'reverse-position': ['action', 'asOfDate', 'positionId']
  });
  class HeldFundsError extends Error { constructor(code, message) { super(message); this.name = 'HeldFundsError'; this.code = code; } }
  function fail(code, message) { throw new HeldFundsError(code, message); }
  function moduleOf(file, globalName) {
    const value = typeof module === 'object' && module.exports ? require('./' + file + '.js') : root[globalName];
    if (!value) fail('HELD_MODULE_UNAVAILABLE', '押金预付核对所需模块未加载，请刷新后重新核对');
    return value;
  }
  const ledger = () => moduleOf('ledger', 'MoneygoLedger');
  const relations = () => moduleOf('relations', 'MoneygoRelations');
  const core = () => moduleOf('held-core', 'MoneygoHeldCore');
  const organizer = () => moduleOf('organizer', 'MoneygoOrganizer');
  const scenario = () => moduleOf('scenario', 'MoneygoScenario');
  function nativePrototype(proto, name, expected) {
    if (!proto) return false;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'constructor');
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') return false;
    const back = Object.getOwnPropertyDescriptor(descriptor.value, 'prototype'), keys = Reflect.ownKeys(proto), expectedKeys = Reflect.ownKeys(expected);
    return !!back && Object.hasOwn(back, 'value') && back.value === proto && Function.prototype.toString.call(descriptor.value) === 'function ' + name + '() { [native code] }' && keys.length === expectedKeys.length && keys.every(key => expectedKeys.includes(key));
  }
  function ordinaryPrototype(proto) { return proto === null || Object.getPrototypeOf(proto) === null && nativePrototype(proto, 'Object', Object.prototype); }
  function ordinaryArrayPrototype(proto) { return !!proto && Array.isArray(proto) && nativePrototype(proto, 'Array', Array.prototype) && ordinaryPrototype(Object.getPrototypeOf(proto)); }
  function shape(value, fields, optional = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !ordinaryPrototype(Object.getPrototypeOf(value))) fail('INVALID_HELD_COMMAND', '核对输入须为普通记录');
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string' || !fields.includes(key) || !Object.getOwnPropertyDescriptor(value, key).enumerable || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')) || fields.some(key => !optional.includes(key) && !Object.hasOwn(value, key))) fail('INVALID_HELD_COMMAND', '核对输入字段缺失或包含不支持的字段');
    return value;
  }
  function id(value) { if (typeof value !== 'string' || value.length > 100 || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) || ['constructor', 'prototype'].includes(value)) fail('INVALID_ID', '记录标识无效'); return value; }
  function text(value, required = false, max = 500) { if (typeof value !== 'string' || value.length > max || required && !value.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || max === 80 && /[\u0000-\u001f\u007f]/.test(value)) fail('INVALID_HELD_COMMAND', '文字缺失、过长或包含无效字符'); return required ? value.trim() : value; }
  function date(value) { if (!ledger().validDate(value)) fail('INVALID_DATE', '必须明确填写有效的核对日期'); return value; }
  function timestamp(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !ledger().validDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('INVALID_DATE', '核对时钟须返回精确 UTC 时间'); return value; }
  function amount(value) { if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < 1 || value > MAX_AMOUNT_CENTS) fail('INVALID_AMOUNT', '本金须为正整数分且在金额范围内'); return value; }
  function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function bytes(value) { let count = 0; for (let i = 0; i < value.length; i++) { const c = value.charCodeAt(i); if (c < 128) count++; else if (c < 2048) count += 2; else if (c >= 0xd800 && c <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { count += 4; i++; } else count += 3; } return count; }
  function canonical(value) { return Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value); }
  // Inspect descriptors before any validator/JSON serializer can invoke an accessor.
  // This is a transient review boundary; it does not change legacy persistence schemas.
  function inputSignature(value) {
    let cells = 0;
    const seen = new Set();
    function inspect(item) {
      if (++cells > 5000000) fail('HELD_REVIEW_LIMIT', '本次核对输入超过安全范围');
      if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
      if (typeof item === 'number' && Number.isFinite(item)) return;
      if (!item || typeof item !== 'object' || seen.has(item)) fail('INVALID_HELD_STATE', '账本包含非数据或循环引用');
      const isArray = Array.isArray(item), prototype = Object.getPrototypeOf(item);
      if (!isArray && !ordinaryPrototype(prototype) || isArray && !ordinaryArrayPrototype(prototype)) fail('INVALID_HELD_STATE', '账本须为普通数据记录');
      seen.add(item);
      const keys = Reflect.ownKeys(item);
      if (isArray && keys.length !== item.length + 1) fail('INVALID_HELD_STATE', '账本数组不能有空项或额外字段');
      for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (isArray && key === 'length') continue;
        if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value') || isArray && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= item.length)) fail('INVALID_HELD_STATE', '账本不能包含访问器、隐藏或额外字段');
        inspect(descriptor.value);
      }
      seen.delete(item);
    }
    inspect(value);
    const signature = canonical(value);
    if (signature.length > 32 * 1024 * 1024 || bytes(signature) > 32 * 1024 * 1024) fail('HELD_REVIEW_LIMIT', '本次核对输入超过安全范围');
    return signature;
  }
  function normalizeCommand(input) {
    // Read action only after checking its own descriptor.
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_HELD_COMMAND', '核对命令无效');
    const discriminator = Object.getOwnPropertyDescriptor(input, 'action');
    if (!discriminator || !Object.hasOwn(discriminator, 'value') || !Object.hasOwn(FIELDS, discriminator.value)) fail('INVALID_HELD_COMMAND', '不支持此核对操作');
    shape(input, FIELDS[discriminator.value]);
    const out = { action: input.action, asOfDate: date(input.asOfDate) };
    for (const key of ['expenseId', 'positionId', 'incomeId', 'recognitionId', 'returnId', 'categoryId']) if (Object.hasOwn(input, key)) out[key] = id(input[key]);
    if (Object.hasOwn(input, 'amountCents')) out.amountCents = amount(input.amountCents);
    if (Object.hasOwn(input, 'effectiveDate')) out.effectiveDate = date(input.effectiveDate);
    if (Object.hasOwn(input, 'kind')) { const allowed = input.action === 'create-position' ? ['deposit', 'prepayment', 'stored-value'] : ['use', 'loss']; if (!allowed.includes(input.kind)) fail('INVALID_HELD_COMMAND', '本金或确认种类无效'); out.kind = input.kind; }
    for (const key of ['purpose', 'reference', 'terms', 'termsSource']) if (Object.hasOwn(input, key)) out[key] = text(input[key]);
    if (Object.hasOwn(input, 'name')) out.name = text(input.name, true, 80);
    if (Object.hasOwn(input, 'merchant')) out.merchant = input.merchant === null ? null : text(input.merchant, true, 80);
    if (Object.hasOwn(input, 'expiry')) { shape(input.expiry, ['kind', 'date']); if (!['unknown', 'none', 'date'].includes(input.expiry.kind) || input.expiry.kind !== 'date' && input.expiry.date !== null) fail('INVALID_HELD_COMMAND', '到期条款无效'); out.expiry = { kind: input.expiry.kind, date: input.expiry.kind === 'date' ? date(input.expiry.date) : null }; }
    if (Object.hasOwn(input, 'refundability')) { if (!['unknown', 'refundable', 'conditional', 'nonrefundable'].includes(input.refundability)) fail('INVALID_HELD_COMMAND', '退回条款无效'); out.refundability = input.refundability; }
    if (Object.hasOwn(input, 'confirmations')) { const keys = input.action === 'create-position' ? ['paidPrincipalOnly', 'noTrackedWalletOverlap'] : ['notAlreadyRecordedAsExpense']; shape(input.confirmations, keys); if (keys.some(key => input.confirmations[key] !== true)) fail('CONFIRMATION_REQUIRED', '请如实确认本金、钱包重叠或重复消费情况；不确定时暂缓分类'); out.confirmations = Object.fromEntries(keys.map(key => [key, true])); }
    return freeze(out);
  }
  function safe(values) { let total = 0n; for (const value of values) total += BigInt(value); if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) fail('AMOUNT_OVERFLOW', '核对累计金额超过精确计算范围'); return Number(total); }
  function graphOf(state) {
    const data = state.bookkeeping;
    return core().validateGraph({ positions: data?.heldPositions || [], recognitions: data?.heldRecognitions || [], returns: data?.heldReturns || [], sources: state.transactions.map(row => ({ id: row.id, type: row.type, date: row.date, amountCents: row.amountCents, accountId: row.accountId, toAccountId: row.type === 'transfer' ? row.toAccountId : null })), categories: state.categories.map(row => ({ id: row.id, type: row.type, name: row.name })) });
  }
  function merchantIndex(state) {
    const overrides = new Map((state.organizer?.merchants || []).map(row => [row.transactionId, row.merchant]));
    return new Map(state.transactions.map(row => [row.id, overrides.get(row.id) || row.note]));
  }
  function sourceIndex(state, financial) {
    const merchants = merchantIndex(state), accounts = new Map(state.accounts.map(row => [row.id, row.name])), categories = new Map(state.categories.map(row => [row.id, row.name])), evidence = new Map();
    for (const row of state.imports?.evidence || []) if (row.transactionId) { const refs = evidence.get(row.transactionId) || []; refs.push({ evidenceId: row.id, sourceKey: row.sourceKey }); evidence.set(row.transactionId, refs); }
    return new Map(state.transactions.map(row => [row.id, { transaction: clone(row), accountName: accounts.get(row.accountId), categoryName: categories.get(row.categoryId) || null, merchant: merchants.get(row.id) || null, evidence: (evidence.get(row.id) || []).sort((a, b) => a.evidenceId.localeCompare(b.evidenceId)), ordinaryResidualCents: row.type === 'expense' ? financial.impacts[row.id].personalExpenseCents : row.type === 'income' ? financial.impacts[row.id].ordinaryIncomeCents : 0 }]));
  }
  function viewPrepared(state, financial, graph, asOfDate) {
    const balances = core().balancesAt(graph, asOfDate), balanceMap = new Map(balances.positions.map(row => [row.positionId, row])), sources = sourceIndex(state, financial), categories = new Map(state.categories.map(row => [row.id, row.name])), data = state.bookkeeping, warnings = [];
    const positions = graph.positions.map(position => {
      const balance = balanceMap.get(position.id), rowWarnings = [];
      if (position.expiry.kind === 'unknown') rowWarnings.push({ code: 'UNKNOWN_EXPIRY', message: '未记录到期条款，不能推断有效期。' });
      if (position.refundability === 'unknown') rowWarnings.push({ code: 'UNKNOWN_REFUNDABILITY', message: '未记录可退条款，剩余记录本金不等于可退金额。' });
      const expired = position.expiry.kind === 'date' && position.expiry.date < asOfDate ? balance.remainingCents : 0;
      if (expired) rowWarnings.push({ code: 'ENTERED_EXPIRY_PASSED', message: '已过填写的到期日，仍有未使用记录本金；不会自动确认损失或承诺可退。', amountCents: expired });
      if (position.expiry.kind === 'date' && position.expiry.date === position.expenseSignature.date) rowWarnings.push({ code: 'EXPIRY_ON_FUNDING_DAY', message: '填写的到期日与原付款日在同一天，请核对条款。' });
      for (const warning of rowWarnings) warnings.push({ ...warning, positionId: position.id });
      return { ...clone(position), ...balance, source: sources.get(position.expenseId), recognitions: graph.recognitions.filter(row => row.positionId === position.id).map(row => ({ ...clone(row), categoryName: categories.get(row.categoryId) })), returns: graph.returns.filter(row => row.positionId === position.id).map(row => ({ ...clone(row), source: sources.get(row.incomeId) })), audit: (data?.audit || []).filter(event => event.kind === 'heldPosition' && event.recordId === position.id || ['heldRecognition', 'heldReturn'].includes(event.kind) && (event.before?.positionId === position.id || event.after?.positionId === position.id)).map(clone), expiredUnconsumedRecordedPrincipalCents: expired, warnings: rowWarnings };
    });
    return freeze({ asOfDate, revision: data?.revision || 0, positions, totals: { ...balances.totals }, expiredUnconsumedRecordedPrincipalCents: safe(positions.map(row => row.expiredUnconsumedRecordedPrincipalCents)), warnings, scope: 'recorded-principal-not-cash-or-refund-guarantee' });
  }
  function creditReferences(state, transactionId) {
    const out = new Map(), data = state.obligations;
    if (!data) return [];
    function collect(kind, row) { if (!row) return; const references = kind === 'fee' ? [row.transactionId, row.transactionSignature.id] : kind === 'contract' ? [row.purchaseTransactionId, row.purchaseSignature?.id] : kind === 'repayment' ? row.sourceProof.legs.map(leg => leg.id) : []; if (references.includes(transactionId)) out.set(kind + ':' + row.id, { kind, id: row.id }); }
    for (const row of data.fees) collect('fee', row); for (const row of data.contracts) collect('contract', row); for (const row of data.repayments) collect('repayment', row);
    for (const event of data.audit) { collect(event.kind, event.before); collect(event.kind, event.after); }
    return [...out.values()];
  }
  function eligibilityPrepared(state, financial, graph, options) {
    shape(options, ['role', 'transactionId', 'positionId', 'asOfDate'], ['positionId']);
    if (!['funding', 'return'].includes(options.role)) fail('INVALID_HELD_COMMAND', '须明确选择本金或实际退回来源');
    const role = options.role, transactionId = id(options.transactionId), positionId = options.positionId === undefined ? null : id(options.positionId), asOfDate = date(options.asOfDate), transaction = state.transactions.find(row => row.id === transactionId), data = state.bookkeeping, reasons = [];
    const add = (code, message, detail) => reasons.push({ code, message, ...(detail ? { dependencies: detail } : {}) });
    if (!transaction) add('SOURCE_NOT_FOUND', '须选择仍存在的真实原始交易。');
    else {
      if (transaction.type !== (role === 'funding' ? 'expense' : 'income')) add('SOURCE_TYPE', role === 'funding' ? '本金须引用真实支出。' : '退回须引用真实收入。');
      if (transaction.date > asOfDate) add('FUTURE_SOURCE', '来源日期晚于明确核对日期，暂不能分类。');
      const conflicts = [];
      const touches = (collection, kind, predicate) => { for (const row of data?.[collection] || []) if (predicate(row)) conflicts.push({ kind, id: row.id }); };
      touches('links', 'link', row => row.primaryId === transactionId || row.shadowId === transactionId);
      touches('transferPairs', 'transferPair', row => row.expenseId === transactionId || row.incomeId === transactionId);
      touches('composites', 'composite', row => row.signatures.some(part => part.id === transactionId));
      touches('refunds', 'refund', row => row.expenseId === transactionId || row.incomeId === transactionId);
      touches('claims', 'claim', row => row.expenseId === transactionId);
      touches('settlements', 'settlement', row => row.incomeId === transactionId);
      touches('refundPlans', 'refundPlan', row => row.expenseId === transactionId);
      if (conflicts.length) add('SOURCE_ROLE_CONFLICT', '整个来源已有不兼容的账务用途；剩余金额不代表可分类。', conflicts);
      const credit = creditReferences(state, transactionId); if (credit.length) add('HELD_CREDIT_HISTORY_CONFLICT', '此来源在信用费用、原分期消费或还款历史中被引用。', credit);
    }
    let capacityCents = transaction?.type === (role === 'funding' ? 'expense' : 'income') ? transaction.amountCents : 0;
    if (role === 'funding') capacityCents -= graph.sourceReservations.find(row => row.expenseId === transactionId)?.amountCents || 0;
    else {
      capacityCents -= graph.receiptReservations.find(row => row.incomeId === transactionId)?.amountCents || 0;
      const position = graph.positions.find(row => row.id === positionId);
      if (!position) add('POSITION_REQUIRED', '须选择仍有效的单笔押金预付记录。');
      else if (transaction) {
        if (transaction.date < position.expenseSignature.date) add('RETURN_BEFORE_FUNDING', '实际退回日期不能早于原付款日期。');
        // Future recorded deductions still reserve this single lot; accepting a return
        // cannot make any later day negative. The minimum suffix is the true capacity.
        const days = graph.timelines.find(row => row.positionId === positionId).days;
        const atReceipt = core().balancesAt(graph, transaction.date).positions.find(row => row.positionId === positionId).remainingCents;
        const suffix = days.filter(day => day.date >= transaction.date).map(day => day.remainingCents);
        capacityCents = Math.min(capacityCents, atReceipt, ...suffix);
      }
    }
    if (capacityCents <= 0) add('NO_CAPACITY', role === 'funding' ? '原付款本金已被完整保留，耗尽余额不会释放来源。' : '此收款或该笔记录没有可分配的剩余本金；实际收入仍保留原有分类。');
    return freeze({ role, transactionId, positionId, asOfDate, eligible: reasons.length === 0, capacityCents: Math.max(0, capacityCents), reasons, source: sourceIndex(state, financial).get(transactionId) || null });
  }
  function eventIndex(state, financial) {
    const merchants = merchantIndex(state), months = new Map(), categories = new Map(), merchantGroups = new Map(), events = new Map();
    for (const event of financial.personalExpenseEvents.concat(financial.personalIncomeEvents)) {
      const kind = event.key.kind === 'transaction-income' ? 'income' : 'expense', month = event.effectiveDate.slice(0, 7), key = canonical(event.key), merchant = event.key.kind === 'held-recognition' ? event.attribution.merchant || '未填写商户' : merchants.get(event.origin.transactionId) || null;
      const entry = { event: clone(event), merchant }; events.set(key, entry);
      function add(map, groupKey, identity) { const group = map.get(groupKey) || { ...identity, expense: 0n, income: 0n, eventKeys: [] }; group[kind] += BigInt(event.amountCents); group.eventKeys.push(clone(event.key)); map.set(groupKey, group); }
      add(months, month, { month }); add(categories, canonical([month, kind, event.categoryId]), { month, type: kind, categoryId: event.categoryId }); add(merchantGroups, canonical([month, kind, merchant]), { month, type: kind, merchant });
    }
    function finish(map) { for (const [key, value] of map) { const expenseCents = safe([value.expense]), incomeCents = safe([value.income]); map.set(key, { ...Object.fromEntries(Object.entries(value).filter(([field]) => !['expense', 'income'].includes(field))), expenseCents, incomeCents, netCents: safe([incomeCents, -expenseCents]) }); } }
    finish(months); finish(categories); finish(merchantGroups);
    return { months, categories, merchants: merchantGroups, events };
  }
  function delta(before, after) { const out = {}; for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) if (typeof before[key] === 'number' || typeof after[key] === 'number') out[key] = safe([after[key] || 0, -(before[key] || 0)]); return out; }
  function changedGroups(before, after, labels) {
    const out = [];
    for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
      const a = before.get(key) || null, b = after.get(key) || null;
      if (canonical(a) === canonical(b)) continue;
      const identity = Object.fromEntries(labels.map(label => [label, (b || a)[label]]));
      out.push({ ...identity, before: a, after: b, delta: { expenseCents: safe([b?.expenseCents || 0, -(a?.expenseCents || 0)]), incomeCents: safe([b?.incomeCents || 0, -(a?.incomeCents || 0)]), netCents: safe([b?.netCents || 0, -(a?.netCents || 0)]) } });
    }
    return out;
  }
  function monthEnd(month) { const year = +month.slice(0, 4), m = +month.slice(5), days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; return month + '-' + days; }
  function actualRoles(state, financial, asOfDate) {
    const profiles = new Map((state.obligations?.profiles || []).map(row => [row.accountId, row.role])), balances = new Map(state.accounts.map(row => [row.id, BigInt(row.openingBalanceCents)])), groups = Object.fromEntries(['cash', 'credit', 'restricted', 'other', 'unknown'].map(role => [role, { balanceCents: 0, inflowCents: 0, outflowCents: 0, netCents: 0 }]));
    const flows = new Map(state.accounts.map(row => [row.id, { income: 0n, expense: 0n }]));
    for (const row of financial.drilldown.accountFlows) if (row.date <= asOfDate) for (const leg of row.movements) { const n = BigInt(leg.signedCents); balances.set(leg.accountId, balances.get(leg.accountId) + n); const f = flows.get(leg.accountId); if (n > 0n) f.income += n; else f.expense -= n; }
    let debt = 0n, creditPositive = 0n, rolesComplete = true;
    for (const account of state.accounts) { const role = profiles.get(account.id) || 'unknown', value = balances.get(account.id), f = flows.get(account.id), group = groups[role]; if (role === 'unknown') rolesComplete = false; group.balanceCents = safe([group.balanceCents, value]); group.inflowCents = safe([group.inflowCents, f.income]); group.outflowCents = safe([group.outflowCents, f.expense]); group.netCents = safe([group.inflowCents, -group.outflowCents]); if (role === 'credit') { if (value < 0n) debt -= value; else creditPositive += value; } }
    return { asOfDate, groups, rolesComplete, knownCashBalanceCents: groups.cash.balanceCents, liquidBalanceCents: rolesComplete ? groups.cash.balanceCents : null, recordedCreditDebtCents: safe([debt]), recordedCreditPositiveBalanceCents: safe([creditPositive]), coverageComplete: false };
  }
  function assertActuals(before, after, a, b, asOfDate) {
    for (const field of ['transactions', 'trash', 'accounts', 'categories', 'simulation', 'imports', 'organizer', 'obligations']) if (canonical(before[field]) !== canonical(after[field])) fail('HELD_ACTUAL_CHANGED', '分类候选意外修改了原交易或其他资料，未提交');
    for (const field of ['cash', 'accountFlows', 'accountBalances']) if (canonical(a[field]) !== canonical(b[field])) fail('HELD_ACTUAL_CHANGED', '分类不能改变实际资金或账户余额');
    if (canonical(a.drilldown.accountFlows) !== canonical(b.drilldown.accountFlows)) fail('HELD_ACTUAL_CHANGED', '分类不能生成或改变账户资金流');
    const roleBefore = actualRoles(before, a, asOfDate), roleAfter = actualRoles(after, b, asOfDate);
    if (canonical(roleBefore) !== canonical(roleAfter)) fail('HELD_ACTUAL_CHANGED', '分类不能改变流动资金或记录信用负债');
    return { cash: delta(a.cash, b.cash), accountFlows: delta(a.accountFlows, b.accountFlows), accountBalances: delta(a.accountBalances, b.accountBalances), roleAware: { before: roleBefore, after: roleAfter, delta: { knownCashBalanceCents: 0, liquidBalanceCents: roleBefore.liquidBalanceCents === null ? null : 0, recordedCreditDebtCents: 0, recordedCreditPositiveBalanceCents: 0 } }, actualTransactionsChanged: false };
  }
  function affectedPosition(command, before, after) {
    if (command.action === 'create-position') return after.bookkeeping.audit.at(-1).recordId;
    if (command.positionId) return command.positionId;
    const collection = command.action === 'reverse-recognition' ? 'heldRecognitions' : 'heldReturns', key = command.recognitionId || command.returnId;
    return before.bookkeeping[collection].find(row => row.id === key).positionId;
  }
  function reviewPrepared(before, after, command, a, b, graphBefore, graphAfter) {
    const beforeView = viewPrepared(before, a, graphBefore, command.asOfDate), afterView = viewPrepared(after, b, graphAfter, command.asOfDate), aIndex = eventIndex(before, a), bIndex = eventIndex(after, b), changedMonths = changedGroups(aIndex.months, bIndex.months, ['month']), positionId = affectedPosition(command, before, after), sourceIds = new Set();
    for (const graph of [graphBefore, graphAfter]) { const position = graph.positions.find(row => row.id === positionId); if (position) sourceIds.add(position.expenseId); for (const row of graph.returns) if (row.positionId === positionId) sourceIds.add(row.incomeId); }
    const aSources = sourceIndex(before, a), bSources = sourceIndex(after, b), sources = [...sourceIds].sort().map(transactionId => ({ transactionId, before: aSources.get(transactionId) || null, after: bSources.get(transactionId) || null }));
    const cutoffs = new Set([command.asOfDate, ...changedMonths.map(row => monthEnd(row.month)), ...(before.organizer?.closes || []).map(row => monthEnd(row.month))]);
    const rights = [...cutoffs].sort().map(asOfDate => { const x = core().balancesAt(graphBefore, asOfDate), y = core().balancesAt(graphAfter, asOfDate); return { asOfDate, before: x, after: y, delta: delta(x.totals, y.totals) }; });
    let frozenComparisons = [];
    if (before.organizer !== undefined) { if (typeof organizer().compareHeldReview !== 'function') fail('HELD_MODULE_UNAVAILABLE', '冻结复盘核对接口未加载'); frozenComparisons = organizer().compareHeldReview(before, after, { beforeFinancial: a, afterFinancial: b }); }
    let scenarioReview = null;
    if (before.simulation !== undefined) {
      const engine = scenario(); if (typeof engine.calculateHeldReview !== 'function') fail('HELD_MODULE_UNAVAILABLE', '沙盘事件核对接口未加载');
      const x = engine.calculateHeldReview(before, before.simulation, command.asOfDate, { expenseEvents: a.personalExpenseEvents, incomeEvents: a.personalIncomeEvents }), y = engine.calculateHeldReview(after, after.simulation, command.asOfDate, { expenseEvents: b.personalExpenseEvents, incomeEvents: b.personalIncomeEvents });
      const aEvents = aIndex.events, bEvents = bIndex.events, impactedEventKeys = [...new Set([...aEvents.keys(), ...bEvents.keys()])].sort().filter(key => canonical(aEvents.get(key)) !== canonical(bEvents.get(key))).map(key => clone((bEvents.get(key) || aEvents.get(key)).event.key));
      scenarioReview = { before: x, after: y, changed: canonical(x) !== canonical(y), exclusions: clone(before.simulation.exclusions), impactedEventKeys };
    }
    const warnings = [...afterView.warnings];
    const backdatedMonths = changedMonths.filter(row => row.month < command.asOfDate.slice(0, 7)).map(row => row.month);
    if (backdatedMonths.length) warnings.push({ code: 'RESTATES_EARLIER_MONTHS', message: '此分类会重述较早月份的个人收支。', months: backdatedMonths });
    if (command.action.startsWith('reverse-')) warnings.push({ code: 'CLASSIFICATION_REVERSAL_ONLY', message: '撤销只改变记录分类，不代表商户退钱或任何账户资金移动。' });
    if (command.action === 'recognize') warnings.push({ code: 'USER_CONFIRMED_NONCASH', message: '这是人工确认的非现金消费或损失；系统不能证明它未在别处重复记账。' });
    return freeze({ positionId, before: beforeView, after: afterView, sources, changedMonths, categories: changedGroups(aIndex.categories, bIndex.categories, ['month', 'type', 'categoryId']), merchants: changedGroups(aIndex.merchants, bIndex.merchants, ['month', 'type', 'merchant']), rights, actualDeltas: assertActuals(before, after, a, b, command.asOfDate), scenario: scenarioReview, frozenComparisons, warnings, backdatedMonths });
  }
  // Mask only the one newly appended event and its newly created row, everywhere
  // that exact ID appears in the review. Existing history is never exempted.
  function equivalence(value, event) {
    function visit(item) {
      if (Array.isArray(item)) return item.map(visit);
      if (!item || typeof item !== 'object') return item;
      const out = {}; for (const [key, val] of Object.entries(item)) {
        if (item.id === event.id && ['at', 'reason'].includes(key)) out[key] = '<commit-only>';
        else if (event.action === 'create' && item.id === event.recordId && ['createdAt', 'reason'].includes(key)) out[key] = '<commit-only>';
        else if (event.action === 'create' && event.kind === 'heldRecognition' && item.event?.key?.kind === 'held-recognition' && item.event.key.id === event.recordId && key === 'reason') out[key] = '<commit-only>';
        else out[key] = visit(val);
      } return out;
    }
    return canonical(visit(value));
  }
  function createCoordinator(options) {
    if (options === undefined) options = {};
    shape(options, ['now'], ['now']);
    const now = options.now === undefined ? () => new Date().toISOString() : options.now;
    if (typeof now !== 'function') fail('INVALID_HELD_COMMAND', '核对时钟必须是函数');
    const tickets = new WeakMap();
    function pipeline(state, command, at, reason) {
      const before = ledger().validateState(state), candidate = relations().applyHeldTransition(before, command, { at, reason }), after = ledger().validateState(candidate);
      const beforeFinancial = relations().calculate(before), afterFinancial = relations().calculate(after), graphBefore = graphOf(before), graphAfter = graphOf(after);
      const review = reviewPrepared(before, after, command, beforeFinancial, afterFinancial, graphBefore, graphAfter);
      const reviewText = canonical(review); if (reviewText.length > 16 * 1024 * 1024 || bytes(reviewText) > 16 * 1024 * 1024) fail('HELD_REVIEW_LIMIT', '完整核对内容超过 16 MiB 上限，未修改任何数据');
      return { candidate: after, review };
    }
    function preview(state, input) {
      const signature = inputSignature(state), command = normalizeCommand(input), at = timestamp(now()), result = pipeline(state, command, at, PREVIEW_REASON), event = result.candidate.bookkeeping.audit.at(-1);
      const ticket = freeze({ action: command.action, asOfDate: command.asOfDate, command: clone(command), review: result.review });
      tickets.set(ticket, { signature, command, candidate: equivalence(result.candidate, event), review: equivalence(result.review, event), eventId: event.id, recordId: event.recordId });
      return ticket;
    }
    function commit(state, ticket, confirmation) {
      const saved = tickets.get(ticket);
      if (!saved) fail('INVALID_HELD_REVIEW', '此核对已失效，请重新预览');
      tickets.delete(ticket); // Every attempted commit consumes the capability, even rejection.
      shape(confirmation, ['confirmed', 'reason']);
      if (confirmation.confirmed !== true) fail('CONFIRMATION_REQUIRED', '请核对影响后明确确认');
      const reason = text(confirmation.reason, true);
      if (inputSignature(state) !== saved.signature) fail('STALE_HELD_REVIEW', '账本或相关资料已变化，请重新核对');
      const at = timestamp(now()), result = pipeline(state, saved.command, at, reason), event = result.candidate.bookkeeping.audit.at(-1);
      if (event.id !== saved.eventId || event.recordId !== saved.recordId || equivalence(result.candidate, event) !== saved.candidate || equivalence(result.review, event) !== saved.review) fail('HELD_REVIEW_MISMATCH', '提交影响与核对结果不一致，请重新预览');
      return result.candidate;
    }
    function view(state, options) { shape(options, ['asOfDate']); const asOfDate = date(options.asOfDate); inputSignature(state); const current = ledger().validateState(state), financial = relations().calculate(current); return viewPrepared(current, financial, graphOf(current), asOfDate); }
    function eligibility(state, options) { inputSignature(state); const current = ledger().validateState(state), financial = relations().calculate(current); return eligibilityPrepared(current, financial, graphOf(current), options); }
    return Object.freeze({ preview, commit, view, eligibility });
  }
  const coordinator = createCoordinator();
  return Object.freeze({ HeldFundsError, createCoordinator, preview: coordinator.preview, commit: coordinator.commit, view: coordinator.view, eligibility: coordinator.eligibility });
}));
