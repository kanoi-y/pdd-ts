import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalJson, hash, hashBytes, safeRead, safeReadJson, validateManifest, parseEvidence, ExecutionManifestSchema, type ExecutionManifest, type ManifestExpected, type ProducerAuthority } from '../../packages/core/src/index.js';
let root:string;
beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'behavproof-core-'));});
afterEach(async()=>{await rm(root,{recursive:true,force:true});});
const digest='a'.repeat(64);
const subject={testedCommitSha:'commit-1',sourceTreeHash:digest,dirty:false};
function fixture(){
  const bytes=Buffer.from('{"passed":2}');
  const manifest:ExecutionManifest={schemaVersion:1,executionId:'exec-1',subject,producer:{tool:'vitest',version:'5.1.0',collectorVersion:'0.1.0'},commandHash:digest,configHashes:{'vitest.config.ts':digest},environment:{nodeVersion:'24.14.1',platform:'test'},startedAt:'2026-11-13T00:00:00Z',completedAt:'2026-11-13T00:00:01Z',exitCode:0,artifacts:[{ref:'report.json',sha256:hashBytes(bytes),kind:'test',scope:['src']}],ci:{repositoryId:'repo',workflowRef:'trusted.yml@main',runId:'20',runAttempt:2,jobId:'test',eventName:'pull_request'}};
  const expected:ManifestExpected={executionId:'exec-1',subject,commandHash:digest,configHashes:{'vitest.config.ts':digest},artifacts:[{ref:'report.json',kind:'test',scope:['src']}]};
  const authority:ProducerAuthority={kind:'ci',producer:manifest.producer,ci:manifest.ci!};
  return {bytes,manifest,expected,authority};
}
describe('bounded scoped reads',()=>{
  it('reads real bytes and rejects tampering independently of metadata',async()=>{
    const {bytes,manifest,expected,authority}=fixture();
    await writeFile(join(root,'report.json'),bytes);
    expect(validateManifest(manifest,expected,{'report.json':await safeRead(root,'report.json')},authority).artifactIntegrity).toBe('pass');
    await writeFile(join(root,'report.json'),'{"passed":999}');
    expect(validateManifest(manifest,expected,{'report.json':await safeRead(root,'report.json')},authority).artifactIntegrity).toBe('fail');
  });
  it('rejects traversal, absolute paths, symlink files and symlink directories',async()=>{
    await mkdir(join(root,'inside'));await writeFile(join(root,'inside','a.json'),'{}');
    await symlink(join(root,'inside','a.json'),join(root,'link.json'));
    await symlink(join(root,'inside'),join(root,'linked'));
    for(const path of ['../escape.json','/etc/passwd','link.json','linked/a.json','C:\\escape.json'])await expect(safeRead(root,path)).rejects.toThrow();
  });
  it('enforces byte bounds on real JSON before parsing and rejects malformed JSON',async()=>{
    await writeFile(join(root,'large.json'),' '.repeat(50)+'{}');
    await expect(safeReadJson(root,'large.json',20)).rejects.toThrow(/size|large|limit/i);
    await writeFile(join(root,'bad.json'),'{');await expect(safeReadJson(root,'bad.json')).rejects.toThrow();
  });
});
describe('manifest validation separates integrity, subject and external producer authority',()=>{
  it('verifies a matching manifest with current external authority',()=>{
    const {bytes,manifest,expected,authority}=fixture();
    expect(validateManifest(manifest,expected,{'report.json':bytes},authority)).toMatchObject({artifactIntegrity:'pass',subjectMatch:'pass',producerTrust:'pass',executionStatus:'pass'});
  });
  it.each(['old-execution','old-tree','old-config','old-scope','dirty'] as const)('rejects %s',change=>{
    const {bytes,manifest,expected,authority}=fixture();
    if(change==='old-execution')manifest.executionId='exec-0';
    if(change==='old-tree')manifest.subject={...subject,sourceTreeHash:'b'.repeat(64)};
    if(change==='old-config')manifest.configHashes={'vitest.config.ts':'b'.repeat(64)};
    if(change==='old-scope')manifest.artifacts[0]!.scope=['other'];
    if(change==='dirty')manifest.subject={...subject,dirty:true};
    expect(validateManifest(manifest,expected,{'report.json':bytes},authority).subjectMatch).toBe('fail');
  });
  it.each(['runId','runAttempt','workflowRef','jobId','repositoryId'] as const)('rejects mismatched external CI %s',field=>{
    const {bytes,manifest,expected,authority}=fixture();
    manifest.ci={...manifest.ci!,[field]:field==='runAttempt'?1:'old'};
    expect(validateManifest(manifest,expected,{'report.json':bytes},authority).producerTrust).toBe('fail');
  });
  it('rejects a producer-name forgery and never infers authority from timestamps or hashes',()=>{
    const {bytes,manifest,expected,authority}=fixture();
    expect(validateManifest(manifest,expected,{'report.json':bytes},undefined).producerTrust).toBe('unknown');
    manifest.producer={...manifest.producer,tool:'attacker'};
    expect(validateManifest(manifest,expected,{'report.json':bytes},authority).producerTrust).toBe('fail');
  });
  it('keeps missing manifests unknown and failed runs failed despite matching bytes',()=>{
    const {bytes,manifest,expected,authority}=fixture();
    expect(validateManifest(undefined,expected,{'report.json':bytes},authority)).toMatchObject({artifactIntegrity:'unknown',producerTrust:'unknown',subjectMatch:'unknown',executionStatus:'unknown'});
    manifest.exitCode=1;expect(validateManifest(manifest,expected,{'report.json':bytes},authority).executionStatus).toBe('fail');
  });
  it('rejects malformed and unsupported manifests and unmanifested/conflicting artifacts',()=>{
    const {bytes,manifest,expected,authority}=fixture();
    expect(()=>validateManifest({...manifest,schemaVersion:2},expected,{'report.json':bytes},authority)).toThrow();
    expect(()=>ExecutionManifestSchema.parse({...manifest,ci:{...manifest.ci,runAttempt:0}})).toThrow();
    expect(()=>validateManifest({...manifest,artifacts:[...manifest.artifacts,...manifest.artifacts]},expected,{'report.json':bytes},authority)).toThrow();
    expect(validateManifest(manifest,expected,{'report.json':bytes,'extra.json':bytes},authority).artifactIntegrity).toBe('fail');
  });
});
describe('canonical data and evidence payload validation',()=>{
  it('uses a known SHA-256 byte vector and deterministic nested JSON keys',()=>{
    expect(hashBytes(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(canonicalJson({z:[{b:2,a:1}],a:0})).toBe('{"a":0,"z":[{"a":1,"b":2}]}');
    expect(hash({a:1,b:2})).toBe(hash({b:2,a:1}));
  });
  it('rejects ambiguous non-JSON values without executing object accessors',()=>{
    for(const value of [NaN,Infinity,undefined,{a:undefined},new Date(),new Array(2),{get unsafe(){throw new Error('must not execute')}}])expect(()=>canonicalJson(value)).toThrow();
    const circular:Record<string,unknown>={};circular.self=circular;expect(()=>canonicalJson(circular)).toThrow();
  });
  it('validates counts against their kind and rejects unsupported evidence schema versions',()=>{
    const base={schemaVersion:1,id:'e',kind:'test',source:{tool:'vitest',artifactRef:'report.json'},context:{effectivePolicyHash:digest,collectedAt:'2026-11-13T00:00:00Z'},provenance:{artifactIntegrity:'unknown',producerTrust:'unknown',subjectMatch:'unknown',reasons:[]},subjectRefs:[],payload:{total:2,passed:2,failed:0,skipped:0}};
    expect(parseEvidence(base).kind).toBe('test');
    for(const payload of [{total:2,passed:3,failed:0,skipped:0},{total:-1,passed:0,failed:0,skipped:0},{total:NaN,passed:0,failed:0,skipped:0},{approved:true}])expect(()=>parseEvidence({...base,payload})).toThrow();
    expect(()=>parseEvidence({...base,schemaVersion:2})).toThrow();
    expect(()=>parseEvidence({...base,kind:'coverage'})).toThrow();
  });
});
