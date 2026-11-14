import {test,expect} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {GitHubAuthority} from '../../packages/adapter-github/src/index.js';import {hashBytes} from '../../packages/core/src/index.js';
import {TrustRootSchema} from '../../packages/cli/src/trust.js';import {pipelineEvaluation} from '../../packages/cli/src/pipeline.js';
const sha='a'.repeat(40),ci={repositoryId:'42',workflowRef:`acme/shop/.github/workflows/publisher.yml@${sha}`,runId:'8',runAttempt:2,jobId:'10',eventName:'workflow_run'};
const workflow=`on: [workflow_run]\npermissions: {contents: read}\njobs:\n  verify:\n    runs-on: ubuntu-latest\n  gate:\n    runs-on: ubuntu-latest\n    if: always()\n    needs: [verify]\n    steps:\n      - run: behavproof check --mode gate --trust-root /opt/behavproof/root.json\n`;
async function fixture(run:(root:string,trust:any,auth:any,provider:GitHubAuthority)=>Promise<void>,status='success'){
 const root=await mkdtemp(join(tmpdir(),'behavproof-live-pipeline-'));
 try{
  await writeFile(join(root,'workflow.yml'),workflow);
  const trust=TrustRootSchema.parse({schemaVersion:1,policy:{schemaVersion:1,profileVersion:'1',rules:{pipelineIntegrity:{severity:'error'}}},config:{schemaVersion:1},baseline:{schemaVersion:1,commitSha:sha,contracts:[],intents:[]},inputs:['source.ts'],configPaths:[],manifests:[],github:{repository:'acme/shop',pr:3,reviewers:['alice'],requiredChecks:[{context:'BehavProof protected gate',appId:77}]},pipeline:{workflow:'workflow.yml',gateJob:'gate',requiredJobs:['verify'],artifacts:['report.json'],protectedBranch:'main',currentRun:{ci,workflowPath:'.github/workflows/publisher.yml',workflowSha:sha,workflowHash:hashBytes(Buffer.from(workflow))}}});
  const provider=new GitHubAuthority({repository:'acme/shop',fetcher:async url=>{
   const path=new URL(url).pathname;
   if(path.endsWith('/protection'))return Response.json({enforce_admins:{enabled:true},required_status_checks:{strict:true,checks:[{context:'BehavProof protected gate',app_id:77}]}});
   if(path.endsWith('/jobs'))return Response.json({jobs:[{id:9,run_id:8,run_attempt:2,name:'verify',status:'completed',conclusion:status},{id:10,run_id:8,run_attempt:2,name:'gate',status:'in_progress',conclusion:null}]});
   return Response.json({id:8,repository:{id:42,full_name:'acme/shop'},head_sha:sha,path:'.github/workflows/publisher.yml',event:'workflow_run',run_attempt:2,status:'in_progress',conclusion:null});
  }});
  await run(root,trust,{trustedCi:true,verified:new Set(['report.json']),artifactBytes:new Map([['report.json',Buffer.from('{}')]])},provider);
 }finally{await rm(root,{recursive:true,force:true});}
}
test('current upstream API outcomes join authenticated producer artifacts and protected workflow bytes',()=>fixture(async(root,trust,auth,provider)=>{
 expect((await pipelineEvaluation(root,trust,auth,provider)).status).toBe('pass');
}));
test('a skipped upstream blocks even when all required artifacts exist',()=>fixture(async(root,trust,auth,provider)=>{
 expect((await pipelineEvaluation(root,trust,auth,provider)).status).toBe('unknown');
},'skipped'));
test('a candidate workflow replacement cannot borrow the live protected workflow identity',()=>fixture(async(root,trust,auth,provider)=>{
 await writeFile(join(root,'workflow.yml'),workflow+'# altered candidate bytes\n');expect((await pipelineEvaluation(root,trust,auth,provider)).status).toBe('unknown');
}));
test('missing artifacts and non-CI authority cannot satisfy protected pipeline integrity',()=>fixture(async(root,trust,auth,provider)=>{
 expect((await pipelineEvaluation(root,trust,{...auth,verified:new Set()},provider)).status).toBe('unknown');expect((await pipelineEvaluation(root,trust,{...auth,trustedCi:false},provider)).status).toBe('unknown');
}));
