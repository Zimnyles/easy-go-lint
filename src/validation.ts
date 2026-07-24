import {
  isMap,
  parseDocument,
  stringify
} from 'yaml';
import {
  GolangciConfig,
  ManagedProfile
} from './model';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  profile?: ManagedProfile;
}

export function normalizeDeprecatedLinters(
  profile: ManagedProfile
): { profile: ManagedProfile; changed: boolean } {
  const enabled = profile.config.linters?.enable;
  const disabled = profile.config.linters?.disable;
  const hasDeprecated = enabled?.includes('wsl') === true ||
    disabled?.includes('wsl') === true ||
    profile.config.linters?.settings?.wsl !== undefined;
  if (!hasDeprecated) {
    return { profile, changed: false };
  }

  const normalized = JSON.parse(JSON.stringify(profile)) as ManagedProfile;
  const linters = normalized.config.linters;
  if (!linters) {
    return { profile, changed: false };
  }
  if (linters.enable) {
    linters.enable = replaceLinterName(linters.enable, 'wsl', 'wsl_v5');
  }
  if (linters.disable) {
    linters.disable = replaceLinterName(linters.disable, 'wsl', 'wsl_v5');
  }
  if (linters.settings?.wsl !== undefined) {
    delete linters.settings.wsl;
    if (linters.settings.wsl_v5 === undefined) {
      linters.settings.wsl_v5 = {
        'allow-first-in-block': true,
        'allow-whole-block': false,
        'branch-max-lines': 2
      };
    }
  }
  return { profile: normalized, changed: true };
}

export function parseProfileYaml(
  yaml: string,
  fallbackName = 'golangci'
): ValidationResult {
  const document = parseDocument(yaml, {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true
  });
  const errors = document.errors.map((error) => error.message);
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  if (!isMap(document.contents)) {
    return {
      valid: false,
      errors: ['Корень .golangci.yml должен быть YAML-объектом.']
    };
  }

  const config = document.toJS() as GolangciConfig;
  if (String(config.version) !== '2') {
    errors.push('Поле version должно быть строкой "2".');
  } else {
    config.version = '2';
  }
  if (
    config.linters?.enable !== undefined &&
    (
      !Array.isArray(config.linters.enable) ||
      config.linters.enable.some((item) => typeof item !== 'string')
    )
  ) {
    errors.push('linters.enable должен быть списком строк.');
  }
  if (
    config.formatters?.enable !== undefined &&
    (
      !Array.isArray(config.formatters.enable) ||
      config.formatters.enable.some((item) => typeof item !== 'string')
    )
  ) {
    errors.push('formatters.enable должен быть списком строк.');
  }

  const metadata = parseMetadata(yaml);
  return {
    valid: errors.length === 0,
    errors,
    profile: errors.length === 0
      ? {
          name: metadata.name || fallbackName,
          description: metadata.description,
          yaml,
          config
        }
      : undefined
  };
}

export function serializeProfile(profile: ManagedProfile): string {
  const name = singleLine(profile.name || 'golangci');
  const description = singleLine(profile.description || '');
  const header = [
    '# Easy Go Lint profile',
    `# name: ${name}`,
    `# description: ${description}`
  ].join('\n');
  return `${header}\n${stringify(profile.config, {
    indent: 2,
    lineWidth: 0,
    defaultStringType: 'PLAIN',
    defaultKeyType: 'PLAIN'
  })}`;
}

export function validateProfileObject(value: unknown): ValidationResult {
  if (!isRecord(value)) {
    return {
      valid: false,
      errors: ['Конфигурация профиля должна быть объектом.']
    };
  }
  if (!isRecord(value.config)) {
    return {
      valid: false,
      errors: ['Поле config должно быть объектом.']
    };
  }
  const profile: ManagedProfile = {
    name: typeof value.name === 'string' ? value.name.trim() : '',
    description: typeof value.description === 'string'
      ? value.description
      : '',
    yaml: typeof value.yaml === 'string' ? value.yaml : '',
    config: value.config as GolangciConfig
  };
  const errors: string[] = [];
  if (!profile.name) {
    errors.push('Название профиля обязательно.');
  }
  if (profile.name.length > 120) {
    errors.push('Название профиля не должно быть длиннее 120 символов.');
  }
  if (String(profile.config.version) !== '2') {
    errors.push('Поле version должно быть строкой "2".');
  } else {
    profile.config.version = '2';
  }
  return {
    valid: errors.length === 0,
    errors,
    profile: errors.length === 0 ? profile : undefined
  };
}

function parseMetadata(yaml: string): {
  name: string;
  description: string;
} {
  let name = '';
  let description = '';
  for (const line of yaml.split(/\r?\n/u).slice(0, 20)) {
    const nameMatch = /^#\s*name:\s*(.*)$/iu.exec(line);
    const descriptionMatch = /^#\s*description:\s*(.*)$/iu.exec(line);
    if (nameMatch) {
      name = nameMatch[1].trim();
    }
    if (descriptionMatch) {
      description = descriptionMatch[1].trim();
    }
  }
  return { name, description };
}

function singleLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function replaceLinterName(
  values: string[],
  oldName: string,
  newName: string
): string[] {
  return Array.from(new Set(
    values.map((value) => value === oldName ? newName : value)
  ));
}
