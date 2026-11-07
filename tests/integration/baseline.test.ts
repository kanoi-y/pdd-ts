import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import os from 'node:os'; import path from 'node:path';
import { afterEach,expect,it } from 'vitest';
import { initProject } from '../../src/requirements/project.js';
import { snapshotAtCommit } from '../../src/ci/baseline.js';
import { runProcess } from '../../src/verification/process.js';
const roots:string[]=[]; afterEach(async()=>{await Promise.all(roots.map(root=>rm(root,{recursive:true,force:true})));});
it('CI-002 loads protected baseline from committed inert files, ignoring working changes',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'pdd-base-')); roots.push(root); await initProject(root);
 for(const args of [['init'],['add','.'],['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','baseline']]) expect((await runProcess('git',args,{cwd:root})).exitCode).toBe(0);
 const head=(await runProcess('git',['rev-parse','HEAD'],{cwd:root})).stdout.trim();
 const before=await snapshotAtCommit(root,head); await writeFile(path.join(root,'lemmascript.json'),'{}');
 expect((await snapshotAtCommit(root,head)).digest).toBe(before.digest);
 await expect(snapshotAtCommit(root,'HEAD; touch oops')).rejects.toThrow(/commit/);
});
