#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const platforms = {
  'darwin-arm64': ['arm64-macos-13', 'c90c75e7d5db9c6ccbb7127840dfe43f0ac938b039a7ebed146d8ead383a572f'],
  'darwin-x64': ['x64-macos-13', '5fc0de946c5b2fad33f16bd22a5b06f4fd0dfa7f6d770284237e3f1f3ca9f73d'],
  'linux-x64': ['x64-ubuntu-22.04', 'a46a9ff7cdd720f7955854c78e95df13f4cfe6b80691b05f8654fe19e8267179'],
};
const asset = platforms[`${process.platform}-${process.arch}`];
if (!asset) throw new Error('Use a manually installed Dafny 4.11.0 on this platform.');
const name = `dafny-4.11.0-${asset[0]}.zip`;
const dir = path.join(root, '.tools');
const archive = path.join(dir, name);
await mkdir(dir, { recursive: true });
let data;
try { data = await readFile(archive); } catch {
  const response = await fetch(`https://github.com/dafny-lang/dafny/releases/download/v4.11.0/${name}`, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
  data = Buffer.from(await response.arrayBuffer());
}
if (createHash('sha256').update(data).digest('hex') !== asset[1]) throw new Error('Official Dafny archive checksum mismatch');
await writeFile(archive, data);
const out = path.join(dir, 'dafny-4.11.0');
const unzip = spawnSync('unzip', ['-qo', archive, '-d', out], { stdio: 'inherit' });
if (unzip.status !== 0) throw new Error('Dafny extraction failed (unzip required)');
const binary = path.join(out, 'dafny/dafny');
const version = spawnSync(binary, ['--version'], { encoding: 'utf8', timeout: 15000 });
if (version.status !== 0 || !version.stdout.startsWith('4.11.0')) throw new Error('Installed Dafny version check failed');
console.log(`Installed ${version.stdout.trim()} at ${binary}`);
