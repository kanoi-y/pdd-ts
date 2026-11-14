// Dedicated App token stays in this protected host. No candidate code executes.
import {parseArgs} from 'node:util';import {readFile} from 'node:fs/promises';
import {hash,CheckReportSchema,safeRead} from '@behavproof/core';import {check} from '../packages/cli/dist/api.js';
import {prepareCheckPublication,prepareFailedCheck,GitHubCheckPublisher} from '@behavproof/adapter-github';
import {protectedState,assertSdkRevision,githubClient,currentPr,number,REPOSITORY,REPOSITORY_ID,CHECK,APP_ID,BASE} from './github-control.mjs';
const {values}=parseArgs({strict:true,options:{pr:{type:'string'}}});const state=protectedState(),sdkRoot=assertSdkRevision(),client=githubClient(),prNumber=number(values.pr),pr=await currentPr(client,prNumber);
const identity={repository:REPOSITORY,repositoryId:REPOSITORY_ID,pr:prNumber,headSha:pr.head.sha,baseSha:pr.base.sha,protectedBranch:BASE,checkName:CHECK,appId:APP_ID};
let decision=prepareFailedCheck({...identity,failureRef:`https://github.com/${REPOSITORY}/actions/runs/${number(process.env.GITHUB_RUN_ID)}`});
const core=report=>CheckReportSchema.parse(Object.fromEntries(['schemaVersion','mode','status','exitCode','mandatoryCount','evaluations','reasons'].map(key=>[key,report[key]])));
try{
 const context=JSON.parse(await readFile('/tmp/behavproof-control/publication-context.json','utf8')),root='/tmp/behavproof-project',fromCli=JSON.parse((await safeRead(root,'.behavproof/gate.json')).toString('utf8'));
 if(context.pr!==prNumber||context.headSha!==pr.head.sha||context.baseSha!==pr.base.sha||context.registrationDigest!==state.digest)throw Error('Publication context mismatch');
 // Re-evaluate using the protected SDK, fresh live APIs and authenticated snapshots.
 // A candidate-controlled serialized report is never the authority callback.
 const fresh=await check(root,{config:'.behavproof/host-config.json',mode:'gate','trust-root':'/tmp/behavproof-control/trust-root.json'}),report=core(fromCli),computed=core(fresh);
 if(hash(report)!==hash(computed)||hash(context.subject)!==hash(fresh.subject)||fromCli.effectivePolicyHash!==fresh.effectivePolicyHash)throw Error('Captured CLI report differs from current protected verification');
 const packet={schemaVersion:1,repositoryId:REPOSITORY_ID,subject:fresh.subject,effectivePolicyHash:fresh.effectivePolicyHash,registrationDigest:state.digest,ci:context.ci,report,upstream:{jobs:fresh.pipelineObservation?.jobs??{},artifacts:fresh.pipelineObservation?.artifacts??[]}},packetHash=hash(packet);
 decision=prepareCheckPublication(packet,{...identity,subject:fresh.subject,effectivePolicyHash:fresh.effectivePolicyHash,registrationDigest:state.digest,ci:context.ci,requiredEvaluations:computed.evaluations.map(({ruleId,severity,scope})=>({ruleId,severity,scope})),requiredJobs:['verify'],requiredArtifacts:context.expectedArtifacts},snapshot=>hash(snapshot)===packetHash);
}catch{console.log('Required producer or verification unavailable; publishing failure.');}
const result=await new GitHubCheckPublisher({repository:REPOSITORY,token:process.env.GITHUB_TOKEN}).publish(decision);console.log(JSON.stringify(result));if(result.conclusion!=='success')process.exitCode=1;
