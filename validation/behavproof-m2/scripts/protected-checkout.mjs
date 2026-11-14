// Protected host only: materialize raw Git blobs, never git checkout or filters.
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,lstat,readFile,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {RelativePathSchema,hashBytes} from '@behavproof/core';
export const sha=value=>{if(typeof value!=='string'||! /^[a-f0-9]{40}$/.test(value))throw Error('Invalid immutable Git commit');return value;};
export function protectedGit(root,args,encoding='utf8'){
 return execFileSync('git',['-c','core.fsmonitor=false','-c','core.hooksPath='+join(root,'.git','disabled-hooks'),'-c','core.attributesFile='+join(root,'.git','disabled-attributes'),...args],{cwd:root,encoding,timeout:120000,maxBuffer:12*1024*1024,stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH??'',...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{}),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'}});
}
export async function materializeProject({root,projectPath,headSha}){
 sha(headSha);RelativePathSchema.parse(projectPath);root=await realpath(root);
 if(protectedGit(root,['rev-parse','HEAD']).trim()!==headSha)throw Error('Current Git HEAD differs from selected subject');
 const prefix=projectPath+'/',rows=protectedGit(root,['ls-tree','-r','-z','--full-tree',headSha,'--',projectPath]).split('\0').filter(Boolean),entries=[],seen=new Set();let total=0;
 if(!rows.length||rows.length>1000)throw Error('Project file inventory is empty or exceeds bounds');
 for(const row of rows){const separator=row.indexOf('\t'),[mode,type,blob]=row.slice(0,separator).split(' '),path=row.slice(separator+1);if(separator<0||!path.startsWith(prefix))throw Error('Unexpected subtree path');
  const local=RelativePathSchema.parse(path.slice(prefix.length)),parts=local.split('/'),folded=local.toLowerCase();
  if(type!=='blob'||!['100644','100755'].includes(mode))throw Error('Only regular source files are supported; symlinks and submodules are rejected');
  if(parts.some(part=>['.git','.behavproof','node_modules'].includes(part.toLowerCase())))throw Error('Reserved host/output path in candidate source');
  if(parts.some(part=>part.toLowerCase()==='.gitattributes'))throw Error('Git attributes and checkout filters are unsupported in the reference producer');
  if(seen.has(folded))throw Error('Ambiguous case-folded source path');seen.add(folded);
  const size=Number(protectedGit(root,['cat-file','-s',blob]).trim());if(!Number.isSafeInteger(size)||size>1024*1024||(total+=size)>10*1024*1024)throw Error('Candidate source exceeds bounds');
  entries.push({path,local,blob,mode});
 }
 const ensure=async(dir)=>{let info;try{info=await lstat(dir);}catch(error){if(error.code!=='ENOENT')throw error;await mkdir(dir);info=await lstat(dir);}if(!info.isDirectory()||info.isSymbolicLink())throw Error('Unsafe source directory');};
 await ensure(join(root,projectPath.split('/')[0]));let ancestor=root;for(const part of projectPath.split('/')){ancestor=join(ancestor,part);await ensure(ancestor);}
 const fileHashes={};
 for(const entry of entries){let dir=join(root,projectPath);for(const part of entry.local.split('/').slice(0,-1)){dir=join(dir,part);await ensure(dir);}const path=join(root,entry.path),bytes=protectedGit(root,['cat-file','blob',entry.blob],null);fileHashes[entry.local]=hashBytes(bytes);
  try{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||!bytes.equals(await readFile(path)))throw Error('Existing materialized source differs from selected Git blob');}catch(error){if(error.code!=='ENOENT')throw error;await writeFile(path,bytes,{flag:'wx',mode:entry.mode==='100755'?0o755:0o644});}
 }
 return {root:join(root,projectPath),inputs:entries.map(row=>row.local).sort(),fileHashes};
}
