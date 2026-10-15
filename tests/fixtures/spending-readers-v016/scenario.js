/* Moneygo's deterministic, local-only spending sandbox. All money is integer cents. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./ledger.js'), root);
  else root.MoneygoScenario = factory(root.MoneygoLedger, root);
}(typeof window !== 'undefined' ? window : globalThis, function (Ledger, root) {
  'use strict';

  const VERSION = 1;
  const EVENT_VERSION = 2;
  const LIMITS = Object.freeze({ scenarios: 3, adjustments: 200, oneOffs: 100, exclusions: 10000, completeMonths: 120 });
  const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

  class ScenarioError extends Error {
    constructor(code, message) {
      super(message);
      this.name = 'ScenarioError';
      this.code = code;
    }
  }
  function fail(code, message) { throw new ScenarioError(code, message); }
  function personalEngine() { if (typeof module === 'object' && module.exports) return require('./personal-events.js'); if (root.MoneygoPersonalEvents) return root.MoneygoPersonalEvents; fail('PERSONAL_EVENTS_UNAVAILABLE', '个人收支事件模块尚未加载'); }
  function record(value, fields, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.prototype.toString.call(value) !== '[object Object]') {
      fail('INVALID_DATA', label + '格式无效');
    }
    const keys = Reflect.ownKeys(value);
    if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key)) ||
        fields.some(key => !Object.prototype.hasOwnProperty.call(value, key))) {
      fail('INVALID_SCHEMA', label + '包含缺失或不支持的字段');
    }
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        fail('INVALID_SCHEMA', label + '字段必须是普通数据');
      }
    }
    return value;
  }
  function list(value, limit, label) {
    if (!Array.isArray(value)) fail('INVALID_DATA', label + '必须是数组');
    if (value.length > limit) fail('ROW_LIMIT', label + '数量超过上限');
    for (let i = 0; i < value.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(value, i)) fail('INVALID_DATA', label + '包含空记录');
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) fail('INVALID_SCHEMA', label + '必须是普通数据');
    }
    if (Reflect.ownKeys(value).length !== value.length + 1) fail('INVALID_SCHEMA', label + '包含不支持的字段');
    return value;
  }
  // V2 is a new strict data format. Do not broaden or change the historic V1
  // normalizer's accepted input/error behavior while checking this new format.
  const nativeSource = Function.call.bind(Function.prototype.toString);
  const ordinaryObjectKeys = Reflect.ownKeys(Object.prototype), ordinaryArrayKeys = Reflect.ownKeys(Array.prototype);
  function ordinaryPrototype(proto, name, keys) {
    if (!proto) return false;
    const constructor = Object.getOwnPropertyDescriptor(proto, 'constructor');
    if (!constructor || !Object.prototype.hasOwnProperty.call(constructor, 'value') || typeof constructor.value !== 'function') return false;
    const back = Object.getOwnPropertyDescriptor(constructor.value, 'prototype');
    const own = Reflect.ownKeys(proto);
    return !!back && Object.prototype.hasOwnProperty.call(back, 'value') && back.value === proto && nativeSource(constructor.value) === 'function ' + name + '() { [native code] }' && own.length === keys.length && own.every(key => keys.includes(key));
  }
  function plainTree(value) {
    const pending = [{ node: value }], ancestors = new Set(); let count = 0;
    while (pending.length) {
      const { node, exit } = pending.pop();
      if (!node || typeof node !== 'object') continue;
      if (exit) { ancestors.delete(node); continue; }
      if (ancestors.has(node) || ++count > 50000) fail('INVALID_SCHEMA', '模拟数据不能循环或超出结构上限');
      ancestors.add(node); pending.push({ node, exit: true });
      const prototype = Object.getPrototypeOf(node);
      if (Array.isArray(node)) {
        if (!ordinaryPrototype(prototype, 'Array', ordinaryArrayKeys)) fail('INVALID_SCHEMA', '排除事件数组必须是普通数组');
        list(node, 10000, '模拟数据');
      } else if (prototype !== null && (Object.getPrototypeOf(prototype) !== null || !ordinaryPrototype(prototype, 'Object', ordinaryObjectKeys))) fail('INVALID_SCHEMA', '模拟数据必须是普通记录');
      for (const key of Reflect.ownKeys(node)) {
        if (Array.isArray(node) && key === 'length') continue;
        const descriptor = Object.getOwnPropertyDescriptor(node, key);
        if (typeof key !== 'string' || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) fail('INVALID_SCHEMA', '模拟字段必须是普通数据');
        pending.push({ node: descriptor.value });
      }
    }
  }
  function identifier(value) {
    if (typeof value !== 'string' || value.length > Ledger.LIMITS.idLength ||
        !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) || value === 'constructor' || value === 'prototype') {
      fail('INVALID_ID', '方案或记录标识无效');
    }
    return value;
  }
  function name(value) {
    if (typeof value !== 'string' || value.length > Ledger.LIMITS.nameLength ||
        !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
      fail('INVALID_NAME', '名称须为 1–' + Ledger.LIMITS.nameLength + ' 个字符');
    }
    return value.trim();
  }
  function month(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value) || !Ledger.validDate(value + '-01')) {
      fail('INVALID_MONTH', '月份须为有效的 YYYY-MM');
    }
    return value;
  }
  function cents(value, zero) {
    if (!Number.isSafeInteger(value) || value < 0 || (!zero && value === 0) || value > Ledger.MAX_AMOUNT_CENTS) {
      fail('INVALID_AMOUNT', '金额须为非负整数分，且不超过 9,999,999,999.99 元；一次性支出须大于零');
    }
    return value === 0 ? 0 : value;
  }
  function unique(value, seen, label) {
    if (seen.has(value)) fail('DUPLICATE_ID', label + '不能重复');
    seen.add(value);
    return value;
  }
  function safe(value) {
    if (value < -MAX_SAFE || value > MAX_SAFE) fail('AMOUNT_OVERFLOW', '模拟累计金额过大，无法安全计算');
    return Number(value);
  }
  function add(left, right) { return safe(BigInt(left) + BigInt(right)); }
  // All operands are nonnegative. A half cent rounds up, never through floating point.
  function rounded(numerator, denominator) {
    return safe((numerator + denominator / 2n) / denominator);
  }
  function monthIndex(value) { return Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1; }
  function nextMonths(current) {
    const index = monthIndex(current);
    return [1, 2, 3].map(offset => {
      const year = Math.floor((index + offset) / 12);
      if (year > 9999) fail('INVALID_DATE_RANGE', '日期过晚，无法表示未来三个月');
      return String(year).padStart(4, '0') + '-' + String((index + offset) % 12 + 1).padStart(2, '0');
    });
  }

  function defaultSettings() {
    return {
      version: VERSION, completeMonths: [], exclusions: [],
      scenarios: [{ id: 'scenario-main', name: '我的方案', adjustments: [], oneOffs: [] }],
      activeId: 'scenario-main'
    };
  }

  /*
   * Strict structural validation returns a detached normalized copy. The optional
   * state argument is intentionally unused: references can become stale after a
   * category/transaction edit, and must survive backup, trash and undo unchanged.
   * calculate, not validation, reports and ignores those references. Never call
   * Ledger.validateState here: the ledger may validate its simulation extension
   * through this function. No validation or calculation occurs during module load.
   */
  function validate(input, state) { // eslint-disable-line no-unused-vars
    if (input && typeof input === 'object' && Object.getOwnPropertyDescriptor(input, 'version')?.value === EVENT_VERSION) plainTree(input);
    record(input, ['version', 'completeMonths', 'exclusions', 'scenarios', 'activeId'], '模拟设置');
    if (input.version !== VERSION && input.version !== EVENT_VERSION) fail('INVALID_VERSION', '不支持此模拟设置版本');
    const complete = new Set();
    const completeMonths = list(input.completeMonths, LIMITS.completeMonths, '已确认完整月份')
      .map(value => unique(month(value), complete, '完整月份'));
    const excluded = new Set();
    const exclusions = list(input.exclusions, LIMITS.exclusions, '排除交易')
      .map(value => {
        if (input.version === VERSION) return unique(identifier(value), excluded, '排除交易');
        record(value, ['kind', 'id'], '排除事件');
        if (value.kind !== 'transaction-expense' && value.kind !== 'held-recognition') fail('INVALID_EVENT_KIND', '不支持此排除事件类型');
        const key = { kind: value.kind, id: identifier(value.id) };
        unique(JSON.stringify([key.kind, key.id]), excluded, '排除事件');
        return key;
      });
    const ids = new Set();
    const scenarioIds = new Set();
    const scenarioRows = list(input.scenarios, LIMITS.scenarios, '方案');
    if (scenarioRows.length === 0) fail('LAST_SCENARIO', '至少需要保留一个方案');
    const scenarios = scenarioRows.map(value => {
      record(value, ['id', 'name', 'adjustments', 'oneOffs'], '方案');
      const id = unique(identifier(value.id), ids, '方案或一次性支出标识');
      scenarioIds.add(id);
      const categories = new Set();
      const adjustments = list(value.adjustments, LIMITS.adjustments, '分类调整').map(adjustment => {
        record(adjustment, ['categoryId', 'mode', 'value'], '分类调整');
        const categoryId = unique(identifier(adjustment.categoryId), categories, '调整分类');
        const mode = adjustment.mode;
        if (mode !== 'amount' && mode !== 'fixed' && mode !== 'percent') fail('INVALID_MODE', '分类调整方式无效');
        let amount;
        if (mode === 'percent') {
          if (!Number.isSafeInteger(adjustment.value) || adjustment.value < -100 || adjustment.value > 1000) {
            fail('INVALID_PERCENT', '调整百分比须为 -100 至 1000 的整数');
          }
          amount = adjustment.value === 0 ? 0 : adjustment.value;
        } else amount = cents(adjustment.value, true);
        return { categoryId, mode, value: amount };
      });
      const oneOffs = list(value.oneOffs, LIMITS.oneOffs, '一次性支出').map(oneOff => {
        record(oneOff, ['id', 'name', 'month', 'categoryId', 'amountCents'], '一次性支出');
        return {
          id: unique(identifier(oneOff.id), ids, '方案或一次性支出标识'), name: name(oneOff.name),
          month: month(oneOff.month), categoryId: identifier(oneOff.categoryId), amountCents: cents(oneOff.amountCents, false)
        };
      });
      return { id, name: name(value.name), adjustments, oneOffs };
    });
    const activeId = identifier(input.activeId);
    if (!scenarioIds.has(activeId)) fail('INVALID_REFERENCE', '当前方案不存在');
    return { version: input.version, completeMonths, exclusions, scenarios, activeId };
  }

  /*
   * calculate(state, settings, today) is pure and timezone-independent. today must
   * be a Gregorian YYYY-MM-DD. Future ledger rows are never treated as predictions.
   *
   * Return contract (all cents are safe integers or explicitly null):
   * - months: next three full calendar months; historyMonths: the latest <=6 past
   *   months that the user explicitly marked complete, oldest first. A confirmed
   *   month without transactions counts as zero. An unconfirmed month never does.
   * - baseline: { monthlyCents, totalCents, categories, months }. totalCents is for
   *   THREE months; category baselineCents is monthly. Monthly baseline is the sum
   *   of independently rounded category means, so visible categories reconcile.
   *   categories: {categoryId,name,baselineCents,historyTotalCents}; months contain
   *   {month,totalCents,categoryTotals:{[categoryId]:cents}} for historical context.
   * - scenarios: {id,name,monthlyRecurringCents,knownMonthlyRecurringCents,
   *   incomplete,categories,months,totalCents,knownTotalCents,deltaCents,warnings}.
   *   categories: {categoryId,name,baselineCents,monthlyCents,mode,value,incomplete}.
   *   months: {month,recurringCents,knownRecurringCents,oneOffCents,totalCents,
   *   knownTotalCents}. Unknown categories make overall totals/delta null, while
   *   known totals remain separately available. With no expense categories and no
   *   history, the result remains incomplete rather than implying a zero forecast.
   * - amount/fixed REPLACE a category's monthly amount, including explicit zero.
   *   fixed is not an additional bill. percent replaces it with rounded baseline
   *   * (100 + value) / 100. One-offs add only once to their specified future month.
   * - warnings: global and per-scenario plain metadata objects. Codes are
   *   NO_CONFIRMED_HISTORY, SHORT_HISTORY, OLD_HISTORY, IGNORED_COMPLETE_MONTHS,
   *   STALE_EXCLUSIONS, STALE_ADJUSTMENT, STALE_ONE_OFF_CATEGORY,
   *   ONE_OFF_OUTSIDE_FORECAST. Ignored one-offs can have two warnings if both
   *   category and date are stale. No source rows/settings are mutated or pruned.
   */
  function calculate(inputState, inputSettings, today) {
    if (!Ledger.validDate(today)) fail('INVALID_DATE', '今天须为有效的 YYYY-MM-DD');
    const currentMonth = today.slice(0, 7);
    const months = nextMonths(currentMonth);
    const state = Ledger.validateState(inputState);
    const settings = validate(inputSettings);
    return calculatePrepared(state, settings, today, () => Ledger.personalEvents(state).expenseEvents);
  }

  // Internal coordinator seam: both state/settings and the full personal stream
  // were validated in the fixed before/after pipeline. No upward replay occurs.
  function calculateHeldReview(validatedState, validatedSettings, asOfDate, personalEvents) {
    if (!Ledger.validDate(asOfDate)) fail('INVALID_DATE', '今天须为有效的 YYYY-MM-DD');
    return calculatePrepared(validatedState, validatedSettings, asOfDate, () => personalEvents.expenseEvents);
  }

  function calculatePrepared(state, settings, today, expenseEventRows) {
    const currentMonth = today.slice(0, 7);
    const months = nextMonths(currentMonth);
    const eligibleMonths = settings.completeMonths.filter(value => value < currentMonth).sort();
    const historyMonths = eligibleMonths.slice(-6);
    const historyMonthCount = historyMonths.length;
    const hasHistory = historyMonthCount > 0;
    const warnings = [];
    if (!hasHistory) warnings.push({ code: 'NO_CONFIRMED_HISTORY' });
    else {
      if (historyMonthCount < 3) warnings.push({ code: 'SHORT_HISTORY', count: historyMonthCount });
      const latestMonth = historyMonths[historyMonthCount - 1];
      if (monthIndex(latestMonth) < monthIndex(currentMonth) - 1) {
        warnings.push({ code: 'OLD_HISTORY', latestMonth, monthsSinceLatest: monthIndex(currentMonth) - monthIndex(latestMonth) });
      }
    }
    const selectedHistoryMonths = new Set(historyMonths);
    const ignoredCompleteMonths = settings.completeMonths.filter(value => !selectedHistoryMonths.has(value)).sort();
    if (ignoredCompleteMonths.length) warnings.push({ code: 'IGNORED_COMPLETE_MONTHS', months: ignoredCompleteMonths, count: ignoredCompleteMonths.length });
    // An expense changed to income/transfer is no longer an applicable exclusion.
    // Trashed expenses remain applicable so undo can restore their exclusion.
    const transactionIds = new Set([
      ...state.transactions.filter(value => value.type === 'expense').map(value => value.id),
      ...state.trash.filter(value => value.transaction.type === 'expense').map(value => value.id)
    ]);
    const activeRecognitionIds = new Set((state.bookkeeping?.heldRecognitions || []).map(row => row.id));
    const staleExclusions = settings.version === VERSION
      ? settings.exclusions.filter(id => !transactionIds.has(id))
      : settings.exclusions.filter(key => key.kind === 'transaction-expense' ? !transactionIds.has(key.id) : !activeRecognitionIds.has(key.id));
    if (staleExclusions.length) warnings.push(settings.version === VERSION
      ? { code: 'STALE_EXCLUSIONS', transactionIds: staleExclusions, count: staleExclusions.length }
      : { code: 'STALE_EXCLUSIONS', eventKeys: staleExclusions.map(key => ({ kind: key.kind, id: key.id })), count: staleExclusions.length });
    const eventEngine = personalEngine();
    const exclusions = new Set(settings.exclusions.map(key => eventEngine.keyOf(settings.version === VERSION ? { kind: 'transaction-expense', id: key } : key)));
    const categories = state.categories.filter(value => value.type === 'expense');
    const categoryIds = new Set(categories.map(value => value.id));
    const historyByMonth = new Map(historyMonths.map(value => [value, {
      month: value, totalCents: 0,
      categoryTotals: Object.fromEntries(categories.map(category => [category.id, 0]))
    }]));
    const expenseEvents = expenseEventRows();
    for (const event of expenseEvents) {
      if (exclusions.has(eventEngine.keyOf(event.key))) continue;
      const row = historyByMonth.get(event.effectiveDate.slice(0, 7));
      if (!row) continue;
      row.categoryTotals[event.categoryId] = add(row.categoryTotals[event.categoryId], event.amountCents);
      row.totalCents = add(row.totalCents, event.amountCents);
    }
    const historyRows = [...historyByMonth.values()];
    const baselineCategories = categories.map(category => {
      let historyTotalCents = null;
      let baselineCents = null;
      if (hasHistory) {
        historyTotalCents = historyRows.reduce((sum, row) => add(sum, row.categoryTotals[category.id]), 0);
        baselineCents = rounded(BigInt(historyTotalCents), BigInt(historyMonthCount));
      }
      return { categoryId: category.id, name: category.name, baselineCents, historyTotalCents };
    });
    const baselineMonthly = hasHistory ? baselineCategories.reduce((sum, category) => add(sum, category.baselineCents), 0) : null;
    const baseline = {
      monthlyCents: baselineMonthly,
      totalCents: baselineMonthly === null ? null : safe(BigInt(baselineMonthly) * 3n),
      categories: baselineCategories, months: historyRows
    };
    const scenarios = settings.scenarios.map(scenario => {
      const scenarioWarnings = [];
      const adjustments = new Map();
      for (const adjustment of scenario.adjustments) {
        if (!categoryIds.has(adjustment.categoryId)) {
          scenarioWarnings.push({ code: 'STALE_ADJUSTMENT', scenarioId: scenario.id, categoryId: adjustment.categoryId });
        } else adjustments.set(adjustment.categoryId, adjustment);
      }
      const scenarioCategories = baselineCategories.map(category => {
        const adjustment = adjustments.get(category.categoryId);
        const mode = adjustment ? adjustment.mode : 'baseline';
        const value = adjustment ? adjustment.value : null;
        let monthlyCents = category.baselineCents;
        if (mode === 'amount' || mode === 'fixed') monthlyCents = value;
        else if (mode === 'percent' && monthlyCents !== null) monthlyCents = rounded(BigInt(monthlyCents) * BigInt(100 + value), 100n);
        return { categoryId: category.categoryId, name: category.name, baselineCents: category.baselineCents,
          monthlyCents, mode, value, incomplete: monthlyCents === null };
      });
      const incomplete = (!hasHistory && scenarioCategories.length === 0) || scenarioCategories.some(category => category.incomplete);
      const knownMonthlyRecurringCents = scenarioCategories.reduce((sum, category) => add(sum, category.monthlyCents === null ? 0 : category.monthlyCents), 0);
      const monthlyRecurringCents = incomplete ? null : knownMonthlyRecurringCents;
      const oneOffTotals = new Map(months.map(value => [value, 0]));
      for (const oneOff of scenario.oneOffs) {
        const validCategory = categoryIds.has(oneOff.categoryId);
        const validMonth = oneOffTotals.has(oneOff.month);
        if (!validCategory) scenarioWarnings.push({ code: 'STALE_ONE_OFF_CATEGORY', scenarioId: scenario.id, oneOffId: oneOff.id, categoryId: oneOff.categoryId });
        if (!validMonth) scenarioWarnings.push({
          code: 'ONE_OFF_OUTSIDE_FORECAST', scenarioId: scenario.id, oneOffId: oneOff.id, month: oneOff.month,
          reason: oneOff.month < currentMonth ? 'past' : oneOff.month === currentMonth ? 'current' : 'future'
        });
        if (validCategory && validMonth) oneOffTotals.set(oneOff.month, add(oneOffTotals.get(oneOff.month), oneOff.amountCents));
      }
      const forecastMonths = months.map(value => {
        const oneOffCents = oneOffTotals.get(value);
        const knownTotalCents = add(knownMonthlyRecurringCents, oneOffCents);
        return { month: value, recurringCents: monthlyRecurringCents, knownRecurringCents: knownMonthlyRecurringCents,
          oneOffCents, totalCents: incomplete ? null : knownTotalCents, knownTotalCents };
      });
      const knownTotalCents = forecastMonths.reduce((sum, row) => add(sum, row.knownTotalCents), 0);
      const totalCents = incomplete ? null : knownTotalCents;
      const deltaCents = totalCents === null || baseline.totalCents === null ? null : safe(BigInt(totalCents) - BigInt(baseline.totalCents));
      return { id: scenario.id, name: scenario.name, monthlyRecurringCents, knownMonthlyRecurringCents, incomplete,
        categories: scenarioCategories, months: forecastMonths, totalCents, knownTotalCents, deltaCents, warnings: scenarioWarnings };
    });
    return { today, currentMonth, months, historyMonths, historyMonthCount, baseline, scenarios, activeId: settings.activeId, warnings };
  }

  return Object.freeze({ VERSION, EVENT_VERSION, LIMITS, ScenarioError, defaultSettings, validate, calculate, calculateHeldReview });
}));
