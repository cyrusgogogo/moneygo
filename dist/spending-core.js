/* Pure spending-planning schema, proof and journal kernel. No live model or clock. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoneygoSpendingCore = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const LIMITS = Object.freeze({ plans: 200, payments: 1000, paymentsPerPlan: 100,
    everIds: 6000, audit: 12000, changesPerOperation: 3, proofComponents: 200,
    basisCells: 100000, remainingReferenceCells: 100000,
    planningBytes: 8388608, resultBytes: 8388608, backupBytes: 33554432,
    dataNodes: 33554432, stringCodeUnits: 33554432, idLength: 100,
    amountCents: 999999999999, sourceCatalogRows: 11000 });
  const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
  const ownMetrics = new WeakMap(), ownErrors = new WeakSet();
  const hasOwn = Function.call.bind(Object.prototype.hasOwnProperty);
  const nativeSource = Function.call.bind(Function.prototype.toString);
  const objectPrototypeKeys = Reflect.ownKeys(Object.prototype);
  const arrayPrototypeKeys = Reflect.ownKeys(Array.prototype);
  const planFields = ['id', 'createdAt', 'name', 'stage', 'status', 'targetAmountCents', 'expectedDate', 'expectedAccountId', 'commitmentBasis', 'note', 'remainingConfirmation'];
  const paymentFields = ['id', 'createdAt', 'reviewedAsOfDate', 'planId', 'transactionId', 'amountCents', 'proof', 'reference'];
  const operationFields = ['id', 'revision', 'at', 'asOfDate', 'action', 'reason', 'changes'];
  const changeFields = ['kind', 'recordId', 'before', 'after', 'reverses'];
  const signatureFields = ['id', 'type', 'date', 'amountCents', 'accountId', 'toAccountId'];
  const proofFields = ['version', 'source', 'role', 'cashProfile', 'duplicateEvidence', 'refunds', 'claims', 'grossPaymentCents'];
  const actions = ['create-plan', 'update-plan', 'commit-plan', 'cancel-plan', 'reopen-plan', 'return-to-plan', 'confirm-remaining', 'retire-plan', 'allocate-payment', 'reverse-payment', 'reconfirm-payment'];
  class SpendingCoreError extends Error {
    constructor(code, message) { super(message); this.name = 'SpendingCoreError'; this.code = code; }
  }
  function fail(code, message) { const error = new SpendingCoreError(code, message); ownErrors.add(error); throw error; }
  function invalid(message) { fail('SPENDING_INVALID_RECORD', message); }
  function guard(action) {
    try { return action(); } catch (error) {
      if (ownErrors.has(error)) throw error;
      fail('SPENDING_INVALID_DATA', 'Data cannot be inspected safely');
    }
  }
  function sameKeys(value, expected) {
    const keys = Reflect.ownKeys(value);
    return keys.length === expected.length && keys.every(key => expected.includes(key));
  }
  function nativePrototype(proto, name) {
    const ctor = Object.getOwnPropertyDescriptor(proto, 'constructor');
    if (!ctor || !hasOwn(ctor, 'value') || typeof ctor.value !== 'function') return false;
    const back = Object.getOwnPropertyDescriptor(ctor.value, 'prototype');
    return !!back && hasOwn(back, 'value') && back.value === proto &&
      nativeSource(ctor.value) === 'function ' + name + '() { [native code] }';
  }
  function ordinaryObjectPrototype(proto) {
    return proto !== null && Object.getPrototypeOf(proto) === null &&
      nativePrototype(proto, 'Object') && sameKeys(proto, objectPrototypeKeys);
  }
  function objectKeys(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('Expected an ordinary data record');
    const proto = Object.getPrototypeOf(value);
    if (proto !== null && !ordinaryObjectPrototype(proto)) invalid('Custom record prototypes are not allowed');
    const keys = Reflect.ownKeys(value);
    for (const key of keys) if (typeof key !== 'string') invalid('Symbol fields are not allowed');
    return keys;
  }
  function dataValue(value, key) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) invalid('Fields must be enumerable own data');
    return descriptor.value;
  }
  function arrayLength(value, maximum) {
    if (!Array.isArray(value)) invalid('Expected an ordinary dense array');
    const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (!descriptor || !hasOwn(descriptor, 'value') || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0) invalid('Invalid array length');
    const length = descriptor.value;
    if (length > maximum) fail('SPENDING_LIMIT', 'Array exceeds its row budget');
    const proto = Object.getPrototypeOf(value);
    if (!proto || !Array.isArray(proto) || !nativePrototype(proto, 'Array') ||
        !ordinaryObjectPrototype(Object.getPrototypeOf(proto)) || !sameKeys(proto, arrayPrototypeKeys)) invalid('Custom array prototypes are not allowed');
    if (Reflect.ownKeys(value).length !== length + 1) invalid('Arrays must be dense without extra fields');
    return length;
  }
  function record(value, fields) {
    const keys = objectKeys(value);
    if (keys.length !== fields.length) invalid('Missing or unexpected record fields');
    const out = Object.create(null);
    for (const key of keys) {
      if (!fields.includes(key)) invalid('Unexpected record field');
      out[key] = dataValue(value, key);
    }
    for (const key of fields) if (!hasOwn(out, key)) invalid('Missing record field');
    return out;
  }
  function arrayValues(value, maximum) {
    const length = arrayLength(value, maximum), out = [];
    for (let i = 0; i < length; i++) out.push(dataValue(value, String(i)));
    return out;
  }
  // Count the actual UTF-8 cost of JSON string escaping without serializing input.
  // Well-formed JSON.stringify escapes lone surrogates, but encodes pairs as four bytes.
  function stringBytes(value) {
    if (value.length > LIMITS.stringCodeUnits) fail('SPENDING_LIMIT', 'String exceeds the safety ceiling');
    let bytes = 2;
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c === 34 || c === 92 || c === 8 || c === 9 || c === 10 || c === 12 || c === 13) bytes += 2;
      else if (c < 32) bytes += 6;
      else if (c < 128) bytes++;
      else if (c < 2048) bytes += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
      else if (c >= 0xd800 && c <= 0xdfff) bytes += 6;
      else bytes += 3;
    }
    return bytes;
  }
  function inspect(raw, maximum) {
    let jsonBytes = 0, nodeCount = 0;
    const ancestors = new WeakSet(), stack = [{ value: raw }];
    function cost(n) {
      jsonBytes += n;
      if (jsonBytes > maximum) fail('SPENDING_LIMIT', 'JSON UTF-8 byte budget exceeded');
    }
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (hasOwn(frame, 'value')) {
        const value = frame.value;
        delete frame.value;
        if (++nodeCount > LIMITS.dataNodes) fail('SPENDING_LIMIT', 'Data node budget exceeded');
        if (value === null) { cost(4); stack.pop(); continue; }
        if (typeof value === 'string') { cost(stringBytes(value)); stack.pop(); continue; }
        if (typeof value === 'boolean') { cost(value ? 4 : 5); stack.pop(); continue; }
        if (typeof value === 'number') {
          if (!Number.isFinite(value) || Object.is(value, -0)) fail('SPENDING_INVALID_DATA', 'Numbers must be finite and not negative zero');
          if (Number.isInteger(value) && !Number.isSafeInteger(value)) fail('SPENDING_AMOUNT', 'Integral JSON numbers must be safe integers');
          cost(String(value).length); stack.pop(); continue;
        }
        if (typeof value !== 'object') fail('SPENDING_INVALID_DATA', 'Only ordinary JSON data is allowed');
        if (ancestors.has(value)) invalid('Cyclic data is not allowed');
        frame.object = value; frame.index = 0;
        if (Array.isArray(value)) {
          // Every array value needs at least one byte and all but one need a comma.
          frame.length = arrayLength(value, Math.min(LIMITS.dataNodes - 1, Math.floor((maximum - 1) / 2)));
          frame.array = true;
          cost(2 + Math.max(0, frame.length - 1));
        } else {
          frame.keys = objectKeys(value); frame.length = frame.keys.length; frame.array = false;
          cost(2 + Math.max(0, frame.length - 1));
        }
        ancestors.add(value);
      } else if (frame.index < frame.length) {
        const key = frame.array ? String(frame.index++) : frame.keys[frame.index++];
        if (!frame.array) cost(stringBytes(key) + 1);
        stack.push({ value: dataValue(frame.object, key) });
      } else { ancestors.delete(frame.object); stack.pop(); }
    }
    return Object.freeze({ jsonBytes, nodeCount });
  }
  // Safety-only raw inspection: aggregate byte budgets belong to normalized data.
  // Individual strings and total nodes still have explicit32MiB-unit safety ceilings.
  function inspectData(raw) { return guard(() => inspect(raw, Infinity)); }
  function compareId(a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; }
  // This serializer is used only after a full descriptor/size inspection. It still
  // reads descriptors rather than properties, so it never invokes toJSON/getters.
  function canonical(raw) {
    const chunks = [], stack = [{ value: raw }], ancestors = new WeakSet();
    let bytes = 0, nodes = 0;
    function append(value) { bytes += utf8Bytes(value); if (bytes > LIMITS.backupBytes) fail('SPENDING_LIMIT', 'Canonical data exceeds the byte budget'); chunks.push(value); }
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (hasOwn(frame, 'value')) {
        const value = frame.value; delete frame.value;
        if (++nodes > LIMITS.dataNodes) fail('SPENDING_LIMIT', 'Canonical data exceeds the node budget');
        if (value === null || typeof value !== 'object') {
          if (!(value === null || typeof value === 'string' || typeof value === 'boolean' ||
              typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0) && (!Number.isInteger(value) || Number.isSafeInteger(value)))) invalid('Invalid canonical data');
          if (typeof value === 'string') stringBytes(value);
          append(JSON.stringify(value)); stack.pop(); continue;
        }
        if (ancestors.has(value)) invalid('Cyclic canonical data');
        frame.object = value; frame.index = 0; frame.array = Array.isArray(value);
        frame.keys = frame.array ? null : objectKeys(value).sort();
        frame.length = frame.array ? arrayLength(value, Math.floor((LIMITS.backupBytes - 1) / 2)) : frame.keys.length;
        append(frame.array ? '[' : '{'); ancestors.add(value);
      } else if (frame.index < frame.length) {
        if (frame.index) append(',');
        const key = frame.array ? String(frame.index++) : frame.keys[frame.index++];
        if (!frame.array) { stringBytes(key); append(JSON.stringify(key)); append(':'); }
        stack.push({ value: dataValue(frame.object, key) });
      } else { append(frame.array ? ']' : '}'); ancestors.delete(frame.object); stack.pop(); }
    }
    return chunks.join('');
  }
  function canonicalData(raw, options) {
    return guard(() => {
      const r = record(options, ['maxBytes']);
      if (r.maxBytes !== LIMITS.planningBytes && r.maxBytes !== LIMITS.backupBytes) invalid('Explicit supported canonical byte limit is required');
      inspect(raw, r.maxBytes);
      const out = canonical(raw);
      // An exotic Proxy can change descriptors between inspections. Recheck the
      // actual output size rather than returning data over the promised budget.
      if (utf8Bytes(out) > r.maxBytes) fail('SPENDING_LIMIT', 'Canonical JSON byte budget exceeded');
      return out;
    });
  }
  function utf8Bytes(value) {
    let bytes = 0;
    for (let i = 0; i < value.length; i++) {
      const c = value.charCodeAt(i);
      if (c < 128) bytes++;
      else if (c < 2048) bytes += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; }
      else bytes += 3;
    }
    return bytes;
  }
  function deepFreeze(value) {
    const stack = [value];
    while (stack.length) {
      const row = stack.pop();
      if (!row || typeof row !== 'object' || Object.isFrozen(row)) continue;
      for (const key of Object.keys(row)) { const child = row[key]; if (child && typeof child === 'object') stack.push(child); }
      Object.freeze(row);
    }
    return value;
  }
  function id(value) {
    if (typeof value !== 'string' || value.length > LIMITS.idLength || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) || value === 'constructor' || value === 'prototype') fail('SPENDING_ID', 'Invalid raw identifier');
    return value;
  }
  function integer(value, min, max, code) {
    if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < min || value > max) fail(code || 'SPENDING_AMOUNT', 'Invalid exact integer');
    return value;
  }
  function positive(value) { return integer(value, 1, LIMITS.amountCents); }
  function safe(value) { if (value < 0n || value > MAX_SAFE) fail('SPENDING_OVERFLOW', 'Spending total exceeds safe integer range'); return Number(value); }
  function date(value) {
    if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(value) || value.slice(0, 4) === '0000') fail('SPENDING_DATE', 'Invalid economic date');
    const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
    const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (day < 1 || day > days[month - 1]) fail('SPENDING_DATE', 'Invalid economic day');
    return value;
  }
  function timestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/.test(value)) fail('SPENDING_DATE', 'Invalid canonical UTC timestamp');
    date(value.slice(0, 10)); return value;
  }
  function text(value, maximum, trim, free) {
    if (typeof value !== 'string' || value.length > maximum ||
        (free ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value) ||
        trim && !value.trim()) fail('SPENDING_TEXT', 'Invalid spending text');
    return trim ? value.trim() : value;
  }
  function normalizeReason(raw) { return guard(() => text(raw, 500, true, true)); }
  function remaining(raw) {
    if (raw === null) return null;
    const r = record(raw, ['amountCents', 'reviewedAsOfDate', 'paymentIds']);
    const paymentIds = arrayValues(r.paymentIds, LIMITS.paymentsPerPlan).map(id).sort();
    for (let i = 1; i < paymentIds.length; i++) if (paymentIds[i] === paymentIds[i - 1]) fail('SPENDING_IDENTITY', 'Remaining confirmation repeats a payment identity');
    return { amountCents: integer(r.amountCents, 0, LIMITS.amountCents), reviewedAsOfDate: date(r.reviewedAsOfDate), paymentIds };
  }
  function plan(raw, accounting) {
    const r = record(raw, planFields);
    if (!['planned', 'committed'].includes(r.stage) || !['open', 'cancelled'].includes(r.status)) invalid('Invalid plan stage or status');
    const commitmentBasis = text(r.commitmentBasis, 500, false, true);
    if (r.stage === 'committed' && !commitmentBasis.trim()) fail('SPENDING_TEXT', 'Committed plan requires a commitment basis');
    if (r.stage === 'planned' && commitmentBasis !== '') fail('SPENDING_HISTORY', 'Planned records must have empty commitment basis');
    const result = { id: id(r.id), createdAt: timestamp(r.createdAt), name: text(r.name, 80, true, false), stage: r.stage, status: r.status,
      targetAmountCents: r.targetAmountCents === null ? null : positive(r.targetAmountCents),
      expectedDate: r.expectedDate === null ? null : date(r.expectedDate), expectedAccountId: r.expectedAccountId === null ? null : id(r.expectedAccountId),
      commitmentBasis, note: text(r.note, 500, false, true), remainingConfirmation: remaining(r.remainingConfirmation) };
    if (accounting) preflightPlan(result, accounting);
    return result;
  }
  function normalizePlan(raw) { return guard(() => { inspect(raw, Infinity); return deepFreeze(plan(raw)); }); }
  function signature(raw, type) {
    const r = record(raw, signatureFields);
    if (r.type !== type || r.toAccountId !== null) fail('SPENDING_PROOF', 'Unexpected financial signature type');
    return { id: id(r.id), type, date: date(r.date), amountCents: positive(r.amountCents), accountId: id(r.accountId), toAccountId: null };
  }
  function sameSignature(a, b) { return signatureFields.every(key => a[key] === b[key]); }
  function proofSize(raw, metrics) {
    const r = record(raw, proofFields);
    const duplicates = arrayLength(r.duplicateEvidence, LIMITS.proofComponents), refunds = arrayLength(r.refunds, LIMITS.proofComponents), claims = arrayLength(r.claims, LIMITS.proofComponents);
    if (duplicates + refunds + claims > LIMITS.proofComponents) fail('SPENDING_LIMIT', 'Proof relation component budget exceeded');
    if (metrics) {
      metrics.proofOccurrences++;
      metrics.basisCells += 2 + 2 * duplicates + 2 * refunds + claims;
      if (metrics.basisCells > LIMITS.basisCells) fail('SPENDING_LIMIT', 'All persisted proof basis cells exceed the budget');
    }
    return r;
  }
  function proof(raw, accounting) {
    const r = proofSize(raw);
    integer(r.version, 1, 1, 'SPENDING_VERSION');
    if (r.role !== 'cash-primary-payment') fail('SPENDING_PROOF', 'Invalid gross-payment proof role');
    const source = signature(r.source, 'expense'), p = record(r.cashProfile, ['id', 'accountId', 'role']);
    const cashProfile = { id: id(p.id), accountId: id(p.accountId), role: p.role };
    if (p.role !== 'cash' || cashProfile.accountId !== source.accountId) fail('SPENDING_PROOF', 'Cash profile must describe the exact source account');
    const duplicateEvidence = [], refunds = [], claims = [], relationIds = new Set(), transactionIds = new Set([source.id]), accountIds = new Set([source.accountId]), incomes = new Map();
    function relation(key) { if (relationIds.has(key)) fail('SPENDING_PROOF', 'Repeated proof component identity'); relationIds.add(key); }
    for (const value of arrayValues(r.duplicateEvidence, LIMITS.proofComponents)) {
      const d = record(value, ['id', 'primaryId', 'shadowId', 'primarySignature', 'shadowSignature']);
      const row = { id: id(d.id), primaryId: id(d.primaryId), shadowId: id(d.shadowId), primarySignature: signature(d.primarySignature, 'expense'), shadowSignature: signature(d.shadowSignature, 'expense') };
      relation(row.id);
      if (row.primaryId !== source.id || !sameSignature(row.primarySignature, source) || row.shadowId !== row.shadowSignature.id || transactionIds.has(row.shadowId)) fail('SPENDING_PROOF', 'Inconsistent duplicate identities');
      const shadow = row.shadowSignature;
      if (shadow.amountCents !== source.amountCents || shadow.accountId !== source.accountId) fail('SPENDING_PROOF', 'Duplicate signature differs from its primary');
      transactionIds.add(row.shadowId); accountIds.add(shadow.accountId); duplicateEvidence.push(row);
    }
    let allocated = 0n;
    for (const value of arrayValues(r.refunds, LIMITS.proofComponents)) {
      const d = record(value, ['id', 'expenseId', 'incomeId', 'amountCents', 'expenseSignature', 'incomeSignature']);
      const row = { id: id(d.id), expenseId: id(d.expenseId), incomeId: id(d.incomeId), amountCents: positive(d.amountCents), expenseSignature: signature(d.expenseSignature, 'expense'), incomeSignature: signature(d.incomeSignature, 'income') };
      relation(row.id);
      if (row.expenseId !== source.id || !sameSignature(row.expenseSignature, source) || row.incomeId !== row.incomeSignature.id) fail('SPENDING_PROOF', 'Refund does not describe its exact signatures');
      const prior = incomes.get(row.incomeId);
      if (prior && !sameSignature(prior.signature, row.incomeSignature) || !prior && transactionIds.has(row.incomeId)) fail('SPENDING_PROOF', 'Contradictory refund income identity');
      const usage = prior || { signature: row.incomeSignature, amount: 0n };
      usage.amount += BigInt(row.amountCents);
      if (usage.amount > BigInt(usage.signature.amountCents)) fail('SPENDING_PROOF', 'Refund allocations exceed their income signature amount');
      incomes.set(row.incomeId, usage); transactionIds.add(row.incomeId); accountIds.add(row.incomeSignature.accountId);
      allocated += BigInt(row.amountCents); refunds.push(row);
    }
    for (const value of arrayValues(r.claims, LIMITS.proofComponents)) {
      const d = record(value, ['id', 'expenseId', 'amountCents', 'expenseSignature']);
      const row = { id: id(d.id), expenseId: id(d.expenseId), amountCents: positive(d.amountCents), expenseSignature: signature(d.expenseSignature, 'expense') };
      relation(row.id);
      if (row.expenseId !== source.id || !sameSignature(row.expenseSignature, source)) fail('SPENDING_PROOF', 'Claim does not describe its exact source');
      allocated += BigInt(row.amountCents); claims.push(row);
    }
    if (allocated > BigInt(source.amountCents)) fail('SPENDING_PROOF', 'Refund and claim allocations exceed the source amount');
    for (const key of relationIds) if (transactionIds.has(key) || key === cashProfile.id) fail('SPENDING_PROOF', 'Component identity overlaps another same-proof owner');
    if (transactionIds.has(cashProfile.id) || accountIds.has(cashProfile.id)) fail('SPENDING_PROOF', 'Cash profile identity overlaps a contained core identity');
    const grossPaymentCents = positive(r.grossPaymentCents);
    if (grossPaymentCents !== source.amountCents) fail('SPENDING_PROOF', 'Gross payment must equal the source amount without subtracting refunds or claims');
    duplicateEvidence.sort(compareId); refunds.sort(compareId); claims.sort(compareId);
    const result = { version: 1, source, role: 'cash-primary-payment', cashProfile, duplicateEvidence, refunds, claims, grossPaymentCents };
    // Recheck the owned output as well: a Proxy may vary descriptors between
    // preflight and normalization, but cannot undercharge retained cells.
    proofSize(result, accounting);
    return result;
  }
  function normalizeProof(raw) { return guard(() => { inspect(raw, Infinity); return deepFreeze(proof(raw)); }); }
  function basisKey(raw) { return guard(() => { inspect(raw, Infinity); return canonical(proof(raw)); }); }
  function payment(raw, accounting) {
    const r = record(raw, paymentFields), p = proof(r.proof, accounting), reviewedAsOfDate = date(r.reviewedAsOfDate), transactionId = id(r.transactionId);
    if (transactionId !== p.source.id || p.source.date > reviewedAsOfDate) fail('SPENDING_PROOF', 'Payment source or reviewed cutoff is inconsistent');
    return { id: id(r.id), createdAt: timestamp(r.createdAt), reviewedAsOfDate, planId: id(r.planId), transactionId,
      amountCents: positive(r.amountCents), proof: p, reference: text(r.reference, 500, false, true) };
  }
  function change(raw, accounting) {
    const r = record(raw, changeFields);
    if (r.kind !== 'plan' && r.kind !== 'payment') fail('SPENDING_HISTORY', 'Unknown change kind');
    const normalize = r.kind === 'plan' ? plan : payment;
    return { kind: r.kind, recordId: id(r.recordId), before: r.before === null ? null : normalize(r.before, accounting),
      after: r.after === null ? null : normalize(r.after, accounting), reverses: r.reverses === null ? null : id(r.reverses) };
  }
  function operation(raw, accounting) {
    const r = record(raw, operationFields);
    if (!actions.includes(r.action)) fail('SPENDING_HISTORY', 'Unknown operation action');
    return { id: id(r.id), revision: integer(r.revision, 1, LIMITS.audit, 'SPENDING_HISTORY'), at: timestamp(r.at), asOfDate: date(r.asOfDate),
      action: r.action, reason: text(r.reason, 500, true, true), changes: arrayValues(r.changes, LIMITS.changesPerOperation).map(value => change(value, accounting)) };
  }
  function uniqueRows(rows) {
    const ids = new Set();
    for (const row of rows) { if (ids.has(row.id)) fail('SPENDING_IDENTITY', 'Repeated current identity'); ids.add(row.id); }
    return rows.sort(compareId);
  }
  // Replay records are private normalized copies and never mutate. Cache their
  // canonical strings; callers cannot seed this cache with mutable objects.
  const equalityKeys = new WeakMap();
  function equalityKey(value) {
    let key = equalityKeys.get(value);
    if (key === undefined) { key = canonical(value); equalityKeys.set(value, key); }
    return key;
  }
  function equal(a, b) {
    if (a === b) return true;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
    return equalityKey(a) === equalityKey(b);
  }
  function history(condition, message) { if (!condition) fail('SPENDING_HISTORY', message); }
  function allowedPlanChange(before, after, allowed) {
    for (const field of planFields) if (!allowed.includes(field)) history(equal(before[field], after[field]), 'Operation changed a protected plan field: ' + field);
  }
  function preflightPlan(raw, metrics) {
    const r = record(raw, planFields);
    if (r.remainingConfirmation !== null) {
      const confirmation = record(r.remainingConfirmation, ['amountCents', 'reviewedAsOfDate', 'paymentIds']);
      metrics.remainingReferenceCells += arrayLength(confirmation.paymentIds, LIMITS.paymentsPerPlan);
      if (metrics.remainingReferenceCells > LIMITS.remainingReferenceCells) fail('SPENDING_LIMIT', 'All persisted remaining-reference cells exceed the budget');
    }
  }
  function validateExtension(raw) {
    return guard(() => {
      inspect(raw, Infinity);
      const r = record(raw, ['version', 'revision', 'plans', 'payments', 'audit']);
      integer(r.version, 1, 1, 'SPENDING_VERSION');
      const rawPlans = arrayValues(r.plans, LIMITS.plans), rawPayments = arrayValues(r.payments, LIMITS.payments), rawAudit = arrayValues(r.audit, LIMITS.audit);
      integer(r.revision, 0, LIMITS.audit, 'SPENDING_HISTORY');
      history(r.revision === rawAudit.length, 'Revision must equal the complete journal length');
      const metrics = { jsonBytes: 0, nodeCount: 0, journalOperations: rawAudit.length, changeCount: 0, proofOccurrences: 0, basisCells: 0,
        remainingReferenceCells: 0, planCreates: 0, paymentCreates: 0, currentPlans: 0, cancelledPlans: 0, retiredPlans: 0,
        currentPayments: 0, reversedPayments: 0, maxActivePlans: 0, maxActivePayments: 0, maxPaymentsPerPlan: 0, everEntityIds: 0 };
      // Count every persisted occurrence before copying or canonicalizing any proof.
      for (const value of rawPlans) preflightPlan(value, metrics);
      for (const value of rawPayments) proofSize(record(value, paymentFields).proof, metrics);
      for (const value of rawAudit) {
        const op = record(value, operationFields);
        for (const value of arrayValues(op.changes, LIMITS.changesPerOperation)) {
          const c = record(value, changeFields); metrics.changeCount++;
          if (c.kind !== 'plan' && c.kind !== 'payment') fail('SPENDING_HISTORY', 'Unknown change kind');
          for (const side of [c.before, c.after]) if (side !== null) {
            if (c.kind === 'plan') preflightPlan(side, metrics); else proofSize(record(side, paymentFields).proof, metrics);
          }
        }
      }
      const accounting = { proofOccurrences: 0, basisCells: 0, remainingReferenceCells: 0 };
      const plans = uniqueRows(rawPlans.map(value => plan(value, accounting))), payments = uniqueRows(rawPayments.map(value => payment(value, accounting))), audit = rawAudit.map(value => operation(value, accounting));
      Object.assign(metrics, accounting);
      metrics.changeCount = audit.reduce((sum, op) => sum + op.changes.length, 0);
      const planStore = new Map(), paymentStore = new Map(), planPayments = new Map(), ever = new Set(), eventIds = new Set(), creation = new Map();
      const groups = new Map(), paymentGroups = new Map(), proofKeys = new WeakMap();
      let capturedTotal = 0n, targetTotal = 0n, remainingTotal = 0n;
      function proofKey(p) { let k = proofKeys.get(p); if (k === undefined) { k = canonical(p); proofKeys.set(p, k); } return k; }
      function define(key) {
        if (ever.has(key) || eventIds.has(key)) fail('SPENDING_IDENTITY', 'Entity identity was already used in history');
        ever.add(key);
        if (ever.size > LIMITS.everIds) fail('SPENDING_LIMIT', 'Ever-created entity budget exceeded');
      }
      function checkRemaining(p, op, authored) {
        const ids = planPayments.get(p.id), confirmation = p.remainingConfirmation;
        if (confirmation === null) return;
        if (authored) history(confirmation.reviewedAsOfDate === op.asOfDate, 'Authored remaining cutoff must equal its operation cutoff');
        history(confirmation.paymentIds.length === ids.size, 'Remaining confirmation must bind the exact current payment set');
        for (const key of confirmation.paymentIds) {
          const row = paymentStore.get(key);
          history(ids.has(key) && row && row.planId === p.id, 'Remaining confirmation contains an orphan or other-plan payment');
          history(row.proof.source.date <= confirmation.reviewedAsOfDate, 'Remaining confirmation binds a future economic source');
        }
      }
      function totals(before, after) {
        if (before) { if (before.targetAmountCents !== null) targetTotal -= BigInt(before.targetAmountCents); if (before.remainingConfirmation !== null) remainingTotal -= BigInt(before.remainingConfirmation.amountCents); }
        if (after) { if (after.targetAmountCents !== null) targetTotal += BigInt(after.targetAmountCents); if (after.remainingConfirmation !== null) remainingTotal += BigInt(after.remainingConfirmation.amountCents); }
      }
      for (let index = 0; index < audit.length; index++) {
        const op = audit[index], cs = op.changes;
        history(op.revision === index + 1, 'Journal revisions must be contiguous and ordered');
        if (eventIds.has(op.id) || ever.has(op.id)) fail('SPENDING_IDENTITY', 'Audit identity overlaps another historical owner');
        eventIds.add(op.id);
        const expectedKinds = op.action === 'allocate-payment' || op.action === 'reverse-payment' ? ['payment', 'plan'] : op.action === 'reconfirm-payment' ? ['payment', 'payment', 'plan'] : ['plan'];
        history(cs.length === expectedKinds.length && cs.every((c, i) => c.kind === expectedKinds[i]), 'Operation has an invalid atomic change sequence');
        const pc = cs[cs.length - 1], before = pc.before, after = pc.after, current = planStore.get(pc.recordId);
        history(pc.reverses === null, 'Plan changes cannot reverse payment operations');
        if (op.action === 'create-plan') {
          history(before === null && after !== null && !current && after.id === pc.recordId && after.createdAt === op.at && after.stage === 'planned' && after.status === 'open' && after.commitmentBasis === '', 'Invalid planned/open plan creation');
          define(pc.recordId); planPayments.set(pc.recordId, new Set()); metrics.planCreates++;
        } else {
          history(current && before && equal(current, before) && before.id === pc.recordId, 'Plan before snapshot does not equal the current record');
          if (op.action === 'retire-plan') history(after === null && before.status === 'cancelled' && planPayments.get(before.id).size === 0, 'Plan retirement requires cancelled status and zero payments');
          else {
            history(after && after.id === before.id && after.createdAt === before.createdAt, 'Plan identity and creation time are immutable');
            const compound = ['allocate-payment', 'reverse-payment', 'reconfirm-payment'].includes(op.action);
            history(!equal(before, after) || compound && before.remainingConfirmation === null && after.remainingConfirmation === null, 'No-op plan transition is not permitted');
            const count = planPayments.get(before.id).size;
            switch (op.action) {
              case 'update-plan': allowedPlanChange(before, after, ['name', 'targetAmountCents', 'expectedDate', 'expectedAccountId', 'note']); break;
              case 'commit-plan':
                history(before.stage === 'planned' && before.status === 'open' && count === 0 && after.stage === 'committed', 'Commit requires an open planned plan with zero payments');
                allowedPlanChange(before, after, ['stage', 'commitmentBasis', 'remainingConfirmation']); break;
              case 'cancel-plan':
                history(before.status === 'open' && after.status === 'cancelled', 'Cancel requires an open plan');
                allowedPlanChange(before, after, ['status']); break;
              case 'reopen-plan':
                history(before.status === 'cancelled' && after.status === 'open', 'Reopen requires a cancelled plan');
                allowedPlanChange(before, after, ['status', 'remainingConfirmation']); break;
              case 'return-to-plan':
                history(before.status === 'cancelled' && count === 0 && after.stage === 'planned' && after.status === 'open' && after.commitmentBasis === '', 'Return requires a cancelled plan with zero payments');
                allowedPlanChange(before, after, ['stage', 'status', 'commitmentBasis', 'remainingConfirmation']); break;
              case 'confirm-remaining': history(before.status === 'open', 'Remaining confirmation requires an open plan'); allowedPlanChange(before, after, ['remainingConfirmation']); break;
              default:
                if (op.action === 'allocate-payment') history(before.status === 'open' && before.stage === 'committed', 'Allocation requires an open committed plan');
                allowedPlanChange(before, after, ['remainingConfirmation']);
            }
          }
        }
        const touchedGroups = new Set();
        for (let i = 0; i < cs.length - 1; i++) {
          const c = cs[i], removes = op.action === 'reverse-payment' || op.action === 'reconfirm-payment' && i === 0;
          if (removes) {
            const active = paymentStore.get(c.recordId);
            history(active && c.before && equal(active, c.before) && c.after === null && c.before.id === c.recordId && active.planId === pc.recordId && c.reverses === creation.get(c.recordId), 'Payment reversal must remove the exact current record and reference its create operation');
            const key = paymentGroups.get(active.id), group = groups.get(key), n = BigInt(active.amountCents);
            group.amount -= n; group.count--; touchedGroups.add(key);
            paymentGroups.delete(active.id); paymentStore.delete(active.id); planPayments.get(active.planId).delete(active.id); capturedTotal -= n;
          } else {
            const row = c.after;
            history(c.before === null && row && c.recordId === row.id && row.planId === pc.recordId && row.createdAt === op.at && row.reviewedAsOfDate === op.asOfDate && c.reverses === null, 'Payment creation must use its exact plan and operation timestamp/cutoff');
            if (op.action === 'reconfirm-payment') {
              const old = cs[0].before;
              history(['planId', 'transactionId', 'amountCents', 'reference'].every(key => old[key] === row[key]) && proofKey(old.proof) !== proofKey(row.proof), 'Reconfirmation must retain amount/source/plan/reference and replace a different proof');
            }
            define(row.id); creation.set(row.id, op.id);
            const key = row.transactionId + '\u0000' + proofKey(row.proof), group = groups.get(key) || { amount: 0n, count: 0, capacity: BigInt(row.proof.grossPaymentCents) };
            group.amount += BigInt(row.amountCents); group.count++; groups.set(key, group); touchedGroups.add(key);
            paymentGroups.set(row.id, key); paymentStore.set(row.id, row); planPayments.get(row.planId).add(row.id); capturedTotal += BigInt(row.amountCents); metrics.paymentCreates++;
          }
        }
        // All cross-record constraints are checked at the completed atomic prefix.
        for (const key of touchedGroups) {
          const group = groups.get(key); safe(group.amount);
          if (group.amount > group.capacity) fail('SPENDING_CAPACITY', 'Same-source canonical-proof capacity exceeded at an operation prefix');
          if (!group.count) groups.delete(key);
        }
        totals(before, after);
        if (after) {
          planStore.set(pc.recordId, after);
          checkRemaining(after, op, !['update-plan', 'cancel-plan'].includes(op.action));
          const count = planPayments.get(pc.recordId).size;
          if (count > LIMITS.paymentsPerPlan) fail('SPENDING_LIMIT', 'Operation prefix exceeds payments per plan');
          metrics.maxPaymentsPerPlan = Math.max(metrics.maxPaymentsPerPlan, count);
        } else { planStore.delete(pc.recordId); planPayments.delete(pc.recordId); }
        if (planStore.size > LIMITS.plans || paymentStore.size > LIMITS.payments) fail('SPENDING_LIMIT', 'Active record budget exceeded at an operation prefix');
        metrics.maxActivePlans = Math.max(metrics.maxActivePlans, planStore.size); metrics.maxActivePayments = Math.max(metrics.maxActivePayments, paymentStore.size);
        safe(capturedTotal); safe(targetTotal); safe(remainingTotal);
      }
      history(equal(plans, [...planStore.values()].sort(compareId)) && equal(payments, [...paymentStore.values()].sort(compareId)), 'Current arrays do not equal complete operation replay');
      const result = { version: 1, revision: r.revision, plans, payments, audit }, size = inspect(result, LIMITS.planningBytes);
      metrics.jsonBytes = size.jsonBytes; metrics.nodeCount = size.nodeCount;
      metrics.currentPlans = plans.length; metrics.cancelledPlans = plans.filter(p => p.status === 'cancelled').length; metrics.retiredPlans = metrics.planCreates - plans.length;
      metrics.currentPayments = payments.length; metrics.reversedPayments = metrics.paymentCreates - payments.length; metrics.everEntityIds = ever.size;
      deepFreeze(result); ownMetrics.set(result, deepFreeze(metrics)); return result;
    });
  }
  function metricsOf(exactValidatedExtension) {
    if (!ownMetrics.has(exactValidatedExtension)) fail('SPENDING_INVALID_RECORD', 'Metrics require the original validated immutable extension');
    return ownMetrics.get(exactValidatedExtension);
  }
  return Object.freeze({ validateExtension, normalizePlan, normalizeProof, normalizeReason, basisKey, inspectData, canonicalData, metricsOf, LIMITS, SpendingCoreError });
}));
