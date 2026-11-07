#!/usr/bin/env node
// Invoked only inside the restricted container; this file is mounted read-only.
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
const require=createRequire(import.meta.url),root=process.cwd();
if(existsSync(path.join(root,'tsconfig.build.json'))) {
 const compiler=path.join(path.dirname(require.resolve('typescript/package.json')),'bin/tsc');
 const build=spawnSync(process.execPath,[compiler,'-p','tsconfig.build.json'],{stdio:'inherit',timeout:60000});
 if(build.status!==0) process.exit(2);
}
const args=JSON.parse(process.argv[2]);
if(!Array.isArray(args)||!args.every(value=>typeof value==='string')) throw new Error('Invalid test arguments');
const test=spawnSync(process.execPath,args,{stdio:'inherit',timeout:100000});
process.exit(test.status??2);
