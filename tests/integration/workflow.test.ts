import { loadProject } from '../../src/requirements/project.js';
import { createSpecSnapshot } from '../../src/requirements/snapshot.js';
import { compareSpecs } from '../../src/requirements/diff.js';
import { renderHumanReviewCard } from '../../src/ci/review.js';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { stringify } from 'yaml';
const cli = path.join(process.cwd(), 'dist/cli/main.js'), roots: string[] = [];
const call = (root: string, command: string, extra: string[] = []) => spawnSync(process.execPath, [cli, command, '--project', root, '--json', ...extra], { encoding: 'utf8', timeout: 30000, maxBuffer: 2097152, env: { PATH: process.env.PATH } });
async function fixture() {
    const root = await mkdtemp(path.join(os.tmpdir(), 'pdd-workflow-'));
    roots.push(root);
    expect(call(root, 'init').status).toBe(0);
    await writeFile(path.join(root, 'domain.ts'), 'export function domain(){return true;}\n');
    for (const [id, risk] of [['AUTH-1', 'high'], ['TEXT-1', 'low']])
        await writeFile(path.join(root, `.pdd/requirements/${id}.yaml`), stringify({ id, revision: 1, title: id, intent: 'Authored behavior', risk, target: { file: 'domain.ts', symbol: 'domain' }, contracts: [], acceptance: [], trustedBoundaries: [] }));
    await writeFile(path.join(root, '.pdd/obligations.yaml'), stringify([{ id: 'tests', requirementIds: ['AUTH-1', 'TEXT-1'], kind: 'test', scope: 'fixture', contractIds: [] }]));
    return root;
}
const decision = (id: string, kind = 'human-specification', requirementIds = ['AUTH-1']) => ({ id, group: 'auth', kind, requirementIds, state: 'open', question: '有効期間を決める', recommendation: '短い有効期間', alternatives: [{ label: '短い', tradeoff: '再認証が増える' }, { label: '長い', tradeoff: '失効まで長くなる' }], impact: '認証境界', blocking: false, evidence: [{ file: 'domain.ts', line: 1 }] });
const registry = (root: string, items: unknown[]) => writeFile(path.join(root, '.pdd/decisions.yaml'), stringify({ schemaVersion: 1, decisions: items }));
afterEach(async () => {
    for (const r of roots.splice(0))
        await rm(r, { recursive: true, force: true });
});
it('WF-001 plans without running code and does not treat an empty queue as approval', async () => { const root = await fixture(), before = (await readdir(path.join(root, '.pdd'))).sort(); const r = call(root, 'plan'); expect(r.status, r.stdout).toBe(0); const p = JSON.parse(r.stdout); expect(p.kind).toBe('decision-plan'); expect(p.status).toBe('no-open-decisions'); expect(p.implementationPermission).toBe('not-established'); expect((await readdir(path.join(root, '.pdd'))).sort()).toEqual(before); });
it('WF-001 groups human questions and keeps facts and implementation tasks with development', async () => { const root = await fixture(); await registry(root, [decision('D1'), decision('D2'), decision('F1', 'fact'), decision('I1', 'implementation')]); const r = call(root, 'plan'); expect(r.status, r.stdout).toBe(1); const p = JSON.parse(r.stdout); expect(p.cards).toHaveLength(1); expect(p.cards[0].decisions).toHaveLength(2); expect(p.developmentTasks).toHaveLength(2); expect(p.blocked).toBe(true); expect(p.cards[0].decisions[0].evidence[0].digest).toMatch(/^[a-f0-9]{64}$/); });
it('WF-001 never upgrades an authored answer into owner approval', async () => { const root = await fixture(); await registry(root, [{ ...decision('D1'), state: 'answered', answer: '本人と短期で合意したと作者が記録' }]); const r = call(root, 'plan'); expect(r.status, r.stdout).toBe(0); const p = JSON.parse(r.stdout); expect(p.implementationPermission).toBe('not-established'); expect(p.recordedAnswers).toHaveLength(1); expect(p.cards).toEqual([]); });
it('WF-001 rejects fabricated approval fields unknown references unsafe evidence and invalid lines', async () => {
    const root = await fixture();
    for (const item of [{ ...decision('D1'), approved: true }, { ...decision('D1'), requirementIds: ['UNKNOWN'] }, { ...decision('D1'), evidence: [{ file: '../outside.ts', line: 1 }] }, { ...decision('D1'), evidence: [{ file: 'domain.ts', line: 999 }] }, { ...decision('D1'), state: 'answered' }]) {
        await registry(root, [item]);
        const r = call(root, 'plan');
        expect(r.status, r.stdout).toBe(2);
    }
});
it('WF-001 blocks high-risk workers before executing empirical tests', async () => {
    const root = await fixture();
    await registry(root, [decision('D1')]);
    await writeFile(path.join(root, 'worker.test.ts'), "import {writeFileSync} from 'node:fs';writeFileSync('EXECUTED','bad');");
    await writeFile(path.join(root, '.pdd/config.yaml'), stringify({ schemaVersion: 1, targets: [], testTargets: [{ obligationId: 'tests', files: ['worker.test.ts'], inputs: ['worker.test.ts'], requiredTests: ['must not run'] }] }));
    for (const args of [['init', '-q'], ['config', 'user.name', 'Workflow fixture'], ['config', 'user.email', 'fixture@example.invalid'], ['add', '.'], ['commit', '-qm', 'fixture']])
        expect(spawnSync('git', args, { cwd: root, encoding: 'utf8' }).status).toBe(0);
    const r = call(root, 'verify');
    expect(r.status, r.stdout).toBe(1);
    const p = JSON.parse(r.stdout);
    expect(p.gate.status).toBe('blocked');
    expect(p.evidence).toEqual([]);
    expect(await readdir(root)).not.toContain('EXECUTED');
});
it('WF-001 installs project skills only explicitly and never overwrites existing paths', async () => { const root = await fixture(); const r = call(root, 'skills', ['--agent', 'codex']); expect(r.status, r.stdout).toBe(0); const p = JSON.parse(r.stdout); expect(p.installed).toHaveLength(5); const file = path.join(root, '.agents/skills/pdd-plan/SKILL.md'); const text = await readFile(file, 'utf8'); expect(text).toContain('name: pdd-plan'); expect(text).toContain('plan'); expect(await readFile(path.join(root, '.agents/skills/pdd-plan/references/decisions.md'), 'utf8')).toContain('human-specification'); expect(call(root, 'skills', ['--agent', 'codex']).status).toBe(2); expect(await readFile(file, 'utf8')).toBe(text); });
it('WF-001 renders blocking human decisions before technical evidence', async () => {
    const root = await fixture();
    await registry(root, [decision('D1')]);
    for (const args of [['init', '-q'], ['config', 'user.name', 'Workflow fixture'], ['config', 'user.email', 'fixture@example.invalid'], ['add', '.'], ['commit', '-qm', 'fixture']])
        expect(spawnSync('git', args, { cwd: root }).status).toBe(0);
    expect(call(root, 'verify').status).toBe(1);
    const r = spawnSync(process.execPath, [cli, 'review', '--project', root], { encoding: 'utf8' });
    expect(r.status, r.stdout).toBe(1);
    expect(r.stdout.indexOf('有効期間を決める')).toBeGreaterThanOrEqual(0);
    expect(r.stdout.indexOf('有効期間を決める')).toBeLessThan(r.stdout.indexOf('<details>'));
});
it('WF-001 keeps low-risk nonblocking questions open without inventing permission', async () => { const root = await fixture(); await registry(root, [decision('D1', 'human-specification', ['TEXT-1'])]); const r = call(root, 'plan'); expect(r.status, r.stdout).toBe(0); const p = JSON.parse(r.stdout); expect(p.status).toBe('open-nonblocking'); expect(p.blocked).toBe(false); expect(p.implementationPermission).toBe('not-established'); });
it('WF-001 binds answers and evidence changes into specification freshness', async () => { const root = await fixture(); await registry(root, [{ ...decision('D1'), state: 'answered', answer: 'short' }]); const before = JSON.parse(call(root, 'plan').stdout).specDigest; await writeFile(path.join(root, 'domain.ts'), 'export function domain(){return false;}\n'); const changed = JSON.parse(call(root, 'plan').stdout).specDigest; expect(changed).not.toBe(before); await registry(root, [{ ...decision('D1'), state: 'answered', answer: 'long' }]); expect(JSON.parse(call(root, 'plan').stdout).specDigest).not.toBe(changed); });
it('WF-001 rejects oversized duplicate and linked decision registries', async () => { const root = await fixture(); await writeFile(path.join(root, '.pdd/decisions.yaml'), 'x'.repeat(262145)); expect(call(root, 'plan').status).toBe(2); await registry(root, [decision('D1'), decision('D1')]); expect(call(root, 'plan').status).toBe(2); await rm(path.join(root, '.pdd/decisions.yaml')); const outside = await mkdtemp(path.join(os.tmpdir(), 'pdd-decision-outside-')); roots.push(outside); await writeFile(path.join(outside, 'input.yaml'), '{}'); await symlink(path.join(outside, 'input.yaml'), path.join(root, '.pdd/decisions.yaml')); expect(call(root, 'plan').status).toBe(2); });
it('WF-001 preflights every skill destination before writing and rejects links', async () => { const root = await fixture(); await mkdir(path.join(root, '.agents/skills/pdd-review'), { recursive: true }); await writeFile(path.join(root, '.agents/skills/pdd-review/SKILL.md'), 'KEEP'); expect(call(root, 'skills', ['--agent', 'codex']).status).toBe(2); expect((await readdir(path.join(root, '.agents/skills'))).sort()).toEqual(['pdd-review']); await rm(path.join(root, '.agents'), { recursive: true }); const outside = await mkdtemp(path.join(os.tmpdir(), 'pdd-skills-outside-')); roots.push(outside); await symlink(outside, path.join(root, '.agents')); expect(call(root, 'skills', ['--agent', 'codex']).status).toBe(2); expect(await readdir(outside)).toEqual([]); });
it('WF-001 keeps review as evidence reporting and rejects unrelated adapter options', async () => { const root = await fixture(); const r = call(root, 'review'); expect(r.status, r.stdout).toBe(1); expect(JSON.parse(r.stdout).gate.status).toBe('blocked'); expect(call(root, 'plan', ['--agent', 'codex']).status).toBe(2); expect(call(root, 'skills', ['--agent', 'unknown']).status).toBe(2); });
it('WF-001 requires requirement revision changes for answers and includes them in human review', async () => {
    const root = await fixture();
    await registry(root, [{ ...decision('D1'), state: 'answered', answer: 'short' }]);
    const before = await createSpecSnapshot(await loadProject(root));
    await registry(root, [{ ...decision('D1'), state: 'answered', answer: 'long' }]);
    const after = await createSpecSnapshot(await loadProject(root));
    expect(compareSpecs(before, after).valid).toBe(false);
    const file = path.join(root, '.pdd/requirements/AUTH-1.yaml');
    await writeFile(file, (await readFile(file, 'utf8')).replace('revision: 1', 'revision: 2'));
    const revised = await createSpecSnapshot(await loadProject(root));
    expect(compareSpecs(before, revised).valid).toBe(true);
    const card = renderHumanReviewCard({ repository: 'example/project', baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40), baseline: before, head: revised });
    expect(card).toContain('long');
    expect(card).toContain('D1');
});
it('WF-001 rechecks decisions changed by a worker before returning its result', async () => {
    const root = await fixture();
    await registry(root, [{ ...decision('D1'), state: 'answered', answer: 'short' }]);
    await writeFile(path.join(root, 'worker.test.ts'), `import {writeFileSync} from 'node:fs';writeFileSync('.pdd/decisions.yaml',${JSON.stringify(stringify({ schemaVersion: 1, decisions: [decision('D1')] }))});`);
    await writeFile(path.join(root, '.pdd/config.yaml'), stringify({ schemaVersion: 1, targets: [], testTargets: [{ obligationId: 'tests', files: ['worker.test.ts'], inputs: ['worker.test.ts'], requiredTests: ['mutation exercise'] }] }));
    for (const args of [['init', '-q'], ['config', 'user.name', 'Workflow fixture'], ['config', 'user.email', 'fixture@example.invalid'], ['add', '.'], ['commit', '-qm', 'fixture']])
        expect(spawnSync('git', args, { cwd: root }).status).toBe(0);
    const r = call(root, 'verify');
    const p = JSON.parse(r.stdout);
    expect(await readFile(path.join(root, '.pdd/decisions.yaml'), 'utf8')).toContain('state: open');
    expect(p.workflow.blocked).toBe(true);
    expect(p.specDigest).not.toBe(p.recordedSpecDigest);
    const report = spawnSync(process.execPath, [cli, 'review', '--project', root], { encoding: 'utf8' });
    expect(report.stdout).not.toContain('検証は開始していません');
});
it('WF-001 rejects non-UTF8 evidence instead of hashing replacement characters', async () => { const root = await fixture(); await writeFile(path.join(root, 'raw.bin'), Buffer.from([255, 254])); await registry(root, [{ ...decision('D1'), evidence: [{ file: 'raw.bin', line: 1 }] }]); expect(call(root, 'plan').status).toBe(2); });
it('WF-001 reports an empty initialized project as development work rather than readiness', async () => { const root = await mkdtemp(path.join(os.tmpdir(), 'pdd-empty-workflow-')); roots.push(root); expect(call(root, 'init').status).toBe(0); const r = call(root, 'plan'); expect(r.status, r.stdout).toBe(1); const p = JSON.parse(r.stdout); expect(p.status).toBe('needs-development'); expect(p.implementationPermission).toBe('not-established'); });
it('WF-001 suppresses configured tool execution in blocked verify report and review', async () => {
    const root = await fixture();
    await registry(root, [decision('D1')]);
    await writeFile(path.join(root, 'domain.ts'), '//@ ensures \\result === true\nexport function domain(){return true;}\n');
    const executable = path.join(root, 'fake-dafny');
    await writeFile(executable, `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(path.join(root, 'VERSION_EXECUTED'))},'version');process.stdout.write('4.11.0\\n');\n`, { mode: 0o700 });
    await writeFile(path.join(root, '.pdd/config.yaml'), stringify({ schemaVersion: 1, tools: { dafnyPath: executable, solverPath: executable }, targets: [{ file: 'domain.ts', symbol: 'domain' }] }));
    await writeFile(path.join(root, '.pdd/requirements/AUTH-1.yaml'), stringify({ id: 'AUTH-1', revision: 1, title: 'auth', intent: 'auth', risk: 'high', target: { file: 'domain.ts', symbol: 'domain' }, contracts: [{ id: 'AUTH-1-C1', kind: 'postcondition', human: 'true', sourceRef: { file: 'domain.ts', symbol: 'domain', clause: 'ensures', index: 0 }, semantics: 'profile:pdd-pure-v1' }], acceptance: [], trustedBoundaries: [] }));
    await writeFile(path.join(root, '.pdd/obligations.yaml'), stringify([{ id: 'proof', requirementIds: ['AUTH-1', 'TEXT-1'], kind: 'source-proof', scope: 'domain.ts#domain', contractIds: ['AUTH-1-C1'] }]));
    for (const args of [['init', '-q'], ['config', 'user.name', 'Workflow fixture'], ['config', 'user.email', 'fixture@example.invalid'], ['add', '.'], ['commit', '-qm', 'fixture']])
        expect(spawnSync('git', args, { cwd: root }).status).toBe(0);
    for (const command of ['verify', 'report', 'review']) {
        const r = call(root, command);
        expect(r.status, r.stdout).toBe(1);
        expect(JSON.parse(r.stdout).workflow.blocked).toBe(true);
        expect(await readdir(root)).not.toContain('VERSION_EXECUTED');
    }
});
it('WF-001 stops subsequent workers when a running worker changes its decision input', async () => {
    const root = await fixture();
    await registry(root, [{ ...decision('D1'), state: 'answered', answer: 'short' }]);
    await writeFile(path.join(root, 'first.test.ts'), `import {writeFileSync} from 'node:fs';writeFileSync('.pdd/decisions.yaml',${JSON.stringify(stringify({ schemaVersion: 1, decisions: [decision('D1')] }))});`);
    await writeFile(path.join(root, 'second.test.ts'), "import {writeFileSync} from 'node:fs';writeFileSync('SECOND_WORKER','ran');");
    await writeFile(path.join(root, '.pdd/config.yaml'), stringify({ schemaVersion: 1, targets: [], testTargets: [{ obligationId: 'a-tests', files: ['first.test.ts'], inputs: ['first.test.ts'], requiredTests: ['first'] }, { obligationId: 'b-tests', files: ['second.test.ts'], inputs: ['second.test.ts'], requiredTests: ['second'] }] }));
    await writeFile(path.join(root, '.pdd/obligations.yaml'), stringify(['a-tests', 'b-tests'].map(id => ({ id, requirementIds: ['AUTH-1', 'TEXT-1'], kind: 'test', scope: id, contractIds: [] }))));
    for (const args of [['init', '-q'], ['config', 'user.name', 'Workflow fixture'], ['config', 'user.email', 'fixture@example.invalid'], ['add', '.'], ['commit', '-qm', 'fixture']])
        expect(spawnSync('git', args, { cwd: root }).status).toBe(0);
    const r = call(root, 'verify');
    expect(await readFile(path.join(root, '.pdd/decisions.yaml'), 'utf8')).toContain('state: open');
    expect(await readdir(root)).not.toContain('SECOND_WORKER');
    expect(JSON.parse(r.stdout).workflow.blocked).toBe(true);
});
