#!/usr/bin/env node
import {spawnSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd();
const env={...process.env,PATH:path.join(root,'.tools/dafny-4.11.0/dafny')+path.delimiter+process.env.PATH};
await mkdir('.tools',{recursive:true});
for(const project of ['examples/existing-hono','examples/greenfield-domain','examples/job-queue','.']) {
 // Root verification serially runs four independently bounded empirical suites and proofs.
 // Keep the outer orchestration budget above a single 120s child budget.
 const timeout=project==='.'?600000:180000,started=performance.now();
 const result=spawnSync(process.execPath,['dist/cli/main.js','verify','--project',project,'--json'],{cwd:root,env,encoding:'utf8',timeout,maxBuffer:16_777_216});
 if(result.error || result.status!==0) throw new Error(`Demo failed: ${project}: ${result.stdout?.slice(0,4000)} ${result.error?.message??''} ${result.stderr?.slice(0,4000)??''}`);
 const packet=JSON.parse(result.stdout);
 if(packet.gate.status!=='trial' || packet.approval!=='pending' || packet.evidence.some(item=>item.status!=='passed')) throw new Error(`Incomplete demo: ${project}`);
 await writeFile(path.join('.tools',project==='.'?'self-trial.json':`${path.basename(project)}-trial.json`),result.stdout);
 console.log(`${project}: local trial, ${packet.evidence.length} satisfied obligations, approval pending (${Math.round(performance.now()-started)}ms)`);
}
