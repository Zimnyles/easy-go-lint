'use strict';

const fs = require('fs');
const path = require('path');

for (const target of [
  'dist',
  '.vsix-build',
  'easy-go-lint-1.0.0.vsix',
  'easy-go-lint-2.0.0.vsix',
  'easy-go-lint-2.0.1.vsix',
  'easy-go-lint-2.1.0.vsix',
  'easy-go-lint-2.1.1.vsix',
  'easy-go-lint-2.2.0.vsix',
  'easy-go-lint-2.2.1.vsix',
  'easy-go-lint-2.3.0.vsix'
]) {
  fs.rmSync(path.join(__dirname, '..', target), { recursive: true, force: true });
}
