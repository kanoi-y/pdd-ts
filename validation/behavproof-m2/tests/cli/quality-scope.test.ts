import {test,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {check} from '../../packages/cli/src/check.js';
import {hash,hashBytes,parseConfig} from '../../packages/core/src/index.js';
import {gitSubject} from '../../packages/adapter-reports/src/index.js';
async function fixture(run:(root:string,path:string,trust:any)=>Promise<void>){
 const scratch=await mkdtemp(join(tmpdir(),'behavproof-quality-')),root=join(scratch,'repo'),host=join(scratch,'host');await mkdir(root);await mkdir(host);await mkdir(join(root,'src'));await mkdir(join(root,'tests'));await mkdir(join(root,'.behavproof'));
 const git=(...args:string[])=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{cwd:root,encoding:'utf8'}).trim();
 try{
  await writeFile(join(root,'.gitignore'),'.behavproof/\n');await writeFile(join(root,'package.json'),JSON.stringify({scripts:{test:'vitest run'},devDependencies:{vitest:'5.1.0'}}));git('init','-q','-b','main');git('add','.');git('commit','-qm','initial');const base=git('rev-parse','HEAD');
  const cfg={schemaVersion:1,profile:'basic',git:{base},reports:{coverage:'.behavproof/lcov.info'},rules:{testResult:{severity:'off'},changedLineCoverage:{severity:'error',min:80}}};
  await writeFile(join(root,'behavproof.config.json'),JSON.stringify(cfg));await writeFile(join(root,'src/orders.ts'),'export const value=1;\n');await writeFile(join(root,'tests/orders.test.ts'),'export const fixture=1;\n');git('add','.');git('commit','-qm','candidate');const head=git('rev-parse','HEAD');
  const inputs=['package.json','behavproof.config.json','src/orders.ts','tests/orders.test.ts'],subject=await gitSubject(root,inputs,head,base),producer={tool:'controlled-scope-fixture',version:'1',collectorVersion:'1'},commandHash=hash({controlled:'coverage'}),reportRef='.behavproof/lcov.info',bytes=Buffer.from('SF:src/orders.ts\nDA:1,1\nend_of_record\n');await writeFile(join(root,reportRef),bytes);
  const configHashes={'behavproof.config.json':hashBytes(await readFile(join(root,'behavproof.config.json')))},artifact={ref:reportRef,kind:'coverage',scope:['src/orders.ts']},expected={executionId:'run',subject,commandHash,configHashes,artifacts:[artifact]};
  const manifest={schemaVersion:1,...expected,producer,environment:{nodeVersion:process.version,platform:process.platform},startedAt:'2026-11-14T00:00:00Z',completedAt:'2026-11-14T00:00:01Z',exitCode:0,artifacts:[{...artifact,sha256:hashBytes(bytes)}]};await writeFile(join(root,'.behavproof/manifest.json'),JSON.stringify(manifest));
  const trust={schemaVersion:1,policy:{schemaVersion:1,profileVersion:'1',rules:{changedLineCoverage:{severity:'error',min:80}}},config:parseConfig(cfg),baseline:{schemaVersion:1,commitSha:base,intents:[],contracts:[],scope:[],discoveryDiagnostics:[],extractorVersion:'1'},inputs,configPaths:['behavproof.config.json'],qualitySources:['src/**/*.ts'],manifests:[{ref:'.behavproof/manifest.json',manifestHash:hash(manifest),expected,authority:{kind:'local',producer,executionId:'run',commandHash}}]};
  const path=join(host,'trust.json');await writeFile(path,JSON.stringify(trust));await run(root,path,trust);
 }finally{await rm(scratch,{recursive:true,force:true});}
}
test('protected quality sources select production lines while retaining tests in the subject and full diff',()=>fixture(async(root,path)=>{
 const report=await check(root,{mode:'gate','trust-root':path});expect(report.evaluations.find(e=>e.ruleId==='changedLineCoverage')?.status).toBe('pass');expect(report.diff.files.map(f=>f.path)).toContain('tests/orders.test.ts');expect((report as any).qualityScope.excludedPaths).toEqual(['tests/orders.test.ts']);
 await writeFile(join(root,'tests/orders.test.ts'),'export const fixture=2;\n');expect((await check(root,{mode:'gate','trust-root':path})).status).not.toBe('pass');
}),45000);
test('a selected production file must be part of the independently hashed input scope',()=>fixture(async(root,path,trust)=>{
 trust.inputs=trust.inputs.filter((p:string)=>p!=='src/orders.ts');await writeFile(path,JSON.stringify(trust));await expect(check(root,{mode:'gate','trust-root':path})).rejects.toThrow(/quality.*input|input.*quality/i);
}));
test('omitting explicit quality sources preserves conservative whole-project coverage requirements',()=>fixture(async(root,path,trust)=>{
 delete trust.qualitySources;await writeFile(path,JSON.stringify(trust));const report=await check(root,{mode:'gate','trust-root':path});expect(report.evaluations.find(e=>e.ruleId==='changedLineCoverage')?.status).toBe('unknown');
}));
