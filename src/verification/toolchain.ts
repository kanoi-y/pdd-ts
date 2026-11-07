import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defaultLscPath } from './contracts.js';
import { sha256 } from './digest.js';
import { runProcess } from './process.js';

export interface VerificationTools {
  dafnyPath?: string;
  solverPath?: string;
  lscPath?: string;
  timeoutMs?: number;
}
export async function hashToolFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function executable(name: string): Promise<string> {
  if (name.includes('/') || name.includes('\\')) { await access(name); return path.resolve(name); }
  for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const file = path.resolve(dir, name);
    try { await access(file); return file; } catch { /* Try the next declared PATH entry. */ }
  }
  throw new Error(`Verification executable is unavailable: ${name}`);
}

export async function describeToolchain(root: string, options: VerificationTools): Promise<{
  digest: string;
  dafny: string;
  solver: string;
  lsc: string;
  manifest: Record<string, unknown>;
}> {
  const local = path.join(root, '.tools/dafny-4.11.0/dafny/dafny');
  let defaultDafny = 'dafny';
  try { await access(local); defaultDafny = local; } catch { /* A system install must pass the same version checks. */ }
  const dafny = await executable(options.dafnyPath ?? defaultDafny);
  const solver = await executable(options.solverPath ?? path.join(path.dirname(dafny), 'z3/bin/z3-4.14.1'));
  const lsc = options.lscPath ?? defaultLscPath;
  const versions = await Promise.allSettled([
    runProcess(dafny, ['--version'], { cwd: root, timeoutMs: options.timeoutMs ?? 30000 }),
    runProcess(solver, ['--version'], { cwd: root, timeoutMs: options.timeoutMs ?? 30000 }),
  ]);
  if (versions.some(result => result.status === 'rejected')) throw new Error('Cannot identify verification toolchain');
  const values = versions.map(result => result.status === 'fulfilled' ? result.value : null);
  const d = values[0]!, s = values[1]!;
  if (d.status !== 'completed' || s.status !== 'completed' || d.exitCode !== 0 || s.exitCode !== 0 ||
      !/^4\.11\.0(?:\+|\s|$)/.test(d.stdout) || !/^Z3 version 4\.14\.1(?:\s|$)/.test(s.stdout)) {
    throw new Error('Pinned Dafny 4.11.0 and Z3 4.14.1 are required');
  }
  const hashes: Record<string, string> = {
    node: await hashToolFile(process.execPath),
    dafny: await hashToolFile(dafny),
    'DafnyCore.dll': await hashToolFile(path.join(path.dirname(dafny), 'DafnyCore.dll')),
    z3: await hashToolFile(solver),
  };
  for (const name of (await readdir(path.dirname(lsc))).filter(file => file.endsWith('.js')).sort()) {
    hashes[`lsc/${name}`] = sha256(await readFile(path.join(path.dirname(lsc), name)));
  }
  // Bind the adapter and both frontend dependency versions/code, not just the external CLI version string.
  const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const ownRoot = path.dirname(moduleRoot);
  const extension = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
  const addCode = async (directory: string, prefix: string, suffix: string): Promise<void> => {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : 1)) {
      if (entry.isDirectory() && entry.name !== 'node_modules') await addCode(path.join(directory, entry.name), `${prefix}/${entry.name}`, suffix);
      else if (entry.isFile() && entry.name.endsWith(suffix)) hashes[`${prefix}/${entry.name}`] = await hashToolFile(path.join(directory, entry.name));
    }
  };
  await addCode(moduleRoot, 'pdd-code', extension);
  hashes['pdd-package'] = await hashToolFile(path.join(ownRoot, 'package.json'));
  for (const [label, resolver] of [['profile-frontend', createRequire(import.meta.url)], ['proof-frontend', createRequire(lsc)]] as const) {
    const pkg = resolver.resolve('ts-morph/package.json');
    hashes[`${label}/package`] = await hashToolFile(pkg);
    await addCode(path.dirname(resolver.resolve('ts-morph')), `${label}/code`, '.js');
    const common = createRequire(pkg).resolve('@ts-morph/common');
    await addCode(path.dirname(common), `${label}/compiler`, '.js');
  }
  const manifest = { profile: 'pdd-pure-v1', node: process.version, lemmascript: '0.6.6', dafny: d.stdout.trim(), z3: s.stdout.trim(), flags: ['--unicode-char:false', '--allow-deprecation'], hashes };
  return { digest: sha256(JSON.stringify(manifest)), dafny, solver, lsc, manifest };
}
