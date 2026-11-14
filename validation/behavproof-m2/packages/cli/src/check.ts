import { scopedEvaluations } from './scopes.js';
import { safeRead, safeReadJson, parseConfig, hashBytes, mergeProtectedPolicy, evaluateGate, hash, type Evaluation, type EvidenceStatus, type Approval, type Config, EvidenceSchema } from '@behavproof/core';
import { detectProject, gitDiff, gitSubject, normalizeVitest, normalizeLcov, normalizeStryker, evaluateCoverage, evaluateMutation, lineMapping, verifyMergeSubject } from '@behavproof/adapter-reports';
import { reconcile, evaluateAssurance, bindRegistrations, evaluateScopedClaims, type ExecutionRow, type ReportBinding } from '@behavproof/contract-registry';
import { GitHubAuthority, diagnoseWorkflow, evaluateUpstream } from '@behavproof/adapter-github';
import { config, fileList, select, registry, registryAtGit, ref, exists } from './project.js';
import { authenticate, isCurrentClaim, loadTrust, approvalKey, type TrustRoot } from './trust.js';
export type CheckOptions={config?:string;profile?:string;mode?:string;base?:string;head?:string;'trust-root'?:string};
const worst=(states:readonly string[]):EvidenceStatus=>states.includes('fail')?'fail':states.length&&states.every(x=>x==='pass')?'pass':'unknown';
export async function check(root:string,options:CheckOptions){
 const configPath=options.config??'behavproof.config.json',configBytes=await exists(root,configPath)?await safeRead(root,configPath):undefined;
 const rawConfig=configBytes?JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(configBytes)):{schemaVersion:1};
 const cfg=parseConfig({...rawConfig,...(options.profile?{profile:options.profile}:{})}),mode=options.mode??cfg.mode;
 if(mode!=='gate'&&mode!=='audit')throw Error('Invalid mode');
 if(mode==='gate'&&!options['trust-root'])throw Error('Gate mode requires --trust-root outside project authority');
 const trust=options['trust-root']?await loadTrust(root,options['trust-root']):undefined;
 const policy=trust?mergeProtectedPolicy({schemaVersion:1,profileVersion:'1',rules:cfg.rules},trust.policy):{schemaVersion:1 as const,profileVersion:'1' as const,rules:cfg.rules};
 const files=await fileList(root),detection=await detectProject(root);
 const diff=await gitDiff(root,ref(options.base??cfg.git.base),ref(options.head??'HEAD'));
 const inputPaths=trust?select(files,trust.inputs):files.filter(p=>!p.startsWith('.behavproof/')&&!Object.values(cfg.reports).includes(p));
 if(!inputPaths.length)throw Error('No source inputs in evaluation scope');
 const subject=await gitSubject(root,inputPaths,diff.headSha,diff.baseSha);
 const testedRelationship=await verifyMergeSubject(root,subject);
 for(const path of select(files,cfg.executionManifests)) (await import('@behavproof/core')).ExecutionManifestSchema.parse(await safeReadJson(root,path));
 const auth=await authenticate(root,trust,subject);
 const readArtifact=async(path:string)=>auth.artifactBytes.get(path)??await safeRead(root,path);
 const readArtifactJson=async(path:string)=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readArtifact(path)));
 const head=await registry(root,cfg,files,subject.testedCommitSha,trust?.config.contracts.sources??[]);
 const approvals:Approval[]=[],approved=new Set<string>();
 let drift=reconcile(trust?.baseline??{contracts:[],intents:[]},head);
 if(trust?.github){
  const targetsFor=(head:import('@behavproof/core').RegistrySnapshot,drift:ReturnType<typeof reconcile>)=>[...head.intents.map(i=>({kind:'intent' as const,id:i.id,contentHash:i.contentHash})),...head.contracts.map(c=>({kind:'contract' as const,id:c.id,contentHash:c.revisionHash})),...drift.changes.filter(c=>c.contractId||c.intentId).map(c=>({kind:c.intentId?'intent' as const:'contract' as const,id:(c.intentId??c.contractId)!,contentHash:c.transitionHash}))];
  const reviewedHead=await registryAtGit(root,cfg,diff.headSha,trust.config.contracts.sources);
  const reviewedDrift=reconcile(trust.baseline,reviewedHead);
  const permitted=new Set((reviewedHead.discoveryDiagnostics?.length===0?targetsFor(reviewedHead,reviewedDrift):[]).map(t=>hash(t)));
  const targets=targetsFor(head,drift).filter(target=>permitted.has(hash(target)));
  const unique=[...new Map(targets.map(t=>[hash(t),t])).values()];if(unique.length>200)throw Error('Approval target limit exceeded');
  const g=trust.github,provider=new GitHubAuthority({repository:g.repository,...(process.env.GITHUB_TOKEN?{token:process.env.GITHUB_TOKEN}:{})});
  for(const target of unique){const result=await provider.approval(g.pr,target,{headSha:diff.headSha,baseSha:diff.baseSha,reviewers:g.reviewers,requiredChecks:g.requiredChecks});if(result.approval&&result.status==='pass'){approvals.push(result.approval);approved.add(approvalKey(result.approval));}}
  drift=reconcile(trust.baseline,head,approvals,a=>approved.has(approvalKey(a)));
 }
 const obligations={...head,contracts:drift.obligations,intents:drift.intentObligations};
 const states=new Map<string,{status:EvidenceStatus;message:string;evidenceIds:string[]}>();
 const set=(id:string,status:EvidenceStatus,message:string,evidenceIds:string[]=[])=>states.set(id,{status,message,evidenceIds});
 const trusted=(path:string|undefined)=>!!path&&auth.verified.has(path)&&auth.failures.length===0&&detection.support==='single-package';
 // Parse configured artifacts even when unauthenticated so malformed input is exit2, not unknown.
 let contractData:any,contractPath:string|undefined;
 for(const spec of trust?.manifests??[])for(const a of spec.expected.artifacts)if(a.kind==='contract_report'&&auth.verified.has(a.ref)){
  if(contractData)throw Error('Multiple contract reports are ambiguous');contractData=await readArtifactJson(a.ref);contractPath=a.ref;
  if(!contractData||contractData.schemaVersion!==1||!Array.isArray(contractData.contracts)||!Array.isArray(contractData.registrations)||!contractData.inventory)throw Error('Malformed contract report');
 }
 const vitestPath=cfg.reports.vitest??trust?.config.reports.vitest;
 if(vitestPath&&await exists(root,vitestPath)){
  const result=normalizeVitest(await readArtifactJson(vitestPath),contractData?.inventory);
  set('testResult',result.status==='fail'?'fail':trusted(vitestPath)?result.status:'unknown',`Vitest ${JSON.stringify(result.payload)}; ${trusted(vitestPath)?'verified current producer':'producer/subject unverified'}`,[vitestPath]);
 }
 const scope=Object.fromEntries(diff.files.filter(f=>!f.kind.startsWith('D')&&/\.[cm]?[jt]sx?$/.test(f.path)).map(f=>[f.path,f.lines]));
 const mapping=diff.status==='known'&&!diff.files.some(f=>f.ambiguous)&&await lineMapping(root,diff.headSha,subject.testedCommitSha,Object.keys(scope))==='known';
 let normalizedCoverage:ReturnType<typeof normalizeLcov>|undefined,normalizedMutation:ReturnType<typeof normalizeStryker>|undefined;const mutationSources:Record<string,string>={};
 const coveragePath=cfg.reports.coverage??trust?.config.reports.coverage;
 if(coveragePath&&await exists(root,coveragePath)){
  const report=normalizeLcov((await readArtifact(coveragePath)).toString('utf8'));
  normalizedCoverage=report;
  const result=evaluateCoverage(report,scope,policy.rules.changedLineCoverage?.min??80,{},mapping);
  set('changedLineCoverage',trusted(coveragePath)?result.status:'unknown',`Changed executable line counts ${JSON.stringify(result.payload)}; score ${result.score??'unknown'}`,[coveragePath]);
 }
 const mutationPath=cfg.reports.mutation??trust?.config.reports.mutation;
 if(mutationPath&&await exists(root,mutationPath)){
  const report=normalizeStryker(await readArtifactJson(mutationPath)),sources:Record<string,string>={};for(const path of Object.keys(scope))sources[path]=(await safeRead(root,path)).toString('utf8');
  normalizedMutation=report;Object.assign(mutationSources,sources);
  const rule=policy.rules.mutationScore,result=evaluateMutation(report,scope,rule?.min??70,rule?.minMutants??10,sources,mapping);
  set('mutationScore',trusted(mutationPath)?result.status:'unknown',`Mutant counts ${JSON.stringify(result.payload)}; score ${result.score??'unknown'}`,[mutationPath]);
 }
 const rows=(contractData?.contracts??[]) as (ExecutionRow&ReportBinding)[],registrations=(contractData?.registrations??[]) as ReportBinding[];
 const bindings=bindRegistrations(registrations,rows,()=>!!contractPath&&trusted(contractPath)).bindings;
 const assurance=evaluateAssurance(obligations,rows,bindings,()=>!!contractPath&&trusted(contractPath));
 set('contractExecution',assurance.cases_executed,`Declared: ${assurance.contract_declared}; binding: ${assurance.binding_verified}; cases: ${assurance.cases_executed}`,contractPath?[contractPath]:[]);
 const intentStatus=new Map(obligations.intents.map(i=>[i.id,trust?.baseline.intents.some(b=>b.id===i.id&&b.contentHash===i.contentHash)||approvals.some(a=>a.target.kind==='intent'&&a.target.id===i.id&&a.target.contentHash===i.contentHash)?'pass':'unknown']));const approvalStates=[...intentStatus.values()];
 const unresolved=drift.changes.some(c=>c.type==='UNSUPPORTED_SEMANTIC_DIFF'||!approvals.some(a=>a.target.kind===(c.intentId?'intent':'contract')&&a.target.id===(c.intentId??c.contractId)&&a.target.contentHash===c.transitionHash));
 for(const change of drift.changes){if(!approvals.some(a=>a.target.kind===(change.intentId?'intent':'contract')&&a.target.id===(change.intentId??change.contractId)&&a.target.contentHash===change.transitionHash)){if(change.intentId)intentStatus.set(change.intentId,'fail');if(change.contractId)for(const id of obligations.contracts.find(c=>c.id===change.contractId)?.intentIds??[])intentStatus.set(id,'fail');}}
 set('intentApproval',!trust?'unknown':unresolved?'fail':worst(approvalStates),'Intent content and transitions require independently verified human approval');
 const observations:any[]=[],canaries:any[]=[];
 for(const spec of trust?.manifests??[])for(const a of spec.expected.artifacts)if(a.kind==='claims'&&trusted(a.ref)){
  const raw=await readArtifactJson(a.ref);if(!Array.isArray(raw)||raw.length>10000)throw Error('Malformed scoped claim inventory');
  for(const item of raw){const evidence=EvidenceSchema.parse(item);if(!isCurrentClaim(evidence,a.ref,subject,hash(policy),obligations.contracts))continue;if(evidence.kind==='target_observation')observations.push(evidence.payload);if(evidence.kind==='canary')canaries.push(evidence.payload);}
 }
 const scoped=obligations.contracts.map(contract=>{
  const s=trust?.claimScopes.find(s=>s.contractId===contract.id);
  if(!s||hash([...s.caseIds].sort())!==hash([...(contract.caseIds??[])].sort()))return {negativeCases:'unknown',productionTargetObserved:'unknown',mutationSensitivityObserved:'unknown'};
  return evaluateScopedClaims(contract,s,observations,canaries,rows,bindings,row=>rows.includes(row as any)?!!contractPath&&trusted(contractPath):observations.includes(row)||canaries.includes(row));
 });
 const scopedClaims=new Map(obligations.contracts.map((c,i)=>[c.id,scoped[i] as Record<string,string>]));
 for(const [rule,key] of [['negativeCases','negative_cases'],['productionTargetObserved','production_target_observed'],['mutationSensitivityObserved','mutation_sensitivity_observed']] as const)set(rule,worst(scoped.map((s:any)=>s[key]??s[rule]??'unknown')),'Requires case-scoped authenticated evidence; aggregate scores do not establish this claim');
 if(trust){
  const sourceWeakened=trust.config.contracts.enabled&&!cfg.contracts.enabled||trust.config.contracts.sources.some(s=>s.include.some(p=>!cfg.contracts.sources.some(c=>c.type===s.type&&c.include.includes(p))));
  const weakened=sourceWeakened||Object.entries(trust.policy.rules).some(([id,r])=>{const local=cfg.rules[id],levels={off:0,warn:1,error:2};return !local||levels[local.severity]<levels[r.severity]||(r.min!==undefined&&(local.min??-1)<r.min)||(r.minMutants!==undefined&&(local.minMutants??-1)<r.minMutants);});
  set('policyProtection',weakened?'fail':'pass',weakened?'Project policy weakens protected obligations; effective evaluation retains protected thresholds':'Policy supplied outside project authority');
 }
 if(trust?.pipeline){const p=trust.pipeline,diagnosis=diagnoseWorkflow((await safeRead(root,p.workflow)).toString('utf8'),p);let upstream:ReturnType<typeof evaluateUpstream>|undefined;
  for(const spec of trust.manifests)for(const a of spec.expected.artifacts)if(a.kind==='pipeline'&&trusted(a.ref)){const raw=await readArtifactJson(a.ref) as any;if(!raw||!raw.jobs||!Array.isArray(raw.artifacts))throw Error('Invalid pipeline report');upstream=evaluateUpstream(raw.jobs,raw.artifacts,p);}
  let protectedStatus='unknown';if(auth.trustedCi&&trust.github){const result=await new GitHubAuthority({repository:trust.github.repository,...(process.env.GITHUB_TOKEN?{token:process.env.GITHUB_TOKEN}:{})}).protection(p.protectedBranch,trust.github.requiredChecks);protectedStatus=result.status;}
  set('pipelineIntegrity',worst([diagnosis.internal.status,upstream?.status??'unknown',protectedStatus]),'Workflow health, authenticated upstream outcomes and issuer-bound external protection evaluated separately');
 }
 if(auth.failures.length)set('evidenceIntegrity','fail',auth.failures.join('; '));
 const evaluations:Evaluation[]=Object.entries(policy.rules).map(([ruleId,rule])=>{
  const exemption=trust?.notApplicable.find(n=>n.ruleId===ruleId&&states.get(ruleId)?.status!=='fail'&&rule.allowNotApplicable?.includes(n.reason)&&trusted(n.evidenceRef));
  if(exemption)return {ruleId,severity:rule.severity,status:'not_applicable',scope:[],evidenceIds:[exemption.evidenceRef],message:exemption.reason,notApplicable:{reason:exemption.reason,allowedReasons:rule.allowNotApplicable!,evidenceIds:[exemption.evidenceRef]}};
  return {ruleId,severity:rule.severity,status:states.get(ruleId)?.status??'unknown',scope:[],evidenceIds:states.get(ruleId)?.evidenceIds??[],message:states.get(ruleId)?.message??'Required evidence unavailable; collect and authenticate current evidence'};
 });
 evaluations.push(...scopedEvaluations({config:cfg,...(trust?{protectedConfig:trust.config}:{}),policy,registry:obligations,files:inputPaths,states,rows,bindings,verifyRow:()=>!!contractPath&&trusted(contractPath),claims:scopedClaims,claimScopes:trust?.claimScopes??[],intentStatus,...(normalizedCoverage?{coverage:normalizedCoverage}:{}),...(normalizedMutation?{mutation:normalizedMutation}:{}),coverageTrusted:trusted(coveragePath),mutationTrusted:trusted(mutationPath),mapping,changed:scope,sources:mutationSources}));
 for(const evaluation of evaluations){const allowed=policy.rules[evaluation.ruleId]?.allowNotApplicable;const exemption=trust?.notApplicable.find(n=>n.ruleId===evaluation.ruleId&&allowed?.includes(n.reason)&&trusted(n.evidenceRef));if(exemption&&evaluation.status==='unknown'){evaluation.status='not_applicable';evaluation.evidenceIds=[exemption.evidenceRef];evaluation.message=exemption.reason;evaluation.notApplicable={reason:exemption.reason,allowedReasons:allowed!,evidenceIds:[exemption.evidenceRef]};}}
 if(auth.failures.length)evaluations.push({ruleId:'evidenceIntegrity',severity:'error',status:'fail',scope:[],evidenceIds:[],message:auth.failures.join('; ')});
 if(testedRelationship!=='known')evaluations.push({ruleId:'testedCommitRelationship',severity:'error',status:'unknown',scope:[],evidenceIds:[],message:'Tested commit is neither PR head nor a verified base/head synthetic merge'});
 if(detection.support!=='single-package'||subject.dirty)evaluations.push({ruleId:'evaluationEnvironment',severity:'error',status:'unknown',scope:[],evidenceIds:[],message:subject.dirty?'Source inputs contain uncommitted or untracked changes':detection.reasons.join('; ')});
 const finalFiles=await fileList(root),finalPaths=trust?select(finalFiles,trust.inputs):finalFiles.filter(p=>!p.startsWith('.behavproof/')&&!Object.values(cfg.reports).includes(p));
 const finalSubject=await gitSubject(root,finalPaths,diff.headSha,diff.baseSha);
 let configsChanged=false;for(const [path,digest] of Object.entries(auth.configHashes))if(hashBytes(await safeRead(root,path))!==digest)configsChanged=true;
 if(trust?.dependencyLockPath&&hashBytes(await safeRead(root,trust.dependencyLockPath))!==auth.dependencyLockHash)configsChanged=true;
 const finalConfig=await exists(root,configPath)?await safeRead(root,configPath):undefined;
 if(configsChanged||hash(finalSubject)!==hash(subject)||(configBytes?hashBytes(configBytes):null)!==(finalConfig?hashBytes(finalConfig):null))evaluations.push({ruleId:'evaluationSnapshot',severity:'error',status:'fail',scope:[],evidenceIds:[],message:'Source, configuration or HEAD changed during evaluation'});
 const stable=!evaluations.some(e=>e.ruleId==='evaluationSnapshot'||e.ruleId==='testedCommitRelationship')&&!subject.dirty;
 return {...evaluateGate(evaluations,mode),documentEvidence:{registry:obligations,rows,bindings,authenticatedRows:stable&&contractPath&&trusted(contractPath)?rows.map(row=>hash(row)):[],authenticatedApprovals:stable?[...approved].sort():[]},subject,diff,detection,provenance:{manifests:auth.manifests,reasons:auth.unknowns},assurance,drift:drift.changes,approvals};
}
