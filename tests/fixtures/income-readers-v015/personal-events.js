/* Pure derived legacy personal events. No persisted state or cash authority. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoneygoPersonalEvents = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const LIMITS = Object.freeze({ facts: 10000, events: 10000, transactionIds: 10000, idLength: 100, heldEvents: 5000, mixedEvents: 15000, eventKeys: 15000 });
  const MAX_AMOUNT_CENTS = 999999999999;
  const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER);
  const ownEvents = new WeakSet(), leafErrors = new WeakSet();
  const hasOwn = Function.call.bind(Object.prototype.hasOwnProperty);
  const nativeSource = Function.call.bind(Function.prototype.toString);
  const objectPrototypeKeys = Reflect.ownKeys(Object.prototype);
  const arrayPrototypeKeys = Reflect.ownKeys(Array.prototype);
  const FACT_FIELDS = ['transactionId', 'kind', 'effectiveDate', 'categoryId', 'accountId', 'rawAmountCents', 'personalAmountCents', 'excluded', 'primaryId', 'transferPairId', 'compositeId', 'personalAuthority', 'fundingAuthority'];
  const EVENT_FIELDS = ['key', 'effectiveDate', 'categoryId', 'amountCents', 'origin', 'attribution', 'route', 'excluded', 'suppression'];
  const KEY_FIELDS = ['kind', 'id'];
  const REFERENCE_FIELDS = ['kind', 'transactionId'];
  const ATTRIBUTION_FIELDS = ['kind', 'transactionId', 'accountId'];
  const QUERY_FIELDS = ['month', 'categoryId', 'transactionIds', 'accountId', 'positiveOnly', 'eventKeys', 'fundingAccountId'];

  class PersonalEventError extends Error {
    constructor(code, message) { super(message); this.name = 'PersonalEventError'; this.code = code; }
  }
  function fail(code, message) { const error = new PersonalEventError(code, message); leafErrors.add(error); throw error; }
  function invalid(message) { fail('INVALID_PERSONAL_EVENT', message); }

  // Inspect descriptors, never caller methods or properties that could be accessors.
  // Genuine ordinary prototypes from another realm are allowed; custom chains are not.
  function sameKeys(value, expected) {
    const keys = Reflect.ownKeys(value);
    return keys.length === expected.length && keys.every(key => expected.includes(key));
  }
  function nativePrototype(proto, name) {
    const constructor = Object.getOwnPropertyDescriptor(proto, 'constructor');
    if (!constructor || !hasOwn(constructor, 'value') || typeof constructor.value !== 'function') return false;
    const back = Object.getOwnPropertyDescriptor(constructor.value, 'prototype');
    return !!back && hasOwn(back, 'value') && back.value === proto && nativeSource(constructor.value) === 'function ' + name + '() { [native code] }';
  }
  function ordinaryObjectPrototype(proto) {
    return proto !== null && Object.getPrototypeOf(proto) === null && nativePrototype(proto, 'Object') && sameKeys(proto, objectPrototypeKeys);
  }
  function record(value, fields, optional, code) {
    const errorCode = code || 'INVALID_PERSONAL_EVENT';
    let keys, proto;
    try {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(errorCode, 'Expected an ordinary data record');
      proto = Object.getPrototypeOf(value);
      if (proto !== null && !ordinaryObjectPrototype(proto)) fail(errorCode, 'Inherited record fields are not allowed');
      keys = Reflect.ownKeys(value);
    } catch (error) {
      if (leafErrors.has(error)) throw error;
      fail(errorCode, 'Record cannot be inspected');
    }
    if ((!optional && keys.length !== fields.length) || keys.length > fields.length) fail(errorCode, 'Unexpected record fields');
    const result = Object.create(null);
    for (const key of keys) {
      if (typeof key !== 'string' || !fields.includes(key)) fail(errorCode, 'Unexpected record field');
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch (_) { fail(errorCode, 'Record cannot be inspected'); }
      if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) fail(errorCode, 'Fields must be enumerable own data');
      result[key] = descriptor.value;
    }
    if (!optional) for (const field of fields) if (!hasOwn(result, field)) fail(errorCode, 'Missing record field');
    return result;
  }
  function arrayValues(value, maximum, code) {
    const errorCode = code || 'INVALID_PERSONAL_EVENT';
    let length, proto, keys;
    try {
      if (!Array.isArray(value)) fail(errorCode, 'Expected an ordinary dense array');
      const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
      if (!descriptor || !hasOwn(descriptor, 'value')) fail(errorCode, 'Invalid array length');
      length = descriptor.value;
      if (!Number.isSafeInteger(length) || length < 0) fail(errorCode, 'Invalid array length');
      // Reject excessive lengths before copying or walking any index.
      if (length > maximum) fail('EVENT_LIMIT', 'Too many personal-event rows');
      proto = Object.getPrototypeOf(value);
      if (!proto || !Array.isArray(proto) || !nativePrototype(proto, 'Array') || !ordinaryObjectPrototype(Object.getPrototypeOf(proto)) || !sameKeys(proto, arrayPrototypeKeys)) fail(errorCode, 'Custom array prototypes are not allowed');
      keys = Reflect.ownKeys(value);
    } catch (error) {
      if (leafErrors.has(error)) throw error;
      fail(errorCode, 'Array cannot be inspected');
    }
    if (keys.length !== length + 1) fail(errorCode, 'Array has missing or custom fields');
    const result = [];
    for (let index = 0; index < length; index++) {
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, String(index)); } catch (_) { fail(errorCode, 'Array cannot be inspected'); }
      if (!descriptor || !descriptor.enumerable || !hasOwn(descriptor, 'value')) fail(errorCode, 'Array must contain dense own data');
      result.push(descriptor.value);
    }
    return result;
  }
  function validId(value) {
    return typeof value === 'string' && value.length <= LIMITS.idLength && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) && value !== 'constructor' && value !== 'prototype';
  }
  function id(value, code) { if (!validId(value)) fail(code || 'INVALID_ID', 'Invalid raw identifier'); return value; }
  function nullableId(value) { return value === null ? null : id(value); }
  function amount(value, minimum, maximum) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail('INVALID_AMOUNT', 'Invalid personal-event amount');
    return value === 0 ? 0 : value;
  }
  function boolean(value) { if (typeof value !== 'boolean') invalid('Expected a boolean'); return value; }
  function validMonth(value) {
    return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value.slice(0, 4) !== '0000';
  }
  function date(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !validMonth(value.slice(0, 7))) fail('INVALID_DATE', 'Invalid economic date');
    const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
    const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (day < 1 || day > days[month - 1]) fail('INVALID_DATE', 'Invalid economic day');
    return value;
  }
  function key(value) {
    const result = record(value, KEY_FIELDS);
    if (result.kind !== 'transaction-expense' && result.kind !== 'transaction-income' && result.kind !== 'held-recognition') invalid('Unknown personal-event kind');
    return { kind: result.kind, id: id(result.id) };
  }
  function encodedKey(value) { return JSON.stringify([value.kind, value.id]); }
  function keyOf(value) { return encodedKey(key(value)); }
  function createEvent(kind, transactionId, effectiveDate, categoryId, accountId, amountCents, excluded, suppression) {
    const result = Object.freeze({
      key: Object.freeze({ kind, id: transactionId }),
      effectiveDate,
      categoryId,
      amountCents,
      origin: Object.freeze({ kind: 'transaction', transactionId }),
      attribution: Object.freeze({ kind: 'transaction', transactionId, accountId }),
      route: Object.freeze({ kind: 'transaction', transactionId }),
      excluded,
      suppression
    });
    ownEvents.add(result);
    return result;
  }
  function projectLegacy(facts) {
    const rows = arrayValues(facts, LIMITS.facts), seen = new Set(), expenseEvents = [], incomeEvents = [];
    for (const value of rows) {
      const row = record(value, FACT_FIELDS);
      const transactionId = id(row.transactionId);
      if (seen.has(transactionId)) fail('DUPLICATE_ID', 'Repeated raw transaction identifier');
      seen.add(transactionId);
      if (row.kind !== 'expense' && row.kind !== 'income' && row.kind !== 'transfer') invalid('Unknown fact kind');
      const effectiveDate = date(row.effectiveDate), categoryId = nullableId(row.categoryId), accountId = id(row.accountId);
      const rawAmountCents = amount(row.rawAmountCents, 1, MAX_AMOUNT_CENTS);
      const personalAmountCents = amount(row.personalAmountCents, 0, rawAmountCents);
      const excluded = boolean(row.excluded), primaryId = nullableId(row.primaryId), transferPairId = nullableId(row.transferPairId);
      nullableId(row.compositeId); boolean(row.personalAuthority); boolean(row.fundingAuthority);
      if (excluded !== (primaryId !== null) || (excluded && primaryId === transactionId)) invalid('Invalid duplicate-evidence primary');
      if (row.kind === 'transfer' && (categoryId !== null || personalAmountCents !== 0)) invalid('Native transfers cannot have personal amounts or categories');
      if ((excluded || transferPairId !== null || (row.kind === 'expense' && !row.personalAuthority)) && personalAmountCents !== 0) invalid('Suppressed facts must have zero personal amount');
      if (row.kind === 'transfer') continue;
      const suppression = excluded ? 'duplicate-evidence' : transferPairId !== null ? 'transfer-leg' : row.kind === 'expense' && !row.personalAuthority ? 'composite-nonpersonal' : personalAmountCents === 0 ? 'fully-allocated' : null;
      const event = createEvent('transaction-' + row.kind, transactionId, effectiveDate, categoryId, accountId, personalAmountCents, excluded, suppression);
      (row.kind === 'expense' ? expenseEvents : incomeEvents).push(event);
    }
    return Object.freeze({ expenseEvents: Object.freeze(expenseEvents), incomeEvents: Object.freeze(incomeEvents) });
  }

  function heldMerchant(value) { if(value===null)return null;if(typeof value!=='string'||value.length>80||!value.trim()||/[\u0000-\u001f\u007f]/.test(value))invalid('Invalid held merchant');return value.trim(); }
  function createHeldEvent(row) {
    const result=Object.freeze({key:Object.freeze({kind:'held-recognition',id:row.recognitionId}),effectiveDate:row.effectiveDate,categoryId:row.categoryId,amountCents:row.amountCents,origin:Object.freeze({kind:'held-recognition',positionId:row.positionId,recognitionId:row.recognitionId}),attribution:Object.freeze({kind:'held-recognition',positionId:row.positionId,recognitionId:row.recognitionId,expenseId:row.expenseId,fundingAccountId:row.fundingAccountId,merchant:row.merchant}),route:Object.freeze({kind:'held-recognition',positionId:row.positionId,recognitionId:row.recognitionId}),excluded:false,suppression:null,recognitionKind:row.kind,cashEffectCents:0});ownEvents.add(result);return result;
  }
  function recognitionFact(value) {
    const row=record(value,['recognitionId','positionId','kind','amountCents','effectiveDate','categoryId','expenseId','fundingAccountId','merchant']);
    if(row.kind!=='use'&&row.kind!=='loss')invalid('Unknown recognition kind');
    return {recognitionId:id(row.recognitionId),positionId:id(row.positionId),kind:row.kind,amountCents:amount(row.amountCents,1,MAX_AMOUNT_CENTS),effectiveDate:date(row.effectiveDate),categoryId:id(row.categoryId),expenseId:id(row.expenseId),fundingAccountId:id(row.fundingAccountId),merchant:heldMerchant(row.merchant)};
  }
  function projectHeld(value) {
    const input=record(value,['rawFacts','recognitions']),raw=arrayValues(input.rawFacts,LIMITS.facts),held=arrayValues(input.recognitions,LIMITS.heldEvents),base=projectLegacy(raw),sources=new Map(raw.map(value=>{const row=record(value,FACT_FIELDS);return [row.transactionId,row];})),seen=new Set(sources.keys()),expenseEvents=base.expenseEvents.slice();
    for(const value of held){const row=recognitionFact(value);if(seen.has(row.recognitionId))fail('DUPLICATE_ID','Recognition and raw identifiers must be distinct');seen.add(row.recognitionId);const source=sources.get(row.expenseId);if(!source||source.kind!=='expense'||source.accountId!==row.fundingAccountId||source.excluded||source.transferPairId!==null||source.compositeId!==null||source.personalAuthority!==true||source.fundingAuthority!==true||source.effectiveDate>row.effectiveDate)invalid('Recognition funding correspondence is invalid');expenseEvents.push(createHeldEvent(row));}
    return Object.freeze({expenseEvents:Object.freeze(expenseEvents),incomeEvents:base.incomeEvents});
  }
  function heldEvent(row,eventKey) {
    if(Object.keys(row).length!==EVENT_FIELDS.length+2)invalid('Missing held event fields');
    const origin=record(row.origin,['kind','positionId','recognitionId']),route=record(row.route,['kind','positionId','recognitionId']),attribution=record(row.attribution,['kind','positionId','recognitionId','expenseId','fundingAccountId','merchant']);
    for(const ref of [origin,route,attribution])if(ref.kind!=='held-recognition'||id(ref.recognitionId)!==eventKey.id||id(ref.positionId)!==origin.positionId)invalid('Held references must agree');
    if(row.excluded!==false||row.suppression!==null||row.cashEffectCents!==0||Object.is(row.cashEffectCents,-0))invalid('Held recognition has no cash/suppression');
    return createHeldEvent(recognitionFact({recognitionId:eventKey.id,positionId:origin.positionId,kind:row.recognitionKind,amountCents:row.amountCents,effectiveDate:row.effectiveDate,categoryId:row.categoryId,expenseId:attribution.expenseId,fundingAccountId:attribution.fundingAccountId,merchant:attribution.merchant}));
  }
  function event(value) {
    // Only this closure's freshly constructed, deeply immutable objects may be shared.
    if (ownEvents.has(value)) return value;
    const row = record(value, EVENT_FIELDS.concat(['recognitionKind','cashEffectCents']), true), eventKey = key(row.key);
    if(eventKey.kind==='held-recognition')return heldEvent(row,eventKey);
    if(Object.keys(row).length!==EVENT_FIELDS.length||hasOwn(row,'recognitionKind')||hasOwn(row,'cashEffectCents'))invalid('Unexpected raw event fields');
    const effectiveDate = date(row.effectiveDate), categoryId = nullableId(row.categoryId);
    const amountCents = amount(row.amountCents, 0, MAX_AMOUNT_CENTS), excluded = boolean(row.excluded);
    const origin = record(row.origin, REFERENCE_FIELDS), attribution = record(row.attribution, ATTRIBUTION_FIELDS), route = record(row.route, REFERENCE_FIELDS);
    for (const reference of [origin, attribution, route]) {
      if (reference.kind !== 'transaction') invalid('Unknown personal-event reference kind');
      if (id(reference.transactionId) !== eventKey.id) invalid('Personal-event references must agree');
    }
    const accountId = id(attribution.accountId), suppression = row.suppression;
    if (suppression !== null && suppression !== 'duplicate-evidence' && suppression !== 'transfer-leg' && suppression !== 'composite-nonpersonal' && suppression !== 'fully-allocated') invalid('Unknown suppression');
    if ((suppression === 'duplicate-evidence') !== excluded || (suppression === null) !== (amountCents > 0) || (suppression === 'composite-nonpersonal' && eventKey.kind !== 'transaction-expense')) invalid('Inconsistent suppression');
    return createEvent(eventKey.kind, eventKey.id, effectiveDate, categoryId, accountId, amountCents, excluded, suppression);
  }
  function eventValues(events) {
    // Keep the legacy 10k rejection precedence for oversized non-mixed inputs.
    // Larger inputs qualify only via safe own-data typed keys; no getter is invoked.
    try { if(Array.isArray(events)){const length=Object.getOwnPropertyDescriptor(events,'length');if(length&&hasOwn(length,'value')&&Number.isSafeInteger(length.value)&&length.value>LIMITS.events){
      if(length.value>LIMITS.mixedEvents)fail('EVENT_LIMIT','Too many personal-event rows');
      let raw=0,held=0;for(let i=0;i<length.value;i++){const slot=Object.getOwnPropertyDescriptor(events,String(i));if(!slot||!hasOwn(slot,'value')||!slot.enumerable||!slot.value||typeof slot.value!=='object')fail('EVENT_LIMIT','Oversized legacy event list');const k=Object.getOwnPropertyDescriptor(slot.value,'key');if(!k||!hasOwn(k,'value')||!k.value||typeof k.value!=='object')fail('EVENT_LIMIT','Oversized legacy event list');const kind=Object.getOwnPropertyDescriptor(k.value,'kind');if(!kind||!hasOwn(kind,'value'))fail('EVENT_LIMIT','Oversized legacy event list');if(kind.value==='held-recognition')held++;else raw++;if(raw>LIMITS.events||held>LIMITS.heldEvents)fail('EVENT_LIMIT','Too many events in a stream');}
    }}}catch(e){if(leafErrors.has(e))throw e;invalid('Event array cannot be inspected');}

    const rows = arrayValues(events, LIMITS.mixedEvents), seen = new Set(), result = [];
    let rawCount=0,heldCount=0;
    for (const value of rows) {
      const current = event(value), identity = encodedKey(current.key);
      if (seen.has(identity)) fail('DUPLICATE_EVENT_KEY', 'Repeated typed personal-event key');
      seen.add(identity);
      if(current.key.kind==='held-recognition')heldCount++;else rawCount++;
      if(rawCount>LIMITS.events||heldCount>LIMITS.heldEvents)fail('EVENT_LIMIT','Too many events in a stream');
      result.push(current);
    }
    return result;
  }
  function queryValue(value) {
    const query = record(value === undefined ? {} : value, QUERY_FIELDS, true, 'INVALID_EVENT_QUERY');
    if (hasOwn(query, 'month') && !validMonth(query.month)) fail('INVALID_MONTH', 'Invalid personal-event month');
    for (const field of ['categoryId', 'accountId', 'fundingAccountId']) if (hasOwn(query, field)) id(query[field], 'INVALID_EVENT_QUERY');
    if (hasOwn(query, 'positiveOnly') && typeof query.positiveOnly !== 'boolean') fail('INVALID_EVENT_QUERY', 'positiveOnly must be boolean');
    if (hasOwn(query, 'transactionIds')) {
      const identifiers = arrayValues(query.transactionIds, LIMITS.transactionIds, 'INVALID_EVENT_QUERY'), selected = new Set();
      for (const identifier of identifiers) {
        id(identifier, 'INVALID_EVENT_QUERY');
        if (selected.has(identifier)) fail('INVALID_EVENT_QUERY', 'Repeated transaction filter identifier');
        selected.add(identifier);
      }
      query.transactionIds = selected;
    }
    if(hasOwn(query,'eventKeys')){const values=arrayValues(query.eventKeys,LIMITS.eventKeys,'INVALID_EVENT_QUERY'),selected=new Set();for(const value of values){const identity=keyOf(value);if(selected.has(identity))fail('INVALID_EVENT_QUERY','Repeated event filter key');selected.add(identity);}query.eventKeys=selected;}
    return query;
  }
  function select(events, query) {
    const filter = queryValue(query), rows = eventValues(events), result = [];
    // Validate every row and typed-key uniqueness before applying any predicate.
    for (const row of rows) {
      if (hasOwn(filter, 'month') && row.effectiveDate.slice(0, 7) !== filter.month) continue;
      if (hasOwn(filter, 'categoryId') && row.categoryId !== filter.categoryId) continue;
      if (hasOwn(filter, 'transactionIds') && (row.origin.kind !== 'transaction' || !filter.transactionIds.has(row.origin.transactionId))) continue;
      if (hasOwn(filter, 'accountId') && row.attribution.accountId !== filter.accountId) continue;
      if (hasOwn(filter, 'eventKeys') && !filter.eventKeys.has(encodedKey(row.key))) continue;
      if (hasOwn(filter, 'fundingAccountId') && (row.attribution.kind==='held-recognition'?row.attribution.fundingAccountId:row.attribution.accountId)!==filter.fundingAccountId) continue;
      if (filter.positiveOnly === true && row.amountCents <= 0) continue;
      result.push(row);
    }
    return Object.freeze(result);
  }
  function safe(value) {
    if (value < -MAX_SAFE_CENTS || value > MAX_SAFE_CENTS) fail('AMOUNT_OVERFLOW', 'Unsafe cumulative personal-event amount');
    return Number(value);
  }
  function reduce(events) {
    const rows = eventValues(events);
    let expense = 0n, income = 0n, expenseEventCount = 0, incomeEventCount = 0, positiveExpenseEventCount = 0, positiveIncomeEventCount = 0;
    for (const row of rows) {
      if (row.key.kind === 'transaction-expense' || row.key.kind === 'held-recognition') {
        expense += BigInt(row.amountCents); expenseEventCount++;
        if (row.amountCents > 0) positiveExpenseEventCount++;
      } else if(row.key.kind==='transaction-income') {
        income += BigInt(row.amountCents); incomeEventCount++;
        if (row.amountCents > 0) positiveIncomeEventCount++;
      }
    }
    // Independent gross checks must precede the signed-net conversion.
    const expenseCents = safe(expense), incomeCents = safe(income), netCents = safe(income - expense);
    return Object.freeze({ expenseCents, incomeCents, netCents, expenseEventCount, incomeEventCount, positiveExpenseEventCount, positiveIncomeEventCount });
  }

  return Object.freeze({ projectLegacy, projectHeld, select, reduce, keyOf, PersonalEventError, LIMITS });
}));
