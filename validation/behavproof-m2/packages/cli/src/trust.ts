import { z } from 'zod';
import { resolve, dirname, basename, relative, sep, isAbsolute } from 'node:path';
import { realpath } from 'node:fs/promises';
import { ConfigSchema, PolicySchema, RegistrySnapshotSchema, RelativePathSchema, HashSchema, CiIdentitySchema, ManifestExpectedSchema, ProducerAuthoritySchema, safeReadJson, safeRead, hashBytes, validateManifest, ExecutionManifestSchema, hash, type EvidenceSubject, type ManifestValidation, type Evidence, type Contract } from '@behavproof/core';
import { GitHubAuthority, verifyArtifactArchive } from '@behavproof/adapter-github';
import { git } from './project.js';
export const TrustRootSchema=z.strictObject({
 schemaVersion:z.literal(1),policy:PolicySchema,config:ConfigSchema,baseline:RegistrySnapshotSchema,
 inputs:z.array(RelativePathSchema).min(1),qualitySources:z.array(RelativePathSchema).min(1).optional(),configPaths:z.array(RelativePathSchema),dependencyLockPath:RelativePathSchema.optional(),
 manifests:z.array(z.strictObject({ref:RelativePathSchema,manifestHash:HashSchema.optional(),expected:ManifestExpectedSchema,authority:ProducerAuthoritySchema,github:z.strictObject({repository:z.string().min(1),workflowPath:z.string(),workflowSha:z.string(),jobName:z.string(),artifactName:z.string(),archivePath:RelativePathSchema,archiveEntries:z.record(RelativePathSchema,RelativePathSchema)}).optional()}).refine(row=>row.authority.kind!=='local'||row.manifestHash!==undefined,'Local authority requires host-pinned manifestHash')),
 github:z.strictObject({repository:z.string().regex(/^[\w-]+\/[\w.-]+$/),pr:z.number().int().positive(),reviewers:z.array(z.string().min(1)).min(1),requiredChecks:z.array(z.strictObject({context:z.string().min(1),appId:z.number().int().positive()})).min(1)}).optional(),
 notApplicable:z.array(z.strictObject({ruleId:z.string().min(1),reason:z.string().min(1),evidenceRef:RelativePathSchema})).default([]),
 claimScopes:z.array(z.strictObject({contractId:z.string().min(1),caseIds:z.array(z.string().min(1)).min(1),targetRef:z.string().min(1),method:z.string().min(1)})).default([]),
 pipeline:z.strictObject({workflow:RelativePathSchema,gateJob:z.string().min(1),requiredJobs:z.array(z.string().min(1)).min(1),artifacts:z.array(RelativePathSchema).min(1),protectedBranch:z.string().min(1),currentRun:z.strictObject({ci:CiIdentitySchema,workflowPath:RelativePathSchema,workflowSha:z.string().regex(/^[a-f0-9]{40}$/),workflowHash:HashSchema}).optional()}).optional(),
});
export type TrustRoot=z.infer<typeof TrustRootSchema>;
export async function loadTrust(root:string,path:string):Promise<TrustRoot>{
 const actual=await realpath(resolve(root,path)),base=await realpath((await git(root,['rev-parse','--show-toplevel'])).trim()),rel=relative(base,actual);
 if(rel===''||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith(`..${sep}`)))throw Error('--trust-root must be outside the project');
 return TrustRootSchema.parse(await safeReadJson(dirname(actual),basename(actual)));
}
export async function authenticate(root:string,trust:TrustRoot|undefined,subject:EvidenceSubject){
 const artifactBytes=new Map<string,Uint8Array>();const verified=new Set<string>(),failures:string[]=[],unknowns:string[]=[],manifests:{ref:string;validation:ManifestValidation}[]=[];const configHashes:Record<string,string>={};let dependencyLockHash:string|undefined;let trustedCi=false;
 if(!trust)return {verified,failures,unknowns:['External producer authority unavailable'],manifests,trustedCi,artifactBytes,configHashes,dependencyLockHash};
 for(const path of trust.configPaths)configHashes[path]=hashBytes(await safeRead(root,path));
 dependencyLockHash=trust.dependencyLockPath?hashBytes(await safeRead(root,trust.dependencyLockPath)):undefined;
 for(const spec of trust.manifests){
  let manifestBytes:Uint8Array;try{manifestBytes=await safeRead(root,spec.ref);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT'){unknowns.push(`Missing manifest: ${spec.ref}`);continue;}throw e;}
  const manifest=ExecutionManifestSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBytes))),bytes:Record<string,Uint8Array>={};
  for(const a of manifest.artifacts){try{bytes[a.ref]=await safeRead(root,a.ref);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
  let authority:typeof spec.authority|undefined=spec.authority;
  if((authority.kind==='local'||spec.manifestHash!==undefined)&&hash(manifest)!==spec.manifestHash){failures.push('Host-pinned manifest digest mismatch');continue;}
  if(authority.kind==='ci'){
    if(!spec.github){authority=undefined;unknowns.push('CI authority requires live GitHub verification');}
    else {const g=spec.github;const archive=await safeRead(root,g.archivePath),digest=hashBytes(archive);const archiveMatch=verifyArtifactArchive(archive,{[spec.ref]:manifestBytes,...bytes},g.archiveEntries);if(archiveMatch.status!=='pass'){unknowns.push(...archiveMatch.reasons);continue;}const result=await new GitHubAuthority({repository:g.repository,...(process.env.GITHUB_TOKEN?{token:process.env.GITHUB_TOKEN}:{})}).producer(manifest.ci,{ci:authority.ci,workflowPath:g.workflowPath,workflowSha:g.workflowSha,jobName:g.jobName,artifactName:g.artifactName,artifactDigest:digest});if(result.status!=='pass'){authority=undefined;unknowns.push(...result.reasons);}}
  }
  const result=validateManifest(manifest,spec.expected,bytes,authority);
  if(hash(spec.expected.subject)!==hash(subject)||hash(spec.expected.configHashes)!==hash(configHashes)||spec.expected.dependencyLockHash!==dependencyLockHash){result.subjectMatch='fail';result.reasons.push('Host-selected expectation does not match current input/config/lock snapshot');}
 manifests.push({ref:spec.ref,validation:result});
  const states=[result.artifactIntegrity,result.producerTrust,result.subjectMatch,result.executionStatus];
  if(states.includes('fail'))failures.push(...result.reasons);
  else if(states.every(x=>x==='pass')){for(const a of manifest.artifacts){const captured=bytes[a.ref]!;if(artifactBytes.has(a.ref)&&hashBytes(artifactBytes.get(a.ref)!)!==hashBytes(captured))throw Error('Conflicting authenticated artifact snapshots');artifactBytes.set(a.ref,captured);verified.add(a.ref);}if(authority?.kind==='ci')trustedCi=true;}
  else unknowns.push(...result.reasons);
 }
 return {verified,failures:failures.sort(),unknowns:unknowns.sort(),manifests,trustedCi,artifactBytes,configHashes,dependencyLockHash};
}
export const approvalKey=(v:unknown)=>hash(v);

export function isCurrentClaim(evidence:Evidence,artifactRef:string,subject:EvidenceSubject,policyHash:string,contracts:readonly Pick<Contract,'id'|'revisionHash'>[]):boolean{
 const payload=evidence.payload as {contractId?:string};
 const active=contracts.find(c=>c.id===payload.contractId);
 return !!active&&evidence.source.artifactRef===artifactRef&&hash(evidence.context.subject??null)===hash(subject)&&evidence.context.effectivePolicyHash===policyHash&&evidence.context.contractHash===active.revisionHash;
}
