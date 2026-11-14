import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {test,expect} from 'vitest';
import {tmpdir} from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {collect,gitSubject} from '../../packages/adapter-reports/src/index.js';
import {hash} from '../../packages/core/src/index.js';
test('an unchanged external root rejects manifest rebinding after source changes',async()=>{
const scratch=await mkdtemp(join(tmpdir(),'bp-review-')), root=join(scratch,'repo'),trustPath=join(scratch,'trust.json');
await mkdir(root);await mkdir(join(root,'.behavproof/out'),{recursive:true});
try{
const git=(...args)=>execFileSync('git',['-c','user.name=review','-c','user.email=review@example.invalid',...args],{cwd:root,encoding:'utf8'}).trim();
const report={numTotalTests:1,numPassedTests:1,numFailedTests:0,numPendingTests:0,numTodoTests:0,numTotalTestSuites:1,numPassedTestSuites:1,numFailedTestSuites:0,numPendingTestSuites:0,success:true,testResults:[{name:'test.ts',status:'passed',assertionResults:[{status:'passed',ancestorTitles:[]}]}]};
const cfg={schemaVersion:1,profile:'basic',git:{base:'HEAD'},reports:{vitest:'.behavproof/out/run1/test.json'}};
await writeFile(join(root,'package.json'),JSON.stringify({type:'module',scripts:{test:'vitest run'},devDependencies:{vitest:'5.1.0'}}));
await writeFile(join(root,'.gitignore'),'.behavproof/\n');await writeFile(join(root,'behavproof.config.json'),JSON.stringify(cfg));await writeFile(join(root,'src.js'),'export const allow = false;\n');
await writeFile(join(root,'runner.mjs'),`import {allow} from './src.js';import {writeFileSync} from 'node:fs';import assert from 'node:assert/strict';assert.equal(allow,false);writeFileSync(process.env.BEHAVPROOF_OUTPUT_DIR+'/test.json',${JSON.stringify(JSON.stringify(report))});`);
git('init','-q','-b','main');git('add','.');git('commit','-qm','approved source');
const inputs=['package.json','.gitignore','behavproof.config.json','src.js','runner.mjs'],head=git('rev-parse','HEAD'),command=process.execPath,args=['runner.mjs'],producer={tool:'review-fixture',version:'1',collectorVersion:'1'};
const manifest=await collect({root,executionId:'run1',command,args,inputPaths:inputs,configPaths:['behavproof.config.json'],outputRoot:'.behavproof/out',artifacts:[{ref:'test.json',kind:'test',scope:['src.js']}],producer,prHead:head,base:head});
const manifestPath=join(root,'.behavproof/out/run1/manifest.json');await writeFile(manifestPath,JSON.stringify(manifest));
const expected={executionId:manifest.executionId,subject:manifest.subject,commandHash:manifest.commandHash,configHashes:manifest.configHashes,artifacts:manifest.artifacts.map(({sha256,...a})=>a)};
const trust={schemaVersion:1,policy:{schemaVersion:1,profileVersion:'1',rules:{testResult:{severity:'error'}}},config:cfg,baseline:{schemaVersion:1,commitSha:head,contracts:[],intents:[],scope:[],discoveryDiagnostics:[]},inputs,configPaths:['behavproof.config.json'],manifests:[{ref:'.behavproof/out/run1/manifest.json',manifestHash:hash(manifest),expected,authority:{kind:'local',producer,executionId:'run1',commandHash:manifest.commandHash}}]};
await writeFile(trustPath,JSON.stringify(trust));const controlBefore=await readFile(trustPath,'utf8');
const cli=()=>{const r=spawnSync(process.execPath,[resolve('packages/cli/dist/index.js'),'check','--mode','gate','--trust-root',trustPath,'--format','json'],{cwd:root,encoding:'utf8'});if(!r.stdout)throw Error(r.stderr);const v=JSON.parse(r.stdout);return {exit:r.status,status:v.status,testResult:v.evaluations.find(e=>e.ruleId==='testResult'),provenance:v.provenance};};
expect(cli().exit).toBe(0);
await writeFile(join(root,'src.js'),'export const allow = true;\n');git('add','src.js');git('commit','-qm','break policy');const current=git('rev-parse','HEAD');
manifest.subject=await gitSubject(root,inputs,current,current);await writeFile(manifestPath,JSON.stringify(manifest));
expect(cli().exit).toBe(1);
expect(controlBefore).toBe(await readFile(trustPath,'utf8'));
const actual=spawnSync(process.execPath,['runner.mjs'],{cwd:root,encoding:'utf8'});expect(actual.status).toBe(1);
}finally{await rm(scratch,{recursive:true,force:true});}
},30000);
