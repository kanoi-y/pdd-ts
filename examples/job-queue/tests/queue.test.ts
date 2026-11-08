import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {Worker} from 'node:worker_threads';
import path from 'node:path';
import os from 'node:os';
import {afterEach,expect,it} from 'vitest';
import {SqliteQueue} from '../src/queue.js';
import {matchQueueTrace} from '../../../src/model/queue.js';
import type {TraceStep} from '../../../src/model/queue.js';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
it('JOB-001 actual SQLite connections allow only one concurrent claim',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'pdd-queue-'));roots.push(root);const file=path.join(root,'queue.db'),db=new DatabaseSync(file);new SqliteQueue(db,2);db.close();
 const code=`(async()=>{const {parentPort,workerData}=require('node:worker_threads');const {DatabaseSync}=require('node:sqlite');const {SqliteQueue}=await import(workerData.module);const db=new DatabaseSync(workerData.file,{timeout:3000});const q=new SqliteQueue(db,2);parentPort.postMessage('ready');parentPort.once('message',()=>{try{parentPort.postMessage(q.claim(workerData.worker));}catch(e){parentPort.postMessage({error:e.message});}finally{db.close();}});})().catch(e=>{throw e;});`;

 const workers=[0,1].map(worker=>new Worker(code,{eval:true,workerData:{file,worker,module:new URL('../src/queue.ts',import.meta.url).href}}));
 try{await Promise.all(workers.map(w=>new Promise<void>((resolve,reject)=>{w.once('message',()=>resolve());w.once('error',reject);})));const results=workers.map(w=>new Promise<unknown>((resolve,reject)=>{w.once('message',resolve);w.once('error',reject);}));workers.forEach(w=>w.postMessage('claim'));const claims=await Promise.all(results);expect(claims.filter(x=>x===1)).toHaveLength(1);expect(claims.filter(x=>x===null)).toHaveLength(1);}finally{await Promise.all(workers.map(w=>w.terminate()));}
});
it('JOB-001 real implementation trace matches the model across retry crash and recovery',()=>{
 const db=new DatabaseSync(':memory:');try{
 const q=new SqliteQueue(db,2),trace:TraceStep[]=[{action:'initial',worker:null,state:q.snapshot()}];
 const a=q.claim(0);expect(a).toBe(1);trace.push({action:'claim',worker:0,state:q.snapshot()});expect(q.claim(1)).toBe(null);expect(q.fail(0,a!)).toBe(true);trace.push({action:'fail',worker:0,state:q.snapshot()});expect(q.retry()).toBe(true);trace.push({action:'retry',worker:null,state:q.snapshot()});const b=q.claim(1);expect(b).toBe(2);trace.push({action:'claim',worker:1,state:q.snapshot()});expect(q.crash(1,b!)).toBe(true);trace.push({action:'crash',worker:1,state:q.snapshot()});expect(q.recover()).toBe(true);trace.push({action:'recover',worker:null,state:q.snapshot()});expect(q.retry()).toBe(false);expect(q.claim(0)).toBe(null);expect(q.complete(0,a!)).toBe(false);
 expect(matchQueueTrace({schemaVersion:1,kind:'job-queue-v1',workers:2,maxAttempts:2,claim:'atomic',recovery:true,limits:{states:1000,depth:64}},trace)).toMatchObject({status:'matched'});
 }finally{db.close();}
});
it('JOB-001 stale attempt tokens cannot finish a later claim by the same worker',()=>{
 const db=new DatabaseSync(':memory:');try{const q=new SqliteQueue(db,2),a=q.claim(0)!;expect(q.fail(0,a)).toBe(true);expect(q.retry()).toBe(true);const b=q.claim(0)!;expect(q.complete(0,a)).toBe(false);expect(q.snapshot().phase).toBe('running');expect(q.complete(0,b)).toBe(true);expect(q.snapshot()).toMatchObject({phase:'completed',attempts:2,active:[]});}finally{db.close();}
});
