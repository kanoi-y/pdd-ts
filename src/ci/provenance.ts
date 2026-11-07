import { z } from 'zod';
const sha=z.string().regex(/^[a-f0-9]{40}$/);
export const attestedIdentitySchema=z.object({schemaVersion:z.literal(1),repositoryId:z.number().int().positive(),candidateSha:sha,baselineSha:sha,runId:z.string().regex(/^[1-9][0-9]*$/),runAttempt:z.number().int().positive(),specDigest:z.string().regex(/^[a-f0-9]{64}$/)});
export interface AttestationPolicy {repository:string;repositoryId:number;workflow:string}
export function attestationArguments(file:string,policy:AttestationPolicy,baselineSha:string,branch:string):string[] {
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(policy.repository) || !/^\.github\/workflows\/[A-Za-z0-9_-]+\.ya?ml$/.test(policy.workflow) || !/^[a-f0-9]{40}$/.test(baselineSha) || !/^[A-Za-z0-9_./-]+$/.test(branch) || branch.includes('..')) throw new Error('Invalid attestation trust policy');
 return ['attestation','verify',file,'--repo',policy.repository,'--cert-identity',`https://github.com/${policy.repository}/${policy.workflow}@refs/heads/${branch}`,'--signer-digest',baselineSha,'--source-ref',`refs/heads/${branch}`,'--source-digest',baselineSha,'--deny-self-hosted-runners','--predicate-type','https://slsa.dev/provenance/v1','--format','json'];
}
export function validateAttestedRun(raw:unknown,expected:{repositoryId:number;candidateSha:string;baselineSha:string;specDigest:string}):boolean {
 const parsed=attestedIdentitySchema.safeParse(raw);
 return parsed.success && parsed.data.repositoryId===expected.repositoryId && parsed.data.candidateSha===expected.candidateSha && parsed.data.baselineSha===expected.baselineSha && parsed.data.specDigest===expected.specDigest;
}
const nativeResultSchema=z.array(z.object({verificationResult:z.object({mediaType:z.literal('application/vnd.dev.sigstore.verificationresult+json;version=0.1'),signature:z.object({certificate:z.object({issuer:z.string(),subjectAlternativeName:z.string(),buildSignerURI:z.string(),buildSignerDigest:sha,runnerEnvironment:z.string(),sourceRepositoryURI:z.string(),sourceRepositoryDigest:sha,sourceRepositoryRef:z.string(),sourceRepositoryIdentifier:z.string(),runInvocationURI:z.string()})}),verifiedTimestamps:z.array(z.object({type:z.enum(['Tlog','TimestampAuthority']),uri:z.url(),timestamp:z.iso.datetime({offset:true})})).min(1),statement:z.object({subject:z.array(z.object({digest:z.object({sha256:z.string()})})).min(1),predicateType:z.literal('https://slsa.dev/provenance/v1')})})})).min(1).max(100);
export interface NativeExpected extends AttestationPolicy {baselineSha:string;branch:string;fileDigest:string;runId:string;runAttempt:number}
export function validateNativeVerification(raw:unknown,expected:NativeExpected):boolean {
 const parsed=nativeResultSchema.safeParse(raw); if(!parsed.success) return false;
 const san=`https://github.com/${expected.repository}/${expected.workflow}@refs/heads/${expected.branch}`;
 return parsed.data.some(entry=>{
  const result=entry.verificationResult,c=result.signature.certificate;
  return c.issuer==='https://token.actions.githubusercontent.com' && c.subjectAlternativeName===san && c.buildSignerURI===san && c.buildSignerDigest===expected.baselineSha && c.runnerEnvironment==='github-hosted' && c.sourceRepositoryURI===`https://github.com/${expected.repository}` && c.sourceRepositoryIdentifier===String(expected.repositoryId) && c.sourceRepositoryDigest===expected.baselineSha && c.sourceRepositoryRef===`refs/heads/${expected.branch}` && c.runInvocationURI===`https://github.com/${expected.repository}/actions/runs/${expected.runId}/attempts/${expected.runAttempt}` && result.statement.subject.some(subject=>subject.digest.sha256===expected.fileDigest);
 });
}
