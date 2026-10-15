'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
function files(directory, relative = '') {
  return fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
    if (entry.name === '.git' || entry.name === 'node_modules') return [];
    const name = path.join(relative, entry.name);
    assert.equal(entry.isSymbolicLink(), false, 'Unreviewed package symlink: ' + name);
    return entry.isDirectory() ? files(path.join(directory, entry.name), name) : [name];
  });
}

test('source package includes no editor or patch backup/reject artifacts of any extension', () => {
  const unexpected = files(root).filter(name => /(?:\.(?:orig|rej|bak|swp|swo)|~)$/i.test(name));
  assert.deepEqual(unexpected, []);
});

test('every shipped asset is explicitly supported and contains no hidden or temporary file', () => {
  const allowed = new Set(['.js', '.css', '.html', '.json', '.csv', '.tsv', '.svg', '.png', '.ico', '.webp']);
  for (const name of files(path.join(root, 'dist'))) {
    assert.ok(!name.split(path.sep).some(part => part.startsWith('.')), 'Hidden asset: ' + name);
    assert.ok(allowed.has(path.extname(name).toLowerCase()), 'Unreviewed asset type: ' + name);
  }
});
