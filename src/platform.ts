export interface BundledBinary {
  platformKey: string;
  fileName: string;
}

export const bundledPlatformKeys = [
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-armhf',
  'linux-x64',
  'win32-arm64',
  'win32-x64'
] as const;

export function bundledBinaryFor(
  platform: string,
  arch: string
): BundledBinary | undefined {
  const platformKey = platform === 'linux' && arch === 'arm'
    ? 'linux-armhf'
    : `${platform}-${arch}`;
  if (!(bundledPlatformKeys as readonly string[]).includes(platformKey)) {
    return undefined;
  }
  return {
    platformKey,
    fileName: platform === 'win32'
      ? 'golangci-lint.exe'
      : 'golangci-lint'
  };
}
