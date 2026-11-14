import { ApprovalSchema, CiIdentitySchema, hash, type Approval } from '@behavproof/core';
import { GitHubTransport, object, observed, unknown, type GitHubOptions, type Observation } from './transport.js';
type Ci = ReturnType<typeof CiIdentitySchema.parse>;
export interface ApprovalExpectation {headSha:string; baseSha?:string; reviewers:string[]; minApprovals?:number; requiredChecks:{context:string;appId:number}[]}
export interface ProducerExpectation {ci:Ci; workflowPath:string; workflowSha:string; jobName:string; artifactName:string; artifactDigest:string}
const sha=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
export class GitHubAuthority {
  private readonly http:GitHubTransport;
  constructor(options:GitHubOptions){this.http=new GitHubTransport(options);}
  async protection(branch:string,requiredChecks:ApprovalExpectation['requiredChecks']):Promise<Observation>{
    try {
      if(!branch||!requiredChecks.length||!requiredChecks.every(c=>c.context&&Number.isSafeInteger(c.appId)&&c.appId>0))return unknown('Invalid protection expectations');
      const path=`${this.http.prefix}/branches/${encodeURIComponent(branch)}/protection`,value=object(await this.http.request(path));
      const checks=value.required_status_checks?.checks;
      if(value.enforce_admins?.enabled!==true||value.required_status_checks?.strict!==true||!Array.isArray(checks)||!requiredChecks.every(c=>checks.some(x=>x.context===c.context&&x.app_id===c.appId)))return unknown('Required checks, expected App or administrator enforcement are not protected');
      return observed(value,[path]);
    }catch(error){return unknown(error instanceof Error?error.message:'Protection unavailable');}
  }
  async approval(pr:number,target:Approval['target'],expected:ApprovalExpectation):Promise<Observation<Approval>&{approval?:Approval}>{
    try {
      const content=ApprovalSchema.shape.target.parse(target);
      if(!Number.isSafeInteger(pr)||pr<1||!sha(expected.headSha)||(expected.baseSha!==undefined&&!sha(expected.baseSha))||!expected.reviewers.length||!expected.reviewers.every(x=>/^[\w-]+$/.test(x))||!expected.requiredChecks.length||!expected.requiredChecks.every(x=>x.context&&Number.isSafeInteger(x.appId)&&x.appId>0)||!Number.isInteger(expected.minApprovals??1)||(expected.minApprovals??1)<1)return unknown('Invalid approval expectations');
      const path=`${this.http.prefix}/pulls/${pr}`,pull=object(await this.http.request(path));
      const validate=(p:Record<string,any>)=>p.number===pr&&p.state==='open'&&p.head?.sha===expected.headSha&&p.base?.repo?.full_name===this.http.repository&&(!expected.baseSha||p.base.sha===expected.baseSha);
      if(!validate(pull)||typeof pull.base?.ref!=='string'||typeof pull.user?.login!=='string')return unknown('PR head/base identity is not current');
      const protection=object(await this.http.request(`${this.http.prefix}/branches/${encodeURIComponent(pull.base.ref)}/protection`));
      const rules=object(protection.required_pull_request_reviews),checks=protection.required_status_checks?.checks;
      if(!Number.isInteger(rules.required_approving_review_count)||rules.required_approving_review_count<1||rules.dismiss_stale_reviews!==true||!Array.isArray(checks)||!expected.requiredChecks.every(c=>checks.some(x=>x.context===c.context&&x.app_id===c.appId)))return unknown('Required human review or issuer-bound checks are not protected');
      const reviews=await this.http.pages(`${path}/reviews`),latest=new Map<string,Record<string,any>>();
      for(const r of reviews){
        if(r.user?.type!=='User'||typeof r.user.login!=='string'||!['APPROVED','CHANGES_REQUESTED','DISMISSED'].includes(r.state))continue;
        if(typeof r.submitted_at!=='string'||!Number.isFinite(Date.parse(r.submitted_at)))return unknown('Malformed review timestamp');
        const login=r.user.login.toLowerCase(),previous=latest.get(login);
        if(!previous||Date.parse(previous.submitted_at)<Date.parse(r.submitted_at)||(previous.submitted_at===r.submitted_at&&Number(previous.id)<Number(r.id)))latest.set(login,r);
      }
      const allow=new Set(expected.reviewers.map(x=>x.toLowerCase())),approved:string[]=[],reviewIds:string[]=[];
      for(const [login,r] of latest){
        if(r.state!=='APPROVED'||r.commit_id!==expected.headSha||login===pull.user.login.toLowerCase()||!allow.has(login))continue;
        const role=object(await this.http.request(`${this.http.prefix}/collaborators/${encodeURIComponent(login)}/permission`));
        if(['write','maintain','admin'].includes(role.permission)){approved.push(login);reviewIds.push(String(r.id));}
      }
      if(approved.length<Math.max(rules.required_approving_review_count,expected.minApprovals??1))return unknown('Insufficient current authorized non-self approvals');
      if(rules.require_code_owner_reviews){
        const [owner,name]=this.http.repository.split('/');
        const data=object(await this.http.request('/graphql',{query:'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){headRefOid baseRefOid reviewDecision}}}',variables:{owner,name,number:pr}}));
        const decision=data.data?.repository?.pullRequest;
        if(data.errors||decision?.headRefOid!==expected.headSha||decision?.baseRefOid!==pull.base.sha||decision?.reviewDecision!=='APPROVED')return unknown('Current CODEOWNERS review decision is unavailable');
      }
      if(!validate(object(await this.http.request(path))))return unknown('PR identity changed during verification');
      const approval=ApprovalSchema.parse({schemaVersion:1,id:hash({content,head:expected.headSha,reviewIds:reviewIds.sort()}),target:content,status:'pass',source:{provider:'github',ref:`https://github.com/${this.http.repository}/pull/${pr}`},approvedBy:approved.sort(),subjectCommitSha:expected.headSha,reasons:[]});
      return {...observed(approval,[path]),approval};
    }catch(error){return unknown(error instanceof Error?error.message:'Approval verification unavailable');}
  }
  /** Read upstream terminal outcomes while this trusted final gate is running. */
  async upstream(ciInput:unknown,expected:{ci:Ci;workflowPath:string;workflowSha:string;gateJob:string;requiredJobs:string[]}):Promise<Observation<{jobs:Record<string,string>}>> {
    try {
      const ci=CiIdentitySchema.parse(ciInput);
      if(hash(ci)!==hash(CiIdentitySchema.parse(expected.ci)) ||
         ![ci.repositoryId,ci.runId,ci.jobId].every(x=>/^\d+$/.test(x)) ||
         !sha(expected.workflowSha) || !/^\.github\/workflows\/[\w.-]+\.ya?ml$/.test(expected.workflowPath) ||
         ci.workflowRef!==`${this.http.repository}/${expected.workflowPath}@${expected.workflowSha}` ||
         !['workflow_dispatch','workflow_run','push'].includes(ci.eventName) || !expected.gateJob ||
         !expected.requiredJobs.length || new Set(expected.requiredJobs).size!==expected.requiredJobs.length ||
         expected.requiredJobs.some(name=>!name || name===expected.gateJob)) return unknown('Invalid final-gate expectations');
      const path=`${this.http.prefix}/actions/runs/${ci.runId}`,attempt=`${path}/attempts/${ci.runAttempt}`;
      // The latest endpoint prevents an earlier attempt from authorizing a rerun.
      for(const endpoint of [path,attempt]) {
        const run=object(await this.http.request(endpoint));
        if(String(run.id)!==ci.runId || String(run.repository?.id)!==ci.repositoryId ||
           run.repository?.full_name!==this.http.repository || run.head_sha!==expected.workflowSha ||
           run.path!==expected.workflowPath || run.event!==ci.eventName || run.run_attempt!==ci.runAttempt ||
           !['in_progress','completed'].includes(run.status)) return unknown('Final-gate run identity mismatch');
      }
      const rows=await this.http.pages(`${attempt}/jobs`,'jobs');
      const belongs=(row:Record<string,any>)=>String(row.run_id)===ci.runId&&row.run_attempt===ci.runAttempt;
      const gate=rows.filter(row=>String(row.id)===ci.jobId&&row.name===expected.gateJob);
      if(gate.length!==1 || !belongs(gate[0]!) || !['in_progress','completed'].includes(gate[0]!.status)) return unknown('Final-gate job identity mismatch');
      const jobs:Record<string,string>={};
      for(const name of expected.requiredJobs) {
        const matched=rows.filter(row=>row.name===name);
        if(matched.length!==1 || !belongs(matched[0]!) || matched[0]!.status!=='completed' || matched[0]!.conclusion!=='success') return unknown('Required upstream job is incomplete or unsuccessful');
        jobs[name]='success';
      }
      return observed({jobs},[path,attempt]);
    }catch(error){return unknown(error instanceof Error?error.message:'Upstream verification unavailable');}
  }
  async producer(ciInput:unknown,expected:ProducerExpectation):Promise<Observation<{ci:Ci;artifactId:string}>>{
    try {
      const ci=CiIdentitySchema.parse(ciInput);
      if(hash(ci)!==hash(CiIdentitySchema.parse(expected.ci))||![ci.repositoryId,ci.runId,ci.jobId].every(x=>/^\d+$/.test(x))||!sha(expected.workflowSha)||!/^\.github\/workflows\/[\w.-]+\.ya?ml$/.test(expected.workflowPath)||ci.workflowRef!==`${this.http.repository}/${expected.workflowPath}@${expected.workflowSha}`||!['workflow_dispatch','workflow_run','push'].includes(ci.eventName)||!expected.jobName||!/^([a-f0-9]{64})$/.test(expected.artifactDigest)||expected.artifactName!==`behavproof-${ci.runId}-${ci.runAttempt}-${ci.jobId}`)return unknown('Producer does not match registered expectations');
      const path=`${this.http.prefix}/actions/runs/${ci.runId}`,attempt=`${path}/attempts/${ci.runAttempt}`;
      const current=async(endpoint:string)=>{const run=object(await this.http.request(endpoint));return String(run.id)===ci.runId&&String(run.repository?.id)===ci.repositoryId&&run.repository?.full_name===this.http.repository&&run.head_sha===expected.workflowSha&&run.path===expected.workflowPath&&run.event===ci.eventName&&run.run_attempt===ci.runAttempt&&run.status==='completed'&&run.conclusion==='success';};
      if(!await current(path)||!await current(attempt))return unknown('Latest producer attempt identity or outcome mismatch');
      const jobs=await this.http.pages(`${attempt}/jobs`,'jobs'),matched=jobs.filter(j=>String(j.id)===ci.jobId&&j.name===expected.jobName);
      if(matched.length!==1||String(matched[0]!.run_id)!==ci.runId||matched[0]!.run_attempt!==ci.runAttempt||matched[0]!.status!=='completed'||matched[0]!.conclusion!=='success')return unknown('Job identity or outcome mismatch');
      const artifacts=await this.http.pages(`${path}/artifacts`,'artifacts'),found=artifacts.filter(a=>a.name===expected.artifactName);
      if(found.length!==1||found[0]!.expired!==false||found[0]!.digest!==`sha256:${expected.artifactDigest}`||String(found[0]!.workflow_run?.id)!==ci.runId||found[0]!.workflow_run?.head_sha!==expected.workflowSha)return unknown('Artifact identity or independently computed digest mismatch');
      if(!await current(path))return unknown('Producer attempt changed during verification');
      return observed({ci,artifactId:String(found[0]!.id)},[path,attempt]);
    }catch(error){return unknown(error instanceof Error?error.message:'Producer verification unavailable');}
  }
}
