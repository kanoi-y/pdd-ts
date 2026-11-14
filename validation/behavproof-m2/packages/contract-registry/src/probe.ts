import ts from 'typescript-parser';
import {canonicalJson,hash,hashBytes,HashSchema,RelativePathSchema,ContractSchema,type Contract} from '@behavproof/core';
import {bindRegistrations,type ReportBinding} from './assurance.js';
export const PROBE_METHOD='protected-case-observer-and-vitest-canary-v1';
export type TargetFault={targetRef:string;originalSha256:string;mutatedSha256:string;description:string};
/** Generate programs only. The caller runs them in an isolated selected producer. */
export function instrumentFunction(input:{source:string;targetRef:string;expectedSourceHash:string;faultValue:unknown}) {
  const unsupported=(reason:string)=>({status:'unknown' as const,reason});
  if(Buffer.byteLength(input.source)>1024*1024)return unsupported('Source exceeds probe limit');
  const originalSha256=hashBytes(Buffer.from(input.source));
  if(!HashSchema.safeParse(input.expectedSourceHash).success||originalSha256!==input.expectedSourceHash)return unsupported('Source differs from independently selected target');
  const parts=input.targetRef.split('#');
  if(parts.length!==2||!RelativePathSchema.safeParse(parts[0]).success||!/^[$A-Z_a-z][$\w]*$/.test(parts[1]!))return unsupported('Unsupported target reference');
  const file=ts.createSourceFile(parts[0]!,input.source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  if((file as ts.SourceFile&{parseDiagnostics:unknown[]}).parseDiagnostics.length)return unsupported('Target source is not valid TypeScript');
  const functions=file.statements.filter((node):node is ts.FunctionDeclaration=>ts.isFunctionDeclaration(node)&&node.name?.text===parts[1]);
  if(functions.length!==1||!functions[0]!.body||functions[0]!.asteriskToken||
     !functions[0]!.modifiers?.some(m=>m.kind===ts.SyntaxKind.ExportKeyword)||
     functions[0]!.modifiers?.some(m=>m.kind===ts.SyntaxKind.DefaultKeyword))return unsupported('Only one named exported function declaration is supported');
  const original=functions[0]!,f=ts.factory;
  let hook='__behavproofObserveTarget';while(input.source.includes(hook))hook+='_';
  let faultJson:string;try{faultJson=canonicalJson(input.faultValue);}catch{return unsupported('Fault value must be plain JSON');}
  const observe=f.createExpressionStatement(f.createCallExpression(f.createIdentifier(hook),undefined,[f.createStringLiteral(input.targetRef)]));
  const imported=f.createImportDeclaration(undefined,f.createImportClause(false,undefined,f.createNamedImports([f.createImportSpecifier(false,f.createIdentifier('observeTargetCall'),f.createIdentifier(hook))])),f.createStringLiteral('@behavproof/vitest/probe'));
  const program=(mutated:boolean)=>{
    const statements=mutated?[observe,f.createReturnStatement(f.createCallExpression(f.createPropertyAccessExpression(f.createIdentifier('JSON'),'parse'),undefined,[f.createStringLiteral(faultJson)]))]:[observe,...original.body!.statements];
    const declaration=f.updateFunctionDeclaration(original,original.modifiers,original.asteriskToken,original.name,original.typeParameters,original.parameters,original.type,f.createBlock(statements,true));
    const next=f.updateSourceFile(file,[imported,...file.statements.map(node=>node===original?declaration:node)]);
    return ts.createPrinter({newLine:ts.NewLineKind.LineFeed}).printFile(next);
  };
  const observedSource=program(false),mutatedSource=program(true);
  return {status:'supported' as const,targetRef:input.targetRef,originalSha256,observedSource,mutatedSource,
    fault:{targetRef:input.targetRef,originalSha256,mutatedSha256:hashBytes(Buffer.from(mutatedSource)),description:'Replace the selected function body with the host-selected distinct JSON fault value'} satisfies TargetFault};
}
export type ProbeRow=ReportBinding&{testState:string;targetCalls:{targetRef:string;count:number}[]};
export type ProbeRun={executionId:string;exitCode:number;sourceHash:string;report:{registrations:ReportBinding[];contracts:ProbeRow[]}};
export type ProbeProtocol={contract:Contract;targetRef:string;expectedSourceHash:string;main:ProbeRun;canary:ProbeRun;fault:TargetFault};
const freeze=<T>(value:T):T=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const identity=(row:ProbeRow)=>hash({contractId:row.contractId,caseId:row.caseId,revisionHash:row.revisionHash,bindingHash:row.bindingHash});
/** Raw observations are never authority: verifyRun authenticates each exact frozen
 * run against independently chosen execution, source transformation and reports.
 * Canary failures are diagnostics, not successful ordinary test evidence.
 */
export function evaluateProbeRuns(input:ProbeProtocol,verifyRun:(run:ProbeRun,phase:'main'|'canary')=>unknown) {
  const contract=ContractSchema.parse(input.contract),caseIds=contract.caseIds??[],targetRef=input.targetRef;
  let main:ProbeRun|undefined,canary:ProbeRun|undefined,mainTrusted=false,canaryTrusted=false;
  try {
    const text=canonicalJson(input);if(Buffer.byteLength(text)>10*1024*1024)throw Error('Probe inventory exceeds limit');
    const p=freeze(JSON.parse(text) as ProbeProtocol);main=p.main;canary=p.canary;
    const valid=(run:ProbeRun)=>!!run.executionId&&Number.isSafeInteger(run.exitCode)&&Array.isArray(run.report.registrations)&&Array.isArray(run.report.contracts)&&run.report.contracts.length<=10000&&bindRegistrations(run.report.registrations,run.report.contracts,()=>true).status==='pass';
    mainTrusted=valid(main)&&main.exitCode===0&&main.sourceHash===p.expectedSourceHash&&HashSchema.safeParse(p.expectedSourceHash).success&&verifyRun(main,'main')===true;
    canaryTrusted=valid(canary)&&canary.executionId!==main.executionId&&[0,1].includes(canary.exitCode)&&
      p.fault.targetRef===p.targetRef&&p.fault.originalSha256===p.expectedSourceHash&&
      HashSchema.safeParse(p.fault.mutatedSha256).success&&p.fault.mutatedSha256!==p.fault.originalSha256&&
      canary.sourceHash===p.fault.mutatedSha256&&!!p.fault.description&&verifyRun(canary,'canary')===true;
  } catch {mainTrusted=false;canaryTrusted=false;main=undefined;canary=undefined;}
  const rows=(run:ProbeRun|undefined,id:string)=>run?.report.contracts.filter(row=>row.contractId===contract.id&&row.caseId===id&&row.revisionHash===contract.revisionHash)??[];
  const count=(row:ProbeRow)=>{
    if(!Array.isArray(row.targetCalls)||row.targetCalls.length>1000||row.targetCalls.some(call=>!call||typeof call!=='object'||typeof call.targetRef!=='string'||!call.targetRef||!Number.isSafeInteger(call.count)||call.count<0)||new Set(row.targetCalls.map(call=>call.targetRef)).size!==row.targetCalls.length)return 0;
    return row.targetCalls.find(call=>call.targetRef===targetRef)?.count??0;
  };
  const observations=caseIds.map(id=>{
    const selected=rows(main,id),total=selected.reduce((n,row)=>n+count(row),0),valid=Number.isSafeInteger(total)&&mainTrusted&&selected.length>0&&selected.every(row=>row.status==='pass'&&row.testState==='passed'&&Number.isSafeInteger(row.comparisonCount)&&row.comparisonCount>0&&count(row)>0);
    return {contractId:contract.id,caseIds:[id],targetRef,method:PROBE_METHOD,observations:valid?total:0,status:valid?'pass' as const:'unknown' as const};
  });
  const canaries=caseIds.map((id,i)=>{
    const expected=rows(main,id),actual=rows(canary,id),bound=mainTrusted&&canaryTrusted&&expected.length>0&&
      hash(expected.map(identity).sort())===hash(actual.map(identity).sort());
    const detected=bound?actual.filter(row=>row.status==='fail'&&row.testState==='failed'&&Number.isSafeInteger(row.comparisonCount)&&row.comparisonCount>0&&count(row)>0).length:0;
    const observed=observations[i]!.status==='pass',total=bound?expected.length:0;
    return {contractId:contract.id,caseIds:[id],targetRef,method:PROBE_METHOD,detected,total,status:bound&&observed?(detected===total?'pass' as const:'fail' as const):'unknown' as const};
  });
  return {observations,canaries};
}
