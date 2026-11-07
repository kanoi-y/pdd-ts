import { z } from 'zod';
import { loadProject } from '../requirements/project.js';
import { createSpecSnapshot } from '../requirements/snapshot.js';
import { compareSpecs } from '../requirements/diff.js';
import { writeProjectFile } from '../requirements/io.js';
import { gitIdentity } from '../cli/runs.js';
import { snapshotAtCommit } from './baseline.js';
import { checkApproval } from './approval.js';
import { GhClient } from './github.js';
export async function approveProject(root:string,pullNumber:number,baselineSha:string) {
 z.number().int().positive().parse(pullNumber);
 const identity=await gitIdentity(root);
 if(identity.dirty) throw new Error('Approval requires a clean committed checkout at the exact reviewed head');
 const current=await createSpecSnapshot(await loadProject(root));
 const baseline=await snapshotAtCommit(root,baselineSha);
 const diff=compareSpecs(baseline,current);
 if(!diff.valid) throw new Error(diff.errors.join('; '));
 const policy=baseline.metadata.config.github;
 if(!policy) throw new Error('Protected baseline has no external reviewer policy');
 const reference={repository:policy.repository,pullNumber,headSha:identity.commit,specDigest:current.digest};
 const result=await checkApproval(new GhClient(root),policy,reference,current.digest);
 if(result.status!=='approved' || result.baseSha!==baselineSha) throw new Error(`External approval invalid: ${result.reasons.join('; ') || 'baseline changed'}`);
 // This file is a reference only; every protected check must re-query GitHub.
 await writeProjectFile(root,'.pdd/approval.json',JSON.stringify({schemaVersion:1,reference,baselineSha,reviewIds:result.reviewIds},null,2)+'\n',true);
 return {schemaVersion:1,reference,baselineSha,diff,approval:result};
}
