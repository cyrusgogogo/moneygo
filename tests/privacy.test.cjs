'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
// Static regression guard for application-owned resources. This is not a claim
// about browser extensions, hosting authentication, transport logs or the OS.
test('real ledger resources contain no outbound data transmission or external resources',()=>{
 const root=path.join(__dirname,'../dist');
 for(const file of ['app.js','ledger.js','scenario.js','importer.js','relations.js','relations-ui.js']) {
  const source=fs.readFileSync(path.join(root,file),'utf8');
  assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/,file);
  assert.doesNotMatch(source,/\b(?:sendBeacon|importScripts)\s*\(/,file);
  assert.doesNotMatch(source,/\beval\s*\(|\bnew\s+Function\s*\(/,file);
 }
 for(const file of ['index.html','styles.css','relations-ui.css']) {
  const source=fs.readFileSync(path.join(root,file),'utf8');
  assert.doesNotMatch(source,/(?:src|href)\s*=\s*["'](?:https?:)?\/\//i,file);
  assert.doesNotMatch(source,/(?:url\(|@import\s*)["']?(?:https?:)?\/\//i,file);
 }
});
