import { canonicalJson } from './io.js';
import type { SpecSnapshot } from './snapshot.js';

export interface SpecDiff {
  changed: boolean; valid: boolean; policyChanged: boolean;
  affectedRequirements: string[]; addedRequirements: string[]; deletedRequirements: string[];
  deletedObligations: string[]; errors: string[];
}
/** Syntactic changes require review; no implication/strengthening claim is inferred. */
export function compareSpecs(before: SpecSnapshot, after: SpecSnapshot): SpecDiff {
  const errors: string[] = [];
  if (!before.complete || !after.complete) errors.push('Both specification snapshots must be complete');
  const policyChanged = canonicalJson(before.metadata.config) !== canonicalJson(after.metadata.config) || canonicalJson(before.metadata.modelConfig) !== canonicalJson(after.metadata.modelConfig);
  const previous = new Map(before.metadata.requirements.map(item => [item.id, item]));
  const next = new Map(after.metadata.requirements.map(item => [item.id, item]));
  const declarations = (snapshot: SpecSnapshot, id: string): string => {
    const req = snapshot.metadata.requirements.find(item => item.id === id)!;
    const scopes = new Set([`${req.target.file}#${req.target.symbol}`, ...req.contracts.map(item => `${item.sourceRef.file}#${item.sourceRef.symbol}`)]);
    return canonicalJson({ models:snapshot.models?.filter(m=>snapshot.metadata.obligations.some(o=>o.id===m.obligationId&&o.requirementIds.includes(id)))??[], requirement: {...req, revision: 0}, decisions:snapshot.workflow?.registry?.items.filter(item=>item.requirementIds.includes(id))??[], contracts: snapshot.contracts.filter(item => scopes.has(item.scope)), obligations: snapshot.metadata.obligations.filter(item => item.requirementIds.includes(id)) });
  };
  const affectedRequirements: string[] = [];
  for (const [id, req] of next) {
    const old = previous.get(id);
    if (!old) continue;
    if (req.revision < old.revision) errors.push(`Revision decreased: ${id}`);
    if (policyChanged || declarations(before, id) !== declarations(after, id)) {
      affectedRequirements.push(id);
      if (req.revision <= old.revision) errors.push(`Changed requirement needs a higher revision: ${id}`);
    }
  }
  return { changed: before.digest !== after.digest, valid: errors.length === 0, policyChanged, affectedRequirements,
    addedRequirements: [...next.keys()].filter(id => !previous.has(id)), deletedRequirements: [...previous.keys()].filter(id => !next.has(id)),
    deletedObligations: before.metadata.obligations.filter(item => !after.metadata.obligations.some(other => other.id === item.id)).map(item => item.id), errors };
}
