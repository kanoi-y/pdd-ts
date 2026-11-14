import {AsyncLocalStorage} from 'node:async_hooks';
export type TargetCall={targetRef:string;count:number};
const active=new AsyncLocalStorage<Map<string,number>>();
/** Called by a separately selected producer's instrumentation, not a proof of authority. */
export function observeTargetCall(targetRef:string):void {
  const observations=active.getStore();
  if(!observations)return;
  if(!targetRef || targetRef.length>4096 || observations.size>=1000&&!observations.has(targetRef))throw Error('Invalid or excessive target observations');
  const count=(observations.get(targetRef)??0)+1;
  if(!Number.isSafeInteger(count))throw Error('Target observation count exceeds limit');
  observations.set(targetRef,count);
}
/** @internal Capture one callback's asynchronous context; errors remain errors. */
export async function withTargetCalls<T>(callback:()=>T,record:(calls:TargetCall[])=>void):Promise<T> {
  const observations=new Map<string,number>();
  return active.run(observations,async()=>{
    try{return await callback();}
    finally{record([...observations].sort(([a],[b])=>a.localeCompare(b)).map(([targetRef,count])=>({targetRef,count})));}
  });
}
