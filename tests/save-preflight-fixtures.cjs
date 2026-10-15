'use strict';
const assert = require('node:assert/strict');
const L = require('../dist/ledger.js'), P = require('../dist/save-preflight.js');
const clone = value => structuredClone(value);
const base = () => L.createEmpty();
const combined = () => require('./spending-boundary-combined-fixture.cjs').combined().state;
function nodes(value) {
  const found = new Set(), queue = [value];
  while (queue.length) {
    const item = queue.pop();
    if (item === null || typeof item !== 'object' || found.has(item)) continue;
    found.add(item);
    for (const key of Object.keys(item)) {
      const d = Object.getOwnPropertyDescriptor(item, key);
      assert.ok(d && Object.hasOwn(d, 'value'));
      queue.push(d.value);
    }
  }
  return found;
}
function assertDataEqual(actual, expected) {
  const queue = [[actual, expected]];
  while (queue.length) {
    const [a, b] = queue.pop();
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') { assert.ok(Object.is(a, b)); continue; }
    assert.equal(Array.isArray(a), Array.isArray(b));
    const ka = Reflect.ownKeys(a), kb = Reflect.ownKeys(b);
    assert.equal(ka.length, kb.length);
    for (const key of ka) {
      const x = Object.getOwnPropertyDescriptor(a, key), y = Object.getOwnPropertyDescriptor(b, key);
      assert.ok(x && y && Object.hasOwn(x, 'value') && Object.hasOwn(y, 'value'));
      assert.equal(x.enumerable, y.enumerable);
      queue.push([x.value, y.value]);
    }
  }
}
function freezeEvidence(value) { return { content: clone(value), nodes: [...nodes(value)].map(node => [node, Object.isFrozen(node)]) }; }
function assertPreserved(value, evidence) { assertDataEqual(value, evidence.content); for (const [node, frozen] of evidence.nodes) assert.equal(Object.isFrozen(node), frozen); }
function assertDetachedFrozen(output, input) {
  const original = nodes(input);
  for (const item of nodes(output)) { assert.ok(Object.isFrozen(item)); assert.equal(original.has(item), false, 'prepared graph owns all of its objects'); }
}
function forwardingLedger(overrides = {}) {
  const calls = [], ledger = {};
  for (const name of ['validateState', 'backup', 'parseBackup']) ledger[name] = function (...args) {
    assert.equal(this, ledger, 'required methods receive their supplied Ledger');
    const call = { name, args }; calls.push(call);
    try { call.out = (overrides[name] || L[name]).apply(this, args); return call.out; }
    catch (error) { call.error = error; throw error; }
  };
  return { ledger, calls };
}
module.exports = { L, P, base, combined, clone, assertDataEqual, freezeEvidence, assertPreserved, assertDetachedFrozen, forwardingLedger };
