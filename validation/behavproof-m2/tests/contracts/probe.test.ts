import {test,expect} from 'vitest';
import {instrumentFunction,evaluateProbeRuns} from '../../packages/contract-registry/src/probe.js';
import {withTargetCalls,observeTargetCall} from '../../packages/contract-vitest/src/probe.js';
import {hashBytes} from '../../packages/core/src/index.js';
import {discover,snapshot} from '../../packages/contract-registry/src/index.js';
const source='export function readOrder(owner:boolean) { return owner ? "yes" : "no"; }',targetRef='src/orders.ts#readOrder',sourceHash=hashBytes(Buffer.from(source));
const input={source,targetRef,expectedSourceHash:sourceHash,faultValue:{__behavproof_fault:'probe-1'}};
test('instrumentation preserves the production body and injects a source-scoped fault as separate programs',()=>{
 const result=instrumentFunction(input);expect(result.status).toBe('supported');expect(result.originalSha256).toBe(sourceHash);expect(result.observedSource).toContain('owner ? "yes" : "no"');expect(result.observedSource).toContain('observeTargetCall');expect(result.mutatedSource).toContain('__behavproof_fault');expect(result.fault.mutatedSha256).not.toBe(result.fault.originalSha256);
});
test('a source mismatch, missing export or unsupported target stays unknown',()=>{
 expect(instrumentFunction({...input,expectedSourceHash:'0'.repeat(64)}).status).toBe('unknown');expect(instrumentFunction({...input,targetRef:'src/orders.ts#missing'}).status).toBe('unknown');const arrow='export const readOrder = () => true';expect(instrumentFunction({...input,source:arrow,expectedSourceHash:hashBytes(Buffer.from(arrow))}).status).toBe('unknown');
});
test('parallel asynchronous callbacks retain separate observation scopes and ambient calls add no evidence',async()=>{
 observeTargetCall(targetRef);const observations:any[]=[];
 await Promise.all([1,2].map(n=>withTargetCalls(async()=>{await new Promise(resolve=>setTimeout(resolve,n));for(let i=0;i<n;i++)observeTargetCall(targetRef);},calls=>{observations.push(calls);})));expect(observations.map(calls=>calls[0]?.count).sort()).toEqual([1,2]);
});
const contract=snapshot(discover({'test.ts':`import {defineContract} from '@behavproof/vitest';const c=defineContract({id:'ORDER',intent:'owner',risk:'critical',cases:[{id:'owner',input:true,expected:'yes'},{id:'other',negative:true,input:false,expected:'no'}]});`}), 'a'.repeat(40),['test.ts']).contracts[0]!;
const binding='b'.repeat(64),mutatedHash='c'.repeat(64);
function run(canary=false){
 const rows=contract.caseIds!.map((caseId,i)=>({testId:`${canary?'canary':'main'}-${i}`,contractId:contract.id,caseId,revisionHash:contract.revisionHash,bindingHash:binding,bindingScope:'runtime-function-string-v1',status:canary?'fail':'pass',comparisonCount:1,testState:canary?'failed':'passed',targetCalls:[{targetRef,count:1}]}));
 return {executionId:canary?'canary':'main',exitCode:canary?1:0,sourceHash:canary?mutatedHash:sourceHash,report:{registrations:rows.map(row=>({...row,status:'unknown',comparisonCount:0})),contracts:rows}};
}
const protocol=()=>({contract,targetRef,expectedSourceHash:sourceHash,main:run(),canary:run(true),fault:{targetRef,originalSha256:sourceHash,mutatedSha256:mutatedHash,description:'replace body with distinct value'}});
test('matching current case bindings, production calls and actual failed comparisons establish separate scoped results',()=>{
 const result=evaluateProbeRuns(protocol(),()=>true);expect(result.observations).toHaveLength(2);expect(result.observations.every((row:any)=>row.status==='pass'&&row.observations===1)).toBe(true);expect(result.canaries.every((row:any)=>row.status==='pass'&&row.detected===1&&row.total===1)).toBe(true);
});
test.each(['fake','different-binding','different-revision','missing-case','no-comparison','no-target','old-source','unrelated-failure'])('%s cannot establish sensitivity for the required callback',kind=>{
 const value=protocol();if(kind==='fake')for(const row of value.main.report.contracts)row.targetCalls=[];if(kind==='different-binding')value.canary.report.contracts[0]!.bindingHash='d'.repeat(64);if(kind==='different-revision')value.canary.report.contracts[0]!.revisionHash='d'.repeat(64);if(kind==='missing-case')value.canary.report.contracts.pop();if(kind==='no-comparison')value.canary.report.contracts[0]!.comparisonCount=0;if(kind==='no-target')value.canary.report.contracts[0]!.targetCalls=[];if(kind==='old-source')value.canary.sourceHash=sourceHash;if(kind==='unrelated-failure')for(const row of value.canary.report.contracts){row.status='unknown';row.comparisonCount=0;}
 expect(evaluateProbeRuns(value,()=>true).canaries.every((row:any)=>row.status==='pass')).toBe(false);
});
test('unverified diagnostics and Promise callbacks never become positive scoped evidence',()=>{
 for(const verify of [()=>false,()=>Promise.resolve(true)]){const result=evaluateProbeRuns(protocol(),verify);expect(result.observations.some((row:any)=>row.status==='pass')).toBe(false);expect(result.canaries.some((row:any)=>row.status==='pass')).toBe(false);}
});
test('verification callbacks cannot retarget the protocol or rewrite observed rows',()=>{
 const value=protocol(),result=evaluateProbeRuns(value,run=>{value.targetRef='src/other.ts#fake';try{run.report.contracts[0]!.targetCalls=[];}catch{}return true;});expect(result.observations.every(row=>row.targetRef===targetRef&&row.status==='pass')).toBe(true);
});
test('an overflowing repeated-registration observation total remains unknown',()=>{
 const value=protocol();const row=value.main.report.contracts[0]!;row.targetCalls[0]!.count=Number.MAX_SAFE_INTEGER;
 value.main.report.contracts.push({...structuredClone(row),testId:'main-repeat'});value.main.report.registrations.push({...structuredClone(row),testId:'main-repeat',comparisonCount:0,status:'unknown'});
 expect(evaluateProbeRuns(value,()=>true).observations.find(row=>row.caseIds[0]==='owner')?.status).toBe('unknown');
});
