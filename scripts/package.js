'use strict';

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(root, 'package.json'), 'utf8')
);
const targetBinaries = new Map([
  ['darwin-arm64', 'darwin-arm64'],
  ['darwin-x64', 'darwin-x64'],
  ['linux-arm64', 'linux-arm64'],
  ['linux-armhf', 'linux-armhf'],
  ['linux-x64', 'linux-x64'],
  ['alpine-arm64', 'linux-arm64'],
  ['alpine-x64', 'linux-x64'],
  ['win32-arm64', 'win32-arm64'],
  ['win32-x64', 'win32-x64']
]);
const platforms = Array.from(targetBinaries.keys());
const targetIndex = process.argv.indexOf('--target');
const target = targetIndex >= 0 ? process.argv[targetIndex + 1] : undefined;
if (targetIndex >= 0 && !target) {
  throw new Error('Expected a platform after --target.');
}
if (target && !platforms.includes(target)) {
  throw new Error(
    `Unsupported target ${target}. Expected one of: ${platforms.join(', ')}`
  );
}

const buildName = target || 'universal';
const stage = path.join(root, '.vsix-build', buildName);
const outputName = target
  ? `${packageJson.name}-${packageJson.version}-${target}.vsix`
  : `${packageJson.name}-${packageJson.version}.vsix`;
const output = path.join(root, outputName);

const binaryPlatforms = target
  ? [targetBinaries.get(target)]
  : Array.from(new Set(targetBinaries.values()));
verifyBinaries(binaryPlatforms);
fs.rmSync(stage, { recursive: true, force: true });
fs.rmSync(output, { force: true });
fs.mkdirSync(stage, { recursive: true });

for (const item of [
  'package.json',
  'README.md',
  'LICENSE',
  'THIRD_PARTY_NOTICES.md',
  '.vscodeignore',
  'media',
  'schemas'
]) {
  fs.cpSync(path.join(root, item), path.join(stage, item), {
    recursive: true
  });
}
fs.mkdirSync(path.join(stage, 'dist'), { recursive: true });
fs.cpSync(
  path.join(root, 'dist', 'src'),
  path.join(stage, 'dist', 'src'),
  { recursive: true }
);
fs.mkdirSync(path.join(stage, 'node_modules'), { recursive: true });
fs.cpSync(
  path.join(root, 'node_modules', 'yaml'),
  path.join(stage, 'node_modules', 'yaml'),
  { recursive: true }
);
copyThirdParty(binaryPlatforms);

const vsce = path.join(root, 'node_modules', '@vscode', 'vsce', 'vsce');
const args = [
  vsce,
  'package',
  '--allow-missing-repository',
  '--out',
  output
];
if (target) {
  args.push('--target', target);
}

try {
  const result = childProcess.spawnSync(process.execPath, args, {
    cwd: stage,
    stdio: 'inherit'
  });
  if (result.error || result.status !== 0) {
    throw result.error ||
      new Error(`vsce exited with status ${result.status}`);
  }
  const smoke = childProcess.spawnSync(
    process.execPath,
    [path.join(root, 'scripts', 'vsix-smoke-test.js'), output],
    {
      cwd: root,
      stdio: 'inherit'
    }
  );
  if (smoke.error || smoke.status !== 0) {
    throw smoke.error ||
      new Error(`VSIX runtime smoke test exited with ${smoke.status}`);
  }
  console.log(output);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}

function verifyBinaries(targets) {
  for (const platformKey of targets) {
    const binary = binaryPath(platformKey);
    if (!fs.existsSync(binary) || fs.statSync(binary).size === 0) {
      throw new Error(`Missing bundled binary: ${binary}`);
    }
  }
}

function copyThirdParty(targets) {
  const destination = path.join(stage, 'third_party', 'golangci-lint');
  fs.mkdirSync(destination, { recursive: true });
  for (const item of ['LICENSE', 'README.md', 'SHA256SUMS']) {
    fs.cpSync(
      path.join(root, 'third_party', 'golangci-lint', item),
      path.join(destination, item)
    );
  }
  for (const platformKey of targets) {
    fs.cpSync(
      path.join(root, 'third_party', 'golangci-lint', platformKey),
      path.join(destination, platformKey),
      { recursive: true }
    );
  }
}

function binaryPath(platformKey) {
  const fileName = platformKey.startsWith('win32-')
    ? 'golangci-lint.exe'
    : 'golangci-lint';
  return path.join(
    root,
    'third_party',
    'golangci-lint',
    platformKey,
    fileName
  );
}
