#!/usr/bin/env node
import {cp,mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const root=process.cwd(),env={...process.env,PATH:path.join(root,'.tools/dafny-4.11.0/dafny')+path.delimiter+process.env.PATH};
await mkdir('.tools',{recursive:true});
const cases=[
 {id:'auth-bypass',project:'existing-hono',file:'src/domain/auth.ts',from:'return role === "admin" && passwordOk;',to:'return true;'},
 {id:'skipped-route-tests',project:'existing-hono',file:'tests/route.test.ts',from:'it.each([',to:'it.skip.each(['},
 {id:'vacuous-premise',project:'existing-hono',file:'src/domain/auth.ts',from:'//@ ensures',to:'//@ requires false\n//@ ensures'},
 {id:'lost-money',project:'greenfield-domain',file:'src/domain/split.ts',from:'second: total - requested',to:'second: 0n'},
];
for(const scenario of cases) {
 const directory=await mkdtemp(path.join(root,'.tools/negative-'));
 try {
  await cp(path.join(root,'examples',scenario.project),directory,{recursive:true,filter:source=>!source.split(path.sep).some(part=>['evidence','reports'].includes(part))});
  const file=path.join(directory,scenario.file),source=await readFile(file,'utf8');
  if(!source.includes(scenario.from)) throw new Error(`Mutation anchor unavailable: ${scenario.id}`);
  await writeFile(file,source.replace(scenario.from,scenario.to));
  for(const args of [['init','-q'],['add','.'],['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','negative fixture']]) {
   const git=spawnSync('git',args,{cwd:directory,encoding:'utf8'});if(git.status!==0)throw new Error('Negative fixture Git setup failed');
  }
  const result=spawnSync(process.execPath,[path.join(root,'dist/cli/main.js'),'verify','--project',directory,'--json'],{env,encoding:'utf8',timeout:120000,maxBuffer:16_777_216});
  if(result.error||result.status!==1)throw new Error(`Expected blocked gate: ${scenario.id}: ${result.status}: ${result.stdout?.slice(0,2000)}`);
  const packet=JSON.parse(result.stdout);
  if(packet.gate.status!=='blocked' || packet.evidence.every(item=>item.status==='passed'))throw new Error(`Negative escaped gate: ${scenario.id}`);
  console.log(`${scenario.id}: blocked (${packet.evidence.map(item=>`${item.kind}:${item.status}`).join(', ')})`);
 }finally{await rm(directory,{recursive:true,force:true});}
}
