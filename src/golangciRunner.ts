import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import {
  CatalogItem,
  GolangciIssue,
  GolangciOutput,
  ManagedProfile
} from './model';
import {
  describePackageTypecheckFailure,
  selectIssuesForFile
} from './issueSelection';
import {
  outputInfo,
  outputWarning
} from './output';
import { bundledBinaryFor } from './platform';
import {
  normalizeDeprecatedLinters,
  serializeProfile
} from './validation';
import {
  cancelAllProcesses,
  executeFile,
  ProcessResult
} from './processRunner';
import { lintOutputArguments } from './lintOutput';

export { isProcessCancelled } from './processRunner';

export const bundledVersion = 'go1.27-pr6642-c4815f06-preview';
const legacyCacheMigrationKey = 'easyGoLint.legacyGoBuildCacheRemoved.v1';

export interface GolangciLintResult {
  issues: GolangciIssue[];
  engine: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export class GolangciRunner {
  private readonly cacheRoot: vscode.Uri;
  private catalogCache:
    | { linters: CatalogItem[]; formatters: CatalogItem[] }
    | undefined;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel
  ) {
    this.cacheRoot = vscode.Uri.joinPath(
      context.globalStorageUri,
      'golangci-lint'
    );
  }

  public async initialize(): Promise<void> {
    await this.ensureRuntimeDirectories();
    if (this.context.globalState.get<boolean>(legacyCacheMigrationKey, false)) {
      return;
    }
    const legacy = vscode.Uri.joinPath(this.cacheRoot, 'go-build-cache');
    try {
      await vscode.workspace.fs.delete(legacy, {
        recursive: true,
        useTrash: false
      });
      outputInfo(
        this.output,
        `Удалён неиспользуемый legacy Go build cache: ${legacy.fsPath}`
      );
    } catch (error) {
      if (!isMissingFileError(error)) {
        outputWarning(
          this.output,
          `Не удалось удалить legacy Go build cache: ${toMessage(error)}`
        );
        return;
      }
    }
    await this.context.globalState.update(legacyCacheMigrationKey, true);
  }

  public dispose(): void {
    cancelAllProcesses();
  }

  public async version(folder?: vscode.WorkspaceFolder): Promise<string> {
    const result = await this.execute(
      ['version', '--short'],
      folder?.uri.fsPath ?? this.context.extensionUri.fsPath,
      folder
    );
    return result.stdout.trim();
  }

  public async catalog(
    folder?: vscode.WorkspaceFolder
  ): Promise<{ linters: CatalogItem[]; formatters: CatalogItem[] }> {
    if (this.catalogCache) {
      return this.catalogCache;
    }
    const cwd = this.context.extensionUri.fsPath;
    const [lintersResult, formattersResult] = await Promise.all([
      this.execute(['linters', '--json', '--no-config'], cwd, folder),
      this.execute(['formatters', '--json', '--no-config'], cwd, folder)
    ]);
    this.catalogCache = {
      linters: parseCatalog(lintersResult.stdout),
      formatters: parseCatalog(formattersResult.stdout)
    };
    return this.catalogCache;
  }

  public async verifyProfile(
    profileUri: vscode.Uri,
    folder?: vscode.WorkspaceFolder,
    token?: vscode.CancellationToken
  ): Promise<ValidationResult> {
    const result = await this.execute(
      ['config', 'verify', '-c', profileUri.fsPath],
      this.cacheRoot.fsPath,
      folder,
      true,
      undefined,
      token
    );
    if (result.exitCode === 0) {
      return { valid: true, errors: [] };
    }
    return {
      valid: false,
      errors: [
        cleanCliError(
          result.stderr || result.stdout || 'Профиль не прошёл проверку.'
        )
      ]
    };
  }

  public async verifyYamlText(
    yaml: string,
    requestId: number,
    folder?: vscode.WorkspaceFolder,
    token?: vscode.CancellationToken
  ): Promise<ValidationResult> {
    await this.ensureRuntimeDirectories();
    const uri = vscode.Uri.joinPath(
      this.cacheRoot,
      `validation-${requestId}.golangci.yml`
    );
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(yaml));
    try {
      return await this.verifyProfile(uri, folder, token);
    } finally {
      await deleteIfExists(uri);
    }
  }

  public async lint(
    document: vscode.TextDocument,
    profile: ManagedProfile,
    profileUri: vscode.Uri,
    folder: vscode.WorkspaceFolder,
    token?: vscode.CancellationToken
  ): Promise<GolangciLintResult> {
    const result = await this.runLint(
      '.',
      path.dirname(document.uri.fsPath),
      profile,
      profileUri,
      folder,
      token
    );
    const selected = selectIssuesForFile(
      result.issues,
      document.uri.fsPath
    );
    if (selected.packageTypecheckBlockers.length > 0) {
      throw new Error(
        describePackageTypecheckFailure(selected.packageTypecheckBlockers)
      );
    }
    return {
      issues: selected.issues,
      engine: result.engine
    };
  }

  public async lintWorkspace(
    profile: ManagedProfile,
    profileUri: vscode.Uri,
    folder: vscode.WorkspaceFolder,
    token?: vscode.CancellationToken
  ): Promise<GolangciLintResult> {
    return this.runLint(
      './...',
      folder.uri.fsPath,
      profile,
      profileUri,
      folder,
      token
    );
  }

  public async formatStdin(
    source: string,
    profile: ManagedProfile,
    profileUri: vscode.Uri,
    document: vscode.TextDocument,
    folder: vscode.WorkspaceFolder,
    token?: vscode.CancellationToken
  ): Promise<string> {
    const formatters = profile.config.formatters?.enable ?? [];
    if (formatters.length === 0) {
      return source;
    }
    return this.withEffectiveProfile(
      profile,
      profileUri,
      async (effectiveUri) => {
        const result = await this.execute(
          ['fmt', '-c', effectiveUri.fsPath, '--stdin'],
          path.dirname(document.uri.fsPath),
          folder,
          false,
          source,
          token
        );
        return result.stdout;
      }
    );
  }

  public async hasPersistentLintCache(): Promise<boolean> {
    const directory = vscode.Uri.joinPath(this.cacheRoot, 'lint-cache');
    try {
      return (await vscode.workspace.fs.readDirectory(directory)).length > 0;
    } catch {
      return false;
    }
  }

  private async runLint(
    target: string,
    cwd: string,
    profile: ManagedProfile,
    profileUri: vscode.Uri,
    folder: vscode.WorkspaceFolder,
    token?: vscode.CancellationToken
  ): Promise<GolangciLintResult> {
    await this.ensureRuntimeDirectories();
    const resultId =
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const outputUri = vscode.Uri.joinPath(
      this.cacheRoot,
      `result-${resultId}.json`
    );
    const textOutputUri = vscode.Uri.joinPath(
      this.cacheRoot,
      `result-${resultId}.txt`
    );
    try {
      return await this.withEffectiveProfile(
        profile,
        profileUri,
        async (effectiveUri) => {
          const result = await this.execute(
            [
              'run',
              '-c',
              effectiveUri.fsPath,
              '--path-mode=abs',
              '--show-stats=false',
              ...lintOutputArguments(
                textOutputUri.fsPath,
                outputUri.fsPath
              ),
              '--max-issues-per-linter=0',
              '--max-same-issues=0',
              '--uniq-by-line=false',
              target
            ],
            cwd,
            folder,
            true,
            undefined,
            token
          );
          const parsed = await readGolangciOutput(outputUri);
          if (parsed.Report?.Error) {
            throw new Error(parsed.Report.Error);
          }
          if (result.exitCode !== 0 && result.exitCode !== 1) {
            throw new Error(
              cleanCliError(
                result.stderr ||
                `golangci-lint завершился с кодом ${result.exitCode}.`
              )
            );
          }
          return {
            issues: parsed.Issues ?? [],
            engine: `golangci-lint ${bundledVersion}`
          };
        }
      );
    } finally {
      await Promise.all([
        deleteIfExists(outputUri),
        deleteIfExists(textOutputUri)
      ]);
    }
  }

  private async withEffectiveProfile<T>(
    profile: ManagedProfile,
    originalUri: vscode.Uri,
    action: (profileUri: vscode.Uri) => Promise<T>
  ): Promise<T> {
    const normalized = normalizeDeprecatedLinters(profile);
    if (!normalized.changed) {
      return action(originalUri);
    }
    const uri = vscode.Uri.joinPath(
      this.cacheRoot,
      `effective-${Date.now()}-${Math.random().toString(36).slice(2)}.golangci.yml`
    );
    await vscode.workspace.fs.writeFile(
      uri,
      new TextEncoder().encode(serializeProfile(normalized.profile))
    );
    outputInfo(
      this.output,
      'Для запуска устаревший linter wsl автоматически заменён на wsl_v5; исходный профиль не изменён.'
    );
    try {
      return await action(uri);
    } finally {
      await deleteIfExists(uri);
    }
  }

  private async execute(
    args: string[],
    cwd: string,
    folder: vscode.WorkspaceFolder | undefined,
    acceptNonZero = false,
    stdin?: string,
    token?: vscode.CancellationToken
  ): Promise<ProcessResult> {
    const binary = this.binaryPath(folder);
    await this.ensureRuntimeDirectories();
    outputInfo(this.output, `$ ${binary} ${args.join(' ')}`);
    const configuration = vscode.workspace.getConfiguration(
      'goLinter',
      folder?.uri
    );
    const goToolchain = configuration.get<string>(
      'goToolchain',
      'auto'
    ).trim();
    const timeoutSeconds = clamp(
      configuration.get<number>('timeoutSeconds', 300),
      10,
      1800
    );
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      GOLANGCI_LINT_CACHE: vscode.Uri.joinPath(
        this.cacheRoot,
        'lint-cache'
      ).fsPath
    };
    if (goToolchain) {
      environment.GOTOOLCHAIN = goToolchain;
    }
    const result = await executeFile(
      binary,
      args,
      {
        cwd,
        env: environment,
        timeoutMs: timeoutSeconds * 1000,
        maxOutputBytes: 64 * 1024 * 1024
      },
      stdin,
      token
    );
    if (result.stderr.trim()) {
      outputWarning(this.output, result.stderr.trim());
    }
    if (!acceptNonZero && result.exitCode !== 0) {
      throw new Error(cleanCliError(result.stderr || result.stdout));
    }
    return result;
  }

  private binaryPath(folder?: vscode.WorkspaceFolder): string {
    const configured = vscode.workspace
      .getConfiguration('goLinter', folder?.uri)
      .get<string>('golangciLintPath', '')
      .trim();
    if (configured) {
      return configured;
    }
    const bundled = bundledBinaryFor(process.platform, process.arch);
    if (!bundled) {
      throw new Error(
        `Для платформы ${process.platform}-${process.arch} нет встроенного golangci-lint. Укажите совместимый бинарник в goLinter.golangciLintPath.`
      );
    }
    return vscode.Uri.joinPath(
      this.context.extensionUri,
      'third_party',
      'golangci-lint',
      bundled.platformKey,
      bundled.fileName
    ).fsPath;
  }

  private async ensureRuntimeDirectories(): Promise<void> {
    await vscode.workspace.fs.createDirectory(
      vscode.Uri.joinPath(this.cacheRoot, 'lint-cache')
    );
  }
}

export function parseGolangciOutput(stdout: string): GolangciOutput {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return { Issues: [] };
  }
  try {
    return JSON.parse(trimmed) as GolangciOutput;
  } catch (error) {
    throw new Error(
      `golangci-lint вернул некорректный JSON: ${toMessage(error)}`
    );
  }
}

async function readGolangciOutput(uri: vscode.Uri): Promise<GolangciOutput> {
  try {
    const bytes = await fs.readFile(uri.fsPath);
    return parseGolangciOutput(new TextDecoder().decode(bytes));
  } catch (error) {
    if (isMissingFileError(error)) {
      return { Issues: [] };
    }
    throw error;
  }
}

function parseCatalog(stdout: string): CatalogItem[] {
  const raw = JSON.parse(stdout) as {
    Enabled?: CatalogItem[] | null;
    Disabled?: CatalogItem[] | null;
  };
  return [...(raw.Enabled ?? []), ...(raw.Disabled ?? [])]
    .sort((left, right) => left.name.localeCompare(right.name));
}

function cleanCliError(value: string): string {
  return value
    .replace(/^level=\w+\s+msg=/gmu, '')
    .replace(/^"|"$/gu, '')
    .trim();
}

async function deleteIfExists(uri: vscode.Uri): Promise<void> {
  await fs.rm(uri.fsPath, {
    force: true
  });
}

function isMissingFileError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null &&
    'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  return code === 'FileNotFound' ||
    code === 'ENOENT' ||
    /not found|enoent|FileNotFound/iu.test(toMessage(error));
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }
  return Math.max(minimum, Math.min(maximum, value));
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
