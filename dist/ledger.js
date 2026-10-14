/* Moneygo's local-only ledger. Integer cents are the sole monetary unit. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoneygoLedger = api;
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const VERSION = 1;
  const SIMULATION_VERSION = 2;
  const STORAGE_KEY = 'moneygo.ledger.v1';
  const MAX_AMOUNT_CENTS = 999999999999;
  const LIMITS = Object.freeze({
    accounts: 100, categories: 200, rows: 10000,
    nameLength: 80, noteLength: 500, idLength: 100,
    backupBytes: 32 * 1024 * 1024
  });
  let sequence = 0;

  class LedgerError extends Error {
    constructor(code, message, cause) {
      super(message);
      this.name = 'LedgerError';
      this.code = code;
      if (cause !== undefined) this.cause = cause;
    }
  }
  function fail(code, message) { throw new LedgerError(code, message); }
  function record(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.prototype.toString.call(value) !== '[object Object]') {
      fail('INVALID_DATA', label + '格式无效');
    }
    return value;
  }
  function list(value, limit, label) {
    if (!Array.isArray(value)) fail('INVALID_DATA', label + '必须是数组');
    if (value.length > limit) fail('ROW_LIMIT', label + '数量超过上限');
    // Array#map skips holes. Reject them rather than silently retaining invalid rows.
    for (let i = 0; i < value.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(value, i)) fail('INVALID_DATA', label + '包含空记录');
    }
    return value;
  }
  function identifier(value) {
    if (typeof value !== 'string' || value.length > LIMITS.idLength ||
        !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) ||
        value === 'constructor' || value === 'prototype') {
      fail('INVALID_ID', '记录标识无效');
    }
    return value;
  }
  function name(value) {
    if (typeof value !== 'string' || value.length > LIMITS.nameLength ||
        !value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
      fail('INVALID_NAME', '名称须为 1–' + LIMITS.nameLength + ' 个字符');
    }
    return value.trim();
  }
  function note(value) {
    if (value === undefined) return '';
    if (typeof value !== 'string' || value.length > LIMITS.noteLength ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
      fail('INVALID_NOTE', '备注最多 ' + LIMITS.noteLength + ' 个字符，且不能含控制字符');
    }
    return value;
  }
  function cents(value, signed, zero) {
    if (!Number.isSafeInteger(value) || Math.abs(value) > MAX_AMOUNT_CENTS ||
        (!signed && value < 0) || (!zero && value === 0)) {
      fail('INVALID_AMOUNT', '金额无效：须使用整数分，且不超过 9,999,999,999.99 元');
    }
    return value === 0 ? 0 : value;
  }
  function safeAdd(a, b) {
    const sum = a + b;
    if (!Number.isSafeInteger(sum)) fail('AMOUNT_OVERFLOW', '累计金额过大，无法安全计算');
    return sum;
  }
  function parseAmount(value, options) {
    const settings = options === undefined ? {} : record(options, '金额选项');
    if (typeof value !== 'string') fail('INVALID_AMOUNT', '请输入金额文字');
    const text = value.trim();
    if (text.length > 32 || !/^-?\d+(?:\.\d{1,2})?$/.test(text)) {
      fail('INVALID_AMOUNT', '金额须为普通数字，最多保留两位小数');
    }
    const negative = text[0] === '-';
    if (negative && settings.allowNegative !== true) fail('INVALID_AMOUNT', '金额不能为负数');
    const parts = (negative ? text.slice(1) : text).split('.');
    const whole = Number(parts[0]);
    if (!Number.isSafeInteger(whole) || whole > Math.floor(MAX_AMOUNT_CENTS / 100)) {
      fail('INVALID_AMOUNT', '金额超过上限');
    }
    const fraction = Number(((parts[1] || '') + '00').slice(0, 2));
    const amount = whole * 100 + fraction;
    return cents(negative ? -amount : amount, settings.allowNegative === true, settings.allowZero === true);
  }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    if (year < 1 || month < 1 || month > 12 || day < 1) return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  }
  function timestamp(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
        !validDate(value.slice(0, 10)) || !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString() !== value) {
      fail('INVALID_DATE', '备份或删除时间无效');
    }
    return value;
  }
  function type(value, transfer) {
    if (value !== 'income' && value !== 'expense' && !(transfer && value === 'transfer')) {
      fail('INVALID_TYPE', '收支类型无效');
    }
    return value;
  }
  function emptyField(value) { return value === undefined || value === null || value === ''; }
  function normalizeTransaction(value, accounts, categories) {
    record(value, '交易');
    const transaction = {
      id: identifier(value.id), type: type(value.type, true), date: value.date,
      amountCents: cents(value.amountCents, false, false), accountId: identifier(value.accountId)
    };
    if (!validDate(transaction.date)) fail('INVALID_DATE', '交易日期无效');
    if (!accounts.has(transaction.accountId)) fail('INVALID_REFERENCE', '交易账户不存在');
    if (transaction.type === 'transfer') {
      transaction.toAccountId = identifier(value.toAccountId);
      if (!accounts.has(transaction.toAccountId)) fail('INVALID_REFERENCE', '转入账户不存在');
      if (transaction.accountId === transaction.toAccountId) fail('SAME_ACCOUNT', '转出和转入账户不能相同');
      if (!emptyField(value.categoryId)) fail('INVALID_REFERENCE', '转账不能设置收支分类');
    } else {
      transaction.categoryId = identifier(value.categoryId);
      const category = categories.get(transaction.categoryId);
      if (!category || category.type !== transaction.type) fail('INVALID_REFERENCE', '交易分类不存在或与收支类型不匹配');
      if (!emptyField(value.toAccountId)) fail('INVALID_REFERENCE', '收入和支出不能设置转入账户');
    }
    transaction.note = note(value.note);
    return transaction;
  }
  function compute(state, month) {
    const accountBalances = Object.create(null);
    let openingTotal = 0;
    for (const account of state.accounts) {
      accountBalances[account.id] = account.openingBalanceCents;
      openingTotal = safeAdd(openingTotal, account.openingBalanceCents);
    }
    const totals = { incomeCents: 0, expenseCents: 0, transferCents: 0, netCents: 0 };
    for (const transaction of state.transactions) {
      const { type: kind, amountCents: amount, accountId } = transaction;
      accountBalances[accountId] = safeAdd(accountBalances[accountId], kind === 'income' ? amount : -amount);
      if (kind === 'transfer') accountBalances[transaction.toAccountId] = safeAdd(accountBalances[transaction.toAccountId], amount);
      if (month === undefined || transaction.date.slice(0, 7) === month) {
        const key = kind + 'Cents';
        totals[key] = safeAdd(totals[key], amount);
      }
    }
    totals.netCents = safeAdd(totals.incomeCents, -totals.expenseCents);
    let balanceTotal = 0;
    for (const account of state.accounts) balanceTotal = safeAdd(balanceTotal, accountBalances[account.id]);
    // Also check a grand total derived from flows, independent of account ordering.
    if (month === undefined) safeAdd(openingTotal, totals.netCents);
    return { accountBalances, totals };
  }
  function validateState(input) {
    record(input, '账本');
    if ((input.version !== VERSION && input.version !== SIMULATION_VERSION) ||
        (input.version === SIMULATION_VERSION && input.simulation === undefined)) fail('INVALID_VERSION', '不支持此账本版本');
    if (input.currency !== 'CNY') fail('INVALID_CURRENCY', '当前账本仅支持人民币 CNY');
    const accountRows = list(input.accounts, LIMITS.accounts, '账户');
    if (accountRows.length === 0) fail('LAST_ACCOUNT', '至少需要保留一个账户');
    const categoryRows = list(input.categories, LIMITS.categories, '分类');
    const transactionRows = list(input.transactions, LIMITS.rows, '交易');
    const trashRows = list(input.trash, LIMITS.rows, '已删除交易');
    if (transactionRows.length + trashRows.length > LIMITS.rows) fail('ROW_LIMIT', '交易总数量（含已删除交易）超过上限');
    const ids = new Set();
    function unique(id) {
      if (ids.has(id)) fail('DUPLICATE_ID', '存在重复记录标识');
      ids.add(id);
      return id;
    }
    const state = { version: input.simulation === undefined ? VERSION : SIMULATION_VERSION, currency: 'CNY', accounts: [], categories: [], transactions: [], trash: [] };
    state.accounts = accountRows.map(value => {
      record(value, '账户');
      return { id: unique(identifier(value.id)), name: name(value.name), openingBalanceCents: cents(value.openingBalanceCents, true, true) };
    });
    state.categories = categoryRows.map(value => {
      record(value, '分类');
      return { id: unique(identifier(value.id)), name: name(value.name), type: type(value.type, false) };
    });
    const accounts = new Set(state.accounts.map(value => value.id));
    const categories = new Map(state.categories.map(value => [value.id, value]));
    state.transactions = transactionRows.map(value => {
      const transaction = normalizeTransaction(value, accounts, categories);
      unique(transaction.id);
      return transaction;
    });
    state.trash = trashRows.map(value => {
      record(value, '已删除交易');
      const transaction = normalizeTransaction(value.transaction, accounts, categories);
      unique(transaction.id);
      const id = identifier(value.id);
      if (id !== transaction.id) fail('INVALID_ID', '已删除交易标识不一致');
      return { id, deletedAt: timestamp(value.deletedAt), transaction };
    });
    if (input.simulation !== undefined) {
      const engine = typeof module === 'object' && module.exports ? require('./scenario.js') : root.MoneygoScenario;
      if (!engine) fail('SIMULATION_UNAVAILABLE', '消费沙盘模块未加载，请刷新后重试');
      state.simulation = engine.validate(input.simulation);
    }
    compute(state);
    return state;
  }
  function createEmpty() {
    return {
      version: VERSION, currency: 'CNY',
      accounts: [{ id: 'account-cash', name: '现金', openingBalanceCents: 0 }],
      categories: [
        { id: 'expense-food', name: '餐饮', type: 'expense' },
        { id: 'expense-transport', name: '交通', type: 'expense' },
        { id: 'expense-shopping', name: '购物', type: 'expense' },
        { id: 'expense-housing', name: '居住', type: 'expense' },
        { id: 'expense-entertainment', name: '娱乐', type: 'expense' },
        { id: 'expense-health', name: '医疗', type: 'expense' },
        { id: 'expense-other', name: '其他支出', type: 'expense' },
        { id: 'income-salary', name: '工资', type: 'income' },
        { id: 'income-bonus', name: '奖金', type: 'income' },
        { id: 'income-other', name: '其他收入', type: 'income' }
      ],
      transactions: [], trash: []
    };
  }
  function allIds(state) {
    return new Set([...state.accounts, ...state.categories, ...state.transactions, ...state.trash].map(value => value.id));
  }
  function newId(state, prefix) {
    const existing = allIds(state);
    for (let attempt = 0; attempt < 10; attempt++) {
      let random;
      if (root.crypto && typeof root.crypto.randomUUID === 'function') random = root.crypto.randomUUID();
      else if (root.crypto && typeof root.crypto.getRandomValues === 'function') {
        const values = new Uint32Array(4);
        root.crypto.getRandomValues(values);
        random = Array.from(values, value => value.toString(16).padStart(8, '0')).join('');
      } else random = Date.now().toString(36) + '-' + (++sequence).toString(36) + '-' + Math.random().toString(36).slice(2);
      const id = prefix + '-' + random;
      if (!existing.has(id)) return identifier(id);
    }
    fail('ID_FAILURE', '无法生成新的记录标识，请重试');
  }
  function putTransaction(inputState, input, id) {
    const state = validateState(inputState);
    record(input, '交易');
    let index = -1;
    if (id !== undefined) {
      identifier(id);
      index = state.transactions.findIndex(value => value.id === id);
      if (index < 0) fail('NOT_FOUND', '要编辑的交易不存在');
    }
    const value = { ...input, id: id === undefined ? newId(state, 'transaction') : id };
    if (index < 0) state.transactions.push(value);
    else state.transactions[index] = value;
    return validateState(state);
  }
  function deleteTransaction(inputState, id) {
    const state = validateState(inputState);
    identifier(id);
    const index = state.transactions.findIndex(value => value.id === id);
    if (index < 0) fail('NOT_FOUND', '要删除的交易不存在');
    const transaction = state.transactions.splice(index, 1)[0];
    state.trash.push({ id: transaction.id, deletedAt: new Date().toISOString(), transaction });
    return validateState(state);
  }
  function undoDelete(inputState, id) {
    const state = validateState(inputState);
    identifier(id);
    const index = state.trash.findIndex(value => value.id === id);
    if (index < 0) fail('NOT_FOUND', '可恢复的交易不存在');
    state.transactions.push(state.trash.splice(index, 1)[0].transaction);
    return validateState(state);
  }
  function putAccount(inputState, input, id) {
    const state = validateState(inputState);
    record(input, '账户');
    let index = -1;
    if (id !== undefined) {
      identifier(id);
      index = state.accounts.findIndex(value => value.id === id);
      if (index < 0) fail('NOT_FOUND', '要编辑的账户不存在');
    }
    const value = { id: id === undefined ? newId(state, 'account') : id, name: input.name, openingBalanceCents: input.openingBalanceCents };
    if (index < 0) state.accounts.push(value);
    else state.accounts[index] = value;
    return validateState(state);
  }
  function referencedTransactions(state) { return state.transactions.concat(state.trash.map(value => value.transaction)); }
  function removeAccount(inputState, id) {
    const state = validateState(inputState);
    identifier(id);
    if (!state.accounts.some(value => value.id === id)) fail('NOT_FOUND', '要删除的账户不存在');
    if (state.accounts.length <= 1) fail('LAST_ACCOUNT', '至少需要保留一个账户');
    if (referencedTransactions(state).some(value => value.accountId === id || value.toAccountId === id)) {
      fail('ACCOUNT_REFERENCED', '此账户仍被交易或已删除交易引用，不能删除');
    }
    state.accounts = state.accounts.filter(value => value.id !== id);
    return validateState(state);
  }
  function putCategory(inputState, input, id) {
    const state = validateState(inputState);
    record(input, '分类');
    let index = -1;
    if (id !== undefined) {
      identifier(id);
      index = state.categories.findIndex(value => value.id === id);
      if (index < 0) fail('NOT_FOUND', '要编辑的分类不存在');
    }
    const value = { id: id === undefined ? newId(state, 'category') : id, name: input.name, type: input.type };
    if (index < 0) state.categories.push(value);
    else state.categories[index] = value;
    return validateState(state);
  }
  function removeCategory(inputState, id) {
    const state = validateState(inputState);
    identifier(id);
    if (!state.categories.some(value => value.id === id)) fail('NOT_FOUND', '要删除的分类不存在');
    if (referencedTransactions(state).some(value => value.categoryId === id)) {
      fail('CATEGORY_REFERENCED', '此分类仍被交易或已删除交易引用，不能删除');
    }
    state.categories = state.categories.filter(value => value.id !== id);
    return validateState(state);
  }
  function balances(inputState) { return compute(validateState(inputState)).accountBalances; }
  function summary(inputState, month) {
    if (month !== undefined && (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month) || !validDate(month + '-01'))) {
      fail('INVALID_MONTH', '月份须为 YYYY-MM');
    }
    return compute(validateState(inputState), month).totals;
  }
  function checkSize(text) {
    if (typeof text !== 'string') fail('INVALID_BACKUP', '备份必须是 JSON 文字');
    // Count encoded UTF-8 bytes, including surrogate pairs, without allocating a second large buffer.
    if (text.length > LIMITS.backupBytes) fail('BACKUP_TOO_LARGE', '备份文件超过 32 MiB 上限');
    let bytes = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
      if (bytes > LIMITS.backupBytes) fail('BACKUP_TOO_LARGE', '备份文件超过 32 MiB 上限');
    }
  }
  function parseJSON(text) {
    checkSize(text);
    try { return JSON.parse(text); }
    catch (error) { throw new LedgerError('INVALID_JSON', 'JSON 内容损坏或格式不正确', error); }
  }
  function backup(inputState) {
    const data = validateState(inputState);
    const text = JSON.stringify({ format: 'moneygo-backup', version: data.simulation ? 2 : VERSION, exportedAt: new Date().toISOString(), data }, null, 2);
    checkSize(text);
    return text;
  }
  function parseBackup(text) {
    const value = record(parseJSON(text), '备份');
    if (value.format !== 'moneygo-backup') fail('INVALID_BACKUP', '请选择 Moneygo 导出的备份文件');
    if (value.version !== VERSION && value.version !== 2) fail('INVALID_VERSION', '不支持此备份版本');
    if (value.version === 2 && (!value.data || value.data.simulation === undefined)) fail('INVALID_BACKUP', '沙盘备份缺少方案数据');
    if (value.version === 1 && value.data && value.data.simulation !== undefined) fail('INVALID_BACKUP', '沙盘数据须使用新版备份格式');
    timestamp(value.exportedAt);
    return validateState(value.data);
  }
  function load(storage) {
    try {
      if (!storage || typeof storage.getItem !== 'function') fail('STORAGE_UNAVAILABLE', '浏览器本地存储不可用');
      const text = storage.getItem(STORAGE_KEY);
      if (text === null) return { state: createEmpty(), error: null };
      return { state: validateState(parseJSON(text)), error: null };
    } catch (error) {
      // Never clear or overwrite unreadable data. The UI must require explicit recovery.
      return { state: createEmpty(), error: error instanceof LedgerError ? error : new LedgerError('STORAGE_READ_FAILED', '无法读取浏览器中的账本，原数据未被更改', error) };
    }
  }
  function save(storage, inputState) {
    const state = validateState(inputState);
    const text = JSON.stringify(state);
    checkSize(text);
    try {
      if (!storage || typeof storage.setItem !== 'function') fail('STORAGE_UNAVAILABLE', '浏览器本地存储不可用');
      storage.setItem(STORAGE_KEY, text);
    } catch (error) {
      if (error instanceof LedgerError) throw error;
      throw new LedgerError('STORAGE_WRITE_FAILED', '保存失败：本地存储可能已满或被浏览器禁用，本次修改未保存', error);
    }
    return state;
  }

  return Object.freeze({
    VERSION, SIMULATION_VERSION, STORAGE_KEY, MAX_AMOUNT_CENTS, LIMITS, LedgerError,
    createEmpty, parseAmount, validDate, validateState, putTransaction, deleteTransaction, undoDelete,
    putAccount, removeAccount, putCategory, removeCategory, balances, summary, backup, parseBackup, load, save
  });
}));
