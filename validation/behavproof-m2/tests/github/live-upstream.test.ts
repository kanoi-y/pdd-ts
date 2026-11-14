import {test,expect} from 'vitest';
import {GitHubAuthority} from '../../packages/adapter-github/src/authority.js';
const sha='a'.repeat(40),ci={repositoryId:'42',workflowRef:`acme/shop/.github/workflows/publisher.yml@${sha}`,runId:'8',runAttempt:2,jobId:'10',eventName:'workflow_run'};
const expected={ci,workflowPath:'.github/workflows/publisher.yml',workflowSha:sha,gateJob:'gate',requiredJobs:['verify']};
function client(change:{job?:string;duplicate?:boolean;head?:string;attempt?:number;gateJob?:string;event?:string}={}){
 const run={id:8,repository:{id:42,full_name:'acme/shop'},head_sha:change.head??sha,path:expected.workflowPath,event:change.event??'workflow_run',run_attempt:change.attempt??2,status:'in_progress',conclusion:null};
 const row={id:9,run_id:8,run_attempt:2,name:'verify',status:change.job==='in_progress'?'in_progress':'completed',conclusion:change.job??'success'};
 return new GitHubAuthority({repository:'acme/shop',fetcher:async url=>{
  const path=new URL(url).pathname;
  if(path.endsWith('/jobs'))return Response.json({jobs:[row,...(change.duplicate?[{...row,id:11}]:[]),{id:10,run_id:8,run_attempt:2,name:change.gateJob??'gate',status:'in_progress',conclusion:null}]});
  return Response.json(run);
 }});
}
test('a running final gate independently observes completed upstream jobs without requiring its own run to finish',async()=>{
 const result=await client().upstream(ci,expected);expect(result.status).toBe('pass');expect(result.value?.jobs).toEqual({verify:'success'});
});
test.each(['skipped','cancelled','failure','neutral','in_progress'])('upstream %s does not become success',async job=>{
 expect((await client({job}).upstream(ci,expected)).status).toBe('unknown');
});
test('workflow source, current attempt, gate identity and unambiguous job names are externally verified',async()=>{
 for(const change of [{head:'b'.repeat(40)},{attempt:3},{gateJob:'other'},{event:'pull_request'},{duplicate:true}])expect((await client(change).upstream(ci,expected)).status).toBe('unknown');
});
