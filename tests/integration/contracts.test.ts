import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectTarget } from '../../src/verification/contracts.js';

const roots: string[] = [];
const backslash = String.fromCharCode(92);
const auth = `//@ ensures ${backslash}result === (role === "admin" && passwordOk)\nexport function auth(role: "admin" | "user", passwordOk: boolean): boolean { return role === "admin" && passwordOk; }\n`;
async function project(source: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pdd-contract-'));
  roots.push(root);
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src/domain.ts'), source);
  await writeFile(path.join(root, 'lemmascript.json'), JSON.stringify({ 'extern-default': 'impure', 'string-semantics': 'javascript-utf16', 'dafny-library': 'local', 'proof-dir': '.pdd/proofs', 'run-log': true }));
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

describe('SPEC-001: actual source contracts and supported semantics', () => {
  it('extracts contracts and a concrete input witness from a real synchronous source', async () => {
    const result = await inspectTarget(await project(auth), { file: 'src/domain.ts', symbol: 'auth' });
    expect(result.reasons).toEqual([]);
    expect(result.status).toBe('supported');
    expect(result.contracts?.ensures).toHaveLength(1);
    expect(result.witness).toEqual({ role: 'admin', passwordOk: false });
    expect(result.sourceFiles).toContain('src/domain.ts');
  });

  it('does not treat an impossible requires as an acceptable premise', async () => {
    const code = `//@ requires x > 0n && x < 0n\n//@ ensures ${backslash}result === 42n\nexport function impossible(x: bigint): bigint { return 0n; }`;
    const result = await inspectTarget(await project(code), { file: 'src/domain.ts', symbol: 'impossible', witnesses: [{ x: '0' }] });
    expect(result.status).not.toBe('supported');
    expect(result.reasons.join(' ')).toMatch(/premise|precondition|witness/i);
  });

  it('requires explicit valid witness inputs when preconditions are present', async () => {
    const code = `//@ requires x > 0n\n//@ ensures ${backslash}result === x\nexport function positive(x: bigint): bigint { return x; }`;
    const root = await project(code);
    expect((await inspectTarget(root, { file: 'src/domain.ts', symbol: 'positive' })).status).toBe('unknown');
    expect((await inspectTarget(root, { file: 'src/domain.ts', symbol: 'positive', witnesses: [{ x: '10' }] })).status).toBe('supported');
  });

  it.each([
    ['number', 'export function auth(x: number): number { return x; }'],
    ['async', 'export async function auth(x: boolean): Promise<boolean> { return x; }'],
    ['division', 'export function auth(x: bigint): bigint { return x / 2n; }'],
    ['assertion', 'export function auth(x: unknown): boolean { return x as boolean; }'],
    ['throw', 'export function auth(x: boolean): boolean { if (!x) throw new Error("bad"); return x; }'],
    ['call', 'export function auth(x: boolean): boolean { return Boolean(x); }'],
    ['aliasing', 'export function auth(x: {value: boolean}): boolean { x.value = true; return x.value; }'],
    ['undeclared import', 'import { readFileSync } from "node:fs"; export function auth(x: boolean): boolean { return x; }'],
  ])('rejects %s before claiming source proof', async (_, body) => {
    const root = await project(`//@ ensures ${backslash}result === x\n${body}`);
    expect((await inspectTarget(root, { file: 'src/domain.ts', symbol: 'auth' })).status).toBe('unsupported');
  });

  it('rejects actual TypeScript type errors before verification', async () => {
    const root = await project(`//@ ensures ${backslash}result === true\nexport function auth(x: boolean): boolean { return 1n; }`);
    expect((await inspectTarget(root, { file: 'src/domain.ts', symbol: 'auth' })).status).toBe('unsupported');
  });

  it('excludes string arithmetic even when the contract and return type are valid', async () => {
    const root = await project(`//@ ensures ${backslash}result === true\nexport function auth(x: "admin" | "user"): boolean { return (x + "suffix") !== ""; }`);
    expect((await inspectTarget(root, { file: 'src/domain.ts', symbol: 'auth' })).status).toBe('unsupported');
  });

  it('rejects unsupported annotations even if their accompanying contract looks valid', async () => {
    const root = await project('//@ option autohavoc true\n' + auth);
    expect((await inspectTarget(root, { file: 'src/domain.ts', symbol: 'auth' })).status).toBe('unsupported');
  });

  it('rejects a missing symbol or a function without postconditions', async () => {
    const root = await project(auth);
    expect((await inspectTarget(root, { file: 'src/domain.ts', symbol: 'missing' })).status).not.toBe('supported');
    const bare = await project('export function auth(x: boolean): boolean { return x; }');
    expect((await inspectTarget(bare, { file: 'src/domain.ts', symbol: 'auth' })).status).not.toBe('supported');
  });

  it('captures every source contract clause, not just a referenced postcondition', async () => {
    const root = await project(`//@ requires passwordOk === true\n${auth}`);
    const result = await inspectTarget(root, { file: 'src/domain.ts', symbol: 'auth', witnesses: [{ role: 'admin', passwordOk: true }] });
    expect(result.status).toBe('supported');
    expect(result.contracts?.requires).toEqual(['passwordOk === true']);
    expect(result.contracts?.ensures).toHaveLength(1);
  });
});
