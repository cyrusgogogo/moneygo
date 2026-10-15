'use strict';
// Build-time only: validates real immutable input backups, emits literal data.
// --create-starter intentionally authors a NEW starter with public APIs; its
// generated IDs/export time are retained in the committed input. Ordinary builds
// reproduce that saved input byte-for-byte and never regenerate financial history.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const P = require('../tests/synthetic-practice-fixture.cjs');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const outputs = new Map();
const starterPath = 'dist/samples/SYNTHETIC-starter.json';
if (process.argv.includes('--create-starter')) {
  if (fs.existsSync(path.join(root, starterPath))) throw Error('Starter already exists; never silently replace the authored seed');
  fs.mkdirSync(path.dirname(path.join(root, starterPath)), { recursive: true });
  const starter = P.L.backup(P.buildStarterState()) + '\n';
  P.L.verifyBackup(starter);
  fs.writeFileSync(path.join(root, starterPath), starter);
}
const complexText = read('tests/fixtures/all-extensions-v6.json');
const starterText = read(starterPath);
const complex = P.L.verifyBackup(complexText), starter = P.L.verifyBackup(starterText);
if (complex.state.version !== 6 || starter.state.version !== 1 || starter.state.transactions.length !== 0) throw Error('Unexpected authored seed schema');
const files = [
  { id: 'complex-json', label: 'SYNTHETIC 完整关系与历史备份', fileName: 'SYNTHETIC-complex-v6.json', mimeType: 'application/json;charset=utf-8', purpose: 'Immutable complete public-API fixture, including real active and reversed histories.', text: complexText },
  { id: 'starter-json', label: 'SYNTHETIC 空白练习备份', fileName: 'SYNTHETIC-starter.json', mimeType: 'application/json;charset=utf-8', purpose: 'Independently authored two-account starter. No transactions or fabricated old history.', text: starterText },
  ...P.descriptors
].map(file => ({ ...file, path: 'samples/' + file.fileName }));
for (const file of files) outputs.set('dist/' + file.path, file.text);
const bundle = { protocol: 'moneygo-synthetic-samples-v1', version: 1, testedEngineRelease: '0.23.0', fixedReferenceDate: P.FIXED_REFERENCE_DATE, defaultSeed: 'complex', seeds: {
  complex: { id: 'complex', label: 'SYNTHETIC 完整样例', initialMonth: '2026-10', schemaVersion: 6, backupText: complexText },
  starter: { id: 'starter', label: 'SYNTHETIC 空白练习', initialMonth: '2026-09', schemaVersion: 1, backupText: starterText }
}, files };
const literal = JSON.stringify(bundle, null, 2).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
outputs.set('dist/synthetic-samples.js', '/* Generated SYNTHETIC data only. Rebuild: node scripts/build-synthetic-samples.cjs. */\n(function (root) {\n  \'use strict\';\n  function freeze(value) { if (value && typeof value === \'object\') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }\n  Object.defineProperty(root, \'MoneygoSyntheticSamples\', { value: freeze(' + literal + '), enumerable: true, writable: false, configurable: false });\n}(typeof window !== \'undefined\' ? window : globalThis));\n');
// Render only the small authored Markdown subset. Every source string is escaped;
// all actual links below are fixed, generated sample paths from this build.
function htmlEscape(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function inline(value) { return htmlEscape(value).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'); }
function guideBody(markdown) {
  const out = []; let list = '', code = false, paragraph = [];
  const closeParagraph = () => { if (paragraph.length) out.push('<p>' + inline(paragraph.join(' ')) + '</p>'); paragraph = []; };
  const closeList = () => { if (list) out.push('</' + list + '>'); list = ''; };
  for (const line of markdown.split(/\r?\n/)) {
    if (line.startsWith('```')) { closeParagraph(); closeList(); out.push(code ? '</code></pre>' : '<pre><code>'); code = !code; continue; }
    if (code) { out.push(htmlEscape(line) + '\n'); continue; }
    if (!line.trim()) { closeParagraph(); closeList(); continue; }
    const heading = /^(#{1,3}) (.+)$/.exec(line), item = /^(?:([-])|\d+\.) (.+)$/.exec(line);
    if (heading) { closeParagraph(); closeList(); out.push('<h' + heading[1].length + '>' + inline(heading[2]) + '</h' + heading[1].length + '>'); }
    else if (item) { closeParagraph(); const kind = item[1] ? 'ul' : 'ol'; if (list !== kind) { closeList(); list = kind; out.push('<' + kind + '>'); } out.push('<li>' + inline(item[2]) + '</li>'); }
    else { closeList(); paragraph.push(line); }
  }
  closeParagraph(); closeList(); if (code) throw Error('Unclosed guide code fence'); return out.join('\n');
}
const guide = read('SAMPLE_GUIDE.md');
outputs.set('dist/synthetic-practice.html', '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SYNTHETIC 本地文件练习指南 · moneygo</title><style>body{margin:0;background:#f6f5f1;color:#202b29;font:17px/1.75 system-ui,sans-serif}main{max-width:900px;margin:auto;padding:32px 22px 80px}h1,h2,h3{line-height:1.35}h2{margin-top:2.2em;border-top:1px solid #c9d3cc;padding-top:1em}a{color:#115d43}a:focus{outline:3px solid #a05a00;outline-offset:4px}code{overflow-wrap:anywhere;background:#e9eee9;padding:1px 4px;border-radius:3px}pre{overflow:auto;background:#e9eee9;padding:16px}pre code{padding:0}li{margin:.45em 0}.notice{padding:18px;border:1px solid #729887;border-radius:8px;background:#eff7f1}nav ul{padding-left:22px}.skip{position:absolute;left:-10000px}.skip:focus{position:static}</style></head><body><a class="skip" href="#guide">跳到练习步骤</a><main><aside class="notice">这是只读指南，应单独打开；请将临时账本留在原标签页，切勿用刷新代替取消。静态网页与下载文件会正常加载，但本指南没有脚本、表单、财务操作或财务数据传输。</aside><nav aria-label="合成练习文件下载"><h2>固定 SYNTHETIC 原始下载</h2><ul>' + files.map(file => '<li><a href="' + htmlEscape(file.path) + '" download="' + htmlEscape(file.fileName) + '">' + htmlEscape(file.label + ' · ' + file.fileName) + '</a></li>').join('') + '</ul></nav><article id="guide">' + guideBody(guide) + '</article></main></body></html>\n');
const sourcePaths = ['tests/fixtures/all-extensions-v6.json', 'tests/fixtures/all-extensions-v6.ids.json', 'tests/full-backup-fixture.cjs', 'tests/full-backup-verification.test.cjs', 'tests/synthetic-practice-fixture.cjs', 'tests/synthetic-samples.test.cjs', 'SAMPLE_GUIDE.md', starterPath, 'scripts/build-synthetic-samples.cjs', 'dist/cash-basis.js', 'dist/daily-cash.js', 'dist/spending-core.js', 'dist/spending-planning.js', 'dist/income-core.js', 'dist/retained-identities.js', 'dist/income-planning.js', 'dist/held-core.js', 'dist/held-funds.js', 'dist/personal-events.js', 'dist/ledger.js', 'dist/importer.js', 'dist/relations.js', 'dist/obligations.js', 'dist/organizer.js', 'dist/scenario.js'];
const manifest = { format: 'moneygo-synthetic-sample-manifest', version: 1, protocol: bundle.protocol, testedEngineRelease: bundle.testedEngineRelease, fixedReferenceDate: bundle.fixedReferenceDate,
  disclosure: 'All included sample files are authored synthetic data. Hashes establish reproduction/source provenance only, never bank authenticity, user-file provenance, financial completeness or browser acceptance.',
  starterProvenance: 'Independently built using Ledger.createEmpty, Ledger.putAccount, Ledger.validateState and Ledger.backup; persisted once with genuine generated ID/export time. No arrays stripped from complex seed and no versions rewritten.',
  complexProvenance: 'Exact bytes of tests/fixtures/all-extensions-v6.json. Original public-API builder and 86-test oracle are source-hashed; this build uses actual Ledger.verifyBackup.',
  reproducibility: 'node scripts/build-synthetic-samples.cjs --check compares deterministic artifacts from retained seed inputs. --create-starter is first-time authoring only; IDs and export timestamp legitimately differ for a newly authored starter. No Date or randomness monkeypatch.',
  sources: Object.fromEntries(sourcePaths.map(name => [name, { sha256: hash(read(name)), bytes: Buffer.byteLength(read(name)) }])),
  artifacts: Object.fromEntries([...outputs].map(([name, text]) => [name, { sha256: hash(text), bytes: Buffer.byteLength(text) }])),
  seeds: { complex: { schemaVersion: complex.state.version, counts: complex.counts }, starter: { schemaVersion: starter.state.version, counts: starter.counts } },
  limits: ['No native file picker or full browser/UI acceptance claimed.', 'Fixed transaction and reference dates are explicit; real model clocks and genuine audit/export timestamps are unchanged.', 'Session exports may include user-selected data and must use neutral session labels.'] };
outputs.set('SYNTHETIC_SAMPLE_MANIFEST.json', JSON.stringify(manifest, null, 2) + '\n');
for (const [name, text] of outputs) {
  if (process.argv.includes('--check')) { if (!fs.existsSync(path.join(root, name)) || read(name) !== text) throw Error('Generated artifact differs: ' + name); }
  else { fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), text); }
}
console.log((process.argv.includes('--check') ? 'Verified' : 'Generated') + ' ' + outputs.size + ' synthetic artifacts using real backup validation.');
