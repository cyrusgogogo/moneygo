/* Internal schema adapter. Only Ledger establishes validity; this module never validates
 * or calls a model. Definitions and typed borrowed references are deliberately distinct. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoneygoRetainedIdentities = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const RELATIONS = { links: 'link', refunds: 'refund', claims: 'claim', settlements: 'settlement', snapshots: 'snapshot', refundPlans: 'refundPlan', transferPairs: 'transferPair', composites: 'composite', heldPositions: 'heldPosition', heldRecognitions: 'heldRecognition', heldReturns: 'heldReturn' };
  const OBLIGATIONS = { profiles: 'profile', statements: 'statement', contracts: 'contract', repayments: 'repayment', inclusions: 'inclusion', fees: 'fee' };
  const ORGANIZER = { rules: 'rule', aliases: 'alias', batches: 'batch', scopes: 'scope', closes: 'close' };
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  function collectNormalized(state) {
    const records = new Map();
    function add(id, namespace, kind, usage, path, parent) {
      if (id === null || id === undefined) return;
      const ownerKey = JSON.stringify(parent === undefined ? [namespace, kind, id] : [namespace, kind, parent, id]);
      const key = JSON.stringify([ownerKey, usage]);
      let row = records.get(key);
      if (!row) { row = { id, namespace, kind, ownerKey, usage, paths: new Set() }; records.set(key, row); }
      row.paths.add(path);
    }
    const ref = (id, namespace, kind, path, parent) => add(id, namespace, kind, 'reference', path, parent);
    const def = (id, namespace, kind, path, parent) => add(id, namespace, kind, 'definition', path, parent);
    function each(rows, path, fn) { (rows || []).forEach((row, i) => fn(row, path + '[' + i + ']')); }
    function signature(row, path, usage = 'reference') {
      if (!row) return;
      add(row.id, 'core', 'transaction', usage, path + '.id');
      ref(row.accountId, 'core', 'account', path + '.accountId');
      ref(row.toAccountId, 'core', 'account', path + '.toAccountId');
      ref(row.categoryId, 'core', 'category', path + '.categoryId');
    }
    function relation(kind, row, path, usage = 'definition') {
      if (!row) return;
      add(row.id, 'relations', kind, usage, path + '.id');
      for (const key of ['primaryId', 'shadowId', 'incomeId', 'expenseId']) ref(row[key], 'core', 'transaction', path + '.' + key);
      for (const key of ['primarySignature', 'shadowSignature', 'incomeSignature', 'expenseSignature']) signature(row[key], path + '.' + key);
      ref(row.accountId, 'core', 'account', path + '.accountId');
      ref(row.categoryId, 'core', 'category', path + '.categoryId');
      if (row.categoryProof) ref(row.categoryProof.id, 'core', 'category', path + '.categoryProof.id');
      ref(row.positionId, 'relations', 'heldPosition', path + '.positionId');
      ref(row.claimId, 'relations', 'claim', path + '.claimId');
      ref(row.planId, 'relations', 'refundPlan', path + '.planId');
      each(row.personalIds, path + '.personalIds', (id, p) => ref(id, 'core', 'transaction', p));
      each(row.fundingIds, path + '.fundingIds', (id, p) => ref(id, 'core', 'transaction', p));
      each(row.signatures, path + '.signatures', signature);
      if (row.basis) {
        each(row.basis.transactions, path + '.basis.transactions', signature);
        each(row.basis.excluded, path + '.basis.excluded', (x, p) => { ref(x.primaryId, 'core', 'transaction', p + '.primaryId'); ref(x.shadowId, 'core', 'transaction', p + '.shadowId'); });
        each(row.basis.composites, path + '.basis.composites', (x, p) => relation('composite', x, p, 'reference'));
      }
    }
    function importConfig(row, path) {
      if (!row) return;
      ref(row.accountId, 'core', 'account', path + '.accountId');
      for (const key of ['expense', 'income']) ref(row.categoryIds?.[key], 'core', 'category', path + '.categoryIds.' + key);
    }
    function importEvidence(row, path) {
      if (!row) return;
      def(row.id, 'imports', 'evidence', path + '.id');
      ref(row.accountId, 'core', 'account', path + '.accountId');
      ref(row.transactionId, 'core', 'transaction', path + '.transactionId');
      for (const key of ['firstBatchId', 'lastBatchId']) ref(row[key], 'imports', 'batch', path + '.' + key);
      signature(row.normalized, path + '.normalized'); signature(row.expectedTransaction, path + '.expectedTransaction');
    }
    function importBatch(row, path) {
      def(row.id, 'imports', 'batch', path + '.id');
      ref(row.accountId, 'core', 'account', path + '.accountId'); ref(row.templateId, 'imports', 'template', path + '.templateId');
      for (const [key, kind] of [['quarantineIds', 'quarantine'], ['coverageIds', 'coverage'], ['resolvedQuarantineIds', 'quarantine']]) each(row[key], path + '.' + key, (id, p) => ref(id, 'imports', kind, p));
      if (row.repair) { ref(row.repair.quarantineId, 'imports', 'quarantine', path + '.repair.quarantineId'); ref(row.repair.previousResolvedByBatchId, 'imports', 'batch', path + '.repair.previousResolvedByBatchId'); }
      each(row.changes, path + '.changes', (c, p) => {
        ref(c.evidenceId, 'imports', 'evidence', p + '.evidenceId');
        importEvidence(c.before, p + '.before'); importEvidence(c.after, p + '.after');
        signature(c.transactionBefore?.transaction, p + '.transactionBefore.transaction'); signature(c.transactionAfter?.transaction, p + '.transactionAfter.transaction');
      });
    }
    function obligation(kind, row, path, usage = 'definition') {
      if (!row) return;
      add(row.id, 'obligations', kind, usage, path + '.id');
      ref(row.accountId, 'core', 'account', path + '.accountId');
      ref(row.statementId, 'obligations', 'statement', path + '.statementId');
      ref(row.contractId, 'obligations', 'contract', path + '.contractId');
      ref(row.installmentId, 'obligations', 'installment', path + '.installmentId', row.contractId);
      each(row.schedule, path + '.schedule', (item, p) => add(item.id, 'obligations', 'installment', usage, p + '.id', row.id));
      ref(row.purchaseTransactionId, 'core', 'transaction', path + '.purchaseTransactionId');
      ref(row.transactionId, 'core', 'transaction', path + '.transactionId');
      signature(row.purchaseSignature, path + '.purchaseSignature'); signature(row.transactionSignature, path + '.transactionSignature');
      function source(value, p) {
        if (!value) return;
        ref(value.sourceId, value.sourceKind === 'native' ? 'core' : 'relations', value.sourceKind === 'native' ? 'transaction' : 'transferPair', p + '.sourceId');
        ref(value.fromAccountId, 'core', 'account', p + '.fromAccountId'); ref(value.toAccountId, 'core', 'account', p + '.toAccountId');
        each(value.legs, p + '.legs', signature);
      }
      if (kind === 'repayment') { source(row, path); source(row.sourceProof, path + '.sourceProof'); }
    }
    function eventKey(row, path) {
      if (!row) return;
      ref(row.id, row.kind === 'held-recognition' ? 'relations' : 'core', row.kind === 'held-recognition' ? 'heldRecognition' : 'transaction', path + '.id');
    }
    function event(row, path) {
      if (!row) return;
      eventKey(row.key, path + '.key'); ref(row.categoryId, 'core', 'category', path + '.categoryId');
      for (const key of ['origin', 'route', 'attribution']) {
        const r = row[key]; if (!r) continue;
        ref(r.transactionId, 'core', 'transaction', path + '.' + key + '.transactionId'); ref(r.expenseId, 'core', 'transaction', path + '.' + key + '.expenseId');
        ref(r.positionId, 'relations', 'heldPosition', path + '.' + key + '.positionId'); ref(r.recognitionId, 'relations', 'heldRecognition', path + '.' + key + '.recognitionId');
        ref(r.accountId, 'core', 'account', path + '.' + key + '.accountId'); ref(r.fundingAccountId, 'core', 'account', path + '.' + key + '.fundingAccountId');
      }
    }
    function closeScope(row, path) {
      if (!row) return;
      each(row.accounts, path + '.accounts', (x, p) => { ref(x.accountId, 'core', 'account', p + '.accountId'); ref(x.snapshotId, 'relations', 'snapshot', p + '.snapshotId'); });
      each(row.unknownAccounts, path + '.unknownAccounts', (id, p) => ref(id, 'core', 'account', p));
      each(row.sources, path + '.sources', (x, p) => { ref(x.accountId, 'core', 'account', p + '.accountId'); each(x.coverage, p + '.coverage', (c, cp) => ref(c.id, 'imports', 'coverage', cp + '.id')); each(x.blockers, p + '.blockers', (b, bp) => ref(b.id, 'imports', b.kind === 'quarantine' ? 'quarantine' : 'evidence', bp + '.id')); });
      each(row.blockers, path + '.blockers', (x, p) => ref(x.id, 'imports', x.kind === 'quarantine' ? 'quarantine' : 'evidence', p + '.id'));
    }
    function rawProof(row, path) {
      signature(row.transaction, path + '.transaction');
      each(row.sources, path + '.sources', (s, p) => ref(s.evidenceId, 'imports', 'evidence', p + '.evidenceId'));
      relation('transferPair', row.transferPair, path + '.transferPair', 'reference');
      ref(row.compositeId, 'relations', 'composite', path + '.compositeId');
    }
    function organizer(collection, row, path) {
      if (!row) return;
      const kind = ORGANIZER[collection]; if (kind) def(row.id, 'organizer', kind, path + '.id');
      if (collection === 'rules') { ref(row.conditions?.accountId, 'core', 'account', path + '.conditions.accountId'); ref(row.actions?.categoryId, 'core', 'category', path + '.actions.categoryId'); }
      if (collection === 'aliases' || collection === 'scopes') ref(row.accountId, 'core', 'account', path + '.accountId');
      if (collection === 'merchants') { ref(row.transactionId, 'core', 'transaction', path + '.transactionId'); ref(row.batchId, 'organizer', 'batch', path + '.batchId'); }
      // Review keys are opaque user-defined queue text, never entity definitions.
      if (collection === 'batches') {
        each(row.definitions, path + '.definitions', (x, p) => organizer(row.kind, x, p));
        each(row.changes, path + '.changes', (c, p) => {
          ref(c.transactionId, 'core', 'transaction', p + '.transactionId'); signature(c.before, p + '.before'); signature(c.after, p + '.after');
          organizer('merchants', c.merchantBefore, p + '.merchantBefore'); organizer('merchants', c.merchantAfter, p + '.merchantAfter');
          each(c.matches, p + '.matches', (id, p) => ref(id, 'organizer', ORGANIZER[row.kind], p)); ref(c.selectedRuleId, 'organizer', ORGANIZER[row.kind], p + '.selectedRuleId');
        });
      }
      if (collection === 'closes') {
        each(row.rows, path + '.rows', rawProof); each(row.rawProofs, path + '.rawProofs', rawProof);
        each(row.compositeProofs, path + '.compositeProofs', (x, p) => relation('composite', x, p, 'reference'));
        each(row.categories, path + '.categories', (x, p) => ref(x.id, 'core', 'category', p + '.id'));
        each(row.totals?.categories, path + '.totals.categories', (x, p) => ref(x.categoryId, 'core', 'category', p + '.categoryId'));
        closeScope(row.scope, path + '.scope');
        each(row.actualRows, path + '.actualRows', (x, p) => ref(x.transactionId, 'core', 'transaction', p + '.transactionId'));
        each(row.personalRows, path + '.personalRows', (x, p) => event(x.event, p + '.event'));
        each(row.manifest?.actualTransactionIds, path + '.manifest.actualTransactionIds', (id, p) => ref(id, 'core', 'transaction', p));
        each(row.manifest?.personalEventKeys, path + '.manifest.personalEventKeys', eventKey);
        for (const [key, kind] of [['positions', 'heldPosition'], ['recognitions', 'heldRecognition'], ['returns', 'heldReturn']]) each(row.heldProof?.[key], path + '.heldProof.' + key, (x, p) => relation(kind, x, p, 'reference'));
        each(row.rights?.positions, path + '.rights.positions', (x, p) => ref(x.positionId, 'relations', 'heldPosition', p + '.positionId'));
      }
    }
    function plan(row, path) { if (!row) return; def(row.id, 'incomePlanning', 'plan', path + '.id'); ref(row.expectedAccountId, 'core', 'account', path + '.expectedAccountId'); }
    function receipt(row, path) {
      if (!row) return;
      def(row.id, 'incomePlanning', 'receipt', path + '.id'); ref(row.planId, 'incomePlanning', 'plan', path + '.planId'); ref(row.transactionId, 'core', 'transaction', path + '.transactionId');
      const proof = row.proof; signature(proof.source, path + '.proof.source');
      each(proof.duplicateEvidence, path + '.proof.duplicateEvidence', (x, p) => { ref(x.id, 'relations', 'link', p + '.id'); for (const key of ['primaryId', 'shadowId']) ref(x[key], 'core', 'transaction', p + '.' + key); signature(x.primarySignature, p + '.primarySignature'); signature(x.shadowSignature, p + '.shadowSignature'); });
      each(proof.reductions, path + '.proof.reductions', (x, p) => { ref(x.id, 'relations', { refund: 'refund', settlement: 'settlement', 'held-return': 'heldReturn' }[x.kind], p + '.id'); signature(x.incomeSignature, p + '.incomeSignature'); });
    }
    each(state.accounts, '$.accounts', (x, p) => def(x.id, 'core', 'account', p + '.id'));
    each(state.categories, '$.categories', (x, p) => def(x.id, 'core', 'category', p + '.id'));
    each(state.transactions, '$.transactions', (x, p) => signature(x, p, 'definition'));
    each(state.trash, '$.trash', (x, p) => { def(x.id, 'core', 'transaction', p + '.id'); signature(x.transaction, p + '.transaction', 'definition'); });
    if (state.imports) {
      each(state.imports.templates, '$.imports.templates', (x, p) => { def(x.id, 'imports', 'template', p + '.id'); importConfig(x, p); importConfig(x.config, p + '.config'); });
      each(state.imports.evidence, '$.imports.evidence', importEvidence); each(state.imports.batches, '$.imports.batches', importBatch);
      for (const [key, kind] of [['quarantine', 'quarantine'], ['coverage', 'coverage'], ['audit', 'audit']]) each(state.imports[key], '$.imports.' + key, (x, p) => { def(x.id, 'imports', kind, p + '.id'); ref(x.batchId, 'imports', 'batch', p + '.batchId'); ref(x.accountId, 'core', 'account', p + '.accountId'); ref(x.resolvedByBatchId, 'imports', 'batch', p + '.resolvedByBatchId'); });
    }
    if (state.bookkeeping) {
      for (const [key, kind] of Object.entries(RELATIONS)) each(state.bookkeeping[key], '$.bookkeeping.' + key, (x, p) => relation(kind, x, p));
      each(state.bookkeeping.audit, '$.bookkeeping.audit', (x, p) => { def(x.id, 'relations', 'audit', p + '.id'); ref(x.recordId, 'relations', x.kind, p + '.recordId'); ref(x.reverses, 'relations', 'audit', p + '.reverses'); relation(x.kind, x.before, p + '.before'); relation(x.kind, x.after, p + '.after'); });
    }
    if (state.organizer) {
      for (const key of ['rules', 'aliases', 'merchants', 'batches', 'scopes', 'reviews', 'closes']) each(state.organizer[key], '$.organizer.' + key, (x, p) => organizer(key, x, p));
      each(state.organizer.audit, '$.organizer.audit', (x, p) => { def(x.id, 'organizer', 'audit', p + '.id'); each(x.changes, p + '.changes', (c, cp) => { if (ORGANIZER[c.collection]) ref(c.key, 'organizer', ORGANIZER[c.collection], cp + '.key'); else if (c.collection === 'merchants') ref(c.key, 'core', 'transaction', cp + '.key'); organizer(c.collection, c.before, cp + '.before'); organizer(c.collection, c.after, cp + '.after'); }); });
    }
    if (state.obligations) {
      for (const [key, kind] of Object.entries(OBLIGATIONS)) each(state.obligations[key], '$.obligations.' + key, (x, p) => obligation(kind, x, p));
      each(state.obligations.audit, '$.obligations.audit', (x, p) => { def(x.id, 'obligations', 'audit', p + '.id'); ref(x.recordId, 'obligations', x.kind, p + '.recordId'); ref(x.reverses, 'obligations', 'audit', p + '.reverses'); obligation(x.kind, x.before, p + '.before'); obligation(x.kind, x.after, p + '.after'); });
    }
    if (state.simulation) {
      ref(state.simulation.activeId, 'simulation', 'scenario', '$.simulation.activeId');
      each(state.simulation.exclusions, '$.simulation.exclusions', (x, p) => typeof x === 'string' ? ref(x, 'core', 'transaction', p) : eventKey(x, p));
      each(state.simulation.scenarios, '$.simulation.scenarios', (x, p) => { def(x.id, 'simulation', 'scenario', p + '.id'); each(x.adjustments, p + '.adjustments', (a, ap) => ref(a.categoryId, 'core', 'category', ap + '.categoryId')); each(x.oneOffs, p + '.oneOffs', (o, op) => { def(o.id, 'simulation', 'oneOff', op + '.id'); ref(o.categoryId, 'core', 'category', op + '.categoryId'); }); });
    }
    if (state.incomePlanning) {
      each(state.incomePlanning.plans, '$.incomePlanning.plans', plan); each(state.incomePlanning.receipts, '$.incomePlanning.receipts', receipt);
      each(state.incomePlanning.audit, '$.incomePlanning.audit', (x, p) => { def(x.id, 'incomePlanning', 'audit', p + '.id'); ref(x.recordId, 'incomePlanning', x.kind, p + '.recordId'); ref(x.reverses, 'incomePlanning', 'audit', p + '.reverses'); const visit = x.kind === 'plan' ? plan : receipt; visit(x.before, p + '.before'); visit(x.after, p + '.after'); });
    }
    return Object.freeze([...records.values()].sort((a, b) => compare(a.ownerKey, b.ownerKey) || compare(a.usage, b.usage)).map(row => Object.freeze({ ...row, paths: Object.freeze([...row.paths].sort(compare)) })));
  }
  return Object.freeze({ collectNormalized });
}));
