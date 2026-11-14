import {test,expect} from 'vitest';
import {parseConfig,mergeProtectedPolicy,getProfilePolicy} from '../../packages/core/src/index.js';
import {normalizeStryker} from '../../packages/adapter-reports/src/index.js';
import {discover,snapshot} from '../../packages/contract-registry/src/index.js';
import {scopedEvaluations} from '../../packages/cli/src/scopes.js';
const registry=snapshot(discover({'tests/order.test.ts':`import {defineContract} from '@behavproof/vitest';const c=defineContract({id:'ORDER',intent:'owner only',risk:'critical',cases:[{id:'owner',input:1,expected:2}]});`}), 'a'.repeat(40),['tests/**/*.ts']);
const source='export const readOrder = () => true;';
const mutation=normalizeStryker({schemaVersion:'1.0',files:{'src/order.ts':{source,mutants:[{id:'1',status:'Killed',location:{start:{line:1},end:{line:1}}}]}}});
function evaluate(configured:number,protectedMinimum:number){
 const config=parseConfig({schemaVersion:1,profile:'critical',rules:{mutationScore:{severity:'error',minMutants:configured}}});
 const protectedPolicy=getProfilePolicy('critical');protectedPolicy.rules.mutationScore!.minMutants=protectedMinimum;
 const policy=mergeProtectedPolicy({schemaVersion:1,profileVersion:'1',rules:config.rules},protectedPolicy);
 return scopedEvaluations({config,policy,registry,files:['src/order.ts'],states:new Map(),rows:[],bindings:{},verifyRow:()=>false,claims:new Map(),claimScopes:[{contractId:'ORDER',targetRef:'src/order.ts#readOrder'}],intentStatus:new Map(),mutation,coverageTrusted:false,mutationTrusted:true,mapping:true,changed:{'src/order.ts':[1]},sources:{'src/order.ts':source}}).find(e=>e.ruleId==='mutationScore');
}
test('scoped mutation uses explicitly configured and protected numerical parameters',()=>{
 expect(evaluate(1,1)?.status).toBe('pass');
});
test('scoped mutation retains the greater protected or project minimum',()=>{
 expect(evaluate(1,10)?.status).toBe('unknown');
 expect(evaluate(3,1)?.status).toBe('unknown');
});
test('critical declaration keeps mandatory severity after configurable thresholds',()=>{
 const config=parseConfig({schemaVersion:1,profile:'basic',rules:{mutationScore:{severity:'off',minMutants:1}}});
 const evaluations=scopedEvaluations({config,policy:{schemaVersion:1,profileVersion:'1',rules:config.rules},registry,files:[],states:new Map(),rows:[],bindings:{},verifyRow:()=>false,claims:new Map(),claimScopes:[],intentStatus:new Map(),coverageTrusted:false,mutationTrusted:false,mapping:false,changed:{},sources:{}});
 expect(evaluations.find(e=>e.ruleId==='mutationScore')).toMatchObject({severity:'error',status:'unknown'});
});
