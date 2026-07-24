import {
  spawn,
  ChildProcessWithoutNullStreams
} from 'node:child_process';

export interface CancellationTokenLike {
  readonly isCancellationRequested?: boolean;
  onCancellationRequested(
    listener: () => void
  ): { dispose(): unknown };
}

const activeChildren = new Set<ChildProcessWithoutNullStreams>();

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ProcessOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  maxOutputBytes: number;
}

export class ProcessCancelledError extends Error {
  public constructor() {
    super('Проверка отменена.');
    this.name = 'ProcessCancelledError';
  }
}

export function isProcessCancelled(error: unknown): boolean {
  return error instanceof ProcessCancelledError ||
    (error instanceof Error && error.name === 'Canceled');
}

export function executeFile(
  file: string,
  args: readonly string[],
  options: ProcessOptions,
  stdin?: string,
  token?: CancellationTokenLike
): Promise<ProcessResult> {
  if (token?.isCancellationRequested) {
    return Promise.reject(new ProcessCancelledError());
  }
  return new Promise((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(file, args, {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error) {
      reject(error);
      return;
    }
    activeChildren.add(child);

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let forcedError: Error | undefined;
    let settled = false;

    const terminate = (error: Error): void => {
      if (forcedError) {
        return;
      }
      forcedError = error;
      child.kill();
      setTimeout(() => {
        if (!settled) {
          child.kill('SIGKILL');
        }
      }, 1500).unref();
    };
    const append = (
      target: Buffer[],
      chunk: Buffer,
      currentBytes: number
    ): number => {
      const nextBytes = currentBytes + chunk.length;
      if (nextBytes > options.maxOutputBytes) {
        terminate(
          new Error(
            `Вывод golangci-lint превысил лимит ${Math.round(
              options.maxOutputBytes / 1024 / 1024
            )} МБ.`
          )
        );
        return currentBytes;
      }
      target.push(chunk);
      return nextBytes;
    };

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes = append(stdout, chunk, stdoutBytes);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes = append(stderr, chunk, stderrBytes);
    });

    const timeout = setTimeout(() => {
      terminate(
        new Error(
          `golangci-lint превысил лимит времени ${Math.round(
            options.timeoutMs / 1000
          )} с.`
        )
      );
    }, options.timeoutMs);
    timeout.unref();
    const cancellation = token?.onCancellationRequested(() => {
      terminate(new ProcessCancelledError());
    });

    child.once('error', (error) => {
      activeChildren.delete(child);
      if (!forcedError) {
        forcedError = error;
      }
    });
    child.once('close', (code) => {
      activeChildren.delete(child);
      settled = true;
      clearTimeout(timeout);
      cancellation?.dispose();
      if (forcedError) {
        reject(forcedError);
        return;
      }
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode: code ?? -1
      });
    });

    child.stdin.end(stdin);
  });
}

export function cancelAllProcesses(): void {
  for (const child of activeChildren) {
    child.kill();
  }
}
