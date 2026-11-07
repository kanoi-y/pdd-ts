import { spawn } from 'node:child_process';

export interface ProcessOptions {
  cwd: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  env?: Record<string, string>;
  redact?: string[];
}
export interface ProcessResult {
  status: 'completed' | 'timeout' | 'output-limit' | 'error';
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error: string | null;
  durationMs: number;
}

/** Output/time bounds and a clean child environment; OS isolation is the caller's responsibility. */
export async function runProcess(command: string, args: string[], options: ProcessOptions): Promise<ProcessResult> {
  const timeoutMs = options.timeoutMs ?? 30000;
  const limit = options.maxOutputBytes ?? 1_048_576;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 16_777_216) {
    throw new Error('Invalid process time/output bound');
  }
  const started = performance.now();
  const secrets = (options.redact ?? []).filter(value => value.length > 0);
  const redact = (text: string): string => secrets.reduce((value, secret) => value.split(secret).join('[REDACTED]'), text);
  return await new Promise<ProcessResult>(resolve => {
    let status: ProcessResult['status'] = 'completed';
    let error: string | null = null;
    let bytes = 0;
    let done = false;
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    const env: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8', ...options.env };
    if (process.platform === 'win32' && process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
    const child = spawn(command, args, { cwd: options.cwd, env, shell: false, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const kill = (): void => {
      if (child.pid) {
        try {
          if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL');
        } catch { /* The process may already have exited. */ }
      }
      // An escaped descendant may retain inherited pipes after the group leader dies.
      // Do not let those handles extend the caller's time/output deadline.
      child.stdout.destroy();
      child.stderr.destroy();
    };
    const timer = setTimeout(() => { status = 'timeout'; kill(); }, timeoutMs);
    const capture = (chunks: Buffer[], chunk: Buffer): void => {
      const remaining = Math.max(0, limit - bytes);
      if (remaining) chunks.push(chunk.subarray(0, remaining));
      bytes += chunk.length;
      if (bytes > limit && status === 'completed') { status = 'output-limit'; kill(); }
    };
    child.stdout.on('data', (chunk: Buffer) => capture(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => capture(stderr, chunk));
    const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const bounded = (text: string, size: number): string => new TextDecoder().decode(Buffer.from(text).subarray(0, size), { stream: true });
      const out = bounded(redact(Buffer.concat(stdout).toString('utf8')), limit);
      const err = bounded(redact(Buffer.concat(stderr).toString('utf8')), Math.max(0, limit - Buffer.byteLength(out)));
      resolve({ status, exitCode, signal, stdout: out, stderr: err, error: error === null ? null : redact(error), durationMs: Math.round(performance.now() - started) });
    };
    child.on('error', cause => { status = 'error'; error = cause.message; finish(null, null); });
    child.on('close', finish);
  });
}
