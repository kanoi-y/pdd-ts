import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import type { SpecSnapshot } from '../requirements/snapshot.js';
import type { ProcessOptions, ProcessResult } from '../verification/process.js';
import { runProcess } from '../verification/process.js';
import { snapshotAtCommit } from './baseline.js';
import { compareSpecs } from '../requirements/diff.js';

export interface ReviewCardInput { repository:string; baseSha:string; headSha:string; baseline:SpecSnapshot; head:SpecSnapshot }
export interface ReviewDependencies {
  environment?:Record<string,string|undefined>;
  run?:(command:string,args:string[],options:ProcessOptions)=>Promise<ProcessResult>;
  get?:(route:string)=>Promise<unknown>;
}
const commit = z.string().regex(/^[a-f0-9]{40}$/, 'An immutable commit is required');
const repositoryName = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const headBranch = 'codex/spec-review';
const text = (value:string):string => value
  .replace(/[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4,'0')}`)
  .replace(/[&<>"'`@\[\]]/g, char => `&#${char.charCodeAt(0)};`);
const block = (value:unknown):string => `<pre>${text(typeof value==='string'?value:JSON.stringify(value,null,2))}</pre>`;
function sourceUrl(repository:string,sha:string,file:string):string {
  if(file.startsWith('/') || file.includes('\\') || file.split('/').some(part=>!part || part==='.' || part==='..')) throw new Error('Invalid pinned source path');
  const segments=file.split('/').map(segment=>encodeURIComponent(segment).replace(/[!'()*]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`));
  return `https://github.com/${repository}/blob/${sha}/${segments.join('/')}`;
}

/** A review request only: rendering never creates proof evidence or a human approval. */
export function renderHumanReviewCard(input:ReviewCardInput):string {
  const {repository,baseSha,headSha,baseline,head}=input;
  repositoryName.parse(repository); commit.parse(baseSha); commit.parse(headSha);
  if(!baseline.complete || !head.complete) throw new Error('Both specification snapshots must be complete');
  const diff=compareSpecs(baseline,head);
  if(!diff.valid) throw new Error(diff.errors.join('; '));
  const lines=[
    '# Review the complete PDD specification',
    '',
    '**Human approval: pending.** This Bot-authored PR requests a personal GitHub review; no review has been submitted by this workflow.',
    '',
    'Confirm the current PR head equals the full head below before reviewing. A changed head requires a newly prepared card and an exact-head review.',
    '',
    `Base commit: ${baseSha}`,
    `Head commit: ${headSha}`,
    `Base specDigest: ${baseline.digest}`,
    `Head specDigest: ${head.digest}`,
    '',
    `[Pinned configuration](${sourceUrl(repository,headSha,'.pdd/config.yaml')}) · [Pinned obligations](${sourceUrl(repository,headSha,'.pdd/obligations.yaml')}) · [Pinned model profile](${sourceUrl(repository,headSha,'lemmascript.json')})`,
    '',
    'A source proof is conditional on the extracted premises, declared profile and trusted toolchain. Tests are empirical evidence for executed cases. This card executes neither candidate code nor candidate tests and supplies no proof, CI attestation or external human approval.',
    '',
    `## Requirements (${head.metadata.requirements.length})`,
  ];
  for(const requirement of [...head.metadata.requirements].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)) {
    lines.push('',`<h3>${text(requirement.id)} — revision ${requirement.revision}</h3>`,block(requirement.title),block(requirement.intent),
      `[Pinned target](${sourceUrl(repository,headSha,requirement.target.file)})`,
      block({risk:requirement.risk,target:requirement.target,contracts:requirement.contracts,acceptance:requirement.acceptance,trustedBoundaries:requirement.trustedBoundaries}));
  }
  lines.push('','## All extracted source contracts');
  for(const entry of [...head.contracts].sort((a,b)=>a.scope<b.scope?-1:a.scope>b.scope?1:0)) {
    const file=entry.scope.slice(0,entry.scope.lastIndexOf('#'));
    lines.push('',block(entry.scope),`[Pinned source](${sourceUrl(repository,headSha,file)})`,block(entry.declaration));
  }
  lines.push('','## Assumptions and runtime boundaries',block(head.metadata.config.approvedAssumptions),block(head.metadata.config.boundaries),
    '', '## Model configuration and proof targets',block(head.metadata.modelConfig),block(head.metadata.config.targets),
    '', '## Required evidence and empirical scope',block(head.metadata.obligations),block(head.metadata.config.testTargets.map(target=>({obligationId:target.obligationId,files:target.files,inputs:target.inputs,requiredCaseCount:target.requiredTests.length}))),
    '', '## Specification transition',block(diff),'',
    'Use GitHub’s review interface personally. Approval is checked later against the immutable head, allowlisted human identity and independently recomputed specification digest. This PR body is a review aid, never an approval record.','');
  const card=lines.join('\n');
  if(Buffer.byteLength(card,'utf8')>60000) throw new Error('Complete review card exceeds the bounded PR body size; do not truncate the specification');
  return card;
}

async function publicGet(route:string):Promise<unknown> {
  const response=await fetch(`https://api.github.com/${route}`,{headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(30000)});
  if(!response.ok || !response.body) throw new Error('Public GitHub identity unavailable');
  const reader=response.body.getReader(),chunks:Uint8Array[]=[]; let size=0;
  try {
    while(true) {
      const chunk=await reader.read(); if(chunk.done) break;
      size+=chunk.value.byteLength;
      if(size>1_048_576) {await reader.cancel();throw new Error('GitHub response exceeds bound');}
      chunks.push(chunk.value);
    }
  } finally {reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** Trusted main-only workflow. Candidate content is fetched and parsed as inert data. */
export async function prepareHumanReview(root:string,dependencies:ReviewDependencies={}):Promise<{url:string;approval:'pending'}> {
  const environment=dependencies.environment??process.env;
  if(environment.GITHUB_EVENT_NAME!=='workflow_dispatch' || environment.GITHUB_REF!=='refs/heads/main') throw new Error('Trusted workflow dispatch on main required');
  const baseSha=commit.parse(environment.GITHUB_SHA);
  if(!environment.GH_TOKEN) throw new Error('The trusted workflow GITHUB_TOKEN is required');
  const run=dependencies.run??runProcess,get=dependencies.get??publicGet;
  const git=async(args:string[]):Promise<string>=>{
    const result=await run('git',args,{cwd:root,timeoutMs:30000,maxOutputBytes:1_048_576});
    if(result.status!=='completed'||result.exitCode!==0) throw new Error('Inert review Git operation failed');
    return result.stdout.trim();
  };
  if(await git(['rev-parse','HEAD'])!==baseSha) throw new Error('Trusted main checkout does not match the workflow commit');
  const baseline=await snapshotAtCommit(root,baseSha);
  if(!baseline.complete) throw new Error('The protected baseline snapshot must be complete');
  const repository=repositoryName.parse(baseline.metadata.config.github?.repository);
  if(repository!==environment.GITHUB_REPOSITORY) throw new Error('Trusted repository policy does not match the workflow repository');
  const remoteRef=async(branch:string):Promise<string>=>{
    const value=z.object({ref:z.literal(`refs/heads/${branch}`),object:z.object({type:z.literal('commit'),sha:commit})}).parse(await get(`repos/${repository}/git/ref/heads/${branch}`));
    return value.object.sha;
  };
  if(await remoteRef('main')!==baseSha) throw new Error('The main baseline changed; dispatch again');
  const headSha=await remoteRef(headBranch);
  if(headSha===baseSha) throw new Error('The existing review branch has no candidate commit');
  await git(['-c','gc.auto=0','-c','maintenance.auto=false','fetch','--no-tags','--no-recurse-submodules',`https://github.com/${repository}.git`,headSha]);
  await git(['merge-base','--is-ancestor',baseSha,headSha]);
  const head=await snapshotAtCommit(root,headSha);
  const body=renderHumanReviewCard({repository,baseSha,headSha,baseline,head});
  if(await remoteRef(headBranch)!==headSha || await remoteRef('main')!==baseSha) throw new Error('The review head or baseline moved; prepare again');
  const temporary=await mkdtemp(path.join(os.tmpdir(),'pdd-human-review-'));
  try {
    const bodyFile=path.join(temporary,'review.md');
    await writeFile(bodyFile,body,{flag:'wx',mode:0o600});
    const config=path.join(temporary,'gh'); await mkdir(config);
    const publication=await run('gh',['pr','create','--repo',repository,'--base','main','--head',headBranch,'--title','Review the complete PDD specification','--body-file',bodyFile],{
      cwd:root,timeoutMs:30000,maxOutputBytes:16384,
      env:{GH_TOKEN:environment.GH_TOKEN,GH_HOST:'github.com',GH_PROMPT_DISABLED:'1',GH_CONFIG_DIR:config},redact:[environment.GH_TOKEN],
    });
    if(publication.status!=='completed'||publication.exitCode!==0) throw new Error('Bot PR creation failed; an existing PR or disabled Actions PR creation must be resolved explicitly');
    const url=publication.stdout.trim(),prefix=`https://github.com/${repository}/pull/`;
    if(!url.startsWith(prefix)||!/^\d+$/.test(url.slice(prefix.length))) throw new Error('Bot PR creation returned an invalid repository URL');
    const pull=z.object({number:z.number().int().positive(),state:z.literal('open'),user:z.object({type:z.literal('Bot')}),head:z.object({sha:commit,ref:z.literal(headBranch),repo:z.object({full_name:z.literal(repository)})}),base:z.object({sha:commit,ref:z.literal('main'),repo:z.object({full_name:z.literal(repository)})})}).parse(await get(`repos/${repository}/pulls/${url.slice(prefix.length)}`));
    if(pull.number!==Number(url.slice(prefix.length)) || pull.head.sha!==headSha || pull.base.sha!==baseSha) throw new Error('Created PR head or baseline changed; human approval remains pending');
    return {url,approval:'pending'};
  } finally {await rm(temporary,{recursive:true,force:true});}
}
