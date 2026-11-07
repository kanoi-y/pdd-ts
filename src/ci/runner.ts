import {mkdir,readFile,writeFile,symlink} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {runProcess} from '../verification/process.js';
import {createSpecSnapshot} from '../requirements/snapshot.js';
import {compareSpecs} from '../requirements/diff.js';
import {loadProject} from '../requirements/project.js';
import {verifyProject,gitIdentity} from '../cli/runs.js';
import {checkApproval} from './approval.js';
import {snapshotAtCommit} from './baseline.js';
import type {GitHubClient} from './github.js';
class PublicClient implements GitHubClient {
 async get(route:string) {const response=await fetch(`https://api.github.com/${route}`,{headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('Public GitHub API unavailable');return await response.json();}
}
/** Run only from a trusted default-branch checkout in a credential-free, disposable worker. */
export async function runTrustedCandidate(trustedRoot:string,pullNumber:number):Promise<void> {
 z.number().int().nonnegative().parse(pullNumber);
 if(process.env.GITHUB_EVENT_NAME!=='workflow_dispatch' || process.env.GITHUB_REF!=='refs/heads/main') throw new Error('Trusted workflow dispatch on main required');
 const baselineSha=(await gitIdentity(trustedRoot)).commit;
 const baseline=await snapshotAtCommit(trustedRoot,baselineSha),policy=baseline.metadata.config.github;
 if(!policy?.repositoryId) throw new Error('Protected repository policy missing');
 const client=new PublicClient(); let candidateSha=baselineSha;
 const candidate=path.join(trustedRoot,'.tools/ci-candidate');
 const git=async(args:string[],cwd=trustedRoot)=>{const result=await runProcess('git',args,{cwd,maxOutputBytes:16_777_216});if(result.status!=='completed'||result.exitCode!==0) throw new Error('Candidate Git operation failed');return result.stdout;};
 if(pullNumber) {
  const pull=z.object({head:z.object({sha:z.string().regex(/^[a-f0-9]{40}$/)}),base:z.object({sha:z.string()})}).parse(await client.get(`repos/${policy.repository}/pulls/${pullNumber}`));
  if(pull.base.sha!==baselineSha) throw new Error('Pull request baseline changed'); candidateSha=pull.head.sha;
  await git(['fetch','--no-tags',`https://github.com/${policy.repository}.git`,candidateSha]);
  const proposed=await snapshotAtCommit(trustedRoot,candidateSha),diff=compareSpecs(baseline,proposed);
  if(!diff.valid) throw new Error(diff.errors.join('; '));
  const approval=await checkApproval(client,policy,{repository:policy.repository,pullNumber,headSha:candidateSha,specDigest:proposed.digest},proposed.digest);
  if(approval.status!=='approved') throw new Error('Exact-head external human approval is required before executing candidate tests');
 }
 const tree=await git(['ls-tree','-r','-z',candidateSha]);
 const entries=tree.split('\0').filter(Boolean).map(line=>({mode:line.slice(0,6),name:line.slice(line.indexOf('\t')+1)}));
 if(entries.length>10000 || entries.some(entry=>!['100644','100755'].includes(entry.mode))) throw new Error('Candidate symlinks, submodules or excessive tree are unsupported');
 await mkdir(candidate,{recursive:false});
 await git(['init'],candidate); await git(['fetch','--no-tags',`https://github.com/${policy.repository}.git`,candidateSha],candidate);
 await git(['checkout','--detach',candidateSha],candidate); // fresh Git configuration, no candidate hooks/filter commands
 const project=await loadProject(candidate);
 if(Object.keys(project.config.tools).length) throw new Error('Candidate executable tool overrides are forbidden in trusted CI');
 // No project install/hooks/scripts. Fixed verifier/Vitest code comes from trustedRoot.
 // Empirical code is reviewed but remains an explicit test-harness/runtime trust boundary.
 const snapshot=await createSpecSnapshot(project);
 const tools=path.join(trustedRoot,'.tools/dafny-4.11.0/dafny');
 await mkdir(path.join(candidate,'.tools'),{recursive:true});
 await symlink(path.join(trustedRoot,'.tools/dafny-4.11.0'),path.join(candidate,'.tools/dafny-4.11.0'));
 process.env.PDD_TEST_SANDBOX='1';
 const previousPath=process.env.PATH;process.env.PATH=tools+path.delimiter+previousPath;
 let packet;try {packet=await verifyProject(candidate);}finally {if(previousPath===undefined)delete process.env.PATH;else process.env.PATH=previousPath;}
 const manifest=JSON.parse(await readFile(path.join(candidate,`.pdd/evidence/${packet.runId}/manifest.json`),'utf8'));
 if(packet.gate.status!=='trial' || !snapshot.complete) throw new Error('Candidate evidence incomplete');
 const claim={schemaVersion:1,repositoryId:policy.repositoryId,candidateSha,baselineSha,runId:process.env.GITHUB_RUN_ID,runAttempt:Number(process.env.GITHUB_RUN_ATTEMPT),specDigest:snapshot.digest,manifest};
 await mkdir(path.join(trustedRoot,'.tools/attestation'),{recursive:true});
 await writeFile(path.join(trustedRoot,'.tools/attestation/evidence.json'),JSON.stringify(claim,null,2)+'\n',{flag:'wx'});
 console.log('Generated trial report; external approval remains separately checked by audit --ci');
}
