import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, realpath } from 'node:fs/promises';
import { join, resolve, dirname, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
const flags=process.argv.slice(2);if(flags.some(arg=>!['--online','--offline'].includes(arg))||flags.includes('--online')&&flags.includes('--offline'))throw Error('Expected --online or --offline');
const offline=flags.includes('--offline');
const project=fileURLToPath(new URL('..',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'behavproof-pack-')),tar=join(scratch,'tar'),consumer=join(scratch,'consumer');
await mkdir(tar);await mkdir(consumer);const packages=['core','adapter-reports','contract-registry','contract-vitest','adapter-github','cli'];
const run=(bin,args,cwd)=>execFileSync(bin,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000,maxBuffer:10*1024*1024});
const candidates=[process.env.npm_execpath,join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),join(dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')];
for(const dir of (process.env.PATH??'').split(delimiter)){try{const entry=await realpath(join(dir,process.platform==='win32'?'npm.cmd':'npm'));candidates.push(process.platform==='win32'?join(dirname(entry),'node_modules/npm/bin/npm-cli.js'):entry);}catch{}}
let npmCli;for(const path of candidates)if(path){try{await access(path);if(path.endsWith('npm-cli.js')){npmCli=path;break;}}catch{}}
if(!npmCli)throw Error('Installed npm CLI JavaScript entrypoint unavailable');
const npm=(args,cwd)=>run(process.execPath,[npmCli,...args],cwd);
try{
 const archives=[];for(const name of packages){const [meta]=JSON.parse(npm(['pack','--json','--ignore-scripts','--cache',join(project,'.npm-cache'),'--pack-destination',tar],join(project,'packages',name)));archives.push(join(tar,meta.filename));}
 await writeFile(join(consumer,'package.json'),'{"name":"behavproof-external-consumer","private":true,"type":"module"}\n');
 npm(['install',...(offline?['--offline']:[]),'--ignore-scripts','--cache',join(project,'.npm-cache'),...archives],consumer);
 const binary=join(consumer,'node_modules/@behavproof/cli/dist/index.js'),help=run(process.execPath,[binary,'--help'],consumer);
 if(!help.includes('Gate requires --trust-root'))throw Error('Installed CLI failed');
 const schema=JSON.parse(await readFile(join(consumer,'node_modules/@behavproof/cli/schemas/config.schema.json'),'utf8'));if(!schema.$schema)throw Error('Schema missing');
 await writeFile(join(consumer,'probe.mjs'),`import {hash,hashBytes} from '@behavproof/core';import {discover,instrumentFunction} from '@behavproof/contract-registry';import {GitHubAuthority,GitHubCheckPublisher,prepareCheckPublication,prepareFailedCheck,readArtifactArchive} from '@behavproof/adapter-github';import {observeTargetCall,withTargetCalls} from '@behavproof/vitest/probe';import {RegistrationSchema,registrationProjectData} from '@behavproof/cli';const source='export function f(){return 1}';const p=instrumentFunction({source,targetRef:'src/a.ts#f',expectedSourceHash:hashBytes(Buffer.from(source)),faultValue:0});let count=0;await withTargetCalls(()=>observeTargetCall('src/a.ts#f'),calls=>{count=calls[0]?.count??0});if(hash({}).length!==64||discover({}).contracts.length!==0||p.status!=='supported'||count!==1||typeof prepareCheckPublication!=='function'||typeof prepareFailedCheck!=='function'||typeof readArtifactArchive!=='function'||typeof registrationProjectData!=='function'||!RegistrationSchema||!new GitHubAuthority({repository:'acme/shop'})||!new GitHubCheckPublisher({repository:'acme/shop'}))throw Error('Public exports failed');`);
 run(process.execPath,['probe.mjs'],consumer);
 const result={schemaVersion:1,command:'node scripts/package-smoke.mjs',node:process.version,packages,consumerInstall:'pass',installationMode:offline?'offline':'online',...(offline?{offlineConsumerInstall:'pass'}:{}),publicExports:'pass',cliHelp:'pass',packagedSchemas:'pass',published:false};
 await writeFile(join(project,offline?'docs/evidence/package-smoke.json':'docs/evidence/package-smoke-online.json'),JSON.stringify(result,null,2)+'\n');console.log('Six packed packages installed in an external consumer; public exports, CLI and schemas passed.');
}finally{await rm(scratch,{recursive:true,force:true});}
