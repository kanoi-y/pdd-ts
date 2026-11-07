import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkEvidenceFreshness, verifySource } from '../../src/verification/lemmascript.js';

const repo = process.cwd();
const dafnyPath = path.join(repo, '.tools/dafny-4.11.0/dafny/dafny');
const solverPath = path.join(repo, '.tools/dafny-4.11.0/dafny/z3/bin/z3-4.14.1');
const roots: string[] = [];
const target = { file: 'src/auth.ts', symbol: 'canIssueAdminToken', obligationId: 'auth-proof', requirementIds: ['AUTH-001'], contractIds: ['AUTH-001-C1'] };
const identity = { id: 'adapter-run', commit: 'b'.repeat(40), specDigest: 'c'.repeat(64) };
async function project(mutate?: (source: string) => string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pdd-adapter-'));
  roots.push(root);
  await mkdir(path.join(root, 'src'));
  const source = await readFile(path.join(repo, 'tests/fixtures/poc/auth.ts'), 'utf8');
  await writeFile(path.join(root, 'src/auth.ts'), mutate ? mutate(source) : source);
  await writeFile(path.join(root, 'lemmascript.json'), JSON.stringify({ 'extern-default': 'impure', 'string-semantics': 'javascript-utf16', 'dafny-library': 'local', 'proof-dir': '.pdd/proofs', 'run-log': true }));
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('CORE-003: real source-linked proof evidence', () => {
  it('proves the actual source and binds the verified member, artifacts and inputs', async () => {
    const root = await project();
    const result = await verifySource(root, target, identity, { dafnyPath, solverPath });
    expect(result.record.status, result.diagnostics.join('\n')).toBe('passed');
    expect(result.record).toMatchObject({ kind: 'source-proof', run: { id: identity.id, origin: 'local' }, verifiedSymbols: [target.symbol], verifiedContractIds: target.contractIds });
    expect(result.inputPaths).toContain('src/auth.ts');
    expect(result.inputPaths).toContain('.pdd/proofs/src/auth.dfy');
    expect(await checkEvidenceFreshness(root, result.record, result.inputPaths)).toBe('fresh');
    const originalProof = await readFile(path.join(root, '.pdd/proofs/src/auth.dfy'), 'utf8');
    await writeFile(path.join(root, '.pdd/proofs/src/auth.dfy'), '// changed hand proof');
    expect(await checkEvidenceFreshness(root, result.record, result.inputPaths)).toBe('stale');
    await writeFile(path.join(root, '.pdd/proofs/src/auth.dfy'), originalProof);
    expect(await checkEvidenceFreshness(root, result.record, result.inputPaths)).toBe('fresh');
    await writeFile(path.join(root, 'src/auth.ts'), 'export function changed(): boolean { return true; }');
    expect(await checkEvidenceFreshness(root, result.record, result.inputPaths)).toBe('stale');
  });

  it('rejects a real counterexample rather than trusting process completion', async () => {
    const root = await project(source => source.replace('return role === "admin" && passwordOk;', 'return true;'));
    const result = await verifySource(root, target, identity, { dafnyPath, solverPath });
    expect(result.record.status).toBe('failed');
    expect(result.record.verifiedContractIds).toEqual([]);
  });

  it('rejects an axiom added to an otherwise additions-only proof', async () => {
    const root = await project();
    const first = await verifySource(root, target, identity, { dafnyPath, solverPath });
    expect(first.record.status).toBe('passed');
    const file = path.join(root, '.pdd/proofs/src/auth.dfy');
    const source = await readFile(file, 'utf8');
    const at = source.lastIndexOf('{');
    await writeFile(file, source.slice(0, at + 1) + '\n assume {:axiom} false;\n' + source.slice(at + 1));
    const second = await verifySource(root, target, { ...identity, id: 'changed-proof' }, { dafnyPath, solverPath });
    expect(second.record.status).not.toBe('passed');
    expect(second.diagnostics.join(' ')).toMatch(/audit|assum|axiom/i);
  });

  it('records unsupported and missing-tool outcomes distinctly', async () => {
    const root = await project(source => source.replace('boolean): boolean', 'number): boolean'));
    expect((await verifySource(root, target, identity, { dafnyPath, solverPath })).record.status).toBe('unsupported');
    const valid = await project();
    expect((await verifySource(valid, target, identity, { dafnyPath: '/missing/pdd-dafny', solverPath })).record.status).toBe('error');
  });

  it('does not overwrite a previous run directory as if it were new evidence', async () => {
    const root = await project();
    await verifySource(root, target, identity, { dafnyPath, solverPath });
    await expect(verifySource(root, target, identity, { dafnyPath, solverPath })).rejects.toThrow(/exist|run/i);
  });

  it('reports an inspection timeout as unknown rather than a completed proof', async () => {
    const root = await project();
    const result = await verifySource(root, target, identity, { dafnyPath, solverPath, timeoutMs: 1 });
    expect(result.record.status).toBe('unknown');
    expect(result.record.verifiedContractIds).toEqual([]);
  });
});

it.each(['comment-replacement','proof-only-premise','forged-sidecar'] as const)('CORE-003 rejects additions-only source substitution: %s',async attack=>{
 const root=await project(source=>source.replace('return role === "admin" && passwordOk;','return true;'));
 const before=await verifySource(root,target,identity,{dafnyPath,solverPath}); expect(before.record.status).toBe('failed');
 const file=path.join(root,'.pdd/proofs/src/auth.dfy'); const generated=await readFile(file,'utf8');
 let forged:string;
 if(attack==='comment-replacement') forged='/*\n'+generated+'\n*/\n'+generated.slice(generated.indexOf('function ')).replace('true', '((role == "admin") && passwordOk)');
 else forged=generated.replace(/(lemma canIssueAdminToken_ensures[^\n]*\n)/,'$1  requires false\n');
 expect(forged).not.toBe(generated); await writeFile(file,forged);
 if(attack==='forged-sidecar') await writeFile(file+'.gen',forged);
 const after=await verifySource(root,target,{...identity,id:'forged-proof'},{dafnyPath,solverPath});
 expect(after.record.status).not.toBe('passed'); expect(after.record.verifiedContractIds).toEqual([]);
});
