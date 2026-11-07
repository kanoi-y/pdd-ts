import {describe,expect,it} from 'vitest';
import {attestationArguments,validateAttestedRun} from '../../src/ci/provenance.js';
const sha='a'.repeat(40), head='b'.repeat(40), digest='c'.repeat(64);
const policy={repository:'owner/repo',repositoryId:123,workflow:'.github/workflows/pdd.yml'};
const claim={schemaVersion:1,repositoryId:123,candidateSha:head,baselineSha:sha,runId:'42',runAttempt:1,specDigest:digest};
describe('CI-003 native attestation and candidate binding',()=>{
 it('pins exact signer identity, signer/source commits and hosted runners',()=>{
  const args=attestationArguments('/tmp/result.json',policy,sha,'main');
  expect(args).toContain('--deny-self-hosted-runners'); expect(args).toContain('--signer-digest'); expect(args.filter(item=>item===sha)).toHaveLength(2);
  expect(args).toContain('https://github.com/owner/repo/.github/workflows/pdd.yml@refs/heads/main');
 });
 it('binds candidate separately from the trusted source commit',()=>{
  expect(validateAttestedRun(claim,{repositoryId:123,candidateSha:head,baselineSha:sha,specDigest:digest})).toBe(true);
  for(const field of ['repositoryId','candidateSha','baselineSha','specDigest','runId','runAttempt']) expect(validateAttestedRun({...claim,[field]:field==='repositoryId'?999:field==='runAttempt'?0:'wrong'},{repositoryId:123,candidateSha:head,baselineSha:sha,specDigest:digest})).toBe(false);
 });
 it('does not accept a receipt with only user-set CI environment or fake JSON',()=>{
  expect(validateAttestedRun({GITHUB_SHA:head,GITHUB_RUN_ID:'42',authenticated:true},{repositoryId:123,candidateSha:head,baselineSha:sha,specDigest:digest})).toBe(false);
 });
});

import {validateNativeVerification} from '../../src/ci/provenance.js';
it('CI-003 requires one complete native verification entry, never cross-entry field mixing',()=>{
 const san='https://github.com/owner/repo/.github/workflows/pdd.yml@refs/heads/main';
 const entry={verificationResult:{mediaType:'application/vnd.dev.sigstore.verificationresult+json;version=0.1',signature:{certificate:{issuer:'https://token.actions.githubusercontent.com',subjectAlternativeName:san,buildSignerURI:san,buildSignerDigest:sha,runnerEnvironment:'github-hosted',sourceRepositoryURI:'https://github.com/owner/repo',sourceRepositoryDigest:sha,sourceRepositoryRef:'refs/heads/main',sourceRepositoryIdentifier:'123',runInvocationURI:'https://github.com/owner/repo/actions/runs/42/attempts/1'}},verifiedTimestamps:[{type:'Tlog',uri:'https://rekor.sigstore.dev',timestamp:'2026-11-07T00:00:00Z'}],statement:{subject:[{digest:{sha256:digest}}],predicateType:'https://slsa.dev/provenance/v1'}}};
 const expected={...policy,baselineSha:sha,branch:'main',fileDigest:digest,runId:'42',runAttempt:1};
 expect(validateNativeVerification([entry],expected)).toBe(true);
 for(const raw of [[],[{}],[{...entry,verificationResult:{...entry.verificationResult,verifiedTimestamps:[]}}],[{...entry,verificationResult:{...entry.verificationResult,signature:{certificate:{...entry.verificationResult.signature.certificate,sourceRepositoryIdentifier:'999'}}}}]]) expect(validateNativeVerification(raw,expected)).toBe(false);
});

it('CI-003 parses actual native verification timestamps with UTC offsets without relaxing identity',async()=>{
 const {readFile}=await import('node:fs/promises');
 const raw=JSON.parse(await readFile(new URL('../fixtures/attestation/native-gh-verification.json',import.meta.url),'utf8'));
 const expected={repository:'kanoi-y/pdd-ts',repositoryId:1449042266,workflow:'.github/workflows/pdd.yml',baselineSha:'1f476c47738612c3b2dbf3d192b7280fdd4f5de2',branch:'main',fileDigest:'b228d836effc6c5837462313b835db07ca83eb361d3156f3d2fa5364ef9d084c',runId:'42359881713',runAttempt:1};
 expect(validateNativeVerification(raw,expected)).toBe(true);
 expect(validateNativeVerification(raw,{...expected,repositoryId:999})).toBe(false);
 const malformed=structuredClone(raw);malformed[0].verificationResult.verifiedTimestamps[0].timestamp='invalid';
 expect(validateNativeVerification(malformed,expected)).toBe(false);
});
