// Actual public Collector -> selected worker -> built CLI flow, under an explicit
// local host. This is not external CI, human approval or branch-protection proof.
import {randomUUID} from 'node:crypto';
import {validateStagedSdk} from './staged-sdk.mjs';
import {parseArgs} from 'node:util';
import {mkdtemp,mkdir,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import {tmpdir} from 'node:os';import {execFileSync,spawnSync} from 'node:child_process';
import {hash,hashBytes,safeRead,getProfilePolicy,parseConfig,mergeProtectedPolicy} from '@behavproof/core';
import {collect,gitSubject} from '@behavproof/adapter-reports';import {discover,snapshot,PROBE_METHOD} from '@behavproof/contract-registry';
const {values}=parseArgs({strict:true,allowPositionals:false,options:{'sandbox-sdk':{type:'string'}}});
let sandboxSdk=values['sandbox-sdk']?resolve(values['sandbox-sdk']):undefined;
const sandboxGuard=sandboxSdk?`import {writeFileSync} from 'node:fs';import {networkInterfaces} from 'node:os';
if(Object.values(networkInterfaces()).flat().some(info=>!info.internal))throw Error('Worker network is not isolated');
let sourceReadOnly=false;try{writeFileSync(new URL('../src/__sandbox_probe__.txt',import.meta.url),'probe',{flag:'wx'});}catch(error){if(['EROFS','EACCES','EPERM'].includes(error.code))sourceReadOnly=true;else throw error;}if(!sourceReadOnly)throw Error('Worker source is writable');
`:'';
const project=fileURLToPath(new URL('..',import.meta.url));
if(sandboxSdk){
 const validated=await validateStagedSdk(sandboxSdk,{referenceRoot:project});sandboxSdk=validated.path;
 if(validated.inventory.built&&validated.inventory.platform!=='linux')throw Error('Built container SDK must use Linux dependencies');
}
const scratch=await mkdtemp(join(tmpdir(),'behavproof-protected-flow-')),root=join(scratch,'candidate'),host=join(scratch,'host');
await mkdir(root);await mkdir(host,{mode:0o700});await mkdir(join(root,'src'));await mkdir(join(root,'tests'));await mkdir(join(root,'.behavproof/collected'),{recursive:true});
const git=(...args)=>execFileSync('git',['-c','user.name=BehavProof fixture','-c','user.email=fixture@example.invalid',...args],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const assert=(condition,message)=>{if(!condition)throw Error(message);};
const image='node:24.14.1-bookworm@sha256:80fc934952c8f1b2b4d39907af7211f8a9fff1a4c2cf673fb49099292c251cec';

try{
 await symlink(join(project,'node_modules'),join(root,'node_modules'),process.platform==='win32'?'junction':'dir');
 const source=await readFile(join(project,'examples/node-api/src/orders.ts'),'utf8'),tests=await readFile(join(project,'examples/node-api/tests/orders.test.ts'),'utf8'),cfg={schemaVersion:1,profile:'critical',git:{base:'HEAD'},reports:{},contracts:{enabled:true,sources:[{type:'vitest-inline',include:['tests/**/*.ts']}]}};
 const inputs=['.gitignore','package.json','behavproof.config.json','src/orders.ts','tests/orders.test.ts'];
 const files={'.gitignore':'node_modules/\n.behavproof/\n','package.json':'{"name":"protected-probe-reference","type":"module","scripts":{"test":"vitest run"},"devDependencies":{"vitest":"5.1.0"}}\n','behavproof.config.json':JSON.stringify(cfg),'src/orders.ts':source,'tests/orders.test.ts':sandboxGuard+"if(process.env.BEHAVPROOF_HOST_ONLY_SECRET)throw Error('Host secret reached candidate');\n"+tests};
 for(const [path,text] of Object.entries(files))await writeFile(join(root,path),text);
 git('init','-q','-b','main');git('add','.');git('commit','-qm','Controlled initial obligations');
 const baseline=snapshot(discover({'tests/orders.test.ts':tests}),git('rev-parse','HEAD'),['tests/**/*.ts']),policy=getProfilePolicy('critical'),effectivePolicy=mergeProtectedPolicy({schemaVersion:1,profileVersion:'1',rules:parseConfig(cfg).rules},getProfilePolicy('critical')),targetRef='src/orders.ts#readOrder',producer={tool:'behavproof-probe-collector',version:'0.1.0',collectorVersion:'0.1.0'};
 const rows=[];
 async function execute(id){
  const head=git('rev-parse','HEAD'),subject=await gitSubject(root,inputs,head,head),requestPath=join(host,`${id}.json`),currentSource=await readFile(join(root,'src/orders.ts'));
  const request={schemaVersion:1,root,tests:['tests/orders.test.ts'],contracts:baseline.contracts,targetRef,expectedSourceHash:hashBytes(currentSource),subject,effectivePolicyHash:hash(effectivePolicy),inputs};await writeFile(requestPath,JSON.stringify(request));
  const name=`behavproof-probe-${id}-${randomUUID()}`,workerArgs=[join(project,'scripts/protected-probe-worker.mjs'),'--request',requestPath];
  const command=sandboxSdk?'docker':process.execPath,args=sandboxSdk?['run','--rm','--name',name,'--platform','linux/amd64','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','256','--memory','2g','--cpus','2','--user',`${process.getuid()}:${process.getgid()}`,'--tmpfs','/tmp:rw,nosuid,nodev,size=256m','--mount',`type=bind,src=${sandboxSdk},dst=${resolve(project)},readonly`,'--mount',`type=bind,src=${root},dst=${root},readonly`,'--mount',`type=bind,src=${host},dst=${host},readonly`,'--mount',`type=bind,src=${join(root,'.behavproof/collected',id)},dst=${join(root,'.behavproof/collected',id)}`,'--env',`BEHAVPROOF_OUTPUT_DIR=${join(root,'.behavproof/collected',id)}`,'--env','HOME=/tmp','--env','GIT_CONFIG_COUNT=1','--env','GIT_CONFIG_KEY_0=safe.directory','--env',`GIT_CONFIG_VALUE_0=${root}`,image,'node',...workerArgs]:workerArgs,kinds=[['vitest.json','test'],['contracts.json','contract_report'],['claims.json','claims'],['probe-diagnostics.json','diagnostic']],artifacts=kinds.map(([ref,kind])=>({ref,kind,scope:['ORDER-OWNERSHIP']}));
  let manifest;try{manifest=await collect({root,executionId:id,command,args,inputPaths:inputs,configPaths:['behavproof.config.json'],outputRoot:'.behavproof/collected',artifacts,producer,prHead:head,base:head});}finally{if(sandboxSdk){spawnSync('docker',['rm','-f',name],{stdio:'ignore',timeout:10000});const remaining=spawnSync('docker',['container','inspect',name],{encoding:'utf8',timeout:10000});if(remaining.status!==1||!/No such (?:object|container):/.test(remaining.stderr??''))throw Error('Unable to confirm probe container cleanup');}}
  const manifestRef=`.behavproof/collected/${id}/manifest.json`;await writeFile(join(root,manifestRef),JSON.stringify(manifest));
  const trust={schemaVersion:1,policy,config:parseConfig({...cfg,reports:{vitest:`.behavproof/collected/${id}/vitest.json`}}),baseline,inputs,configPaths:['behavproof.config.json'],qualitySources:['src/**/*.ts'],manifests:[{ref:manifestRef,manifestHash:hash(manifest),expected:{executionId:id,subject,commandHash:hash({command,args}),configHashes:manifest.configHashes,artifacts:artifacts.map(a=>({...a,ref:`.behavproof/collected/${id}/${a.ref}`}))},authority:{kind:'local',producer,executionId:id,commandHash:hash({command,args})}}],claimScopes:[{contractId:'ORDER-OWNERSHIP',caseIds:baseline.contracts[0].caseIds,targetRef,method:PROBE_METHOD}]};
  const rootPath=join(host,`${id}-trust.json`);await writeFile(rootPath,JSON.stringify(trust));let text,exit,diagnostics;
  try{text=execFileSync(process.execPath,[join(project,'packages/cli/dist/index.js'),'check','--mode','gate','--trust-root',rootPath,'--format','json'],{cwd:root,encoding:'utf8',maxBuffer:10*1024*1024,stdio:['ignore','pipe','pipe']});exit=0;}catch(error){text=error.stdout?.toString();exit=error.status;diagnostics=error.stderr?.toString();}
  assert(text,`No CLI report for ${id}: ${diagnostics??''}`);const report=JSON.parse(text);
  const claims=manifest.exitCode===0?JSON.parse(await readFile(join(root,`.behavproof/collected/${id}/claims.json`),'utf8')):[];
  const summary={id,producerExit:manifest.exitCode,gateExit:exit,subject:manifest.subject,evaluations:report.evaluations.map(({ruleId,scope,status})=>({ruleId,scope,status})),claims:claims.map(({kind,payload})=>({kind,payload})),artifactHashes:manifest.artifacts};rows.push(summary);return {manifest,report,claims,exit};
 }
 const previousSecret=process.env.BEHAVPROOF_HOST_ONLY_SECRET;process.env.BEHAVPROOF_HOST_ONLY_SECRET='fixture-not-a-credential';
 let correct;try{correct=await execute('correct');}finally{if(previousSecret===undefined)delete process.env.BEHAVPROOF_HOST_ONLY_SECRET;else process.env.BEHAVPROOF_HOST_ONLY_SECRET=previousSecret;}
 assert(correct.manifest.exitCode===0,'Correct probe worker failed');
 for(const rule of ['contractExecution','negativeCases','productionTargetObserved','mutationSensitivityObserved'])assert(correct.report.evaluations.some(e=>e.ruleId===rule&&e.scope.length===0&&e.status==='pass'),`Correct missing ${rule}`);
 assert(correct.report.assurance.production_target_observed==='pass'&&correct.report.assurance.mutation_sensitivity_observed==='pass','Report summary lost authenticated scoped claims');
 assert(correct.exit===1&&correct.report.status==='incomplete','Missing coverage/mutation/external protection must still block the critical gate');
 await writeFile(join(root,'tests/orders.test.ts'),tests.replace('({input})=>readOrder(input.userId,input.order)','({expected})=>expected'));git('add','.');git('commit','-qm','Controlled fake callback');
 const fake=await execute('fake');assert(fake.manifest.exitCode===0&&fake.exit===1,'Fake callback collection/gate distinction lost');assert(fake.claims.every(e=>e.payload.status!=='pass'),'Fake callback established scoped observations');
 await writeFile(join(root,'tests/orders.test.ts'),tests);await writeFile(join(root,'src/orders.ts'),source.replace('userId===order.ownerId?order:null','true?order:null'));git('add','.');git('commit','-qm','Controlled ownership failure');
 const faulty=await execute('faulty');assert(faulty.manifest.exitCode!==0&&faulty.manifest.artifacts.length===0&&faulty.exit===1,'Ordinary failure sealed success artifacts');
 await writeFile(join(root,'src/orders.ts'),source);await writeFile(join(root,'tests/orders.test.ts'),tests.replace("import { defineContract, contractTest }", "import { describe } from 'vitest';\nimport { defineContract, contractTest }").replace('contractTest.each(ownership,','describe.skip(\'required\',()=>contractTest.each(ownership,').replace('input.order));','input.order)));'));git('add','.');git('commit','-qm','Controlled skipped cases');
 const skipped=await execute('skipped');assert(skipped.manifest.exitCode!==0&&skipped.exit===1,'Skipped comparisons were accepted');
 const removedSource=tests.replace("{id:'non-owner',negative:true,input:{userId:'bob',order:{id:'order-1',ownerId:'alice',total:120}},expected:null},",'');
 assert(hash(discover({'tests/orders.test.ts':removedSource}).contracts[0]?.caseIds)===hash(['owner']),'Fixture did not remove the required case');
 await writeFile(join(root,'tests/orders.test.ts'),removedSource);git('add','.');git('commit','-qm','Controlled removed obligation');
 const removed=await execute('removed');assert(removed.exit===1&&removed.report.evaluations.find(e=>e.ruleId==='contractExecution'&&e.scope.length===0)?.status!=='pass','Removed required case was accepted');
 const evidence={schemaVersion:1,command:'node scripts/protected-probe-flow.mjs'+(sandboxSdk?' --sandbox-sdk <sanitized-linux-sdk>':''),...(sandboxSdk?{sandbox:{image,network:'none',source:'read-only',sdk:'separately sanitized and read-only',control:'read-only',output:'fresh writable',fixtureChecks:['no external network interfaces','source writes denied']}}:{}),node:process.version,authority:'Explicit local host selected the worker and captured outer Collector manifests; no CI/human/protection claim',method:PROBE_METHOD,limits:['Function-declaration instrumentation only; unsupported sources stay unknown.','Scoped observations assume the selected runner and instrumentation; arbitrary hostile JavaScript can forge in-process metadata.','The critical gate remains incomplete without authenticated coverage, sufficient mutations and external protection.'],runs:rows};
 await writeFile(join(project,sandboxSdk?'docs/evidence/protected-probe-sandbox.json':'docs/evidence/protected-probe-flow.json'),JSON.stringify(evidence,null,2)+'\n');console.log('Protected-probe flow passed: real per-case calls and same-callback faults; fake, ordinary failure, skip and removal block. Critical missing evidence remains incomplete.');
}finally{await rm(scratch,{recursive:true,force:true});}
