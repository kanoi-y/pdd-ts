import { access, mkdir, readdir, realpath } from 'node:fs/promises';
import { z } from 'zod';
import { identifier, obligationSchema, obligationsSchema } from './schema.js';
import { readProjectYaml, writeProjectFile, yamlText } from './io.js';
import { resolveProjectPath } from '../verification/paths.js';
import type { ProofTarget } from '../verification/contracts.js';
import type { VerificationTools } from '../verification/toolchain.js';

const text = z.string().min(1).max(10000);
const symbol = z.string().min(1).max(200).regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/);
const file = z.string().min(1).max(1000).refine(value => !/[\x00-\x1f\x7f]/.test(value), 'Control characters are not allowed in paths');
export const targetSchema = z.strictObject({ file, symbol, witnesses: z.array(z.record(symbol, z.union([z.string().max(4096), z.boolean()]))).max(100).optional() }).transform((value): ProofTarget => {
  const target: ProofTarget = { file: value.file, symbol: value.symbol };
  if (value.witnesses !== undefined) target.witnesses = value.witnesses;
  return target;
});
const referenceSchema = z.strictObject({ file, symbol, clause: z.enum(['requires', 'ensures', 'decreases', 'invariant']), index: z.number().int().nonnegative() });
export const requirementSchema = z.strictObject({
  id: identifier, revision: z.number().int().positive(), title: text, intent: text, risk: z.enum(['low', 'medium', 'high']),
  target: z.strictObject({ file, symbol }),
  contracts: z.array(z.strictObject({ id: identifier, kind: z.enum(['precondition', 'postcondition', 'invariant']), human: text, sourceRef: referenceSchema, semantics: text })).max(1000),
  acceptance: z.array(z.strictObject({ id: identifier, kind: text, scenario: text })).max(1000),
  trustedBoundaries: z.array(identifier).max(1000),
});
export const projectConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  tools: z.strictObject({ dafnyPath: text.optional(), solverPath: text.optional(), timeoutMs: z.number().int().min(1).max(300000).optional() }).transform((value): VerificationTools => {
    const tools: VerificationTools = {};
    if (value.dafnyPath !== undefined) tools.dafnyPath = value.dafnyPath;
    if (value.solverPath !== undefined) tools.solverPath = value.solverPath;
    if (value.timeoutMs !== undefined) tools.timeoutMs = value.timeoutMs;
    return tools;
  }).default({}),
  approvedAssumptions: z.array(text).max(100).default(['profile:pdd-pure-v1']),
  targets: z.array(targetSchema).max(1000).default([]),
  testTargets: z.array(z.strictObject({obligationId: identifier, files:z.array(file).min(1).max(1000), inputs:z.array(file).min(1).max(10000), requiredTests:z.array(text).min(1).max(10000)})).max(1000).default([]),
  boundaries: z.array(z.strictObject({id:identifier,callerFiles:z.array(file).min(1),validatorFiles:z.array(file).min(1),calleeScope:text,testObligationIds:z.array(identifier).min(1),assumption:text.optional()})).max(1000).default([]),
  github: z.strictObject({ repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/), reviewerIds: z.array(z.number().int().positive()).min(1), minApprovals: z.number().int().min(1).max(10).default(1), workflow: file.default('.github/workflows/pdd.yml'), repositoryId:z.number().int().positive().optional(), checkAppId:z.number().int().positive().optional(), checkContext:text.default('PDD protected gate') }).optional(),
});
export type Requirement = z.infer<typeof requirementSchema>;
export type ProjectConfig = z.infer<typeof projectConfigSchema>;
export interface Project { root: string; config: ProjectConfig; requirements: Requirement[]; obligations: z.infer<typeof obligationSchema>[] }

export async function initProject(directory: string): Promise<void> {
  const root = await realpath(directory);
  await resolveProjectPath(root, 'lemmascript.json', { allowMissing: true });
  const config = await resolveProjectPath(root, '.pdd/config.yaml', { allowMissing: true });
  try { await access(config); throw new Error('PDD configuration already exists; init never overwrites it'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  // Check all destinations before creating any configuration file.
  const destinations = ['.pdd/config.yaml', '.pdd/obligations.yaml', '.pdd/.gitignore'];
  for (const relative of destinations) {
    const file = await resolveProjectPath(root, relative, { allowMissing: true });
    try { await access(file); throw new Error(`Initialization destination exists: ${relative}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  await mkdir(await resolveProjectPath(root, '.pdd/requirements', { allowMissing: true }), { recursive: true });
  await writeProjectFile(root, '.pdd/config.yaml', yamlText(projectConfigSchema.parse({ schemaVersion: 1 })));
  await writeProjectFile(root, '.pdd/obligations.yaml', '[]\n');
  await writeProjectFile(root, '.pdd/.gitignore', 'evidence/\nreports/\napproval.json\n');
  try { await access(await resolveProjectPath(root, 'lemmascript.json')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await writeProjectFile(root, 'lemmascript.json', JSON.stringify({ 'extern-default': 'impure', 'dafny-library': 'local', 'string-semantics': 'javascript-utf16', 'proof-dir': '.pdd/proofs', 'run-log': true }, null, 2) + '\n');
  }
}

export async function loadProject(directory: string): Promise<Project> {
  const root = await realpath(directory);
  const config = projectConfigSchema.parse(await readProjectYaml(root, '.pdd/config.yaml'));
  const obligations = obligationsSchema.parse(await readProjectYaml(root, '.pdd/obligations.yaml')).sort((a, b) => a.id < b.id ? -1 : 1);
  const folder = await resolveProjectPath(root, '.pdd/requirements');
  const names = (await readdir(folder)).filter(name => /\.ya?ml$/.test(name)).sort();
  if (names.length > 1000) throw new Error('Too many requirement files');
  const requirements: Requirement[] = [];
  for (const name of names) requirements.push(requirementSchema.parse(await readProjectYaml(root, `.pdd/requirements/${name}`)));
  requirements.sort((a, b) => a.id < b.id ? -1 : 1);
  const requirementIds = new Set(requirements.map(item => item.id));
  const allIds = requirements.flatMap(item => [item.id, ...item.contracts.map(contract => contract.id), ...item.acceptance.map(test => test.id)]);
  if (new Set(allIds).size !== allIds.length) throw new Error('Duplicate requirement, contract or acceptance ID');
  const scopes = config.targets.map(target => `${target.file}#${target.symbol}`);
  if (new Set(scopes).size !== scopes.length) throw new Error('Duplicate proof target');
  for (const target of config.targets) await resolveProjectPath(root, target.file);
  for (const obligation of obligations) {
    if (obligation.requirementIds.some(id => !requirementIds.has(id))) throw new Error(`Unknown requirement in obligation ${obligation.id}`);
    if (obligation.kind !== 'source-proof') continue;
    if (!scopes.includes(obligation.scope)) throw new Error(`No source target for ${obligation.id}`);
    for (const id of obligation.contractIds) {
      const owner = requirements.find(requirement => requirement.contracts.some(contract => contract.id === id));
      const contract = owner?.contracts.find(contract => contract.id === id);
      if (!owner || !contract || !obligation.requirementIds.includes(owner.id) || `${contract.sourceRef.file}#${contract.sourceRef.symbol}` !== obligation.scope) throw new Error(`Unbound source contract ${id}`);
    }
  }
  const testIds=config.testTargets.map(item=>item.obligationId);
  if(new Set(testIds).size!==testIds.length) throw new Error('Duplicate empirical target');
  for(const target of config.testTargets) {
    if(!obligations.some(item=>item.id===target.obligationId && item.kind==='test')) throw new Error('Empirical target has no test obligation');
    for(const file of [...target.files,...target.inputs]) await resolveProjectPath(root,file);
  }
  for(const boundary of config.boundaries) for(const file of [...boundary.callerFiles,...boundary.validatorFiles]) await resolveProjectPath(root,file);
  return { root, config, requirements, obligations };
}
