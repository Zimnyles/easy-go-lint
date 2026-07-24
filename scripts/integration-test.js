'use strict';

const assert = require('assert/strict');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const platformKey = process.platform === 'linux' && process.arch === 'arm'
  ? 'linux-armhf'
  : `${process.platform}-${process.arch}`;
const supportedPlatforms = new Set([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-armhf',
  'linux-x64',
  'win32-arm64',
  'win32-x64'
]);
const binaryName = process.platform === 'win32'
  ? 'golangci-lint.exe'
  : 'golangci-lint';
const binary = path.join(
  root,
  'third_party',
  'golangci-lint',
  platformKey,
  binaryName
);

if (!supportedPlatforms.has(platformKey)) {
  console.log('golangci-lint integration test skipped on this platform');
  process.exit(0);
}

const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-go-lint-test-'));
const env = {
  ...process.env,
  GOTOOLCHAIN: process.env.EASY_GO_LINT_TEST_TOOLCHAIN || 'go1.27rc2',
  GOCACHE: path.join(cache, 'go-build'),
  GOLANGCI_LINT_CACHE: path.join(cache, 'lint-cache')
};
const { createDefaultProfile } = require('../dist/src/model');
const { serializeProfile } = require('../dist/src/validation');
const defaultProfilePath = path.join(cache, 'default.golangci.yml');
fs.writeFileSync(defaultProfilePath, serializeProfile(createDefaultProfile()));

const verifyDefault = childProcess.spawnSync(
  binary,
  ['config', 'verify', '-c', defaultProfilePath],
  {
    cwd: path.join(root, 'test', 'fixtures', 'golangci-project'),
    env,
    encoding: 'utf8'
  }
);
assert.equal(verifyDefault.status, 0, verifyDefault.stderr);

const run = childProcess.spawnSync(
  binary,
  [
    'run',
    '-c',
    'profile.golangci.yml',
    '--path-mode=abs',
    '--show-stats=false',
    `--output.text.path=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`,
    '--output.json.path=stdout'
  ],
  {
    cwd: path.join(root, 'test', 'fixtures', 'golangci-project'),
    env,
    encoding: 'utf8'
  }
);

assert.equal(run.status, 1, run.stderr);
const output = JSON.parse(run.stdout);
assert.ok(output.Issues.some((issue) => issue.FromLinter === 'forbidigo'));

const go127Run = childProcess.spawnSync(
  binary,
  [
    'run',
    '-c',
    'profile.golangci.yml',
    '--path-mode=abs',
    '--show-stats=false',
    `--output.text.path=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`,
    '--output.json.path=stdout'
  ],
  {
    cwd: path.join(root, 'test', 'fixtures', 'go127-project'),
    env,
    encoding: 'utf8'
  }
);
assert.equal(go127Run.status, 1, go127Run.stderr);
const go127Output = JSON.parse(go127Run.stdout);
assert.ok(
  go127Output.Issues.some((issue) => issue.FromLinter === 'forbidigo')
);

const singleFilePackageRun = childProcess.spawnSync(
  binary,
  [
    'run',
    '-c',
    'profile.golangci.yml',
    '--path-mode=abs',
    '--show-stats=false',
    `--output.text.path=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`,
    '--output.json.path=stdout',
    '.'
  ],
  {
    cwd: path.join(root, 'test', 'fixtures', 'single-file-project'),
    env,
    encoding: 'utf8'
  }
);
assert.equal(singleFilePackageRun.status, 1, singleFilePackageRun.stderr);
const singleFileOutput = JSON.parse(singleFilePackageRun.stdout);
assert.ok(
  singleFileOutput.Issues.some(
    (issue) =>
      issue.FromLinter === 'forbidigo' &&
      issue.Pos.Filename.endsWith(`${path.sep}target.go`)
  )
);
assert.ok(
  !singleFileOutput.Issues.some(
    (issue) =>
      issue.FromLinter === 'typecheck' ||
      issue.Pos.Filename.endsWith(`${path.sep}nested.go`)
  )
);

const workspaceJson = path.join(cache, 'workspace-result.json');
const workspaceRun = childProcess.spawnSync(
  binary,
  [
    'run',
    '-c',
    'profile.golangci.yml',
    '--path-mode=abs',
    '--show-stats=false',
    `--output.text.path=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`,
    `--output.json.path=${workspaceJson}`,
    './...'
  ],
  {
    cwd: path.join(root, 'test', 'fixtures', 'single-file-project'),
    env,
    encoding: 'utf8'
  }
);
assert.equal(workspaceRun.status, 1, workspaceRun.stderr);
const workspaceOutput = JSON.parse(
  fs.readFileSync(workspaceJson, 'utf8')
);
assert.ok(
  workspaceOutput.Issues.some(
    (issue) =>
      issue.FromLinter === 'forbidigo' &&
      issue.Pos.Filename.endsWith(`${path.sep}nested.go`)
  )
);

const verify = childProcess.spawnSync(
  binary,
  ['config', 'verify', '-c', 'profile.golangci.yml'],
  {
    cwd: path.join(root, 'test', 'fixtures', 'golangci-project'),
    env,
    encoding: 'utf8'
  }
);
assert.equal(verify.status, 0, verify.stderr);
assert.equal(
  childProcess.execFileSync(binary, ['version', '--short'], {
    encoding: 'utf8'
  }).trim(),
  'go1.27-pr6642-c4815f06'
);

fs.rmSync(cache, { recursive: true, force: true });
console.log('golangci-lint integration: OK');
