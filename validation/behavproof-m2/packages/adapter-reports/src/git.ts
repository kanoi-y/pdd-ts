import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { hash, hashBytes, safeRead, safeReadJson, RelativePathSchema, type EvidenceSubject } from '@behavproof/core';
const exec=promisify(execFile);
async function git(root:string,args:string[]):Promise<string>{return (await exec('git',['-c','core.fsmonitor=false',...args],{cwd:root,encoding:'utf8',timeout:30000,maxBuffer:10*1024*1024,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}})).stdout;}
export async function sourceTreeHash(root:string,paths:readonly string[]):Promise<string>{const unique=[...new Set(paths)].sort();if(unique.length!==paths.length)throw new Error('Duplicate input path');const entries=await Promise.all(unique.map(async p=>({path:RelativePathSchema.parse(p),sha256:hashBytes(await safeRead(root,p))})));return hash(entries);}
export type DiffFile={path:string;previousPath?:string;kind:string;lines:number[];ambiguous:boolean};
export type GitDiff={status:'known'|'unknown';baseSha:string;headSha:string;diffBaseSha?:string;files:DiffFile[];reason?:string};
export async function gitDiff(root:string,base:string,head:string):Promise<GitDiff>{
 const baseSha=(await git(root,['rev-parse','--verify',`${base}^{commit}`])).trim(),headSha=(await git(root,['rev-parse','--verify',`${head}^{commit}`])).trim();let diffBaseSha:string;
 try{diffBaseSha=(await git(root,['merge-base',baseSha,headSha])).trim();if(!diffBaseSha)throw new Error('No merge base');}catch{return {status:'unknown',baseSha,headSha,files:[],reason:'Missing merge base'};}
 const names=(await git(root,['diff','--relative','--no-ext-diff','--find-renames','--name-status','-z',diffBaseSha,headSha,'--'])).split('\0');const files:DiffFile[]=[];
 for(let i=0;i<names.length-1;){const status=names[i++]!;const first=names[i++]!;const rename=status.startsWith('R')||status.startsWith('C');const name=rename?names[i++]!:first;RelativePathSchema.parse(name);if(rename)RelativePathSchema.parse(first);const lines:number[]=[];let ambiguous=false;
 if(!status.startsWith('D')){const patch=await git(root,['diff','--relative','--no-ext-diff','--no-textconv','--no-color','--find-renames','--unified=0',diffBaseSha,headSha,'--',...(rename?[`:(literal)${first}`]:[]),`:(literal)${name}`]);if(patch.includes('Binary files ')||patch.includes('GIT binary patch'))ambiguous=true;for(const match of patch.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)){const start=Number(match[1]),n=match[2]===undefined?1:Number(match[2]);for(let l=start;l<start+n;l++)lines.push(l);}}
 files.push({path:name,...(rename?{previousPath:first}:{}),kind:status,lines,ambiguous});}
 return {status:'known',baseSha,headSha,diffBaseSha,files};
}
export async function detectProject(root:string):Promise<{support:'single-package'|'monorepo'|'unsupported';evidence:string[];reasons:string[]}>{
 const evidence:string[]=[],reasons:string[]=[];let pkg:Record<string,unknown>;try{const value=await safeReadJson(root,'package.json');if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Invalid package');pkg=value as Record<string,unknown>;evidence.push('package.json');}catch{return {support:'unsupported',evidence,reasons:['Missing, invalid or unsafe package.json']};}
 const names=await readdir(root);for(const name of ['package-lock.json','pnpm-lock.yaml','yarn.lock','bun.lock','vitest.config.ts','vitest.config.js','vitest.config.mts','vitest.config.mjs'])if(names.includes(name))evidence.push(name);
 try{await access(join(root,'.github','workflows'));evidence.push('.github/workflows');}catch{}
 try{await git(root,['rev-parse','--show-toplevel']);evidence.push('git');}catch{reasons.push('Git repository not found');}
 const workspaceMarkers=['pnpm-workspace.yaml','lerna.json','rush.json','nx.json','turbo.json'];let layout=Boolean(pkg.workspaces)||workspaceMarkers.some(name=>names.includes(name));
 if(names.includes('packages')){try{const children=await readdir(join(root,'packages'));for(const child of children){try{await safeRead(root,`packages/${child}/package.json`);layout=true;break;}catch{}}}catch{}}
 if(layout){reasons.push('Workspace or monorepo layout is detected but unsupported');return {support:'monorepo',evidence,reasons};}
 const deps=[pkg.dependencies,pkg.devDependencies,pkg.optionalDependencies].filter(v=>v&&typeof v==='object'&&!Array.isArray(v)) as Record<string,unknown>[];
 const vitest=deps.some(d=>typeof d.vitest==='string'&&d.vitest.length>0);if(vitest)evidence.push('vitest dependency');else reasons.push('Vitest dependency not established; other runners are unsupported');
 const scripts=pkg.scripts&&typeof pkg.scripts==='object'&&!Array.isArray(pkg.scripts)?pkg.scripts as Record<string,unknown>:{};if(typeof scripts.test!=='string'||!/^\s*vitest(?:\s+run)?\s*$/.test(scripts.test))reasons.push('Selected test script uses an unsupported or unverified runner');
 const engines=pkg.engines&&typeof pkg.engines==='object'&&!Array.isArray(pkg.engines)?pkg.engines as Record<string,unknown>:{};
 if(vitest||typeof engines.node==='string'||names.some(n=>['package-lock.json','pnpm-lock.yaml','yarn.lock','bun.lock'].includes(n)))evidence.push('Node.js project');else reasons.push('Node.js project not established');
 return {support:reasons.length?'unsupported':'single-package',evidence,reasons};
}
export async function gitSubject(root:string,inputPaths:readonly string[],prHead?:string,base?:string):Promise<EvidenceSubject>{
 const testedCommitSha=(await git(root,['rev-parse','--verify','HEAD^{commit}'])).trim();const dirtyStatus=Boolean((await git(root,['status','--porcelain=v1','-z','--',...inputPaths.map(p=>`:(literal)${RelativePathSchema.parse(p)}`)])).length);let untracked=false;for(const p of inputPaths){const tracked=await git(root,['ls-files','-z','--',`:(literal)${p}`]);if(!tracked)untracked=true;}const dirty=dirtyStatus||untracked;const source=await sourceTreeHash(root,inputPaths);let extra:Partial<EvidenceSubject>={};if(Boolean(prHead)!==Boolean(base))throw new Error('Both PR head and base are required');if(prHead&&base){const diff=await gitDiff(root,base,prHead);extra={...(testedCommitSha!==diff.headSha?{testedCommitParents:(await git(root,['rev-list','--parents','-n','1',testedCommitSha])).trim().split(' ').slice(1)}:{}),prHeadSha:diff.headSha,baseSha:diff.baseSha,...(diff.diffBaseSha?{diffBaseSha:diff.diffBaseSha}:{})};}return {testedCommitSha,sourceTreeHash:source,dirty,...extra};
}
/** Mapping is safe only when the entire scoped file has identical Git blob content. */
export async function lineMapping(root:string,prHead:string,testedCommit:string,paths:readonly string[]):Promise<'known'|'unknown'>{
 if(!paths.length)return 'unknown';const head=(await git(root,['rev-parse','--verify',`${prHead}^{commit}`])).trim(),tested=(await git(root,['rev-parse','--verify',`${testedCommit}^{commit}`])).trim();
 for(const p of paths){RelativePathSchema.parse(p);try{const [a,b]=await Promise.all([git(root,['rev-parse','--verify',`${head}:./${p}`]),git(root,['rev-parse','--verify',`${tested}:./${p}`])]);if(a.trim()!==b.trim())return 'unknown';}catch{return 'unknown';}}return 'known';
}

/** Recognize an actual Git synthetic merge, never an asserted parent array alone. */
export async function verifyMergeSubject(root:string,subject:EvidenceSubject):Promise<'known'|'unknown'>{
 try {
  if(!subject.prHeadSha||!subject.baseSha)return 'unknown';
  const tested=(await git(root,['rev-parse','--verify',`${subject.testedCommitSha}^{commit}`])).trim();
  if(tested!==subject.testedCommitSha)return 'unknown';
  if(tested===subject.prHeadSha)return 'known';
  const parents=(await git(root,['rev-list','--parents','-n','1',tested])).trim().split(' ').slice(1);
  return parents.length===2&&parents[0]===subject.baseSha&&parents[1]===subject.prHeadSha&&JSON.stringify(parents)===JSON.stringify(subject.testedCommitParents)?'known':'unknown';
 }catch{return 'unknown';}
}
