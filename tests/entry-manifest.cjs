'use strict';
const fs = require('node:fs');
const path = require('node:path');

// Read the real entry without adapting source or replacing its bootstrap.
// Missing entry scripts must fail the host instead of silently being skipped.
function readEntryManifest(root = path.join(__dirname, '../dist')) {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const body = /<body\b([^>]*)>([\s\S]*?)<\/body\s*>/i.exec(html);
  if (!body) throw Error('Entry document has no body');
  const attrs = {};
  for (const attr of body[1].matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    attrs[attr[1]] = (attr[2] ?? attr[3] ?? attr[4] ?? '').replace(/&(?:amp|lt|gt|quot|#39);/g, value => ({'&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'"})[value]);
  }
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>\s*<\/script>/g)].map(match => match[1]);
  if (!scripts.length) throw Error('Entry document has no external scripts');
  for (const file of scripts) if (!/^[a-z0-9-]+\.js$/.test(file)) throw Error('Unexpected application script: ' + file);
  return { root, html, attrs, scripts, bodyHTML: body[2].split(/<script\b/i)[0] };
}

function applyBodyAttributes(body, entry) {
  body.attrs = { ...entry.attrs };
  body.dataset = Object.fromEntries(Object.entries(body.attrs).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
  body.getAttribute = name => body.attrs[name] ?? null;
  body.hasAttribute = name => Object.hasOwn(body.attrs, name);
  body.setAttribute = (name, value) => { body.attrs[name] = String(value); };
  body.removeAttribute = name => { delete body.attrs[name]; };
  return body;
}

// Keep the callable Map entries used by existing tests while modeling every
// registered listener, including independent module listeners and removal.
function addListener(listeners, type, callback) {
  let dispatch = listeners.get(type);
  if (!dispatch) {
    const callbacks = new Set();
    dispatch = event => { for (const callback of [...callbacks]) callback(event); };
    dispatch.callbacks = callbacks;
    listeners.set(type, dispatch);
  }
  dispatch.callbacks.add(callback);
}
function removeListener(listeners, type, callback) {
  const dispatch = listeners.get(type);
  if (!dispatch) return;
  dispatch.callbacks.delete(callback);
  if (!dispatch.callbacks.size) listeners.delete(type);
}
module.exports = { readEntryManifest, applyBodyAttributes, addListener, removeListener };
