import {spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {afterEach,expect,it} from 'vitest';
const roots:string[]=[];
afterEach(async()=>{for(const r of roots.splice(0))await rm(r,{recursive:true,force:true});});
const model={schemaVersion:1,kind:'job-queue-v1',workers:2,maxAttempts:2,claim:'atomic',recovery:true,limits:{states:1000,depth:64}};
const call=(root:string)=>spawnSync(process.execPath,[path.resolve('dist/cli/main.js'),'model-check','--project',root,'--model','model.json','--json'],{encoding:'utf8',timeout:10000,maxBuffer:1048576});
it('MODEL-001 checks a finite queue with the actual CLI and identifies its guarantee',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'pdd-model-'));roots.push(root);await writeFile(path.join(root,'model.json'),JSON.stringify(model));const r=call(root);expect(r.status,r.stdout).toBe(0);const p=JSON.parse(r.stdout);expect(p.status).toBe('passed');expect(p.exhaustive).toBe(true);expect(p.kind).toBe('model-check');expect(p.fairness).toBe('none');expect(p.guarantee).toBe('finite-model-only');expect(p.explored.states).toBeGreaterThan(5);
});
it('MODEL-001 CLI returns a shortest duplicate execution counterexample',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'pdd-model-'));roots.push(root);await writeFile(path.join(root,'model.json'),JSON.stringify({...model,claim:'split-read-write'}));const r=call(root);expect(r.status,r.stdout).toBe(1);const p=JSON.parse(r.stdout);expect(p.status).toBe('failed');expect(p.violation).toBe('simultaneous-execution');expect(p.counterexample.at(-1).state.active).toHaveLength(2);expect(p.counterexample).toHaveLength(5);
});
it('MODEL-001 CLI cannot pass an incomplete search',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'pdd-model-'));roots.push(root);await writeFile(path.join(root,'model.json'),JSON.stringify({...model,limits:{states:1,depth:64}}));const r=call(root);expect(r.status,r.stdout).toBe(1);expect(JSON.parse(r.stdout)).toMatchObject({status:'unknown',exhaustive:false});
});

import {initProject,loadProject} from '../../src/requirements/project.js';
import {createSpecSnapshot} from '../../src/requirements/snapshot.js';
import {compareSpecs} from '../../src/requirements/diff.js';
import {stringify} from 'yaml';
const runCLI=(root:string,command:string)=>spawnSync(process.execPath,[path.resolve('dist/cli/main.js'),command,'--project',root,'--json'],{encoding:'utf8',timeout:15000,maxBuffer:2097152});
async function projectFixture(){
 const root=await mkdtemp(path.join(os.tmpdir(),'pdd-model-project-'));roots.push(root);await initProject(root);await writeFile(path.join(root,'queue.ts'),'export const claim=()=>true;\n');await writeFile(path.join(root,'model.json'),JSON.stringify(model));
 await writeFile(path.join(root,'mapping.json'),JSON.stringify({schemaVersion:1,entries:[{action:'claim',file:'queue.ts',symbol:'claim',explanation:'条件付き更新で取得する'}]}));
 await writeFile(path.join(root,'.pdd/requirements/JOB.yaml'),stringify({id:'JOB',revision:1,title:'同時二重実行を防ぐ',intent:'有限モデルの性質とコードの証明を区別する',risk:'high',target:{file:'queue.ts',symbol:'claim'},contracts:[],acceptance:[],trustedBoundaries:[]}));
 await writeFile(path.join(root,'.pdd/obligations.yaml'),stringify([{id:'queue-model',requirementIds:['JOB'],kind:'model-check',scope:'queue',contractIds:[]}]));
 await writeFile(path.join(root,'.pdd/config.yaml'),stringify({schemaVersion:1,modelTargets:[{obligationId:'queue-model',file:'model.json',mapping:'mapping.json'}]}));
 for(const args of [['init','-q'],['config','user.name','Model fixture'],['config','user.email','fixture@example.invalid'],['add','.'],['commit','-qm','fixture']])expect(spawnSync('git',args,{cwd:root}).status).toBe(0);
 return root;
}
it('MODEL-001 verify produces model evidence and review stales it after mapped implementation changes',async()=>{
 const root=await projectFixture();const r=runCLI(root,'verify');expect(r.status,r.stdout).toBe(0);const p=JSON.parse(r.stdout);expect(p.gate.status).toBe('trial');expect(p.evidence[0]).toMatchObject({kind:'model-check',status:'passed',verifiedContractIds:[]});expect(p.modelChecks[0].result.guarantee).toBe('finite-model-only');expect(runCLI(root,'review').status).toBe(0);
 await writeFile(path.join(root,'queue.ts'),'export const claim=()=>false;\n');const next=runCLI(root,'review');expect(next.status,next.stdout).toBe(1);expect(JSON.parse(next.stdout).evidence[0].status).toBe('stale');
});
it('MODEL-001 model changes require a new specification revision',async()=>{
 const root=await projectFixture(),before=await createSpecSnapshot(await loadProject(root));await writeFile(path.join(root,'model.json'),JSON.stringify({...model,maxAttempts:3}));const after=await createSpecSnapshot(await loadProject(root));expect(after.digest).not.toBe(before.digest);expect(compareSpecs(before,after).valid).toBe(false);
});
it('MODEL-001 failed and unknown model results block the required gate',async()=>{
 const root=await projectFixture();for(const input of [{...model,claim:'split-read-write'},{...model,limits:{states:1,depth:64}}]){await writeFile(path.join(root,'model.json'),JSON.stringify(input));const r=runCLI(root,'verify');expect(r.status,r.stdout).toBe(1);expect(JSON.parse(r.stdout).gate.status).toBe('blocked');expect(['failed','unknown']).toContain(JSON.parse(r.stdout).evidence[0].status);}
});
import {checkQueueModel,matchQueueTrace} from '../../src/model/queue.js';
import {renderMarkdown} from '../../src/reporter/markdown.js';
it('MODEL-001 finds a crashed-worker deadlock and does not call failed terminal states deadlocks',()=>{
 expect(checkQueueModel({...model,recovery:false})).toMatchObject({status:'failed',violation:'deadlock'});
 expect(checkQueueModel({...model,maxAttempts:1})).toMatchObject({status:'passed',exhaustive:true});
});
it('MODEL-001 rejects depth truncation and accepts only complete observed transitions',()=>{
 expect(checkQueueModel({...model,limits:{states:1000,depth:1}})).toMatchObject({status:'unknown',reason:'depth-limit'});
 const trace=[{action:'initial',worker:null,state:{phase:'pending',attempts:0,active:[],readers:[]}},{action:'claim',worker:0,state:{phase:'running',attempts:1,active:[0],readers:[]}},{action:'complete',worker:0,state:{phase:'completed',attempts:1,active:[],readers:[]}}];
 expect(matchQueueTrace(model,trace)).toMatchObject({status:'matched',guarantee:'observed-trace-only'});
 expect(matchQueueTrace(model,[trace[0],{...trace[1],worker:1}])).toMatchObject({status:'mismatch',index:1});
 expect(()=>matchQueueTrace(model,[])).toThrow();
});
it('MODEL-001 rejects executable unknown and invalid model inputs instead of extending semantics',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'pdd-model-'));roots.push(root);
 for(const raw of [{...model,workers:100},{...model,fairness:'weak'},{...model,script:'process.exit(0)'},{...model,limits:{states:10001,depth:64}}]){await writeFile(path.join(root,'model.json'),JSON.stringify(raw));expect(call(root).status).toBe(2);}
});
it('MODEL-001 review shows a concrete counterexample and high-risk Atlas review tasks',async()=>{
 const root=await projectFixture();await writeFile(path.join(root,'model.json'),JSON.stringify({...model,claim:'split-read-write'}));const p=JSON.parse(runCLI(root,'verify').stdout);const md=renderMarkdown(p);expect(md).toContain('有限状態モデル');expect(md).toContain('同時二重実行');expect(md).toContain('```mermaid');expect(md).toContain('高リスク');expect(md).toContain('--previous');expect(md).toContain('コード全体の証明ではありません');
});
import {symlink,mkdir} from 'node:fs/promises';
it('MODEL-001 rejects linked non-UTF8 oversized and escaping model inputs',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'pdd-model-'));roots.push(root);const outside=await mkdtemp(path.join(os.tmpdir(),'pdd-model-out-'));roots.push(outside);await writeFile(path.join(outside,'valid.json'),JSON.stringify(model));await symlink(path.join(outside,'valid.json'),path.join(root,'model.json'));expect(call(root).status).toBe(2);await rm(path.join(root,'model.json'));await writeFile(path.join(root,'model.json'),Buffer.from([0xff]));expect(call(root).status).toBe(2);await writeFile(path.join(root,'model.json'),' '.repeat(65537));expect(call(root).status).toBe(2);
});
it('MODEL-001 report cannot keep a successful gate after model artifacts change',async()=>{
 const root=await projectFixture();const p=JSON.parse(runCLI(root,'verify').stdout);const artifact=p.evidence[0].artifactPaths.find((p:string)=>p.endsWith('/model-result.json'));await writeFile(path.join(root,artifact),'{}');const r=runCLI(root,'review');expect(r.status,r.stdout).toBe(1);expect(JSON.parse(r.stdout).evidence[0].status).toBe('stale');
});
it('MODEL-001 unresolved high-risk decisions stop model verification',async()=>{
 const root=await projectFixture();await writeFile(path.join(root,'.pdd/decisions.yaml'),stringify({schemaVersion:1,decisions:[{id:'D1',group:'job',kind:'human-specification',requirementIds:['JOB'],state:'open',question:'再試行上限を決める',recommendation:'2回',alternatives:[{label:'2回',tradeoff:'短期停止'},{label:'3回',tradeoff:'待ち時間増加'}],impact:'復旧',blocking:false,evidence:[{file:'queue.ts',line:1}]}]}));const r=runCLI(root,'verify');expect(r.status,r.stdout).toBe(1);expect(JSON.parse(r.stdout).evidence).toEqual([]);
});
it('MODEL-001 unregistered malformed and escaping mappings fail closed',async()=>{
 const root=await projectFixture();for(const entry of [{action:'claim',file:'../out.ts',symbol:'claim',explanation:'bad'},{action:'initial',file:'queue.ts',symbol:'claim',explanation:'bad'},{action:'claim',file:'queue.ts',symbol:'claim',explanation:'bad',approved:true}]){await writeFile(path.join(root,'mapping.json'),JSON.stringify({schemaVersion:1,entries:[entry]}));const r=runCLI(root,'verify');expect(r.status,r.stdout).not.toBe(0);expect(JSON.parse(r.stdout).gate.status).toBe('blocked');}
});
it('MODEL-001 actual CLI compares an implementation trace without claiming source proof',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'pdd-model-'));roots.push(root);await writeFile(path.join(root,'model.json'),JSON.stringify(model));await writeFile(path.join(root,'trace.json'),JSON.stringify([{action:'initial',worker:null,state:{phase:'pending',attempts:0,active:[],readers:[]}},{action:'claim',worker:0,state:{phase:'running',attempts:1,active:[0],readers:[]}}]));const args=[path.resolve('dist/cli/main.js'),'model-check','--project',root,'--model','model.json','--trace','trace.json','--json'];const r=spawnSync(process.execPath,args,{encoding:'utf8'});expect(r.status,r.stdout).toBe(0);expect(JSON.parse(r.stdout).traceComparison).toMatchObject({status:'matched',guarantee:'observed-trace-only'});
});
import {renderHumanReviewCard} from '../../src/ci/review.js';
it('WF-001 high-risk human review cards explain model scope and show pinned code changes',async()=>{
 const root=await projectFixture(),head=await createSpecSnapshot(await loadProject(root));const card=renderHumanReviewCard({repository:'example/queue',baseSha:'a'.repeat(40),headSha:'b'.repeat(40),baseline:head,head});expect(card).toContain('高リスク変更の確認');expect(card).toContain('有限状態モデル');expect(card).toContain('主要Diff');expect(card).toContain('/compare/');expect(card).toContain('mapping.json');
});
it('MODEL-001 doctor diagnoses the registered model backend without requiring Dafny',async()=>{
 const root=await projectFixture();const r=runCLI(root,'doctor');expect(r.status,r.stdout).toBe(0);const p=JSON.parse(r.stdout);expect(p.checks.find((c:{name:string})=>c.name==='toolchain').status).toBe('ready');expect(p.protectedReady).toBe(false);
});
import {verifyModel} from '../../src/model/adapter.js';
it('MODEL-001 artifact write failure never leaves successful model evidence',async()=>{
 const root=await projectFixture();await mkdir(path.join(root,'.pdd/evidence/collision/queue-model'),{recursive:true});await writeFile(path.join(root,'.pdd/evidence/collision/queue-model/model-result.json'),'KEEP');const r=await verifyModel(await loadProject(root),'queue-model',{id:'collision',commit:'a'.repeat(40),specDigest:'b'.repeat(64)},'c'.repeat(64));expect(r.record.status).toBe('error');
});
it('MODEL-001 review requires the actual model result artifact',async()=>{
 const root=await projectFixture();const p=JSON.parse(runCLI(root,'verify').stdout),file=path.join(root,`.pdd/evidence/${p.runId}/manifest.json`),m=JSON.parse(await readFile(file,'utf8')),e=m.evidence[0];const result=e.artifactPaths.find((p:string)=>p.endsWith('/model-result.json'));e.artifactPaths=e.artifactPaths.filter((p:string)=>p!==result);delete e.artifactDigests[result];await writeFile(file,JSON.stringify(m));const r=runCLI(root,'review');expect(r.status,r.stdout).toBe(1);expect(JSON.parse(r.stdout).evidence[0].status).toBe('stale');
});
