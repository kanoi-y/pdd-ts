import { it, expect } from 'vitest';
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gitDiff, sourceTreeHash, detectProject, collect } from '../../packages/adapter-reports/src/index.js';
const git=(root:string,...args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
it('pins a real Git diff and hashes tracked and explicit ignored inputs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'behavproof-')); git(root,'init','-q','-b','main'); git(root,'config','user.email','test@example.com');git(root,'config','user.name','Test');
 await writeFile(join(root,'a.ts'),'one\n');git(root,'add','.');git(root,'commit','-m','base');const base=git(root,'rev-parse','HEAD');
 await writeFile(join(root,'a.ts'),'one\ntwo\n');git(root,'add','.');git(root,'commit','-m','head');
 const diff=await gitDiff(root,base,'HEAD');expect(diff.status).toBe('known');expect(diff.files[0]?.lines).toEqual([2]);
 const before=await sourceTreeHash(root,['a.ts']);await writeFile(join(root,'a.ts'),'changed');expect(await sourceTreeHash(root,['a.ts'])).not.toBe(before);
});
it('detects monorepos without importing configuration',async()=>{
 const root=await mkdtemp(join(tmpdir(),'behavproof-'));await writeFile(join(root,'package.json'),JSON.stringify({workspaces:['packages/*']}));
 expect((await detectProject(root)).support).toBe('monorepo');
});
it('seals isolated outputs from an explicitly selected command',async()=>{
 const root=await mkdtemp(join(tmpdir(),'behavproof-'));git(root,'init','-q','-b','main');git(root,'config','user.email','test@example.com');git(root,'config','user.name','Test');
 await writeFile(join(root,'a.ts'),'source');git(root,'add','.');git(root,'commit','-m','base');await mkdir(join(root,'out'));
 const result=await collect({root,executionId:'run-1',command:process.execPath,args:['-e',"require('fs').writeFileSync(process.env.BEHAVPROOF_OUTPUT_DIR+'/result.json','{}')"],inputPaths:['a.ts'],configPaths:[],outputRoot:'out',artifacts:[{ref:'result.json',kind:'test',scope:['a.ts']}],producer:{tool:'test',version:'1',collectorVersion:'1'}});
 expect(result.exitCode).toBe(0);expect(result.artifacts).toHaveLength(1);expect(await readFile(join(root,'out','run-1','result.json'),'utf8')).toBe('{}');
});
it('rejects inputs changed while collecting and never seals stale failed outputs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'behavproof-'));git(root,'init','-q');git(root,'config','user.email','test@example.com');git(root,'config','user.name','Test');
 await writeFile(join(root,'a.ts'),'source');git(root,'add','.');git(root,'commit','-qm','base');await mkdir(join(root,'out'));
 const common={root,command:process.execPath,inputPaths:['a.ts'],configPaths:[],outputRoot:'out',artifacts:[{ref:'result.json',kind:'test',scope:['a.ts']}],producer:{tool:'test',version:'1',collectorVersion:'1'}};
 await expect(collect({...common,executionId:'changed',args:['-e',"require('fs').writeFileSync('a.ts','changed')"]})).rejects.toThrow('Inputs changed');
 const failed=await collect({...common,executionId:'failed',args:['-e','process.exit(1)']});expect(failed.exitCode).toBe(1);expect(failed.artifacts).toEqual([]);
 await expect(collect({...common,executionId:'failed',args:['-e','']})).rejects.toThrow();
});
it('keeps rename identity, unrelated histories, and differing merge content explicit',async()=>{
 const root=await mkdtemp(join(tmpdir(),'behavproof-'));git(root,'init','-q');git(root,'config','user.email','test@example.com');git(root,'config','user.name','Test');
 await writeFile(join(root,'old.ts'),'one\ntwo\n');git(root,'add','.');git(root,'commit','-qm','base');const base=git(root,'rev-parse','HEAD');
 git(root,'mv','old.ts','new.ts');git(root,'commit','-qm','rename');const head=git(root,'rev-parse','HEAD');
 const diff=await gitDiff(root,base,head);expect(diff.files[0]?.previousPath).toBe('old.ts');expect(diff.files[0]?.path).toBe('new.ts');expect(diff.files[0]?.lines).toEqual([]);
 const {lineMapping}=await import('../../packages/adapter-reports/src/index.js');expect(await lineMapping(root,head,base,['new.ts'])).toBe('unknown');
 git(root,'checkout','-q','--orphan','unrelated');git(root,'rm','-rf','.');await writeFile(join(root,'other'),'other');git(root,'add','.');git(root,'commit','-qm','unrelated');expect((await gitDiff(root,base,'HEAD')).status).toBe('unknown');
});
it('rejects collector output directories overlapping the input scope',async()=>{
 const root=await mkdtemp(join(tmpdir(),'behavproof-'));git(root,'init','-q');git(root,'config','user.email','test@example.com');git(root,'config','user.name','Test');await mkdir(join(root,'out'));await writeFile(join(root,'out','input'),'x');git(root,'add','.');git(root,'commit','-qm','base');
 await expect(collect({root,executionId:'run',command:process.execPath,args:['-e',''],inputPaths:['out/input'],configPaths:[],outputRoot:'out',artifacts:[],producer:{tool:'test',version:'1',collectorVersion:'1'}})).rejects.toThrow('overlap');
});
it('bounds a hanging runner and seals no artifacts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'behavproof-'));git(root,'init','-q');git(root,'config','user.email','test@example.com');git(root,'config','user.name','Test');await writeFile(join(root,'input'),'x');git(root,'add','.');git(root,'commit','-qm','base');await mkdir(join(root,'out'));
 const result=await collect({root,executionId:'timeout',command:process.execPath,args:['-e','setInterval(()=>{},1000)'],inputPaths:['input'],configPaths:[],outputRoot:'out',artifacts:[],producer:{tool:'test',version:'1',collectorVersion:'1'},timeoutMs:50});expect(result.exitCode).not.toBe(0);
 await expect(collect({root,executionId:'too-long',command:process.execPath,args:['-e',''],inputPaths:['input'],configPaths:[],outputRoot:'out',artifacts:[],producer:{tool:'test',version:'1',collectorVersion:'1'},timeoutMs:3600001})).rejects.toThrow('Invalid timeout');
});
it('identifies deleted and binary changes without claiming binary line mapping',async()=>{
 const root=await mkdtemp(join(tmpdir(),'behavproof-'));git(root,'init','-q');git(root,'config','user.email','test@example.com');git(root,'config','user.name','Test');await writeFile(join(root,'delete.ts'),'text\n');await writeFile(join(root,'data.bin'),Buffer.from([0,1,2]));git(root,'add','.');git(root,'commit','-qm','base');const base=git(root,'rev-parse','HEAD');git(root,'rm','delete.ts');await writeFile(join(root,'data.bin'),Buffer.from([0,3,4]));git(root,'add','.');git(root,'commit','-qm','change');const diff=await gitDiff(root,base,'HEAD');expect(diff.files.find(f=>f.path==='delete.ts')?.kind).toBe('D');expect(diff.files.find(f=>f.path==='delete.ts')?.lines).toEqual([]);expect(diff.files.find(f=>f.path==='data.bin')?.ambiguous).toBe(true);
});
it('requires Node, Vitest, Git and a supported single-package layout',async()=>{
 const root=await mkdtemp(join(tmpdir(),'behavproof-'));expect((await detectProject(root)).support).toBe('unsupported');
 await writeFile(join(root,'package.json'),JSON.stringify({name:'other',scripts:{test:'jest'},devDependencies:{jest:'1'}}));git(root,'init','-q');
 const unsupported=await detectProject(root);expect(unsupported.support).toBe('unsupported');expect(unsupported.reasons.join(' ')).toMatch(/Vitest/);
 await writeFile(join(root,'package.json'),JSON.stringify({name:'node-project',scripts:{test:'vitest run'},devDependencies:{vitest:'5.1.0'}}));expect((await detectProject(root)).support).toBe('single-package');
 await writeFile(join(root,'rush.json'),'{}');expect((await detectProject(root)).support).toBe('monorepo');
});
it('does not invoke a repository configured text converter during diff',async()=>{
 const root=await mkdtemp(join(tmpdir(),'behavproof-'));git(root,'init','-q');git(root,'config','user.email','test@example.com');git(root,'config','user.name','Test');
 const marker=join(root,'marker');const converter=join(root,'converter');await writeFile(converter,`#!/bin/sh\ntouch '${marker}'\ncat "$1"\n`);await import('node:fs/promises').then(fs=>fs.chmod(converter,0o755));git(root,'config','diff.evil.textconv',converter);
 await writeFile(join(root,'.gitattributes'),'*.dat diff=evil\n');await writeFile(join(root,'file.dat'),'one\n');git(root,'add','.');git(root,'commit','-qm','base');const base=git(root,'rev-parse','HEAD');await writeFile(join(root,'file.dat'),'two\n');git(root,'add','file.dat');git(root,'commit','-qm','head');
 const diff=await gitDiff(root,base,'HEAD');expect(diff.files.find(f=>f.path==='file.dat')?.lines).toEqual([1]);await expect(readFile(marker)).rejects.toMatchObject({code:'ENOENT'});
});
it('does not support a project whose selected test script uses another runner',async()=>{
 const root=await mkdtemp(join(tmpdir(),'behavproof-'));git(root,'init','-q');await writeFile(join(root,'package.json'),JSON.stringify({scripts:{test:'jest'},devDependencies:{jest:'1',vitest:'5'}}));
 const result=await detectProject(root);expect(result.support).toBe('unsupported');expect(result.reasons.join(' ')).toMatch(/runner/i);
});
it.each(['node custom-runner.js # vitest','node custom-runner.js vitest'])('rejects unverified runner script %s',async(script)=>{
 const root=await mkdtemp(join(tmpdir(),'behavproof-'));git(root,'init','-q');
 await writeFile(join(root,'package.json'),JSON.stringify({scripts:{test:script},devDependencies:{vitest:'5.1.0'}}));
 const result=await detectProject(root);expect(result.support).toBe('unsupported');expect(result.reasons.join(' ')).toMatch(/runner/i);
});
it('requires an explicit supported test script even when Vitest is a dependency',async()=>{
 const root=await mkdtemp(join(tmpdir(),'behavproof-'));git(root,'init','-q');await writeFile(join(root,'package.json'),JSON.stringify({devDependencies:{vitest:'5.1.0'}}));
 expect((await detectProject(root)).support).toBe('unsupported');
});
it('records synthetic merge parents and distinguishes a valid PR/base relationship',async()=>{
 const {gitSubject,verifyMergeSubject}=await import('../../packages/adapter-reports/src/index.js');
 const dir=await mkdtemp(join(tmpdir(),'behavproof-merge-'));
 try {
  const g=(...args:string[])=>execFileSync('git',['-c','user.name=Test','-c','user.email=test@example.invalid',...args],{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
  g('init','-q','-b','main');await writeFile(join(dir,'a.ts'),'export const a=1;\n');g('add','.');g('commit','-qm','base');
  const base=g('rev-parse','HEAD');g('checkout','-qb','feature');await writeFile(join(dir,'a.ts'),'export const a=2;\n');g('commit','-qam','feature');const head=g('rev-parse','HEAD');
  g('checkout','-q','main');await writeFile(join(dir,'b.ts'),'export const b=1;\n');g('add','.');g('commit','-qm','main');const currentBase=g('rev-parse','HEAD');g('merge','--no-ff','-qm','test merge','feature');
  const subject=await gitSubject(dir,['a.ts','b.ts'],head,currentBase);
  expect(subject.testedCommitSha).not.toBe(head);expect(subject.testedCommitParents).toEqual([currentBase,head]);expect(await verifyMergeSubject(dir,subject)).toBe('known');
  expect(await verifyMergeSubject(dir,{...subject,baseSha:base})).toBe('unknown');
 }finally{await rm(dir,{recursive:true,force:true});}
});
