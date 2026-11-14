import { canonicalJson } from './serialization.js';
import { parseEvidence, type Evidence } from './schemas.js';
/** Merge already collected claims, retaining no ambiguous identity collisions. This does not confer trust. */
export function mergeEvidence(evidence:readonly Evidence[]):Evidence[]{
  const rows=new Map<string,Evidence>();
  for(const input of evidence){
    const row=parseEvidence(input),existing=rows.get(row.id);
    if(existing&&canonicalJson(existing)!==canonicalJson(row))throw new Error(`Conflicting evidence ID: ${row.id}`);
    rows.set(row.id,row);
  }
  return [...rows.values()].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}
