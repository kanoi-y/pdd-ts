import type { EvidenceStatus } from '@behavproof/core';
import { RelativePathSchema } from '@behavproof/core';
type Counts={total:number;passed:number;failed:number;skipped:number};
const count=(n:unknown):number=>{if(!Number.isSafeInteger(n)||Number(n)<0)throw new Error('Invalid count');return Number(n)};
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('Expected object');return v as Record<string,unknown>};
const path=(p:string)=>RelativePathSchema.parse(p);
export type VitestInventory={suiteCount:number;testCount:number;files:readonly string[]};
export function normalizeVitest(value:unknown,inventory?:VitestInventory):{payload:Counts;status:EvidenceStatus}{
 const v=object(value); const payload={total:count(v.numTotalTests),passed:count(v.numPassedTests),failed:count(v.numFailedTests),skipped:count(v.numPendingTests)+count(v.numTodoTests)};
 if(typeof v.success!=='boolean'||payload.passed+payload.failed+payload.skipped!==payload.total||!Array.isArray(v.testResults))throw new Error('Inconsistent Vitest report');
 const suiteTotal=count(v.numTotalTestSuites),suitePassed=count(v.numPassedTestSuites),suiteFailedCount=count(v.numFailedTestSuites),suitePending=count(v.numPendingTestSuites);if(suitePassed+suiteFailedCount+suitePending!==suiteTotal)throw new Error('Inconsistent suite counts');
 let observed=0,passed=0,failed=0,skipped=0,suiteFailed=false,suiteIncomplete=false,hasNested=false;const fileNames:string[]=[];
 for(const suite of v.testResults){const s=object(suite);if(typeof s.name!=='string'||!s.name)throw new Error('Invalid suite file identity');fileNames.push(s.name);if(s.status==='failed')suiteFailed=true;else if(s.status!=='passed')suiteIncomplete=true;if(!Array.isArray(s.assertionResults))throw new Error('Missing assertions');for(const a of s.assertionResults){const assertion=object(a);const status=assertion.status;if(!Array.isArray(assertion.ancestorTitles)||assertion.ancestorTitles.some(t=>typeof t!=='string'))throw new Error('Invalid suite ancestry');if(assertion.ancestorTitles.length)hasNested=true;observed++;if(status==='passed')passed++;else if(status==='failed')failed++;else if(status==='skipped'||status==='pending'||status==='todo')skipped++;else throw new Error('Unknown test status');}}
 if(observed!==payload.total||passed!==payload.passed||failed!==payload.failed||skipped!==payload.skipped)throw new Error('Inconsistent assertion counts');
 const uniqueFiles=new Set(fileNames);let complete=!hasNested&&suiteTotal===fileNames.length&&uniqueFiles.size===fileNames.length;
 if(inventory!==undefined){const names=inventory.files;complete=Number.isSafeInteger(inventory.suiteCount)&&Number.isSafeInteger(inventory.testCount)&&Array.isArray(names)&&names.every(n=>typeof n==='string'&&n.length>0)&&new Set(names).size===names.length&&uniqueFiles.size===fileNames.length&&inventory.suiteCount===suiteTotal&&inventory.testCount===payload.total&&names.length===fileNames.length&&names.every(n=>uniqueFiles.has(n));}
 return {payload,status:payload.failed||suiteFailed||suiteFailedCount||!v.success?'fail':!payload.total||payload.skipped||suitePending||suiteIncomplete||v.testResults.length>suiteTotal||!complete?'unknown':'pass'};
}
export type CoverageReport=Record<string,Record<number,number>>;
export function normalizeLcov(input:string):CoverageReport{
 if(Buffer.byteLength(input)>10*1024*1024)throw new Error('Report too large');const result:CoverageReport=Object.create(null);let file:string|undefined;
 for(const raw of input.split(/\r?\n/)){if(raw.startsWith('SF:')){if(file)throw new Error('Incomplete LCOV record');file=path(raw.slice(3));if(Object.hasOwn(result,file))throw new Error('Duplicate LCOV file');result[file]=Object.create(null);}else if(raw.startsWith('DA:')){if(!file)throw new Error('LCOV line without file');const m=/^DA:(\d+),(\d+)(?:,[^,]+)?$/.exec(raw);if(!m||!Number.isSafeInteger(Number(m[1]))||Number(m[1])<1||!Number.isSafeInteger(Number(m[2])))throw new Error('Invalid LCOV line');const line=Number(m[1]);if(Object.hasOwn(result[file]!,line))throw new Error('Duplicate LCOV line');result[file]![line]=Number(m[2]);}else if(raw==='end_of_record'){if(!file)throw new Error('Unexpected LCOV end');file=undefined;}}
 if(file)throw new Error('Incomplete LCOV record');return result;
}
export type Scope=Readonly<Record<string,readonly number[]>>;
export function evaluateCoverage(report:CoverageReport,scope:Scope,min:number,nonExecutable:Scope={},mappingVerified=false):{status:EvidenceStatus;payload:{covered:number;total:number;excluded:number;unobserved:number};score:number|undefined}{
 if(!Number.isFinite(min)||min<0||min>100)throw new Error('Invalid threshold');let covered=0,total=0,excluded=0,unobserved=0;
 for(const [file,lines] of Object.entries(scope)){path(file);for(const line of new Set(lines)){if(!Number.isSafeInteger(line)||line<1)throw new Error('Invalid changed line');if(nonExecutable[file]?.includes(line)){excluded++;continue}const hits=report[file]?.[line];if(hits===undefined){unobserved++;continue}total++;if(hits>0)covered++;}}
 const score=total?covered/total*100:undefined;return {status:!mappingVerified||unobserved||score===undefined?'unknown':score>=min?'pass':'fail',payload:{covered,total,excluded,unobserved},score};
}
export type Mutant={status:string;start:number;end:number};export type MutationReport=Record<string,{source:string;mutants:Mutant[]}>;
const statuses=new Set(['Killed','Survived','NoCoverage','Timeout','CompileError','RuntimeError','Ignored','Pending']);
export function normalizeStryker(value:unknown):MutationReport{
 const v=object(value);if(v.schemaVersion!=='1.0')throw new Error('Unsupported Stryker schema');const files=object(v.files);const result:MutationReport=Object.create(null);
 for(const [name,entry] of Object.entries(files)){path(name);const f=object(entry);if(!Array.isArray(f.mutants)||typeof f.source!=='string')throw new Error('Invalid mutants or source');const ids=new Set<string>();result[name]={source:f.source,mutants:f.mutants.map(x=>{const m=object(x),loc=object(m.location),start=object(loc.start),end=object(loc.end);if(typeof m.id!=='string'||ids.has(m.id)||typeof m.status!=='string'||!statuses.has(m.status))throw new Error('Invalid mutant');ids.add(m.id);const a=count(start.line),b=count(end.line);if(a<1||b<a)throw new Error('Invalid location');return {status:m.status,start:a,end:b};})};}return result;
}
export function evaluateMutation(report:MutationReport,scope:Scope,min:number,minMutants:number,sources:Readonly<Record<string,string>>={},mappingVerified=false):{status:EvidenceStatus;payload:{killed:number;survived:number;noCoverage:number;timeout:number;excluded:number;unobserved:number};score:number|undefined}{
 if(!Number.isFinite(min)||min<0||min>100)throw new Error('Invalid threshold');count(minMutants);const payload={killed:0,survived:0,noCoverage:0,timeout:0,excluded:0,unobserved:0};
 for(const [file,lines] of Object.entries(scope)){path(file);if(!report[file]){payload.unobserved++;continue}if(!Object.hasOwn(sources,file)||sources[file]!==report[file].source||!mappingVerified)payload.unobserved++;for(const m of report[file].mutants){if(!lines.some(line=>line>=m.start&&line<=m.end))continue;switch(m.status){case 'Killed':payload.killed++;break;case 'Survived':payload.survived++;break;case 'NoCoverage':payload.noCoverage++;break;case 'Timeout':payload.timeout++;break;case 'CompileError':case 'Ignored':payload.excluded++;break;default:payload.unobserved++;}}}
 const denominator=payload.killed+payload.survived+payload.noCoverage+payload.timeout;const score=denominator?(payload.killed+payload.timeout)/denominator*100:undefined;return {payload,score,status:payload.unobserved||score===undefined||denominator<minMutants?'unknown':score>=min?'pass':'fail'};
}
