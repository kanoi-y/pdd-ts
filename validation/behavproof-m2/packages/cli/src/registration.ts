import {z} from 'zod';
import {realpath,stat} from 'node:fs/promises';
import {resolve,relative,isAbsolute,sep,join,dirname,basename} from 'node:path';
import {ApprovalSchema,PolicySchema,ConfigSchema,RegistrySnapshotSchema,RelativePathSchema,HashSchema,canonicalJson,hash,safeRead,type Approval} from '@behavproof/core';
import {git,writeScoped} from './project.js';
import {ClaimScopesSchema} from './trust.js';
const text=z.string().min(1),sha=z.string().regex(/^[a-f0-9]{40}$/);
export const RegistrationSchema=z.strictObject({
 schemaVersion:z.literal(1),repository:z.strictObject({id:z.string().regex(/^\d+$/),fullName:z.string().regex(/^[\w-]+\/[\w.-]+$/)}),
 source:z.strictObject({commitSha:sha,prNumber:z.number().int().positive(),projectPath:z.union([z.literal('.'),RelativePathSchema]),policyRef:RelativePathSchema,fileHashes:z.record(RelativePathSchema,HashSchema)}),
 policyId:text,policy:PolicySchema,config:ConfigSchema,baseline:RegistrySnapshotSchema,
 inputs:z.array(RelativePathSchema).min(1),configPaths:z.array(RelativePathSchema),
 claimScopes:ClaimScopesSchema,approvals:z.array(ApprovalSchema),
});
export type Registration=z.infer<typeof RegistrationSchema>;
export type RegistrationAuthority={verifySource:(registration:Registration)=>boolean;verifyApproval:(approval:Approval)=>boolean};
export type VerifiedRegistration={readonly registration:Registration;readonly digest:string};
const verifiedHandles=new WeakSet<VerifiedRegistration>();
function freeze<T>(value:T):T{if(value&&typeof value==='object'){for(const entry of Object.values(value))freeze(entry);Object.freeze(value);}return value;}
export function createRegistration(value:unknown,authority:RegistrationAuthority):VerifiedRegistration{
 const registration=RegistrationSchema.parse(structuredClone(value));
 registration.approvals.sort((a,b)=>a.id.localeCompare(b.id));freeze(registration);
 if(authority.verifySource(registration)!==true)throw Error('Source verification unavailable');
 if(registration.baseline.commitSha!==registration.source.commitSha||registration.baseline.repositoryId!==undefined&&registration.baseline.repositoryId!==registration.repository.id)throw Error('Registered source commit/repository mismatch');
 if(registration.baseline.discoveryDiagnostics?.length!==0||!registration.baseline.extractorVersion||!registration.baseline.scope?.length||!registration.baseline.contracts.length||!registration.baseline.intents.length)throw Error('Complete discovery inventory required');
 for(const path of [registration.source.policyRef,...registration.baseline.contracts.map(c=>c.sourceRef),...registration.baseline.intents.map(i=>i.origin.ref)])if(!Object.hasOwn(registration.source.fileHashes,path))throw Error('Missing independently verified source hash');
 if(new Set(registration.inputs).size!==registration.inputs.length||new Set(registration.configPaths).size!==registration.configPaths.length)throw Error('Duplicate input scope');
 if(!Object.values(registration.policy.rules).some(rule=>rule.severity==='error'))throw Error('No mandatory policy obligations');
 const targets=[{kind:'policy',id:registration.policyId,contentHash:hash(registration.policy)},...registration.baseline.intents.map(i=>({kind:'intent',id:i.id,contentHash:i.contentHash})),...registration.baseline.contracts.map(c=>({kind:'contract',id:c.id,contentHash:c.revisionHash}))];
 if(new Set(registration.approvals.map(a=>a.id)).size!==registration.approvals.length)throw Error('Duplicate approval identity');
 for(const approval of registration.approvals)if(approval.status!=='pass'||approval.subjectCommitSha!==registration.source.commitSha||approval.source.provider!=='github'||approval.source.ref!==`https://github.com/${registration.repository.fullName}/pull/${registration.source.prNumber}`||!approval.approvedBy.length||!targets.some(t=>hash(t)===hash(approval.target))||authority.verifyApproval(approval)!==true)throw Error('Unverified or incorrectly scoped approval');
 for(const target of targets)if(!registration.approvals.some(a=>hash(a.target)===hash(target)))throw Error(`Missing ${target.kind} approval: ${target.id}`);
 for(const scope of registration.claimScopes){const contract=registration.baseline.contracts.find(c=>c.id===scope.contractId);if(!contract||new Set(scope.caseIds).size!==scope.caseIds.length||hash([...scope.caseIds].sort())!==hash([...(contract.caseIds??[])].sort()))throw Error('Claim scope differs from registered case inventory');}
 const result=freeze({registration,digest:hash(registration)});verifiedHandles.add(result);return result;
}
async function externalDirectory(projectRoot:string,directory:string){
 const project=await realpath((await git(projectRoot,['rev-parse','--show-toplevel'])).trim()),host=await realpath(resolve(directory)),path=relative(project,host);
 if(path===''||!isAbsolute(path)&&path!=='..'&&!path.startsWith(`..${sep}`))throw Error('Registration must be outside the entire Git checkout');
 const info=await stat(host);if(!info.isDirectory())throw Error('Registration host is not a directory');
 if(process.platform!=='win32'&&((info.mode&0o077)!==0||typeof process.getuid==='function'&&info.uid!==process.getuid()))throw Error('Registration host must be private and owned by the current user');
 return host;
}
export async function persistRegistration(projectRoot:string,directory:string,handle:VerifiedRegistration){
 if(!verifiedHandles.has(handle)||hash(handle.registration)!==handle.digest)throw Error('Unverified registration handle');
 const host=await externalDirectory(projectRoot,directory),name=`registration-${handle.digest}.json`,content=canonicalJson(handle.registration)+'\n';
 try{await writeScoped(host,name,content,true);}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const actual=await safeRead(host,name);if(!actual.equals(Buffer.from(content)))throw Error('Conflicting or tampered registered snapshot');}
 return {path:join(host,name),digest:handle.digest};
}

/** expectedDigest belongs to the protected host invocation, never to candidate JSON. */
export async function loadRegistration(projectRoot:string,path:string,expectedDigest:string):Promise<Registration>{
 HashSchema.parse(expectedDigest);const actual=resolve(path),host=await externalDirectory(projectRoot,dirname(actual));
 const registration=RegistrationSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await safeRead(host,basename(actual)))));
 if(hash(registration)!==expectedDigest)throw Error('Registered baseline digest mismatch');
 return freeze(registration);
}

/** Path projection only; obtain authority separately with loadRegistration and a protected digest. */
export function registrationProjectData(value:Registration){
 const r=RegistrationSchema.parse(structuredClone(value)),prefix=r.source.projectPath==='.'?'':r.source.projectPath+'/';
 const local=(path:string)=>{if(prefix&&!path.startsWith(prefix))throw Error('Registration path lies outside the selected project subtree');const result=prefix?path.slice(prefix.length):path;RelativePathSchema.parse(result);return result;};
 return freeze({policy:r.policy,config:r.config,baseline:{...r.baseline,contracts:r.baseline.contracts.map(c=>({...c,sourceRef:local(c.sourceRef)})),intents:r.baseline.intents.map(i=>({...i,origin:{...i.origin,ref:local(i.origin.ref)}})),...(r.baseline.scope?{scope:r.baseline.scope.map(local)}:{})},inputs:r.inputs.map(local),configPaths:r.configPaths.map(local),claimScopes:r.claimScopes.map(s=>({...s,targetRef:local(s.targetRef)}))});
}
