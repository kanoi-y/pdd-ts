import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { z } from 'zod';
import type { SpecSnapshot } from '../requirements/snapshot.js';
import type { ProcessOptions, ProcessResult } from '../verification/process.js';
import { runProcess } from '../verification/process.js';
import { snapshotAtCommit } from './baseline.js';
import { compareSpecs } from '../requirements/diff.js';
import { canonicalJson } from '../requirements/io.js';
import { validateBoundaries } from '../verification/boundaries.js';

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
  const assumptions=(snapshot:SpecSnapshot):Set<string>=>new Set([
    ...snapshot.metadata.config.approvedAssumptions,
    ...snapshot.metadata.config.boundaries.flatMap(boundary=>boundary.assumption?[boundary.assumption]:[]),
  ]);
  const previousAssumptions=assumptions(baseline);
  const addedAssumptions=[...assumptions(head)].filter(value=>!previousAssumptions.has(value));
  const unapprovedAssumptions=[...new Set(head.metadata.config.boundaries.flatMap(boundary=>
    boundary.assumption&&!head.metadata.config.approvedAssumptions.includes(boundary.assumption)?[boundary.assumption]:[]))];
  const beforeContracts=new Map(baseline.contracts.map(entry=>[entry.scope,entry.declaration]));
  const afterContracts=new Map(head.contracts.map(entry=>[entry.scope,entry.declaration]));
  const changedScopes=[...new Set([...beforeContracts.keys(),...afterContracts.keys()])]
    .filter(scope=>canonicalJson(beforeContracts.get(scope)??null)!==canonicalJson(afterContracts.get(scope)??null));
  const registrationProblems=validateBoundaries({root:'',...head.metadata});
  const lines=[
    '# PDDレビュー',
    '',
    '**人間の承認：未完了。検証結果：未取得。**',
    '',
    '## 今回確認すること',
    '',
    `- 仕様差分：${diff.changed?'あり':'なし'}`,
    `- 要件の影響範囲：既存 ${diff.affectedRequirements.length}件、追加 ${diff.addedRequirements.length}件、削除 ${diff.deletedRequirements.length}件`,
    `- 検証条件・モデル設定の変更：${diff.policyChanged?'あり':'なし'}`,
    `- 登録：要件 ${head.metadata.requirements.length}件、ソース証明 ${head.metadata.obligations.filter(item=>item.kind==='source-proof').length}件、テスト義務 ${head.metadata.obligations.filter(item=>item.kind==='test').length}件`,
    '',
    `対象コミット： ${headSha}`,
    `[コード差分](https://github.com/${repository}/compare/${baseSha}...${headSha})`,
    '',
    diff.changed?'変更された意図・契約・入力前提・信頼前提・必須検証を確認してください。':'定義した仕様は同一です。今回のコード差分とCI結果を確認してください。',
  ];
  const high=head.metadata.requirements.filter(r=>r.risk==='high');
  if(high.length)lines.push('', '## 高リスク変更の確認', '- [ ] 主要Diff・入力条件・認可/外部境界・失敗後の状態を確認する。', '- [ ] 有限状態モデルの結果とコードの証明・実行テストを区別する。Atlas差分はreview --previousで根拠と比較する。', '- [ ] 未決の仕様はplanの判断カードへ戻す。作者の回答は本人承認ではない。');
  if(addedAssumptions.length) lines.push('','**追加された信頼前提（要確認）**',block(addedAssumptions));
  if(unapprovedAssumptions.length) lines.push('','**未許可の信頼前提**',block(unapprovedAssumptions));
  if(diff.deletedRequirements.length) lines.push('','**削除される要件**',block(diff.deletedRequirements));
  if(diff.deletedObligations.length) lines.push('','**削除される必須検証**',block(diff.deletedObligations));
  for(const scope of changedScopes) {
    const before=beforeContracts.get(scope),after=afterContracts.get(scope),file=scope.slice(0,scope.lastIndexOf('#'));
    lines.push('',`契約変更：[${text(scope)}](${sourceUrl(repository,after?headSha:baseSha,file)})`);
    if(!after) lines.push('**契約対象から削除されます。**');
    for(const [key,label] of [['requires','入力前提'],['ensures','事後条件']] as const) {
      const added=(after?.[key]??[]).filter(value=>!before?.[key].includes(value));
      const removed=(before?.[key]??[]).filter(value=>!after?.[key].includes(value));
      if(added.length) lines.push(`${label}を追加：`,block(added));
      if(removed.length) lines.push(`${label}を削除：`,block(removed));
    }
  }
  if(registrationProblems.length) lines.push('','**登録上の確認事項（ゲートで別途検査）**',block(registrationProblems));
  lines.push('',
    'ソース証明は宣言した前提の下で成立し、テストは実行したケースの経験的な証拠です。このカードはコードやテストを実行しません。本人承認とCI結果は別途確認します。',
    '',
    '<details>',
    '<summary>完全な仕様・契約・検証登録を表示</summary>',
    '',
    '全要件・抽出契約と固定した設定へのリンクを収録しています。必須テストの個別名は設定リンクから確認できます。対象コミットが変わった場合は再生成し、そのheadに対してレビューしてください。',
    '',
    `基準コミット： ${baseSha}`,
    `対象コミット： ${headSha}`,
    `基準の仕様ダイジェスト： ${baseline.digest}`,
    `対象の仕様ダイジェスト： ${head.digest}`,
    '',
    `[対象コミットの設定](${sourceUrl(repository,headSha,'.pdd/config.yaml')}) · [対象コミットの必須検証一覧](${sourceUrl(repository,headSha,'.pdd/obligations.yaml')}) · [対象コミットの意味論プロファイル](${sourceUrl(repository,headSha,'lemmascript.json')})`,
    '',
    'ソース証明は、抽出した前提・宣言した意味論プロファイル・信頼するツールチェーンという前提の下で成立します。テストは、実行したケースについての経験的な証拠です。このカード自体は候補コードやテストを実行せず、証明・CI署名・人間承認の証拠にはなりません。',
    '',
    `## 要件（${head.metadata.requirements.length}件）`,
  );
  for(const requirement of [...head.metadata.requirements].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)) {
    lines.push('',`<h3>${text(requirement.id)} — 改訂 ${requirement.revision}</h3>`,block(requirement.title),block(requirement.intent),
      `[対象コミットの実装](${sourceUrl(repository,headSha,requirement.target.file)})`,
      block({risk:requirement.risk,target:requirement.target,contracts:requirement.contracts,acceptance:requirement.acceptance,trustedBoundaries:requirement.trustedBoundaries}));
  }
  lines.push('','## 抽出したすべてのソース契約');
  for(const entry of [...head.contracts].sort((a,b)=>a.scope<b.scope?-1:a.scope>b.scope?1:0)) {
    const file=entry.scope.slice(0,entry.scope.lastIndexOf('#'));
    lines.push('',block(entry.scope),`[対象コミットのソース](${sourceUrl(repository,headSha,file)})`,block(entry.declaration));
  }
  if(head.models)lines.push('', '## 有限状態モデルと実装の対応（コードの証明ではありません）',block(head.models));
  if(head.workflow)lines.push('', '## 作者が記録した仕様判断と根拠', '回答の記録は本人認証ではありません。この対象へのレビューで内容を確認してください。',block(head.workflow));
  const inputSets:{id:string;files:string[]}[]=[];const inputIds=new Map<string,string>();
  const testScopes=head.metadata.config.testTargets.map(target=>{const key=canonicalJson(target.inputs);let id=inputIds.get(key);if(!id){id=`I${inputSets.length+1}`;inputIds.set(key,id);inputSets.push({id,files:target.inputs});}return {obligationId:target.obligationId,files:target.files,inputSetId:id,requiredCaseCount:target.requiredTests.length};});
  lines.push('','## 前提・仮定と実行時の信頼境界',block(head.metadata.config.approvedAssumptions),block(head.metadata.config.boundaries),
    '', '## モデル設定と証明対象',block(head.metadata.modelConfig),block(head.metadata.config.targets),
    '', '## 必須の証拠とテスト範囲',block(head.metadata.obligations),block(testScopes), '', '## 検証入力の共通一覧（各inputSetIdの全ファイル）',block(inputSets),
    '', '## 基準からの仕様変更',block(diff),'',
    'GitHubのレビュー画面から、ご本人としてレビューしてください。承認は後続処理で、対象コミット・許可された本人のID・独立に再計算した仕様ダイジェストに照合されます。このPR本文はレビューの補助資料であり、承認記録ではありません。','','</details>','');
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
    const publication=await run('gh',['pr','create','--repo',repository,'--base','main','--head',headBranch,'--title','変更内容をレビューする（PDD）','--body-file',bodyFile],{
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
