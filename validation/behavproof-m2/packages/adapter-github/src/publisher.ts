import {
  CheckReportSchema, CiIdentitySchema, EvidenceSubjectSchema, EvaluationSchema,
  HashSchema, evaluateGate, hash,
  type CheckReport, type EvidenceSubject, type Evaluation,
} from '@behavproof/core';
import {GitHubAuthority} from './authority.js';
import {evaluateUpstream} from './pipeline.js';
import {GitHubTransport, object, type GitHubOptions} from './transport.js';

type Ci = ReturnType<typeof CiIdentitySchema.parse>;
export interface PublicationPacket {
  schemaVersion: 1;
  repositoryId: string;
  subject: EvidenceSubject;
  effectivePolicyHash: string;
  registrationDigest: string;
  ci: Ci;
  report: CheckReport;
  upstream: {jobs: Record<string,string>; artifacts: string[]};
}
export interface PublicationExpectation {
  repository: string;
  repositoryId: string;
  pr: number;
  headSha: string;
  baseSha: string;
  protectedBranch: string;
  checkName: string;
  appId: number;
  subject: EvidenceSubject;
  effectivePolicyHash: string;
  registrationDigest: string;
  ci: Ci;
  requiredEvaluations: Pick<Evaluation,'ruleId'|'severity'|'scope'>[];
  requiredJobs: string[];
  requiredArtifacts: string[];
}
export interface PreparedCheck {
  readonly headSha: string;
  readonly checkName: string;
  readonly conclusion: 'success'|'failure';
}
const preparations = new WeakMap<PreparedCheck, Readonly<PublicationExpectation>>();
function freeze<T>(value:T):T {
  if(value && typeof value==='object') {
    for(const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const sha = (value:unknown) => typeof value==='string' && /^[a-f0-9]{40}$/.test(value);
const rowKey = (row:Pick<Evaluation,'ruleId'|'scope'>) => hash({ruleId:row.ruleId,scope:[...new Set(row.scope)].sort()});
function expectation(value:PublicationExpectation):Readonly<PublicationExpectation> {
  const e=structuredClone(value);
  // These are host configuration errors, not candidate failures.
  new GitHubTransport({repository:e.repository});
  if(!/^\d+$/.test(e.repositoryId) || !Number.isSafeInteger(e.pr) || e.pr<1 ||
     !sha(e.headSha) || !sha(e.baseSha) || !e.protectedBranch ||
     !e.checkName || e.checkName.length>100 || !Number.isSafeInteger(e.appId) ||
     e.appId<1 || e.appId===15368) throw Error('Invalid protected publication identity');
  e.subject=EvidenceSubjectSchema.parse(e.subject);
  e.ci=CiIdentitySchema.parse(e.ci);
  HashSchema.parse(e.effectivePolicyHash); HashSchema.parse(e.registrationDigest);
  if(e.subject.dirty || e.subject.prHeadSha!==e.headSha || e.subject.baseSha!==e.baseSha ||
     !sha(e.subject.testedCommitSha) || e.ci.repositoryId!==e.repositoryId ||
     !['workflow_dispatch','workflow_run','push'].includes(e.ci.eventName) ||
     !e.ci.workflowRef.startsWith(`${e.repository}/.github/workflows/`) ||
     !/@[a-f0-9]{40}$/.test(e.ci.workflowRef)) throw Error('Invalid protected subject or producer');
  const rows=e.requiredEvaluations.map(row=>EvaluationSchema.parse({...row,status:'unknown',evidenceIds:[],message:'Required host obligation'}));
  if(!rows.some(row=>row.severity==='error') || new Set(rows.map(rowKey)).size!==rows.length ||
     !e.requiredJobs.length || !e.requiredArtifacts.length ||
     [...e.requiredJobs,...e.requiredArtifacts].some(value=>typeof value!=='string'||!value) ||
     new Set(e.requiredJobs).size!==e.requiredJobs.length ||
     new Set(e.requiredArtifacts).size!==e.requiredArtifacts.length) throw Error('Empty or ambiguous protected obligations');
  return freeze(e);
}
function packet(value:unknown):PublicationPacket {
  const p=object(structuredClone(value));
  if(p.schemaVersion!==1 || Object.keys(p).some(key=>!['schemaVersion','repositoryId','subject','effectivePolicyHash','registrationDigest','ci','report','upstream'].includes(key))) throw Error('Invalid publication packet');
  const upstream=object(p.upstream),jobs=object(upstream.jobs);
  if(Object.keys(upstream).some(key=>!['jobs','artifacts'].includes(key)) ||
     !Object.values(jobs).every(value=>typeof value==='string') ||
     !Array.isArray(upstream.artifacts) || !upstream.artifacts.every(value=>typeof value==='string')) throw Error('Invalid upstream inventory');
  return freeze({schemaVersion:1,repositoryId:p.repositoryId,
    subject:EvidenceSubjectSchema.parse(p.subject),ci:CiIdentitySchema.parse(p.ci),
    effectivePolicyHash:HashSchema.parse(p.effectivePolicyHash),registrationDigest:HashSchema.parse(p.registrationDigest),
    report:CheckReportSchema.parse(p.report),upstream:{jobs,artifacts:upstream.artifacts}});
}

/** Host expectations and callback must come from the protected control plane.
 * The callback authenticates this exact immutable packet against the independently
 * selected completed CI attempt/job/archive and the verifier's captured bytes.
 * A packet's own provenance/status fields never supply that authority.
 */
export function prepareCheckPublication(
  value:unknown, expected:PublicationExpectation,
  verifyPacket:(snapshot:PublicationPacket)=>unknown,
):PreparedCheck {
  const e=expectation(expected);
  let accepted=false;
  try {
    const p=packet(value);
    const levels={off:0,warn:1,error:2};
    const complete=e.requiredEvaluations.every(required=>p.report.evaluations.some(row=>
      rowKey(row)===rowKey(required) && levels[row.severity]>=levels[required.severity]));
    const recomputed=evaluateGate(p.report.evaluations,'gate');
    accepted=p.repositoryId===e.repositoryId && hash(p.subject)===hash(e.subject) &&
      p.effectivePolicyHash===e.effectivePolicyHash && p.registrationDigest===e.registrationDigest &&
      hash(p.ci)===hash(e.ci) && p.report.mode==='gate' && p.report.status==='pass' &&
      p.report.exitCode===0 && recomputed.status==='pass' && complete &&
      evaluateUpstream(p.upstream.jobs,p.upstream.artifacts,{requiredJobs:e.requiredJobs,artifacts:e.requiredArtifacts}).status==='pass' &&
      verifyPacket(p)===true;
  } catch { /* Malformed, incomplete or unverifiable input yields a failure check. */ }
  const result=freeze({headSha:e.headSha,checkName:e.checkName,conclusion:accepted?'success' as const:'failure' as const});
  preparations.set(result,e);
  return result;
}

/** Separate privileged publisher; it executes no candidate code or commands. */
export class GitHubCheckPublisher {
  private readonly http:GitHubTransport;
  private readonly authority:GitHubAuthority;
  constructor(options:GitHubOptions) {
    this.http=new GitHubTransport(options);
    this.authority=new GitHubAuthority(options);
  }
  async publish(decision:PreparedCheck) {
    const e=preparations.get(decision);
    if(!e || e.repository!==this.http.repository) throw Error('Unverified prepared publication');
    const repo=object(await this.http.request(this.http.prefix));
    if(String(repo.id)!==e.repositoryId || repo.full_name!==e.repository) throw Error('Current repository identity mismatch');
    const current=async()=> {
      const p=object(await this.http.request(`${this.http.prefix}/pulls/${e.pr}`));
      if(p.number!==e.pr || p.state!=='open' || p.head?.sha!==e.headSha ||
         p.base?.sha!==e.baseSha || p.base?.ref!==e.protectedBranch ||
         String(p.base?.repo?.id)!==e.repositoryId || p.base?.repo?.full_name!==e.repository)
        throw Error('Current PR identity mismatch');
    };
    await current();
    const protection=await this.authority.protection(e.protectedBranch,[{context:e.checkName,appId:e.appId}]);
    await current();
    const conclusion=decision.conclusion==='success' && protection.status==='pass'?'success':'failure';
    const body={name:e.checkName,head_sha:e.headSha,status:'completed',conclusion,
      external_id:hash({repositoryId:e.repositoryId,pr:e.pr,head:e.headSha,ci:e.ci,registration:e.registrationDigest}),
      output:{title:conclusion==='success'?'BehavProof gate accepted':'BehavProof gate blocked',
        summary:conclusion==='success'?'Current authenticated evidence satisfies the protected obligations.':'Required evidence, upstream outcomes or protected authority is unavailable or unsatisfied.'}};
    const published=object(await this.http.request(`${this.http.prefix}/check-runs`,body));
    if(!Number.isSafeInteger(published.id) || published.id<1 || published.app?.id!==e.appId ||
       published.name!==e.checkName || published.head_sha!==e.headSha || published.status!=='completed' ||
       published.conclusion!==conclusion) throw Error('Published check issuer or identity mismatch');
    return {id:published.id as number,headSha:e.headSha,conclusion,protection:protection.status};
  }
}
