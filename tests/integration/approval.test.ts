import { describe, expect, it } from 'vitest';
import { checkApproval } from '../../src/ci/approval.js';
const sha='a'.repeat(40), digest='b'.repeat(64);
const policy={repository:'owner/repo', reviewerIds:[7], minApprovals:1};
const pr={number:3,state:'open',head:{sha,repo:{full_name:'owner/repo'}},base:{sha:'c'.repeat(40),repo:{full_name:'owner/repo'}},user:{id:8,type:'User'}};
const review={id:10,user:{id:7,type:'User'},state:'APPROVED',commit_id:sha,submitted_at:'2026-11-07T00:00:00Z'};
const client=(reviews:unknown[]= [review], pull:unknown=pr)=>({get:async(path:string)=>path.includes('/reviews')?reviews:pull});
const reference={repository:'owner/repo',pullNumber:3,headSha:sha,specDigest:digest};
describe('CI-001 externally authenticated exact-head approval',()=>{
  it('accepts only an allowlisted external exact-head human review',async()=>{ expect((await checkApproval(client(),policy,reference,digest)).status).toBe('approved'); });
  it.each([
    [{...review,state:'DISMISSED'}], [{...review,commit_id:'d'.repeat(40)}], [{...review,user:{id:8,type:'User'}}],
    [{...review,user:{id:7,type:'Bot'}}], [{...review,submitted_at:null}], [review,{...review,id:11,state:'CHANGES_REQUESTED'}],
    [{...review,user:{id:9,type:'User'}}], [],
  ])('rejects invalid, obsolete, self and superseded reviews: %j',async(...rows)=>{
    const reviews=rows.length===1 && Array.isArray(rows[0])?rows[0]:rows;
    expect((await checkApproval(client(reviews),policy,reference,digest)).status).toBe('invalid');
  });
  it('rejects a forged digest, changed head and different base repository',async()=>{
    expect((await checkApproval(client(),policy,reference,'e'.repeat(64))).status).toBe('invalid');
    expect((await checkApproval(client([], {...pr,head:{...pr.head,sha:'e'.repeat(40)}}),policy,reference,digest)).status).toBe('invalid');
    expect((await checkApproval(client([], {...pr,base:{...pr.base,repo:{full_name:'else/repo'}}}),policy,reference,digest)).status).toBe('invalid');
  });
});
