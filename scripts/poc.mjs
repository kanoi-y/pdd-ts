// Phase 0 experiment only. Production adapters get their own test-first implementation.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ts } from 'ts-morph';
import fc from 'fast-check';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.join(root, '.tools/poc');
const lsc = path.join(root, 'node_modules/lemmascript/tools/dist/lsc.js');
const env = { ...process.env, PATH: `${root}/.tools/dafny-4.11.0/dafny:${process.env.PATH}`, DOTNET_CLI_HOME: `${root}/.tools/dotnet` };
await mkdir(work, { recursive: true });
await writeFile(path.join(work, 'lemmascript.json'), await readFile(path.join(root, 'tests/fixtures/poc/lemmascript.json')));

function command(executable, args, label) {
  const started = performance.now();
  const r = spawnSync(executable, args, { cwd: work, env, encoding: 'utf8', timeout: 45000, maxBuffer: 2_000_000 });
  return { label, exit: r.status, signal: r.signal, error: r.error?.message, ms: Math.round(performance.now() - started), stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

// Evaluate the upstream typed expression nodes only for concrete witness probes.
// This does not establish translation soundness and is not a production contract DSL.
function evaluate(n, values) {
  if (n.kind === 'var') return n.name === String.fromCharCode(92) + 'result' ? values.result : values[n.name];
  if (n.kind === 'field') return evaluate(n.obj, values)[n.field];
  if (n.kind === 'bigint') return BigInt(n.value);
  if (n.kind === 'num' || n.kind === 'bool' || n.kind === 'str') return n.value;
  if (n.kind === 'binop') {
    const a = evaluate(n.left, values), b = evaluate(n.right, values);
    switch (n.op) {
      case '&&': return a && b;
      case '||': return a || b;
      case '>': return a > b;
      case '>=': return a >= b;
      case '<': return a < b;
      case '<=': return a <= b;
      case '===': case '==': return a === b;
      case '!==': case '!=': return a !== b;
      case '+': return a + b;
      case '-': return a - b;
    }
  }
  throw new Error(`Unsupported witness expression ${JSON.stringify(n)}`);
}

const auth = await readFile(path.join(root, 'tests/fixtures/poc/auth.ts'), 'utf8');
const allocation = await readFile(path.join(root, 'tests/fixtures/poc/allocate.ts'), 'utf8');
const split = await readFile(path.join(root, 'tests/fixtures/poc/split.ts'), 'utf8');
const vacuous = await readFile(path.join(root, 'tests/fixtures/poc/vacuous.ts'), 'utf8');
const slash = String.fromCharCode(92);
const spec = (clauses, body) => clauses.map(c => `//@ ${c}`).join('\n') + '\n' + body + '\n';
const cases = [
  { name: 'auth', source: auth, expectProof: true, expectAccepted: true, witnesses: [{ role: 'admin', passwordOk: true }] },
  { name: 'allocation', source: allocation, expectProof: true, expectAccepted: true, witnesses: [{ total: 10n, first: 3n }] },
  { name: 'split', source: split, expectProof: true, expectAccepted: true, witnesses: [{ total: 10n, requested: 3n }] },
  { name: 'always-true', source: auth.replace('return role === "admin" && passwordOk;', 'return true;'), expectProof: false, expectAccepted: false },
  { name: 'missing-admin', source: auth.replace('return role === "admin" && passwordOk;', 'return passwordOk;'), expectProof: false, expectAccepted: false },
  { name: 'inverted-password', source: auth.replace('return role === "admin" && passwordOk;', 'return role === "admin" && !passwordOk;'), expectProof: false, expectAccepted: false },
  { name: 'lost-unit', source: allocation.replace('return total - first;', 'return total - first - 1n;'), expectProof: false, expectAccepted: false },
  { name: 'vacuous', source: vacuous, expectProof: true, expectAccepted: false, witnesses: [{ x: -1n }, { x: 0n }, { x: 1n }] },
  { name: 'no-postcondition', source: 'export function empty(x: boolean): boolean { return x; }\n', expectProof: true, expectAccepted: false },
  { name: 'async', source: spec([`ensures ${slash}result === true`], 'export async function later(x: boolean): Promise<boolean> { return x; }'), expectAccepted: false, excluded: true },
  { name: 'number', source: spec(['requires a >= 0 && b > 0', `ensures ${slash}result > a`], 'export function add(a: number, b: number): number { return a + b; }'), expectAccepted: false, excluded: true },
  { name: 'bigint-negative-division', source: spec([`ensures ${slash}result === -1n`], 'export function divide(): bigint { return -3n / 2n; }'), expectAccepted: false, excluded: true },
  { name: 'bigint-positive-division', source: spec([`ensures ${slash}result === 1n`], 'export function divide(): bigint { return 3n / 2n; }'), expectAccepted: false, excluded: true },
  { name: 'null-undefined', source: spec([`ensures ${slash}result === (x === null)`], 'export function nullish(x: boolean | null | undefined): boolean { return x === null; }'), expectAccepted: false, excluded: true },
  { name: 'exception', source: spec([`ensures ${slash}result >= 0n`], 'export function positive(x: bigint): bigint { if (x < 0n) { throw new Error("invalid"); } return x; }'), expectAccepted: false, excluded: true },
  { name: 'external', source: 'declare function external(x: boolean): boolean;\n' + spec([`ensures ${slash}result === x`], 'export function delegated(x: boolean): boolean { return external(x); }'), expectAccepted: false, excluded: true },
  { name: 'alias', source: spec(['requires xs.length > 0', `ensures ${slash}result === false`], 'export function alias(xs: boolean[]): boolean { const ys = xs; ys[0] = false; return xs[0]; }'), expectAccepted: false, excluded: true },
  { name: 'loop', source: spec(['requires n >= 0n', `ensures ${slash}result === n`], 'export function count(n: bigint): bigint { let i = 0n;\n//@ invariant 0n <= i && i <= n\n//@ decreases n - i\nwhile (i < n) { i = i + 1n; } return i; }'), expectAccepted: false, excluded: true },
];

const results = [];
for (const c of cases) {
  const target = path.join(work, c.name + '.ts');
  await writeFile(target, c.source);
  // Fresh sidecars keep repeated experiments from accidentally verifying obsolete models.
  const { rm } = await import('node:fs/promises');
  await rm(target.replace(/\.ts$/, '.dfy'), { force: true });
  const info = command(process.execPath, [lsc, 'info', '--typed', target], c.name + ':info');
  const check = command(process.execPath, [lsc, 'check', '--backend=dafny', target], c.name + ':proof');
  let typed;
  try { typed = JSON.parse(info.stdout); } catch { typed = undefined; }
  const fn = typed?.functions?.[0];
  const complete = Boolean(fn && fn.ensures?.length > 0 && !typed.externs?.length && !fn.autohavoc);
  let witnessed = false;
  if (fn) {
    try { witnessed = fn.requires.length === 0 || (c.witnesses ?? []).some(w => fn.requires.every(n => evaluate(n, w) === true)); }
    catch { witnessed = false; }
  }
  const proofPassed = check.exit === 0 && /[1-9]\d* verified, 0 errors/.test(check.stdout);
  const accepted = Boolean(proofPassed && complete && witnessed && !c.excluded);
  const ok = (c.expectProof === undefined || (check.exit === 0) === c.expectProof) && accepted === c.expectAccepted;
  results.push({ name: c.name, sourceDigest: createHash('sha256').update(c.source).digest('hex'), solverSucceeded: check.exit === 0, complete, witnessed, explicitlyExcluded: Boolean(c.excluded), accepted, expectedAccepted: c.expectAccepted, ok, info, check });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${c.name}: solver=${check.exit}, accepted=${accepted}`);
}

// Show why additions-only does not establish proof integrity.
const bypass = path.join(work, 'always-true.dfy');
let dfy = await readFile(bypass, 'utf8');
const at = dfy.lastIndexOf('{');
dfy = dfy.slice(0, at + 1) + '\n  assume {:axiom} false;\n' + dfy.slice(at + 1);
await writeFile(bypass, dfy);
const bypassCheck = command(process.execPath, [lsc, 'check', '--backend=dafny', path.join(work, 'always-true.ts')], 'assumption-bypass:proof');
const bypassAudit = command('dafny', ['audit', bypass, '--report-format', 'json'], 'assumption-bypass:audit-json');
const auditText = command('dafny', ['audit', bypass], 'assumption-bypass:audit');
const caught = /assum|axiom|false/i.test(auditText.stdout + auditText.stderr);
const bypassOk = bypassCheck.exit === 0 && caught;
results.push({ name: 'assumption-bypass', solverSucceeded: bypassCheck.exit === 0, accepted: false, ok: bypassOk, check: bypassCheck, audit: auditText, auditJsonProbe: bypassAudit });
console.log(`${bypassOk ? 'PASS' : 'FAIL'} assumption-bypass: solver=${bypassCheck.exit}, auditExit=${auditText.exit}, unapprovedAssumption=${caught}`);

const versions = [command(process.execPath, ['--version'], 'node'), command('dafny', ['--version'], 'dafny')];
const conformance = [];
for (const name of ['auth', 'allocation', 'split']) {
  const experiment = results.find(r => r.name === name);
  const fn = JSON.parse(experiment.info.stdout).functions[0];
  const compiled = path.join(work, name + '.runtime.mjs');
  await writeFile(compiled, ts.transpileModule(await readFile(path.join(work, name + '.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
  const runtime = (await import(pathToFileURL(compiled).href))[fn.name];
  const args = name === 'auth' ? fc.tuple(fc.constantFrom('admin', 'user'), fc.boolean()) : fc.tuple(fc.bigInt({ min: 0n, max: 10n ** 100n }), fc.bigInt({ min: 0n, max: 10n ** 100n }));
  let executed = 0;
  try {
    fc.assert(fc.property(args, inputs => {
      const values = Object.fromEntries(fn.params.map((p, i) => [p.name, inputs[i]]));
      if (!fn.requires.every(n => evaluate(n, values) === true)) return;
      values.result = runtime(...inputs);
      executed++;
      if (!fn.ensures.every(n => evaluate(n, values) === true)) throw new Error('Runtime violates extracted formal postcondition');
    }), { seed: 20261107, numRuns: 500 });
    if (executed === 0) throw new Error('No precondition-valid runtime inputs');
    conformance.push({ name, seed: 20261107, samples: 500, validInputs: executed, passed: true, scope: 'Runtime outputs vs upstream typed contract; not general model equivalence' });
  } catch (error) {
    conformance.push({ name, passed: false, error: String(error) });
  }
  console.log(`${conformance.at(-1).passed ? 'PASS' : 'FAIL'} runtime-contract ${name}: ${executed} valid inputs`);
}
const report = { experiment: 'P0: observed tool behavior, not translation-soundness proof', date: new Date().toISOString(), versions, lemmascript: JSON.parse(await readFile(path.join(root, 'node_modules/lemmascript/package.json'), 'utf8')).version, runtimeCounterexamples: { numberAddition: { a: '9007199254740992', b: '1', result: String(9007199254740992 + 1), strictlyIncreased: 9007199254740992 + 1 > 9007199254740992 }, nullAndUndefinedAreDistinct: null !== undefined }, conformance, results };
await mkdir(path.join(root, 'docs/evidence'), { recursive: true });
await writeFile(path.join(root, 'docs/evidence/p0-results.json'), JSON.stringify(report, null, 2).replaceAll(root, '<repo>') + '\n');
if (results.some(r => !r.ok) || conformance.some(r => !r.passed)) process.exitCode = 1;
