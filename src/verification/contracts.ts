import { createRequire } from 'node:module';
import { readProjectText } from '../requirements/io.js';
import path from 'node:path';
import { z } from 'zod';
import { expressionSchema, evaluateExpression } from './expressions.js';
import type { Expr, FormalValue } from './expressions.js';
import { inspectProfile } from './profile.js';
import { resolveProjectPath } from './paths.js';
import { digestFiles } from './digest.js';
import { runProcess } from './process.js';

const require = createRequire(import.meta.url);
export const defaultLscPath = path.join(path.dirname(require.resolve('lemmascript/package.json')), 'tools/dist/lsc.js');
export interface ProofTarget {
  file: string;
  symbol: string;
  witnesses?: Record<string, string | boolean>[];
}
export interface SourceContracts {
  signature: string;
  contract: string[];
  requires: string[];
  ensures: string[];
  decreases: string | null;
}
export interface TargetInspection {
  status: 'supported' | 'unsupported' | 'unknown' | 'error';
  reasons: string[];
  sourceFiles: string[];
  sourceDigest?: string;
  contracts?: SourceContracts;
  witness?: Record<string, string | boolean>;
  emittedLemma?: string;
}

const texts = z.array(z.string());
const rawFunctionSchema = z.looseObject({
  name: z.string(), params: z.array(z.looseObject({ name: z.string(), tsType: z.string() })),
  returnType: z.string(), contract: texts, requires: texts, ensures: texts, decreases: z.string().nullable(),
});
const typedFunctionSchema = z.looseObject({
  name: z.string(), requires: z.array(expressionSchema), ensures: z.array(expressionSchema),
  autohavoc: z.boolean(),
});
const rawSchema = z.looseObject({ functions: z.array(rawFunctionSchema), externs: z.array(z.unknown()) });
const typedSchema = z.looseObject({
  schema: z.literal(1), lemmascript: z.literal('0.6.6'), functions: z.array(typedFunctionSchema),
  externs: z.array(z.unknown()), classes: z.array(z.unknown()),
  dafny: z.looseObject({ emittedNames: z.record(z.string(), z.string()) }),
});

/** Extract all declared clauses independently of body support or proof success. */
export async function extractDeclaredContracts(root: string, target: Pick<ProofTarget, 'file' | 'symbol'>): Promise<SourceContracts> {
  const file = await resolveProjectPath(root, target.file);
  await readProjectText(root,target.file);
  const config = await resolveProjectPath(root, 'lemmascript.json');
  await readProjectText(root,'lemmascript.json');
  const result = await runProcess(process.execPath, [defaultLscPath, 'extract', `--config=${config}`, file], { cwd: root });
  if (result.status !== 'completed' || result.exitCode !== 0) throw new Error(`Cannot extract source contracts: ${target.file}#${target.symbol}`);
  const module = rawSchema.parse(JSON.parse(result.stdout));
  const matches = module.functions.filter(fn => fn.name === target.symbol);
  const fn = matches[0];
  if (matches.length !== 1 || !fn) throw new Error(`Missing or ambiguous source function: ${target.symbol}`);
  return { signature: `(${fn.params.map(p => `${p.name}: ${p.tsType}`).join(', ')}): ${fn.returnType}`, contract: fn.contract, requires: fn.requires, ensures: fn.ensures, decreases: fn.decreases };
}

/** Reads source and upstream IR only; it never evaluates the target's executable body. */
export async function inspectTarget(root: string, target: ProofTarget, options: { lscPath?: string; timeoutMs?: number } = {}): Promise<TargetInspection> {
  const sourceFiles = [target.file, 'lemmascript.json'];
  const failure = (status: TargetInspection['status'], reasons: string[]): TargetInspection => ({ status, reasons, sourceFiles });
  try {
    const file = await resolveProjectPath(root, target.file);
    const source = await readProjectText(root,target.file);
    if (Buffer.byteLength(source) > 1_048_576) return failure('unsupported', ['Source file exceeds inspection size limit']);
    const profile = inspectProfile(source, file, target.symbol);
    if (profile.reasons.length) return failure('unsupported', profile.reasons);
    const config = await resolveProjectPath(root, 'lemmascript.json');
    const data: unknown = JSON.parse(await readProjectText(root,'lemmascript.json'));
    const expectedConfig = z.strictObject({
      'extern-default': z.literal('impure'), 'string-semantics': z.literal('javascript-utf16'),
      'dafny-library': z.literal('local'), 'proof-dir': z.literal('.pdd/proofs'), 'run-log': z.literal(true),
    });
    if (!expectedConfig.safeParse(data).success) return failure('unsupported', ['LemmaScript configuration must match the pinned semantic profile']);
    const snapshot = await digestFiles(root, sourceFiles);
    const execute = async (args: string[]) => await runProcess(process.execPath, [options.lscPath ?? defaultLscPath, ...args, `--config=${config}`, file], { cwd: root, timeoutMs: options.timeoutMs ?? 30000 });
    const outcomes = await Promise.allSettled([execute(['extract']), execute(['info', '--typed'])]);
    if (outcomes.some(result => result.status === 'rejected')) return failure('error', ['Could not execute source inspection']);
    const values = outcomes.map(result => result.status === 'fulfilled' ? result.value : null);
    const rawRun = values[0]!, typedRun = values[1]!;
    if (rawRun.status !== 'completed' || typedRun.status !== 'completed') return failure('unknown', ['Source inspection exceeded a process bound or could not start']);
    if (rawRun.exitCode !== 0 || typedRun.exitCode !== 0) return failure('unsupported', ['Upstream source extraction or type resolution failed']);
    const raw = rawSchema.parse(JSON.parse(rawRun.stdout)), typed = typedSchema.parse(JSON.parse(typedRun.stdout));
    const rawMatches = raw.functions.filter(fn => fn.name === target.symbol);
    const typedMatches = typed.functions.filter(fn => fn.name === target.symbol);
    const fn = rawMatches[0], formal = typedMatches[0];
    if (rawMatches.length !== 1 || typedMatches.length !== 1 || !fn || !formal || fn.ensures.length === 0) return failure('unsupported', ['Named source function and nonempty postconditions are required']);
    if (raw.externs.length || typed.externs.length || typed.classes.length || typed.functions.some(fn => fn.autohavoc)) return failure('unsupported', ['External assumptions, classes or autohavoc are not admitted']);
    const defaults = Object.fromEntries(Object.entries(profile.domains).map(([name, domain]) => [name, domain.kind === 'boolean' ? false : domain.kind === 'bigint' ? '0' : domain.values[0]!]));
    const witnesses = target.witnesses?.length ? target.witnesses : formal.requires.length ? [] : [defaults];
    if (witnesses.length === 0) return failure('unknown', ['Explicit premise witness inputs are required for preconditions']);
    for (const witness of witnesses) {
      if (Object.keys(witness).length !== fn.params.length) return failure('unsupported', ['Witness parameters do not match the source signature']);
      const decoded: Record<string, FormalValue> = {};
      for (const [name, domain] of Object.entries(profile.domains)) {
        const value = witness[name];
        if (domain.kind === 'boolean' && typeof value === 'boolean') decoded[name] = value;
        else if (domain.kind === 'bigint' && typeof value === 'string' && /^-?\d{1,4096}$/.test(value)) decoded[name] = BigInt(value);
        else if (domain.kind === 'literal' && typeof value === 'string' && domain.values.includes(value)) decoded[name] = value;
        else return failure('unsupported', ['Witness does not belong to the source parameter domain']);
      }
      if (!formal.requires.every((expr: Expr) => evaluateExpression(expr, decoded) === true)) return failure('unknown', ['Premise witness fails a precondition; no non-vacuity evidence']);
    }
    const after = await digestFiles(root, sourceFiles);
    if (after.digest !== snapshot.digest) return failure('unknown', ['Source changed during inspection']);
    const emittedLemma = typed.dafny.emittedNames[`${target.symbol}_ensures`];
    if (!emittedLemma) return failure('unsupported', ['No emitted proof member maps to the source postcondition']);
    return {
      status: 'supported', reasons: [], sourceFiles, sourceDigest: snapshot.digest,
      contracts: { signature: `(${fn.params.map(p => `${p.name}: ${p.tsType}`).join(', ')}): ${fn.returnType}`, contract: fn.contract, requires: fn.requires, ensures: fn.ensures, decreases: fn.decreases },
      witness: witnesses[0]!, emittedLemma,
    };
  } catch (error) {
    return failure('error', [error instanceof Error ? error.message : 'Invalid source inspection input']);
  }
}
