export type Severity = 'error' | 'warning' | 'information';

export interface GolangciConfig {
  version: '2';
  run?: {
    tests?: boolean;
    [key: string]: unknown;
  };
  linters?: {
    default?: string;
    enable?: string[];
    disable?: string[];
    settings?: Record<string, unknown>;
    exclusions?: Record<string, unknown>;
    [key: string]: unknown;
  };
  formatters?: {
    enable?: string[];
    settings?: Record<string, unknown>;
    exclusions?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ManagedProfile {
  name: string;
  description: string;
  yaml: string;
  config: GolangciConfig;
}

export interface ProfileSummary {
  id: string;
  fileName: string;
  name: string;
  description: string;
  enabledLinters: string[];
  enabledFormatters: string[];
  scope: 'global' | 'workspace';
  readOnly: boolean;
}

export interface ResolvedProfile {
  id: string;
  fileName: string;
  scope: 'global' | 'workspace';
  profile: ManagedProfile;
  uri: import('vscode').Uri;
}

export interface CatalogItem {
  name: string;
  description: string;
  fast?: boolean;
  autoFix?: boolean;
  deprecated?: boolean;
}

export interface LintProblem {
  uri?: string;
  fileName?: string;
  linter: string;
  message: string;
  severity: Severity;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  fixable: boolean;
}

export interface LintReport {
  scope: 'file' | 'workspace';
  uri: string;
  fileName: string;
  profileName: string;
  durationMs: number;
  errors: number;
  warnings: number;
  information: number;
  problems: LintProblem[];
  engine: string;
}

export interface GolangciTextEdit {
  Pos: number;
  End: number;
  NewText: string | null;
}

export interface GolangciIssue {
  FromLinter: string;
  Text: string;
  Severity?: string;
  Pos: {
    Filename: string;
    Offset: number;
    Line: number;
    Column: number;
  };
  SuggestedFixes?: Array<{
    Message?: string;
    TextEdits?: GolangciTextEdit[];
  }>;
}

export interface GolangciOutput {
  Issues?: GolangciIssue[];
  Report?: {
    Error?: string;
    Linters?: Array<{
      Name: string;
      Enabled?: boolean;
    }>;
  };
}

export function createDefaultConfig(): GolangciConfig {
  return {
    version: '2',
    run: {
      tests: false
    },
    linters: {
      default: 'none',
      enable: [
        'asciicheck',
        'bidichk',
        'bodyclose',
        'contextcheck',
        'copyloopvar',
        'cyclop',
        'decorder',
        'durationcheck',
        'err113',
        'errcheck',
        'errchkjson',
        'errname',
        'errorlint',
        'forbidigo',
        'forcetypeassert',
        'gochecknoglobals',
        'gochecknoinits',
        'goconst',
        'gocritic',
        'godox',
        'gosec',
        'govet',
        'ineffassign',
        'lll',
        'makezero',
        'misspell',
        'mnd',
        'nestif',
        'nilerr',
        'nlreturn',
        'noctx',
        'nonamedreturns',
        'paralleltest',
        'prealloc',
        'promlinter',
        'protogetter',
        'rowserrcheck',
        'sqlclosecheck',
        'staticcheck',
        'testpackage',
        'unconvert',
        'unparam',
        'unused',
        'usestdlibvars',
        'whitespace',
        'wsl_v5',
        'zerologlint'
      ],
      settings: {
        cyclop: {
          'max-complexity': 20
        },
        decorder: {
          'dec-order': ['const', 'var', 'type', 'func']
        },
        lll: {
          'line-length': 150
        }
      },
      exclusions: {
        generated: 'lax',
        presets: [
          'comments',
          'common-false-positives',
          'legacy',
          'std-error-handling'
        ],
        paths: [
          'third_party$',
          'builtin$',
          'examples$'
        ]
      }
    },
    formatters: {
      enable: ['gci', 'gofmt', 'gofumpt', 'goimports'],
      exclusions: {
        generated: 'lax',
        paths: [
          'third_party$',
          'builtin$',
          'examples$',
          'tmp$',
          'testing$',
          'infra/ent$'
        ]
      }
    }
  };
}

export function createDefaultProfile(
  language: 'ru' | 'en' = 'ru'
): ManagedProfile {
  return {
    name: language === 'en' ? 'New profile' : 'Новый профиль',
    description: language === 'en'
      ? 'golangci-lint v2 profile'
      : 'Профиль golangci-lint v2',
    yaml: '',
    config: createDefaultConfig()
  };
}

export function slugifyProfileName(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${slug || 'golangci'}.golangci.yml`;
}

export function globalProfileId(fileName: string): string {
  return `global:${fileName}`;
}

export function workspaceProfileId(fileName: string): string {
  return `workspace:${fileName}`;
}

export function parseProfileId(
  id: string
): { scope: 'global' | 'workspace'; fileName: string } {
  if (id.startsWith('global:')) {
    return { scope: 'global', fileName: id.slice('global:'.length) };
  }
  if (id.startsWith('workspace:')) {
    return { scope: 'workspace', fileName: id.slice('workspace:'.length) };
  }
  throw new Error('Некорректный идентификатор профиля.');
}

export function cloneProfile(profile: ManagedProfile): ManagedProfile {
  return JSON.parse(JSON.stringify(profile)) as ManagedProfile;
}
