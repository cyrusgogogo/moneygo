'use strict';
// Explicitly regenerate only the NEW synthetic v6 fixture using current public APIs.
// Never use this to regenerate any historical fixture or downgrade a version field.
const fs = require('node:fs');
const path = require('node:path');
const { buildFullBackupFixture, modules: { L } } = require('./full-backup-fixture.cjs');
const { state, ids } = buildFullBackupFixture();
const text = L.backup(state);
L.verifyBackup(text);
fs.writeFileSync(path.join(__dirname, 'fixtures/all-extensions-v6.json'), text + '\n');
fs.writeFileSync(path.join(__dirname, 'fixtures/all-extensions-v6.ids.json'), JSON.stringify(ids, null, 2) + '\n');
console.log('Generated and verified the synthetic all-extension v6 backup and its ID map.');
