import { canonicalJson } from './serialization.js';
import { EvaluationSchema, ModeSchema, PolicySchema, RulePolicySchema, type Evaluation, type Mode, type CheckReport, type Policy, type RulePolicy } from './schemas.js';
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const sorted=(items:readonly string[])=>[...new Set(items)].sort(compare);
export function evaluateGate(evaluations:readonly Evaluation[],mode:Mode):CheckReport{
  ModeSchema.parse(mode);
  const byKey=new Map<string,Evaluation>();
  for(const input of evaluations){
    const row=EvaluationSchema.parse(input);
    row.evidenceIds=sorted(row.evidenceIds);row.scope=sorted(row.scope);
    if(row.notApplicable){row.notApplicable.allowedReasons=sorted(row.notApplicable.allowedReasons);row.notApplicable.evidenceIds=sorted(row.notApplicable.evidenceIds);}
    const key=canonicalJson([row.ruleId,row.scope]);
    const existing=byKey.get(key);
    if(existing&&canonicalJson(existing)!==canonicalJson(row))throw new Error(`Conflicting evaluation: ${row.ruleId}`);
    byKey.set(key,row);
  }
  const rows=[...byKey.values()].sort((a,b)=>compare(canonicalJson([a.ruleId,a.scope]),canonicalJson([b.ruleId,b.scope])));
  const required=rows.filter(r=>r.severity==='error');
  const failed=required.some(r=>r.status==='fail');
  const incomplete=required.length===0||required.some(r=>r.status==='unknown'||r.status==='not_applicable'&&(!r.notApplicable||!r.notApplicable.allowedReasons.includes(r.notApplicable.reason)||r.notApplicable.evidenceIds.length===0));
  const status=failed?'fail':incomplete?'incomplete':'pass';
  const reasons=sorted([...(required.length===0?['No mandatory rules configured']:[]),...required.filter(r=>r.status==='fail'||r.status==='unknown'||r.status==='not_applicable'&&(!r.notApplicable||!r.notApplicable.allowedReasons.includes(r.notApplicable.reason)||r.notApplicable.evidenceIds.length===0)).map(r=>`${r.ruleId}: ${r.status}`)]);
  return {schemaVersion:1,mode,status,exitCode:mode==='gate'&&status!=='pass'?1:0,mandatoryCount:required.length,evaluations:rows,reasons};
}
export function evaluateThreshold(ruleId:string,value:number|undefined,policy:RulePolicy,evidenceIds:string[]=[],scope:string[]=[]):Evaluation{
  RulePolicySchema.parse(policy);
  if(value!==undefined&&(!Number.isFinite(value)||value<0||value>100))throw new Error('Invalid percentage');
  const status=value===undefined||policy.min===undefined?'unknown':value>=policy.min?'pass':'fail';
  return {ruleId,severity:policy.severity,status,evidenceIds,scope,message:value===undefined?'Measurement unavailable':`Measured ${value}; minimum ${policy.min??'unset'}`};
}
export function mergeProtectedPolicy(project:Policy,protectedPolicy:Policy):Policy{
  const left=PolicySchema.parse(project),right=PolicySchema.parse(protectedPolicy);
  const rules:Policy['rules']={}; const levels={off:0,warn:1,error:2} as const;
  for(const id of sorted([...Object.keys(left.rules),...Object.keys(right.rules)])){
    const a=left.rules[id],b=right.rules[id];
    if(!a||!b){rules[id]={...(a??b)!};continue;}
    const result:RulePolicy={severity:levels[a.severity]>=levels[b.severity]?a.severity:b.severity};
    for(const field of ['min','minMutants'] as const)if(a[field]!==undefined||b[field]!==undefined)result[field]=Math.max(a[field]??0,b[field]??0);
    // Omitted permissions mean no N/A exception; intersection can never add one.
    result.allowNotApplicable=sorted((a.allowNotApplicable??[]).filter(x=>(b.allowNotApplicable??[]).includes(x)));
    rules[id]=result;
  }
  return {schemaVersion:1,profileVersion:'1',rules};
}
