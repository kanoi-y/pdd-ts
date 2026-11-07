import {expect,it} from 'vitest';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {restoreCandidateEvidence} from '../../src/ci/publish.js';

it('CI-007 restores verification artifacts exclusively without precreating or overwriting evidence',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'pdd-publisher-'));
 try{
  const source=path.join(root,'.tools/candidate-artifacts');
  const candidate=path.join(root,'candidate');
  await mkdir(path.join(source,'run/proof'),{recursive:true});
  await mkdir(path.join(candidate,'.pdd'),{recursive:true});
  await writeFile(path.join(source,'run/manifest.json'),'original manifest\n');
  await writeFile(path.join(source,'run/proof/members.log'),'original verifier bytes\n');
  await restoreCandidateEvidence(root,candidate);
  expect(await readFile(path.join(candidate,'.pdd/evidence/run/manifest.json'),'utf8')).toBe('original manifest\n');
  expect(await readFile(path.join(candidate,'.pdd/evidence/run/proof/members.log'),'utf8')).toBe('original verifier bytes\n');
  await writeFile(path.join(source,'run/manifest.json'),'replacement\n');
  await expect(restoreCandidateEvidence(root,candidate)).rejects.toMatchObject({code:'ERR_FS_CP_EEXIST'});
  expect(await readFile(path.join(candidate,'.pdd/evidence/run/manifest.json'),'utf8')).toBe('original manifest\n');
  const existing=path.join(root,'existing');
  await mkdir(path.join(existing,'.pdd/evidence'),{recursive:true});
  await expect(restoreCandidateEvidence(root,existing)).rejects.toMatchObject({code:'ERR_FS_CP_EEXIST'});
 }finally{await rm(root,{recursive:true,force:true});}
});
