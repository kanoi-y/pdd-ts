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
await mkdir(path.join(project, 'src'));
await writeFile(path.join(project, 'src/domain.ts'), 'export function domain(){return true;}\n');
await writeFile(path.join(project, 'index.ts'), "import {domain} from '@sample/domain'; export const sample = () => domain();\n");
await writeFile(path.join(project, 'tsconfig.json'), JSON.stringify({compilerOptions:{paths:{'@sample/*':['src/*']}}}));
const survey = JSON.parse(run(cli, ['scan', '--project', project, '--json'], work));
if (!survey.coverage.complete || survey.functions.length !== 2 || survey.configuration.status !== 'applied' || survey.modules.find(m => m.file === 'index.ts')?.imports[0]?.target !== 'src/domain.ts' || survey.atlas.status !== 'as-is-proposal') throw new Error('Packed CLI scan is incomplete');
const history = JSON.parse(run(cli, ['scan', '--project', project, '--history', '--json'], work)).history;
if (!history || !['available','incomplete','unavailable'].includes(history.status)) throw new Error('Packed CLI history state is absent');
const initialized = JSON.parse(run(cli, ['init', '--project', project, '--json'], work));
if (!initialized.initialized) throw new Error('Packed CLI did not initialize the project');
JSON.parse(await readFile(path.join(project, 'lemmascript.json'), 'utf8'));
const skills = JSON.parse(run(cli, ['skills', '--project', project, '--agent', 'codex', '--json'], work));
if (skills.installed.length !== 5 || !skills.supportingFiles.length) throw new Error('Packed project skills incomplete');
for (const file of [...skills.installed,...skills.supportingFiles]) await readFile(path.join(project,file),'utf8');
const planned = JSON.parse(run(cli, ['plan', '--project', repo, '--json']));
if (planned.kind !== 'decision-plan' || planned.implementationPermission !== 'not-established') throw new Error('Packed plan is incomplete');

const trials = [];
for (const sample of ['examples/existing-hono', 'examples/greenfield-domain', '.']) {
  const packet = JSON.parse(run(cli, ['verify', '--project', path.resolve(repo, sample), '--json']));
  if (packet.gate.status !== 'trial' || packet.approval !== 'pending' || packet.evidence.some(item => item.status !== 'passed')) throw new Error('Packed verification incomplete: ' + sample);
  trials.push({ project: sample, commit: packet.commit, dirty: packet.dirty, gate: packet.gate.status, approval: packet.approval, evidence: packet.evidence.map(item => ({ kind: item.kind, status: item.status, counts: item.counts })) });
}
await writeFile(path.join(repo, '.tools/packed-trials.json'), JSON.stringify(trials, null, 2) + '\n');
console.log('PASS: offline tarball install, executable help/scan/init/plan/skills, both examples and self verification');
