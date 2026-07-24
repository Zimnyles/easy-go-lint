import * as path from 'node:path';
import { GolangciIssue } from './model';

export interface FileIssueSelection {
  issues: GolangciIssue[];
  packageTypecheckBlockers: GolangciIssue[];
}

export function selectIssuesForFile(
  allIssues: GolangciIssue[],
  targetFile: string
): FileIssueSelection {
  const normalizedTarget = normalizeFilePath(targetFile);
  const targetDirectory = path.dirname(normalizedTarget);
  const issues: GolangciIssue[] = [];
  const packageTypecheckBlockers: GolangciIssue[] = [];

  for (const issue of allIssues) {
    const issueFile = normalizeFilePath(issue.Pos.Filename, targetDirectory);
    if (issueFile === normalizedTarget) {
      issues.push(issue);
    } else if (issue.FromLinter === 'typecheck') {
      packageTypecheckBlockers.push(issue);
    }
  }

  return { issues, packageTypecheckBlockers };
}

export function describePackageTypecheckFailure(
  blockers: GolangciIssue[]
): string {
  const examples = blockers.slice(0, 3).map((issue) => {
    const location = issue.Pos.Filename
      ? `${issue.Pos.Filename}:${Math.max(1, issue.Pos.Line)}`
      : 'пакет';
    return `${location}: ${issue.Text}`;
  });
  const remaining = blockers.length - examples.length;

  return [
    'Проверка текущего файла не завершена: Go type checker не смог загрузить пакет.',
    'Результат «0 проблем» не показан, потому что остальные линтеры в таком состоянии работают недостоверно.',
    ...examples,
    ...(remaining > 0 ? [`И ещё блокирующих ошибок: ${remaining}.`] : [])
  ].join('\n');
}

function normalizeFilePath(value: string, relativeTo?: string): string {
  const normalized = path.resolve(relativeTo ?? '.', value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}
