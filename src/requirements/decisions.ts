import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { isUtf8 } from 'node:buffer';
import { resolveProjectPath } from '../verification/paths.js';
import { z } from 'zod';
import { parseDocument } from 'yaml';
import { identifier } from './schema.js';
import { sha256 } from '../verification/digest.js';
import type { Project } from './project.js';
const text = z.string().min(1).max(4096);
const relative = z.string().min(1).max(1000).refine(p => !p.startsWith('/') && !/^[a-z]:/i.test(p) && !/[\x00-\x1f\x7f\\]/.test(p) && p.split('/').every(s => s !== '' && s !== '.' && s !== '..'));
const decision = z.strictObject({ id: identifier, group: identifier, kind: z.enum(['human-specification', 'fact', 'implementation']), requirementIds: z.array(identifier).min(1).max(20), state: z.enum(['open', 'answered']), question: text, recommendation: text, alternatives: z.array(z.strictObject({ label: text, tradeoff: text })).min(2).max(5), impact: text, blocking: z.boolean(), answer: text.optional(), evidence: z.array(z.strictObject({ file: relative, line: z.number().int().positive() })).min(1).max(10) }).superRefine((v, c) => {
    if (v.state === 'answered' && !v.answer)
        c.addIssue({ code: 'custom', message: 'An authored answer is required' });
    if (new Set(v.requirementIds).size !== v.requirementIds.length)
        c.addIssue({ code: 'custom', message: 'Duplicate requirement reference' });
});
const schema = z.strictObject({ schemaVersion: z.literal(1), decisions: z.array(decision).max(100) });
export type Decision = z.infer<typeof decision>;
export interface DecisionRegistry {
    fileDigest: string;
    items: (Decision & {
        mustResolve: boolean;
        evidence: (Decision['evidence'][number] & {
            digest: string;
        })[];
    })[];
}
async function readDecisionText(root: string, file: string, limit = 1048576): Promise<string> {
    const resolved = await resolveProjectPath(root, file);
    const handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
        const info = await handle.stat();
        if (!info.isFile() || info.size > limit)
            throw new Error('Invalid or oversized decision input');
        const bytes = Buffer.alloc(limit + 1);
        let total = 0;
        while (total <= limit) {
            const r = await handle.read(bytes, total, bytes.length - total, null);
            if (!r.bytesRead)
                break;
            total += r.bytesRead;
        }
        if (total > limit || !isUtf8(bytes.subarray(0, total)))
            throw new Error('Decision input must be bounded UTF-8 text');
        return bytes.subarray(0, total).toString('utf8');
    }
    finally {
        await handle.close();
    }
}
/** Authored data, never an authenticated human approval or executable instruction. */
export async function readDecisionRegistry(project: Project): Promise<DecisionRegistry | undefined> {
    let raw: string;
    try {
        raw = await readDecisionText(project.root, '.pdd/decisions.yaml', 262144);
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            return undefined;
        throw error;
    }
    const document = parseDocument(raw, { uniqueKeys: true, strict: true, stringKeys: true, prettyErrors: false });
    if (document.errors.length || document.warnings.length)
        throw new Error('Invalid decision registry YAML');
    const parsed = schema.parse(document.toJS({ maxAliasCount: 0 }));
    if (new Set(parsed.decisions.map(d => d.id)).size !== parsed.decisions.length)
        throw new Error('Duplicate decision ID');
    const requirements = new Map(project.requirements.map(r => [r.id, r]));
    const texts = new Map<string, string>();
    let bytes = 0;
    const items: DecisionRegistry['items'] = [];
    for (const item of parsed.decisions) {
        if (item.requirementIds.some(id => !requirements.has(id)))
            throw new Error('Unknown decision requirement');
        const evidence: DecisionRegistry['items'][number]['evidence'] = [];
        for (const ref of item.evidence) {
            let source = texts.get(ref.file);
            if (source === undefined) {
                if (texts.size >= 200)
                    throw new Error('Decision evidence file limit');
                source = await readDecisionText(project.root, ref.file);
                bytes += Buffer.byteLength(source);
                if (bytes > 8388608)
                    throw new Error('Decision evidence byte limit');
                texts.set(ref.file, source);
            }
            if (ref.line > source.split('\n').length)
                throw new Error('Decision evidence line is outside the file');
            evidence.push({ ...ref, digest: sha256(source) });
        }
        items.push({ ...item, evidence, mustResolve: item.kind === 'human-specification' && item.state === 'open' && (item.blocking || item.requirementIds.some(id => requirements.get(id)!.risk === 'high')) });
    }
    return { fileDigest: sha256(raw), items };
}
