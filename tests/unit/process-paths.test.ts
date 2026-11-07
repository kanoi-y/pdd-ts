import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runProcess } from '../../src/verification/process.js';
import { resolveProjectPath } from '../../src/verification/paths.js';
import { digestFiles } from '../../src/verification/digest.js';

const temporary: string[] = [];
async function project(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pdd-test-'));
  temporary.push(dir);
  return dir;
}
afterEach(async () => { await Promise.all(temporary.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });

describe('CLI-001: bounded process execution without shell expansion', () => {
  it('preserves literal argv rather than invoking shell substitution', async () => {
    const cwd = await project();
    const arg = '$(touch pwned) `touch pwned` ; touch pwned';
    const result = await runProcess(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', arg], { cwd });
    expect(result).toMatchObject({ status: 'completed', exitCode: 0, stdout: arg });
    await expect(readFile(path.join(cwd, 'pwned'))).rejects.toThrow();
  });

  it('terminates a hung process within the deadline', async () => {
    const result = await runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: await project(), timeoutMs: 100 });
    expect(result.status).toBe('timeout');
    expect(result.durationMs).toBeLessThan(5000);
  });

  it('bounds combined output and kills a flooding subprocess', async () => {
    const result = await runProcess(process.execPath, ['-e', 'setInterval(()=>{process.stdout.write("x".repeat(4096));process.stderr.write("y".repeat(4096))},1)'], { cwd: await project(), maxOutputBytes: 1024 });
    expect(result.status).toBe('output-limit');
    expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(1024);
  });

  it('returns at the deadline even if a detached descendant keeps stdout open', async () => {
    const code = 'const c=require("node:child_process").spawn(process.execPath,["-e","setTimeout(()=>{},3000)"],{detached:true,stdio:["ignore",1,2]});console.log(c.pid);c.unref();setInterval(()=>{},1000)';
    const result = await runProcess(process.execPath, ['-e', code], { cwd: await project(), timeoutMs: 150 });
    const descendant = Number(result.stdout.trim());
    if (descendant > 0) { try { process.kill(descendant, 'SIGKILL'); } catch { /* Already exited. */ } }
    expect(result.status).toBe('timeout');
    expect(result.durationMs).toBeLessThan(1000);
  });

  it('does not leak parent GitHub credentials into code under test', async () => {
    const original = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'parent-token-must-not-leak';
    try {
      const result = await runProcess(process.execPath, ['-e', 'process.stdout.write(String(process.env.GITHUB_TOKEN))'], { cwd: await project() });
      expect(result.stdout).toBe('undefined');
    } finally {
      if (original === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = original;
    }
  });

  it('redacts explicitly known secrets even when printed across chunks', async () => {
    const result = await runProcess(process.execPath, ['-e', 'process.stdout.write("secret-");setTimeout(()=>process.stdout.write("token"),10)'], { cwd: await project(), redact: ['secret-token'] });
    expect(result.stdout).toBe('[REDACTED]');
  });

  it('distinguishes spawn failure from a completed nonzero exit', async () => {
    expect((await runProcess('pdd-missing-executable-12345', [], { cwd: await project() })).status).toBe('error');
    expect(await runProcess(process.execPath, ['-e', 'process.exit(7)'], { cwd: await project() })).toMatchObject({ status: 'completed', exitCode: 7 });
  });
});

describe('CLI-002: project-contained artifact paths', () => {
  it.each(['../outside', 'a/../../outside', '/etc/passwd', 'C:\\Windows\\file', 'x\u0000y', 'line\nbreak.ts', 'line\rbad.ts', '\u001b[31m.ts'])('rejects escaping or invalid path %s', async relative => {
    await expect(resolveProjectPath(await project(), relative, { allowMissing: true })).rejects.toThrow();
  });

  it('rejects a symlink escape for both reads and new artifacts', async () => {
    const root = await project(), outside = await project();
    await writeFile(path.join(outside, 'secret'), 'outside');
    await symlink(outside, path.join(root, 'link'));
    await expect(resolveProjectPath(root, 'link/secret')).rejects.toThrow();
    await expect(resolveProjectPath(root, 'link/new.json', { allowMissing: true })).rejects.toThrow();
  });

  it('allows a contained existing file and contained new nested artifact', async () => {
    const root = await project();
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src/file.ts'), 'export {}');
    expect(await resolveProjectPath(root, 'src/file.ts')).toBe(path.join(await import('node:fs/promises').then(fs => fs.realpath(root)), 'src/file.ts'));
    expect(await resolveProjectPath(root, '.pdd/evidence/new/run.json', { allowMissing: true })).toContain('/.pdd/evidence/new/run.json');
  });
});

describe('CORE-002: content-based freshness', () => {
  it('is stable across input ordering and detects dependency-only edits', async () => {
    const root = await project();
    await writeFile(path.join(root, 'source.ts'), 'import { value } from "./dep.js";');
    await writeFile(path.join(root, 'dep.ts'), 'export const value = true;');
    const first = await digestFiles(root, ['source.ts', 'dep.ts']);
    expect((await digestFiles(root, ['dep.ts', 'source.ts'])).digest).toBe(first.digest);
    await writeFile(path.join(root, 'dep.ts'), 'export const value = false;');
    expect((await digestFiles(root, ['source.ts', 'dep.ts'])).digest).not.toBe(first.digest);
  });

  it('rejects missing, duplicated and escaped inputs rather than hashing a partial set', async () => {
    const root = await project();
    await writeFile(path.join(root, 'source.ts'), 'export {}');
    await expect(digestFiles(root, ['source.ts', 'missing.ts'])).rejects.toThrow();
    await expect(digestFiles(root, ['source.ts', 'source.ts'])).rejects.toThrow();
    await expect(digestFiles(root, ['../other.ts'])).rejects.toThrow();
  });
});

it('CORE-002 hashes special object-key filenames without losing their bytes',async()=>{
 const root=await project();
 await writeFile(path.join(root,'__proto__'),'before');
 const before=await digestFiles(root,['__proto__']);
 expect(Object.hasOwn(before.files,'__proto__')).toBe(true);
 await writeFile(path.join(root,'__proto__'),'after');
 expect((await digestFiles(root,['__proto__'])).digest).not.toBe(before.digest);
});
