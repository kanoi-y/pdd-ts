import {test,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {gitDiff,lineMapping,gitSubject,verifyMergeSubject} from '../../packages/adapter-reports/src/index.js';
import {registryAtGit} from '../../packages/cli/src/project.js';
import {parseConfig} from '../../packages/core/src/index.js';
async function fixture(run:(root:string,git:(...args:string[])=>string,base:string,head:string)=>Promise<void>){
 const repo=await mkdtemp(join(tmpdir(),'behavproof-nested-')),root=join(repo,'apps/node-api');await mkdir(join(root,'src'),{recursive:true});await mkdir(join(root,'tests'));
 const git=(...args:string[])=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{cwd:repo,encoding:'utf8'}).trim();
 try{await writeFile(join(repo,'sibling.ts'),'export const outside=0;\n');await writeFile(join(root,'src/orders.ts'),'export const order=1;\n');await writeFile(join(root,'tests/orders.test.ts'),`import {defineContract} from '@behavproof/vitest';const c=defineContract({id:'ORDER',intent:'owner only',risk:'critical',cases:[{id:'owner',input:1,expected:1}]});\n`);git('init','-q','-b','main');git('add','.');git('commit','-qm','base');const base=git('rev-parse','HEAD');await writeFile(join(repo,'sibling.ts'),'export const outside=2;\n');await writeFile(join(root,'src/orders.ts'),'export const order=2;\n');git('add','.');git('commit','-qm','change');await run(root,git,base,git('rev-parse','HEAD'));}finally{await rm(repo,{recursive:true,force:true});}
}
test('a single-package project nested in Git receives project-relative diffs and complete real subject identity',()=>fixture(async(root,_git,base,head)=>{
 const diff=await gitDiff(root,base,head);expect(diff.status).toBe('known');expect(diff.files.map(f=>f.path)).toEqual(['src/orders.ts']);expect(diff.files[0]?.lines).toEqual([1]);
 const subject=await gitSubject(root,['src/orders.ts','tests/orders.test.ts'],head,base);expect(subject.dirty).toBe(false);expect(subject.testedCommitSha).toBe(head);expect(await verifyMergeSubject(root,subject)).toBe('known');
}));
test('nested source mappings compare the actual Git-prefixed objects',()=>fixture(async(root,_git,_base,head)=>{
 expect(await lineMapping(root,head,head,['src/orders.ts'])).toBe('known');
}));
test('nested immutable approval discovery reads the actual project Git subtree',()=>fixture(async(root,_git,_base,head)=>{
 const config=parseConfig({schemaVersion:1,contracts:{enabled:true,sources:[{type:'vitest-inline',include:['tests/**/*.ts']}]}}),registry=await registryAtGit(root,config,head);
 expect(registry.discoveryDiagnostics).toEqual([]);expect(registry.contracts[0]?.sourceRef).toBe('tests/orders.test.ts');expect(registry.contracts[0]?.id).toBe('ORDER');
}));
