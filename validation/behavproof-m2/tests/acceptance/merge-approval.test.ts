import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {execFileSync} from 'node:child_process';
import {check} from '../../packages/cli/src/check.js';import {discover,snapshot} from '../../packages/contract-registry/src/index.js';
import {test,expect} from 'vitest';
test('PR-head approval cannot approve a merge-only contract weakening',async()=>{
const scratch=await mkdtemp(join(tmpdir(),'bp-merge-review-')),root=join(scratch,'repo'),trustPath=join(scratch,'trust.json');await mkdir(root);await mkdir(join(root,'tests'));
const git=(...args)=>execFileSync('git',['-c','user.name=review','-c','user.email=review@example.invalid',...args],{cwd:root,encoding:'utf8'}).trim();
const old="import {defineContract} from '@behavproof/vitest';\nconst access=defineContract({id:'ACCESS',intent:'nonowners denied',risk:'basic',cases:[{id:'non-owner',negative:true,input:0,expected:false}]});\n",changed=old.replace('expected:false','expected:true');
const cfg={schemaVersion:1,profile:'basic',git:{base:'HEAD'},contracts:{enabled:true,sources:[{type:'vitest-inline',include:['tests/access.ts']}]},rules:{intentApproval:{severity:'error'}}};
await writeFile(join(root,'package.json'),JSON.stringify({type:'module',scripts:{test:'vitest run'},devDependencies:{vitest:'5.1.0'}}));await writeFile(join(root,'behavproof.config.json'),JSON.stringify(cfg));await writeFile(join(root,'tests/access.ts'),old);git('init','-q','-b','main');git('add','.');git('commit','-qm','approved base');const base=git('rev-parse','HEAD');
await writeFile(join(root,'readme.txt'),'reviewed harmless change');git('add','.');git('commit','-qm','PR reviewed harmless update');const pr=git('rev-parse','HEAD');
await writeFile(join(root,'tests/access.ts'),changed);git('add','.');const tree=git('write-tree'),merge=git('commit-tree',tree,'-p',base,'-p',pr,'-m','synthetic merge with unreviewed weakening');git('reset','--hard',merge);
const baseline=snapshot(discover({'tests/access.ts':old}),base,['tests/access.ts']);
await writeFile(trustPath,JSON.stringify({schemaVersion:1,policy:{schemaVersion:1,profileVersion:'1',rules:{intentApproval:{severity:'error'}}},config:cfg,baseline,inputs:['package.json','behavproof.config.json','tests/access.ts','readme.txt'],configPaths:[],manifests:[],github:{repository:'acme/shop',pr:3,reviewers:['alice'],requiredChecks:[{context:'gate',appId:77}]}}));
const routes={
'/repos/acme/shop/pulls/3':{number:3,state:'open',user:{login:'bob'},head:{sha:pr},base:{sha:base,ref:'main',repo:{full_name:'acme/shop'}}},
'/repos/acme/shop/branches/main/protection':{required_pull_request_reviews:{required_approving_review_count:1,dismiss_stale_reviews:true,require_code_owner_reviews:false},required_status_checks:{checks:[{context:'gate',app_id:77}]}},
'/repos/acme/shop/pulls/3/reviews':[{id:1,user:{login:'alice',type:'User'},state:'APPROVED',commit_id:pr,submitted_at:'2026-11-13T00:00:00Z'}],
'/repos/acme/shop/collaborators/alice/permission':{permission:'write'}};
const previous=globalThis.fetch;globalThis.fetch=async url=>{const value=routes[new URL(url).pathname];return new Response(JSON.stringify(value??{}),{status:value?200:404});};
try {const r=await check(root,{mode:'audit',base,head:pr,'trust-root':trustPath});expect(r.documentEvidence.registry.contracts[0].cases[0].expected).toBe(false);expect(r.evaluations.find(e=>e.ruleId==='intentApproval'&&e.scope.length===0)?.status).toBe('fail');}finally{globalThis.fetch=previous;await rm(scratch,{recursive:true,force:true});}

},30000);
