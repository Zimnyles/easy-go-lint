import * as vscode from 'vscode';
import * as path from 'node:path';
import {
  bundledVersion,
  GolangciRunner,
  isProcessCancelled
} from './golangciRunner';
import { applySuggestedFixes } from './fixes';
import {
  createDefaultProfile,
  GolangciIssue,
  LintProblem,
  LintReport,
  ManagedProfile
} from './model';
import {
  DashboardHost,
  GoLinterPanel,
  GoLinterSidebarProvider
} from './panel';
import { ProfileStore } from './profileStore';
import {
  parseProfileYaml,
  serializeProfile,
  validateProfileObject
} from './validation';
import {
  lintCacheKey,
  rememberWarmLintTarget
} from './lintState';
import {
  outputError,
  outputInfo,
  outputWarning
} from './output';

const diagnosticSource = 'Easy Go Lint · golangci-lint';
const warmLintTargetsKey = 'easyGoLint.warmLintTargets.v2';

export function activate(context: vscode.ExtensionContext): void {
  const controller = new GoLinterController(context);
  context.subscriptions.push(controller);
  controller.register();
}

export function deactivate(): void {
  // ExtensionContext disposes all registered resources.
}

class GoLinterController implements vscode.Disposable, DashboardHost {
  private readonly output = vscode.window.createOutputChannel('Go Linter');
  private readonly diagnostics =
    vscode.languages.createDiagnosticCollection('easy-go-lint');
  private readonly store: ProfileStore;
  private readonly runner: GolangciRunner;
  private readonly sidebar: GoLinterSidebarProvider;
  private readonly initialization: Promise<void>;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly fixableDiagnosticKeys = new Set<string>();
  private activeOperation = '';

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.store = new ProfileStore(context, this.output);
    this.runner = new GolangciRunner(context, this.output);
    this.sidebar = new GoLinterSidebarProvider(context);
    this.initialization = Promise.all([
      this.store.initialize(),
      this.runner.initialize()
    ]).then(() => undefined).catch((error: unknown) => {
      this.output.appendLine(
        `Ошибка инициализации Easy Go Lint: ${toMessage(error)}`
      );
    });
  }

  public register(): void {
    this.disposables.push(
      this.output,
      this.diagnostics,
      vscode.commands.registerCommand('goLinter.open', () => this.openDashboard()),
      vscode.commands.registerCommand(
        'goLinter.lintCurrentFile',
        () => this.runCommand(
          () => this.runExclusive('Lint', () => this.lintCurrentFile())
        )
      ),
      vscode.commands.registerCommand(
        'goLinter.lintWorkspace',
        () => this.runCommand(
          () => this.runExclusive(
            'Lint Project',
            () => this.lintWorkspace()
          )
        )
      ),
      vscode.commands.registerCommand(
        'goLinter.fixCurrentFile',
        () => this.runCommand(
          () => this.runExclusive('Quick Fix', () => this.fixCurrentFile())
        )
      ),
      vscode.window.registerWebviewViewProvider(
        GoLinterSidebarProvider.viewType,
        this.sidebar
      ),
      vscode.languages.registerCodeActionsProvider(
        { language: 'go', scheme: 'file' },
        {
          provideCodeActions: (
            document,
            _range,
            actionContext
          ) => this.provideCodeActions(document, actionContext)
        },
        {
          providedCodeActionKinds: [vscode.CodeActionKind.QuickFix]
        }
      )
    );

    const watcher = vscode.workspace.createFileSystemWatcher(
      '**/.golangci.y{a,}ml'
    );
    const refresh = (): void => {
      void this.refreshDashboard();
    };
    watcher.onDidCreate(refresh, null, this.disposables);
    watcher.onDidChange(refresh, null, this.disposables);
    watcher.onDidDelete(refresh, null, this.disposables);
    this.disposables.push(
      watcher,
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        void this.store.initialize().then(() => this.refreshDashboard());
      }),
      vscode.window.onDidChangeActiveTextEditor(() => {
        void this.refreshDashboard();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (
          event.affectsConfiguration('goLinter.showResultsInOutput') ||
          event.affectsConfiguration('goLinter.showResultsInDashboard') ||
          event.affectsConfiguration('goLinter.language')
        ) {
          this.sidebar.refresh();
          void this.refreshDashboard();
        }
      })
    );
  }

  public dispose(): void {
    this.runner.dispose();
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  public async handleDashboardMessage(
    message: Record<string, unknown>,
    panel: GoLinterPanel
  ): Promise<void> {
    try {
      await this.initialization;
      const type = String(message.type ?? '');
      if (type === 'ready') {
        await this.refreshDashboard(panel);
      } else if (type === 'create') {
        await panel.openEditor(
          createDefaultProfile(this.language()),
          undefined,
          await this.runner.catalog(this.store.getWorkspaceFolder())
        );
      } else if (type === 'edit') {
        const folder = this.store.getWorkspaceFolder();
        const profileId = String(message.profileId ?? '');
        const resolved = await this.store.resolve(profileId, folder);
        if (resolved.scope === 'workspace') {
          throw new Error(
            'Конфигурация из корня проекта доступна только для чтения.'
          );
        }
        await panel.openEditor(
          resolved.profile,
          resolved.id,
          await this.runner.catalog(folder)
        );
      } else if (type === 'validateYaml') {
        await this.validateYamlMessage(message, panel);
      } else if (type === 'profileToYaml') {
        const result = validateProfileObject(message.profile);
        if (!result.valid || !result.profile) {
          await panel.showSaveError(result.errors);
        } else {
          await panel.openYaml(
            serializeProfile(result.profile),
            typeof message.fileName === 'string'
              ? message.fileName
              : undefined
          );
        }
      } else if (type === 'yamlToForm') {
        await this.yamlToForm(message, panel);
      } else if (type === 'saveProfile') {
        await this.saveProfileFromForm(message, panel);
      } else if (type === 'saveYaml') {
        await this.saveProfileFromYaml(message, panel);
      } else if (type === 'activate') {
        await this.activateProfile(String(message.profileId ?? ''));
      } else if (type === 'delete') {
        await this.deleteProfile(String(message.profileId ?? ''));
      } else if (type === 'import') {
        await this.importProfile();
      } else if (type === 'export') {
        await this.exportProfile(String(message.profileId ?? ''));
      } else if (type === 'updateResultDestinations') {
        await this.updateResultDestinations(message);
        await this.refreshDashboard(panel);
      } else if (type === 'updateLanguage') {
        await this.updateLanguage(message);
        this.sidebar.refresh();
        await this.refreshDashboard(panel);
      } else if (type === 'lint') {
        await this.runExclusive('Lint', () => this.lintCurrentFile());
      } else if (type === 'lintWorkspace') {
        await this.runExclusive(
          'Lint Project',
          () => this.lintWorkspace()
        );
      } else if (type === 'fix') {
        await this.runExclusive('Quick Fix', () => this.fixCurrentFile());
      } else if (type === 'openProblem') {
        await this.openProblem(
          String(message.uri ?? ''),
          Number(message.line ?? 0),
          Number(message.column ?? 0)
        );
      } else if (type === 'resetReport') {
        await this.resetReport(panel);
      }
    } catch (error) {
      if (isProcessCancelled(error)) {
        outputInfo(
          this.output,
          this.text(
            'Проверка отменена пользователем.',
            'The check was cancelled by the user.'
          )
        );
        await this.refreshDashboard(panel);
        return;
      }
      const text = toMessage(error);
      outputError(this.output, `Ошибка: ${text}`);
      this.output.show(true);
      await vscode.window.showErrorMessage(`Go Linter: ${text}`);
      await this.refreshDashboard(panel);
    }
  }

  private async openDashboard(): Promise<void> {
    const panel = GoLinterPanel.createOrShow(this.context, this);
    await this.refreshDashboard(panel);
  }

  private async refreshDashboard(
    panel: GoLinterPanel | undefined = GoLinterPanel.existing()
  ): Promise<void> {
    if (!panel) {
      return;
    }
    await this.initialization;
    const folder = this.store.getWorkspaceFolder();
    const destinations = this.resultDestinations();
    await panel.postState({
      workspaceName: folder
        ? `${folder.name} · golangci-lint ${bundledVersion}`
        : this.text(
            'Без открытого проекта · глобальные профили доступны',
            'No project is open · global profiles are available'
          ),
      profiles: await this.store.list(folder),
      activeProfile: await this.store.activeId(folder),
      showResultsInOutput: destinations.output,
      showResultsInDashboard: destinations.dashboard,
      language: this.language()
    });
  }

  private async validateYamlMessage(
    message: Record<string, unknown>,
    panel: GoLinterPanel
  ): Promise<void> {
    const requestId = Number(message.requestId ?? 0);
    const yaml = String(message.yaml ?? '');
    const parsed = parseProfileYaml(yaml);
    if (!parsed.valid) {
      await panel.showValidation(requestId, parsed.errors);
      return;
    }
    const result = await this.runner.verifyYamlText(
      yaml,
      requestId,
      this.store.getWorkspaceFolder()
    );
    await panel.showValidation(requestId, result.errors);
  }

  private async yamlToForm(
    message: Record<string, unknown>,
    panel: GoLinterPanel
  ): Promise<void> {
    const yaml = String(message.yaml ?? '');
    const fileName = typeof message.fileName === 'string'
      ? message.fileName
      : undefined;
    const parsed = parseProfileYaml(
      yaml,
      profileFallbackName(fileName)
    );
    if (!parsed.valid || !parsed.profile) {
      await panel.showSaveError(parsed.errors);
      return;
    }
    const verified = await this.runner.verifyYamlText(
      yaml,
      Date.now(),
      this.store.getWorkspaceFolder()
    );
    if (!verified.valid) {
      await panel.showSaveError(verified.errors);
      return;
    }
    await panel.openEditor(
      parsed.profile,
      fileName,
      await this.runner.catalog(this.store.getWorkspaceFolder())
    );
  }

  private async saveProfileFromForm(
    message: Record<string, unknown>,
    panel: GoLinterPanel
  ): Promise<void> {
    const result = validateProfileObject(message.profile);
    if (!result.valid || !result.profile) {
      await panel.showSaveError(result.errors);
      return;
    }
    const yaml = serializeProfile(result.profile);
    await this.validateAndSave(
      yaml,
      result.profile.name,
      typeof message.fileName === 'string' ? message.fileName : undefined,
      panel
    );
  }

  private async saveProfileFromYaml(
    message: Record<string, unknown>,
    panel: GoLinterPanel
  ): Promise<void> {
    const yaml = String(message.yaml ?? '');
    const parsed = parseProfileYaml(
      yaml,
      profileFallbackName(
        typeof message.fileName === 'string' ? message.fileName : undefined
      )
    );
    if (!parsed.valid || !parsed.profile) {
      await panel.showSaveError(parsed.errors);
      return;
    }
    await this.validateAndSave(
      yaml,
      parsed.profile.name,
      typeof message.fileName === 'string' ? message.fileName : undefined,
      panel
    );
  }

  private async validateAndSave(
    yaml: string,
    name: string,
    existingProfileId: string | undefined,
    panel: GoLinterPanel
  ): Promise<void> {
    const folder = this.store.getWorkspaceFolder();
    const validation = await this.runner.verifyYamlText(yaml, Date.now(), folder);
    if (!validation.valid) {
      await panel.showSaveError(validation.errors);
      return;
    }
    const saved = await this.store.writeYaml(
      yaml,
      existingProfileId,
      name
    );
    if (!(await this.store.activeId(folder))) {
      const makeActiveLabel = this.text('Сделать активным', 'Make active');
      const choice = await vscode.window.showInformationMessage(
        this.text(
          `Профиль «${saved.profile.name}» сохранён.`,
          `Profile "${saved.profile.name}" saved.`
        ),
        makeActiveLabel,
        this.text('Позже', 'Later')
      );
      if (choice === makeActiveLabel) {
        await this.store.setActive(saved.id, folder);
      }
    } else {
      await vscode.window.showInformationMessage(
        this.text(
          `Профиль «${saved.profile.name}» сохранён.`,
          `Profile "${saved.profile.name}" saved.`
        )
      );
    }
    await this.refreshDashboard(panel);
  }

  private async activateProfile(profileId: string): Promise<void> {
    const folder = this.store.getWorkspaceFolder();
    const resolved = await this.store.resolve(profileId, folder);
    const verified = await this.runner.verifyProfile(
      resolved.uri,
      folder
    );
    if (!verified.valid) {
      throw new Error(verified.errors.join('\n'));
    }
    await this.store.setActive(profileId, folder);
    await vscode.window.showInformationMessage(
      this.text(
        `Активный golangci-lint профиль: ${resolved.profile.name}.`,
        `Active golangci-lint profile: ${resolved.profile.name}.`
      )
    );
    await this.refreshDashboard();
  }

  private async deleteProfile(profileId: string): Promise<void> {
    const folder = this.store.getWorkspaceFolder();
    const resolved = await this.store.resolve(profileId, folder);
    if (resolved.scope === 'workspace') {
      throw new Error(
        'Конфигурация из корня проекта не удаляется через Easy Go Lint.'
      );
    }
    const deleteLabel = this.text('Удалить', 'Delete');
    const confirmation = await vscode.window.showWarningMessage(
      this.text(
        `Удалить профиль «${resolved.profile.name}»?`,
        `Delete profile "${resolved.profile.name}"?`
      ),
      { modal: true, detail: resolved.fileName },
      deleteLabel
    );
    if (confirmation !== deleteLabel) {
      return;
    }
    await this.store.remove(profileId);
    await this.refreshDashboard();
  }

  private async importProfile(): Promise<void> {
    const folder = this.store.getWorkspaceFolder();
    const selected = await vscode.window.showOpenDialog({
      canSelectMany: false,
      canSelectFiles: true,
      canSelectFolders: false,
      title: this.text(
        'Импортировать профиль golangci-lint v2',
        'Import a golangci-lint v2 profile'
      ),
      filters: {
        'golangci-lint profile': ['golangci.yml'],
        YAML: ['yml', 'yaml']
      }
    });
    if (!selected?.[0]) {
      return;
    }
    const bytes = await vscode.workspace.fs.readFile(selected[0]);
    const yaml = new TextDecoder().decode(bytes);
    const parsed = parseProfileYaml(
      yaml,
      selected[0].path.split('/').pop()?.replace(/\.golangci\.yml$/u, '') ??
        'golangci'
    );
    if (!parsed.valid || !parsed.profile) {
      throw new Error(parsed.errors.join('\n'));
    }
    const verification = await this.runner.verifyProfile(selected[0], folder);
    if (!verification.valid) {
      throw new Error(verification.errors.join('\n'));
    }
    const enabled = parsed.profile.config.linters?.enable ?? [];
    const importLabel = this.text('Импортировать', 'Import');
    const confirmation = await vscode.window.showInformationMessage(
      this.text(
        `Импортировать «${parsed.profile.name}»?`,
        `Import "${parsed.profile.name}"?`
      ),
      {
        modal: true,
        detail: this.text(
          `golangci-lint v2 · ${enabled.length} включённых линтеров: ${enabled.slice(0, 12).join(', ')}${enabled.length > 12 ? '…' : ''}`,
          `golangci-lint v2 · ${enabled.length} enabled linters: ${enabled.slice(0, 12).join(', ')}${enabled.length > 12 ? '…' : ''}`
        )
      },
      importLabel
    );
    if (confirmation !== importLabel) {
      return;
    }
    const saved = await this.store.writeYaml(
      yaml,
      undefined,
      parsed.profile.name
    );
    await this.refreshDashboard();
    const makeActiveLabel = this.text('Сделать активным', 'Make active');
    void Promise.resolve(vscode.window.showInformationMessage(
      this.text(
        `Профиль «${saved.profile.name}» импортирован.`,
        `Profile "${saved.profile.name}" imported.`
      ),
      makeActiveLabel
    )).then(async (makeActive) => {
      if (makeActive === makeActiveLabel) {
        await this.store.setActive(saved.id, folder);
        await this.refreshDashboard();
      }
    }).catch((error: unknown) => {
      this.output.appendLine(
        `Не удалось активировать импортированный профиль: ${toMessage(error)}`
      );
    });
  }

  private async exportProfile(profileId: string): Promise<void> {
    const folder = this.store.getWorkspaceFolder();
    const resolved = await this.store.resolve(profileId, folder);
    const destination = await vscode.window.showSaveDialog({
      title: this.text(
        'Экспортировать профиль golangci-lint',
        'Export golangci-lint profile'
      ),
      defaultUri: folder
        ? vscode.Uri.joinPath(folder.uri, resolved.fileName)
        : undefined,
      filters: {
        'golangci-lint profile': ['golangci.yml']
      }
    });
    if (!destination) {
      return;
    }
    await vscode.workspace.fs.writeFile(
      destination,
      new TextEncoder().encode(resolved.profile.yaml)
    );
    await vscode.window.showInformationMessage(
      this.text(
        `Профиль «${resolved.profile.name}» экспортирован.`,
        `Profile "${resolved.profile.name}" exported.`
      )
    );
  }

  private async lintCurrentFile(): Promise<LintReport | undefined> {
    const editor = this.currentGoEditor();
    if (!editor) {
      return undefined;
    }
    const folder = this.store.getWorkspaceFolder(editor.document.uri);
    if (!folder) {
      await vscode.window.showErrorMessage(
        this.text(
          'Go Linter: файл должен находиться в открытом workspace.',
          'Go Linter: the file must be inside an open workspace.'
        )
      );
      return undefined;
    }
    const active = await this.store.chooseActive(folder);
    if (!active) {
      return undefined;
    }
    if (editor.document.isDirty && !(await editor.document.save())) {
      throw new Error(this.text(
        'Сохраните текущий Go-файл перед проверкой.',
        'Save the current Go file before linting.'
      ));
    }

    const cacheKey = await this.lintCacheKey(
      editor.document,
      active.uri,
      folder
    );
    const coldCache = !this.isLintTargetWarm(cacheKey) ||
      !(await this.runner.hasPersistentLintCache());
    const panel = GoLinterPanel.createOrShow(this.context, this);
    await panel.showLintProgress({
      fileName: fileNameOf(editor.document),
      filePath: editor.document.uri.fsPath,
      profileName: active.profile.name,
      coldCache,
      startedAt: Date.now()
    });
    outputInfo(
      this.output,
      this.text(
        `▶ Lint запущен: ${editor.document.uri.fsPath} · профиль «${active.profile.name}». Выполняется, пожалуйста, подождите.`,
        `▶ Lint started: ${editor.document.uri.fsPath} · profile "${active.profile.name}". Please wait.`
      )
    );
    if (coldCache) {
      outputWarning(
        this.output,
        this.text(
          'Первый запуск для этого пакета и профиля: кэш ещё не прогрет. Проверка может занять больше времени; последующие запуски будут значительно быстрее.',
          'First run for this package and profile: the cache is cold. This check may take longer; subsequent runs will be much faster.'
        )
      );
    } else {
      outputInfo(
        this.output,
        this.text(
          'Кэш прогрет: повторная проверка должна завершиться быстрее.',
          'Cache is warm: this check should finish faster.'
        )
      );
    }
    this.output.show(true);

    try {
      return await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Window,
          title: `golangci-lint: ${fileNameOf(editor.document)}`,
          cancellable: true
        },
        async (_progress, token) => {
          const started = Date.now();
          const result = await this.runner.lint(
            editor.document,
            active.profile,
            active.uri,
            folder,
            token
          );
          await this.markLintTargetWarm(cacheKey);
          const problems = result.issues.map(toLintProblem);
          this.publishDiagnostics(editor.document, problems);
          const report = makeReport(
            editor.document,
            active.profile,
            problems,
            Date.now() - started,
            result.engine
          );
          outputInfo(
            this.output,
            this.text(
              `✓ Проверен ${editor.document.uri.fsPath}: ${problems.length} проблем, ${report.durationMs} мс`,
              `✓ Checked ${editor.document.uri.fsPath}: ${problems.length} problems, ${report.durationMs} ms`
            )
          );
          const destinations = this.resultDestinations();
          if (destinations.output) {
            this.writeReportToOutput(report);
          }
          await this.refreshDashboard(panel);
          await panel.showReport(report);
          return report;
        }
      );
    } catch (error) {
      await panel.showLintError(toMessage(error));
      throw error;
    }
  }

  private async lintWorkspace(): Promise<LintReport | undefined> {
    const folder = this.store.getWorkspaceFolder();
    if (!folder) {
      await vscode.window.showErrorMessage(
        this.text(
          'Go Linter: откройте папку проекта перед полной проверкой.',
          'Go Linter: open a project folder before running a full check.'
        )
      );
      return undefined;
    }
    const active = await this.store.chooseActive(folder);
    if (!active) {
      return undefined;
    }
    const dirtyDocuments = vscode.workspace.textDocuments.filter(
      (document) =>
        document.languageId === 'go' &&
        document.isDirty &&
        vscode.workspace.getWorkspaceFolder(document.uri)?.uri.toString() ===
          folder.uri.toString()
    );
    for (const document of dirtyDocuments) {
      if (!(await document.save())) {
        throw new Error(
          `Не удалось сохранить ${document.uri.fsPath} перед проверкой проекта.`
        );
      }
    }

    const cacheKey = await this.lintCacheKeyForTarget(
      folder.uri.fsPath,
      active.uri,
      folder
    );
    const coldCache = !this.isLintTargetWarm(cacheKey) ||
      !(await this.runner.hasPersistentLintCache());
    const panel = GoLinterPanel.createOrShow(this.context, this);
    await panel.showLintProgress({
      fileName: folder.name,
      filePath: folder.uri.fsPath,
      profileName: active.profile.name,
      coldCache,
      startedAt: Date.now()
    });
    outputInfo(
      this.output,
      this.text(
        `▶ Lint Project запущен: ${folder.uri.fsPath} · профиль «${active.profile.name}». Выполняется, пожалуйста, подождите.`,
        `▶ Lint Project started: ${folder.uri.fsPath} · profile "${active.profile.name}". Please wait.`
      )
    );
    if (coldCache) {
      outputWarning(
        this.output,
        this.text(
          'Первый полный запуск проекта: кэш ещё не прогрет. Он может занять заметно больше времени; последующие проверки будут быстрее.',
          'First full project run: the cache is cold. It can take considerably longer; subsequent checks will be faster.'
        )
      );
    }
    this.output.show(true);

    try {
      return await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: this.text(
            `golangci-lint: проект ${folder.name}`,
            `golangci-lint: project ${folder.name}`
          ),
          cancellable: true
        },
        async (_progress, token) => {
          const started = Date.now();
          const result = await this.runner.lintWorkspace(
            active.profile,
            active.uri,
            folder,
            token
          );
          await this.markLintTargetWarm(cacheKey);
          const problems = result.issues.map(toLintProblem);
          this.publishWorkspaceDiagnostics(problems);
          const report = makeWorkspaceReport(
            folder,
            active.profile,
            problems,
            Date.now() - started,
            result.engine
          );
          outputInfo(
            this.output,
            this.text(
              `✓ Проект проверен: ${folder.uri.fsPath}; ${problems.length} проблем, ${report.durationMs} мс`,
              `✓ Project checked: ${folder.uri.fsPath}; ${problems.length} problems, ${report.durationMs} ms`
            )
          );
          if (this.resultDestinations().output) {
            this.writeReportToOutput(report);
          }
          await this.refreshDashboard(panel);
          await panel.showReport(report);
          return report;
        }
      );
    } catch (error) {
      await panel.showLintError(toMessage(error));
      throw error;
    }
  }

  private async runCommand<T>(action: () => Promise<T>): Promise<T | undefined> {
    try {
      return await action();
    } catch (error) {
      if (isProcessCancelled(error)) {
        outputInfo(
          this.output,
          this.text(
            'Проверка отменена пользователем.',
            'The check was cancelled by the user.'
          )
        );
        this.output.show(true);
        return undefined;
      }
      const text = toMessage(error);
      outputError(this.output, `Ошибка: ${text}`);
      this.output.show(true);
      await vscode.window.showErrorMessage(`Go Linter: ${text}`);
      return undefined;
    }
  }

  private async runExclusive<T>(
    label: string,
    action: () => Promise<T>
  ): Promise<T | undefined> {
    if (this.activeOperation) {
      await vscode.window.showInformationMessage(
        this.text(
          `Go Linter: уже выполняется ${this.activeOperation}. Дождитесь завершения или отмените процесс в индикаторе прогресса.`,
          `Go Linter: ${this.activeOperation} is already running. Wait for it to finish or cancel it from the progress indicator.`
        )
      );
      return undefined;
    }
    this.activeOperation = label;
    try {
      await vscode.commands.executeCommand(
        'setContext',
        'goLinter.running',
        true
      );
      return await action();
    } finally {
      this.activeOperation = '';
      const cleanup = await Promise.allSettled([
        vscode.commands.executeCommand(
          'setContext',
          'goLinter.running',
          false
        ),
        this.refreshDashboard()
      ]);
      for (const result of cleanup) {
        if (result.status === 'rejected') {
          this.output.appendLine(
            `Не удалось обновить состояние интерфейса: ${toMessage(result.reason)}`
          );
        }
      }
    }
  }

  private async fixCurrentFile(): Promise<void> {
    const editor = this.currentGoEditor();
    if (!editor) {
      return;
    }
    const folder = this.store.getWorkspaceFolder(editor.document.uri);
    if (!folder) {
      throw new Error(this.text(
        'Go-файл должен находиться в открытом workspace.',
        'The Go file must be inside an open workspace.'
      ));
    }
    const active = await this.store.chooseActive(folder);
    if (!active) {
      return;
    }
    if (editor.document.isDirty && !(await editor.document.save())) {
      throw new Error(this.text(
        'Сохраните текущий Go-файл перед исправлением.',
        'Save the current Go file before applying fixes.'
      ));
    }

    const fixed = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: `golangci-lint Quick Fix: ${fileNameOf(editor.document)}`,
        cancellable: true
      },
      async (_progress, token) => {
        outputInfo(
          this.output,
          `▶ Quick Fix запущен: ${editor.document.uri.fsPath}`
        );
        const lintResult = await this.runner.lint(
          editor.document,
          active.profile,
          active.uri,
          folder,
          token
        );
        const original = editor.document.getText();
        const suggested = applySuggestedFixes(original, lintResult.issues);
        let updated = suggested.text;
        let fixedCount = suggested.fixed;
        const formatted = await this.runner.formatStdin(
          updated,
          active.profile,
          active.uri,
          editor.document,
          folder,
          token
        );
        if (formatted !== updated) {
          updated = formatted;
          fixedCount += 1;
        }
        if (updated !== original) {
          const edit = new vscode.WorkspaceEdit();
          edit.replace(
            editor.document.uri,
            new vscode.Range(
              new vscode.Position(0, 0),
              editor.document.positionAt(original.length)
            ),
            updated
          );
          if (!(await vscode.workspace.applyEdit(edit))) {
            throw new Error('Редактор отклонил исправления golangci-lint.');
          }
          await editor.document.save();
        }
        return fixedCount;
      }
    );
    const report = await this.lintCurrentFile();
    if (report) {
      // A notification without action buttons can remain pending until the user
      // dismisses it. It must not keep the single-flight operation lock active.
      void vscode.window.showInformationMessage(
        this.text(
          `golangci-lint: применено исправлений ${fixed}, осталось проблем ${report.problems.length}.`,
          `golangci-lint: applied ${fixed} fixes, ${report.problems.length} problems remain.`
        )
      );
    }
  }

  private publishDiagnostics(
    document: vscode.TextDocument,
    problems: LintProblem[]
  ): void {
    const uriPrefix = `${document.uri.toString()}|`;
    for (const key of Array.from(this.fixableDiagnosticKeys)) {
      if (key.startsWith(uriPrefix)) {
        this.fixableDiagnosticKeys.delete(key);
      }
    }
    const diagnostics = problems.map((item) => {
      const range = safeRange(document, item);
      const diagnostic = new vscode.Diagnostic(
        range,
        item.message,
        toDiagnosticSeverity(item.severity)
      );
      diagnostic.source = diagnosticSource;
      diagnostic.code = item.linter;
      if (item.fixable) {
        this.fixableDiagnosticKeys.add(
          diagnosticKey(document.uri, diagnostic, item.linter)
        );
      }
      return diagnostic;
    });
    this.diagnostics.set(document.uri, diagnostics);
  }

  private publishWorkspaceDiagnostics(problems: LintProblem[]): void {
    this.diagnostics.clear();
    this.fixableDiagnosticKeys.clear();
    const grouped = new Map<string, vscode.Diagnostic[]>();
    for (const problem of problems) {
      if (!problem.uri) {
        continue;
      }
      const uri = vscode.Uri.parse(problem.uri);
      const range = new vscode.Range(
        new vscode.Position(problem.line, problem.column),
        new vscode.Position(problem.endLine, problem.endColumn)
      );
      const diagnostic = new vscode.Diagnostic(
        range,
        problem.message,
        toDiagnosticSeverity(problem.severity)
      );
      diagnostic.source = diagnosticSource;
      diagnostic.code = problem.linter;
      if (problem.fixable) {
        this.fixableDiagnosticKeys.add(
          diagnosticKey(uri, diagnostic, problem.linter)
        );
      }
      const key = uri.toString();
      const diagnostics = grouped.get(key) ?? [];
      diagnostics.push(diagnostic);
      grouped.set(key, diagnostics);
    }
    for (const [uri, diagnostics] of grouped) {
      this.diagnostics.set(vscode.Uri.parse(uri), diagnostics);
    }
  }

  private provideCodeActions(
    document: vscode.TextDocument,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const fixable = context.diagnostics.filter((diagnostic) => {
      if (diagnostic.source !== diagnosticSource) {
        return false;
      }
      const code = typeof diagnostic.code === 'object'
        ? String(diagnostic.code.value)
        : String(diagnostic.code ?? '');
      return this.fixableDiagnosticKeys.has(
        diagnosticKey(document.uri, diagnostic, code)
      );
    });
    if (fixable.length === 0) {
      return [];
    }
    const action = new vscode.CodeAction(
      'golangci-lint: применить безопасные исправления',
      vscode.CodeActionKind.QuickFix
    );
    action.command = {
      command: 'goLinter.fixCurrentFile',
      title: 'Исправить текущий Go-файл'
    };
    action.diagnostics = fixable;
    action.isPreferred = true;
    return [action];
  }

  private resultDestinations(): {
    output: boolean;
    dashboard: boolean;
  } {
    const configuration = vscode.workspace.getConfiguration('goLinter');
    return {
      output: configuration.get<boolean>('showResultsInOutput', true),
      dashboard: configuration.get<boolean>('showResultsInDashboard', false)
    };
  }

  private language(): 'ru' | 'en' {
    return vscode.workspace
      .getConfiguration('goLinter')
      .get<'ru' | 'en'>('language', 'ru');
  }

  private text(russian: string, english: string): string {
    return this.language() === 'en' ? english : russian;
  }

  private async updateResultDestinations(
    message: Record<string, unknown>
  ): Promise<void> {
    const configuration = vscode.workspace.getConfiguration('goLinter');
    await Promise.all([
      configuration.update(
        'showResultsInOutput',
        message.output === true,
        vscode.ConfigurationTarget.Global
      ),
      configuration.update(
        'showResultsInDashboard',
        message.dashboard === true,
        vscode.ConfigurationTarget.Global
      )
    ]);
  }

  private async updateLanguage(
    message: Record<string, unknown>
  ): Promise<void> {
    const language = message.language;
    if (language !== 'ru' && language !== 'en') {
      return;
    }
    await vscode.workspace.getConfiguration('goLinter').update(
      'language',
      language,
      vscode.ConfigurationTarget.Global
    );
  }

  private writeReportToOutput(report: LintReport): void {
    const filePath = vscode.Uri.parse(report.uri).fsPath;
    outputInfo(
      this.output,
      this.text(
        `=== ${report.scope === 'workspace' ? 'Lint Project' : 'Lint'}: ${filePath} · профиль «${report.profileName}» ===`,
        `=== ${report.scope === 'workspace' ? 'Lint Project' : 'Lint'}: ${filePath} · profile "${report.profileName}" ===`
      )
    );
    if (report.problems.length === 0) {
      outputInfo(
        this.output,
        this.text('✓ Проблем не найдено.', '✓ No problems found.')
      );
    } else {
      for (const problem of report.problems) {
        const problemPath = problem.uri
          ? vscode.Uri.parse(problem.uri).fsPath
          : filePath;
        const message = `${problemPath}:${problem.line + 1}:${problem.column + 1}: ${
          severityLabel(problem.severity)
        } [${problem.linter}] ${problem.message}`;
        if (problem.severity === 'error') {
          outputError(this.output, message);
        } else if (problem.severity === 'warning') {
          outputWarning(this.output, message);
        } else {
          outputInfo(this.output, message);
        }
      }
    }
    const summary = this.text(
      `Итого: ошибок ${report.errors}, предупреждений ${report.warnings}, информации ${report.information}; ${report.durationMs} мс; ${report.engine}`,
      `Total: errors ${report.errors}, warnings ${report.warnings}, information ${report.information}; ${report.durationMs} ms; ${report.engine}`
    );
    if (report.errors > 0) {
      outputError(this.output, summary);
    } else if (report.warnings > 0) {
      outputWarning(this.output, summary);
    } else {
      outputInfo(this.output, summary);
    }
    this.output.show(true);
  }

  private async lintCacheKey(
    document: vscode.TextDocument,
    profileUri: vscode.Uri,
    folder: vscode.WorkspaceFolder
  ): Promise<string> {
    return this.lintCacheKeyForTarget(
      path.dirname(document.uri.fsPath),
      profileUri,
      folder
    );
  }

  private async lintCacheKeyForTarget(
    targetDirectory: string,
    profileUri: vscode.Uri,
    folder: vscode.WorkspaceFolder
  ): Promise<string> {
    const configuration = vscode.workspace.getConfiguration(
      'goLinter',
      folder.uri
    );
    const profileStat = await vscode.workspace.fs.stat(profileUri);
    return lintCacheKey({
      engine: bundledVersion,
      binary: configuration.get<string>('golangciLintPath', '').trim() ||
        'bundled',
      goToolchain: configuration.get<string>(
        'goToolchain',
        'auto'
      ),
      packageDirectory: targetDirectory,
      profilePath: profileUri.fsPath,
      profileMtime: profileStat.mtime,
      profileSize: profileStat.size
    });
  }

  private isLintTargetWarm(key: string): boolean {
    return this.context.globalState.get<string[]>(
      warmLintTargetsKey,
      []
    ).includes(key);
  }

  private async markLintTargetWarm(key: string): Promise<void> {
    const current = this.context.globalState.get<string[]>(
      warmLintTargetsKey,
      []
    );
    await this.context.globalState.update(
      warmLintTargetsKey,
      rememberWarmLintTarget(current, key)
    );
  }

  private async resetReport(panel: GoLinterPanel): Promise<void> {
    this.diagnostics.clear();
    this.fixableDiagnosticKeys.clear();
    await panel.clearReport();
    outputInfo(
      this.output,
      this.text(
        'Отчёт сброшен: предупреждения Easy Go Lint удалены из редактора и Problems.',
        'Report reset: Easy Go Lint diagnostics were removed from the editor and Problems.'
      )
    );
  }

  private currentGoEditor(): vscode.TextEditor | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'go') {
      void vscode.window.showWarningMessage(
        this.text(
          'Go Linter: откройте Go-файл в активном редакторе.',
          'Go Linter: open a Go file in the active editor.'
        )
      );
      return undefined;
    }
    return editor;
  }

  private async openProblem(
    uriValue: string,
    line: number,
    column: number
  ): Promise<void> {
    const document = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(uriValue)
    );
    const editor = await vscode.window.showTextDocument(document);
    const position = new vscode.Position(
      Math.max(0, Math.min(line, document.lineCount - 1)),
      Math.max(0, Math.min(column, document.lineAt(
        Math.max(0, Math.min(line, document.lineCount - 1))
      ).text.length))
    );
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(
      new vscode.Range(position, position),
      vscode.TextEditorRevealType.InCenterIfOutsideViewport
    );
  }
}

function toLintProblem(issue: GolangciIssue): LintProblem {
  const severity = mapSeverity(issue.Severity);
  const line = Math.max(0, issue.Pos.Line - 1);
  const column = Math.max(0, issue.Pos.Column - 1);
  const uri = issue.Pos.Filename
    ? vscode.Uri.file(issue.Pos.Filename).toString()
    : undefined;
  return {
    uri,
    fileName: issue.Pos.Filename
      ? path.basename(issue.Pos.Filename)
      : undefined,
    linter: issue.FromLinter || 'golangci-lint',
    message: issue.Text,
    severity,
    line,
    column,
    endLine: line,
    endColumn: column + 1,
    fixable: (issue.SuggestedFixes?.length ?? 0) > 0 ||
      ['gci', 'gofmt', 'gofumpt', 'goimports', 'golines'].includes(issue.FromLinter)
  };
}

function mapSeverity(value: string | undefined): LintProblem['severity'] {
  const normalized = value?.toLowerCase();
  if (normalized === 'error') {
    return 'error';
  }
  if (normalized === 'info' || normalized === 'information') {
    return 'information';
  }
  return 'warning';
}

function severityLabel(severity: LintProblem['severity']): string {
  if (severity === 'error') {
    return 'error';
  }
  if (severity === 'information') {
    return 'info';
  }
  return 'warning';
}

function makeReport(
  document: vscode.TextDocument,
  profile: ManagedProfile,
  problems: LintProblem[],
  durationMs: number,
  engine: string
): LintReport {
  return {
    scope: 'file',
    uri: document.uri.toString(),
    fileName: fileNameOf(document),
    profileName: profile.name,
    durationMs,
    errors: problems.filter((item) => item.severity === 'error').length,
    warnings: problems.filter((item) => item.severity === 'warning').length,
    information: problems.filter((item) => item.severity === 'information').length,
    problems,
    engine
  };
}

function makeWorkspaceReport(
  folder: vscode.WorkspaceFolder,
  profile: ManagedProfile,
  problems: LintProblem[],
  durationMs: number,
  engine: string
): LintReport {
  return {
    scope: 'workspace',
    uri: folder.uri.toString(),
    fileName: folder.name,
    profileName: profile.name,
    durationMs,
    errors: problems.filter((item) => item.severity === 'error').length,
    warnings: problems.filter((item) => item.severity === 'warning').length,
    information: problems.filter(
      (item) => item.severity === 'information'
    ).length,
    problems,
    engine
  };
}

function fileNameOf(document: vscode.TextDocument): string {
  return document.fileName.split(/[\\/]/u).pop() ?? document.fileName;
}

function safeRange(
  document: vscode.TextDocument,
  problem: LintProblem
): vscode.Range {
  const startLine = Math.max(0, Math.min(problem.line, document.lineCount - 1));
  const endLine = Math.max(startLine, Math.min(problem.endLine, document.lineCount - 1));
  const startColumn = Math.max(
    0,
    Math.min(problem.column, document.lineAt(startLine).text.length)
  );
  const endColumn = Math.max(
    endLine === startLine ? startColumn : 0,
    Math.min(problem.endColumn, document.lineAt(endLine).text.length)
  );
  return new vscode.Range(
    new vscode.Position(startLine, startColumn),
    new vscode.Position(endLine, endColumn)
  );
}

function toDiagnosticSeverity(
  severity: LintProblem['severity']
): vscode.DiagnosticSeverity {
  if (severity === 'error') {
    return vscode.DiagnosticSeverity.Error;
  }
  if (severity === 'information') {
    return vscode.DiagnosticSeverity.Information;
  }
  return vscode.DiagnosticSeverity.Warning;
}

function diagnosticKey(
  uri: vscode.Uri,
  diagnostic: vscode.Diagnostic,
  linter: string
): string {
  return `${uri.toString()}|${diagnostic.range.start.line}:${
    diagnostic.range.start.character
  }:${diagnostic.range.end.line}:${diagnostic.range.end.character}:${linter}`;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function profileFallbackName(profileId: string | undefined): string {
  return (profileId ?? 'golangci')
    .replace(/^(global|workspace):/u, '')
    .replace(/\.golangci\.ya?ml$/u, '') || 'golangci';
}
