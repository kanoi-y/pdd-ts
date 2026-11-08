import type {DatabaseSync} from 'node:sqlite';
import type {QueueState} from '../../../src/model/queue.js';
/** Local SQLite example: one row, no external side effects or lease-expiry assumption. */
export class SqliteQueue {
 private db:DatabaseSync;
 private maxAttempts:number;
 constructor(db:DatabaseSync,maxAttempts:number){
  if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>5)throw new Error('Invalid attempt limit');
  this.db=db;this.maxAttempts=maxAttempts;
  db.exec("CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY CHECK(id=1),phase TEXT NOT NULL CHECK(phase IN ('pending','running','completed','failed')),attempts INTEGER NOT NULL CHECK(attempts>=0),owner INTEGER); INSERT OR IGNORE INTO jobs VALUES(1,'pending',0,NULL)");
 }
 claim(worker:number):number|null{
  this.worker(worker);
  const row=this.db.prepare("UPDATE jobs SET phase='running',owner=?,attempts=attempts+1 WHERE id=1 AND phase='pending' AND attempts<? RETURNING attempts").get(worker,this.maxAttempts);
  return row?Number(row.attempts):null;
 }
 complete(worker:number,attempt:number):boolean{return this.finish('completed',worker,attempt);}
 fail(worker:number,attempt:number):boolean{return this.finish('failed',worker,attempt);}
 private finish(phase:'completed'|'failed',worker:number,attempt:number):boolean{
  this.worker(worker);this.attempt(attempt);
  return this.db.prepare("UPDATE jobs SET phase=?,owner=NULL WHERE id=1 AND phase='running' AND owner=? AND attempts=?").run(phase,worker,attempt).changes===1;
 }
 /** Caller must have actually stopped this worker; a timer expiring alone is insufficient. */
 crash(worker:number,attempt:number):boolean{
  this.worker(worker);this.attempt(attempt);
  return this.db.prepare("UPDATE jobs SET owner=NULL WHERE id=1 AND phase='running' AND owner=? AND attempts=?").run(worker,attempt).changes===1;
 }
 recover():boolean{return this.db.prepare("UPDATE jobs SET phase='failed' WHERE id=1 AND phase='running' AND owner IS NULL").run().changes===1;}
 retry():boolean{return this.db.prepare("UPDATE jobs SET phase='pending' WHERE id=1 AND phase='failed' AND attempts<?").run(this.maxAttempts).changes===1;}
 snapshot():QueueState{
  const row=this.db.prepare('SELECT phase,attempts,owner FROM jobs WHERE id=1').get()!;
  return {phase:row.phase as QueueState['phase'],attempts:Number(row.attempts),active:row.owner===null?[]:[Number(row.owner)],readers:[]};
 }
 private worker(worker:number){if(!Number.isInteger(worker)||worker<0||worker>3)throw new Error('Invalid worker');}
 private attempt(attempt:number){if(!Number.isInteger(attempt)||attempt<1||attempt>this.maxAttempts)throw new Error('Invalid attempt');}
}
