import {z} from 'zod';
import {readFile,open,readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {hashToolFile} from '../verification/toolchain.js';
import {isUtf8} from 'node:buffer';
import {fileURLToPath} from 'node:url';
import {resolveProjectPath} from '../verification/paths.js';
import {digestFiles,sha256} from '../verification/digest.js';
import {canonicalJson,writeProjectFile} from '../requirements/io.js';
import type {Project} from '../requirements/project.js';
import type {VerificationOutcome,VerificationRun} from '../verification/lemmascript.js';
import type {EvidenceRecord} from '../verification/types.js';
import {checkQueueModel,queueModelSchema,traceStepSchema,modelResultSchema} from './queue.js';
export const modelTargetSchema=z.strictObject({obligationId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/),file:z.string().min(1).max(1000),mapping:z.string().min(1).max(1000)});
const mappingSchema=z.strictObject({schemaVersion:z.literal(1),entries:z.array(z.strictObject({action:traceStepSchema.shape.action.exclude(['initial']),file:z.string().min(1).max(1000),symbol:z.string().regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/).max(200),explanation:z.string().min(1).max(1000)})).min(1).max(30)});
export async function readModelJson(root:string,file:string):Promise<unknown>{
 const handle=await open(await resolveProjectPath(root,file),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const info=await handle.stat();if(!info.isFile()||info.size>65536)throw new Error('Invalid or oversized model input');
  const bytes=Buffer.alloc(65537);let total=0;while(total<bytes.length){const r=await handle.read(bytes,total,bytes.length-total,null);if(!r.bytesRead)break;total+=r.bytesRead;}
  if(total>65536||!isUtf8(bytes.subarray(0,total)))throw new Error('Model input must be bounded UTF-8');return JSON.parse(bytes.subarray(0,total).toString('utf8')) as unknown;
 }finally{await handle.close();}
}
export async function modelInputs(project:Project,id:string){
 const target=project.config.modelTargets?.find(t=>t.obligationId===id);if(!target)throw new Error('No model target registered');
 const model=queueModelSchema.parse(await readModelJson(project.root,target.file)),mapping=mappingSchema.parse(await readModelJson(project.root,target.mapping));
 if(new Set(mapping.entries.map(e=>e.action)).size!==mapping.entries.length)throw new Error('Duplicate model mapping action');
 for(const entry of mapping.entries)await resolveProjectPath(project.root,entry.file);
 const files=[...new Set([target.file,target.mapping,...mapping.entries.map(e=>e.file)])].sort();
 return {target,model,mapping,files,inputs:await digestFiles(project.root,files)};
}
export async function modelSpecification(project:Project){
 const entries=[];
 for(const target of project.config.modelTargets??[]){const data=await modelInputs(project,target.obligationId);entries.push({obligationId:target.obligationId,model:data.model,mapping:data.mapping,files:data.inputs.files});}
 return entries;
}
export async function modelToolDigest(){
 const ext=import.meta.url.endsWith('.ts')?'ts':'js';
 const files=['model/queue','model/adapter','requirements/project','requirements/schema','requirements/io','verification/paths','verification/digest'].map(name=>fileURLToPath(new URL(`../${name}.${ext}`,import.meta.url)));
 const hashes=await Promise.all(files.map(async file=>sha256(await readFile(file))));
 const zodRoot=path.dirname(createRequire(import.meta.url).resolve('zod/package.json'));
 const dependency:Record<string,string>={};
 async function walk(folder:string){for(const item of (await readdir(folder,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const file=path.join(folder,item.name);if(item.isDirectory())await walk(file);else if(item.isFile()&&(/\.(?:js|cjs|json)$/.test(item.name)))dependency[path.relative(zodRoot,file)]=sha256(await readFile(file));}}
 await walk(zodRoot);
 return sha256(canonicalJson({adapter:'job-queue-v1',node:await hashToolFile(process.execPath),hashes,dependency}));
}
export async function verifyModel(project:Project,id:string,identity:VerificationRun,toolchainDigest:string):Promise<VerificationOutcome>{
 const obligation=project.obligations.find(o=>o.id===id)!,directory=`.pdd/evidence/${identity.id}/${id}`,artifact=`${directory}/model-result.json`,diagnostics:string[]=[];
 const record:EvidenceRecord={id:`model-${sha256(identity.id+id).slice(0,48)}`,obligationId:id,requirementIds:obligation.requirementIds,kind:'model-check',status:'error',scope:obligation.scope,assumptions:[],artifactPaths:[],artifactDigests:{},verifiedSymbols:[],verifiedContractIds:[],premiseEvidenceIds:[],proofInputDigest:sha256('job-queue-v1'),sourceDigest:sha256('unavailable'),specDigest:identity.specDigest,toolchainDigest,commit:identity.commit,run:{id:identity.id,origin:'local'}};
 let inputPaths:string[]=[];
 try{const data=await modelInputs(project,id);inputPaths=data.files;record.sourceDigest=data.inputs.digest;record.proofInputDigest=sha256(canonicalJson(data.model));const result=checkQueueModel(data.model);record.status=result.status;await writeProjectFile(project.root,artifact,JSON.stringify(result,null,2)+'\n');record.artifactPaths.push(artifact);if((await modelInputs(project,id)).inputs.digest!==record.sourceDigest)record.status='stale';}
 catch(error){record.status='error';diagnostics.push(error instanceof Error?error.message:'Model unavailable');}
 const diagnosis=`${directory}/diagnostics.json`;await writeProjectFile(project.root,diagnosis,JSON.stringify(diagnostics)+'\n');record.artifactPaths.push(diagnosis);record.artifactDigests=(await digestFiles(project.root,record.artifactPaths)).files;
 return {record,inputPaths,diagnostics};
}
export {modelResultSchema};
