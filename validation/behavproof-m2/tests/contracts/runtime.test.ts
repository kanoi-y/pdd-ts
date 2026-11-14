import {it,expect,afterAll} from 'vitest';
import {spawnSync} from 'node:child_process';
import {readFileSync,rmSync,mkdtempSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
const runtimeRoot=mkdtempSync(join(tmpdir(),'behavproof-runtime-'));
afterAll(()=>rmSync(runtimeRoot,{recursive:true,force:true}));
it('collects actual comparison rows and runtime inventory from child Vitest',()=>{
 const output=join(runtimeRoot,'runtime-test.json');
 rmSync(output,{force:true});
 const child=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tests/fixtures/contracts/vitest.config.ts','--includeTaskLocation','--reporter',resolve('packages/contract-vitest/dist/reporter.js'),'tests/fixtures/contracts/runtime.fixture.ts'],{encoding:'utf8',env:{...process.env,BEHAVPROOF_REPORT:output}});
 expect(child.status,child.stderr).toBe(0);
 const report=JSON.parse(readFileSync(output,'utf8'));
 expect(report.inventory.testCount).toBe(3);expect(report.inventory.suiteCount).toBeGreaterThan(1);
 expect(report.contracts).toHaveLength(2);expect(report.contracts.every((r:any)=>r.comparisonCount===1&&r.status==='pass')).toBe(true);
});
it('inventory matches Vitest JSON file identities and suite totals',()=>{
 const output=join(runtimeRoot,'runtime-inventory.json');
 const json=join(runtimeRoot,'runtime-vitest.json');
 const child=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tests/fixtures/contracts/vitest.config.ts','--reporter=json','--reporter',resolve('packages/contract-vitest/dist/reporter.js'),'--outputFile',json],{encoding:'utf8',env:{...process.env,BEHAVPROOF_REPORT:output}});
 expect(child.status).toBe(0);
 const report=JSON.parse(readFileSync(json,'utf8')),inventory=JSON.parse(readFileSync(output,'utf8')).inventory;
 expect(inventory.files).toEqual(report.testResults.map((x:any)=>x.name));
 expect(inventory.suiteCount).toBe(report.numTotalTestSuites);expect(inventory.testCount).toBe(report.numTotalTests);
});
it('records skipped and failed comparisons without production claims',()=>{
 const reporter=resolve('packages/contract-vitest/dist/reporter.js');
 for(const [env,status,expectedCount,expectedState] of [['CONTRACT_SKIP',0,0,'unknown'],['CONTRACT_FAIL',1,1,'fail']] as const){
  const output=join(runtimeRoot,`${env}.json`);
  const child=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tests/fixtures/contracts/vitest.config.ts','--reporter',reporter],{encoding:'utf8',env:{...process.env,[env]:'1',BEHAVPROOF_REPORT:output}});
  expect(child.status).toBe(status);const rows=JSON.parse(readFileSync(output,'utf8')).contracts;
  expect(rows).toHaveLength(2);expect(rows.every((r:any)=>r.comparisonCount===expectedCount&&r.status===expectedState)).toBe(true);
  expect(rows.every((r:any)=>!('production_target_observed' in r)&&!('mutation_sensitivity_observed' in r))).toBe(true);
 }
});
it('supplies independent nested suite inventory to report normalization',async()=>{
 const output=join(runtimeRoot,'runtime-full-inventory.json');const json=join(runtimeRoot,'runtime-full-vitest.json');
 const child=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tests/fixtures/contracts/vitest.config.ts','--reporter=json','--reporter',resolve('packages/contract-vitest/dist/reporter.js'),'--outputFile',json],{encoding:'utf8',env:{...process.env,INVENTORY_FULL:'1',BEHAVPROOF_REPORT:output}});
 expect(child.status).toBe(0);const report=JSON.parse(readFileSync(json,'utf8'));const inv=JSON.parse(readFileSync(output,'utf8')).inventory;
 const {normalizeVitest}=await import('@behavproof/adapter-reports');
 expect(normalizeVitest(report).status).toBe('unknown');expect(normalizeVitest(report,inv).status).toBe('pass');
});
it('snapshots registration bindings before execution with collision-free case identities',async()=>{
 const output=join(runtimeRoot,'registrations.json');
 const child=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tests/fixtures/contracts/vitest.config.ts','--reporter',resolve('packages/contract-vitest/dist/reporter.js')],{encoding:'utf8',env:{...process.env,BEHAVPROOF_REPORT:output}});
 expect(child.status).toBe(0);const report=JSON.parse(readFileSync(output,'utf8'));expect(report.registrations??[]).toHaveLength(2);
 expect(report.registrations.every((r:any)=>r.comparisonCount===0&&r.status==='unknown')).toBe(true);
 expect(report.registrations.every((r:any)=>report.contracts.some((c:any)=>c.testId===r.testId&&c.bindingHash===r.bindingHash&&c.comparisonCount===1))).toBe(true);
 const {bindingKey}=await import('../../packages/contract-registry/src/index.js');expect(bindingKey('a:b','c')).not.toBe(bindingKey('a','b:c'));
});
it('joins authenticated current registrations to active static cases',async()=>{
 const output=join(runtimeRoot,'registration-join.json');
 const child=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tests/fixtures/contracts/vitest.config.ts','--reporter',resolve('packages/contract-vitest/dist/reporter.js')],{encoding:'utf8',env:{...process.env,BEHAVPROOF_REPORT:output}});expect(child.status).toBe(0);
 const report=JSON.parse(readFileSync(output,'utf8'));
 const {discover,bindRegistrations,evaluateAssurance,snapshot}=await import('../../packages/contract-registry/src/index.js');
 const found=discover({'runtime.fixture.ts':readFileSync('tests/fixtures/contracts/runtime.fixture.ts','utf8')});expect(found.diagnostics).toEqual([]);
 const binding=bindRegistrations(report.registrations,report.contracts,()=>true);expect(binding.status).toBe('pass');
 expect(evaluateAssurance(snapshot(found,'base',[]),report.contracts,binding.bindings,()=>true).cases_executed).toBe('pass');
});
it('reports runtime inventory even when contracts are disabled',()=>{
 const output=join(runtimeRoot,'plain-inventory.json');
 const child=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tests/fixtures/contracts/plain.config.ts','--reporter',resolve('packages/contract-vitest/dist/reporter.js')],{encoding:'utf8',env:{...process.env,BEHAVPROOF_REPORT:output}});expect(child.status).toBe(0);
 const report=JSON.parse(readFileSync(output,'utf8'));expect(report.inventory.testCount).toBe(1);expect(report.inventory.suiteCount).toBe(2);expect(report.contracts).toEqual([]);expect(report.registrations).toEqual([]);
});
it('compares against isolated registered expected values despite later or callback mutation',()=>{
 const output=join(runtimeRoot,'runtime-mutation.json');
 const child=spawnSync(process.execPath,['node_modules/vitest/vitest.mjs','run','--config','tests/fixtures/contracts/mutation.config.ts','--reporter',resolve('packages/contract-vitest/dist/reporter.js')],{encoding:'utf8',env:{...process.env,BEHAVPROOF_REPORT:output}});
 expect(child.status).toBe(1);const rows=JSON.parse(readFileSync(output,'utf8')).contracts;
 expect(rows.map((r:any)=>r.status)).toEqual(['fail','fail']);
});
