import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { normalizeVitest, normalizeLcov, evaluateCoverage, normalizeStryker, evaluateMutation } from '../../packages/adapter-reports/src/index.js';
const fixture=async(name:string)=>JSON.parse(await readFile(`tests/fixtures/reports/${name}`,'utf8'));
describe('report adapters',()=>{
 it('does not accept zero or skipped tests as a passing run',async()=>{
  expect(normalizeVitest(await fixture('vitest-5.1.0-real.json')).status).toBe('pass');
  expect(normalizeVitest(await fixture('vitest-5.1.0-zero-tests.json')).status).toBe('unknown');
  expect(normalizeVitest(await fixture('vitest-5.1.0-skipped.json')).status).toBe('unknown');
 });
 it('does not omit missing changed files and checks threshold',async()=>{
  const report=normalizeLcov(await readFile('tests/fixtures/reports/vitest-5.1.0-real.lcov','utf8'));
  expect(evaluateCoverage(report,{'missing.ts':[1]},80).status).toBe('unknown');
  expect(evaluateCoverage(report,{'order-access.ts':[2]},80,{},true).status).toBe('pass');
 });
 it('reports zero mutants as unknown and counts real killed mutants',async()=>{
  const report=normalizeStryker(await fixture('stryker-10.1.1-real.json'));
  expect(evaluateMutation(report,{'order-access.ts':[2]},70,1,{'order-access.ts':report['order-access.ts']!.source},true).status).toBe('pass');
  expect(evaluateMutation(report,{'other.ts':[1]},70,1).status).toBe('unknown');
 });
});
it('discloses coverage thresholds and incomplete lines',()=>{
 const report=normalizeLcov('SF:a.ts\nDA:1,1\nDA:2,1\nDA:3,1\nDA:4,1\nDA:5,0\nend_of_record\n');
 expect(evaluateCoverage(report,{'a.ts':[1,2,3,4,5]},80,{},true).status).toBe('pass');
 expect(evaluateCoverage(report,{'a.ts':[1,2,3,4,5]},81,{},true).status).toBe('fail');
 expect(evaluateCoverage(report,{'a.ts':[6]},80).payload.unobserved).toBe(1);
 expect(evaluateCoverage(report,{'a.ts':[6]},80,{'a.ts':[6]}).status).toBe('unknown');
});
it('classifies every Stryker status and rejects unknown statuses',()=>{
 const statuses=['Killed','Survived','NoCoverage','Timeout','CompileError','RuntimeError','Ignored','Pending'];
 const raw={schemaVersion:'1.0',files:{'a.ts':{source:'source',mutants:statuses.map((status,id)=>({id:String(id),status,location:{start:{line:1},end:{line:1}}}))}}};
 const result=evaluateMutation(normalizeStryker(raw),{'a.ts':[1]},70,1,{'a.ts':'source'},true);
 expect(result.payload).toEqual({killed:1,survived:1,noCoverage:1,timeout:1,excluded:2,unobserved:2});expect(result.score).toBe(50);expect(result.status).toBe('unknown');
 expect(()=>normalizeStryker({...raw,files:{'a.ts':{mutants:[{id:'x',status:'MadeUp',location:{start:{line:1},end:{line:1}}}]}}})).toThrow();
});
it('rejects failed suite reports even if success and assertion counts claim passing',async()=>{
 const report=await fixture('vitest-5.1.0-real.json');report.testResults[0].status='failed';
 expect(normalizeVitest(report).status).toBe('fail');
});
it('does not assume report line mapping is trustworthy',()=>{
 const report=normalizeLcov('SF:a.ts\nDA:1,1\nend_of_record\n');
 expect(evaluateCoverage(report,{'a.ts':[1]},80).status).toBe('unknown');
});
it('fails at 79 percent under an 80 percent threshold',()=>{
 const lines=Array.from({length:100},(_,i)=>`DA:${i+1},${i<79?1:0}`).join('\n');
 const result=evaluateCoverage(normalizeLcov(`SF:a.ts\n${lines}\nend_of_record\n`),{'a.ts':Array.from({length:100},(_,i)=>i+1)},80,{},true);
 expect(result.score).toBe(79);expect(result.status).toBe('fail');
});
it('fails failed tests regardless of the success flag',async()=>{
 const report=await fixture('vitest-5.1.0-real.json');report.testResults[0].assertionResults[0].status='failed';report.numPassedTests=1;report.numFailedTests=1;
 expect(normalizeVitest(report).status).toBe('fail');
});
it('fails a declared failed suite and accepts nested suite summaries',async()=>{
 const r=await fixture('vitest-5.1.0-real.json');r.numTotalTestSuites=2;r.numFailedTestSuites=1;
 expect(normalizeVitest(r).status).not.toBe('pass');
 const nested=await fixture('vitest-5.1.0-real.json');nested.numTotalTestSuites=3;nested.numPassedTestSuites=3;nested.testResults[0].assertionResults[0].ancestorTitles=['outer','inner'];nested.testResults[0].assertionResults[1].ancestorTitles=['outer'];
 expect(normalizeVitest(nested,{suiteCount:3,testCount:2,files:['<project-root>/behavior.test.ts']}).status).toBe('pass');
 const incomplete=await fixture('vitest-5.1.0-real.json');incomplete.numTotalTestSuites=2;incomplete.numPassedTestSuites=2;expect(normalizeVitest(incomplete).status).toBe('unknown');
});
it('requires matching Stryker source and verified mapping for every scoped file',()=>{
 const raw={schemaVersion:'1.0',files:{'a.ts':{source:'a',mutants:[{id:'1',status:'Killed',location:{start:{line:1},end:{line:1}}}]},'b.ts':{source:'b',mutants:[{id:'2',status:'Killed',location:{start:{line:1},end:{line:1}}}]}}};
 const report=normalizeStryker(raw),scope={'a.ts':[1],'b.ts':[1]};
 expect(evaluateMutation(report,scope,70,1).status).toBe('unknown');
 expect(evaluateMutation(report,scope,70,1,{'a.ts':'different','b.ts':'b'},true).status).toBe('unknown');
 expect(evaluateMutation(report,scope,70,1,{'a.ts':'a'},true).status).toBe('unknown');
 expect(evaluateMutation(report,scope,70,1,{'a.ts':'a','b.ts':'b'},true).status).toBe('pass');
});
it('rejects a Stryker result whose source differs despite claimed mapping',()=>{
 const report=normalizeStryker({schemaVersion:'1.0',files:{'a.ts':{source:'original',mutants:[{id:'1',status:'Killed',location:{start:{line:1},end:{line:1}}}]}}});
 expect(evaluateMutation(report,{'a.ts':[1]},70,1,{'a.ts':'different'},true).status).toBe('unknown');
});
it('rejects a Stryker scope if one of multiple files lacks matching source',()=>{
 const mutant={id:'1',status:'Killed',location:{start:{line:1},end:{line:1}}};const report=normalizeStryker({schemaVersion:'1.0',files:{'a.ts':{source:'a',mutants:[mutant]},'b.ts':{source:'b',mutants:[mutant]}}});
 expect(evaluateMutation(report,{'a.ts':[1],'b.ts':[1]},70,1,{'a.ts':'a','b.ts':'wrong'},true).status).toBe('unknown');
});
it('accepts real passing Vitest output with repeated describe names',async()=>{
 const report=await fixture('vitest-5.1.0-repeated-suites.json');
 expect(report.numTotalTestSuites).toBe(3);expect(report.testResults).toHaveLength(1);
 expect(normalizeVitest(report).status).toBe('unknown');
 expect(normalizeVitest(report,{suiteCount:3,testCount:2,files:['<project-root>/repeated.test.js']}).status).toBe('pass');
});
it('rejects inconsistent independently supplied suite inventories',async()=>{
 const r=await fixture('vitest-5.1.0-repeated-suites.json');
 expect(normalizeVitest(r,{suiteCount:2,testCount:2,files:['<project-root>/repeated.test.js']}).status).toBe('unknown');
 expect(normalizeVitest(r,{suiteCount:3,testCount:3,files:['<project-root>/repeated.test.js']}).status).toBe('unknown');
 expect(normalizeVitest(r,{suiteCount:3,testCount:2,files:['<project-root>/other.test.js']}).status).toBe('unknown');
});
