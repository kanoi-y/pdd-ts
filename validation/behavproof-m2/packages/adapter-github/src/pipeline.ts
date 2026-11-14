import { parseDocument } from 'yaml';
import { parseArgs } from 'node:util';
import { observed, unknown } from './transport.js';
function isGateCommand(command:string):boolean {
  // Shell expansion/compound commands are outside this static diagnostic.
  if(/[;&|\n`$<>]/.test(command))return false;
  const words=command.trim().split(/\s+/);
  if(words[0]!=='behavproof'||words[1]!=='check')return false;
  try {
    const {values,tokens}=parseArgs({args:words.slice(2),strict:true,allowPositionals:false,tokens:true,options:{mode:{type:'string'},'trust-root':{type:'string'},config:{type:'string'},profile:{type:'string'},base:{type:'string'},head:{type:'string'},format:{type:'string'},output:{type:'string'},root:{type:'string'}}});
    return values.mode==='gate'&&tokens.filter(t=>t.kind==='option'&&t.name==='mode').length===1;
  }catch{return false;}
}
export function evaluateUpstream(jobs:Record<string,string>,available:string[],expected:{requiredJobs:string[];artifacts:string[]}){
  if(!expected.requiredJobs.length||!expected.artifacts.length||new Set(expected.requiredJobs).size!==expected.requiredJobs.length||new Set(expected.artifacts).size!==expected.artifacts.length||new Set(available).size!==available.length)return unknown('Empty or ambiguous upstream requirements');
  if(expected.requiredJobs.some(name=>jobs[name]==='failure'))return {status:'fail' as const,reasons:['Upstream job failed'],sources:[]};
  if(expected.requiredJobs.some(name=>jobs[name]!=='success')||expected.artifacts.some(name=>!available.includes(name)))return unknown('Upstream jobs or artifacts are incomplete');
  return observed({jobs,available},[]);
}
export function diagnoseWorkflow(source:string,expected:{gateJob:string;requiredJobs:string[]}){
  const protection=unknown('External issuer-bound branch protection and workflow integrity must be verified independently');
  const invalid=(reason:string)=>({internal:unknown(reason),protection});
  try {
    if(Buffer.byteLength(source)>1024*1024)return invalid('Workflow exceeds size limit');
    const doc=parseDocument(source,{uniqueKeys:true,version:'1.2'});if(doc.errors.length)return invalid('Invalid or duplicate YAML keys');
    const value=doc.toJS({maxAliasCount:100});
    if(!value||typeof value!=='object'||!value.jobs||!expected.requiredJobs.length)return invalid('Missing workflow requirements');
    const events=typeof value.on==='string'?[value.on]:Array.isArray(value.on)?value.on:Object.keys(value.on??{});
    if(!events.length||events.some((x:string)=>!['pull_request','push','workflow_dispatch','workflow_run'].includes(x)))return invalid('Unsupported or privileged event');
    if(value.on&&typeof value.on==='object'&&!Array.isArray(value.on)&&Object.values(value.on).some((v:any)=>v&&['paths','paths-ignore','branches','branches-ignore'].some(k=>k in v)))return invalid('Workflow filters can suppress final gate');
    const writes=(p:any)=>p==='write-all'||(p&&typeof p==='object'&&Object.values(p).includes('write'));
    const gate=value.jobs[expected.gateJob];
    if(!gate||writes(value.permissions)||writes(gate.permissions)||gate['continue-on-error']||!['always()','${{ always() }}'].includes(gate.if))return invalid('Final gate is conditional, privileged or absent');
    const needs=typeof gate.needs==='string'?[gate.needs]:gate.needs;
    if(!Array.isArray(needs)||!expected.requiredJobs.every(name=>needs.includes(name)&&value.jobs[name]))return invalid('Final gate omits required upstream jobs');
    const steps=Array.isArray(gate.steps)?gate.steps:[];
    const commands=steps.filter((s:any)=>typeof s.run==='string'&&/^behavproof check\b/.test(s.run.trim()));
    if(commands.length!==1||commands[0].if||commands[0]['continue-on-error']||!isGateCommand(commands[0].run))return invalid('Missing unconditional effective gate command');
    return {internal:observed({gateJob:expected.gateJob,requiredJobs:[...expected.requiredJobs].sort()},[]),protection};
  }catch{return invalid('Workflow parsing failed');}
}
