/* Pure income-planning schema, proof and journal kernel. No live model or clock. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoneygoIncomeCore = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const LIMITS = Object.freeze({ plans: 200, receipts: 1000, receiptsPerPlan: 100,
    everIds: 6000, audit: 12000, proofComponents: 200, proofCells: 100000,
    planningBytes: 8 * 1024 * 1024, previewBytes: 8 * 1024 * 1024,
    backupBytes: 32 * 1024 * 1024, dataNodes: 32 * 1024 * 1024,
    stringCodeUnits: 32 * 1024 * 1024, idLength: 100, amountCents: 999999999999 });
  const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
  const ownMetrics = new WeakMap(), ownErrors = new WeakSet();
  const hasOwn = Function.call.bind(Object.prototype.hasOwnProperty);
  const nativeSource = Function.call.bind(Function.prototype.toString);
  const objectPrototypeKeys = Reflect.ownKeys(Object.prototype);
  const arrayPrototypeKeys = Reflect.ownKeys(Array.prototype);
  const planFields = ['id', 'createdAt', 'name', 'certainty', 'expectedAmountCents', 'expectedDate', 'expectedAccountId', 'status', 'basis', 'note'];
  const receiptFields = ['id', 'createdAt', 'reviewedAsOfDate', 'planId', 'transactionId', 'amountCents', 'proof', 'reference'];
  const auditFields = ['id', 'revision', 'at', 'kind', 'recordId', 'action', 'reason', 'before', 'after', 'reverses'];
  const signatureFields = ['id', 'type', 'date', 'amountCents', 'accountId', 'toAccountId'];
  const proofFields = ['version', 'source', 'role', 'duplicateEvidence', 'reductions', 'ordinaryIncomeCents'];
  class IncomeCoreError extends Error {
    constructor(code, message) { super(message); this.name = 'IncomeCoreError'; this.code = code; }
  }
  function fail(code, message) { const error = new IncomeCoreError(code, message); ownErrors.add(error); throw error; }
  function invalid(message) { fail('INVALID_INCOME_RECORD', message); }
  function guard(action) {
    try { return action(); } catch (error) {
      if (ownErrors.has(error)) throw error;
      fail('INVALID_INCOME_DATA', 'Data cannot be inspected safely');
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
    if (length > maximum) fail('INCOME_LIMIT', 'Array exceeds its row budget');
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
    if (value.length > LIMITS.stringCodeUnits) fail('INCOME_LIMIT', 'String exceeds the safety ceiling');
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
      if (jsonBytes > maximum) fail('INCOME_LIMIT', 'JSON UTF-8 byte budget exceeded');
    }
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (hasOwn(frame, 'value')) {
        const value = frame.value;
        delete frame.value;
        if (++nodeCount > LIMITS.dataNodes) fail('INCOME_LIMIT', 'Data node budget exceeded');
        if (value === null) { cost(4); stack.pop(); continue; }
        if (typeof value === 'string') { cost(stringBytes(value)); stack.pop(); continue; }
        if (typeof value === 'boolean') { cost(value ? 4 : 5); stack.pop(); continue; }
        if (typeof value === 'number') {
          if (!Number.isFinite(value) || Object.is(value, -0)) invalid('Numbers must be finite and not negative zero');
          cost(String(value).length); stack.pop(); continue;
        }
        if (typeof value !== 'object') invalid('Only ordinary JSON data is allowed');
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
    function append(value) { bytes += utf8Bytes(value); if (bytes > LIMITS.backupBytes) fail('INCOME_LIMIT', 'Canonical data exceeds the byte budget'); chunks.push(value); }
    while (stack.length) {
      const frame = stack[stack.length - 1];
      if (hasOwn(frame, 'value')) {
        const value = frame.value; delete frame.value;
        if (++nodes > LIMITS.dataNodes) fail('INCOME_LIMIT', 'Canonical data exceeds the node budget');
        if (value === null || typeof value !== 'object') {
          if (!(value === null || typeof value === 'string' || typeof value === 'boolean' ||
              typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0))) invalid('Invalid canonical data');
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
      if (utf8Bytes(out) > r.maxBytes) fail('INCOME_LIMIT', 'Canonical JSON byte budget exceeded');
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
    if (typeof value !== 'string' || value.length > LIMITS.idLength || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) || value === 'constructor' || value === 'prototype') fail('INVALID_ID', 'Invalid raw identifier');
    return value;
  }
  function integer(value, min, max, code) {
    if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < min || value > max) fail(code || 'INVALID_AMOUNT', 'Invalid exact integer');
    return value;
  }
  function positive(value) { return integer(value, 1, LIMITS.amountCents); }
  function safe(value) { if (value < 0n || value > MAX_SAFE) fail('AMOUNT_OVERFLOW', 'Income total exceeds safe integer range'); return Number(value); }
  function date(value) {
    if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(value) || value.slice(0, 4) === '0000') fail('INVALID_DATE', 'Invalid economic date');
    const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
    const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (day < 1 || day > days[month - 1]) fail('INVALID_DATE', 'Invalid economic day');
    return value;
  }
  function timestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/.test(value)) fail('INVALID_DATE', 'Invalid canonical UTC timestamp');
    date(value.slice(0, 10)); return value;
  }
  function text(value, maximum, trim, free) {
    if (typeof value !== 'string' || value.length > maximum ||
        (free ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value) ||
        trim && !value.trim()) invalid('Invalid income text');
    return trim ? value.trim() : value;
  }
  function normalizeReason(raw) { return guard(() => text(raw, 500, true, true)); }
  function plan(raw) {
    const r = record(raw, planFields);
    if (!['confirmed-plan', 'expectation'].includes(r.certainty) || !['open', 'cancelled'].includes(r.status)) invalid('Invalid plan certainty or status');
    const basis = text(r.basis, 500, false, true);
    if (r.certainty === 'confirmed-plan' && !basis.trim()) invalid('Confirmed plan requires a basis');
    return { id: id(r.id), createdAt: timestamp(r.createdAt), name: text(r.name, 80, true, false), certainty: r.certainty,
      expectedAmountCents: r.expectedAmountCents === null ? null : positive(r.expectedAmountCents),
      expectedDate: r.expectedDate === null ? null : date(r.expectedDate),
      expectedAccountId: r.expectedAccountId === null ? null : id(r.expectedAccountId),
      status: r.status, basis, note: text(r.note, 500, false, true) };
  }
  function normalizePlan(raw) { return guard(() => { inspect(raw, Infinity); return deepFreeze(plan(raw)); }); }
  function signature(raw) {
    const r = record(raw, signatureFields);
    if (r.type !== 'income' || r.toAccountId !== null) invalid('Proof signature must be ordinary income');
    return { id: id(r.id), type: 'income', date: date(r.date), amountCents: positive(r.amountCents), accountId: id(r.accountId), toAccountId: null };
  }
  function sameSignature(a, b) {
    return a.id === b.id && a.type === b.type && a.date === b.date && a.amountCents === b.amountCents && a.accountId === b.accountId && a.toAccountId === b.toAccountId;
  }
  function proofSize(raw, metrics) {
    const r = record(raw, proofFields);
    const duplicates = arrayLength(r.duplicateEvidence, LIMITS.proofComponents), reductions = arrayLength(r.reductions, LIMITS.proofComponents);
    if (duplicates + reductions > LIMITS.proofComponents) fail('INCOME_LIMIT', 'Proof relation component budget exceeded');
    if (metrics) {
      metrics.proofOccurrences++;
      metrics.proofComponents += duplicates + reductions;
      metrics.proofCells += 1 + 2 * duplicates + reductions;
      if (metrics.proofCells > LIMITS.proofCells) fail('INCOME_LIMIT', 'All proof signature occurrences exceed the budget');
    }
    return r;
  }
  function proof(raw) {
    const r = proofSize(raw);
    integer(r.version, 1, 1, 'UNSUPPORTED_INCOME_VERSION');
    if (r.role !== 'ordinary-primary') invalid('Invalid ordinary proof role');
    const source = signature(r.source), duplicateEvidence = [], reductions = [], relationIds = new Set(), transactionIds = new Set([source.id]);
    for (const value of arrayValues(r.duplicateEvidence, LIMITS.proofComponents)) {
      const d = record(value, ['id', 'primaryId', 'shadowId', 'primarySignature', 'shadowSignature']);
      const row = { id: id(d.id), primaryId: id(d.primaryId), shadowId: id(d.shadowId), primarySignature: signature(d.primarySignature), shadowSignature: signature(d.shadowSignature) };
      if (relationIds.has(row.id)) fail('DUPLICATE_ID', 'Repeated proof relationship');
      relationIds.add(row.id);
      if (row.primaryId !== source.id || !sameSignature(row.primarySignature, source) || row.shadowId !== row.shadowSignature.id || transactionIds.has(row.shadowId)) fail('INCOME_PROOF', 'Inconsistent duplicate identities');
      const shadow = row.shadowSignature;
      if (shadow.type !== source.type || shadow.amountCents !== source.amountCents || shadow.accountId !== source.accountId || shadow.toAccountId !== source.toAccountId) fail('INCOME_PROOF', 'Duplicate signature differs from its primary');
      transactionIds.add(row.shadowId); duplicateEvidence.push(row);
    }
    let reductionTotal = 0n, hasHeld = false, hasOther = false;
    for (const value of arrayValues(r.reductions, LIMITS.proofComponents)) {
      const d = record(value, ['id', 'kind', 'amountCents', 'incomeSignature']);
      if (!['refund', 'settlement', 'held-return'].includes(d.kind)) invalid('Invalid ordinary reduction kind');
      const row = { id: id(d.id), kind: d.kind, amountCents: positive(d.amountCents), incomeSignature: signature(d.incomeSignature) };
      if (relationIds.has(row.id)) fail('DUPLICATE_ID', 'Repeated proof relationship');
      relationIds.add(row.id);
      if (!sameSignature(row.incomeSignature, source)) fail('INCOME_PROOF', 'Reduction does not use its exact source signature');
      reductionTotal += BigInt(row.amountCents); safe(reductionTotal);
      if (row.kind === 'held-return') hasHeld = true; else hasOther = true;
      reductions.push(row);
    }
    for (const key of relationIds) if (transactionIds.has(key)) fail('DUPLICATE_ID', 'Proof relationship overlaps a source transaction');
    if (hasHeld && (hasOther || duplicateEvidence.length)) fail('INCOME_PROOF', 'Held return cannot coexist with refund, settlement or duplicates');
    const ordinaryIncomeCents = positive(r.ordinaryIncomeCents);
    if (BigInt(source.amountCents) - reductionTotal !== BigInt(ordinaryIncomeCents)) fail('INCOME_PROOF', 'Ordinary residual does not equal source less reductions');
    duplicateEvidence.sort(compareId); reductions.sort(compareId);
    return { version: 1, source, role: 'ordinary-primary', duplicateEvidence, reductions, ordinaryIncomeCents };
  }
  function normalizeProof(raw) { return guard(() => { inspect(raw, Infinity); return deepFreeze(proof(raw)); }); }
  function basisKey(raw) { return guard(() => { inspect(raw, Infinity); return canonical(proof(raw)); }); }
  function receipt(raw) {
    const r = record(raw, receiptFields), p = proof(r.proof), reviewedAsOfDate = date(r.reviewedAsOfDate), transactionId = id(r.transactionId);
    if (transactionId !== p.source.id || p.source.date > reviewedAsOfDate) fail('INCOME_PROOF', 'Receipt source or economic cutoff is inconsistent');
    return { id: id(r.id), createdAt: timestamp(r.createdAt), reviewedAsOfDate, planId: id(r.planId), transactionId,
      amountCents: positive(r.amountCents), proof: p, reference: text(r.reference, 500, false, true) };
  }
  function audit(raw) {
    const r = record(raw, auditFields), kind = r.kind, action = r.action;
    if (!(kind === 'plan' && ['create', 'update', 'retire'].includes(action) || kind === 'receipt' && ['create', 'reverse'].includes(action))) fail('INCOME_HISTORY', 'Invalid journal kind/action');
    const normalize = kind === 'plan' ? plan : receipt;
    return { id: id(r.id), revision: integer(r.revision, 1, LIMITS.audit, 'INCOME_HISTORY'), at: timestamp(r.at), kind,
      recordId: id(r.recordId), action, reason: text(r.reason, 500, true, true),
      before: r.before === null ? null : normalize(r.before), after: r.after === null ? null : normalize(r.after),
      reverses: r.reverses === null ? null : id(r.reverses) };
  }
  function uniqueRows(rows) {
    const ids = new Set();
    for (const row of rows) { if (ids.has(row.id)) fail('DUPLICATE_ID', 'Repeated current record ID'); ids.add(row.id); }
    rows.sort(compareId); return rows;
  }
  function validateExtension(raw) {
    return guard(() => {
      inspect(raw, Infinity);
      const r = record(raw, ['version', 'revision', 'plans', 'receipts', 'audit']);
      integer(r.version, 1, 1, 'UNSUPPORTED_INCOME_VERSION');
      const rawPlans = arrayValues(r.plans, LIMITS.plans), rawReceipts = arrayValues(r.receipts, LIMITS.receipts), rawAudit = arrayValues(r.audit, LIMITS.audit);
      integer(r.revision, 0, LIMITS.audit, 'INCOME_HISTORY');
      if (r.revision !== rawAudit.length) fail('INCOME_HISTORY', 'Revision must equal the complete journal length');
      const metrics = { jsonBytes: 0, nodeCount: 0, journalEvents: 0, proofOccurrences: 0, proofComponents: 0, proofCells: 0,
        planCreates: 0, receiptCreates: 0, currentPlans: 0, cancelledPlans: 0, retiredPlans: 0, currentReceipts: 0,
        reversedReceipts: 0, auditOperations: rawAudit.length, maxActivePlans: 0, maxActiveReceipts: 0, maxReceiptsPerPlan: 0 };
      // Charge every persisted occurrence before normalization, sorting or copying proofs.
      for (const value of rawReceipts) proofSize(record(value, receiptFields).proof, metrics);
      for (const value of rawAudit) {
        const a = record(value, auditFields);
        if (a.kind === 'receipt') for (const side of [a.before, a.after]) if (side !== null) proofSize(record(side, receiptFields).proof, metrics);
      }
      const plans = uniqueRows(rawPlans.map(plan)), receipts = uniqueRows(rawReceipts.map(receipt)), events = rawAudit.map(audit);
      const planStore = new Map(), receiptStore = new Map(), ever = new Set(), eventIds = new Set(), creation = new Map();
      const planTotals = new Map(), planCounts = new Map(), groups = new Map(), receiptGroups = new Map();
      let capturedTotal = 0n, targetTotal = 0n;
      function checkPlan(key) {
        const p = planStore.get(key), total = planTotals.get(key) || 0n;
        safe(total);
        if (p && p.expectedAmountCents !== null && total > BigInt(p.expectedAmountCents)) fail('INCOME_CAPACITY', 'Captured receipts exceed a plan target at a journal prefix');
        const count = planCounts.get(key) || 0;
        if (count > LIMITS.receiptsPerPlan) fail('INCOME_LIMIT', 'A journal prefix exceeds receipts per plan');
        metrics.maxReceiptsPerPlan = Math.max(metrics.maxReceiptsPerPlan, count);
      }
      function define(key) {
        if (ever.has(key) || eventIds.has(key)) fail('DUPLICATE_ID', 'Entity ID was already used in history');
        ever.add(key); if (ever.size > LIMITS.everIds) fail('INCOME_LIMIT', 'Ever-created entity budget exceeded');
      }
      for (let i = 0; i < events.length; i++) {
        const e = events[i]; metrics.journalEvents++;
        if (e.revision !== i + 1) fail('INCOME_HISTORY', 'Journal revisions must be contiguous and ordered');
        if (e.id === e.recordId || eventIds.has(e.id) || ever.has(e.id)) fail('DUPLICATE_ID', 'Audit ID overlaps another historical identity');
        eventIds.add(e.id);
        if (e.action === 'create') {
          if (e.before !== null || !e.after || e.recordId !== e.after.id || e.after.createdAt !== e.at || e.reverses !== null) fail('INCOME_HISTORY', 'Invalid create event');
          define(e.recordId); creation.set(e.recordId, e.id);
          if (e.kind === 'plan') {
            planStore.set(e.recordId, e.after); planCounts.set(e.recordId, 0); planTotals.set(e.recordId, 0n); metrics.planCreates++;
            if (e.after.expectedAmountCents !== null) targetTotal += BigInt(e.after.expectedAmountCents);
          } else {
            const row = e.after;
            if (!planStore.has(row.planId)) fail('INCOME_HISTORY', 'Receipt was created before its current plan');
            const key = row.transactionId + '\u0000' + canonical(row.proof), group = groups.get(key) || { amount: 0n, count: 0, capacity: BigInt(row.proof.ordinaryIncomeCents) };
            group.amount += BigInt(row.amountCents); group.count++;
            safe(group.amount);
            if (group.amount > group.capacity) fail('INCOME_CAPACITY', 'Same-basis receipt capacity exceeded at a journal prefix');
            groups.set(key, group); receiptGroups.set(row.id, key); receiptStore.set(row.id, row);
            planTotals.set(row.planId, planTotals.get(row.planId) + BigInt(row.amountCents));
            planCounts.set(row.planId, planCounts.get(row.planId) + 1);
            capturedTotal += BigInt(row.amountCents); metrics.receiptCreates++; checkPlan(row.planId);
          }
        } else {
          const store = e.kind === 'plan' ? planStore : receiptStore, current = store.get(e.recordId);
          if (!current || e.before === null || canonical(e.before) !== canonical(current)) fail('INCOME_HISTORY', 'Journal before does not match the current record');
          if (e.action === 'update') {
            if (!e.after || e.after.id !== current.id || e.after.createdAt !== current.createdAt || e.reverses !== null || canonical(e.before) === canonical(e.after)) fail('INCOME_HISTORY', 'Invalid or no-op plan update');
            if (current.expectedAmountCents !== null) targetTotal -= BigInt(current.expectedAmountCents);
            if (e.after.expectedAmountCents !== null) targetTotal += BigInt(e.after.expectedAmountCents);
            planStore.set(e.recordId, e.after); checkPlan(e.recordId);
          } else if (e.action === 'retire') {
            if (e.after !== null || e.reverses !== null || planCounts.get(e.recordId) !== 0) fail('INCOME_HISTORY', 'Plan retirement requires no current receipt');
            if (current.expectedAmountCents !== null) targetTotal -= BigInt(current.expectedAmountCents);
            planStore.delete(e.recordId); planCounts.delete(e.recordId); planTotals.delete(e.recordId);
          } else {
            if (e.after !== null || e.reverses !== creation.get(e.recordId)) fail('INCOME_HISTORY', 'Reverse must reference the exact original create event');
            const key = receiptGroups.get(e.recordId), group = groups.get(key), n = BigInt(current.amountCents);
            group.amount -= n; group.count--;
            if (!group.count) groups.delete(key);
            receiptGroups.delete(e.recordId); receiptStore.delete(e.recordId);
            planTotals.set(current.planId, planTotals.get(current.planId) - n);
            planCounts.set(current.planId, planCounts.get(current.planId) - 1);
            capturedTotal -= n; checkPlan(current.planId);
          }
        }
        if (planStore.size > LIMITS.plans || receiptStore.size > LIMITS.receipts) fail('INCOME_LIMIT', 'Active record budget exceeded at a journal prefix');
        metrics.maxActivePlans = Math.max(metrics.maxActivePlans, planStore.size);
        metrics.maxActiveReceipts = Math.max(metrics.maxActiveReceipts, receiptStore.size);
        safe(capturedTotal); safe(targetTotal);
      }
      const replayedPlans = [...planStore.values()].sort(compareId), replayedReceipts = [...receiptStore.values()].sort(compareId);
      if (canonical(plans) !== canonical(replayedPlans) || canonical(receipts) !== canonical(replayedReceipts)) fail('INCOME_HISTORY', 'Current stores do not equal complete journal replay');
      const result = { version: 1, revision: r.revision, plans, receipts, audit: events };
      const size = inspect(result, LIMITS.planningBytes);
      metrics.jsonBytes = size.jsonBytes; metrics.nodeCount = size.nodeCount;
      metrics.currentPlans = plans.length; metrics.cancelledPlans = plans.filter(row => row.status === 'cancelled').length;
      metrics.retiredPlans = metrics.planCreates - plans.length; metrics.currentReceipts = receipts.length;
      metrics.reversedReceipts = metrics.receiptCreates - receipts.length;
      deepFreeze(result); ownMetrics.set(result, deepFreeze(metrics)); return result;
    });
  }
  function metricsOf(exactValidatedExtension) {
    if (!ownMetrics.has(exactValidatedExtension)) fail('INVALID_INCOME_EXTENSION', 'Metrics require the original validated immutable extension');
    return ownMetrics.get(exactValidatedExtension);
  }
  return Object.freeze({ validateExtension, normalizeProof, basisKey, normalizePlan, normalizeReason,
    inspectData, canonicalData, metricsOf, LIMITS, IncomeCoreError });
}));
