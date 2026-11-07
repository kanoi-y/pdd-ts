import {mkdir,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {sandboxArguments} from './sandbox.js';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { digestFiles,sha256 } from './digest.js';
import { resolveProjectPath } from './paths.js';
import { runProcess } from './process.js';
import { readProjectText,writeProjectFile } from '../requirements/io.js';
import { empiricalInputs } from './boundaries.js';
import type { Project } from '../requirements/project.js';
import type { EvidenceRecord } from './types.js';
import type { VerificationRun,VerificationOutcome } from './lemmascript.js';
const assertion=z.object({fullName:z.string().min(1),status:z.enum(['passed','failed','pending','todo','skipped'])});
const reportSchema=z.object({success:z.boolean(),numTotalTests:z.number().int().nonnegative(),numPassedTests:z.number().int().nonnegative(),numFailedTests:z.number().int().nonnegative(),numPendingTests:z.number().int().nonnegative(),testResults:z.array(z.object({assertionResults:z.array(assertion)}))});
export function inspectTestReport(raw:unknown,required:string[]) {
 const invalid=(message:string)=>({status:'unknown' as const,counts:{total:0,passed:0,failed:0,skipped:0},diagnostics:[message]});
 const parsed=reportSchema.safeParse(raw); if(!parsed.success) return invalid('テスト結果の形式を確認できません。');
 if(!required.length) return invalid('必須テストが登録されていません。');
 const data=parsed.data, cases=data.testResults.flatMap(item=>item.assertionResults),names=cases.map(item=>item.fullName);
 const counts={total:cases.length,passed:cases.filter(item=>item.status==='passed').length,failed:cases.filter(item=>item.status==='failed').length,skipped:cases.filter(item=>!['passed','failed'].includes(item.status)).length};
 if(new Set(names).size!==names.length) return invalid('結果のテスト名が重複しています。');
 if(counts.total===0) return invalid('結果のテストケース数が0件です。');
 if(counts.total!==data.numTotalTests || counts.passed!==data.numPassedTests || counts.failed!==data.numFailedTests || counts.skipped!==data.numPendingTests) return invalid('結果のケース一覧と集計件数が一致しません。');
 const missing=required.filter(name=>!names.includes(name));
 if(missing.length) return invalid(`結果に含まれない必須テスト：${missing.join(' / ')}`);
 return {status:data.success && counts.passed===counts.total && counts.failed===0 && counts.skipped===0?'passed' as const:'failed' as const,counts,diagnostics:[]};
}
export const vitestCli=path.join(path.dirname(createRequire(import.meta.url).resolve('vitest/package.json')),'vitest.mjs');
export async function empiricalToolDigest():Promise<string> {
 const {hashToolFile}=await import('./toolchain.js');
 return sha256(JSON.stringify({node:await hashToolFile(process.execPath),vitest:await hashToolFile(vitestCli),adapter:await hashToolFile(fileURLToPath(import.meta.url))}));
}
export async function verifyTests(project:Project,obligationId:string,identity:VerificationRun,toolchainDigest:string):Promise<VerificationOutcome> {
 const obligation=project.obligations.find(item=>item.id===obligationId)!;
 const target=project.config.testTargets.find(item=>item.obligationId===obligationId);
 if(!target) throw new Error('No empirical target registered');
 const directory=`.pdd/evidence/${identity.id}/${obligationId}`;
 const inputPaths=empiricalInputs(project,obligationId),artifacts:string[]=[],diagnostics:string[]=[];
 const record:EvidenceRecord={id:`test-${sha256(identity.id+obligationId).slice(0,48)}`,obligationId,requirementIds:obligation.requirementIds,kind:'test',status:'error',scope:obligation.scope,assumptions:[],artifactPaths:[],artifactDigests:{},verifiedSymbols:[],verifiedContractIds:[],premiseEvidenceIds:[],proofInputDigest:sha256('empirical'),sourceDigest:sha256('unavailable'),specDigest:identity.specDigest,toolchainDigest,commit:identity.commit,run:{id:identity.id,origin:'local'}};
 try {
  const inputs=await digestFiles(project.root,inputPaths); record.sourceDigest=inputs.digest;
  for(const file of target.files) await resolveProjectPath(project.root,file);
  const config=`${directory}/vitest.config.mjs`,output=`${directory}/results.json`;
  await writeProjectFile(project.root,config,`export default ${JSON.stringify({cacheDir:path.join(project.root,directory,'vite-cache'),test:{include:target.files,exclude:[],passWithNoTests:false,watch:false,testTimeout:60000,hookTimeout:60000,pool:'forks',maxWorkers:2}})};\n`); artifacts.push(config);
  const args=[vitestCli,'run','--configLoader','native','--root',project.root,'--config',await resolveProjectPath(project.root,config),'--reporter=json','--outputFile',await resolveProjectPath(project.root,output,{allowMissing:true})];
  let outcome;
  if(process.env.PDD_TEST_SANDBOX==='1') {
   const trustedRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
   const name=`pdd-test-${randomUUID()}`;
   for(const folder of ['.tools','dist']) await mkdir(path.join(project.root,folder),{recursive:true});
   const command=['node',path.join(trustedRoot,'scripts/ci-test-worker.mjs'),JSON.stringify(args)];
   try {outcome=await runProcess('docker',sandboxArguments({trustedRoot,projectRoot:project.root,artifactDirectory:await resolveProjectPath(project.root,directory),name,command,uid:process.getuid?.()??1001,gid:process.getgid?.()??1001}),{cwd:project.root,timeoutMs:120000,maxOutputBytes:2_097_152});}
   finally {await runProcess('docker',['rm','--force',name],{cwd:project.root,timeoutMs:10000});}
  } else {
   const state=path.join(await resolveProjectPath(project.root,directory),'.tool-state');
   try{outcome=await runProcess(process.execPath,args,{cwd:project.root,timeoutMs:120000,maxOutputBytes:2_097_152,env:{XDG_DATA_HOME:state}});}
   finally{await rm(state,{recursive:true,force:true});}
  }
  await writeProjectFile(project.root,`${directory}/process.json`,JSON.stringify(outcome,null,2)+'\n'); artifacts.push(`${directory}/process.json`);
  if(outcome.status==='completed') {
   const results=inspectTestReport(JSON.parse(await readProjectText(project.root,output,8_388_608)),target.requiredTests); artifacts.push(output);
   diagnostics.push(...results.diagnostics);
   record.counts=results.counts; record.status=outcome.exitCode===0?results.status:'failed';
  } else record.status=outcome.status==='error'?'error':'unknown';
  if((await digestFiles(project.root,inputPaths)).digest!==inputs.digest) record.status='stale';
 } catch(error) {diagnostics.push(error instanceof Error?error.message:'Empirical run unavailable');}
 await writeProjectFile(project.root,`${directory}/diagnostics.json`,JSON.stringify(diagnostics)+'\n'); artifacts.push(`${directory}/diagnostics.json`);
 record.artifactPaths=artifacts; record.artifactDigests=(await digestFiles(project.root,artifacts)).files;
 return {record,inputPaths,diagnostics};
}
