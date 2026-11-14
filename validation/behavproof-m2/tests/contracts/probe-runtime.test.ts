import {test,expect} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
import {instrumentFunction,evaluateProbeRuns} from '../../packages/contract-registry/src/probe.js';
import {discover,snapshot} from '../../packages/contract-registry/src/index.js';
import {hash,hashBytes} from '../../packages/core/src/index.js';
const project=resolve('.'),target='src/orders.ts#readOrder';
function execute(fake=false,fault=false){
 const root=mkdtempSync(join(tmpdir(),'behavproof-probe-'));
 try{
  mkdirSync(join(root,'src'));mkdirSync(join(root,'tests'));symlinkSync(join(project,'node_modules'),join(root,'node_modules'),process.platform==='win32'?'junction':'dir');writeFileSync(join(root,'package.json'),'{"type":"module"}');
  const source=readFileSync(join(project,'examples/node-api/src/orders.ts'),'utf8'),instrumented=instrumentFunction({source,targetRef:target,expectedSourceHash:hashBytes(Buffer.from(source)),faultValue:{__behavproof_fault:true}});
  if(instrumented.status!=='supported')throw Error(instrumented.reason);
  writeFileSync(join(root,'src/orders.ts'),fault?instrumented.mutatedSource:instrumented.observedSource);
  let contract=readFileSync(join(project,'examples/node-api/tests/orders.test.ts'),'utf8');if(fake)contract=contract.replace('({input})=>readOrder(input.userId,input.order)','({expected})=>expected');writeFileSync(join(root,'tests/orders.test.ts'),contract);
  writeFileSync(join(root,'vitest.config.mjs'),`export default {test:{include:['tests/**/*.ts'],maxWorkers:1}};`);
  const report=join(root,'report.json'),run=spawnSync(process.execPath,[join(project,'node_modules/vitest/vitest.mjs'),'run','--config','vitest.config.mjs','--reporter',join(project,'packages/contract-vitest/dist/reporter.js')],{cwd:root,encoding:'utf8',timeout:20000,env:{...process.env,BEHAVPROOF_REPORT:report}});
  const reportData=JSON.parse(readFileSync(report,'utf8'));
  return {exit:run.status,diagnostics:run.stderr,report:reportData,fault:instrumented.fault,protocolRun:{executionId:root,exitCode:run.status??-1,sourceHash:fault?instrumented.fault.mutatedSha256:instrumented.originalSha256,report:reportData}};
 }finally{rmSync(root,{recursive:true,force:true});}
}
test('actual production calls are recorded per currently executing contract case',()=>{
 const result=execute();expect(result.exit,result.diagnostics).toBe(0);expect(result.report.contracts).toHaveLength(2);
 for(const row of result.report.contracts)expect(row.targetCalls).toEqual([{targetRef:target,count:1}]);
 expect(result.report.contracts.map((row:any)=>row.caseId).sort()).toEqual(['non-owner','owner']);
},30000);
test('a fake callback can pass comparisons without observing the production target',()=>{
 const result=execute(true);expect(result.exit,result.diagnostics).toBe(0);for(const row of result.report.contracts){expect(row.status).toBe('pass');expect(row.targetCalls).toEqual([]);}
},30000);
test('target-specific faults fail the actual same required callbacks and retain per-case observations',()=>{
 const result=execute(false,true);expect(result.exit).toBe(1);for(const row of result.report.contracts){expect(row.status).toBe('fail');expect(row.comparisonCount).toBe(1);expect(row.targetCalls).toEqual([{targetRef:target,count:1}]);}
},30000);

const active=snapshot(discover({'tests/orders.test.ts':readFileSync(join(project,'examples/node-api/tests/orders.test.ts'),'utf8')}),'a'.repeat(40),['tests/**/*.ts']).contracts[0]!;
test('the public instrumentation and runtime records establish separate per-case observation and canary results',()=>{
 const main=execute(),canary=execute(false,true),captured=new Set([hash(main.protocolRun),hash(canary.protocolRun)]);
 const result=evaluateProbeRuns({contract:active,targetRef:target,expectedSourceHash:main.fault.originalSha256,main:main.protocolRun,canary:canary.protocolRun,fault:canary.fault},run=>captured.has(hash(run)));
 expect(result.observations).toHaveLength(2);expect(result.observations.every(row=>row.status==='pass')).toBe(true);expect(result.canaries.every(row=>row.status==='pass')).toBe(true);
},30000);
test('real fake-callback runs survive the production fault and cannot establish target reach or sensitivity',()=>{
 const main=execute(true),canary=execute(true,true),captured=new Set([hash(main.protocolRun),hash(canary.protocolRun)]);
 const result=evaluateProbeRuns({contract:active,targetRef:target,expectedSourceHash:main.fault.originalSha256,main:main.protocolRun,canary:canary.protocolRun,fault:canary.fault},run=>captured.has(hash(run)));
 expect(main.exit).toBe(0);expect(canary.exit).toBe(0);expect(result.observations).toHaveLength(2);expect(result.observations.every(row=>row.status==='unknown')).toBe(true);expect(result.canaries.every(row=>row.status==='unknown')).toBe(true);
},30000);
