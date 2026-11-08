import {z} from 'zod';
import {canonicalJson} from '../requirements/io.js';
export const queueModelSchema=z.strictObject({
 schemaVersion:z.literal(1),kind:z.literal('job-queue-v1'),workers:z.number().int().min(2).max(4),maxAttempts:z.number().int().min(1).max(5),
 claim:z.enum(['atomic','split-read-write']),recovery:z.boolean(),
 limits:z.strictObject({states:z.number().int().min(1).max(10000),depth:z.number().int().min(1).max(128)}),
});
export type QueueModel=z.infer<typeof queueModelSchema>;
export const queueStateSchema=z.strictObject({phase:z.enum(['pending','running','completed','failed']),attempts:z.number().int().min(0).max(10),active:z.array(z.number().int().min(0).max(3)).max(4),readers:z.array(z.number().int().min(0).max(3)).max(4)});
export type QueueState=z.infer<typeof queueStateSchema>;
export const traceStepSchema=z.strictObject({action:z.enum(['initial','claim','read','start','complete','fail','crash','retry','recover']),worker:z.number().int().min(0).max(3).nullable(),state:queueStateSchema});
export type TraceStep=z.infer<typeof traceStepSchema>;
export const initialState=():QueueState=>({phase:'pending',attempts:0,active:[],readers:[]});
interface Edge {action:TraceStep['action'];worker:number|null;state:QueueState}
/** Fixed semantics, not executable model input. One job; process death removes the worker before recovery. */
export function queueSuccessors(model:QueueModel,state:QueueState):Edge[]{
 const edges:Edge[]=[];
 const add=(action:Edge['action'],worker:number|null,patch:Partial<QueueState>)=>edges.push({action,worker,state:{...state,...patch}});
 for(let worker=0;worker<model.workers;worker++){
  if(state.phase==='pending'&&state.attempts<model.maxAttempts&&!state.active.includes(worker)&&!state.readers.includes(worker)){
   if(model.claim==='atomic')add('claim',worker,{phase:'running',attempts:state.attempts+1,active:[worker]});
   else add('read',worker,{readers:[...state.readers,worker].sort()});
  }
  // This deliberately unsafe option commits a previously read value without a compare-and-set.
  if(model.claim==='split-read-write'&&state.readers.includes(worker))add('start',worker,{phase:'running',attempts:state.attempts+1,active:[...state.active,worker].sort(),readers:state.readers.filter(w=>w!==worker)});
  if(state.active.includes(worker)){
   const remaining=state.active.filter(w=>w!==worker);
   add('complete',worker,{phase:'completed',active:remaining});
   add('fail',worker,{phase:'failed',active:remaining});
   add('crash',worker,{active:remaining});
  }
 }
 if(state.phase==='failed'&&state.active.length===0&&state.readers.length===0&&state.attempts<model.maxAttempts)add('retry',null,{phase:'pending'});
 if(model.recovery&&state.phase==='running'&&state.active.length===0&&state.readers.length===0)add('recover',null,{phase:'failed'});
 return edges;
}
export const modelResultSchema=z.strictObject({
 schemaVersion:z.literal(1),kind:z.literal('model-check'),adapter:z.literal('job-queue-v1'),status:z.enum(['passed','failed','unknown']),
 guarantee:z.literal('finite-model-only'),fairness:z.literal('none'),method:z.literal('breadth-first-exhaustive'),exhaustive:z.boolean(),
 model:queueModelSchema,explored:z.strictObject({states:z.number().int().nonnegative().max(10000),transitions:z.number().int().nonnegative().max(100000),depth:z.number().int().nonnegative().max(128)}),
 violation:z.enum(['simultaneous-execution','attempt-limit','invalid-terminal','deadlock']).nullable(),reason:z.string().max(200),counterexample:z.array(traceStepSchema).max(130),
});
export type ModelResult=z.infer<typeof modelResultSchema>;
export function checkQueueModel(raw:unknown):ModelResult{
 const model=queueModelSchema.parse(raw),nodes:{step:TraceStep;parent:number;depth:number}[]=[{step:{action:'initial',worker:null,state:initialState()},parent:-1,depth:0}];
 const seen=new Set([canonicalJson(initialState())]);let transitions=0,depth=0,cutoff=false;
 const started=performance.now();
 const result=(status:ModelResult['status'],reason:string,violation:ModelResult['violation']=null,index=-1):ModelResult=>{
  const counterexample:TraceStep[]=[];for(let i=index;i>=0;i=nodes[i]!.parent)counterexample.push(nodes[i]!.step);
  return {schemaVersion:1,kind:'model-check',adapter:'job-queue-v1',status,guarantee:'finite-model-only',fairness:'none',method:'breadth-first-exhaustive',exhaustive:status==='passed',model,explored:{states:nodes.length,transitions,depth},violation,reason,counterexample:counterexample.reverse()};
 };
 for(let index=0;index<nodes.length;index++){
  if(performance.now()-started>1000)return result('unknown','time-limit');
  const node=nodes[index]!,s=node.step.state;depth=Math.max(depth,node.depth);
  const violation=s.active.length>1?'simultaneous-execution':s.attempts>model.maxAttempts?'attempt-limit':s.phase==='completed'&&s.active.length>0?'invalid-terminal':null;
  if(violation)return result('failed',violation,violation,index);
  const next=queueSuccessors(model,s);
  const terminal=(s.phase==='completed'||s.phase==='failed'&&s.attempts===model.maxAttempts)&&s.active.length===0&&s.readers.length===0;
  if(!next.length&&!terminal)return result('failed','deadlock','deadlock',index);
  for(const edge of next){
   if(transitions>=100000)return result('unknown','transition-limit');transitions++;
   const key=canonicalJson(edge.state);if(seen.has(key))continue;
   if(node.depth>=model.limits.depth){cutoff=true;continue;}
   if(nodes.length>=model.limits.states)return result('unknown','state-limit');
   seen.add(key);nodes.push({step:edge,parent:index,depth:node.depth+1});
  }
 }
 return cutoff?result('unknown','depth-limit'):result('passed','reachable-state-space-exhausted');
}
export function matchQueueTrace(rawModel:unknown,rawTrace:unknown):{status:'matched'|'mismatch';index:number;guarantee:'observed-trace-only'}{
 const model=queueModelSchema.parse(rawModel),trace=z.array(traceStepSchema).min(2).max(130).parse(rawTrace);
 const out=(status:'matched'|'mismatch',index:number)=>({status,index,guarantee:'observed-trace-only' as const});
 if(canonicalJson(trace[0])!==canonicalJson({action:'initial',worker:null,state:initialState()}))return out('mismatch',0);
 for(let i=1;i<trace.length;i++)if(!queueSuccessors(model,trace[i-1]!.state).some(edge=>canonicalJson(edge)===canonicalJson(trace[i])))return out('mismatch',i);
 return out('matched',trace.length-1);
}
