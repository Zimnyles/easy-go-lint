import * as vscode from 'vscode';
import {
  globalProfileId,
  ManagedProfile,
  parseProfileId,
  ProfileSummary,
  ResolvedProfile,
  slugifyProfileName,
  workspaceProfileId
} from './model';
import {
  parseProfileYaml,
  serializeProfile,
  validateProfileObject
} from './validation';

const legacyProfileDirectory = ['.vscode', 'go-linter'];
const workspaceProfileNames = ['.golangci.yml', '.golangci.yaml'];
const activeGlobalProfileKey = 'easyGoLint.activeGlobalProfile.v1';
const activeWorkspaceProfilesKey = 'easyGoLint.activeWorkspaceProfiles.v1';

export class ProfileStore {
  private readonly globalDirectory: vscode.Uri;

  public constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel
  ) {
    this.globalDirectory = vscode.Uri.joinPath(
      context.globalStorageUri,
      'profiles'
    );
  }

  public async initialize(): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.globalDirectory);
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      await this.migrateLegacyProfiles(folder);
    }
  }

  public getWorkspaceFolder(
    uri: vscode.Uri | undefined = vscode.window.activeTextEditor?.document.uri
  ): vscode.WorkspaceFolder | undefined {
    return (
      (uri ? vscode.workspace.getWorkspaceFolder(uri) : undefined) ??
      vscode.workspace.workspaceFolders?.[0]
    );
  }

  public async list(
    folder?: vscode.WorkspaceFolder
  ): Promise<ProfileSummary[]> {
    const summaries = await this.listGlobalProfiles();
    if (folder) {
      summaries.push(...await this.listWorkspaceProfiles(folder));
    }
    return summaries.sort((left, right) => {
      if (left.scope !== right.scope) {
        return left.scope === 'workspace' ? -1 : 1;
      }
      return left.name.localeCompare(right.name, 'ru');
    });
  }

  public async read(
    id: string,
    folder?: vscode.WorkspaceFolder
  ): Promise<ManagedProfile> {
    const parsed = parseProfileId(id);
    this.assertFileName(parsed.scope, parsed.fileName);
    const uri = this.uriFor(parsed.scope, parsed.fileName, folder);
    const fallbackName = parsed.scope === 'workspace' && folder
      ? `Конфигурация проекта ${folder.name}`
      : parsed.fileName.replace(/\.golangci\.ya?ml$/u, '');
    return this.readUri(uri, fallbackName);
  }

  public async resolve(
    id: string,
    folder?: vscode.WorkspaceFolder
  ): Promise<ResolvedProfile> {
    const parsed = parseProfileId(id);
    return {
      id,
      fileName: parsed.fileName,
      scope: parsed.scope,
      profile: await this.read(id, folder),
      uri: this.uriFor(parsed.scope, parsed.fileName, folder)
    };
  }

  public async writeProfile(
    value: unknown,
    existingId?: string
  ): Promise<ResolvedProfile> {
    const result = validateProfileObject(value);
    if (!result.valid || !result.profile) {
      throw new Error(result.errors.join('\n'));
    }
    return this.writeYaml(
      serializeProfile(result.profile),
      existingId,
      result.profile.name
    );
  }

  public async writeYaml(
    yaml: string,
    existingId?: string,
    preferredName?: string
  ): Promise<ResolvedProfile> {
    const parsed = parseProfileYaml(yaml, preferredName || 'golangci');
    if (!parsed.valid || !parsed.profile) {
      throw new Error(parsed.errors.join('\n'));
    }
    await vscode.workspace.fs.createDirectory(this.globalDirectory);
    let fileName: string;
    if (existingId) {
      const existing = parseProfileId(existingId);
      if (existing.scope !== 'global') {
        throw new Error(
          'Конфигурация из корня проекта доступна только для чтения.'
        );
      }
      fileName = this.safeGlobalFileName(existing.fileName);
    } else {
      fileName = await this.availableFileName(
        slugifyProfileName(parsed.profile.name)
      );
    }
    const uri = vscode.Uri.joinPath(this.globalDirectory, fileName);
    await vscode.workspace.fs.writeFile(
      uri,
      new TextEncoder().encode(ensureFinalNewline(yaml))
    );
    const id = globalProfileId(fileName);
    this.output.appendLine(
      `Глобальный профиль golangci-lint сохранён: ${uri.fsPath}`
    );
    return {
      id,
      fileName,
      scope: 'global',
      profile: parsed.profile,
      uri
    };
  }

  public async remove(id: string): Promise<void> {
    const parsed = parseProfileId(id);
    if (parsed.scope !== 'global') {
      throw new Error(
        'Конфигурация проекта не удаляется через Easy Go Lint.'
      );
    }
    const fileName = this.safeGlobalFileName(parsed.fileName);
    await vscode.workspace.fs.delete(
      vscode.Uri.joinPath(this.globalDirectory, fileName)
    );
    if (
      this.context.globalState.get<string>(activeGlobalProfileKey, '') ===
      fileName
    ) {
      await this.context.globalState.update(activeGlobalProfileKey, undefined);
    }
    this.output.appendLine(`Глобальный профиль удалён: ${fileName}`);
  }

  public async activeId(
    folder?: vscode.WorkspaceFolder
  ): Promise<string> {
    if (folder) {
      const activeByFolder = this.activeWorkspaceProfiles();
      const fileName = activeByFolder[folder.uri.toString()];
      if (fileName) {
        const id = workspaceProfileId(fileName);
        try {
          await this.read(id, folder);
          return id;
        } catch {
          delete activeByFolder[folder.uri.toString()];
          await this.context.workspaceState.update(
            activeWorkspaceProfilesKey,
            activeByFolder
          );
        }
      }
    }

    const globalFileName = this.context.globalState.get<string>(
      activeGlobalProfileKey,
      ''
    );
    if (!globalFileName) {
      return '';
    }
    const id = globalProfileId(globalFileName);
    try {
      await this.read(id);
      return id;
    } catch {
      await this.context.globalState.update(activeGlobalProfileKey, undefined);
      return '';
    }
  }

  public async setActive(
    id: string,
    folder?: vscode.WorkspaceFolder
  ): Promise<void> {
    const resolved = await this.resolve(id, folder);
    if (resolved.scope === 'workspace') {
      if (!folder) {
        throw new Error(
          'Для конфигурации проекта не определена папка workspace.'
        );
      }
      const activeByFolder = this.activeWorkspaceProfiles();
      activeByFolder[folder.uri.toString()] = resolved.fileName;
      await this.context.workspaceState.update(
        activeWorkspaceProfilesKey,
        activeByFolder
      );
      return;
    }

    await this.context.globalState.update(
      activeGlobalProfileKey,
      resolved.fileName
    );
    if (folder) {
      const activeByFolder = this.activeWorkspaceProfiles();
      delete activeByFolder[folder.uri.toString()];
      await this.context.workspaceState.update(
        activeWorkspaceProfilesKey,
        activeByFolder
      );
    }
  }

  public async chooseActive(
    folder: vscode.WorkspaceFolder
  ): Promise<ResolvedProfile | undefined> {
    const active = await this.activeId(folder);
    if (active) {
      try {
        return await this.resolve(active, folder);
      } catch (error) {
        this.output.appendLine(
          `Активный профиль ${active} недоступен: ${toMessage(error)}`
        );
      }
    }

    const profiles = await this.list(folder);
    if (profiles.length === 0) {
      const action = await vscode.window.showInformationMessage(
        this.text(
          'Нет доступных профилей *.golangci.yml.',
          'No *.golangci.yml profiles are available.'
        ),
        this.text('Открыть Easy Go Lint', 'Open Easy Go Lint')
      );
      if (action) {
        await vscode.commands.executeCommand('goLinter.open');
      }
      return undefined;
    }
    const selected = await vscode.window.showQuickPick(
      profiles.map((profile) => ({
        label: profile.name,
        description: profile.scope === 'workspace'
          ? this.text(
              `${profile.fileName} · проект`,
              `${profile.fileName} · project`
            )
          : this.text(
              `${profile.fileName} · глобальный`,
              `${profile.fileName} · global`
            ),
        detail: this.text(
          `${profile.enabledLinters.length} линтеров`,
          `${profile.enabledLinters.length} linters`
        ),
        id: profile.id
      })),
      {
        title: this.text(
          'Выберите активный профиль golangci-lint',
          'Select the active golangci-lint profile'
        ),
        placeHolder: this.text(
          'Глобальные профили доступны во всех проектах',
          'Global profiles are available in every project'
        )
      }
    );
    if (!selected) {
      return undefined;
    }
    await this.setActive(selected.id, folder);
    return this.resolve(selected.id, folder);
  }

  public profileUri(
    id: string,
    folder?: vscode.WorkspaceFolder
  ): vscode.Uri {
    const parsed = parseProfileId(id);
    this.assertFileName(parsed.scope, parsed.fileName);
    return this.uriFor(parsed.scope, parsed.fileName, folder);
  }

  private async listGlobalProfiles(): Promise<ProfileSummary[]> {
    await vscode.workspace.fs.createDirectory(this.globalDirectory);
    const entries = await vscode.workspace.fs.readDirectory(
      this.globalDirectory
    );
    const summaries: ProfileSummary[] = [];
    for (const [fileName, type] of entries) {
      if (type !== vscode.FileType.File || !isProfileFile(fileName)) {
        continue;
      }
      const id = globalProfileId(fileName);
      try {
        const profile = await this.read(id);
        summaries.push(toSummary(id, fileName, profile, 'global', false));
      } catch (error) {
        this.output.appendLine(
          `Не удалось прочитать глобальный профиль ${fileName}: ${toMessage(error)}`
        );
      }
    }
    return summaries;
  }

  private async listWorkspaceProfiles(
    folder: vscode.WorkspaceFolder
  ): Promise<ProfileSummary[]> {
    const summaries: ProfileSummary[] = [];
    for (const fileName of workspaceProfileNames) {
      const id = workspaceProfileId(fileName);
      try {
        const profile = await this.read(id, folder);
        summaries.push(toSummary(id, fileName, profile, 'workspace', true));
      } catch (error) {
        if (!isMissingFileError(error)) {
          this.output.appendLine(
            `Не удалось прочитать ${fileName} из ${folder.name}: ${toMessage(error)}`
          );
        }
      }
    }
    return summaries;
  }

  private async readUri(
    uri: vscode.Uri,
    fallbackName: string
  ): Promise<ManagedProfile> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const result = parseProfileYaml(
      new TextDecoder().decode(bytes),
      fallbackName
    );
    if (!result.valid || !result.profile) {
      throw new Error(result.errors.join('\n'));
    }
    return result.profile;
  }

  private uriFor(
    scope: 'global' | 'workspace',
    fileName: string,
    folder?: vscode.WorkspaceFolder
  ): vscode.Uri {
    if (scope === 'global') {
      return vscode.Uri.joinPath(this.globalDirectory, fileName);
    }
    if (!folder) {
      throw new Error(
        'Для конфигурации проекта не определена папка workspace.'
      );
    }
    return vscode.Uri.joinPath(folder.uri, fileName);
  }

  private activeWorkspaceProfiles(): Record<string, string> {
    return {
      ...this.context.workspaceState.get<Record<string, string>>(
        activeWorkspaceProfilesKey,
        {}
      )
    };
  }

  private async migrateLegacyProfiles(
    folder: vscode.WorkspaceFolder
  ): Promise<void> {
    const legacyDirectory = vscode.Uri.joinPath(
      folder.uri,
      ...legacyProfileDirectory
    );
    let entries: [string, vscode.FileType][];
    try {
      entries = await vscode.workspace.fs.readDirectory(legacyDirectory);
    } catch (error) {
      if (isMissingFileError(error)) {
        return;
      }
      this.output.appendLine(
        `Не удалось проверить старые профили в ${folder.name}: ${toMessage(error)}`
      );
      return;
    }

    const migrated = new Map<string, string>();
    for (const [fileName, type] of entries) {
      if (type !== vscode.FileType.File || !isProfileFile(fileName)) {
        continue;
      }
      try {
        const source = vscode.Uri.joinPath(legacyDirectory, fileName);
        const bytes = await vscode.workspace.fs.readFile(source);
        const yaml = new TextDecoder().decode(bytes);
        const parsed = parseProfileYaml(
          yaml,
          fileName.replace(/\.golangci\.yml$/u, '')
        );
        if (!parsed.valid || !parsed.profile) {
          throw new Error(parsed.errors.join('\n'));
        }
        const destinationName = await this.migrationDestination(
          fileName,
          bytes
        );
        const destination = vscode.Uri.joinPath(
          this.globalDirectory,
          destinationName
        );
        if (!(await this.sameFileContents(destination, bytes))) {
          await vscode.workspace.fs.writeFile(destination, bytes);
          this.output.appendLine(
            `Профиль перенесён в глобальное хранилище: ${fileName} → ${destinationName}`
          );
        }
        migrated.set(fileName, destinationName);
      } catch (error) {
        this.output.appendLine(
          `Не удалось перенести ${fileName}: ${toMessage(error)}`
        );
      }
    }

    const legacyActive = vscode.workspace
      .getConfiguration('goLinter', folder.uri)
      .get<string>('activeProfile', '');
    const migratedActive = migrated.get(legacyActive);
    if (
      migratedActive &&
      !this.context.globalState.get<string>(activeGlobalProfileKey, '')
    ) {
      await this.context.globalState.update(
        activeGlobalProfileKey,
        migratedActive
      );
    }
  }

  private async migrationDestination(
    preferred: string,
    sourceBytes: Uint8Array
  ): Promise<string> {
    const preferredUri = vscode.Uri.joinPath(this.globalDirectory, preferred);
    try {
      const existing = await vscode.workspace.fs.readFile(preferredUri);
      if (equalBytes(existing, sourceBytes)) {
        return preferred;
      }
      const entries = await vscode.workspace.fs.readDirectory(
        this.globalDirectory
      );
      for (const [fileName, type] of entries) {
        if (type !== vscode.FileType.File || !isProfileFile(fileName)) {
          continue;
        }
        if (
          await this.sameFileContents(
            vscode.Uri.joinPath(this.globalDirectory, fileName),
            sourceBytes
          )
        ) {
          return fileName;
        }
      }
      return this.availableFileName(preferred);
    } catch (error) {
      if (isMissingFileError(error)) {
        return preferred;
      }
      throw error;
    }
  }

  private async sameFileContents(
    uri: vscode.Uri,
    expected: Uint8Array
  ): Promise<boolean> {
    try {
      return equalBytes(await vscode.workspace.fs.readFile(uri), expected);
    } catch (error) {
      if (isMissingFileError(error)) {
        return false;
      }
      throw error;
    }
  }

  private async availableFileName(preferred: string): Promise<string> {
    const safe = this.safeGlobalFileName(preferred);
    const base = safe.replace(/\.golangci\.yml$/u, '');
    let fileName = safe;
    let suffix = 2;
    while (await this.existsGlobal(fileName)) {
      fileName = `${base}-${suffix}.golangci.yml`;
      suffix += 1;
    }
    return fileName;
  }

  private async existsGlobal(fileName: string): Promise<boolean> {
    try {
      await vscode.workspace.fs.stat(
        vscode.Uri.joinPath(this.globalDirectory, fileName)
      );
      return true;
    } catch {
      return false;
    }
  }

  private safeGlobalFileName(fileName: string): string {
    this.assertFileName('global', fileName);
    return fileName;
  }

  private assertFileName(
    scope: 'global' | 'workspace',
    fileName: string
  ): void {
    const valid = scope === 'global'
      ? isProfileFile(fileName)
      : workspaceProfileNames.includes(fileName);
    if (!valid || fileName.includes('/') || fileName.includes('\\')) {
      throw new Error('Некорректное имя файла профиля.');
    }
  }

  private text(russian: string, english: string): string {
    return vscode.workspace
      .getConfiguration('goLinter')
      .get<'ru' | 'en'>('language', 'ru') === 'en'
      ? english
      : russian;
  }
}

export function isProfileFile(fileName: string): boolean {
  return fileName.endsWith('.golangci.yml');
}

function toSummary(
  id: string,
  fileName: string,
  profile: ManagedProfile,
  scope: 'global' | 'workspace',
  readOnly: boolean
): ProfileSummary {
  return {
    id,
    fileName,
    name: profile.name,
    description: profile.description,
    enabledLinters: profile.config.linters?.enable ?? [],
    enabledFormatters: profile.config.formatters?.enable ?? [],
    scope,
    readOnly
  };
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function isMissingFileError(error: unknown): boolean {
  return /not found|enoent|FileNotFound/iu.test(toMessage(error));
}

function ensureFinalNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
