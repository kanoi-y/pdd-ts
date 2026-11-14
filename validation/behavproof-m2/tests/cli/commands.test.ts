import { beforeEach, afterEach, test, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const binary=resolve('packages/cli/dist/index.js');let root:string;
const run=(args:string[])=>spawnSync(process.execPath,[binary,...args],{cwd:root,encoding:'utf8'});
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'behavproof CLI '));await writeFile(join(root,'package.json'),JSON.stringify({name:'test',scripts:{test:'vitest run'},devDependencies:{vitest:'5.1.0'}}));spawnSync('git',['init','-q','-b','main'],{cwd:root});spawnSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','add','.'],{cwd:root});spawnSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','initial'],{cwd:root});});
afterEach(()=>rm(root,{recursive:true,force:true}));
test('init dry-run writes nothing and init is non-destructive/idempotent',async()=>{
 const dry=run(['init','--dry-run']);expect(dry.status).toBe(0);expect(dry.stdout).toContain('behavproof.config.json');
 await expect(readFile(join(root,'behavproof.config.json'))).rejects.toThrow();
 expect(run(['init']).status).toBe(0);const original=await readFile(join(root,'behavproof.config.json'),'utf8');
 expect(run(['init']).status).toBe(0);expect(await readFile(join(root,'behavproof.config.json'),'utf8')).toBe(original);
});
test('audit reports unknown evidence with exit0; gate needs an external root',()=>{
 const audit=run(['check','--base','HEAD','--format','json']);expect(audit.status).toBe(0);const report=JSON.parse(audit.stdout);expect(report.status).toBe('incomplete');expect(report.evaluations.find((x:any)=>x.ruleId==='testResult').status).toBe('unknown');
 const gate=run(['check','--mode','gate','--base','HEAD']);expect(gate.status).toBe(2);expect(gate.stderr).toContain('trust-root');
});
test('strict option, config and malformed report errors exit2',async()=>{
 expect(run(['check','--wat']).status).toBe(2);
 await writeFile(join(root,'behavproof.config.json'),'{"schemaVersion":999}');expect(run(['check']).status).toBe(2);
 await writeFile(join(root,'behavproof.config.json'),'{"schemaVersion":1,"reports":{"vitest":"bad.json"}}');await writeFile(join(root,'bad.json'),'not JSON');expect(run(['check','--base','HEAD']).status).toBe(2);
});
test('critical profile retains every mandatory rule when contracts disabled',()=>{
 const result=run(['check','--profile','critical','--base','HEAD','--format','json']);expect(result.status).toBe(0);const report=JSON.parse(result.stdout);expect(report.mandatoryCount).toBeGreaterThanOrEqual(10);expect(report.status).toBe('incomplete');
});
test('renders deterministic JSON/markdown/console and safely writes an output',async()=>{
 const args=['check','--base','HEAD','--format','json'];expect(run(args).stdout).toBe(run(args).stdout);
 expect(run(['check','--base','HEAD','--format','markdown']).stdout).toContain('| Rule |');
 expect(run(['check','--base','HEAD','--output','out/report.json','--format','json']).status).toBe(0);expect(JSON.parse(await readFile(join(root,'out/report.json'),'utf8')).schemaVersion).toBe(1);
 expect(run(['check','--base','HEAD','--output','../escape']).status).toBe(2);
});
test('doctor and explain disclose support and claim limits',()=>{
 expect(run(['doctor']).status).toBe(0);expect(run(['doctor']).stdout).toContain('single-package');
 expect(run(['explain','changed-line-coverage']).stdout).toContain('unknown');expect(run(['formal','check']).status).toBe(2);
});
test('static discovery, baseline, impact, diff and generated docs use no imported code',async()=>{
 await mkdir(join(root,'tests'));await writeFile(join(root,'tests/order.test.ts'),`import {defineContract} from '@behavproof/vitest';\nthrow Error('must never execute');\nconst order=defineContract({id:'ORDER',intent:'positive',risk:'critical',cases:[{id:'yes',input:2,expected:3}]});\n`);
 await writeFile(join(root,'behavproof.config.json'),JSON.stringify({schemaVersion:1,contracts:{enabled:true,sources:[{type:'vitest-inline',include:['tests/**/*.ts']}]}}));
 for(const command of ['discover','list','validate']){const r=run(['contracts',command]);expect(r.status,r.stderr).toBe(0);expect(r.stdout).toContain('ORDER');}
 const baseline=run(['baseline','create']);expect(baseline.status,baseline.stderr).toBe(0);expect(JSON.parse(await readFile(join(root,'.behavproof/baseline.json'),'utf8')).contracts).toHaveLength(1);
 expect(run(['intent','diff','--base','HEAD','--head','HEAD']).status).toBe(0);expect(run(['impact','--base','HEAD','--head','HEAD']).status).toBe(0);
 expect(run(['docs','generate']).status).toBe(0);expect(run(['docs','check']).status).toBe(0);
 const path=join(root,'.behavproof/generated/behavior.md');expect(await readFile(path,'utf8')).toContain('ORDER');await writeFile(path,'edited');expect(run(['docs','--check']).status).toBe(1);
});
test('project-contained trust root and symlink output escape are refused',async()=>{
 await writeFile(join(root,'root.json'),'{}');expect(run(['check','--mode','gate','--trust-root','root.json','--base','HEAD']).status).toBe(2);
});
test('an explicit external local authority gates current bytes, rejects stale/tampered evidence and preserves protected thresholds',async()=>{
 const {hash,hashBytes,parseConfig}=await import('../../packages/core/src/index.js');
 const {gitSubject}=await import('../../packages/adapter-reports/src/index.js');
 const cfg={schemaVersion:1,profile:'basic',git:{base:'HEAD'},reports:{vitest:'.behavproof/input/vitest.json'}};
 await writeFile(join(root,'behavproof.config.json'),JSON.stringify(cfg));await writeFile(join(root,'src.ts'),'export const n=1;\n');
 spawnSync('git',['add','.'],{cwd:root});spawnSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid','commit','-qm','configure'],{cwd:root});
 await mkdir(join(root,'.behavproof/input'),{recursive:true});
 const report={numTotalTests:1,numPassedTests:1,numFailedTests:0,numPendingTests:0,numTodoTests:0,numTotalTestSuites:1,numPassedTestSuites:1,numFailedTestSuites:0,numPendingTestSuites:0,success:true,testResults:[{name:'test.ts',status:'passed',assertionResults:[{status:'passed',ancestorTitles:[]}]}]};
 const reportPath='.behavproof/input/vitest.json',reportBytes=Buffer.from(JSON.stringify(report));await writeFile(join(root,reportPath),reportBytes);
 const inputs=['package.json','behavproof.config.json','src.ts'];const head=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim();
 const subject=await gitSubject(root,inputs,head,head),commandHash=hash({command:'trusted-runner'}),producer={tool:'vitest',version:'5.1.0',collectorVersion:'0.1.0'},configHashes={'behavproof.config.json':hashBytes(await readFile(join(root,'behavproof.config.json')))};
 const artifact={ref:reportPath,kind:'test',scope:['src.ts']};const expected={executionId:'run1',subject,commandHash,configHashes,artifacts:[artifact]};
 const manifest={schemaVersion:1,...expected,producer,environment:{nodeVersion:process.version,platform:process.platform},startedAt:'2026-11-13T01:00:00Z',completedAt:'2026-11-13T01:00:01Z',exitCode:0,artifacts:[{...artifact,sha256:hashBytes(reportBytes)}]};
 const manifestPath='.behavproof/input/manifest.json';await writeFile(join(root,manifestPath),JSON.stringify(manifest));
 const control=await mkdtemp(join(tmpdir(),'behavproof-host-'));const rootFile=join(control,'trust.json');
 const trust={schemaVersion:1,policy:{schemaVersion:1,profileVersion:'1',rules:{testResult:{severity:'error'}}},config:cfg,baseline:{schemaVersion:1,commitSha:head,contracts:[],intents:[],extractorVersion:'1',discoveryDiagnostics:[],scope:[]},inputs,configPaths:['behavproof.config.json'],manifests:[{ref:manifestPath,manifestHash:hash(manifest),expected,authority:{kind:'local',producer,executionId:'run1',commandHash}}]};
 try {
  await writeFile(rootFile,JSON.stringify(trust));const args=['check','--mode','gate','--trust-root',rootFile,'--format','json'];
  const valid=run(args);expect(valid.status,valid.stderr+valid.stdout).toBe(0);expect(JSON.parse(valid.stdout).evaluations.find((e:any)=>e.ruleId==='testResult').status).toBe('pass');
  await writeFile(join(root,reportPath),JSON.stringify({...report,success:false}));expect(run(args).status).toBe(1);
  await writeFile(join(root,reportPath),reportBytes);await writeFile(join(root,manifestPath),JSON.stringify({...manifest,executionId:'old'}));expect(run(args).status).toBe(1);
  await writeFile(join(root,manifestPath),JSON.stringify(manifest));trust.policy.rules={testResult:{severity:'error'},changedLineCoverage:{severity:'error',min:95}} as any;await writeFile(rootFile,JSON.stringify(trust));
  const protectedResult=run(args);expect(protectedResult.status).toBe(1);expect(JSON.parse(protectedResult.stdout).evaluations.find((e:any)=>e.ruleId==='changedLineCoverage').severity).toBe('error');
 }finally{await rm(control,{recursive:true,force:true});}
});
test('oversized input and output symlinks are rejected before processing',async()=>{
 const {symlink}=await import('node:fs/promises');
 await writeFile(join(root,'large.json'),' '.repeat(10*1024*1024+1));
 await writeFile(join(root,'behavproof.config.json'),JSON.stringify({schemaVersion:1,reports:{vitest:'large.json'}}));expect(run(['check','--base','HEAD']).status).toBe(2);
 await writeFile(join(root,'behavproof.config.json'),'{"schemaVersion":1}');
 const other=await mkdtemp(join(tmpdir(),'behavproof-output-'));try{await symlink(other,join(root,'linked'));expect(run(['check','--base','HEAD','--output','linked/report.json']).status).toBe(2);}finally{await rm(other,{recursive:true,force:true});}
});
test('normal audit violations preserve exit0 while reporting test failure',async()=>{
 const report={numTotalTests:1,numPassedTests:0,numFailedTests:1,numPendingTests:0,numTodoTests:0,numTotalTestSuites:1,numPassedTestSuites:0,numFailedTestSuites:1,numPendingTestSuites:0,success:false,testResults:[{name:'test.ts',status:'failed',assertionResults:[{status:'failed',ancestorTitles:[]}]}]};
 await writeFile(join(root,'failed.json'),JSON.stringify(report));await writeFile(join(root,'behavproof.config.json'),JSON.stringify({schemaVersion:1,reports:{vitest:'failed.json'}}));
 const result=run(['check','--base','HEAD','--format','json']);expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout).status).toBe('fail');
});
test('risk overrides add scoped critical obligations without disabling global rules',async()=>{
 await mkdir(join(root,'src'));await writeFile(join(root,'src/auth.ts'),'export const authorize=(ok:boolean)=>ok;\n');
 await writeFile(join(root,'behavproof.config.json'),JSON.stringify({schemaVersion:1,profile:'basic',riskOverrides:[{selector:{kind:'path',value:'src/auth.ts'},profile:'critical'}]}));
 const result=run(['check','--base','HEAD','--format','json']);expect(result.status,result.stderr).toBe(0);const report=JSON.parse(result.stdout);
 expect(report.evaluations.some((e:any)=>e.ruleId==='productionTargetObserved'&&e.severity==='error'&&e.scope.includes('src/auth.ts')&&e.status==='unknown')).toBe(true);
 expect(report.evaluations.some((e:any)=>e.ruleId==='testResult'&&e.scope.length===0)).toBe(true);
});
test('protected CI generated config must retain candidate weakening for policyProtection to reject it',async()=>{
 const {hostConfig}=await import('../../scripts/github-control.mjs'),{parseConfig}=await import('../../packages/core/src/index.js');const registered=parseConfig({schemaVersion:1,profile:'basic',rules:{testResult:{severity:'error'},policyProtection:{severity:'error'}},git:{base:'HEAD'}}),candidate={...registered,rules:{...registered.rules,testResult:{severity:'off'}}},head=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).stdout.trim(),generated=hostConfig({config:registered},head,'run1',candidate);
 await mkdir(join(root,'.behavproof'));await writeFile(join(root,'.behavproof/host-config.json'),JSON.stringify(generated));const control=await mkdtemp(join(tmpdir(),'behavproof-policy-host-')),trustPath=join(control,'root.json');try{
  await writeFile(trustPath,JSON.stringify({schemaVersion:1,policy:{schemaVersion:1,profileVersion:'1',rules:registered.rules},config:registered,baseline:{schemaVersion:1,commitSha:head,contracts:[],intents:[],extractorVersion:'1',discoveryDiagnostics:[],scope:[]},inputs:['package.json'],configPaths:[],manifests:[]}));
  const result=run(['check','--mode','gate','--config','.behavproof/host-config.json','--trust-root',trustPath,'--format','json']);expect(result.status,result.stderr).toBe(1);expect(JSON.parse(result.stdout).evaluations.find((row:any)=>row.ruleId==='policyProtection').status).toBe('fail');
 }finally{await rm(control,{recursive:true,force:true});}
});
