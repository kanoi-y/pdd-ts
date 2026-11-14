import {z} from 'zod';
import {execFileSync} from 'node:child_process';
import {realpath,readdir,lstat} from 'node:fs/promises';
import {resolve,relative,join,isAbsolute,sep} from 'node:path';
import {safeRead,RelativePathSchema,HashSchema,hashBytes} from '@behavproof/core';
const packages=['core','adapter-reports','contract-registry','contract-vitest','adapter-github','cli'];
const within=(base,path)=>{const r=relative(base,path);return r===''||!isAbsolute(r)&&r!=='..'&&!r.startsWith(`..${sep}`);};
const sourcePath=path=>['package.json','package-lock.json','tsconfig.json','tsconfig.base.json','scripts/build-artifacts.mjs','scripts/protected-probe-worker.mjs'].includes(path)||path.startsWith('templates/')||packages.some(name=>path===`packages/${name}/package.json`||path===`packages/${name}/tsconfig.json`||path.startsWith(`packages/${name}/src/`)&&path.endsWith('.ts'));
/** Structural/private-surface check; installed dependencies must already be trusted.
 * The canonical path returned here, not the supplied alias, is used for the mount.
 */
export async function validateStagedSdk(input,{referenceRoot,uid=process.getuid?.()}={}){
 if(!Number.isSafeInteger(uid)||uid<=0)throw Error('A non-root POSIX host is required for the candidate container');
 const reference=await realpath(referenceRoot),sdk=await realpath(input);
 const git=args=>execFileSync('git',['-c','core.fsmonitor=false',...args],{cwd:reference,encoding:'utf8',timeout:30000,maxBuffer:10*1024*1024});
 const top=await realpath(git(['rev-parse','--show-toplevel']).trim());
 if(within(top,sdk))throw Error('Sandbox SDK must be outside the entire workspace checkout');
 const owner=await lstat(sdk);if(!owner.isDirectory()||owner.uid!==uid||(owner.mode&0o077)!==0)throw Error('Staged SDK directory must be private and owned by the non-root host user');
 const inventory=z.strictObject({schemaVersion:z.literal(1),sourceCommit:z.string().regex(/^[a-f0-9]{40}$/),sourceDirty:z.boolean(),built:z.boolean(),platform:z.string().min(1),arch:z.string().min(1),dependencyLockHash:HashSchema,files:z.array(z.strictObject({path:RelativePathSchema,sha256:HashSchema,size:z.number().int().nonnegative().safe()})).max(10000),limits:z.array(z.string())}).parse(JSON.parse((await safeRead(sdk,'sdk-source-inventory.json')).toString('utf8')));
 const sources=git(['ls-files','-z','--','.']).split('\0').filter(sourcePath),allowed=new Set(sources),executables=[];
 for(const path of sources)if(path.startsWith('packages/')&&path.includes('/src/')&&path.endsWith('.ts')&&!path.endsWith('.d.ts')){
  const base=path.replace('/src/','/dist/').slice(0,-3);for(const suffix of ['.js','.js.map','.d.ts','.d.ts.map'])allowed.add(base+suffix);executables.push(base+'.js');
 }
 for(const name of packages)allowed.add(`packages/${name}/tsconfig.tsbuildinfo`);
 allowed.add('tsconfig.tsbuildinfo');
 for(const schema of ['config','policy','evidence','manifest','registry','trust-root','registration'])allowed.add(`packages/cli/schemas/${schema}.schema.json`);
 for(const profile of ['basic','standard','critical'])allowed.add(`packages/cli/presets/${profile}-v1.json`);
 for(const path of sources.filter(path=>path.startsWith('templates/')))allowed.add('packages/cli/'+path);
 const recorded=new Set();
 for(const entry of inventory.files){RelativePathSchema.parse(entry.path);HashSchema.parse(entry.sha256);if(!allowed.has(entry.path)||recorded.has(entry.path)||hashBytes(await safeRead(sdk,entry.path))!==entry.sha256)throw Error('Staged SDK inventory is incomplete or altered');recorded.add(entry.path);}
 for(const path of sources){if(!recorded.has(path)||hashBytes(await safeRead(sdk,path))!==hashBytes(await safeRead(reference,path)))throw Error('Staged SDK differs from selected verifier source');}
 for(const path of executables)if(hashBytes(await safeRead(sdk,path))!==hashBytes(await safeRead(reference,path)))throw Error('Staged executable differs from selected verifier');
 const lock=JSON.parse((await safeRead(reference,'package-lock.json')).toString('utf8'));
 const dependencyRoots=new Set(Object.keys(lock.packages).filter(path=>path.startsWith('node_modules/')).map(path=>{const p=path.slice(13).split('/');return p[0].startsWith('@')?p.slice(0,2).join('/'):p[0];}));
 let count=0;
 const walk=async(dir,dependency=false)=>{
  for(const name of await readdir(join(sdk,dir))){if(++count>50000)throw Error('SDK inventory exceeds limit');const path=dir?`${dir}/${name}`:name,info=await lstat(join(sdk,path));
   if(path==='node_modules'){if(info.isSymbolicLink()||!info.isDirectory())throw Error('Dependency root escapes the staged installation');await walk(path,true);continue;}
   if(dependency){const parts=path.slice(13).split('/'),root=parts[0].startsWith('@')?parts.slice(0,2).join('/'):parts[0];
    if(parts.length===1&&parts[0].startsWith('@')){if(![...dependencyRoots].some(pkg=>pkg.startsWith(parts[0]+'/')))throw Error('Unlisted dependency scope');}
    else if(!dependencyRoots.has(root)&&!['.bin','.package-lock.json'].includes(root))throw Error('Unlisted dependency surface');
    if(info.isSymbolicLink()){const target=await realpath(join(sdk,path));if(!within(sdk,target))throw Error('SDK dependency link escapes the staged installation');}
    else if(info.isDirectory())await walk(path,true);
   }else{if(info.isSymbolicLink())throw Error('SDK source/artifact links are unsupported');if(info.isDirectory()){if(![...allowed].some(file=>file.startsWith(path+'/')))throw Error('Private or unlisted SDK surface');await walk(path);}else if(path!=='sdk-source-inventory.json'){if(!allowed.has(path))throw Error('Private or unlisted SDK surface');if(!path.endsWith('.tsbuildinfo')&&hashBytes(await safeRead(sdk,path))!==hashBytes(await safeRead(reference,path)))throw Error(`SDK file differs from selected public verifier: ${path}`);}}
  }
 };
 const dependencyDir=await lstat(join(sdk,'node_modules'));if(!dependencyDir.isDirectory()||dependencyDir.isSymbolicLink())throw Error('Dependency root escapes the staged installation');
 await walk('');
 return {path:sdk,inventory};
}
