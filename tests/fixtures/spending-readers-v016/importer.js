/* Local CSV import. No network, provider adapters, or raw-file persistence. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoneygoImporter = api;
}(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';
  const VERSION = 2;
  const FIELDS = Object.freeze(['date', 'amount', 'direction', 'note', 'stableId', 'status', 'channel']);
  const LIMITS = Object.freeze({ bytes: 8 * 1024 * 1024, rows: 10000, columns: 200, field: 1000, templates: 100, batches: 1000, history: 50000 });
  const previews = new WeakMap();
  const DELIMITERS = [',', '\t', ';', '|'];
  const FORMATS = ['YYYY-MM-DD', 'YYYY/MM/DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD HH:mm:ss', 'YYYY/MM/DD HH:mm:ss'];
  const DIRECTIONS = Object.freeze({ income: 'income', expense: 'expense', transfer: 'transfer', '收入': 'income', '支出': 'expense', '转账': 'transfer' });
  const STATUSES = Object.freeze({ completed: 'completed', complete: 'completed', success: 'completed', pending: 'pending', cancelled: 'cancelled', canceled: 'cancelled', '已完成': 'completed', '交易成功': 'completed', '支付成功': 'completed', '处理中': 'pending', '待支付': 'pending', '已取消': 'cancelled', '已关闭': 'cancelled', '交易关闭': 'cancelled' });
  function ledger() { return typeof module === 'object' && module.exports ? require('./ledger.js') : root.MoneygoLedger; }
  function fail(code, message) { throw new (ledger().LedgerError)(code, message); }
  function object(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.prototype.toString.call(value) !== '[object Object]') fail('INVALID_IMPORT', label + '格式无效');
    return value;
  }
  function array(value, limit, label) {
    if (!Array.isArray(value) || value.length > limit) fail('IMPORT_LIMIT', label + '数量或格式无效');
    for (let i = 0; i < value.length; i++) if (!Object.prototype.hasOwnProperty.call(value, i)) fail('INVALID_IMPORT', label + '包含空记录');
    return value;
  }
  function text(value, max, label, empty) {
    if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail('INVALID_IMPORT', label + '无效或过长');
    return value;
  }
  function id(value) { if (typeof value !== 'string' || value.length > 100 || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) || value === 'constructor' || value === 'prototype') fail('INVALID_IMPORT', '导入标识无效'); return value; }
  function integer(value, minimum, maximum) { if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail('INVALID_IMPORT', '导入计数无效'); return value; }
  function safeAdd(a, b) { const value = a + b; if (!Number.isSafeInteger(value)) fail('AMOUNT_OVERFLOW', '导入累计金额过大，无法安全计算'); return value; }
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function canonical(value) {
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }
  // Four independent 32-bit accumulators: identifiers only, never an authorization check.
  // Preview authorization/staleness uses exact canonical data held in a private WeakMap.
  function hash(value) {
    const s = typeof value === 'string' ? value : canonical(value);
    let a = 2166136261, b = 2246822519, c = 3266489917, d = 668265263;
    for (let i = 0; i < s.length; i++) { const n = s.charCodeAt(i); a = Math.imul(a ^ n, 16777619); b = Math.imul(b ^ n, 2246822519); c = Math.imul(c ^ n, 3266489917); d = Math.imul(d ^ n, 668265263); }
    return [a, b, c, d].map(n => (n >>> 0).toString(16).padStart(8, '0')).join('');
  }
  function freeze(value) { if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; }
  function timestamp(value) { if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('INVALID_IMPORT', '导入时间无效'); return value; }
  function checkText(value) {
    if (typeof value !== 'string') fail('INVALID_CSV', 'CSV 必须是文字');
    if (value.length > LIMITS.bytes) fail('CSV_TOO_LARGE', 'CSV 超过 8 MiB 上限');
    let bytes = 0;
    for (let i = 0; i < value.length; i++) { const n = value.charCodeAt(i); if (n < 128) bytes++; else if (n < 2048) bytes += 2; else if (n >= 0xd800 && n <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) { bytes += 4; i++; } else bytes += 3; }
    if (bytes > LIMITS.bytes) fail('CSV_TOO_LARGE', 'CSV 超过 8 MiB 上限');
    if (value.includes('\u0000')) fail('INVALID_ENCODING', 'CSV 含空字节，请转为 UTF-8 后再导入');
    if (value.includes('\ufffd')) fail('INVALID_ENCODING', 'CSV 含解码替代字符，请核对编码后再导入');
    return bytes;
  }
  function parseCSV(input, options) {
    checkText(input);
    const opts = options === undefined ? {} : object(options, 'CSV 选项');
    const delimiter = opts.delimiter === undefined ? ',' : opts.delimiter;
    if (!DELIMITERS.includes(delimiter)) fail('INVALID_DELIMITER', '请选择逗号、制表符、分号或竖线作为分隔符');
    if (opts.startLine !== undefined && (!Number.isSafeInteger(opts.startLine) || opts.startLine < 1 || opts.startLine > LIMITS.bytes)) fail('INVALID_START_LINE', '起始物理行必须是范围内的正整数');
    const source = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
    const records = []; let fields = [], field = '', quoted = false, closed = false, touched = false, line = 1, startLine = 1, blankLines = 0;
    function endField() { fields.push(field); if (fields.length > LIMITS.columns) fail('CSV_COLUMNS', 'CSV 列数超过上限'); field = ''; closed = false; }
    function endRecord() { if (!touched && fields.length === 0 && field === '') blankLines++; else { endField(); records.push({ line: startLine, fields }); if (records.length > LIMITS.rows + (opts.header === false ? 0 : 1)) fail('ROW_LIMIT', 'CSV 记录超过 10,000 行上限'); } fields = []; field = ''; touched = false; closed = false; }
    for (let i = 0; i < source.length; i++) {
      const char = source[i];
      if (quoted) {
        if (char === '"') { if (source[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
        else { field += char; if (char === '\n') line++; else if (char === '\r' && source[i + 1] !== '\n') line++; }
      } else if (char === delimiter) { endField(); touched = true; }
      else if (char === '\r' || char === '\n') { endRecord(); if (char === '\r' && source[i + 1] === '\n') i++; line++; startLine = line; }
      else if (char === '"') { if (field || closed) fail('CSV_QUOTE', '第 ' + line + ' 行引号位置无效'); quoted = true; touched = true; }
      else { if (closed) fail('CSV_QUOTE', '第 ' + line + ' 行引号后只能是分隔符或换行'); field += char; touched = true; }
    }
    if (quoted) fail('CSV_QUOTE', '第 ' + startLine + ' 行的引号未闭合');
    if (touched || fields.length || field) endRecord();
    const useHeader = opts.header !== false;
    // A start is an existing CSV record boundary, never an arbitrary text slice.
    // Unset preserves legacy first-nonblank-record behavior and its fingerprints.
    const start = opts.startLine === undefined ? 0 : records.findIndex(record => record.line === opts.startLine);
    if (start < 0) fail('INVALID_START_LINE', '所选物理行不是完整 CSV 记录的起点（可能为空行、引号内换行或超出文件）');
    const first = useHeader ? records[start] : null, skippedRecords = records.slice(0, start);
    return { delimiter, headers: first ? first.fields.map(value => value.trim()) : [], headerLine: first ? first.line : null, rows: records.slice(start + (useHeader ? 1 : 0)), records, skippedRecords, skippedPhysicalLines: opts.startLine === undefined ? 0 : opts.startLine - 1, blankLines, bom: input.charCodeAt(0) === 0xfeff };
  }
  function inspectCSV(input) {
    const bytes = checkText(input);
    const candidates = [], errors = []; let selected = null;
    for (const delimiter of DELIMITERS) {
      try {
        const parsed = parseCSV(input, { delimiter }); const width = parsed.headers.length;
        const mismatchedRows = parsed.rows.filter(row => row.fields.length !== width).map(row => row.line);
        const score = width > 1 ? (parsed.rows.length - mismatchedRows.length + 1) / (parsed.rows.length + 1) : 0;
        candidates.push({ delimiter, columns: width, consistent: mismatchedRows.length === 0, mismatchedRows, score });
        if (score > 0 && (!selected || score > selected.score || (score === selected.score && width > selected.parsed.headers.length))) selected = { delimiter, score, parsed };
      } catch (error) { errors.push({ delimiter, code: error.code || 'INVALID_CSV', message: error.message }); }
    }
    const viable = candidates.filter(item => item.score > 0);
    const ambiguous = viable.length > 1 && viable.filter(item => item.score === Math.max(...viable.map(v => v.score))).length > 1;
    const parsed = selected ? selected.parsed : (() => { try { return parseCSV(input); } catch (_) { return { headers: [], rows: [], blankLines: 0 }; } })();
    return { encoding: input.charCodeAt(0) === 0xfeff ? '含 BOM 标记；文字已解码，原始编码待确认' : '已解码文字；原始编码无法从文字确认', bytes, bom: input.charCodeAt(0) === 0xfeff, newline: input.includes('\r\n') ? 'CRLF' : input.includes('\r') ? 'CR' : 'LF', delimiterCandidates: candidates, suggestedDelimiter: selected && !ambiguous ? selected.delimiter : null, ambiguous, headers: parsed.headers, rowCount: parsed.rows.length, blankLines: parsed.blankLines, errors, warnings: ['格式识别是候选，请确认列映射；未验证任何支付平台或银行专用格式。'] };
  }
  function mapValues(value, defaults, allowed) {
    if (value === undefined) return { ...defaults };
    object(value, '值映射'); const result = {};
    if (Object.keys(value).length > 100) fail('INVALID_CONFIG', '值映射过多');
    for (const key of Object.keys(value)) {
      text(key, 100, '值映射名称', false);
      if (['__proto__', 'constructor', 'prototype'].includes(key) || !allowed.includes(value[key])) fail('INVALID_CONFIG', '值映射无效');
      result[key] = value[key];
    }
    return result;
  }
  function headersValue(value) { return array(value, LIMITS.columns, '表头').map(v => text(v, 200, '表头', true)); }
  function normalizeConfig(value, headers, state) {
    object(value, '导入配置');
    const config = { sourceKey: text(value.sourceKey, 100, '来源', false).trim(), accountId: id(value.accountId), delimiter: value.delimiter, header: value.header !== false, columns: {}, dateFormat: value.dateFormat || 'YYYY-MM-DD', amountMode: value.amountMode || 'absolute', defaultType: value.defaultType || null, categoryIds: {}, directionMap: mapValues(value.directionMap, DIRECTIONS, ['income', 'expense', 'transfer']), statusMap: mapValues(value.statusMap, STATUSES, ['completed', 'pending', 'cancelled']) };
    if (!DELIMITERS.includes(config.delimiter)) fail('INVALID_DELIMITER', '请明确选择分隔符');
    if (value.header !== undefined && typeof value.header !== 'boolean') fail('INVALID_CONFIG', '是否包含表头须明确选择');
    if (value.startLine !== undefined) { if (!Number.isSafeInteger(value.startLine) || value.startLine < 1 || value.startLine > LIMITS.bytes) fail('INVALID_START_LINE', '起始物理行必须是范围内的正整数'); config.startLine = value.startLine; }
    if (!FORMATS.includes(config.dateFormat)) fail('INVALID_CONFIG', '日期格式不支持');
    if (!['absolute', 'signed'].includes(config.amountMode) || ![null, 'income', 'expense'].includes(config.defaultType)) fail('INVALID_CONFIG', '金额或默认方向设置无效');
    object(value.columns, '列映射'); if (Object.keys(value.columns).some(key => !FIELDS.includes(key))) fail('COLUMN_MAPPING', '包含不支持的列映射'); const used = new Set();
    for (const field of FIELDS) {
      const column = value.columns[field];
      if (column === undefined || column === null || column === '') continue;
      let index = column;
      if (typeof column === 'string') { const matches = headers.map((header, i) => header === column ? i : -1).filter(i => i >= 0); if (matches.length !== 1) fail('COLUMN_MAPPING', '列“' + column + '”不存在或名称重复，请用列序号确认'); index = matches[0]; }
      if (!Number.isSafeInteger(index) || index < 0 || index >= headers.length || used.has(index)) fail('COLUMN_MAPPING', '列映射越界或多次使用同一列');
      used.add(index); config.columns[field] = index;
    }
    if (config.columns.date === undefined || config.columns.amount === undefined) fail('COLUMN_MAPPING', '必须映射日期和金额列');
    if (config.columns.direction === undefined && config.amountMode !== 'signed' && !config.defaultType) fail('COLUMN_MAPPING', '请映射收支方向或明确默认方向');
    if (value.expectedHeaders !== undefined && canonical(headersValue(value.expectedHeaders)) !== canonical(headers)) fail('TEMPLATE_HEADERS_CHANGED', '表头已变化，请重新确认映射后再导入');
    const categories = value.categoryIds === undefined ? {} : object(value.categoryIds, '默认分类');
    config.categoryIds.expense = categories.expense === undefined ? 'expense-other' : id(categories.expense);
    config.categoryIds.income = categories.income === undefined ? 'income-other' : id(categories.income);
    if (value.coverage !== undefined && value.coverage !== null) {
      object(value.coverage, '覆盖区间');
      if (value.coverage.confirmed !== true || !ledger().validDate(value.coverage.start) || !ledger().validDate(value.coverage.end) || value.coverage.start > value.coverage.end) fail('INVALID_COVERAGE', '覆盖区间须由用户确认起止日期');
      config.coverage = { start: value.coverage.start, end: value.coverage.end, confirmed: true };
    }
    if (state) {
      if (!state.accounts.some(a => a.id === config.accountId)) fail('INVALID_REFERENCE', '导入资金账户不存在');
      for (const type of ['expense', 'income']) if (!state.categories.some(c => c.id === config.categoryIds[type] && c.type === type)) fail('INVALID_REFERENCE', '导入默认分类不存在或方向不符');
    }
    return config;
  }
  function parseDate(raw, format) {
    let value = raw.trim(), date;
    if (format.includes('HH:mm:ss')) {
      const match = /^(.*) (\d\d):(\d\d):(\d\d)$/.exec(value);
      if (!match || +match[2] > 23 || +match[3] > 59 || +match[4] > 59) fail('INVALID_DATE', '日期时间须完全符合所选格式');
      value = match[1]; format = format.slice(0, 10);
    }
    if (format === 'YYYY-MM-DD') date = /^\d{4}-\d\d-\d\d$/.test(value) ? value : '';
    else if (format === 'YYYY/MM/DD') date = /^\d{4}\/\d\d\/\d\d$/.test(value) ? value.replaceAll('/', '-') : '';
    else { const m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(value); date = m ? m[3] + '-' + (format === 'DD/MM/YYYY' ? m[2] + '-' + m[1] : m[1] + '-' + m[2]) : ''; }
    if (!ledger().validDate(date)) fail('INVALID_DATE', '日期无效或不符合所选格式');
    return date;
  }
  function mappedValue(value) {
    object(value, '保留字段'); const result = {};
    for (const key of Object.keys(value)) { if (!FIELDS.includes(key)) fail('INVALID_IMPORT', '包含未映射的原始字段'); result[key] = text(value[key], LIMITS.field, '原始字段', true); }
    return result;
  }
  function snapshot(value, state) {
    if (value === null) return null;
    object(value, '导入交易快照'); const result = { id: id(value.id), type: value.type, date: value.date, amountCents: value.amountCents, accountId: id(value.accountId), categoryId: id(value.categoryId), note: text(value.note, 500, '备注', true) };
    if (!['income', 'expense'].includes(result.type) || !ledger().validDate(result.date) || !Number.isSafeInteger(result.amountCents) || result.amountCents <= 0 || result.amountCents > ledger().MAX_AMOUNT_CENTS) fail('INVALID_IMPORT', '导入交易快照无效');
    if (state && (!state.accounts.some(a => a.id === result.accountId) || !state.categories.some(c => c.id === result.categoryId && c.type === result.type))) fail('INVALID_REFERENCE', '导入历史引用了不存在的账户或分类');
    return result;
  }
  function normalized(value, state) { if (value === null) return null; const result = snapshot({ ...object(value, '标准化交易'), id: 'import-normalized' }, state); delete result.id; return result; }
  function emptyImports() { return { version: VERSION, revision: 0, templates: [], evidence: [], batches: [], quarantine: [], coverage: [], audit: [] }; }
  function validateImportState(input, state) {
    object(input, '导入数据'); if (![1, VERSION].includes(input.version)) fail('INVALID_IMPORT_VERSION', '不支持此导入数据版本');
    const knownTransactions = state ? new Set([...state.transactions, ...state.trash].map(t => t.id)) : null;
    const result = emptyImports(); result.revision = integer(input.revision, 0, Number.MAX_SAFE_INTEGER - 1);
    const unique = new Set(); function uniqueId(value) { id(value); if (unique.has(value)) fail('INVALID_IMPORT', '导入记录标识重复'); unique.add(value); return value; }
    const batchIds = new Set(array(input.batches, LIMITS.batches, '导入批次').map(b => id(object(b, '批次').id)));
    function batchRef(value) { id(value); if (!batchIds.has(value)) fail('INVALID_IMPORT', '导入批次引用不存在'); return value; }
    function evidence(value, live) {
      object(value, '导入证据');
      const row = { id: id(value.id), sourceKey: text(value.sourceKey, 100, '来源', false), accountId: id(value.accountId), stableId: value.stableId === null ? null : text(value.stableId, 160, '来源交易编号', false), status: value.status, transactionId: value.transactionId === null ? null : id(value.transactionId), normalized: normalized(value.normalized, state), mapped: mappedValue(value.mapped), fingerprint: text(value.fingerprint, 100, '指纹', false), expectedLocation: value.expectedLocation, expectedTransaction: snapshot(value.expectedTransaction, state), firstBatchId: batchRef(value.firstBatchId), lastBatchId: batchRef(value.lastBatchId) };
      if (Object.prototype.hasOwnProperty.call(value, 'sourceLine')) { if (input.version === 1) fail('INVALID_IMPORT_VERSION', '旧版导入证据不能包含来源物理行'); row.sourceLine = integer(value.sourceLine, 1, LIMITS.bytes); }
      if (!['completed', 'pending', 'cancelled'].includes(row.status) || ![null, 'active', 'trash'].includes(row.expectedLocation) || !row.normalized || row.accountId !== row.normalized.accountId) fail('INVALID_IMPORT', '导入证据状态无效');
      if ((row.transactionId === null) !== (row.expectedTransaction === null) || (row.transactionId === null) !== (row.expectedLocation === null) || (row.expectedTransaction && row.expectedTransaction.id !== row.transactionId) || (row.status === 'completed' && row.expectedLocation !== 'active') || (row.status !== 'completed' && row.expectedLocation === 'active')) fail('INVALID_IMPORT', '导入证据交易引用不一致');
      if (row.status === 'completed' && canonical(normalized(row.expectedTransaction, state)) !== canonical(row.normalized)) fail('INVALID_IMPORT', '已完成证据与交易快照不一致');
      if (live && state && row.transactionId && !knownTransactions.has(row.transactionId)) fail('INVALID_REFERENCE', '导入证据引用的交易不存在');
      return row;
    }
    result.templates = array(input.templates, LIMITS.templates, '导入模板').map(value => { object(value, '模板'); if (input.version === 1 && value.config && value.config.startLine !== undefined) fail('INVALID_IMPORT_VERSION', '旧版导入记录不能包含起始行设置'); const headers = headersValue(value.headers); const config = normalizeConfig(value.config, headers, state); if (value.sourceKey !== config.sourceKey || value.accountId !== config.accountId) fail('INVALID_IMPORT', '模板来源不一致'); return { id: uniqueId(value.id), name: text(value.name === undefined ? value.sourceKey : value.name, 100, '模板名称', false), version: integer(value.version, 1, Number.MAX_SAFE_INTEGER), sourceKey: config.sourceKey, accountId: config.accountId, headers, config }; });
    const templateIds = new Set(result.templates.map(t => t.id)), templateMap = new Map(result.templates.map(t => [t.id, t]));
    const stableIds = new Set(), transactionRefs = new Set();
    result.evidence = array(input.evidence, LIMITS.rows, '导入证据').map(value => { const row = evidence(value, true); uniqueId(row.id); if (row.transactionId) { if (transactionRefs.has(row.transactionId)) fail('INVALID_IMPORT', '多条导入证据引用同一交易'); transactionRefs.add(row.transactionId); } if (row.stableId) { const key = canonical([row.sourceKey, row.accountId, row.stableId]); if (stableIds.has(key)) fail('INVALID_IMPORT', '同源稳定交易编号重复'); stableIds.add(key); } return row; });
    function location(value) { object(value, '交易位置快照'); if (![null, 'active', 'trash'].includes(value.location)) fail('INVALID_IMPORT', '交易位置无效'); const item = { location: value.location, transaction: snapshot(value.transaction, state), deletedAt: value.deletedAt === null ? null : timestamp(value.deletedAt) }; if ((item.location === null) !== (item.transaction === null) || (item.location === 'trash') !== (item.deletedAt !== null)) fail('INVALID_IMPORT', '交易位置快照不一致'); return item; }
    let totalChanges = 0;
    result.batches = input.batches.map(value => {
      object(value, '批次'); const row = { id: uniqueId(value.id), createdAt: timestamp(value.createdAt), sourceKey: text(value.sourceKey, 100, '来源', false), accountId: id(value.accountId), templateId: id(value.templateId), fileFingerprint: text(value.fileFingerprint, 100, '文件指纹', false), selectedRowKeys: array(value.selectedRowKeys, LIMITS.rows, '已确认行').map(id), changes: [], quarantineIds: array(value.quarantineIds, LIMITS.rows, '隔离行标识').map(id), coverageIds: array(value.coverageIds, LIMITS.batches, '覆盖区间标识').map(id), resolvedQuarantineIds: array(value.resolvedQuarantineIds || [], LIMITS.rows, '修复记录标识').map(id), rolledBack: value.rolledBack, repair: value.repair === null || value.repair === undefined ? null : { quarantineId: id(object(value.repair, '修复引用').quarantineId), previousResolvedByBatchId: value.repair.previousResolvedByBatchId === null ? null : batchRef(value.repair.previousResolvedByBatchId) } };
      if (!templateIds.has(row.templateId) || typeof row.rolledBack !== 'boolean' || new Set(row.selectedRowKeys).size !== row.selectedRowKeys.length) fail('INVALID_IMPORT', '批次模板或状态无效');
      if (templateMap.get(row.templateId).sourceKey !== row.sourceKey || templateMap.get(row.templateId).accountId !== row.accountId || (row.repair && row.repair.previousResolvedByBatchId !== null)) fail('INVALID_IMPORT', '批次来源或修复快照不一致');
      const selectedKeys = new Set(row.selectedRowKeys);
      row.changes = array(value.changes, LIMITS.rows, '批次修改').map(change => { object(change, '批次修改'); return { rowKey: id(change.rowKey), evidenceId: id(change.evidenceId), before: change.before === null ? null : evidence(change.before, false), after: evidence(change.after, false), transactionBefore: location(change.transactionBefore), transactionAfter: location(change.transactionAfter) }; });
      totalChanges += row.changes.length; if (totalChanges > LIMITS.history) fail('IMPORT_LIMIT', '导入历史超过上限，请先备份');
      for (const change of row.changes) {
        if (!selectedKeys.has(change.rowKey) || change.evidenceId !== change.after.id || (change.before && (change.before.id !== change.evidenceId || change.before.sourceKey !== change.after.sourceKey || change.before.accountId !== change.after.accountId || change.before.stableId !== change.after.stableId || change.before.firstBatchId !== change.after.firstBatchId)) || (!change.before && change.after.firstBatchId !== row.id) || change.after.lastBatchId !== row.id || change.after.sourceKey !== row.sourceKey || change.after.accountId !== row.accountId) fail('INVALID_IMPORT', '批次修改引用不一致');
        if (canonical(change.transactionAfter.transaction) !== canonical(change.after.expectedTransaction) || change.transactionAfter.location !== change.after.expectedLocation || (change.before && (canonical(change.transactionBefore.transaction) !== canonical(change.before.expectedTransaction) || change.transactionBefore.location !== change.before.expectedLocation)) || (!change.before && change.transactionBefore.location !== null)) fail('INVALID_IMPORT', '批次交易快照与证据不一致');
      }
      if (row.changes.length !== row.selectedRowKeys.length || new Set(row.changes.map(c => c.rowKey)).size !== row.changes.length || new Set(row.changes.map(c => c.evidenceId)).size !== row.changes.length) fail('INVALID_IMPORT', '批次确认行与修改数不一致');
      return row;
    });
    result.quarantine = array(input.quarantine, LIMITS.rows, '隔离记录').map(value => { object(value, '隔离记录'); const row = { id: uniqueId(value.id), batchId: batchRef(value.batchId), sourceKey: text(value.sourceKey, 100, '来源', false), accountId: id(value.accountId), rowKey: id(value.rowKey), line: integer(value.line, 1, LIMITS.bytes), mapped: mappedValue(value.mapped), errors: array(value.errors, 20, '错误').map(e => ({ code: text(object(e, '错误').code, 80, '错误代码', false), message: text(e.message, 500, '错误说明', false) })), rawTruncated: array(value.rawTruncated || [], FIELDS.length, '截断字段').map(v => { if (!FIELDS.includes(v)) fail('INVALID_IMPORT', '截断字段无效'); return v; }), resolvedByBatchId: value.resolvedByBatchId === null || value.resolvedByBatchId === undefined ? null : batchRef(value.resolvedByBatchId) }; if (!row.errors.length) fail('INVALID_IMPORT', '隔离记录缺少错误说明'); return row; });
    result.coverage = array(input.coverage, LIMITS.batches, '覆盖区间').map(value => { object(value, '覆盖区间'); const row = { id: uniqueId(value.id), batchId: batchRef(value.batchId), sourceKey: text(value.sourceKey, 100, '来源', false), accountId: id(value.accountId), start: value.start, end: value.end, confirmed: true }; if (value.confirmed !== true || !ledger().validDate(row.start) || !ledger().validDate(row.end) || row.start > row.end) fail('INVALID_COVERAGE', '覆盖区间无效'); return row; });
    result.audit = array(input.audit, LIMITS.batches * 3, '导入日志').map(value => { object(value, '日志'); if (!['commit', 'rollback', 'template'].includes(value.action)) fail('INVALID_IMPORT', '导入日志操作无效'); return { id: uniqueId(value.id), batchId: value.batchId === null ? null : batchRef(value.batchId), action: value.action, at: timestamp(value.at), selectedCount: integer(value.selectedCount, 0, LIMITS.rows), quarantineCount: integer(value.quarantineCount, 0, LIMITS.rows) }; });
    const quarantines = new Map(result.quarantine.map(q => [q.id, q])), coverages = new Map(result.coverage.map(c => [c.id, c]));
    const batches = new Map(result.batches.map((b, index) => [b.id, { index, batch: b, quarantine: new Set(b.quarantineIds), coverage: new Set(b.coverageIds), resolved: new Set(b.resolvedQuarantineIds), changes: new Map(b.changes.map(c => [c.evidenceId, c])) }]));
    for (const batch of result.batches) {
      for (const change of batch.changes) if (change.before) { const previous = batches.get(change.before.lastBatchId), priorChange = previous.changes.get(change.evidenceId); if (previous.index >= batches.get(batch.id).index || !priorChange || canonical(priorChange.after) !== canonical(change.before) || canonical(priorChange.transactionAfter) !== canonical(change.transactionBefore)) fail('INVALID_IMPORT', '导入历史的前后版本不一致'); }
      if (new Set(batch.quarantineIds).size !== batch.quarantineIds.length || new Set(batch.coverageIds).size !== batch.coverageIds.length || new Set(batch.resolvedQuarantineIds).size !== batch.resolvedQuarantineIds.length) fail('INVALID_IMPORT', '批次引用重复');
      for (const ref of batch.quarantineIds) { const q = quarantines.get(ref); if (!q || q.batchId !== batch.id || q.sourceKey !== batch.sourceKey || q.accountId !== batch.accountId) fail('INVALID_IMPORT', '批次隔离记录引用无效'); }
      for (const ref of batch.coverageIds) if (!batch.rolledBack) { const c = coverages.get(ref); if (!c || c.batchId !== batch.id || c.sourceKey !== batch.sourceKey || c.accountId !== batch.accountId) fail('INVALID_IMPORT', '批次覆盖引用无效'); }
      for (const ref of batch.resolvedQuarantineIds) { const q = quarantines.get(ref); if (!q || (!batch.rolledBack && q.resolvedByBatchId !== batch.id)) fail('INVALID_IMPORT', '已修复记录引用无效'); }
      if (batch.repair && (!quarantines.has(batch.repair.quarantineId) || !batches.get(batch.id).resolved.has(batch.repair.quarantineId))) fail('INVALID_IMPORT', '修复的隔离记录不存在');
    }
    for (const q of result.quarantine) {
      const owner = batches.get(q.batchId); if (!owner.quarantine.has(q.id) || owner.batch.sourceKey !== q.sourceKey || owner.batch.accountId !== q.accountId) fail('INVALID_IMPORT', '隔离记录的拥有批次不一致');
      if (q.resolvedByBatchId) { const resolved = batches.get(q.resolvedByBatchId); if (owner.batch.rolledBack || resolved.batch.rolledBack || !resolved.resolved.has(q.id) || resolved.batch.sourceKey !== q.sourceKey || resolved.batch.accountId !== q.accountId) fail('INVALID_IMPORT', '隔离记录的修复批次不一致'); }
    }
    for (const c of result.coverage) { const owner = batches.get(c.batchId); if (owner.batch.rolledBack || !owner.coverage.has(c.id) || owner.batch.sourceKey !== c.sourceKey || owner.batch.accountId !== c.accountId) fail('INVALID_IMPORT', '覆盖记录的拥有批次不一致'); }
    for (const row of result.evidence) { const owner = batches.get(row.lastBatchId), change = owner.changes.get(row.id), first = batches.get(row.firstBatchId), origin = first.changes.get(row.id); if (owner.batch.rolledBack || !change || canonical(change.after) !== canonical(row) || first.batch.rolledBack || !origin || origin.before !== null) fail('INVALID_IMPORT', '当前导入证据与最后批次或初始批次不一致'); }
    if (state) for (const row of [...result.batches, ...result.quarantine, ...result.coverage]) if (!state.accounts.some(a => a.id === row.accountId)) fail('INVALID_REFERENCE', '导入历史引用了不存在的账户');
    return result;
  }
  function validated(input) { const state = ledger().validateState(input); if (input.imports !== undefined && state.imports === undefined) state.imports = validateImportState(input.imports, state); return state; }
  // Capture the complete, valid command-start state once. A detached or partly
  // appended import journal is not a valid input to the public Ledger boundary.
  function retainedIds(input, state) { return state.version === 7 ? new Set(ledger().collectRetainedIdentities(input).map(row => row.id)) : null; }
  function reserveIdentity(reserved, value) {
    if (reserved) { if (reserved.has(value)) fail('IDENTITY_COLLISION', '导入标识与保留历史冲突，未进行任何修改'); reserved.add(value); }
    return value;
  }
  function evidenceOwnerKey(sourceKey, accountId, stableId, rowKey) { return canonical([sourceKey, accountId, stableId, stableId === null ? rowKey : null]); }
  function historicalEvidenceOwners(imports) {
    const owners = new Map();
    // A rolled-back import may legitimately be imported again. Verify its
    // original source identity rather than exempting a matching ID string.
    for (const batch of imports.batches) for (const change of batch.changes) {
      const row = change.after, key = evidenceOwnerKey(row.sourceKey, row.accountId, row.stableId, change.rowKey);
      if (!owners.has(row.id)) owners.set(row.id, new Set());
      owners.get(row.id).add(key);
    }
    return owners;
  }
  function detach(state) { const value = clone(state); delete value.imports; if (value.version === 3) value.version = value.simulation ? 2 : 1; return value; }
  function attach(state, imports) { state.imports = imports; const value = ledger().validateState(state); if (value.imports === undefined) value.imports = validateImportState(imports, value); return value; }
  function currentLocation(state, transactionId) {
    if (!transactionId) return { location: null, transaction: null, deletedAt: null };
    const active = state.transactions.find(t => t.id === transactionId); if (active) return { location: 'active', transaction: clone(active), deletedAt: null };
    const deleted = state.trash.find(t => t.id === transactionId); if (deleted) return { location: 'trash', transaction: clone(deleted.transaction), deletedAt: deleted.deletedAt };
    return { location: null, transaction: null, deletedAt: null };
  }
  function locationIndex(state) { const active = new Map(state.transactions.map(t => [t.id, t])), trash = new Map(state.trash.map(t => [t.id, t])); return { active, trash, get(transactionId) { const tx = active.get(transactionId); if (tx) return { location: 'active', transaction: clone(tx), deletedAt: null }; const removed = trash.get(transactionId); return removed ? { location: 'trash', transaction: clone(removed.transaction), deletedAt: removed.deletedAt } : { location: null, transaction: null, deletedAt: null }; } }; }
  function heldDependencies(state, transactionId) {
    const out = [], data = state.bookkeeping;
    for (const row of data?.heldPositions || []) if (row.expenseId === transactionId) out.push({ kind: 'heldPosition', id: row.id });
    for (const row of data?.heldReturns || []) if (row.incomeId === transactionId) out.push({ kind: 'heldReturn', id: row.id });
    return out;
  }
  function heldImportConflict(state, evidence, transaction, status) {
    if (!evidence?.transactionId) return [];
    const before = evidence.expectedTransaction;
    const financialChanged = status !== 'completed' || !before || ['type', 'date', 'amountCents', 'accountId', 'toAccountId'].some(key => (before[key] ?? null) !== (transaction?.[key] ?? null));
    return financialChanged ? heldDependencies(state, evidence.transactionId) : [];
  }
  function evidenceConflict(state, evidence, locations) { const current = locations ? locations.get(evidence.transactionId) : currentLocation(state, evidence.transactionId); return current.location !== evidence.expectedLocation || canonical(current.transaction) !== canonical(evidence.expectedTransaction); }
  function matchKey(value) { return canonical([value.accountId, value.date, value.type, value.amountCents]); }
  function basicMatch(a, b) { return a && b && a.accountId === b.accountId && a.date === b.date && a.type === b.type && a.amountCents === b.amountCents; }
  function normalizedRow(mapped, config) {
    const date = parseDate(mapped.date || '', config.dateFormat);
    const signed = ledger().parseAmount(mapped.amount || '', { allowNegative: config.amountMode === 'signed' });
    const direction = mapped.direction === undefined ? null : mapped.direction.trim();
    let kind = direction === null ? (config.amountMode === 'signed' ? null : config.defaultType) : Object.prototype.hasOwnProperty.call(config.directionMap, direction) ? config.directionMap[direction] : null;
    if (direction !== null && !kind) fail('UNKNOWN_DIRECTION', '无法识别收支方向，请确认映射');
    if (config.amountMode === 'signed') { const inferred = signed < 0 ? 'expense' : 'income'; if (kind && kind !== inferred) fail('DIRECTION_CONFLICT', '金额正负与所选方向不一致'); kind = inferred; }
    if (!kind) fail('UNKNOWN_DIRECTION', '缺少明确的收支方向');
    let status = 'completed';
    if (mapped.status !== undefined) { const value = mapped.status.trim(); if (!Object.prototype.hasOwnProperty.call(config.statusMap, value)) fail('UNKNOWN_STATUS', '无法识别交易状态，不会默认入账'); status = config.statusMap[value]; }
    const stableId = mapped.stableId === undefined || !mapped.stableId.trim() ? null : text(mapped.stableId.trim(), 160, '来源交易编号', false);
    const note = mapped.note === undefined ? '' : text(mapped.note, 500, '备注', true);
    if (mapped.channel !== undefined) text(mapped.channel, 100, '支付渠道', true);
    return { transaction: kind === 'transfer' ? null : { type: kind, date, amountCents: Math.abs(signed), accountId: config.accountId, categoryId: config.categoryIds[kind], note }, kind, status, stableId };
  }
  function makePreview(input, csv, rawConfig, repairContext) {
    const state = validated(input), parsed = parseCSV(csv, { delimiter: rawConfig && rawConfig.delimiter, header: !rawConfig || rawConfig.header !== false, startLine: rawConfig && rawConfig.startLine });
    if (parsed.skippedPhysicalLines && rawConfig.preambleConfirmed !== true) fail('PREAMBLE_CONFIRMATION_REQUIRED', '请逐条核对并明确确认跳过前置说明行；不会自动忽略这些内容');
    if (rawConfig && rawConfig.header === false && parsed.rows.length) parsed.headers = parsed.rows[0].fields.map((_, i) => '第' + (i + 1) + '列');
    if (!parsed.headers.length) fail('EMPTY_CSV', 'CSV 缺少表头');
    parsed.headers = headersValue(parsed.headers);
    const config = normalizeConfig(rawConfig, parsed.headers, state), imports = state.imports || emptyImports();
    const mappedRows = parsed.rows.map(record => { const mapped = {}, rawTruncated = [], rawInvalid = [], fullMapped = {}; for (const field of FIELDS) if (config.columns[field] !== undefined) { const value = record.fields[config.columns[field]] || ''; fullMapped[field] = value; mapped[field] = value.slice(0, LIMITS.field).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '\ufffd'); if (value.length > LIMITS.field) rawTruncated.push(field); if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) rawInvalid.push(field); } return { line: repairContext ? imports.quarantine.find(q => q.id === repairContext).line : record.line, mapped, rawTruncated, rawInvalid, rawFingerprint: hash(fullMapped), width: record.fields.length }; });
    // Source location affects selection/provenance, not semantic receipt identity.
    const fingerprintConfig = clone(config); delete fingerprintConfig.startLine;
    const fileFingerprint = hash([config.sourceKey, config.accountId, fingerprintConfig, repairContext, mappedRows.map(r => [r.mapped, r.width, r.rawTruncated, r.rawInvalid, r.rawFingerprint])]);
    const signature = canonical(state), previewId = 'preview-' + hash([signature, fileFingerprint]);
    const rows = [], receipts = imports.batches.filter(b => !b.rolledBack && b.fileFingerprint === fileFingerprint && b.sourceKey === config.sourceKey && b.accountId === config.accountId);
    const templateConfig = clone(fingerprintConfig); delete templateConfig.coverage;
    const receiptRows = new Map();
    for (const batch of receipts) { const saved = imports.templates.find(t => t.id === batch.templateId), savedConfig = saved && clone(saved.config); if (savedConfig) delete savedConfig.startLine; if (saved && canonical(saved.headers) === canonical(parsed.headers) && canonical(savedConfig) === canonical(templateConfig)) for (const change of batch.changes) receiptRows.set(change.rowKey, change); }
    function alreadySelected(row, normal) { const change = receiptRows.get(row.key); return change && canonical(change.after.mapped) === canonical(row.mapped) && canonical(change.after.normalized) === canonical(normal.transaction) && change.after.status === normal.status && change.after.stableId === normal.stableId ? change : null; }
    const locations = locationIndex(state);
    const evidenceById = new Map(imports.evidence.map(e => [e.id, e])), existingStable = new Map(imports.evidence.filter(e => e.sourceKey === config.sourceKey && e.accountId === config.accountId && e.stableId).map(e => [e.stableId, e]));
    const seenStable = new Map(), transactionCandidates = new Map(), evidenceCandidates = new Map(), rowCandidates = new Map();
    function addCandidate(map, transaction, id) { const key = matchKey(transaction); if (!map.has(key)) map.set(key, []); map.get(key).push(id); }
    for (const tx of state.transactions) addCandidate(transactionCandidates, tx, tx.id);
    const activeIds = new Set(state.transactions.map(t => t.id));
    for (const e of imports.evidence) if (!activeIds.has(e.transactionId)) addCandidate(evidenceCandidates, e.normalized, e.id);
    const duplicateStable = new Map();
    mappedRows.forEach((r, index) => { const stable = r.mapped.stableId && r.mapped.stableId.trim(); if (stable) { const key = canonical([config.sourceKey, config.accountId, stable]); if (!duplicateStable.has(key)) duplicateStable.set(key, []); duplicateStable.get(key).push(index); } });
    const conflictingStable = new Set();
    for (const indexes of duplicateStable.values()) if (new Set(indexes.map(i => canonical(mappedRows[i].mapped))).size > 1) for (const index of indexes) conflictingStable.add(index);
    for (let index = 0; index < mappedRows.length; index++) {
      const raw = mappedRows[index];
      const row = { key: 'row-' + fileFingerprint + '-' + (index + 1), line: raw.line, action: 'new', status: null, explanation: '', transaction: null, mapped: raw.mapped, rawTruncated: raw.rawTruncated, candidateTransactionIds: [], candidateEvidenceIds: [], candidateRowKeys: [], candidateTransactionCount: 0, candidateEvidenceCount: 0, candidateRowCount: 0, candidateCount: 0, errors: [], evidenceId: null, previousEvidence: null };
      try {
        if (raw.width !== parsed.headers.length) fail('ROW_WIDTH', '字段数量与表头不一致');
        if (raw.rawInvalid.length) fail('INVALID_CONTROL', '映射字段含不允许的控制字符，隔离记录中已替换为占位符');
        if (raw.rawTruncated.length) fail('FIELD_TOO_LONG', '映射字段超过保存上限，隔离时仅保留前 1,000 个字符');
        mappedValue(raw.mapped);
        const normal = normalizedRow(raw.mapped, config); Object.assign(row, { transaction: normal.transaction, status: normal.status, stableId: normal.stableId });
        if (conflictingStable.has(index)) { row.action = 'conflict'; row.explanation = '文件内同一来源交易编号存在不同版本，请先核对。'; }
        else if (normal.kind === 'transfer') { row.action = 'transfer-candidate'; row.explanation = '可能是账户间转账；需核实转入账户后手动建立转账，不计入消费。'; }
        else {
          const previous = normal.stableId && existingStable.get(normal.stableId);
          const priorRow = normal.stableId && seenStable.get(normal.stableId);
          const receipt = !normal.stableId && alreadySelected(row, normal);
          if (priorRow) { row.action = 'duplicate'; row.explanation = '同一文件内相同来源编号和内容的重复行，不会创建第二笔交易。'; }
          else if (previous) {
            row.evidenceId = previous.id; row.previousEvidence = clone(previous);
            if (evidenceConflict(state, previous, locations)) { row.action = 'conflict'; row.explanation = '关联交易在导入后被修改或删除，请先核对；不会覆盖后续操作。'; }
            else if (canonical(previous.normalized) === canonical(normal.transaction) && previous.status === normal.status && canonical(previous.mapped) === canonical(raw.mapped)) { row.action = 'duplicate'; row.explanation = '同源、同资金账户、同稳定编号的内容未变化。'; }
            else if (heldImportConflict(state, previous, normal.transaction, normal.status).length) { row.action = 'conflict'; row.dependencies = heldImportConflict(state, previous, normal.transaction, normal.status); row.explanation = '此交易已有押金预付本金或实际退回分配，不能覆盖金额、日期、账户或完成状态；请先核对相关记录。'; row.errors.push({ code: 'HELD_REFERENCED', message: row.explanation }); }
            else { row.action = previous.status !== normal.status ? 'status' : 'update'; row.explanation = previous.status !== normal.status ? '稳定编号匹配，状态从 ' + previous.status + ' 变为 ' + normal.status + '；确认后更新同一笔记录。' : '稳定编号匹配，映射内容发生变化；确认后更新原记录。'; }
          } else if (receipt) {
            const latest = evidenceById.get(receipt.evidenceId);
            if (!latest || evidenceConflict(state, latest, locations)) { row.action = 'conflict'; row.explanation = '此文件的已入账记录后来被修改或删除，请先核对。'; }
            else { row.action = 'duplicate'; row.explanation = '这份相同映射文件的此行已确认且关联交易未变，不会重复入账。'; }
          } else {
            const key = matchKey(normal.transaction), txCandidates = transactionCandidates.get(key) || [], evidenceCandidatesForRow = evidenceCandidates.get(key) || [], earlier = rowCandidates.get(key) || { keys: [], count: 0 };
            row.candidateTransactionIds = txCandidates.slice(0, 20);
            row.candidateEvidenceIds = evidenceCandidatesForRow.slice(0, 20);
            row.candidateRowKeys = earlier.keys.slice(); row.candidateTransactionCount = txCandidates.length; row.candidateEvidenceCount = evidenceCandidatesForRow.length; row.candidateRowCount = earlier.count; row.candidateCount = txCandidates.length + evidenceCandidatesForRow.length + earlier.count;
            if (!normal.stableId && (row.candidateTransactionIds.length || row.candidateEvidenceIds.length || row.candidateRowKeys.length)) { row.action = 'candidate'; row.explanation = '日期、金额和账户与其他记录相似，不能证明重复。勾选此行表示确认它是独立交易。'; }
            else row.explanation = normal.status === 'completed' ? '未找到同源稳定编号；确认后新增一笔交易。' : '状态为 ' + normal.status + '，仅保留证据，不计入收支；后续可用稳定编号更新。';
            if (!normal.stableId) row.explanation += ' 没有稳定编号，跨文件重叠只能提示候选。';
          }
        }
      } catch (error) { row.action = 'invalid'; row.explanation = error.message; row.errors.push({ code: error.code || 'INVALID_ROW', message: error.message }); }
      rows.push(row);
      if (row.stableId && !['invalid', 'conflict'].includes(row.action) && !seenStable.has(row.stableId)) seenStable.set(row.stableId, row);
      if (row.transaction && !['invalid', 'conflict', 'duplicate'].includes(row.action)) { const key = matchKey(row.transaction), group = rowCandidates.get(key) || { keys: [], count: 0 }; if (group.keys.length < 20) group.keys.push(row.key); group.count++; rowCandidates.set(key, group); }
    }
    const totals = { new: 0, update: 0, status: 0, candidate: 0, duplicate: 0, invalid: 0, conflict: 0, transferCandidate: 0, incomeCents: 0, expenseCents: 0, netCents: 0 };
    for (const row of rows) {
      totals[row.action === 'transfer-candidate' ? 'transferCandidate' : row.action]++;
      if (!['new', 'update', 'status', 'candidate'].includes(row.action)) continue;
      const before = row.previousEvidence && row.previousEvidence.expectedLocation === 'active' ? row.previousEvidence.expectedTransaction : null;
      if (before) totals[before.type + 'Cents'] = safeAdd(totals[before.type + 'Cents'], -before.amountCents);
      if (row.status === 'completed') totals[row.transaction.type + 'Cents'] = safeAdd(totals[row.transaction.type + 'Cents'], row.transaction.amountCents);
    }
    totals.netCents = safeAdd(totals.incomeCents, -totals.expenseCents);
    const value = { id: previewId, baseSignature: hash(signature), fileFingerprint, config, headers: parsed.headers, selection: { headerLine: parsed.headerLine, dataLine: parsed.rows[0]?.line || null, skippedRecordCount: parsed.skippedRecords.length, skippedPhysicalLines: parsed.skippedPhysicalLines }, rows, totals, invalids: rows.filter(r => r.action === 'invalid'), warnings: ['金额影响按所有可确认行计算；实际提交只处理明确勾选的行。', '未映射状态列时，您确认这些记录均已完成。', '只保存映射字段、核对记录和变更历史，不保存原始 CSV。'] };
    previews.set(value, { signature, value: clone(value), repairId: repairContext || null, committedBatches: new Set() });
    return freeze(value);
  }
  function preview(input, csv, config) { return makePreview(input, csv, config, null); }
  function templateFor(imports, config, headers, customName, reserved) {
    const saved = clone(config); delete saved.coverage;
    const templateId = 'template-' + hash([config.sourceKey, config.accountId, headers, saved]);
    let template = imports.templates.find(t => t.id === templateId);
    if (template && (canonical(template.config) !== canonical(saved) || canonical(template.headers) !== canonical(headers))) fail('IDENTITY_COLLISION', '模板标识冲突，请重新核对');
    if (!template) { reserveIdentity(reserved, templateId); const version = Math.max(0, ...imports.templates.filter(t => t.sourceKey === config.sourceKey && t.accountId === config.accountId).map(t => t.version)) + 1; template = { id: templateId, name: customName || config.sourceKey, version, sourceKey: config.sourceKey, accountId: config.accountId, headers: clone(headers), config: saved }; imports.templates.push(template); }
    return template;
  }
  function saveTemplate(input, options) {
    const state = validated(input), spec = object(options, '模板'), headers = headersValue(spec.headers), config = normalizeConfig(spec.config, headers, state), imports = state.imports || emptyImports();
    const name = spec.name === undefined ? undefined : text(spec.name, 100, '模板名称', false);
    const reserved = retainedIds(input, state), count = imports.templates.length, template = templateFor(imports, config, headers, name, reserved);
    if (count === imports.templates.length && (!name || template.name === name)) return state;
    if (name) template.name = name;
    imports.revision++;
    imports.audit.push({ id: reserveIdentity(reserved, 'audit-' + hash(['template', template.id, imports.revision])), batchId: null, action: 'template', at: new Date().toISOString(), selectedCount: 0, quarantineCount: 0 });
    return attach(detach(state), imports);
  }
  function commit(input, givenPreview, selectedRowKeys) {
    const state = validated(input), ticket = previews.get(givenPreview);
    if (!ticket) fail('INVALID_PREVIEW', '请先重新生成本地预览');
    if (selectedRowKeys === undefined) fail('SELECTION_REQUIRED', '请明确确认要提交的行');
    const selection = array(selectedRowKeys, LIMITS.rows, '确认行').map(id);
    if (new Set(selection).size !== selection.length) fail('INVALID_SELECTION', '同一行不能重复选择');
    const p = ticket.value, selected = new Set(selection), selectedRows = p.rows.filter(row => selected.has(row.key));
    if (selectedRows.length !== selection.length || selectedRows.some(row => !['new', 'update', 'status', 'candidate'].includes(row.action))) fail('INVALID_SELECTION', '所选行不可入账，请重新核对');
    const imports = clone(state.imports || emptyImports()), batchId = 'batch-' + hash([p.id, selection.slice().sort(), ticket.repairId]);
    const repeated = imports.batches.find(b => b.id === batchId);
    if (repeated && !repeated.rolledBack) { if (ticket.committedBatches.has(batchId)) return state; fail('IDENTITY_COLLISION', '批次标识冲突，请重新预览'); }
    if (canonical(state) !== ticket.signature) fail('STALE_PREVIEW', '账本在预览后已变化，请重新预览');
    if (ticket.repairId && (selection.length !== 1 || selectedRows[0].action === 'invalid')) fail('INVALID_SELECTION', '修复时须明确确认修复后的这一行');
    const reserved = retainedIds(input, state); reserveIdentity(reserved, batchId);
    const historicalOwners = reserved ? historicalEvidenceOwners(imports) : null;
    const working = detach(state), locations = locationIndex(working), evidenceStore = new Map(imports.evidence.map(e => [e.id, e]));
    const usedIds = new Set([...working.accounts, ...working.categories, ...working.transactions, ...working.trash].map(t => t.id));
    const now = new Date().toISOString();
    const template = templateFor(imports, p.config, p.headers, undefined, reserved);
    const batch = { id: batchId, createdAt: now, sourceKey: p.config.sourceKey, accountId: p.config.accountId, templateId: template.id, fileFingerprint: p.fileFingerprint, selectedRowKeys: selection.slice().sort(), changes: [], quarantineIds: [], coverageIds: [], resolvedQuarantineIds: [], rolledBack: false, repair: null };
    imports.batches.push(batch);
    for (const row of selectedRows) {
      const before = row.previousEvidence ? clone(row.previousEvidence) : null;
      const evidenceId = before ? before.id : 'evidence-' + hash([p.config.sourceKey, p.config.accountId, row.stableId || row.key]);
      if (!before && evidenceStore.has(evidenceId)) fail('IDENTITY_COLLISION', '导入记录标识冲突，请核对后重试');
      if (!before && reserved) {
        const owners = historicalOwners.get(evidenceId), owner = evidenceOwnerKey(p.config.sourceKey, p.config.accountId, row.stableId || null, row.key);
        if (owners && owners.size === 1 && owners.has(owner)) reserved.add(evidenceId);
        else reserveIdentity(reserved, evidenceId);
      }
      let transactionId = before ? before.transactionId : null;
      const transactionBefore = locations.get(transactionId);
      if (before && evidenceConflict(working, before, locations)) fail('IMPORT_CONFLICT', '关联交易已改变，未进行任何修改');
      if (before && heldImportConflict(working, before, row.transaction, row.status).length) fail('HELD_REFERENCED', '导入交易仍被押金预付记录引用，未进行任何修改');
      if (row.status === 'completed') {
        if (!transactionId) { transactionId = reserveIdentity(reserved, 'transaction-import-' + hash([batchId, row.key])); if (usedIds.has(transactionId)) fail('IDENTITY_COLLISION', '交易标识冲突，请重新核对'); usedIds.add(transactionId); }
        locations.active.set(transactionId, { id: transactionId, ...clone(row.transaction) }); locations.trash.delete(transactionId);
      } else if (transactionBefore.location === 'active') {
        locations.active.delete(transactionId); locations.trash.set(transactionId, { id: transactionId, deletedAt: now, transaction: clone(transactionBefore.transaction) });
      }
      const transactionAfter = locations.get(transactionId);
      const after = { id: evidenceId, sourceLine: row.line, sourceKey: p.config.sourceKey, accountId: p.config.accountId, stableId: row.stableId || null, status: row.status, transactionId, normalized: clone(row.transaction), mapped: clone(row.mapped), fingerprint: hash(row.mapped), expectedLocation: transactionAfter.location, expectedTransaction: clone(transactionAfter.transaction), firstBatchId: before ? before.firstBatchId : batchId, lastBatchId: batchId };
      evidenceStore.set(evidenceId, after);
      batch.changes.push({ rowKey: row.key, evidenceId, before, after: clone(after), transactionBefore, transactionAfter });
    }
    working.transactions = Array.from(locations.active.values()); working.trash = Array.from(locations.trash.values()); imports.evidence = Array.from(evidenceStore.values());
    const activeBatchIds = new Set(imports.batches.filter(b => !b.rolledBack).map(b => b.id));
    const pendingKeys = new Set(imports.quarantine.filter(q => q.resolvedByBatchId === null && activeBatchIds.has(q.batchId)).map(q => q.rowKey));
    for (const row of p.rows.filter(item => item.action !== 'duplicate' && !selected.has(item.key))) {
      const quarantineId = 'quarantine-' + hash([batchId, row.key]);
      if (pendingKeys.has(row.key)) continue;
      reserveIdentity(reserved, quarantineId);
      imports.quarantine.push({ id: quarantineId, batchId, sourceKey: p.config.sourceKey, accountId: p.config.accountId, rowKey: row.key, line: row.line, mapped: clone(row.mapped), errors: row.errors.length ? clone(row.errors) : [{ code: row.action === 'conflict' ? 'REVIEW_CONFLICT' : row.action === 'transfer-candidate' ? 'REVIEW_TRANSFER' : 'NOT_SELECTED', message: row.explanation || '此行尚未确认入账，可稍后修复或重新预览。' }], rawTruncated: clone(row.rawTruncated), resolvedByBatchId: null }); batch.quarantineIds.push(quarantineId);
    }
    if (p.config.coverage) { const coverageId = reserveIdentity(reserved, 'coverage-' + hash([batchId, p.config.coverage])); imports.coverage.push({ id: coverageId, batchId, sourceKey: p.config.sourceKey, accountId: p.config.accountId, ...p.config.coverage }); batch.coverageIds.push(coverageId); }
    for (const q of imports.quarantine) if (q.resolvedByBatchId === null && activeBatchIds.has(q.batchId) && selected.has(q.rowKey)) { q.resolvedByBatchId = batchId; batch.resolvedQuarantineIds.push(q.id); }
    if (ticket.repairId) { const q = imports.quarantine.find(v => v.id === ticket.repairId); if (!q) fail('INVALID_REFERENCE', '待修复记录不存在'); batch.repair = { quarantineId: q.id, previousResolvedByBatchId: q.resolvedByBatchId === batchId ? null : q.resolvedByBatchId }; q.resolvedByBatchId = batchId; if (!batch.resolvedQuarantineIds.includes(q.id)) batch.resolvedQuarantineIds.push(q.id); }
    imports.revision++;
    imports.audit.push({ id: reserveIdentity(reserved, 'audit-' + hash([batchId, 'commit'])), batchId, action: 'commit', at: now, selectedCount: selection.length, quarantineCount: batch.quarantineIds.length });
    const result = attach(working, imports); ticket.committedBatches.add(batchId); return result;
  }
  function previewRepair(input, quarantineId, patch) {
    const state = validated(input), imports = state.imports || emptyImports(), q = imports.quarantine.find(row => row.id === quarantineId);
    if (!q) fail('NOT_FOUND', '隔离记录不存在'); if (q.resolvedByBatchId) fail('ALREADY_REPAIRED', '此记录已修复');
    const batch = imports.batches.find(b => b.id === q.batchId), template = imports.templates.find(t => t.id === batch.templateId);
    if (batch.rolledBack) fail('BATCH_ROLLED_BACK', '原批次已撤销，请重新导入后再修复');
    const mapped = { ...q.mapped, ...mappedValue(patch) }, fields = FIELDS.filter(field => mapped[field] !== undefined);
    const config = { ...clone(template.config), columns: Object.fromEntries(fields.map((field, i) => [field, i])), delimiter: ',', header: true };
    // Repair CSV is synthesized from mapped fields; its original file start is irrelevant.
    delete config.startLine;
    const quote = value => '"' + value.replaceAll('"', '""') + '"';
    const csv = fields.join(',') + '\n' + fields.map(field => quote(mapped[field])).join(',');
    return makePreview(state, csv, config, q.id);
  }
  function rollback(input, batchId) {
    const state = validated(input), imports = clone(state.imports || emptyImports()), batch = imports.batches.find(b => b.id === batchId);
    if (!batch) fail('NOT_FOUND', '导入批次不存在');
    if (batch.rolledBack) return { state, conflicts: [], rolledBack: false };
    const conflicts = [], locations = locationIndex(state), evidenceStore = new Map(imports.evidence.map(e => [e.id, e])), quarantineStore = new Map(imports.quarantine.map(q => [q.id, q]));
    for (const ref of batch.quarantineIds) { const q = quarantineStore.get(ref); if (q.resolvedByBatchId && q.resolvedByBatchId !== batchId) conflicts.push({ evidenceId: null, transactionId: null, reason: '此批次的暂存记录已有后续修复，请先处理修复批次。' }); }
    for (const change of batch.changes) {
      const evidence = evidenceStore.get(change.evidenceId);
      if (canonical(evidence || null) !== canonical(change.after)) conflicts.push({ evidenceId: change.evidenceId, transactionId: change.after.transactionId, reason: '此证据已有后续批次更新，须先处理后续修改。' });
      else if (canonical(locations.get(change.after.transactionId)) !== canonical(change.transactionAfter)) conflicts.push({ evidenceId: change.evidenceId, transactionId: change.after.transactionId, reason: '交易已被编辑、删除或恢复，不能覆盖后续操作。' });
    }
    for (const ref of batch.resolvedQuarantineIds) { const q = quarantineStore.get(ref); if (!q || q.resolvedByBatchId !== batch.id) conflicts.push({ evidenceId: null, transactionId: null, reason: '隔离记录已有后续修复。' }); }
    if (state.bookkeeping || state.organizer || state.obligations) {
      const dependencies = new Map(), data = state.bookkeeping || { links: [], refunds: [], claims: [], settlements: [], refundPlans: [] };
      const add = (transactionId, kind, id) => {if (!dependencies.has(transactionId)) dependencies.set(transactionId, []); dependencies.get(transactionId).push({kind,id});};
      for (const row of data.links) {add(row.primaryId,'link',row.id);add(row.shadowId,'link',row.id);}
      for (const row of data.composites || []) for (const member of row.signatures) add(member.id,'composite',row.id);
      for (const row of data.transferPairs || []) {add(row.expenseId,'transferPair',row.id);add(row.incomeId,'transferPair',row.id);}
      for (const row of data.refunds) {add(row.expenseId,'refund',row.id);add(row.incomeId,'refund',row.id);}
      for (const row of data.claims) add(row.expenseId,'claim',row.id);
      for (const row of data.settlements) add(row.incomeId,'settlement',row.id);
      for (const row of data.refundPlans) add(row.expenseId,'refundPlan',row.id);
      for (const row of data.heldPositions || []) add(row.expenseId,'heldPosition',row.id);
      for (const row of data.heldReturns || []) add(row.incomeId,'heldReturn',row.id);
      for (const row of state.organizer?.merchants || []) add(row.transactionId,'merchant',row.batchId);
      for (const row of state.obligations?.repayments || []) for (const leg of row.sourceProof.legs) add(leg.id,'creditRepayment',row.id);
      for (const row of state.obligations?.contracts || []) if (row.purchaseTransactionId) add(row.purchaseTransactionId,'installmentPurchase',row.id);
      for (const row of state.obligations?.fees || []) add(row.transactionId,'feeEvidence',row.id);
      for (const change of batch.changes) {
        const transactionId = change.after.transactionId, referenced = dependencies.get(transactionId);
        if (referenced && canonical(change.transactionBefore) !== canonical(change.transactionAfter)) conflicts.push({ evidenceId: change.evidenceId, transactionId, reason: '交易已有证据关联、退款、应收或商户整理依赖，请先核对并撤销相关操作，再回滚导入批次。', dependencies: referenced });
      }
    }

    if (conflicts.length) return { state, conflicts, rolledBack: false };
    const reserved = retainedIds(input, state);
    const working = detach(state);
    for (const change of batch.changes.slice().reverse()) {
      const txId = change.after.transactionId;
      if (txId) { locations.active.delete(txId); locations.trash.delete(txId); }
      const before = change.transactionBefore;
      if (before.location === 'active') locations.active.set(before.transaction.id, clone(before.transaction));
      else if (before.location === 'trash') locations.trash.set(before.transaction.id, { id: before.transaction.id, deletedAt: before.deletedAt, transaction: clone(before.transaction) });
      evidenceStore.delete(change.evidenceId); if (change.before) evidenceStore.set(change.evidenceId, clone(change.before));
    }
    working.transactions = Array.from(locations.active.values()); working.trash = Array.from(locations.trash.values()); imports.evidence = Array.from(evidenceStore.values());
    for (const ref of batch.resolvedQuarantineIds) quarantineStore.get(ref).resolvedByBatchId = null;
    if (batch.repair) quarantineStore.get(batch.repair.quarantineId).resolvedByBatchId = batch.repair.previousResolvedByBatchId;
    imports.coverage = imports.coverage.filter(c => c.batchId !== batchId);
    batch.rolledBack = true; imports.revision++;
    imports.audit.push({ id: reserveIdentity(reserved, 'audit-' + hash([batchId, 'rollback'])), batchId, action: 'rollback', at: new Date().toISOString(), selectedCount: batch.selectedRowKeys.length, quarantineCount: batch.quarantineIds.length });
    return { state: attach(working, imports), conflicts: [], rolledBack: true };
  }
  return Object.freeze({ VERSION, LIMITS, FIELDS, parseCSV, inspectCSV, validateImportState, preview, commit, rollback, saveTemplate, previewRepair });
}));
