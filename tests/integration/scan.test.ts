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
