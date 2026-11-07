import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { initProject } from '../../src/requirements/project.js';
import { snapshotAtCommit } from '../../src/ci/baseline.js';
import { runProcess } from '../../src/verification/process.js';
import type { ProcessOptions, ProcessResult } from '../../src/verification/process.js';
import type { SpecSnapshot } from '../../src/requirements/snapshot.js';
import { prepareHumanReview, renderHumanReviewCard } from '../../src/ci/review.js';

let root: string, baseSha: string, headSha: string, baseline: SpecSnapshot, head: SpecSnapshot;
const repository = 'fixture/review';
const success = (stdout = ''): ProcessResult => ({ status: 'completed', exitCode: 0, stdout, stderr: '', signal: null, error: null, durationMs: 0 });
const env = () => ({ GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: baseSha, GITHUB_REPOSITORY: repository, GH_TOKEN: 'fixture-secret' });
beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'pdd-review-card-'));
  await initProject(root);
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src/decision.ts'), '//@ contract Keep the enabled decision.\n//@ requires enabled === true\n//@ ensures \\result === enabled\nexport function decision(enabled: boolean): boolean { return enabled; }\n');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: { postinstall: 'touch CANDIDATE_EXECUTED', build: 'touch CANDIDATE_EXECUTED' } }));
  await writeFile(path.join(root, '.pdd/config.yaml'), stringify({ schemaVersion: 1, tools: {}, approvedAssumptions: ['profile:pdd-pure-v1'], targets: [{file: 'src/decision.ts', symbol: 'decision', witnesses: [{enabled: true}]}], github: { repository, repositoryId: 1, reviewerIds: [7], minApprovals: 1, workflow: '.github/workflows/pdd.yml', checkContext: 'PDD protected gate', checkAppId: 9 } }));
  for (let index = 1; index <= 11; index++) {
    const id = `REVIEW-${String(index).padStart(3, '0')}`;
    await writeFile(path.join(root, `.pdd/requirements/${id}.yaml`), stringify({ id, revision: 1, title: `Requirement ${index}`, intent: index === 11 ? 'Literal <script>alert(1)</script> [unsafe](javascript:bad) @everyone `ticks`' : `Keep intent ${index}`, risk: 'high', target: {file: 'src/decision.ts', symbol: 'decision'}, contracts: [{id:`${id}-C1`,kind:'postcondition',human:'Preserve the enabled value.',sourceRef:{file:'src/decision.ts',symbol:'decision',clause:'ensures',index:0},semantics:'boolean-equality-v1'}], acceptance:[],trustedBoundaries:[] }));
  }
  for (const args of [['init'], ['add', '.'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'base']]) {
    expect((await runProcess('git', args, {cwd:root})).exitCode).toBe(0);
  }
  baseSha = (await runProcess('git', ['rev-parse', 'HEAD'], {cwd:root})).stdout.trim();
  await writeFile(path.join(root, 'README.md'), 'A review candidate, no specification change.\n');
  for (const args of [['add', '.'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'candidate']]) expect((await runProcess('git', args, {cwd:root})).exitCode).toBe(0);
  headSha = (await runProcess('git', ['rev-parse', 'HEAD'], {cwd:root})).stdout.trim();
  baseline = await snapshotAtCommit(root, baseSha);
  head = await snapshotAtCommit(root, headSha);
});
afterAll(async () => { if (root) await rm(root, {recursive:true,force:true}); });

describe('CI-001 human specification review preparation', () => {
  it('renders immutable complete specifications, every intent and every extracted clause without approving them', () => {
    const input = {repository,baseSha,headSha,baseline,head};
    const card = renderHumanReviewCard(input);
    expect(card).toBe(renderHumanReviewCard(input));
    for (const value of [head.digest,baseSha,headSha,'enabled === true','\\result === enabled']) expect(card).toContain(value);
    for (let index=1;index<=11;index++) expect(card).toContain(`REVIEW-${String(index).padStart(3,'0')}`);
    expect(card).toContain('改訂 1');
    expect(card).toContain('人間の承認：未完了');
    expect(card).toContain('前提の下で成立');
    expect(card).toContain('経験的な証拠');
    expect(card).toContain('## 抽出したすべてのソース契約');
    expect(card).toContain('## 前提・仮定と実行時の信頼境界');
    expect(card).not.toContain('Review the complete PDD specification');
    expect(card).toContain(`https://github.com/${repository}/blob/${headSha}/src/decision.ts`);
    expect(card).toContain(`https://github.com/${repository}/blob/${headSha}/.pdd/config.yaml`);
    expect(card).not.toContain('<script>');
    expect(card).not.toContain('[unsafe](javascript:bad)');
    expect(card).not.toContain('@everyone');
  });

  it('rejects incomplete snapshots, invalid revision transitions and mutable identities', () => {
    expect(() => renderHumanReviewCard({repository,baseSha,headSha,baseline,head:{...head,complete:false,errors:['missing clause']}})).toThrow(/complete/);
    const changed = structuredClone(head);
    changed.metadata.requirements[0]!.intent = 'Changed without revision';
    expect(() => renderHumanReviewCard({repository,baseSha,headSha,baseline,head:changed})).toThrow(/revision/i);
    expect(() => renderHumanReviewCard({repository,baseSha,headSha:'codex/spec-review',baseline,head})).toThrow(/commit/i);
  });

  it('escapes parentheses in pinned source URLs and refuses to truncate an oversized specification', () => {
    const withPath=structuredClone(head);
    withPath.contracts[0]!.scope='src/decision)(.ts#decision';
    const card=renderHumanReviewCard({repository,baseSha,headSha,baseline:withPath,head:withPath});
    expect(card).toContain(`/src/decision%29%28.ts`);
    expect(card).not.toContain(`/src/decision)(.ts`);
    const oversized=structuredClone(head);
    oversized.metadata.requirements[0]!.intent='x'.repeat(60001);
    expect(()=>renderHumanReviewCard({repository,baseSha,headSha,baseline:oversized,head:oversized})).toThrow(/size|bound|truncate/i);
  });

  it.each([
    {GITHUB_EVENT_NAME:'pull_request'}, {GITHUB_REF:'refs/heads/codex/spec-review'}, {GITHUB_SHA:'main'},
  ])('rejects untrusted authority before any I/O: %j', async change => {
    let calls=0;
    await expect(prepareHumanReview(root,{environment:{...env(),...change},run:async()=>{calls++;throw new Error('Unexpected I/O');},get:async()=>{calls++;throw new Error('Unexpected I/O');}})).rejects.toThrow(/trusted|main|commit/i);
    expect(calls).toBe(0);
  });

  it('fetches only inert pinned data and creates a Bot PR with the exact temporary body file', async () => {
    const commands: {command:string;args:string[];options:ProcessOptions}[]=[];
    let actualBody='';
    const run=async(command:string,args:string[],options:ProcessOptions) => {
      commands.push({command,args,options});
      if(command==='gh') {
        actualBody=await readFile(args[args.indexOf('--body-file')+1]!, 'utf8');
        return success(`https://github.com/${repository}/pull/12\n`);
      }
      if(args.includes('fetch')) return success();
      if(args.includes('rev-parse')) return success(`${baseSha}\n`);
      return await runProcess(command,args,options);
    };
    const get=async(route:string) => route.includes('/pulls/')
      ? {number:12,state:'open',user:{type:'Bot'},head:{sha:headSha,ref:'codex/spec-review',repo:{full_name:repository}},base:{sha:baseSha,ref:'main',repo:{full_name:repository}}}
      : {ref:route.endsWith('/main')?'refs/heads/main':'refs/heads/codex/spec-review',object:{type:'commit',sha:route.endsWith('/main')?baseSha:headSha}};
    const result=await prepareHumanReview(root,{environment:env(),run,get});
    expect(result.url).toBe(`https://github.com/${repository}/pull/12`);
    expect(result.approval).toBe('pending');
    expect(actualBody).toContain(head.digest);
    const publication=commands.filter(item=>item.command==='gh');
    expect(publication).toHaveLength(1);
    expect(publication[0]!.args.slice(0,2)).toEqual(['pr','create']);
    expect(publication[0]!.args).toContain('codex/spec-review');
    expect(publication[0]!.options.env?.GH_TOKEN).toBe('fixture-secret');
    expect(commands.filter(item=>item.command!=='gh').every(item=>!item.options.env?.GH_TOKEN)).toBe(true);
    expect(commands.find(item=>item.args.includes('fetch'))!.args).toContain(headSha);
    await expect(readFile(path.join(root,'CANDIDATE_EXECUTED'))).rejects.toThrow();
    await expect(readFile(publication[0]!.args[publication[0]!.args.indexOf('--body-file')+1]!)).rejects.toThrow();
  });

  it('fails before creating a PR when the fixed remote branch moves', async () => {
    let headQueries=0,publications=0;
    const run=async(command:string,args:string[],options:ProcessOptions)=>{
      if(command==='gh'){publications++;return success();}
      if(args.includes('fetch'))return success();
      if(args.includes('rev-parse'))return success(`${baseSha}\n`);
      return await runProcess(command,args,options);
    };
    const get=async(route:string)=>({ref:route.endsWith('/main')?'refs/heads/main':'refs/heads/codex/spec-review',object:{type:'commit',sha:route.endsWith('/main')?baseSha:(++headQueries===1?headSha:'f'.repeat(40))}});
    await expect(prepareHumanReview(root,{environment:env(),run,get})).rejects.toThrow(/changed|moved/i);
    expect(publications).toBe(0);
  });
});
