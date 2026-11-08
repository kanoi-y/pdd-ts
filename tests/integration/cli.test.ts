import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';

const repo = process.cwd(), cli = path.join(repo, 'dist/cli/main.js');
const roots: string[] = [];
function command(root: string, ...args: string[]) {
  return spawnSync(process.execPath, [cli, ...args, '--project', root, '--json'], {
    encoding: 'utf8', timeout: 60000,
    env: { PATH: `${repo}/.tools/dafny-4.11.0/dafny:${process.env.PATH}`, CI: '', GITHUB_ACTIONS: '' },
  });
}
async function project(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pdd-cli-'));
  roots.push(root);
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src/auth.ts'), await readFile(path.join(repo, 'tests/fixtures/poc/auth.ts')));
  await writeFile(path.join(root, 'package.json'), '{"name":"pdd-cli-fixture","type":"module"}\n');
  execFileSync('git', ['init', '-q', root]);
  return root;
}
function commit(root: string) {
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=PDD fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
}
async function configure(root: string) {
  const init = command(root, 'init');
  expect(init.status, init.stderr).toBe(0);
  const config = parse(await readFile(path.join(root, '.pdd/config.yaml'), 'utf8'));
  config.targets = [{ file: 'src/auth.ts', symbol: 'canIssueAdminToken' }];
  await writeFile(path.join(root, '.pdd/config.yaml'), stringify(config));
  await writeFile(path.join(root, '.pdd/obligations.yaml'), stringify([{
    id: 'auth-proof', requirementIds: ['AUTH-001'], kind: 'source-proof',
    scope: 'src/auth.ts#canIssueAdminToken', contractIds: ['AUTH-001-C1'],
  }]));
  await writeFile(path.join(root, '.pdd/requirements/AUTH-001.yaml'), stringify({
    id: 'AUTH-001', revision: 1, title: '<img src="https://example.invalid"> | auth',
    intent: 'Only authenticated administrators may receive a token.', risk: 'high',
    target: config.targets[0], trustedBoundaries: [],
    contracts: [{ id: 'AUTH-001-C1', kind: 'postcondition', human: 'Both conditions are necessary and sufficient.',
      sourceRef: { ...config.targets[0], clause: 'ensures', index: 0 }, semantics: 'pdd-pure-v1' }],
    acceptance: [],
  }));
  commit(root);
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('CLI-003: CLI review workflow', () => {
  it('initializes without modifying existing source or clobbering configuration', async () => {
    const root = await project();
    const original = await readFile(path.join(root, 'src/auth.ts'), 'utf8');
    expect(command(root, 'init').status).toBe(0);
    await writeFile(path.join(root, '.pdd/config.yaml'), '# keep this user content\nschemaVersion: 1\n');
    expect(command(root, 'init').status).toBe(2);
    expect(await readFile(path.join(root, '.pdd/config.yaml'), 'utf8')).toContain('keep this user content');
    expect(await readFile(path.join(root, 'src/auth.ts'), 'utf8')).toBe(original);
  });

  it('rejects an empty required set and cannot report success without an actual run', async () => {
    const root = await project();
    expect(command(root, 'init').status).toBe(0);
    commit(root);
    const missing = command(root, 'report');
    expect(missing.status).toBe(1);
    expect(JSON.parse(missing.stdout).evidence).toEqual([]);
    expect(command(root, 'verify').status).toBe(1);
    const output = command(root, 'report');
    expect(output.status).toBe(1);
    expect(JSON.parse(output.stdout).gate.status).toBe('blocked');
  });

  it('checks unsafe existing model paths before creating a partial configuration', async () => {
    const root = await project();
    const external = await mkdtemp(path.join(os.tmpdir(), 'pdd-outside-'));
    roots.push(external);
    await writeFile(path.join(external, 'model.json'), '{}');
    await symlink(path.join(external, 'model.json'), path.join(root, 'lemmascript.json'));
    expect(command(root, 'init').status).toBe(2);
    await expect(readFile(path.join(root, '.pdd/config.yaml'))).rejects.toThrow();
    expect(await readFile(path.join(external, 'model.json'), 'utf8')).toBe('{}');
  });

  it('runs real proofs, shows a local trial and rechecks freshness on report', async () => {
    const root = await project();
    await configure(root);
    const verified = command(root, 'verify');
    expect(verified.status, verified.stderr + verified.stdout).toBe(0);
    const result = JSON.parse(verified.stdout);
    expect(result.gate.status).toBe('trial');
    expect(result.evidence[0].status).toBe('passed');
    expect(result.approval).toBe('pending');
    expect(result.specDigest).toMatch(/^[a-f0-9]{64}$/);
    const report = command(root, 'report');
    expect(report.status, report.stderr).toBe(0);
    expect(JSON.parse(report.stdout).gate.status).toBe('trial');
    const markdown = spawnSync(process.execPath, [cli, 'report', '--project', root], { encoding: 'utf8', env: { PATH: `${repo}/.tools/dafny-4.11.0/dafny:${process.env.PATH}` } });
    expect(markdown.stdout).toContain('手元の検証');
    expect(markdown.stdout).not.toContain('CIの出所の確認が完了');
    expect(markdown.stdout).not.toContain('<img');
    expect(markdown.stdout).not.toContain(root);
    await writeFile(path.join(root, 'src/auth.ts'), (await readFile(path.join(root, 'src/auth.ts'), 'utf8')).replace('return role === "admin" && passwordOk;', 'return true;'));
    const stale = command(root, 'report');
    expect(stale.status).toBe(1);
    expect(JSON.parse(stale.stdout).evidence[0].status).toBe('stale');
  });

  it('does not accept YAML aliases, duplicate keys, unknown flags or untrusted CI claims', async () => {
    const root = await project();
    await configure(root);
    expect(command(root, 'verify', '--skip-proof').status).toBe(2);
    expect(command(root, 'verify', '--ci').status).not.toBe(0);
    await writeFile(path.join(root, '.pdd/config.yaml'), 'schemaVersion: 1\nschemaVersion: 2\n');
    expect(command(root, 'verify').status).toBe(2);
    await writeFile(path.join(root, '.pdd/config.yaml'), 'schemaVersion: 1\ntargets: &a []\nextra: *a\n');
    expect(command(root, 'verify').status).toBe(2);
  });

  it('reports unavailable tools as an error without manufacturing evidence', async () => {
    const root = await project();
    await configure(root);
    const config = parse(await readFile(path.join(root, '.pdd/config.yaml'), 'utf8'));
    config.tools = { dafnyPath: '/missing/dafny' };
    await writeFile(path.join(root, '.pdd/config.yaml'), stringify(config));
    const doctor = command(root, 'doctor');
    expect(doctor.status).not.toBe(0);
    expect(JSON.parse(doctor.stdout).checks.some((check: { status: string }) => check.status === 'error')).toBe(true);
    const proof = command(root, 'verify');
    expect(proof.status).toBe(2);
    expect(JSON.parse(proof.stdout).evidence.every((item: { status: string }) => item.status !== 'passed')).toBe(true);
  });
});

it('CLI-003 doctor identifies an empty required registry as insufficient',async()=>{
 const root=await project();expect(command(root,'init').status).toBe(0);commit(root);
 const result=command(root,'doctor');const data=JSON.parse(result.stdout);
 expect(data.protectedReady).toBe(false);
 expect(data.checks).toContainEqual(expect.objectContaining({name:'required-registry',status:'insufficient'}));
});


it('CLI-003 never describes an unresolved contract as a confirmed behavior',async()=>{
 const root=await project();await configure(root);
 const file=path.join(root,'.pdd/requirements/AUTH-001.yaml');
 const requirement=parse(await readFile(file,'utf8'));
 requirement.contracts[0].sourceRef.index=999;
 requirement.contracts[0].human='セッションの有効期限も検査する。';
 await writeFile(file,stringify(requirement));commit(root);
 const result=command(root,'verify');expect(result.status,result.stderr).toBe(1);
 const packet=JSON.parse(result.stdout);
 expect(packet.snapshotComplete).toBe(false);expect(packet.gate.status).toBe('blocked');
 expect(packet.evidence[0].status).toBe('passed');
 const report=spawnSync(process.execPath,[cli,'report','--project',root],{encoding:'utf8',env:{PATH:`${repo}/.tools/dafny-4.11.0/dafny:${process.env.PATH}`}});
 expect(report.status,report.stderr).toBe(1);
 const front=report.stdout.split('<details>')[0]!;
 expect(front).toContain('開発側');
 expect(front).not.toContain('セッションの有効期限も検査する。');
 expect(report.stdout).toContain('セッションの有効期限も検査する。');
});
it('CLI-003 does not hide an unreferenced source precondition from the human review',async()=>{
 const root=await project();await configure(root);
 const source=path.join(root,'src/auth.ts');
 await writeFile(source,(await readFile(source,'utf8')).replace('//@ ensures','//@ requires role === "admin"\n//@ ensures').replace('return role === "admin" && passwordOk;','return passwordOk;'));
 const configFile=path.join(root,'.pdd/config.yaml'),config=parse(await readFile(configFile,'utf8'));
 config.targets[0].witnesses=[{role:'admin',passwordOk:true}];await writeFile(configFile,stringify(config));commit(root);
 expect(command(root,'verify').status).toBe(0);commit(root);
 const result=command(root,'verify');expect(result.status,result.stderr).toBe(0);
 const packet=JSON.parse(result.stdout);expect(packet.snapshotComplete).toBe(true);expect(packet.dirty).toBe(false);
 expect(packet.evidence[0].status).toBe('passed');
 const output=spawnSync(process.execPath,[cli,'report','--project',root],{encoding:'utf8',env:{PATH:`${repo}/.tools/dafny-4.11.0/dafny:${process.env.PATH}`}});
 const front=output.stdout.split('<details>')[0]!;
 expect(front).toContain('入力条件の説明');expect(front).toContain('開発側');
 expect(front).not.toContain('Both conditions are necessary and sufficient.');
 expect(output.stdout).toContain('role ===');
});
