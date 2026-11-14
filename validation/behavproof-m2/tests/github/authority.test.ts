import { describe, test, expect } from 'vitest';
import { GitHubAuthority, evaluateUpstream, diagnoseWorkflow } from '../../packages/adapter-github/src/index.js';
const sha='a'.repeat(40), sourceSha='b'.repeat(40), digest='c'.repeat(64);
const target={kind:'intent',id:'ORDER-001:intent',contentHash:'d'.repeat(64)};
const pull={number:3,state:'open',user:{login:'bob',type:'User'},head:{sha},base:{sha:sourceSha,ref:'main',repo:{id:42,full_name:'acme/shop'}}};
const protection={required_pull_request_reviews:{required_approving_review_count:1,dismiss_stale_reviews:true,require_code_owner_reviews:false},required_status_checks:{strict:true,checks:[{context:'BehavProof protected gate',app_id:77}]}};
const review=(overrides={})=>({id:1,user:{login:'alice',type:'User'},state:'APPROVED',commit_id:sha,submitted_at:'2026-11-13T10:00:00Z',...overrides});
type Route=unknown|{http:number}|((url:URL)=>unknown);
function transport(routes:Record<string,Route>, seen:string[]=[]) {
  return async (url:string|URL,options?:RequestInit)=>{
    const u=new URL(url);seen.push(`${options?.method??'GET'} ${u.pathname}${u.search}`);
    let value=routes[u.pathname]; if(typeof value==='function')value=value(u);
    if(value===undefined)return new Response('{}',{status:404});
    if(value&&typeof value==='object'&&'http' in value)return new Response('{}',{status:Number(value.http)});
    return new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
  };
}
function client(extra:Record<string,Route>={},seen:string[]=[]){return new GitHubAuthority({repository:'acme/shop',token:'test-secret-not-real',fetcher:transport({
  '/repos/acme/shop/pulls/3':pull,
  '/repos/acme/shop/pulls/3/reviews':[review()],
  '/repos/acme/shop/branches/main/protection':protection,
  '/repos/acme/shop/collaborators/alice/permission':{permission:'write',role_name:'write'},
  ...extra,
},seen)});}
const approvalOptions={headSha:sha,baseSha:sourceSha,reviewers:['alice'],requiredChecks:[{context:'BehavProof protected gate',appId:77}]};
describe('external review authority',()=>{
  test('binds a current non-self review and independently selected target to protected head',async()=>{
    const result=await client().approval(3,target,approvalOptions);
    expect(result.status).toBe('pass');expect(result.approval.target).toEqual(target);expect(result.approval.subjectCommitSha).toBe(sha);expect(result.approval.approvedBy).toEqual(['alice']);
  });
  test.each([
    ['stale',review({commit_id:'f'.repeat(40)})],['dismissed',review({state:'DISMISSED'})],['changes requested',review({state:'CHANGES_REQUESTED'})],['self',review({user:{login:'bob',type:'User'}})],['bot',review({user:{login:'alice',type:'Bot'}})],['unauthorized',review({user:{login:'mallory',type:'User'}})],
  ])('does not approve %s review',async(_name,r)=>expect((await client({'/repos/acme/shop/pulls/3/reviews':[r]}).approval(3,target,approvalOptions)).status).not.toBe('pass'));
  test.each([401,403,404,500])('permissions/HTTP%s remain unknown without token leakage',async http=>{
    const result=await client({'/repos/acme/shop/branches/main/protection':{http}}).approval(3,target,approvalOptions);
    expect(result.status).toBe('unknown');expect(JSON.stringify(result)).not.toContain('test-secret-not-real');
  });
  test('follows review pages and ignores later comments without dismissing a valid approval',async()=>{
    const seen:string[]=[];
    const result=await client({'/repos/acme/shop/pulls/3/reviews':u=>u.searchParams.get('page')==='1'?Array.from({length:100},(_,i)=>review({id:i+2,user:{login:`other${i}`,type:'User'},state:'COMMENTED'})):[review(),review({id:200,state:'COMMENTED',submitted_at:'2026-11-13T11:00:00Z'})]},seen).approval(3,target,approvalOptions);
    expect(result.status).toBe('pass');expect(seen.some(x=>x.includes('page=2'))).toBe(true);
  });
  test('rechecks head after collecting authority',async()=>{
    let reads=0;
    const result=await client({'/repos/acme/shop/pulls/3':()=>++reads===1?pull:{...pull,head:{sha:'e'.repeat(40)}}}).approval(3,target,approvalOptions);
    expect(result.status).toBe('unknown');
  });
  test('same-name check from another issuer does not prove protection',async()=>{
    const result=await client({'/repos/acme/shop/branches/main/protection':{...protection,required_status_checks:{checks:[{context:'BehavProof protected gate',app_id:88}]}}}).approval(3,target,approvalOptions);
    expect(result.status).toBe('unknown');
  });
  test('a review by a read-only collaborator cannot satisfy a protected review',async()=>expect((await client({'/repos/acme/shop/collaborators/alice/permission':{permission:'read'}}).approval(3,target,approvalOptions)).status).not.toBe('pass'));
  test('CODEOWNERS enforcement requires authoritative current review decision',async()=>{
    const p={...protection,required_pull_request_reviews:{...protection.required_pull_request_reviews,require_code_owner_reviews:true}};
    expect((await client({'/repos/acme/shop/branches/main/protection':p,'/graphql':{data:{repository:{pullRequest:{headRefOid:sha,baseRefOid:sourceSha,reviewDecision:'APPROVED'}}}}}).approval(3,target,approvalOptions)).status).toBe('pass');
    expect((await client({'/repos/acme/shop/branches/main/protection':p}).approval(3,target,approvalOptions)).status).toBe('unknown');
  });
  test('bounds network failures and invalid authority expectations',async()=>{
    const c=new GitHubAuthority({repository:'acme/shop',fetcher:async()=>{throw new Error('failure with test-secret-not-real')}});
    expect((await c.approval(3,target,approvalOptions)).status).toBe('unknown');
    expect((await client().approval(3,target,{...approvalOptions,reviewers:[]})).status).not.toBe('pass');
    expect(()=>new GitHubAuthority({repository:'../elsewhere'})).toThrow();
  });
});
describe('CI producer provenance',()=>{
  const ci={repositoryId:'42',workflowRef:`acme/shop/.github/workflows/trusted.yml@${sourceSha}`,runId:'8',runAttempt:2,jobId:'9',eventName:'workflow_dispatch'};
  const expected={ci,workflowPath:'.github/workflows/trusted.yml',workflowSha:sourceSha,jobName:'Produce evidence',artifactName:'behavproof-8-2-9',artifactDigest:digest};
  const routes={
    '/repos/acme/shop/actions/runs/8/attempts/2':{id:8,repository:{id:42,full_name:'acme/shop'},head_sha:sourceSha,path:'.github/workflows/trusted.yml',event:'workflow_dispatch',run_attempt:2,status:'completed',conclusion:'success'},
    '/repos/acme/shop/actions/runs/8/attempts/2/jobs':{jobs:[{id:9,run_id:8,run_attempt:2,name:'Produce evidence',status:'completed',conclusion:'success'}]},
    '/repos/acme/shop/actions/runs/8/artifacts':{artifacts:[{id:10,name:'behavproof-8-2-9',expired:false,digest:`sha256:${digest}`,workflow_run:{id:8,head_sha:sourceSha}}]},
  };
  const currentRun='/repos/acme/shop/actions/runs/8';
  routes[currentRun]=routes[currentRun+'/attempts/2'];
  test('a successful old attempt cannot authorize a newer rerun',async()=>expect((await client({...routes,[currentRun]:{...routes[currentRun],run_attempt:3,status:'in_progress',conclusion:null}}).producer(ci,expected)).status).toBe('unknown'));
  test('checks independently pinned workflow, job, run/attempt and downloaded artifact digest',async()=>expect((await client(routes).producer(ci,expected)).status).toBe('pass'));
  test.each([
    {workflowSha:'e'.repeat(40)},{artifactDigest:'f'.repeat(64)},{jobName:'Other'},{ci:{...ci,runAttempt:1}},{ci:{...ci,workflowRef:'self-declared'}},
  ])('does not accept mismatched producer %j',async change=>expect((await client(routes).producer(ci,{...expected,...change})).status).not.toBe('pass'));
});
describe('final gate and workflow definitions',()=>{
  const requirement={requiredJobs:['tests','mutation'],artifacts:['manifest.json','vitest.json']};
  test('requires all upstream results and artifacts',()=>expect(evaluateUpstream({tests:'success',mutation:'success'},['manifest.json','vitest.json'],requirement).status).toBe('pass'));
  test.each(['skipped','cancelled','failure','unknown'])('blocks upstream %s',state=>expect(evaluateUpstream({tests:'success',mutation:state},['manifest.json','vitest.json'],requirement).status).not.toBe('pass'));
  test('missing output and zero obligations cannot pass',()=>{
    expect(evaluateUpstream({tests:'success',mutation:'success'},[],requirement).status).toBe('unknown');
    expect(evaluateUpstream({},[],{requiredJobs:[],artifacts:[]}).status).not.toBe('pass');
  });
  const workflow=`name: Evidence\non: [pull_request]\npermissions: {contents: read}\njobs:\n  tests:\n    runs-on: ubuntu-latest\n    steps: [{run: npm test}]\n  gate:\n    needs: [tests]\n    if: always()\n    runs-on: ubuntu-latest\n    steps: [{run: behavproof check --mode gate}]\n`;
  test('safe internal final gate remains unknown until external definition protection is established',()=>{
    const result=diagnoseWorkflow(workflow,{gateJob:'gate',requiredJobs:['tests']});
    expect(result.internal.status).toBe('pass');expect(result.protection.status).toBe('unknown');
  });
  test.each([workflow.replace('if: always()','if: false'),workflow.replace('needs: [tests]','needs: []'),workflow.replace('--mode gate','--mode audit')])('detects weakened gate definition',source=>expect(diagnoseWorkflow(source,{gateJob:'gate',requiredJobs:['tests']}).internal.status).not.toBe('pass'));
  test('privileged PR execution, unsupported events and duplicate YAML keys are not healthy',()=>{
    expect(diagnoseWorkflow(workflow.replace('pull_request','pull_request_target'),{gateJob:'gate',requiredJobs:['tests']}).internal.status).not.toBe('pass');
    expect(diagnoseWorkflow(workflow.replace('pull_request','merge_group'),{gateJob:'gate',requiredJobs:['tests']}).internal.status).not.toBe('pass');
    expect(diagnoseWorkflow(workflow+'jobs: {}\n',{gateJob:'gate',requiredJobs:['tests']}).internal.status).not.toBe('pass');
  });
});
test('external required check protection requires an issuer and enforced admin policy',async()=>{
 const strict={...protection,enforce_admins:{enabled:true}};
 const c=client({'/repos/acme/shop/branches/main/protection':strict});
 expect((await c.protection('main',approvalOptions.requiredChecks)).status).toBe('pass');
 expect((await client().protection('main',approvalOptions.requiredChecks)).status).toBe('unknown');
 expect((await c.protection('main',[{context:'BehavProof protected gate',appId:88}])).status).toBe('unknown');
});
describe('effective final-gate arguments',()=>{
 const definition=(command:string)=>`on: [pull_request]\npermissions: {contents: read}\njobs:\n  tests:\n    runs-on: ubuntu-latest\n    steps: [{run: npm test}]\n  gate:\n    needs: [tests]\n    if: always()\n    runs-on: ubuntu-latest\n    steps: [{run: '${command}'}]\n`;
 test.each([
  'behavproof check --mode gate --mode audit',
  'behavproof check --mode gate --mode=audit',
  'behavproof check --mode audit --mode gate',
  'behavproof check --mode gate --help',
  'behavproof check --help --mode gate',
  'behavproof check --mode gate --version',
  'behavproof check --mode gate -- --help',
 ])('does not certify a bypass or ambiguous command: %s',command=>{
  expect(diagnoseWorkflow(definition(command),{gateJob:'gate',requiredJobs:['tests']}).internal.status).toBe('unknown');
 });
 test('recognizes one explicit effective gate mode in equals syntax',()=>{
  expect(diagnoseWorkflow(definition('behavproof check --mode=gate --format json'),{gateJob:'gate',requiredJobs:['tests']}).internal.status).toBe('pass');
 });
});
