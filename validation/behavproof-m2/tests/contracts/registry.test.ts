import { describe, it, expect } from 'vitest';
import { discover, reconcile, renderDocuments, snapshot as makeSnapshot } from '../../packages/contract-registry/src/index.js';
const literal = `import { defineContract } from '@behavproof/vitest';
const c = defineContract({id:'ORDER-001',intent:'private orders',risk:'critical',cases:[{id:'owner',input:{id:'a'},expected:'allowed'},{id:'other',input:{id:'b'},expected:'denied'}]});`;
describe('static contract registry', () => {
 it('extracts literals without executing and retains content hash on moves', () => {
  const a=discover({'a.ts':literal}); const b=discover({'b.ts':literal});
  expect(a.contracts).toHaveLength(1); expect(a.contracts[0].cases).toHaveLength(2);
  expect(a.contracts[0].revisionHash).toBe(b.contracts[0].revisionHash);
 });
 it('diagnoses dynamic expressions and duplicate IDs', () => {
  expect(discover({'a.ts':literal.replace("'private orders'",'process.exit()')}).diagnostics).not.toHaveLength(0);
  expect(() => discover({'a.ts':literal,'b.ts':literal})).toThrow(/duplicate/i);
 });
 it('preserves baseline obligations after removal and detects stale docs', () => {
  const a=discover({'a.ts':literal}); const result=reconcile(a,discover({}));
  expect(result.obligations).toHaveLength(1); expect(result.changes.some((x:any)=>x.type==='CONTRACT_REMOVED')).toBe(true);
  expect(renderDocuments(a).markdown).toContain('ORDER-001');
 });
});

it('requires the active revision and comparison while separating target claims', async () => {
 const {evaluateAssurance}=await import('../../packages/contract-registry/src/index.js');
 const c=discover({'a.ts':literal}).contracts[0];
 const row={contractId:c.id,caseId:'owner',revisionHash:c.revisionHash,bindingHash:'a'.repeat(64),comparisonCount:1,status:'pass'};
 const result=evaluateAssurance(makeSnapshot({contracts:[c],intents:[],diagnostics:[]},'base',[]),[row]);
 expect(result.cases_executed).toBe('unknown'); expect(result.production_target_observed).toBe('unknown');
 expect(evaluateAssurance(makeSnapshot({contracts:[c],intents:[],diagnostics:[]},'base',[]),[row,{...row,caseId:'other'}],{'["ORDER-001","owner"]':'a'.repeat(64),'["ORDER-001","other"]':'a'.repeat(64)},()=>true).cases_executed).toBe('pass');
 expect(evaluateAssurance(makeSnapshot({contracts:[c],intents:[],diagnostics:[]},'base',[]),[row,{...row,caseId:'other',status:'fail'}],{},()=>true).cases_executed).toBe('fail');
});

it('requires independently verified content-bound supersession',async()=>{
 const {transitionHash}=await import('../../packages/contract-registry/src/index.js');
 const a=discover({'a.ts':literal});const b=discover({'a.ts':literal.replace("expected:'denied'","expected:'allowed'")});
 const approval:any={schemaVersion:1,id:'review',target:{kind:'contract',id:'ORDER-001',contentHash:transitionHash(a.contracts[0],b.contracts[0])},status:'pass',source:{provider:'vcs',ref:'review'},approvedBy:['reviewer'],reasons:[]};
 expect(reconcile(a,b,[approval]).obligations[0].revisionHash).toBe(a.contracts[0].revisionHash);
 expect(reconcile(a,b,[approval],()=>true).obligations[0].revisionHash).toBe(b.contracts[0].revisionHash);
 expect(reconcile(a,b).changes.map((c:any)=>c.type)).toContain('CONTRACT_EXPECTED_CHANGED');
});
it('follows imports and reports unknown dynamic dependencies',async()=>{
 const {analyzeImpact}=await import('../../packages/contract-registry/src/index.js');
 const result=analyzeImpact({'test.ts':"import {f} from './src'; f(); import(name)",'src.ts':'export function f(){}'},['src.ts'],{'test.ts':['ORDER-001']});
 expect(result.contractIds).toContain('ORDER-001');expect(result.status).toBe('unknown');
});
it('does not verify arbitrary or stale binding hashes',async()=>{
 const {evaluateAssurance}=await import('../../packages/contract-registry/src/index.js');
 const c=discover({'a.ts':literal}).contracts[0];
 const rows=c.caseIds.map((caseId:string)=>({contractId:c.id,caseId,revisionHash:c.revisionHash,bindingHash:'a'.repeat(64),comparisonCount:1,status:'pass' as const}));
 expect(evaluateAssurance(makeSnapshot({contracts:[c],intents:[],diagnostics:[]},'base',[]),rows).binding_verified).toBe('unknown');
 expect(evaluateAssurance(makeSnapshot({contracts:[c],intents:[],diagnostics:[]},'base',[]),rows,{'["ORDER-001","owner"]':'a'.repeat(64),'["ORDER-001","other"]':'a'.repeat(64)},()=>true).binding_verified).toBe('pass');
});
it('accepts literal JSON manifests and diagnoses unsupported source kinds',async()=>{
 const {discoverSources}=await import('../../packages/contract-registry/src/index.js');
 const json=JSON.stringify({id:'M',intent:'safe',risk:'critical',cases:[{id:'x',input:1,expected:2}]});
 const result=discoverSources([{kind:'manifest',ref:'contract.json',content:json},{kind:'openapi',ref:'api.yaml',content:'x'}]);
 expect(result.contracts.map((c:any)=>c.id)).toEqual(['M']);expect(result.diagnostics[0].code).toBe('UNSUPPORTED_SOURCE');
});
it('rejects duplicate case IDs in imported registry snapshots',async()=>{
 const {RegistrySnapshotSchema}=await import('@behavproof/core');const d=discover({'a.ts':literal});
 const c=d.contracts[0];
 expect(RegistrySnapshotSchema.safeParse({schemaVersion:1,commitSha:'base',intents:d.intents,contracts:[{...c,caseIds:['owner','owner']}]}).success).toBe(false);
});
it('reports intent statement changes and detects edited generated documents',async()=>{
 const {checkDocuments}=await import('../../packages/contract-registry/src/index.js');
 const a=discover({'a.ts':literal}),b=discover({'a.ts':literal.replace('private orders','open orders')});
 expect(reconcile(a,b).changes.map((x:any)=>x.type)).toContain('INTENT_CHANGED_UNAPPROVED');
 const docs=renderDocuments(a);expect(checkDocuments(docs,{...docs,html:docs.html+'edit'})).toEqual(['DOCUMENT_OUTDATED']);
});
it('diagnoses indirect and namespace helper registration',()=>{
 const result=discover({'a.ts':"import * as bp from '@behavproof/vitest'; bp.defineContract(make());",'b.ts':"import {defineContract as dc} from '@behavproof/vitest'; const alias=dc; alias(make());"});
 expect(result.diagnostics).toHaveLength(2);expect(result.diagnostics.every((d:any)=>d.code==='CONTRACT_DISCOVERY_UNKNOWN')).toBe(true);
});
it('requires negative cases and scoped target and canary observations independently',async()=>{
 const {evaluateScopedClaims}=await import('../../packages/contract-registry/src/index.js');
 const c=discover({'a.ts':literal}).contracts[0];const scope={contractId:c.id,caseIds:['other'],targetRef:'src/order.ts#check',method:'instrumentation'};
 const observation={...scope,observations:1,status:'pass' as const};const canary={...scope,detected:1,total:1,status:'pass' as const};const row={contractId:c.id,caseId:'other',revisionHash:c.revisionHash,bindingHash:'a'.repeat(64),comparisonCount:1,status:'pass' as const};
 expect(evaluateScopedClaims(c,scope,[],[])).toMatchObject({negative_cases:'unknown',production_target_observed:'unknown',mutation_sensitivity_observed:'unknown'});
 c.cases[1].negative=true;
 expect(evaluateScopedClaims(c,scope,[observation],[canary],[row],{'["ORDER-001","owner"]':'a'.repeat(64),'["ORDER-001","other"]':'a'.repeat(64)},()=>true)).toMatchObject({negative_cases:'pass',production_target_observed:'pass',mutation_sensitivity_observed:'pass'});
 expect(evaluateScopedClaims(c,scope,[{...observation,targetRef:'wrong'}],[]).production_target_observed).toBe('unknown');
});
it('renders scoped execution evidence in all document formats',()=>{
 const a=discover({'a.ts':literal});const c=a.contracts[0];
 const docs=renderDocuments(a,[{contractId:c.id,caseId:'other',revisionHash:c.revisionHash,bindingHash:'a'.repeat(64),comparisonCount:1,status:'pass'}]);
 expect(docs.markdown).toContain('other');expect(docs.html).toContain('other');expect(JSON.parse(docs.json).execution).toHaveLength(1);
});
it('reports static calls and marks computed calls unknown',async()=>{
 const {analyzeImpact}=await import('../../packages/contract-registry/src/index.js');
 const result=analyzeImpact({'a.ts':'function f(){ return 1 }; f(); obj[key]()'},['a.ts'],{});
 expect(result.calls).toContainEqual({file:'a.ts',callee:'f'});expect(result.status).toBe('unknown');
});
it('rejects duplicate inline case IDs rather than dropping the contract',()=>{
 expect(()=>discover({'a.ts':literal.replace("id:'other'","id:'owner'")})).toThrow(/duplicate/i);
});
it('never elevates unverified comparison or observations',async()=>{
 const {evaluateAssurance,evaluateScopedClaims}=await import('../../packages/contract-registry/src/index.js');const c=discover({'a.ts':literal}).contracts[0];
 const rows=c.caseIds.map((caseId:string)=>({contractId:c.id,caseId,revisionHash:c.revisionHash,bindingHash:'a'.repeat(64),comparisonCount:1,status:'pass' as const}));
 expect(evaluateAssurance(makeSnapshot({contracts:[c],intents:[],diagnostics:[]},'base',[]),rows,{'["ORDER-001","owner"]':'a'.repeat(64),'["ORDER-001","other"]':'a'.repeat(64)}).cases_executed).toBe('unknown');
 const scope={contractId:c.id,caseIds:['other'],targetRef:'order',method:'instrumentation'};const observation={...scope,observations:1,status:'pass' as const};
 expect(evaluateScopedClaims(c,scope,[observation],[]).production_target_observed).toBe('unknown');
});
it('transitions lifecycle only on externally verified content-bound approvals',async()=>{
 const {lifecycle,lifecycleTransitionHash}=await import('../../packages/contract-registry/src/index.js');
 const i=discover({'a.ts':literal}).intents[0];const make=(contentHash:string)=>({schemaVersion:1 as const,id:'review',target:{kind:'intent' as const,id:i.id,contentHash},status:'pass' as const,source:{provider:'vcs',ref:'r'},approvedBy:['reviewer'],reasons:[]});
 const approval=make(i.contentHash);expect(lifecycle(i, [{action:'approve',approval}],()=>false).state).toBe('proposed');
 expect(lifecycle(i,[{action:'approve',approval}],()=>true).state).toBe('approved');
 const revoke=make(lifecycleTransitionHash('intent',i.id,i.contentHash,'revoke',null));
 expect(lifecycle(i,[{action:'approve',approval},{action:'revoke',approval:revoke}],()=>true).state).toBe('revoked');
 expect(lifecycle(i,[{action:'approve',approval},{action:'revoke',approval:make('a'.repeat(64))}],()=>true).state).toBe('approved');
});
it('builds typed evidence graph without trusting stale or unauthenticated rows',async()=>{
 const {buildEvidenceGraph}=await import('../../packages/contract-registry/src/index.js');const d=discover({'a.ts':literal});const c=d.contracts[0];
 const row={id:'ev-1',contractId:c.id,caseId:'owner',revisionHash:c.revisionHash,bindingHash:'a'.repeat(64),comparisonCount:1,status:'pass' as const};
 const inputs={registry:d,executions:[row],rules:[{id:'contractExecution',evidenceIds:['ev-1']}],approvals:[],expectedBindings:{'["ORDER-001","owner"]':'a'.repeat(64),'["ORDER-001","other"]':'a'.repeat(64)}};
 const denied=buildEvidenceGraph(inputs,()=>false,()=>false);expect(denied.edges.find((x:any)=>x.kind==='case_executed_by_test').status).toBe('unknown');
 const accepted=buildEvidenceGraph(inputs,()=>true,()=>false);expect(accepted.edges.find((x:any)=>x.kind==='case_executed_by_test').status).toBe('pass');expect(accepted.edges.some((x:any)=>x.kind==='evidence_supports_rule')).toBe(true);
});
it('derives expected bindings only from authenticated matching registration snapshots',async()=>{
 const {bindRegistrations,bindingKey}=await import('../../packages/contract-registry/src/index.js');
 const registration={testId:'t',contractId:'a:b',caseId:'c',revisionHash:'a'.repeat(64),bindingHash:'b'.repeat(64),bindingScope:'runtime-function-string-v1',comparisonCount:0,status:'unknown'};
 const row={...registration,comparisonCount:1,status:'pass'};
 expect(bindRegistrations([registration],[row],()=>false).status).toBe('unknown');
 expect(bindRegistrations([registration],[row],()=>true).bindings[bindingKey('a:b','c')]).toBe('b'.repeat(64));
 expect(bindRegistrations([registration],[{...row,bindingHash:'c'.repeat(64)}],()=>true).status).toBe('unknown');
 expect(bindRegistrations([registration,registration],[row],()=>true).status).toBe('unknown');
});
it('documents approval and execution scopes with unknown for untrusted or stale evidence',()=>{
 const d=discover({'a.ts':literal}),c=d.contracts[0],i=d.intents[0];const row={contractId:c.id,caseId:'other',revisionHash:'f'.repeat(64),bindingHash:'a'.repeat(64),comparisonCount:1,status:'pass' as const};
 const approval:any={schemaVersion:1,id:'review',target:{kind:'intent',id:i.id,contentHash:i.contentHash},status:'pass',source:{provider:'vcs',ref:'review-ref'},approvedBy:['r'],reasons:[]};
 const output=renderDocuments(d,[row],{approvals:[approval],verifyEvidence:()=>true,verifyApproval:()=>false});const parsed=JSON.parse(output.json);
 expect(parsed.execution[0].effectiveStatus).toBe('unknown');expect(parsed.approvals[0].effectiveStatus).toBe('unknown');
 expect(output.html).toContain('review-ref');expect(output.markdown).toContain('unknown');
});
it('tracks literal require and dynamic import paths conservatively',async()=>{
 const {analyzeImpact}=await import('../../packages/contract-registry/src/index.js');
 const result=analyzeImpact({'test.ts':"const src = require('./src'); import('./src')",'src.ts':'export const n=1'},['src.ts'],{'test.ts':['C']});
 expect(result.contractIds).toEqual(['C']);expect(result.status).toBe('pass');
});
it('marks changed unsupported semantic kinds explicitly',()=>{
 const a=discover({'a.ts':literal}),b=discover({'b.ts':literal});a.contracts[0].kind='state_machine';b.contracts[0].kind='state_machine';b.contracts[0].revisionHash='a'.repeat(64);
 expect(reconcile(a,b).changes.map((c:any)=>c.type)).toContain('UNSUPPORTED_SEMANTIC_DIFF');
});
it('does not let duplicate evidence IDs make a graph rule pass',async()=>{
 const {buildEvidenceGraph,bindingKey}=await import('../../packages/contract-registry/src/index.js');const d=discover({'a.ts':literal}),c=d.contracts[0];
 const row={id:'same',contractId:c.id,caseId:'owner',revisionHash:c.revisionHash,bindingHash:'a'.repeat(64),comparisonCount:1,status:'pass' as const};
 const g=buildEvidenceGraph({registry:d,executions:[row,row],rules:[{id:'rule',evidenceIds:['same']}],approvals:[],expectedBindings:{[bindingKey(c.id,'owner')]:row.bindingHash}},()=>true,()=>false);
 expect(g.edges.find((e:any)=>e.kind==='evidence_supports_rule').status).toBe('unknown');
});
it('rejects malformed approvals even if a verifier returns true',async()=>{
 const {transitionHash}=await import('../../packages/contract-registry/src/index.js');const a=discover({'a.ts':literal}),b=discover({'a.ts':literal.replace("expected:'denied'","expected:'allowed'")});
 const malformed:any={target:{kind:'contract',id:'ORDER-001',contentHash:transitionHash(a.contracts[0],b.contracts[0])},status:'pass'};
 expect(reconcile(a,b,[malformed],()=>true).obligations[0].revisionHash).toBe(a.contracts[0].revisionHash);
});
it('rejects malformed comparison counts and scoped observation counts',async()=>{
 const {evaluateAssurance,evaluateScopedClaims,bindingKey}=await import('../../packages/contract-registry/src/index.js');const c=discover({'a.ts':literal}).contracts[0];
 const rows=c.caseIds.map((caseId:string)=>({contractId:c.id,caseId,revisionHash:c.revisionHash,bindingHash:'a'.repeat(64),comparisonCount:Infinity,status:'pass' as const}));const bindings=Object.fromEntries(rows.map((r:any)=>[bindingKey(r.contractId,r.caseId),r.bindingHash]));
 expect(evaluateAssurance(makeSnapshot({contracts:[c],intents:[],diagnostics:[]},'base',[]),rows,bindings,()=>true).cases_executed).toBe('unknown');
 const scope={contractId:c.id,caseIds:['other'],targetRef:'target',method:'trace'};expect(evaluateScopedClaims(c,scope,[{...scope,observations:Infinity,status:'pass'}],[],[],{},()=>true).production_target_observed).toBe('unknown');
});
it('marks unresolved indirect calls unknown',async()=>{
 const {analyzeImpact}=await import('../../packages/contract-registry/src/index.js');
 expect(analyzeImpact({'a.ts':'const run=globalThis.handler; run();'},['a.ts'],{}).status).toBe('unknown');
});
it('allows distinct execution identities for one case and conservatively aggregates failures',async()=>{
 const {bindRegistrations,evaluateAssurance}=await import('../../packages/contract-registry/src/index.js');const c=discover({'a.ts':literal}).contracts[0];
 const make=(id:string,caseId:string,bindingHash:string)=>({testId:id,contractId:c.id,caseId,revisionHash:c.revisionHash,bindingHash,bindingScope:'runtime-function-string-v1',comparisonCount:0,status:'unknown'});
 const reg=[make('unit','owner','a'.repeat(64)),make('integration','owner','b'.repeat(64)),make('other','other','c'.repeat(64))];
 const rows=reg.map(x=>({...x,status:'pass' as const,comparisonCount:1}));const result=bindRegistrations(reg,rows,()=>true);expect(result.status).toBe('pass');
 expect(evaluateAssurance(makeSnapshot({contracts:[c],intents:[],diagnostics:[]},'base',[]),rows,result.bindings,()=>true).cases_executed).toBe('pass');
 expect(evaluateAssurance(makeSnapshot({contracts:[c],intents:[],diagnostics:[]},'base',[]),[...rows.slice(0,1),{...rows[1],status:'fail' as const},rows[2]],result.bindings,()=>true).cases_executed).toBe('fail');
 expect(bindRegistrations([reg[0],reg[0]], [rows[0],rows[0]],()=>true).status).toBe('unknown');
});
it('preserves discovery diagnostics and refuses a partial inventory pass',async()=>{
 const {snapshot,evaluateAssurance,bindingKey}=await import('../../packages/contract-registry/src/index.js');
 const d=discover({'a.ts':literal+"\nconst x=defineContract(make())"});const snap=snapshot(d,'base',['a.ts']);expect(snap.discoveryDiagnostics??[]).toHaveLength(1);
 const c=d.contracts[0];const rows=c.caseIds.map((caseId:string)=>({contractId:c.id,caseId,revisionHash:c.revisionHash,bindingHash:'a'.repeat(64),comparisonCount:1,status:'pass' as const}));const bindings=Object.fromEntries(rows.map((r:any)=>[bindingKey(r.contractId,r.caseId),r.bindingHash]));
 expect(evaluateAssurance(snap,rows,bindings,()=>true).cases_executed).toBe('unknown');
});
it('reconciles shared intent changes and deletion independently of contract approvals',async()=>{
 const {transitionHash,intentTransitionHash}=await import('../../packages/contract-registry/src/index.js');const a=discover({'a.ts':literal});const old=a.intents[0];
 const shared={...a.contracts[0],id:'SHARED'};a.contracts.push(shared);const changed={...old,statement:'changed',contentHash:'a'.repeat(64)};const b={contracts:a.contracts.map((x:any)=>({...x})),intents:[changed]};
 expect(reconcile(a,b).changes.some((x:any)=>x.type==='INTENT_CHANGED_UNAPPROVED')).toBe(true);expect(reconcile(a,b).intentObligations[0].contentHash).toBe(old.contentHash);
 const modified={...b,contracts:b.contracts.map((x:any,i:number)=>i===0?{...x,revisionHash:'b'.repeat(64)}:x)};
 const approval:any={schemaVersion:1,id:'contract-review',target:{kind:'contract',id:a.contracts[0].id,contentHash:transitionHash(a.contracts[0],modified.contracts[0])},status:'pass',source:{provider:'vcs',ref:'r'},approvedBy:['r'],reasons:[]};
 expect(reconcile(a,modified,[approval],()=>true).intentObligations[0].contentHash).toBe(old.contentHash);
 const refs=['ORDER-001','SHARED'];const ia={...approval,id:'intent-review',target:{kind:'intent',id:old.id,contentHash:intentTransitionHash(old,changed,refs,refs)}};
 expect(reconcile(a,modified,[ia],()=>true).intentObligations[0].contentHash).toBe(changed.contentHash);
 expect(reconcile(a,{contracts:b.contracts,intents:[]}).intentObligations[0].contentHash).toBe(old.contentHash);
});
it('requires case-attributed scoped claims and never masks verified failures',async()=>{
 const {evaluateScopedClaims,bindingKey}=await import('../../packages/contract-registry/src/index.js');const c=discover({'a.ts':literal}).contracts[0];c.cases[1].negative=true;
 const scope={contractId:c.id,caseIds:['owner','other'],targetRef:'target',method:'trace'};const obs={...scope,observations:1,status:'pass' as const};const canary={...scope,detected:1,total:1,status:'pass' as const};
 expect(evaluateScopedClaims(c,scope,[obs],[canary],[],{},()=>true)).toMatchObject({production_target_observed:'unknown',mutation_sensitivity_observed:'unknown'});
 const row={contractId:c.id,caseId:'other',revisionHash:c.revisionHash,bindingHash:'a'.repeat(64),comparisonCount:1,status:'pass' as const};const bindings={[bindingKey(c.id,'other')]:row.bindingHash};
 expect(evaluateScopedClaims(c,{...scope,contractId:'wrong'},[],[],[row],bindings,()=>true).negative_cases).toBe('unknown');
 expect(evaluateScopedClaims(c,scope,[],[],[row,{...row,status:'fail'}],bindings,()=>true).negative_cases).toBe('fail');
 const attributed=scope.caseIds.map(caseId=>({...obs,caseIds:[caseId]}));const canaries=scope.caseIds.map(caseId=>({...canary,caseIds:[caseId]}));
 expect(evaluateScopedClaims(c,scope,attributed,canaries,[row],bindings,()=>true)).toMatchObject({production_target_observed:'pass',mutation_sensitivity_observed:'pass'});
});
it('retains the old executable relationship after contract-only approval',async()=>{
 const {transitionHash,intentTransitionHash}=await import('../../packages/contract-registry/src/index.js');
 const base=discover({'a.ts':literal}), c=base.contracts[0], intent=base.intents[0];
 const head={contracts:[],intents:base.intents};
 const approve=(kind:string,id:string,contentHash:string)=>({schemaVersion:1,id:`${kind}-approval`,target:{kind,id,contentHash},status:'pass',source:{provider:'vcs',ref:'r'},approvedBy:['r'],reasons:[]}) as any;
 const contractApproval=approve('contract',c.id,transitionHash(c,undefined));
 const unapproved=reconcile(base,head,[contractApproval],()=>true);
 expect(unapproved.obligations.map(x=>x.id)).toContain(c.id);expect(unapproved.obligations[0].intentIds).toContain(intent.id);
 const intentApproval=approve('intent',intent.id,intentTransitionHash(intent,intent,[c.id],[]));
 expect(reconcile(base,head,[contractApproval,intentApproval],()=>true).obligations).toHaveLength(0);
 const changed={...c,intentIds:[],revisionHash:'b'.repeat(64)};const changedHead={contracts:[changed],intents:base.intents};
 const changeApproval=approve('contract',c.id,transitionHash(c,changed));
 expect(reconcile(base,changedHead,[changeApproval],()=>true).obligations[0].intentIds).toContain(intent.id);
});
it('does not mask a skipped or missing negative-case execution',async()=>{
 const {evaluateScopedClaims,bindingKey}=await import('../../packages/contract-registry/src/index.js');
 const c=discover({'a.ts':literal}).contracts[0];c.cases[1].negative=true;
 const scope={contractId:c.id,caseIds:['other'],targetRef:'target',method:'trace'};
 const base={contractId:c.id,caseId:'other',revisionHash:c.revisionHash,bindingHash:'a'.repeat(64),comparisonCount:1,status:'pass' as const};
 const first={...base,testId:'unit'},second={...base,testId:'integration'};
 const bindings={[bindingKey(c.id,'other','unit')]:base.bindingHash,[bindingKey(c.id,'other','integration')]:base.bindingHash};
 expect(evaluateScopedClaims(c,scope,[],[],[first,{...second,status:'unknown',comparisonCount:0}],bindings,()=>true).negative_cases).toBe('unknown');
 expect(evaluateScopedClaims(c,scope,[],[],[first],bindings,()=>true).negative_cases).toBe('unknown');
 expect(evaluateScopedClaims(c,scope,[],[],[first,second],bindings,()=>true).negative_cases).toBe('pass');
 expect(evaluateScopedClaims(c,scope,[],[],[first,{...second,status:'fail'}],bindings,()=>true).negative_cases).toBe('fail');
});
it('does not attribute a negative failure to a mismatched test binding',async()=>{
 const {evaluateScopedClaims,bindingKey}=await import('../../packages/contract-registry/src/index.js');
 const c=discover({'a.ts':literal}).contracts[0];c.cases[1].negative=true;
 const scope={contractId:c.id,caseIds:['other'],targetRef:'target',method:'trace'};
 const row={testId:'unit',contractId:c.id,caseId:'other',revisionHash:c.revisionHash,bindingHash:'b'.repeat(64),comparisonCount:1,status:'fail' as const};
 const bindings={[bindingKey(c.id,'other','unit')]:'a'.repeat(64)};
 expect(evaluateScopedClaims(c,scope,[],[],[row],bindings,()=>true).negative_cases).toBe('unknown');
 expect(evaluateScopedClaims(c,scope,[],[],[{...row,testId:'other-test',bindingHash:'a'.repeat(64)}],bindings,()=>true).negative_cases).toBe('unknown');
 expect(evaluateScopedClaims(c,scope,[],[],[{...row,bindingHash:'a'.repeat(64)}],bindings,()=>true).negative_cases).toBe('fail');
});
