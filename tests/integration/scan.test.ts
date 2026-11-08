import { ts } from 'ts-morph';
import { readScanConfiguration } from '../../src/analysis/configuration.js';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it } from 'vitest';
const cli = path.join(process.cwd(), 'dist/cli/main.js'), roots: string[] = [];
async function fixture() { const root = await mkdtemp(path.join(os.tmpdir(), 'pdd-scan-')); roots.push(root); await mkdir(path.join(root, 'src')); await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'scan-fixture', scripts: { postinstall: 'touch EXECUTED' }, dependencies: { hono: '4.13.16' } })); await writeFile(path.join(root, 'src/domain.ts'), '//@ ensures \\result === enabled\nexport function decision(enabled:boolean):boolean{return enabled;}\n'); await writeFile(path.join(root, 'src/app.ts'), `import {decision as decide} from './domain.js';\nimport {Hono} from 'hono';\nimport {writeFileSync} from 'node:fs';\nwriteFileSync('EXECUTED','must never execute');\nconst app=new Hono();\napp.post('/decision',c=>c.json({allowed:decide(true)}));\nexport function withProvider(provider:()=>boolean){return provider();}\n`); return root; }
function scan(root: string, json = true, extra: string[] = []) { return spawnSync(process.execPath, [cli, 'scan', '--project', root, ...json ? ['--json'] : [], ...extra], { encoding: 'utf8', timeout: 30000, maxBuffer: 16777216, env: { PATH: process.env.PATH } }); }
afterEach(async () => {
    for (const root of roots.splice(0))
        await rm(root, { recursive: true, force: true });
});
it('SCAN-001 surveys an uninitialized project without executing or changing its files', async () => {
    const root = await fixture(), before = await readFile(path.join(root, 'src/app.ts'), 'utf8');
    const r = scan(root);
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const p = JSON.parse(r.stdout);
    expect(p.kind).toBe('architecture-scan');
    expect(p.coverage.complete).toBe(true);
    expect(p.atlas.flows.some((f: {
        steps: string[];
    }) => f.steps.some(step => step.includes('c.json')))).toBe(true);
    const decision = p.functions.find((f: {
        name: string;
    }) => f.name === 'decision');
    expect(decision.evidence.file).toBe('src/domain.ts');
    expect(decision.evidence.line).toBe(2);
    expect(p.functions.flatMap((f: {
        calls: unknown[];
    }) => f.calls).some((c: {
        expression: string;
        targetId?: string;
    }) => c.expression === 'decide' && c.targetId === decision.id)).toBe(true);
    expect(p.modules.find((m: {
        file: string;
    }) => m.file === 'src/app.ts').imports.some((i: {
        specifier: string;
        target?: string;
    }) => i.specifier === './domain.js' && i.target === 'src/domain.ts')).toBe(true);
    expect(await readFile(path.join(root, 'src/app.ts'), 'utf8')).toBe(before);
    expect((await readdir(root)).sort()).toEqual(['package.json', 'src']);
});
it('SCAN-001 labels injected calls unknown instead of inventing a runtime dependency', async () => {
    const root = await fixture(), r = scan(root);
    expect(r.status, r.stdout).toBe(0);
    const p = JSON.parse(r.stdout);
    const call = p.functions.find((f: {
        name: string;
    }) => f.name === 'withProvider').calls.find((c: {
        expression: string;
    }) => c.expression === 'provider');
    expect(call.status).toBe('unknown');
    expect(call.targetId).toBeUndefined();
    expect(call.evidence.file).toBe('src/app.ts');
});
it('SCAN-001 never follows a source symlink outside the selected project', async () => {
    const root = await fixture(), outside = await mkdtemp(path.join(os.tmpdir(), 'pdd-scan-outside-'));
    roots.push(outside);
    await writeFile(path.join(outside, 'secret.ts'), 'export const NEVER_READ_OUTSIDE_MARKER=1;');
    await symlink(path.join(outside, 'secret.ts'), path.join(root, 'src/link.ts'));
    const r = scan(root);
    expect(r.status, r.stdout).toBe(1);
    const p = JSON.parse(r.stdout);
    expect(p.coverage.complete).toBe(false);
    expect(p.issues.some((i: {
        code: string;
    }) => i.code === 'symlink')).toBe(true);
    expect(r.stdout).not.toContain('NEVER_READ_OUTSIDE_MARKER');
    expect(r.stdout).not.toContain(outside);
});
it('SCAN-001 exposes skipped oversized sources and syntax errors as incomplete coverage', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'src/large.ts'), 'x'.repeat(1048577));
    await writeFile(path.join(root, 'src/broken.ts'), 'export function broken( {');
    const r = scan(root);
    expect(r.status, r.stdout).toBe(1);
    const p = JSON.parse(r.stdout);
    expect(p.coverage.complete).toBe(false);
    expect(p.issues.map((i: {
        code: string;
    }) => i.code)).toEqual(expect.arrayContaining(['file-size-limit', 'syntax-error']));
});
it('SCAN-001 respects shadowed import names when recording static call targets', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'src/shadow.ts'), "import {decision as decide} from './domain.js';\nexport function shadow(decide:(v:boolean)=>boolean){return decide(true);}\n");
    const r = scan(root);
    expect(r.status, r.stdout).toBe(0);
    const p = JSON.parse(r.stdout);
    const call = p.functions.find((f: {
        name: string;
    }) => f.name === 'shadow').calls[0];
    expect(call.status).toBe('unknown');
    expect(call.targetId).toBeUndefined();
});
it('SCAN-001 rejects backslash filenames instead of inventing canonical source evidence', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'src', 'wrong\\name.ts'), 'export function outside(){return true;}');
    const r = scan(root);
    expect(r.status, r.stdout).toBe(1);
    const p = JSON.parse(r.stdout);
    expect(p.issues.some((i: {
        code: string;
    }) => i.code === 'invalid-path')).toBe(true);
    expect(p.functions.some((f: {
        name: string;
    }) => f.name === 'outside')).toBe(false);
});
it('SCAN-001 does not propose declarations without implementations as proof candidates', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'src/api.d.ts'), 'export declare function declared(value:boolean):boolean;');
    const r = scan(root);
    expect(r.status, r.stdout).toBe(0);
    const p = JSON.parse(r.stdout), f = p.functions.find((f: {
        name: string;
    }) => f.name === 'declared');
    expect(f).toBeDefined();
    expect(p.candidates.some((c: {
        functionId: string;
    }) => c.functionId === f.id)).toBe(false);
});
it('SCAN-001 renders a Japanese evidence-labelled Atlas without executable diagram labels', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: '<script>alert(1)</script> ]-->attack' }));
    const r = scan(root, false);
    expect(r.status, r.stdout).toBe(0);
    expect(r.stdout).toContain('Architecture Atlas');
    for (const word of ['確認済み', '推測', '未確認', 'mermaid', 'src/domain.ts', '仕様の承認'])
        expect(r.stdout).toContain(word);
    expect(r.stdout).not.toContain('<script>');
    const diagrams = [...r.stdout.matchAll(/```mermaid\n([\s\S]*?)```/g)].map(m => m[1]);
    expect(diagrams.length).toBeGreaterThan(0);
    expect(diagrams.join('')).not.toContain('attack');
});
it('SCAN-001 derives three Hono response-flow candidates with evidence rather than runtime guarantees', async () => {
    const root = await fixture();
    await mkdir(path.join(root, 'src/domain'));
    await writeFile(path.join(root, 'src/app.ts'), await readFile('examples/existing-hono/src/app.ts'));
    await writeFile(path.join(root, 'src/domain/auth.ts'), await readFile('examples/existing-hono/src/domain/auth.ts'));
    const r = scan(root);
    expect(r.status, r.stdout).toBe(0);
    const p = JSON.parse(r.stdout);
    expect(p.atlas.flows).toHaveLength(3);
    expect(p.atlas.flows.every((f: {
        status: string;
        evidence: unknown[];
    }) => f.status === 'inferred' && f.evidence.length > 0)).toBe(true);
    expect(p.atlas.flows.map((f: {
        statusArgument: string | null;
    }) => f.statusArgument)).toEqual(expect.arrayContaining([null, '401', '503']));
    expect(p.atlas.documents.runtimeFlows).toContain('到達性');
    expect(p.atlas.documents.stateInvariants).toContain('未承認');
});
it('SCAN-001 observes package entrypoints tests and CI files without running configuration', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'meta', main: 'dist/server.js', bin: { cli: 'dist/cli.js' }, scripts: { test: 'touch EXECUTED' } }));
    await mkdir(path.join(root, '.github/workflows'), { recursive: true });
    await writeFile(path.join(root, '.github/workflows/ci.yml'), 'jobs:\n  test:\n    steps:\n      - run: touch EXECUTED\n');
    await mkdir(path.join(root, 'tests'));
    await writeFile(path.join(root, 'tests/example.test.ts'), 'export const marker=true;');
    const r = scan(root);
    expect(r.status, r.stdout).toBe(0);
    const p = JSON.parse(r.stdout);
    expect(p.metadata.entrypoints.some((e: {
        value: string;
    }) => e.value === 'dist/server.js')).toBe(true);
    expect(p.metadata.ciFiles).toContain('.github/workflows/ci.yml');
    expect(p.metadata.testFiles).toContain('tests/example.test.ts');
    expect(await readdir(root)).not.toContain('EXECUTED');
});
it('SCAN-001 stops oversized observation sets with an explicit incomplete result', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'src/flood.ts'), 'export function flood(){' + 'unknownTarget();'.repeat(20000) + '}');
    const r = scan(root);
    expect(r.status, r.stderr).toBe(1);
    const p = JSON.parse(r.stdout);
    expect(p.coverage.complete).toBe(false);
    expect(p.issues.some((i: {
        code: string;
    }) => ['fact-limit', 'time-limit', 'ast-limit'].includes(i.code))).toBe(true);
    expect(p.candidates.some((c: {
        functionId: string;
    }) => c.functionId.includes('flood'))).toBe(false);
});
it('SCAN-001 compares saved observations without turning an incomplete scan into deletions', async () => {
    const root = await fixture(), before = scan(root);
    expect(before.status, before.stdout).toBe(0);
    await writeFile(path.join(root, 'baseline.json'), before.stdout);
    await writeFile(path.join(root, 'src/domain.ts'), (await readFile(path.join(root, 'src/domain.ts'), 'utf8')) + 'export function added(){return true;}');
    const r = scan(root, true, ['--previous', 'baseline.json']);
    expect(r.status, r.stdout).toBe(0);
    const p = JSON.parse(r.stdout);
    expect(p.changes.status).toBe('proposal');
    expect(p.changes.files.changed).toContain('src/domain.ts');
    expect(p.changes.functionDeclarations.added.some((f: {
        name: string;
    }) => f.name === 'added')).toBe(true);
    const incomplete = JSON.parse(before.stdout);
    incomplete.coverage.complete = false;
    await writeFile(path.join(root, 'incomplete.json'), JSON.stringify(incomplete));
    const uncertain = scan(root, true, ['--previous', 'incomplete.json']);
    expect(uncertain.status, uncertain.stdout).toBe(0);
    expect(JSON.parse(uncertain.stdout).changes.status).toBe('incomplete');
    expect(JSON.parse(uncertain.stdout).changes.files.removed).toEqual([]);
});
it('SCAN-001 rejects a fabricated baseline digest and an outside baseline path', async () => {
    const root = await fixture(), before = scan(root);
    const p = JSON.parse(before.stdout);
    p.sourceDigest = '0'.repeat(64);
    await writeFile(path.join(root, 'forged.json'), JSON.stringify(p));
    expect(scan(root, true, ['--previous', 'forged.json']).status).toBe(2);
    expect(scan(root, true, ['--previous', '../outside.json']).status).toBe(2);
});
it('SCAN-001 keeps same-line callbacks and shadowed nested declarations distinct', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'src/app.ts'), "declare const app:any; app.get('/a', c=>c.json('A',201)); app.get('/b', c=>c.json('B',202)); export function x(){function same(){return 1;}return same();} export function y(){function same(){return 2;}return same();}");
    const r = scan(root);
    expect(r.status, r.stdout).toBe(0);
    const p = JSON.parse(r.stdout);
    expect(new Set(p.functions.map((f: {
        id: string;
    }) => f.id)).size).toBe(p.functions.length);
    const a = p.atlas.flows.find((f: {
        name: string;
    }) => f.name.startsWith('GET /a'));
    const b = p.atlas.flows.find((f: {
        name: string;
    }) => f.name.startsWith('GET /b'));
    expect(a.statusArgument).toBe('201');
    expect(a.steps.join(' ')).toContain("'A'");
    expect(b.statusArgument).toBe('202');
    expect(a.functionId).not.toBe(b.functionId);
    const x = p.functions.find((f: {
        name: string;
    }) => f.name === 'x'), y = p.functions.find((f: {
        name: string;
    }) => f.name === 'y');
    expect(x.calls[0].targetId).not.toBe(y.calls[0].targetId);
    await writeFile(path.join(root, 'baseline.json'), r.stdout);
    expect(scan(root, true, ['--previous', 'baseline.json']).status).toBe(0);
});
it('SCAN-001 resolves JSONC paths through local tsconfig inheritance without running plugins', async () => {
    const root = await fixture();
    await writeFile(path.join(root, 'EXECUTED.js'), `require('node:fs').writeFileSync(${JSON.stringify(path.join(root, 'EXECUTED'))},'plugin ran'); module.exports=()=>({create:info=>info.languageService});`);
    await mkdir(path.join(root, 'configs'));
    await writeFile(path.join(root, 'configs/tsconfig.base.json'), '{"compilerOptions":{"paths":{"@domain/*":["../src/*"]}}}');
    await writeFile(path.join(root, 'tsconfig.json'), '// config is data\n{"extends":"./configs/tsconfig.base.json","compilerOptions":{"plugins":[{"name":"./EXECUTED.js"}]},}');
    await writeFile(path.join(root, 'src/app.ts'), "import {decision} from '@domain/domain'; export function entry(){return decision(true);}");
    const r = scan(root);
    expect(r.status, r.stdout).toBe(0);
    const p = JSON.parse(r.stdout);
    expect(p.configuration.status).toBe('applied');
    expect(p.configuration.files).toContain('configs/tsconfig.base.json');
    expect(p.modules.find((m: {
        file: string;
    }) => m.file === 'src/app.ts').imports[0]).toMatchObject({ resolution: 'local', target: 'src/domain.ts' });
    expect(p.functions.find((f: {
        name: string;
    }) => f.name === 'entry').calls[0].status).toBe('confirmed');
    expect(await readdir(root)).not.toContain('EXECUTED');
});
it('SCAN-001 respects child baseUrl overrides and does not resolve an external config', async () => {
    const root = await fixture();
    await mkdir(path.join(root, 'other'));
    await writeFile(path.join(root, 'other/domain.ts'), 'export function decision(){return false;}');
    await writeFile(path.join(root, 'tsconfig.base.json'), '{"compilerOptions":{"baseUrl":"./src","paths":{"@domain/*":["*"]}}}');
    await writeFile(path.join(root, 'tsconfig.json'), '{"extends":"./tsconfig.base.json","compilerOptions":{"baseUrl":"./other"}}');
    await writeFile(path.join(root, 'src/app.ts'), "import {decision} from '@domain/domain'; export function entry(){return decision();}");
    const p = JSON.parse(scan(root).stdout);
    expect(p.configuration.status).toBe('applied');
    expect(p.modules.find((m: {
        file: string;
    }) => m.file === 'src/app.ts').imports[0].target).toBe('other/domain.ts');
    await writeFile(path.join(root, 'tsconfig.json'), '{"extends":"outside-package/tsconfig.json","compilerOptions":{"baseUrl":"./src","paths":{"@domain/*":["*"]}}}');
    const r = scan(root);
    expect(r.status, r.stdout).toBe(1);
    const q = JSON.parse(r.stdout);
    expect(q.configuration.status).toBe('unresolved');
    expect(q.modules.find((m: {
        file: string;
    }) => m.file === 'src/app.ts').imports[0].target).toBeUndefined();
});
it('SCAN-001 rejects cyclic malformed and escaping configuration instead of guessing aliases', async () => {
    const root = await fixture();
    for (const text of ['{"extends":"./tsconfig.json"}', '{"compilerOptions":{"baseUrl":"../outside"}}', '{"compilerOptions":{"paths":{"@x/*":["../../outside/*"]}}}', '{"compilerOptions":']) {
        await writeFile(path.join(root, 'tsconfig.json'), text);
        const r = scan(root);
        expect(r.status, r.stdout).toBe(1);
        const p = JSON.parse(r.stdout);
        expect(p.configuration.status).toBe('unresolved');
        expect(p.coverage.complete).toBe(false);
    }
});
it('SCAN-001 reads bounded Git change frequency only when explicitly requested', async () => {
    const root = await fixture();
    const git = (...args: string[]) => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }); expect(r.status, r.stderr).toBe(0); return r.stdout; };
    git('init', '-q');
    git('config', 'user.name', 'Scanner fixture');
    git('config', 'user.email', 'scanner@example.invalid');
    git('add', '.');
    git('commit', '-qm', 'initial');
    await writeFile(path.join(root, 'src/domain.ts'), (await readFile(path.join(root, 'src/domain.ts'), 'utf8')) + '\n');
    git('add', '.');
    git('commit', '-qm', 'domain change');
    const before = await readFile(path.join(root, '.git/config'), 'utf8');
    git('config', 'core.fsmonitor', 'touch EXECUTED');
    git('config', 'core.pager', 'touch EXECUTED');
    const protectedPaths = ['.git/index', '.git/HEAD', '.git/config', '.git/logs/HEAD'];
    const protectedBytes = await Promise.all(protectedPaths.map(p => readFile(path.join(root, p))));
    const plain = JSON.parse(scan(root).stdout);
    expect(plain.history).toBeUndefined();
    const r = scan(root, true, ['--history']);
    expect(r.status, r.stdout).toBe(0);
    const p = JSON.parse(r.stdout);
    expect(p.history.status).toBe('available');
    expect(p.history.commitCount).toBe(2);
    expect(p.history.files.find((f: {
        file: string;
    }) => f.file === 'src/domain.ts').changes).toBe(2);
    expect(p.history.head).toMatch(/^[a-f0-9]{40,64}$/);
    expect(await readdir(root)).not.toContain('EXECUTED');
    expect(await Promise.all(protectedPaths.map(p => readFile(path.join(root, p))))).toEqual(protectedBytes);
    git('config', '--unset', 'core.fsmonitor');
    git('config', '--unset', 'core.pager');
    expect(await readFile(path.join(root, '.git/config'), 'utf8')).toBe(before);
    const nested = scan(path.join(root, 'src'), true, ['--history']);
    expect(nested.status, nested.stdout).toBe(0);
    expect(JSON.parse(nested.stdout).history.files.some((f: {
        file: string;
    }) => f.file === 'domain.ts')).toBe(true);
});
it('SCAN-001 reports missing or unborn Git history without weakening the scan result', async () => {
    const root = await fixture();
    const r = scan(root, true, ['--history']);
    expect(r.status, r.stdout).toBe(0);
    const p = JSON.parse(r.stdout);
    expect(p.history.status).toBe('unavailable');
    expect(p.history.files).toEqual([]);
    const init = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' });
    expect(init.status, init.stderr).toBe(0);
    expect(JSON.parse(scan(root, true, ['--history']).stdout).history.status).toBe('unavailable');
    expect(scan(root, true, ['--history', '--previous', '../outside.json']).status).toBe(2);
    const invalid = spawnSync(process.execPath, [cli, 'init', '--project', root, '--history', '--json'], { encoding: 'utf8' });
    expect(invalid.status).toBe(2);
});
it('SCAN-001 bounds history and refuses shallow or promisor frequency claims', async () => {
    const root = await fixture();
    const git = (...args: string[]) => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }); expect(r.status, r.stderr).toBe(0); return r.stdout; };
    git('init', '-q');
    git('config', 'user.name', 'Scanner fixture');
    git('config', 'user.email', 'scanner@example.invalid');
    git('add', '.');
    git('commit', '-qm', 'initial');
    const branch = git('symbolic-ref', 'HEAD').trim(), parent = git('rev-parse', 'HEAD').trim();
    let stream = '';
    for (let i = 0; i < 101; i++) {
        const value = 'revision ' + i;
        stream += `commit ${branch}\nmark :${i + 1}\ncommitter Scanner <scanner@example.invalid> ${1700000000 + i} +0000\ndata 6\nchange\nfrom ${i === 0 ? parent : ':' + i}\nM 100644 inline README.md\ndata ${Buffer.byteLength(value)}\n${value}\n\n`;
    }
    const imported = spawnSync('git', ['fast-import', '--quiet'], { cwd: root, input: stream, encoding: 'utf8', env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
    expect(imported.status, imported.stderr).toBe(0);
    await writeFile(path.join(root, 'README.md'), 'revision 100');
    const r = scan(root, true, ['--history']);
    expect(r.status, r.stdout).toBe(0);
    const h = JSON.parse(r.stdout).history;
    expect(h.commitCount).toBe(100);
    expect(h.commits).toHaveLength(100);
    expect(h.truncated).toBe(true);
    expect(h.files.find((f: {
        file: string;
    }) => f.file === 'README.md').changes).toBe(100);
    await writeFile(path.join(root, '.git/shallow'), git('rev-parse', 'HEAD'));
    const shallow = JSON.parse(scan(root, true, ['--history']).stdout).history;
    expect(shallow.status).toBe('incomplete');
    expect(shallow.shallow).toBe(true);
    expect(shallow.files).toEqual([]);
    await rm(path.join(root, '.git/shallow'));
    git('config', 'remote.origin.promisor', 'true');
    git('config', 'remote.origin.url', 'ext::touch EXECUTED');
    git('config', 'protocol.ext.allow', 'always');
    const partial = JSON.parse(scan(root, true, ['--history']).stdout).history;
    expect(partial.status).toBe('unavailable');
    expect(partial.files).toEqual([]);
    expect(await readdir(root)).not.toContain('EXECUTED');
    expect(await readdir(path.join(root, '.git'))).not.toContain('FETCH_HEAD');
});
it('SCAN-001 bounds repeated configuration inheritance and exposes unresolved local aliases', async () => {
    const files = new Map<string, string>([['tsconfig.json', '{"extends":"./tsconfig.level0.json"}']]);
    for (let i = 0; i < 7; i++)
        files.set(`tsconfig.level${i}.json`, i === 6 ? '{}' : JSON.stringify({ extends: Array(4).fill(`./tsconfig.level${i + 1}.json`) }));
    let reads = 0;
    const get = files.get.bind(files);
    files.get = (key: string) => {
        if (++reads > 64)
            throw new Error('excessive repeated reads');
        return get(key);
    };
    expect(readScanConfiguration(files, new Map([...files.keys()].map(k => [k, 'a'.repeat(64)]))).metadata.status).toBe('applied');
    expect(reads).toBeLessThanOrEqual(64);
    const root = await fixture();
    await writeFile(path.join(root, 'tsconfig.json'), '{"compilerOptions":{"paths":{"@domain/*":["src/missing/*"]}}}');
    await writeFile(path.join(root, 'src/app.ts'), "import {decision} from '@domain/domain';export function f(){return decision();}");
    const r = scan(root);
    expect(r.status, r.stdout).toBe(1);
    const p = JSON.parse(r.stdout);
    expect(p.issues.some((i: {
        code: string;
    }) => i.code === 'unresolved-alias')).toBe(true);
    expect(p.functions.find((f: {
        name: string;
    }) => f.name === 'f').calls[0].status).toBe('unknown');
});
it('SCAN-001 treats marker-like Git filenames as data rather than fabricated commits', async () => {
    const root = await fixture();
    const git = (...args: string[]) => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }); expect(r.status, r.stderr).toBe(0); return r.stdout; };
    await writeFile(path.join(root, 'PDD_COMMIT:' + '0'.repeat(40)), 'ordinary unscanned file');
    git('init', '-q');
    git('config', 'user.name', 'Scanner fixture');
    git('config', 'user.email', 'scanner@example.invalid');
    git('add', '.');
    git('commit', '-qm', 'initial');
    const r = scan(root, true, ['--history']);
    expect(r.status, r.stdout).toBe(0);
    const h = JSON.parse(r.stdout).history;
    expect(h.status).toBe('available');
    expect(h.commitCount).toBe(1);
    expect(h.commits).toEqual([git('rev-parse', 'HEAD').trim()]);
    expect(h.files.find((f: {
        file: string;
    }) => f.file === 'src/domain.ts').changes).toBe(1);
});
it('SCAN-001 does not invent baseUrl lookup for unrelated bare imports', async () => {
    const root = await fixture();
    const config = { compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext', paths: { '@unused/*': ['./*'] } } };
    await writeFile(path.join(root, 'tsconfig.json'), JSON.stringify(config));
    await writeFile(path.join(root, 'dep.ts'), 'export function choose(){return true;}');
    await writeFile(path.join(root, 'src/app.ts'), "import {choose as bare} from 'dep';import {choose as mapped} from '@unused/dep';export function entry(){return bare()&&mapped();}");
    const files = new Map([['/oracle/dep.ts', 'export function choose(){return true;}'], ['/oracle/src/app.ts', '']]);
    const host = { useCaseSensitiveFileNames: true, fileExists: (p: string) => files.has(p), readFile: (p: string) => files.get(p), readDirectory: () => [], directoryExists: (p: string) => p === '/oracle' || p === '/oracle/src', getCurrentDirectory: () => '/oracle', getDirectories: () => [] };
    const options = ts.parseJsonConfigFileContent(config, host, '/oracle').options;
    expect(ts.resolveModuleName('dep', '/oracle/src/app.ts', options, host).resolvedModule).toBeUndefined();
    const r = scan(root);
    expect(r.status, r.stdout).toBe(0);
    const p = JSON.parse(r.stdout), imports = p.modules.find((m: {
        file: string;
    }) => m.file === 'src/app.ts').imports;
    expect(imports.find((i: {
        specifier: string;
    }) => i.specifier === 'dep').target).toBeUndefined();
    expect(imports.find((i: {
        specifier: string;
    }) => i.specifier === '@unused/dep').target).toBe('dep.ts');
    expect(p.configuration.baseUrl).toBeNull();
    const calls = p.functions.find((f: {
        name: string;
    }) => f.name === 'entry').calls;
    expect(calls.find((c: {
        expression: string;
    }) => c.expression === 'bare').status).toBe('unknown');
    expect(calls.find((c: {
        expression: string;
    }) => c.expression === 'mapped').status).toBe('confirmed');
});
