import {safeRead,hashBytes,type EvidenceStatus} from '@behavproof/core';
import {GitHubAuthority,diagnoseWorkflow,evaluateUpstream} from '@behavproof/adapter-github';
import type {TrustRoot} from './trust.js';
type Auth={trustedCi:boolean;verified:ReadonlySet<string>;artifactBytes:ReadonlyMap<string,Uint8Array>};
const worst=(states:readonly string[]):EvidenceStatus=>states.includes('fail')?'fail':states.length>0&&states.every(status=>status==='pass')?'pass':'unknown';
/** Artifacts come from authenticate's retained snapshots, never candidate rereads. */
export async function pipelineEvaluation(root:string,trust:TrustRoot,auth:Auth,provider?:GitHubAuthority) {
  const p=trust.pipeline;
  if(!p)return {status:'unknown' as EvidenceStatus,jobs:{},artifacts:[] as string[]};
  const bytes=await safeRead(root,p.workflow),source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  const sourceStatus=!p.currentRun||hashBytes(bytes)===p.currentRun.workflowHash?'pass':'unknown';
  const diagnosis=diagnoseWorkflow(source,p);
  const available=[...auth.verified].sort();
  let jobs:Record<string,string>={},upstreamStatus:EvidenceStatus='unknown',protectionStatus='unknown';
  const github=trust.github;
  const authority=provider??(github?new GitHubAuthority({repository:github.repository,...(process.env.GITHUB_TOKEN?{token:process.env.GITHUB_TOKEN}:{})}):undefined);
  if(p.currentRun){
    if(auth.trustedCi&&authority&&sourceStatus==='pass'){
      const r=p.currentRun,result=await authority.upstream(r.ci,{ci:r.ci,workflowPath:r.workflowPath,workflowSha:r.workflowSha,gateJob:p.gateJob,requiredJobs:p.requiredJobs});
      if(result.status==='pass'&&result.value){jobs=result.value.jobs;upstreamStatus=evaluateUpstream(jobs,available,p).status;}
    }
  }else{
    const reports=trust.manifests.flatMap(spec=>spec.expected.artifacts).filter(artifact=>artifact.kind==='pipeline'&&auth.verified.has(artifact.ref));
    if(reports.length===1){
      const captured=auth.artifactBytes.get(reports[0]!.ref);
      if(!captured)throw Error('Authenticated pipeline snapshot unavailable');
      const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(captured));
      if(!raw||!raw.jobs||!Array.isArray(raw.artifacts))throw Error('Invalid pipeline report');
      jobs=raw.jobs;upstreamStatus=evaluateUpstream(jobs,raw.artifacts,p).status;
    }
  }
  if(auth.trustedCi&&github&&authority)protectionStatus=(await authority.protection(p.protectedBranch,github.requiredChecks)).status;
  return {status:worst([sourceStatus,diagnosis.internal.status,upstreamStatus,protectionStatus]),jobs,artifacts:available};
}
