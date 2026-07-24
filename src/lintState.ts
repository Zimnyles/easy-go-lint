export interface LintCacheIdentity {
  engine: string;
  binary: string;
  goToolchain: string;
  packageDirectory: string;
  profilePath: string;
  profileMtime: number;
  profileSize: number;
}

export function lintCacheKey(identity: LintCacheIdentity): string {
  return JSON.stringify(identity);
}

export function rememberWarmLintTarget(
  current: string[],
  key: string,
  limit = 100
): string[] {
  return [
    key,
    ...current.filter((item) => item !== key)
  ].slice(0, limit);
}
