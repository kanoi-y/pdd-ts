import {cp,mkdir,readFile,writeFile,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {z} from 'zod';
import {GhClient} from './github.js';
import {snapshotAtCommit} from './baseline.js';
import {gitIdentity} from '../cli/runs.js';
import {loadProject} from '../requirements/project.js';
import {attestedIdentitySchema} from './provenance.js';
import {auditCI} from './audit.js';
import {runProcess} from '../verification/process.js';
/** Trusted publisher: candidate blobs are parsed, never executed with this job's token. */
export async function publishTrustedCheck(trustedRoot:string,pullNumber:number):Promise<void> {
 z.number().int().positive().parse(pullNumber);
 if(process.env.GITHUB_REF!=='refs/heads/main' || process.env.GITHUB_EVENT_NAME!=='workflow_dispatch') throw new Error('Trusted main dispatch required');
 const baselineSha=(await gitIdentity(trustedRoot)).commit;
 const baseline=await snapshotAtCommit(trustedRoot,baselineSha),policy=baseline.metadata.config.github;
 if(!policy?.repositoryId || !policy.checkAppId || policy.checkAppId===15368) throw new Error('A dedicated publisher GitHub App issuer is required in protected policy');
 const client=new GhClient(trustedRoot);
 const pull=z.object({head:z.object({sha:z.string().regex(/^[a-f0-9]{40}$/)})}).parse(await client.get(`repos/${policy.repository}/pulls/${pullNumber}`));
 let conclusion:'success'|'failure'='failure'; let summary='Required authenticated evidence or current external approval is unavailable.';
 try {
  const claim=attestedIdentitySchema.parse(JSON.parse(await readFile(path.join(trustedRoot,'.tools/signed/evidence.json'),'utf8')));
  if(claim.candidateSha!==pull.head.sha || claim.baselineSha!==baselineSha) throw new Error('Candidate or baseline changed');
  const candidate=path.join(trustedRoot,'.tools/publisher-candidate');await mkdir(candidate,{recursive:false});
  const git=async(args:string[],cwd=candidate)=>{const result=await runProcess('git',args,{cwd,maxOutputBytes:16_777_216});if(result.exitCode!==0||result.status!=='completed')throw new Error('Candidate Git read failed');return result.stdout;};
  await git(['init']); await git(['fetch','--no-tags',`https://github.com/${policy.repository}.git`,claim.candidateSha]);
  const tree=await git(['ls-tree','-r','-z',claim.candidateSha]);
  const entries=tree.split('\0').filter(Boolean);
  if(entries.length>10000 || entries.some(entry=>!['100644','100755'].includes(entry.slice(0,6)))) throw new Error('Candidate tree is unsupported');
  await git(['checkout','--detach',claim.candidateSha]);
  const project=await loadProject(candidate);
  if(Object.keys(project.config.tools).length) throw new Error('Untrusted executable configuration rejected');
  await mkdir(path.join(candidate,'.tools'),{recursive:true});
  await symlink(path.join(trustedRoot,'.tools/dafny-4.11.0'),path.join(candidate,'.tools/dafny-4.11.0'));
  await restoreCandidateEvidence(trustedRoot,candidate);
  await cp(path.join(trustedRoot,'.tools/signed/evidence.json'),path.join(candidate,'.pdd/evidence/attested-evidence.json'));
  const packet=await auditCI(candidate,baselineSha,pullNumber,'.pdd/evidence/attested-evidence.json');
  if(packet.gate.status!=='passed') throw new Error('Protected gate unsatisfied');
  conclusion='success'; summary='Native signature, exact candidate and baseline, current human reviews, required obligations and all input/artifact hashes verified.';
 }catch{ /* Publish a fixed failure message without copying untrusted diagnostics/secrets. */ }
 const body={name:policy.checkContext,head_sha:pull.head.sha,status:'completed',conclusion,output:{title:conclusion==='success'?'Authenticated PDD evidence accepted':'PDD evidence blocked',summary}};
 const bodyFile=path.join(trustedRoot,'.tools/check-request.json');await writeFile(bodyFile,JSON.stringify(body));
 const env:Record<string,string>={HOME:os.homedir(),GH_PROMPT_DISABLED:'1'};if(process.env.GH_TOKEN)env.GH_TOKEN=process.env.GH_TOKEN;
 const result=await runProcess('gh',['api','--hostname','github.com','--method','POST',`repos/${policy.repository}/check-runs`,'--input',bodyFile],{cwd:trustedRoot,env});
 if(result.exitCode!==0||result.status!=='completed') throw new Error('Required check publication unavailable');
 const published=z.object({app:z.object({id:z.number()})}).parse(JSON.parse(result.stdout));
 if(published.app.id!==policy.checkAppId) throw new Error('Published check has the wrong App issuer; it cannot satisfy the protected policy');
 if(conclusion!=='success') throw new Error('Protected PDD gate blocked');
}

/** Restore verified-job bytes exclusively; candidate files must never be overwritten. */
export async function restoreCandidateEvidence(trustedRoot:string,candidate:string):Promise<void> {
 await cp(path.join(trustedRoot,'.tools/candidate-artifacts'),path.join(candidate,'.pdd/evidence'),{recursive:true,errorOnExist:true,force:false});
}
