'use strict';

const assert = require('assert/strict');
const childProcess = require('child_process');
const fs = require('fs');
const Module = require('module');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8')
);
const explicitVsix = process.argv[2];
const vsix = explicitVsix
  ? path.resolve(root, explicitVsix)
  : path.join(root, `${packageJson.name}-${packageJson.version}.vsix`);
assert.ok(fs.existsSync(vsix), `VSIX does not exist: ${vsix}`);

const temporary = fs.mkdtempSync(
  path.join(os.tmpdir(), 'easy-go-lint-vsix-smoke-')
);
try {
  const unzip = childProcess.spawnSync(
    'unzip',
    ['-q', vsix, '-d', temporary],
    { stdio: 'inherit' }
  );
  assert.equal(unzip.status, 0, `Unable to extract ${vsix}`);
  const extension = path.join(temporary, 'extension');
  const manifest = JSON.parse(
    fs.readFileSync(path.join(extension, 'package.json'), 'utf8')
  );
  assert.ok(
    fs.existsSync(path.join(extension, manifest.main)),
    `Extension entry point is missing: ${manifest.main}`
  );
  assert.ok(
    fs.existsSync(path.join(extension, 'node_modules', 'yaml', 'package.json')),
    'Runtime dependency yaml is missing from the VSIX'
  );

  const validation = fs.readFileSync(
    path.join(extension, 'dist', 'src', 'validation.js'),
    'utf8'
  );
  assert.match(validation, /require\(["']yaml["']\)/u);

  const originalLoad = Module._load;
  try {
    Module._load = function (request, parent, isMain) {
      if (request === 'vscode') {
        return {};
      }
      return originalLoad.call(this, request, parent, isMain);
    };
    const entryPoint = require(path.join(extension, manifest.main));
    assert.equal(
      typeof entryPoint.activate,
      'function',
      'Extension activate export is missing'
    );
    assert.equal(
      typeof entryPoint.deactivate,
      'function',
      'Extension deactivate export is missing'
    );
  } finally {
    Module._load = originalLoad;
  }
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}

console.log(`VSIX runtime smoke test: OK (${path.basename(vsix)})`);
