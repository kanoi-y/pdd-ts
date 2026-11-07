import { z } from 'zod';

export const identifier = z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const evidenceKindSchema = z.enum(['source-proof', 'model-check', 'test', 'trusted-contract', 'manual-review']);
export const executionStatusSchema = z.enum(['passed', 'failed', 'unsupported', 'unknown', 'not-run', 'stale', 'error']);
const strings = z.array(z.string().min(1).max(4096)).max(10000);
const ids = z.array(identifier).max(10000);

export const obligationSchema = z.strictObject({
  id: identifier,
  requirementIds: ids.min(1),
  kind: evidenceKindSchema,
  scope: z.string().min(1).max(4096),
  contractIds: ids,
}).superRefine((item, ctx) => {
  if (item.kind === 'source-proof' && (!item.scope.includes('#') || item.contractIds.length === 0)) {
    ctx.addIssue({ code: 'custom', message: 'Source proofs require a symbol scope and at least one contract' });
  }
  if (new Set(item.contractIds).size !== item.contractIds.length || new Set(item.requirementIds).size !== item.requirementIds.length) {
    ctx.addIssue({ code: 'custom', message: 'Repeated contract or requirement ID' });
  }
});

export const obligationsSchema = z.array(obligationSchema).max(10000).superRefine((items, ctx) => {
  if (new Set(items.map(item => item.id)).size !== items.length) ctx.addIssue({ code: 'custom', message: 'Duplicate obligation ID' });
});

export const countsSchema = z.strictObject({
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

export const evidenceSchema = z.strictObject({
  id: identifier,
  obligationId: identifier,
  requirementIds: ids.min(1),
  kind: evidenceKindSchema,
  status: executionStatusSchema,
  scope: z.string().min(1).max(4096),
  assumptions: strings,
  artifactPaths: strings.min(1),
  artifactDigests: z.record(z.string(), digestSchema),
  verifiedSymbols: strings,
  verifiedContractIds: ids,
  premiseEvidenceIds: ids,
  proofInputDigest: digestSchema,
  sourceDigest: digestSchema,
  specDigest: digestSchema,
  toolchainDigest: digestSchema,
  commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
  run: z.strictObject({
    id: identifier,
    origin: z.enum(['local', 'ci']),
    workflowIdentity: z.string().min(1).max(4096).optional(),
    url: z.url().optional(),
  }),
  counts: countsSchema.optional(),
  reviewId: identifier.optional(),
}).superRefine((item, ctx) => {
  if (new Set(item.artifactPaths).size !== item.artifactPaths.length ||
      Object.keys(item.artifactDigests).length !== item.artifactPaths.length ||
      item.artifactPaths.some(file => !item.artifactDigests[file])) {
    ctx.addIssue({ code: 'custom', message: 'Every artifact needs exactly one content digest' });
  }
});

export const gateContextSchema = z.strictObject({
  runId: identifier,
  sourceDigest: digestSchema,
  specDigest: digestSchema,
  toolchainDigest: digestSchema,
  expectedSourceDigests: z.record(identifier, digestSchema).optional(),
  commit: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/).optional(),
  approval: z.enum(['approved', 'pending', 'invalid']),
  mode: z.enum(['trial', 'ci']),
  authenticatedRunId: identifier.optional(),
  approvedAssumptions: strings.default([]),
});
