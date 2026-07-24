'use strict';

const childProcess = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const platforms = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-armhf',
  'linux-x64',
  'alpine-arm64',
  'alpine-x64',
  'win32-arm64',
  'win32-x64'
];

for (const platform of platforms) {
  const result = childProcess.spawnSync(
    process.execPath,
    [path.join(root, 'scripts', 'package.js'), '--target', platform],
    {
      cwd: root,
      stdio: 'inherit'
    }
  );
  if (result.error || result.status !== 0) {
    throw result.error ||
      new Error(`Packaging ${platform} exited with ${result.status}`);
  }
}
