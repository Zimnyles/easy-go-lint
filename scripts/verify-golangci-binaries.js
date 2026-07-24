'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'third_party', 'golangci-lint');
const checksums = fs.readFileSync(
  path.join(directory, 'SHA256SUMS'),
  'utf8'
).trim().split(/\r?\n/u);

assert.equal(checksums.length, 7, 'Expected seven bundled platform checksums');
for (const line of checksums) {
  const match = /^([a-f0-9]{64}) {2}(.+)$/u.exec(line);
  assert.ok(match, `Invalid checksum line: ${line}`);
  const file = path.join(directory, match[2]);
  assert.ok(fs.statSync(file).size > 0, `Bundled binary is empty: ${file}`);
  const actual = crypto
    .createHash('sha256')
    .update(fs.readFileSync(file))
    .digest('hex');
  assert.equal(actual, match[1], `Checksum mismatch: ${match[2]}`);
}

console.log('bundled golangci-lint checksums: OK');
