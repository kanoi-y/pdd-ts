import {test,expect} from 'vitest';import {githubClient,boundedBody,protectedState} from '../../scripts/github-control.mjs';
test('artifact storage redirect never forwards the GitHub credential and refuses unrelated origins',async()=>{
 const calls:any[]=[];const client=githubClient('controlled-fixture',async(url:any,options:any)=>{calls.push({url:String(url),options});return calls.length===1?new Response(null,{status:302,headers:{location:'https://fixture.blob.core.windows.net/artifact?signature=fixture'}}):new Response('archive');});
 expect((await client.archive(1)).toString()).toBe('archive');expect(calls[0].options.headers.Authorization).toContain('controlled-fixture');expect(calls[1].options.headers).toBeUndefined();
 await expect(githubClient('fixture',async()=>new Response(null,{status:302,headers:{location:'https://example.invalid/artifact'}})).archive(1)).rejects.toThrow(/origin/);
});
test('control-plane input is bounded and feature-branch dispatch cannot select protected authority',async()=>{
 await expect(boundedBody(new Response('oversized'),2)).rejects.toThrow(/bound/);expect(()=>protectedState({GITHUB_REPOSITORY:'kanoi-y/pdd-ts',GITHUB_REF:'refs/heads/candidate',GITHUB_EVENT_NAME:'workflow_dispatch'})).toThrow(/main/);
});
test('protected publisher template retains its unconditional real CLI gate and separate final publication',async()=>{
 const {readFile}=await import('node:fs/promises'),{diagnoseWorkflow}=await import('../../packages/adapter-github/src/index.js');const source=await readFile('templates/protected-github-publisher.yml','utf8');expect(diagnoseWorkflow(source,{gateJob:'gate',requiredJobs:['verify']}).internal.status).toBe('pass');
});
test('changing the tracked proposed policy file requires new enrollment even when the admin policy is retained',async()=>{
 const {selectedProjectConfig}=await import('../../scripts/github-control.mjs'),{mkdtemp,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{hashBytes}=await import('../../packages/core/src/index.js');const root=await mkdtemp(join(tmpdir(),'behavproof-policy-proposal-')),original='{"schemaVersion":1,"profileVersion":"1","rules":{"testResult":{"severity":"error"}}}';
 try{await writeFile(join(root,'policy.json'),original);await writeFile(join(root,'behavproof.config.json'),'{"schemaVersion":1,"profile":"basic"}');const registration={source:{projectPath:'project',policyRef:'project/policy.json',fileHashes:{'project/policy.json':hashBytes(Buffer.from(original))}}};await expect(selectedProjectConfig(root,registration)).resolves.toMatchObject({profile:'basic'});await writeFile(join(root,'policy.json'),original.replace('error','off'));await expect(selectedProjectConfig(root,registration)).rejects.toThrow(/policy|enroll/i);}finally{await rm(root,{recursive:true,force:true});}
});
