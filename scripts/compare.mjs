#!/usr/bin/env node
// Same source/properties/cases; measurements are machine observations, not a human study.
import {cp,mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {parse} from 'yaml';
const require=createRequire(import.meta.url),root=process.cwd();
const lsc=path.join(path.dirname(require.resolve('lemmascript/package.json')),'tools/dist/lsc.js');
const vitest=path.join(path.dirname(require.resolve('vitest/package.json')),'vitest.mjs');
const dafny=path.join(root,'.tools/dafny-4.11.0/dafny/dafny'),solver=path.join(path.dirname(dafny),'z3/bin/z3-4.14.1');
const env={PATH:path.dirname(dafny)+path.delimiter+process.env.PATH,LANG:'C.UTF-8'};
const run=(command,args,cwd)=>{
 const start=performance.now(),result=spawnSync(command,args,{cwd,env,encoding:'utf8',timeout:180000,maxBuffer:16_777_216});
 if(result.error||result.status!==0)throw new Error(`Comparison command failed: ${path.basename(command)}: ${result.stdout?.slice(0,3000)} ${result.stderr?.slice(0,1000)}`);
 return {durationMs:Math.round(performance.now()-start),stdout:result.stdout};
};
const measurements=[];await mkdir('.tools',{recursive:true});
for(const sample of ['existing-hono','greenfield-domain']) {
 const project=await mkdtemp(path.join(root,'.tools/comparison-'));
 try {
  await cp(path.join(root,'examples',sample),project,{recursive:true,filter:file=>!file.split(path.sep).some(part=>['evidence','reports'].includes(part))});
  for(const args of [['init','-q'],['add','.'],['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','comparison fixture']])run('git',args,project);
  const config=parse(await readFile(path.join(project,'.pdd/config.yaml'),'utf8')),target=config.targets[0],test=config.testTargets[0];
  const sourceHash=createHash('sha256').update(await readFile(path.join(project,target.file))).digest('hex');
  const direct=()=>{
   const start=performance.now(),source=path.join(project,target.file),model=path.join(project,'lemmascript.json'),proof=path.join(project,'.pdd/proofs',target.file.replace(/\.ts$/,'.dfy'));
   run(process.execPath,[lsc,'extract',`--config=${model}`,source],project);
   run(process.execPath,[lsc,'info','--typed',`--config=${model}`,source],project);
   run(process.execPath,[lsc,'gen-check',`--config=${model}`,source],project);
   run(dafny,['audit',proof],project);
   run(dafny,['verify',proof,'--unicode-char:false','--allow-deprecation','--solver-path',solver,'--log-format','text;LogFileName=direct-members.log'],project);
   run(process.execPath,[vitest,'run','--config',path.join(project,'direct.config.mjs'),'--reporter=json','--outputFile',path.join(project,'direct-tests.json')],project);
   return {durationMs:Math.round(performance.now()-start),invocations:6};
  };
  await writeFile(path.join(project,'direct.config.mjs'),`export default ${JSON.stringify({test:{include:test.files,exclude:[],maxWorkers:2,watch:false}})};\n`);
  const pdd=()=>{const result=run(process.execPath,[path.join(root,'dist/cli/main.js'),'verify','--project',project,'--json'],root);const packet=JSON.parse(result.stdout);if(packet.gate.status!=='trial')throw new Error('PDD trial incomplete');return {durationMs:result.durationMs,invocations:1};};
  // Counterbalance order across the two tiny fixtures; no performance conclusion from n=1.
  let directResult,pddResult;
  if(sample==='existing-hono'){directResult=direct();pddResult=pdd();}else{pddResult=pdd();directResult=direct();}
  const proof=path.join(project,'.pdd/proofs',target.file.replace(/\.ts$/,'.dfy'));
  if(!(await readFile(proof)).equals(await readFile(proof+'.gen')))throw new Error('Unexpected handwritten proof');
  const results=JSON.parse(await readFile(path.join(project,'direct-tests.json'),'utf8'));
  if(!results.success||results.numPassedTests!==results.numTotalTests||results.numPendingTests||!results.numTotalTests||test.requiredTests.some(name=>!results.testResults.flatMap(item=>item.assertionResults.map(value=>value.fullName)).includes(name)))throw new Error('Direct cases incomplete');
  measurements.push({sample,sourceSha256:sourceHash,tests:results.numTotalTests,direct:directResult,pdd:pddResult});
  console.log(`${sample}: direct ${directResult.durationMs}ms / pdd-ts ${pddResult.durationMs}ms, same source and ${results.numTotalTests} cases`);
 }finally{await rm(project,{recursive:true,force:true});}
}
await writeFile('docs/evidence/machine-comparison.json',JSON.stringify({schemaVersion:1,observedAt:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,lemmascript:'0.6.6',dafny:'4.11.0',z3:'4.14.1',iterationsPerFixture:1,scope:'Positive proof and empirical cases only. PDD additionally checks profile, witnesses, obligations, digests and report. No human-effort/usability conclusion.',measurements},null,2)+'\n');
