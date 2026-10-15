/* Local intake scheduling and explicit-coverage views. No I/O, storage or finance inference. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoneygoImportWorkflow = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const LIMITS = Object.freeze({ files: 20, fileBytes: 8 * 1024 * 1024, totalBytes: 32 * 1024 * 1024, sources: 1500, intervals: 1000 });
  const STATUSES = Object.freeze({ queued: '等待检查', waiting: '等待读取', reading: '正在读取', ready: '待映射', review: '待确认', stale: '需重新预览', error: '文件需处理', committed: '已提交' });
  function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
  function createQueue(makeDraft) {
    if (typeof makeDraft !== 'function') fail('INVALID_QUEUE', '缺少文件草稿构造器');
    let sequence = 0, activeId = null, tail = Promise.resolve();
    const entries = new Map();
    const get = id => entries.get(id) || null;
    function add(files) {
      // Inspect only bounded File metadata; never read all selected files here.
      if (!files || !Number.isSafeInteger(files.length) || files.length < 0) fail('INVALID_FILES', '请选择本地文件');
      const added = [], errors = []; let reserved = [...entries.values()].reduce((n, e) => n + e.reservedBytes, 0);
      const room = LIMITS.files - entries.size;
      for (let i = 0; i < Math.min(files.length, room); i++) {
        const file = files[i], id = 'intake-' + (++sequence), draft = makeDraft();
        const name = typeof file?.name === 'string' ? file.name.slice(0, 240) : '未命名文件';
        let problem = '';
        if (!/\.(csv|tsv)$/i.test(name)) problem = '请选择 .csv 或 .tsv 文件。Excel 工作簿请先另存为 CSV。';
        else if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > LIMITS.fileBytes) problem = '文件超过 8 MB 或文件大小无效。请分段导出后重试。';
        else if (reserved + file.size > LIMITS.totalBytes) problem = '队列合计最多 32 MB。请先处理或移除其他文件，再添加此文件。';
        else if (typeof file.arrayBuffer !== 'function') problem = '当前浏览器无法读取此文件。';
        const reservedBytes = problem ? 0 : file.size; reserved += reservedBytes;
        draft.fileName = name; draft.config.sourceKey = ''; draft.config.accountId = ''; draft.error = problem;
        const entry = { id, file: problem ? null : file, name, size: Number.isSafeInteger(file?.size) ? file.size : 0, reservedBytes, draft, status: problem ? 'error' : 'queued', token: 0, batchId: null };
        entries.set(id, entry); added.push(entry);
      }
      if (files.length > room) errors.push('队列最多 20 个文件，其余文件未添加。请先处理或移除已有文件。');
      if (!activeId && added.length) activeId = added[0].id;
      return { added, errors };
    }
    function select(id) { if (!entries.has(id)) fail('UNKNOWN_FILE', '文件已移除'); activeId = id; return get(id); }
    function cancel(id) { const entry = get(id); if (!entry) return; entry.token++; if (entry.status === 'waiting' || entry.status === 'reading') { entry.status = entry.draft.parsed ? 'ready' : 'queued'; entry.draft.reading = false; } }
    function remove(id) { const entry = get(id); if (!entry) return; cancel(id); entries.delete(id); if (activeId === id) activeId = entries.keys().next().value || null; }
    function clear() { for (const id of entries.keys()) cancel(id); entries.clear(); activeId = null; }
    async function read(id, loader) {
      const entry = get(id); if (!entry || !entry.file || entry.status === 'committed') return false;
      const token = ++entry.token; entry.status = 'waiting'; entry.draft.reading = true; entry.draft.error = '';
      const run = async () => {
        if (get(id) !== entry || entry.token !== token) return false;
        entry.status = 'reading';
        try {
          const bytes = await entry.file.arrayBuffer();
          if (get(id) !== entry || entry.token !== token) return false;
          if (!bytes || !Number.isSafeInteger(bytes.byteLength) || bytes.byteLength > LIMITS.fileBytes || bytes.byteLength > entry.reservedBytes) fail('FILE_SIZE_CHANGED', '实际读取大小超过已检查的文件大小，请重新选择文件。');
          const result = await loader(bytes, entry);
          if (get(id) !== entry || entry.token !== token) return false;
          if (!result || typeof result !== 'object') fail('INVALID_READ', '文件检查未返回有效结果');
          Object.assign(entry.draft, result, { reading: false, error: typeof result.error === 'string' ? result.error : '' }); entry.status = entry.draft.error ? 'error' : 'ready'; return !entry.draft.error;
        } catch (error) {
          if (get(id) === entry && entry.token === token) { entry.draft.reading = false; entry.draft.error = error.message || '文件读取失败'; entry.status = 'error'; }
          return false;
        }
      };
      // Cancellation invalidates an individual result. One physical read remains in flight
      // until it settles, so fast selection/encoding changes cannot create unbounded reads.
      const task = tail.then(run, run); tail = task.then(() => {}, () => {}); return task;
    }
    function markCommitted(id, batchId) {
      const entry = get(id); if (!entry) return;
      cancel(id); entry.status = 'committed'; entry.batchId = batchId; entry.file = null; entry.reservedBytes = 0;
      Object.assign(entry.draft, { text: '', bytes: null, inspection: null, parsed: null, preview: null, previewState: null, selected: new Set(), error: '', reading: false });
    }
    return Object.freeze({ add, select, get, cancel, remove, clear, read, markCommitted, list: () => [...entries.values()], active: () => get(activeId) });
  }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(value)) return false;
    const y = +value.slice(0, 4), m = +value.slice(5, 7), d = +value.slice(8);
    return y >= 1 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= days(y, m);
  }
  function days(y, m) { return [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]; }
  function dayAfter(value) {
    if (!validDate(value)) fail('INVALID_DATE', '日期无效');
    let y = +value.slice(0, 4), m = +value.slice(5, 7), d = +value.slice(8);
    if (value === '9999-12-31') return null;
    if (++d > days(y, m)) { d = 1; if (++m > 12) { m = 1; y++; } }
    return String(y).padStart(4, '0') + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  function monthRange(month) {
    if (typeof month !== 'string' || !validDate(month + '-01')) fail('INVALID_MONTH', '请选择有效月份');
    return { month, start: month + '-01', end: month + '-' + days(+month.slice(0, 4), +month.slice(5)), dayCount: days(+month.slice(0, 4), +month.slice(5)) };
  }
  const pair = (sourceKey, accountId) => JSON.stringify([sourceKey, accountId]);
  function coverageCalendar(state, month) {
    const range = monthRange(month), sources = new Map(), accounts = new Set((state.accounts || []).map(a => a.id));
    const scopes = state.organizer?.scopes || [], coverage = state.imports?.coverage || [], batches = state.imports?.batches || [];
    if (!Array.isArray(scopes) || scopes.length > 500 || !Array.isArray(coverage) || coverage.length > LIMITS.intervals || !Array.isArray(batches) || batches.length > 1000) fail('COVERAGE_LIMIT', '来源或覆盖记录超出上限');
    const liveBatches = new Map(batches.filter(b => !b.rolledBack).map(b => [b.id, b]));
    function source(value) {
      if (typeof value.sourceKey !== 'string' || !value.sourceKey.trim() || value.sourceKey.length > 100 || !accounts.has(value.accountId)) fail('INVALID_SOURCE', '来源或账户引用无效');
      const key = pair(value.sourceKey, value.accountId);
      if (!sources.has(key)) sources.set(key, { key, sourceKey: value.sourceKey, accountId: value.accountId, declared: false, included: null, reason: '', intervals: [], unresolvedRows: 0, pendingEvidenceCount: 0 });
      return sources.get(key);
    }
    for (const s of scopes) { if (s.confirmed !== true || typeof s.included !== 'boolean') fail('INVALID_SCOPE', '来源范围必须明确确认'); Object.assign(source(s), { declared: true, included: s.included, reason: s.reason || '' }); }
    for (const batch of liveBatches.values()) source(batch);
    for (const c of coverage) {
      if (c.confirmed !== true) continue;
      const owner = liveBatches.get(c.batchId);
      // A rolled back batch is never coverage, even in a stale external snapshot.
      if (!owner) continue;
      if (owner.sourceKey !== c.sourceKey || owner.accountId !== c.accountId || !validDate(c.start) || !validDate(c.end) || c.start > c.end) fail('INVALID_COVERAGE', '已确认覆盖的范围或批次归属无效');
      source(c).intervals.push({ id: c.id, batchId: c.batchId, start: c.start, end: c.end });
    }
    if ((state.imports?.quarantine || []).length > 10000 || (state.imports?.evidence || []).length > 10000) fail('COVERAGE_LIMIT', '核对记录超出上限');
    for (const e of state.imports?.evidence || []) if (e.status === 'pending') { const row = sources.get(pair(e.sourceKey, e.accountId)); if (row) row.pendingEvidenceCount++; }
    for (const q of state.imports?.quarantine || []) if (!q.resolvedByBatchId && liveBatches.has(q.batchId)) { const row = sources.get(pair(q.sourceKey, q.accountId)); if (row) row.unresolvedRows++; }
    if (sources.size > LIMITS.sources) fail('COVERAGE_LIMIT', '来源数量超出上限');
    const rows = [...sources.values()].map(s => {
      // Month-sized difference array. Never loop over an entire multi-year interval.
      const difference = Array(range.dayCount + 1).fill(0);
      let latestConfirmedEnd = null;
      for (const c of s.intervals) {
        if (!latestConfirmedEnd || c.end > latestConfirmedEnd) latestConfirmedEnd = c.end;
        const start = c.start > range.start ? c.start : range.start, end = c.end < range.end ? c.end : range.end;
        if (start > end) continue;
        difference[+start.slice(8) - 1]++; difference[+end.slice(8)]--;
      }
      let count = 0; const dates = difference.slice(0, range.dayCount).map((change, index) => { count += change; return { date: month + '-' + String(index + 1).padStart(2, '0'), count, status: count === 0 ? 'unknown' : count === 1 ? 'confirmed' : 'overlap' }; });
      const spans = wanted => { const result = []; let current = null; for (const d of dates) { if (wanted(d)) { if (!current) { current = { start: d.date, end: d.date }; result.push(current); } else current.end = d.date; } else current = null; } return result; };
      return { ...s, days: dates, gaps: spans(d => d.count === 0), overlaps: spans(d => d.count > 1), latestConfirmedEnd, coveredDays: dates.filter(d => d.count > 0).length, overlapDays: dates.filter(d => d.count > 1).length };
    }).sort((a, b) => a.sourceKey.localeCompare(b.sourceKey) || a.accountId.localeCompare(b.accountId));
    return { ...range, weekOffset: (new Date(range.start + 'T00:00:00.000Z').getUTCDay() + 6) % 7, sources: rows, unknownAccounts: [...accounts].filter(id => !rows.some(s => s.accountId === id && s.declared)), warning: '未确认覆盖不等于漏账或零消费；已确认导出范围也不等于所有行已入账或余额已核实。' };
  }
  function exportChecklist(state, month, asOf) {
    if (!validDate(asOf)) fail('INVALID_DATE', '清单参考日期无效');
    const calendar = coverageCalendar(state, month);
    return { month, asOf, sources: calendar.sources.map(s => ({ sourceKey: s.sourceKey, accountId: s.accountId, declared: s.declared, included: s.included, excluded: s.included === false, reason: s.reason, latestConfirmedEnd: s.latestConfirmedEnd, nextStart: s.latestConfirmedEnd ? dayAfter(s.latestConfirmedEnd) : null, gaps: s.gaps, unresolvedRows: s.unresolvedRows, pendingEvidenceCount: s.pendingEvidenceCount, needsSourceDeclaration: !s.declared })), unknownAccounts: calendar.unknownAccounts };
  }
  return Object.freeze({ LIMITS, STATUSES, createQueue, coverageCalendar, exportChecklist, monthRange, dayAfter });
}));
