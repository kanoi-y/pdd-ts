import { describe,expect,it } from 'vitest';
import { inspectTestReport } from '../../src/verification/tests.js';
import { validateBoundaries } from '../../src/verification/boundaries.js';
const report=(status='passed')=>({success:status==='passed',numTotalTests:1,numPassedTests:status==='passed'?1:0,numFailedTests:status==='failed'?1:0,numPendingTests:status==='pending'?1:0,testResults:[{assertionResults:[{fullName:'INPUT-001 rejects malformed input',status}]}]});
describe('CORE-004 empirical evidence and registered boundaries',()=>{
 it('requires structured successful named cases',()=>{expect(inspectTestReport(report(),['INPUT-001 rejects malformed input']).status).toBe('passed');});
 it.each(['pending','failed','todo','skipped'])('rejects %s cases',status=>{expect(inspectTestReport(report(status),['INPUT-001 rejects malformed input']).status).not.toBe('passed');});
 it('rejects empty, omitted, duplicate, inconsistent and forged successes',()=>{
  for(const value of [{}, {...report(),numTotalTests:0}, {...report(),testResults:[]}, {...report(),numPassedTests:0}, {...report(),testResults:[{assertionResults:[{fullName:'other',status:'passed'}]}]}, {...report(),numTotalTests:2,numPassedTests:2,testResults:[{assertionResults:[{fullName:'INPUT-001 rejects malformed input',status:'passed'},{fullName:'INPUT-001 rejects malformed input',status:'passed'}]}]}]) expect(inspectTestReport(value,['INPUT-001 rejects malformed input']).status).not.toBe('passed');
 });
 it('rejects unregistered boundary IDs, absent validators and missing required tests',()=>{
  expect(validateBoundaries({requirements:[{trustedBoundaries:['B1']}],obligations:[],config:{boundaries:[],testTargets:[]}} as never)).toContain('Unregistered boundary: B1');
  expect(validateBoundaries({requirements:[],obligations:[{id:'t',kind:'test'}],config:{boundaries:[{id:'B1',callerFiles:['src/route.ts'],validatorFiles:[],testObligationIds:['other']}],testTargets:[]}} as never).length).toBeGreaterThan(0);
 });
});

import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises';
import path from 'node:path';
import { verifyTests,empiricalToolDigest } from '../../src/verification/tests.js';
import { checkEvidenceFreshness } from '../../src/verification/lemmascript.js';
import type { Project } from '../../src/requirements/project.js';
it('CORE-004 runs actual test cases and invalidates changed validator inputs',async()=>{
 await mkdir('.tools',{recursive:true}); const root=await mkdtemp(path.resolve('.tools/empirical-'));
 try {
  await writeFile(path.join(root,'input.ts'),'export const parse=(input:unknown)=>typeof input === "boolean";');
  await writeFile(path.join(root,'input.test.ts'),"import {it,expect} from 'vitest'; import {parse} from './input.js'; it('INPUT-001 rejects malformed input',()=>expect(parse('true')).toBe(false));");
  const project:Project={root,config:{schemaVersion:1,tools:{},targets:[],approvedAssumptions:[],testTargets:[{obligationId:'input-test',files:['input.test.ts'],inputs:['input.ts'],requiredTests:['INPUT-001 rejects malformed input']}],boundaries:[]},requirements:[],obligations:[{id:'input-test',kind:'test',scope:'input',requirementIds:['CORE-004'],contractIds:[]}]};
  const result=await verifyTests(project,'input-test',{id:'actual-run',commit:'a'.repeat(40),specDigest:'b'.repeat(64)},await empiricalToolDigest());
  expect(result.diagnostics).toEqual([]); expect(result.record.status).toBe('passed'); expect(result.record.counts).toEqual({total:1,passed:1,failed:0,skipped:0});
  await writeFile(path.join(root,'input.ts'),'export const parse=()=>true;');
  expect(await checkEvidenceFreshness(root,result.record,result.inputPaths)).toBe('stale');
  const mutant=await verifyTests(project,'input-test',{id:'mutant-run',commit:'a'.repeat(40),specDigest:'b'.repeat(64)},await empiricalToolDigest());
  expect(mutant.record.status).toBe('failed');
 } finally {await rm(root,{recursive:true,force:true});}
});

import { sandboxArguments } from '../../src/verification/sandbox.js';
it('CI-005 isolates candidate execution from trusted verifier code and authority',()=>{
 const args=sandboxArguments({trustedRoot:'/trusted',projectRoot:'/trusted/candidate',artifactDirectory:'/trusted/candidate/.pdd/evidence/run/test',name:'pdd-test-123',command:['node','test.js'],uid:1001,gid:1001});
 for(const arg of ['--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=128']) expect(args).toContain(arg);
 expect(args).toContain('type=bind,src=/trusted,dst=/trusted,readonly');
 expect(args.some(arg=>arg.includes('docker.sock'))).toBe(false);
 expect(args.some(arg=>arg.includes('GH_TOKEN'))).toBe(false);
});
