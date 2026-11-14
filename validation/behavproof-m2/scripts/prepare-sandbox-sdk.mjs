// Stage an explicit verifier build/runtime without workspace-private surfaces.
import {execFileSync} from 'node:child_process';import {parseArgs} from 'node:util';
import {mkdir,writeFile,readFile,readdir,realpath,cp,lstat,readlink,unlink,symlink,rm} from 'node:fs/promises';
import {resolve,relative,dirname,basename,join,isAbsolute,sep} from 'node:path';import {fileURLToPath} from 'node:url';
import {safeRead,RelativePathSchema,hashBytes} from '@behavproof/core';
const {values}=parseArgs({strict:true,allowPositionals:false,options:{output:{type:'string'},built:{type:'boolean'}}});
if(!values.output)throw Error('--output is required');
if(values.built&&process.platform==='win32')throw Error('Built container SDK staging requires a POSIX host');
const source=await realpath(fileURLToPath(new URL('..',import.meta.url))),requested=resolve(values.output);
const git=(args)=>execFileSync('git',['-c','core.fsmonitor=false',...args],{cwd:source,encoding:'utf8',timeout:30000,maxBuffer:10*1024*1024,env:{...process.env,GIT_OPTIONAL_LOCKS:'0'}});
const top=await realpath(git(['rev-parse','--show-toplevel']).trim()),within=(base,path)=>{const rel=relative(base,path);return rel===''||!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith(`..${sep}`);};
if(within(top,requested))throw Error('SDK staging must be outside the entire Git checkout');
const output=join(await realpath(dirname(requested)),basename(requested));
if(within(top,output))throw Error('SDK staging must be outside the entire Git checkout');
const packages=['core','adapter-reports','contract-registry','contract-vitest','adapter-github','cli'];
const allowed=path=>['package.json','package-lock.json','tsconfig.json','tsconfig.base.json','scripts/build-artifacts.mjs','scripts/protected-probe-worker.mjs'].includes(path)||path.startsWith('templates/')||packages.some(name=>path===`packages/${name}/package.json`||path===`packages/${name}/tsconfig.json`||path.startsWith(`packages/${name}/src/`)&&path.endsWith('.ts'));
const paths=git(['ls-files','-z','--','.']).split('\0').filter(Boolean).filter(allowed).sort();
for(const required of ['package.json','package-lock.json','scripts/build-artifacts.mjs','scripts/protected-probe-worker.mjs',...packages.map(name=>`packages/${name}/package.json`)])if(!paths.includes(required))throw Error('Required tracked SDK build input is missing');
await mkdir(output,{mode:0o700});
try{
const files=[];let total=0;
async function copyFile(path){
 RelativePathSchema.parse(path);const bytes=await safeRead(source,path);total+=bytes.length;if(total>25*1024*1024)throw Error('SDK source/artifact staging exceeds limit');
 if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}/.test(bytes.toString('utf8')))throw Error('Credential-shaped source is not permitted in the SDK');
 await mkdir(dirname(join(output,path)),{recursive:true});await writeFile(join(output,path),bytes,{flag:'wx'});files.push({path,sha256:hashBytes(bytes),size:bytes.length});
}
for(const path of paths)await copyFile(path);
if(values.built){
 const walkArtifacts=async(dir)=>{for(const entry of await readdir(join(source,dir),{withFileTypes:true})){const path=`${dir}/${entry.name}`;if(entry.isDirectory())await walkArtifacts(path);else if(/\.(?:js|ts|map|json|ya?ml)$/.test(entry.name))await copyFile(path);}};
 for(const name of packages){await walkArtifacts(`packages/${name}/dist`);if(name==='cli')for(const dir of ['schemas','presets','templates'])await walkArtifacts(`packages/cli/${dir}`);}
 const lock=JSON.parse((await safeRead(source,'package-lock.json')).toString('utf8'));
 const roots=new Set(Object.keys(lock.packages).filter(path=>path.startsWith('node_modules/')).map(path=>{const parts=path.slice(13).split('/');return parts[0].startsWith('@')?parts.slice(0,2).join('/'):parts[0];}));
 const sourceModules=join(source,'node_modules'),targetModules=join(output,'node_modules');
 await cp(sourceModules,targetModules,{recursive:true,dereference:false,verbatimSymlinks:true,filter:path=>{const rel=relative(sourceModules,path);if(!rel)return true;const parts=rel.split(sep);const name=parts[0].startsWith('@')?parts.slice(0,2).join('/'):parts[0];return parts[0].startsWith('@')&&parts.length===1?[...roots].some(pkg=>pkg.startsWith(parts[0]+'/')):roots.has(name);}});
 const links=async(dir)=>{for(const name of await readdir(dir)){const path=join(dir,name),info=await lstat(path);if(info.isSymbolicLink()){const corresponding=join(source,relative(output,path)),target=resolve(dirname(corresponding),await readlink(path));if(!within(sourceModules,target)&&!packages.some(name=>within(join(source,'packages',name),target)))throw Error('Dependency symlink escapes the selected verifier installation');const rebased=relative(dirname(path),join(output,relative(source,target)));await unlink(path);await symlink(rebased,path);}else if(info.isDirectory())await links(path);}};
 await links(targetModules);
}
await writeFile(join(output,'sdk-source-inventory.json'),JSON.stringify({schemaVersion:1,sourceCommit:git(['rev-parse','HEAD']).trim(),sourceDirty:!!git(['status','--porcelain','-z','--',...paths]),built:!!values.built,platform:process.platform,arch:process.arch,dependencyLockHash:hashBytes(await safeRead(source,'package-lock.json')),files,limits:['Source/artifact hashes and protected lock describe the selected verifier; this file is not producer authority.','Build with npm ci --ignore-scripts before running in a credential-free sandbox.']},null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({output,files:files.length,built:!!values.built,bytes:total}));

}catch(error){await rm(output,{recursive:true,force:true});throw error;}
