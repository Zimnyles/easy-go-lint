'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = process.env.GOLANGCI_LINT_SOURCE;
const version = 'go1.27-pr6642-c4815f06';
const commit = 'c4815f06852754c8daa088b684d71fd88589b175';
const buildDate = '2026-07-24T05:45:00+05:00';
const targets = [
  { platformKey: 'darwin-arm64', goos: 'darwin', goarch: 'arm64' },
  { platformKey: 'darwin-x64', goos: 'darwin', goarch: 'amd64' },
  { platformKey: 'linux-arm64', goos: 'linux', goarch: 'arm64' },
  {
    platformKey: 'linux-armhf',
    goos: 'linux',
    goarch: 'arm',
    goarm: '7'
  },
  { platformKey: 'linux-x64', goos: 'linux', goarch: 'amd64' },
  { platformKey: 'win32-arm64', goos: 'windows', goarch: 'arm64' },
  { platformKey: 'win32-x64', goos: 'windows', goarch: 'amd64' }
];
const targetIndex = process.argv.indexOf('--target');
const requestedTarget = targetIndex >= 0
  ? process.argv[targetIndex + 1]
  : undefined;
if (
  requestedTarget &&
  !targets.some((target) => target.platformKey === requestedTarget)
) {
  throw new Error(`Unsupported build target: ${requestedTarget}`);
}

if (!source || !fs.existsSync(path.join(source, 'go.mod'))) {
  throw new Error(
    'Set GOLANGCI_LINT_SOURCE to the golangci-lint PR #6642 source checkout.'
  );
}

const sourceRevision = childProcess.spawnSync(
  'git',
  ['rev-parse', 'HEAD'],
  {
    cwd: source,
    encoding: 'utf8'
  }
);
if (
  sourceRevision.error ||
  sourceRevision.status !== 0 ||
  sourceRevision.stdout.trim() !== commit
) {
  throw new Error(
    `GOLANGCI_LINT_SOURCE must be checked out at ${commit}; got ${
      sourceRevision.stdout?.trim() || 'unknown'
    }.`
  );
}

for (const target of targets.filter(
  (item) => !requestedTarget || item.platformKey === requestedTarget
)) {
  const directory = path.join(
    root,
    'third_party',
    'golangci-lint',
    target.platformKey
  );
  const fileName = target.goos === 'windows'
    ? 'golangci-lint.exe'
    : 'golangci-lint';
  const output = path.join(directory, fileName);
  fs.mkdirSync(directory, { recursive: true });
  console.log(`building ${target.platformKey}`);
  const result = childProcess.spawnSync(
    'go',
    [
      'build',
      '-trimpath',
      '-ldflags',
      [
        '-s',
        '-w',
        `-X main.version=${version}`,
        `-X main.commit=${commit}`,
        `-X main.date=${buildDate}`
      ].join(' '),
      '-o',
      output,
      './cmd/golangci-lint'
    ],
    {
      cwd: source,
      env: {
        ...process.env,
        CGO_ENABLED: '0',
        GOOS: target.goos,
        GOARCH: target.goarch,
        ...(target.goarm ? { GOARM: target.goarm } : {}),
        GOCACHE: process.env.GOCACHE ||
          path.join(os.tmpdir(), 'easy-go-lint-cross-build-cache'),
        GOTOOLCHAIN: process.env.GOTOOLCHAIN || 'go1.27rc2'
      },
      stdio: 'inherit'
    }
  );
  if (result.error || result.status !== 0) {
    throw result.error ||
      new Error(`go build for ${target.platformKey} exited with ${result.status}`);
  }
  if (target.goos !== 'windows') {
    fs.chmodSync(output, 0o755);
  }
}

const checksums = targets.map((target) => {
  const fileName = target.goos === 'windows'
    ? 'golangci-lint.exe'
    : 'golangci-lint';
  const output = path.join(
    root,
    'third_party',
    'golangci-lint',
    target.platformKey,
    fileName
  );
  if (!fs.existsSync(output)) {
    throw new Error(`Missing bundled binary after build: ${output}`);
  }
  return `${
    crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex')
  }  ${target.platformKey}/${fileName}`;
});
fs.writeFileSync(
  path.join(root, 'third_party', 'golangci-lint', 'SHA256SUMS'),
  `${checksums.join('\n')}\n`
);
