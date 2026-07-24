import * as vscode from 'vscode';
import {
  CatalogItem,
  LintReport,
  ManagedProfile,
  ProfileSummary
} from './model';

export interface DashboardState {
  workspaceName: string;
  profiles: ProfileSummary[];
  activeProfile: string;
  showResultsInOutput: boolean;
  showResultsInDashboard: boolean;
  language: 'ru' | 'en';
}

export interface DashboardHost {
  handleDashboardMessage(
    message: Record<string, unknown>,
    panel: GoLinterPanel
  ): Promise<void>;
}

export interface LintStatus {
  phase: 'running' | 'error';
  fileName: string;
  filePath: string;
  profileName: string;
  coldCache: boolean;
  startedAt: number;
  message?: string;
}

export class GoLinterPanel {
  private static current: GoLinterPanel | undefined;
  private readonly disposables: vscode.Disposable[] = [];
  private lastReport: LintReport | undefined;
  private lintStatus: LintStatus | undefined;

  public static createOrShow(
    context: vscode.ExtensionContext,
    host: DashboardHost
  ): GoLinterPanel {
    if (GoLinterPanel.current) {
      GoLinterPanel.current.panel.reveal(vscode.ViewColumn.One);
      return GoLinterPanel.current;
    }

    const panel = vscode.window.createWebviewPanel(
      'easyGoLint',
      'Easy Go Lint',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(context.extensionUri, 'media')
        ]
      }
    );
    GoLinterPanel.current = new GoLinterPanel(panel, context, host);
    return GoLinterPanel.current;
  }

  public static existing(): GoLinterPanel | undefined {
    return GoLinterPanel.current;
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    context: vscode.ExtensionContext,
    host: DashboardHost
  ) {
    this.panel.webview.html = this.html(context);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      async (message: Record<string, unknown>) => {
        await host.handleDashboardMessage(message, this);
      },
      null,
      this.disposables
    );
  }

  public reveal(): void {
    this.panel.reveal(vscode.ViewColumn.One);
  }

  public async postState(state: DashboardState): Promise<void> {
    await this.panel.webview.postMessage({
      type: 'state',
      state,
      report: this.lastReport ?? null,
      lintStatus: this.lintStatus ?? null
    });
  }

  public async openEditor(
    profile: ManagedProfile,
    fileName: string | undefined,
    catalog: { linters: CatalogItem[]; formatters: CatalogItem[] }
  ): Promise<void> {
    this.reveal();
    await this.panel.webview.postMessage({
      type: 'editProfile',
      profile,
      fileName: fileName ?? null,
      catalog
    });
  }

  public async showValidation(
    requestId: number,
    errors: string[]
  ): Promise<void> {
    await this.panel.webview.postMessage({
      type: 'validationResult',
      requestId,
      errors
    });
  }

  public async openYaml(yaml: string, fileName?: string): Promise<void> {
    this.reveal();
    await this.panel.webview.postMessage({
      type: 'editYaml',
      yaml,
      fileName: fileName ?? null
    });
  }

  public async showSaveError(errors: string[]): Promise<void> {
    await this.panel.webview.postMessage({
      type: 'saveError',
      errors
    });
  }

  public async showReport(report: LintReport): Promise<void> {
    this.lastReport = report;
    this.lintStatus = undefined;
    this.reveal();
    await this.panel.webview.postMessage({
      type: 'report',
      report
    });
  }

  public async showLintProgress(
    status: Omit<LintStatus, 'phase' | 'message'>
  ): Promise<void> {
    this.lintStatus = {
      ...status,
      phase: 'running'
    };
    this.reveal();
    await this.panel.webview.postMessage({
      type: 'lintStatus',
      status: this.lintStatus
    });
  }

  public async showLintError(message: string): Promise<void> {
    if (!this.lintStatus) {
      return;
    }
    this.lintStatus = {
      ...this.lintStatus,
      phase: 'error',
      message
    };
    this.reveal();
    await this.panel.webview.postMessage({
      type: 'lintStatus',
      status: this.lintStatus
    });
  }

  public async clearReport(): Promise<void> {
    this.lastReport = undefined;
    this.lintStatus = undefined;
    await this.panel.webview.postMessage({
      type: 'clearReport'
    });
  }

  private dispose(): void {
    GoLinterPanel.current = undefined;
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }

  private html(context: vscode.ExtensionContext): string {
    const webview = this.panel.webview;
    const css = webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'media', 'webview.css')
    );
    const script = webview.asWebviewUri(
      vscode.Uri.joinPath(context.extensionUri, 'media', 'webview.js')
    );
    const nonce = createNonce();
    return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${css}">
  <title>Easy Go Lint</title>
</head>
<body>
  <main id="app" aria-live="polite"></main>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

export class GoLinterSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'goLinter.sidebar';
  private view: vscode.WebviewView | undefined;

  public constructor(private readonly context: vscode.ExtensionContext) {}

  public resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true
    };
    this.render(view);
    view.onDidDispose(() => {
      if (this.view === view) {
        this.view = undefined;
      }
    });
    view.webview.onDidReceiveMessage(
      async (message: { type?: string; language?: string }) => {
        if (message.type === 'open') {
          await vscode.commands.executeCommand('goLinter.open');
        } else if (
          message.type === 'language' &&
          (message.language === 'ru' || message.language === 'en')
        ) {
          await vscode.workspace.getConfiguration('goLinter').update(
            'language',
            message.language,
            vscode.ConfigurationTarget.Global
          );
          this.refresh();
        }
      }
    );
  }

  public refresh(): void {
    if (this.view) {
      this.render(this.view);
    }
  }

  private render(view: vscode.WebviewView): void {
    const language = vscode.workspace
      .getConfiguration('goLinter')
      .get<'ru' | 'en'>('language', 'ru');
    const text = language === 'en'
      ? {
          description: 'golangci-lint v2 · global *.golangci.yml profiles',
          open: 'Open Easy Go Lint',
          language: 'Interface language'
        }
      : {
          description: 'golangci-lint v2 · профили *.golangci.yml',
          open: 'Открыть Easy Go Lint',
          language: 'Язык интерфейса'
        };
    const nonce = createNonce();
    view.webview.html = `<!doctype html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <style nonce="${nonce}">
    body { padding: 16px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
    .card { padding: 16px; border: 1px solid var(--vscode-widget-border); border-radius: 8px; background: var(--vscode-sideBar-background); }
    h2 { margin: 0 0 8px; font-size: 16px; }
    p { color: var(--vscode-descriptionForeground); line-height: 1.5; }
    button { width: 100%; margin-top: 8px; padding: 9px 12px; color: var(--vscode-button-foreground); border: 0; border-radius: 5px; background: var(--vscode-button-background); cursor: pointer; }
    .language-label { display: block; margin-top: 16px; color: var(--vscode-descriptionForeground); font-size: 12px; }
    .languages { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .languages button { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
    .languages button.active { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  </style>
</head>
<body>
  <section class="card">
    <h2>Easy Go Lint</h2>
    <p>${text.description}</p>
    <button id="open">${text.open}</button>
    <span class="language-label">${text.language}</span>
    <div class="languages" role="group" aria-label="${text.language}">
      <button class="${language === 'ru' ? 'active' : ''}" data-language="ru" aria-pressed="${language === 'ru'}">RU</button>
      <button class="${language === 'en' ? 'active' : ''}" data-language="en" aria-pressed="${language === 'en'}">EN</button>
    </div>
  </section>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('open').addEventListener('click', () => vscode.postMessage({ type: 'open' }));
    document.querySelectorAll('[data-language]').forEach((button) => {
      button.addEventListener('click', () => vscode.postMessage({
        type: 'language',
        language: button.dataset.language
      }));
    });
  </script>
</body>
</html>`;
  }
}

function createNonce(): string {
  const alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let value = '';
  for (let index = 0; index < 32; index += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return value;
}
