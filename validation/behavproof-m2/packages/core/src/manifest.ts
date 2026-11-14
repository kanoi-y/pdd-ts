import { z } from 'zod';
import { canonicalJson, hashBytes } from './serialization.js';
import { CiIdentitySchema, EvidenceSubjectSchema, ExecutionManifestSchema, HashSchema, ProducerSchema, RelativePathSchema, type EvidenceStatus, type Provenance } from './schemas.js';
const expectedArtifact=z.strictObject({ref:RelativePathSchema,kind:z.string().min(1),scope:z.array(z.string().min(1))});
export const ManifestExpectedSchema=z.strictObject({executionId:z.string().min(1),subject:EvidenceSubjectSchema,commandHash:HashSchema,configHashes:z.record(RelativePathSchema,HashSchema),dependencyLockHash:HashSchema.optional(),artifacts:z.array(expectedArtifact)}).refine(v=>new Set(v.artifacts.map(a=>a.ref)).size===v.artifacts.length,'Duplicate expected artifact references');
export const ProducerAuthoritySchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('ci'),producer:ProducerSchema,ci:CiIdentitySchema}),
  z.strictObject({kind:z.literal('local'),producer:ProducerSchema,executionId:z.string().min(1),commandHash:HashSchema})
]);
export type ManifestExpected=z.infer<typeof ManifestExpectedSchema>;
export type ProducerAuthority=z.infer<typeof ProducerAuthoritySchema>;
export type ManifestValidation=Provenance&{executionStatus:EvidenceStatus};
const equal=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
const inventory=(rows:{ref:string;kind:string;scope:string[]}[])=>rows.map(row=>({...row,scope:[...new Set(row.scope)].sort()})).sort((a,b)=>a.ref<b.ref?-1:a.ref>b.ref?1:0);
/** Authority is a caller-owned control-plane input, never a field read from the report. */
export function validateManifest(manifest:unknown,expected:ManifestExpected,artifacts:Readonly<Record<string,Uint8Array>>,authority:ProducerAuthority|undefined):ManifestValidation{
  const wanted=ManifestExpectedSchema.parse(expected);
  const trusted=authority===undefined?undefined:ProducerAuthoritySchema.parse(authority);
  if(manifest===undefined||manifest===null)return {artifactIntegrity:'unknown',producerTrust:'unknown',subjectMatch:'unknown',executionStatus:'unknown',reasons:['Execution manifest unavailable']};
  const actual=ExecutionManifestSchema.parse(manifest);
  const reasons:string[]=[];
  let artifactIntegrity:EvidenceStatus='pass';
  for(const artifact of actual.artifacts){
    const bytes=Object.hasOwn(artifacts,artifact.ref)?artifacts[artifact.ref]:undefined;
    if(bytes===undefined){artifactIntegrity='fail';reasons.push(`Artifact unavailable: ${artifact.ref}`);}
    else if(hashBytes(bytes)!==artifact.sha256){artifactIntegrity='fail';reasons.push(`Artifact hash mismatch: ${artifact.ref}`);}
  }
  for(const ref of Object.keys(artifacts))if(!actual.artifacts.some(a=>a.ref===ref)){artifactIntegrity='fail';reasons.push(`Unmanifested artifact: ${ref}`);}
  let subjectMatch:EvidenceStatus='pass';
  const mismatch=(condition:boolean,reason:string)=>{if(condition){subjectMatch='fail';reasons.push(reason);}};
  mismatch(actual.executionId!==wanted.executionId,'Execution ID mismatch');
  mismatch(!equal(actual.subject,wanted.subject),'Evidence subject mismatch');
  mismatch(actual.subject.dirty||wanted.subject.dirty,'Dirty source inputs cannot satisfy a gate');
  mismatch(actual.commandHash!==wanted.commandHash,'Command hash mismatch');
  mismatch(!equal(actual.configHashes,wanted.configHashes),'Configuration hashes mismatch');
  mismatch(actual.dependencyLockHash!==wanted.dependencyLockHash,'Dependency lock hash mismatch');
  mismatch(!equal(inventory(actual.artifacts.map(({ref,kind,scope})=>({ref,kind,scope}))),inventory(wanted.artifacts)),'Artifact kind/scope inventory mismatch');
  let producerTrust:EvidenceStatus='unknown';
  if(!trusted)reasons.push('External producer authority unavailable');
  else{
    const identityMatch=equal(actual.producer,trusted.producer)&&(trusted.kind==='ci'?actual.ci!==undefined&&equal(actual.ci,trusted.ci):actual.ci===undefined&&actual.executionId===trusted.executionId&&actual.commandHash===trusted.commandHash);
    producerTrust=identityMatch?'pass':'fail';
    if(!identityMatch)reasons.push('External producer identity mismatch');
  }
  const executionStatus=actual.exitCode===0?'pass':'fail';
  if(executionStatus==='fail')reasons.push(`Producer execution failed: exit ${actual.exitCode}`);
  return {artifactIntegrity,producerTrust,subjectMatch,executionStatus,reasons:reasons.sort()};
}
