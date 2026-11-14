import {test,expect} from 'vitest';import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {execFileSync} from 'node:child_process';
import {materializeProject} from '../../scripts/protected-checkout.mjs';
test('protected materialization retains the actual commit and exact subtree bytes without running checkout filters',async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'behavproof-materialize-')),repo=join(scratch,'repo');await mkdir(repo);const git=(...args:string[])=>execFileSync('git',args,{cwd:repo,encoding:'utf8'}).trim();
 try{git('init','-q','-b','main');await mkdir(join(repo,'project'));await writeFile(join(repo,'project/package.json'),'{"type":"module"}');await writeFile(join(repo,'project/test.ts'),'actual source');await writeFile(join(repo,'outside.txt'),'outside project');git('add','.');git('-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','subject');const head=git('rev-parse','HEAD');
  const result=await materializeProject({root:repo,projectPath:'project',headSha:head});expect(result.inputs).toEqual(['package.json','test.ts']);expect(await readFile(join(repo,'project/test.ts'),'utf8')).toBe('actual source');expect(git('rev-parse','HEAD')).toBe(head);
  await writeFile(join(repo,'project/.gitattributes'),'*.ts filter=untrusted');git('add','.');git('-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','attributes');await expect(materializeProject({root:repo,projectPath:'project',headSha:git('rev-parse','HEAD')})).rejects.toThrow(/attributes|filter/i);
 }finally{await rm(scratch,{recursive:true,force:true});}
});
test.skipIf(process.platform==='win32')('protected materialization refuses symlinks and reserved host/output paths',async()=>{
 const scratch=await mkdtemp(join(tmpdir(),'behavproof-materialize-negative-'));const git=(...args:string[])=>execFileSync('git',args,{cwd:scratch,encoding:'utf8'}).trim();
 try{git('init','-q','-b','main');await mkdir(join(scratch,'project'));await symlink('/not-read',join(scratch,'project/link'));git('add','.');git('-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','symlink');await expect(materializeProject({root:scratch,projectPath:'project',headSha:git('rev-parse','HEAD')})).rejects.toThrow(/regular|symlink/i);
  git('rm','-q','project/link');await mkdir(join(scratch,'project/.behavproof'),{recursive:true});await writeFile(join(scratch,'project/.behavproof/host-config.json'),'{}');git('add','.');git('-c','user.name=fixture','-c','user.email=fixture@example.invalid','commit','-qm','reserved');await expect(materializeProject({root:scratch,projectPath:'project',headSha:git('rev-parse','HEAD')})).rejects.toThrow(/reserved/i);
 }finally{await rm(scratch,{recursive:true,force:true});}
});
