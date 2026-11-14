import { test, expect } from 'vitest';
import { discover, snapshot, evaluateAssurance, bindingKey, reconcile, transitionHash, renderDocuments, buildEvidenceGraph } from '../../packages/contract-registry/src/index.js';
const discovery=discover({'case.ts':`import {defineContract} from '@behavproof/vitest';const c=defineContract({id:'A',intent:'observe',risk:'critical',cases:[{id:'one',input:{n:2},expected:{n:3}}]});`});
const registry=snapshot(discovery,'base',[]),c=registry.contracts[0]!,row={contractId:'A',caseId:'one',revisionHash:c.revisionHash,bindingHash:'a'.repeat(64),comparisonCount:1,status:'pass' as const},bindings={[bindingKey('A','one')]:row.bindingHash};
test('truthy non-boolean authority must never authenticate a claim or approval',()=>{
 expect(evaluateAssurance(registry,[row],bindings,(()=>Promise.resolve(false)) as any).cases_executed).toBe('unknown');
 const approval={schemaVersion:1,id:'approval',status:'pass',target:{kind:'contract',id:'A',contentHash:transitionHash(c,undefined)},source:{provider:'fixture',ref:'approval'},approvedBy:['reviewer'],reasons:[]} as any;
 expect(reconcile(registry,{contracts:[],intents:[]},[approval],(()=>({verified:false})) as any).obligations).toHaveLength(1);
});
test('generated documents render input/expected and gracefully reject malformed approvals',()=>{
 const docs=renderDocuments(registry,[row],{expectedBindings:bindings,verifyEvidence:(()=>Promise.resolve(false)) as any,approvals:[{}] as any});
 expect(docs.markdown).toContain('Input');expect(docs.markdown).toContain('Expected');expect(docs.html).toContain('Input');expect(docs.json).toContain('unknown');
 expect(()=>buildEvidenceGraph({registry,executions:[],rules:[],approvals:[{}] as any,expectedBindings:{}})).not.toThrow();
});
