import { mkdtemp,mkdir,rm } from 'node:fs/promises';
import os from 'node:os'; import path from 'node:path';
import { runProcess } from '../verification/process.js';
import { writeProjectFile } from '../requirements/io.js';
import { loadProject } from '../requirements/project.js';
import { createSpecSnapshot } from '../requirements/snapshot.js';
import type { SpecSnapshot } from '../requirements/snapshot.js';
/** Reconstitutes only bounded regular metadata/TS blobs. No checkout hooks or candidate scripts. */
export async function snapshotAtCommit(repositoryRoot:string,commit:string):Promise<SpecSnapshot> {
 if(!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(commit)) throw new Error('An immutable commit is required');
 const tree=await runProcess('git',['ls-tree','-r','-z',commit],{cwd:repositoryRoot,maxOutputBytes:4_194_304});
 if(tree.exitCode!==0 || tree.status!=='completed') throw new Error('Protected commit unavailable');
 const entries=tree.stdout.split('\0').filter(Boolean).map(line=>{const tab=line.indexOf('\t');return {mode:line.slice(0,6),name:line.slice(tab+1)};});
 if(entries.length>2000) throw new Error('Baseline file limit exceeded');
 const temporary=await mkdtemp(path.join(os.tmpdir(),'pdd-baseline-'));
 try {
  await mkdir(path.join(temporary,'.pdd/requirements'),{recursive:true});
  for(const entry of entries) {
   if(!['100644','100755'].includes(entry.mode)) throw new Error('Baseline contains a non-regular specification input');
   const blob=await runProcess('git',['show',`${commit}:${entry.name}`],{cwd:repositoryRoot,maxOutputBytes:1_048_576});
   if(blob.exitCode!==0 || blob.status!=='completed') throw new Error('Baseline input unavailable or too large');
   await writeProjectFile(temporary,entry.name,blob.stdout);
  }
  return await createSpecSnapshot(await loadProject(temporary));
 } finally {await rm(temporary,{recursive:true,force:true});}
}
