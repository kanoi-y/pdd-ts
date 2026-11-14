import {test,expect} from 'vitest';
import {evaluateGate,hash} from '../../packages/core/src/index.js';
import {prepareCheckPublication,GitHubCheckPublisher} from '../../packages/adapter-github/src/publisher.js';
const head='a'.repeat(40),base='b'.repeat(40),policyHash='c'.repeat(64),registrationDigest='d'.repeat(64);
const subject={testedCommitSha:head,prHeadSha:head,baseSha:base,sourceTreeHash:'e'.repeat(64),dirty:false};
const ci={repositoryId:'42',workflowRef:`acme/shop/.github/workflows/producer.yml@${base}`,runId:'8',runAttempt:2,jobId:'9',eventName:'workflow_dispatch'};
const required=[{ruleId:'testResult',severity:'error' as const,scope:[]},{ruleId:'contractExecution',severity:'error' as const,scope:['contract','ORDER']}];
const report=()=>evaluateGate(required.map(row=>({...row,status:'pass' as const,evidenceIds:[],message:'candidate-controlled-diagnostic'})),'gate');
const packet=()=>({schemaVersion:1,repositoryId:'42',subject,effectivePolicyHash:policyHash,registrationDigest,ci,report:report(),upstream:{jobs:{collect:'success',verify:'success'},artifacts:['manifest.json','gate.json']}});
const expected=()=>({repository:'acme/shop',repositoryId:'42',pr:3,headSha:head,baseSha:base,protectedBranch:'main',checkName:'BehavProof protected gate',appId:77,subject,effectivePolicyHash:policyHash,registrationDigest,ci,requiredEvaluations:required,requiredJobs:['collect','verify'],requiredArtifacts:['manifest.json','gate.json']});
const allow=()=>true;
test('prepared publication re-evaluates an authenticated complete current gate',()=>{
 const decision=prepareCheckPublication(packet(),expected(),allow);expect(decision.conclusion).toBe('success');expect(decision.headSha).toBe(head);
});
test.each(['failure','skipped','cancelled','timed_out','neutral','unknown'])('upstream %s cannot publish success',status=>{
 const value=packet();value.upstream.jobs.collect=status;expect(prepareCheckPublication(value,expected(),allow).conclusion).toBe('failure');
});
test('missing artifacts, unknown mandatory rows and dropped scoped obligations block publication',()=>{
 const missing=packet();missing.upstream.artifacts.pop();expect(prepareCheckPublication(missing,expected(),allow).conclusion).toBe('failure');
 const unknown=packet();unknown.report.evaluations[1]!.status='unknown';expect(prepareCheckPublication(unknown,expected(),allow).conclusion).toBe('failure');
 const dropped=packet();dropped.report=evaluateGate(dropped.report.evaluations.slice(0,1),'gate');expect(prepareCheckPublication(dropped,expected(),allow).conclusion).toBe('failure');
});
test('serialized success, audit exits and unauthenticated reports confer no authority',()=>{
 const forged=packet();forged.report.evaluations[0]!.status='fail';expect(prepareCheckPublication(forged,expected(),allow).conclusion).toBe('failure');
 const audit=packet();audit.report=evaluateGate(audit.report.evaluations,'audit');expect(prepareCheckPublication(audit,expected(),allow).conclusion).toBe('failure');
 expect(prepareCheckPublication(packet(),expected(),()=>false).conclusion).toBe('failure');expect(prepareCheckPublication(packet(),expected(),()=>Promise.resolve(true)).conclusion).toBe('failure');
});
test.each(['subject','ci','policy','registration','repository'])('%s substitutions cannot publish success',field=>{
 const value=structuredClone(packet());if(field==='subject')value.subject.sourceTreeHash='0'.repeat(64);if(field==='ci')value.ci.runAttempt=1;if(field==='policy')value.effectivePolicyHash='0'.repeat(64);if(field==='registration')value.registrationDigest='0'.repeat(64);if(field==='repository')value.repositoryId='13';
 expect(prepareCheckPublication(value,expected(),allow).conclusion).toBe('failure');
});
test('authority checks cannot mutate the packet or its host expectations',()=>{
 const original=packet(),host=expected(),decision=prepareCheckPublication(original,host,(copy:any)=>{try{copy.report.evaluations[0].status='fail';}catch{}return true;});
 original.report.evaluations[0]!.status='fail';host.checkName='another';expect(decision.conclusion).toBe('success');expect(decision.checkName).toBe('BehavProof protected gate');
});
function connection(changes:{head?:string;app?:number;protectedApp?:number;postHead?:string;protectHttp?:number}={}){
 const posts:any[]=[],requests:string[]=[];
 const fetcher=async(url:string|URL,options?:RequestInit)=>{
  const path=new URL(url).pathname;requests.push(`${options?.method} ${path}`);
  if(path==='/repos/acme/shop')return Response.json({id:42,full_name:'acme/shop'});
  if(path==='/repos/acme/shop/pulls/3')return Response.json({number:3,state:'open',head:{sha:changes.head??head},base:{sha:base,ref:'main',repo:{id:42,full_name:'acme/shop'}}});
  if(path==='/repos/acme/shop/branches/main/protection')return Response.json({enforce_admins:{enabled:true},required_status_checks:{strict:true,checks:[{context:'BehavProof protected gate',app_id:changes.protectedApp??77}]}},{status:changes.protectHttp??200});
  if(path==='/repos/acme/shop/check-runs'&&options?.method==='POST'){const body=JSON.parse(String(options.body));posts.push(body);return Response.json({id:44,name:body.name,head_sha:changes.postHead??body.head_sha,status:'completed',conclusion:body.conclusion,app:{id:changes.app??77},html_url:'https://github.com/acme/shop/runs/44'});}
  return Response.json({},{status:404});
 };
 return {publisher:new GitHubCheckPublisher({repository:'acme/shop',token:'secret-fixture',fetcher}),posts,requests};
}
test('publisher sends only fixed text after live repository/head/base/protection checks',async()=>{
 const {publisher,posts}=connection();const result=await publisher.publish(prepareCheckPublication(packet(),expected(),allow));expect(result.conclusion).toBe('success');expect(posts).toHaveLength(1);expect(posts[0]).toMatchObject({name:'BehavProof protected gate',head_sha:head,status:'completed',conclusion:'success'});expect(JSON.stringify(posts)).not.toContain('candidate-controlled-diagnostic');
});
test('a failed packet publishes a failure rather than neutral or skipped',async()=>{
 const {publisher,posts}=connection();await publisher.publish(prepareCheckPublication(packet(),expected(),()=>false));expect(posts[0].conclusion).toBe('failure');
});
test('wrong protection issuer or unavailable protection cannot publish success',async()=>{
 for(const change of [{protectedApp:88},{protectHttp:403}]){const {publisher,posts}=connection(change);await publisher.publish(prepareCheckPublication(packet(),expected(),allow));expect(posts[0].conclusion).toBe('failure');}
});
test('a changed current head blocks publication and copied decisions are not authority',async()=>{
 const {publisher,posts}=connection({head:'f'.repeat(40)}),decision=prepareCheckPublication(packet(),expected(),allow);await expect(publisher.publish(decision)).rejects.toThrow(/current|identity/i);expect(posts).toHaveLength(0);
 await expect(connection().publisher.publish(JSON.parse(JSON.stringify(decision)))).rejects.toThrow(/prepared|verified/i);
});
test('publisher validates returned issuer and exact check identity',async()=>{
 for(const change of [{app:88},{postHead:'f'.repeat(40)}])await expect(connection(change).publisher.publish(prepareCheckPublication(packet(),expected(),allow))).rejects.toThrow(/issuer|identity/i);
});
