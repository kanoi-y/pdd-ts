import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { initProject, loadProject } from '../../src/requirements/project.js';
import { createSpecSnapshot } from '../../src/requirements/snapshot.js';

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pdd-spec-'));
  roots.push(root);
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src/auth.ts'), await readFile('tests/fixtures/poc/auth.ts'));
  await initProject(root);
  const config = parse(await readFile(path.join(root, '.pdd/config.yaml'), 'utf8'));
  config.targets = [{ file: 'src/auth.ts', symbol: 'canIssueAdminToken' }];
  await writeFile(path.join(root, '.pdd/config.yaml'), stringify(config));
  const requirement = { id: 'AUTH-001', revision: 1, title: 'Auth', intent: 'Both conditions are required', risk: 'high',
    target: config.targets[0], contracts: [{ id: 'AUTH-001-C1', kind: 'postcondition', human: 'Both are necessary and sufficient',
      sourceRef: { ...config.targets[0], clause: 'ensures', index: 0 }, semantics: 'pdd-pure-v1' }], acceptance: [], trustedBoundaries: [] };
  await writeFile(path.join(root, '.pdd/requirements/AUTH-001.yaml'), stringify(requirement));
  await writeFile(path.join(root, '.pdd/obligations.yaml'), stringify([{ id: 'auth-proof', requirementIds: ['AUTH-001'], kind: 'source-proof', scope: 'src/auth.ts#canIssueAdminToken', contractIds: ['AUTH-001-C1'] }]));
  return { root, requirement };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('SPEC-002: complete specification snapshots', () => {
  it('keeps a body-only change out of the specification digest', async () => {
    const { root } = await fixture();
    const before = await createSpecSnapshot(await loadProject(root));
    expect(before.complete).toBe(true);
    const code = await readFile(path.join(root, 'src/auth.ts'), 'utf8');
    await writeFile(path.join(root, 'src/auth.ts'), code.replace('return role === "admin" && passwordOk;', 'return true;'));
    expect((await createSpecSnapshot(await loadProject(root))).digest).toBe(before.digest);
  });
  it('includes every precondition even if the requirement only references ensures', async () => {
    const { root } = await fixture();
    const before = await createSpecSnapshot(await loadProject(root));
    await writeFile(path.join(root, 'src/auth.ts'), '//@ requires passwordOk === true\n' + await readFile(path.join(root, 'src/auth.ts'), 'utf8'));
    const after = await createSpecSnapshot(await loadProject(root));
    expect(after.digest).not.toBe(before.digest);
    expect(after.contracts[0]?.declaration.requires).toEqual(['passwordOk === true']);
  });
  it('rejects a missing source clause instead of silently rebinding its contract ID', async () => {
    const { root, requirement } = await fixture();
    requirement.contracts[0]!.sourceRef.index = 99;
    await writeFile(path.join(root, '.pdd/requirements/AUTH-001.yaml'), stringify(requirement));
    const result = await createSpecSnapshot(await loadProject(root));
    expect(result.complete).toBe(false);
    expect(result.errors.join(' ')).toMatch(/AUTH-001-C1/);
  });
  it('binds policy changes and does not accept unknown requirement IDs', async () => {
    const { root } = await fixture();
    const before = await createSpecSnapshot(await loadProject(root));
    const config = parse(await readFile(path.join(root, '.pdd/config.yaml'), 'utf8'));
    config.approvedAssumptions.push('new-trust');
    await writeFile(path.join(root, '.pdd/config.yaml'), stringify(config));
    expect((await createSpecSnapshot(await loadProject(root))).digest).not.toBe(before.digest);
    await writeFile(path.join(root, '.pdd/obligations.yaml'), stringify([{ id: 'unknown', requirementIds: ['OTHER-001'], kind: 'test', scope: 'tests', contractIds: [] }]));
    await expect(loadProject(root)).rejects.toThrow(/Unknown requirement/);
  });
});

import { extractDeclaredContracts } from '../../src/verification/contracts.js';
it('SPEC-002 rejects oversized source before launching contract extraction',async()=>{
 const {root}=await fixture(); await writeFile(path.join(root,'src/auth.ts'),' '.repeat(1_048_577));
 await expect(extractDeclaredContracts(root,{file:'src/auth.ts',symbol:'canIssueAdminToken'})).rejects.toThrow(/oversized/);
});
