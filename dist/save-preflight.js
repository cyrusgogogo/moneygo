/* Ordinary-save recoverability check. Pure, synchronous, and storage-neutral. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoneygoSavePreflight = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const messages = Object.freeze({
    SAVE_PREFLIGHT_UNAVAILABLE: '保存前的完整备份检查暂不可用；本次修改未保存。可到「数据备份」下载原始恢复数据或恢复有效备份。',
    SAVE_PREFLIGHT_INVALID_CANDIDATE: '本次修改未通过完整数据检查，未保存。可到「数据备份」下载原始恢复数据或恢复有效备份。',
    SAVE_BACKUP_CAPACITY: '本次修改超过支持的完整备份容量，未保存。可到「数据备份」下载原始恢复数据，或恢复较小的有效备份；不会自动删减历史。',
    SAVE_PREFLIGHT_NORMALIZATION_CHANGED: '保存前重复校验的数据不一致，本次修改未保存。可到「数据备份」下载原始恢复数据或恢复有效备份。',
    SAVE_PREFLIGHT_ROUND_TRIP_FAILED: '本次修改未通过完整备份试恢复检查，未保存。可到「数据备份」下载原始恢复数据或恢复有效备份。',
    SAVE_PREFLIGHT_ROUND_TRIP_MISMATCH: '完整备份试恢复后的数据不一致，本次修改未保存。原始恢复数据仍可在「数据备份」下载，也可恢复有效备份。'
  });
  function sourceCode(cause) {
    try {
      if (cause === null || typeof cause !== 'object' && typeof cause !== 'function') return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(cause, 'code');
      if (descriptor && own(descriptor, 'value') && typeof descriptor.value === 'string' && /^[A-Z][A-Z0-9_]{0,99}$/.test(descriptor.value)) return descriptor.value;
    } catch (_) { /* Exception inspection must never invoke a getter or escape. */ }
    return undefined;
  }
  function failure(code, phase, cause) {
    const error = new Error(messages[code]);
    Object.defineProperties(error, {
      name: { value: 'SavePreflightError', configurable: true, writable: true },
      code: { value: code, enumerable: true },
      phase: { value: phase, enumerable: true }
    });
    if (arguments.length > 2) {
      Object.defineProperty(error, 'cause', { value: cause, configurable: true });
      const originalCode = sourceCode(cause);
      if (originalCode !== undefined) Object.defineProperty(error, 'sourceCode', { value: originalCode, enumerable: true });
    }
    return error;
  }
  function invalid() { throw new TypeError('Expected complete ordinary data'); }
  function nativePrototype(prototype, name) {
    if (!prototype) invalid();
    const constructor = Object.getOwnPropertyDescriptor(prototype, 'constructor');
    if (!constructor || !own(constructor, 'value') || typeof constructor.value !== 'function' ||
        Function.prototype.toString.call(constructor.value) !== 'function ' + name + '() { [native code] }') invalid();
    const descriptor = Object.getOwnPropertyDescriptor(constructor.value, 'prototype');
    if (!descriptor || !own(descriptor, 'value') || descriptor.value !== prototype) invalid();
  }
  function ordinary(value, array) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === null) { if (array) invalid(); return; }
    nativePrototype(prototype, array ? 'Array' : 'Object');
    const parent = Object.getPrototypeOf(prototype);
    if (array) {
      nativePrototype(parent, 'Object');
      if (Object.getPrototypeOf(parent) !== null) invalid();
    } else if (parent !== null) invalid();
    // JSON.stringify consults inherited toJSON before looking at data fields.
    // Reject that hook descriptor-safely rather than ever invoking it.
    for (let current = prototype; current !== null; current = Object.getPrototypeOf(current)) {
      if (Object.getOwnPropertyDescriptor(current, 'toJSON')) invalid();
    }
  }
  function scalar(value, allowUndefined) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') {
      if (!Number.isFinite(value) || !allowUndefined && Object.is(value, -0)) invalid();
      return true;
    }
    if (value === undefined && allowUndefined) return true;
    if (typeof value !== 'object') invalid();
    return false;
  }
  // Iterative descriptor traversal has no arbitrary row, node, or depth cap.
  // A path set rejects cycles while permitting ordinary shared input subtrees.
  function inspect(value, allowUndefined, detach) {
    const active = new WeakSet();
    const stack = [{ value, parent: null, key: null, exit: false }];
    let result;
    while (stack.length) {
      const frame = stack.pop(), current = frame.value;
      if (frame.exit) { active.delete(current); continue; }
      const primitive = scalar(current, allowUndefined);
      let output = current;
      if (!primitive) {
        if (active.has(current)) invalid();
        const array = Array.isArray(current);
        ordinary(current, array);
        const keys = Reflect.ownKeys(current), fields = [];
        let length;
        for (const key of keys) {
          const descriptor = Object.getOwnPropertyDescriptor(current, key);
          if (typeof key !== 'string' || !descriptor || !own(descriptor, 'value')) invalid();
          if (array && key === 'length') {
            if (descriptor.enumerable || !Number.isInteger(descriptor.value) || descriptor.value < 0) invalid();
            length = descriptor.value;
          } else {
            if (!descriptor.enumerable) invalid();
            fields.push([key, descriptor.value]);
          }
        }
        if (array) {
          if (length === undefined || fields.length !== length) invalid();
          for (let i = 0; i < fields.length; i++) if (fields[i][0] !== String(i)) invalid();
        }
        if (detach) output = array ? [] : Object.create(Object.getPrototypeOf(current) === null ? null : Object.prototype);
        active.add(current);
        stack.push({ value: current, exit: true });
        for (let i = fields.length - 1; i >= 0; i--) stack.push({ value: fields[i][1], parent: output, key: fields[i][0], exit: false });
      }
      if (detach) {
        if (frame.parent === null) result = output;
        else Object.defineProperty(frame.parent, frame.key, { value: output, enumerable: true, configurable: true, writable: true });
      }
    }
    return detach ? result : value;
  }
  function freezeTree(value) {
    const stack = [value];
    while (stack.length) {
      const current = stack.pop();
      if (current === null || typeof current !== 'object') continue;
      for (const key of Object.keys(current)) stack.push(Object.getOwnPropertyDescriptor(current, key).value);
      Object.freeze(current);
    }
    return value;
  }
  // Inputs were inspected, but use own descriptors again so comparison cannot
  // coerce values, read accessors, or confuse an absent field with null.
  function equal(left, right) {
    const stack = [[left, right]];
    while (stack.length) {
      const pair = stack.pop(), a = pair[0], b = pair[1];
      if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
        if (!Object.is(a, b)) return false;
        continue;
      }
      if (Array.isArray(a) !== Array.isArray(b)) return false;
      const keys = Object.keys(a), otherKeys = Object.keys(b);
      if (keys.length !== otherKeys.length) return false;
      for (const key of keys) {
        const x = Object.getOwnPropertyDescriptor(a, key), y = Object.getOwnPropertyDescriptor(b, key);
        if (!x || !y || !x.enumerable || !y.enumerable || !own(x, 'value') || !own(y, 'value')) return false;
        stack.push([x.value, y.value]);
      }
    }
    return true;
  }
  function prepare(inputState, ledger) {
    let validate, backup, parse;
    try {
      if (ledger === null || typeof ledger !== 'object' && typeof ledger !== 'function') invalid();
      const methods = ['validateState', 'backup', 'parseBackup'].map(key => {
        const descriptor = Object.getOwnPropertyDescriptor(ledger, key);
        if (!descriptor || !own(descriptor, 'value') || typeof descriptor.value !== 'function') invalid();
        return descriptor.value;
      });
      [validate, backup, parse] = methods;
    } catch (cause) { throw failure('SAVE_PREFLIGHT_UNAVAILABLE', 'capability', cause); }
    try { inspect(inputState, true, false); }
    catch (cause) { throw failure('SAVE_PREFLIGHT_INVALID_CANDIDATE', 'input', cause); }
    let selected;
    try { selected = Reflect.apply(validate, ledger, [inputState]); }
    catch (cause) { throw failure(sourceCode(cause) === 'BACKUP_TOO_LARGE' ? 'SAVE_BACKUP_CAPACITY' : 'SAVE_PREFLIGHT_INVALID_CANDIDATE', 'normalize', cause); }
    let state, compactRaw;
    try {
      state = inspect(selected, false, true);
      selected = null;
      compactRaw = JSON.stringify(state);
      freezeTree(state);
    } catch (cause) { throw failure('SAVE_PREFLIGHT_INVALID_CANDIDATE', 'normalize', cause); }
    try {
      let repeated = Reflect.apply(validate, ledger, [state]);
      inspect(repeated, false, false);
      if (!equal(state, repeated) || JSON.stringify(repeated) !== compactRaw) invalid();
      repeated = null;
    } catch (cause) { throw failure('SAVE_PREFLIGHT_NORMALIZATION_CHANGED', 'fixed-point', cause); }
    let backupText;
    try {
      backupText = Reflect.apply(backup, ledger, [state]);
      if (typeof backupText !== 'string') invalid();
    } catch (cause) { throw failure(sourceCode(cause) === 'BACKUP_TOO_LARGE' ? 'SAVE_BACKUP_CAPACITY' : 'SAVE_PREFLIGHT_ROUND_TRIP_FAILED', 'backup', cause); }
    let restored;
    try {
      restored = Reflect.apply(parse, ledger, [backupText]);
      backupText = null;
      inspect(restored, false, false);
    } catch (cause) { throw failure('SAVE_PREFLIGHT_ROUND_TRIP_FAILED', 'parse', cause); }
    let matches;
    try { matches = equal(state, restored); }
    catch (cause) { throw failure('SAVE_PREFLIGHT_ROUND_TRIP_FAILED', 'parse', cause); }
    restored = null;
    if (!matches) throw failure('SAVE_PREFLIGHT_ROUND_TRIP_MISMATCH', 'compare');
    return Object.freeze({ state, compactRaw });
  }
  return Object.freeze({ prepare });
}));
