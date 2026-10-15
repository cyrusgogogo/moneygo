/* Noncash income attribution and explicit, one-use review. No storage or network. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoneygoIncomePlanning = api;
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const PLAN_FIELDS = ['name', 'certainty', 'expectedAmountCents', 'expectedDate', 'expectedAccountId', 'basis', 'note'];
  const MODES = ['confirmed-only', 'planned', 'conservative'];
  const PREVIEW_REASON = '待用户确认';
  const BYTES = { preview: 8 * 1024 * 1024, ledger: 32 * 1024 * 1024 };
  const GRAMMAR = {
    'create-plan': ['action', 'plan'], 'update-plan': ['action', 'planId', 'patch'],
    'retire-plan': ['action', 'planId'],
    'allocate-receipt': ['action', 'planId', 'transactionId', 'amountCents', 'reference'],
    'reverse-receipt': ['action', 'receiptId'], 'reconfirm-receipt': ['action', 'receiptId']
  };
  function fail(code, message) { const e = new Error(message || code); e.name = 'IncomePlanningError'; e.code = code; throw e; }
  function dependency(file, name) {
    const value = typeof module === 'object' && module.exports ? require('./' + file + '.js') : root[name];
    if (!value) fail('INCOME_MODULE_UNAVAILABLE', '收入计划所需模块未加载');
    return value;
  }
  const core = () => dependency('income-core', 'MoneygoIncomeCore');
  const ledger = () => dependency('ledger', 'MoneygoLedger');
  const relations = () => dependency('relations', 'MoneygoRelations');
  const copy = value => JSON.parse(JSON.stringify(value));
  function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
  const sortIds = values => [...new Set(values)].sort();
  const order = (values, key = 'id') => values.sort((a, b) => a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);
  const canonical = value => core().canonicalData(value, { maxBytes: BYTES.ledger });
  const equal = (a, b) => canonical(a) === canonical(b);
  function sum(values) { let n = 0n; for (const v of values) n += BigInt(v); if (n > BigInt(Number.MAX_SAFE_INTEGER) || n < BigInt(Number.MIN_SAFE_INTEGER)) fail('INCOME_SUM_OVERFLOW'); return Number(n); }
  function shape(value, fields, partial = false) {
    core().inspectData(value);
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_INCOME_INPUT');
    const keys = Object.keys(value);
    if (keys.some(key => !fields.includes(key)) || (!partial && fields.some(key => !Object.hasOwn(value, key))) || (partial && !keys.length)) fail('INVALID_INCOME_INPUT', '收入计划字段缺失或包含不支持的字段');
    return value;
  }
  function id(value) { if (typeof value !== 'string' || value.length > 100 || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) || ['constructor', 'prototype'].includes(value)) fail('INVALID_ID'); return value; }
  function date(value) { if (!ledger().validDate(value)) fail('INVALID_DATE'); return value; }
  function timestamp(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !ledger().validDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('INVALID_TIMESTAMP'); return value; }
  function amount(value) { if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < 1 || value > 999999999999) fail('INVALID_AMOUNT'); return value; }
  function text(value) { if (typeof value !== 'string' || value.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail('INVALID_TEXT'); return value; }
  function options(raw, project = true) {
    shape(raw, project ? ['asOfDate', 'horizonEnd', 'mode'] : ['asOfDate']);
    const out = { asOfDate: date(raw.asOfDate) };
    if (project) { out.horizonEnd = date(raw.horizonEnd); out.mode = raw.mode; if (!MODES.includes(out.mode)) fail('INVALID_INCOME_MODE'); if (out.horizonEnd <= out.asOfDate) fail('INVALID_HORIZON'); }
    return out;
  }
  function validateState(raw) {
    // Descriptor inspection precedes every old validator and serializer.
    core().inspectData(raw);
    const state = ledger().validateState(raw);
    canonical(state);
    return state;
  }
  const extensionOf = state => state.incomePlanning || { version: 1, revision: 0, plans: [], receipts: [], audit: [] };
  const signature = row => ({ id: row.id, type: row.type, date: row.date, amountCents: row.amountCents, accountId: row.accountId, toAccountId: row.toAccountId === undefined ? null : row.toAccountId });
  const withId = (key, row) => ({ id: key, type: row.type, date: row.date, amountCents: row.amountCents, accountId: row.accountId, toAccountId: row.toAccountId === undefined ? null : row.toAccountId });
  function prepare(state, asOfDate) {
    const extension = extensionOf(state), financial = relations().calculate(state);
    const transactions = new Map(state.transactions.map(row => [row.id, row]));
    const plans = new Map(extension.plans.map(row => [row.id, row]));
    const receipts = new Map(extension.receipts.map(row => [row.id, row]));
    const accounts = new Set(state.accounts.map(row => row.id));
    const components = new Map();
    function entry(key) { if (!components.has(key)) components.set(key, { duplicates: [], reductions: [] }); return components.get(key); }
    // One pass over each relevant relation collection, never a per-receipt scan.
    for (const row of state.bookkeeping?.links || []) entry(row.primaryId).duplicates.push({ id: row.id, primaryId: row.primaryId, shadowId: row.shadowId, primarySignature: withId(row.primaryId, row.primarySignature), shadowSignature: withId(row.shadowId, row.shadowSignature) });
    for (const [collection, kind] of [['refunds', 'refund'], ['settlements', 'settlement'], ['heldReturns', 'held-return']]) for (const row of state.bookkeeping?.[collection] || []) entry(row.incomeId).reductions.push({ id: row.id, kind, amountCents: row.amountCents, incomeSignature: withId(row.incomeId, row.incomeSignature) });
    for (const value of components.values()) { order(value.duplicates); order(value.reductions); }
    const probes = new Map();
    function probe(key) {
      if (probes.has(key)) return probes.get(key);
      const tx = transactions.get(key), part = components.get(key) || { duplicates: [], reductions: [] };
      const p = { transaction: tx ? signature(tx) : null, proof: null, key: null, residual: null, status: 'missing', reasons: [], duplicates: tx ? part.duplicates : [], reductions: tx ? part.reductions : [] };
      if (!tx) p.reasons.push('source-missing');
      else {
        const impact = financial.impacts[key];
        if (!impact || !Number.isSafeInteger(impact.ordinaryIncomeCents)) fail('INCOME_INVARIANT_VIOLATION');
        p.residual = impact.ordinaryIncomeCents;
        if (tx.type !== 'income' || impact.excluded || impact.primaryId || impact.transferPairId || p.residual <= 0) { p.status = 'ineligible'; p.reasons.push('role-changed'); }
        else if (part.duplicates.length + part.reductions.length > 200) { p.status = 'unsupported'; p.reasons.push('proof-limit'); }
        else {
          p.proof = core().normalizeProof({ version: 1, source: signature(tx), role: 'ordinary-primary', duplicateEvidence: part.duplicates, reductions: part.reductions, ordinaryIncomeCents: p.residual });
          if (p.proof.ordinaryIncomeCents !== impact.ordinaryIncomeCents) fail('INCOME_INVARIANT_VIOLATION');
          p.key = core().basisKey(p.proof); p.status = 'available';
        }
        if (tx.date > asOfDate) p.reasons.push('future-at-cutoff');
      }
      p.reasons = sortIds(p.reasons); probes.set(key, p); return p;
    }
    const sourceIds = sortIds(state.transactions.filter(row => row.type === 'income').map(row => row.id).concat(extension.receipts.map(row => row.transactionId)));
    for (const key of sourceIds) probe(key);
    const receiptViews = new Map(), byPlan = new Map(), bySource = new Map();
    for (const receipt of extension.receipts) {
      const p = probe(receipt.transactionId), reasons = p.reasons.slice();
      const sourceChanged = !!p.transaction && !equal(receipt.proof.source, p.transaction);
      const basisMismatch = !!p.proof && core().basisKey(receipt.proof) !== p.key;
      // A changed financial signature is not itself a changed ordinary role.
      // Keep complete-key matching for applicability, but report role/composition
      // changes only when those fields actually differ.
      const roleChanged = !!p.transaction && (p.status === 'ineligible' || basisMismatch && ['role', 'duplicateEvidence', 'reductions'].some(field => !equal(receipt.proof[field], p.proof[field])));
      if (sourceChanged) reasons.push('source-changed');
      if (roleChanged) reasons.push('role-changed');
      const applicability = !p.transaction ? 'source-missing' : sourceChanged ? 'source-changed' : p.status === 'ineligible' || basisMismatch ? 'role-changed' : p.status === 'unsupported' ? 'unsupported-basis' : p.transaction.date > asOfDate ? 'future-at-cutoff' : 'applicable';
      if (applicability === 'unsupported-basis') reasons.push('unsupported-basis');
      const currentAmount = !p.transaction ? null : p.transaction.date > asOfDate || p.status === 'ineligible' ? 0 : p.residual;
      const rv = { receiptId: receipt.id, planId: receipt.planId, transactionId: receipt.transactionId, economicDate: receipt.proof.source.date, reviewedAsOfDate: receipt.reviewedAsOfDate, capturedAmountCents: receipt.amountCents, applicability, reasonCodes: sortIds(reasons), currentOrdinaryIncomeCents: currentAmount };
      receiptViews.set(receipt.id, rv);
      if (!byPlan.has(receipt.planId)) byPlan.set(receipt.planId, []); byPlan.get(receipt.planId).push(rv);
      if (!bySource.has(receipt.transactionId)) bySource.set(receipt.transactionId, []); bySource.get(receipt.transactionId).push(rv);
    }
    const sourceViews = new Map();
    for (const key of sourceIds) {
      const p = probe(key), rows = bySource.get(key) || [], unresolved = rows.filter(row => row.applicability !== 'applicable');
      let ordinary = p.residual, attributed = sum(rows.filter(row => row.applicability === 'applicable').map(row => row.capturedAmountCents)), unassociated;
      if (!p.transaction) { ordinary = null; attributed = null; unassociated = null; }
      else if (p.transaction.date > asOfDate || p.status === 'ineligible') { ordinary = 0; attributed = 0; unassociated = 0; }
      else if (p.status === 'unsupported') { attributed = null; unassociated = null; }
      else { if (attributed > ordinary) fail('INCOME_INVARIANT_VIOLATION', '当前来源归属容量不变量失败'); unassociated = ordinary - attributed; }
      sourceViews.set(key, { transactionId: key, asOfDate, currentTransaction: p.transaction, ordinaryIncomeCents: ordinary, applicableAttributedCents: attributed, unassociatedOrdinaryCents: unassociated, unresolvedCapturedCents: sum(unresolved.map(row => row.capturedAmountCents)), unresolvedReceiptIds: sortIds(unresolved.map(row => row.receiptId)), basisStatus: p.status, reasonCodes: p.reasons });
    }
    const planViews = new Map();
    for (const plan of extension.plans) {
      const rows = byPlan.get(plan.id) || [], unresolved = rows.filter(row => row.applicability !== 'applicable');
      const known = sum(rows.filter(row => row.applicability === 'applicable').map(row => row.capturedAmountCents));
      const received = unresolved.length ? null : known, remaining = received === null || plan.expectedAmountCents === null ? null : plan.expectedAmountCents - received;
      const accountStatus = plan.expectedAccountId === null ? 'unspecified' : accounts.has(plan.expectedAccountId) ? 'known' : 'missing';
      const warnings = sortIds(rows.flatMap(row => row.reasonCodes).concat(accountStatus === 'missing' ? ['expected-account-missing'] : []));
      planViews.set(plan.id, { plan, receiptIds: sortIds(rows.map(row => row.receiptId)), knownApplicableCents: known, unresolvedCapturedCents: sum(unresolved.map(row => row.capturedAmountCents)), unresolvedReceiptIds: sortIds(unresolved.map(row => row.receiptId)), receivedCents: received, remainingCents: remaining, progress: unresolved.length ? 'unresolved' : plan.expectedAmountCents === null ? 'target-unknown' : remaining === 0 ? 'complete' : received === 0 ? 'none' : 'partial', expectedAccountStatus: accountStatus, warnings });
    }
    const view = { asOfDate, knowledgeBasis: 'current-state-not-historical-knowledge', plans: [...planViews.values()], receipts: order([...receiptViews.values()], 'receiptId'), sources: order([...sourceViews.values()], 'transactionId'), warnings: sortIds([...planViews.values()].flatMap(row => row.warnings).concat([...sourceViews.values()].flatMap(row => row.reasonCodes))) };
    view.plans.sort((a, b) => a.plan.id < b.plan.id ? -1 : a.plan.id > b.plan.id ? 1 : 0);
    return { state, extension, financial, transactions, plans, receipts, accounts, probe, view, planViews, receiptViews, sourceViews, byPlan, bySource };
  }
  function projectPrepared(prepared, opt) {
    const rows = prepared.view.plans.map(planView => {
      const plan = planView.plan, expected = plan.expectedDate;
      const dateState = expected === null ? 'undated' : expected <= opt.asOfDate ? 'due' : expected > opt.horizonEnd ? 'tail' : 'in-window';
      const exclusionReason = plan.status === 'cancelled' ? 'cancelled' : planView.progress === 'complete' ? 'fulfilled' : opt.mode === 'confirmed-only' && plan.certainty === 'expectation' ? 'expectation' : opt.mode === 'conservative' ? 'conservative-assumption' : null;
      const bucket = exclusionReason ? 'excluded' : dateState === 'tail' ? 'tail' : planView.unresolvedReceiptIds.length ? 'blocked' : dateState === 'undated' ? 'undated' : dateState === 'due' ? 'overdue' : 'dated';
      const contribution = bucket === 'excluded' ? 0 : bucket === 'blocked' ? null : planView.remainingCents;
      const window = bucket === 'excluded' || bucket === 'tail' ? 0 : bucket === 'dated' ? contribution : null;
      return { planId: plan.id, planView, dateState, bucket, exclusionReason, expectedDate: expected, contributionCents: contribution, windowContributionCents: window, blocksWindowTotal: window === null, receivedCents: planView.receivedCents, remainingCents: planView.remainingCents, warnings: planView.warnings };
    });
    const known = sum(rows.filter(row => row.bucket === 'dated' && row.contributionCents !== null).map(row => row.contributionCents));
    const blocking = rows.filter(row => row.blocksWindowTotal).map(row => row.planId);
    return { mode: opt.mode, asOfDate: opt.asOfDate, horizonEnd: opt.horizonEnd, rows, knownDatedTotalCents: known, scheduledTotalCents: blocking.length ? null : known, knownTailTotalCents: sum(rows.filter(row => row.bucket === 'tail' && row.contributionCents !== null).map(row => row.contributionCents)), unknownTailCount: rows.filter(row => row.bucket === 'tail' && row.contributionCents === null).length, blockingPlanIds: blocking, warnings: prepared.view.warnings };
  }
  function normalizeQuery(raw) {
    core().inspectData(raw);
    if (!raw || !['allocate-receipt', 'reconfirm-receipt'].includes(raw.action)) fail('INVALID_INCOME_QUERY');
    shape(raw, raw.action === 'allocate-receipt' ? ['action', 'planId', 'transactionId', 'asOfDate'] : ['action', 'receiptId', 'asOfDate']);
    return raw.action === 'allocate-receipt' ? { action: raw.action, planId: id(raw.planId), transactionId: id(raw.transactionId), asOfDate: date(raw.asOfDate) } : { action: raw.action, receiptId: id(raw.receiptId), asOfDate: date(raw.asOfDate) };
  }
  function eligibilityPrepared(p, query) {
    const reconfirm = query.action === 'reconfirm-receipt', receipt = reconfirm ? p.receipts.get(query.receiptId) : null;
    const plan = p.plans.get(reconfirm ? receipt?.planId : query.planId);
    if (reconfirm && !receipt || !reconfirm && !plan) return { eligible: false, reasonCodes: [reconfirm ? 'receipt-not-found' : 'plan-not-found'], sourceCapacityCents: null, planTargetCapacity: { kind: 'unresolved', cents: null }, maxAdditionalCents: null, amountToReconfirmCents: null };
    if (!plan) fail('INCOME_INVARIANT_VIOLATION');
    const key = reconfirm ? receipt.transactionId : query.transactionId, probe = p.probe(key), source = p.sourceViews.get(key);
    const pv = p.planViews.get(plan.id), reasons = [];
    let capacity = source ? source.unassociatedOrdinaryCents : probe.transaction ? (probe.transaction.date > query.asOfDate || probe.status === 'ineligible' ? 0 : probe.status === 'unsupported' ? null : probe.residual) : null;
    if (reconfirm && p.receiptViews.get(receipt.id).applicability === 'applicable') { if (capacity !== null) capacity += receipt.amountCents; reasons.push('reconfirm-unnecessary'); }
    if (!probe.transaction) reasons.push('source-missing');
    else {
      if (probe.transaction.date > query.asOfDate) reasons.push('future-at-cutoff');
      if (probe.status === 'ineligible') reasons.push('source-ineligible');
      if (probe.status === 'unsupported') reasons.push('proof-limit');
    }
    let target;
    if (reconfirm) {
      const captured = sum((p.byPlan.get(plan.id) || []).filter(row => row.receiptId !== receipt.id).map(row => row.capturedAmountCents));
      target = plan.expectedAmountCents === null ? { kind: 'target-unknown', cents: null } : { kind: 'known', cents: plan.expectedAmountCents - captured };
      if (capacity !== null && receipt.amountCents > capacity) reasons.push('source-capacity-exceeded');
      if (target.kind === 'known' && receipt.amountCents > target.cents) reasons.push('plan-capacity-exceeded');
    } else {
      if (plan.status === 'cancelled') reasons.push('plan-cancelled');
      if (pv.progress === 'unresolved') { reasons.push('plan-unresolved'); target = { kind: 'unresolved', cents: null }; }
      else target = plan.expectedAmountCents === null ? { kind: 'target-unknown', cents: null } : { kind: 'known', cents: pv.remainingCents };
    }
    const max = reconfirm || target.kind === 'unresolved' || capacity === null ? null : target.kind === 'known' ? Math.min(capacity, target.cents) : capacity;
    if (!reconfirm && max === 0) reasons.push('no-additional-capacity');
    return { eligible: !reasons.length, reasonCodes: sortIds(reasons), sourceCapacityCents: capacity, planTargetCapacity: target, maxAdditionalCents: max, amountToReconfirmCents: reconfirm ? receipt.amountCents : null };
  }
  function command(raw) {
    core().inspectData(raw);
    if (!raw || !Object.hasOwn(GRAMMAR, raw.action)) fail('INVALID_INCOME_COMMAND');
    shape(raw, GRAMMAR[raw.action]); const out = copy(raw);
    if (Object.hasOwn(out, 'planId')) id(out.planId);
    if (Object.hasOwn(out, 'transactionId')) id(out.transactionId);
    if (Object.hasOwn(out, 'receiptId')) id(out.receiptId);
    if (out.action === 'create-plan') {
      shape(out.plan, PLAN_FIELDS);
      const normalized = core().normalizePlan({ id: 'preview-plan', createdAt: '2000-01-01T00:00:00.000Z', status: 'open', ...out.plan });
      out.plan = Object.fromEntries(PLAN_FIELDS.map(key => [key, normalized[key]]));
    }
    if (out.action === 'update-plan') shape(out.patch, PLAN_FIELDS.concat('status'), true);
    if (out.action === 'allocate-receipt') { amount(out.amountCents); text(out.reference); }
    return out;
  }
  function queryFor(cmd, asOfDate) { return cmd.action === 'allocate-receipt' ? { action: cmd.action, planId: cmd.planId, transactionId: cmd.transactionId, asOfDate } : { action: cmd.action, receiptId: cmd.receiptId, asOfDate }; }
  function retained(state) {
    if (typeof ledger().collectRetainedIdentities !== 'function') fail('INCOME_MODULE_UNAVAILABLE');
    return new Set(ledger().collectRetainedIdentities(state).map(row => row.id));
  }
  function buildCandidate(before, cmd, opt, at, reason, fixedIds) {
    const state = before.state, data = copy(before.extension), reserved = retained(state), ids = [], events = [], entities = [];
    let sequence = 0, fixedIndex = 0;
    function fresh(kind) {
      let value;
      if (fixedIds) { value = fixedIds[fixedIndex++]; if (!value || reserved.has(value)) fail('INCOME_STALE_PREVIEW'); }
      else do { value = 'income-' + kind + '-' + (data.revision + 1) + '-' + (++sequence); } while (reserved.has(value));
      reserved.add(value); ids.push(value); return value;
    }
    function append(kind, action, oldRow, newRow, reverses = null, eventId) {
      const event = { id: eventId || fresh('event'), revision: ++data.revision, at, kind, recordId: (newRow || oldRow).id, action, reason, before: oldRow ? copy(oldRow) : null, after: newRow ? copy(newRow) : null, reverses };
      data.audit.push(event); events.push(event.id);
    }
    function reverse(old) {
      const original = data.audit.find(row => row.kind === 'receipt' && row.action === 'create' && row.recordId === old.id);
      if (!original) fail('INCOME_INVARIANT_VIOLATION');
      data.receipts = data.receipts.filter(row => row.id !== old.id); append('receipt', 'reverse', old, null, original.id);
    }
    let targetId, eligibility = null;
    if (cmd.action === 'create-plan') {
      if (cmd.plan.expectedAccountId !== null && !before.accounts.has(cmd.plan.expectedAccountId)) fail('expected-account-not-found');
      const row = core().normalizePlan({ id: fresh('plan'), createdAt: at, ...cmd.plan, status: 'open' });
      entities.push(row.id); targetId = row.id; data.plans.push(copy(row)); append('plan', 'create', null, row);
    } else if (cmd.action === 'update-plan' || cmd.action === 'retire-plan') {
      const old = before.plans.get(cmd.planId); if (!old) fail('plan-not-found'); targetId = old.id;
      if (cmd.action === 'retire-plan') { if ((before.byPlan.get(old.id) || []).length) fail('plan-has-receipts'); data.plans = data.plans.filter(row => row.id !== old.id); append('plan', 'retire', old, null); }
      else {
        const row = core().normalizePlan({ ...old, ...cmd.patch });
        if (equal(row, old)) fail('plan-no-op');
        if (row.expectedAmountCents !== old.expectedAmountCents && before.planViews.get(old.id).progress === 'unresolved') fail('plan-unresolved');
        if (row.expectedAccountId !== old.expectedAccountId && row.expectedAccountId !== null && !before.accounts.has(row.expectedAccountId)) fail('expected-account-not-found');
        data.plans = data.plans.map(value => value.id === old.id ? copy(row) : value); append('plan', 'update', old, row);
      }
    } else if (cmd.action === 'reverse-receipt') {
      const old = before.receipts.get(cmd.receiptId); if (!old) fail('receipt-not-found'); targetId = old.planId; reverse(old);
    } else {
      eligibility = eligibilityPrepared(before, queryFor(cmd, opt.asOfDate));
      if (!eligibility.eligible) fail(eligibility.reasonCodes[0], '此收入归属当前不能确认：' + eligibility.reasonCodes.join('、'));
      const old = cmd.action === 'reconfirm-receipt' ? before.receipts.get(cmd.receiptId) : null;
      if (!old && cmd.amountCents > eligibility.maxAdditionalCents) fail('allocation-capacity-exceeded');
      targetId = old ? old.planId : cmd.planId;
      const source = before.probe(old ? old.transactionId : cmd.transactionId);
      if (source.status !== 'available' || source.transaction.date > opt.asOfDate) fail('source-unavailable');
      if (old) reverse(old);
      const row = { id: fresh('receipt'), createdAt: at, reviewedAsOfDate: opt.asOfDate, planId: targetId, transactionId: source.transaction.id, amountCents: old ? old.amountCents : cmd.amountCents, proof: copy(source.proof), reference: old ? old.reference : cmd.reference };
      entities.push(row.id); data.receipts.push(row); append('receipt', 'create', null, row);
    }
    if (fixedIds && fixedIndex !== fixedIds.length) fail('INCOME_STALE_PREVIEW');
    const candidate = validateState({ ...state, version: Math.max(state.version, 7), incomePlanning: data });
    return { candidate, ids, events, entities, targetId, eligibility };
  }
  function financialDeltas(before, after) {
    const strip = state => Object.fromEntries(Object.entries(state).filter(([key]) => key !== 'version' && key !== 'incomePlanning'));
    if (!equal(strip(before.state), strip(after.state))) fail('INCOME_FINANCIAL_MUTATION');
    const a = before.financial, b = after.financial;
    const result = { scope: 'all-recorded-dates-current-financial-model', ordinaryIncomeCents: b.personal.incomeCents - a.personal.incomeCents, personalExpenseCents: b.personal.expenseCents - a.personal.expenseCents, cashInCents: b.cash.incomeCents - a.cash.incomeCents, cashOutCents: b.cash.expenseCents - a.cash.expenseCents, accounts: [] };
    function flows(p) {
      const map = new Map(p.state.accounts.map(row => [row.id, { inflow: 0, outflow: 0 }]));
      for (const row of p.financial.drilldown.accountFlows) for (const movement of row.movements) {
        const v = map.get(movement.accountId); if (!v) fail('INCOME_INVARIANT_VIOLATION');
        if (movement.signedCents > 0) v.inflow = sum([v.inflow, movement.signedCents]); else v.outflow = sum([v.outflow, -movement.signedCents]);
      }
      return map;
    }
    const left = flows(before), right = flows(after);
    for (const key of sortIds(before.state.accounts.map(row => row.id))) result.accounts.push({ accountId: key, inflowCents: right.get(key).inflow - left.get(key).inflow, outflowCents: right.get(key).outflow - left.get(key).outflow, balanceCents: b.accountBalances[key] - a.accountBalances[key] });
    if (['ordinaryIncomeCents', 'personalExpenseCents', 'cashInCents', 'cashOutCents'].some(key => result[key] !== 0) || result.accounts.some(row => row.inflowCents !== 0 || row.outflowCents !== 0 || row.balanceCents !== 0)) fail('INCOME_FINANCIAL_MUTATION');
    return result;
  }
  function headroom(p, key) { const row = p.plans.get(key); return !row ? { kind: 'absent', cents: null } : row.expectedAmountCents === null ? { kind: 'target-unknown', cents: null } : { kind: 'known', cents: row.expectedAmountCents - sum((p.byPlan.get(key) || []).map(value => value.capturedAmountCents)) }; }
  function match(plan, source) {
    return { date: plan.expectedDate === null ? 'expected-unspecified' : !source ? 'source-unavailable' : plan.expectedDate === source.date ? 'same' : 'different', account: plan.expectedAccountId === null ? 'expected-unspecified' : !source ? 'source-unavailable' : plan.expectedAccountId === source.accountId ? 'same' : 'different' };
  }
  function totals(projected) { return Object.fromEntries(['knownDatedTotalCents', 'scheduledTotalCents', 'knownTailTotalCents', 'unknownTailCount', 'blockingPlanIds', 'warnings'].map(key => [key, projected[key]])); }
  function review(before, after, built, cmd, opt, previewAt) {
    const key = built.targetId;
    const receiptIds = sortIds((before.byPlan.get(key) || []).concat(after.byPlan.get(key) || []).map(row => row.receiptId));
    const receiptRows = receiptIds.map(receiptId => {
      const row = before.receipts.get(receiptId) || after.receipts.get(receiptId), source = before.probe(row.transactionId);
      const fields = source.proof ? ['source', 'role', 'duplicateEvidence', 'reductions', 'ordinaryIncomeCents'].filter(field => !equal(row.proof[field], source.proof[field])) : [];
      function side(p) { const plan = p.plans.get(key); return !p.receipts.has(receiptId) ? null : { captured: match(plan, row.proof.source), current: match(plan, source.transaction) }; }
      return { receipt: row, before: before.receiptViews.get(receiptId) || null, after: after.receiptViews.get(receiptId) || null, proofComparison: { result: !source.proof ? 'unavailable' : fields.length ? 'different' : 'equal', differentFields: fields }, planMatchBefore: side(before), planMatchAfter: side(after) };
    });
    const sourceIds = sortIds(receiptRows.map(row => row.receipt.transactionId).concat(cmd.action === 'allocate-receipt' ? [cmd.transactionId] : []));
    function allocations(p, transactionId) { return order((p.bySource.get(transactionId) || []).filter(row => row.applicability === 'applicable').map(row => ({ receiptId: row.receiptId, planId: row.planId, amountCents: row.capturedAmountCents })), 'receiptId'); }
    const sources = sourceIds.map(transactionId => {
      const p = before.probe(transactionId);
      return { transactionId, currentTransaction: p.transaction, currentBasis: p.status === 'unsupported' ? 'proof-limit' : p.status, currentProof: p.proof, ordinaryResidualCents: p.residual, reductionComponents: p.reductions.map(row => ({ id: row.id, kind: row.kind, amountCents: row.amountCents })), duplicateLinks: p.duplicates.map(row => ({ id: row.id, primaryId: row.primaryId, shadowId: row.shadowId })), before: before.sourceViews.get(transactionId) || null, after: after.sourceViews.get(transactionId) || null, applicableAllocationsBefore: allocations(before, transactionId), applicableAllocationsAfter: allocations(after, transactionId) };
    });
    const scenarios = {};
    for (const [name, mode] of [['confirmedOnly', 'confirmed-only'], ['planned', 'planned'], ['conservative', 'conservative']]) {
      const a = projectPrepared(before, { ...opt, mode }), b = projectPrepared(after, { ...opt, mode });
      if (!equal(a.rows.filter(row => row.planId !== key), b.rows.filter(row => row.planId !== key))) fail('INCOME_UNRELATED_PLAN_MUTATION');
      scenarios[name] = { mode, before: totals(a), after: totals(b), rows: [{ planId: key, before: a.rows.find(row => row.planId === key) || null, after: b.rows.find(row => row.planId === key) || null }] };
    }
    return { version: 1, command: cmd, options: opt, confirmationStamp: { status: 'pending-confirmation', previewAt, reason: null }, newEvents: after.extension.audit.slice(before.extension.audit.length).map(row => ({ id: row.id, revision: row.revision, kind: row.kind, recordId: row.recordId, action: row.action, reverses: row.reverses })), plans: [{ planId: key, before: before.planViews.get(key) || null, after: after.planViews.get(key) || null, targetHeadroomBefore: headroom(before, key), targetHeadroomAfter: headroom(after, key) }], receipts: receiptRows, sources, operationEligibility: built.eligibility, scenarioImpacts: scenarios, financialDeltas: financialDeltas(before, after), unchangedSubtrees: { basis: 'normalized-persisted-full-ledger', allowedChangedPaths: ['version', 'incomePlanning'], allOtherSubtreesEqual: true } };
  }
  function maskCandidate(state, meta) {
    const value = copy(state), events = new Set(meta.events), entities = new Set(meta.entities);
    function record(row) { if (row && entities.has(row.id)) row.createdAt = meta.previewAt; }
    value.incomePlanning.plans.forEach(record); value.incomePlanning.receipts.forEach(record);
    for (const row of value.incomePlanning.audit) { if (events.has(row.id)) { row.at = meta.previewAt; row.reason = PREVIEW_REASON; } record(row.before); record(row.after); }
    return value;
  }
  function maskReview(raw, meta) {
    const value = copy(raw), entities = new Set(meta.entities);
    function plan(view) { if (view && entities.has(view.plan.id)) view.plan.createdAt = meta.previewAt; }
    for (const row of value.plans) { plan(row.before); plan(row.after); }
    for (const row of value.receipts) if (entities.has(row.receipt.id)) row.receipt.createdAt = meta.previewAt;
    for (const impact of Object.values(value.scenarioImpacts)) for (const row of impact.rows) { if (row.before) plan(row.before.planView); if (row.after) plan(row.after.planView); }
    return value;
  }
  function createCoordinator(capabilities) {
    // These are the only explicit function capabilities accepted by the module.
    if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) fail('INVALID_INCOME_CAPABILITIES');
    core().inspectData(Object.create(Object.getPrototypeOf(capabilities)));
    const keys = Reflect.ownKeys(capabilities);
    if (keys.length !== 2 || !keys.includes('now') || !keys.includes('today') || keys.some(key => { const d = Object.getOwnPropertyDescriptor(capabilities, key); return !d.enumerable || !Object.hasOwn(d, 'value') || typeof d.value !== 'function'; })) fail('INVALID_INCOME_CAPABILITIES');
    const now = capabilities.now, today = capabilities.today, tickets = new WeakMap(); let generation = 0;
    function preview(raw, rawCommand, rawOptions) {
      const state = validateState(raw), cmd = command(rawCommand), opt = options(rawOptions);
      if (opt.asOfDate > date(today())) fail('cutoff-in-future');
      const previewAt = timestamp(now()), before = prepare(state, opt.asOfDate);
      const built = buildCandidate(before, cmd, opt, previewAt, PREVIEW_REASON), after = prepare(built.candidate, opt.asOfDate);
      const ticket = freeze(copy({ review: review(before, after, built, cmd, opt, previewAt) }));
      core().canonicalData(ticket, { maxBytes: BYTES.preview });
      tickets.set(ticket, { ...built, cmd, opt, previewAt, generation, basis: canonical(state), candidateSignature: canonical(built.candidate), reviewSignature: canonical(ticket.review) });
      return ticket;
    }
    function commit(raw, ticket, confirmation) {
      const meta = tickets.get(ticket); if (meta) tickets.delete(ticket);
      const state = validateState(raw);
      if (!meta || meta.generation !== generation) fail('INCOME_TICKET_INVALID', '复核已失效，请重新预览');
      shape(confirmation, ['confirmed', 'reason']);
      if (confirmation.confirmed !== true) fail('INCOME_CONFIRMATION_REQUIRED');
      const reason = core().normalizeReason(confirmation.reason);
      if (canonical(state) !== meta.basis) fail('INCOME_STALE_PREVIEW', '账本已改变，请重新预览');
      if (meta.opt.asOfDate > date(today())) fail('cutoff-in-future');
      const at = timestamp(now()), before = prepare(state, meta.opt.asOfDate);
      const built = buildCandidate(before, meta.cmd, meta.opt, at, reason, meta.ids), after = prepare(built.candidate, meta.opt.asOfDate);
      if (canonical(maskCandidate(built.candidate, meta)) !== meta.candidateSignature) fail('INCOME_STALE_PREVIEW');
      const recomputed = maskReview(review(before, after, built, meta.cmd, meta.opt, meta.previewAt), meta);
      if (canonical(recomputed) !== meta.reviewSignature) fail('INCOME_STALE_PREVIEW');
      return freeze(copy(built.candidate));
    }
    function cancel(ticket) { const meta = tickets.get(ticket); if (!meta) return false; tickets.delete(ticket); return meta.generation === generation; }
    function invalidateAll() { generation++; }
    return Object.freeze({ preview, commit, cancel, invalidateAll });
  }
  function view(raw, rawOptions) { const state = validateState(raw), opt = options(rawOptions, false); return freeze(copy(prepare(state, opt.asOfDate).view)); }
  function project(raw, rawOptions) { const state = validateState(raw), opt = options(rawOptions); return freeze(copy(projectPrepared(prepare(state, opt.asOfDate), opt))); }
  function eligibility(raw, rawQuery) { const state = validateState(raw), query = normalizeQuery(rawQuery); return freeze(copy(eligibilityPrepared(prepare(state, query.asOfDate), query))); }
  function validateExtension(raw) { return core().validateExtension(raw); }
  return Object.freeze({ validateExtension, view, project, eligibility, createCoordinator });
}));
