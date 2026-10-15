/* Gross recorded cash-role payment annotations. No storage, network, or financial writes. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoneygoSpendingPlanning = api;
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const PLAN_FIELDS = ['name', 'targetAmountCents', 'expectedDate', 'expectedAccountId', 'note'];
  const PROOF_FIELDS = ['source', 'role', 'cashProfile', 'duplicateEvidence', 'refunds', 'claims', 'grossPaymentCents'];
  const PREVIEW_REASON = '待用户确认', RESULT_BYTES = 8388608, LEDGER_BYTES = 33554432;
  const GRAMMAR = {
    'create-plan': ['action', 'plan', 'remainingAfterCents'],
    'update-plan': ['action', 'planId', 'patch'],
    'commit-plan': ['action', 'planId', 'commitmentBasis', 'remainingAfterCents'],
    'cancel-plan': ['action', 'planId'], 'retire-plan': ['action', 'planId'],
    'reopen-plan': ['action', 'planId', 'remainingAfterCents'],
    'return-to-plan': ['action', 'planId', 'remainingAfterCents'],
    'confirm-remaining': ['action', 'planId', 'remainingAfterCents'],
    'allocate-payment': ['action', 'planId', 'transactionId', 'amountCents', 'reference', 'remainingAfterCents'],
    'reverse-payment': ['action', 'paymentId', 'remainingAfterCents'],
    'reconfirm-payment': ['action', 'paymentId', 'remainingAfterCents']
  };
  function fail(code, message) { const error = new Error(message || code); error.name = 'SpendingPlanningError'; error.code = code; throw error; }
  function dependency(file, name) {
    const value = typeof module === 'object' && module.exports ? require('./' + file + '.js') : root[name];
    if (!value) fail('SPENDING_INVARIANT', '支出计划所需模块未加载');
    return value;
  }
  const core = () => dependency('spending-core', 'MoneygoSpendingCore');
  const ledger = () => dependency('ledger', 'MoneygoLedger');
  const relations = () => dependency('relations', 'MoneygoRelations');
  const copy = value => JSON.parse(JSON.stringify(value));
  function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
  const sorted = values => [...new Set(values)].sort();
  const order = (rows, key = 'id') => rows.sort((a, b) => a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0);
  const canonical = value => core().canonicalData(value, { maxBytes: LEDGER_BYTES });
  const equal = (a, b) => canonical(a) === canonical(b);
  // Descriptor-only canonicalization detaches untrusted callers before old validators or property reads.
  const snapshot = value => JSON.parse(canonical(value));
  function sum(values) { let total = 0n; for (const value of values) total += BigInt(value); if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) fail('SPENDING_OVERFLOW'); return Number(total); }
  function shape(value, fields, code, partial = false) {
    core().inspectData(value);
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
    const keys = Object.keys(value);
    if (keys.some(key => !fields.includes(key)) || (!partial && fields.some(key => !Object.hasOwn(value, key))) || (partial && !keys.length)) fail(code);
    return value;
  }
  function id(value, code) { if (typeof value !== 'string' || value.length > 100 || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) || ['constructor', 'prototype'].includes(value)) fail(code); return value; }
  function date(value, code) { if (!ledger().validDate(value)) fail(code); return value; }
  function timestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !ledger().validDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('SPENDING_INVALID_CAPABILITIES');
    return value;
  }
  function amount(value, zero = false) { if (!Number.isSafeInteger(value) || Object.is(value, -0) || value < (zero ? 0 : 1) || value > 999999999999) fail('SPENDING_INVALID_COMMAND'); return value; }
  function text(value) { if (typeof value !== 'string' || value.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail('SPENDING_INVALID_COMMAND'); return value; }
  function options(raw, fields = ['asOfDate']) { raw = snapshot(raw); shape(raw, fields, 'SPENDING_INVALID_OPTIONS'); return { ...raw, asOfDate: date(raw.asOfDate, 'SPENDING_INVALID_OPTIONS') }; }
  function expose(raw) {
    try { core().canonicalData(raw, { maxBytes: RESULT_BYTES }); } catch (error) { if (error.code === 'SPENDING_LIMIT') fail('SPENDING_RESULT_LIMIT', '完整复核内容超过大小限制'); throw error; }
    return freeze(copy(raw));
  }
  function stateSnapshot(raw) {
    const engine = core();
    if (engine.inspectData(raw).jsonBytes > LEDGER_BYTES) fail('SPENDING_LIMIT');
    const copies = new WeakMap(), pending = [], detached = []; let nodes = 0;
    try {
      function detach(value) {
        if (++nodes > engine.LIMITS.dataNodes || typeof value === 'string' && value.length > engine.LIMITS.stringCodeUnits) fail('SPENDING_LIMIT');
        if (!value || typeof value !== 'object') return value;
        if (copies.has(value)) return copies.get(value);
        const array = Array.isArray(value), result = array ? [] : Object.create(Object.getPrototypeOf(value));
        if (array) Object.setPrototypeOf(result, Object.getPrototypeOf(value));
        copies.set(value, result); pending.push({ value, result, array }); detached.push({ result, array }); return result;
      }
      const result = detach(raw);
      while (pending.length) {
        const frame = pending.pop();
        for (const key of Reflect.ownKeys(frame.value)) {
          const d = Object.getOwnPropertyDescriptor(frame.value, key);
          if (!d || !Object.hasOwn(d, 'value') || typeof key !== 'string' || key.length > engine.LIMITS.stringCodeUnits || (!d.enumerable && !(frame.array && key === 'length'))) fail('SPENDING_INVALID_DATA');
          if (frame.array && key === 'length') { Object.defineProperty(frame.result, key, { value: d.value, writable: true }); continue; }
          Object.defineProperty(frame.result, key, { value: detach(d.value), enumerable: true, writable: true, configurable: true });
        }
      }
      if (engine.inspectData(result).jsonBytes > LEDGER_BYTES) fail('SPENDING_LIMIT');
      // Preserve own property/array order, but normalize only proven ordinary realm prototypes.
      for (const row of detached) Object.setPrototypeOf(row.result, row.array ? Array.prototype : Object.prototype);
      return result;
    } catch (error) {
      let code; try { code = Object.getOwnPropertyDescriptor(error, 'code')?.value; } catch (_) { /* unstable thrown object */ }
      fail(code === 'SPENDING_LIMIT' ? code : 'SPENDING_INVALID_DATA', '不能安全读取支出计划账本');
    }
  }
  function validateState(raw) { const state = ledger().validateState(stateSnapshot(raw)); canonical(state); return state; }
  const extensionOf = state => state.spendingPlanning || { version: 1, revision: 0, plans: [], payments: [], audit: [] };
  const signature = row => ({ id: row.id, type: row.type, date: row.date, amountCents: row.amountCents, accountId: row.accountId, toAccountId: row.toAccountId === undefined ? null : row.toAccountId });
  const withId = (key, row) => signature({ ...row, id: key });
  function prepare(state, asOfDate) {
    const extension = extensionOf(state), financial = relations().calculate(state);
    const transactions = new Map(state.transactions.map(row => [row.id, row]));
    const plans = new Map(extension.plans.map(row => [row.id, row])), payments = new Map(extension.payments.map(row => [row.id, row]));
    const accounts = new Set(state.accounts.map(row => row.id));
    const profiles = new Map((state.obligations?.profiles || []).map(row => [row.accountId, row]));
    const heldSources = new Set((state.bookkeeping?.heldPositions || []).map(row => row.expenseId));
    const components = new Map();
    function parts(key) { if (!components.has(key)) components.set(key, { duplicates: [], refunds: [], claims: [] }); return components.get(key); }
    for (const row of state.bookkeeping?.links || []) parts(row.primaryId).duplicates.push({ id: row.id, primaryId: row.primaryId, shadowId: row.shadowId, primarySignature: withId(row.primaryId, row.primarySignature), shadowSignature: withId(row.shadowId, row.shadowSignature) });
    for (const row of state.bookkeeping?.refunds || []) parts(row.expenseId).refunds.push({ id: row.id, expenseId: row.expenseId, incomeId: row.incomeId, amountCents: row.amountCents, expenseSignature: withId(row.expenseId, row.expenseSignature), incomeSignature: withId(row.incomeId, row.incomeSignature) });
    for (const row of state.bookkeeping?.claims || []) parts(row.expenseId).claims.push({ id: row.id, expenseId: row.expenseId, amountCents: row.amountCents, expenseSignature: withId(row.expenseId, row.expenseSignature) });
    for (const part of components.values()) for (const rows of Object.values(part)) order(rows);
    const probes = new Map();
    function probe(key) {
      if (probes.has(key)) return probes.get(key);
      const tx = transactions.get(key), part = components.get(key) || { duplicates: [], refunds: [], claims: [] }, profile = tx ? profiles.get(tx.accountId) : null;
      const p = { transaction: tx ? signature(tx) : null, profile: profile ? { id: profile.id, accountId: profile.accountId, role: profile.role } : null, proof: null, key: null, status: 'missing', reasons: [], accountRole: tx ? profile?.role || 'unknown' : 'missing', gross: null, personal: null, components: part };
      if (!tx) p.reasons.push('source-missing');
      else {
        const impact = financial.impacts[key];
        if (!impact || !Number.isSafeInteger(impact.personalExpenseCents)) fail('SPENDING_INVARIANT');
        p.personal = impact.personalExpenseCents;
        if (tx.type !== 'expense') p.reasons.push('not-expense');
        if (tx.type === 'transfer') p.reasons.push('native-transfer');
        if (!profile) p.reasons.push('account-role-unknown');
        else if (profile.role !== 'cash') p.reasons.push(profile.role + '-account');
        if (impact.transferPairId) p.reasons.push('paired-transfer');
        if (impact.excluded || impact.primaryId) p.reasons.push('duplicate-shadow');
        if (impact.compositeId) p.reasons.push('composite-member');
        if (heldSources.has(key) || impact.heldFundingCents > 0) p.reasons.push('held-source');
        p.status = p.reasons.length ? 'ineligible' : 'available';
        if (p.status === 'available') {
          if (!impact.fundingAuthority || !impact.personalAuthority || impact.cashExpenseCents !== tx.amountCents) fail('SPENDING_INVARIANT', '记录付款金额与正式财务模型不一致');
          p.gross = tx.amountCents;
          if (part.duplicates.length + part.refunds.length + part.claims.length > 200) { p.status = 'unsupported'; p.reasons.push('proof-limit'); }
          else {
            p.proof = core().normalizeProof({ version: 1, source: p.transaction, role: 'cash-primary-payment', cashProfile: p.profile, duplicateEvidence: part.duplicates, refunds: part.refunds, claims: part.claims, grossPaymentCents: tx.amountCents });
            p.key = core().basisKey(p.proof);
          }
        }
        if (tx.date > asOfDate) p.reasons.push('future-at-cutoff');
      }
      p.reasons = sorted(p.reasons); probes.set(key, p); return p;
    }
    const paymentViews = new Map(), byPlan = new Map(), bySource = new Map();
    for (const payment of extension.payments) {
      const p = probe(payment.transactionId), reasons = p.reasons.slice();
      let applicability;
      if (!p.transaction) applicability = 'source-missing';
      else {
        const sourceChanged = !equal(payment.proof.source, p.transaction);
        const roleChanged = p.status === 'ineligible' || !equal(payment.proof.cashProfile, p.profile) || p.proof && payment.proof.role !== p.proof.role;
        const basisChanged = !!p.proof && ['duplicateEvidence', 'refunds', 'claims'].some(field => !equal(payment.proof[field], p.proof[field]));
        if (sourceChanged) reasons.push('source-changed');
        if (roleChanged) reasons.push('role-changed');
        if (basisChanged) reasons.push('basis-changed');
        if (p.status === 'unsupported') reasons.push('unsupported-basis');
        applicability = sourceChanged ? 'source-changed' : roleChanged ? 'role-changed' : p.status === 'unsupported' ? 'unsupported-basis' : p.key !== core().basisKey(payment.proof) ? 'basis-changed' : p.transaction.date > asOfDate ? 'future-at-cutoff' : 'applicable';
        if (applicability === 'basis-changed') reasons.push('basis-changed');
      }
      const pv = { paymentId: payment.id, planId: payment.planId, transactionId: payment.transactionId, capturedAmountCents: payment.amountCents, capturedEconomicDate: payment.proof.source.date, reviewedAsOfDate: payment.reviewedAsOfDate, applicability, reasonCodes: sorted(reasons) };
      paymentViews.set(payment.id, pv);
      if (!byPlan.has(payment.planId)) byPlan.set(payment.planId, []); byPlan.get(payment.planId).push(pv);
      if (!bySource.has(payment.transactionId)) bySource.set(payment.transactionId, []); bySource.get(payment.transactionId).push(pv);
    }
    for (const values of [...byPlan.values(), ...bySource.values()]) order(values, 'paymentId');
    const lastConfirmation = new Map(), createdBy = new Map();
    for (const operation of extension.audit) {
      for (const change of operation.changes) {
        if (change.kind === 'payment' && change.before === null) createdBy.set(change.recordId, operation.id);
        if (change.kind === 'plan' && change.after?.remainingConfirmation && operation.action !== 'update-plan' && operation.action !== 'cancel-plan') lastConfirmation.set(change.recordId, { confirmation: change.after.remainingConfirmation, operationId: operation.id, revision: operation.revision });
      }
    }
    const planViews = new Map();
    for (const plan of extension.plans) {
      const rows = byPlan.get(plan.id) || [], paymentIds = rows.map(row => row.paymentId), unresolved = rows.filter(row => row.applicability !== 'applicable');
      const known = sum(rows.filter(row => row.applicability === 'applicable').map(row => row.capturedAmountCents)), unresolvedAmount = sum(unresolved.map(row => row.capturedAmountCents));
      const confirmation = plan.remainingConfirmation;
      const remainingStatus = unresolved.length ? 'payments-unresolved' : confirmation === null ? 'unknown' : !equal(confirmation.paymentIds, paymentIds) ? 'link-set-changed' : confirmation.reviewedAsOfDate > asOfDate ? 'review-after-cutoff' : 'confirmed';
      const remainingCents = remainingStatus === 'confirmed' ? confirmation.amountCents : null, grossPaidCents = unresolved.length ? null : known;
      const expectedAccountStatus = plan.expectedAccountId === null ? 'unspecified' : accounts.has(plan.expectedAccountId) ? 'known' : 'missing';
      const warnings = rows.flatMap(row => row.reasonCodes);
      if (expectedAccountStatus === 'missing') warnings.push('expected-account-missing');
      if (plan.targetAmountCents === null) warnings.push('target-unknown');
      if (remainingStatus === 'unknown') warnings.push('remaining-unknown');
      if (remainingStatus === 'link-set-changed') warnings.push('remaining-link-set-changed');
      if (remainingStatus === 'review-after-cutoff') warnings.push('remaining-review-after-cutoff');
      planViews.set(plan.id, { plan, paymentIds, knownApplicablePaymentCents: known, unresolvedCapturedPaymentCents: unresolvedAmount, unresolvedPaymentIds: unresolved.map(row => row.paymentId), grossPaidCents, remainingCents, remainingStatus, lastConfirmedRemaining: lastConfirmation.get(plan.id) || null,
        plannedContributionCents: plan.status === 'cancelled' || plan.stage !== 'planned' ? 0 : remainingCents,
        committedContributionCents: plan.status === 'cancelled' || plan.stage !== 'committed' ? 0 : remainingCents,
        futureExclusionReason: plan.status === 'cancelled' ? 'cancelled-exclusion' : null,
        referenceDifferenceCents: grossPaidCents === null || remainingCents === null || plan.targetAmountCents === null ? null : sum([grossPaidCents, remainingCents, -plan.targetAmountCents]),
        expectedAccountStatus, dateStatus: plan.expectedDate === null ? 'undated' : plan.expectedDate <= asOfDate ? 'due' : 'future',
        progress: grossPaidCents === null || remainingCents === null ? 'needs-review' : remainingCents === 0 ? 'confirmed-no-remainder' : grossPaidCents > 0 ? 'partially-paid' : 'no-linked-payment', warnings: sorted(warnings) });
    }
    function layer(field, knownField) {
      const rows = [...planViews.values()], unresolvedPlanIds = sorted(rows.filter(row => row[field] === null).map(row => row.plan.id));
      const knownCents = sum(rows.map(row => knownField ? row[knownField] : row[field] === null ? 0 : row[field]));
      return { knownCents, completeCents: unresolvedPlanIds.length ? null : knownCents, unresolvedPlanIds };
    }
    const view = { version: 1, asOfDate, knowledgeBasis: 'current-state-not-historical-knowledge', plans: order([...planViews.values()].map(row => ({ ...row, id: row.plan.id }))).map(({ id: unused, ...row }) => row), payments: order([...paymentViews.values()], 'paymentId'), totals: { planned: layer('plannedContributionCents'), committed: layer('committedContributionCents'), grossPaid: layer('grossPaidCents', 'knownApplicablePaymentCents') }, warnings: sorted([...planViews.values()].flatMap(row => row.warnings)) };
    const sourceDetails = new Map();
    function sourceDetail(key) {
      if (sourceDetails.has(key)) return sourceDetails.get(key);
      const p = probe(key), usages = bySource.get(key) || [], applicable = usages.filter(row => row.applicability === 'applicable'), unresolved = usages.filter(row => row.applicability !== 'applicable');
      const applicableAttributedCents = sum(applicable.map(row => row.capturedAmountCents)), unresolvedCapturedCents = sum(unresolved.map(row => row.capturedAmountCents));
      const eligibleAtCutoff = p.status === 'available' && p.transaction.date <= asOfDate;
      const sourceCapacityCents = eligibleAtCutoff ? sum([p.gross, -applicableAttributedCents]) : null;
      if (sourceCapacityCents !== null && sourceCapacityCents < 0) fail('SPENDING_INVARIANT', '有效归属超过记录付款金额');
      const usage = rows => rows.map(row => ({ paymentId: row.paymentId, planId: row.planId, amountCents: row.capturedAmountCents }));
      const detail = { transactionId: key, asOfDate, currentSource: p.transaction, accountRole: p.accountRole, basisStatus: p.status, eligibleAtCutoff, reasonCodes: p.reasons, grossPaymentCents: p.gross, currentPersonalExpenseCents: p.personal, personalExpenseBasis: 'all-current-relations-restated-purchase',
        refundAllCurrentCents: sum(p.components.refunds.map(row => row.amountCents)), refundRecordedByCutoffCents: sum(p.components.refunds.filter(row => row.incomeSignature.date <= asOfDate).map(row => row.amountCents)), refundFutureRecordedCents: sum(p.components.refunds.filter(row => row.incomeSignature.date > asOfDate).map(row => row.amountCents)), claimAllCurrentCents: sum(p.components.claims.map(row => row.amountCents)),
        componentCounts: { duplicates: p.components.duplicates.length, refunds: p.components.refunds.length, claims: p.components.claims.length }, applicableAttributedCents, unresolvedCapturedCents, unresolvedPaymentIds: unresolved.map(row => row.paymentId), sourceCapacityCents, allocatableCents: unresolved.length ? null : sourceCapacityCents,
        currentProof: p.proof, components: p.components, applicablePayments: usage(applicable), unresolvedPayments: usage(unresolved) };
      sourceDetails.set(key, detail); return detail;
    }
    // Validate current applicable capacity once per linked source, including sources outside a requested page.
    for (const key of bySource.keys()) sourceDetail(key);
    return { state, asOfDate, extension, financial, transactions, plans, payments, accounts, paymentViews, planViews, byPlan, bySource, createdBy, probe, sourceDetail, view };
  }
  function normalizeQuery(raw) {
    raw = snapshot(raw);
    if (!raw || !['allocate-payment', 'reconfirm-payment'].includes(raw.action)) fail('SPENDING_INVALID_QUERY');
    shape(raw, raw.action === 'allocate-payment' ? ['action', 'planId', 'transactionId', 'asOfDate'] : ['action', 'paymentId', 'asOfDate'], 'SPENDING_INVALID_QUERY');
    return raw.action === 'allocate-payment' ? { action: raw.action, planId: id(raw.planId, 'SPENDING_INVALID_QUERY'), transactionId: id(raw.transactionId, 'SPENDING_INVALID_QUERY'), asOfDate: date(raw.asOfDate, 'SPENDING_INVALID_QUERY') } : { action: raw.action, paymentId: id(raw.paymentId, 'SPENDING_INVALID_QUERY'), asOfDate: date(raw.asOfDate, 'SPENDING_INVALID_QUERY') };
  }
  function eligibilityPrepared(p, query) {
    const reconfirm = query.action === 'reconfirm-payment', payment = reconfirm ? p.payments.get(query.paymentId) : null;
    const plan = p.plans.get(reconfirm ? payment?.planId : query.planId);
    const result = { version: 1, query, eligible: false, reasonCodes: [], sourceCapacityCents: null, maxAdditionalCents: null, amountToReconfirmCents: null, targetAmountCents: null, targetIsAllocationCap: false };
    if (reconfirm && !payment || !reconfirm && !plan) { result.reasonCodes = [reconfirm ? 'payment-not-found' : 'plan-not-found']; return result; }
    if (!plan) fail('SPENDING_INVARIANT');
    const source = p.sourceDetail(reconfirm ? payment.transactionId : query.transactionId), reasons = source.reasonCodes.slice();
    result.sourceCapacityCents = source.sourceCapacityCents; result.targetAmountCents = plan.targetAmountCents;
    if (reconfirm) {
      result.amountToReconfirmCents = payment.amountCents;
      if (p.paymentViews.get(payment.id).applicability === 'applicable') reasons.push('reconfirm-unnecessary');
      if (source.sourceCapacityCents !== null && payment.amountCents > source.sourceCapacityCents) reasons.push('source-capacity-exceeded');
    } else {
      if (plan.status === 'cancelled') reasons.push('plan-cancelled');
      if (plan.stage !== 'committed') reasons.push('plan-not-committed');
      if (p.planViews.get(plan.id).unresolvedPaymentIds.length) reasons.push('plan-has-unresolved-payments');
      if (source.unresolvedPaymentIds.length) reasons.push('source-has-unresolved-payments');
      if (source.sourceCapacityCents === 0) reasons.push('no-source-capacity');
    }
    result.reasonCodes = sorted(reasons); result.eligible = !reasons.length;
    if (!reconfirm && result.eligible) result.maxAdditionalCents = source.sourceCapacityCents;
    return result;
  }
  function command(raw) {
    raw = snapshot(raw);
    if (!raw || !Object.hasOwn(GRAMMAR, raw.action)) fail('SPENDING_INVALID_COMMAND');
    shape(raw, GRAMMAR[raw.action], 'SPENDING_INVALID_COMMAND'); const out = copy(raw);
    for (const key of ['planId', 'paymentId', 'transactionId']) if (Object.hasOwn(out, key)) id(out[key], 'SPENDING_INVALID_COMMAND');
    if (Object.hasOwn(out, 'remainingAfterCents') && out.remainingAfterCents !== null) amount(out.remainingAfterCents, true);
    if (out.action === 'create-plan') {
      shape(out.plan, PLAN_FIELDS, 'SPENDING_INVALID_COMMAND');
      const normalized = core().normalizePlan({ id: 'preview-plan', createdAt: '2000-01-01T00:00:00.000Z', ...out.plan, stage: 'planned', status: 'open', commitmentBasis: '', remainingConfirmation: null });
      out.plan = Object.fromEntries(PLAN_FIELDS.map(key => [key, normalized[key]]));
    }
    if (out.action === 'update-plan') {
      shape(out.patch, PLAN_FIELDS, 'SPENDING_INVALID_COMMAND', true);
      const normalized = core().normalizePlan({ id: 'preview-plan', createdAt: '2000-01-01T00:00:00.000Z', name: 'Preview', targetAmountCents: null, expectedDate: null, expectedAccountId: null, note: '', ...out.patch, stage: 'planned', status: 'open', commitmentBasis: '', remainingConfirmation: null });
      out.patch = Object.fromEntries(Object.keys(out.patch).map(key => [key, normalized[key]]));
    }
    if (out.action === 'allocate-payment') { amount(out.amountCents); text(out.reference); }
    if (out.action === 'commit-plan') out.commitmentBasis = core().normalizeReason(out.commitmentBasis);
    return out;
  }
  const queryFor = (cmd, asOfDate) => cmd.action === 'allocate-payment' ? { action: cmd.action, planId: cmd.planId, transactionId: cmd.transactionId, asOfDate } : { action: cmd.action, paymentId: cmd.paymentId, asOfDate };
  function utf8Bytes(value) { let n = 0; for (let i = 0; i < value.length; i++) { const c = value.charCodeAt(i); if (c < 128) n++; else if (c < 2048) n += 2; else if (c >= 0xd800 && c <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { n += 4; i++; } else n += 3; } return n; }
  function buildCandidate(before, cmd, opt, at, reason, fixedIds) {
    const state = before.state, data = copy(before.extension), reserved = new Set(ledger().collectRetainedIdentities(state).map(row => row.id));
    const ids = [], entities = [], changes = [], revision = data.revision + 1; let counter = 0, fixedIndex = 0;
    function fresh(kind) {
      let value;
      if (fixedIds) { value = fixedIds[fixedIndex++]; if (!value || reserved.has(value)) fail('SPENDING_STALE_PREVIEW'); }
      else { let attempts = reserved.size + 1; do { if (!attempts--) fail('SPENDING_INVARIANT'); value = 'spending-' + kind + '-' + revision + '-' + (++counter); } while (reserved.has(value)); }
      reserved.add(value); ids.push(value); return value;
    }
    const eventId = fresh('event');
    let plan = cmd.planId ? before.plans.get(cmd.planId) : null, oldPayment = cmd.paymentId ? before.payments.get(cmd.paymentId) : null;
    if (cmd.paymentId) { if (!oldPayment) fail('payment-not-found'); plan = before.plans.get(oldPayment.planId); }
    if (cmd.action !== 'create-plan' && !plan) fail('plan-not-found');
    const oldPlan = plan || null; let eligibility = null;
    function removePayment(row) {
      const reverses = before.createdBy.get(row.id); if (!reverses) fail('SPENDING_INVARIANT');
      data.payments = data.payments.filter(value => value.id !== row.id); changes.push({ kind: 'payment', recordId: row.id, before: copy(row), after: null, reverses });
    }
    if (cmd.action === 'create-plan') {
      if (cmd.plan.expectedAccountId !== null && !before.accounts.has(cmd.plan.expectedAccountId)) fail('expected-account-not-found');
      plan = { id: fresh('plan'), createdAt: at, ...cmd.plan, stage: 'planned', status: 'open', commitmentBasis: '', remainingConfirmation: null }; entities.push(plan.id);
    } else {
      plan = copy(plan);
      const count = (before.byPlan.get(plan.id) || []).length;
      if (cmd.action === 'update-plan') {
        if (Object.hasOwn(cmd.patch, 'expectedAccountId') && cmd.patch.expectedAccountId !== null && cmd.patch.expectedAccountId !== plan.expectedAccountId && !before.accounts.has(cmd.patch.expectedAccountId)) fail('expected-account-not-found');
        plan = { ...plan, ...cmd.patch };
      } else if (cmd.action === 'commit-plan') {
        if (plan.status !== 'open') fail('plan-not-open'); if (plan.stage !== 'planned') fail('plan-not-planned'); if (count) fail('plan-has-payments');
        plan.stage = 'committed'; plan.commitmentBasis = cmd.commitmentBasis;
      } else if (cmd.action === 'cancel-plan') { if (plan.status !== 'open') fail('plan-not-open'); plan.status = 'cancelled'; }
      else if (cmd.action === 'reopen-plan') { if (plan.status !== 'cancelled') fail('plan-not-cancelled'); plan.status = 'open'; }
      else if (cmd.action === 'return-to-plan' || cmd.action === 'retire-plan') {
        if (plan.status !== 'cancelled') fail('plan-not-cancelled'); if (count) fail('plan-has-payments');
        if (cmd.action === 'retire-plan') plan = null;
        else { plan.status = 'open'; plan.stage = 'planned'; plan.commitmentBasis = ''; }
      } else if (cmd.action === 'confirm-remaining') { if (plan.status !== 'open') fail('plan-not-open'); }
      else if (cmd.action === 'reverse-payment') removePayment(oldPayment);
      else {
        eligibility = eligibilityPrepared(before, queryFor(cmd, opt.asOfDate));
        if (!eligibility.eligible) fail(eligibility.reasonCodes[0], '此付款归属当前不能确认：' + eligibility.reasonCodes.join('、'));
        if (cmd.action === 'allocate-payment' && cmd.amountCents > eligibility.maxAdditionalCents) fail('allocation-capacity-exceeded');
        const source = before.probe(oldPayment ? oldPayment.transactionId : cmd.transactionId);
        if (oldPayment) removePayment(oldPayment);
        const payment = { id: fresh('payment'), createdAt: at, reviewedAsOfDate: opt.asOfDate, planId: plan.id, transactionId: source.transaction.id, amountCents: oldPayment ? oldPayment.amountCents : cmd.amountCents, proof: copy(source.proof), reference: oldPayment ? oldPayment.reference : cmd.reference };
        entities.push(payment.id); data.payments.push(payment); changes.push({ kind: 'payment', recordId: payment.id, before: null, after: copy(payment), reverses: null });
      }
    }
    const targetId = (plan || oldPlan).id;
    if (Object.hasOwn(cmd, 'remainingAfterCents')) {
      const survivors = data.payments.filter(row => row.planId === targetId);
      if (cmd.remainingAfterCents !== null && survivors.some(row => before.paymentViews.has(row.id) && before.paymentViews.get(row.id).applicability !== 'applicable')) fail('remaining-requires-applicable-payments');
      plan.remainingConfirmation = cmd.remainingAfterCents === null ? null : { amountCents: cmd.remainingAfterCents, reviewedAsOfDate: opt.asOfDate, paymentIds: sorted(survivors.map(row => row.id)) };
    }
    if (plan) plan = core().normalizePlan(plan);
    if (oldPlan && plan && equal(oldPlan, plan) && !(changes.length && plan.remainingConfirmation === null)) fail('plan-no-op');
    data.plans = data.plans.filter(row => row.id !== targetId); if (plan) data.plans.push(copy(plan));
    changes.push({ kind: 'plan', recordId: targetId, before: oldPlan ? copy(oldPlan) : null, after: plan ? copy(plan) : null, reverses: null });
    const operation = { id: eventId, revision, at, asOfDate: opt.asOfDate, action: cmd.action, reason, changes };
    data.revision = revision; data.audit.push(operation);
    if (fixedIds && fixedIndex !== fixedIds.length) fail('SPENDING_STALE_PREVIEW');
    const candidate = validateState({ ...state, version: 8, spendingPlanning: data });
    // Pretty exported envelopes have a separate budget from compact canonical state.
    if (utf8Bytes(JSON.stringify({ format: 'moneygo-backup', version: 8, exportedAt: at, data: candidate }, null, 2)) > LEDGER_BYTES) fail('SPENDING_LIMIT', '完整备份超过大小限制');
    return { candidate, ids, entities, eventId, targetId, eligibility };
  }
  function financialDeltas(before, after) {
    const strip = state => Object.fromEntries(Object.entries(state).filter(([key]) => key !== 'version' && key !== 'spendingPlanning'));
    if (!equal(strip(before.state), strip(after.state))) fail('SPENDING_FINANCIAL_MUTATION');
    const a = before.financial, b = after.financial;
    const result = { scope: 'all-recorded-dates-current-financial-model', ordinaryIncomeCents: sum([b.personal.incomeCents, -a.personal.incomeCents]), personalExpenseCents: sum([b.personal.expenseCents, -a.personal.expenseCents]), cashInCents: sum([b.cash.incomeCents, -a.cash.incomeCents]), cashOutCents: sum([b.cash.expenseCents, -a.cash.expenseCents]), accounts: [] };
    function flows(p) {
      const map = new Map(p.state.accounts.map(row => [row.id, { inflow: 0, outflow: 0 }]));
      for (const row of p.financial.drilldown.accountFlows) for (const movement of row.movements) {
        const value = map.get(movement.accountId); if (!value) fail('SPENDING_INVARIANT');
        if (movement.signedCents > 0) value.inflow = sum([value.inflow, movement.signedCents]); else value.outflow = sum([value.outflow, -movement.signedCents]);
      }
      return map;
    }
    const left = flows(before), right = flows(after);
    for (const key of sorted(before.state.accounts.map(row => row.id))) result.accounts.push({ accountId: key, inflowCents: sum([right.get(key).inflow, -left.get(key).inflow]), outflowCents: sum([right.get(key).outflow, -left.get(key).outflow]), balanceCents: sum([b.accountBalances[key], -a.accountBalances[key]]) });
    if (['ordinaryIncomeCents', 'personalExpenseCents', 'cashInCents', 'cashOutCents'].some(key => result[key] !== 0) || result.accounts.some(row => row.inflowCents !== 0 || row.outflowCents !== 0 || row.balanceCents !== 0)) fail('SPENDING_FINANCIAL_MUTATION');
    return result;
  }
  function match(plan, source) {
    if (!plan) return null;
    return { date: plan.expectedDate === null ? 'expected-unspecified' : !source ? 'source-unavailable' : plan.expectedDate === source.date ? 'same' : 'different', account: plan.expectedAccountId === null ? 'expected-unspecified' : !source ? 'source-unavailable' : plan.expectedAccountId === source.accountId ? 'same' : 'different' };
  }
  function review(before, after, built, cmd, opt, previewAt) {
    const key = built.targetId, a = before.planViews.get(key) || null, b = after.planViews.get(key) || null;
    if (!equal(before.view.plans.filter(row => row.plan.id !== key), after.view.plans.filter(row => row.plan.id !== key))) fail('SPENDING_UNRELATED_MUTATION');
    const paymentIds = sorted((before.byPlan.get(key) || []).concat(after.byPlan.get(key) || []).map(row => row.paymentId));
    const payments = paymentIds.map(paymentId => {
      const payment = before.payments.get(paymentId) || after.payments.get(paymentId), current = before.probe(payment.transactionId);
      const differentFields = current.proof ? PROOF_FIELDS.filter(field => !equal(payment.proof[field], current.proof[field])) : [];
      return { payment, before: before.paymentViews.get(paymentId) || null, after: after.paymentViews.get(paymentId) || null, capturedMatchBefore: match(a?.plan, payment.proof.source), capturedMatchAfter: match(b?.plan, payment.proof.source), currentMatchBefore: match(a?.plan, current.transaction), currentMatchAfter: match(b?.plan, current.transaction), proofComparison: { result: !current.proof ? 'unavailable' : differentFields.length ? 'different' : 'equal', differentFields } };
    });
    const sourceIds = sorted(payments.map(row => row.payment.transactionId).concat(cmd.action === 'allocate-payment' ? [cmd.transactionId] : []));
    const submissionRequired = Object.hasOwn(cmd, 'remainingAfterCents'); let suggestionStatus = submissionRequired ? 'explicit-review-required' : 'not-applicable', suggestedCents = null;
    if (cmd.action === 'allocate-payment') {
      const source = before.sourceDetail(cmd.transactionId);
      if (source.componentCounts.refunds || source.componentCounts.claims) suggestionStatus = 'refund-or-claim-context';
      else if (a.remainingCents === null) suggestionStatus = 'unknown-previous-remaining';
      else if (a.remainingCents < cmd.amountCents) suggestionStatus = 'negative-result';
      else { suggestionStatus = 'simple-subtraction'; suggestedCents = sum([a.remainingCents, -cmd.amountCents]); }
    }
    return { version: 1, command: cmd, options: opt, confirmationStamp: { status: 'pending-confirmation', previewAt, reason: null }, operation: after.extension.audit[after.extension.audit.length - 1], plan: { planId: key, before: a, after: b }, payments, sources: sourceIds.map(transactionId => ({ transactionId, before: before.sourceDetail(transactionId), after: after.sourceDetail(transactionId) })), operationEligibility: built.eligibility, layerImpacts: { before: before.view.totals, after: after.view.totals },
      remainingDecision: { before: a?.remainingCents ?? null, after: b?.remainingCents ?? null, submitted: submissionRequired ? cmd.remainingAfterCents : null, submissionRequired, suggestedCents, suggestionStatus },
      targetComparison: { beforeTargetCents: a?.plan.targetAmountCents ?? null, afterTargetCents: b?.plan.targetAmountCents ?? null, beforeDifferenceCents: a?.referenceDifferenceCents ?? null, afterDifferenceCents: b?.referenceDifferenceCents ?? null },
      financialDeltas: financialDeltas(before, after), unchangedSubtrees: { basis: 'normalized-persisted-full-ledger', allowedChangedPaths: ['version', 'spendingPlanning'], allOtherSubtreesEqual: true } };
  }
  function maskCandidate(raw, meta) {
    const value = copy(raw), entities = new Set(meta.entities);
    function record(row) { if (row && entities.has(row.id)) row.createdAt = meta.previewAt; }
    value.spendingPlanning.plans.forEach(record); value.spendingPlanning.payments.forEach(record);
    const operation = value.spendingPlanning.audit.find(row => row.id === meta.eventId);
    operation.at = meta.previewAt; operation.reason = PREVIEW_REASON;
    for (const change of operation.changes) { record(change.before); record(change.after); }
    return value;
  }
  function maskReview(raw, meta) {
    const value = copy(raw), entities = new Set(meta.entities);
    function record(row) { if (row && entities.has(row.id)) row.createdAt = meta.previewAt; }
    value.operation.at = meta.previewAt; value.operation.reason = PREVIEW_REASON;
    for (const change of value.operation.changes) { record(change.before); record(change.after); }
    if (value.plan.before) record(value.plan.before.plan); if (value.plan.after) record(value.plan.after.plan);
    value.payments.forEach(row => record(row.payment));
    return value;
  }
  function createCoordinator(capabilities) {
    if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) fail('SPENDING_INVALID_CAPABILITIES');
    let now, today;
    try {
      core().inspectData(Object.create(Object.getPrototypeOf(capabilities)));
      const keys = Reflect.ownKeys(capabilities), descriptors = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(capabilities, key)]));
      if (keys.length !== 2 || !keys.includes('now') || !keys.includes('today') || keys.some(key => { const d = descriptors.get(key); return !d || !d.enumerable || !Object.hasOwn(d, 'value') || typeof d.value !== 'function'; })) fail('SPENDING_INVALID_CAPABILITIES');
      now = descriptors.get('now').value; today = descriptors.get('today').value;
    } catch (error) { fail('SPENDING_INVALID_CAPABILITIES'); }
    const tickets = new WeakMap(); let generation = 0;
    function preview(raw, rawCommand, rawOptions) {
      const state = validateState(raw), cmd = command(rawCommand), opt = options(rawOptions);
      if (opt.asOfDate > date(today(), 'SPENDING_INVALID_CAPABILITIES')) fail('cutoff-in-future');
      const previewAt = timestamp(now()), before = prepare(state, opt.asOfDate);
      const built = buildCandidate(before, cmd, opt, previewAt, PREVIEW_REASON), after = prepare(built.candidate, opt.asOfDate);
      const ticket = expose({ review: review(before, after, built, cmd, opt, previewAt) });
      tickets.set(ticket, { ids: built.ids, entities: built.entities, eventId: built.eventId, cmd, opt, previewAt, generation, basis: canonical(state), candidateSignature: canonical(built.candidate), reviewSignature: canonical(ticket.review) });
      return ticket;
    }
    function commit(raw, ticket, confirmation) {
      const meta = tickets.get(ticket); if (meta) tickets.delete(ticket);
      if (!meta || meta.generation !== generation) fail('SPENDING_TICKET_INVALID', '复核已失效，请重新预览');
      const state = validateState(raw);
      confirmation = snapshot(confirmation);
      shape(confirmation, ['confirmed', 'reason'], 'SPENDING_CONFIRMATION_REQUIRED');
      if (confirmation.confirmed !== true) fail('SPENDING_CONFIRMATION_REQUIRED');
      const reason = core().normalizeReason(confirmation.reason);
      if (canonical(state) !== meta.basis) fail('SPENDING_STALE_PREVIEW', '账本已改变，请重新预览');
      if (meta.opt.asOfDate > date(today(), 'SPENDING_INVALID_CAPABILITIES')) fail('cutoff-in-future');
      const at = timestamp(now()), before = prepare(state, meta.opt.asOfDate);
      const built = buildCandidate(before, meta.cmd, meta.opt, at, reason, meta.ids), after = prepare(built.candidate, meta.opt.asOfDate);
      if (canonical(maskCandidate(built.candidate, meta)) !== meta.candidateSignature) fail('SPENDING_STALE_PREVIEW');
      const recomputed = review(before, after, built, meta.cmd, meta.opt, meta.previewAt);
      // Actual confirmation reason/timestamps must fit the public result budget too.
      expose({ review: recomputed });
      if (canonical(maskReview(recomputed, meta)) !== meta.reviewSignature) fail('SPENDING_STALE_PREVIEW');
      return freeze(copy(built.candidate));
    }
    function cancel(ticket) { const meta = tickets.get(ticket); if (!meta) return false; tickets.delete(ticket); return meta.generation === generation; }
    function invalidateAll() { generation++; }
    return Object.freeze({ preview, commit, cancel, invalidateAll });
  }
  function view(raw, rawOptions) { const state = validateState(raw), opt = options(rawOptions); return expose(prepare(state, opt.asOfDate).view); }
  function source(raw, rawOptions) { const state = validateState(raw), opt = options(rawOptions, ['asOfDate', 'transactionId']); return expose(prepare(state, opt.asOfDate).sourceDetail(id(opt.transactionId, 'SPENDING_INVALID_OPTIONS'))); }
  function sources(raw, rawOptions) {
    const state = validateState(raw), opt = options(rawOptions, ['asOfDate', 'offset', 'limit', 'accountId']);
    const { offset, limit, accountId } = opt;
    if (!Number.isInteger(offset) || Object.is(offset, -0) || offset < 0 || offset > 11000 || !Number.isInteger(limit) || limit < 1 || limit > 100) fail('SPENDING_INVALID_OPTIONS');
    if (accountId !== null && (!state.accounts.some(row => row.id === id(accountId, 'SPENDING_INVALID_OPTIONS')))) fail('SPENDING_INVALID_OPTIONS');
    const prepared = prepare(state, opt.asOfDate), live = state.transactions.filter(row => accountId === null || row.accountId === accountId).slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(row => row.id);
    const missing = accountId === null ? sorted(prepared.extension.payments.filter(row => !prepared.transactions.has(row.transactionId)).map(row => row.transactionId)) : [];
    const ids = live.concat(missing), totalCount = ids.length;
    if (totalCount > 11000) fail('SPENDING_INVARIANT');
    const rows = ids.slice(offset, offset + limit).map(key => { const { currentProof, components, applicablePayments, unresolvedPayments, ...summary } = prepared.sourceDetail(key); return summary; });
    return expose({ version: 1, asOfDate: opt.asOfDate, totalCount, offset, limit, nextOffset: offset + limit < totalCount ? Math.min(offset + limit, totalCount) : null, rows });
  }
  function eligibility(raw, rawQuery) { const state = validateState(raw), query = normalizeQuery(rawQuery); return expose(eligibilityPrepared(prepare(state, query.asOfDate), query)); }
  function validateExtension(raw) { return core().validateExtension(raw); }
  return Object.freeze({ validateExtension, view, sources, source, eligibility, createCoordinator });
}));
