'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const UI = require('./personal-events-ui-helper.cjs'), F = require('./income-root-fixture.cjs');
function reservedState() {
  let state = F.L.createEmpty();
  const forced = 'plan-' + new Date('2026-11-02T12:00:00.000Z').getTime().toString(36) + '-i';
  state.accounts.push({ id: 'scenario-main', name: 'SYNTHETIC formerly expected account', openingBalanceCents: 0 }, { id: forced, name: 'SYNTHETIC second expected account', openingBalanceCents: 0 });
  const api = F.coordinator();
  for (const id of ['scenario-main', forced]) { const value = F.plan(api, state, 'SYNTHETIC retained expected account ' + id, { expectedAccountId: id }); state = value.state; state = F.L.removeAccount(state, id); }
  return { state, forced };
}
function missingSource() {
  let state = F.L.createEmpty();
  state.transactions.push({ id: 'income-host-source', type: 'income', amountCents: 10000, date: '2026-10-01', accountId: 'account-cash', categoryId: 'income-other', note: 'SYNTHETIC receipt' });
  state = F.L.validateState(state);
  const api = F.coordinator(), created = F.plan(api, state, 'SYNTHETIC host source correction', { expectedAmountCents: 10000 });
  state = F.run(api, created.state, { action: 'allocate-receipt', planId: created.id, transactionId: 'income-host-source', amountCents: 4000, reference: '' }).state;
  return F.L.deleteTransaction(state, 'income-host-source');
}

for (const mode of ['personal', 'synthetic']) {
  test(mode + ': sandbox default/reset and new generated one-off avoid retained planning identities', () => {
    const { state, forced } = reservedState(), app = UI.app(mode, state);
    const before = app.run('JSON.stringify(state.incomePlanning)'), saved = app.run('savedRaw');
    app.run("page='sandbox';render()");
    assert.equal(app.run('savedRaw'), saved, 'Read-only default does not upgrade or rewrite');
    assert.equal(app.run('state.simulation'), undefined);
    assert.equal(app.run("saveSimulation(s=>s.completeMonths=['2026-10'])"), true);
    const firstId = app.run('state.simulation.activeId');
    assert.notEqual(firstId, 'scenario-main');
    assert.equal(app.run('JSON.stringify(state.incomePlanning)'), before);
    app.run("Math.random=()=>0.5;saveSimulation((settings,generate)=>activeScenario(settings).oneOffs.push({id:generate('plan'),name:'SYNTHETIC generated cost',month:'2026-12',categoryId:'expense-other',amountCents:100}))");
    const oneOff = app.value('state.simulation.scenarios[0].oneOffs[0]');
    assert.notEqual(oneOff.id, forced);
    assert.equal(oneOff.id, forced + '-1');
    app.run("confirmScenarioAction('reset-sandbox')"); UI.click(app, '#confirm-scenario-action');
    assert.notEqual(app.run('state.simulation.activeId'), 'scenario-main');
    assert.notEqual(app.run('state.simulation.activeId'), firstId);
    assert.equal(app.run('JSON.stringify(state.incomePlanning)'), before);
    assert.equal(app.run('state.version'), 7);
    assert.deepEqual(app.counters.forbidden, []);
    if (mode === 'synthetic') { assert.equal(app.counters.localStorage, 0); assert.deepEqual(app.counters.personalIO, []); }
  });

  test(mode + ': v7 selected backup and restore preview show current and history counts with explicit cutoff', async () => {
    const app = UI.app(mode, missingSource()), raw = app.run('L.backup(state)'), before = app.run('savedRaw');
    const file = { name: 'SYNTHETIC-income-v7.json', size: Buffer.byteLength(raw), text: async () => raw };
    app.run('verifyBackupFile()');
    await app.node('#verify-backup-file').onchange({ target: { files: [file] } });
    const first = app.node('.income-backup-review').textContent;
    assert.match(first, /1 项当前计划.*0 项已取消.*0 项退役历史/);
    assert.match(first, /1 笔当前归属.*0 笔已撤销归属.*2 个审计操作/);
    assert.match(first, /2026-11-02 日终/);
    assert.match(first, /1 笔来源缺失/);
    assert.match(first, /不代表当时已知信息/);
    assert.equal(app.run('savedRaw'), before);
    const note = app.value("JSON.parse(storage.getItem('moneygo.backupVerification.note.v1'))");
    assert.deepEqual(Object.keys(note).sort(), ['backupVersion', 'completedAt', 'kind', 'verifierRevision', 'version']);
    assert.equal(note.backupVersion, 7);
    app.run('closeModal(true);showRestore()');
    await app.node('#restore-file').onchange({ target: { files: [file] } });
    assert.equal(app.node('.income-backup-review').textContent, first);
    assert.equal(app.node('#confirm-restore').disabled, true);
    assert.equal(app.run('savedRaw'), before);
    assert.equal(app.run('storage.getItem(ROLLBACK_KEY)'), null);
    if (mode === 'synthetic') assert.deepEqual(app.counters.personalIO, []);
  });

  test(mode + ': corrupted v7 file preview never replaces active memory, ledger or recovery copy', async () => {
    const app = UI.app(mode, missingSource()), before = app.run('JSON.stringify(state)'), rawBefore = app.run('savedRaw');
    const backup = JSON.parse(app.run('L.backup(state)')); backup.data.incomePlanning.receipts[0].proof.ordinaryIncomeCents++;
    const raw = JSON.stringify(backup), file = { name: 'SYNTHETIC-corrupt-v7.json', size: Buffer.byteLength(raw), text: async () => raw };
    app.run('showRestore()'); await app.node('#restore-file').onchange({ target: { files: [file] } });
    assert.equal(app.node('#form-error').hidden, false);
    assert.equal(app.node('#restore-preview').innerHTML, '');
    assert.equal(app.run('JSON.stringify(state)'), before);
    assert.equal(app.run('savedRaw'), rawBefore);
    assert.equal(app.run('storage.getItem(ROLLBACK_KEY)'), null);
    if (mode === 'synthetic') assert.deepEqual(app.counters.personalIO, []);
  });
}
