import {readDecisionRegistry} from '../requirements/decisions.js';
import type { ScanChanges } from '../analysis/changes.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { evidenceSchema, identifier, digestSchema } from '../requirements/schema.js';
import { loadProject } from '../requirements/project.js';
import type { Project } from '../requirements/project.js';
import { createSpecSnapshot } from '../requirements/snapshot.js';
import type { SpecSnapshot } from '../requirements/snapshot.js';
import { readProjectText, writeProjectFile, canonicalJson } from '../requirements/io.js';
import { verifySource, checkEvidenceFreshness } from '../verification/lemmascript.js';
import { digestFiles, sha256 } from '../verification/digest.js';
import { resolveProjectPath } from '../verification/paths.js';
import { describeToolchain } from '../verification/toolchain.js';
import { runProcess } from '../verification/process.js';
import { verifyTests, empiricalToolDigest } from '../verification/tests.js';
import { empiricalInputs, validateBoundaries } from '../verification/boundaries.js';
import { evaluateGate } from '../verification/gate.js';
import type { EvidenceRecord, GateResult } from '../verification/types.js';

export const savedRunSchema = z.strictObject({
  schemaVersion: z.literal(1), id: identifier, createdAt: z.iso.datetime(),
  commit: z.string().regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/), dirty: z.boolean(),
  specDigest: digestSchema,
  evidence: z.array(evidenceSchema).max(10000).refine(items => items.every(item => item.run.origin === 'local'), 'Local saved runs cannot assert authenticated CI origin'),
  diagnostics: z.array(z.strictObject({ obligationId: identifier, messages: z.array(z.string()) })),
});
export type SavedRun = z.infer<typeof savedRunSchema>;
export class NoRunError extends Error {}
export interface ReviewPacket {
  workflow?:SpecSnapshot['workflow'];
  atlasUpdate?:ScanChanges;
  schemaVersion: 1; runId: string; createdAt: string; commit: string; dirty: boolean;
  origin: 'local'|'ci'; approval: 'pending'|'approved'; specDigest: string; recordedSpecDigest: string;
  snapshotComplete: boolean; gate: GateResult; evidence: EvidenceRecord[];
  requirements: Project['requirements']; obligations: Project['obligations']; sourceContracts: SpecSnapshot['contracts']; unverifiedRequirements: string[];
  diagnostics: SavedRun['diagnostics'];
  boundaries: Project['config']['boundaries']; allowedAssumptions: string[];
}

export async function gitIdentity(root: string): Promise<{ commit: string; dirty: boolean }> {
  const commit = await runProcess('git', ['rev-parse', 'HEAD'], { cwd: root });
  const state = await runProcess('git', ['status', '--porcelain'], { cwd: root });
  if (commit.exitCode !== 0 || state.exitCode !== 0 || !/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(commit.stdout.trim())) throw new Error('Verification requires an existing Git commit; commit the initial source first');
  return { commit: commit.stdout.trim(), dirty: state.stdout.length > 0 };
}

async function currentProofInputs(project: Project, scope: string): Promise<string[]> {
  const target = project.config.targets.find(item => `${item.file}#${item.symbol}` === scope);
  if (!target || !target.file.endsWith('.ts')) throw new Error('Current registered source target is unavailable');
  const stem = target.file.slice(0, -3);
  const files = [target.file, 'lemmascript.json', `.pdd/proofs/${stem}.dfy`, `.pdd/proofs/${stem}.dfy.gen`];
  for (const name of ['tsconfig.json', 'package.json', 'pnpm-lock.yaml', 'package-lock.json']) {
    try { await resolveProjectPath(project.root, name); files.push(name); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  return files;
}

async function currentToolchain(project:Project):Promise<string> {
  const proof = project.obligations.some(item=>item.kind==='source-proof') ? (await describeToolchain(project.root,project.config.tools)).digest : 'none';
  const empirical = project.obligations.some(item=>item.kind==='test') ? await empiricalToolDigest() : 'none';
  return sha256(JSON.stringify({proof,empirical}));
}

async function reviewCurrent(project: Project, snapshot: SpecSnapshot, saved: SavedRun): Promise<ReviewPacket> {
  const identity = await gitIdentity(project.root);
  const expectedSourceDigests: Record<string, string> = {};
  const evidence: EvidenceRecord[] = structuredClone(saved.evidence);
  let toolchainDigest = sha256('unavailable');
  if(!snapshot.workflow?.blocked)try { toolchainDigest = await currentToolchain(project); }
  catch { /* An unavailable current toolchain cannot match a previously successful record. */ }
  for (const obligation of project.obligations.filter(item => ['source-proof','test'].includes(item.kind))) {
    try {
      const files = obligation.kind==='test' ? empiricalInputs(project,obligation.id) : await currentProofInputs(project, obligation.scope);
      expectedSourceDigests[obligation.id] = (await digestFiles(project.root, files)).digest;
      const record = evidence.find(item => item.obligationId === obligation.id);
      if (record && (await checkEvidenceFreshness(project.root, record, files) === 'stale' || record.specDigest !== snapshot.digest || record.toolchainDigest !== toolchainDigest || record.commit !== identity.commit)) {
        if (record.status === 'passed') record.status = 'stale';
      }
    } catch {
      const record = evidence.find(item => item.obligationId === obligation.id);
      if (record?.status === 'passed') record.status = 'stale';
    }
  }
  const gate = evaluateGate(project.obligations, evidence, {
    runId: saved.id, commit: identity.commit, sourceDigest: sha256('per-obligation'), expectedSourceDigests,
    specDigest: snapshot.digest, toolchainDigest, mode: 'trial', approval: 'pending', approvedAssumptions: project.config.approvedAssumptions,
  });
  const boundaryErrors=validateBoundaries(project);
  if (!snapshot.complete || boundaryErrors.length) {
    gate.status = 'blocked';
    gate.findings.push(...[...snapshot.errors,...boundaryErrors].map(message => ({ code: 'spec-incomplete', message })));
  }
  const covered = new Set(project.obligations.flatMap(item => item.requirementIds));
  for(const requirement of project.requirements) if(!covered.has(requirement.id)) {gate.status='blocked';gate.findings.push({code:'uncovered-requirement',message:`No required obligation: ${requirement.id}`});}
  return { schemaVersion: 1, runId: saved.id, createdAt: saved.createdAt, commit: identity.commit, dirty: identity.dirty,
    origin: 'local', approval: 'pending', specDigest: snapshot.digest, recordedSpecDigest: saved.specDigest,
    snapshotComplete: snapshot.complete, gate, evidence, requirements: project.requirements, obligations: project.obligations, sourceContracts: snapshot.contracts, ...(snapshot.workflow?{workflow:snapshot.workflow}:{}),
    unverifiedRequirements: project.requirements.filter(item => !covered.has(item.id)).map(item => item.id), boundaries: project.config.boundaries, allowedAssumptions: project.config.approvedAssumptions, diagnostics: saved.diagnostics };
}

export async function verifyProject(directory: string): Promise<ReviewPacket> {
  const project = await loadProject(directory);
  const snapshot = await createSpecSnapshot(project);
  const identity = await gitIdentity(project.root);
  const id = randomUUID();
  const saved: SavedRun = { schemaVersion: 1, id, createdAt: new Date().toISOString(), ...identity, specDigest: snapshot.digest, evidence: [], diagnostics: [] };
  let toolchainDigest=sha256('unavailable');
  if(!snapshot.workflow?.blocked)try {toolchainDigest=await currentToolchain(project);} catch { /* Source adapter records the specific unavailable tool. */ }
  for (const obligation of snapshot.workflow?.blocked?[]:project.obligations) {
    try{const current=await readDecisionRegistry(await loadProject(project.root));if(canonicalJson(current??null)!==canonicalJson(snapshot.workflow?.registry??null)){saved.diagnostics.push({obligationId:obligation.id,messages:['Decision inputs changed; remaining workers were not started']});break;}}catch{saved.diagnostics.push({obligationId:obligation.id,messages:['Decision inputs unavailable; remaining workers were not started']});break;}
    if(obligation.kind==='test' && project.config.testTargets.some(item=>item.obligationId===obligation.id)) {
      const result=await verifyTests(project,obligation.id,{id,commit:identity.commit,specDigest:snapshot.digest},toolchainDigest);
      result.record.toolchainDigest=toolchainDigest;
    saved.evidence.push(result.record); saved.diagnostics.push({obligationId:obligation.id,messages:result.diagnostics}); continue;
    }
    if (obligation.kind !== 'source-proof') continue;
    const target = project.config.targets.find(item => `${item.file}#${item.symbol}` === obligation.scope)!;
    const result = await verifySource(project.root, { ...target, obligationId: obligation.id, requirementIds: obligation.requirementIds, contractIds: obligation.contractIds }, { id, commit: identity.commit, specDigest: snapshot.digest }, project.config.tools);
    result.record.toolchainDigest=toolchainDigest;
    saved.evidence.push(result.record);
    saved.diagnostics.push({ obligationId: obligation.id, messages: result.diagnostics });
  }
  savedRunSchema.parse(saved);
  await writeProjectFile(project.root, `.pdd/evidence/${id}/spec.json`, JSON.stringify(snapshot, null, 2) + '\n');
  await writeProjectFile(project.root, `.pdd/evidence/${id}/manifest.json`, JSON.stringify(saved, null, 2) + '\n');
  await writeProjectFile(project.root, '.pdd/evidence/latest.json', JSON.stringify({ schemaVersion: 1, id }) + '\n', true);
  const current=await loadProject(project.root);
  return await reviewCurrent(current, await createSpecSnapshot(current), saved);
}

export async function reportProject(directory: string, selectedId?: string): Promise<ReviewPacket> {
  const project = await loadProject(directory);
  const snapshot = await createSpecSnapshot(project);
  let id = selectedId;
  if (id === undefined) {
    try { id = z.strictObject({ schemaVersion: z.literal(1), id: identifier }).parse(JSON.parse(await readProjectText(project.root, '.pdd/evidence/latest.json'))).id; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new NoRunError('No verification run exists; run pdd-ts verify first');
      throw error;
    }
  }
  identifier.parse(id);
  const saved = savedRunSchema.parse(JSON.parse(await readProjectText(project.root, `.pdd/evidence/${id}/manifest.json`, 16_777_216)));
  if (saved.id !== id || saved.evidence.some(item => item.run.id !== id)) throw new Error('Evidence run identity mismatch');
  return await reviewCurrent(project, snapshot, saved);
}
