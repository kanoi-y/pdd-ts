// Protected workflow control plane. Never imported from candidate source.
import {fileURLToPath} from 'node:url';import {mkdir,writeFile} from 'node:fs/promises';import {join} from 'node:path';
import {hash,hashBytes,parseConfig,safeRead,RelativePathSchema} from '@behavproof/core';
import {RegistrationSchema,registrationProjectData} from '../packages/cli/dist/api.js';
import {protectedGit,materializeProject,sha} from './protected-checkout.mjs';
export const REPOSITORY='kanoi-y/pdd-ts',REPOSITORY_ID='1449042266',CHECK='BehavProof protected gate',APP_ID=5653976;
export const IMAGE='node:24.14.1-bookworm@sha256:80fc934952c8f1b2b4d39907af7211f8a9fff1a4c2cf673fb49099292c251cec';
export const PRODUCER='.github/workflows/behavproof-producer.yml',PUBLISHER='.github/workflows/behavproof-publisher.yml',BASE='behavproof-enforcement-test';
export const number=value=>{if(!/^[1-9][0-9]*$/.test(String(value))||!Number.isSafeInteger(Number(value)))throw Error('Invalid positive identity');return Number(value);};
export async function boundedBody(response,max=10*1024*1024){
 if(!response.body)throw Error('Missing response bytes');const reader=response.body.getReader(),parts=[];let size=0;
 try{while(true){const next=await reader.read();if(next.done)break;if((size+=next.value.length)>max)throw Error('Response exceeds bound');parts.push(Buffer.from(next.value));}return Buffer.concat(parts);}finally{await reader.cancel().catch(()=>{});}
}
export function githubClient(token=process.env.GITHUB_TOKEN,fetcher=fetch){
 if(!token)throw Error('Protected GitHub token unavailable');
 const request=async(path)=>{if(!path.startsWith(`/repos/${REPOSITORY}/`)||path.includes('..')||path.includes('#'))throw Error('Unexpected control-plane endpoint');const response=await fetcher('https://api.github.com'+path,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},redirect:'manual',signal:AbortSignal.timeout(30000)});return response;};
 const json=async(path)=>{const response=await request(path);if(response.status!==200)throw Error(`Control-plane HTTP ${response.status}`);return JSON.parse((await boundedBody(response,2*1024*1024)).toString('utf8'));};
 return {json,async pages(path,key){const rows=[];for(let page=1;page<=10;page++){const value=await json(path+`${path.includes('?')?'&':'?'}per_page=100&page=${page}`),batch=key?value[key]:value;if(!Array.isArray(batch))throw Error('Invalid paginated inventory');rows.push(...batch);if(batch.length<100)return rows;}throw Error('Pagination bound exceeded');},async archive(id){const response=await request(`/repos/${REPOSITORY}/actions/artifacts/${number(id)}/zip`);if(response.status===200)return boundedBody(response);if(response.status!==302)throw Error('Artifact redirect unavailable');const target=new URL(response.headers.get('location')??'');if(target.protocol!=='https:'||target.username||target.password||!['.blob.core.windows.net','.actions.githubusercontent.com'].some(suffix=>target.hostname.endsWith(suffix)))throw Error('Unexpected artifact storage origin');const blob=await fetcher(target,{redirect:'error',signal:AbortSignal.timeout(30000)});if(blob.status!==200)throw Error('Artifact download unavailable');return boundedBody(blob);}};
}
export function protectedState(env=process.env){
 if(env.GITHUB_REPOSITORY!==REPOSITORY||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_EVENT_NAME!=='workflow_dispatch')throw Error('Only the registered repository main dispatch is supported');
 const workflowSha=sha(env.BEHAVPROOF_WORKFLOW_SHA);if(env.BEHAVPROOF_CURRENT_WORKFLOW_SHA!==workflowSha)throw Error('Unregistered workflow source');sha(env.BEHAVPROOF_SDK_SHA);
 const registration=RegistrationSchema.parse(JSON.parse(env.BEHAVPROOF_REGISTRATION_JSON??'')),digest=env.BEHAVPROOF_REGISTRATION_DIGEST;
 if(hash(registration)!==digest||registration.repository.id!==REPOSITORY_ID||registration.repository.fullName!==REPOSITORY)throw Error('Protected registration mismatch');
 if(!registration.baseline.contracts.length||registration.claimScopes.length!==1)throw Error('Reference producer requires one protected probe target');
 return {registration,digest,project:registrationProjectData(registration),workflowSha};
}
export function assertSdkRevision(){const root=fileURLToPath(new URL('..',import.meta.url));if(protectedGit(root,['rev-parse','HEAD']).trim()!==sha(process.env.BEHAVPROOF_SDK_SHA))throw Error('Installed verifier differs from registered SDK commit');return root;}
export async function currentPr(client,prNumber){const p=await client.json(`/repos/${REPOSITORY}/pulls/${number(prNumber)}`);if(p.state!=='open'||p.number!==prNumber||p.base?.ref!==BASE||String(p.base?.repo?.id)!==REPOSITORY_ID||p.base?.repo?.full_name!==REPOSITORY)throw Error('PR must target the isolated enforcement branch');sha(p.head?.sha);sha(p.base?.sha);return p;}
export async function jobIdentity(client,workflowPath,workflowSha){
 const run=number(process.env.GITHUB_RUN_ID),attempt=number(process.env.GITHUB_RUN_ATTEMPT),name=process.env.GITHUB_JOB;
 const jobs=await client.pages(`/repos/${REPOSITORY}/actions/runs/${run}/attempts/${attempt}/jobs`,'jobs'),matches=jobs.filter(job=>job.name===name&&job.status==='in_progress');if(matches.length!==1)throw Error('Running job identity ambiguous');
 return {repositoryId:REPOSITORY_ID,workflowRef:`${REPOSITORY}/${workflowPath}@${workflowSha}`,runId:String(run),runAttempt:attempt,jobId:String(number(matches[0].id)),eventName:'workflow_dispatch'};
}
export async function candidateCheckout(directory,projectPath,headSha,baseSha){
 await mkdir(directory,{mode:0o700});protectedGit(directory,['init','-q','-b','candidate']);
 protectedGit(directory,['fetch','--no-tags',`https://github.com/${REPOSITORY}.git`,sha(headSha),sha(baseSha)]);
 protectedGit(directory,['update-ref','refs/heads/candidate',headSha]);protectedGit(directory,['read-tree',headSha]);
 // Only generated host/report directories are excluded. Every tracked project file
 // remains an input, including unsupported/new extensions.
 await writeFile(join(directory,'.git/info/exclude'),'.behavproof/\nnode_modules/\n',{flag:'w'});
 return materializeProject({root:directory,projectPath,headSha});
}
export async function selectedProjectConfig(root,registration){
 const prefix=registration.source.projectPath+'/',policyRef=registration.source.policyRef;if(!policyRef.startsWith(prefix))throw Error('Reference policy must be within the selected project');const path=RelativePathSchema.parse(policyRef.slice(prefix.length));
 if(hashBytes(await safeRead(root,path))!==registration.source.fileHashes[policyRef])throw Error('Proposed policy changed; new approved enrollment required');
 return parseConfig(JSON.parse((await safeRead(root,'behavproof.config.json')).toString('utf8')));
}
export function hostConfig(project,baseSha,executionId,candidateConfig=project.config){const cfg=parseConfig(candidateConfig);return {...cfg,git:{base:sha(baseSha)},reports:{...cfg.reports,vitest:`.behavproof/collected/${executionId}/vitest.json`}};}
export async function hostWrite(root,path,bytes){RelativePathSchema.parse(path);const {dirname}=await import('node:path');await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),bytes,{flag:'wx',mode:0o600});}
export const jsonBytes=value=>Buffer.from(JSON.stringify(value)+'\n');
