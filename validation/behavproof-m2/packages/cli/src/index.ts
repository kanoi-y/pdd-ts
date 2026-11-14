#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve, extname } from 'node:path';
import { parseConfig, canonicalJson, hash, safeRead, safeReadJson, type CheckReport } from '@behavproof/core';
import { detectProject, gitDiff } from '@behavproof/adapter-reports';
import { renderDocuments, checkDocuments, analyzeImpact, reconcile } from '@behavproof/contract-registry';
import { check } from './check.js';
import { config, exists, fileList, registry, git, writeScoped, select, ref } from './project.js';
function formatReport(report:CheckReport,format:string){
 if(format==='json')return canonicalJson(report)+'\n';
 if(format==='markdown'){const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('|','&#124;').replaceAll('\n',' ');return `# BehavProof ${report.status}\n\n| Rule | Severity | Status | Reason |\n| --- | --- | --- | --- |\n${report.evaluations.map(e=>`| ${escape(e.ruleId)} | ${e.severity} | ${e.status} | ${escape(e.message)} |`).join('\n')}\n`;}
 if(format!=='console')throw Error('Unsupported report format');
 return `BehavProof: ${report.status} (${report.mandatoryCount} mandatory rules)\n${report.evaluations.map(e=>`${e.status.padEnd(14)} ${e.severity.padEnd(5)} ${e.ruleId}: ${e.message}`).join('\n')}\n`;
}
const help=`BehavProof 0.1.0\nCommands: init, doctor, check, explain <rule>, baseline create, contracts discover|list|validate, intent diff, impact, docs generate|check\ncheck reads artifacts; it never runs tests. Gate requires --trust-root outside project.\nOptions: --config --base --head --profile --mode audit|gate --format console|json|markdown --output --trust-root --dry-run --check --help --version\n`;
async function main(){
 const {values,positionals}=parseArgs({allowPositionals:true,strict:true,options:{config:{type:'string'},base:{type:'string'},head:{type:'string'},profile:{type:'string'},mode:{type:'string'},format:{type:'string'},output:{type:'string'},'trust-root':{type:'string'},'dry-run':{type:'boolean'},check:{type:'boolean'},help:{type:'boolean'},version:{type:'boolean'},root:{type:'string'}}});
 const root=resolve(values.root??process.cwd()),[command,sub,...rest]=positionals;
 if(values.version){process.stdout.write('0.1.0\n');return 0;}if(values.help||!command){process.stdout.write(help);return 0;}
 if(rest.length)throw Error('Unexpected command arguments');
 const emit=async(text:string)=>{if(values.output)await writeScoped(root,values.output,text);else process.stdout.write(text);};
 if(command==='init'){
  if(sub)throw Error('Unexpected init argument');
  const path=values.config??'behavproof.config.json',found=await exists(root,path),detection=await detectProject(root);
  const proposal={schemaVersion:1,mode:'audit',profile:'standard',git:{base:'origin/main'},reports:{vitest:'.behavproof/input/vitest.json',coverage:'coverage/lcov.info',mutation:'reports/mutation/mutation.json'},executionManifests:[],contracts:{enabled:false,sources:[]}};
  if(!values['dry-run']&&!found)await writeScoped(root,path,JSON.stringify(proposal,null,2)+'\n',true);
  process.stdout.write(JSON.stringify({path,action:found?'preserve':values['dry-run']?'would-create':'created',detection,notice:'No package installation, workflow edits or separate specification documents are required.'},null,2)+'\n');return 0;
 }
 if(command==='doctor'){
  if(sub)throw Error('Unexpected doctor argument');const detection=await detectProject(root);await config(root,values.config,values.profile);await emit(JSON.stringify({node:process.version,...detection,trust:'External producer and protection authority must be configured separately.'},null,2)+'\n');return detection.support==='single-package'?0:1;
 }
 if(command==='explain'){
  const explanations:Record<string,string>={testResult:'Vitest assertions must complete; skipped/zero tests or unverified producers remain unknown.',changedLineCoverage:'Changed-line coverage requires current authenticated LCOV, complete executable-line scope and source mapping. Missing data is unknown; collect coverage in the verified execution.',mutationScore:'Score = (Killed + Timeout) / (Killed + Timeout + Survived + NoCoverage). Missing mapping or insufficient comparable mutants is unknown.',pipelineIntegrity:'A final always() gate checks all upstream results and artifacts. External issuer-bound branch protection requires independent verification; unavailable authority is unknown.',contractExecution:'Declared contracts require verified runtime binding and all required cases. A fake callback can pass comparisons; production reach and sensitivity remain separate unknown claims.',intentApproval:'Intent and contract transitions require current content-bound human approval from a protected authority.',policyProtection:'Protected policy is supplied through a trusted external host and cannot be weakened by project configuration.'};
  const key=(sub??'').replace(/-([a-z])/g,(_,c:string)=>c.toUpperCase());if(!explanations[key])throw Error('Unknown rule');await emit(explanations[key]+'\n');return 0;
 }
 if(command==='formal')throw Error('Unsupported optional M2-F command; no formal evidence is synthesized');
 if(command==='check'){
  if(sub)throw Error('Unexpected check argument');const options=Object.fromEntries(Object.entries(values).filter(([key,value])=>typeof value==='string'&&['config','profile','mode','base','head','trust-root'].includes(key)));
  const report=await check(root,options);await emit(formatReport(report,values.format??'console'));return report.exitCode;
 }
 const cfg=await config(root,values.config,values.profile),files=await fileList(root),sha=(await git(root,['rev-parse','--verify','HEAD^{commit}'])).trim(),current=await registry(root,cfg,files,sha);
 if(command==='contracts'){
  if(!['discover','list','validate'].includes(sub??''))throw Error('Expected contracts discover|list|validate');await emit(canonicalJson(current)+'\n');return sub==='validate'&&current.discoveryDiagnostics?.length?1:0;
 }
 if(command==='baseline'&&sub==='create'){
  await writeScoped(root,values.output??'.behavproof/baseline.json',canonicalJson(current)+'\n',true);if(!values.output)process.stdout.write('Created .behavproof/baseline.json; this is proposed data until registered by a trusted host.\n');return 0;
 }
 if(command==='docs'){
  const action=values.check?'check':sub??'generate';if(!['generate','check'].includes(action))throw Error('Expected docs generate|check');
  let generated:ReturnType<typeof renderDocuments>;
  if(values['trust-root']){const report=await check(root,{...(values.config?{config:values.config}:{}),...(values.profile?{profile:values.profile}:{}),...(values.head?{head:values.head}:{}),base:values.base??'HEAD',mode:'audit','trust-root':values['trust-root']});const evidence=report.documentEvidence;generated=renderDocuments(evidence.registry,evidence.rows,{approvals:report.approvals,expectedBindings:evidence.bindings,verifyEvidence:row=>evidence.authenticatedRows.includes(hash(row)),verifyApproval:approval=>evidence.authenticatedApprovals.includes(hash(approval))});}
  else{const rows=[];for(const manifestRef of select(files,cfg.executionManifests)){const {ExecutionManifestSchema}=await import('@behavproof/core');const manifest=ExecutionManifestSchema.parse(await safeReadJson(root,manifestRef));for(const artifact of manifest.artifacts)if(artifact.kind==='contract_report'&&await exists(root,artifact.ref)){const data=await safeReadJson(root,artifact.ref) as any;if(!Array.isArray(data?.contracts))throw Error('Malformed contract report');rows.push(...data.contracts);}}generated=renderDocuments(current,rows);}
  const extension=values.output?extname(values.output):'',single=extension?extension==='.md'?'markdown':extension==='.html'?'html':extension==='.json'?'json':undefined:undefined;
  if(extension&&!single)throw Error('Unsupported document extension');
  const directory=values.output&&!extension?values.output:cfg.contracts.documents.output;
  const paths:Record<string,string>=single?{[single]:values.output!}:{markdown:`${directory}/behavior.md`,html:`${directory}/behavior.html`,json:`${directory}/behavior.json`};
  let outdated=false;for(const [format,path] of Object.entries(paths)){
   const content=generated[format as keyof typeof generated];if(action==='generate')await writeScoped(root,path,content);
   else if(!await exists(root,path)||(await safeRead(root,path)).toString('utf8')!==content)outdated=true;
  }
  process.stdout.write(outdated?'DOCUMENT_OUTDATED: regenerate documents\n':`Documents ${action==='generate'?'generated':'current'}; declarations alone do not prove execution.\n`);return outdated?1:0;
 }
 if(command==='impact'||command==='intent'&&sub==='diff'){
  const diff=await gitDiff(root,ref(values.base??cfg.git.base),ref(values.head??'HEAD'));if(diff.headSha!==sha)throw Error('The selected --head must be checked out for static analysis');
  if(command==='impact'){
   const sources:Record<string,string>={};for(const p of files.filter(p=>/\.[cm]?[jt]sx?$/.test(p)))sources[p]=(await safeRead(root,p)).toString('utf8');
   const mappings:Record<string,string[]>={};for(const c of current.contracts){const path=c.sourceRef.replace(/:\d+(?::\d+)?$/,'');(mappings[path]??=[]).push(c.id);}
   await emit(canonicalJson({...analyzeImpact(sources,diff.files.map(f=>f.path),mappings),diff})+'\n');return 0;
  }
  const baseFiles=(await git(root,['ls-tree','-r','--name-only','-z',diff.diffBaseSha??diff.baseSha])).split('\0').filter(Boolean),sourceRows:{kind:string;ref:string;content:string}[]=[];
  for(const s of cfg.contracts.sources)for(const p of select(baseFiles,s.include))sourceRows.push({kind:s.type,ref:p,content:await git(root,['show',`${diff.diffBaseSha??diff.baseSha}:${p}`])});
  const {discoverSources,snapshot}=await import('@behavproof/contract-registry');const base=snapshot(discoverSources(sourceRows),diff.diffBaseSha??diff.baseSha,cfg.contracts.sources.flatMap(s=>s.include));
  await emit(canonicalJson({...reconcile(base,current),notice:'Git-derived baseline is comparison data, not independent approval authority.'})+'\n');return 0;
 }
 throw Error('Unknown command');
}
main().then(code=>{process.exitCode=code;}).catch(error=>{process.stderr.write(`BehavProof error: ${error instanceof Error?error.message:'Unknown error'}\n`);process.exitCode=2;});
