import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { evaluateGate, evaluateThreshold, mergeProtectedPolicy, parseConfig } from '../../packages/core/src/index.js';
import type { Evaluation } from '../../packages/core/src/index.js';
const evaluation = (status: Evaluation['status'], severity: Evaluation['severity'] = 'error'): Evaluation => ({ruleId:'testResult',status,severity,evidenceIds:[],scope:[],message:'test'});
describe('mandatory gate obligations', () => {
  it.each(['fail','unknown'] as const)('blocks mandatory %s while audit exits normally', status => {
    expect(evaluateGate([evaluation(status)], 'gate').exitCode).toBe(1);
    expect(evaluateGate([evaluation(status)], 'audit').exitCode).toBe(0);
  });
  it('does not let warnings fail a satisfied mandatory gate', () => {
    expect(evaluateGate([evaluation('pass'),{...evaluation('fail','warn'),ruleId:'warning'}],'gate').status).toBe('pass');
  });
  it('blocks an empty mandatory rule inventory', () => { expect(evaluateGate([evaluation('pass','warn')],'gate').exitCode).toBe(1); });
  it('requires a permitted N/A reason and independently referenced evidence', () => {
    expect(evaluateGate([evaluation('not_applicable')],'gate').status).toBe('incomplete');
    expect(evaluateGate([{...evaluation('not_applicable'),notApplicable:{reason:'no executable lines',allowedReasons:['no executable lines'],evidenceIds:['scope-1']}}],'gate').status).toBe('pass');
    expect(evaluateGate([{...evaluation('not_applicable'),notApplicable:{reason:'unapproved',allowedReasons:['no executable lines'],evidenceIds:['scope-1']}}],'gate').exitCode).toBe(1);
  });
  it.each([[80,'pass'],[79,'fail']] as const)('evaluates the inclusive threshold %i', (value, status) => {
    expect(evaluateThreshold('coverage', value, {severity:'error',min:80}).status).toBe(status);
  });
  it('preserves deterministic reports across evaluation ordering', () => {
    fc.assert(fc.property(fc.array(fc.constantFrom('pass','fail','unknown'),{maxLength:20}), statuses => {
      const rows=statuses.map((status,i)=>({...evaluation(status),ruleId:`r${i}`}));
      expect(evaluateGate(rows,'gate')).toEqual(evaluateGate([...rows].reverse(),'gate'));
    }));
  });
  it('keeps protected severity, thresholds, and restrictive N/A permissions', () => {
    const merged=mergeProtectedPolicy({schemaVersion:1,profileVersion:'1',rules:{coverage:{severity:'off',min:10,allowNotApplicable:['anything']}}},{schemaVersion:1,profileVersion:'1',rules:{coverage:{severity:'error',min:80,minMutants:10,allowNotApplicable:[]},approval:{severity:'error'}}});
    expect(merged.rules.coverage).toEqual({severity:'error',min:80,minMutants:10,allowNotApplicable:[]});
    expect(merged.rules.approval?.severity).toBe('error');
  });
  it('rejects conflicting rules rather than order-dependent aggregation', () => {
    expect(()=>evaluateGate([evaluation('pass'),evaluation('fail')],'gate')).toThrow();
  });
});
describe('strict configuration',()=>{
  it('defaults to audit and disabled contracts with a pinned profile version',()=>{
    const config=parseConfig({schemaVersion:1});
    expect(config.mode).toBe('audit'); expect(config.contracts.enabled).toBe(false); expect(config.profileVersion).toBe('1');
  });
  it.each([{schemaVersion:2},{schemaVersion:1,profileVersion:'2'},{schemaVersion:1,rules:{mutationScore:{severity:'error',minMutants:-1}}},{schemaVersion:1,rules:{coverage:{severity:'error',min:NaN}}},{schemaVersion:1,reports:{vitest:'../escape.json'}},{schemaVersion:1,trusted:true}])('rejects malformed or unsafe configuration %j',value=>{expect(()=>parseConfig(value)).toThrow();});
});

describe('version 1 profile obligations',()=>{
  it('selects distinct basic, standard, and critical policies',()=>{
    const basic=parseConfig({schemaVersion:1,profile:'basic'});
    const standard=parseConfig({schemaVersion:1,profile:'standard'});
    const critical=parseConfig({schemaVersion:1,profile:'critical'});
    expect(basic.rules.mutationScore?.severity).toBe('off');
    expect(standard.rules.changedLineCoverage).toEqual({severity:'warn',min:80});
    expect(standard.rules.mutationScore).toEqual({severity:'warn',min:70,minMutants:10});
    for(const id of ['testResult','changedLineCoverage','mutationScore','pipelineIntegrity','intentApproval','negativeCases','contractExecution','policyProtection','productionTargetObserved','mutationSensitivityObserved'])expect(critical.rules[id]?.severity).toBe('error');
  });
  it('preserves critical obligations through partial rules and explicit contract disabling',()=>{
    const config=parseConfig({schemaVersion:1,profile:'critical',contracts:{enabled:false},rules:{testResult:{severity:'error'},intentApproval:{severity:'off'},changedLineCoverage:{severity:'warn',min:60}}});
    expect(config.rules.intentApproval?.severity).toBe('error');
    expect(config.rules.contractExecution?.severity).toBe('error');
    expect(config.rules.changedLineCoverage).toEqual({severity:'error',min:60});
    const rows=Object.entries(config.rules).map(([ruleId,rule])=>({...evaluation(ruleId==='testResult'?'pass':'unknown',rule.severity),ruleId}));
    expect(evaluateGate(rows,'gate').status).toBe('incomplete');
  });
  it('keeps profile obligations when a project supplies only one rule override',()=>{
    const config=parseConfig({schemaVersion:1,rules:{changedLineCoverage:{severity:'error',min:85}}});
    expect(config.rules.testResult?.severity).toBe('error');
    expect(config.rules.changedLineCoverage?.min).toBe(85);
  });
});
