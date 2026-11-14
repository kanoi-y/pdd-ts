import type { Config, Contract, Evidence, EvidenceSubject, RegistrySnapshot } from './schemas.js';
import type { ManifestExpected, ProducerAuthority } from './manifest.js';
export interface AdapterFormat { readonly format:string; readonly versions:readonly string[]; readonly requiredEvidenceKinds:readonly Evidence['kind'][]; }
export interface DetectContext { readonly root:string; readonly files:readonly string[]; }
export interface DetectionResult { readonly detected:boolean; readonly supported:boolean; readonly reasons:readonly string[]; readonly formats:readonly AdapterFormat[]; }
/** The host supplies a bounded scoped read; contexts contain no command executor. */
export interface CollectContext { readonly root:string; readonly config:Config; readonly artifactRefs:readonly string[]; readonly read:(path:string,maxBytes?:number)=>Promise<Uint8Array>; readonly expected?:ManifestExpected; readonly authority?:ProducerAuthority; }
export interface DiscoverContext { readonly root:string; readonly includes:readonly string[]; readonly files:readonly string[]; readonly read:(path:string,maxBytes?:number)=>Promise<Uint8Array>; }
export type ContractExecutionEvidence=Extract<Evidence,{kind:'contract_execution'}>;
export interface BindingContext { readonly contracts:readonly Contract[]; readonly evidence:readonly Evidence[]; readonly subject?:EvidenceSubject; readonly baseline?:RegistrySnapshot; }
export interface BehavProofAdapter { readonly id:string; readonly apiVersion:1; detect(ctx:DetectContext):Promise<DetectionResult>; collect(ctx:CollectContext):Promise<Evidence[]>; }
export interface ContractSourceAdapter { readonly id:string; readonly apiVersion:1; discover(ctx:DiscoverContext):Promise<Contract[]>; bindExecution(ctx:BindingContext):Promise<ContractExecutionEvidence[]>; }
