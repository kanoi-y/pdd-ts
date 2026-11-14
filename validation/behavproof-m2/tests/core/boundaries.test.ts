import { describe, expect, it } from 'vitest';
import { canonicalJson, evaluateGate, mergeProtectedPolicy, parseConfig, parseEvidence } from '../../packages/core/src/index.js';
const digest='a'.repeat(64);
const evidence=(kind:string,payload:unknown)=>({schemaVersion:1,id:'e',kind,source:{tool:'tool',artifactRef:'report.json'},context:{effectivePolicyHash:digest,collectedAt:'2026-11-13T00:00:00Z'},provenance:{artifactIntegrity:'unknown',producerTrust:'unknown',subjectMatch:'unknown',reasons:[]},subjectRefs:[],payload});
describe('secondary validation boundaries',()=>{
  it('rejects sparse arrays with added properties and never invokes array accessors',()=>{
    const sparse=new Array(1);sparse.extra=1;
    expect(()=>canonicalJson(sparse)).toThrow();
    let accessed=false;const accessor:unknown[]=[];
    Object.defineProperty(accessor,'0',{enumerable:true,get(){accessed=true;return 1;}});
    expect(()=>canonicalJson(accessor)).toThrow();expect(accessed).toBe(false);
  });
  it('rejects pass claims with zero contract comparisons or observations',()=>{
    expect(()=>parseEvidence(evidence('contract_execution',{contractId:'c',caseId:'case',revisionHash:digest,bindingHash:digest,comparisonCount:0,status:'pass'}))).toThrow();
    expect(()=>parseEvidence(evidence('target_observation',{contractId:'c',caseIds:['case'],targetRef:'src/a.ts',method:'instrumentation',observations:0,status:'pass'}))).toThrow();
    expect(()=>parseEvidence(evidence('canary',{contractId:'c',caseIds:['case'],targetRef:'src/a.ts',method:'fault',detected:0,total:0,status:'pass'}))).toThrow();
  });
  it('does not grant N/A permission when either protected policy lacks it',()=>{
    const policy={schemaVersion:1 as const,profileVersion:'1' as const,rules:{r:{severity:'error' as const}}};
    expect(mergeProtectedPolicy({...policy,rules:{r:{severity:'error',allowNotApplicable:['no scope']}}},policy).rules.r?.allowNotApplicable).toEqual([]);
  });
  it('handles off rules as nonmandatory and validates malformed gate input',()=>{
    expect(evaluateGate([{ruleId:'r',severity:'off',status:'fail',evidenceIds:[],scope:[],message:'off'}],'gate').status).toBe('incomplete');
    expect(()=>evaluateGate([{ruleId:'r',severity:'error',status:'success',evidenceIds:[],scope:[],message:'bad'}] as never,'gate')).toThrow();
  });
  it('rejects oversized percentages and fractional count thresholds',()=>{
    for(const rule of [{severity:'error',min:101},{severity:'error',minMutants:0.5}])expect(()=>parseConfig({schemaVersion:1,rules:{r:rule}})).toThrow();
  });
});

it('rejects conflicting evidence with the same ID and deterministically deduplicates identical evidence', async()=>{
  const { mergeEvidence }=await import('../../packages/core/src/index.js');
  const a=evidence('test',{total:2,passed:2,failed:0,skipped:0});
  const b={...a,id:'other'};
  expect(mergeEvidence([b,a,a] as never).map(row=>row.id)).toEqual(['e','other']);
  expect(()=>mergeEvidence([a,{...a,payload:{total:2,passed:1,failed:1,skipped:0}}] as never)).toThrow(/conflict/i);
});

describe('reserved rule names cannot silently erase protected obligations',()=>{
  const policy={schemaVersion:1 as const,profileVersion:'1' as const,rules:{x:{severity:'error' as const}}};
  it.each(['__proto__','constructor','prototype','toString'])('rejects %s from config, project policy, and protected policy',async name=>{
    const {PolicySchema}=await import('../../packages/core/src/index.js');
    const rules=JSON.parse(`{"${name}":{"severity":"error"},"x":{"severity":"error"}}`);
    expect(()=>parseConfig({schemaVersion:1,rules})).toThrow();
    expect(()=>PolicySchema.parse({...policy,rules})).toThrow();
    expect(()=>mergeProtectedPolicy({...policy,rules},policy)).toThrow();
    expect(()=>mergeProtectedPolicy(policy,{...policy,rules})).toThrow();
  });
});
