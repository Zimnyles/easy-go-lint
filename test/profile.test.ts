import test = require('node:test');
import assert = require('node:assert/strict');
import {
  createDefaultProfile,
  globalProfileId,
  parseProfileId,
  slugifyProfileName,
  workspaceProfileId
} from '../src/model';
import {
  normalizeDeprecatedLinters,
  parseProfileYaml,
  serializeProfile,
  validateProfileObject
} from '../src/validation';
import {
  describePackageTypecheckFailure,
  selectIssuesForFile
} from '../src/issueSelection';
import {
  lintCacheKey,
  rememberWarmLintTarget
} from '../src/lintState';
import { applySuggestedFixes } from '../src/fixes';
import {
  bundledBinaryFor,
  bundledPlatformKeys
} from '../src/platform';
import {
  executeFile,
  ProcessCancelledError
} from '../src/processRunner';

test('default profile serializes as golangci-lint v2 YAML', () => {
  const profile = createDefaultProfile();
  const yaml = serializeProfile(profile);
  assert.match(yaml, /^# Easy Go Lint profile/mu);
  assert.match(yaml, /^version: "2"$/mu);
  assert.match(yaml, /^    - staticcheck$/mu);
  assert.match(yaml, /^      line-length: 150$/mu);

  const parsed = parseProfileYaml(yaml);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.profile?.config.version, '2');
  assert.equal(parsed.profile?.name, 'Новый профиль');
  assert.ok(parsed.profile?.config.linters?.enable?.includes('gosec'));
  assert.ok(parsed.profile?.config.linters?.enable?.includes('wsl_v5'));
  assert.ok(!parsed.profile?.config.linters?.enable?.includes('wsl'));
});

test('normalizes deprecated wsl profiles only for execution', () => {
  const original = createDefaultProfile();
  original.config.linters!.enable = ['govet', 'wsl'];
  original.config.linters!.settings = {
    wsl: {
      'allow-multiline-assign': true
    }
  };

  const normalized = normalizeDeprecatedLinters(original);

  assert.equal(normalized.changed, true);
  assert.deepEqual(original.config.linters?.enable, ['govet', 'wsl']);
  assert.deepEqual(
    normalized.profile.config.linters?.enable,
    ['govet', 'wsl_v5']
  );
  assert.equal(
    normalized.profile.config.linters?.settings?.wsl,
    undefined
  );
  assert.ok(
    normalized.profile.config.linters?.settings?.wsl_v5 !== undefined
  );
});

test('parses the required metadata and preserves unknown config fields', () => {
  const yaml = `# name: Backend
# description: Team rules
version: "2"
run:
  tests: false
custom-extension-field:
  enabled: true
linters:
  default: none
  enable:
    - govet
`;
  const parsed = parseProfileYaml(yaml);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.profile?.name, 'Backend');
  assert.deepEqual(parsed.profile?.config['custom-extension-field'], {
    enabled: true
  });
});

test('rejects non-v2 and malformed YAML profiles', () => {
  const old = parseProfileYaml('version: "1"\nlinters: {}\n');
  assert.equal(old.valid, false);
  assert.ok(old.errors.some((error) => error.includes('version')));

  const malformed = parseProfileYaml('version: "2"\nlinters:\n  enable: [\n');
  assert.equal(malformed.valid, false);
  assert.ok(malformed.errors.length > 0);
});

test('validates form profile and creates .golangci.yml filename', () => {
  const profile = createDefaultProfile();
  assert.equal(validateProfileObject(profile).valid, true);
  assert.equal(
    slugifyProfileName('Backend Rules'),
    'backend-rules.golangci.yml'
  );
  assert.equal(
    slugifyProfileName(' Команда / API '),
    'команда-api.golangci.yml'
  );
});

test('distinguishes global profiles from the current project config', () => {
  assert.equal(
    globalProfileId('backend.golangci.yml'),
    'global:backend.golangci.yml'
  );
  assert.equal(
    workspaceProfileId('.golangci.yml'),
    'workspace:.golangci.yml'
  );
  assert.deepEqual(parseProfileId('global:backend.golangci.yml'), {
    scope: 'global',
    fileName: 'backend.golangci.yml'
  });
  assert.deepEqual(parseProfileId('workspace:.golangci.yml'), {
    scope: 'workspace',
    fileName: '.golangci.yml'
  });
});

test('does not hide a package typecheck failure as zero file issues', () => {
  const selected = selectIssuesForFile(
    [
      {
        FromLinter: 'typecheck',
        Text: 'could not import dependency',
        Pos: {
          Filename: '/workspace/sibling.go',
          Offset: 0,
          Line: 17,
          Column: 2
        }
      }
    ],
    '/workspace/target.go'
  );

  assert.deepEqual(selected.issues, []);
  assert.equal(selected.packageTypecheckBlockers.length, 1);
  assert.match(
    describePackageTypecheckFailure(selected.packageTypecheckBlockers),
    /Результат «0 проблем» не показан/u
  );
});

test('keeps only diagnostics for the requested file', () => {
  const selected = selectIssuesForFile(
    [
      {
        FromLinter: 'mnd',
        Text: 'Magic number',
        Pos: {
          Filename: '/workspace/target.go',
          Offset: 0,
          Line: 5,
          Column: 4
        }
      },
      {
        FromLinter: 'mnd',
        Text: 'Magic number in sibling',
        Pos: {
          Filename: '/workspace/sibling.go',
          Offset: 0,
          Line: 8,
          Column: 4
        }
      }
    ],
    '/workspace/target.go'
  );

  assert.equal(selected.issues.length, 1);
  assert.equal(selected.issues[0]?.Text, 'Magic number');
  assert.deepEqual(selected.packageTypecheckBlockers, []);
});

test('tracks a warmed cache per engine, package and profile revision', () => {
  const identity = {
    engine: 'go1.27-build',
    binary: 'bundled',
    goToolchain: 'go1.27rc2',
    packageDirectory: '/workspace/pkg',
    profilePath: '/profiles/team.golangci.yml',
    profileMtime: 10,
    profileSize: 20
  };
  const first = lintCacheKey(identity);
  const changedProfile = lintCacheKey({
    ...identity,
    profileMtime: 11
  });

  assert.ok(first !== changedProfile);
  assert.deepEqual(
    rememberWarmLintTarget(['old', first], first),
    [first, 'old']
  );
});

test('Quick Fix treats null NewText as deletion and skips null no-op edits', () => {
  const result = applySuggestedFixes(
    'before remove after',
    [
      {
        FromLinter: 'formatter',
        Text: 'delete text',
        Pos: {
          Filename: '/workspace/target.go',
          Offset: 0,
          Line: 1,
          Column: 1
        },
        SuggestedFixes: [
          {
            TextEdits: [
              {
                Pos: 7,
                End: 14,
                NewText: null
              },
              {
                Pos: 0,
                End: 0,
                NewText: null
              }
            ]
          }
        ]
      }
    ]
  );

  assert.equal(result.text, 'before after');
  assert.equal(result.fixed, 1);
});

test('bundles native golangci-lint for all Cursor desktop platforms', () => {
  assert.deepEqual(bundledPlatformKeys, [
    'darwin-arm64',
    'darwin-x64',
    'linux-arm64',
    'linux-armhf',
    'linux-x64',
    'win32-arm64',
    'win32-x64'
  ]);
  assert.deepEqual(bundledBinaryFor('darwin', 'arm64'), {
    platformKey: 'darwin-arm64',
    fileName: 'golangci-lint'
  });
  assert.deepEqual(bundledBinaryFor('win32', 'x64'), {
    platformKey: 'win32-x64',
    fileName: 'golangci-lint.exe'
  });
  assert.deepEqual(bundledBinaryFor('linux', 'arm'), {
    platformKey: 'linux-armhf',
    fileName: 'golangci-lint'
  });
  assert.equal(bundledBinaryFor('freebsd', 'x64'), undefined);
});

test('process runner cancels a running child process', async () => {
  let cancel = (): void => undefined;
  const token = {
    onCancellationRequested(listener: () => void) {
      cancel = listener;
      return { dispose: (): void => undefined };
    }
  };
  const running = executeFile(
    process.execPath,
    ['-e', 'setInterval(() => undefined, 1000)'],
    {
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 5000,
      maxOutputBytes: 1024
    },
    undefined,
    token
  );
  setTimeout(cancel, 30);
  await assert.rejects(
    running,
    (error: unknown) => error instanceof ProcessCancelledError
  );
});

test('process runner does not spawn when already cancelled', async () => {
  await assert.rejects(
    executeFile(
      process.execPath,
      ['-e', 'process.exit(0)'],
      {
        cwd: process.cwd(),
        env: process.env,
        timeoutMs: 5000,
        maxOutputBytes: 1024
      },
      undefined,
      {
        isCancellationRequested: true,
        onCancellationRequested: () => ({
          dispose: (): void => undefined
        })
      }
    ),
    (error: unknown) => error instanceof ProcessCancelledError
  );
});

test('process runner enforces its timeout', async () => {
  await assert.rejects(
    executeFile(
      process.execPath,
      ['-e', 'setInterval(() => undefined, 1000)'],
      {
        cwd: process.cwd(),
        env: process.env,
        timeoutMs: 30,
        maxOutputBytes: 1024
      }
    ),
    /лимит времени/u
  );
});
