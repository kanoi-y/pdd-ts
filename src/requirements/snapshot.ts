import {readDecisionRegistry} from './decisions.js';
import type {DecisionRegistry} from './decisions.js';
import { canonicalJson, readProjectText } from './io.js';
import type { Project } from './project.js';
import { sha256 } from '../verification/digest.js';
import { extractDeclaredContracts } from '../verification/contracts.js';
import type { SourceContracts } from '../verification/contracts.js';

export interface SpecSnapshot {
  schemaVersion: 1;
  digest: string;
  complete: boolean;
  errors: string[];
  metadata: { config: Project['config']; requirements: Project['requirements']; obligations: Project['obligations']; modelConfig: unknown };
  workflow?: {registry:DecisionRegistry|null;blocked:boolean};
  contracts: { scope: string; declaration: SourceContracts }[];
}

export async function createSpecSnapshot(project: Project): Promise<SpecSnapshot> {
  const errors: string[] = [];
  const contracts: SpecSnapshot['contracts'] = [];
  const targets = new Map(project.config.targets.map(target => [`${target.file}#${target.symbol}`, target]));
  for (const requirement of project.requirements) {
    for (const contract of requirement.contracts) {
      const ref = contract.sourceRef;
      targets.set(`${ref.file}#${ref.symbol}`, { file: ref.file, symbol: ref.symbol });
    }
  }
  for (const [scope, target] of [...targets].sort(([a], [b]) => a < b ? -1 : 1)) {
    try { contracts.push({ scope, declaration: await extractDeclaredContracts(project.root, target) }); }
    catch { errors.push(`Source contract extraction unavailable: ${scope}`); }
  }
  for (const requirement of project.requirements) {
    for (const contract of requirement.contracts) {
      const ref = contract.sourceRef;
      const source = contracts.find(entry => entry.scope === `${ref.file}#${ref.symbol}`)?.declaration;
      const clauses = ref.clause === 'requires' ? source?.requires : ref.clause === 'ensures' ? source?.ensures : ref.clause === 'decreases' && source?.decreases ? [source.decreases] : [];
      const compatible = contract.kind === 'postcondition' ? ref.clause === 'ensures' : contract.kind === 'precondition' ? ref.clause === 'requires' : ref.clause === 'invariant';
      if (!compatible || !clauses || ref.index >= clauses.length) errors.push(`Unresolved or mismatched contract reference: ${contract.id}`);
    }
  }
  let modelConfig: unknown = null;
  try { modelConfig = JSON.parse(await readProjectText(project.root, 'lemmascript.json')); }
  catch { errors.push('LemmaScript model configuration is unavailable'); }
  let workflow:SpecSnapshot['workflow'];
  try{const registry=await readDecisionRegistry(project);if(registry){const blocked=registry.items.some(i=>i.mustResolve);workflow={registry,blocked};if(blocked)errors.push('Unresolved high-risk or blocking human specification decision');}}catch{workflow={registry:null,blocked:true};errors.push('Decision registry is invalid or unavailable');}
  const metadata = { config: project.config, requirements: project.requirements, obligations: project.obligations, modelConfig };
  const body = { schemaVersion: 1 as const, complete: errors.length === 0, errors, metadata, contracts, ...(workflow?{workflow}:{}) };
  return { ...body, digest: sha256(canonicalJson(body)) };
}
