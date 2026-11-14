import {test,expect} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {createRegistration,persistRegistration} from '../../packages/cli/src/registration.js';
import {getProfilePolicy,parseConfig,hash} from '../../packages/core/src/index.js';
import {discover,snapshot} from '../../packages/contract-registry/src/index.js';
const commit='a'.repeat(40),policy=getProfilePolicy('critical');
const baseline=snapshot(discover({'tests/orders.test.ts':`import {defineContract} from '@behavproof/vitest';const c=defineContract({id:'ORDER',intent:'only owner',risk:'critical',cases:[{id:'owner',input:1,expected:2}]});`}),commit,['tests/**/*.ts']);
const targets=[{kind:'policy',id:'critical-v1',contentHash:hash(policy)},...baseline.intents.map(i=>({kind:'intent',id:i.id,contentHash:i.contentHash})),...baseline.contracts.map(c=>({kind:'contract',id:c.id,contentHash:c.revisionHash}))];
const approvals=targets.map((target,i)=>({schemaVersion:1,id:`review-${i}`,target,status:'pass',subjectCommitSha:commit,source:{provider:'github',ref:'https://github.com/acme/project/pull/7'},approvedBy:['alice'],reasons:[]}));
const value=()=>({schemaVersion:1,repository:{id:'42',fullName:'acme/project'},source:{commitSha:commit,prNumber:7,projectPath:'example',policyRef:'packages/core/src/profiles.ts',fileHashes:{'packages/core/src/profiles.ts':'b'.repeat(64),'tests/orders.test.ts':'c'.repeat(64)}},policyId:'critical-v1',policy,config:parseConfig({schemaVersion:1,profile:'critical',contracts:{enabled:true,sources:[{type:'vitest-inline',include:['tests/**/*.ts']}]}}),baseline,inputs:['src/**/*.ts','tests/**/*.ts','package.json'],configPaths:[],claimScopes:[{contractId:'ORDER',caseIds:['owner'],targetRef:'src/orders.ts#readOrder',method:'protected-observer-v1'}],approvals});
const authority={verifySource:()=>true,verifyApproval:()=>true};
test('registration binds approved source, policy and every Intent/Contract before persistence',()=>{
 const a=createRegistration(value(),authority),b=createRegistration(value(),authority);expect(a.digest).toBe(hash(a.registration));expect(a.digest).toBe(b.digest);expect(a.registration.baseline.contracts).toHaveLength(1);
});
test.each(['policy','intent','contract'])('missing %s approval cannot establish a baseline',kind=>{
 expect(()=>createRegistration({...value(),approvals:approvals.filter(a=>a.target.kind!==kind)},authority)).toThrow(/approval/i);
});
test('source and approval checks require strict external verification',()=>{
 expect(()=>createRegistration(value(),{...authority,verifySource:()=>false})).toThrow(/source/i);
 expect(()=>createRegistration(value(),{...authority,verifySource:()=>Promise.resolve(true)})).toThrow(/source/i);
 expect(()=>createRegistration(value(),{...authority,verifyApproval:()=>Promise.resolve(true)})).toThrow(/approval/i);
 expect(()=>createRegistration({...value(),approvals:approvals.map(a=>({...a,subjectCommitSha:'f'.repeat(40)}))},authority)).toThrow(/approval/i);
});
test('incomplete discovery and contradictory source commits cannot be enrolled',()=>{
 expect(()=>createRegistration({...value(),baseline:{...baseline,discoveryDiagnostics:[{code:'UNKNOWN',sourceRef:'x.ts',message:'unsupported'}]}},authority)).toThrow(/discovery/i);
 expect(()=>createRegistration({...value(),baseline:{...baseline,commitSha:'f'.repeat(40)}},authority)).toThrow(/commit/i);
});
test('immutable registration is stored outside the entire Git checkout and detects later tampering',async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'behavproof-enroll-')),repo=join(scratch,'repo'),host=join(scratch,'host');await mkdir(repo);await mkdir(host,{mode:0o700});execFileSync('git',['init','-q'],{cwd:repo});
 try{const registration=createRegistration(value(),authority);const result=await persistRegistration(repo,host,registration);expect(JSON.parse(await readFile(result.path,'utf8'))).toEqual(registration.registration);expect((await persistRegistration(repo,host,registration)).digest).toBe(result.digest);if(process.platform!=='win32')expect((await stat(result.path)).mode&0o077).toBe(0);
  await expect(persistRegistration(repo,repo,registration)).rejects.toThrow(/outside/i);
  await writeFile(result.path,'tampered');await expect(persistRegistration(repo,host,registration)).rejects.toThrow(/tamper|conflict/i);
 }finally{await rm(scratch,{recursive:true,force:true});}
});
test('verified handles are isolated from mutable caller data and cannot be reconstructed from JSON',async()=>{
 const data=value(),original=data.baseline.contracts[0]!.revisionHash,registration=createRegistration(data,authority);data.baseline.contracts[0]!.revisionHash='0'.repeat(64);expect(registration.registration.baseline.contracts[0]!.revisionHash).toBe(original);
 const scratch=await mkdtemp(join(tmpdir(),'behavproof-reg-handle-'));execFileSync('git',['init','-q'],{cwd:scratch});try{await expect(persistRegistration(scratch,tmpdir(),JSON.parse(JSON.stringify(registration)))).rejects.toThrow(/unverified/i);}finally{await rm(scratch,{recursive:true,force:true});data.baseline.contracts[0]!.revisionHash=original;}
});
test('authority callbacks cannot change the enrollment snapshot during verification',()=>{
 const result=createRegistration(value(),{verifySource:()=>true,verifyApproval:approval=>{try{approval.status='unknown';}catch{}return true;}});
 expect(result.registration.approvals.every(a=>a.status==='pass')).toBe(true);
});
test('loading a baseline requires an independent digest and rejects a PR-owned copy',async()=>{
 const {loadRegistration}=await import('../../packages/cli/src/registration.js');
 const scratch=await mkdtemp(join(tmpdir(),'behavproof-reg-load-')),repo=join(scratch,'repo'),host=join(scratch,'host');await mkdir(repo);await mkdir(host,{mode:0o700});execFileSync('git',['init','-q'],{cwd:repo});
 try{const verified=createRegistration(value(),authority),saved=await persistRegistration(repo,host,verified);expect((await loadRegistration(repo,saved.path,saved.digest)).source.commitSha).toBe(commit);await expect(loadRegistration(repo,saved.path,'0'.repeat(64))).rejects.toThrow(/digest/i);const copy=join(repo,'self-registered.json');await writeFile(copy,JSON.stringify(verified.registration));await expect(loadRegistration(repo,copy,saved.digest)).rejects.toThrow(/outside/i);}finally{await rm(scratch,{recursive:true,force:true});}
});
test('project data retains approved hashes and real commit while translating only the selected Git subtree',async()=>{
 const {registrationProjectData}=await import('../../packages/cli/src/registration.js');const data=value();
 data.source.projectPath='example';data.baseline={...baseline,contracts:baseline.contracts.map(c=>({...c,sourceRef:`example/${c.sourceRef}`})),intents:baseline.intents.map(i=>({...i,origin:{...i.origin,ref:`example/${i.origin.ref}`}})),scope:['example/tests/**/*.ts']};data.inputs=data.inputs.map(p=>`example/${p}`);data.claimScopes=data.claimScopes.map(s=>({...s,targetRef:`example/${s.targetRef}`}));
 const projected=registrationProjectData(data as any);expect(projected.baseline.commitSha).toBe(commit);expect(projected.baseline.contracts[0]?.sourceRef).toBe('tests/orders.test.ts');expect(projected.baseline.contracts[0]?.revisionHash).toBe(baseline.contracts[0]?.revisionHash);expect(projected.baseline.intents[0]?.contentHash).toBe(baseline.intents[0]?.contentHash);expect(projected.inputs).toContain('src/**/*.ts');expect(projected.claimScopes[0]?.targetRef).toBe('src/orders.ts#readOrder');
 data.inputs.push('another-project/src/**');expect(()=>registrationProjectData(data as any)).toThrow(/outside|subtree/i);
});
test('a single-package project at the Git root has an explicit identity projection',async()=>{
 const {registrationProjectData,RegistrationSchema}=await import('../../packages/cli/src/registration.js');const data={...value(),source:{...value().source,projectPath:'.'}};
 const projected=registrationProjectData(RegistrationSchema.parse(data));expect(projected.inputs).toEqual(data.inputs);expect(projected.baseline.contracts).toEqual(data.baseline.contracts);
});
test('multiple target scopes for the same contract are rejected rather than silently selecting the first',async()=>{
 const data=value();data.claimScopes.push({...data.claimScopes[0]!,targetRef:'src/other.ts#readOther'});expect(()=>createRegistration(data,authority)).toThrow(/scope|duplicate|one/i);
 const {TrustRootSchema}=await import('../../packages/cli/src/trust.js');expect(()=>TrustRootSchema.parse({schemaVersion:1,policy,config:data.config,baseline,inputs:data.inputs,configPaths:[],manifests:[],claimScopes:data.claimScopes})).toThrow(/scope|duplicate|one/i);
});
