// Install the actual packed CLI offline from the populated dependency store, then invoke its bin.
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = await mkdtemp(path.join(repo, '.tools/package-smoke-'));
const env = { PATH: path.join(repo, '.tools/dafny-4.11.0/dafny') + path.delimiter + process.env.PATH, COREPACK_HOME: path.join(repo, '.tools/corepack'), COREPACK_ENABLE_NETWORK: '0' };
function run(command, args, cwd = repo) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 180000, maxBuffer: 2_000_000 });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
const policy = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8')).pnpm;
run('pnpm', ['pack', '--pack-destination', work]);
await writeFile(path.join(work, 'package.json'), JSON.stringify({ name: 'pdd-packed-smoke', private: true, packageManager: 'pnpm@10.32.1', pnpm: policy }) + '\n');
run('pnpm', ['add', path.join(work, 'pdd-ts-0.1.0.tgz'), '--prefer-offline', '--ignore-scripts', '--store-dir', path.join(repo, '.tools/pnpm-store')], work);
// A frozen project install need not warm registry metadata. Prime this consumer's exact lock,
// then remove its links and prove a fresh offline installation from that lock/store.
await rm(path.join(work, 'node_modules'), { recursive: true, force: true });
run('pnpm', ['install', '--offline', '--frozen-lockfile', '--ignore-scripts', '--store-dir', path.join(repo, '.tools/pnpm-store')], work);
const cli = path.join(work, 'node_modules/.bin/pdd-ts');
const help = run(cli, ['--help'], work);
if (!help.includes('verify') || !help.includes('report')) throw new Error('Packed executable does not expose the expected CLI');
const project = path.join(work, 'project');
await mkdir(project);
const initialized = JSON.parse(run(cli, ['init', '--project', project, '--json'], work));
if (!initialized.initialized) throw new Error('Packed CLI did not initialize the project');
JSON.parse(await readFile(path.join(project, 'lemmascript.json'), 'utf8'));
const trials = [];
for (const sample of ['examples/existing-hono', 'examples/greenfield-domain', '.']) {
  const packet = JSON.parse(run(cli, ['verify', '--project', path.resolve(repo, sample), '--json']));
  if (packet.gate.status !== 'trial' || packet.approval !== 'pending' || packet.evidence.some(item => item.status !== 'passed')) throw new Error('Packed verification incomplete: ' + sample);
  trials.push({ project: sample, commit: packet.commit, dirty: packet.dirty, gate: packet.gate.status, approval: packet.approval, evidence: packet.evidence.map(item => ({ kind: item.kind, status: item.status, counts: item.counts })) });
}
await writeFile(path.join(repo, '.tools/packed-trials.json'), JSON.stringify(trials, null, 2) + '\n');
console.log('PASS: offline tarball install, executable help/init, both examples and self verification');
