import { z } from 'zod';
import type { GitHubClient } from './github.js';
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const repo = z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
export const approvalReferenceSchema = z.strictObject({ repository:repo, pullNumber:z.number().int().positive(),headSha:sha,specDigest:z.string().regex(/^[a-f0-9]{64}$/) });
export const approvalPolicySchema = z.object({repository:repo,reviewerIds:z.array(z.number().int().positive()).min(1),minApprovals:z.number().int().min(1).max(10)});
const user = z.object({id:z.number().int().positive(),type:z.string()});
const pullSchema = z.object({ number:z.number().int(),state:z.string(),head:z.object({sha,repo:z.object({full_name:repo})}),base:z.object({sha,repo:z.object({full_name:repo})}),user });
const reviewSchema = z.object({id:z.number().int().positive(),user,state:z.string(),commit_id:sha,submitted_at:z.string().nullable()});
export type ApprovalReference = z.infer<typeof approvalReferenceSchema>;
export interface ApprovalResult {status:'approved'|'invalid';reviewIds:number[];reasons:string[];headSha?:string;baseSha?:string}
export async function checkApproval(client:GitHubClient, rawPolicy:unknown, rawReference:unknown, independentlyComputedDigest:string):Promise<ApprovalResult> {
  try {
    const policy=approvalPolicySchema.parse(rawPolicy), reference=approvalReferenceSchema.parse(rawReference);
    if (reference.repository!==policy.repository || reference.specDigest!==independentlyComputedDigest) throw new Error('Approval reference does not bind the current specification');
    const path=`repos/${policy.repository}/pulls/${reference.pullNumber}`;
    const pull=pullSchema.parse(await client.get(path));
    if (pull.number!==reference.pullNumber || pull.state!=='open' || pull.head.sha!==reference.headSha || pull.base.repo.full_name!==policy.repository) throw new Error('Pull request identity, state or exact head changed');
    const reviews:z.infer<typeof reviewSchema>[]=[];
    for(let page=1;page<=100;page++) {
      const rows=z.array(reviewSchema).max(100).parse(await client.get(`${path}/reviews?per_page=100&page=${page}`));
      reviews.push(...rows); if(rows.length<100) break;
      if(page===100) throw new Error('Too many reviews');
    }
    const latest=new Map<number,z.infer<typeof reviewSchema>>();
    for(const review of reviews.sort((a,b)=>a.id-b.id)) {
      // COMMENTED/PENDING does not supersede an opinionated review; dismissal does.
      if(['APPROVED','CHANGES_REQUESTED','DISMISSED'].includes(review.state)) latest.set(review.user.id,review);
    }
    const accepted=[...latest.values()].filter(review=>review.state==='APPROVED' && review.commit_id===pull.head.sha && Boolean(review.submitted_at) && review.user.type==='User' && review.user.id!==pull.user.id && policy.reviewerIds.includes(review.user.id));
    if(accepted.length<policy.minApprovals) throw new Error('Insufficient current allowlisted human approvals at the exact head');
    return {status:'approved',reviewIds:accepted.map(item=>item.id),reasons:[],headSha:pull.head.sha,baseSha:pull.base.sha};
  } catch(error) { return {status:'invalid',reviewIds:[],reasons:[error instanceof Error?error.message:'Approval could not be authenticated']}; }
}
