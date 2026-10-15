'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
// Static regression guard for application-owned resources. This is not a claim
// about browser extensions, hosting authentication, transport logs or the OS.
test('all application assets pass the static network and code-generation guard',()=>{
 const root=path.join(__dirname,'../dist');
 const files=fs.readdirSync(root,{recursive:true}).filter(file=>fs.statSync(path.join(root,file)).isFile());
 for(const file of files.filter(file=>file.endsWith('.js'))) {
  const source=fs.readFileSync(path.join(root,file),'utf8');
  assert.doesNotMatch(source,/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/,file);
  assert.doesNotMatch(source,/\b(?:sendBeacon|importScripts)\s*\(/,file);
  assert.doesNotMatch(source,/\beval\s*\(|\bnew\s+Function\s*\(/,file);
 }
 for(const file of files.filter(file=>/\.(?:html|css)$/.test(file))) {
  const source=fs.readFileSync(path.join(root,file),'utf8');
  assert.doesNotMatch(source,/(?:src|href)\s*=\s*["'](?:https?:)?\/\//i,file);
  assert.doesNotMatch(source,/(?:url\(|@import\s*)["']?(?:https?:)?\/\//i,file);
 }
});
