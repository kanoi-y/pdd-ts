import {test,expect} from 'vitest';import {mkdtemp,readFile,readdir,rm,access} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {execFileSync,spawnSync} from 'node:child_process';
test('a separately staged verifier includes its pinned build inputs and excludes private workspace surfaces',async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'behavproof-sanitized-')),output=join(scratch,'sdk');
 try{
  execFileSync(process.execPath,['scripts/prepare-sandbox-sdk.mjs','--output',output],{cwd:resolve('.'),stdio:'pipe'});
  const manifest=JSON.parse(await readFile(join(output,'sdk-source-inventory.json'),'utf8'));expect(manifest.files.length).toBeGreaterThan(0);expect(manifest.files.some((row:any)=>row.path==='scripts/protected-probe-worker.mjs')).toBe(true);
  expect(await readFile(join(output,'packages/core/src/schemas.ts'),'utf8')).toBe(await readFile('packages/core/src/schemas.ts','utf8'));
  for(const path of ['node_modules','.git','.superpowers','.codex','.aws','BehavProof_開発仕様書_v0.6.md'])await expect(access(join(output,path))).rejects.toThrow();
  const before=await readdir(output);expect(spawnSync(process.execPath,['scripts/prepare-sandbox-sdk.mjs','--output',output],{encoding:'utf8'}).status).not.toBe(0);expect(await readdir(output)).toEqual(before);
  const inside=join(resolve('.'),'.behavproof',`unsafe-stage-${Date.now()}`);expect(spawnSync(process.execPath,['scripts/prepare-sandbox-sdk.mjs','--output',inside],{encoding:'utf8'}).status).not.toBe(0);await expect(access(inside)).rejects.toThrow();
 }finally{await rm(scratch,{recursive:true,force:true});}
},30000);
test.skipIf(process.platform==='win32')('built staging preserves package resolution and rejects outside dependency links without leaving a usable partial SDK',async()=>{
 const {symlink,unlink}=await import('node:fs/promises');const scratch=await mkdtemp(join(tmpdir(),'behavproof-runtime-stage-')),output=join(scratch,'runtime'),bad=join(scratch,'rejected'),target=join(scratch,'private-fixture.txt'),link=resolve('node_modules/zod/.behavproof-private-fixture-'+crypto.randomUUID());let linked=false;
 try{
  execFileSync(process.execPath,['scripts/prepare-sandbox-sdk.mjs','--built','--output',output],{stdio:'pipe',timeout:60000});
  const {validateStagedSdk}=await import('../../scripts/staged-sdk.mjs');await expect(validateStagedSdk(output,{referenceRoot:resolve('.')})).resolves.toMatchObject({path:await (await import('node:fs/promises')).realpath(output)});
  const probe="import {hash} from '@behavproof/core';if(hash({}).length!==64)throw Error('Staged dependency resolution failed');";const {writeFile}=await import('node:fs/promises');await writeFile(join(output,'probe.mjs'),probe);execFileSync(process.execPath,[join(output,'probe.mjs')],{stdio:'pipe'});await unlink(join(output,'probe.mjs'));
  const {rename}=await import('node:fs/promises');await rename(join(output,'node_modules'),join(scratch,'modules'));await symlink(join(scratch,'modules'),join(output,'node_modules'));await expect(validateStagedSdk(output,{referenceRoot:resolve('.')})).rejects.toThrow(/dependency root/i);await unlink(join(output,'node_modules'));await rename(join(scratch,'modules'),join(output,'node_modules'));
  await writeFile(join(output,'.env'),'controlled private fixture');await expect(validateStagedSdk(output,{referenceRoot:resolve('.')})).rejects.toThrow(/private|unlisted/i);await unlink(join(output,'.env'));
  await writeFile(target,'controlled private fixture');await symlink(target,link);linked=true;
  expect(spawnSync(process.execPath,['scripts/prepare-sandbox-sdk.mjs','--built','--output',bad],{encoding:'utf8',timeout:60000}).status).not.toBe(0);
  await expect(access(bad)).rejects.toThrow();expect(await readFile(target,'utf8')).toBe('controlled private fixture');
 }finally{if(linked)await unlink(link).catch(()=>{});await rm(scratch,{recursive:true,force:true});}
},120000);
