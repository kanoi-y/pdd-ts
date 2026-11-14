import { getProfilePolicy, resolveRisk, mergeProtectedPolicy, type Config, type Policy, type RegistrySnapshot, type Evaluation, type EvidenceStatus } from '@behavproof/core';
import { evaluateCoverage, evaluateMutation, type CoverageReport, type MutationReport, type Scope } from '@behavproof/adapter-reports';
import { evaluateAssurance, type ExecutionRow } from '@behavproof/contract-registry';
type State={status:EvidenceStatus;message:string;evidenceIds:string[]};
const worst=(states:readonly string[]):EvidenceStatus=>states.includes('fail')?'fail':states.length&&states.every(s=>s==='pass')?'pass':'unknown';
const sourcePath=(ref:string)=>ref.replace(/:\d+(?::\d+)?$/,'');
export function scopedEvaluations(input:{config:Config;protectedConfig?:Config;policy:Policy;registry:RegistrySnapshot;files:readonly string[];states:ReadonlyMap<string,State>;rows:ExecutionRow[];bindings:Record<string,string>;verifyRow:(row:ExecutionRow)=>boolean;claims:ReadonlyMap<string,Record<string,string>>;claimScopes:readonly {contractId:string;targetRef:string}[];intentStatus:ReadonlyMap<string,string>;coverage?:CoverageReport;mutation?:MutationReport;coverageTrusted:boolean;mutationTrusted:boolean;mapping:boolean;changed:Scope;sources:Readonly<Record<string,string>>}){
 const contexts:{id:string;path:string;contractId?:string;kind?:RegistrySnapshot['contracts'][number]['kind'];declaredRisk?:'basic'|'standard'|'critical'}[]=[];
 for(const c of input.registry.contracts)contexts.push({id:c.id,path:sourcePath(c.sourceRef),contractId:c.id,kind:c.kind,...(c.risk?{declaredRisk:c.risk}:{})});
 for(const path of input.files){const module=path.replace(/\.[cm]?[jt]sx?$/,'');if([...input.config.riskOverrides,...(input.protectedConfig?.riskOverrides??[])].some(o=>o.selector.kind==='module'?o.selector.value===module:o.selector.kind==='path'&&resolveRisk({...input.config,riskOverrides:[o]},{path,module})!==input.config.profile))contexts.push({id:path,path});}
 const result:Evaluation[]=[];
 for(const context of contexts){
  const target={path:context.path,module:context.path.replace(/\.[cm]?[jt]sx?$/,''),...(context.kind?{contractKind:context.kind}:{}),...(context.declaredRisk?{declaredRisk:context.declaredRisk}:{})};
  const protectedRisk=input.protectedConfig?resolveRisk(input.protectedConfig,target):undefined,risk=resolveRisk(input.config,target,protectedRisk),profile=getProfilePolicy(risk);
  // Risk selects mandatory obligations; numerical parameters come from the
  // already merged project/protected policy rather than reapplying preset defaults.
  for(const [id,rule] of Object.entries(profile.rules)){const configured=input.policy.rules[id];if(configured?.min!==undefined)rule.min=configured.min;if(configured?.minMutants!==undefined)rule.minMutants=configured.minMutants;if(configured?.allowNotApplicable)rule.allowNotApplicable=configured.allowNotApplicable;}
  const effective=mergeProtectedPolicy(input.policy,profile);
  const contracts=context.contractId?input.registry.contracts.filter(c=>c.id===context.contractId):input.registry.contracts.filter(c=>sourcePath(c.sourceRef)===context.path||input.claimScopes.some(s=>s.contractId===c.id&&s.targetRef.split('#')[0]===context.path));
  const selected={...input.registry,contracts},assurance=evaluateAssurance(selected,input.rows,input.bindings,input.verifyRow),facts=new Map(input.states);
  facts.set('contractExecution',{status:assurance.cases_executed,message:`Scoped ${risk} contract comparison requirements`,evidenceIds:[]});
  const intents=[...new Set(contracts.flatMap(c=>c.intentIds))];facts.set('intentApproval',{status:worst(intents.map(id=>input.intentStatus.get(id)??'unknown')),message:'Scoped Intent approval requirements',evidenceIds:[]});
  for(const [rule,claim] of [['negativeCases','negative_cases'],['productionTargetObserved','production_target_observed'],['mutationSensitivityObserved','mutation_sensitivity_observed']] as const)facts.set(rule,{status:worst(contracts.map(c=>input.claims.get(c.id)?.[claim]??'unknown')),message:`Scoped ${risk} case evidence required`,evidenceIds:[]});
  const paths=context.contractId?input.claimScopes.filter(s=>s.contractId===context.contractId).map(s=>s.targetRef.split('#')[0]!):[context.path],scope=Object.fromEntries(Object.entries(input.changed).filter(([path])=>paths.includes(path)));
  if(input.coverage){const evaluation=evaluateCoverage(input.coverage,scope,effective.rules.changedLineCoverage?.min??80,{},input.mapping);facts.set('changedLineCoverage',{status:input.coverageTrusted?evaluation.status:'unknown',message:`Scoped changed lines: ${JSON.stringify(evaluation.payload)}`,evidenceIds:[]});}
  else facts.set('changedLineCoverage',{status:'unknown',message:'Scoped coverage unavailable',evidenceIds:[]});
  if(input.mutation){const p=effective.rules.mutationScore,evaluation=evaluateMutation(input.mutation,scope,p?.min??70,p?.minMutants??10,input.sources,input.mapping);facts.set('mutationScore',{status:input.mutationTrusted?evaluation.status:'unknown',message:`Scoped mutants: ${JSON.stringify(evaluation.payload)}`,evidenceIds:[]});}
  else facts.set('mutationScore',{status:'unknown',message:'Scoped mutation data unavailable',evidenceIds:[]});
  for(const [ruleId,rule] of Object.entries(effective.rules)){
   const fact=facts.get(ruleId);result.push({ruleId,severity:rule.severity,status:fact?.status??'unknown',scope:[context.contractId?'contract':'path',context.id],evidenceIds:fact?.evidenceIds??[],message:fact?.message??`Evidence unavailable for ${risk} scope`});
  }
 }
 return result;
}
